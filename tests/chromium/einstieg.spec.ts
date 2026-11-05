// Chromium: Auftrag E (Einstieg, Session 11). Testbau: nach der Installation gilt der Einstieg als erledigt und nichts oeffnet sich;
// `einstieg-test` setzt zurueck und oeffnet. Ganzer Durchgang mit echten Klicks, Ueberspringen, "I’m not", Popup-Hinweis, #interview, 360 px.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT } from '../../src/einstieg/texte';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';
let messzahl = 0; // Zahl der gegen den Speicher geprueften Wirkungen

const url = (seite: string) => `chrome-extension://${id}/${seite}`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const entferne = (seite: Page, k: string[]) => seite.evaluate((k) => (globalThis as any).chrome.storage.local.remove(k), k);
const sende = (seite: Page, n: Record<string, unknown>) =>
  seite.evaluate((n) => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'einstieg-test', ...n }), n);
const einst = async (s: Page) => (await lies(s, 'einstellungen')) ?? {};
// Schalter: die Eingabe ist unsichtbar, geklickt wird die Zeile.
const schalter = (s: Page, feld: string) => s.locator('label.schalter', { has: s.locator(feld) }).click();

// Eine Verwaltungsseite der Erweiterung, auf der Nachrichten und Speicher erreichbar sind.
async function verwaltung(seite = 'options.html'): Promise<Page> {
  const s = await context.newPage();
  await s.goto(url(seite));
  return s;
}

// Setzt den Einstieg zurueck und liefert die neu geoeffnete Willkommensseite.
async function oeffneNeu(v: Page): Promise<Page> {
  const neu = context.waitForEvent('page');
  const antwort = await sende(v, { zuruecksetzen: true, oeffne: true });
  expect(antwort.ok).toBe(true);
  expect(typeof antwort.tabId).toBe('number');
  const w = await neu;
  await w.waitForLoadState('domcontentloaded');
  await expect(w.locator('#schritt-titel')).toBeVisible();
  return w;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-einstieg-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});

