// Firefox-Test Auftrag L (PHASE-6-AUFTRAEGE-SESSION-11 Abschnitt 5): Mia’s Ledger. Gleiche Faelle wie Chromium: Senden, Ereignisse, Zeitgeber,
// Tageswechsel, Absender und Werte, Minute und Stufe, Popup-Zeile, Einstellungsseite mit Loeschen. Gemessen wird immer im Speicher.

import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_TITEL, LOESCHEN_FERTIG, popupZeile } from '../../src/ledger/texte.ts';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 300 s ueberschritten');
  process.exit(1);
}, 300_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47423);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const seite = (query = '') => `${basis}/ledger.html${query}`;

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
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
async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 600)})`);
}

let driver;
let server;
let ordner;
const uuid = randomUUID();
let hauptFenster;

async function oeffneErweiterung(seiteName) {
  const vorher = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow('navigator:browser');
       w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/${seiteName}`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error(`Erweiterungsseite ${seiteName} nicht geoeffnet`);
  await driver.switchTo().window(neu);
  await bis('Erweiterungsseite geladen', async () => {
    try {
      return await driver.executeScript(`return document.readyState === 'complete' && !!(window.browser || window.chrome) && location.protocol === 'moz-extension:'`);
    } catch {
      return false;
    }
  });
}
async function zurueckZumHaupt() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1 && !alle[0]?.startsWith?.('x')) {
    await driver.close();
  }
  await driver.switchTo().window(hauptFenster);
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

// Aktion auf einer Erweiterungsseite (Einstellungen setzen, Pack importieren), danach zurueck zur Webseite.
async function mitOptionen(fn) {
  await oeffneErweiterung('options.html');
  try {
    return await fn();
  } finally {
    await zurueckZumHaupt();
  }
}
const setzeEinstellungen = (neu) =>
  mitOptionen(() =>
    imSeitenkontext(
      `const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
       await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } });
       return true;`,
      neu,
    ),
  );
