// Chromium: Auftrag E (Einstieg, Session 11). Testbau: nach der Installation gilt der Einstieg als erledigt und nichts oeffnet sich;
// `einstieg-test` setzt zurueck und oeffnet. Ganzer Durchgang mit echten Klicks, Ueberspringen, "I’m not", Popup-Hinweis, #interview, 360 px.
import { HINWEIS_FACE_EIN, HINWEIS_PACK_OHNE_STICKER } from '../../src/oberflaeche/gemeinsam';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT } from '../../src/einstieg/texte';
import { STANDARD } from '../../src/einstellungen';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { mitReitern } from './einstellungen-ordnung';

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
// Ein Pack im Speicher (Fund 7, E4e I1: mit Pack beim Einstieg hat das Interview 6 Seiten, ohne 4).
const PACK_KURZ = { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 };
const einst = async (s: Page) => (await lies(s, 'einstellungen')) ?? {};
// Schalter aus den Bausteinen (E4e): ein Knopf mit role="switch", geklickt wird der Knopf selbst.
const schalter = (s: Page, feld: string) => s.locator(feld).click();
// Karte einer Wahlgruppe der Bausteine (data-id) und Stufe der Stimmung.
const karte = (s: Page, gruppe: string, kartenId: string) => s.locator(`#${gruppe} [data-id="${kartenId}"]`);
const stufe = (s: Page, name: string) => s.locator('#iv-stimmung-wahl .v-stufe', { hasText: new RegExp(`^${name}$`) });
const exaktOeffnen = (s: Page) => s.locator('#iv-stimmung-wahl .v-auf-kopf').click();

