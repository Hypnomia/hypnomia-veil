// Firefox-Test Phase 5, Auftrag L (PHASE-5-AUFTRAEGE-SESSION-9 Abschnitt 5): Leerlauf-Spirale. Der Testhaken `veil-test` spielt idle und active vor
// (Hintergrund `leerlauf-test`, dann echte Nachricht `inhalt/leerlauf` an die oberste Seite). Gemessen werden Zeit bis sichtbar, Einblenden, echte
// Streifenfrequenz aus dem gezeichneten Winkel, Zeit bis zum Ende bei Maus, Taste, Klick, Pause, Warnkarte, verborgenem Tab und alle Faelle ohne
// Spirale. Firefox zaehlt nur den sichtbaren Tab als sichtbar: gewartet wird immer im Tab der Seite.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47393);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const seite = (query = '') => `${basis}/spirale.html${query}`;

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


// ---------- Hilfen fuer die Spirale ----------
let nr = 100;
const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: true, leerlaufMinuten: 2 };
const setzeKontrolle = (teil) => setzeEinstellungen({ kontrolle: { ...KONTROLLE, ...teil } });
const setzeWarnung = (gesehen) =>
  mitOptionen(() =>
    imSeitenkontext(
      gesehen
        ? `await api.storage.local.set({ spiraleWarnungGesehen: true }); return true;`
        : `await api.storage.local.remove(['spiraleWarnungGesehen', 'quizWarnungGesehen']); return true;`,
    ),
  );