test.afterAll(async () => {
  console.log(`chromium: einstieg ${messzahl} Wirkungen im Speicher gemessen`);
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test('Testbau: Installation schreibt den Einstieg als erledigt, nichts oeffnet sich, einstieg-test setzt zurueck', async () => {
  const v = await verwaltung();
  await expect.poll(async () => (await lies(v, 'einstieg'))?.interview, { timeout: 15_000 }).toBe('uebersprungen');
  const s = await lies(v, 'einstieg');
  expect([s.warnung, s.alter, s.einwilligung]).toEqual([true, true, true]);
  expect(context.pages().filter((p) => p.url().includes('willkommen.html'))).toHaveLength(0);
  expect((await sende(v, { zuruecksetzen: true })).ok).toBe(true);
  const z = await lies(v, 'einstieg');
  expect([z.warnung, z.alter, z.einwilligung, z.interview, z.zeit]).toEqual([false, false, false, 'offen', null]);
  messzahl += 2;
  await v.close();
});

test('ganzer Durchgang mit echten Klicks: Einstellungen wie gewaehlt, einstieg fertig, interview fertig', async () => {
  // Die Verwaltungsseite ist hier nicht die Einstellungsseite, damit "All settings" eine neue Seite oeffnet (sonst springt Chrome zur offenen).
  const v = await verwaltung('popup.html');
  await entferne(v, ['einstellungen', 'pack', 'quizWarnungGesehen', 'spiraleWarnungGesehen']);
  const w = await oeffneNeu(v);
  // a. Warnung
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'warnung');
  await expect(w.locator('#warnung-kern')).toHaveText(TEXT.warnungKern);
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.schrittVon(1, 8));
  await w.locator('#warnung-ok').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).warnung).toBe(true);
  expect(await lies(v, 'quizWarnungGesehen')).toBe(true);
  expect(await lies(v, 'spiraleWarnungGesehen')).toBe(true);
  messzahl += 3;
  // b. 18+
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'alter');
  expect((await lies(v, 'einstieg')).alter).toBe(false);
  await w.locator('#alter-ja').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).alter).toBe(true);
  messzahl++;
  // c. Einwilligung
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'einwilligung');
  await expect(w.locator('#einwilligung-punkte li')).toHaveCount(TEXT.einwilligungPunkte.length);
  expect((await lies(v, 'einstieg')).einwilligung).toBe(false);
  await w.locator('#einwilligung-ok').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).einwilligung).toBe(true);
  const stand = await lies(v, 'einstieg');
  expect(typeof stand.zeit).toBe('number');
  expect(stand.interview).toBe('offen');
  messzahl += 3;
  // d1. Stimmung und Strict
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.schrittVon(4, 8));
  await expect(w.locator('#iv-zurueck')).toHaveCount(0);
  await expect(w.locator('#iv-stimmung')).toHaveValue('0.1');
  await w.locator('#iv-stimmung').fill('0.2');
  await expect.poll(async () => (await einst(v)).schwelle).toBe(0.2);
  await schalter(w, '#iv-strict');
  await expect.poll(async () => (await einst(v)).strict).toBe(true);
  messzahl += 2;
  await w.locator('#iv-weiter').click();
  // d2. Zonen
  await expect(w.locator('#iv-zonen-koerper')).toBeChecked();
  await w.locator('label', { has: w.locator('#iv-zonen-alles') }).click();
  await expect.poll(async () => Object.values((await einst(v)).zonen).every((z: any) => z.an)).toBe(true);
  await schalter(w, '#iv-bedeckt');
  await expect.poll(async () => (await einst(v)).zonen.feet.bedeckt).toBe(true);
  await expect.poll(async () => (await einst(v)).zonen.breast.bedeckt).toBe(true);
  await w.locator('label', { has: w.locator('#iv-zonen-koerper-gesicht') }).click();
  await expect.poll(async () => (await einst(v)).zonen.face.an).toBe(true);
  expect((await einst(v)).zonen.feet.an).toBe(false);
  messzahl += 4;
  // Zurueck und wieder vor: Seite 1 zeigt die gespeicherten Werte
  await w.locator('#iv-zurueck').click();
  await expect(w.locator('#iv-stimmung')).toHaveValue('0.2');
  await expect(w.locator('#iv-strict')).toBeChecked();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#iv-zonen-koerper-gesicht')).toBeChecked();
  await expect(w.locator('#iv-bedeckt')).toBeChecked();
  await w.locator('#iv-weiter').click();
  // d3. Stil und Calm
  await expect(w.locator('#iv-stil-mosaik')).toBeChecked();
  await expect(w.locator('#iv-stil-mia-patch')).toBeDisabled();
  await expect(w.locator('#iv-stil-sperre')).toBeVisible();
  await w.locator('label', { has: w.locator('#iv-stil-blur') }).click();
  await expect.poll(async () => (await einst(v)).stil).toBe('blur');
  await schalter(w, '#iv-ruhig');
  await expect.poll(async () => (await einst(v)).ruhig).toBe(true);
  // Mit Pack wird "Mia patch" waehlbar und der Hinweis verschwindet (folgt dem Speicher)
  await schreibe(v, { pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: ['stil:mia-patch'], bilder: 1, groesse: 1, importiert: 1 } });
  await expect(w.locator('#iv-stil-mia-patch')).toBeEnabled();
  await expect(w.locator('#iv-stil-sperre')).toBeHidden();
  await w.locator('label', { has: w.locator('#iv-stil-mia-patch') }).click();
  await expect.poll(async () => (await einst(v)).stil).toBe('mia-patch');
  await entferne(v, ['pack']);
  await expect(w.locator('#iv-stil-mia-patch')).toBeDisabled();
  await expect(w.locator('#iv-stil-mosaik')).toBeChecked();
  // Das Pack ist direkt aus dem Speicher weg (nicht ueber entfernePack): der gespeicherte Stil bleibt, also stellen wir ihn ausdruecklich auf Blur.
  await w.locator('label', { has: w.locator('#iv-stil-blur') }).click();
  await expect.poll(async () => (await einst(v)).stil).toBe('blur');
  messzahl += 6;
  await w.locator('#iv-weiter').click();
  // d4. Erwachsenenseiten
  await expect(w.locator('#iv-ohne-pack')).toBeVisible();
  await schalter(w, '#iv-erw-an');
  await expect.poll(async () => (await einst(v)).erwachsen.an).toBe(false);
  await schalter(w, '#iv-erw-ersatz');
  await expect.poll(async () => (await einst(v)).erwachsen.komplettErsatz).toBe(true);
  await w.locator('#iv-verweigern').fill('20');
  await expect.poll(async () => (await einst(v)).quiz.verweigern).toBe(0.2);
  messzahl += 3;
  await w.locator('#iv-weiter').click();
  // d5. Kontrolle und Ton
  await expect(w.locator('#iv-weiter')).toHaveText(TEXT.fertig);
  await w.locator('#iv-blitz').selectOption('oft');
  await expect.poll(async () => (await einst(v)).kontrolle.blitz).toBe('oft');
  await schalter(w, '#iv-leerlauf');
  await expect.poll(async () => (await einst(v)).kontrolle.leerlauf).toBe(false);
  await w.locator('#iv-cursor').selectOption('herz');
  await expect.poll(async () => (await einst(v)).kontrolle.cursor).toBe('herz');
  await schalter(w, '#iv-ton');
  await expect.poll(async () => (await einst(v)).ton.an).toBe(true);
  messzahl += 4;
  // Abschluss
  await w.locator('#iv-weiter').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).interview).toBe('fertig');
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  await expect(w.locator('#fortschritt-zeile')).toBeHidden();
  messzahl++;
  // "All settings" oeffnet die Einstellungsseite
  const opt = context.waitForEvent('page');
  await w.locator('#ende-einstellungen').click();
  expect((await opt).url()).toContain('options.html');
  // "Add the Mia Pack" fuehrt zum Pack-Abschnitt
  await w.locator('#ende-pack').click();
  await w.waitForURL(/options\.html#neu$/);
  messzahl += 2;
  // Einstellungen blieben wie gewaehlt
  const e = await einst(v);
  expect([e.schwelle, e.strict, e.stil, e.ruhig, e.erwachsen.an, e.erwachsen.komplettErsatz, e.quiz.verweigern, e.kontrolle.blitz, e.kontrolle.leerlauf, e.kontrolle.cursor, e.ton.an]).toEqual([
    0.2, true, 'blur', true, false, true, 0.2, 'oft', false, 'herz', true,
  ]);
  for (const p of context.pages()) if (p !== v) await p.close();
  await v.close();
});

