// Firefox-Test Phase 6, Session 12, Auftrag O (UX-Funde der Einstellungsseite): klebende Leiste mit Pause (5, 29), Stimmungswort (6),
// Kontraste (9, 10), Fingerziele bei 360 px (11), Woerterbuch (14), Ueberschriften (15), Strict (16), Chip Interview (17), Tonprobe in der
// Pause (24), Ledger ohne Pack (25), Speicherfehler (26), Datum (28). Hilfsfunktionen wie einstellungen.test.mjs. Startet stumm (Entscheidung 140).
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEHLER_SPEICHERN, datumLang, stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';
import { LEDGER_MEHR, LEDGER_MEHR_NEUER, stufeWert } from '../../src/ledger/texte.ts';
import { TON_TEXTE } from '../../src/ton/texte.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 200 s ueberschritten');
  process.exit(1);
}, 200_000).unref();

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

// Phase 9 (Paket B, Fund 4): ohne Pack sind Adult sites, Mia’s control (bis auf Calm mode) und Sound zugeklappt; wie die Person mit "Set them now" aufklappen.
const oeffneZu = async () => {
  const frist = Date.now() + 15_000;
  for (;;) {
    try {
      if (await driver.executeScript(`return document.body.getAttribute('data-veil-ordnung') === 'bereit'`)) break;
    } catch {
      /* Seite laedt noch */
    }
    if (Date.now() > frist) throw new Error('Ordnung der Einstellungsseite nicht bereit');
    await new Promise((r) => setTimeout(r, 100));
  }
  await driver.executeScript(`for (let i = 0; i < 5; i++) { const k = [...document.querySelectorAll('.zu-knopf')].find((e) => !e.hidden && e.getClientRects().length > 0); if (!k) break; k.click(); } window.scrollTo(0, 0);`);
};
const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const einst = async () => (await speicher('einstellungen')) ?? {};
const waehle = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, wert);
const zahl = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));


const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const setze = (o) => imSeitenkontext(`await api.storage.local.set(args[0]);`, o);
const entferne = (k) => imSeitenkontext(`await api.storage.local.remove(args[0]);`, k);
const packMit = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const anzeige = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return e.value ?? e.textContent;`, css);
// Echte WebDriver-Klicks und Tasten (Mausklick aufs Label, Pfeiltasten am Regler), kein element.click() im Seitenskript.
// Session 18: unter Last meldet geckodriver fuer den klebenden Pause-Knopf gelegentlich "could not be scrolled into view" (Seite waechst
// noch); dann kurz warten und einmal wiederholen. Andere Fehler gehen durch.
const wdKlick = async (by) => {
  for (let versuch = 0; ; versuch++) {
    try {
      return await (await driver.findElement(by)).click();
    } catch (e) {
      if (versuch >= 2 || e?.name !== 'ElementNotInteractableError') throw e;
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
};
const labelMit = (bereich, text) => By.xpath(`//*[@id='${bereich}']//label[contains(., '${text}')]`);
const zone = (text) => wdKlick(labelMit('zonen', text));
const stilWahl = (text) => wdKlick(By.xpath(`//div[contains(@class,'wahl')]//label[contains(., '${text}')]`));
const strictKlick = () => wdKlick(By.xpath(`//label[.//input[@id='strict']]`));
const tasten = async (css, key, n) => {
  const e = await driver.findElement(By.css(css));
  await e.sendKeys(...Array(n).fill(key));
};
const geklickt = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const gesperrt = (css) => driver.executeScript(`return document.querySelector(arguments[0]).disabled`, css);
const wertVon = (css) => driver.executeScript(`return document.querySelector(arguments[0]).value`, css);
const geprueft = (css) => driver.executeScript(`return document.querySelector(arguments[0]).checked`, css);

// Neue Seite beobachten: Griffe vor dem Klick merken, danach den neuen Griff, seine Adresse lesen, schliessen, zurueckwechseln.
async function neueSeiteNach(aktion) {
  const vorher = await driver.getAllWindowHandles();
  const zurueck = await driver.getWindowHandle();
  await aktion();
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error('keine neue Seite');
  await driver.switchTo().window(neu);
  let url = await driver.getCurrentUrl();
  for (let i = 0; i < 100 && url === 'about:blank'; i++) {
    await warte(50);
    url = await driver.getCurrentUrl();
  }
  await driver.close();
  await driver.switchTo().window(zurueck);
  return url;
}


