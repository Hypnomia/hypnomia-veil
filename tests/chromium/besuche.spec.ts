// Chromium: Auftrag Z2 (Phase 5, Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 7). Pflicht-Besuche: der Testhaken `veil-test` loest die
// Pruefung sofort aus (als waere der Besuch faellig), der Hintergrund oeffnet im Testbau `about:blank#veil-besuch` statt einer echten Adresse.
// Geprueft: Hinweis (Satz, Lage, 5 s), neuer Tab neben dem Absender, Adresse aus links.json, 2-Stunden-Grenze im Hintergrund, "Not now", nichts beim
// Tippen, im Vollbild, mit Schalter aus, ohne Pack, in der Pause, in Rahmen, Plan ueber alle Tabs, Klick auf den Hinweis erreicht die Seite nicht.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://127.0.0.1:${port}/besuche.html`;
const DUMMY_SATZ = 'Test visit line.';
const TEST_ADRESSE = 'about:blank#veil-besuch';
const H = 3_600_000;

const bauModul = '../../scripts/pack/baue-pack.mjs';
interface Abbild {
  nr: number;
  phase: string;
  satz?: string;
  hinweisMs?: number;
  abgelehnt?: string;
  ergebnis?: string;
  grund?: string;
  url?: string;
  tabId?: number | null;
  dauerMs?: number;
  geplant?: boolean;
  host?: { x: number; y: number; w: number; h: number };
  knopf?: { x: number; y: number; w: number; h: number };
}

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
let linkWerte: string[] = [];
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: false, leerlaufMinuten: 2, besuche: true };

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-besuche-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-besuche-pack-'));
  const bau = (await import(bauModul)) as { baueDummyPack(): Promise<{ bytes: Uint8Array }> };
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  const links = JSON.parse(await readFile(path.join(wurzel, 'data/links.json'), 'utf8')) as Record<string, string>;
  linkWerte = Object.entries(links).filter(([k]) => k !== 'LIES-MICH').map(([, v]) => v);
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

const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const setzeKontrolle = (teil: Record<string, unknown> = {}) => setzeEinstellungen({ kontrolle: { ...KONTROLLE, ...teil } });
const setzeSpeicher = (werte: Record<string, unknown>) => worker.evaluate((w) => (globalThis as any).chrome.storage.local.set(w), werte);
const loescheSpeicher = (...schluessel: string[]) => worker.evaluate((s) => (globalThis as any).chrome.storage.local.remove(s), schluessel);
const liesSpeicher = <T = any>(schluessel: string) => worker.evaluate(async (s) => (await (globalThis as any).chrome.storage.local.get(s))[s] as T, schluessel);

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

const abbildVon = async (s: Page): Promise<Abbild | null> => {
  const roh = await s.evaluate(() => document.documentElement.getAttribute('data-veil-besuch'));
  return roh ? (JSON.parse(roh) as Abbild) : null;
};
const sende = (s: Page, besuch: Record<string, unknown>) =>
  s.evaluate((b) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ besuch: b }) })), besuch);
// Loest aus und wartet auf die erste Antwort des Moduls (Abbild mit neuer Nummer: Hinweis steht oder abgelehnt).
async function loeseAus(s: Page, besuch: Record<string, unknown> = { faellig: true }): Promise<Abbild> {
  const vorher = (await abbildVon(s))?.nr ?? 0;
  await sende(s, besuch);
  await expect.poll(async () => ((await abbildVon(s))?.nr ?? 0) > vorher, { timeout: 15_000, intervals: [30] }).toBe(true);
  return (await abbildVon(s))!;
}
async function warteEnde(s: Page, frist = 20_000): Promise<Abbild> {
  await expect.poll(async () => (await abbildVon(s))?.phase, { timeout: frist, intervals: [30] }).toBe('ende');
  return (await abbildVon(s))!;
}
async function erwarteAbgelehnt(s: Page, grund: string, besuch: Record<string, unknown> = { faellig: true }) {
  const a = await loeseAus(s, besuch);
  expect(a.abgelehnt, JSON.stringify(a)).toBe(grund);
  expect(a.phase).toBe('abgelehnt');
}
async function neueSeite(): Promise<Page> {
  const s = await context.newPage();
  await s.goto(SEITE);
  await s.bringToFront();
  // Das Content-Script braucht einen Augenblick fuer Pack und Einstellungen.
  await abwarten(1200);
  return s;
}
const besuchsSeiten = () => context.pages().filter((p) => p.url() === TEST_ADRESSE);
async function schliesseBesuche(zurueck?: Page) {
  for (const p of besuchsSeiten()) await p.close();
  await zurueck?.bringToFront();
}
const gesehen = (s: Page) => s.evaluate(() => ({ ...(window as any).gesehen }) as Record<string, number>);
const tabsListe = () =>
  worker.evaluate(async () => (await (globalThis as any).chrome.tabs.query({})).map((t: any) => ({ id: t.id, index: t.index, openerTabId: t.openerTabId, active: t.active, windowId: t.windowId, url: t.url ?? '' })));

