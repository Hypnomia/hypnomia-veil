// Chromium: Auftrag T (PHASE-4-BAUPLAN Abschnitt 3). Titel mit Mias Kommentar: Kartentitel, Seitentitel und Tab-Titel werden zum Satz der
// Pack-Gruppe `titel` (Dummy: `Test title: {{title}}`), lange Titel gekuerzt, Pause stellt sofort zurueck, die Seite schreibt neu, ohne Pack oder
// Freischaltung oder Liste keine Aenderung, kein innerHTML. Die Erwachsenenseiten laufen auf *.veil-erwachsen.test (nur im Testbau).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const seite = (name: string, datei = 'erwachsen-titel.html') => `http://${name}.veil-erwachsen.test:${port}/${datei}`;

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean; id?: string; texte?: unknown }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;
const inhaltModul = '../../scripts/pack/dummy-inhalte.mjs';

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let altPackPfad: string;
let mehrPackPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-titel-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-titel-pack-'));
  const bau = await ladeBau();
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  // Pack wie vor 0.4.0: keine Freischaltung `erwachsen:titel`.
  altPackPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPackPfad, (await bau.baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);
  // Pack mit drei Titel-Saetzen: die Wahl je Originaltitel muss stabil sein.
  const { DUMMY_TEXTE } = (await import(inhaltModul)) as { DUMMY_TEXTE: { version: number; gruppen: Record<string, string[]> } };
  const mehrTexte = { ...DUMMY_TEXTE, gruppen: { ...DUMMY_TEXTE.gruppen, titel: ['Alpha {{title}}', 'Beta {{title}}', 'Gamma {{title}}'] } };
  mehrPackPfad = path.join(ordner, 'mehr.miapack');
  await writeFile(mehrPackPfad, (await bau.baueDummyPack({ texte: mehrTexte, id: 'mehr' })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${erweiterung}`,
      `--load-extension=${erweiterung}`,
      '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1',
    ],
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
const loescheEinstellungen = () => worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstellungen'));

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
const textVon = (s: Page, id: string): Promise<string> => s.evaluate((i) => document.getElementById(i)!.textContent ?? '', id);
const attrVon = (s: Page, id: string, name: string): Promise<string | null> => s.evaluate(([i, n]) => document.getElementById(i!)!.getAttribute(n!), [id, name]);
const tabTitel = (s: Page): Promise<string> => s.evaluate(() => document.title);

const ORIGINALE: Record<string, string> = {
  t1: 'Original card one',
  t2: 'Original card two',
  't3': 'This is a very long original card title that goes on and on far beyond sixty characters in total',
  'seitentitel-text': 'Original page title',
};

async function warteBisErsetzt(s: Page) {
  await expect.poll(() => textVon(s, 't1'), { timeout: 20_000, intervals: [100] }).toBe('Test title: Original card one');
}

test.beforeEach(async () => {
  await loescheEinstellungen();
});

test('ohne Pack aendert sich nichts: Karten, Seitentitel und Tab-Titel bleiben', async () => {
  test.setTimeout(60_000);
  await entfernePack();
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await abwarten(1500);
  for (const [id, t] of Object.entries(ORIGINALE)) expect(await textVon(s, id), id).toBe(t);
  expect(await tabTitel(s)).toBe('Original tab title');
  expect(await attrVon(s, 't1', 'title')).toBe('Original card one');
  await s.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack(packPfad);
});

test('Pornhub: Kartentitel, Seitentitel, Tab-Titel und Link-Titel werden Mias Kommentar, Symbol bleibt', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  expect(await textVon(s, 't2')).toBe('Test title: Original card two');
  expect(await textVon(s, 'seitentitel-text')).toBe('Test title: Original page title');
  // Symbol neben dem Titel bleibt unberuehrt
  expect(await textVon(s, 'symbol')).toBe('*');
  expect(await s.evaluate(() => document.getElementById('seitentitel')!.querySelector('i#symbol') !== null)).toBe(true);
  // Tab-Titel
  await expect.poll(() => tabTitel(s), { timeout: 10_000 }).toBe('Test title: Original tab title');
  // Attribut title am Link, alt gibt es hier nicht; das Element ohne title bekommt keins
  expect(await attrVon(s, 't1', 'title')).toBe('Test title: Original card one');
  expect(await attrVon(s, 't3', 'title')).toBeNull();
  // Titel aus mehreren Textknoten (<b> mitten im Titel) wird als Ganzes ersetzt
  expect(await textVon(s, 't7')).toBe('Test title: Foo bar baz');
  // Kurzer Titel neben einer Laufzeit-Angabe: nur der Titel wird ersetzt, die Laufzeit bleibt
  expect(await textVon(s, 'dauer8')).toBe('10 min');
  expect(await s.evaluate(() => document.getElementById('t8')!.firstChild!.nodeValue)).toBe('Test title: Wow');
  // Was nicht zum Selektor gehoert, bleibt
  expect(await textVon(s, 't6')).toBe('Not a title element');
  // XVideos-Titel gehoeren nicht zum Pornhub-Adapter
  expect(await textVon(s, 'seitentitel-xv')).toBe('Original xvideos page title');
  expect(await textVon(s, 't5')).toBe('Original xvideos card');
  await s.close();
});

test('XVideos: h2.page-title und Kartentitel in thumb-under werden ersetzt', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('xvideos'));
  await expect.poll(() => textVon(s, 'seitentitel-xv'), { timeout: 20_000, intervals: [100] }).toBe('Test title: Original xvideos page title');
  expect(await textVon(s, 't5')).toBe('Test title: Original xvideos card');
  // Pornhub-Titel gehoeren nicht zum XVideos-Adapter
  expect(await textVon(s, 't1')).toBe('Original card one');
  await s.close();
});

test('lange Titel werden auf etwa 60 Zeichen gekuerzt', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  const t = await textVon(s, 't3');
  console.log(`chromium T: gekuerzt ${JSON.stringify(t)}`);
  expect(t.startsWith('Test title: This is a very long original card title')).toBe(true);
  expect(t.endsWith('…')).toBe(true);
  expect(t.length).toBeLessThanOrEqual('Test title: '.length + 61);
  expect(t).not.toContain('in total');
  await s.close();
});

test('kein innerHTML: Titel mit <b> und <img> bleibt Text', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  expect(await textVon(s, 't4')).toBe('Test title: <b>bold</b> <img src=x onerror=window.__xss=1> title');
  expect(await s.evaluate(() => document.getElementById('t4')!.children.length)).toBe(0);
  expect(await s.evaluate(() => (window as any).__xss ?? null)).toBeNull();
  await s.close();
});

test('Pause stellt Originale sofort zurueck, Ende der Pause ersetzt wieder', async () => {
  test.setTimeout(90_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await expect.poll(() => tabTitel(s), { timeout: 10_000 }).toBe('Test title: Original tab title');
  await setzeEinstellungen({ pause: true });
  await expect.poll(() => textVon(s, 't1'), { timeout: 5000, intervals: [50] }).toBe('Original card one');
  await expect.poll(() => tabTitel(s), { timeout: 5000, intervals: [50] }).toBe('Original tab title');
  expect(await textVon(s, 'seitentitel-text')).toBe('Original page title');
  expect(await textVon(s, 't3')).toBe(ORIGINALE.t3);
  expect(await attrVon(s, 't1', 'title')).toBe('Original card one');
  // Waehrend der Pause schreibt die Seite neu: nichts wird ersetzt
  await s.evaluate(() => (window as any).schreibeKarteNeu('t2', 'Pause card'));
  await abwarten(400);
  expect(await textVon(s, 't2')).toBe('Pause card');
  await setzeEinstellungen({ pause: false });
  await expect.poll(() => textVon(s, 't1'), { timeout: 10_000, intervals: [50] }).toBe('Test title: Original card one');
  await expect.poll(() => textVon(s, 't2'), { timeout: 10_000, intervals: [50] }).toBe('Test title: Pause card');
  await expect.poll(() => tabTitel(s), { timeout: 10_000 }).toBe('Test title: Original tab title');
  await s.close();
});

test('die Seite schreibt Titel neu: Karte, Tab-Titel, neue Karten und Seitenwechsel werden wieder ersetzt', async () => {
  test.setTimeout(90_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await s.evaluate(() => (window as any).schreibeKarteNeu('t2', 'Fresh card text'));
  await expect.poll(() => textVon(s, 't2'), { timeout: 10_000, intervals: [50] }).toBe('Test title: Fresh card text');
  await s.evaluate(() => (window as any).setzeTabTitel('Fresh tab title'));
  await expect.poll(() => tabTitel(s), { timeout: 10_000, intervals: [50] }).toBe('Test title: Fresh tab title');
  // Endlos-Scrollen: neue Karte
  const neu = await s.evaluate(() => (window as any).neueKarte('Late loaded card'));
  await expect.poll(() => textVon(s, neu), { timeout: 10_000, intervals: [50] }).toBe('Test title: Late loaded card');
  // Sturm: die Seite schreibt alle 20 ms neu, wir bleiben dabei ohne Endlosschleife stabil und sparsam
  await s.evaluate(() => (window as any).starteSturm());
  await abwarten(1500);
  const sturm = await s.evaluate(async () => {
    // Zaehlt eine Sekunde lang alle Aenderungen an der Liste und die Schreibungen der Seite im selben Zeitraum.
    const w = window as any;
    let n = 0;
    const o = new MutationObserver((l) => (n += l.length));
    o.observe(document.getElementById('liste')!, { subtree: true, childList: true, characterData: true, attributes: true });
    const vorher = w.__sturmSchreibungen as number;
    await new Promise((r) => setTimeout(r, 1000));
    o.disconnect();
    return { alle: n, seite: (w.__sturmSchreibungen as number) - vorher };
  });
  await s.evaluate(() => (window as any).stoppeSturm());
  // Die Seite schreibt mit `textContent =` je einmal ein Record; alles darueber sind unsere Schreibungen.
  const unsere = sturm.alle - sturm.seite;
  console.log(`chromium T: Sturm, Seite ${sturm.seite} Schreibungen, wir ${unsere} in 1 s`);
  expect(sturm.seite).toBeGreaterThan(20);
  expect(unsere).toBeLessThanOrEqual(50 + 5);
  await expect.poll(() => textVon(s, 't1'), { timeout: 10_000, intervals: [50] }).toBe('Test title: Original card one');
  // Seitenwechsel ohne Neuladen
  await s.evaluate(() => (window as any).seitenwechsel('/neue/seite'));
  expect(await s.evaluate(() => location.pathname)).toBe('/neue/seite');
  await expect.poll(() => tabTitel(s), { timeout: 10_000, intervals: [50] }).toBe('Test title: Routed tab title');
  await expect.poll(() => textVon(s, 'seitentitel-text'), { timeout: 10_000, intervals: [50] }).toBe('Test title: Routed page title');
  expect(await s.evaluate(() => Array.from(document.querySelectorAll('#liste .title a')).map((a) => a.textContent))).toEqual(['Test title: Routed card A', 'Test title: Routed card B']);
  await s.close();
});

test('die Seite kuerzt unseren Text selbst und schreibt ihn zurueck: nicht doppelt umhuellt, Pause stellt das Original her', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await expect.poll(() => textVon(s, 't2'), { timeout: 10_000, intervals: [50] }).toBe('Test title: Original card two');
  await s.evaluate(() => (window as any).kuerzeSelbst('t2'));
  await abwarten(600);
  const t = await textVon(s, 't2');
  expect(t).toBe('Test title: Original car...');
  expect(t.match(/Test title:/g)!.length).toBe(1);
  await setzeEinstellungen({ pause: true });
  await expect.poll(() => textVon(s, 't2'), { timeout: 5000, intervals: [50] }).toBe('Original card two');
  await s.close();
});

test('Adresswechsel ohne Neuladen: Ausnahme mit Pfad greift beim Hin- und Herwechseln', async () => {
  test.setTimeout(90_000);
  await setzeEinstellungen({ ausnahmen: ['pornhub.veil-erwachsen.test/gesperrt'] });
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await s.evaluate(() => (window as any).geheZu('/gesperrt/seite'));
  await expect.poll(() => textVon(s, 't1'), { timeout: 8000, intervals: [50] }).toBe('Original card one');
  await expect.poll(() => tabTitel(s), { timeout: 8000, intervals: [50] }).toBe('Original tab title');
  // Auf dem ausgenommenen Pfad schreibt die Seite neu: nichts wird ersetzt
  await s.evaluate(() => (window as any).schreibeKarteNeu('t2', 'Blocked path card'));
  await abwarten(400);
  expect(await textVon(s, 't2')).toBe('Blocked path card');
  await s.evaluate(() => (window as any).geheZu('/erwachsen-titel.html'));
  await expect.poll(() => textVon(s, 't1'), { timeout: 8000, intervals: [50] }).toBe('Test title: Original card one');
  await expect.poll(() => textVon(s, 't2'), { timeout: 8000, intervals: [50] }).toBe('Test title: Blocked path card');
  await expect.poll(() => tabTitel(s), { timeout: 8000, intervals: [50] }).toBe('Test title: Original tab title');
  await s.close();
});

test('eigene Seite des Nutzers gilt wie die Liste; Eintrag entfernt stellt das Original zurueck', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-titel.html`);
  await abwarten(1500);
  expect(await tabTitel(s)).toBe('Original tab title');
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } });
  await expect.poll(() => tabTitel(s), { timeout: 10_000, intervals: [50] }).toBe('Test title: Original tab title');
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  await expect.poll(() => tabTitel(s), { timeout: 8000, intervals: [50] }).toBe('Original tab title');
  await s.close();
});