// Eine Verwaltungsseite der Erweiterung, auf der Nachrichten und Speicher erreichbar sind.
async function verwaltung(seite = 'options.html'): Promise<Page> {
  const s = mitReitern(await context.newPage());
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

// Interview mit sechs Seiten, aber ohne Pack danach: das Pack liegt beim Eintritt im Speicher (Fund 7) und wird gleich wieder entfernt,
// damit die Hinweise "ohne Pack" auf Seite 5 und 6 sichtbar sind.
async function interviewSechs(v: Page, breite?: number): Promise<Page> {
  await schreibe(v, FERTIG);
  await schreibe(v, { pack: PACK_KURZ });
  const w = mitReitern(await context.newPage());
  if (breite) await w.setViewportSize({ width: breite, height: 700 });
  await w.goto(url('willkommen.html#interview'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, 6));
  await entferne(v, ['pack']);
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
  await schreibe(v, { pack: PACK_KURZ }); // mit Pack beim Einstieg: sechs Seiten
  const w = await oeffneNeu(v);
  // a. Warnung
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'warnung');
  await expect(w.locator('#warnung-kern')).toHaveText(TEXT.warnungKern);
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.schrittVon(1, 9));
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
  // d1. Zones (E4e I2): der Standard markiert "Body"
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, 6)); // Fund 19
  await expect(w.locator('#etappen li[aria-current="step"]')).toHaveText(TEXT.etappen.interview);
  await expect(w.locator('#iv-zurueck')).toHaveCount(0);
  await expect(w.locator('.iv-schritte li')).toHaveText(TEXT.schritteNamen); // sechs Schritte mit Pack
  await entferne(v, ['pack']); // ab hier wie ohne Pack; die Zahl der Seiten bleibt bei 6
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, 6));
  await expect(karte(w, 'iv-zonen-wahl', 'koerper')).toHaveAttribute('aria-checked', 'true');
  await karte(w, 'iv-zonen-wahl', 'alles').click();
  await expect.poll(async () => Object.values((await einst(v)).zonen).every((z: any) => z.an)).toBe(true);
  await karte(w, 'iv-zonen-wahl', 'koerper-gesicht').click();
  await expect.poll(async () => (await einst(v)).zonen.face.an).toBe(true);
  expect((await einst(v)).zonen.feet.an).toBe(false);
  messzahl += 3;
  await w.locator('#iv-weiter').click();
  // d2. Clothes (I2): bei gemischtem Stand (Standard) ist keine Antwort markiert, der Hinweis nennt den gespeicherten Stand
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-2');
  await expect(w.locator('#iv-kleidung-frage [role="radio"][aria-checked="true"]')).toHaveCount(0);
  await expect(w.locator('#iv-kleidung-frage .v-hinweis')).toContainText('Genitals');
  await karte(w, 'iv-kleidung-frage', 'auch-bedeckt').click();
  await expect.poll(async () => (await einst(v)).zonen.feet.bedeckt).toBe(true);
  await expect.poll(async () => (await einst(v)).zonen.breast.bedeckt).toBe(true);
  expect((await einst(v)).zonen.face.an).toBe(true); // Kleidung aendert nie ein `an`
  await karte(w, 'iv-kleidung-frage', 'haut').click();
  await expect.poll(async () => (await einst(v)).zonen.breast.bedeckt).toBe(false);
  await karte(w, 'iv-kleidung-frage', 'auch-bedeckt').click();
  await expect.poll(async () => (await einst(v)).zonen.breast.bedeckt).toBe(true);
  messzahl += 5;
  // Zurueck und wieder vor: Seite 1 zeigt die gespeicherten Werte
  await w.locator('#iv-zurueck').click();
  await expect(karte(w, 'iv-zonen-wahl', 'koerper-gesicht')).toHaveAttribute('aria-checked', 'true');
  await w.locator('#iv-weiter').click();
  await expect(karte(w, 'iv-kleidung-frage', 'auch-bedeckt')).toHaveAttribute('aria-checked', 'true');
  await w.locator('#iv-weiter').click();
  // d3. Style (Stilkarten und Eye bar wie heute)
  await expect(w.locator('#iv-preset-mosaik')).toBeChecked();
  await expect(w.locator('#iv-preset-mia-wort')).toBeDisabled();
  await expect(w.locator('#iv-stil-sperre')).toBeVisible();
  await expect(w.locator('#iv-preset-karten input[name="iv-preset"]')).toHaveCount(12); // dieselben Karten wie auf der Einstellungsseite
  await w.locator('label', { has: w.locator('#iv-preset-blur') }).click();
  await expect.poll(async () => (await einst(v)).preset).toBe('blur');
  await expect(w.locator('.iv-vorschau .v-vorschau-etikett')).toHaveText('Blur'); // der Platz der Vorschau folgt dem gespeicherten Stil
  // Eye bar (E4c): ein Schalter unter dem Raster, aendert nur sich selbst
  await expect(w.locator('#iv-augenbalken')).not.toBeChecked();
  await schalter(w, '#iv-augenbalken');
  await expect.poll(async () => (await einst(v)).augenbalken).toBe(true);
  expect((await einst(v)).preset).toBe('blur');
  await schalter(w, '#iv-augenbalken');
  await expect.poll(async () => (await einst(v)).augenbalken).toBe(false);
  await expect(w.locator('#iv-ruhig')).toHaveCount(0); // Calm mode steht mit Pack auf der letzten Seite (Fund 23)
  // Mit Pack werden die Presets mit meinem Gesicht waehlbar und der Hinweis verschwindet (folgt dem Speicher)
  await schreibe(v, { pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: ['stil:mia-patch'], bilder: 1, groesse: 1, importiert: 1 } });
  await expect(w.locator('#iv-preset-mia-wort')).toBeEnabled();
  // Pack ohne Sticker (wie vor 1.0): die Sticker-Karten bleiben gesperrt, der Hinweis sagt es
  await expect(w.locator('#iv-preset-sticker')).toBeDisabled();
  await expect(w.locator('#iv-preset-mia-sticker')).toBeDisabled();
  await expect(w.locator('#iv-stil-sperre')).toHaveText(HINWEIS_PACK_OHNE_STICKER);
  await schreibe(v, { pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: ['stil:mia-patch', 'zensur:sticker'], bilder: 1, sticker: 1, groesse: 1, importiert: 1 } });
  await expect(w.locator('#iv-preset-sticker')).toBeEnabled();
  await expect(w.locator('#iv-stil-sperre')).toBeHidden();
  // Face steht aus: das Mia-Preset schaltet es ein
  const vorMia = await einst(v);
  await schreibe(v, { einstellungen: { ...vorMia, zonen: { ...vorMia.zonen, face: { an: false } } } });
  await w.locator('label', { has: w.locator('#iv-preset-mia-wort') }).click();
  await expect.poll(async () => (await einst(v)).preset).toBe('mia-wort');
  // Entscheidung der Inhaberin: das Mia-Preset schaltet Face ein, mit kurzem Hinweis
  await expect.poll(async () => (await einst(v)).zonen.face.an).toBe(true);
  await expect(w.locator('#iv-stil-face')).toHaveText(HINWEIS_FACE_EIN);
  await expect(w.locator('#iv-preset-karten')).toHaveAttribute('role', 'radiogroup');
  await expect(w.locator('#iv-preset-karten')).toHaveAttribute('aria-labelledby', 'schritt-titel');
  await entferne(v, ['pack']);
  await expect(w.locator('#iv-preset-mia-wort')).toBeDisabled();
  await expect(w.locator('#iv-preset-mosaik')).toBeChecked();
  // Das Pack ist direkt aus dem Speicher weg (nicht ueber entfernePack): der gespeicherte Stil bleibt, also stellen wir ihn ausdruecklich auf Blur.
  await w.locator('label', { has: w.locator('#iv-preset-blur') }).click();
  await expect.poll(async () => (await einst(v)).preset).toBe('blur');
  messzahl += 6;
  await w.locator('#iv-weiter').click();
  // d4. Mood (I4): Stufen mit Namen, "Exact value", Strict als Schalter
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-4');
  await expect(stufe(w, stimmungsWort(0.1))).toHaveAttribute('aria-checked', 'true');
  await stufe(w, stimmungsWort(0.22)).click();
  await expect.poll(async () => (await einst(v)).schwelle).toBe(0.22);
  await exaktOeffnen(w);
  await w.locator('#iv-stimmung-wahl input[type=range]').fill('0.2');
  await expect.poll(async () => (await einst(v)).schwelle).toBe(0.2);
  await schalter(w, '#iv-strict');
  await expect.poll(async () => (await einst(v)).strict).toBe(true);
  messzahl += 3;
  await w.locator('#iv-weiter').click();
  // d5. Adult sites (I5, I5a): das Pack fehlt hier, also die Form ohne Freischaltung: Off und On waehlbar, die drei Stufen gesperrt
  await expect(w.locator('#iv-ohne-pack')).toBeVisible();
  await expect(karte(w, 'iv-erw-wahl', 'on')).toHaveAttribute('aria-checked', 'true'); // Standard: an
  await karte(w, 'iv-erw-wahl', 'off').click();
  await expect.poll(async () => (await einst(v)).erwachsen.an).toBe(false);
  expect((await einst(v)).erwachsen.stufe).toBe(STANDARD.erwachsen.stufe); // Off laesst die Stufe stehen
  await karte(w, 'iv-erw-wahl', 'on').click();
  await expect.poll(async () => (await einst(v)).erwachsen.an).toBe(true);
  messzahl += 3;
  await w.locator('#iv-weiter').click();
  // d6. Extras (I6): Calm mode oben, Flash words als Auswahl; Leerlauf, Zeiger und Ton werden nicht mehr gefragt
  await expect(w.locator('#iv-weiter')).toHaveText(TEXT.fertig);
  await schalter(w, '#iv-ruhig');
  await expect.poll(async () => (await einst(v)).ruhig).toBe(true);
  await w.locator('#iv-blitz').selectOption('oft');
  await expect.poll(async () => (await einst(v)).kontrolle.blitz).toBe('oft');
  for (const weg of ['#iv-leerlauf', '#iv-cursor', '#iv-ton', '#iv-verweigern', '#iv-erw-ersatz', '#iv-erw-an', '#iv-bedeckt']) await expect(w.locator(weg)).toHaveCount(0);
  messzahl += 2;
  // Abschluss
  await w.locator('#iv-weiter').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).interview).toBe('fertig');
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  await expect(w.locator('#fortschritt-zeile')).toBeHidden();
  messzahl++;
  // "All settings" geht im selben Tab zur Einstellungsseite (Fund 22), "Back" fuehrt zum Abschluss zurueck
  const seitenVorher = context.pages().length;
  await w.locator('#ende-einstellungen').click();
  await w.waitForURL(/options\.html$/);
  expect(context.pages().length).toBe(seitenVorher);
  await w.goBack();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  // "Add the Mia Pack" fuehrt zum Pack-Abschnitt, ebenfalls im selben Tab
  await w.locator('#ende-pack').click();
  await w.waitForURL(/options\.html#neu$/);
  expect(context.pages().length).toBe(seitenVorher);
  messzahl += 3;
  // Einstellungen blieben wie gewaehlt
  const e = await einst(v);
  // Was gefragt wurde, steht wie gewaehlt; was nicht mehr gefragt wird, bleibt beim Standard (I7).
  expect([e.schwelle, e.strict, e.preset, e.ruhig, e.erwachsen.an, e.kontrolle.blitz]).toEqual([0.2, true, 'blur', true, true, 'oft']);
  expect([e.erwachsen.komplettErsatz, e.quiz.verweigern, e.kontrolle.leerlauf, e.kontrolle.cursor, e.ton.an]).toEqual([
    STANDARD.erwachsen.komplettErsatz, STANDARD.quiz.verweigern, STANDARD.kontrolle.leerlauf, STANDARD.kontrolle.cursor, STANDARD.ton.an,
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
  // Erst eine Antwort geben, dann auf Seite 2 ueberspringen: die gesetzten Einstellungen bleiben, es wird nichts zurueckgesetzt.
  await karte(w, 'iv-zonen-wahl', 'alles').click();
  await expect.poll(async () => Object.values((await einst(v)).zonen).every((z: any) => z.an)).toBe(true);
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-2'); // ohne Pack gibt es nur vier Seiten (Fund 7)
  const vorher = await lies(v, 'einstellungen');
  expect(Object.values(vorher.zonen).every((z: any) => z.an)).toBe(true);
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
  const p = mitReitern(await context.newPage());
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
  const p2 = mitReitern(await context.newPage());
  await p2.goto(url('popup.html'));
  await expect(p2.locator('#einstieg-hinweis')).toBeVisible();
  // Ist die Willkommensseite schon offen, holt "Meet Mia" sie nach vorn und oeffnet keine zweite
  const zaehle = () => context.pages().filter((s) => s.url().includes('willkommen.html')).length;
  expect(zaehle()).toBe(1);
  const pz = mitReitern(await context.newPage());
  await pz.goto(url('popup.html'));
  await expect(pz.locator('#einstieg-knopf')).toBeVisible();
  await pz.locator('#einstieg-knopf').click(); // das Popup schliesst sich danach selbst
  await v.waitForTimeout(1000);
  expect(zaehle()).toBe(1);
  messzahl++;
  // Fertig im Speicher: der offene Hinweis verschwindet von selbst
  await schreibe(v, { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });
  await expect(p2.locator('#einstieg-hinweis')).toBeHidden();
  const p3 = mitReitern(await context.newPage());
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
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html#interview'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  // Neuladen mitten im Interview bleibt auf der Seite
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-2');
  await w.reload();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-2');
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
  await expect(w.locator('#iv-zonen-wahl .v-hinweis')).toHaveText(TEXT.wahlKeine);
  for (const f of ['koerper', 'koerper-gesicht', 'alles']) await expect(karte(w, 'iv-zonen-wahl', f)).toHaveAttribute('aria-checked', 'false');
  await karte(w, 'iv-zonen-wahl', 'koerper').click();
  await expect.poll(async () => (await einst(v)).zonen.eyes.an).toBe(false);
  await expect(w.locator('#iv-zonen-wahl .v-hinweis')).toHaveCount(0);
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
  await schreibe(v, { pack: PACK_KURZ }); // sechs Seiten; unten wird das Pack entfernt, damit die Pack-Hinweise mitgemessen werden
  const w = mitReitern(await context.newPage());
  await w.setViewportSize({ width: 360, height: 700 });
  await w.goto(url('willkommen.html#interview'));
  let geprueft = 0;
  for (let i = 1; i <= 6; i++) {
    await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', `interview-${i}`);
    if (i === 1) await entferne(v, ['pack']);
    const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(m.s, `Seite ${i}`).toBeLessThanOrEqual(m.c);
    geprueft++;
    await w.locator('#iv-weiter').click();
  }
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  {
    const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(m.s, 'ende').toBeLessThanOrEqual(m.c);
    geprueft++;
  }
  // Fehlerzeile sichtbar (Speichern scheitert) auf Seite 4 (Strict), auch beim zweiten Fehler
  await w.reload();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  for (let i = 0; i < 3; i++) await w.locator('#iv-weiter').click();
  await expect(w.locator('#iv-strict')).toBeVisible();
  await w.evaluate(() => {
    (globalThis as any).chrome.storage.local.set = () => Promise.reject(new Error('voll'));
  });
  await schalter(w, '#iv-strict');
  await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
  await schalter(w, '#iv-strict');
  await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
  {
    const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(m.s, 'fehler').toBeLessThanOrEqual(m.c);
    geprueft++;
  }
  await sende(v, { zuruecksetzen: true });
  await w.reload();
  for (const s of ['warnung', 'alter', 'einwilligung']) {
    await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', s);
    const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(m.s, s).toBeLessThanOrEqual(m.c);
    geprueft++;
    if (s === 'alter') {
      await w.locator('#alter-nein').click();
      await expect(w.locator('#alter-zurueck')).toBeVisible();
      const a = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      expect(a.s, 'absage').toBeLessThanOrEqual(a.c);
      geprueft++;
      await w.locator('#alter-zurueck').click();
    }
    await w.locator(s === 'warnung' ? '#warnung-ok' : s === 'alter' ? '#alter-ja' : '#einwilligung-ok').click();
  }
  console.log(`chromium: einstieg 360 px, ${geprueft} Schritte ohne Ueberlauf`);
  messzahl += geprueft;
  await entferne(v, ['einstellungen']);
  await w.close();
  await v.close();
});

// ---------- Session 12, Auftrag W: UX-Funde ----------

const FERTIG = { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } };
const PACK = { pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 } };
// Kontrast nach WCAG aus berechneten Farben (rgb/rgba-Text), im Seitenkontext.
const kontrast = (s: Page, css: string, vorn: 'color' | 'borderTopColor' | 'backgroundColor', hinten: string) =>
  s.evaluate(
    ([css, vorn, hinten]) => {
      const rgb = (t: string) => (t.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: number[]) => {
        const l = c.map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
        return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
      };
      const e = document.querySelector(css) as HTMLElement;
      const a = lum(rgb(getComputedStyle(e)[vorn as 'color']));
      const b = lum(rgb(hinten.startsWith('#') ? hinten.match(/\w\w/g)!.map((h) => String(parseInt(h, 16))).join(' ') : getComputedStyle(e).backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    },
    [css, vorn, hinten] as const,
  );

test('Fund 2 und 18: Einwilligungsseite sagt, was schon laeuft und was bei "Not now" gilt; "I tapped the wrong one" fuehrt zur Frage zurueck', async () => {
  const v = await verwaltung();
  const w = await oeffneNeu(v);
  await w.locator('#warnung-ok').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'alter');
  const vorher = await lies(v, 'einstieg');
  await w.locator('#alter-nein').click();
  await expect(w.locator('#alter-absage')).toBeVisible();
  await expect(w.locator('#alter-zurueck')).toHaveText(TEXT.alterZurueck);
  await w.locator('#alter-zurueck').click();
  await expect(w.locator('#alter-frage')).toBeVisible();
  await expect(w.locator('#alter-absage')).toBeHidden();
  await expect(w.locator('#alter-ja')).toBeFocused();
  await expect(w.locator('#fortschritt-zeile')).toBeVisible();
  expect(await lies(v, 'einstieg')).toEqual(vorher);
  messzahl += 3;
  await w.locator('#alter-ja').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'einwilligung');
  await expect(w.locator('#einwilligung-laeuft')).toHaveText(TEXT.einwilligungLaeuft);
  await expect(w.locator('#einwilligung-nein-hinweis')).toHaveText(TEXT.einwilligungNeinHinweis);
  await expect(w.locator('#einwilligung-nein')).toHaveAttribute('aria-describedby', 'einwilligung-nein-hinweis');
  messzahl += 3;
  await w.close();
  await v.close();
});

