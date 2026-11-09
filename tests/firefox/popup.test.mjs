// Firefox-Test des Popups ueber geckodriver/WebDriver (PHASE-2-BAUPLAN 9.3 und 9.6): Pause schaltet storage.local, Mia patch ist ohne Pack
// gesperrt und mit Pack waehlbar, der Verweis auf die Einstellungsseite ist da und oeffnet sie.
// Das Popup wird als Tab geoeffnet (moz-extension://<uuid>/popup.html), siehe tests/firefox/pack.test.mjs.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../../entrypoints/popup/texte.ts';
import { createServer } from 'node:http';
import { FEHLER_SPEICHERN, STIMMUNG_WOERTER, stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 90 s ueberschritten');
  process.exit(1);
}, 90_000).unref();

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
      seite.startsWith('http') ? seite : `moz-extension://${uuid}/${seite}`,
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
    // Session 12: waehrend eine Seite noch laedt, fehlt das Element kurz (Firefox 128); weiter warten statt abbrechen.
    try {
      letzter = await fn();
    } catch (fehler) {
      letzter = String(fehler?.name ?? fehler);
      await warte(50);
      continue;
    }
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

// Phase 9, Paket A (Fund 2): Mood, Zonen und Strict stehen hinter "Change"; der Zustand bleibt in localStorage der Erweiterung.
const oeffneGruppe = async () => {
  if ((await driver.findElement(By.css('#aendern')).getAttribute('aria-expanded')) !== 'true') await driver.findElement(By.css('#aendern')).click();
  await bis('Gruppe offen', async () => driver.findElement(By.css('#zonen')).isDisplayed());
};
const schliesseGruppe = async () => {
  if ((await driver.findElement(By.css('#aendern')).getAttribute('aria-expanded')) === 'true') await driver.findElement(By.css('#aendern')).click();
  await bis('Gruppe zu', async () => !(await driver.findElement(By.css('#zonen')).isDisplayed()));
};
const radio = (wert) => `input[name="stil"][value="${wert}"]`;
const eigenschaft = (css, name) => driver.executeScript(`return document.querySelector(arguments[0])[arguments[1]]`, css, name);
const text = (css) => driver.findElement(By.css(css)).getText();

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);

  const t0 = Date.now();
  const popup = await oeffne('popup.html');
  await bis('Popup gezeichnet', async () => (await text('#status')).length > 0);
  console.log(`firefox: Version ${version}, Popup nach ${Date.now() - t0} ms gezeichnet`);

  // Pause schaltet storage.local (und der Knopf folgt)
  const vorher = await speicher('einstellungen');
  pruefe(!vorher || vorher.pause === false, 'Pause ist anfangs aus');
  pruefe((await text('#pause')) === 'Pause Mia', 'Knopf zeigt "Pause Mia"');
  await driver.findElement(By.css('#pause')).click();
  await bis('Pause an', async () => (await speicher('einstellungen'))?.pause === true);
  pruefe(true, 'Klick auf Pause setzt einstellungen.pause = true');
  await bis('Knopftext', async () => (await text('#pause')) === 'Let Mia back in');
  pruefe((await text('#status')).includes('Paused'), 'Statuszeile meldet die Pause');
  await driver.findElement(By.css('#pause')).click();
  await bis('Pause aus', async () => (await speicher('einstellungen'))?.pause === false);
  pruefe(true, 'zweiter Klick setzt einstellungen.pause = false');

  // Cover style im Popup: eine Zeile mit Vorschau, Name und "Change style" (gewaehlt wird auf der Einstellungsseite); ohne Pack gilt Mosaik
  const setzePreset = (preset) => imSeitenkontext(`await api.storage.local.set({ einstellungen: { ...((await api.storage.local.get('einstellungen')).einstellungen ?? {}), preset: args[0] } });`, preset);
  pruefe((await text('#preset-name')) === 'Mosaic', 'ohne Pack gilt Mosaik (Name in der Zeile)');
  pruefe((await driver.findElements(By.css('#preset-bild svg'))).length === 1, 'Vorschau der Figur steht da');
  pruefe((await driver.findElements(By.css('input[name="stil"]'))).length === 0, 'keine Stil-Knoepfe im Popup');
  pruefe((await text('#pack-link')).length > 0, 'Verweis auf die Einstellungsseite ist da');
  await setzePreset('blur');
  await bis('Blur', async () => (await text('#preset-name')) === 'Blur');
  pruefe(true, 'Blur in storage.local, das Popup folgt');
  // Ein Mia-Preset ohne Pack: gilt Mosaik, der Hinweis nennt den Weg zum Pack
  await setzePreset('mia-wort');
  await bis('Mosaik gilt', async () => (await text('#preset-name')) === 'Mosaic');
  pruefe((await text('#pack-hinweis')).includes('Mia Pack'), 'Hinweis nennt den Weg zum Pack');

  // Mit Pack (Kurzfassung in storage.local) gilt das Mia-Preset, das Popup folgt der Aenderung ohne Neuladen
  await imSeitenkontext(
    `await api.storage.local.set({ pack: { id: 'test', version: '1.0.0', titel: 'Test', freischaltungen: ['stil:mia-patch'], bilder: 3, groesse: 100, importiert: 1 } });`,
  );
  await bis('Mia-Preset gilt', async () => (await text('#preset-name')) === 'My face, black, words');
  pruefe((await text('#pack-hinweis')).includes('I choose my face from'), 'Satz nennt die Herkunft des Gesichts');

  // Pack weg: das Popup zeigt wieder das wirksame Preset (Mosaik)
  await imSeitenkontext(`await api.storage.local.remove('pack');`);
  await bis('wieder Mosaik', async () => (await text('#preset-name')) === 'Mosaic');
  await setzePreset('mosaik');

  // Auftrag U, Session 12: UX-Funde im echten Firefox (Popup als Tab, Fenster 1280 px breit)
  pruefe((await text('#pack-hinweis')).length > 0, 'U Vorbereitung');
  // Fund 8: "All settings" oben, ueber der Pause-Taste
  const lage = await driver.executeScript(`const k = document.getElementById('alle-einstellungen').getBoundingClientRect(); const p = document.getElementById('pause').getBoundingClientRect(); return { kBis: k.bottom, pTop: p.top };`);
  pruefe(lage.kBis <= 80 && lage.kBis < lage.pTop, `Fund 8: All settings liegt bis y ${Math.round(lage.kBis)} px, ueber Pause (${Math.round(lage.pTop)} px)`);
  // Fund 27: Breite hoechstens 360 px, Schrift mindestens 12,5 px
  const mass = await driver.executeScript(`const w = [...document.querySelectorAll('.hinweis, .enden, .schalter small, .auch, footer')].map((e) => parseFloat(getComputedStyle(e).fontSize)); return { breite: document.body.getBoundingClientRect().width, klein: Math.min(...w) };`);
  pruefe(mass.breite <= 360 && mass.klein >= 12.5, `Fund 27: Breite ${mass.breite} px, kleinste Schrift ${mass.klein} px`);
  // Fund 12: sechs Kaestchen mit Zonennamen
  const namen = await driver.executeScript(`return [...document.querySelectorAll('#zonen input[data-bedeckt]')].map((e) => e.getAttribute('aria-label'))`);
  pruefe(namen.length === 6 && namen.every((n) => /^[A-Z][a-z]+: even when clothed$/.test(n)) && new Set(namen).size === 6, `Fund 12: ${namen.length} Namen (${namen[0]})`);
  // Fund 9 und 10: Kontraste (WCAG)
  const kontraste = await driver.executeScript(`const l = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const k = (a, b) => { const x = l(a), y = l(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const knopf = document.querySelector('button.klein'); const weiss = getComputedStyle(document.querySelector('section')).backgroundColor;
    const f = (e, p) => getComputedStyle(e)[p]; const feld = document.querySelector('.wahl input:not(:checked) + span'); const gew = document.querySelector('.wahl input:checked + span');
    return { knopf: k(f(knopf, 'color'), f(knopf, 'backgroundColor')), bahn: k(f(document.querySelector('.schalter input:not(:checked) + .regler'), 'backgroundColor'), weiss), rand: k(f(feld, 'borderTopColor'), weiss), randFeld: k(f(feld, 'borderTopColor'), f(feld, 'backgroundColor')), gewRand: k(f(gew, 'borderTopColor'), weiss), gewFuellung: k(f(gew, 'borderTopColor'), f(gew, 'backgroundColor')) };`);
  pruefe(kontraste.knopf >= 4.5 && kontraste.bahn >= 3 && kontraste.rand >= 3 && kontraste.randFeld >= 3 && kontraste.gewRand >= 3 && kontraste.gewFuellung >= 3, `Fund 9/10: ${Object.entries(kontraste).map(([n, v]) => n + ' ' + v.toFixed(2)).join(', ')}`);
  // Fund 6: Stimmungswort mit echten Tasten
  await oeffneGruppe();
  await driver.findElement(By.css('#stimmung')).sendKeys(Key.END);
  await bis('Stimmung 0.25 gespeichert', async () => Math.abs(((await speicher('einstellungen'))?.schwelle ?? 0) - 0.25) < 1e-6);
  pruefe((await text('#stimmung-wert')) === stimmungsWort(0.25) && (await driver.findElement(By.css('#stimmung')).getAttribute('aria-valuetext')) === stimmungsWort(0.25), `Fund 6: ${await text('#stimmung-wert')}`);
  await driver.findElement(By.css('#stimmung')).sendKeys(Key.HOME);
  await bis('Stimmung 0.10 gespeichert', async () => Math.abs(((await speicher('einstellungen'))?.schwelle ?? 0) - 0.1) < 1e-6);
  pruefe((await text('#stimmung-wert')) === STIMMUNG_WOERTER[0] + ' (my default)', 'Fund 6: Home zeigt das erste Wort');
  // Schnelle Folgeklicks (Pack mit allen Freischaltungen): drei Klicks im selben Augenblick
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 'test', version: '1.0.0', titel: 'Test', freischaltungen: ['stil:mia-patch', 'erwachsen:vorschau', 'erwachsen:ersatz'], bilder: 3, groesse: 100, importiert: 1 } });`);
  await bis('Erwachsenen-Schalter da', async () => await driver.findElement(By.css('#erw-an')).isDisplayed().catch(() => false) || (await eigenschaft('#erwachsen-schalter', 'hidden')) === false);
  const vor = await driver.executeScript(`return [document.getElementById('erw-an').checked, document.getElementById('erw-ersatz').checked, document.querySelector('input[data-zone="mouth"]').checked];`);
  await driver.executeScript(`document.getElementById('erw-an').click(); document.getElementById('erw-ersatz').click(); document.querySelector('input[data-zone="mouth"]').click();`);
  await bis('drei Klicks gespeichert', async () => {
    const e = await speicher('einstellungen');
    return e && e.erwachsen?.an === !vor[0] && e.erwachsen?.komplettErsatz === !vor[1] && e.zonen?.mouth?.an === !vor[2];
  });
  const nach = await driver.executeScript(`return [document.getElementById('erw-an').checked, document.getElementById('erw-ersatz').checked, document.querySelector('input[data-zone="mouth"]').checked];`);
  pruefe(nach.every((w, i) => w === !vor[i]), 'schnelle Folgeklicks: Speicher und Anzeige zeigen alle drei');
  // Fund 7: Verweis des Erwachsenen-Pack-Knopfs ist ohne Pack da; mit Pack fuehrt pack-link zu #stand (unten)
  // Fund 26: Speichern scheitert, Fehlersatz, Schalter springt zurueck (Seitenwelt ueberschreibt set)
  const ueberschrieben = await driver.executeScript(`try { const a = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser; a.storage.local.set = () => Promise.reject(new Error('kaputt')); return true; } catch (e) { return String(e); }`);
  if (ueberschrieben === true) {
    await oeffneGruppe();
    const strictVor = await driver.executeScript(`return document.getElementById('strict').checked`);
    await driver.findElement(By.css('label.schalter:has(#strict)')).click();
    await bis('Fehlersatz', async () => (await text('#fehler')) === FEHLER_SPEICHERN);
    pruefe((await driver.executeScript(`return document.getElementById('strict').checked`)) === strictVor, 'Fund 26: Fehlersatz, Strict springt auf den gespeicherten Stand zurueck');
  } else {
    pruefe(false, `Fund 26: Speicher-Override nicht moeglich (${ueberschrieben})`);
  }
  await imSeitenkontext(`await api.storage.local.remove('pack');`);

  // Fund 13: Satz vor und nach "Leave this site alone" (eine http-Seite ist der aktive Tab; das Popup wird danach neu geladen)
  const web = createServer((_, antwort) => antwort.end('<!doctype html><title>t</title><p>hi</p>')).listen(Number(process.env.VEIL_FIXTURE_PORT ?? 47533), '127.0.0.1');
  try {
    await oeffne(`http://localhost:${process.env.VEIL_FIXTURE_PORT ?? 47533}/`).catch(() => oeffne(`http://127.0.0.1:${process.env.VEIL_FIXTURE_PORT ?? 47533}/`));
    // Das Popup laedt neu, waehrend der http-Tab der gewaehlte ist (Umschalten des Treibers wuerde das Popup auswaehlen)
    await driver.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript(`const w = Services.wm.getMostRecentWindow('navigator:browser'); const t = w.gBrowser.tabs.find((x) => x.linkedBrowser.currentURI.spec.endsWith('/popup.html')); t.linkedBrowser.reload();`);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
    await warte(800);
    await driver.switchTo().window(popup);
    await bis('Ausnahme-Knopf frei', async () => (await driver.findElement(By.css('#ausnahme')).isEnabled()));
    const muster = (await text('#ausnahme-hinweis')).match(/^One tap, and I leave (\S+) alone/)?.[1] ?? '';
    pruefe(muster !== '' && (await text('#ausnahme-hinweis')) === T.AUSNAHME_VOR(muster), `Fund 13: vor dem Klick "${await text('#ausnahme-hinweis')}"`);
    await driver.findElement(By.css('#ausnahme')).click();
    await bis('Ausnahme gespeichert', async () => ((await speicher('einstellungen'))?.ausnahmen ?? []).includes(muster));
    await bis('Satz danach', async () => (await text('#ausnahme-hinweis')) === T.AUSNAHME_NACH(muster));
    pruefe((await text('#ausnahme')) === T.AUSNAHME_KNOPF_ZURUECK && (await text('#status')) === T.STATUS_AUSNAHME, 'Fund 13: nach dem Klick gilt es, Knopf und Status nennen es');
    await driver.findElement(By.css('#ausnahme')).click();
    await bis('Ausnahme entfernt', async () => !((await speicher('einstellungen'))?.ausnahmen ?? []).includes(muster));
  } finally {
    web.close();
  }

  // ---------- Phase 9, Paket A: Popup neu geordnet ----------
  {
    const gruppe = await driver.executeScript(`return document.getElementById('aendern').getAttribute('aria-expanded')`);
    pruefe(gruppe === 'true', 'Fund 2: der geoeffnete Zustand von "Change" blieb im localStorage (nach dem Neuladen noch offen)');
    await schliesseGruppe();
    pruefe((await text('#aendern')) === T.AENDERN_ZU && (await driver.findElement(By.css('#aendern')).getAttribute('aria-expanded')) === 'false', 'Fund 2: zu heisst "Change", aria-expanded false');
    pruefe(!(await driver.findElement(By.css('#stimmung')).isDisplayed()), 'Fund 2: Mood ist zugeklappt');
    const kurz = await text('#abdeckung-kurz');
    pruefe(/^I cover: .+\.$/.test(kurz), `Fund 2: Kurzfassung "${kurz}"`);
    const name = await text('#diese-seite-name');
    pruefe(name !== '' && (await text('#diese-seite')).includes(name), `Fund 2: This site nennt die Seite (${name})`);
    // Reihenfolge und Hoehe ohne Aufklappen (Fenster 1280 px breit, das Popup ist hoechstens 360 px breit)
    const lage = await driver.executeScript(`const y = (i) => Math.round(document.getElementById(i).getBoundingClientRect().top); return { pause: y('pause'), diese: y('diese-seite'), stil: y('stil-karte'), erw: y('erwachsen'), hoehe: Math.ceil(document.body.getBoundingClientRect().height), breite: document.body.getBoundingClientRect().width };`);
    pruefe(lage.pause < lage.diese && lage.diese < lage.stil && lage.stil < lage.erw, `Fund 2: Reihenfolge Pause ${lage.pause}, This site ${lage.diese}, Cover ${lage.stil}, Adult ${lage.erw}`);
    pruefe(lage.hoehe <= 600 && lage.breite <= 360, `Fund 2: Hoehe ohne Aufklappen ${lage.hoehe} px bei ${lage.breite} px Breite (hoechstens 600)`);
    console.log(`firefox: Popup ohne Aufklappen ${lage.hoehe} px hoch, ${lage.breite} px breit`);
    await oeffneGruppe();
    pruefe(await driver.findElement(By.css('#zonen')).isDisplayed(), 'Fund 2: "Change" klappt die Zonen auf');
    await schliesseGruppe();

    // Fund 15: das Kuerzel, wie der Browser es meldet; Fund 17 und 16
    const kuerzel = await imSeitenkontext(`const b = await api.commands.getAll(); return b.find((x) => x.name === 'pause-umschalten')?.shortcut ?? '';`);
    pruefe(kuerzel !== '' && (await text('#pause-kuerzel')) === T.PAUSE_KUERZEL(kuerzel), `Fund 15: Kuerzel "${await text('#pause-kuerzel')}" (Browser: ${kuerzel})`);
    pruefe(!(await driver.findElement(By.css('#pause-zeile')).isDisplayed()), 'Fund 17: ohne Pause keine Pausenzeile');
    await driver.findElement(By.css('#pause')).click();
    await bis('Pausenzeile', async () => (await text('#pause-zeile')) === T.PAUSE_ZEILE);
    const dimm = await bis('Karten blasser', async () => (await driver.executeScript(`return Number(getComputedStyle(document.getElementById('stil-karte')).opacity)`)) < 1 && true);
    pruefe(dimm === true && Math.abs((await driver.executeScript(`return Number(getComputedStyle(document.getElementById('stil-karte')).opacity)`)) - 0.7) < 0.01, 'Fund 17: im Pausenzustand Pausenzeile und Karten mit Deckkraft 0,7');
    await driver.findElement(By.css('#pause')).click();
    await bis('Pause aus', async () => (await speicher('einstellungen'))?.pause === false);
    await bis('Pausenzeile weg', async () => !(await driver.findElement(By.css('#pause-zeile')).isDisplayed()));
    const href = (id) => driver.executeScript(`const a = document.getElementById(arguments[0]); return [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')];`, id);
    const un = await href('deinstallieren');
    const ve = await href('version');
    pruefe(un[0] === 'hilfe.html#uninstall' && un[1] === '_blank' && un[2].includes('noopener'), `Fund 16: "uninstalling" fuehrt zu ${un[0]}`);
    pruefe(ve[0] === 'hilfe.html#updates' && ve[1] === '_blank' && ve[2].includes('noopener') && /^v\d/.test(await text('#version')), `Fund 16: die Version ist ein Link auf ${ve[0]}`);

    // Fund 12 (Popup), 10 und 1: Pack mit Werbe-Tausch, Vorschau und Steigerung
    await imSeitenkontext(`await api.storage.local.set({ pack: { id: 'test', version: '1.0.0', titel: 'Test', freischaltungen: ['stil:mia-patch', 'erwachsen:vorschau', 'erwachsen:ersatz', 'zensur:steigerung', 'kontrolle:werbung'], bilder: 3, groesse: 100, importiert: 1 } });`);
    await bis('Werbe-Frage da', async () => driver.findElement(By.css('#popup-werbung-frage')).isDisplayed());
    pruefe((await text('#popup-werbung-frage-titel')) === 'Show my ads?' && (await text('#popup-werbung-frage-ja')) === 'Yes, show them' && (await text('#popup-werbung-frage-nein')) === 'No ads', 'Fund 12: Karte mit den Saetzen der Einstellungsseite');
    const ordnung = await driver.executeScript(`return ['pause', 'popup-werbung-frage', 'diese-seite'].map((i) => document.getElementById(i).getBoundingClientRect().top);`);
    pruefe(ordnung[0] < ordnung[1] && ordnung[1] < ordnung[2], 'Fund 12: die Karte liegt unter der Pause und ueber This site');
    await driver.findElement(By.css('#popup-werbung-frage-ja')).click();
    await bis('Antwort gespeichert', async () => {
      const k = (await speicher('einstellungen'))?.kontrolle;
      return k?.werbung === true && k?.werbungGefragt === true;
    });
    await bis('Karte weg', async () => !(await driver.findElement(By.css('#popup-werbung-frage')).isDisplayed()));
    pruefe(true, 'Fund 12: Ja speichert werbung und werbungGefragt, die Karte verschwindet');
    pruefe((await text('#pack-link')) === T.PACK_KNOPF_MIT && (await driver.executeScript(`return !!document.getElementById('pack-link').closest('footer')`)), 'Fund 1/18: mit Pack steht "Mia Pack settings" im Fuss');
    await bis('How hot da', async () => driver.findElement(By.css('#heiss')).isDisplayed());
    await driver.findElement(By.css('#heiss label:has(input[value="tease"])')).click();
    await bis('Tease gespeichert', async () => (await speicher('einstellungen'))?.erwachsen?.stufe === 'tease');
    await driver.findElement(By.css('#heiss label:has(input[value="explicit"])')).click();
    await bis('Explicit gespeichert', async () => (await speicher('einstellungen'))?.erwachsen?.stufe === 'explicit');
    pruefe(await driver.executeScript(`return document.querySelector('#heiss input[value="explicit"]').checked`), 'Fund 10: How hot wird gespeichert und angezeigt');
    const gh = await href('grip-hilfe');
    pruefe(gh[0] === 'hilfe.html#grip' && gh[1] === '_blank' && gh[2].includes('noopener') && (await text('#grip-satz')) === T.GRIP_SATZ, `Fund 10: My grip mit "?" auf ${gh[0]} und dem Satz`);
    await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen']);`);
    await bis('ohne Pack wieder', async () => (await text('#pack-link')) === T.PACK_KNOPF_OHNE);
    pruefe((await text('#erwachsen-pack-link')) === 'Get the Mia Pack', 'Fund 1: ohne Pack heissen beide Knoepfe "Get the Mia Pack"');
  }

  // Fund 7 und Nr 8: Pack-Knoepfe fuehren zu #neu und #stand; die offene Einstellungsseite wird wiederverwendet (kein zweiter Tab)
  const tabsVor = await driver.getAllWindowHandles();
  await driver.findElement(By.css('#pack-link')).click();
  const options = await bis('Einstellungsseite geoeffnet', async () => (await driver.getAllWindowHandles()).find((h) => !tabsVor.includes(h)));
  await driver.switchTo().window(options);
  await bis('Einstellungsseite #neu', async () => (await driver.getCurrentUrl()).endsWith('/options.html#neu'));
  pruefe((await driver.getCurrentUrl()).endsWith('/options.html#neu'), 'Fund 7: pack-link oeffnet options.html#neu (ohne Pack)');
  const imBlick = (anker) => driver.executeScript(`const r = document.getElementById(arguments[0]).getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight;`, anker);
  await bis('#neu im Blick', async () => imBlick('neu'));
  pruefe(true, 'Fund 7: Abschnitt #neu liegt im Blick');
  const nachErstem = (await driver.getAllWindowHandles()).length;
  await driver.switchTo().window(popup).catch(() => {});
  const popup2 = await oeffne('popup.html');
  await bis('Popup 2 gezeichnet', async () => (await text('#status')).length > 0);
  await driver.findElement(By.css('#erwachsen-pack-link')).click();
  await bis('Einstellungsseite wiederverwendet', async () => (await driver.getAllWindowHandles()).length <= nachErstem);
  pruefe((await driver.getAllWindowHandles()).length <= nachErstem, 'Nr 8: erwachsen-pack-link nutzt den offenen Options-Tab (Tabs ' + (await driver.getAllWindowHandles()).length + ')');
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 'test', version: '1.0.0', titel: 'Test', freischaltungen: ['stil:mia-patch'], bilder: 3, groesse: 100, importiert: 1 } });`).catch(() => {});
  await driver.switchTo().window(options);
  await driver.executeScript(`location.hash = '';`);
  await driver.switchTo().window(popup2).catch(() => {});
  const popup3 = await oeffne('popup.html');
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 'test', version: '1.0.0', titel: 'Test', freischaltungen: ['stil:mia-patch'], bilder: 3, groesse: 100, importiert: 1 } });`);
  await bis('Knopf mit Pack', async () => (await text('#pack-link')) === T.PACK_KNOPF_MIT);
  await driver.findElement(By.css('#pack-link')).click();
  await driver.switchTo().window(options);
  await bis('Einstellungsseite #stand', async () => (await driver.getCurrentUrl()).endsWith('/options.html#stand'));
  pruefe((await driver.getCurrentUrl()).endsWith('/options.html#stand'), 'Fund 7: pack-link oeffnet options.html#stand (mit Pack)');
  await bis('#stand im Blick', async () => imBlick('stand'));
  pruefe(true, 'Fund 7: Abschnitt #stand liegt im Blick');
  await driver.switchTo().window(popup3).catch(() => {});
  await imSeitenkontext(`await api.storage.local.remove('pack');`).catch(() => {});
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: popup.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