test.beforeEach(async () => {
  await loescheSpeicher('einstellungen', 'besuchZeitplan', 'besuchZuletzt');
});

test('ohne Pack zeigt sich nichts, auch nicht per Testereignis; der Hintergrund lehnt ab', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await setzeKontrolle();
  const s = await neueSeite();
  await erwarteAbgelehnt(s, 'kein-pack');
  const o = await context.newPage();
  await o.goto(optionsUrl());
  const antwort = await o.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }));
  console.log(`Hintergrund ohne Pack: ${JSON.stringify(antwort)}`);
  expect(antwort).toEqual({ ok: false, grund: 'kein-pack' });
  await o.close();
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack();
});

test('Schalter ab Werk aus: nichts, auch nicht per Testereignis; der Hintergrund lehnt ab', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite(); // keine Einstellungen gespeichert: Standard
  await erwarteAbgelehnt(s, 'aus');
  await setzeKontrolle({ besuche: false });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'aus');
  const o = await context.newPage();
  await o.goto(optionsUrl());
  const antwort = await o.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }));
  expect(antwort).toEqual({ ok: false, grund: 'aus' });
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE }, pause: true });
  expect(await o.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }))).toEqual({ ok: false, grund: 'pause' });
  await setzeEinstellungen({ pause: false, ausnahmen: ['127.0.0.1'] });
  await o.close();
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('Hinweis, 5 s, neuer Tab neben dem Absender mit Testadresse, Adresse aus links.json, danach neuer Plan', async () => {
  test.setTimeout(90_000);
  await setzeKontrolle();
  const s = await neueSeite();
  const t0 = Date.now();
  const a = await loeseAus(s, { faellig: true });
  expect(a.phase, JSON.stringify(a)).toBe('hinweis');
  expect(a.satz).toBe(DUMMY_SATZ);
  // Lage: unten mittig im Fenster, kleine Karte
  const vp = s.viewportSize()!;
  const mitte = a.host!.x + a.host!.w / 2;
  console.log(`Hinweis: Host ${JSON.stringify(a.host)}, Knopf ${JSON.stringify(a.knopf)}, Fenster ${vp.width}x${vp.height}`);
  expect(Math.abs(mitte - vp.width / 2)).toBeLessThan(4);
  expect(a.host!.y + a.host!.h).toBeGreaterThan(vp.height - 60);
  expect(a.host!.w).toBeLessThan(vp.width);
  expect(a.knopf!.w).toBeGreaterThan(20);
  // Der Hinweis steht nie im DOM der Seite: nur ein Host am Ende von html, geschlossene Shadow Root.
  const aufbau = await s.evaluate(() => {
    const h = document.documentElement.lastElementChild as HTMLElement;
    return { tag: h.tagName.toLowerCase(), shadow: !!h.shadowRoot, imBody: !!document.body.querySelector('mia-hinweis'), text: document.body.textContent?.includes('Not now') };
  });
  expect(aufbau).toEqual({ tag: 'mia-hinweis', shadow: false, imBody: false, text: false });
  expect(besuchsSeiten().length).toBe(0); // noch kein Tab
  const ende = await warteEnde(s);
  const gesamt = Date.now() - t0;
  console.log(`Besuch: Hinweisdauer ${ende.dauerMs} ms, gesamt ${gesamt} ms, Ergebnis ${ende.ergebnis}, Adresse ${ende.url}`);
  expect(ende.ergebnis, JSON.stringify(ende)).toBe('ok');
  expect(ende.dauerMs!).toBeGreaterThanOrEqual(4900);
  expect(ende.dauerMs!).toBeLessThan(8000);
  expect(linkWerte).toContain(ende.url);
  await expect.poll(() => besuchsSeiten().length, { timeout: 5000 }).toBe(1);
  const tabs = await tabsListe();
  const neu = tabs.find((t: any) => t.openerTabId !== undefined && t.active);
  const absender = tabs.find((t: any) => t.id === neu?.openerTabId);
  console.log(`Neuer Tab: Index ${neu?.index}, Absender Index ${absender?.index}, aktiv ${neu?.active}`);
  expect(absender?.url).toBe(SEITE);
  expect(neu.index).toBe(absender.index + 1);
  expect(neu.windowId).toBe(absender.windowId);
  expect(neu.id).toBe(ende.tabId);
  const zuletzt = await liesSpeicher<number>('besuchZuletzt');
  expect(Math.abs(Date.now() - zuletzt)).toBeLessThan(20_000);
  const plan = await liesSpeicher<{ zuletzt: number; abstandMs: number }>('besuchZeitplan');
  console.log(`Neuer Plan: Abstand ${(plan.abstandMs / H).toFixed(2)} h`);
  expect(Math.abs(Date.now() - plan.zuletzt)).toBeLessThan(20_000);
  expect(plan.abstandMs).toBeGreaterThanOrEqual(2 * H);
  expect(plan.abstandMs).toBeLessThanOrEqual(4 * H);
  await schliesseBesuche(s);
  await s.close();
});