test('Wiederholen: "Question n of 6", Stimmung mit genauem Wert, Hinweis und Pack-Link auf Seite 5 und 6, Calm mode nur auf Seite 6, kein Ueberspringen auf Seite 6', async () => {
  const v = await verwaltung();
  await schreibe(v, FERTIG);
  await schreibe(v, PACK); // mit Pack beim Eintritt: sechs Fragen; nach Seite 1 faellt das Pack weg, damit die Pack-Hinweise sichtbar sind
  await schreibe(v, { einstellungen: { version: 1, schwelle: 0.2, kontrolle: { werbung: true } } }); // Werbung ist ab Werk aus (Opt-in), hier an, damit die Zeile alle drei nennt
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html#interview'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  await entferne(v, ['pack']);
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, 6)); // Fund 19
  await expect(w.locator('#fortschritt')).toHaveAttribute('max', '6');
  await expect(w.locator('#iv-ueberspringen')).toBeVisible();
  await w.locator('#iv-weiter').click();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#iv-ruhig')).toHaveCount(0); // Fund 23: nicht auf der Stil-Seite, wenn das Interview sechs Seiten hat
  await w.locator('#iv-weiter').click();
  // Seite 4: der gespeicherte Zwischenwert 0.2 markiert keine Stufe, "Exact value" ist offen und zeigt ihn genau (E4d2 F3), nichts wird geschrieben
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-4');
  await expect(w.locator('#iv-stimmung-wahl .v-stufe[aria-checked="true"]')).toHaveCount(0);
  await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText('0.2');
  await expect(w.locator('#iv-stimmung-wahl input[type=range]')).toBeVisible();
  await w.locator('#iv-stimmung-wahl input[type=range]').fill('0.11');
  await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText('0.11');
  await expect.poll(async () => (await einst(v)).schwelle).toBe(0.11);
  messzahl += 5;
  await w.locator('#iv-weiter').click();
  // Seite 5: Satz und Link (Fund 4)
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-5');
  await expect(w.locator('#iv-ohne-pack')).toContainText(TEXT.ohnePack5);
  await expect(w.locator('#iv-pack-link')).toHaveText(TEXT.packLink);
  await expect(w.locator('#iv-pack-link')).toHaveAttribute('href', `chrome-extension://${id}/options.html#neu`);
  messzahl += 3;
  await w.locator('#iv-weiter').click();
  // Seite 6
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(6, 6));
  await expect(w.locator('#iv-ohne-pack')).toContainText(TEXT.ohnePack6);
  const alle = [TEXT.auchAnNamen.werbung, TEXT.auchAnNamen.tabtitel, TEXT.auchAnNamen.meldungen];
  await expect(w.locator('#iv-auch-an')).toContainText(TEXT.auchAn(alle)); // Fund 3
  await expect(w.locator('#iv-auch-an-link')).toHaveText(TEXT.auchAnLink); // Fund 21
  await expect(w.locator('#iv-auch-an-link')).toHaveAttribute('href', `chrome-extension://${id}/options.html#kontrolle`);
  await expect(w.locator('#iv-auch-an-link')).toHaveAttribute('target', '_blank');
  await expect(w.locator('#iv-ohne-pack')).not.toContainText(TEXT.auchAnNamen.werbung);
  // Die Zeile folgt dem Speicher: ist etwas ausgeschaltet, wird es nicht genannt
  await schreibe(v, { einstellungen: { version: 1, kontrolle: { werbung: false, tabtitel: true, meldungen: false } } });
  await expect(w.locator('#iv-auch-an')).toContainText(TEXT.auchAn([TEXT.auchAnNamen.tabtitel]));
  await schreibe(v, { einstellungen: { version: 1, kontrolle: { werbung: false, tabtitel: false, meldungen: false } } });
  await expect(w.locator('#iv-auch-an')).toBeHidden();
  await schreibe(v, { einstellungen: { version: 1, kontrolle: { werbung: true } } });
  await expect(w.locator('#iv-auch-an')).toContainText(TEXT.auchAn(alle));
  await expect(w.locator('#iv-ueberspringen')).toHaveCount(0); // Fund 20
  await expect(w.locator('.ueberspringen')).toHaveCount(0);
  await schalter(w, '#iv-ruhig'); // Fund 23
  await expect.poll(async () => (await einst(v)).ruhig).toBe(true);
  messzahl += 5;
  // Mit Pack verschwindet der Link
  await schreibe(v, PACK);
  await expect(w.locator('#iv-ohne-pack')).toBeHidden();
  await entferne(v, ['pack']);
  await expect(w.locator('#iv-ohne-pack')).toBeVisible();
  messzahl += 1;
  await entferne(v, ['einstellungen']);
  await w.close();
  await v.close();
});

