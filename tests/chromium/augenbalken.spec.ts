// Chromium: Preset Augenbalken (Eye bar). Pixelmessung des Balkens (auch bei ausgeschalteten Augen, geneigtem Gesicht, mehreren Gesichtern, PNG mit Alpha),
// bewegtes SVG, Seite mit Bild, Leinwand, Video und Pause, Hinweis in "My grip". Die Preset-Wahl in der Oberflaeche steht in presets.spec.ts.
// Testbilder aus ../05 Testbilder (nie im Repo): fehlen sie, ist der Test ROT, nur mit VEIL_OHNE_TESTBILDER=1 wird er laut uebersprungen.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { GRIP_AUGENBALKEN, GRIP_SATZ } from '../../entrypoints/popup/texte';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

const BILD_MIT_GESICHT = 'sfw-001-portraet.jpg';
const BILD_NSFW = '_DSC6278.JPG';
const ROSA = [255, 79, 163];
// Patch-Bilder des Dummy-Packs sind 480 x 360 (scripts/pack/baue-pack.mjs, dummyBild).
const PATCH_B = 480;
const PATCH_H = 360;

const ZONEN_BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ZONEN_ALLE = ['eyes', 'mouth', 'face', 'head', ...ZONEN_BEDECKBAR];
function zonenNur(an: string[]): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ZONEN_ALLE) z[n] = ZONEN_BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: false } : { an: an.includes(n) };
  return z;
}