test('zweiter Versuch innerhalb von 2 Stunden: der Hintergrund lehnt ab, kein zweiter Tab; nach "vergiss" geht es wieder', async () => {
  test.setTimeout(90_000);
  await setzeKontrolle();
  await setzeSpeicher({ besuchZuletzt: Date.now() - 30 * 60_000 });
  const s = await neueSeite();
  const a = await loeseAus(s, { faellig: true, hinweisMs: 400 });
  expect(a.phase).toBe('hinweis');
  const ende = await warteEnde(s);
  console.log(`2-Stunden-Grenze: ${ende.ergebnis} (${ende.grund})`);
  expect(ende.ergebnis).toBe('abgelehnt');
  expect(ende.grund).toBe('zu-frueh');
  expect(besuchsSeiten().length).toBe(0);
  // "zu frueh" erneuert den Plan (sonst kaeme der Hinweis jede Minute wieder)
  expect(await liesSpeicher('besuchZeitplan')).toBeTruthy();
  // Genau 2 Stunden her: erlaubt
  await setzeSpeicher({ besuchZuletzt: Date.now() - 2 * H - 5000 });
  await loeseAus(s, { faellig: true, hinweisMs: 400 });
  const ok = await warteEnde(s);
  expect(ok.ergebnis, JSON.stringify(ok)).toBe('ok');
  await schliesseBesuche(s);
  // Der Testhaken im Hintergrund vergisst den letzten Besuch
  const o = await context.newPage();
  await o.goto(optionsUrl());
  const antwort = await o.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch-test', vergiss: true }));
  expect(antwort.ok).toBe(true);
  expect(await liesSpeicher('besuchZuletzt')).toBeUndefined();
  await o.close();
  await s.bringToFront();
  await loeseAus(s, { faellig: true, hinweisMs: 400 });
  const wieder = await warteEnde(s);
  expect(wieder.ergebnis, JSON.stringify(wieder)).toBe('ok');
  await schliesseBesuche(s);
  await s.close();
});