test('Abschluss: Satz folgt dem Pack (Fund 21)', async () => {
  const v = await verwaltung();
  await schreibe(v, FERTIG);
  await entferne(v, ['pack']);
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  await expect(w.locator('#ende-text')).toHaveText(TEXT.endeText);
  await expect(w.locator('#ende-pack')).toHaveText(TEXT.endePack);
  await expect(w.locator('#ende-pack')).toHaveClass(/gross/); // Fund 1: ohne Pack der Hauptknopf
  await schreibe(v, PACK);
  await expect(w.locator('#ende-text')).toHaveText(TEXT.endeTextMitPack);
  await expect(w.locator('#ende-pack')).toBeHidden();
  await entferne(v, ['pack']);
  await expect(w.locator('#ende-text')).toHaveText(TEXT.endeText);
  messzahl += 5;
  await w.close();
  await v.close();
});

test('Fund 26: scheitert das Speichern, steht der Fehlersatz da und jedes Element springt auf den gespeicherten Stand (Strict, Stimmung, Zonen)', async () => {
  const v = await verwaltung();
  await schreibe(v, FERTIG);
  await entferne(v, ['einstellungen']);
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html#interview'));
  await w.evaluate(() => {
    (globalThis as any).chrome.storage.local.set = () => Promise.reject(new Error('Speicher voll'));
  });
  // Zones
  await karte(w, 'iv-zonen-wahl', 'alles').click();
  await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
  await expect(karte(w, 'iv-zonen-wahl', 'koerper')).toHaveAttribute('aria-checked', 'true');
  await expect(karte(w, 'iv-zonen-wahl', 'alles')).toHaveAttribute('aria-checked', 'false');
  for (let i = 0; i < 3; i++) await w.locator('#iv-weiter').click();
  // Mood und Strict (Seite 4)
  await expect(w.locator('#iv-strict')).not.toBeChecked();
  await schalter(w, '#iv-strict');
  await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
  await expect(w.locator('#iv-strict')).not.toBeChecked();
  expect((await einst(v)).strict ?? false).toBe(false);
  await stufe(w, stimmungsWort(0.22)).click();
  await expect(stufe(w, stimmungsWort(0.1))).toHaveAttribute('aria-checked', 'true');
  await expect(w.locator('#iv-stimmung-wahl input[type=range]')).toHaveValue('0.1');
  expect((await einst(v)).schwelle ?? 0.1).toBe(0.1);
  messzahl += 6;
  await w.close();
  await v.close();
});

