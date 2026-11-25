// Chromium: Custom-Baukasten (Phase 11 E6a, T5). Die echte Erweiterung auf der lokalen Testseite (tests/fixtures/custom.html, ein Bild vom Testserver):
// (a) Schwarz mit Woertern plus weiches Gesicht wird so gemalt, (b) der Wechsel eines Bausteins bei offener Seite malt das Bild neu, (c) eine ungueltige Mischung im
// Speicher malt Mosaik, (d) Mias Gesicht und Sticker ohne Pack malen Mosaik an beiden Stellen. Testbilder aus ../05 Testbilder (nie im Repo): fehlen sie, ist der
// Test ROT, nur mit VEIL_OHNE_TESTBILDER=1 wird er laut uebersprungen. Ohne Pack (frisches Profil).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

const GESICHT = 'sfw-001-portraet.jpg'; // 1280 x 800, Gesicht (YuNet), kleiner als das Arbeitsbild: Seite und Antwort haben dieselben Masse
const KOERPER = '_DSC6278.JPG';
const ROSA_RAHMEN = [255, 79, 163];
const ROSA_WORT = [255, 179, 211];
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
function zonenNur(an: string[], bedeckt = true): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ALLE) z[n] = BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt } : { an: an.includes(n) };
  return z;
}

let profil = '';
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
const speicher = (seite: Page, schluessel: string) => seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], schluessel);
// Schreibt Einstellungen roh in den Speicher (so wie ein Altbestand oder ein Fehler sie hinterliesse); `ersetze` legt den ganzen Wert neu an.
const schreibeEinst = (seite: Page, teil: Record<string, unknown>, ersetze = false) =>
  seite.evaluate(
    async ([t, neu]) => {
      const c = (globalThis as any).chrome;
      const alt = neu ? {} : ((await c.storage.local.get('einstellungen')).einstellungen ?? {});
      await c.storage.local.set({ einstellungen: { ...alt, ...(t as Record<string, unknown>) } });
    },
    [teil, ersetze] as const,
  );

type Box = [number, number, number, number];
interface Flaeche { zone: string; box: Box; behandlung?: string; ersatz?: string }
interface Pixel { daten: Buffer; b: number; h: number }
type Mischung = { gesicht: string; flaeche: string; woerter: boolean };

// Die Pruefung des Erkenners wie der Bild-Weg des Schleiers sie schickt (verschmelzen: true), mit `preset` und der Mischung.
function nachricht(quelle: unknown, an: string[], preset: string, custom?: unknown, extra: Record<string, unknown> = {}) {
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `custom-${Math.random().toString(36).slice(2, 8)}`,
    quelle,
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: zonenNur(an), rand: 0.15, preset, ...(custom === undefined ? {} : { custom }), ...extra },
    rendern: true,
    verschmelzen: true,
  };
}
const urlQuelle = (satz: string, name: string) => ({ art: 'url', url: `${basis}/testbild/${satz}/${encodeURIComponent(name)}`, referer: '' });

async function brauchtBild(satz: string, name: string): Promise<Buffer> {
  const antwort = await fetch(`${basis}/testbild/${satz}/${encodeURIComponent(name)}`);
  if (antwort.ok) return Buffer.from(await antwort.arrayBuffer());
  if (OHNE_TESTBILDER) {
    console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Test mit ${satz}/${name} uebersprungen`);
    test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
  }
  throw new Error(`Testbild ${satz}/${name} fehlt (../05 Testbilder); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
}
async function rohPixel(bytes: Buffer): Promise<Pixel> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { daten: Buffer.from(data), b: info.width, h: info.height };
}
const ausDataUrl = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