const loescheEinstellungen = () => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove('einstellungen'); return true;`));
const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();

const importierePack = (pfad) =>
  mitOptionen(async () => {
    await driver.findElement(By.css('#datei')).sendKeys(pfad);
    await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Erfolgsmeldung', async () => (await text('#meldung')).includes('The pack is in'));
  });
const entfernePack = () =>
  mitOptionen(async () => {
    await bis('Optionsseite da', async () => (await text('#pack-status').catch(() => '')).length > 0);
    await warte(300);
    if (await sichtbar('#entfernen')) {
      await driver.findElement(By.css('#entfernen')).click();
      await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
      await driver.findElement(By.css('#entfernen-ja')).click();
      await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));
    }
  });


const liesSpeicher = (k) => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]] ?? null;`, k));
const schreibe = (k, w) => mitOptionen(() => imSeitenkontext(`await api.storage.local.set({ [args[0]]: args[1] }); return true;`, k, w));
const ledger = () => liesSpeicher('ledger');
const ledger_aufSeite = () => imSeitenkontext(`return (await api.storage.local.get('ledger')).ledger ?? null;`);
const vonOptionen = (nachricht) => mitOptionen(() => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, nachricht));
const loesche = () => vonOptionen({ ziel: 'hintergrund', typ: 'ledger-loeschen' });
const minute = (erwachsen) => vonOptionen({ ziel: 'hintergrund', typ: 'steigerung-minute', erwachsen, zensiert: 0 });
const abbild = async () => {
  const t = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-ledger')`);
  return t ? JSON.parse(t) : null;
};
const testEreignis = (l) => driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ledger: JSON.parse(arguments[0]) }) }))`, JSON.stringify(l));
async function oeffne(mitBild = false) {
  await driver.get(seite(mitBild ? '' : '?ohne'));
  await bis('Testspur da', () => driver.executeScript(`return document.documentElement.hasAttribute('data-veil-ledger')`));
}
async function bisGesamt(zaehler, soll, frist = 15_000) {
  let l;
  try {
    return await bis(`${zaehler} == ${soll}`, async () => ((l = await ledger())?.gesamt?.[zaehler] === soll ? l : false), frist);
  } catch (e) {
    throw new Error(`${e.message}`);
  }
}
const stufeStand = (stufe) => ({ version: 1, stufe, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null });

let code = 0;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.setContext(firefox.Context.CHROME).catch(() => {});
  await driver.setContext(firefox.Context.CONTENT);
  await driver.executeScript('return 1');
  await driver.switchTo().window(hauptFenster);
  await driver.manage();
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await warte(1500);

  // 1. Stand da
  pruefe((await loesche()).ok === true, 'ledger-loeschen von der Einstellungsseite ok');
  let l = await ledger();
  pruefe(l.seit > 0 && /^\d{4}-\d{2}-\d{2}$/.test(l.tag) && Object.values(l.gesamt).every((v) => v === 0), 'Stand mit seit, Tag und Nullen');
  console.log(`firefox ledger: Stand da, ${Object.keys(l.gesamt).length} Zaehler`);

  // 2. Verdecktes Bild: nichts vor dem Senden, danach zensiert >= 1
  const bild = path.join(wurzel, '..', '05 Testbilder', 'nsfw', 'IMG_0260.jpg');
  if (!existsSync(bild) && process.env.VEIL_OHNE_TESTBILDER === '1') console.log('firefox ledger: AUSNAHME VEIL_OHNE_TESTBILDER=1: Bildfall uebersprungen');
  else {
    if (!existsSync(bild)) throw new Error('braucht ../05 Testbilder/nsfw/IMG_0260.jpg');
    await oeffne(true);
    await bis('Bild zensiert', () => driver.executeScript(`return document.getElementById('bild')?.getAttribute('data-veil') === 'zensiert'`), 60_000);
    await warte(1500);
    // Nur das Abbild der Seite lesen: ein Blick in den Speicher ueber einen zweiten Tab verbirgt die Seite und loest das Senden beim Verbergen aus.
    const vor = await abbild();
    pruefe(vor.nachrichten === 0 && vor.gepuffert === true, `vor dem Senden nichts gesendet (Nachrichten ${vor.nachrichten}, gepuffert ${vor.gepuffert})`);
    await testEreignis({ senden: true });
    await bis('zensiert >= 1', async () => ((await ledger()).gesamt.zensiert ?? 0) >= 1);
    l = await ledger();
    pruefe(l.heute.zensiert === l.gesamt.zensiert, 'heute gleich gesamt');
    console.log(`firefox ledger: zensiert heute ${l.heute.zensiert}, gesamt ${l.gesamt.zensiert} nach dem Senden`);
  }

  // 3. Jede Ereignisart
  await loesche();
  await oeffne();
  const arten = [
    [{ art: 'zensiert' }, 'zensiert', 1], [{ art: 'quiz-richtig' }, 'quizGeloest', 1], [{ art: 'quiz-falsch' }, 'quizFalsch', 1],
    [{ art: 'quiz-verweigert' }, 'quizVerweigert', 1], [{ art: 'werbung' }, 'werbung', 1], [{ art: 'blitz', woerter: 4 }, 'blitzwoerter', 4],
    [{ art: 'spirale' }, 'spiralen', 1], [{ art: 'besuch' }, 'besuche', 1],
  ];
  for (const [e, z, n] of arten) {
    const vorher = (await ledger()).gesamt[z];
    const nach0 = (await abbild()).nachrichten;
    await testEreignis({ ereignis: e });
    await bisGesamt(z, vorher + n);
    const ab = await abbild();
    // Ohne Zeitgeber geht die Nachricht sofort: Abstand zwischen erstem Ereignis und Sendung weit unter dem Zeitgeber
    pruefe(ab.nachrichten === nach0 + 1 && ab.gesendetMs - ab.ersteMs < 500, `${z}: sofort gesendet (${Math.round(ab.gesendetMs - ab.ersteMs)} ms, Nachrichten ${ab.nachrichten})`);
  }
  await testEreignis({ ereignis: { art: 'quiz-start' } });
  await warte(500);
  const summe = Object.values((await ledger()).gesamt).reduce((a, b) => a + b, 0);
  pruefe(summe === 11, `Summe ${summe}, quiz-start zaehlt nicht`);
  console.log(`firefox ledger: ${arten.length} Arten gezaehlt, Summe ${summe}`);

  // 4. Zeitgeber: drei Ereignisse, eine Nachricht, erst nach dem Abstand. Nur das Abbild der Seite lesen (ein Blick in den Speicher ueber
  // einen zweiten Tab verbirgt die Seite und loest das Senden beim Verbergen aus).
  await loesche();
  await oeffne();
  for (let i = 0; i < 3; i++) await testEreignis({ takt: 1500, ereignis: { art: 'spirale' } });
  await warte(600);
  const vorZ = await abbild();
  pruefe(vorZ.nachrichten === 0 && vorZ.gepuffert === true, `vor dem Zeitgeber nichts gesendet (Nachrichten ${vorZ.nachrichten})`);
  const nachZ = await bis('Zeitgeber hat gesendet', async () => {
    const a = await abbild();
    return a && a.nachrichten >= 1 ? a : false;
  }, 10_000);
  const abstandZ = nachZ.gesendetMs - nachZ.ersteMs;
  pruefe(nachZ.nachrichten === 1 && nachZ.letzte.spiralen === 3 && abstandZ >= 1450, `eine Nachricht mit 3 Spiralen, ${Math.round(abstandZ)} ms nach dem ersten Ereignis`);
  await bisGesamt('spiralen', 3, 10_000);
  console.log(`firefox ledger: 3 Ereignisse in 1 Nachricht, ${Math.round(abstandZ)} ms nach dem ersten Ereignis (Zeitgeber 1500 ms)`);

  // 4b. Verbergen der Seite sendet den Puffer (Zeitgeber steht auf 60 s)
  await loesche();
  await oeffne();
  await testEreignis({ takt: 60_000, ereignis: { art: 'besuch' } });
  const vorV = await abbild();
  pruefe(vorV.nachrichten === 0 && vorV.gepuffert === true, 'Verbergen: vorher gepuffert, nichts gesendet');
  const tV = Date.now();
  await bisGesamt('besuche', 1, 15_000); // der Blick in den Speicher oeffnet einen Tab und verbirgt die Seite
  const nachV = await abbild();
  pruefe(nachV.nachrichten === 1 && nachV.gesendetMs - nachV.ersteMs < 10_000, `Verbergen sendet (${Math.round(nachV.gesendetMs - nachV.ersteMs)} ms nach dem Ereignis, Zeitgeber 60000 ms)`);
  console.log(`firefox ledger: Verbergen sendete den Puffer nach ${Math.round(nachV.gesendetMs - nachV.ersteMs)} ms (Zeitgeber 60000 ms), Wartezeit des Tests ${Date.now() - tV} ms`);

  // 5. Tageswechsel
  l = await ledger();
  await schreibe('ledger', { ...l, tag: '2020-01-01', heute: { ...l.heute, zensiert: 5 }, gesamt: { ...l.gesamt, zensiert: 5 } });
  await oeffne();
  await testEreignis({ ereignis: { art: 'besuch' } });
  await bis('neuer Tag', async () => (await ledger()).tag !== '2020-01-01');
  l = await ledger();
  pruefe(l.heute.zensiert === 0 && l.gesamt.zensiert === 5 && l.heute.besuche === 1, `Tageswechsel heute ${l.heute.zensiert}, gesamt ${l.gesamt.zensiert}`);
  console.log(`firefox ledger: neuer Tag ${l.tag}, heute zensiert ${l.heute.zensiert}, gesamt ${l.gesamt.zensiert}`);

  // 6. Absender und Werte
  await loesche();
  await oeffne();
  const roh = async (n) => {
    await testEreignis({ roh: n });
    return (await bis('Roh-Antwort', async () => {
      const a = await abbild();
      return a && a.rohAntwort && a.rohAntwort !== 'wartet' ? a : false;
    })).rohAntwort;
  };
  l = await ledger();
  await schreibe('ledger', { ...l, gesamt: { ...l.gesamt, besuche: 7 } });
  pruefe((await roh({ ziel: 'hintergrund', typ: 'ledger-loeschen' })).ok === false && (await ledger()).gesamt.besuche === 7, 'Loeschen aus Content abgelehnt');
  const schlecht = [10_001, -3, 1.5].map((w) => ({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: w } }));
  const abgelehnt = [];
  for (const n of schlecht) abgelehnt.push((await roh(n)).ok);
  pruefe(abgelehnt.every((x) => x === false), `Unsinn-Summen abgelehnt ${abgelehnt}`);
  pruefe((await roh({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: 2, fremd: 9, erwachsenMinuten: 99 } })).ok === true, 'gute Summe ok');
  l = await ledger();
  pruefe(l.gesamt.zensiert === 2 && l.gesamt.erwachsenMinuten === 0 && !JSON.stringify(l).includes('fremd'), 'nur bekannte Schluessel, erwachsenMinuten nicht aus Content');
  pruefe((await vonOptionen({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: 5 } })).ok === false && (await ledger()).gesamt.zensiert === 2, 'Summe aus Erweiterungsseite abgelehnt');
  console.log('firefox ledger: Loeschen aus Content abgelehnt, 3 Unsinn-Summen abgelehnt, Summe aus Erweiterungsseite abgelehnt, 2 gezaehlt');

  // 7. Minute und Stufe
  await loesche();
  await schreibe('ledgerMinute', -1);
  for (let i = 0; i < 3; i++) {
    const m0 = Math.floor(Date.now() / 60_000);
    await minute(true);
    await minute(true);
    if (Math.floor(Date.now() / 60_000) === m0) break;
    await loesche();
    await schreibe('ledgerMinute', -1);
  }
  pruefe((await ledger()).gesamt.erwachsenMinuten === 1, 'zwei Meldungen in einer Minute ergeben 1');
  await minute(false);
  pruefe((await ledger()).gesamt.erwachsenMinuten === 1, 'Nicht-Erwachsenen-Minute zaehlt nicht');
  await schreibe('ledgerMinute', -1);
  await setzeEinstellungen({ pause: true });
  await minute(true);
  pruefe((await ledger()).gesamt.erwachsenMinuten === 1, 'in der Pause zaehlt nichts');
  await setzeEinstellungen({ pause: false });
  await schreibe('steigerung', stufeStand(3));
  await minute(false);
  pruefe((await ledger()).hoechsteStufe === 3, 'hoechste Stufe 3');
  await schreibe('steigerung', stufeStand(1));
  await minute(false);
  pruefe((await ledger()).hoechsteStufe === 3, 'hoechste Stufe bleibt 3');
  console.log('firefox ledger: 2 Meldungen in einer Minute ergeben 1, Pause 0, hoechste Stufe 3 bleibt bei Stufe 1');

  // 8. Popup-Zeile
  await loesche();
  await oeffneErweiterung('popup.html');
  try {
    await bis('Popup-Zeile 0', async () => (await text('#ledger-kurz')).length > 0);
    const null_ = await text('#ledger-kurz');
    l = await (async () => {
      await zurueckZumHaupt();
      return ledger();
    })();
    await schreibe('ledger', { ...l, heute: { ...l.heute, zensiert: 34 }, gesamt: { ...l.gesamt, zensiert: 34 } });
    await oeffneErweiterung('popup.html');
    await bis('Popup-Zeile 34', async () => (await text('#ledger-kurz')).includes('34'));
    pruefe(null_ === popupZeile(0), `Popup bei 0: "${null_}"`);
    pruefe((await text('#ledger-kurz')) === popupZeile(34), 'Popup bei 34');
    console.log(`firefox ledger: Popup-Zeile "${await text('#ledger-kurz')}"`);
  } finally {
    await zurueckZumHaupt();
  }

  // 9. Einstellungsseite
  await loesche();
  l = await ledger();
  await schreibe('ledger', { ...l, hoechsteStufe: 2, heute: { ...l.heute, zensiert: 12 }, gesamt: { ...l.gesamt, zensiert: 340, besuche: 3 } });
  await oeffneErweiterung('options.html');
  try {
    await bis('Ledger-Zahlen', async () => (await text('#ledger-gesamt-zensiert')) === '340');
    pruefe((await text('#ledger-heute-zensiert')) === '12' && (await text('#ledger-gesamt-besuche')) === '3' && (await text('#ledger-stufe')) === '2', 'Zahlen angezeigt');
    pruefe((await text('#ledger-titel')).toLowerCase() === LEDGER_TITEL.toLowerCase() && (await text('#ledger-satz-zensiert')).length > 5 && (await text('#ledger-seit')).includes('With me since'), 'Titel, Satz, seit');
    pruefe(!(await sichtbar('#ledger-frage')), 'Rueckfrage anfangs zu');
    await driver.findElement(By.css('#ledger-loeschen')).click();
    await bis('Rueckfrage sichtbar', () => sichtbar('#ledger-frage'));
    await driver.findElement(By.css('#ledger-nein')).click();
    await bis('Rueckfrage zu', async () => !(await sichtbar('#ledger-frage')));
    pruefe((await ledger_aufSeite()).gesamt.zensiert === 340, 'Nein behaelt 340');
    const vorher = Date.now();
    await driver.findElement(By.css('#ledger-loeschen')).click();
    await driver.findElement(By.css('#ledger-ja')).click();
    await bis('Meldung', async () => (await text('#ledger-meldung')) === LOESCHEN_FERTIG);
    await bis('Anzeige 0', async () => (await text('#ledger-gesamt-zensiert')) === '0');
    const nach = await ledger_aufSeite();
    pruefe(Object.values(nach.gesamt).every((v) => v === 0) && nach.hoechsteStufe === 0 && nach.seit >= vorher - 2000, 'Ja setzt alles auf 0');
    console.log('firefox ledger: Nein behielt 340, Ja setzte alle 9 Zaehler und die Stufe auf 0');
  } finally {
    await zurueckZumHaupt();
  }
} catch (e) {
  console.error('firefox: FEHLER', e?.stack ?? e);
  code = 1;
} finally {
  try {
    await driver?.quit();
  } catch {
    // egal
  }
  await server?.close?.();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox ledger: ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
