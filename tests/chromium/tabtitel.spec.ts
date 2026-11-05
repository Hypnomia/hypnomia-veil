// Hinweis: das kopflose Chromium kennt keine verborgenen Tabs (bringToFront, Minimieren und Fokus aendern document.visibilityState nicht, wie schon
// bei der Spirale vermerkt). Der Testhaken `veil-test { tabtitel: { verborgen } }` stellt Verbergen und Zurueckkehren nach und ruft dieselbe
// Funktion wie das visibilitychange-Ereignis; das echte Ereignis deckt der Firefox-Test ab (nur der Vordergrund-Tab gilt dort als sichtbar).
// Chromium: Auftrag K1 (Phase 5 Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 3). Tab-Titel: verlaesst die Person den Tab, traegt er
// einen Dummy-Satz aus dem Pack; zurueck steht sofort das Original da. Seite aendert den Titel im Hintergrund, Flackern (gibt auf), kein
// title-Element, Titel beim Laden noch leer, Pause (gespeichert und lokal), Schalter aus, ohne Pack oder Freischaltung, eigene Ausnahme
// (auch per pushState), nichts in Rahmen, kein neues Element in der Seite.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://127.0.0.1:${port}/tabtitel.html`;
const SEITE_OHNE = `http://127.0.0.1:${port}/tabtitel-ohne.html`;
const SEITE_LEER = `http://127.0.0.1:${port}/tabtitel-leer.html`;
const ORIGINAL = 'Fixture title original';
// Dummy-Saetze aus scripts/pack/dummy-inhalte.mjs, Gruppe tabtitel
const DUMMY = ['Test tab title one', 'Test tab title two'];
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2, tabtitel: true, cursor: 'spirale', meldungen: true, besuche: false, zeiten: [] };

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean; id?: string }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

interface Abbild { nr: number; grund: string; mias: string | null; original: string | null; aufgegeben: boolean; setzungen: number; aenderungen: number; latenzMs: number | null }

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let altPackPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-tabtitel-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-tabtitel-pack-'));
  const bau = await ladeBau();
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  altPackPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPackPfad, (await bau.baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);
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

async function importierePack(pfad: string) {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(pfad);
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
    // Session 11: die Einstellungsseite zeichnet den Pack-Stand erst nach dem Laden (sonst Wettlauf).
    await expect(s.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
    if (await s.locator('#entfernen').isVisible()) {
      await s.locator('#entfernen').click();
      await s.locator('#entfernen-ja').click();
      await expect(s.locator('#entfernen')).toBeHidden({ timeout: 15_000 });
    }
  } finally {
    await s.close();
  }
}

const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));
const titel = (s: Page) => s.evaluate(() => document.title);
const abbildVon = async (s: Page): Promise<Abbild | null> => {
  const roh = await s.evaluate(() => document.documentElement.getAttribute('data-veil-tabtitel'));
  return roh ? (JSON.parse(roh) as Abbild) : null;
};
const sendeSpirale = (s: Page, d: Record<string, unknown>) =>
  s.evaluate((x) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: x }) })), d);

// Seite oeffnen (das Content-Script braucht Pack und Einstellungen; ist es noch nicht fertig, holt `neuBewerten` es nach).
async function oeffne(url = SEITE): Promise<Page> {
  const s = await context.newPage();
  await s.goto(url);
  return s;
}
const verborgen = (s: Page, ist: boolean) =>
  s.evaluate((v) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ tabtitel: { verborgen: v } }) })), ist);
// Tab verlassen: die Seite gilt ab jetzt als verborgen.
async function gehWeg(s: Page): Promise<void> {
  await verborgen(s, true);
}
// Zurueck: liefert die Zeit in ms vom Ausloesen bis zum gelesenen Original, gemessen in der Seite, und das, was die Seite im selben Schritt sah.
async function kommZurueck(s: Page): Promise<number> {
  return s.evaluate(() => {
    const t0 = performance.now();
    document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ tabtitel: { verborgen: false } }) }));
    const sah = document.title; // gleicher Aufruf: der Hoerer lief synchron, das Original muss schon stehen
    (window as any).titelNachRueckkehr = sah;
    return performance.now() - t0;
  });
}
const istDummy = (t: string) => DUMMY.includes(t);
// Wartet, bis der Titel Mias Satz ist, und liefert ihn.
async function warteDummy(s: Page, timeout = 15_000): Promise<string> {
  await expect.poll(() => titel(s).then(istDummy), { timeout, intervals: [20] }).toBe(true);
  return titel(s);
}
async function warteTitel(s: Page, erwartet: string, timeout = 10_000) {
  await expect.poll(() => titel(s), { timeout, intervals: [10] }).toBe(erwartet);
}
// Bleibt der Titel ueber `ms` Millisekunden unveraendert gleich `erwartet`? (Gegenprobe zu einem Positivfall im selben Test.)
async function bleibt(s: Page, erwartet: string, ms = 1500) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    expect(await titel(s)).toBe(erwartet);
    await abwarten(100);
  }
}

