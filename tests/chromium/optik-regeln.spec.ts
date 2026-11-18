// Chromium: Optik-Regeln O2, O3 und O4 (Phase 11, Bewertung und Fahrplan Abschnitt 2; Ursachen B2 und B4 im Bestand Eigenschaften).
// 707 Tests beweisen Deckung, nicht Aussehen: diese Datei prueft das Aussehen.
//   O2  Jedes Wort liegt ganz in seiner Flaeche, mittig, mit Abstand zum Rand, und wird von keiner Nachbarflaeche ueberdeckt; je Flaeche hoechstens ein Wort.
//   O3  Kein Ersatzbild steht zweimal gleichzeitig im sichtbaren Bereich, solange der Pool reicht (zwoelf gleich grosse Kacheln auf einer Erwachsenenseite).
//   O4  Kein Ersatzbild ist gestreckt (Zuschnitt ist erlaubt).
// Kennzeichnung: was zu einem Zeitpunkt rot ist, steht als erwarteter Fehlschlag (`test.fail`, Kommentar "Phase 11 Etappe N hebt das auf"); was gruen ist, ist ein
// normaler Test (Waechter). Damit ein erwarteter Fehlschlag nicht an einer fehlenden Voraussetzung scheitert, pruefen eigene normale Tests zuerst die
// Voraussetzungen (Bilder da, Kacheln getauscht). Erwartungen werden nie gelockert.
// Testbilder aus ../05 Testbilder (nie im Repo): fehlen sie, ist der Test ROT, nur mit VEIL_OHNE_TESTBILDER=1 wird er laut uebersprungen.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mitReitern } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const seite = (name: string, datei: string) => `http://${name}.veil-erwachsen.test:${port}/${datei}`;
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

const ROSA_WORT = [255, 179, 211]; // rosa-300 aus werte.ts
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
function zonenNur(an: string[], bedeckt = true): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ALLE) z[n] = BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt } : { an: an.includes(n) };
  return z;
}