let profil = '';
let ordner = '';
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const popupUrl = () => `chrome-extension://${erweiterungsId}/popup.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
const speicher = (seite: Page, schluessel: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], schluessel);

function nachricht(quelle: unknown, an: string[], preset: string, rendern = true) {
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    quelle,
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: zonenNur(an), rand: 0.15, preset },
    rendern,
  };
}
const urlQuelle = (satz: string, name: string) => ({ art: 'url', url: `${basis}/testbild/${satz}/${encodeURIComponent(name)}`, referer: '' });

async function ladeBild(satz: string, name: string): Promise<Buffer | null> {
  const antwort = await fetch(`${basis}/testbild/${satz}/${encodeURIComponent(name)}`);
  return antwort.ok ? Buffer.from(await antwort.arrayBuffer()) : null;
}

// Fehlt das Testbild: ROT, ausser mit VEIL_OHNE_TESTBILDER=1 (dann laut uebersprungen).
async function brauchtBild(satz: string, name: string): Promise<Buffer> {
  const bild = await ladeBild(satz, name);
  if (bild) return bild;
  if (OHNE_TESTBILDER) {
    console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Test mit ${satz}/${name} uebersprungen`);
    test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
  }
  throw new Error(`Testbild ${satz}/${name} fehlt (../05 Testbilder); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
}

async function rohPixel(bytes: Buffer): Promise<{ daten: Buffer; b: number; h: number }> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { daten: data, b: info.width, h: info.height };
}
const ausDataUrl = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
const dataUrlVon = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

interface Flaeche {
  zone: string;
  box: number[];
  balken?: { mitte: number[]; breite: number; hoehe: number; winkel: number };
}

// Liegt der Punkt im Balken der Flaeche, um `rand` Pixel nach innen versetzt (negativ: nach aussen)? Gedrehter Balken in seinem Eigenmass.
function imBalken(f: Flaeche, x: number, y: number, rand: number): boolean {
  if (f.balken) {
    const b = f.balken;
    const dx = x + 0.5 - b.mitte[0]!;
    const dy = y + 0.5 - b.mitte[1]!;
    const c = Math.cos(-b.winkel);
    const s = Math.sin(-b.winkel);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    return Math.abs(lx) <= b.breite / 2 - rand && Math.abs(ly) <= b.hoehe / 2 - rand;
  }
  const [bx, by, bw, bh] = f.box as [number, number, number, number];
  return x >= bx + rand && x < bx + bw - rand && y >= by + rand && y < by + bh - rand;
}

interface Messung {
  innenAnteilSchwarz: number; // Anteil der Innenpixel (3 px vom Rand) mit allen Kanaelen unter 50
  innenPixel: number;
  aussenPixel: number;
  aussenMittel: number; // mittlere Abweichung ausserhalb (8 px Abstand zum Balken) gegen das Original
  aussenAnteilGross: number; // Anteil der Aussenpixel mit Abweichung ueber 48
  rosaImRand: number; // Pixel nahe Rosa im 6-px-Streifen um den Balken
}

// Misst das Ergebnis gegen das Original (beide gleich gross, das Original ist hoechstens 1600 px lang).
function messe(orig: { daten: Buffer; b: number; h: number }, aus: { daten: Buffer; b: number; h: number }, flaechen: Flaeche[]): Messung {
  expect([aus.b, aus.h]).toEqual([orig.b, orig.h]);
  let innen = 0;
  let schwarz = 0;
  let aussen = 0;
  let summe = 0;
  let gross = 0;
  let rosa = 0;
  for (let y = 0; y < orig.h; y++) {
    for (let x = 0; x < orig.b; x++) {
      const i = (y * orig.b + x) * 3;
      if (flaechen.some((f) => imBalken(f, x, y, 3))) {
        innen++;
        if (aus.daten[i]! < 50 && aus.daten[i + 1]! < 50 && aus.daten[i + 2]! < 50) schwarz++;
        continue;
      }
      if (flaechen.some((f) => imBalken(f, x, y, -8))) {
        const nah = Math.hypot(aus.daten[i]! - ROSA[0]!, aus.daten[i + 1]! - ROSA[1]!, aus.daten[i + 2]! - ROSA[2]!) < 60;
        if (flaechen.some((f) => imBalken(f, x, y, -6)) && nah) rosa++;
        continue;
      }
      aussen++;
      const d = (Math.abs(aus.daten[i]! - orig.daten[i]!) + Math.abs(aus.daten[i + 1]! - orig.daten[i + 1]!) + Math.abs(aus.daten[i + 2]! - orig.daten[i + 2]!)) / 3;
      summe += d;
      if (d > 48) gross++;
    }
  }
  return {
    innenAnteilSchwarz: innen ? schwarz / innen : 0,
    innenPixel: innen,
    aussenPixel: aussen,
    aussenMittel: aussen ? summe / aussen : 0,
    aussenAnteilGross: aussen ? gross / aussen : 0,
    rosaImRand: rosa,
  };
}

function pruefeBalken(m: Messung, name: string): void {
  console.log(`chromium: Eye bar ${name}: innen ${m.innenPixel} px, davon schwarz ${(m.innenAnteilSchwarz * 100).toFixed(1)} %, aussen ${m.aussenPixel} px, mittlere Abweichung ${m.aussenMittel.toFixed(2)}, ueber 48: ${(m.aussenAnteilGross * 100).toFixed(2)} %, rosa im Rand ${m.rosaImRand}`);
  expect(m.innenPixel).toBeGreaterThan(500);
  expect(m.innenAnteilSchwarz).toBeGreaterThan(0.99); // deckendes Schwarz
  expect(m.aussenMittel).toBeLessThan(4); // sonst unveraendert (nur JPEG-Rauschen)
  expect(m.aussenAnteilGross).toBeLessThan(0.005);
  expect(m.rosaImRand).toBeLessThan(5); // kein pinker Rahmen
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-augen-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-augen-datei-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  // Warten, bis der Erkenner (Offscreen-Dokument) antwortet.
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  await expect
    .poll(
      async () => {
        try {
          await seite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }));
          return (await ausWorker({ ziel: 'erkenner', typ: 'wecke' }))?.ok === true;
        } catch {
          return false;
        }
      },
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true);
  await seite.close();
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('Eye bar: schwarzer Balken ueber den Augen, sonst unveraenderte Pixel, auch bei ausgeschalteten Augen', async () => {
  test.setTimeout(120_000);
  const original = await brauchtBild('sfw', BILD_MIT_GESICHT);
  const orig = await rohPixel(original);
  // Nur Brust an, Augen AUS: im Stil Eye bar gelten trotzdem nur die Augen.
  const a = await ausWorker(nachricht(urlQuelle('sfw', BILD_MIT_GESICHT), ['breast'], 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect(a.flaechen.length).toBeGreaterThanOrEqual(1);
  expect((a.flaechen as Flaeche[]).every((f) => f.zone === 'eyes')).toBe(true);
  expect(String(a.bild).startsWith('data:image/jpeg')).toBe(true);
  const yunetAugen = (a.treffer as { zone: string; quelle?: string; box: number[] }[]).find((t) => t.zone === 'eyes' && t.quelle === 'yunet');
  expect(yunetAugen, 'YuNet laeuft auch bei ausgeschalteten Augen').toBeTruthy();
  const aus = await rohPixel(ausDataUrl(a.bild));
  const m = messe(orig, aus, a.flaechen);
  pruefeBalken(m, BILD_MIT_GESICHT);
  // Der Balken (ob gedreht oder nicht) deckt die Mitte und die Punkte bei 60 % der halben Augenbox von YuNet; ist er achsenparallel, auch die
  // Ecken der Augenbox. Gepruefte Flaeche: die mit der naechsten Mitte (gilt auch im gedrehten Fall, kein stilles Ueberspringen).
  const [ex, ey, ew, eh] = yunetAugen!.box as [number, number, number, number];
  const mitteAugen = [ex + ew / 2, ey + eh / 2];
  const f = [...(a.flaechen as Flaeche[])].sort((p, q) => Math.hypot(p.box[0]! + p.box[2]! / 2 - mitteAugen[0]!, p.box[1]! + p.box[3]! / 2 - mitteAugen[1]!) - Math.hypot(q.box[0]! + q.box[2]! / 2 - mitteAugen[0]!, q.box[1]! + q.box[3]! / 2 - mitteAugen[1]!))[0]!;
  console.log(`chromium: Eye bar Deckung der Augenbox ${yunetAugen!.box}: Balken ${f.balken ? `gedreht ${((f.balken.winkel * 180) / Math.PI).toFixed(1)} Grad` : 'achsenparallel'}`);
  const punkte: [number, number][] = [mitteAugen as [number, number]];
  for (const sx of [-0.6, 0.6]) for (const sy of [-0.6, 0.6]) punkte.push([mitteAugen[0]! + (sx * ew) / 2, mitteAugen[1]! + (sy * eh) / 2]);
  if (!f.balken) punkte.push([ex, ey], [ex + ew - 1, ey], [ex, ey + eh - 1], [ex + ew - 1, ey + eh - 1]);
  for (const [px, py] of punkte) expect(imBalken(f, Math.floor(px), Math.floor(py), 0), `Punkt ${px},${py} der Augenbox liegt im Balken`).toBe(true);
  // Alle Zonen an: im Stil Eye bar ist es derselbe Balken (gleiche Flaechen)
  const b = await ausWorker(nachricht(urlQuelle('sfw', BILD_MIT_GESICHT), ZONEN_ALLE, 'augenbalken', false));
  expect(b.flaechen).toEqual(a.flaechen);
  // Steigerung Stufe 4 (ganzVerdecken) macht im Stil Eye bar kein ganzes Bild daraus
  const nachrichtGanz = nachricht(urlQuelle('sfw', BILD_MIT_GESICHT), ['breast'], 'augenbalken', false);
  (nachrichtGanz.einstellungen as Record<string, unknown>).ganzVerdecken = true;
  const ganz = await ausWorker(nachrichtGanz);
  expect(ganz.flaechen).toEqual(a.flaechen);
});

test('Eye bar: ein Bild ohne Gesicht bleibt frei (keine Flaeche, kein Bild); ein Bild mit Koerperzonen bekommt nur Augenbalken', async () => {
  test.setTimeout(120_000);
  const leer = await sharp({ create: { width: 480, height: 360, channels: 3, background: { r: 120, g: 160, b: 200 } } }).png().toBuffer();
  const a = await ausWorker(nachricht({ art: 'daten', dataUrl: dataUrlVon(leer) }, ZONEN_ALLE, 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect(a.flaechen).toEqual([]);
  expect(a.bild).toBeUndefined();
  // Gegenprobe zur Gegenprobe: derselbe leere Satz im Stil Mosaik mit allen Zonen ist ebenfalls leer (kein Bild ohne Treffer) und die
  // Testaussage ist keine Folge eines kaputten Testbilds: ein Bild mit Koerper liefert in Mosaik mehr als Augenflaechen.
  const nsfw = await ladeBild('nsfw', BILD_NSFW);
  if (!nsfw) {
    if (OHNE_TESTBILDER) {
      console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Teil mit nsfw/${BILD_NSFW} uebersprungen`);
      return;
    }
    throw new Error(`Testbild nsfw/${BILD_NSFW} fehlt (../05 Testbilder)`);
  }
  const mosaik = await ausWorker(nachricht(urlQuelle('nsfw', BILD_NSFW), ZONEN_ALLE, 'mosaik', false));
  expect(mosaik.flaechen.some((f: Flaeche) => f.zone !== 'eyes')).toBe(true);
  const balken = await ausWorker(nachricht(urlQuelle('nsfw', BILD_NSFW), ZONEN_ALLE, 'augenbalken'));
  expect(balken.ok, balken.fehler).toBe(true);
  expect((balken.flaechen as Flaeche[]).every((f) => f.zone === 'eyes')).toBe(true);
  console.log(`chromium: Eye bar ${BILD_NSFW}: ${balken.flaechen.length} Augenbalken, Mosaik haette ${mosaik.flaechen.length} Flaechen`);
  if (balken.flaechen.length > 0) {
    const orig = await rohPixel(nsfw);
    pruefeBalken(messe(orig, await rohPixel(ausDataUrl(balken.bild)), balken.flaechen), BILD_NSFW);
  } else {
    expect(balken.bild).toBeUndefined();
  }
});

