// Update-Test auf Android (Phase 8, Entscheidung 152): signierte Update-Test-Erweiterung 1.0.0 dauerhaft installieren, dann die
// Update-Pruefung von Gecko ueber update_url anstossen und messen, ob 1.1.0 kommt.
//   node tests/android/update-test/lauf.mjs
// Vorher: Emulator laeuft, signierte Dateien in .output-updatetest/signed/ (scripts/release/signieren.mjs).
// update_url ist https://127.0.0.1:47177/updates.json; adb reverse leitet den Port zum Mac. Der Server hier nutzt ein eigenes
// Zertifikat (nur Test, in .output-updatetest/tls/), Firefox im Emulator bekommt dafuer eine Ausnahme im Chrome-Kontext.
// Grenze: angestossen wird AddonManager.findUpdates (dieselbe Gecko-Pruefung, die der Update-Dienst von Fenix nutzt), nicht der
// Zeitplan von Fenix selbst (der laeuft etwa alle 12 Stunden).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import firefox from 'selenium-webdriver/firefox.js';
import * as L from '../lib.mjs';
import { UPDATE_TEST_ID } from './erzeuge.mjs';

process.env.SE_AVOID_STATS = 'true';
const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ordner = path.join(wurzel, '.output-updatetest');
const signiert = path.join(ordner, 'signed');
const PORT = 47177;
setTimeout(() => {
  console.error('update-test: Zeitlimit 5 min');
  process.exit(1);
}, 5 * 60_000).unref();

const xpiFuer = (v) => {
  const n = existsSync(signiert) ? readdirSync(signiert).find((d) => d.endsWith(`-${v}.xpi`)) : null;
  if (!n) throw new Error(`signierte XPI ${v} fehlt in .output-updatetest/signed`);
  return path.join(signiert, n);
};
const alt = xpiFuer('1.0.0');
const neu = xpiFuer('1.1.0');

// Eigenes Zertifikat fuer 127.0.0.1 (nur Test).
const tls = path.join(ordner, 'tls');
mkdirSync(tls, { recursive: true });
const schluessel = path.join(tls, 'key.pem');
const zert = path.join(tls, 'cert.pem');
if (!existsSync(zert)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', schluessel, '-out', zert, '-days', '30', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
}
const zertBase64 = readFileSync(zert, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

const neuDaten = readFileSync(neu);
const updates = {
  addons: {
    [UPDATE_TEST_ID]: {
      updates: [{ version: '1.1.0', update_link: `https://127.0.0.1:${PORT}/veil-updatetest-1.1.0.xpi`, update_hash: `sha256:${createHash('sha256').update(neuDaten).digest('hex')}` }],
    },
  },
};
const abrufe = [];
const server = https.createServer({ key: readFileSync(schluessel), cert: readFileSync(zert) }, (req, res) => {
  abrufe.push({ t: Date.now(), url: req.url });
  if (req.url?.startsWith('/updates.json')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(updates));
  } else if (req.url === '/veil-updatetest-1.1.0.xpi') {
    res.writeHead(200, { 'content-type': 'application/x-xpinstall' });
    res.end(neuDaten);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
L.adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);

let driver;
let code = 0;
const ergebnis = { start: new Date().toISOString() };
const chrome = async (skript, ...args) => {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeAsyncScript(skript, ...args);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
};
const VERSION = `const fertig = arguments[arguments.length - 1];
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  AddonManager.getAddonByID(arguments[0]).then((a) => fertig(a ? a.version + (a.isActive ? '' : ' inaktiv') : null), (e) => fertig('FEHLER ' + e));`;
try {
  const geckodriver = execFileSync('which', ['geckodriver'], { encoding: 'utf8' }).trim();
  const { Builder } = await import('selenium-webdriver');
  const optionen = new firefox.Options();
  optionen.set('moz:firefoxOptions', { androidPackage: L.paketName, androidDeviceSerial: L.seriennummer, // requireBuiltInCerts: das Testzertifikat stammt nicht von einer eingebauten Stelle (echte Adressen wie raw.githubusercontent.com schon).
  prefs: { 'media.volume_scale': '0.0', 'extensions.update.requireBuiltInCerts': false, 'extensions.install.requireBuiltInCerts': false } });
  const dienst = new firefox.ServiceBuilder(geckodriver).addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ script: 120_000 });
  await L.raeumeFirefoxDialogeWeg();
  ergebnis.firefox = (await driver.getCapabilities()).get('browserVersion');
  // Zertifikat-Ausnahme fuer den Testserver
  ergebnis.ausnahme = await chrome(
    `const fertig = arguments[arguments.length - 1];
     try {
       const db = Cc['@mozilla.org/security/x509certdb;1'].getService(Ci.nsIX509CertDB);
       const c = db.constructX509FromBase64(arguments[0]);
       const s = Cc['@mozilla.org/security/certoverride;1'].getService(Ci.nsICertOverrideService);
       s.rememberValidityOverride('127.0.0.1', arguments[1], {}, c, true);
       fertig('ok');
     } catch (e) { fertig('FEHLER ' + e); }`,
    zertBase64,
    PORT,
  );
  // 1.0.0 dauerhaft installieren (signiert)
  ergebnis.installiert = await driver.installAddon(alt, false);
  ergebnis.versionVorher = await chrome(VERSION, UPDATE_TEST_ID);
  // Update-Pruefung anstossen
  const t0 = Date.now();
  ergebnis.pruefung = await chrome(
    `const fertig = arguments[arguments.length - 1];
     const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
     AddonManager.getAddonByID(arguments[0]).then((a) => {
       const log = [];
       a.findUpdates({
         onUpdateAvailable(addon, install) {
           log.push('verfuegbar ' + install.version);
           install.addListener({
             onInstallEnded() { log.push('installiert'); fertig(log); },
             onInstallFailed() { log.push('install-fehler ' + install.error); fertig(log); },
             onDownloadFailed() { log.push('download-fehler ' + install.error); fertig(log); },
           });
           install.install();
         },
         onNoUpdateAvailable() { log.push('kein-update'); },
         onUpdateFinished(addon, err) { log.push('pruefung-ende ' + err); if (!log.some((l) => l.startsWith('verfuegbar'))) fertig(log); },
       }, AddonManager.UPDATE_WHEN_USER_REQUESTED);
     }, (e) => fertig(['FEHLER ' + e]));`,
    UPDATE_TEST_ID,
  );
  ergebnis.msPruefungBisFertig = Date.now() - t0;
  await L.warte(1500);
  ergebnis.versionNachher = await chrome(VERSION, UPDATE_TEST_ID);
  ergebnis.abrufe = abrufe.map((a) => a.url);
  console.log(`update-test: ${JSON.stringify(ergebnis)}`);
  if (!String(ergebnis.versionNachher).startsWith('1.1.0')) code = 1;
} catch (e) {
  code = 1;
  console.error('update-test: Abbruch', e);
} finally {
  await L.schliesse(driver);
  try { L.adb('reverse', '--remove', `tcp:${PORT}`); } catch {}
  server.close();
  console.log(`update-test: Ergebnis ${L.schreibeErgebnis({ updateTest: ergebnis })}`);
}
process.exit(code);