test('"Not now": kein Besuch, neuer Plan; Klicks auf den Hinweis erreichen die Seite nicht, Klicks daneben schon', async () => {
  test.setTimeout(90_000);
  await setzeKontrolle();
  const s = await neueSeite();
  const a = await loeseAus(s, { faellig: true, hinweisMs: 8000 });
  expect(a.phase).toBe('hinweis');
  const fokusVor = await s.evaluate(() => document.activeElement?.tagName);
  // Klick auf den Hinweis neben dem Knopf: nichts erreicht die Seite, der Hinweis bleibt
  await s.mouse.click(a.host!.x + 6, a.host!.y + a.host!.h / 2);
  await abwarten(200);
  expect((await abbildVon(s))!.phase).toBe('hinweis');
  const mitte = { x: a.knopf!.x + a.knopf!.w / 2, y: a.knopf!.y + a.knopf!.h / 2 };
  await s.mouse.click(mitte.x, mitte.y);
  const ende = await warteEnde(s, 5000);
  console.log(`Not now: ${ende.ergebnis} nach ${ende.dauerMs} ms`);
  expect(ende.ergebnis).toBe('nicht-jetzt');
  const g = await gesehen(s);
  console.log(`Ereignisse der Seite nach Klicks auf den Hinweis: ${JSON.stringify(g)}`);
  expect(g).toEqual({});
  const fokusNach = await s.evaluate(() => document.activeElement?.tagName);
  console.log(`Fokus der Seite vor und nach Not now: ${fokusVor} / ${fokusNach}`);
  expect(fokusNach).toBe(fokusVor); // kein Fokuswechsel auf den Hinweis (sonst sahe die Seite focusin, g waere nicht leer)
  await expect.poll(async () => (await abbildVon(s))?.geplant, { timeout: 5000 }).toBe(true);
  const plan = await liesSpeicher<{ zuletzt: number }>('besuchZeitplan');
  expect(Math.abs(Date.now() - plan.zuletzt)).toBeLessThan(20_000);
  await abwarten(500);
  expect(besuchsSeiten().length).toBe(0);
  expect(await liesSpeicher('besuchZuletzt')).toBeUndefined();
  // Gegenprobe: ein Klick auf die Seite selbst kommt an
  await s.mouse.click(50, 50);
  await expect.poll(async () => (await gesehen(s)).click ?? 0, { timeout: 3000 }).toBeGreaterThan(0);
  expect((await gesehen(s)).mousedown).toBeGreaterThan(0);
  // Nach dem Ende ist der Host weg
  expect(await s.evaluate(() => document.querySelectorAll('mia-hinweis').length)).toBe(0);
  await s.close();
});

test('nichts beim Tippen: Fokus im Feld oder Rahmen, Taste in den letzten 2 s; eine Taste im Hinweis bricht ab, ohne neuen Plan', async () => {
  test.setTimeout(120_000);
  await setzeKontrolle();
  const s = await neueSeite();
  const planVor = await liesSpeicher('besuchZeitplan'); // vom Einschalten (Hintergrund)
  await s.locator('#feld').focus();
  await erwarteAbgelehnt(s, 'eingabe');
  await s.frameLocator('#rahmen').locator('#innen').focus();
  await erwarteAbgelehnt(s, 'eingabe');
  await s.locator('#knopf').focus();
  await s.keyboard.press('a');
  await abwarten(300);
  await erwarteAbgelehnt(s, 'eingabe');
  await abwarten(2200);
  // Taste waehrend des Hinweises
  await loeseAus(s, { faellig: true, hinweisMs: 2500 });
  await abwarten(300);
  await s.evaluate(() => { (window as any).gesehen = {}; });
  await s.keyboard.press('b');
  const ende = await warteEnde(s, 5000);
  console.log(`Taste im Hinweis: ${ende.ergebnis} (${ende.grund}) nach ${ende.dauerMs} ms`);
  expect(ende.ergebnis).toBe('abbruch');
  expect(ende.grund).toBe('taste');
  expect((await gesehen(s)).keydown).toBeGreaterThan(0); // die Taste gehoert der Seite
  // Fokus ins Eingabefeld waehrend des Hinweises
  await abwarten(2200);
  await loeseAus(s, { faellig: true, hinweisMs: 2500 });
  await s.locator('#feld').focus();
  const ende2 = await warteEnde(s, 5000);
  expect(ende2.grund).toBe('eingabe');
  await abwarten(2800);
  expect(besuchsSeiten().length).toBe(0);
  expect(await liesSpeicher('besuchZeitplan')).toEqual(planVor); // Abbruch ohne neuen Plan
  expect(await liesSpeicher('besuchZuletzt')).toBeUndefined();
  await s.close();
});