test('Eye bar: ein geneigtes Gesicht bekommt einen gedrehten Balken entlang der Augenlinie', async () => {
  test.setTimeout(120_000);
  const original = await brauchtBild('sfw', BILD_MIT_GESICHT);
  // 25 Grad im Uhrzeigersinn gedreht (die YuNet-Augenpunkte folgen der Neigung nur gedaempft: gemessen 8 Grad bei 25, unter 3 Grad bei 18), mit Randfarbe aufgefuellt; das gedrehte Bild ist die Eingabe und das Original dieser Messung.
  const gedreht = await sharp(original).rotate(25, { background: { r: 128, g: 128, b: 128 } }).jpeg({ quality: 92 }).toBuffer();
  const orig = await rohPixel(gedreht);
  const a = await ausWorker(nachricht({ art: 'daten', dataUrl: `data:image/jpeg;base64,${gedreht.toString('base64')}` }, ['breast'], 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect(a.flaechen.length).toBeGreaterThanOrEqual(1);
  const gedrehteFlaeche = (a.flaechen as Flaeche[]).find((f) => f.balken);
  expect(gedrehteFlaeche, `YuNet lieferte einen Winkel (Flaechen ${JSON.stringify(a.flaechen)})`).toBeTruthy();
  const grad = (gedrehteFlaeche!.balken!.winkel * 180) / Math.PI;
  console.log(`chromium: geneigtes Gesicht: Balken um ${grad.toFixed(1)} Grad gedreht (Bild 25 Grad im Uhrzeigersinn)`);
  expect(grad).toBeGreaterThan(3); // im Uhrzeigersinn, wie das Bild
  expect(grad).toBeLessThan(35);
  const aus = await rohPixel(ausDataUrl(a.bild));
  const m = messe(orig, aus, a.flaechen);
  pruefeBalken(m, 'geneigt');
  // Die gedrehte Ecke liegt im Balken, die achsenparallele Box ueber dem Balken enthaelt aber mehr als den Balken (Gegenpruefung der Drehung).
  const b = gedrehteFlaeche!.balken!;
  const innenEcke = [b.mitte[0]! + (b.breite / 2 - 4) * Math.cos(b.winkel) - (b.hoehe / 2 - 4) * Math.sin(b.winkel), b.mitte[1]! + (b.breite / 2 - 4) * Math.sin(b.winkel) + (b.hoehe / 2 - 4) * Math.cos(b.winkel)];
  const i = (Math.round(innenEcke[1]!) * orig.b + Math.round(innenEcke[0]!)) * 3;
  expect(Math.max(aus.daten[i]!, aus.daten[i + 1]!, aus.daten[i + 2]!)).toBeLessThan(60);
  const [bx, by, bw, bh] = gedrehteFlaeche!.box as [number, number, number, number];
  expect(bw * bh).toBeGreaterThan(b.breite * b.hoehe * 1.05);
});

// ---------- Seite: Bild, Leinwand, Video, Pause, mehrere Gesichter, bewegtes SVG ----------

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const c = (globalThis as any).chrome;
    const alt = (await c.storage.local.get('einstellungen')).einstellungen ?? {};
    await c.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}
const urteil = (seite: Page, id: string) => seite.evaluate((i) => document.getElementById(i)!.dataset.veil ?? '', id);

test('Eye bar auf einer Seite: das Bild bekommt den Balken, Leinwand und Video mit Gesicht werden ganz verdeckt, die Pause gibt alles frei', async () => {
  test.setTimeout(150_000);
  await brauchtBild('sfw', BILD_MIT_GESICHT);
  await setze({ preset: 'augenbalken', pause: false });
  const seite = await context.newPage();
  try {
    await seite.goto(`${basis}/augenbalken.html`);
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 20_000 }).toBe('1');
    // Bild: zensiert, die Quelle ist jetzt das Ergebnis mit dem Balken (Data-URL), Mitte der Augen schwarz
    await expect.poll(() => urteil(seite, 'bild'), { timeout: 30_000 }).toBe('zensiert');
    const bildPixel = await seite.evaluate(async () => {
      const el = document.getElementById('bild') as HTMLImageElement;
      const b = await createImageBitmap(await (await fetch(el.src)).blob());
      const c = new OffscreenCanvas(b.width, b.height);
      const g = c.getContext('2d')!;
      g.drawImage(b, 0, 0);
      return { src: el.src.slice(0, 23), b: b.width, h: b.height, daten: Array.from(g.getImageData(0, 0, b.width, b.height).data) };
    });
    expect(bildPixel.src).toBe('data:image/jpeg;base64,');
    let dunkel = 0;
    for (let i = 0; i < bildPixel.daten.length; i += 4) if (bildPixel.daten[i]! < 30 && bildPixel.daten[i + 1]! < 30 && bildPixel.daten[i + 2]! < 30) dunkel++;
    console.log(`chromium: Eye bar auf der Seite: Bild zensiert, ${dunkel} schwarze Pixel (${((dunkel / (bildPixel.b * bildPixel.h)) * 100).toFixed(1)} %)`);
    expect(dunkel).toBeGreaterThan(5000);
    expect(dunkel / (bildPixel.b * bildPixel.h)).toBeLessThan(0.08); // ein Balken, kein ganzes Bild
    // Leinwand und Video mit Gesicht: das Urteil heisst ganz verdeckt (Eye bar gilt hier noch nicht, die Hilfe sagt es)
    await expect.poll(() => urteil(seite, 'leinwand'), { timeout: 30_000 }).not.toBe('');
    await expect.poll(() => urteil(seite, 'film'), { timeout: 30_000 }).not.toBe('');
    const medien = await seite.evaluate(() => ['leinwand', 'film'].map((id) => ({ id, urteil: document.getElementById(id)!.dataset.veil, filter: getComputedStyle(document.getElementById(id)!).filter, opacity: getComputedStyle(document.getElementById(id)!).opacity })));
    console.log(`chromium: Eye bar Leinwand und Video: ${JSON.stringify(medien)}`);
    for (const m of medien) expect(m.urteil, `${m.id} mit Gesicht ganz verdeckt`).toBe('verdeckt');
    for (const m of medien) expect(m.filter).toContain('blur');
    // Pause: Bild frei (Original, keine Data-URL), Leinwand und Video ohne Urteil und ohne Filter
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
    expect(await seite.evaluate(() => (document.getElementById('bild') as HTMLImageElement).src.startsWith('data:'))).toBe(false);
    expect(await seite.evaluate(() => document.querySelectorAll('[data-veil]').length)).toBe(0);
    expect(await seite.evaluate(() => ['bild', 'leinwand', 'film'].every((id) => getComputedStyle(document.getElementById(id)!).filter === 'none' && getComputedStyle(document.getElementById(id)!).opacity === '1'))).toBe(true);
  } finally {
    await setze({ pause: false, preset: 'mosaik' });
    await seite.close();
  }
});

