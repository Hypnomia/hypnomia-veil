// Chromium: Auftrag K2 (PHASE-5-AUFTRAEGE-SESSION-10 Abschnitt 4). Mauszeiger: mit Pack und Freischaltung ist der berechnete `cursor` an Body,
// Link und Knopf eine SVG-Data-URL (Art an der Kennung im SVG), an Textfeldern und editierbaren Bereichen `text`. Wechsel Spirale/Herz/aus, Pause,
// lokale Pause, ohne Pack, Ausnahme, Rahmen gleicher und fremder Herkunft, offene Shadow Root nach Beruehrung, keine neuen Elemente im DOM.
// Nicht belegbar ohne Augen: dass der Browser den Zeiger tatsaechlich zeichnet (Live-Blick). Belegt wird: der Wert steht im berechneten Stil,
// das SVG laesst sich als Bild laden, ist hoechstens 32 x 32 px gross.
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47175);
const seite = `http://127.0.0.1:${port}/cursor.html?fremd=${portFremd}`;
const bauModul = '../../scripts/pack/baue-pack.mjs';

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-cursor-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-cursor-pack-'));
  const bau = (await import(bauModul)) as { baueDummyPack(): Promise<{ bytes: Uint8Array }> };
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});
test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: false, tabtitel: false, meldungen: false, besuche: false };
const setzeArt = (cursor: string) => setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: { ...KONTROLLE, cursor } });

async function importierePack() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(packPfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
  } finally {
    await s.close();
  }
}
async function entfernePack() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await expect(s.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
    await abwarten(300);
    if (await s.locator('#entfernen').isVisible()) {
      await s.locator('#entfernen').click();
      await s.locator('#entfernen-ja').click();
      await expect(s.locator('#entfernen')).toBeHidden({ timeout: 15_000 });
    }
  } finally {
    await s.close();
  }
}

// Berechneter cursor eines Elements: 'text', 'auto' ... oder 'spirale' / 'herz' (Kennung im SVG der Data-URL) / 'url?' (andere URL).
const art = (f: Page | Frame, auswahl: string, inWurzel?: string): Promise<string> =>
  f.evaluate(
    ([sel, host]) => {
      const el = host ? document.querySelector(host)!.shadowRoot!.querySelector(sel!) : document.querySelector(sel!);
      const c = getComputedStyle(el!).cursor;
      const m = c.match(/url\("data:image\/svg\+xml,([^"]*)"\)/);
      if (!m) return c;
      const svg = decodeURIComponent(m[1]!);
      const k = svg.match(/id='veil-(\w+)'/);
      return k ? k[1]! : 'url?';
    },
    [auswahl, inWurzel] as const,
  );
const warteArt = (f: Page | Frame, auswahl: string, erwartet: string, inWurzel?: string, frist = 15_000) =>
  expect.poll(() => art(f, auswahl, inWurzel), { timeout: frist, intervals: [30, 60, 120] }).toBe(erwartet);
const elemente = (s: Page) => s.evaluate(() => document.getElementsByTagName('*').length);
const rahmen = (s: Page, teil: string): Frame => s.frames().find((f) => f.url().includes(teil))!;

test('ohne Pack: normaler Zeiger, keine Blaetter', async () => {
  await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: { ...KONTROLLE, cursor: 'spirale' } });
  const s = await context.newPage();
  await s.goto(seite);
  await abwarten(2500);
  for (const sel of ['body', '#link', '#knopf']) expect(await art(s, sel), sel).not.toMatch(/spirale|herz|url\?/);
  expect(await s.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
  console.log('cursor ohne Pack: Zeiger am Link', await art(s, '#link'), ', Blaetter 0');
  await s.close();
});

test('mit Pack: Spirale an Body, Link, Knopf; Text an Feldern; Groesse hoechstens 32 px; keine neuen Elemente', async () => {
  await importierePack();
  await setzeArt('spirale');
  const s = await context.newPage();
  await s.goto(seite);
  const vorher = await elemente(s);
  await warteArt(s, 'body', 'spirale');
  for (const sel of ['body', '#text', '#link', '#knopf', '#in-box', '#nicht-edit']) expect(await art(s, sel), sel).toBe('spirale');
  for (const sel of ['#in-text', '#in-ohne', '#in-suche', '#area', '#edit', '#edit-kind']) expect(await art(s, sel), sel).toBe('text');
  const bild = await s.evaluate(async () => {
    const c = getComputedStyle(document.body).cursor;
    const url = c.match(/url\("([^"]*)"\)/)![1]!;
    const i = new Image();
    i.src = url;
    await i.decode();
    return { w: i.naturalWidth, h: i.naturalHeight, hot: c.replace(/^url\("[^"]*"\)\s*/, '') };
  });
  console.log(`cursor: Spirale ${bild.w} x ${bild.h} px, Klickpunkt/Rueckfall "${bild.hot}", Elemente vorher ${vorher}`);
  expect(bild.w).toBeLessThanOrEqual(32);
  expect(bild.h).toBeLessThanOrEqual(32);
  expect(bild.w).toBeGreaterThan(0);
  expect(bild.hot).toBe('16 16, auto');
  expect(await elemente(s)).toBe(vorher);
  expect(await s.evaluate(() => document.querySelectorAll('style, link[rel=stylesheet]').length)).toBe(1); // nur das <style> der Fixture
  await s.close();
});

test('Wechsel Spirale, Herz, aus, wieder Spirale auf geoeffneter Seite', async () => {
  const s = await context.newPage();
  await s.goto(seite);
  await warteArt(s, '#link', 'spirale');
  const t0 = Date.now();
  await setzeArt('herz');
  await warteArt(s, '#link', 'herz');
  await warteArt(s, '#in-text', 'text');
  console.log(`cursor: Herz nach ${Date.now() - t0} ms`);
  await setzeArt('aus');
  await warteArt(s, '#link', 'pointer');
  expect(await art(s, '#in-text')).toBe('text');
  expect(await s.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
  await setzeArt('spirale');
  await warteArt(s, '#link', 'spirale');
  await s.close();
});

test('Pause, Ende der Pause, lokale Pause, eigene Ausnahme geben den Zeiger sofort zurueck', async () => {
  await setzeArt('spirale');
  const s = await context.newPage();
  await s.goto(seite);
  await warteArt(s, '#link', 'spirale');
  const nach = async (name: string, tu: () => Promise<void>, rueckgabe: () => Promise<void>) => {
    const t0 = Date.now();
    await tu();
    await warteArt(s, '#link', 'pointer', undefined, 5000);
    console.log(`cursor: ${name}: Zeiger zurueck nach ${Date.now() - t0} ms`);
    await rueckgabe();
    await warteArt(s, '#link', 'spirale');
  };
  await nach('Pause', () => setzeEinstellungen({ pause: true }), () => setzeEinstellungen({ pause: false }));
  await nach('Ausnahme', () => setzeEinstellungen({ ausnahmen: ['127.0.0.1'] }), () => setzeEinstellungen({ ausnahmen: [] }));
  // lokale Pause: der Hintergrund bleibt unberuehrt
  const t1 = Date.now();
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { lokalePause: true } }) })));
  await warteArt(s, '#link', 'pointer', undefined, 3000);
  console.log(`cursor: lokale Pause: Zeiger zurueck nach ${Date.now() - t1} ms`);
  await s.close();
  await setzeArt('spirale');
});

