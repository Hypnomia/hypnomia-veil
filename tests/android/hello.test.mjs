// Android-Test: Firefox fuer Android im Emulator ueber geckodriver/WebDriver.
// Schritt 1: Fixture-Seite laden, Ueberschrift lesen, Ladezeit messen.
// Schritt 2: signierte XPI installieren (auf Android nur signiert moeglich) und Attribut pruefen.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

// Globaler Waechter: haengt irgendetwas, endet der Lauf nach 60 Sekunden mit Fehler.
setTimeout(() => {
  console.error('android: Zeitlimit von 60 s ueberschritten');
  process.exit(1);
}, 60_000).unref();

// Selenium Manager soll keine Nutzungsstatistik senden.
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const signiert = path.join(wurzel, '.output', 'signed');
const seriennummer = process.env.VEIL_ANDROID_SERIAL ?? 'emulator-5554';
const paketName = process.env.VEIL_ANDROID_PACKAGE ?? 'org.mozilla.firefox';
const port = Number(process.env.VEIL_ANDROID_FIXTURE_PORT ?? 47175);
// Im Emulator ist der Mac unter 10.0.2.2 erreichbar.
const seitenUrl = `http://10.0.2.2:${port}/hello.html`;

// geckodriver-Pfad selbst setzen: sonst traegt Selenium Manager ein Desktop-Firefox als
// "binary" ein, und das schliesst sich mit androidPackage aus.
const geckodriver = process.env.VEIL_GECKODRIVER ?? execFileSync('which', ['geckodriver'], { encoding: 'utf8' }).trim();

let server;
let driver;
let code = 0;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options();
  // moz:firefoxOptions mit androidPackage und androidDeviceSerial (kein -headless: auf Android nicht unterstuetzt)
  optionen.set('moz:firefoxOptions', {
    androidPackage: paketName,
    androidDeviceSerial: seriennummer,
  });
  const dienst = new firefox.ServiceBuilder(geckodriver);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000 });

  // Schritt 1: Seite laden, Ueberschrift lesen
  const start = Date.now();
  await driver.get(seitenUrl);
  const ueberschrift = await driver.executeScript('return document.querySelector("h1")?.textContent ?? null');
  console.log(`android: Schritt 1: Ueberschrift "${ueberschrift}" nach ${Date.now() - start} ms`);
  if (ueberschrift !== 'Hello Veil') throw new Error(`Ueberschrift unerwartet: ${ueberschrift}`);
  // Vor der Installation darf das Attribut nicht gesetzt sein (sonst waere Schritt 2 wertlos).
  const vorher = await driver.executeScript('return document.documentElement.dataset.hypnomiaVeil ?? null');
  if (vorher !== null) throw new Error(`Attribut schon vor der Installation gesetzt: ${vorher}`);

  // Schritt 2: signierte XPI installieren
  const xpis = existsSync(signiert) ? readdirSync(signiert).filter((n) => n.endsWith('.xpi')) : [];
  if (xpis.length === 0) {
    console.log('android: Schritt 2 uebersprungen: keine signierte XPI unter .output/signed/*.xpi');
  } else {
    const xpi = path.join(signiert, xpis.sort().at(-1));
    await driver.installAddon(xpi, false);
    const t2 = Date.now();
    await driver.get(seitenUrl);
    let wert = null;
    while (Date.now() - t2 < 15_000) {
      wert = await driver.executeScript('return document.documentElement.dataset.hypnomiaVeil ?? null');
      if (wert === 'hello') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (wert !== 'hello') throw new Error(`Schritt 2: Attribut fehlt (Wert: ${wert})`);
    console.log(`android: Schritt 2: Attribut nach ${Date.now() - t2} ms`);
  }
} catch (fehler) {
  console.error('android: FEHLER', fehler);
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
