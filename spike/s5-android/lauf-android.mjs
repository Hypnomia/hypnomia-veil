// Wegwerf-Spike S5: S1-Messseite in Firefox fuer Android im Emulator (geckodriver, wie tests/android/hello.test.mjs).
// Der Messserver aus spike/s1-modell laeuft dafuer auf allen Schnittstellen (VEIL_S1_HOST=0.0.0.0), der Emulator
// erreicht den Mac unter 10.0.2.2. Parameter wie lauf-chromium.mjs: --modell 320n|640m, --kanal, --max N, --saetze.
// Vorher: export ANDROID_HOME=... und Emulator veil-android15 starten (siehe UEBERGABE-1).
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

process.env.SE_AVOID_STATS = 'true';
const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const port = Number(process.env.VEIL_S1_PORT ?? 47195);
const seriennummer = process.env.VEIL_ANDROID_SERIAL ?? 'emulator-5554';
const paketName = process.env.VEIL_ANDROID_PACKAGE ?? 'org.mozilla.firefox';
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const modell = arg('modell') === '640m' ? '640m' : '320n';
const kanal = arg('kanal') === 'bgr' ? 'bgr' : 'rgb';
const max = arg('max') ?? '0';
const saetze = arg('saetze') ?? 'nsfw,sfw';
const schwelle = arg('schwelle') ?? '0.2';
const abfrage = `browser=android&backend=wasm&modell=${modell}&kanal=${kanal}&pad=ru&schwelle=${schwelle}&max=${max}&saetze=${saetze}`;
const geckodriver = process.env.VEIL_GECKODRIVER ?? execFileSync('which', ['geckodriver'], { encoding: 'utf8' }).trim();

const server = spawn(process.execPath, [path.join(wurzel, 'spike/s1-modell/server.mjs')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VEIL_S1_PORT: String(port), VEIL_S1_HOST: '0.0.0.0' } });
let driver;
let code = 0;
try {
  await new Promise((r) => setTimeout(r, 800));
  const optionen = new firefox.Options();
  optionen.set('moz:firefoxOptions', { androidPackage: paketName, androidDeviceSerial: seriennummer });
  const dienst = new firefox.ServiceBuilder(geckodriver);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 120_000, script: 1_800_000 });
  const t0 = Date.now();
  await driver.get(`http://10.0.2.2:${port}/?${abfrage}`);
  console.log(`android: Seite geladen nach ${Date.now() - t0} ms`);
  let fertig = null;
  let letzterTitel = '';
  while (Date.now() - t0 < 1_800_000) {
    fertig = await driver.executeScript('return document.documentElement.dataset.fertig ?? null');
    if (fertig === '1') break;
    const titel = await driver.getTitle();
    if (titel !== letzterTitel) { letzterTitel = titel; console.log(`android: ${titel} (${Math.round((Date.now() - t0) / 1000)} s)`); }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (fertig !== '1') throw new Error('Zeitlimit von 30 Minuten ueberschritten');
  const fehler = await driver.executeScript('return document.documentElement.dataset.fehler ?? null');
  if (fehler) throw new Error(fehler);
  const e = JSON.parse(await driver.executeScript('return document.documentElement.dataset.ergebnis'));
  const kurz = {};
  for (const k of ['browser', 'modell', 'kanal', 'backend', 'genutztesBackend', 'simd', 'numThreads', 'userAgent', 'modellLadenMs', 'sessionMs', 'kaltstartMs', 'anzahl', 'dekodMedianMs', 'vorMedianMs', 'infMedianMs', 'infP90Ms', 'infP95Ms', 'nachMedianMs', 'jeBildMedianMs', 'bilderProSekunde', 'koerperzonen', 'fehlerBilder', 'gesamtMs', 'datei']) kurz[k] = e[k];
  console.log('android Ergebnis:', JSON.stringify(kurz, null, 2));
} catch (f) {
  console.error('android: FEHLER', f);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  server.kill();
}
process.exit(code);