test.beforeEach(async () => {
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove(['einstellungen']));
});

test('ohne Pack bleibt der Titel im Hintergrund, wie er ist', async () => {
  test.setTimeout(60_000);
  await entfernePack();
  const s = await oeffne();
  await gehWeg(s);
  await bleibt(s, ORIGINAL, 1500);
  await s.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack(packPfad);
});

test('Kernfall: im Hintergrund steht ein Dummy-Satz, zurueck sofort das Original (im selben Schritt)', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  await gehWeg(s);
  const satz = await warteDummy(s);
  console.log(`Hintergrund-Titel: "${satz}"`);
  const ms = await kommZurueck(s);
  const a = await abbildVon(s);
  console.log(`Zeit bis Original: ${ms.toFixed(2)} ms (in der Seite gemessen, synchron), Hoerer ${a?.latenzMs?.toFixed(2)} ms nach dem Ereignis`);
  expect(await s.evaluate(() => (window as any).titelNachRueckkehr)).toBe(ORIGINAL);
  await warteTitel(s, ORIGINAL);
  expect(ms).toBeLessThan(50);
  await s.close();
});

test('der Satz wechselt: nie derselbe zweimal hintereinander im selben Tab, beide Saetze kommen vor', async () => {
  test.setTimeout(120_000);
  const s = await oeffne();
  const folge: string[] = [];
  for (let i = 0; i < 8; i++) {
    await gehWeg(s);
    folge.push(await warteDummy(s));
    await kommZurueck(s);
    await warteTitel(s, ORIGINAL);
  }
  console.log(`Saetze in Folge: ${JSON.stringify(folge)}`);
  for (let i = 1; i < folge.length; i++) expect(folge[i]).not.toBe(folge[i - 1]);
  expect(new Set(folge).size).toBe(2);
  await s.close();
});

test('Seite aendert den Titel im Hintergrund: Mias Satz kommt wieder darueber (hoechstens einmal je Sekunde), die neue Fassung ist das Original', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  const t0 = Date.now();
  await s.evaluate(() => (document.title = '(3) Messages'));
  await warteDummy(s);
  const ms = Date.now() - t0;
  console.log(`Seite setzt "(3) Messages": Mias Satz wieder da nach ${ms} ms`);
  expect(ms).toBeLessThan(5000);
  // Titel-Element ausgetauscht (Einzelseiten-App): gleiches Verhalten
  const gleich = await s.evaluate(() => {
    const neu = document.createElement('title');
    neu.textContent = '(4) Replaced';
    document.querySelector('title')!.replaceWith(neu);
    return document.title; // sofort nach dem Austausch: die neue Fassung der Seite
  });
  expect(gleich).toBe('(4) Replaced');
  await warteDummy(s);
  await kommZurueck(s);
  await warteTitel(s, '(4) Replaced');
  expect(await s.evaluate(() => document.querySelectorAll('title').length)).toBe(1);
  await s.close();
});

test('mehr als 10 Aenderungen je Minute: Mia gibt fuer diesen Besuch auf, der Titel der Seite bleibt stehen; der naechste Besuch geht wieder', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  await s.evaluate(() => (window as any).flackere(30, 100));
  await expect.poll(async () => (await abbildVon(s))?.aufgegeben, { timeout: 15_000, intervals: [50] }).toBe(true);
  await warteTitel(s, 'Flicker 30', 15_000);
  await bleibt(s, 'Flicker 30', 1800);
  const a = await abbildVon(s);
  console.log(`Flackern: aufgegeben nach ${a?.aenderungen} Aenderungen der Seite, ${a?.setzungen} Setzungen von Mia`);
  expect(a!.aenderungen).toBeLessThanOrEqual(12);
  expect(a!.setzungen).toBeLessThanOrEqual(8);
  await kommZurueck(s);
  await warteTitel(s, 'Flicker 30');
  // neuer Besuch: wieder ein Satz
  await gehWeg(s);
  await warteDummy(s);
  await kommZurueck(s);
  await warteTitel(s, 'Flicker 30');
  await s.close();
});

test('ohne title-Element legt Mia keines an; taucht eines auf, kommt der Satz', async () => {
  test.setTimeout(60_000);
  const s = await oeffne(SEITE_OHNE);
  const kopf = await s.evaluate(() => [...document.head.children].map((e) => e.tagName).join(','));
  await gehWeg(s);
  await abwarten(1500);
  expect(await s.evaluate(() => document.querySelectorAll('title').length)).toBe(0);
  expect(await s.evaluate(() => [...document.head.children].map((e) => e.tagName).join(','))).toBe(kopf);
  expect(await titel(s)).toBe('');
  // Gegenprobe: die Seite legt selbst eines an
  await s.evaluate(() => (window as any).titelSpaeter('Late title', 0));
  await warteDummy(s);
  await kommZurueck(s);
  await warteTitel(s, 'Late title');
  await s.close();
});