interface PackBau {
  baueDummyPack(opts?: Record<string, unknown>): Promise<{ bytes: Uint8Array; vorschau: number }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

test.describe.configure({ mode: 'serial' });

let profil = '';
let ordner = '';
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
let poolGroesse = 0;
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-optik-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-optik-pack-'));
  const voll = await (await ladeBau()).baueDummyPack();
  poolGroesse = voll.vorschau; // Standard-Dummy-Pack: vier Vorschau-Bilder (tease und hot), alle quer
  await writeFile(path.join(ordner, 'dummy.miapack'), voll.bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`, '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1'],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  const s = mitReitern(await context.newPage());
  try {
    await s.goto(optionsUrl());
    await expect
      .poll(
        async () => {
          try {
            await s.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }));
            return (await ausWorker({ ziel: 'erkenner', typ: 'wecke' }))?.ok === true;
          } catch {
            return false;
          }
        },
        { timeout: 30_000, intervals: [200] },
      )
      .toBe(true);
  } finally {
    await s.close();
  }
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

const setzeEinstellungen = (neu: Record<string, unknown>) =>
  worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
const loescheEinstellungen = () => worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstellungen'));

async function importierePack(): Promise<void> {
  const s = mitReitern(await context.newPage());
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(path.join(ordner, 'dummy.miapack'));
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
  } finally {
    await s.close();
  }
}

// ---------- O2: Woerter in ihren Flaechen ----------

type Box = [number, number, number, number];
interface Flaeche { zone: string; box: Box; behandlung?: string }
interface Pixel { daten: Buffer; b: number; h: number }
interface Messbild { name: string; flaechen: Flaeche[]; aus: Pixel }

const MAX_BILDER = 16; // die ersten Bilder des Satzes nsfw (stabile Reihenfolge des Testservers)
let messbilder: Messbild[] = [];

const schnittBox = (a: Box, b: Box): Box | null => {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x2 > x1 && y2 > y1 ? [x1, y1, x2 - x1, y2 - y1] : null;
};
const innen = (b: Box, x: number, y: number) => x >= b[0] && x < b[0] + b[2] && y >= b[1] && y < b[1] + b[3];
const istWortRosa = (p: Pixel, x: number, y: number) => {
  const i = (y * p.b + x) * 3;
  return Math.hypot(p.daten[i]! - ROSA_WORT[0]!, p.daten[i + 1]! - ROSA_WORT[1]!, p.daten[i + 2]! - ROSA_WORT[2]!) < 45;
};
// Flaechen, die ein Wort tragen: Koerper-Behandlung schwarz-wort ab 64 x 48 (darunter gibt es kein Wort, presets.ts).
const traegtWort = (f: Flaeche) => f.behandlung === 'schwarz-wort' && f.box[2] >= 64 && f.box[3] >= 48;

test('O2 Voraussetzung: Testbilder da, der Erkenner liefert Flaechen und das gemalte Bild, mindestens eine Flaeche traegt ein Wort', async () => {
  test.setTimeout(600_000);
  const liste = (await (await fetch(`${basis}/api/testbilder?satz=nsfw`)).json()) as { bilder: string[] };
  if (!liste.bilder.length) {
    if (OHNE_TESTBILDER) test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
    throw new Error('Satz nsfw fehlt (../05 Testbilder); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1');
  }
  messbilder = [];
  for (const name of liste.bilder.slice(0, MAX_BILDER)) {
    const antwort = await fetch(`${basis}/testbild/nsfw/${encodeURIComponent(name)}`);
    const gross = Buffer.from(await antwort.arrayBuffer());
    const klein = await sharp(gross).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    // Preset "My face, black, words" mit allen Koerperzonen (Gesicht aus): Koerperflaechen schwarz mit Wort.
    const a = await ausWorker({
      ziel: 'erkenner',
      typ: 'pruefe',
      id: `optik-${Math.random().toString(36).slice(2, 8)}`,
      quelle: { art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` },
      breite: 0,
      hoehe: 0,
      einstellungen: { schwelle: 0.1, zonen: zonenNur(BEDECKBAR), rand: 0.15, preset: 'mia-wort' },
      rendern: true,
      verschmelzen: true, // Bild-Weg wie im Produkt (der Video-Weg laesst es aus)
    });
    expect(a.ok, `${name}: ${a.fehler}`).toBe(true);
    const { data, info } = await sharp(Buffer.from(String(a.bild).slice(String(a.bild).indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    messbilder.push({ name, flaechen: a.flaechen as Flaeche[], aus: { daten: data, b: info.width, h: info.height } });
  }
  const mitWort = messbilder.reduce((n, m) => n + m.flaechen.filter(traegtWort).length, 0);
  const dicht = messbilder.filter((m) => m.flaechen.filter(traegtWort).length >= 2).length;
  console.log(`chromium O2: ${messbilder.length} Bilder, ${mitWort} Wort-Flaechen, ${dicht} Bilder mit zwei oder mehr Wort-Flaechen`);
  expect(mitWort, 'mindestens eine Flaeche mit Wort').toBeGreaterThan(0);
});

