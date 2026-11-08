// Firefox-Test Auftrag V (Session 11): Version und Update-Status. Firefox ruft version.json nie ab (Zaehler des Mini-Servers bleibt 0, auch
// wenn eine Adresse gesetzt ist), die Einstellungsseite zeigt Version, Baudatum und "Firefox keeps me up to date by itself.", "Check now" ergibt
// einen Satz zum Ergebnis von runtime.requestUpdateCheck, das Popup zeigt nie einen Update-Hinweis. Hilfsfunktionen wie kontrolle-optionen.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteVersionServer } from '../version-server.mjs';

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
// Leer, solange die Seite noch laedt (Element fehlt): sonst wackelt das Warten auf das Popup (Firefox 128, Session 11).
const text = async (css) => (await driver.executeScript(`const e = document.querySelector(arguments[0]); return e ? e.textContent.trim() : ''`, css)) ?? '';

const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const einst = async () => (await speicher('einstellungen')) ?? {};
const waehle = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, wert);
const zahl = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));

let code = 0;
let server;
try {
  server = await starteVersionServer();
  const links = JSON.parse(readFileSync(path.join(wurzel, 'data/links.json'), 'utf8'));
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  const nachricht = (n) => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, n);

  await oeffne('options.html');
  // Auch mit gesetzter Adresse ruft Firefox nie ab.
  pruefe((await nachricht({ ziel: 'hintergrund', typ: 'version-test', vergiss: true, url: server.adresse('9.9.9.json') })).ok === true, 'Testhaken version-test antwortet ok');
  await driver.navigate().refresh();
  await bis('Abschnitt gezeichnet', async () => (await text('#ue-version')).length > 0);
  pruefe((await text('#ueber-titel')) === 'About and help', 'Ueberschrift About and help');
  pruefe((await text('#ue-version')) === paketJson.version, `Version ${paketJson.version} steht da`);
  pruefe(/^\d{4}-\d{2}-\d{2}$/.test(await text('#ue-datum')), 'Baudatum steht da (JJJJ-MM-TT)');
  // Gibt es runtime.requestUpdateCheck? Firefox 128: nein (dann kein Knopf, nur der Status-Satz).
  const hat = (await imSeitenkontext(`return typeof api.runtime.requestUpdateCheck;`)) === 'function';
  console.log(`firefox: runtime.requestUpdateCheck ${hat ? 'vorhanden' : 'nicht vorhanden'} (Firefox ${version})`);
  const statusSatz = hat ? 'Firefox keeps me up to date by itself.' : 'Firefox updates me by itself. Nothing for you to do.';
  await bis('Status-Satz', async () => (await text('#ue-stand')) === statusSatz);
  pruefe(true, `Status: ${statusSatz}`);
  pruefe((await sichtbar('#ue-pruefen')) === hat, `Knopf Check now ${hat ? 'sichtbar' : 'nicht da'}`);
  pruefe(!(await sichtbar('#ue-anleitung')), 'keine Anleitung in Firefox');
  pruefe(!(await sichtbar('#ue-netz')), 'kein Satz zum Abruf auf GitHub in Firefox');
  pruefe(server.gesamt() === 0, `Abrufe nach dem Oeffnen: ${server.gesamt()} (soll 0)`);

  // Links der Marke
  const hrefs = await driver.executeScript(`return [...document.querySelectorAll('#ue-links a')].map((a) => [a.textContent, a.href, a.rel, a.target]);`);
  pruefe(
    JSON.stringify(hrefs.map((h) => h.slice(0, 2))) === JSON.stringify([['lnk.bio', links.linkbio], ['Patreon', links.patreon], ['SubscribeStar', links.subscribestar]]),
    'Links lnk.bio, Patreon, SubscribeStar aus data/links.json',
  );
  pruefe(hrefs.every((h) => h[2].includes('noopener') && h[3] === '_blank'), 'Links mit noopener und neuem Tab');
  pruefe((await text('#ue-pause')).includes('Pausing'), 'Satz zu Pause und Deinstallation');

  // Check now: nur wo Firefox die Funktion kennt, ein Satz zum Ergebnis; kein Abruf
  if (hat) {
    await klick('#ue-pruefen');
    const bekannt = [
      'A newer me is waiting. Firefox installs it by itself.',
      'Nothing newer right now. You’re up to date.',
      'Firefox just looked. Try again in a little while.',
      'Couldn’t check just now. Try again later.',
    ];
    await bis('Ergebnissatz', async () => bekannt.includes(await text('#ue-stand')));
    const satz = await text('#ue-stand');
    pruefe(true, `Check now ergibt einen Satz: "${satz}"`);
    console.log(`firefox: Check now Satz: "${satz}"`);
    await bis('Knopf wieder frei', async () => (await eigenschaft('#ue-pruefen', 'disabled')) === false);
  }
  const a = await nachricht({ ziel: 'hintergrund', typ: 'version', erzwingen: true });
  pruefe(a.ok === true && a.browser === 'firefox' && a.aktuell === paketJson.version && a.neuer === false && a.neueste === null, 'Antwort: firefox, Version, nie neuer');
  pruefe(['update_available', 'no_update', 'throttled', 'unbekannt'].includes(a.firefoxStatus), `firefoxStatus ist ein bekannter Wert (${a.firefoxStatus})`);
  if (!hat) pruefe(a.firefoxStatus === 'unbekannt', 'ohne die Funktion antwortet erzwingen mit unbekannt');
  console.log(`firefox: firefoxStatus ${a.firefoxStatus}${a.firefoxStatus === 'unbekannt' ? ' (kein echtes Ergebnis von Firefox)' : ' (echte Antwort von Firefox)'}`);
  const b = await nachricht({ ziel: 'hintergrund', typ: 'version', pruefen: true });
  pruefe(b.firefoxStatus === undefined && b.neuer === false, 'pruefen ohne erzwingen fragt Firefox nicht');
  pruefe(server.gesamt() === 0, `Abrufe insgesamt nach Check now: ${server.gesamt()} (soll 0)`);

  // Popup: nie ein Hinweis
  await oeffne('popup.html');
  await bis('Popup steht', async () => (await text('#version')).startsWith('v'));
  await warte(500);
  pruefe(!(await sichtbar('#version-hinweis')), 'Popup zeigt in Firefox keinen Update-Hinweis');
  pruefe((await text('#version-satz')) === '', 'Popup-Satz bleibt leer');
  pruefe(server.gesamt() === 0, `Abrufe nach dem Popup: ${server.gesamt()} (soll 0)`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['versionPruefung']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) await server.schliesse();
}
console.log(`firefox: version.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