test('nichts im Vollbild; Vollbild im Hinweis bricht ab', async () => {
  test.setTimeout(90_000);
  await setzeKontrolle();
  const s = await neueSeite();
  await s.click('#vollbild');
  await expect.poll(() => s.evaluate(() => !!document.fullscreenElement), { timeout: 5000 }).toBe(true);
  await erwarteAbgelehnt(s, 'vollbild');
  await s.evaluate(() => document.exitFullscreen());
  await expect.poll(() => s.evaluate(() => !!document.fullscreenElement), { timeout: 5000 }).toBe(false);
  await abwarten(2200); // der Klick zaehlt nicht als Eingabe, aber sicher ist sicher
  await loeseAus(s, { faellig: true, hinweisMs: 4000 });
  await s.click('#vollbild');
  const ende = await warteEnde(s, 6000);
  console.log(`Vollbild im Hinweis: ${ende.ergebnis} (${ende.grund})`);
  expect(ende.grund).toBe('vollbild');
  await s.evaluate(() => document.exitFullscreen()).catch(() => undefined);
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('der Hintergrund lehnt ab, wenn der Absender-Tab nicht der aktive seines Fensters ist', async () => {
  test.setTimeout(90_000);
  await setzeKontrolle();
  // Headless Chromium meldet jeden Tab als sichtbar und fokussiert (document.visibilityState, hasFocus); die Sichtbarkeit der Seite prueft der
  // Firefox-Test mit echtem Tabwechsel. Der Hintergrund fragt den Browser selbst (tabs.get, active) und kennt den Unterschied.
  const s = await neueSeite();
  const o = await context.newPage();
  await o.goto(optionsUrl());
  const v = await context.newPage();
  await v.goto(SEITE);
  await v.bringToFront();
  await abwarten(800);
  const antwort = await o.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }));
  console.log(`Hintergrund, Absender-Tab nicht aktiv: ${JSON.stringify(antwort)}`);
  expect(antwort).toEqual({ ok: false, grund: 'tab-nicht-aktiv' });
  await o.close();
  await v.close();
  await s.close();
  expect(besuchsSeiten().length).toBe(0);
});

