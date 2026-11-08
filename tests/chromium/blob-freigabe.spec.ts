// Chromium: Freigabe der Blob-Adressen der Pack-Chibis beim Verlassen einer Erweiterungsseite (pagehide), Session 17 (Testluecke aus
// UEBERGABE-16 Punkt 4; Logik in src/oberflaeche/blob-register.ts, Einsatz in src/oberflaeche/chibi-platz.ts). Die Einstellungsseite zeigt mit
// dem Dummy-Pack das Pack-Chibi als Blob-Adresse; nach dem Verlassen muss jede dieser Adressen widerrufen sein.
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const bauModul = '../../scripts/pack/baue-pack.mjs';
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };

let profil = '';
let ordner = '';
let packPfad = '';
let context: BrowserContext;
let id = '';

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-blob-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-blob-datei-'));
  packPfad = path.join(ordner, 'dummy.miapack');
  const bau = (await import(bauModul)) as { baueDummyPack(): Promise<{ bytes: Uint8Array }> };
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('Pack-Chibis: alle Blob-Adressen werden beim Verlassen der Seite widerrufen', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(`chrome-extension://${id}/options.html`);
  await s.evaluate((e) => (globalThis as any).chrome.storage.local.set({ einstieg: e }), EINSTIEG_FERTIG);
  await s.reload();
  await s.locator('#datei').setInputFiles(packPfad);
  await s.locator('#annehmen').click();
  await expect(s.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
  // Gleich nach dem Import begruesst Mia einmal mit dem Pack-Chibi (Blob-Adresse); danach Widerrufe mitschreiben (localStorage der
  // Erweiterung ueberlebt die Seite).
  await expect
    .poll(() => s.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('blob:') && !i.hidden).length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  const offen = await s.evaluate(() => {
    localStorage.setItem('widerrufen', '[]');
    const echt = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (a: string) => {
      const l = JSON.parse(localStorage.getItem('widerrufen') ?? '[]') as string[];
      l.push(a);
      localStorage.setItem('widerrufen', JSON.stringify(l));
      echt(a);
    };
    return [...document.querySelectorAll('img')].map((i) => i.src).filter((a) => a.startsWith('blob:'));
  });
  // Vor dem Verlassen ist keine der gezeigten Adressen widerrufen (sonst waere das Bild kaputt).
  expect(await s.evaluate(() => JSON.parse(localStorage.getItem('widerrufen') ?? '[]').length)).toBe(0);
  await s.goto('about:blank');
  const p = await context.newPage();
  await p.goto(`chrome-extension://${id}/hilfe.html`);
  const widerrufen = await p.evaluate(() => JSON.parse(localStorage.getItem('widerrufen') ?? '[]') as string[]);
  console.log(`blob-freigabe: ${offen.length} Blob-Adressen gezeigt, ${widerrufen.length} beim Verlassen widerrufen`);
  for (const a of offen) expect(widerrufen).toContain(a);
  await Promise.all([s.close(), p.close()]);
});