const liesSpeicher = (schluessel) => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]] ?? null;`, schluessel));
const abbild = async () => {
  const t = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-spirale')`);
  return t ? JSON.parse(t) : null;
};
async function bisAbbild(beschreibung, pruefFn, frist = 15_000, schritt = 15) {
  const t0 = Date.now();
  let a = null;
  while (Date.now() - t0 < frist) {
    a = await abbild();
    if (a && pruefFn(a)) return a;
    await warte(schritt);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen, letztes Abbild ${JSON.stringify(a)?.slice(0, 400)}`);
}
async function sende(zustand) {
  const n = ++nr;
  await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { zustand: arguments[0], nr: arguments[1] } }) }))`, zustand, n);
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    const a = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-spirale-antwort')`);
    if (a && JSON.parse(a).nr === n) return JSON.parse(a).antwort ?? { ok: false };
    await warte(10);
  }
  throw new Error('keine Antwort des Hintergrunds');
}
const hostAnzahl = () => driver.executeScript(`return document.querySelectorAll('[data-veil-spirale-host]').length`);
const zaehler = () => driver.executeScript(`return window.zaehler`);
const capture = () => driver.executeScript(`return window.zaehlerCapture`);
const einstellungImTab = (teil) => driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ einstellungen: arguments[0] }) }))`, teil);
const pfad = () => driver.executeScript(`return location.pathname`);
async function oeffne(query = '') {
  await driver.get(seite(query));
  await bis('Testspur da', () => driver.executeScript(`return document.documentElement.hasAttribute('data-veil-spirale')`));
  await driver.actions({ async: true }).move({ x: 150, y: 130, origin: 'viewport' }).perform();
  await warte(300);
}
async function idleUndEntscheidung() {
  const vorher = (await abbild())?.entscheidungen ?? 0;
  const t0 = Date.now();
  const antwort = await sende('idle');
  if (!antwort.gesendet) return { a: await abbild(), ms: Date.now() - t0, antwort };
  const a = await bisAbbild('Entscheidung', (x) => x.entscheidungen > vorher);
  return { a, ms: Date.now() - t0, antwort };
}
async function zeigeSpirale() {
  const { a, ms } = await idleUndEntscheidung();
  pruefe(a.ergebnis === 'spirale', `Spirale erwartet, Ergebnis ${a.ergebnis}`);
  await bisAbbild('zeichnet', (x) => (x.bilder ?? 0) > 1);
  return ms;
}
async function bisWeg(t0) {
  await bisAbbild('Spirale weg', (x) => x.phase === 'ruhend', 5000, 5);
  const ms = Date.now() - t0;
  pruefe((await hostAnzahl()) === 0, 'Host nach dem Ende weg');
  return ms;
}
async function ruheWieder() {
  await sende('active');
  await warte(400);
}
const hzAus = (x1, x2) => (x2.arme * (x2.winkel - x1.winkel)) / (2 * Math.PI) / ((x2.winkelZeit - x1.winkelZeit) / 1000);
const aktionen = () => driver.actions({ async: true });
const mitte = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), origin: 'viewport' });

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-spirale-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`firefox: Version ${version}`);
  await driver.setContext(firefox.Context.CHROME).catch(() => {});
  await driver.setContext(firefox.Context.CONTENT);
  await driver.executeScript('return 1');
  await driver.switchTo().window(hauptFenster);
  await driver.manage();
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await warte(1500);
  await loescheEinstellungen();

  // 1. Ohne Pack: nichts
  await oeffne();
  let antwort = await sende('idle');
  await warte(500);
  pruefe(antwort.gesendet === false && (await hostAnzahl()) === 0 && (await abbild()).entscheidungen === 0, 'ohne Pack: Hintergrund sendet nichts, keine Spirale');
  console.log('firefox spirale: ohne Pack 0 Nachrichten, 0 Hosts');

  // 2. Pack, Einstellungen
  await importierePack(packPfad);
  await setzeKontrolle({});
  await setzeWarnung(true);

  // 3. Spirale: sichtbar, Deckung, Satz, Einblenden, Streifenfrequenz, Aufloesung
  await oeffne();
  const tSicht = Date.now();
  await zeigeSpirale();
  const a1 = await bisAbbild('Deckkraft ueber 5 Prozent', (x) => (x.deckkraft ?? 0) > 0.05, 5000, 5);
  const hell = await bisAbbild('Deckkraft ueber 50 Prozent', (x) => (x.deckkraft ?? 0) > 0.5, 5000, 5);
  const msSichtbar = Date.now() - tSicht;
  pruefe(hell.deckkraft > 0.5, 'sichtbar heisst Deckkraft ueber 0,5');
  pruefe(a1.satz === 'Test idle line.' && a1.phase === 'spirale', 'Satz aus dem Pack und Phase spirale');
  const gross = await driver.executeScript(`return { b: innerWidth, h: innerHeight, oben: !!document.elementFromPoint(150, 130)?.hasAttribute('data-veil-spirale-host') }`);
  pruefe(a1.host.x === 0 && a1.host.y === 0 && a1.host.w === gross.b && a1.host.h === gross.h && gross.oben, 'Spirale deckt den ganzen Sichtbereich, liegt ueber dem Link');
  const a2 = await bisAbbild('Deckkraft plus 0,2', (x) => (x.deckkraft ?? 0) > a1.deckkraft + 0.2, 5000);
  const steigung = ((a2.deckkraft - a1.deckkraft) / (a2.jetzt - a1.jetzt)) * 1200;
  pruefe(steigung <= 1.08, `Einblenden mindestens 1200 ms (Steigung*1200 ${steigung.toFixed(2)})`);
  await bisAbbild('voll', (x) => x.deckkraft === 1, 5000);
  const b1 = await abbild();
  await warte(2000);
  const b2 = await abbild();
  const hz = hzAus(b1, b2);
  pruefe(hz <= 2.5 && hz > 0.9, `Streifenfrequenz ${hz.toFixed(2)} Hz im Rahmen`);
  pruefe(Math.max(b2.aufloesung.breite, b2.aufloesung.hoehe) <= 1280, 'Aufloesung hoechstens 1280');
  console.log(`firefox spirale: sichtbar (Deckkraft ueber 0,5) nach ${msSichtbar} ms, Einblenden Steigung*1200 ${steigung.toFixed(2)}, Streifenfrequenz ${hz.toFixed(2)} Hz (Grenze 2,5), Aufloesung ${b2.aufloesung.breite}x${b2.aufloesung.hoehe}`);

  // 4. Maus beendet; Sperre bis active
  await ruheWieder();
  await zeigeSpirale();
  let t0 = Date.now();
  await aktionen().move({ x: 300, y: 300, origin: 'viewport' }).perform();
  const msMaus = await bisWeg(t0);
  const nochmal = await idleUndEntscheidung();
  pruefe(nochmal.a.ergebnis === 'gesperrt' && (await hostAnzahl()) === 0, 'zweites idle ohne active: gesperrt');
  await ruheWieder();
  console.log(`firefox spirale: Maus beendet nach ${msMaus} ms (inklusive Abfrage)`);

  // 5. Taste: Seite sieht kein keydown
  await zeigeSpirale();
  t0 = Date.now();
  await aktionen().sendKeys('a').perform();
  const msTaste = await bisWeg(t0);
  let z = await zaehler();
  let c = await capture();
  pruefe(z.keydown === 0 && z.keyup === 0 && c.keydown + c.keyup + c.keypress === 0, `Taste: Seite zaehlt keydown ${z.keydown}, keyup ${z.keyup}, frueher Horcher ${c.keydown}/${c.keyup}/${c.keypress}`);
  console.log(`firefox spirale: Taste beendet nach ${msTaste} ms, Seite zaehlt keydown ${z.keydown}, keyup ${z.keyup}`);
  await ruheWieder();

  // 6. Klick: Link wird nicht ausgeloest
  await oeffne();
  await zeigeSpirale();
  t0 = Date.now();
  await aktionen().press().perform();
  const msKlick = await bisWeg(t0);
  await aktionen().release().perform();
  await warte(500);
  z = await zaehler();
  pruefe((await pfad()) === '/spirale.html' && z.linkClick === 0 && z.click === 0 && z.mousedown === 0 && z.mouseup === 0, `Klick: Link ${z.linkClick}, click ${z.click}, mousedown ${z.mousedown}, mouseup ${z.mouseup}, Pfad ${await pfad()}`);
  c = await capture();
  pruefe(c.pointerdown + c.pointerup + c.mousedown + c.mouseup + c.click === 0, `Klick: frueher Fenster-Horcher pointerdown ${c.pointerdown}, mousedown ${c.mousedown}, mouseup ${c.mouseup}, click ${c.click}`);
  console.log(`firefox spirale: Klick beendet nach ${msKlick} ms, Link ausgeloest ${z.linkClick}, click ${z.click}, mousedown ${z.mousedown}, mouseup ${z.mouseup}`);
  await ruheWieder();

  // 6b. Nachlauf endet bei blur
  await oeffne();
  await zeigeSpirale();
  await aktionen().keyDown('a').perform();
  await bisWeg(Date.now());
  pruefe((await abbild()).nachlaufAktiv === true, 'Nachlauf steht, solange die Taste unten ist');
  await driver.executeScript(`window.dispatchEvent(new Event('blur'))`);
  await bisAbbild('Nachlauf aus (blur)', (x) => !x.nachlaufAktiv, 2000, 10);
  await aktionen().keyUp('a').perform();
  await warte(150);
  pruefe((await capture()).keyup === 1, 'nach blur erreicht das Loslassen die Seite');
  await ruheWieder();

  // 7. Rad
  await zeigeSpirale();
  t0 = Date.now();
  await aktionen().scroll(150, 130, 0, 100, 'viewport').perform();
  const msRad = await bisWeg(t0);
  pruefe((await zaehler()).wheel === 0, 'Rad: Seite zaehlt 0 wheel');
  console.log(`firefox spirale: Rad beendet nach ${msRad} ms`);
  await ruheWieder();

  // 8. Pause, Schalter aus, active, locked (die Einstellungen kommen aus dem Tab selbst, der Tab bleibt sichtbar)
  await zeigeSpirale();
  t0 = Date.now();
  await einstellungImTab({ pause: true });
  const msPause = await bisWeg(t0);
  pruefe((await abbild()).endeGrund === 'einstellung', `Pause beendet mit Grund einstellung (${(await abbild()).endeGrund})`);
  await einstellungImTab({ pause: false });
  await warte(500);
  await ruheWieder();
  await zeigeSpirale();
  t0 = Date.now();
  await einstellungImTab({ kontrolle: { ...KONTROLLE, leerlauf: false } });
  const msAus = await bisWeg(t0);
  pruefe((await abbild()).endeGrund === 'einstellung', `Schalter aus beendet mit Grund einstellung (${(await abbild()).endeGrund})`);
  await einstellungImTab({ kontrolle: { ...KONTROLLE } });
  await warte(500);
  await ruheWieder();
  await zeigeSpirale();
  t0 = Date.now();
  await sende('active');
  const msAktiv = await bisWeg(t0);
  pruefe((await abbild()).endeGrund === 'aktiv', 'active beendet mit Grund aktiv');
  await warte(400);
  await zeigeSpirale();
  t0 = Date.now();
  await sende('locked');
  const msLocked = await bisWeg(t0);
  console.log(`firefox spirale: Pause ${msPause} ms, Schalter aus ${msAus} ms, active ${msAktiv} ms, locked ${msLocked} ms`);
  await ruheWieder();

  // 9. Lokale Pause
  await zeigeSpirale();
  t0 = Date.now();
  await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { lokalePause: true } }) }))`);
  const msLokal = await bisWeg(t0);
  pruefe((await abbild()).endeGrund === 'pause', 'lokale Pause: Grund pause');
  await ruheWieder();
  const nach = await idleUndEntscheidung();
  pruefe(nach.a.ergebnis === 'absage:nicht-erlaubt', `nach lokaler Pause keine Spirale (${nach.a.ergebnis})`);
  console.log(`firefox spirale: lokale Pause beendet nach ${msLokal} ms`);

  // 10. Tab verborgen
  await oeffne();
  await zeigeSpirale();
  t0 = Date.now();
  const seitenFenster = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  // Erst warten, bis der Seitentab wirklich verborgen war: das Zurueckschalten holt ihn sonst nach vorn, bevor visibilitychange feuert
  // (Wettlauf in Firefox 128, 1 von 3 Laeufen rot; Orchestrator, Session 9).
  await warte(500);
  await driver.switchTo().window(seitenFenster);
  // Firefox meldet den Wechsel des Tabs erst, wenn er wirklich im Hintergrund ist: im Hintergrund lesen wir nur das Abbild.
  const neuerTab = (await driver.getAllWindowHandles()).find((h) => h !== seitenFenster && h !== hauptFenster);
  let verborgenOk = false;
  try {
    await bisAbbild('Tab verborgen', (x) => x.phase === 'ruhend', 6000, 20);
    verborgenOk = (await abbild()).endeGrund === 'verborgen';
  } catch {
    verborgenOk = false;
  }
  pruefe(verborgenOk, 'Tab verborgen beendet die Spirale');
  console.log(`firefox spirale: Tab verborgen, Spirale weg: ${verborgenOk} (nach ${Date.now() - t0} ms)`);
  if (neuerTab) {
    await driver.switchTo().window(neuerTab);
    await driver.close();
  }
  await driver.switchTo().window(hauptFenster);

  // 11. Ruhig-Modus und prefers-reduced-motion
  await setzeEinstellungen({ ruhig: false });
  const messeHz = async () => {
    await oeffne();
    await zeigeSpirale();
    const x1 = await abbild();
    await warte(2500);
    const x2 = await abbild();
    return { hz: hzAus(x1, x2), ruhig: x2.ruhig };
  };
  const normal = await messeHz();
  await setzeEinstellungen({ ruhig: true });
  const ruhig = await messeHz();
  await setzeEinstellungen({ ruhig: false });
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(`Services.prefs.setIntPref('ui.prefersReducedMotion', 1);`);
  await driver.setContext(firefox.Context.CONTENT);
  const reduziert = await messeHz();
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(`Services.prefs.clearUserPref('ui.prefersReducedMotion');`);
  await driver.setContext(firefox.Context.CONTENT);
  pruefe(ruhig.ruhig === true && reduziert.ruhig === true && ruhig.hz / normal.hz > 0.2 && ruhig.hz / normal.hz < 0.4 && reduziert.hz / normal.hz > 0.2 && reduziert.hz / normal.hz < 0.4, `Ruhig 30 Prozent: ${normal.hz.toFixed(2)} / ${ruhig.hz.toFixed(2)} / ${reduziert.hz.toFixed(2)} (ruhig ${ruhig.ruhig}, reduziert ${reduziert.ruhig})`);
  console.log(`firefox spirale: normal ${normal.hz.toFixed(2)} Hz, Ruhig-Modus ${ruhig.hz.toFixed(2)} Hz, reduced-motion ${reduziert.hz.toFixed(2)} Hz`);

  // 12. Warnkarte
  await setzeWarnung(false);
  await oeffne();
  let r = await idleUndEntscheidung();
  pruefe(r.a.ergebnis === 'warnung' && r.a.phase === 'warnung' && r.a.knoepfe && r.a.hz === null, 'erste Spirale: Warnkarte ohne Bewegung');
  await aktionen().move(mitte(r.a.knoepfe.ja)).press().release().perform();
  await bisAbbild('Karte zu', (x) => x.phase === 'ruhend');
  pruefe((await hostAnzahl()) === 0 && (await liesSpeicher('spiraleWarnungGesehen')) === true, 'Got it: Karte weg, Warnung gemerkt');
  await ruheWieder();
  await zeigeSpirale();
  await setzeWarnung(false);
  await oeffne();
  r = await idleUndEntscheidung();
  await aktionen().move(mitte(r.a.knoepfe.nein)).press().release().perform();
  await bisAbbild('Karte zu', (x) => x.phase === 'ruhend');
  await bis('Schalter aus gespeichert', async () => (await liesSpeicher('einstellungen'))?.kontrolle?.leerlauf === false);
  pruefe((await liesSpeicher('spiraleWarnungGesehen')) === null, 'No spiral for me: Schalter aus, Warnung nicht gemerkt');
  await setzeKontrolle({});
  await oeffne();
  r = await idleUndEntscheidung();
  pruefe(r.a.ergebnis === 'warnung', 'Karte wieder');
  await aktionen().sendKeys('').perform(); // Escape
  await bisAbbild('Karte zu (Escape)', (x) => x.phase === 'ruhend');
  pruefe((await hostAnzahl()) === 0 && (await zaehler()).keydown === 0 && (await liesSpeicher('spiraleWarnungGesehen')) === null, 'Escape schliesst, nichts gemerkt, Seite sieht keine Taste');
  await warte(400);
  r = await idleUndEntscheidung();
  await sende('active');
  await warte(300);
  pruefe((await abbild()).phase === 'warnung', 'Karte bleibt bei active stehen');
  await aktionen().move({ x: 700, y: 500, origin: 'viewport' }).press().release().perform();
  await bisAbbild('Karte zu (daneben)', (x) => x.phase === 'ruhend');
  pruefe((await hostAnzahl()) === 0 && (await zaehler()).click === 0 && (await liesSpeicher('spiraleWarnungGesehen')) === null, 'Klick daneben schliesst, nichts gemerkt, Seite sieht keinen Klick');
  await oeffne('?lang=1');
  r = await idleUndEntscheidung();
  pruefe(r.a.ergebnis === 'warnung', 'Karte fuer die Tastaturprobe');
  for (let i = 0; i < 3; i++) {
    await aktionen().sendKeys('\uE004').perform();
    pruefe(await driver.executeScript(`return document.activeElement.hasAttribute('data-veil-spirale-host')`), `Tab ${i + 1}: Fokus bleibt auf der Karte`);
  }
  await aktionen().sendKeys('\uE004').perform();
  await aktionen().sendKeys('\uE007').perform(); // Enter
  await bisAbbild('Karte zu (Enter)', (x) => x.phase === 'ruhend');
  c = await capture();
  pruefe((await liesSpeicher('spiraleWarnungGesehen')) === true && c.keydown + c.keyup + c.keypress === 0, `Enter auf "I understand": gemerkt, Seite sieht keine Taste (${c.keydown}/${c.keyup}/${c.keypress})`);
  console.log('firefox spirale: Warnkarte beide Knoepfe, Escape und Klick daneben, Tastatur (Tab bleibt auf der Karte, Enter bestaetigt), Karte bleibt bei active');
  await setzeWarnung(true);

  // 13. Keine Spirale in diesen Faellen
  await oeffne('?feld=1');
  pruefe((await idleUndEntscheidung()).a.ergebnis === 'absage:eingabe' && (await hostAnzahl()) === 0, 'Fokus im Eingabefeld: keine Spirale');
  await oeffne('?rahmen=1');
  await driver.executeScript(`document.getElementById('rahmen').focus()`);
  pruefe((await idleUndEntscheidung()).a.ergebnis === 'absage:eingabe' && (await hostAnzahl()) === 0, 'Fokus im Rahmen: keine Spirale');
  await oeffne();
  await aktionen().move({ x: 460, y: 220, origin: 'viewport' }).press().release().perform();
  const vollbild = await bis('Vollbild', () => driver.executeScript(`return !!document.fullscreenElement`), 5000).then(() => true, () => false);
  if (vollbild) pruefe((await idleUndEntscheidung()).a.ergebnis === 'absage:vollbild' && (await hostAnzahl()) === 0, 'Vollbild: keine Spirale');
  else console.log('firefox spirale: Vollbild im kopflosen Firefox nicht herstellbar, uebersprungen');
  await setzeKontrolle({ leerlauf: false });
  await oeffne();
  pruefe((await idleUndEntscheidung()).antwort.gesendet === false && (await hostAnzahl()) === 0, 'Schalter aus: keine Spirale');
  await setzeKontrolle({});
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await oeffne();
  pruefe((await idleUndEntscheidung()).a.ergebnis === 'absage:nicht-erlaubt' && (await hostAnzahl()) === 0, 'eigene Ausnahme: keine Spirale');
  await setzeEinstellungen({ ausnahmen: [] });
  console.log(`firefox spirale: Faelle ohne Spirale (Feld, Rahmen, Vollbild ${vollbild ? 'geprueft' : 'uebersprungen'}, Schalter aus, Ausnahme)`);

  // 14. Minuten-Einstellung: der Haken meldet nur den zuletzt vom Horcher gesetzten Wert
  const abstaende = [];
  await oeffne();
  for (const min of [5, 1, 60, 2]) {
    await setzeKontrolle({ leerlaufMinuten: min });
    const wert = await bis(`Abstand fuer ${min} Minuten`, async () => ((await sende('active')).abstand === min * 60 ? min * 60 : false), 8000);
    abstaende.push(wert);
    pruefe(wert === min * 60, `Erkennungsabstand fuer ${min} Minuten: ${wert}`);
  }
  console.log(`firefox spirale: Erkennungsabstand ${abstaende.join(', ')} s fuer 5, 1, 60, 2 Minuten`);
  await setzeKontrolle({});

  // 15. Standardaktion: scrollbare Seite scrollt nicht, Fokus bleibt
  await oeffne('?lang=1');
  const stand = () => driver.executeScript(`return { y: scrollY, fokus: document.activeElement && document.activeElement.tagName }`);
  for (const [name, taste] of [['Leertaste', ' '], ['Bild ab', '\uE00F'], ['Pfeil ab', '\uE015'], ['Ende', '\uE010'], ['Tab', '\uE004']]) {
    await ruheWieder();
    await zeigeSpirale();
    await aktionen().sendKeys(taste).perform();
    await bisWeg(Date.now());
    await warte(200);
    const st = await stand();
    pruefe(st.y === 0 && st.fokus === 'BODY', `${name}: scrollY ${st.y}, Fokus ${st.fokus}`);
  }
  await ruheWieder();
  await zeigeSpirale();
  await aktionen().scroll(150, 130, 0, 600, 'viewport').perform();
  await bisWeg(Date.now());
  await warte(300);
  pruefe((await stand()).y === 0, `Rad: scrollY ${(await stand()).y}`);
  console.log('firefox spirale: Leertaste, Bild ab, Pfeil, Ende, Tab und Rad ohne Standardaktion (scrollY 0, Fokus bleibt)');

  // 16. Stehendes Bild, nach dem Ende kein Zeichnen und keine Horcher, Unterrahmen leer
  await oeffne('?rahmen=1');
  await ruheWieder();
  const basis = (await abbild()).offeneHoerer;
  await zeigeSpirale();
  const laeuft = await abbild();
  pruefe(laeuft.offeneHoerer > basis, `Horcher waehrend der Spirale ${laeuft.offeneHoerer} ueber Grundstand ${basis}`);
  const imRahmen = await driver.executeScript(`const f = document.getElementById('rahmen').contentDocument; return [f.querySelectorAll('[data-veil-spirale-host]').length, f.documentElement.hasAttribute('data-veil-spirale')]`);
  pruefe(imRahmen[0] === 0 && imRahmen[1] === false, 'Unterrahmen: weder Host noch Testspur');
  await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { uhrVor: 900000 } }) }))`);
  const steht = await bisAbbild('Bild steht', (x) => x.stehend === true, 5000);
  await warte(600);
  const spaeter = await abbild();
  pruefe(spaeter.bilderGesamt === steht.bilderGesamt, `stehendes Bild: ${steht.bilderGesamt} Bilder, spaeter ${spaeter.bilderGesamt}`);
  await aktionen().sendKeys('x').perform();
  await bisWeg(Date.now());
  await bisAbbild('Nachlauf aus, Horcher weg', (x) => !x.nachlaufAktiv && x.offeneHoerer === basis, 3000, 20);
  const n1 = await abbild();
  await warte(700);
  const n2 = await abbild();
  pruefe(n2.bilderGesamt === n1.bilderGesamt && n2.offeneHoerer === basis, `nach dem Ende: Bilder ${n1.bilderGesamt} gleich ${n2.bilderGesamt}, Horcher ${n2.offeneHoerer} (Grundstand ${basis})`);
  console.log(`firefox spirale: Bild steht nach vorgestellter Uhr (${steht.bilderGesamt} Bilder gleichbleibend), nach dem Ende 0 neue Bilder, Horcher ${laeuft.offeneHoerer} auf ${n2.offeneHoerer}, Unterrahmen leer`);

} catch (e) {
  console.error('firefox: FEHLER', e?.stack ?? e);
  code = 1;
} finally {
  await driver?.quit().catch(() => {});
  server?.close?.();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: ${ok} Pruefungen gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
