// Firefox-Leerlauftest (PHASE-2-BAUPLAN 9.6): die Ereignisseite der Erweiterung endet nach Leerlauf (Firefox: 30 s, hier per Einstellung
// extensions.background.idle.timeout verkuerzt) und startet bei der naechsten Nachricht neu. Gemessen wird:
//   1. Die Ereignisseite endet wirklich (Zustand der Erweiterung im Browser: running, dann stopped; Chrome-Kontext von Marionette).
//   2. Sie startet neu: der Zustand wird wieder running, der Erkenner hat einen neuen Kaltstart (Laufzaehler zurueck auf 0 bis 1,
//      kaltstartMs neu gemessen), das Modell steht wieder (bereit).
//   3. Ein neues Bild vom zweiten Ursprung mit ?nurReferer=1 wird danach wieder beurteilt (die Referer-Regeln lagen im Speicher der
//      beendeten Seite und sind weg; der Erkenner holt das Bild ueber 403, neue Referer-Regel, zweiter Versuch).
// Ausgabe: Kaltstart nach dem Neustart in Millisekunden (vom Einfuegen des Bildes bis zum Urteil und laut Erkenner).
// Der Zustand der Ereignisseite liegt im Browser, nicht in der Seite: geckodriver braucht dafuer --allow-system-access (Chrome-Kontext).
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

// Globaler Waechter: haengt irgendetwas, endet der Lauf nach 150 Sekunden mit Fehler.
setTimeout(() => {
  console.error('firefox: Zeitlimit von 150 s ueberschritten');
  process.exit(1);
}, 150_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const portFremd = port + 2;
const basis = `http://127.0.0.1:${port}`;
const LEERLAUF_MS = 3000; // verkuerzte Leerlaufzeit der Ereignisseite
const ERWEITERUNG_ID = 'veil@hypnomia';
const ZYKLEN = 3; // so oft wird die Ereignisseite beendet und neu gestartet

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
// Erweiterung als temporaeres Add-on installieren, ueber den Pfad (nicht Base64 wie driver.installAddon): geckodriver 0.37 mit Firefox 128
// lehnt die Base64-Form ab (InvalidArgumentError), der Pfad geht in 128 und in neueren Versionen.
async function installiere(treiber, paketPfad) {
  await treiber.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
}

let driver;
const server = [];
let code = 0;

async function bis(beschreibung, fn, frist = 30_000, takt = 100) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(takt);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

const status = async () => {
  const roh = await driver.executeScript('return document.documentElement.dataset.veilStatus ?? null');
  return roh ? JSON.parse(roh) : null;
};

// Zustand der Ereignisseite aus dem Browser (Chrome-Kontext): 'running', 'stopped', 'starting', 'suspending'.
async function hintergrundZustand() {
  await driver.setContext('chrome');
  try {
    return await driver.executeScript(
      "const p = WebExtensionPolicy.getByID(arguments[0]); return p && p.extension ? p.extension.backgroundState : 'unbekannt';",
      ERWEITERUNG_ID,
    );
  } finally {
    await driver.setContext('content');
  }
}

async function leerlaufZeit() {
  await driver.setContext('chrome');
  try {
    return await driver.executeScript("return Services.prefs.getIntPref('extensions.background.idle.timeout', -1)");
  } finally {
    await driver.setContext('content');
  }
}

// Einstellungen ueber das Testereignis setzen (storage.local).
async function setzeEinstellungen(einstellungen) {
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen }));
  await warte(300);
}

// Fragt den Status des Erkenners ueber das Content-Script ab (Testhaken). Das weckt eine beendete Ereignisseite.
let nummer = 0;
async function erkennerStatus() {
  const nr = ++nummer;
  await driver.executeScript(
    "document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))",
    JSON.stringify({ erkennerStatus: nr }),
  );
  const antwort = await bis(
    'Antwort des Erkenners',
    async () => {
      const roh = await driver.executeScript("return document.documentElement.getAttribute('data-veil-erkenner')");
      if (!roh) return null;
      const a = JSON.parse(roh);
      return a.nr === nr ? a : null;
    },
    20_000,
    25,
  );
  if (antwort.fehler) throw new Error(`Status: ${antwort.fehler}`);
  return antwort.antwort;
}

