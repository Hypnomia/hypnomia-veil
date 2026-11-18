// Chromium: Etappe 2, Raster mit vielen Kacheln im Ausschnitt (Pruefung Runde 3, Fund M1, Entscheidung 257): 120 Quer-Kacheln (200 x 112, mindestens 30 im
// Ausschnitt bei 1280 x 720), Vorrat 50 Bilder mit nur 10 im Format der Kacheln (quer) und 40 hoch. Mit festem Fenster von 24 naher Vergaben kehren die passenden
// Bilder nach 25 Vergaben per Format zurueck und stehen dann zweimal im Ausschnitt; das Fenster nach Ausschnitt (ceil(1,5 x Fenster / Kachel)) haelt sie fern.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mitReitern } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const seite = (name: string, datei: string) => `http://${name}.veil-erwachsen.test:${port}/${datei}`;

interface PackBau {
  baueDummyPack(opts?: Record<string, unknown>): Promise<{ bytes: Uint8Array; vorschau: number }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

const QUER = 10;
const HOCH = 40;

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
  profil = await mkdtemp(path.join(tmpdir(), 'veil-raster-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-raster-pack-'));
  const voll = await (await ladeBau()).baueDummyPack({ vorschauGemischt: { quer: QUER, hoch: HOCH } });
  poolGroesse = voll.vorschau;
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





const N = 120;
const ids = Array.from({ length: N }, (_, i) => `v${i + 1}`);
interface Stand { id: string; veil: string | null; src: string }
const stand = (s: Page): Promise<Stand[]> =>
  s.evaluate(
    (l) =>
      l.map((id) => {
        const el = document.getElementById(id) as HTMLImageElement;
        return { id, veil: el.getAttribute('data-veil'), src: el.getAttribute('src') ?? '' };
      }),
    ids,
  );
const istPack = (k: Stand) => k.veil === 'zensiert' && k.src.startsWith('data:image/jpeg');

test('Voraussetzung: Pack importiert (10 quer, 40 hoch), Erwachsenenmodus an, Stufe Hot', async () => {
  test.setTimeout(120_000);
  await importierePack();
  expect(poolGroesse, 'Pool').toBe(QUER + HOCH);
  await loescheEinstellungen();
  await setzeEinstellungen({ erwachsen: { stufe: 'hot', an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
});

test('Raster: kein Ausschnitt beim Rollen zeigt zwei gleiche Ersatzbilder, obwohl nur 10 Bilder zum Format passen', async () => {
  test.setTimeout(240_000);
  const s = mitReitern(await context.newPage());
  await s.setViewportSize({ width: 1280, height: 720 });
  await s.goto(seite('xvideos', 'optik-lang.html?b=200&h=112'));
  await expect.poll(async () => (await stand(s)).every(istPack), { timeout: 120_000, intervals: [100] }).toBe(true);
  const k1 = await stand(s);
  const verschieden = new Set(k1.map((k) => k.src)).size;
  let doppelt = 0;
  let maxSichtbar = 0;
  let geprueft = 0;
  const hoehe = await s.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < hoehe; y += 120) {
    await s.evaluate((yy) => window.scrollTo(0, yy), y);
    await s.waitForTimeout(80);
    const sicht = await s.evaluate((l) => {
      const aus: { id: string; src: string }[] = [];
      for (const id of l) {
        const el = document.getElementById(id) as HTMLImageElement;
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) aus.push({ id, src: el.getAttribute('src') ?? '' });
      }
      return aus;
    }, ids);
    maxSichtbar = Math.max(maxSichtbar, sicht.length);
    if (sicht.length >= poolGroesse) continue;
    geprueft++;
    const gesehen = new Map<string, string>();
    for (const k of sicht) {
      const vorher = gesehen.get(k.src);
      if (vorher) {
        doppelt++;
        if (doppelt <= 6) console.log(`chromium raster: doppelt ${vorher} und ${k.id} bei scrollY ${y}`);
      }
      gesehen.set(k.src, k.id);
    }
  }
  console.log(`chromium raster: ${verschieden} verschiedene Bilder bei ${N} Kacheln (Vorrat ${poolGroesse}), hoechstens ${maxSichtbar} Kacheln im Ausschnitt, ${geprueft} Ausschnitte geprueft, ${doppelt} doppelte Bilder im Ausschnitt`);
  expect(maxSichtbar, 'mindestens 30 Kacheln im Ausschnitt').toBeGreaterThanOrEqual(30);
  expect(geprueft, 'geprueft Ausschnitte').toBeGreaterThan(10);
  expect(doppelt, 'doppelte Ersatzbilder im sichtbaren Bereich').toBe(0);
  await s.close();
});