test('Kontrast (Fund 9 und 10): kleine Knoepfe mindestens 4,5:1, Schalterbahn aus und Feldraender mindestens 3:1', async () => {
  const v = await verwaltung();
  const w = await interviewSechs(v);
  // "Skip the rest" ist seit E4e (I9) ein Textlink ohne eigenen Grund: gemessen gegen die zwei hellsten Gruende der Karte
  const knopf = Math.min(await kontrast(w, '#iv-ueberspringen', 'color', '#ffffff'), await kontrast(w, '#iv-ueberspringen', 'color', '#fff5fa'));
  expect(knopf).toBeGreaterThanOrEqual(4.5);
  const rand = await kontrast(w, '.v-wahl-karte', 'borderTopColor', '#ffffff'); // Seite 1: Wahlkarten
  expect(rand).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 2; i++) await w.locator('#iv-weiter').click(); // Seite 3: Eye bar (Schalter)
  const bahn = await kontrast(w, '.v-bahn', 'backgroundColor', '#ffffff');
  const bahnGrund = await kontrast(w, '.v-bahn', 'backgroundColor', '#fff5fa');
  expect(Math.min(bahn, bahnGrund)).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 3; i++) await w.locator('#iv-weiter').click(); // Seite 6: Auswahlfeld
  const feld = await kontrast(w, '#iv-blitz', 'borderTopColor', '#ffffff');
  expect(feld).toBeGreaterThanOrEqual(3);
  console.log(`chromium: einstieg Kontrast Knopf ${knopf.toFixed(2)}, Bahn ${bahn.toFixed(2)}, Rand ${rand.toFixed(2)}, Feld ${feld.toFixed(2)}`);
  messzahl += 4;
  await w.close();
  await v.close();
});