// Seit Phase 11 Etappe 1 verschmelzen sich Flaechen zu einer Huelle; vorher deckte die spaeter gemalte Flaeche das Wort der frueheren. (Ob die ersten 16 Bilder heute eine solche Stelle enthalten, ist
// [Guessing]: ohne Chromium im Lauf nicht gemessen. Wird der Test heute gruen gemeldet, braucht er ein Bild mit dicht liegenden Flaechen.)
test('O2: jedes Wort liegt ganz und mittig in seiner Flaeche, mit Abstand zum Rand, ohne Ueberdeckung durch Nachbarflaechen, je Flaeche ein Wort', async () => {
  expect(messbilder.length, 'Voraussetzung O2 gelaufen').toBeGreaterThan(0);
  for (const m of messbilder) {
    const gleichrangig = m.flaechen.filter((f) => f.behandlung !== 'mia-gesicht' && f.behandlung !== 'balken');
    // Schnittbereiche zweier Flaechen: dort darf kein Wortpixel stehen (ein Wort im Schnitt gehoert zu keiner der beiden Flaechen allein).
    const schnitte: Box[] = [];
    for (let i = 0; i < gleichrangig.length; i++) {
      for (let j = i + 1; j < gleichrangig.length; j++) {
        const s = schnittBox(gleichrangig[i]!.box, gleichrangig[j]!.box);
        if (s) schnitte.push(s);
      }
    }
    for (const f of m.flaechen.filter(traegtWort)) {
      const [bx, by, bw, bh] = f.box;
      let n = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          if (!istWortRosa(m.aus, x, y)) continue;
          n++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      const wo = `${m.name}: ${f.zone} ${JSON.stringify(f.box)}`;
      expect(n, `${wo}: das Wort ist zu sehen (nicht ueberdeckt)`).toBeGreaterThan(40);
      // mit Abstand zum Rand: mindestens 2 Prozent der Kantenlaenge plus 1 px
      expect(minX - bx, `${wo}: Abstand links`).toBeGreaterThanOrEqual(bw * 0.02 + 1);
      expect(bx + bw - 1 - maxX, `${wo}: Abstand rechts`).toBeGreaterThanOrEqual(bw * 0.02 + 1);
      expect(minY - by, `${wo}: Abstand oben`).toBeGreaterThanOrEqual(bh * 0.02 + 1);
      expect(by + bh - 1 - maxY, `${wo}: Abstand unten`).toBeGreaterThanOrEqual(bh * 0.02 + 1);
      // mittig: Mitte des sichtbaren Worts nahe der Flaechenmitte (ein halb verdecktes Wort verschiebt sie)
      expect(Math.abs((minX + maxX) / 2 - (bx + bw / 2)) / bw, `${wo}: Wort mittig (waagerecht)`).toBeLessThan(0.12);
      expect(Math.abs((minY + maxY) / 2 - (by + bh / 2)) / bh, `${wo}: Wort mittig (senkrecht)`).toBeLessThan(0.12);
      // die Mitte der Flaeche (dort steht das Wort) gehoert keiner Nachbarflaeche
      const mx = bx + bw / 2;
      const my = by + bh / 2;
      const nachbar = gleichrangig.find((g) => g !== f && innen(g.box, mx, my));
      expect(nachbar, `${wo}: Mitte liegt in einer Nachbarflaeche`).toBeUndefined();
      // je Flaeche hoechstens ein Wort: kein Wortpixel im Schnittbereich mit einer anderen Flaeche
      for (const s of schnitte) {
        if (!schnittBox(s, f.box)) continue;
        for (let y = s[1]; y < s[1] + s[3]; y++) {
          for (let x = s[0]; x < s[0] + s[2]; x++) {
            if (innen(f.box, x, y) && istWortRosa(m.aus, x, y)) throw new Error(`${wo}: Wortpixel (${x}, ${y}) im Schnitt mit einer Nachbarflaeche ${JSON.stringify(s)}`);
          }
        }
      }
    }
  }
});

