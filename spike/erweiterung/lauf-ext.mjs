// Wegwerf-Spike: baut die Spike-Erweiterung, laedt sie in Chromium (Playwright) oder Firefox (selenium)
// und steuert sie ueber die Brueckenseite (http://127.0.0.1:<port>/bruecke.html, Content-Script bruecke.js):
// S1 im Erweiterungskontext, Kaltstart nach Leerlauf, S2 auf einer Seite, Feed-Freigabe.
// Parameter: --browser chromium|firefox, --modell, --backend, --threads, --strategie, --freigabe, --max N, --saetze nsfw,sfw,
//   --aufgabe s1|kaltstart|s2|feed|status|liste, --url <Seite>, --warten <ms>, --wartenSeite <ms>, --sichtbar, --modellQuelle, --kanal, --datei <JSON mit urls>
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baue } from './bau.mjs';

process.env.SE_AVOID_STATS = 'true';
const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const arg = (name, standard) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : standard; };
const browser = arg('browser', 'chromium') === 'firefox' ? 'firefox' : 'chromium';
const aufgabe = arg('aufgabe', 's1');
const port = Number(process.env.VEIL_S1_PORT ?? 47181);
const sichtbar = process.argv.includes('--sichtbar');
const SPIKE_UUID = '2a9c4d8e-1b3f-4a5c-8d7e-6f5a4b3c2d1e';

const gebaut = baue({ browser, modell: arg('modell'), backend: arg('backend'), threads: arg('threads'), strategie: arg('strategie'), freigabe: arg('freigabe'), vorladen: process.argv.includes('--vorladen'), modellQuelle: arg('modellQuelle'), kanal: arg('kanal'), name: arg('name'), coep: arg('coep'), parallel: arg('parallel') });
console.log(`gebaut: ${path.relative(wurzel, gebaut.ziel)} (${JSON.stringify(gebaut.konfig)})`);

const server = spawn(process.execPath, [path.join(wurzel, 'spike/s1-modell/server.mjs')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VEIL_S1_PORT: String(port) } });
await new Promise((r) => setTimeout(r, 700));
const bruecke = `http://127.0.0.1:${port}/bruecke.html`;

const params = {
  server: `http://127.0.0.1:${port}`, browser: `${browser}-ext`, max: Number(arg('max', 0)) || undefined, saetze: arg('saetze', 'nsfw,sfw').split(','),
  wartenMs: Number(arg('warten', 35000)), schliessen: process.argv.includes('--schliessen'), kanal: arg('kanal'), url: arg('url'), videoBild: process.argv.includes('--videoBild'), videoPixel: process.argv.includes('--videoPixel'),
  modell: arg('modell'),
};
const kurzS1 = (r) => {
  const kurz = { ...r };
  delete kurz.zonen;
  delete kurz.jeBild;
  kurz.verpasstJeZone = Object.fromEntries(Object.entries(r.zonen ?? {}).map(([z, v]) => [z, `${v.treffer_sichtbar}/${v.soll_sichtbar} (${v.verpasst_prozent}%), fehl nsfw ${v.fehlalarm_nsfw}, fehl sfw ${v.fehlalarm_sfw}`]));
  return kurz;
};