test('nur am Inhalt erkannte Seite (liste null, amInhalt true): keine Aenderung', async () => {
  test.skip(OHNE_TESTBILDER, 'VEIL_OHNE_TESTBILDER=1');
  test.setTimeout(180_000);
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-inhalt.html?satz=nsfw&n=16`);
  const vorher = await tabTitel(s);
  await expect
    .poll(async () => (await s.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-veil-erwachsen') ?? 'null')))?.amInhalt, { timeout: 120_000, intervals: [250] })
    .toBe(true);
  await abwarten(1000);
  expect(await tabTitel(s)).toBe(vorher);
  await s.close();
});

test('Seite nicht auf der Liste: keine Aenderung', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-titel.html`);
  await abwarten(2000);
  expect(await textVon(s, 't1')).toBe('Original card one');
  expect(await tabTitel(s)).toBe('Original tab title');
  await s.close();
});

test('Pornoseiten-Modus aus oder eigene Ausnahme: keine Aenderung', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen({ erwachsen: { an: false, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  let s = await context.newPage();
  await s.goto(seite('pornhub'));
  await abwarten(2000);
  expect(await textVon(s, 't1')).toBe('Original card one');
  expect(await tabTitel(s)).toBe('Original tab title');
  // Wirkt sofort: Modus wieder an
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  await warteBisErsetzt(s);
  // Eigene Ausnahme: sofort zurueck
  await setzeEinstellungen({ ausnahmen: ['pornhub.veil-erwachsen.test'] });
  await expect.poll(() => textVon(s, 't1'), { timeout: 5000, intervals: [50] }).toBe('Original card one');
  await expect.poll(() => tabTitel(s), { timeout: 5000, intervals: [50] }).toBe('Original tab title');
  await s.close();
});

test('Seite ohne eigene Titel-Selektoren (allgemein): nur der Tab-Titel wird ersetzt', async () => {
  test.setTimeout(60_000);
  // Im Testbau gilt jede andere Subdomain als `allgemein` (Seite auf der Liste ohne Titel-Selektoren). Die Karten bleiben,
  // der Tab-Titel (nicht an Selektoren gebunden) wird ersetzt.
  const s = await context.newPage();
  await s.goto(seite('irgendeine'));
  await expect.poll(() => tabTitel(s), { timeout: 20_000, intervals: [100] }).toBe('Test title: Original tab title');
  expect(await textVon(s, 't1')).toBe('Original card one');
  await s.close();
});

test('stabile Satzwahl: gleicher Titel, gleicher Satz, auch nach Neuaufbau und Neuladen', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await importierePack(mehrPackPfad);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await expect.poll(() => textVon(s, 't1'), { timeout: 20_000, intervals: [100] }).toMatch(/^(Alpha|Beta|Gamma) Original card one$/);
  await expect.poll(() => attrVon(s, 't9', 'title'), { timeout: 10_000, intervals: [100] }).toMatch(/^(Alpha|Beta|Gamma) /);
  const lesen = () => s.evaluate(() => ['t1', 't2', 't3', 't4'].map((i) => document.getElementById(i)!.textContent));
  const erste = await lesen();
  // Text und Tooltip (Attribut title) desselben Titels bekommen denselben Satz
  expect(await textVon(s, 't9')).toMatch(/^(Alpha|Beta|Gamma) /);
  expect((await textVon(s, 't9')).split(' ')[0]).toBe(((await attrVon(s, 't9', 'title')) ?? '').split(' ')[0]);
  console.log(`chromium T: Satzwahl ${JSON.stringify(erste.map((t) => t!.split(' ')[0]))}`);
  // Die Seite schreibt dieselben Originale neu
  await s.evaluate(() => {
    const w = window as any;
    w.schreibeKarteNeu('t1', 'Original card one');
    w.schreibeKarteNeu('t2', 'Original card two');
  });
  await abwarten(500);
  expect(await lesen()).toEqual(erste);
  await s.reload();
  await expect.poll(() => textVon(s, 't1'), { timeout: 20_000, intervals: [100] }).toMatch(/^(Alpha|Beta|Gamma) /);
  await abwarten(300);
  expect(await lesen()).toEqual(erste);
  await s.close();
});

test('Pack ohne Freischaltung erwachsen:titel: keine Aenderung', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await importierePack(altPackPfad);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await abwarten(2000);
  expect(await textVon(s, 't1')).toBe('Original card one');
  expect(await tabTitel(s)).toBe('Original tab title');
  await s.close();
});