test('Hintergrund: Fenster im Vollbild lehnt ab, Fokus, zwei gleichzeitige Anfragen nacheinander', async () => {
  test.setTimeout(120_000);
  await setzeKontrolle();
  const s = await neueSeite();
  const o = await context.newPage();
  await o.goto(optionsUrl());
  await o.bringToFront();
  const frage = () => o.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }));
  const fenster = () => worker.evaluate(async () => { const api = (globalThis as any).chrome; const t = (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0]; const w = await api.windows.get(t.windowId); return { id: w.id, focused: w.focused, state: w.state }; });
  const f = await fenster();
  console.log(`Fenster im Hintergrund gesehen: ${JSON.stringify(f)}`);
  expect(f.focused).toBe(true);
  // Vollbild des Fensters: nur der Hintergrund sieht es
  await worker.evaluate((id) => (globalThis as any).chrome.windows.update(id, { state: 'fullscreen' }), f.id);
  await expect.poll(async () => (await fenster()).state, { timeout: 8000 }).toBe('fullscreen');
  const vollbild = await frage();
  console.log(`Hintergrund, Fenster im Vollbild: ${JSON.stringify(vollbild)}`);
  expect(vollbild).toEqual({ ok: false, grund: 'vollbild' });
  // Die Seite selbst erkennt das Vollbild (display-mode) und zeigt keinen Hinweis
  await s.bringToFront();
  const a = await loeseAus(s, { faellig: true, hinweisMs: 300 });
  console.log(`Seite im Fenster-Vollbild: ${a.abgelehnt ?? a.phase}`);
  expect(a.abgelehnt).toBe('vollbild');
  await worker.evaluate((id) => (globalThis as any).chrome.windows.update(id, { state: 'normal' }), f.id);
  await expect.poll(async () => (await fenster()).state, { timeout: 8000 }).toBe('normal');
  // Ohne Fokus (Fenster nicht fokussiert), soweit der Browser es zulaesst
  await worker.evaluate((id) => (globalThis as any).chrome.windows.update(id, { focused: false }).catch(() => undefined), f.id);
  await abwarten(500);
  const ohneFokus = (await fenster()).focused;
  console.log(`Fenster nach focused:false: focused=${ohneFokus}`);
  if (!ohneFokus) expect(await frage()).toEqual({ ok: false, grund: 'kein-fokus' });
  else console.log('UEBERSPRUNGEN: kein-fokus im Hintergrund (Headless-Chromium bleibt fokussiert, nur Einheitstest)');
  await worker.evaluate((id) => (globalThis as any).chrome.windows.update(id, { focused: true }), f.id);
  await o.bringToFront();
  // Zwei gleichzeitige Anfragen aus demselben aktiven Tab laufen nacheinander: genau eine kommt durch
  await loescheSpeicher('besuchZuletzt');
  const zwei = await o.evaluate(() => Promise.all([1, 2].map(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }))));
  console.log(`zwei gleichzeitige Anfragen: ${JSON.stringify(zwei.map((z: any) => (z.ok ? 'ok' : z.grund)))}`);
  expect(zwei.filter((z: any) => z.ok).length).toBe(1);
  // Die zweite Anfrage kommt erst nach dem ersten Besuch dran: der neue Tab ist aktiv (tab-nicht-aktiv) oder die Grenze greift (zu-frueh)
  expect(zwei.filter((z: any) => !z.ok && ['zu-frueh', 'tab-nicht-aktiv'].includes(z.grund)).length).toBe(1);
  await o.close();
  await schliesseBesuche(s);
  await s.close();
});

test('nichts in der Pause, auf eigener Ausnahme; Pause und Schalter aus im Hinweis brechen ab', async () => {
  test.setTimeout(120_000);
  await setzeKontrolle();
  const s = await neueSeite();
  await setzeEinstellungen({ pause: true });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'nicht-erlaubt');
  await setzeEinstellungen({ pause: false, ausnahmen: ['127.0.0.1'] });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'nicht-erlaubt');
  await setzeEinstellungen({ ausnahmen: [] });
  await abwarten(300);
  for (const wie of ['pause', 'aus'] as const) {
    const a = await loeseAus(s, { faellig: true, hinweisMs: 8000 });
    expect(a.phase, JSON.stringify(a)).toBe('hinweis');
    const t0 = Date.now();
    if (wie === 'pause') await setzeEinstellungen({ pause: true });
    else await setzeKontrolle({ besuche: false });
    const ende = await warteEnde(s, 5000);
    console.log(`${wie} im Hinweis: ${ende.ergebnis} (${ende.grund}) nach ${Date.now() - t0} ms`);
    expect(ende.ergebnis).toBe('abbruch');
    expect(ende.grund).toBe('einstellung');
    expect(await s.evaluate(() => document.querySelectorAll('mia-hinweis').length)).toBe(0);
    await setzeEinstellungen({ pause: false });
    await setzeKontrolle();
    await abwarten(300);
  }
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('nichts in Rahmen: das Modul laeuft nur in der obersten Seite', async () => {
  test.setTimeout(60_000);
  await setzeKontrolle();
  const s = await neueSeite();
  const rahmen = s.frames().find((f) => f !== s.mainFrame())!;
  await rahmen.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ besuch: { faellig: true } }) })));
  await abwarten(1200);
  // Gegenprobe: das Content-Script (Schleier) lief im Rahmen sehr wohl, nur das Besuchs-Modul nicht.
  expect(await rahmen.evaluate(() => document.documentElement.hasAttribute('data-veil-status'))).toBe(true);
  expect(await rahmen.evaluate(() => document.documentElement.getAttribute('data-veil-besuch'))).toBeNull();
  expect(await rahmen.evaluate(() => document.querySelectorAll('mia-hinweis').length)).toBe(0);
  expect(await abbildVon(s)).toBeNull();
  await s.close();
});