// rufe(fn, params) fuehrt eine Steuerfunktion ueber die Brueckenseite aus; oeffne(url) oeffnet einen Tab (gibt tabId).
async function fuehreAus(rufe, oeffne, leseAttribut) {
  const status = await rufe('status', {});
  console.log('status:', JSON.stringify({ instanz: status.instanz, kontext: status.konfig?.kontext, gpu: status.gpu, navigatorGpu: status.navigatorGpu, crossOriginIsolated: status.crossOriginIsolated, numThreads: status.sessionInfo?.numThreads, ua: status.userAgent?.slice(0, 90) }));
  if (aufgabe === 'status') return status;
  if (aufgabe === 's1') {
    const r = await rufe('messeS1', params);
    console.log('S1 Erweiterung:', JSON.stringify(kurzS1(r), null, 2));
    return r;
  }
  if (aufgabe === 'kaltstart') {
    const r = await rufe('kaltstart', params);
    console.log('Kaltstart:', JSON.stringify(r, null, 2));
    return r;
  }
  if (aufgabe === 'liste') {
    const urls = JSON.parse(await readFile(arg('datei'), 'utf8'));
    const liste = Array.isArray(urls) ? urls : urls.urls;
    const r = await rufe('holeListe', { urls: liste, seitenReferer: arg('referrer'), dekod: true, S: 320 });
    console.log('Liste:', JSON.stringify(r, null, 2));
    return r;
  }
  if (aufgabe === 's2' || aufgabe === 'feed') {
    const tabId = await oeffne(params.url);
    await new Promise((r) => setTimeout(r, Number(arg('wartenSeite', 6000))));
    if (aufgabe === 's2') {
      const r = await rufe('messeS2', { ...params, tabId });
      console.log('S2:', JSON.stringify(r, null, 2));
      return r;
    }
    const f = await leseAttribut(tabId);
    if (process.env.VEIL_DEBUG) console.log('dataset:', JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).slice(0, 120)]))));
    const start = Number(f.veilStart ?? 0);
    const freigaben = JSON.parse(f.veilFreigaben ?? '[]');
    const sichtbare = freigaben.filter((x) => x.sichtbar);
    const r = {
      strategie: f.veilStrategie, start, anzahlFreigaben: freigaben.length, anfangsSichtbare: sichtbare.length,
      freiSichtbarerBereichMs: sichtbare.length ? Math.max(...sichtbare.map((x) => x.t)) - start : null,
      ersteFreigabeMs: freigaben.length ? Math.min(...freigaben.map((x) => x.t)) - start : null,
      letzteFreigabeMs: freigaben.length ? Math.max(...freigaben.map((x) => x.t)) - start : null,
      seiteFreiMs: f.veilSeiteFreiMs ? Number(f.veilSeiteFreiMs) - start : null, seiteDebug: f.veilSeiteDebug ?? null,
      kaltstartDabei: freigaben.some((x) => x.kalt), fehler: freigaben.filter((x) => !x.ok).length,
      dauerMedianMs: (() => { const d = freigaben.map((x) => x.dauer).sort((a, b) => a - b); return d.length ? d[d.length >> 1] : null; })(),
      inferenzMedianMs: (() => { const d = freigaben.map((x) => x.ms?.inf).filter((v) => v != null).sort((a, b) => a - b); return d.length ? d[d.length >> 1] : null; })(),
      freigaben: freigaben.map((x) => ({ feed: x.feed, sichtbar: x.sichtbar, tMs: x.t - start, dauer: x.dauer, kalt: x.kalt, zonen: x.zonen, fehler: x.fehler })),
    };
    console.log('Feed:', JSON.stringify(r, null, 2));
    return r;
  }
  throw new Error(`unbekannte Aufgabe ${aufgabe}`);
}