test('Fund N9: Unterzeile der gewaehlten Karte mindestens 4,5:1 auf dem Kartengrund', async () => {
  const v = await verwaltung();
  await schreibe(v, FERTIG);
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html#interview'));
  const m = await w.evaluate(() => {
    const rgb = (t: string) => (t.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const l = c.map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
      return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
    };
    const kontr = (a: string, b: string) => {
      const x = lum(rgb(a)), y = lum(rgb(b));
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const out: number[] = [];
    document.querySelectorAll('.v-wahl-karte[aria-checked="true"]').forEach((l) => {
      const sm = l.querySelector('.v-wahl-satz');
      if (!sm) return;
      out.push(kontr(getComputedStyle(sm).color, getComputedStyle(l).backgroundColor));
    });
    return out;
  });
  expect(m.length).toBeGreaterThan(0);
  for (const k of m) expect(k).toBeGreaterThanOrEqual(4.5);
  console.log(`chromium: einstieg N9 Kontrast gewaehlte Unterzeile ${m.map((k) => k.toFixed(2)).join(', ')}`);
  messzahl += m.length;
  await w.close();
  await v.close();
});

test('Fund N10: bei 360 px sind Auswahlen, Knoepfe, Schalter, Regler und der Pack-Link mindestens 44 px hoch', async () => {
  const v = await verwaltung();
  const w = await interviewSechs(v, 360);
  const hoehen: string[] = [];
  for (let i = 1; i <= 6; i++) {
    await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', `interview-${i}`);
    const kleinste = await w.evaluate(() => {
      const ziele = [...document.querySelectorAll<HTMLElement>('#schritt button, #schritt select, #schritt input[type=range], #schritt #iv-pack-link')];
      return ziele
        .filter((e) => e.offsetParent !== null)
        .map((e) => ({ id: e.id || e.className || e.tagName, h: e.getBoundingClientRect().height }));
    });
    for (const z of kleinste) expect(z.h, `Seite ${i}: ${z.id}`).toBeGreaterThanOrEqual(43.99);
    if (kleinste.length) hoehen.push(`${i}:${Math.min(...kleinste.map((z) => z.h)).toFixed(1)}`);
    messzahl += kleinste.length;
    if (i === 5) await expect(w.locator('#iv-pack-link')).toBeVisible();
    if (i < 6) await w.locator('#iv-weiter').click();
  }
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  const ende = await w.evaluate(() => [...document.querySelectorAll<HTMLElement>('#schritt button')].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect().height));
  for (const h of ende) expect(h).toBeGreaterThanOrEqual(43.99);
  const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(m.s).toBeLessThanOrEqual(m.c);
  console.log(`chromium: einstieg N10 kleinste Trefferhoehe je Seite ${hoehen.join(' ')}, Ende ${Math.min(...ende).toFixed(1)}, scrollWidth ${m.s} von ${m.c}`);
  messzahl += ende.length;
  await w.close();
  await v.close();
});