test('Plan: fehlend wird ab jetzt angelegt, faellig zeigt den Hinweis, nicht faellig nichts, Plan vor dem Import gilt als fehlend', async () => {
  test.setTimeout(120_000);
  await setzeKontrolle();
  const s = await neueSeite();
  await loescheSpeicher('besuchZeitplan'); // das Einschalten hat schon einen Plan geschrieben
  const jetzt = Date.now();
  const a = await loeseAus(s, { takt: true, jetzt });
  expect(a.abgelehnt).toBe('nicht-faellig');
  const plan = await liesSpeicher<{ zuletzt: number; abstandMs: number }>('besuchZeitplan');
  expect(plan.zuletzt).toBe(jetzt);
  expect(plan.abstandMs).toBeGreaterThanOrEqual(2 * H);
  expect(plan.abstandMs).toBeLessThanOrEqual(4 * H);
  // Nicht faellig: 1 Stunde vergangen
  const b = await loeseAus(s, { takt: true, jetzt: jetzt + H });
  expect(b.abgelehnt).toBe('nicht-faellig');
  expect(await liesSpeicher('besuchZeitplan')).toEqual(plan);
  // Plan aus der Zeit vor dem Pack-Import gilt als fehlend: nicht faellig, neu ab jetzt
  const imp = (await liesSpeicher<{ importiert: number }>('pack')).importiert;
  await setzeSpeicher({ besuchZeitplan: { zuletzt: imp - 6 * H, abstandMs: 2 * H } });
  const d = await loeseAus(s, { takt: true, jetzt: imp + 1000 });
  console.log(`alter Plan vor dem Import: ${d.abgelehnt}`);
  expect(d.abgelehnt).toBe('nicht-faellig');
  expect((await liesSpeicher<{ zuletzt: number }>('besuchZeitplan')).zuletzt).toBe(imp + 1000);
  // Faellig: Plan von vor 5 Stunden (echte Uhr, weil der Hinweis am Ende den Plan noch einmal liest), Hinweis erscheint, der Besuch geht durch
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const p = (await api.storage.local.get('pack')).pack;
    await api.storage.local.set({ pack: { ...p, importiert: 1 } });
  });
  await setzeSpeicher({ besuchZeitplan: { zuletzt: Date.now() - 5 * H, abstandMs: 2 * H } });
  const c = await loeseAus(s, { takt: true, hinweisMs: 300 });
  expect(c.phase, JSON.stringify(c)).toBe('hinweis');
  const ende = await warteEnde(s);
  expect(ende.ergebnis, JSON.stringify(ende)).toBe('ok');
  const neu = await liesSpeicher<{ zuletzt: number }>('besuchZeitplan');
  expect(Math.abs(Date.now() - neu.zuletzt)).toBeLessThan(20_000);
  await schliesseBesuche(s);
  await s.close();
});