async function warteBeurteilt(n) {
  return bis(`${n} Elemente beurteilt, ohne Fehler`, async () => {
    const s = await status();
    return s && s.gesamt === n && s.offen === 0 && s.fehler === 0 ? s : null;
  });
}

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.background.idle.timeout', LEERLAUF_MS);
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(optionen)
    .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
    .build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);

  const zeit = await leerlaufZeit();
  if (zeit !== LEERLAUF_MS) throw new Error(`Leerlaufzeit nicht gesetzt: ${zeit}`);

  await driver.get(`${basis}/leerlauf.html`);
  await bis('Status', status);

  // ---- Phase 1: Erkenner arbeitet, drei fremde Bilder werden beurteilt (Referer-Regel wird gebraucht) ----
  let aufbau = Date.now();
  for (const n of [3, 5, 6]) await driver.executeScript('window.fuegeEin(arguments[0])', n);
  await warteBeurteilt(3);
  const vorher = await erkennerStatus();
  console.log(`firefox Leerlauf: vor dem Leerlauf: Zustand ${await hintergrundZustand()}, bereit ${vorher.bereit}, Laeufe ${vorher.laeufe}, kaltstartMs ${vorher.kaltstartMs} (erster Kaltstart, ${Date.now() - aufbau} ms bis drei Bilder beurteilt)`);
  if (!(vorher.laeufe >= 3)) throw new Error(`zu wenige Laeufe vor dem Leerlauf: ${vorher.laeufe}`);

  // ---- Phase 2: mehrere Zyklen Leerlauf, Ende der Ereignisseite, Neustart, neues Bild beurteilt ----
  const kaltMs = [];
  const beurteiltMs = [];
  let bilder = 3;
  let naechstesBild = 10;
  for (let zyklus = 1; zyklus <= ZYKLEN; zyklus++) {
    // Die Ereignisseite endet. Gemessen ab hier, es darf nichts mehr an den Hintergrund gehen (die Seite ist ruhig).
    const tLeer = Date.now();
    await bis('Ereignisseite endet', async () => (await hintergrundZustand()) === 'stopped', 30_000, 250);
    const bisEnde = Date.now() - tLeer;
    console.log(`firefox Leerlauf ${zyklus}: Ereignisseite beendet nach ${bisEnde} ms Leerlauf (eingestellt ${LEERLAUF_MS} ms)`);

    // Neues Bild vom zweiten Ursprung: die Seite weckt den Hintergrund (wecke, Erkenner), der Erkenner startet kalt.
    const n = naechstesBild++;
    const t0 = Date.now();
    await driver.executeScript('window.fuegeEin(arguments[0])', n);
    bilder++;
    const z = await warteBeurteilt(bilder);
    const beurteilt = Date.now() - t0;
    const zustandDanach = await hintergrundZustand();
    if (zustandDanach !== 'running') throw new Error(`Ereignisseite nach dem Wecken nicht running: ${zustandDanach}`);
    const nachher = await erkennerStatus();
    // Laufzaehler zurueck: der Erkenner ist ein neuer, nicht der alte (der alte hatte mindestens 3 Laeufe).
    if (!(nachher.laeufe < vorher.laeufe)) throw new Error(`Laufzaehler nicht zurueckgesetzt: vorher ${vorher.laeufe}, jetzt ${nachher.laeufe}`);
    if (nachher.kaltstartMs === null) throw new Error('kein neuer Kaltstart gemessen');
    // Klassen-Hintergruende ohne Treffer tragen kein Attribut (frei): beurteilt heisst hier, die Zaehlung steht und nichts ist verdeckt.
    const urteil = `frei ${z.frei}, zensiert ${z.zensiert}, verdeckt ${z.verdeckt}, fehler ${z.fehler}`;
    if (z.frei + z.zensiert !== bilder || z.verdeckt !== 0) throw new Error(`neues Bild nicht beurteilt: ${urteil}`);
    kaltMs.push(nachher.kaltstartMs);
    beurteiltMs.push(beurteilt);
    console.log(
      `firefox Leerlauf ${zyklus}: Neustart: Zustand ${zustandDanach}, Laeufe vorher ${vorher.laeufe}, jetzt ${nachher.laeufe}, ` +
        `Kaltstart laut Erkenner ${nachher.kaltstartMs} ms, Bild eingefuegt bis beurteilt (Wecken, Modell laden, 403, Referer-Regel, Wiederholung) ${beurteilt} ms, ` +
        `Urteil ${urteil}`,
    );
  }
  const mittel = (liste) => Math.round(liste.reduce((a, b) => a + b, 0) / liste.length);
  console.log(`firefox Leerlauf: ${ZYKLEN} Neustarts, Kaltstart laut Erkenner ${JSON.stringify(kaltMs)} ms (Mittel ${mittel(kaltMs)} ms), Wecken bis beurteilt ${JSON.stringify(beurteiltMs)} ms (Mittel ${mittel(beurteiltMs)} ms)`);
  // ---- Phase 3: mit eigener Ausnahme und eingebettetem Rahmen endet die Ereignisseite trotzdem ----
  // Frueher fragten Rahmen die Tab-Adresse im Takt beim Hintergrund und hielten ihn wach. Jetzt melden nur Adresswechsel der obersten Seite.
  await setzeEinstellungen({ ausnahmen: ['beispiel.test/gp/buy'] });
  await driver.get(`${basis}/leerlauf.html?rahmen=1`);
  await bis('Status', status);
  await bis('Rahmen geladen', () => driver.executeScript("const r = document.getElementById('rahmen'); return !!r && !!r.contentWindow"), 10_000);
  // Der Rahmen (anderer Host) ist da und hat sein Content-Script; die oberste Seite hat die Ausnahme geladen.
  await warte(1000);
  const tAus = Date.now();
  await bis('Ereignisseite endet trotz Ausnahme und Rahmen', async () => (await hintergrundZustand()) === 'stopped', 30_000, 250);
  console.log(`firefox Leerlauf mit Ausnahme und Rahmen: Ereignisseite beendet ${Date.now() - tAus + 1000} ms nach dem Laden (eingestellt ${LEERLAUF_MS} ms)`);
  // Ein Adresswechsel der obersten Seite weckt sie (hintergrund/adresse), danach endet sie wieder.
  await driver.executeScript("window.gehe('/ohne-folgen')");
  await bis('Ereignisseite wacht auf', async () => (await hintergrundZustand()) !== 'stopped', 10_000, 100);
  await bis('Ereignisseite endet wieder', async () => (await hintergrundZustand()) === 'stopped', 30_000, 250);
  console.log('firefox Leerlauf mit Ausnahme und Rahmen: Adresswechsel weckt die Ereignisseite, danach endet sie wieder');
  await setzeEinstellungen({ ausnahmen: [] });
  console.log('firefox: Leerlauf-Test gruen');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) {
    await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  }
  for (const s of server) s.close();
}
process.exit(code);
