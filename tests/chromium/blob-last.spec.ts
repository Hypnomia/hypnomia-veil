// Chromium: Regressionstest K1 (Session 14). Pack mit grossen Vorschau-Bildern (1 bis 2 MB, synthetisches Rauschen), danach viele gleichzeitige
// Packbild-Anfragen (Nachrichtenweg und eine Seite mit 80 Vorschaubildern). Der Erweiterungsprozess darf nicht sterben ("Bad blob references in
// BlobRegistry::Register" im Live-Lauf Session 13): Offscreen-Dokument und Service Worker leben danach, eine neue Seite wird markiert.
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://pornhub.veil-erwachsen.test:${port}/erwachsen-stufe.html`;
const GROSSE = 8; // Anzahl grosser Bilder im Pack
const KACHELN = Number(process.env.VEIL_K1_ANZAHL ?? 80);
const WELLEN = Number(process.env.VEIL_K1_WELLEN ?? 3);
const PAUSE_MS = Number(process.env.VEIL_K1_PAUSE ?? 0);

interface PackBau {
  baueDummyPack(opts?: { grosseVorschau?: number }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
let workerGeschlossen = 0;
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-blob-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-blob-pack-'));
  const bau = (await import(bauModul)) as PackBau;
  packPfad = path.join(ordner, 'gross.miapack');
  const gebaut = (await bau.baueDummyPack({ grosseVorschau: GROSSE })).bytes;
  // Das Pack muss wirklich gross sein, sonst bewiese der Test nichts.
  expect(gebaut.byteLength).toBeGreaterThan(GROSSE * 1_000_000);
  await writeFile(packPfad, gebaut);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`, '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1'],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  context.on('serviceworker', () => {});
  worker.on('close', () => workerGeschlossen++);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

async function offscreenLebt(): Promise<boolean> {
  try {
    const kontexte = await worker.evaluate(async () => (await (globalThis as any).chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length);
    return kontexte > 0;
  } catch {
    return false;
  }
}

async function warteAufErkenner() {
  const s = await context.newPage();
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
}

test('Pack mit grossen Bildern importieren', async () => {
  test.setTimeout(90_000);
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(packPfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 60_000 });
  } finally {
    await s.close();
  }
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, erwachsen: { ...(alt.erwachsen ?? {}), an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [], stufe: 'hot' } } });
  });
  await warteAufErkenner();
});

// Leert den Zwischenspeicher des Erkenners (`fertig` in packbild.ts): die Meldung "geaendert" auf dem Kanal `veil-pack` loescht ihn und die
// Ergebnisse. Ohne das beantworten ab der zweiten Welle fertige Eintraege (der Speicher haengt am Dateinamen, nicht am Schluessel) die
// Anfragen, und es wuerde kein Blob mehr aus IndexedDB gelesen.
async function leereZwischenspeicher() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.evaluate(() => {
      const k = new BroadcastChannel('veil-pack');
      k.postMessage('geaendert');
      k.close();
    });
  } finally {
    await s.close();
  }
  await new Promise((r) => setTimeout(r, 300));
}

test('viele gleichzeitige Packbild-Anfragen: Erweiterung lebt, Bilder kommen, neue Seite wird markiert', async () => {
  test.setTimeout(180_000);
  expect(await offscreenLebt()).toBe(true);
  // 1. Nachrichtenweg: 3 Wellen mit je 80 gleichzeitigen Anfragen, jede mit eigenem Schluessel; vor jeder Welle ist der Zwischenspeicher leer,
  // damit die Bilder wirklich neu aus IndexedDB gelesen werden (gleichzeitige Anfragen derselben Datei teilen eine Lesung, es sind 8 Dateien)
  let ok = 0;
  let gesamt = 0;
  for (let welle = 0; welle < WELLEN; welle++) {
    if (welle > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    await leereZwischenspeicher();
    const antworten = await Promise.all(
      Array.from({ length: KACHELN }, (_, i) =>
        ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: `w${welle}-k${i}`, breite: 1, hoehe: 1, stufe: 'hot' }).catch((e) => ({ ok: false, fehler: String(e) })),
      ),
    );
    gesamt += antworten.length;
    ok += antworten.filter((a) => a?.ok === true).length;
  }
  console.log(`chromium K1: Packbild-Antworten ok ${ok} von ${gesamt}, Service Worker geschlossen ${workerGeschlossen}x`);
  expect(ok).toBe(gesamt);
  await leereZwischenspeicher();
  // 2. Seite mit 80 Vorschaubildern auf einer Erwachsenenseite, gleichzeitig mit dem Nachrichtenweg
  const s = await context.newPage();
  await s.goto(SEITE);
  await s.evaluate((n) => {
    for (let i = 0; i < n; i++) (window as any).addTile(`z${i}`, 320, 180, 200 + i, `ph5z${i}`);
  }, KACHELN);
  await expect
    .poll(
      () =>
        s.evaluate(() => [...document.querySelectorAll('img')].filter((e) => e.getAttribute('data-veil') === 'zensiert' && e.src.startsWith('data:image/jpeg')).length),
      { timeout: 90_000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(KACHELN);
  // 3. Danach leben Offscreen-Dokument und Service Worker noch, und eine neue Seite wird markiert
  expect(workerGeschlossen).toBe(0);
  expect(await offscreenLebt()).toBe(true);
  expect((await ausWorker({ ziel: 'erkenner', typ: 'wecke' }))?.ok).toBe(true);
  const neu = await context.newPage();
  await neu.goto(SEITE);
  await expect
    .poll(() => neu.evaluate(() => document.querySelectorAll('[data-veil]').length), { timeout: 30_000, intervals: [250] })
    .toBeGreaterThan(0);
  await neu.close();
  await s.close();
});