// Kennzahlen einer Box (Pixel um `inset` nach innen versetzt): Anteil dunkel, Anzahl Wort-Rosa, Anzahl Rahmen-Rosa, mittlere Abweichung zum Original.
function stat(orig: Pixel, aus: Pixel, box: Box, inset = 0) {
  const [bx, by, bw, bh] = box;
  let n = 0;
  let dunkel = 0;
  let wort = 0;
  let rahmen = 0;
  let summe = 0;
  for (let y = by + inset; y < by + bh - inset; y++) {
    for (let x = bx + inset; x < bx + bw - inset; x++) {
      const i = (y * aus.b + x) * 3;
      const r = aus.daten[i]!;
      const g = aus.daten[i + 1]!;
      const b = aus.daten[i + 2]!;
      n++;
      if (r < 60 && g < 60 && b < 60) dunkel++;
      if (Math.hypot(r - ROSA_WORT[0]!, g - ROSA_WORT[1]!, b - ROSA_WORT[2]!) < 45) wort++;
      if (Math.hypot(r - ROSA_RAHMEN[0]!, g - ROSA_RAHMEN[1]!, b - ROSA_RAHMEN[2]!) < 60) rahmen++;
      summe += (Math.abs(r - orig.daten[i]!) + Math.abs(g - orig.daten[i + 1]!) + Math.abs(b - orig.daten[i + 2]!)) / 3;
    }
  }
  return { n, dunkel: dunkel / Math.max(1, n), wort, rahmen, mittel: summe / Math.max(1, n) };
}

async function warteAufErkenner(): Promise<void> {
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
}

// Pixel des Bildes #bild einer Seite (so wie es gerade angezeigt wird), und ein Hash der Dateibytes (gleiche Bytes heisst gleich gemalt).
async function seitenBildPixel(seite: Page): Promise<Pixel> {
  const roh = await seite.evaluate(async () => {
    const el = document.getElementById('bild') as HTMLImageElement;
    const b = await createImageBitmap(await (await fetch(el.src)).blob());
    const c = new OffscreenCanvas(b.width, b.height);
    const g = c.getContext('2d')!;
    g.drawImage(b, 0, 0);
    const d = g.getImageData(0, 0, b.width, b.height).data;
    const rgb = new Uint8Array(b.width * b.height * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      rgb[j] = d[i]!;
      rgb[j + 1] = d[i + 1]!;
      rgb[j + 2] = d[i + 2]!;
    }
    return { b: b.width, h: b.height, daten: Array.from(rgb) };
  });
  return { daten: Buffer.from(roh.daten), b: roh.b, h: roh.h };
}
const seitenHash = (seite: Page): Promise<string> =>
  seite.evaluate(async () => {
    const el = document.getElementById('bild') as HTMLImageElement;
    const bytes = await (await (await fetch(el.src)).blob()).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
  });
const urteil = (seite: Page): Promise<string> => seite.evaluate(() => document.getElementById('bild')!.dataset.veil ?? '');
const istUrl = (seite: Page, teil: string): Promise<boolean> => seite.evaluate((t) => (document.getElementById('bild') as HTMLImageElement).src.startsWith(t), teil);

async function oeffneSeite(satz: string, bild: string): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(`${basis}/custom.html?satz=${satz}&bild=${encodeURIComponent(bild)}`);
  return seite;
}
const warteZensiert = (seite: Page, timeout = 60_000) => expect.poll(() => urteil(seite), { timeout, intervals: [200] }).toBe('zensiert');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-custom-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  await warteAufErkenner();
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

// Das Preset-Stand des Speichers fuer eine Pruefung auf der Seite: Zonen, Schwelle, Rand wie in der Nachricht.
const grund = (an: string[]) => ({ version: 1, pause: false, schwelle: 0.1, rand: 0.15, zonen: zonenNur(an), augenbalken: false });

