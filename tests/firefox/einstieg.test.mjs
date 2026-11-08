// Firefox-Test Auftrag E (Einstieg, Session 11): Testbau-Stand nach der Installation, einstieg-test, ganzer Durchgang mit Klicks, Ueberspringen,
// "I’m not", Popup-Hinweis, #interview. Hilfsfunktionen wie tests/firefox/kontrolle-optionen.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT } from '../../src/einstieg/texte.ts';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 150 s ueberschritten');
  process.exit(1);
}, 150_000).unref();

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
const schritt = () => driver.executeScript(`return document.querySelector('#schritt').dataset.schritt`);
const einst = async () => (await speicher('einstellungen')) ?? {};
const einstieg = () => speicher('einstieg');
const sende = (n) => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, { ziel: 'hintergrund', typ: 'einstieg-test', ...n });
const imStand = async (h, fn) => {
  await driver.switchTo().window(h);
  return fn();
};
const bisSchritt = (soll) => bis(`Schritt ${soll}`, async () => (await schritt()) === soll);
let messzahl = 0;

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  // Verwaltungsseite: Speicher und Nachrichten
  const v = await oeffne('options.html');

  // 1. Testbau: Installation schreibt den Einstieg als erledigt, nichts oeffnet sich
  await bis('Einstieg erledigt', async () => (await einstieg())?.interview === 'uebersprungen');
  let s = await einstieg();
  pruefe(s.warnung && s.alter && s.einwilligung, 'Testbau: Warnung, 18+ und Einwilligung nach der Installation wahr');
  pruefe((await driver.getAllWindowHandles()).length === 2, 'Testbau: keine Willkommensseite von selbst geoeffnet'); // Startfenster + Verwaltungsseite
  // 2. einstieg-test: zuruecksetzen und oeffnen
  const vorher = await driver.getAllWindowHandles();
  const antwort = await sende({ zuruecksetzen: true, oeffne: true });
  pruefe(antwort?.ok === true && typeof antwort.tabId === 'number', 'einstieg-test oeffne antwortet mit tabId');
  s = await einstieg();
  pruefe(!s.warnung && !s.alter && !s.einwilligung && s.interview === 'offen' && s.zeit === null, 'einstieg-test zuruecksetzen leert den Einstieg');
  let w;
  for (let i = 0; i < 100 && !w; i++) {
    w = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!w) await warte(50);
  }
  pruefe(!!w, 'einstieg-test oeffne oeffnet einen neuen Tab');
  await driver.switchTo().window(w);
  await bis('Warnung da', async () => (await schritt()) === 'warnung');
  pruefe((await driver.getCurrentUrl()).includes('willkommen.html'), 'der neue Tab ist die Willkommensseite');
  messzahl += 5;

  // 3. Ganzer Durchgang
  // Fund 7: mit Pack beim Einstieg hat das Interview fuenf Seiten; das Pack faellt nach Seite 1 wieder weg, damit die Hinweise "ohne Pack" sichtbar sind.
  await imStand(v, () => imSeitenkontext(`await api.storage.local.remove(['einstellungen', 'quizWarnungGesehen', 'spiraleWarnungGesehen']); await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 } });`));
  await driver.switchTo().window(w);
  pruefe((await text('#warnung-kern')) === TEXT.warnungKern, 'Warnung zeigt den sachlichen Kern');
  pruefe((await text('#fortschritt-text')) === TEXT.schrittVon(1, 6), 'Fortschritt Schritt 1 von 6 (die Seite war vor dem Pack offen)');
  await klick('#warnung-ok');
  await bis('warnung gespeichert', async () => (await einstieg()).warnung === true);
  pruefe((await speicher('quizWarnungGesehen')) === true && (await speicher('spiraleWarnungGesehen')) === true, 'Warnung zaehlt als gesehen fuer Quiz und Spirale');
  await bisSchritt('alter');
  await klick('#alter-ja');
  await bis('alter gespeichert', async () => (await einstieg()).alter === true);
  await bisSchritt('einwilligung');
  pruefe((await einstieg()).einwilligung === false, 'Einwilligung noch nicht gespeichert');
  await klick('#einwilligung-ok');
  await bis('einwilligung gespeichert', async () => (await einstieg()).einwilligung === true);
  pruefe(typeof (await einstieg()).zeit === 'number', 'I agree speichert die Zeit');
  await bisSchritt('interview-1');
  pruefe((await text('#fortschritt-text')) === TEXT.frageVon(1, 5), 'Fund 7 und 19: mit Pack fuenf Fragen, Question 1 of 5');
  pruefe((await text('#etappen li[aria-current="step"]')) === TEXT.etappen.interview, 'Fund 19: Etappe Questions fett');
  await imStand(v, () => imSeitenkontext(`await api.storage.local.remove('pack');`));
  await driver.switchTo().window(w);
  messzahl += 8;
  // Seite 1
  await setzeRange('#iv-stimmung', 0.2);
  await bis('schwelle', async () => (await einst()).schwelle === 0.2);
  await klick('#iv-strict');
  await bis('strict', async () => (await einst()).strict === true);
  pruefe(!(await sichtbar('#iv-zurueck')), 'Seite 1 hat kein Back');
  await klick('#iv-weiter');
  // Seite 2
  await bisSchritt('interview-2');
  pruefe((await eigenschaft('#iv-zonen-koerper', 'checked')) === true, 'Zonen ab Werk: Body vorgewaehlt');
  await klick('#iv-zonen-alles');
  await bis('alle Zonen', async () => Object.values((await einst()).zonen).every((z) => z.an));
  await klick('#iv-bedeckt');
  await bis('alle bedeckt', async () => (await einst()).zonen.feet.bedeckt === true && (await einst()).zonen.breast.bedeckt === true);
  await klick('#iv-zonen-koerper-gesicht');
  await bis('Body and face', async () => (await einst()).zonen.face.an === true && (await einst()).zonen.feet.an === false);
  messzahl += 6;
  await klick('#iv-zurueck');
  await bisSchritt('interview-1');
  pruefe((await eigenschaft('#iv-stimmung', 'value')) === '0.2' && (await eigenschaft('#iv-strict', 'checked')) === true, 'Back zeigt die gespeicherten Werte');
  await klick('#iv-weiter');
  await bisSchritt('interview-2');
  pruefe((await eigenschaft('#iv-zonen-koerper-gesicht', 'checked')) === true && (await eigenschaft('#iv-bedeckt', 'checked')) === true, 'Seite 2 vorbelegt');
  await klick('#iv-weiter');
  // Seite 3
  await bisSchritt('interview-3');
  pruefe((await eigenschaft('#iv-stil-mia-patch', 'disabled')) === true && (await sichtbar('#iv-stil-sperre')), 'ohne Pack: Mia patch gesperrt mit Hinweis');
  await klick('#iv-stil-blur');
  await bis('stil blur', async () => (await einst()).stil === 'blur');
  pruefe(!(await driver.executeScript(`return !!document.querySelector('#iv-ruhig')`)), 'Calm mode steht nicht auf Seite 3');
  await klick('#iv-weiter');
  // Seite 4
  await bisSchritt('interview-4');
  pruefe(await sichtbar('#iv-ohne-pack'), 'Seite 4 ohne Pack: Hinweis');
  await klick('#iv-erw-an');
  await bis('erwachsen aus', async () => (await einst()).erwachsen.an === false);
  await klick('#iv-erw-ersatz');
  await bis('ersatz an', async () => (await einst()).erwachsen.komplettErsatz === true);
  await setzeRange('#iv-verweigern', 20);
  await bis('verweigern', async () => (await einst()).quiz.verweigern === 0.2);
  await klick('#iv-weiter');
  // Seite 5
  await bisSchritt('interview-5');
  pruefe((await text('#iv-weiter')) === TEXT.fertig, 'letzte Seite: Knopf Finish');
  await waehle('#iv-blitz', 'oft');
  await bis('blitz', async () => (await einst()).kontrolle.blitz === 'oft');
  await klick('#iv-leerlauf');
  await bis('leerlauf', async () => (await einst()).kontrolle.leerlauf === false);
  await waehle('#iv-cursor', 'herz');
  await bis('cursor', async () => (await einst()).kontrolle.cursor === 'herz');
  await klick('#iv-ton');
  await bis('ton', async () => (await einst()).ton.an === true);
  await klick('#iv-ruhig');
  await bis('ruhig', async () => (await einst()).ruhig === true);
  messzahl += 15;
  await klick('#iv-weiter');
  await bis('interview fertig', async () => (await einstieg()).interview === 'fertig');
  await bisSchritt('ende');
  pruefe(!(await sichtbar('#fortschritt-zeile')), 'Abschluss ohne Fortschritt');
  pruefe((await eigenschaft('#ende-pack', 'hidden')) === false, 'Abschluss bietet das Pack an');
  messzahl += 2;
  // Pack da: der Knopf verschwindet
  await imStand(v, () => imSeitenkontext(`await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 } });`));
  await driver.switchTo().window(w);
  await bis('Pack-Knopf weg', async () => (await eigenschaft('#ende-pack', 'hidden')) === true);
  await imStand(v, () => imSeitenkontext(`await api.storage.local.remove('pack');`));
  await driver.switchTo().window(w);
  await bis('Pack-Knopf da', async () => (await eigenschaft('#ende-pack', 'hidden')) === false);
  // Beide Abschluss-Knoepfe gehen im selben Tab zur Einstellungsseite (Fund 22)
  const tabsDavor = (await driver.getAllWindowHandles()).length;
  await klick('#ende-einstellungen');
  await bis('Einstellungsseite', async () => (await driver.getCurrentUrl()).endsWith('options.html'));
  pruefe((await driver.getAllWindowHandles()).length === tabsDavor, 'All settings oeffnet keinen neuen Tab');
  await driver.navigate().back();
  await bisSchritt('ende');
  await klick('#ende-pack');
  pruefe((await driver.getAllWindowHandles()).length === tabsDavor, 'Add the Mia Pack oeffnet keinen neuen Tab');
  await bis('Pack-Abschnitt', async () => (await driver.getCurrentUrl()).endsWith('options.html#neu'));
  const e = await imStand(w, () => einst());
  pruefe(e.schwelle === 0.2 && e.strict && e.ruhig && e.erwachsen.an === false && e.erwachsen.komplettErsatz && e.quiz.verweigern === 0.2 && e.ton.an, 'Einstellungen wie gewaehlt');
  messzahl += 3;
  await driver.close();

  // 4. Ueberspringen
  await driver.switchTo().window(v);
  await imSeitenkontext(`await api.storage.local.remove(['einstellungen', 'pack']);`);
  await sende({ zuruecksetzen: true });
  await driver.switchTo().window(v);
  await oeffne('willkommen.html');
  await bisSchritt('warnung');
  pruefe(!(await sichtbar('#iv-ueberspringen')), 'am Gate kein Ueberspringen');
  await klick('#warnung-ok');
  await bisSchritt('alter');
  await klick('#alter-ja');
  await bisSchritt('einwilligung');
  pruefe(!(await sichtbar('#iv-ueberspringen')), 'bei der Einwilligung kein Ueberspringen');
  await klick('#einwilligung-ok');
  await bisSchritt('interview-1');
  // Erst Antworten geben, dann auf Seite 2 ueberspringen (ohne Pack gibt es nur drei Seiten): gesetzte Einstellungen bleiben, nichts wird zurueckgesetzt
  await setzeRange('#iv-stimmung', 0.15);
  await bis('schwelle 0.15', async () => (await einst()).schwelle === 0.15);
  await klick('#iv-strict');
  await bis('strict an', async () => (await einst()).strict === true);
  await klick('#iv-weiter');
  await bisSchritt('interview-2');
  const vorEinst = JSON.stringify(await speicher('einstellungen'));
  pruefe((await einst()).schwelle === 0.15, 'vor dem Ueberspringen steht die Antwort im Speicher');
  await klick('#iv-ueberspringen');
  await bis('uebersprungen', async () => (await einstieg()).interview === 'uebersprungen');
  await bisSchritt('ende');
  pruefe(JSON.stringify(await speicher('einstellungen')) === vorEinst, 'Ueberspringen laesst die gesetzten Einstellungen unveraendert');
  messzahl += 6;
  await driver.close();

  // 5. "I’m not"
  await driver.switchTo().window(v);
  await sende({ zuruecksetzen: true });
  await oeffne('willkommen.html');
  await bisSchritt('warnung');
  await klick('#warnung-ok');
  await bisSchritt('alter');
  const davor = JSON.stringify(await einstieg());
  await klick('#alter-nein');
  pruefe(await sichtbar('#alter-absage'), 'I’m not zeigt die Absage');
  pruefe((await text('#alter-entfernen')) === TEXT.entfernenFirefox, 'Absage nennt den Weg zum Entfernen in Firefox');
  pruefe(!(await sichtbar('#alter-ja')), 'nach I’m not kein Weiter');
  await warte(300);
  pruefe(JSON.stringify(await einstieg()) === davor, 'I’m not speichert nichts');
  messzahl += 4;
  await driver.close();

  // 6. Popup-Hinweis
  await driver.switchTo().window(v);
  await sende({ zuruecksetzen: true });
  const p = await oeffne('popup.html');
  await bis('Hinweis sichtbar', async () => sichtbar('#einstieg-hinweis'));
  pruefe((await text('#einstieg-knopf')) === 'Meet Mia', 'Popup zeigt Meet Mia bei offenem Einstieg');
  await imStand(v, () => imSeitenkontext(`await api.storage.local.set({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });`));
  await driver.switchTo().window(p);
  await bis('Hinweis weg', async () => !(await sichtbar('#einstieg-hinweis')));
  pruefe(true, 'Popup-Hinweis verschwindet bei fertigem Einstieg');
  await driver.switchTo().window(v);
  await sende({ zuruecksetzen: true });
  await driver.switchTo().window(p);
  await bis('Hinweis wieder da', async () => sichtbar('#einstieg-hinweis'));
  const vorKnopf = await driver.getAllWindowHandles();
  await klick('#einstieg-knopf');
  let w2;
  for (let i = 0; i < 100 && !w2; i++) {
    w2 = (await driver.getAllWindowHandles()).find((h) => !vorKnopf.includes(h));
    if (!w2) await warte(50);
  }
  pruefe(!!w2, 'Meet Mia oeffnet die Willkommensseite');
  await driver.switchTo().window(w2);
  await bisSchritt('warnung');
  pruefe((await driver.getCurrentUrl()).includes('willkommen.html'), 'Meet Mia: Willkommensseite beginnt bei der Warnung');
  messzahl += 5;
  // Zweites Popup bei offener Willkommensseite: kein neuer Tab
  await driver.switchTo().window(v);
  const p3 = await oeffne('popup.html');
  await bis('Hinweis im zweiten Popup', async () => sichtbar('#einstieg-hinweis'));
  const vorZwei = await driver.getAllWindowHandles();
  await klick('#einstieg-knopf');
  await warte(1000);
  pruefe((await driver.getAllWindowHandles()).filter((x) => !vorZwei.includes(x)).length === 0, 'Meet Mia bei offener Willkommensseite oeffnet keinen zweiten Tab');
  messzahl++;
  if ((await driver.getAllWindowHandles()).includes(p3)) {
    await driver.switchTo().window(p3);
    await driver.close();
  }
  await driver.switchTo().window(w2);
  await driver.close();
  // Das Popup schliesst sich nach dem Knopf selbst (window.close); steht es noch da, wird es hier geschlossen.
  if ((await driver.getAllWindowHandles()).includes(p)) {
    await driver.switchTo().window(p);
    await driver.close();
  }

  // 7. #interview
  await driver.switchTo().window(v);
  await imSeitenkontext(`await api.storage.local.set({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });`);
  const h = await oeffne('willkommen.html#interview');
  await bisSchritt('interview-1');
  pruefe(true, '#interview bei fertigem Einstieg: Interview-Seite 1');
  await driver.get(`moz-extension://${uuid}/willkommen.html`);
  await bisSchritt('ende');
  pruefe(true, 'ohne Anker und mit beendetem Interview: Abschluss');
  await driver.switchTo().window(v);
  await sende({ zuruecksetzen: true });
  await driver.switchTo().window(h);
  await driver.get(`moz-extension://${uuid}/willkommen.html#interview`);
  await driver.navigate().refresh();
  await bisSchritt('warnung');
  pruefe(true, '#interview bei offenem Einstieg: bleibt am Gate');
  messzahl += 3;

  // 8. Session 12 (Auftrag W): Funde 2, 3, 4, 6, 9, 10, 18, 19, 20, 21, 22, 23, 26
  await driver.switchTo().window(h);
  await driver.get(`moz-extension://${uuid}/willkommen.html`);
  await bisSchritt('warnung');
  await klick('#warnung-ok');
  await bisSchritt('alter');
  const stand18 = JSON.stringify(await einstieg());
  await klick('#alter-nein');
  pruefe((await text('#alter-zurueck')) === TEXT.alterZurueck, 'Fund 18: Absage hat den Knopf I tapped the wrong one');
  await klick('#alter-zurueck');
  pruefe((await sichtbar('#alter-frage')) && !(await sichtbar('#alter-absage')), 'Fund 18: Knopf fuehrt zur Frage zurueck');
  pruefe(JSON.stringify(await einstieg()) === stand18, 'Fund 18: nichts gespeichert');
  await klick('#alter-ja');
  await bisSchritt('einwilligung');
  pruefe((await text('#einwilligung-laeuft')) === TEXT.einwilligungLaeuft, 'Fund 2: Satz zum laufenden Schleier');
  pruefe((await text('#einwilligung-nein-hinweis')) === TEXT.einwilligungNeinHinweis, 'Fund 2: Satz unter Not now');
  messzahl += 6;
  // Wiederholen: fertiger Einstieg, #interview
  await driver.switchTo().window(v);
  await imSeitenkontext(`await api.storage.local.set({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } }); await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 } }); await api.storage.local.set({ einstellungen: { version: 1, schwelle: 0.2, kontrolle: { werbung: true } } });`);
  await driver.switchTo().window(h);
  await driver.get(`moz-extension://${uuid}/willkommen.html#interview`);
  await driver.navigate().refresh();
  await bisSchritt('interview-1');
  await bis('Pack da', async () => (await text('#fortschritt-text')) === TEXT.frageVon(1, 5));
  await imStand(v, () => imSeitenkontext(`await api.storage.local.remove('pack');`));
  await driver.switchTo().window(h);
  pruefe((await text('#fortschritt-text')) === TEXT.frageVon(1, 5), 'Fund 19: Wiederholen zaehlt Question 1 of 5');
  pruefe((await text('#iv-stimmung-wert')) === stimmungsWort(0.2), 'Fund 6: Stimmungswort statt Zahl');
  pruefe((await eigenschaft('#iv-stimmung', 'ariaValueText')) === stimmungsWort(0.2) || (await driver.executeScript(`return document.querySelector('#iv-stimmung').getAttribute('aria-valuetext')`)) === stimmungsWort(0.2), 'Fund 6: aria-valuetext');
  const kontrastCode = `const rgb = (t) => (t.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const l = c.map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
    const e = document.querySelector(arguments[0]); const st = getComputedStyle(e);
    const a = lum(rgb(st[arguments[1]])); const b = lum(arguments[2] ? rgb(arguments[2]) : rgb(st.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);`;
  const knopfKontrast = await driver.executeScript(kontrastCode, '#iv-ueberspringen', 'color', '');
  pruefe(knopfKontrast >= 4.5, `Fund 9: kleiner Knopf ${knopfKontrast.toFixed(2)}:1`);
  await klick('#iv-weiter');
  await bisSchritt('interview-2');
  const bahn = await driver.executeScript(kontrastCode, '.schalter .regler', 'backgroundColor', 'rgb(255, 255, 255)');
  const rand = await driver.executeScript(kontrastCode, '.wahl label', 'borderTopColor', 'rgb(255, 255, 255)');
  pruefe(bahn >= 3 && rand >= 3, `Fund 10: Bahn ${bahn.toFixed(2)}:1, Rand ${rand.toFixed(2)}:1`);
  // Fund N9: Unterzeile der gewaehlten Karte
  const gewaehlt = await driver.executeScript(
    `const rgb = (t) => (t.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
     const lum = (c) => { const l = c.map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
     return [...document.querySelectorAll('.wahl label')].filter((l) => l.querySelector('input:checked') && l.querySelector('small')).map((l) => { const a = lum(rgb(getComputedStyle(l.querySelector('small')).color)); const b = lum(rgb(getComputedStyle(l).backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });`,
  );
  pruefe(gewaehlt.length > 0 && gewaehlt.every((k) => k >= 4.5), `Fund N9: gewaehlte Unterzeile ${gewaehlt.map((k) => k.toFixed(2)).join(',')}:1`);
  // Fund N10: Trefferhoehe der Bedienelemente
  const kleinste = await driver.executeScript(
    `return Math.min(...[...document.querySelectorAll('#schritt button, #schritt select, #schritt input[type=range], #schritt label.schalter, #schritt .wahl label')].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect().height));`,
  );
  pruefe(kleinste >= 43.99, `Fund N10: kleinste Trefferhoehe Seite 2 ${kleinste}`);
  messzahl += 2;
  for (let i = 0; i < 2; i++) await klick('#iv-weiter');
  await bisSchritt('interview-4');
  pruefe((await sichtbar('#iv-ohne-pack')) && (await text('#iv-ohne-pack')).includes(TEXT.ohnePack4), 'Fund 4: Satz auf Seite 4');
  pruefe((await eigenschaft('#iv-pack-link', 'href')) === `moz-extension://${uuid}/options.html#neu`, 'Fund 4: Link Add the Mia Pack fuehrt zu options.html#neu');
  // Fund N11: der Link oeffnet einen neuen Tab, der Interview-Tab bleibt auf Schritt 4
  const vorN11 = await driver.getAllWindowHandles();
  await klick('#iv-pack-link');
  await bis('Fund N11: neuer Tab', async () => (await driver.getAllWindowHandles()).length === vorN11.length + 1);
  const nachN11 = await driver.getAllWindowHandles();
  const neuerTab = nachN11.find((x) => !vorN11.includes(x));
  await driver.switchTo().window(neuerTab);
  await bis('Fund N11: Ziel options.html#neu', async () => (await driver.getCurrentUrl()).endsWith('options.html#neu'));
  pruefe(nachN11.length === vorN11.length + 1, `Fund N11: Tabs ${vorN11.length} auf ${nachN11.length}`);
  await driver.close();
  await driver.switchTo().window(h);
  pruefe((await schritt()) === 'interview-4' && (await driver.getCurrentUrl()).includes('willkommen.html'), 'Fund N11: Interview-Tab bleibt auf Schritt 4');
  messzahl += 2;
  await bisSchritt('interview-4');
  await klick('#iv-weiter');
  await bisSchritt('interview-5');
  pruefe((await text('#fortschritt-text')) === TEXT.frageVon(5, 5), 'Fund 19: Question 5 of 5');
  pruefe((await text('#iv-auch-an')).startsWith(TEXT.auchAn([TEXT.auchAnNamen.werbung, TEXT.auchAnNamen.tabtitel, TEXT.auchAnNamen.meldungen])), 'Fund 3: Zeile zu Werbung, Tab-Titeln, Notizen');
  pruefe((await text('#iv-auch-an-link')) === TEXT.auchAnLink && (await eigenschaft('#iv-auch-an-link', 'href')) === `moz-extension://${uuid}/options.html#kontrolle`, 'Fund 21: Link zu den Einstellungen');
  pruefe(!(await sichtbar('#iv-ueberspringen')), 'Fund 20: Seite 5 ohne Ueberspringen');
  await klick('#iv-ruhig');
  await bis('ruhig auf Seite 5', async () => (await einst()).ruhig === true);
  // Fund 26: Speichern scheitert
  await driver.executeScript(`const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; a.storage.local.set = () => Promise.reject(new Error('voll'));`);
  await klick('#iv-leerlauf');
  await bis('Fehlersatz', async () => (await text('#fehler')) === FEHLER_SPEICHERN);
  pruefe((await eigenschaft('#iv-leerlauf', 'checked')) === true, 'Fund 26: Schalter springt auf den gespeicherten Stand');
  pruefe((await imStand(v, () => einst())).kontrolle.leerlauf === true, 'Fund 26: Speicher unveraendert');
  await driver.switchTo().window(h);
  messzahl += 13;
  // Fund 21: Abschluss mit Pack
  await driver.get(`moz-extension://${uuid}/willkommen.html`);
  await bisSchritt('ende');
  pruefe((await text('#ende-text')) === TEXT.endeText, 'Fund 21: ohne Pack der Satz zum Pack');
  // Fund 3: Checkliste im Abschluss, Firefox desktop: Rechtsklick auf mein Symbol; Kuerzel aus browser.commands
  pruefe((await driver.executeScript(`return document.querySelectorAll('#ende-liste li').length`)) === 3, 'Fund 3: drei Zeilen in der Checkliste');
  pruefe((await text('#ende-pin')).includes(TEXT.endePinFirefox), 'Fund 3: Firefox-Satz zum Anheften');
  pruefe((await eigenschaft('#ende-pin-link', 'target')) === '_blank' && (await driver.executeScript(`return document.querySelector('#ende-pin-link').getAttribute('href')`)) === 'hilfe.html#pin', 'Fund 3: Hilfe-Link zum Anheften');
  const kuerzel = await imSeitenkontext(`const alle = await api.commands.getAll(); return (alle.find((c) => c.name === 'pause-umschalten') || {}).shortcut || '';`);
  await bis('Fund 3: Pause-Zeile', async () => (await text('#ende-pause')).includes(kuerzel ? TEXT.endePauseKuerzel(kuerzel) : TEXT.endePauseNurPopup));
  pruefe((await text('#ende-versuch')).includes(TEXT.endeVersuch), 'Fund 3: Try me');
  pruefe((await text('#ende-pack')) === 'Get the Mia Pack', 'Fund 1: Abschluss bietet Get the Mia Pack');
  await driver.switchTo().window(v);
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 } });`);
  await driver.switchTo().window(h);
  await bis('Satz mit Pack', async () => (await text('#ende-text')) === TEXT.endeTextMitPack);
  messzahl += 2;

  // Fund 7 und 8: ohne Pack drei Fragen, Calm mode auf Seite 3, "Calm mode on, then continue" auf der Warnseite
  await driver.switchTo().window(v);
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen']);`);
  await sende({ zuruecksetzen: true });
  await oeffne('willkommen.html');
  await bisSchritt('warnung');
  pruefe((await text('#fortschritt-text')) === TEXT.schrittVon(1, 6), 'Fund 7: ohne Pack Step 1 of 6');
  pruefe((await text('#warnung-ruhig')) === TEXT.warnungRuhig && (await eigenschaft('#warnung-ruhig', 'className')).includes('gross'), 'Fund 8: zweiter, gleich starker Knopf');
  pruefe(((await einst()).ruhig ?? false) === false, 'Fund 8: Calm mode vorher aus');
  await klick('#warnung-ruhig');
  await bisSchritt('alter');
  await bis('Calm mode an', async () => (await einst()).ruhig === true);
  pruefe((await einstieg()).warnung === true && (await speicher('quizWarnungGesehen')) === true, 'Fund 8: Warnung zaehlt als gesehen');
  pruefe((await text('#etappen li[aria-current="step"]')) === TEXT.etappen.alter, 'Fund 19: Etappe Age');
  await klick('#alter-ja');
  await bisSchritt('einwilligung');
  await klick('#einwilligung-ok');
  await bisSchritt('interview-1');
  pruefe((await text('#fortschritt-text')) === TEXT.frageVon(1, 3), 'Fund 7 und 19: Question 1 of 3');
  await klick('#iv-weiter');
  await bisSchritt('interview-2');
  await klick('#iv-weiter');
  await bisSchritt('interview-3');
  pruefe((await text('#iv-weiter')) === TEXT.fertig && !(await sichtbar('#iv-ueberspringen')), 'Fund 7: Seite 3 ist die letzte');
  pruefe((await eigenschaft('#iv-ruhig', 'checked')) === true, 'Fund 8: Calm mode auf Seite 3 steht auf an');
  await klick('#iv-ruhig');
  await bis('Calm mode aus', async () => (await einst()).ruhig === false);
  await klick('#iv-weiter');
  await bis('interview fertig (3 Seiten)', async () => (await einstieg()).interview === 'fertig');
  await bisSchritt('ende');
  messzahl += 9;
  await driver.close();
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) {
    try {
      const hs = await driver.getAllWindowHandles();
      await driver.switchTo().window(hs[hs.length - 1]);
      await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'quizWarnungGesehen', 'spiraleWarnungGesehen']);`);
    } catch {}
    await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  }
}
console.log(`firefox: einstieg.test ${ok} gruen, ${rot} rot, ${messzahl} Wirkungen im Speicher gemessen`);
process.exit(code || (rot > 0 ? 1 : 0));