test('Schalter gerade eingeschaltet: ein alter, faelliger Plan zaehlt neu ab jetzt; der Zeitgeber laeuft im Testbau nicht von selbst', async () => {
  test.setTimeout(120_000);
  await setzeKontrolle({ besuche: false });
  await setzeSpeicher({ besuchZeitplan: { zuletzt: Date.now() - 5 * H, abstandMs: 2 * H } });
  const s = await neueSeite();
  await abwarten(500);
  await setzeKontrolle({ besuche: true });
  // Der Plan wird beim Einschalten einmal geschrieben (kein Flag je Tab): ohne Takt, sofort
  await expect.poll(async () => Math.abs(Date.now() - ((await liesSpeicher<{ zuletzt: number }>('besuchZeitplan'))?.zuletzt ?? 0)), { timeout: 8000 }).toBeLessThan(10_000);
  const a = await loeseAus(s, { takt: true });
  console.log(`gerade eingeschaltet: ${a.abgelehnt}`);
  expect(a.abgelehnt).toBe('nicht-faellig');
  // Zeitgeber: faelliger Plan, aber erst nach dem Testereignis taktMs zeigt er den Hinweis
  await setzeSpeicher({ besuchZeitplan: { zuletzt: Date.now() - 5 * H, abstandMs: 2 * H } });
  await abwarten(1500);
  expect((await abbildVon(s))?.phase).toBe('abgelehnt'); // nur die Antwort von vorhin, kein Hinweis
  await sende(s, { taktMs: 200 });
  await expect.poll(async () => (await abbildVon(s))?.phase, { timeout: 10_000, intervals: [50] }).toBe('hinweis');
  await sende(s, { abbruch: true });
  await expect.poll(async () => (await abbildVon(s))?.phase, { timeout: 5000 }).toBe('ende');
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('Pack-Entfernung im Hinweis bricht ab, danach nichts mehr', async () => {
  test.setTimeout(90_000);
  await setzeKontrolle();
  const s = await neueSeite();
  const a = await loeseAus(s, { faellig: true, hinweisMs: 15_000 });
  expect(a.phase).toBe('hinweis');
  await entfernePack();
  const ende = await warteEnde(s, 10_000);
  console.log(`Pack entfernt im Hinweis: ${ende.ergebnis} (${ende.grund})`);
  expect(ende.grund).toBe('pack');
  await erwarteAbgelehnt(s, 'kein-pack');
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('lokale Pause (ohne Speicher): davor nichts, im Hinweis sofortiger Abbau', async () => {
  test.setTimeout(90_000);
  await importierePack();
  await setzeKontrolle();
  const s = await neueSeite();
  await loeseAus(s, { faellig: true, hinweisMs: 9000 });
  const t0 = Date.now();
  await sende(s, { lokalePause: true });
  const ende = await warteEnde(s, 5000);
  console.log(`lokale Pause im Hinweis: ${ende.ergebnis} (${ende.grund}), Abbau nach ${Date.now() - t0} ms`);
  expect(ende.grund).toBe('pause');
  expect(await s.evaluate(() => document.querySelectorAll('mia-hinweis').length)).toBe(0);
  await erwarteAbgelehnt(s, 'nicht-erlaubt');
  expect(((await liesSpeicher('einstellungen')) as any)?.pause ?? false).toBe(false);
  expect(besuchsSeiten().length).toBe(0);
  await s.close();
});

test('Ablehnung des Hintergrunds (Tab inzwischen nicht aktiv): keine Wiederholung vor 10 Minuten', async () => {
  test.setTimeout(90_000);
  await importierePack();
  await setzeKontrolle();
  const s = await neueSeite();
  // Der Plan ist noch faellig (nur dann wird er verkuerzt, siehe Fund N1)
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const p = (await api.storage.local.get('pack')).pack;
    await api.storage.local.set({ pack: { ...p, importiert: 1 } });
  });
  await setzeSpeicher({ besuchZeitplan: { zuletzt: Date.now() - 5 * H, abstandMs: 2 * H } });
  await loeseAus(s, { faellig: true, hinweisMs: 2500 });
  const v = await context.newPage();
  await v.goto(SEITE);
  await v.bringToFront(); // der Hintergrund sieht: der Absender-Tab ist nicht mehr aktiv; die Seite merkt es in Headless-Chromium nicht
  const ende = await warteEnde(s, 8000);
  console.log(`Ablehnung durch den Hintergrund: ${ende.ergebnis} (${ende.grund})`);
  expect(ende.ergebnis).toBe('abgelehnt');
  expect(ende.grund).toBe('tab-nicht-aktiv');
  const plan = await liesSpeicher<{ zuletzt: number; abstandMs: number }>('besuchZeitplan');
  const faelligIn = plan.zuletzt + plan.abstandMs - Date.now();
  console.log(`Wiederholung faellig in ${(faelligIn / 60000).toFixed(1)} min`);
  expect(faelligIn).toBeGreaterThan(8 * 60_000);
  expect(faelligIn).toBeLessThan(11 * 60_000);
  await v.close();
  await s.close();
});
