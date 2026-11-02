// Startet den Messserver und misst S1 in Firefox (selenium-webdriver, headless).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

process.env.SE_AVOID_STATS = 'true';
const hier = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VEIL_S1_PORT ?? 47180);
const firefoxBin = process.env.VEIL_FIREFOX_BIN;
if (!firefoxBin) {
  console.error('firefox: VEIL_FIREFOX_BIN fehlt');
  process.exit(1);
}
// Parameter: --backend wasm|webgpu (WebGPU in Firefox: Pref dom.webgpu.enabled).
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const backend = arg('backend') === 'webgpu' ? 'webgpu' : 'wasm';
const server = spawn(process.execPath, [path.join(hier, 'server.mjs')], { stdio: ['ignore', 'inherit', 'inherit'] });
let driver;
let code = 0;
try {
  await new Promise((r) => setTimeout(r, 800));
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  if (backend === 'webgpu') optionen.setPreference('dom.webgpu.enabled', true);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 60_000, script: 600_000 });
  await driver.get(`http://127.0.0.1:${port}/?browser=firefox&backend=${backend}`);
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
  console.log('firefox Ergebnis:', JSON.stringify(JSON.parse(ergebnis), null, 2));
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
