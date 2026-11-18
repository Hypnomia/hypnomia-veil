// Chromium: Etappe 2, lange Kachelliste (Phase 11, Regel O3 und Vorschau-Speicher): 120 Kacheln, Pool aus POOL grossen Bildern (Dummy-Pack, Originale
// 1 bis 2 MB, auf 480 px verkleinert). Prueft: alle Kacheln getauscht, im sichtbaren Bereich nie dasselbe Bild zweimal (auch beim Durchscrollen),
// jede Kachel behaelt ihr Bild, ein Bild kehrt fruehestens nach 25 Kacheln (Fenster der letzten 24 Vergaben) oder nach Pool Kacheln zurueck. Misst: Zeit bis alle getauscht sind, Bilder und Bytes im Zwischenspeicher, Abrufe. Zahlen in ../00 Planung/MESSUNG-PHASE-11-E2.md.
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

const POOL = Number(process.env.VEIL_LANG_POOL ?? 70);

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
  profil = await mkdtemp(path.join(tmpdir(), 'veil-lang-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-lang-pack-'));
  const voll = await (await ladeBau()).baueDummyPack({ grosseVorschau: POOL });
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

test('Voraussetzung: Pack importiert, Erwachsenenmodus an, Stufe Hot', async () => {
  test.setTimeout(120_000);
  await importierePack();
  expect(poolGroesse, 'Pool').toBe(POOL);
  await loescheEinstellungen();
  await setzeEinstellungen({ erwachsen: { stufe: 'hot', an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
});

test('lange Liste mit 120 Kacheln: alle getauscht, im sichtbaren Bereich nie dasselbe Bild zweimal, jede Kachel behaelt ihr Bild', async () => {
  test.setTimeout(240_000);
  const s = mitReitern(await context.newPage());
  await s.setViewportSize({ width: POOL <= 30 ? 800 : 1280, height: 720 }); // 18 bis 30 Kacheln im Ausschnitt
  const t0 = Date.now();
  await s.goto(seite('xvideos', 'optik-lang.html'));
  await expect.poll(async () => (await stand(s)).every(istPack), { timeout: 120_000, intervals: [100] }).toBe(true);
  const dauer = Date.now() - t0;
  const k1 = await stand(s);
  const verschieden = new Set(k1.map((k) => k.src)).size;
  const zaehler = async () => JSON.parse((await s.evaluate(() => document.documentElement.getAttribute('data-veil-erwachsen'))) ?? '{}');
  const z = await zaehler();
  console.log(`chromium lang: ${N} Kacheln, Pool ${poolGroesse}, ${verschieden} verschiedene Bilder, ${dauer} ms bis alle getauscht, Abrufe ${z.abrufe}, Bilder im Speicher ${z.bilder}, ${(z.bytes / 1048576).toFixed(1)} MB`);
  expect(verschieden, 'verschiedene Ersatzbilder gesamt').toBe(Math.min(N, poolGroesse));
  // Durchscrollen: in jedem Ausschnitt kein Bild doppelt, solange der Pool die sichtbaren Kacheln deckt
  let doppelt = 0;
  let geprueft = 0;
  let maxSichtbar = 0;
  const hoehe = await s.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < hoehe; y += 300) {
    await s.evaluate((yy) => window.scrollTo(0, yy), y);
    await s.waitForTimeout(150);
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
    if (sicht.length >= poolGroesse) continue; // zeigt der Ausschnitt mehr Kacheln als der Pool Bilder hat, sind Doppelte unvermeidbar
    geprueft++;
    const gesehen = new Map<string, string>();
    for (const k of sicht) {
      const vorher = gesehen.get(k.src);
      if (vorher) console.log(`chromium lang: doppelt ${vorher} und ${k.id} bei scrollY ${y}`);
      gesehen.set(k.src, k.id);
    }
    doppelt += sicht.length - new Set(sicht.map((k) => k.src)).size;
  }
  console.log(`chromium lang: beim Durchscrollen hoechstens ${maxSichtbar} Kacheln im Ausschnitt, ${doppelt} doppelte Bilder im Ausschnitt`);
  console.log(`chromium lang: ${geprueft} Ausschnitte geprueft (Pool ${poolGroesse})`);
  expect(geprueft, 'geprueft Ausschnitte').toBeGreaterThan(3);
  expect(doppelt, 'doppelte Ersatzbilder im sichtbaren Bereich').toBe(0);
  // Abstand in der Vergabefolge (Kachelreihenfolge): ein Bild kehrt fruehestens nach Pool Kacheln wieder
  const zuletzt = new Map<string, number>();
  let kleinster = Infinity;
  k1.forEach((k, i) => {
    const v = zuletzt.get(k.src);
    if (v !== undefined) kleinster = Math.min(kleinster, i - v);
    zuletzt.set(k.src, i);
  });
  console.log(`chromium lang: kleinster Abstand zwischen zwei gleichen Bildern ${kleinster} Kacheln (Pool ${poolGroesse})`);
  // Regel der Wahl (Hook-Lauf 3): Rang 0 sind Bilder ausserhalb der letzten 24 Vergaben, ein Bild kehrt also fruehestens nach 25 Kacheln zurueck (kleinerer Pool: nach Pool Kacheln)
  if (N > poolGroesse) expect(kleinster, 'kleinster Abstand in der Vergabefolge').toBeGreaterThanOrEqual(Math.min(25, poolGroesse - 1));
  const k2 = await stand(s);
  expect(k2.map((k) => k.src), 'jede Kachel behaelt ihr Bild').toEqual(k1.map((k) => k.src));
  const z2 = await zaehler();
  console.log(`chromium lang: nach Durchscrollen Abrufe ${z2.abrufe}, Bilder im Speicher ${z2.bilder}, ${(z2.bytes / 1048576).toFixed(1)} MB, Bild ${Math.round(z2.bytes / Math.max(1, z2.bilder) / 1024)} KB im Mittel`);
  await s.close();
});

test('Pool groesser als die Kachelzahl: alle Kacheln zeigen verschiedene Bilder (60 Kacheln)', async () => {
  test.skip(poolGroesse < 60, 'Pool kleiner als 60');
  test.setTimeout(120_000);
  const s = mitReitern(await context.newPage());
  await s.goto(seite('xvideos', 'optik-lang.html?n=60'));
  const l = ids.slice(0, 60);
  const lies = () => s.evaluate((x) => x.map((id) => (document.getElementById(id) as HTMLImageElement).getAttribute('src') ?? ''), l);
  await expect.poll(async () => (await lies()).every((q) => q.startsWith('data:image/jpeg')), { timeout: 60_000, intervals: [100] }).toBe(true);
  expect(new Set(await lies()).size, 'verschiedene Bilder bei 60 Kacheln').toBe(60);
  await s.close();
});

// Messung N4: Dauer der Blickfeld-Messung (alle gemerkten Elemente, ein getBoundingClientRect je Element) bei 120 und bei 1000 Kacheln,
// aus dem Testhaken `blickMs`, dazu die Zeit bis alle getauscht sind.
for (const n of [120, 1000]) {
  test(`Messung N4: ${n} Kacheln, Dauer der Blickfeld-Messung und Zeit bis alle getauscht`, async () => {
    test.setTimeout(240_000);
    const s = mitReitern(await context.newPage());
    await s.setViewportSize({ width: 1280, height: 720 });
    const t0 = Date.now();
    await s.goto(seite('xvideos', `optik-lang.html?n=${n}`));
    const l = Array.from({ length: n }, (_, i) => `v${i + 1}`);
    await expect
      .poll(async () => s.evaluate((x) => x.every((id) => ((document.getElementById(id) as HTMLImageElement).getAttribute('src') ?? '').startsWith('data:image/jpeg')), l), { timeout: 200_000, intervals: [200] })
      .toBe(true);
    const dauer = Date.now() - t0;
    const st = JSON.parse((await s.evaluate(() => document.documentElement.getAttribute('data-veil-erwachsen'))) ?? '{}');
    const ms: number[] = st.blickMs ?? [];
    console.log(`chromium N4: ${n} Kacheln, ${dauer} ms bis alle getauscht, Blickfeld-Messungen (letzte ${ms.length}) ms: ${JSON.stringify(ms)}, Abrufe ${st.abrufe}`);
    await s.close();
  });
}