const ZAEHLER = ['zensiert', 'quizGeloest', 'quizFalsch', 'quizVerweigert', 'erwachsenMinuten', 'werbung', 'blitzwoerter', 'spiralen', 'besuche'];
const nullen = () => Object.fromEntries(ZAEHLER.map((z) => [z, 0]));
const ledgerStand = (teil = {}) => {
  const d = new Date();
  const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { version: 1, seit: Date.now(), tag, heute: nullen(), gesamt: nullen(), hoechsteStufe: 0, ...teil };
};
const ALLES = ['pack', 'einstellungen', 'einstieg', 'ledger', 'quizWarnungGesehen', 'spiraleWarnungGesehen'];
// Seite neu laden und warten, bis der Pack-Teil fertig ist (Wettlauf aus Session 11)
async function frisch(vorher = {}) {
  await entferne(ALLES);
  if (Object.keys(vorher).length) await setze(vorher);
  await driver.navigate().refresh();
  await bis('Pack-Status', async () => (await text('#pack-status')) !== '');
  await oeffneZu();
}
// Seite in einem 360 px breiten Iframe messen (Firefox-Fenster werden nicht so schmal)
const imRahmen = (skript) =>
  driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const f = document.createElement('iframe');
     f.style.cssText = 'width:360px;height:800px;position:fixed;left:0;top:0;border:0';
     f.src = location.href;
     f.onload = () => setTimeout(() => { const d = f.contentDocument; ${skript} }, 700);
     document.body.append(f);`,
  );
const kontrast = `const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const kr = (a, b) => { const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); };`;

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);
  await oeffne('options.html');
  await frisch({ einstieg: EINSTIEG_FERTIG });

  // ---- Fund 5 und 29: klebende Leiste, Pause darin ----
  await driver.executeScript(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await bis('gescrollt', async () => (await driver.executeScript(`return window.scrollY`)) > 1000);
  const lage = await driver.executeScript(`const r = document.getElementById('leiste').getBoundingClientRect(); return { oben: r.top, hoehe: r.height, scroll: window.scrollY };`);
  console.log(`firefox: Leiste nach Scroll ${Math.round(lage.scroll)} px: oben ${lage.oben}, Hoehe ${Math.round(lage.hoehe)}`);
  pruefe(Math.abs(lage.oben) <= 1, 'Fund 5: Leiste klebt oben nach dem Scrollen');
  pruefe((await text('#pause-leiste')) === 'Pause Mia', 'Fund 29: Pause-Knopf in der Leiste "Pause Mia"');
  // Nr. 10: der Klick nimmt den Hintergrundweg (runtime.sendMessage typ "pause" mit Zielwert), nicht den Ersatzweg ueber den Speicher
  await driver.executeScript(`const rt = (window.wrappedJSObject && window.wrappedJSObject.browser || window.browser).runtime;
    window.__pause = []; const echt = rt.sendMessage.bind(rt);
    rt.sendMessage = (n, ...rest) => { if (n && n.typ === 'pause') window.__pause.push(n.an); return echt(n, ...rest); };`);
  await wdKlick(By.id('pause-leiste'));
  await bis('pause an', async () => (await einst()).pause === true);
  pruefe(JSON.stringify(await driver.executeScript(`return window.__pause`)) === '[true]', 'Fund 29: Pause aus der Leiste geht ueber runtime.sendMessage "pause" an den Hintergrund');
  pruefe((await text('#pause-leiste')) === 'Let Mia back in' && (await driver.executeScript(`return document.getElementById('pause-leiste').getAttribute('aria-pressed')`)) === 'true' && (await text('#pause')) === 'Let Mia back in', 'Fund 29: Pause aus der Leiste schreibt pause, beide Knoepfe zeigen "Let Mia back in", aria-pressed');
  await wdKlick(By.id('pause-leiste'));
  await bis('pause aus', async () => (await einst()).pause === false);

  // ---- Fund 3 und 5: am Desktop keine Chips ausserhalb der Leiste ----
  const dk = await driver.executeScript(`const n = document.getElementById('sprung'); const l = n.getBoundingClientRect(); return { sw: n.scrollWidth, cw: n.clientWidth, aus: [...n.querySelectorAll('a')].filter((a) => a.getClientRects().length && a.getBoundingClientRect().right > l.right + 1).length };`);
  console.log(`firefox: Desktop Sprungleiste scrollWidth ${dk.sw}, clientWidth ${dk.cw}, Chips ausserhalb ${dk.aus}`);
  pruefe(dk.aus === 0 && dk.sw <= dk.cw, 'Fund 3: am Desktop umbrechen die Chips, keine liegt ausserhalb');

  // ---- Fund 6: Stimmungswort ----
  const woerter = [];
  await tasten('#stimmung', Key.HOME, 1);
  await bis('schwelle 0.10', async () => Math.abs((await einst()).schwelle - 0.1) < 1e-6);
  woerter.push(await text('#stimmung-wert'));
  let ziel = 10;
  for (const n of [3, 4, 4]) {
    ziel += n;
    await tasten('#stimmung', Key.ARROW_RIGHT, n);
    await bis(`schwelle ${ziel}`, async () => Math.round((await einst()).schwelle * 100) === ziel);
    const w = await text('#stimmung-wert');
    pruefe(w === stimmungsWort(ziel / 100) && (await driver.executeScript(`return document.getElementById('stimmung').getAttribute('aria-valuetext')`)) === w, `Fund 6: Schwelle 0.${ziel} als Wort "${w}", aria-valuetext gleich`);
    woerter.push(w);
  }
  console.log(`firefox: Stimmungswoerter ${woerter.join(', ')}`);
  pruefe(new Set(woerter).size === 4 && !/\d/.test(woerter.join('')), 'Fund 6: vier verschiedene Woerter, keine Ziffer');

  // ---- Fund 9 und 10: Kontraste ----
  const k = await driver.executeScript(`${kontrast}
    const cs = (e) => getComputedStyle(e);
    const knopf = document.getElementById('ausnahme-add');
    const bahn = document.querySelector('#strict + .regler');
    const feld = document.getElementById('ausnahme-feld');
    const karte = cs(bahn.closest('section')).backgroundColor;
    return { knopf: kr(cs(knopf).color, cs(knopf).backgroundColor), bahn: kr(cs(bahn).backgroundColor, karte), feld: kr(cs(feld).borderTopColor, karte), auswahl: kr(cs(document.getElementById('kon-blitz')).borderTopColor, karte) };`);
  console.log(`firefox: Kontraste Knopftext ${k.knopf.toFixed(2)}, Bahn aus ${k.bahn.toFixed(2)}, Textfeldrand ${k.feld.toFixed(2)}, Auswahlrand ${k.auswahl.toFixed(2)}`);
  const k2 = await driver.executeScript(`${kontrast}
    const bg = getComputedStyle(document.body).backgroundColor;
    const knoepfe = [...document.querySelectorAll('button.klein')].filter((e) => e.getClientRects().length > 0);
    return { n: knoepfe.length, min: Math.min(...knoepfe.map((e) => kr(getComputedStyle(e).color, getComputedStyle(e).backgroundColor))), bahn: kr(getComputedStyle(document.querySelector('#strict + .regler')).backgroundColor, bg), feld: kr(getComputedStyle(document.getElementById('ausnahme-feld')).borderTopColor, bg) };`);
  console.log(`firefox: ${k2.n} sichtbare button.klein, kleinster Textkontrast ${k2.min.toFixed(2)}, Bahn gegen Seitengrund ${k2.bahn.toFixed(2)}, Feldrand gegen Seitengrund ${k2.feld.toFixed(2)}`);
  pruefe(k2.n > 2 && k2.min >= 4.5 && k2.bahn >= 3 && k2.feld >= 3, 'Fund 9 und 10: alle button.klein 4,5:1, Bahn und Feldrand auch gegen den Seitengrund 3:1');
  pruefe(k.knopf >= 4.5, 'Fund 9: Knopftext mindestens 4,5:1');
  pruefe(k.bahn >= 3 && k.feld >= 3 && k.auswahl >= 3, 'Fund 10: Bahn aus und Feldraender mindestens 3:1');

  // ---- Fund 15, 16, 17 ----
  const g = await driver.executeScript(`const a = getComputedStyle(document.getElementById('erw-titel')); const b = getComputedStyle(document.querySelector('#erwachsen h3')); return { h2: parseFloat(a.fontSize), h3: parseFloat(b.fontSize), farbe: a.color === getComputedStyle(document.body).color, gross: a.textTransform };`);
  console.log(`firefox: h2 ${g.h2} px, h3 ${g.h3} px`);
  pruefe(g.h2 > g.h3 && g.h2 >= 17 && g.farbe && g.gross === 'none', 'Fund 15: h2 groesser als h3, Textfarbe, keine Grossbuchstaben');
  pruefe((await driver.executeScript(`return document.getElementById('abschnitt-strict') === null && !!document.querySelector('#abschnitt-zonen #strict') && ![...document.querySelectorAll('#sprung a')].some((a) => a.textContent === 'Strict')`)), 'Fund 16: Strict im Abschnitt "What I cover", kein eigener Abschnitt und Chip');
  await strictKlick();
  await bis('strict an', async () => (await einst()).strict === true);
  await strictKlick();
  await bis('strict aus', async () => (await einst()).strict === false);
  pruefe(!(await sichtbar('#chip-interview')) && (await sichtbar('#abschnitt-interview')) && (await text('#interview-neu')) === 'Run the interview again' && (await driver.executeScript(`return document.getElementById('ueber').lastElementChild.id`)) === 'abschnitt-interview', 'Fund 22 (Phase 9): Interview-Knopf als letzter Punkt in About and help, kein eigener Chip');
  await entferne('einstieg');
  await bis('Interview weg', async () => !(await sichtbar('#abschnitt-interview')));
  pruefe(true, 'Fund 22: ohne Einstieg der Interview-Knopf verborgen');
  await setze({ einstieg: EINSTIEG_FERTIG });

  // ---- Fund 14: Woerter ----
  await setze({ ledger: ledgerStand({ hoechsteStufe: 3 }) });
  await bis('Stufe', async () => (await text('#ledger-stufe')) === stufeWert(3));
  const sicht = (await driver.executeScript(`return document.body.innerText`)).toLowerCase();
  const h2 = await driver.executeScript(`return [...document.querySelectorAll('h2')].map((e) => e.textContent)`);
  const chips = await driver.executeScript(`return [...document.querySelectorAll('#sprung a:not([hidden])')].map((e) => e.textContent)`);
  pruefe(!/\bskip/.test(sicht) && !/\bexception/.test(sicht) && !sicht.includes('your pack') && !sicht.includes('add a pack'), 'Fund 14: kein "skip", "exception", "your pack", "add a pack" im sichtbaren Text');
  pruefe(h2.includes('Sites I leave alone') && h2.includes('Mia Pack') && chips.includes('Mia Pack') && chips.includes('Covering') && chips.includes('About and help') && !chips.includes('Pack') && !chips.includes('Left alone'), 'Fund 14: Ueberschriften und Chips nach dem Woerterbuch');
  pruefe(stufeWert(3) === 'Level 3 of 4', 'Fund 14: Stufe "Level 3 of 4"');

  // ---- Fund 28: Datum ----
  const seit = new Date(2026, 10, 5, 14, 3).getTime();
  await setze({ ledger: ledgerStand({ seit }) });
  await bis('Datum', async () => (await text('#ledger-seit')).includes(datumLang(seit)));
  const datumText = await text('#ledger-seit');
  console.log(`firefox: Ledger-Datum "${datumText.slice(0, 32)}"`);
  pruefe(datumText.includes('Nov 5, 2026') && !/\d{2}\/\d{2}\/\d{4}/.test(datumText), 'Fund 28: Ledger-Datum "Nov 5, 2026"');

  // ---- Fund 25: Ledger ohne Pack ----
  const zeilen = () => driver.executeScript(`return [...document.querySelectorAll('#ledger .ledger-liste > li')].filter((l) => !l.hidden).length`);
  await bis('Mehr-Zeile', async () => (await sichtbar('#ledger-mehr')) && (await text('#ledger-mehr')) === LEDGER_MEHR);
  const ohne = await zeilen();
  console.log(`firefox: Ledger ohne Pack ${ohne} von 9 Zeilen sichtbar`);
  pruefe(ohne === 1 && !(await sichtbar('#ledger-stufe-zeile')), 'Fund 25: ohne Pack nur die Zeile "zensiert" und die Sammelzeile, keine Stufenzeile');
  await setze({ ledger: ledgerStand({ gesamt: { ...nullen(), besuche: 3 } }) });
  await bis('besuche sichtbar', async () => await sichtbar('#ledger-zeile-besuche'));
  pruefe((await zeilen()) === 2, 'Fund 25: ein Zaehler ueber 0 bleibt sichtbar');
  const ohneSteigerung = ['erwachsen:vorschau', 'erwachsen:quiz', 'kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf', 'kontrolle:besuche'];
  await setze({ pack: packMit(ohneSteigerung) });
  await bis('acht', async () => (await zeilen()) === 8 && (await text('#ledger-mehr')) === LEDGER_MEHR_NEUER && !(await sichtbar('#ledger-stufe-zeile')));
  pruefe(true, 'Fund 25 und 13: Pack ohne zensur:steigerung zeigt 8 Zeilen, keine Stufenzeile und "newer Mia Pack"');
  await setze({ pack: packMit([...ohneSteigerung, 'zensur:steigerung']) });
  await bis('alle neun', async () => (await zeilen()) === 9 && !(await sichtbar('#ledger-mehr')) && (await sichtbar('#ledger-stufe-zeile')));
  pruefe(true, 'Fund 25: mit zensur:steigerung alle neun Zeilen und die Stufenzeile, keine Sammelzeile');

  // ---- Fund 24: Tonprobe in der Pause ----
  await setze({ pack: packMit(['ton']), einstellungen: { ...(await einst()), pause: true } });
  await bis('Probe frei', async () => !(await gesperrt('#ton-probe')));
  await wdKlick(By.id('ton-probe'));
  await bis('Pausen-Satz', async () => (await text('#ton-probe-meldung')) === TON_TEXTE.probePause);
  pruefe(true, 'Fund 24: Probe in der Pause frei, Klick zeigt den Satz');
  await setze({ einstellungen: { ...(await einst()), pause: false } });
  await bis('Satz weg', async () => (await text('#ton-probe-meldung')) !== TON_TEXTE.probePause);

  // ---- Fund 26: Speichern scheitert ----
  await frisch({ einstieg: EINSTIEG_FERTIG });
  const kaputt = (an) =>
    driver.executeScript(
      `const sl = (window.wrappedJSObject && window.wrappedJSObject.browser || window.browser).storage.local;
       if (!sl.__echtSet) sl.__echtSet = sl.set.bind(sl);
       const echt = sl.__echtSet;
       sl.set = (o) => (arguments[0] && 'einstellungen' in o ? Promise.reject(new Error('Test')) : echt(o));`,
      an,
    );
  await kaputt(true);
  await driver.findElement(By.id('seite-feld')).sendKeys('getippt.example');
  await driver.findElement(By.id('ausnahme-feld')).sendKeys('auch-getippt.example');
  const leereMeldung = () => driver.executeScript(`const m = document.getElementById('speicher-meldung'); m.textContent = ''; m.hidden = true;`);
  const fehlerBei = async (name, aktion, zurueck) => {
    await leereMeldung();
    await aktion();
    await bis(`Fehlersatz ${name}`, async () => (await sichtbar('#speicher-meldung')) && (await text('#speicher-meldung')) === FEHLER_SPEICHERN);
    pruefe(await driver.executeScript(`const r = document.getElementById('speicher-meldung').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight;`), `Fund 26: ${name}: Satz ohne Scrollen sichtbar`);
    await bis(`${name} zurueck`, zurueck);
  };
  for (const [name, css] of [['Strict', '#strict'], ['Adult-site mode', '#erw-an'], ['Calm mode', '#ruhig'], ['My ads', '#kon-werbung'], ['Tab-Titel', '#kon-tabtitel'], ['Ton', '#ton-an']]) {
    const vor = await geprueft(css);
    await fehlerBei(name, () => geklickt(css), async () => (await geprueft(css)) === vor);
  }
  const vorBlitz = await wertVon('#kon-blitz');
  await fehlerBei('Blitz-Auswahl', () => waehle('#kon-blitz', vorBlitz === 'oft' ? 'selten' : 'oft'), async () => (await wertVon('#kon-blitz')) === vorBlitz);
  for (const [name, css, key, n] of [['Lautstaerke', '#ton-lautstaerke', Key.ARROW_RIGHT, 1], ['Stimmung', '#stimmung', Key.ARROW_RIGHT, 2], ['Verweigern', '#verweigern', Key.END, 1], ['Freilegen', '#freilegen', Key.END, 1]]) {
    const vor = await wertVon(css);
    await fehlerBei(name, () => tasten(css, key, n), async () => (await wertVon(css)) === vor);
  }
  pruefe((await text('#stimmung-wert')) === stimmungsWort(Number(await wertVon('#stimmung'))) + (Math.round(Number(await wertVon('#stimmung')) * 100) === 10 ? ' (my default)' : ''), 'Fund 26: Stimmungswort passt zum gespeicherten Regler');
  pruefe(((await einst()).strict ?? false) === false && ((await einst()).ruhig ?? false) === false, 'Fund 26: nichts gespeichert');
  pruefe((await wertVon('#seite-feld')) === 'getippt.example' && (await wertVon('#ausnahme-feld')) === 'auch-getippt.example', 'Fund 26: getippter Text in unbeteiligten Feldern bleibt');
  pruefe(true, 'Fund 26: 12 Elemente mit Speicherfehler, je Satz gesehen');
  await kaputt(false);
  await strictKlick();
  await bis('strict gespeichert', async () => (await einst()).strict === true);
  await bis('Meldung weg', async () => !(await sichtbar('#speicher-meldung')));
  pruefe(true, 'Fund 26: nach gelungenem Speichern verschwindet der Fehlersatz');

  // ---- Fund 5 und 11 bei 360 px ----
  await frisch({
    einstieg: EINSTIEG_FERTIG,
    pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'kontrolle:zeitplan']),
    einstellungen: { ...(await einst()), ausnahmen: ['kurz.de'], erwachsen: { ...((await einst()).erwachsen ?? {}), eigeneSeiten: ['adult.example'] } },
  });
  const m = await imRahmen(`
    d.querySelectorAll('.zu-knopf').forEach((k) => k.click());
    d.getElementById('kon-zeit-neu').click();
    setTimeout(() => {
      const h = (sel) => { const l = [...d.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0); return { n: l.length, min: Math.round(Math.min(...l.map((e) => e.getBoundingClientRect().height))) }; };
      const nav = d.getElementById('sprung');
      fertig({
        breite: d.documentElement.scrollWidth, fenster: d.documentElement.clientWidth, navScroll: nav.scrollWidth, navBreit: nav.clientWidth, leiste: Math.round(d.getElementById('leiste').getBoundingClientRect().height),
        hoehen: { chips: h('#sprung a'), ausnahme: h('#ausnahmen-liste button'), seiten: h('#seiten-liste button'), zeit: h('#kon-zeiten .zeit-weg'), bedeckt: h('.auch'), tage: h('.zeit-tage label'), schalter: h('label.schalter'), knoepfe: h('button.klein') },
      });
    }, 400);`);
  console.log(`firefox: 360 px Seite ${m.breite}/${m.fenster}, Sprungleiste ${m.navScroll}/${m.navBreit}, Leiste ${m.leiste} px, Hoehen ${JSON.stringify(m.hoehen)}`);
  pruefe(m.breite <= m.fenster && m.navScroll > m.navBreit && m.leiste < 90, 'Fund 5: bei 360 px Sprungleiste waagrecht scrollbar, Seite ohne Ueberlauf');
  pruefe(Object.values(m.hoehen).every((v) => v.n > 0 && v.min >= 44), 'Fund 11: alle Fingerziele bei 360 px mindestens 44 px hoch');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'ledger']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: einstellungen-s12.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