test('Eye bar: mehrere Gesichter in einem Bild bekommen je einen Balken', async () => {
  test.setTimeout(120_000);
  // Beide Haelften zusammen bleiben unter 1600 px Breite (laengere Bilder verkleinert der Erkenner, dann stimmten die Koordinaten nicht mehr).
  const original = await sharp(await brauchtBild('sfw', BILD_MIT_GESICHT)).resize({ width: 700 }).jpeg({ quality: 92 }).toBuffer();
  const meta = await sharp(original).metadata();
  const w = meta.width!;
  const h = meta.height!;
  // Zwei Kopien nebeneinander, die zweite etwas kleiner und tiefer: zwei Gesichter in einem Bild
  const klein = await sharp(original).resize(Math.round(w * 0.7)).jpeg({ quality: 92 }).toBuffer();
  const kleinMeta = await sharp(klein).metadata();
  const zwei = await sharp({ create: { width: w * 2, height: h, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([{ input: original, left: 0, top: 0 }, { input: klein, left: w + 60, top: h - kleinMeta.height! }])
    .jpeg({ quality: 92 })
    .toBuffer();
  const orig = await rohPixel(zwei);
  const a = await ausWorker(nachricht({ art: 'daten', dataUrl: `data:image/jpeg;base64,${zwei.toString('base64')}` }, ['breast'], 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  const eyes = (a.flaechen as Flaeche[]).filter((f) => f.zone === 'eyes');
  expect(eyes.length, `Balken je Gesicht (${JSON.stringify(a.flaechen)})`).toBeGreaterThanOrEqual(2);
  expect(eyes.length).toBe(a.flaechen.length);
  // Einer im linken, einer im rechten Bildteil
  const mitten = (f: Flaeche) => f.box[0]! + f.box[2]! / 2;
  expect(eyes.some((f) => mitten(f) < w)).toBe(true);
  expect(eyes.some((f) => mitten(f) > w)).toBe(true);
  pruefeBalken(messe(orig, await rohPixel(ausDataUrl(a.bild)), a.flaechen), 'zwei Gesichter');
});

test('Eye bar: bewegtes SVG wird ganz Mosaik (Sicherheit vor Eye bar), mit pinkem Rahmen und ohne schwarzen Balken', async () => {
  test.setTimeout(60_000);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="rgb(40,160,60)"><animate attributeName="x" from="0" to="20" dur="1s" repeatCount="indefinite"/></rect></svg>';
  const a = await ausWorker(nachricht({ art: 'daten', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }, ['breast'], 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect(a.flaechen).toHaveLength(1);
  expect(a.flaechen[0].box).toEqual([0, 0, a.breite, a.hoehe]);
  const aus = await rohPixel(ausDataUrl(a.bild));
  const px = (x: number, y: number) => [0, 1, 2].map((k) => aus.daten[(y * aus.b + x) * 3 + k]!);
  const rand = px(1, Math.floor(aus.h / 2));
  const mitte = px(Math.floor(aus.b / 2), Math.floor(aus.h / 2));
  console.log(`chromium: bewegtes SVG in Eye bar: Rand ${rand}, Mitte ${mitte}`);
  expect(Math.hypot(rand[0]! - ROSA[0]!, rand[1]! - ROSA[1]!, rand[2]! - ROSA[2]!)).toBeLessThan(90); // pinker Rahmen: Mosaik, nicht Balken
  expect(Math.max(...mitte)).toBeGreaterThan(80); // nicht schwarz
});

test('Eye bar: PNG mit durchsichtigen Pixeln kommt als PNG mit Alpha zurueck, ein deckendes PNG und alle anderen Stile bleiben JPEG', async () => {
  test.setTimeout(90_000);
  const original = await brauchtBild('sfw', BILD_MIT_GESICHT);
  // Eine Ecke durchsichtig machen (links oben 60 x 60), der Rest deckend
  const meta = await sharp(original).metadata();
  const rgba = await sharp(original).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) rgba[(y * meta.width! + x) * 4 + 3] = 0;
  const mitAlpha = await sharp(rgba, { raw: { width: meta.width!, height: meta.height!, channels: 4 } }).png().toBuffer();
  const deckend = await sharp(original).png().toBuffer();
  const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  const a = await ausWorker(nachricht({ art: 'daten', dataUrl: dataUrl(mitAlpha) }, ['breast'], 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect(a.flaechen.length).toBeGreaterThanOrEqual(1);
  expect(String(a.bild).startsWith('data:image/png')).toBe(true);
  const roh = await sharp(ausDataUrl(a.bild)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(roh.data[3]).toBe(0); // links oben noch durchsichtig
  expect(roh.data[((100 * roh.info.width) + 100) * 4 + 3]).toBe(255);
  const b = await ausWorker(nachricht({ art: 'daten', dataUrl: dataUrl(deckend) }, ['breast'], 'augenbalken'));
  expect(String(b.bild).startsWith('data:image/jpeg')).toBe(true);
  const c = await ausWorker(nachricht({ art: 'daten', dataUrl: dataUrl(mitAlpha) }, ['face'], 'mosaik'));
  expect(String(c.bild).startsWith('data:image/jpeg')).toBe(true);
  console.log('chromium: Eye bar: PNG mit Alpha bleibt PNG, deckendes PNG und Mosaik bleiben JPEG');
});

test('Popup: "My grip" sagt bei Eye bar, dass der Griff ruht; bei anderen Stilen steht nur der gewohnte Satz', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await seite.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({
        pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: ['zensur:steigerung', 'stil:mia-patch', 'erwachsen:vorschau'], bilder: 7, groesse: 1, importiert: 1 },
      });
    });
    await seite.reload();
    await expect(seite.locator('#steigerung')).toBeVisible();
    await expect(seite.locator('#grip-satz')).toHaveText(GRIP_SATZ);
    await setze({ preset: 'augenbalken' });
    await expect(seite.locator('#grip-satz')).toHaveText(`${GRIP_SATZ} ${GRIP_AUGENBALKEN}`);
    await setze({ preset: 'mosaik' });
    await expect(seite.locator('#grip-satz')).toHaveText(GRIP_SATZ);
  } finally {
    await seite.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.remove('pack');
    });
    await seite.close();
  }
});

test('Eye bar mit Alpha: ist das PNG groesser als die Grenze (3 MB), kommt JPEG zurueck, kleine PNG bleiben PNG', async () => {
  test.setTimeout(120_000);
  const original = await brauchtBild('sfw', BILD_MIT_GESICHT);
  const breite = 1600;
  const basis0 = await sharp(original).resize({ width: breite }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) basis0.data[(y * basis0.info.width + x) * 4 + 3] = 0; // durchsichtige Ecke
  // Rauschen (zufaellige Pixel mit kleiner Deckkraft) macht das PNG unkomprimierbar gross; das Gesicht bleibt erkennbar
  const rauschen = Buffer.alloc(basis0.info.width * basis0.info.height * 4);
  for (let i = 0; i < rauschen.length; i += 4) {
    rauschen[i] = Math.random() * 255;
    rauschen[i + 1] = Math.random() * 255;
    rauschen[i + 2] = Math.random() * 255;
    rauschen[i + 3] = 18;
  }
  const gross = await sharp(basis0.data, { raw: { width: basis0.info.width, height: basis0.info.height, channels: 4 } })
    .composite([{ input: rauschen, raw: { width: basis0.info.width, height: basis0.info.height, channels: 4 }, blend: 'over' }])
    .png({ compressionLevel: 1 })
    .toBuffer();
  expect(gross.length, 'das Test-PNG ist groesser als die Grenze').toBeGreaterThan(3_000_000);
  const a = await ausWorker(nachricht({ art: 'daten', dataUrl: `data:image/png;base64,${gross.toString('base64')}` }, ['breast'], 'augenbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect(a.flaechen.length).toBeGreaterThanOrEqual(1);
  console.log(`chromium: Eye bar mit grossem PNG (${(gross.length / 1e6).toFixed(1)} MB): Ausgabe ${String(a.bild).slice(0, 15)}, ${(String(a.bild).length / 1e6).toFixed(1)} MB`);
  expect(String(a.bild).startsWith('data:image/jpeg')).toBe(true);
  // Gegenstueck: das kleine PNG mit Alpha (Test oben) bleibt PNG
});