test('Ueberspringen: interview uebersprungen, Einstellungen unveraendert, Gate und Einwilligung nie', async () => {
  const v = await verwaltung();
  await entferne(v, ['einstellungen', 'pack']);
  const w = await oeffneNeu(v);
  await expect(w.locator('#iv-ueberspringen')).toHaveCount(0); // am Gate gibt es kein Ueberspringen
  await w.locator('#warnung-ok').click();
  await w.locator('#alter-ja').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'einwilligung');
  await expect(w.locator('#iv-ueberspringen')).toHaveCount(0);
  await w.locator('#einwilligung-ok').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  // Erst Antworten geben, dann auf Seite 3 ueberspringen: die gesetzten Einstellungen bleiben, es wird nichts zurueckgesetzt.
  await w.locator('#iv-stimmung').fill('0.15');
  await expect.poll(async () => (await einst(v)).schwelle).toBe(0.15);
  await schalter(w, '#iv-strict');
  await expect.poll(async () => (await einst(v)).strict).toBe(true);
  await w.locator('#iv-weiter').click();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-3');
  const vorher = await lies(v, 'einstellungen');
  expect(vorher.schwelle).toBe(0.15);
  await w.locator('#iv-ueberspringen').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).interview).toBe('uebersprungen');
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  expect(await lies(v, 'einstellungen')).toEqual(vorher);
  messzahl += 5;
  await w.close();
  await v.close();
});

test('"I’m not" speichert nichts und bietet kein Weiter; "Not now" speichert die Einwilligung nicht', async () => {
  const v = await verwaltung();
  const w = await oeffneNeu(v);
  await w.locator('#warnung-ok').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'alter');
  const vorher = await lies(v, 'einstieg');
  await w.locator('#alter-nein').click();
  await expect(w.locator('#alter-absage')).toBeVisible();
  await expect(w.locator('#alter-entfernen')).toHaveText(TEXT.entfernenChrome);
  await expect(w.locator('#alter-ja')).toBeHidden();
  await w.waitForTimeout(300);
  expect(await lies(v, 'einstieg')).toEqual(vorher);
  expect((await lies(v, 'einstieg')).alter).toBe(false);
  // Neu laden: die Seite fragt wieder (nichts gemerkt)
  await w.reload();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'alter');
  await w.locator('#alter-ja').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'einwilligung');
  const davor = await lies(v, 'einstieg');
  const zu = w.waitForEvent('close');
  await w.locator('#einwilligung-nein').click();
  await zu;
  expect(await lies(v, 'einstieg')).toEqual(davor);
  expect(davor.einwilligung).toBe(false);
  messzahl += 3;
  await v.close();
});