test('Titel beim Laden noch leer: erst wenn die Seite einen hat, kommt der Satz', async () => {
  test.setTimeout(60_000);
  const s = await oeffne(SEITE_LEER);
  await gehWeg(s);
  await bleibt(s, '', 1200);
  await s.evaluate(() => (window as any).setzeTitelSpaeter('Late title', 0));
  await warteDummy(s);
  await kommZurueck(s);
  await warteTitel(s, 'Late title');
  await s.close();
});

test('nichts in Rahmen: der Titel des Rahmen-Dokuments bleibt, es gibt dort kein Abbild', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  const rahmen = s.frames().find((f) => f !== s.mainFrame())!;
  expect(await rahmen.evaluate(() => document.title)).toBe('Frame title original');
  // Gegenprobe: das Content-Script lief im Rahmen sehr wohl, nur dieses Modul nicht
  await expect.poll(() => rahmen.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000, intervals: [50] }).toBe(true);
  expect(await rahmen.evaluate(() => document.documentElement.getAttribute('data-veil-tabtitel'))).toBeNull();
  await s.close();
});

test('kein neues Element, keine Aenderung an Seitenelementen: nur der Text des title-Elements', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  const momentaufnahme = () =>
    s.evaluate(() => ({
      zahl: document.querySelectorAll('*').length,
      kopf: [...document.head.children].map((e) => e.tagName + (e.tagName === 'TITLE' ? '' : e.outerHTML.length)).join(','),
      koerper: document.body.outerHTML,
      wurzelKinder: [...document.documentElement.children].map((e) => e.tagName).join(','),
    }));
  const vorher = await momentaufnahme();
  await gehWeg(s);
  await warteDummy(s);
  const waehrend = await momentaufnahme();
  console.log(`Elemente vorher ${vorher.zahl}, im Hintergrund ${waehrend.zahl}`);
  expect(waehrend).toEqual(vorher);
  await kommZurueck(s);
  await warteTitel(s, ORIGINAL);
  expect(await momentaufnahme()).toEqual(vorher);
  await s.close();
});

test('gespeicherte Pause: das Original ist sofort wieder da; Pause aus, der Satz kommt wieder', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  const t0 = Date.now();
  await setzeEinstellungen({ pause: true });
  await warteTitel(s, ORIGINAL);
  console.log(`Pause: Original nach ${Date.now() - t0} ms (inklusive Schreiben der Einstellung)`);
  await bleibt(s, ORIGINAL, 1000);
  await setzeEinstellungen({ pause: false });
  await warteDummy(s);
  await s.close();
});

test('lokale Pause (Hintergrund antwortet nie): das Original ist sofort wieder da', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  const t0 = Date.now();
  await sendeSpirale(s, { lokalePause: true });
  await warteTitel(s, ORIGINAL);
  console.log(`lokale Pause: Original nach ${Date.now() - t0} ms`);
  // gespeichert ist keine Pause, lokal gilt sie trotzdem: auch ein neuer Besuch ohne Satz
  await kommZurueck(s);
  await gehWeg(s);
  await bleibt(s, ORIGINAL, 1000);
  await s.close();
});

test('Schalter aus: Original sofort; wieder an, der Satz kommt', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, tabtitel: false } });
  await warteTitel(s, ORIGINAL);
  await bleibt(s, ORIGINAL, 1000);
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, tabtitel: true } });
  await warteDummy(s);
  await s.close();
});

test('Pack entfernt: Original sofort; altes Pack ohne Freischaltung: nichts; Dummy-Pack wieder: Satz', async () => {
  test.setTimeout(120_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  await entfernePack();
  await warteTitel(s, ORIGINAL);
  await importierePack(altPackPfad);
  await bleibt(s, ORIGINAL, 1500);
  await entfernePack();
  await importierePack(packPfad);
  await warteDummy(s);
  await s.close();
});

test('eigene Ausnahme: Original sofort, auch wenn sie erst per pushState erreicht wird', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await warteTitel(s, ORIGINAL);
  await bleibt(s, ORIGINAL, 1000);
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1/sperre'] });
  await warteDummy(s);
  await s.evaluate(() => (window as any).gehe('/sperre/seite'));
  await warteTitel(s, ORIGINAL);
  await s.evaluate(() => (window as any).gehe('/tabtitel.html'));
  await warteDummy(s);
  await s.close();
});

test('pagehide: steht gerade Mias Satz, kommt das Original zurueck', async () => {
  test.setTimeout(60_000);
  const s = await oeffne();
  await gehWeg(s);
  await warteDummy(s);
  await s.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await warteTitel(s, ORIGINAL);
  await s.close();
});