test('T5a Schwarz mit Woertern und weiches Gesicht: das Gesicht ist weichgezeichnet (kein Rahmen, nicht dunkel), die Flaeche schwarz mit Wort', async () => {
  test.setTimeout(240_000);
  const m: Mischung = { gesicht: 'blur', flaeche: 'schwarz', woerter: true };
  const orig = await rohPixel(await brauchtBild('sfw', GESICHT));
  const hilf = await context.newPage();
  await hilf.goto(optionsUrl());
  // Gesicht: auf der Seite weichgezeichnet
  const af = await ausWorker(nachricht(urlQuelle('sfw', GESICHT), ['face'], 'custom', m));
  expect(af.ok, af.fehler).toBe(true);
  const gesicht = (af.flaechen as Flaeche[]).find((f) => f.zone === 'face')!;
  expect(gesicht.behandlung).toBe('blur');
  await schreibeEinst(hilf, { ...grund(['face']), preset: 'custom', custom: m }, true);
  const s1 = await oeffneSeite('sfw', GESICHT);
  try {
    await warteZensiert(s1);
    const p = await seitenBildPixel(s1);
    expect(p.b).toBe(orig.b);
    const k = stat(orig, p, gesicht.box, 6);
    console.log(`chromium: T5a Gesicht weich: Rahmen ${stat(orig, p, gesicht.box, 0).rahmen}, dunkel ${(k.dunkel * 100).toFixed(1)} %, Abweichung ${k.mittel.toFixed(1)}`);
    expect(stat(orig, p, gesicht.box, 0).rahmen, 'Weichzeichner hat keinen pinken Rahmen').toBeLessThan(10);
    expect(k.dunkel).toBeLessThan(0.3);
    expect(k.mittel, 'das Gesicht weicht vom Original ab').toBeGreaterThan(3);
    expect(k.wort, 'kein Wort auf dem Gesicht (Weichzeichner traegt keins)').toBeLessThan(5);
  } finally {
    await s1.close();
  }
  // Flaeche (hier die Kopf-Zone, die Koerper-Behandlung des Mixes): schwarz mit rosa Wort, kein Rahmen
  const ak = await ausWorker(nachricht(urlQuelle('sfw', GESICHT), ['head'], 'custom', m));
  const kopf = (ak.flaechen as Flaeche[])[0]!;
  expect(kopf.behandlung).toBe('schwarz-wort');
  await schreibeEinst(hilf, { ...grund(['head']), preset: 'custom', custom: m }, true);
  const s2 = await oeffneSeite('sfw', GESICHT);
  try {
    await warteZensiert(s2);
    const p = await seitenBildPixel(s2);
    const k = stat(orig, p, kopf.box, 8);
    console.log(`chromium: T5a Flaeche schwarz mit Wort: dunkel ${(k.dunkel * 100).toFixed(0)} %, Wortpixel ${k.wort}, Rahmen ${stat(orig, p, kopf.box, 0).rahmen}`);
    expect(k.dunkel).toBeGreaterThan(0.7);
    expect(k.wort).toBeGreaterThan(40);
    expect(stat(orig, p, kopf.box, 0).rahmen, 'Schwarz mit Wort hat keinen pinken Rahmen').toBe(0);
  } finally {
    await s2.close();
  }
  // Koerper (Antwort des Erkenners mit der Mischung, wie die Presets): schwarz mit Wort, ausserhalb unveraendert
  const gross = await brauchtBild('nsfw', KOERPER);
  const klein = await sharp(gross).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const origK = await rohPixel(klein);
  const ab = await ausWorker(nachricht({ art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` }, BEDECKBAR, 'custom', m));
  expect(ab.ok, ab.fehler).toBe(true);
  const f = [...(ab.flaechen as Flaeche[])].sort((p, q) => q.box[2] * q.box[3] - p.box[2] * p.box[3])[0]!;
  const aus = await rohPixel(ausDataUrl(ab.bild));
  const kk = stat(origK, aus, f.box, 8);
  console.log(`chromium: T5a Koerper: ${f.behandlung}, dunkel ${(kk.dunkel * 100).toFixed(0)} %, Wortpixel ${kk.wort}`);
  expect(f.behandlung).toBe('schwarz-wort');
  expect(kk.dunkel).toBeGreaterThan(0.7);
  expect(kk.wort).toBeGreaterThan(40);
  await hilf.close();
});

test('T5b Wechsel eines Bausteins bei offener Seite: das Bild wird neu gemalt (Gesicht, Flaeche, Woerter), je Wechsel genau wie bei einem Stilwechsel', async () => {
  test.setTimeout(300_000);
  const orig = await rohPixel(await brauchtBild('sfw', GESICHT));
  const hilf = await context.newPage();
  await hilf.goto(optionsUrl());
  const mosaik: Mischung = { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false };
  const af = await ausWorker(nachricht(urlQuelle('sfw', GESICHT), ['face'], 'custom', mosaik));
  const gesicht = (af.flaechen as Flaeche[]).find((f) => f.zone === 'face')!;
  const ak = await ausWorker(nachricht(urlQuelle('sfw', GESICHT), ['head'], 'custom', mosaik));
  const kopf = (ak.flaechen as Flaeche[])[0]!;
  const lies = async (s: Page, box: Box) => stat(orig, await seitenBildPixel(s), box, 6);
  const rahmen = async (s: Page, box: Box) => stat(orig, await seitenBildPixel(s), box, 0).rahmen;
  const flach = (box: Box) => Math.round(Math.min(box[2], box[3]) * 0.9);

  // Gesicht: Mosaik, dann Schwarz, dann Schwarz mit Wort, dann Weichzeichner, jeweils bei geoeffneter Seite
  await schreibeEinst(hilf, { ...grund(['face']), preset: 'custom', custom: mosaik }, true);
  const s = await oeffneSeite('sfw', GESICHT);
  try {
    await warteZensiert(s);
    expect(await rahmen(s, gesicht.box), 'Ausgang Mosaik: pinker Rahmen').toBeGreaterThan(flach(gesicht.box));
    expect((await lies(s, gesicht.box)).dunkel).toBeLessThan(0.5);
    await schreibeEinst(hilf, { custom: { ...mosaik, gesicht: 'schwarz' } });
    await expect.poll(async () => (await lies(s, gesicht.box)).dunkel, { timeout: 60_000, intervals: [500], message: 'Gesicht wird schwarz' }).toBeGreaterThan(0.9);
    expect(await rahmen(s, gesicht.box), 'Schwarz hat keinen Rahmen').toBe(0);
    await schreibeEinst(hilf, { custom: { ...mosaik, gesicht: 'schwarz', woerter: true } });
    await expect.poll(async () => (await lies(s, gesicht.box)).wort, { timeout: 60_000, intervals: [500], message: 'Wort auf dem schwarzen Gesicht' }).toBeGreaterThan(40);
    expect((await lies(s, gesicht.box)).dunkel).toBeGreaterThan(0.6);
    await schreibeEinst(hilf, { custom: { ...mosaik, gesicht: 'blur', woerter: true } });
    // weich heisst: nicht dunkel, kein Rahmen UND deutlich anders als das Original (das unverdeckte Original erfuellt die ersten beiden auch)
    const istWeich = async (): Promise<boolean> => { const k = await lies(s, gesicht.box); return k.dunkel < 0.3 && k.mittel > 3; };
    await expect.poll(istWeich, { timeout: 60_000, intervals: [500], message: 'Gesicht wird weich (und weicht vom Original ab)' }).toBe(true);
    await ruhenderHash(s); // erst messen, wenn das Bild ruht (wie im Firefox-Test), sonst faengt die Messung eine Zwischenfassung
    expect(await istWeich(), 'ruhend noch weich').toBe(true);
    expect(await rahmen(s, gesicht.box), 'Weichzeichner hat keinen Rahmen').toBeLessThan(10);
  } finally {
    await s.close();
  }
  // Gegenprobe (M3): mit dem Original als Eingabe (keine Zone an, die Seite bleibt unverdeckt) wird dieselbe Pruefung rot
  await schreibeEinst(hilf, { ...grund([]), preset: 'custom', custom: mosaik }, true);
  const g0 = await oeffneSeite('sfw', GESICHT);
  try {
    await expect.poll(() => urteil(g0), { timeout: 60_000, intervals: [200] }).toBe('frei');
    const k = await lies(g0, gesicht.box);
    expect(k.dunkel, 'das Original ist nicht dunkel (erfuellt also dunkel < 0,3 allein)').toBeLessThan(0.3);
    expect(k.mittel > 3, 'die Abweichung vom Original unterscheidet: das Original ist rot').toBe(false);
  } finally {
    await g0.close();
  }
  await schreibeEinst(hilf, { ...grund(['face']), preset: 'custom', custom: mosaik }, true);

  // Flaeche (Kopf-Zone): Mosaik, dann Weichzeichner, dann Schwarz
  await schreibeEinst(hilf, { ...grund(['head']), preset: 'custom', custom: mosaik }, true);
  const t = await oeffneSeite('sfw', GESICHT);
  try {
    await warteZensiert(t);
    expect(await rahmen(t, kopf.box), 'Ausgang Mosaik: pinker Rahmen').toBeGreaterThan(flach(kopf.box));
    await schreibeEinst(hilf, { custom: { ...mosaik, flaeche: 'blur' } });
    await expect.poll(() => rahmen(t, kopf.box), { timeout: 60_000, intervals: [500], message: 'Flaeche wird weich' }).toBeLessThan(10);
    await schreibeEinst(hilf, { custom: { ...mosaik, flaeche: 'schwarz' } });
    await expect.poll(async () => (await lies(t, kopf.box)).dunkel, { timeout: 60_000, intervals: [500], message: 'Flaeche wird schwarz' }).toBeGreaterThan(0.9);
    // Wort mit Wechsel des Schalters allein
    await schreibeEinst(hilf, { custom: { ...mosaik, flaeche: 'schwarz', woerter: true } });
    await expect.poll(async () => (await lies(t, kopf.box)).wort, { timeout: 60_000, intervals: [500], message: 'Wort auf der schwarzen Flaeche' }).toBeGreaterThan(40);
    // Wechsel von Custom auf ein Preset der Tabelle und zurueck
    await schreibeEinst(hilf, { preset: 'blur' });
    await expect.poll(async () => (await lies(t, kopf.box)).dunkel, { timeout: 60_000, intervals: [500], message: 'Preset blur: nicht mehr schwarz' }).toBeLessThan(0.3);
    await schreibeEinst(hilf, { preset: 'custom' });
    await expect.poll(async () => (await lies(t, kopf.box)).dunkel, { timeout: 60_000, intervals: [500], message: 'zurueck auf Custom: wieder schwarz (die Mischung blieb gespeichert)' }).toBeGreaterThan(0.7);
    expect((await lies(t, kopf.box)).wort, 'und das Wort ist wieder da').toBeGreaterThan(40);
    expect((await speicher(hilf, 'einstellungen')).custom).toEqual({ ...mosaik, flaeche: 'schwarz', woerter: true });
  } finally {
    await t.close();
  }
  await hilf.close();
});

// Stand der Seite, wenn er ruht: derselbe Hash zweimal im Abstand.
async function ruhenderHash(seite: Page): Promise<string> {
  let h = await seitenHash(seite);
  for (let i = 0; i < 25; i++) {
    await seite.waitForTimeout(400);
    const n = await seitenHash(seite);
    if (n === h) return n;
    h = n;
  }
  return h;
}
// Setzt Einstellungen und wartet, bis die Seite ein anderes Bild als `vorher` zeigt (und es ruht); liefert dessen Hash. Wer einen Wechsel erwartet, nimmt so nie den alten Stand.
async function wechsleZu(hilf: Page, seite: Page, teil: Record<string, unknown>, vorher: string): Promise<string> {
  await schreibeEinst(hilf, teil);
  await expect.poll(async () => (await seitenHash(seite)) !== vorher, { timeout: 60_000, intervals: [300], message: `Seite zeigt nach ${JSON.stringify(teil)} ein anderes Bild` }).toBe(true);
  return ruhenderHash(seite);
}

test('T5c ungueltige Mischung im Speicher: die Seite malt Mosaik (byteweise wie das Preset Mosaik), die Einstellung bleibt custom', async () => {
  test.setTimeout(300_000);
  const hilf = await context.newPage();
  await hilf.goto(optionsUrl());
  await schreibeEinst(hilf, { ...grund(['face']), preset: 'mosaik' }, true);
  const s = await oeffneSeite('sfw', GESICHT);
  try {
    await warteZensiert(s);
    const mosaik = await ruhenderHash(s);
    let jetzt = await wechsleZu(hilf, s, { preset: 'blur' }, mosaik);
    expect(jetzt).not.toBe(mosaik);
    const faelle: Array<[string, unknown]> = [
      ['Mischung fehlt', undefined],
      ['null', null],
      ['Zeichenkette', 'schwarz'],
      ['leeres Objekt', {}],
      ['Feld mit unbekanntem Wert', { gesicht: 'schwarz', flaeche: 'regenbogen', woerter: true }],
      ['woerter als Zeichenkette', { gesicht: 'schwarz', flaeche: 'blur', woerter: 'true' }],
      ['Prototyp-Name', { gesicht: 'constructor', flaeche: 'blur', woerter: false }],
    ];
    for (const [name, wert] of faelle) {
      // Vom Weichzeichner aus: der Wechsel auf die ungueltige Mischung muss ein anderes Bild zeigen, nach dem Mosaik
      expect(jetzt, `${name}: Ausgang ist der Weichzeichner`).not.toBe(mosaik);
      const roh = { preset: 'custom', custom: wert };
      await schreibeEinst(hilf, roh);
      await expect.poll(() => seitenHash(s), { timeout: 60_000, intervals: [400], message: `${name}: Seite malt Mosaik` }).toBe(mosaik);
      const e = await speicher(hilf, 'einstellungen');
      expect(e.preset, `${name}: preset bleibt stehen`).toBe('custom');
      jetzt = await wechsleZu(hilf, s, { preset: 'blur' }, mosaik);
    }
  } finally {
    await s.close();
  }
  await hilf.close();
});

test('T5d Mias Gesicht und Sticker ohne Pack: Mosaik an beiden Stellen (mit Woertern Mosaik mit Wort), byteweise wie die Presets Mosaik und Mosaic and words', async () => {
  test.setTimeout(300_000);
  const hilf = await context.newPage();
  await hilf.goto(optionsUrl());
  expect((await speicher(hilf, 'pack')) ?? null, 'frisches Profil ohne Pack').toBeNull();
  // Gesicht (Baustein 1) und Flaeche (Baustein 2) liegen getrennt: der Kopf schluckt das Gesicht, darum je eine Zone (Face, dann Head)
  for (const [zone, ort] of [['face', 'am Gesicht'], ['head', 'an der Flaeche']] as const) {
    await schreibeEinst(hilf, { ...grund([zone]), preset: 'mosaik' }, true);
    const s = await oeffneSeite('sfw', GESICHT);
    try {
      await warteZensiert(s);
      const mosaik = await ruhenderHash(s);
      const mosaikWort = await wechsleZu(hilf, s, { preset: 'mosaik-wort' }, mosaik);
      expect(mosaikWort).not.toBe(mosaik);
      let jetzt = mosaikWort;
      for (const [mischung, soll, titel] of [
        [{ gesicht: 'mia', flaeche: 'sticker', woerter: false }, mosaik, 'mia und sticker'],
        [{ gesicht: 'sticker', flaeche: 'sticker', woerter: false }, mosaik, 'sticker und sticker'],
        [{ gesicht: 'mia', flaeche: 'sticker', woerter: true }, mosaikWort, 'mia und sticker mit Woertern'],
        [{ gesicht: 'sticker', flaeche: 'sticker', woerter: true }, mosaikWort, 'sticker und sticker mit Woertern'],
      ] as const) {
        // erst auf einen Stand, der weder Mosaik noch Mosaik mit Wort ist (der Wechsel auf die Mischung muss sichtbar sein)
        jetzt = await wechsleZu(hilf, s, { preset: 'blur' }, jetzt === mosaik || jetzt === mosaikWort ? jetzt : '');
        expect(jetzt).not.toBe(mosaik);
        expect(jetzt).not.toBe(mosaikWort);
        await schreibeEinst(hilf, { preset: 'custom', custom: mischung });
        await expect.poll(() => seitenHash(s), { timeout: 60_000, intervals: [400], message: `${ort}, ${titel}: Mosaik` }).toBe(soll);
        jetzt = soll;
      }
    } finally {
      await s.close();
    }
  }
  await hilf.close();
});