test('Popup: Hinweis "Meet Mia" bei offenem Einstieg sichtbar, bei fertigem weg, Knopf oeffnet die Willkommensseite', async () => {
  const v = await verwaltung();
  await sende(v, { zuruecksetzen: true });
  const p = await context.newPage();
  await p.goto(url('popup.html'));
  await expect(p.locator('#einstieg-hinweis')).toBeVisible();
  await expect(p.locator('#einstieg-knopf')).toHaveText('Meet Mia');
  const neu = context.waitForEvent('page');
  await p.locator('#einstieg-knopf').click();
  const w = await neu;
  await w.waitForLoadState('domcontentloaded');
  expect(w.url()).toContain('willkommen.html');
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'warnung');
  messzahl += 2;
  const p2 = await context.newPage();
  await p2.goto(url('popup.html'));
  await expect(p2.locator('#einstieg-hinweis')).toBeVisible();
  // Ist die Willkommensseite schon offen, holt "Meet Mia" sie nach vorn und oeffnet keine zweite
  const zaehle = () => context.pages().filter((s) => s.url().includes('willkommen.html')).length;
  expect(zaehle()).toBe(1);
  const pz = await context.newPage();
  await pz.goto(url('popup.html'));
  await expect(pz.locator('#einstieg-knopf')).toBeVisible();
  await pz.locator('#einstieg-knopf').click(); // das Popup schliesst sich danach selbst
  await v.waitForTimeout(1000);
  expect(zaehle()).toBe(1);
  messzahl++;
  // Fertig im Speicher: der offene Hinweis verschwindet von selbst
  await schreibe(v, { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });
  await expect(p2.locator('#einstieg-hinweis')).toBeHidden();
  const p3 = await context.newPage();
  await p3.goto(url('popup.html'));
  await expect(p3.locator('#einstieg-hinweis')).toBeHidden();
  messzahl += 2;
  for (const s of context.pages()) if (s !== v) await s.close();
  await v.close();
});

test('Adresse: #interview springt bei fertigem Einstieg ins Interview, sonst zum Gate; Zonen ohne Wahl waehlen nichts vor', async () => {
  const v = await verwaltung();
  await schreibe(v, { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });
  await entferne(v, ['einstellungen']);
  const w = await context.newPage();
  await w.goto(url('willkommen.html#interview'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  // Neuladen mitten im Interview bleibt auf der Seite
  await w.locator('#iv-weiter').click();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-3');
  await w.reload();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-3');
  // Interview erneut aufgerufen und ueberspringen: 'fertig' bleibt 'fertig'
  await w.locator('#iv-ueberspringen').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  expect((await lies(v, 'einstieg')).interview).toBe('fertig');
  messzahl += 2;
  await w.goto(url('willkommen.html'));
  await w.reload();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  // Zonen, die zu keiner Wahl passen
  await schreibe(v, { einstellungen: { version: 1, zonen: { eyes: { an: true } } } });
  await w.goto(url('willkommen.html#interview'));
  await w.reload();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#iv-zonen-keine')).toBeVisible();
  for (const f of ['koerper', 'koerper-gesicht', 'alles']) await expect(w.locator(`#iv-zonen-${f}`)).not.toBeChecked();
  await w.locator('label', { has: w.locator('#iv-zonen-koerper') }).click();
  await expect.poll(async () => (await einst(v)).zonen.eyes.an).toBe(false);
  await expect(w.locator('#iv-zonen-keine')).toBeHidden();
  messzahl += 4;
  // Einstieg offen: #interview kommt nicht am Gate vorbei
  await sende(v, { zuruecksetzen: true });
  await w.goto(url('willkommen.html#interview'));
  await w.reload();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'warnung');
  messzahl++;
  await entferne(v, ['einstellungen']);
  await w.close();
  await v.close();
});

test('360 px: kein waagrechtes Scrollen in keinem Schritt', async () => {
  const v = await verwaltung();
  await schreibe(v, { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });
  const w = await context.newPage();
  await w.setViewportSize({ width: 360, height: 700 });
  await w.goto(url('willkommen.html#interview'));
  let geprueft = 0;
  for (let i = 1; i <= 5; i++) {
    await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', `interview-${i}`);
    const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(m.s, `Seite ${i}`).toBeLessThanOrEqual(m.c);
    geprueft++;
    await w.locator('#iv-weiter').click();
  }
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  await sende(v, { zuruecksetzen: true });
  await w.reload();
  for (const s of ['warnung', 'alter', 'einwilligung']) {
    await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', s);
    const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(m.s, s).toBeLessThanOrEqual(m.c);
    geprueft++;
    await w.locator(s === 'warnung' ? '#warnung-ok' : s === 'alter' ? '#alter-ja' : '#einwilligung-ok').click();
  }
  console.log(`chromium: einstieg 360 px, ${geprueft} Schritte ohne Ueberlauf`);
  messzahl += geprueft;
  await entferne(v, ['einstellungen']);
  await w.close();
  await v.close();
});
