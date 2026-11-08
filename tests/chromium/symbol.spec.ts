// Chromium: Pausen-Zeichen am Symbol (Session 17, UX-Pruefung Phase 9 Fund 9). Pausiert: Abzeichen "II" und Titel mit "paused"; aktiv: leer.
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-symbol-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

const zustand = () =>
  worker.evaluate(async () => {
    const a = (globalThis as any).chrome.action;
    return { text: await a.getBadgeText({}), titel: await a.getTitle({}) };
  });
const setzePause = (pause: boolean) =>
  worker.evaluate(async (p) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, version: 1, pause: p } });
  }, pause);

test('Pause zeigt "II" und "paused" am Symbol, Ende der Pause raeumt beides weg', async () => {
  await expect.poll(zustand).toEqual({ text: '', titel: 'HYPNOMIA VEIL' });
  await setzePause(true);
  await expect.poll(zustand).toEqual({ text: 'II', titel: 'HYPNOMIA VEIL: paused' });
  await setzePause(false);
  await expect.poll(zustand).toEqual({ text: '', titel: 'HYPNOMIA VEIL' });
});
