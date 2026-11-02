// Firefox-Test des Popups ueber geckodriver/WebDriver (PHASE-2-BAUPLAN 9.3 und 9.6): Pause schaltet storage.local, Mia patch ist ohne Pack
// gesperrt und mit Pack waehlbar, der Verweis auf die Einstellungsseite ist da und oeffnet sie.
// Das Popup wird als Tab geoeffnet (moz-extension://<uuid>/popup.html), siehe tests/firefox/pack.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const radio = (wert) => `input[name="stil"][value="${wert}"]`;
const eigenschaft = (css, name) => driver.executeScript(`return document.querySelector(arguments[0])[arguments[1]]`, css, name);
const text = (css) => driver.findElement(By.css(css)).getText();

let code = 0;
try {
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
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

  // Mia patch ohne Pack gesperrt
  pruefe((await eigenschaft(radio('mia-patch'), 'disabled')) === true, 'Mia patch ist ohne Pack gesperrt');
  pruefe((await text('#pack-hinweis')).includes('Add the Mia Pack'), 'Hinweis nennt den Weg zum Pack');
  pruefe((await eigenschaft(radio('mosaik'), 'checked')) === true, 'ohne Pack gilt Mosaik');
  pruefe((await text('#pack-link')).length > 0, 'Verweis auf die Einstellungsseite ist da');
  // Blur ist waehlbar
  await driver.findElement(By.css('label:has(input[value="blur"])')).click();
  await bis('Blur', async () => (await speicher('einstellungen'))?.stil === 'blur');
  pruefe(true, 'Blur waehlbar, in storage.local');

  // Mit Pack (Kurzfassung in storage.local) wird Mia patch waehlbar, das Popup folgt der Aenderung ohne Neuladen
  await imSeitenkontext(
    `await api.storage.local.set({ pack: { id: 'test', version: '1.0.0', titel: 'Test', freischaltungen: ['stil:mia-patch'], bilder: 3, groesse: 100, importiert: 1 } });`,
  );
  await bis('Mia patch frei', async () => (await eigenschaft(radio('mia-patch'), 'disabled')) === false);
  pruefe(true, 'mit Pack ist Mia patch waehlbar');
  pruefe((await text('#pack-hinweis')).includes('3 of my pictures'), 'Hinweis zaehlt die Bilder');
  await driver.findElement(By.css('label:has(input[value="mia-patch"])')).click();
  await bis('Mia patch gewaehlt', async () => (await speicher('einstellungen'))?.stil === 'mia-patch');
  pruefe((await eigenschaft(radio('mia-patch'), 'checked')) === true, 'Mia patch ist gewaehlt');

  // Pack weg: das Popup zeigt wieder den wirksamen Stil (Mosaik) und sperrt
  await imSeitenkontext(`await api.storage.local.remove('pack');`);
  await bis('wieder gesperrt', async () => (await eigenschaft(radio('mia-patch'), 'disabled')) === true);
  pruefe((await eigenschaft(radio('mosaik'), 'checked')) === true, 'ohne Pack zeigt das Popup Mosaik');
  await imSeitenkontext(`await api.storage.local.set({ einstellungen: { ...(await api.storage.local.get('einstellungen')).einstellungen, stil: 'mosaik' } });`);

  // Verweis oeffnet die Einstellungsseite
  const vorherTabs = await driver.getAllWindowHandles();
  await driver.findElement(By.css('#pack-link')).click();
  const options = await bis('Einstellungsseite geoeffnet', async () => (await driver.getAllWindowHandles()).find((h) => !vorherTabs.includes(h)));
  await driver.switchTo().window(options);
  await bis('Einstellungsseite geladen', async () => (await driver.getCurrentUrl()).endsWith('/options.html'));
  pruefe((await driver.getCurrentUrl()).endsWith('/options.html'), 'Verweis oeffnet options.html');
  await driver.switchTo().window(popup).catch(() => {});
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: popup.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