let code = 0;
let aufraeumen = async () => {};
try {
  if (browser === 'chromium') {
    const { chromium } = await import('@playwright/test');
    const profil = await mkdtemp(path.join(tmpdir(), 'veil-spike-'));
    const gpuArgs = gebaut.konfig.backend === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] : [];
    const context = await chromium.launchPersistentContext(profil, { channel: 'chromium', headless: !sichtbar, args: [`--disable-extensions-except=${gebaut.ziel}`, `--load-extension=${gebaut.ziel}`, ...gpuArgs] });
    aufraeumen = async () => { await context.close().catch(() => {}); await rm(profil, { recursive: true, force: true }); };
    const seite = await context.newPage();
    seite.on('console', (m) => { if (m.type() === 'error' || process.env.VEIL_DEBUG) console.error('bruecke-konsole:', m.text().slice(0, 300)); });
    await seite.goto(bruecke);
    await seite.waitForFunction(() => document.documentElement.dataset.veilBruecke === '1', null, { timeout: 15_000 });
    let zaehler = 0;
    const rufe = async (fn, p) => {
      const id = `${Date.now().toString(36)}${zaehler++}`;
      await seite.bringToFront();
      return seite.evaluate(([id, fn, p]) => new Promise((ok) => {
        window.dispatchEvent(new CustomEvent('veil-befehl', { detail: JSON.stringify({ id, fn, params: p }) }));
        const t = setInterval(() => { const a = document.documentElement.getAttribute(`data-veil-antwort-${id}`); if (a !== null) { clearInterval(t); ok(JSON.parse(a)); } }, 100);
      }), [id, fn, p]);
    };
    const seiten = new Map();
    const oeffne = async (url) => {
      const neu = await context.newPage();
      neu.on('console', (m) => { if (m.type() === 'error' || process.env.VEIL_DEBUG) console.error('seite-konsole:', m.text().slice(0, 300)); });
      await neu.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => console.error('seite:', e.message));
      await seite.bringToFront();
      const tabs = await rufe('sammleTab', { url, nurId: true }).catch(() => null);
      const id = tabs?.tabId ?? null;
      seiten.set(id, neu);
      return id;
    };
    const leseAttribut = async () => {
      const neu = [...seiten.values()].at(-1);
      return neu.evaluate(() => ({ ...document.documentElement.dataset }));
    };
    await fuehreAus(rufe, oeffne, leseAttribut);
  } else {
    const { Builder } = await import('selenium-webdriver');
    const firefox = (await import('selenium-webdriver/firefox.js')).default;
    const optionen = new firefox.Options().setBinary(process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox');
    if (!sichtbar) optionen.addArguments('-headless');
    optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ 'veil-spike@hypnomia': SPIKE_UUID }));
    if (gebaut.konfig.backend === 'webgpu') optionen.setPreference('dom.webgpu.enabled', true);
    const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
    aufraeumen = async () => { await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]); };
    await driver.manage().setTimeouts({ pageLoad: 60_000, script: 900_000 });
    const t0 = Date.now();
    await driver.installAddon(gebaut.zip, true);
    console.log(`firefox: Erweiterung installiert nach ${Date.now() - t0} ms`);
    await driver.get(bruecke);
    const brueckeGriff = await driver.getWindowHandle();
    await driver.wait(async () => (await driver.executeScript('return document.documentElement.dataset.veilBruecke ?? null')) === '1', 15_000);
    let zaehler = 0;
    const rufe = async (fn, p) => {
      const id = `${Date.now().toString(36)}${zaehler++}`;
      await driver.switchTo().window(brueckeGriff);
      return driver.executeAsyncScript(`const [id, fn, p, fertig] = arguments;
        window.dispatchEvent(new CustomEvent('veil-befehl', { detail: JSON.stringify({ id, fn, params: p }) }));
        const t = setInterval(() => { const a = document.documentElement.getAttribute('data-veil-antwort-' + id); if (a !== null) { clearInterval(t); fertig(JSON.parse(a)); } }, 100);`, id, fn, p);
    };
    let seitenGriff = null;
    const oeffne = async (url) => {
      await driver.switchTo().newWindow('tab');
      seitenGriff = await driver.getWindowHandle();
      await driver.get(url).catch((e) => console.error('seite:', e.message));
      await driver.switchTo().window(brueckeGriff);
      const tabs = await rufe('sammleTab', { url, nurId: true }).catch(() => null);
      return tabs?.tabId ?? null;
    };
    const leseAttribut = async () => {
      await driver.switchTo().window(seitenGriff);
      const d = await driver.executeScript('return Object.assign({}, document.documentElement.dataset)');
      await driver.switchTo().window(brueckeGriff);
      return d;
    };
    await fuehreAus(rufe, oeffne, leseAttribut);
  }
} catch (f) {
  console.error(`${browser}: FEHLER`, f);
  code = 1;
} finally {
  await aufraeumen();
  server.kill();
}
process.exit(code);