test('Rahmen gleicher und fremder Herkunft, Ausnahme des Tabs gilt in fremden Rahmen', async () => {
  await setzeArt('herz');
  const s = await context.newPage();
  await s.goto(seite);
  await expect.poll(() => s.frames().length, { timeout: 15_000 }).toBe(3);
  await expect.poll(() => s.frames().every((f) => f.url().includes('cursor')), { timeout: 15_000 }).toBe(true);
  const innen = rahmen(s, `127.0.0.1:${port}/cursor-innen`);
  const fremd = rahmen(s, `localhost:${portFremd}/cursor-innen`);
  await warteArt(innen, '#i-link', 'herz');
  await warteArt(fremd, '#i-link', 'herz');
  expect(await art(innen, '#i-text')).toBe('text');
  expect(await art(fremd, '#i-text')).toBe('text');
  console.log('cursor: Rahmen gleich/fremd: Herz, Textfeld text');
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await warteArt(s, '#link', 'pointer');
  await warteArt(fremd, '#i-link', 'pointer', undefined, 8000); // Tab-Adresse zaehlt
  await warteArt(innen, '#i-link', 'pointer', undefined, 8000);
  await setzeEinstellungen({ ausnahmen: [] });
  await warteArt(fremd, '#i-link', 'herz');
  await s.close();
});

test('offene Shadow Root bekommt den Zeiger nach der Beruehrung; Seite ersetzt adoptedStyleSheets: Blatt kommt wieder', async () => {
  await setzeArt('spirale');
  const s = await context.newPage();
  await s.goto(seite);
  await warteArt(s, '#link', 'spirale');
  await s.hover('#s-link');
  await warteArt(s, '#s-link', 'spirale', '#wirt');
  expect(await art(s, '#s-text', '#wirt')).toBe('text');
  expect(await art(s, '#s-knopf', '#wirt')).toBe('spirale');
  // Die Seite wirft alle Blaetter weg.
  await s.evaluate(() => { document.adoptedStyleSheets = []; });
  await expect.poll(() => art(s, '#link'), { timeout: 3000 }).toBe('pointer');
  await s.mouse.move(5, 5);
  await s.mouse.move(60, 20);
  await s.evaluate(() => window.dispatchEvent(new Event('focus')));
  await warteArt(s, '#link', 'spirale', undefined, 5000);
  console.log('cursor: Shadow Root nach Beruehrung Spirale, Blatt nach Ersetzen wieder angehaengt');
  await s.close();
});

test('Pack entfernt: Zeiger normal', async () => {
  const s = await context.newPage();
  await s.goto(seite);
  await warteArt(s, '#link', 'spirale');
  await entfernePack();
  await warteArt(s, '#link', 'pointer');
  expect(await s.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
  await s.close();
});

test('Vollbild: im Vollbild kein Zeiger-Blatt (cursor: none der Player bleibt wirksam), beim Verlassen sofort wieder', async () => {
  await importierePack(); // der Test davor hat das Pack entfernt
  await setzeArt('spirale');
  const s = await context.newPage();
  await s.goto(seite);
  await warteArt(s, '#link', 'spirale');
  await s.click('#voll');
  await expect.poll(() => s.evaluate(() => !!document.fullscreenElement), { timeout: 5000 }).toBe(true);
  const t0 = Date.now();
  await warteArt(s, '#link', 'pointer', undefined, 3000);
  console.log(`cursor: Vollbild: Zeiger weg nach ${Date.now() - t0} ms, Blaetter ${await s.evaluate(() => document.adoptedStyleSheets.length)}`);
  expect(await s.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
  const t1 = Date.now();
  await s.evaluate(() => document.exitFullscreen());
  await warteArt(s, '#link', 'spirale', undefined, 3000);
  console.log(`cursor: Vollbild verlassen: Zeiger zurueck nach ${Date.now() - t1} ms`);
  await s.close();
});
