// Startet den Messserver und misst S1 in Chromium (Playwright, headless).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const hier = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VEIL_S1_PORT ?? 47180);
// Parameter: --backend wasm|webgpu, --threads N, --sichtbar (Fenster statt headless).
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const backend = arg('backend') === 'webgpu' ? 'webgpu' : 'wasm';
const threads = Number(arg('threads') ?? 1) || 1;
const sichtbar = process.argv.includes('--sichtbar');
// WebGPU in Chromium: headless braucht diese Flags (Metal ueber ANGLE). Vulkan ist auf macOS nicht noetig.
const gpuArgs = backend === 'webgpu'
  ? ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist']
  : [];
const abfrage = `backend=${backend}${threads > 1 ? `&threads=${threads}` : ''}`;
const server = spawn(process.execPath, [path.join(hier, 'server.mjs')], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, VEIL_S1_LOG: '1' } });
let browser;
let code = 0;
try {
  await new Promise((r) => setTimeout(r, 800));
  browser = await chromium.launch({ headless: !sichtbar, channel: 'chromium', args: gpuArgs });
  const seite = await (await browser.newContext()).newPage();
  seite.on('console', (m) => { if (m.type() === 'error') console.error('chromium-konsole:', m.text()); });
  seite.on('pageerror', (e) => console.error('chromium-seitenfehler:', String(e).slice(0, 400)));
  seite.on('requestfailed', (r) => console.error('chromium-anfrage-fehlt:', r.url(), r.failure()?.errorText));
  await seite.goto(`http://127.0.0.1:${port}/?browser=chromium&${abfrage}`);
  await seite.waitForFunction(() => document.documentElement.dataset.fertig === '1', null, { timeout: 600_000, polling: 500 });
  const { fehler, ergebnis } = await seite.evaluate(() => ({
    fehler: document.documentElement.dataset.fehler ?? null,
    ergebnis: document.documentElement.dataset.ergebnis ?? null,
  }));
  if (fehler) throw new Error(fehler);
  console.log('chromium Ergebnis:', JSON.stringify(JSON.parse(ergebnis), null, 2));
} catch (f) {
  console.error('chromium: FEHLER', f);
  code = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
process.exit(code);
