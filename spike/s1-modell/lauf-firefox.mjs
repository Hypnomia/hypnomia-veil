// Startet den Messserver und misst S1 in Firefox (selenium-webdriver, headless).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

process.env.SE_AVOID_STATS = 'true';
const hier = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VEIL_S1_PORT ?? 47180);
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
// Parameter: --backend wasm|webgpu (WebGPU in Firefox: Pref dom.webgpu.enabled).
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const backend = arg('backend') === 'webgpu' ? 'webgpu' : 'wasm';
const sichtbar = process.argv.includes('--sichtbar');
const modell = arg('modell') === '320n' ? '320n' : '640m';
const kanal = arg('kanal') === 'bgr' ? 'bgr' : 'rgb';
const pad = arg('pad') === 'mitte' ? 'mitte' : 'ru';
const schwelle = arg('schwelle') ?? '0.2';
const max = arg('max') ?? '0';
const saetze = arg('saetze') ?? 'nsfw,sfw';
const abfrage = `backend=${backend}&modell=${modell}&kanal=${kanal}&pad=${pad}&schwelle=${schwelle}&max=${max}&saetze=${saetze}`;
const server = spawn(process.execPath, [path.join(hier, 'server.mjs')], { stdio: ['ignore', 'inherit', 'inherit'] });
let driver;
let code = 0;
try {
  await new Promise((r) => setTimeout(r, 800));
  const optionen = new firefox.Options().setBinary(firefoxBin);
  if (!sichtbar) optionen.addArguments('-headless');
  if (backend === 'webgpu') optionen.setPreference('dom.webgpu.enabled', true);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 60_000, script: 600_000 });
  await driver.get(`http://127.0.0.1:${port}/?browser=firefox&${abfrage}`);
  const start = Date.now();
  let fertig = null;
  while (Date.now() - start < 600_000) {
    fertig = await driver.executeScript('return document.documentElement.dataset.fertig ?? null');
    if (fertig === '1') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (fertig !== '1') throw new Error('Zeitlimit von 10 Minuten ueberschritten');
  const fehler = await driver.executeScript('return document.documentElement.dataset.fehler ?? null');
  if (fehler) throw new Error(fehler);
  const ergebnis = await driver.executeScript('return document.documentElement.dataset.ergebnis');
  const e = JSON.parse(ergebnis);
  // Kurzfassung im Terminal; die vollstaendigen Zahlen je Zone und je Bild stehen in der Ergebnisdatei.
  const kurz = {};
  for (const k of ['browser', 'modell', 'kanal', 'pad', 'schwelle', 'backend', 'genutztesBackend', 'gpuAdapter', 'fehlerLog', 'crossOriginIsolated', 'numThreads', 'modellLadenMs', 'sessionMs', 'kaltstartMs', 'anzahl', 'dekodMedianMs', 'vorMedianMs', 'infMedianMs', 'infP90Ms', 'infP95Ms', 'nachMedianMs', 'jeBildMedianMs', 'bilderProSekunde', 'koerperzonen', 'fehlerBilder', 'gesamtMs', 'datei']) kurz[k] = e[k];
  kurz.verpasstJeZone = Object.fromEntries(Object.entries(e.zonen ?? {}).map(([z, v]) => [z, `${v.treffer_sichtbar}/${v.soll_sichtbar} (${v.verpasst_prozent}%), fehl nsfw ${v.fehlalarm_nsfw}, fehl sfw ${v.fehlalarm_sfw}`]));
  console.log('firefox Ergebnis:', JSON.stringify(kurz, null, 2));
} catch (f) {
  console.error('firefox: FEHLER', f);
  code = 1;
} finally {
  if (driver) {
    await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  }
  server.kill();
}
process.exit(code);