test('Fund N11: Link "Add the Mia Pack" oeffnet einen neuen Tab mit options.html#neu, der Interview-Tab bleibt auf seiner Seite', async () => {
  const v = await verwaltung();
  const w = await interviewSechs(v);
  for (let i = 0; i < 4; i++) await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-5');
  const vorher = context.pages().length;
  const neu = context.waitForEvent('page');
  await w.locator('#iv-pack-link').click();
  const n = await neu;
  await n.waitForLoadState('domcontentloaded');
  await n.waitForURL(/options\.html#neu$/);
  expect(context.pages().length).toBe(vorher + 1);
  expect(w.url()).toContain('willkommen.html');
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-5');
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(5, 6));
  console.log(`chromium: einstieg N11 Tabs ${vorher} auf ${context.pages().length}, neuer Tab ${n.url().split('/').pop()}, Interview-Tab bleibt ${w.url().split('/').pop()}`);
  messzahl += 4;
  await n.close();
  await w.close();
  await v.close();
});

test('Fund N12: beim Wiederholen fuehrt "All settings" am Ende im selben Tab zur Einstellungsseite, kein zweiter Tab', async () => {
  const v = await verwaltung();
  await schreibe(v, FERTIG);
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html#interview'));
  for (let i = 0; i < 4; i++) await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  const vorher = context.pages().length;
  await w.locator('#ende-einstellungen').click();
  await w.waitForURL(/options\.html$/);
  expect(context.pages().length).toBe(vorher);
  console.log(`chromium: einstieg N12 Tabs ${vorher} auf ${context.pages().length}, Ziel ${w.url().split('/').pop()}`);
  messzahl += 2;
  await w.close();
  await v.close();
});

test('Fund 7, 8 und 19: ohne Pack vier Fragen mit Calm mode auf Seite 3, Etappen unter der Bahn, "Calm mode on, then continue" auf der Warnseite', async () => {
  const v = await verwaltung('popup.html');
  await entferne(v, ['einstellungen', 'pack', 'quizWarnungGesehen', 'spiraleWarnungGesehen']);
  const w = await oeffneNeu(v);
  // Warnseite: zwei gleich starke Knoepfe, Etappen mit der aktuellen fett
  await expect(w.locator('#warnung-ok')).toHaveClass(/gross/);
  await expect(w.locator('#warnung-ruhig')).toHaveClass(/gross/);
  await expect(w.locator('#warnung-ruhig')).toHaveText(TEXT.warnungRuhig);
  await expect(w.locator('#etappen li')).toHaveText([TEXT.etappen.warnung, TEXT.etappen.alter, TEXT.etappen.einwilligung, TEXT.etappen.interview]);
  await expect(w.locator('#etappen li[aria-current="step"]')).toHaveText(TEXT.etappen.warnung);
  expect(await w.locator('#etappen li[aria-current="step"]').evaluate((e) => Number(getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(700);
  expect(((await einst(v)) as any).ruhig ?? false).toBe(false);
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.schrittVon(1, 7)); // ohne Pack: 3 Gate-Schritte + 4 Fragen
  await w.locator('#warnung-ruhig').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'alter');
  await expect.poll(async () => (await einst(v)).ruhig).toBe(true);
  expect((await lies(v, 'einstieg')).warnung).toBe(true);
  expect(await lies(v, 'quizWarnungGesehen')).toBe(true);
  await expect(w.locator('#etappen li[aria-current="step"]')).toHaveText(TEXT.etappen.alter);
  await w.locator('#alter-ja').click();
  await expect(w.locator('#etappen li[aria-current="step"]')).toHaveText(TEXT.etappen.einwilligung);
  await w.locator('#einwilligung-ok').click();
  // vier Fragen
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, 4));
  await expect(w.locator('.iv-schritte li')).toHaveText(TEXT.schritteNamen.slice(0, 4));
  await expect(w.locator('#etappen li[aria-current="step"]')).toHaveText(TEXT.etappen.interview);
  await expect(w.locator('#iv-ueberspringen')).toBeVisible();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(2, 4));
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(3, 4));
  // Calm mode steht auf der Stil-Seite (Seite 3) und ist schon an (Warnseite), ausschalten wird gespeichert
  await expect(w.locator('#iv-ruhig')).toBeChecked();
  await schalter(w, '#iv-ruhig');
  await expect.poll(async () => (await einst(v)).ruhig).toBe(false);
  await schalter(w, '#iv-ruhig');
  await expect.poll(async () => (await einst(v)).ruhig).toBe(true);
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(4, 4));
  await expect(w.locator('#iv-weiter')).toHaveText(TEXT.fertig);
  await expect(w.locator('#iv-ueberspringen')).toHaveCount(0);
  await w.locator('#iv-weiter').click();
  await expect.poll(async () => (await lies(v, 'einstieg')).interview).toBe('fertig');
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  messzahl += 8;
  // Wer mit Pack kommt, bekommt alle sechs Fragen und Calm mode erst auf Seite 6; "I understand" laesst Calm mode aus
  await entferne(v, ['einstellungen']);
  await schreibe(v, { pack: PACK_KURZ });
  const w2 = await oeffneNeu(v);
  await w2.locator('#warnung-ok').click();
  await expect(w2.locator('#schritt')).toHaveAttribute('data-schritt', 'alter');
  expect(((await einst(v)) as any).ruhig ?? false).toBe(false);
  await w2.locator('#alter-ja').click();
  await w2.locator('#einwilligung-ok').click();
  await expect(w2.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, 6));
  await w2.locator('#iv-weiter').click();
  await w2.locator('#iv-weiter').click();
  await expect(w2.locator('#iv-ruhig')).toHaveCount(0);
  messzahl += 3;
  await entferne(v, ['pack']);
  for (const p of context.pages()) if (p !== v) await p.close();
  await v.close();
});

