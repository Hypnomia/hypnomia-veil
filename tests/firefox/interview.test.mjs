// Firefox: Interview aus den Bausteinen (Phase 11 E4e, I1 bis I11, I5a, I8, I8a) ueber die echte Seite und den echten Speicher.
// I8 (1) und (2): Next und Finish, Skip the rest und Schliessen aendern keinen Wert (erster Start und vier Staende, ohne und mit Pack); jede Frage: waehlen, Speicher lesen, neu laden.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT } from '../../src/einstieg/texte.ts';
import { STANDARD } from '../../src/einstellungen.ts';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';
import { mitReitern, oeffneReiter, oeffneReiterFuer } from './reiter-hilfe.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 240 s ueberschritten');
  process.exit(1);
}, 240_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const GECKO_ID = 'veil@hypnomia';

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}

// Erweiterung als temporaeres Add-on installieren, ueber den Pfad (nicht Base64 wie driver.installAddon): geckodriver 0.37 mit Firefox 128
// lehnt die Base64-Form ab (InvalidArgumentError), der Pfad geht in 128 und in neueren Versionen.
async function installiere(treiber, paketPfad) {
  await treiber.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let rot = 0;
function pruefe(bedingung, text) {
  if (bedingung) ok++;
  else {
    rot++;
    console.error(`firefox: ROT  ${text}`);
  }
}

let driver;
const uuid = randomUUID();

async function oeffne(seite) {
  const vorher = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow('navigator:browser');
       w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/${seite}`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error(`Erweiterungsseite ${seite} nicht geoeffnet`);
  await driver.switchTo().window(neu);
  return neu;
}

async function imSeitenkontext(code, ...args) {
  const text = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
     const args = JSON.parse(arguments[0]);
     const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
     Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
    JSON.stringify(args),
  );
  return JSON.parse(text);
}

const speicher = (schluessel) => imSeitenkontext(`const a = await api.storage.local.get(args[0]); return a[args[0]] ?? null;`, schluessel);

async function bis(beschreibung, fn, frist = 15_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

const eigenschaft = (css, name) => driver.executeScript(`return document.querySelector(arguments[0])[arguments[1]]`, css, name);
const text = async (css) => (await driver.executeScript(`return document.querySelector(arguments[0]).textContent.trim()`, css));
const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const waehle = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, wert);
// Session 18: null-sicher, die Seite kann beim Abfragen noch laden (Gesamtlauf unter Last).
const schritt = () => driver.executeScript(`return document.querySelector('#schritt')?.dataset.schritt ?? null`);
const einst = async () => (await speicher('einstellungen')) ?? {};
const einstieg = () => speicher('einstieg');
const sende = (n) => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, { ziel: 'hintergrund', typ: 'einstieg-test', ...n });
const imStand = async (h, fn) => {
  await driver.switchTo().window(h);
  return fn();
};
const bisSchritt = (soll) => bis(`Schritt ${soll}`, async () => (await schritt()) === soll);
// Bausteine (E4e): Karten einer Wahlgruppe ueber data-id, Stufen der Stimmung ueber ihren Namen, Schalter sind Knoepfe mit aria-checked.
const kartenKlick = (gruppe, kartenId) => klick(`#${gruppe} [data-id="${kartenId}"]`);
const gewaehlt = (gruppe, kartenId) => driver.executeScript(`return document.querySelector(arguments[0]).getAttribute('aria-checked')`, `#${gruppe} [data-id="${kartenId}"]`).then((a) => a === 'true');
const schalterAn = (css) => driver.executeScript(`return document.querySelector(arguments[0]).getAttribute('aria-checked') === 'true'`, css);
const stufeKlick = (name) => driver.executeScript(`[...document.querySelectorAll('#iv-stimmung-wahl .v-stufe')].find((b) => b.textContent === arguments[0]).click()`, name);
const stufeGewaehlt = (name) => driver.executeScript(`const b = [...document.querySelectorAll('#iv-stimmung-wahl .v-stufe')].find((b) => b.textContent === arguments[0]); return b.getAttribute('aria-checked') === 'true'`, name);
const exaktOeffnen = () => klick('#iv-stimmung-wahl .v-auf-kopf');
const exaktSetzen = (wert) => setzeRange('#iv-stimmung-wahl input[type=range]', wert);
let messzahl = 0;


const FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 };
const PACK_OHNE = { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 };
const PACK_VOLL = { ...PACK_OHNE, freischaltungen: ['stil:mia-patch', 'zensur:sticker', 'erwachsen:vorschau'], sticker: 1 };
const PACK_OHNE_ERW = { ...PACK_OHNE, freischaltungen: ['stil:mia-patch', 'zensur:sticker'], sticker: 1 };
const zonenSet = (an, bedeckt) => Object.fromEntries(Object.keys(STANDARD.zonen).map((z) => [z, ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'].includes(z) ? { an, bedeckt } : { an }]));
const STAENDE = {
  'erster Start': undefined,
  'alle Zonen an und alles unter Kleidung': { version: 1, zonen: zonenSet(true, true) },
  'Zwischenwert der Schwelle mit Strict': { version: 1, schwelle: 0.1049, strict: true },
  'Eye bar mit Pack-Stil': { version: 1, augenbalken: true, preset: 'mia-wort' },
  'ungewohnte Werte, auch nicht gefragte': {
    version: 1,
    ruhig: true,
    preset: 'blur',
    erwachsen: { an: false, stufe: 'explicit', komplettErsatz: true, erkennenAmInhalt: false, eigeneSeiten: ['a.example'] },
    quiz: { verweigern: 0.3, freilegenMs: 7000 },
    kontrolle: { blitz: 'oft', leerlauf: false, cursor: 'aus' },
    ton: { an: true, lautstaerke: 0.45 },
  },
};
const kartenAttr = (gruppe, kartenId, name) => driver.executeScript(`return document.querySelector(arguments[0]).getAttribute(arguments[1])`, `#${gruppe} [data-id="${kartenId}"]`, name);
const anzahl = (css) => driver.executeScript(`return document.querySelectorAll(arguments[0]).length`, css);
const ids = (gruppe) => driver.executeScript(`return [...document.querySelectorAll('#' + arguments[0] + ' [role=radio]')].map((b) => b.dataset.id).join(',')`, gruppe);
const gesperrt = (gruppe) => driver.executeScript(`return [...document.querySelectorAll('#' + arguments[0] + ' [role=radio]')].filter((b) => b.disabled).map((b) => b.dataset.id).join(',')`, gruppe);
// Liest den rohen Speicher und kehrt zum Fenster zurueck, in dem der Aufruf begann.
const roh = async (v) => {
  const zurueck = await driver.getWindowHandle();
  const r = JSON.stringify(await imStand(v, () => speicher('einstellungen')));
  await driver.switchTo().window(zurueck);
  return r;
};
const schreibeSpeicher = (obj) => imSeitenkontext(`await api.storage.local.set(args[0]);`, obj);
const entferneSpeicher = (...k) => imSeitenkontext(`await api.storage.local.remove(args[0]);`, k);
const schliesseAlleAusser = async (v) => {
  for (const h of await driver.getAllWindowHandles()) {
    if (h === v) continue;
    await driver.switchTo().window(h);
    await driver.close();
  }
  await driver.switchTo().window(v);
};
// Oeffnet das Interview (Wiederholung) mit gesetztem Stand.
async function interview(v, stand, pack) {
  await driver.switchTo().window(v);
  await schreibeSpeicher({ einstieg: FERTIG });
  await entferneSpeicher('einstellungen', 'pack');
  if (stand !== undefined) await schreibeSpeicher({ einstellungen: stand });
  if (pack) await schreibeSpeicher({ pack });
  const h = await oeffne('willkommen.html#interview');
  await bisSchritt('interview-1');
  return h;
}
// Zaehlt die Aufrufe von `storage.local.set` in der offenen Seite (auch einen Aufruf mit unveraendertem Wert).
const zaehleSetAufrufe = () => driver.executeScript(`const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; const echt = a.storage.local.set.bind(a.storage.local); window.__setAufrufe = 0; a.storage.local.set = (...x) => { window.__setAufrufe++; return echt(...x); };`);
const bisSeite = async (n) => {
  for (let i = 1; i < n; i++) {
    await klick('#iv-weiter');
    await bisSchritt(`interview-${i + 1}`);
  }
};

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  mitReitern(driver);
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);
  const v = await oeffne('options.html');
  await bis('Einstieg erledigt', async () => (await einstieg())?.interview === 'uebersprungen');

  // ---- I8 (1) und (2): Next und Finish, Skip the rest und Schliessen aendern keinen Wert ----
  // Zaehler fuer Schreibereignisse auf `einstellungen` in der Verwaltungsseite (sessionStorage, weil Werte auf `window` aus dem Sandkasten nicht sichtbar sind).
  await imStand(v, () => imSeitenkontext(`sessionStorage.setItem('schreib', '0'); if (!window.__horcher) { window.__horcher = true; api.storage.onChanged.addListener((c) => { if (c.einstellungen) sessionStorage.setItem('schreib', String(Number(sessionStorage.getItem('schreib') || 0) + 1)); }); }`));
  const nullen = async () => {
    const zurueck = await driver.getWindowHandle();
    await imStand(v, () => imSeitenkontext(`sessionStorage.setItem('schreib', '0');`));
    await driver.switchTo().window(zurueck);
  };
  const zaehlerLesen = async () => {
    const zurueck = await driver.getWindowHandle();
    const z = await imStand(v, () => imSeitenkontext(`return Number(sessionStorage.getItem('schreib') || 0);`));
    await driver.switchTo().window(zurueck);
    return z;
  };
  for (const [name, stand] of Object.entries(STAENDE)) {
    for (const [mit, pack] of [['ohne Pack', null], ['mit Pack', PACK_VOLL]]) {
      const erwartet = pack ? 6 : 4;
      await interview(v, stand, pack);
      await warte(500);
      await nullen();
      const vorher = await roh(v);
      pruefe((await anzahl('.iv-schritte li')) === erwartet, `${name}, ${mit}: ${erwartet} Seiten`);
      pruefe((await text('#fortschritt-text')) === TEXT.frageVon(1, erwartet), `${name}, ${mit}: Question 1 of ${erwartet}`);
      for (let i = 1; i < erwartet; i++) {
        pruefe((await text('#iv-weiter')) === TEXT.weiter, `${name}, ${mit}: Seite ${i} Next`);
        await klick('#iv-weiter');
        await bisSchritt(`interview-${i + 1}`);
      }
      pruefe((await text('#iv-weiter')) === TEXT.fertig, `${name}, ${mit}: letzte Seite Finish`);
      await klick('#iv-weiter');
      await bisSchritt('ende');
      await bis('interview fertig', async () => (await einstieg()).interview === 'fertig');
      pruefe((await roh(v)) === vorher, `I8 (1): Next und Finish aendern keinen Wert (${name}, ${mit})`);
      const z1 = await zaehlerLesen();
      pruefe(z1 === 0, `I8 (1): kein Schreibereignis auf die Einstellungen (${name}, ${mit}), Zaehler ${z1}`);
      await schliesseAlleAusser(v);
      // Skip the rest
      await interview(v, stand, pack);
      await warte(500);
      await nullen();
      await zaehleSetAufrufe();
      await klick('#iv-weiter');
      await bisSchritt('interview-2');
      await klick('#iv-ueberspringen');
      await bisSchritt('ende');
      await bis('interview uebersprungen', async () => (await einstieg()).interview === 'uebersprungen' || (await einstieg()).interview === 'fertig');
      const n1 = await driver.executeScript('return window.__setAufrufe');
      pruefe(n1 === 1, `H3: Skip the rest ruft `+'`set`'+` genau einmal (Einstieg), nicht fuer die Einstellungen (${name}, ${mit}), Aufrufe ${n1}`);
      pruefe((await roh(v)) === vorher, `I8 (2): Skip the rest aendert keinen Wert (${name}, ${mit})`);
      const z3 = await zaehlerLesen(); // H3: auch ein Schreiben des unveraenderten Wertes waere ein Ereignis nur bei Aenderung; hier zaehlt der Aufruf in der Seite unten
      pruefe(z3 === 0, `I8 (2): kein Schreibereignis bei Skip the rest (${name}, ${mit}), Zaehler ${z3}`);
      await schliesseAlleAusser(v);
      // Schliessen mitten im Interview
      await interview(v, stand, pack);
      await warte(500);
      await nullen();
      await zaehleSetAufrufe();
      await klick('#iv-weiter');
      await klick('#iv-weiter');
      const n2 = await driver.executeScript('return window.__setAufrufe');
      pruefe(n2 === 0, `H3: bis zum Schliessen kein `+'`set`'+` (${name}, ${mit}), Aufrufe ${n2}`);
      await driver.close();
      await driver.switchTo().window(v);
      pruefe((await roh(v)) === vorher, `I8 (2): Schliessen aendert keinen Wert (${name}, ${mit})`);
      const z2 = await zaehlerLesen();
      pruefe(z2 === 0, `I8 (2): kein Schreibereignis bei Skip und Schliessen (${name}, ${mit}), Zaehler ${z2}`);
      await schliesseAlleAusser(v);
      messzahl += 7;
    }
  }

  // ---- Jede Frage: waehlen, Speicher lesen, neu laden, Anzeige stimmt; I7 ----
  {
    const h = await interview(v, STAENDE['ungewohnte Werte, auch nicht gefragte'], PACK_VOLL);
    const rest = (e) => JSON.stringify([e.erwachsen.komplettErsatz, e.erwachsen.erkennenAmInhalt, e.erwachsen.eigeneSeiten, e.quiz, e.kontrolle.leerlauf, e.kontrolle.cursor, e.ton]);
    const rest0 = rest(await einst());
    const neuLaden = async (schritt) => {
      await driver.navigate().refresh();
      await bisSchritt(schritt);
    };
    await kartenKlick('iv-zonen-wahl', 'alles');
    await bis('alle Zonen', async () => Object.values((await einst()).zonen).every((z) => z.an));
    await neuLaden('interview-1');
    pruefe(await gewaehlt('iv-zonen-wahl', 'alles'), 'Zones: nach dem Neuladen steht Everything da');
    await klick('#iv-weiter');
    await kartenKlick('iv-kleidung-frage', 'haut');
    await bis('Bare skin only', async () => (await einst()).zonen.feet.bedeckt === false && (await einst()).zonen.breast.bedeckt === false);
    await neuLaden('interview-2');
    pruefe(await gewaehlt('iv-kleidung-frage', 'haut'), 'Clothes: nach dem Neuladen steht Bare skin only da');
    await klick('#iv-weiter');
    await bisSchritt('interview-3');
    await klick('#iv-preset-mosaik');
    await bis('mosaik', async () => (await einst()).preset === 'mosaik');
    await klick('#iv-augenbalken');
    await bis('Eye bar', async () => (await einst()).augenbalken === true);
    await neuLaden('interview-3');
    pruefe((await eigenschaft('#iv-preset-mosaik', 'checked')) === true && (await schalterAn('#iv-augenbalken')) === true, 'Style: nach dem Neuladen stehen Mosaic und Eye bar da');
    await klick('#iv-weiter');
    await bisSchritt('interview-4');
    await stufeKlick(stimmungsWort(0.15));
    await bis('schwelle', async () => (await einst()).schwelle === 0.15);
    await klick('#iv-strict');
    await bis('strict', async () => (await einst()).strict === true);
    await neuLaden('interview-4');
    pruefe((await stufeGewaehlt(stimmungsWort(0.15))) && (await schalterAn('#iv-strict')), 'Mood: nach dem Neuladen stehen Stufe und Strict da');
    await klick('#iv-weiter');
    await bisSchritt('interview-5');
    pruefe((await ids('iv-erw-wahl')) === 'off,tease,hot,explicit', 'Adult sites mit Freischaltung: Off, Tease, Hot, Explicit');
    await kartenKlick('iv-erw-wahl', 'tease');
    await bis('tease', async () => (await einst()).erwachsen.stufe === 'tease' && (await einst()).erwachsen.an === true);
    await neuLaden('interview-5');
    pruefe(await gewaehlt('iv-erw-wahl', 'tease'), 'Adult sites: nach dem Neuladen steht Tease da');
    await klick('#iv-weiter');
    await bisSchritt('interview-6');
    await klick('#iv-ruhig');
    await bis('ruhig aus', async () => (await einst()).ruhig === false);
    await waehle('#iv-blitz', 'selten');
    await bis('blitz', async () => (await einst()).kontrolle.blitz === 'selten');
    await neuLaden('interview-6');
    pruefe((await schalterAn('#iv-ruhig')) === false && (await eigenschaft('#iv-blitz', 'value')) === 'selten', 'Extras: nach dem Neuladen stehen Calm mode und Flash words da');
    pruefe(rest(await einst()) === rest0, 'I7: nicht gefragte Werte (Komplett-Ersatz, Verweigern, Leerlauf, Zeiger, Ton) bleiben unveraendert');
    messzahl += 14;
    await schliesseAlleAusser(v);
  }

  // ---- I5a: beide Formen der Gruppe der Erwachsenenseiten ----
  {
    let h = await interview(v, { version: 1, erwachsen: { an: true, stufe: 'explicit' } }, PACK_VOLL);
    await bisSeite(5);
    pruefe((await ids('iv-erw-wahl')) === 'off,tease,hot,explicit' && (await gesperrt('iv-erw-wahl')) === '', 'I5a mit Freischaltung: vier Karten, keine gesperrt');
    pruefe(await gewaehlt('iv-erw-wahl', 'explicit'), 'I5a: gespeicherte Stufe markiert');
    await kartenKlick('iv-erw-wahl', 'off');
    await bis('Off', async () => (await einst()).erwachsen.an === false);
    pruefe((await einst()).erwachsen.stufe === 'explicit', 'I5a: Off laesst die Stufe stehen');
    await kartenKlick('iv-erw-wahl', 'hot');
    await bis('Hot', async () => (await einst()).erwachsen.stufe === 'hot' && (await einst()).erwachsen.an === true);
    await schliesseAlleAusser(v);
    for (const [pack, name] of [[PACK_OHNE_ERW, 'Pack ohne Freischaltung'], [PACK_OHNE, 'Pack ohne alle Freischaltungen']]) {
      h = await interview(v, { version: 1, erwachsen: { an: false, stufe: 'explicit' } }, pack);
      await bisSeite(5);
      pruefe((await ids('iv-erw-wahl')) === 'off,on,tease,hot,explicit', `I5a ${name}: Off, On und drei Stufen`);
      pruefe((await gesperrt('iv-erw-wahl')) === 'tease,hot,explicit', `I5a ${name}: die drei Stufen gesperrt`);
      pruefe(!(await gewaehlt('iv-erw-wahl', 'explicit')) && !(await gewaehlt('iv-erw-wahl', 'hot')) && !(await gewaehlt('iv-erw-wahl', 'tease')), `I5a ${name}: keine Stufe markiert`);
      pruefe(await gewaehlt('iv-erw-wahl', 'off'), `I5a ${name}: Off markiert bei an: false`);
      const vor = await roh(v);
      await klick('#iv-erw-wahl [data-id="hot"]'); // gesperrt: der Klick auf einen deaktivierten Knopf tut nichts
      await driver.executeScript(`const b = document.querySelector('#iv-erw-wahl [data-id="hot"]'); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
      await warte(400);
      pruefe((await roh(v)) === vor, `I5a ${name}: Klick und Eingabe auf eine gesperrte Stufe schreiben nichts`);
      await kartenKlick('iv-erw-wahl', 'on');
      await bis('On', async () => (await einst()).erwachsen.an === true);
      pruefe((await einst()).erwachsen.stufe === 'explicit', `I5a ${name}: On laesst die Stufe stehen`);
      await kartenKlick('iv-erw-wahl', 'off');
      await bis('Off', async () => (await einst()).erwachsen.an === false);
      pruefe((await einst()).erwachsen.stufe === 'explicit', `I5a ${name}: Off laesst die Stufe stehen`);
      await schliesseAlleAusser(v);
    }
    h = await interview(v, { version: 1, erwachsen: { an: true, stufe: 'hot', komplettErsatz: true } }, PACK_VOLL);
    await bisSeite(5);
    pruefe((await text('#iv-ersatz-an')) === TEXT.ersatzAn, 'I8 (5): der Warnsatz zu Komplett-Ersatz bleibt sichtbar, solange er gespeichert an ist');
    await schliesseAlleAusser(v);
    void h;
    messzahl += 20;
  }

  // ---- Tastatur: ein Pfeil waehlt nicht ----
  {
    await interview(v, undefined, null);
    await driver.executeScript(`document.querySelector('#iv-zonen-wahl [data-id="koerper"]').focus()`);
    const taste = async (k) => driver.actions({ async: true }).sendKeys(k).perform();
    for (const k of [Key.ARROW_RIGHT, Key.ARROW_RIGHT, Key.END, Key.ARROW_LEFT, Key.HOME, Key.ARROW_DOWN, Key.ARROW_UP, Key.ARROW_RIGHT]) await taste(k);
    await warte(300);
    pruefe((await driver.executeScript(`return document.activeElement.dataset.id`)) === 'koerper-gesicht', 'Tastatur: der Pfeil bewegt den Fokus');
    pruefe((await imStand(v, () => speicher('einstellungen'))) === null, 'Tastatur: Pfeile, Pos1 und Ende schreiben nichts');
    await driver.switchTo().window((await driver.getAllWindowHandles()).at(-1));
    await taste(Key.SPACE);
    await bis('Leertaste waehlt', async () => (await einst()).zonen?.face?.an === true);
    await taste(Key.ARROW_RIGHT);
    await taste(Key.ENTER);
    await bis('Eingabe waehlt', async () => Object.values((await einst()).zonen).every((z) => z.an));
    messzahl += 4;
    await schliesseAlleAusser(v);
  }

  // ---- Speicherfehler und verworfene Handlung (I8 (4), I8a) ----
  {
    await interview(v, undefined, null);
    await driver.executeScript(`const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; window.__echtSet = a.storage.local.set.bind(a.storage.local); window.__setAufrufe = 0; a.storage.local.set = () => { window.__setAufrufe++; return Promise.reject(new Error('voll')); };`);
    await kartenKlick('iv-zonen-wahl', 'alles');
    await bis('Fehlersatz', async () => (await text('#fehler')) === FEHLER_SPEICHERN);
    pruefe(await gewaehlt('iv-zonen-wahl', 'koerper'), 'I8 (4): nach dem Speicherfehler zeigt Zones den gespeicherten Stand');
    pruefe((await driver.executeScript('return window.__setAufrufe')) === 1, 'ein gescheiterter Schreibaufruf');
    // verworfen: Stand aendert sich von aussen, im selben Augenblick klickt die Person
    await driver.executeScript(`window.__echtSet({ einstellungen: arguments[0] }); document.querySelector('#iv-zonen-wahl [data-id="koerper-gesicht"]').click();`, { version: 1, zonen: zonenSet(true, true) });
    await bis('Hinweis verworfen', () => sichtbar('#iv-zonen-verworfen'));
    pruefe((await text('#iv-zonen-verworfen')) === TEXT.zonenVerworfen, 'I8a: der Hinweis zur verworfenen Handlung steht da');
    pruefe((await driver.executeScript('return window.__setAufrufe')) === 1, 'I8a: die verworfene Handlung ruft `set` nicht');
    pruefe(Object.values((await einst()).zonen).every((z) => z.an), 'I8a: gespeichert ist der Stand von aussen, kein zweiter Versuch');
    await bis('gespeicherter Stand angezeigt', async () => await gewaehlt('iv-zonen-wahl', 'alles'));
    pruefe((await text('#fehler')) === FEHLER_SPEICHERN && (await sichtbar('#fehler')), 'I8a: der stehende Fehlersatz verschwindet nicht');
    messzahl += 6;
    await schliesseAlleAusser(v);
  }

  // ---- H1: Regler "Exact value" mit Fokus, Speichern scheitert ----
  for (const [richtung, gespeichert, taste] of [['zu weniger Deckung', 0.1, Key.ARROW_RIGHT], ['zu mehr Deckung', 0.22, Key.ARROW_LEFT]]) {
    await interview(v, { version: 1, schwelle: gespeichert }, null);
    await bisSeite(4);
    await exaktOeffnen();
    await driver.executeScript(`const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; a.storage.local.set = () => Promise.reject(new Error('voll')); document.querySelector('#iv-stimmung-wahl input[type=range]').focus();`);
    // Ein Tastendruck: Firefox 160 feuert `change` nicht, wenn der Schritt auf den Wert des letzten `change` zurueckfuehrt (gemessen: nach dem Zuruecksetzen zeigt der zweite Druck den verstellten Wert ohne Schreibversuch, siehe Bericht E4e H1).
    await driver.actions({ async: true }).sendKeys(taste).perform();
    await bis('Fehlersatz', async () => (await text('#fehler')) === FEHLER_SPEICHERN);
    const messen = () => driver.executeScript(`const r = document.querySelector('#iv-stimmung-wahl input[type=range]'); return { fokus: document.activeElement === r, wert: r.value, zahl: document.querySelector('#iv-stimmung-wahl .v-wert').textContent };`);
    let z = await messen();
    // das Zuruecksetzen laeuft nach dem Fehlersatz asynchron (Neulesen), darum bis zu 3 s warten; ohne den erzwungenen Neuaufbau bleibt es bei dem verstellten Wert
    for (let i = 0; i < 30 && !(Number(z.wert) === gespeichert && z.zahl === String(gespeichert)); i++) {
      await warte(100);
      z = await messen();
    }
    pruefe(z.fokus && Number(z.wert) === gespeichert && z.zahl === String(gespeichert), `H1 (${richtung}): Regler ${z.wert}, Zahl ${z.zahl}, Fokus ${z.fokus}, gespeichert ${gespeichert}`);
    pruefe(await stufeGewaehlt(stimmungsWort(gespeichert)), `H1 (${richtung}): die Stufe des gespeicherten Stands ist markiert`);
    messzahl += 2;
    await schliesseAlleAusser(v);
  }

  // ---- K1 (E4k): Mood-Regler in Firefox: nach einem gescheiterten Speichern und dem Zuruecksetzen meldet Firefox kein `change` fuer dieselbe Taste ----
  {
    await interview(v, { version: 1, schwelle: 0.15 }, null);
    await bisSeite(4);
    await exaktOeffnen();
    await driver.executeScript(`const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; window.__echtSet = a.storage.local.set.bind(a.storage.local); window.__k1 = 0; window.__k1kaputt = true; a.storage.local.set = (o) => { if ('einstellungen' in o) window.__k1++; return window.__k1kaputt && 'einstellungen' in o ? Promise.reject(new Error('voll')) : window.__echtSet(o); }; document.querySelector('#iv-stimmung-wahl input[type=range]').focus();`);
    const messen = () => driver.executeScript(`const r = document.querySelector('#iv-stimmung-wahl input[type=range]'); return { fokus: document.activeElement === r, wert: Number(r.value), zahl: document.querySelector('#iv-stimmung-wahl .v-wert').textContent };`);
    const versuche = () => driver.executeScript('return window.__k1');
    for (const [taste, name] of [[Key.ARROW_LEFT, 'links'], [Key.ARROW_RIGHT, 'rechts']]) {
      for (let i = 1; i <= 2; i++) {
        await driver.executeScript(`const f = document.getElementById('fehler'); f.textContent = ''; f.hidden = true;`);
        const n0 = await versuche();
        await driver.actions({ async: true }).sendKeys(taste).perform();
        await bis(`K1 ${name} ${i}: Fehlersatz`, async () => (await text('#fehler')) === FEHLER_SPEICHERN);
        await bis(`K1 ${name} ${i}: gespeicherter Stand`, async () => { const z = await messen(); return z.wert === 0.15 && z.zahl === '0.15'; });
        pruefe((await versuche()) === n0 + 1, `K1 Taste ${name} ${i}: genau ein Schreibversuch (waren ${(await versuche()) - n0})`);
        pruefe(await stufeGewaehlt(stimmungsWort(0.15)), `K1 Taste ${name} ${i}: die Stufe des gespeicherten Stands ist markiert`);
        messzahl += 2;
      }
    }
    pruefe(((await einst()).schwelle) === 0.15, 'K1: nach den gescheiterten Versuchen steht der gespeicherte Stand im Speicher');
    await driver.executeScript('window.__k1kaputt = false');
    const n1 = await versuche();
    await driver.actions({ async: true }).sendKeys(Key.ARROW_LEFT).perform();
    await bis('K1: gelungen gespeichert', async () => Math.abs((await einst()).schwelle - 0.14) < 1e-9);
    await warte(300);
    const z = await messen();
    pruefe(z.wert === 0.14 && z.zahl === '0.14' && (await versuche()) === n1 + 1, `K1: gelungen, Anzeige gleich Speicher, ein Schreibversuch (${JSON.stringify(z)}, Versuche ${(await versuche()) - n1})`);
    messzahl += 2;
    await schliesseAlleAusser(v);
  }

  // ---- L1 (E4k Nachr.): Mood mit gespeichertem Zwischenwert: kein Schreibversuch ohne Handlung ----
  {
    await interview(v, { version: 1, schwelle: 0.1051 }, null);
    await bisSeite(4);
    await driver.executeScript(`const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; window.__echtSet = a.storage.local.set.bind(a.storage.local); window.__k1 = 0; a.storage.local.set = (o) => { window.__k1++; return window.__echtSet(o); };`);
    const roh = JSON.stringify(await speicher('einstellungen'));
    const reg = await driver.findElement(By.css('#iv-stimmung-wahl input[type=range]'));
    await driver.executeScript('arguments[0].focus()', reg);
    for (const t of [Key.SHIFT, Key.CONTROL, 'a', Key.ESCAPE]) await reg.sendKeys(t);
    const pos = await driver.executeScript(`const r = arguments[0]; r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); const a = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)); return [b.left + 8 + (b.width - 16) * a, b.top + b.height / 2];`, reg);
    await driver.actions({ async: true }).move({ x: Math.round(pos[0]), y: Math.round(pos[1]) }).press().release().perform();
    await driver.actions({ async: true }).sendKeys(Key.TAB).perform();
    await driver.executeScript('arguments[0].focus()', reg);
    await driver.actions({ async: true }).sendKeys(Key.chord(Key.SHIFT, Key.TAB)).perform();
    await driver.executeScript('arguments[0].blur()', reg);
    await warte(500);
    pruefe((await driver.executeScript('return window.__k1')) === 0, 'L1: null Schreibaufrufe ohne Handlung im Interview');
    pruefe(JSON.stringify(await speicher('einstellungen')) === roh, 'L1: der gespeicherte Wert bleibt Bit fuer Bit');
    messzahl += 2;
    await schliesseAlleAusser(v);
  }

  // ---- N9: ein Pfeil waehlt nicht, auch nicht in der Kleidungsfrage und der Gruppe der Erwachsenenseiten ----
  for (const [seite, gruppe, name] of [[2, 'iv-kleidung-frage', 'Kleidungsfrage'], [5, 'iv-erw-wahl', 'Gruppe der Erwachsenenseiten']]) {
    await interview(v, { version: 1, erwachsen: { an: true, stufe: 'hot' } }, PACK_VOLL);
    await bisSeite(seite);
    const vorher = await roh(v);
    const markiertIdx = () => driver.executeScript(`return [...document.querySelectorAll('#' + arguments[0] + ' [role=radio]')].findIndex((b) => b.getAttribute('aria-checked') === 'true')`, gruppe);
    const m0 = await markiertIdx();
    await driver.executeScript(`document.querySelector('#' + arguments[0] + ' [role=radio]').focus()`, gruppe);
    for (const k of [Key.ARROW_RIGHT, Key.ARROW_DOWN, Key.END, Key.ARROW_LEFT, Key.HOME, Key.ARROW_DOWN, Key.ARROW_UP, Key.ARROW_RIGHT]) await driver.actions({ async: true }).sendKeys(k).perform();
    await warte(300);
    pruefe((await roh(v)) === vorher, `N9 ${name}: Pfeile schreiben nichts`);
    pruefe((await markiertIdx()) === m0, `N9 ${name}: die Markierung bleibt`);
    await driver.actions({ async: true }).sendKeys(Key.SPACE).perform();
    await bis(`${name}: Leertaste waehlt`, async () => (await roh(v)) !== vorher);
    messzahl += 3;
    await schliesseAlleAusser(v);
  }

  // ---- Namen der Stimmung wie auf der Einstellungsseite ----
  {
    await interview(v, undefined, null);
    await bisSeite(4);
    const imInterview = await driver.executeScript(`return [...document.querySelectorAll('#iv-stimmung-wahl .v-stufe')].map((b) => b.textContent).join('|')`);
    await oeffne('options.html');
    await bis('Stimmung der Einstellungsseite', async () => (await anzahl('#stimmung-wahl .v-stufe')) === 3);
    const aufEinstellungen = await driver.executeScript(`return [...document.querySelectorAll('#stimmung-wahl .v-stufe')].map((b) => b.textContent).join('|')`);
    pruefe(imInterview === aufEinstellungen && imInterview.split('|').length === 3, `I4: gleiche Namen (${imInterview})`);
    // H4 (N5): auch die Werte: jede Stufe schreibt auf beiden Seiten denselben Wert
    const werteEinstellungen = [];
    for (const n of aufEinstellungen.split('|')) {
      await driver.executeScript(`[...document.querySelectorAll('#stimmung-wahl .v-stufe')].find((b) => b.textContent === arguments[0]).click()`, n);
      await warte(300);
      werteEinstellungen.push((await einst()).schwelle);
    }
    await schliesseAlleAusser(v);
    await interview(v, undefined, null);
    await bisSeite(4);
    const werteInterview = [];
    for (const n of imInterview.split('|')) {
      await stufeKlick(n);
      await warte(300);
      werteInterview.push((await einst()).schwelle);
    }
    pruefe(JSON.stringify(werteInterview) === JSON.stringify(werteEinstellungen) && werteInterview.length === 3, `I4: gleiche Werte ${JSON.stringify(werteInterview)} gegen ${JSON.stringify(werteEinstellungen)}`);
    messzahl += 1;
    await schliesseAlleAusser(v);
  }
  await entferneSpeicher('einstellungen', 'pack');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) {
    try {
      const hs = await driver.getAllWindowHandles();
      await driver.switchTo().window(hs[hs.length - 1]);
      await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen']);`);
    } catch {}
    await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  }
}
console.log(`firefox: interview.test ${ok} gruen, ${rot} rot, ${messzahl} Wirkungen gemessen`);
process.exit(code || (rot > 0 ? 1 : 0));
