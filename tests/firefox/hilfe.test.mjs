// Firefox-Test Hilfe-Seite (Session 17, Entscheidung 179): die Anleitungen aus docs/ stehen offline in der Erweiterung, Adresse #name zeigt
// das Thema, Suche filtert, aeussere Links nur https mit noopener, Popup hat den Weg dorthin. Hilfsfunktionen wie version.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  const anzahlDocs = readdirSync(path.join(wurzel, 'docs')).filter((d) => d.endsWith('.md')).length;
  await oeffne('hilfe.html');
  await bis('Liste gezeichnet', async () => (await driver.executeScript(`return document.querySelectorAll('#themen-liste a').length`)) > 0);
  const n = await driver.executeScript(`return document.querySelectorAll('#themen-liste a').length`);
  pruefe(n === anzahlDocs, `Themenliste hat ${n} Eintraege (docs/: ${anzahlDocs})`);
  pruefe((await driver.executeScript(`return document.querySelector('#inhalt').dataset.anleitung`)) === 'readme', 'Startseite ist README');
  await driver.executeScript(`location.hash = '#faq'`);
  await bis('FAQ angezeigt', async () => (await driver.executeScript(`return document.querySelector('#inhalt').dataset.anleitung`)) === 'faq');
  pruefe((await driver.executeScript(`return document.querySelector('#themen-liste a[aria-current="page"]')?.dataset.name`)) === 'faq', 'FAQ in der Liste markiert');
  const aussen = await driver.executeScript(`return [...document.querySelectorAll('#inhalt a.aussen')].map((a) => [a.href, a.rel, a.target])`);
  pruefe(aussen.every(([h, r, t]) => h.startsWith('https://') && r.includes('noopener') && t === '_blank'), `aeussere Links nur https mit noopener (${aussen.length})`);
  await driver.executeScript(`const s = document.querySelector('#suche'); s.value = 'android'; s.dispatchEvent(new Event('input', { bubbles: true }));`);
  const treffer = await driver.executeScript(`return [...document.querySelectorAll('#themen-liste a')].map((a) => a.dataset.name)`);
  pruefe(treffer.includes('install-firefox-android') && treffer.length < n, `Suche "android" filtert (${treffer.join(', ')})`);
  pruefe((await driver.executeScript(`return document.documentElement.scrollWidth <= window.innerWidth`)) === true, 'kein waagrechtes Scrollen');
  // Weg aus dem Popup: Knopf "?" ist da.
  await oeffne('popup.html');
  await bis('Popup steht', async () => (await sichtbar('#hilfe')) === true);
  pruefe((await eigenschaft('#hilfe', 'ariaLabel')) === 'Help' || (await driver.executeScript(`return document.querySelector('#hilfe').getAttribute('aria-label')`)) === 'Help', 'Popup hat den Hilfe-Knopf');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: hilfe.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