test('Fund 3: Abschluss zeigt Anheften, Pause mit Kuerzel und Ausprobieren, Hilfe-Link und Pack-Knopf', async () => {
  const v = await verwaltung();
  await schreibe(v, FERTIG);
  await entferne(v, ['pack']);
  const w = mitReitern(await context.newPage());
  await w.goto(url('willkommen.html'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
  await expect(w.locator('#ende-liste li')).toHaveCount(3);
  await expect(w.locator('#ende-pin')).toContainText(TEXT.endePinTitel);
  await expect(w.locator('#ende-pin')).toContainText(TEXT.endePinChrome); // Chromium: Puzzle-Teil neben der Adressleiste
  await expect(w.locator('#ende-pin-link')).toHaveAttribute('href', 'hilfe.html#pin');
  await expect(w.locator('#ende-pin-link')).toHaveAttribute('target', '_blank');
  await expect(w.locator('#ende-pin-link')).toHaveAttribute('rel', 'noopener');
  await expect(w.locator('#ende-pause')).toContainText(TEXT.endePauseTitel);
  // Das Kuerzel kommt aus browser.commands (in Chromium im Testbau gesetzt); steht keines da, bleibt das Popup
  const kuerzel = await w.evaluate(async () => {
    const alle = await (globalThis as any).chrome.commands.getAll();
    return (alle.find((c: any) => c.name === 'pause-umschalten')?.shortcut as string | undefined) ?? '';
  });
  await expect(w.locator('#ende-pause')).toContainText(kuerzel ? TEXT.endePauseKuerzel(kuerzel) : TEXT.endePauseNurPopup);
  await expect(w.locator('#ende-versuch')).toContainText(TEXT.endeVersuch);
  await expect(w.locator('#ende-hilfe')).toHaveText(TEXT.endeHilfe);
  await expect(w.locator('#ende-hilfe')).toHaveAttribute('href', 'hilfe.html');
  await expect(w.locator('#ende-pack')).toHaveText('Get the Mia Pack');
  messzahl += 9;
  await w.close();
  await v.close();
});

test('Fund 20: bei 360 px ist Mias Bild ein Band von hoechstens 160 px, "I agree" liegt hoch', async () => {
  const v = await verwaltung();
  await entferne(v, ['pack']);
  await sende(v, { zuruecksetzen: true });
  await schreibe(v, { einstieg: { version: 1, warnung: true, alter: true, einwilligung: false, interview: 'offen', zeit: null } });
  const w = mitReitern(await context.newPage());
  await w.setViewportSize({ width: 360, height: 700 });
  await w.goto(url('willkommen.html'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'einwilligung');
  // Das Bild ist im Testbau da, wenn Kern-Bilder gebaut sind; ohne sie bleibt der Platz weg und nichts ist zu messen.
  const bild = w.locator('#kern-bild');
  const da = await bild.isVisible().catch(() => false);
  if (da) {
    const h = await w.locator('#kern-bild img').evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeLessThanOrEqual(160);
    messzahl++;
  }
  const y = await w.locator('#einwilligung-ok').evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
  expect(y).toBeLessThan(900);
  messzahl++;
  await w.close();
  await v.close();
});