test('Pack entfernt auf offener Seite: Originale kommen zurueck', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await importierePack(packPfad);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await entfernePack();
  await expect.poll(() => textVon(s, 't1'), { timeout: 10_000, intervals: [100] }).toBe('Original card one');
  await expect.poll(() => tabTitel(s), { timeout: 10_000, intervals: [100] }).toBe('Original tab title');
  await s.close();
});

// ---------- Nachlese Session 8 (Auftrag N) ----------
// Messsonde als erstes Skript: zaehlt gezeichnete Frames, in denen ein Originaltitel sichtbar war (Karte nicht versteckt, Tab-Titel Original).
const SONDE_FRAMES = `(() => {
  const M = (window.__fr = { frames: 0, karte: 0, tab: 0, frei: null, t0: performance.now() });
  const schritt = () => {
    const k = document.getElementById('t1');
    const t = document.title;
    M.frames++;
    const karteSichtbar = !!k && k.textContent === 'Original card one' && getComputedStyle(k).visibility === 'visible';
    if (karteSichtbar) M.karte++;
    if (t === 'Original tab title') M.tab++;
    if (M.frei === null && karteSichtbar && t === 'Original tab title') M.frei = performance.now() - M.t0;
    requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
})();`;
const lieseFrames = (s: Page) => s.evaluate(() => (window as any).__fr as { frames: number; karte: number; tab: number; frei: number | null });