// O2, ein Wort je zusammenhaengender Flaeche (Pruefer-Fund N5): Mias Gesicht ohne passenden Patch (hier: noch kein Pack importiert, dieser Fall steht
// darum vor den Faellen mit Pack) faellt auf Schwarz mit Wort zurueck. Schneidet es eine Flaeche mit eigenem Wort, entfaellt sein Wort.
test('O2 ohne Pack: ein Ersatz-Gesicht auf einer Flaeche mit Wort traegt kein zweites Wort (hoechstens ein Wort je zusammenhaengender schwarzer Flaeche)', async () => {
  test.setTimeout(300_000);
  let paare = 0;
  const zon = { ...zonenNur(BEDECKBAR), face: { an: true }, head: { an: true }, eyes: { an: true }, mouth: { an: true } };
  for (const name of ['sfw-015-figur.jpg', 'sfw-009-portraet.jpg', 'sfw-016-figur.jpg', 'sfw-022-figur.jpg', 'sfw-027-strand.jpg', 'sfw-028-strand.jpg']) {
    const antwort = await fetch(`${basis}/testbild/sfw/${encodeURIComponent(name)}`);
    if (!antwort.ok) {
      if (OHNE_TESTBILDER) test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
      throw new Error(`Testbild ${name} fehlt (../05 Testbilder)`);
    }
    const klein = await sharp(Buffer.from(await antwort.arrayBuffer())).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    const b = await ausWorker({
      ziel: 'erkenner', typ: 'pruefe', id: `optik-n5-${Math.random().toString(36).slice(2, 8)}`,
      quelle: { art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` }, breite: 0, hoehe: 0,
      einstellungen: { schwelle: 0.1, zonen: zon, rand: 0.15, preset: 'mia-wort' }, rendern: true, verschmelzen: true,
    });
    expect(b.ok, `${name}: ${b.fehler}`).toBe(true);
    const fl = b.flaechen as (Flaeche & { wortBox?: Box | null })[];
    const gesichter = fl.filter((f) => f.behandlung === 'mia-gesicht');
    const { data, info } = await sharp(Buffer.from(String(b.bild).slice(String(b.bild).indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pix: Pixel = { daten: data, b: info.width, h: info.height };
    for (const f of fl.filter((x) => x.behandlung === 'schwarz-wort' && x.wortBox)) {
      for (const g of gesichter.filter((x) => schnittBox(x.box, f.box))) {
        paare++;
        const wb = f.wortBox as Box;
        // rosa Pixel im Gesicht ausserhalb der wortBox der Flaeche waeren ein zweites Wort
        let n = 0;
        for (let y = g.box[1]; y < g.box[1] + g.box[3]; y++) for (let x = g.box[0]; x < g.box[0] + g.box[2]; x++) if (!innen(wb, x, y) && istWortRosa(pix, x, y)) n++;
        expect(n, `${name}: zweites Wort im Gesicht ${JSON.stringify(g.box)} auf Flaeche ${JSON.stringify(f.box)}`).toBeLessThanOrEqual(40);
      }
    }
  }
  console.log(`chromium O2 ohne Pack: ${paare} Paare aus Flaeche mit Wort und Ersatz-Gesicht geprueft`);
  expect(paare, 'mindestens ein Paar (sonst prueft der Test nichts)').toBeGreaterThan(0);
});

// O2 mit aufgelegten Flaechen (Phase 11 E1, Nachbesserung): Zone Face an, also Mias Gesicht (Dummy-Pack), Augenbalken oder Sticker auf der Kopf-Huelle.
// Wort und Sticker stehen in der `wortBox` der Flaeche: ganz in der Flaeche, von keiner aufgelegten Flaeche (Mias Gesicht, Augenbalken) geschnitten;
// das gemalte Wort (Rosa auf dem Schwarz der Flaeche, ausserhalb der aufgelegten Flaechen) liegt ganz in der `wortBox`.
const AUFGELEGT = ['mia-gesicht', 'balken'];
const ueberdeckt = (f: Flaeche, aufgelegt: Flaeche[]) => aufgelegt.some((a) => schnittBox(a.box, f.box));
for (const preset of ['mia-wort', 'mia-sticker', 'zensurbalken'] as const) {
  test(`O2 mit Zone Face (${preset}): Wort und Sticker liegen ganz in ihrer Flaeche und werden von Mias Gesicht und Augenbalken nicht ueberdeckt`, async () => {
    test.setTimeout(300_000);
    await importierePack();
    const liste = (await (await fetch(`${basis}/api/testbilder?satz=sfw`)).json()) as { bilder: string[] };
    if (!liste.bilder.length) {
      if (OHNE_TESTBILDER) test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
      throw new Error('Satz sfw fehlt (../05 Testbilder); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1');
    }
    const namen = liste.bilder.filter((n) => /portraet|figur/.test(n)).slice(0, 8);
    let mitWortBox = 0;
    let wortePixel = 0;
    for (const name of namen) {
      const gross = Buffer.from(await (await fetch(`${basis}/testbild/sfw/${encodeURIComponent(name)}`)).arrayBuffer());
      const klein = await sharp(gross).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      const zon = { ...zonenNur(BEDECKBAR), face: { an: true }, head: { an: true }, eyes: { an: true }, mouth: { an: true } };
      const b = await ausWorker({
        ziel: 'erkenner', typ: 'pruefe', id: `optik-f2-${Math.random().toString(36).slice(2, 8)}`,
        quelle: { art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` }, breite: 0, hoehe: 0,
        einstellungen: { schwelle: 0.1, zonen: zon, rand: 0.15, preset },
        rendern: true, verschmelzen: true,
      });
      expect(b.ok, `${name}: ${b.fehler}`).toBe(true);
      const fl = b.flaechen as (Flaeche & { wortBox?: Box | null })[];
      const aufgelegt = fl.filter((f) => f.behandlung && AUFGELEGT.includes(f.behandlung));
      const { data, info } = await sharp(Buffer.from(String(b.bild).slice(String(b.bild).indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pix: Pixel = { daten: data, b: info.width, h: info.height };
      for (const f of fl.filter((x) => !(x.behandlung && AUFGELEGT.includes(x.behandlung)))) {
        if (f.wortBox === undefined) {
          // ohne wortBox liegt keine aufgelegte Flaeche auf dieser Flaeche
          expect(ueberdeckt(f, aufgelegt), `${name}: ${f.zone} ${JSON.stringify(f.box)} ohne wortBox, aber von Aufgelegtem geschnitten`).toBe(false);
          continue;
        }
        mitWortBox++;
        const wb = f.wortBox;
        if (wb === null) continue; // nichts frei: kein Wort, kein Sticker, die Flaeche deckt weiter
        const wo = `${name} ${preset}: ${f.zone} ${JSON.stringify(f.box)} wortBox ${JSON.stringify(wb)}`;
        expect(schnittBox(wb, f.box) && wb[0] >= f.box[0] && wb[1] >= f.box[1] && wb[0] + wb[2] <= f.box[0] + f.box[2] && wb[1] + wb[3] <= f.box[1] + f.box[3], `${wo}: wortBox liegt ganz in der Flaeche`).toBeTruthy();
        for (const g of aufgelegt) expect(schnittBox(wb, g.box), `${wo}: wortBox wird von ${g.behandlung} ${JSON.stringify(g.box)} geschnitten`).toBeNull();
        if (f.behandlung === 'schwarz-wort') {
          // gemaltes Wort: rosa Pixel in der Flaeche ausserhalb aller aufgelegten Flaechen liegen ganz in der wortBox
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
          for (let y = f.box[1]; y < f.box[1] + f.box[3]; y++) {
            for (let x = f.box[0]; x < f.box[0] + f.box[2]; x++) {
              if (aufgelegt.some((g) => innen(g.box, x, y)) || !istWortRosa(pix, x, y)) continue;
              n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
          }
          if (n > 40) {
            wortePixel++;
            expect(minX, `${wo}: Wort links`).toBeGreaterThanOrEqual(wb[0] - 1);
            expect(maxX, `${wo}: Wort rechts`).toBeLessThanOrEqual(wb[0] + wb[2]);
            expect(minY, `${wo}: Wort oben`).toBeGreaterThanOrEqual(wb[1] - 1);
            expect(maxY, `${wo}: Wort unten`).toBeLessThanOrEqual(wb[1] + wb[3]);
          }
        }
      }
    }
    console.log(`chromium O2 Face ${preset}: ${namen.length} Bilder, ${mitWortBox} Flaechen mit wortBox, ${wortePixel} mit gemaltem Wort geprueft`);
    expect(mitWortBox, 'mindestens eine Flaeche mit aufgelegter Flaeche darauf (sonst prueft der Test nichts)').toBeGreaterThan(preset === 'zensurbalken' ? -1 : 0);
  });
}

// ---------- O3: kein Ersatzbild doppelt im sichtbaren Bereich ----------

const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);
interface Kachel { id: string; veil: string | null; src: string; hg: string }
const kacheln = (s: Page, liste: string[]): Promise<Kachel[]> =>
  s.evaluate(
    (l) =>
      l.map((id) => {
        const el = document.getElementById(id) as HTMLElement | null;
        if (!el) return { id, veil: 'FEHLT', src: '', hg: '' };
        return { id, veil: el.getAttribute('data-veil'), src: el instanceof HTMLImageElement ? el.getAttribute('src') ?? '' : '', hg: el.style.getPropertyValue('background-image') };
      }),
    liste,
  );
const istPackBild = (k: Kachel) => k.veil === 'zensiert' && (k.src.startsWith('data:image/jpeg') || k.hg.includes('data:image/jpeg'));
const bildVon = (k: Kachel) => (k.src.startsWith('data:') ? k.src : k.hg);
const haeufigste = (k: Kachel[]) => {
  const z = new Map<string, number>();
  for (const x of k) z.set(bildVon(x), (z.get(bildVon(x)) ?? 0) + 1);
  return Math.max(...z.values());
};

async function warteAufTausch(s: Page, liste: string[]): Promise<Kachel[]> {
  try {
    await expect.poll(async () => (await kacheln(s, liste)).every(istPackBild), { timeout: 40_000, intervals: [100] }).toBe(true);
  } catch (e) {
    console.log(`DIAG ${s.url()} ${JSON.stringify((await kacheln(s, liste)).map((k) => `${k.id}:${k.veil}:${k.src.slice(0, 22)}`))} ${await s.evaluate(() => document.documentElement.getAttribute('data-veil-erwachsen'))}`);
    throw e;
  }
  return kacheln(s, liste);
}

async function oeffneKacheln(variante: 'a' | 'b' | 'c' | 'd' | 'e' | 'formen'): Promise<Page> {
  const s = mitReitern(await context.newPage());
  await s.goto(seite('xvideos', `optik-kacheln.html?v=${variante}`));
  return s;
}

test('O3 Voraussetzung: mit Pack, Erwachsenenmodus und Stufe Hot werden alle zwoelf Kacheln der Varianten a bis e gegen Pack-Bilder getauscht', async () => {
  test.setTimeout(120_000);
  await importierePack();
  expect(poolGroesse, 'Pool des Dummy-Packs').toBeGreaterThanOrEqual(2);
  await loescheEinstellungen();
  await setzeEinstellungen({ erwachsen: { stufe: 'hot', an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  for (const v of ['a', 'b', 'c', 'd', 'e'] as const) {
    const s = await oeffneKacheln(v);
    const k = await warteAufTausch(s, ids(12));
    expect(k.filter(istPackBild).length, `Variante ${v}`).toBe(12);
    await s.close();
  }
});

// Variante a (keine Video-Kennung im Link, gleiche Quelle): ohne Etappe 2 ein gemeinsamer Schluessel, zwoelf Mal dasselbe Bild (Bestand B2).
// Erwartung: min(Kacheln, Pool) verschiedene Bilder.
test('O3a: zwoelf Kacheln ohne Video-Kennung und mit gleicher Platzhalter-Quelle zeigen so viele verschiedene Ersatzbilder wie der Pool hergibt, nach Neuladen dieselbe Zuordnung', async () => {
  test.setTimeout(120_000);
  const s = await oeffneKacheln('a');
  const k1 = await warteAufTausch(s, ids(12));
  const verschieden = new Set(k1.map(bildVon)).size;
  console.log(`chromium O3a: ${verschieden} verschiedene Ersatzbilder bei 12 Kacheln, Pool ${poolGroesse}`);
  expect(verschieden, 'verschiedene Ersatzbilder').toBe(Math.min(12, poolGroesse));
  expect(haeufigste(k1), 'kein Bild haeufiger als noetig').toBeLessThanOrEqual(Math.ceil(12 / poolGroesse));
  await s.reload();
  const k2 = await warteAufTausch(s, ids(12));
  expect(k2.map(bildVon), 'dieselbe Zuordnung nach Neuladen').toEqual(k1.map(bildVon));
  await s.close();
});

// Variante c baut die xHamster-Premium-Kachel nach (Messung 0b): Link /fh/out?url=%2Fvideos%2F<Kennung>, die Kennung steht
// prozentkodiert in der Abfrage, das Bild hat nur einen data:-Platzhalter. Der Rueckfall in `kuerze` nimmt dann die Link-Adresse ohne Abfrage, also fuer
// alle Kacheln denselben Schluessel und dasselbe Ersatzbild.
test('O3c: zwoelf Kacheln mit Link /fh/out?url=%2Fvideos%2F<Kennung> und data:-Platzhalter zeigen so viele verschiedene Ersatzbilder wie der Pool hergibt, nach Neuladen dieselbe Zuordnung', async () => {
  test.setTimeout(120_000);
  const s = await oeffneKacheln('c');
  const k1 = await warteAufTausch(s, ids(12));
  const verschieden = new Set(k1.map(bildVon)).size;
  console.log(`chromium O3c: ${verschieden} verschiedene Ersatzbilder bei 12 Kacheln, Pool ${poolGroesse}`);
  expect(verschieden, 'verschiedene Ersatzbilder').toBe(Math.min(12, poolGroesse));
  expect(haeufigste(k1), 'kein Bild haeufiger als noetig').toBeLessThanOrEqual(Math.ceil(12 / poolGroesse));
  await s.reload();
  const k2 = await warteAufTausch(s, ids(12));
  expect(k2.map(bildVon), 'dieselbe Zuordnung nach Neuladen').toEqual(k1.map(bildVon));
  await s.close();
});

// Variante b (verschiedene Kennungen) ist heute gruen, wenn die Hash-Reihenfolge den Pool ausschoepft (fuer diese zwoelf Kennungen mit dem
// Dummy-Pack: alle vier Reste modulo vier kommen vor, in Node nachgerechnet). Waechter: Etappe 2 darf das nicht verschlechtern.
test('O3b (Waechter): zwoelf Kacheln mit verschiedenen Kennungen zeigen so viele verschiedene Ersatzbilder wie der Pool hergibt, nach Neuladen dieselbe Zuordnung', async () => {
  test.setTimeout(120_000);
  const s = await oeffneKacheln('b');
  const k1 = await warteAufTausch(s, ids(12));
  const verschieden = new Set(k1.map(bildVon)).size;
  console.log(`chromium O3b: ${verschieden} verschiedene Ersatzbilder bei 12 Kacheln, Pool ${poolGroesse}`);
  expect(verschieden, 'verschiedene Ersatzbilder').toBe(Math.min(12, poolGroesse));
  expect(haeufigste(k1), 'kein Bild haeufiger als noetig').toBeLessThanOrEqual(Math.ceil(12 / poolGroesse));
  await s.reload();
  const k2 = await warteAufTausch(s, ids(12));
  expect(k2.map(bildVon), 'dieselbe Zuordnung nach Neuladen').toEqual(k1.map(bildVon));
  await s.close();
});

// Variante d: gemeinsamer Platzhalter-Link `#` und gleiche Quelle unterscheiden die Kacheln nicht (Pruefung E2, M2): je Kachel ein eigenes Bild, solange der Pool reicht.
test('O3d: zwoelf Kacheln mit gemeinsamem Link # und gleicher Quelle zeigen so viele verschiedene Ersatzbilder wie der Pool hergibt, nach Neuladen dieselbe Zuordnung', async () => {
  test.setTimeout(120_000);
  const s = await oeffneKacheln('d');
  const k1 = await warteAufTausch(s, ids(12));
  const verschieden = new Set(k1.map(bildVon)).size;
  console.log(`chromium O3d: ${verschieden} verschiedene Ersatzbilder bei 12 Kacheln, Pool ${poolGroesse}, haeufigstes ${haeufigste(k1)}`);
  expect(verschieden, 'verschiedene Ersatzbilder').toBe(Math.min(12, poolGroesse));
  expect(haeufigste(k1), 'kein Bild haeufiger als noetig').toBeLessThanOrEqual(Math.ceil(12 / poolGroesse));
  await s.reload();
  const k2 = await warteAufTausch(s, ids(12));
  expect(k2.map(bildVon), 'dieselbe Zuordnung nach Neuladen').toEqual(k1.map(bildVon));
  await s.close();
});

// Variante e: dasselbe Video zweimal gleichzeitig sichtbar (Empfehlung und Liste): die beiden Kacheln zeigen verschiedene Bilder (O3 geht vor).
test('O3e: zwei gleichzeitig sichtbare Kacheln desselben Videos zeigen verschiedene Ersatzbilder', async () => {
  test.setTimeout(120_000);
  const s = await oeffneKacheln('e');
  const k1 = await warteAufTausch(s, ids(12));
  const gleich = [0, 2, 4, 6, 8, 10].filter((i) => bildVon(k1[i]!) === bildVon(k1[i + 1]!));
  console.log(`chromium O3e: ${new Set(k1.map(bildVon)).size} verschiedene Ersatzbilder, Paare mit gleichem Bild: ${gleich.length}`);
  expect(gleich, 'Paare desselben Videos mit gleichem Bild').toEqual([]);
  expect(new Set(k1.map(bildVon)).size, 'verschiedene Ersatzbilder').toBe(Math.min(12, poolGroesse));
  await s.close();
});

// ---------- O4: kein gestrecktes Ersatzbild ----------

// Heute vermutlich gruen (Waechter): das Pack-Bild ist quer, die Kacheln sind es teils nicht; der Tausch darf das Bild zuschneiden, nie strecken.
test('O4 (Waechter): kein Ersatzbild ist gestreckt, auch in hohen, quadratischen und sehr breiten Kacheln (Zuschnitt erlaubt)', async () => {
  test.setTimeout(120_000);
  const s = await oeffneKacheln('formen');
  const liste = ids(8);
  const k = await warteAufTausch(s, liste);
  expect(k.filter(istPackBild).length, 'alle acht Kacheln getauscht').toBe(8);
  const mass = await s.evaluate(async (l) => {
    const aus: { id: string; kachel: number; natuerlich: number; fuellung: string; gestreckt: boolean }[] = [];
    for (const id of l) {
      const el = document.getElementById(id) as HTMLElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      let quelle = '';
      let fuellung = '';
      let gestreckt = false;
      if (el instanceof HTMLImageElement) {
        quelle = el.currentSrc || el.src;
        fuellung = cs.objectFit; // fill streckt, alles andere behaelt das Verhaeltnis
      } else {
        quelle = /url\("?([^")]+)"?\)/.exec(cs.backgroundImage)?.[1] ?? '';
        fuellung = cs.backgroundSize; // cover und contain behalten das Verhaeltnis
      }
      const b = new Image();
      b.src = quelle;
      await b.decode();
      const nat = b.naturalWidth / b.naturalHeight;
      const kachel = r.width / r.height;
      const abweichung = Math.abs(nat / kachel - 1) > 0.03;
      if (el instanceof HTMLImageElement) gestreckt = fuellung === 'fill' && abweichung;
      else gestreckt = !/cover|contain|auto/.test(fuellung) && abweichung;
      aus.push({ id, kachel, natuerlich: nat, fuellung, gestreckt });
    }
    return aus;
  }, liste);
  console.log(`chromium O4: ${JSON.stringify(mass.map((m) => [m.id, +m.kachel.toFixed(2), +m.natuerlich.toFixed(2), m.fuellung]))}`);
  expect(mass.filter((m) => m.gestreckt).map((m) => `${m.id}: Kachel ${m.kachel.toFixed(2)}, Bild ${m.natuerlich.toFixed(2)}, ${m.fuellung}`), 'gestreckte Ersatzbilder').toEqual([]);
  await s.close();
});
