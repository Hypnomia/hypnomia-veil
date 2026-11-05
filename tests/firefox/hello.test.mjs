// Firefox-Test ueber geckodriver/WebDriver (Playwright kann in Firefox keine Erweiterungen laden).
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

// Globaler Waechter: haengt irgendetwas, endet der Lauf nach 60 Sekunden mit Fehler.
setTimeout(() => {
  console.error('firefox: Zeitlimit von 60 s ueberschritten');
  process.exit(1);
}, 60_000).unref();

// Selenium Manager soll keine Nutzungsstatistik senden.
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);

// Zip-Name exakt aus package.json (Vorlage von WXT: name-version-browser.zip).
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

let server;
let driver;
let code = 0;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 15_000 });
  // true = temporaere Installation, keine Signatur noetig
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);

  const start = Date.now();
  await driver.get(`http://127.0.0.1:${port}/hello.html`);
  let wert = null;
  while (Date.now() - start < 15_000) {
    wert = await driver.executeScript('return document.documentElement.dataset.hypnomiaVeil ?? null');
    if (wert === 'hello') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (wert !== 'hello') throw new Error(`Attribut fehlt (Wert: ${wert})`);
  console.log(`firefox: Attribut nach ${Date.now() - start} ms`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  // Schliessen darf nie haengen: Treiber hoechstens 10 s warten lassen.
  if (driver) {
    await Promise.race([
      driver.quit().catch(() => {}),
      new Promise((r) => setTimeout(r, 10_000)),
    ]);
  }
  if (server) server.close();
}
process.exit(code);