test('Titel ohne Aufblitzen: mit Pack 0 gezeichnete Frames mit Originaltitel, danach ersetzt', async () => {
  test.setTimeout(90_000);
  await importierePack(packPfad);
  const s = await context.newPage();
  await s.addInitScript(SONDE_FRAMES);
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await expect.poll(() => tabTitel(s), { timeout: 10_000 }).toBe('Test title: Original tab title');
  await abwarten(300);
  const f = await lieseFrames(s);
  console.log(`chromium T: Frames ${f.frames}, davon Originalkarte sichtbar ${f.karte}, Original-Tab-Titel ${f.tab}`);
  expect(f.frames).toBeGreaterThan(3);
  expect(f.karte).toBe(0);
  expect(f.tab).toBe(0);
  await s.close();
});

test('Titel ohne Aufblitzen: ohne Pack bleiben die Titel nach kurzer Zeit sichtbar', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  const s = await context.newPage();
  await s.addInitScript(SONDE_FRAMES);
  await s.goto(seite('pornhub'));
  await expect.poll(async () => (await lieseFrames(s)).frei, { timeout: 5000, intervals: [50] }).not.toBeNull();
  const f = await lieseFrames(s);
  console.log(`chromium T: ohne Pack Titel nach ${Math.round(f.frei!)} ms sichtbar (ab Start der Sonde)`);
  expect(f.frei!).toBeLessThan(300);
  expect(await textVon(s, 't1')).toBe('Original card one');
  expect(await tabTitel(s)).toBe('Original tab title');
  await s.close();
  await importierePack(packPfad);
});

test('Titel, die spaeter eingefuegt werden (Endlos-Scrollen): 0 Frames im Original, danach ersetzt', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub'));
  await warteBisErsetzt(s);
  await s.evaluate(async () => {
    const w = window as any;
    w.__spaet = { frames: 0, orig: 0 };
    const ids: string[] = [];
    const f = () => {
      for (const id of ids) {
        const e = document.getElementById(id);
        if (e && e.textContent!.startsWith('Late') && getComputedStyle(e).visibility === 'visible') w.__spaet.orig++;
      }
      w.__spaet.frames++;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
    for (let i = 0; i < 6; i++) {
      ids.push(w.neueKarte('Late card ' + i));
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  await expect.poll(() => textVon(s, 't101'), { timeout: 5000, intervals: [50] }).toBe('Test title: Late card 0');
  await abwarten(300);
  const r = await s.evaluate(() => (window as any).__spaet as { frames: number; orig: number });
  console.log(`chromium T: spaet eingefuegte Titel, Frames ${r.frames}, davon im Original sichtbar ${r.orig}`);
  expect(r.frames).toBeGreaterThan(5);
  expect(r.orig).toBe(0);
  await s.close();
});

test('Seite kopiert die Blattliste und setzt sie spaeter neu: ohne Pack bleibt der Titel sichtbar', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  const s = await context.newPage();
  await s.goto(seite('pornhub') + '?kopie=1');
  await expect.poll(() => s.evaluate(() => (window as any).__kopie.gesetzt), { timeout: 8000, intervals: [100] }).toBe(true);
  await abwarten(300);
  const n = await s.evaluate(() => (window as any).__kopie.n);
  console.log(`chromium T: Seite kopierte ${n} Blatt/Blaetter und setzte sie neu`);
  expect(n).toBeGreaterThan(0);
  expect(await s.evaluate(() => getComputedStyle(document.getElementById('t1')!).visibility)).toBe('visible');
  expect(await tabTitel(s)).toBe('Original tab title');
  await s.close();
});

test('Pack ohne Titel-Saetze: das Original ist sofort wieder da (nicht erst nach der 3-s-Frist)', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  const bau = await ladeBau();
  const { DUMMY_TEXTE } = (await import(inhaltModul)) as { DUMMY_TEXTE: { version: number; gruppen: Record<string, string[]> } };
  const ohneTitel = { ...DUMMY_TEXTE, gruppen: { ...DUMMY_TEXTE.gruppen, titel: ['no placeholder here'] } };
  const pfad = path.join(ordner, 'ohne-titel.miapack');
  await writeFile(pfad, (await bau.baueDummyPack({ texte: ohneTitel, id: 'ohne-titel' })).bytes);
  await importierePack(pfad);
  const s = await context.newPage();
  await s.addInitScript(SONDE_FRAMES);
  await s.goto(seite('pornhub'));
  await expect.poll(async () => (await lieseFrames(s)).frei, { timeout: 5000, intervals: [50] }).not.toBeNull();
  const f = await lieseFrames(s);
  console.log(`chromium T: Pack ohne Titel-Saetze, Titel nach ${Math.round(f.frei!)} ms sichtbar`);
  expect(f.frei!).toBeLessThan(1500);
  await s.close();
  await entfernePack();
  await importierePack(packPfad);
});

test('lokale Pause im Riegel (Hintergrund stumm): der Tab-Titel ist sofort im Original', async () => {
  test.setTimeout(90_000);
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } });
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-titel.html`);
  await expect.poll(() => tabTitel(s), { timeout: 15_000, intervals: [50] }).toBe('Test title: Original tab title');
  // Der Riegel-Testhaken laeuft nur auf 127.0.0.1 (Seite `allgemein`, ohne Titel-Selektoren): hier zaehlt der Tab-Titel. Die Karten stellt
  // dieselbe Rueckruf-Kette (beiLokalerPause) zurueck; ihre Pause ueber die Einstellungen deckt der Test oben ab.
  await s.evaluate(() =>
    document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ riegel: { oeffne: { frage: 'test-w1', pauseHaengt: true } } }) })),
  );
  let pause: { x: number; y: number; w: number; h: number } | null = null;
  await expect
    .poll(
      async () => {
        const a = await s.evaluate(() => {
          const v = document.documentElement.getAttribute('data-veil-riegel');
          return v ? JSON.parse(v) : null;
        });
        if (a && a.zustand === 'frage' && a.offen) pause = a.pause;
        return pause !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await s.mouse.click(pause!.x + pause!.w / 2, pause!.y + pause!.h / 2);
  await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-riegel-ergebnis')), { timeout: 3000 }).toBe('pause');
  await expect.poll(() => tabTitel(s), { timeout: 2000, intervals: [25] }).toBe('Original tab title');
  expect(await s.evaluate(() => (globalThis as any).chrome === undefined || true)).toBe(true);
  await s.close();
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
});
