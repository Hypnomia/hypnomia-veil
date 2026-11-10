// Messung der Zonen-Leinwand fuer Videos (Bauplan Video-Zonen, M1 und M2). Kein Produktcode.
//   M1  Rundlauf je Zonen-Pruefung (Aufnahme des Bildes bis Antwort), Median und p90, mit und ohne Gesichtszonen (YuNet)
//   M2  Zeit je Bild fuer Analyse (Graustufenbild, Daumen), Verfolgung und Malen, bei 360p, 720p und 1080p Aufnahme (Anzeige 1280 mal 720)
// Aufruf: node scripts/messung/video-zonen.mjs --browser chromium|firefox [--ausgabe .output-video] [--dauer 9]
// Liest den Testbau (npm run build:test, zip:test:firefox) aus dem Ausgabeordner. Messen nur ohne andere Last.
import { chromium } from '@playwright/test';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const browser = arg('browser', 'chromium');
const dauer = Number(arg('dauer', '9')) * 1000;
const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ausgabe = path.join(wurzel, arg('ausgabe', process.env.VEIL_AUSGABE ?? '.output-test'));
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (l) => (l.length ? [...l].sort((a, b) => a - b)[l.length >> 1] : null);
const p90 = (l) => (l.length ? [...l].sort((a, b) => a - b)[Math.min(l.length - 1, Math.floor(l.length * 0.9))] : null);

const server = await starteFixtureServer(port);
await starteFixtureServer(port + 2);

// Gemeinsame Schnittstelle: oeffne(url), ausfuehren(js-Funktion als Text), setzeEinstellungen(obj)
let ctx;
let profil;
let seite;
let driver;
let worker;
if (browser === 'chromium') {
  const erweiterung = path.join(ausgabe, 'chrome-mv3');
  profil = await mkdtemp(path.join(tmpdir(), 'veil-mess-'));
  ctx = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 10_000 }));
} else {
  const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
  const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
  if (!existsSync(paket)) throw new Error(`Paket fehlt: ${paket}`);
  const bin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
  const opt = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(bin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opt).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  console.log(`Firefox ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
}

async function oeffne(abfrage) {
  const url = `${basis}/video-zonen.html?bild=${BILD}&${abfrage}`;
  if (browser === 'chromium') {
    if (seite) await seite.close();
    seite = await ctx.newPage();
    await seite.setViewportSize({ width: 1400, height: 800 });
    await seite.goto(url);
  } else await driver.get(url);
}
const js = async (code) => (browser === 'chromium' ? seite.evaluate(`(() => { ${code} })()`) : driver.executeScript(code));
async function setze(e) {
  if (browser === 'chromium') {
    await worker.evaluate(async (n) => {
      await chrome.storage.local.set({ einstellungen: n });
    }, e);
  } else await js(`document.dispatchEvent(new CustomEvent('veil-test', { detail: ${JSON.stringify(JSON.stringify({ einstellungen: e }))} }))`);
}
async function misse(aufl, gesicht) {
  await setze({ video: 'zonen', zonen: gesicht ? { eyes: { an: true }, mouth: { an: true }, face: { an: true } } : {} });
  await oeffne(`kurz=1&aufl=${aufl}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000 && !(await js("return document.documentElement.dataset.filmBereit ?? null"))) await warte(250);
  await js("window.neuesVideo({ id: 'v1', breite: 1280, hoehe: 720, loop: true }); return 1;");
  // Anlaufzeit (Erkenner laedt, erste Treffer), dann Zaehler ruecksetzen geht nicht: Differenz zweier Staende
  const stand = async () => JSON.parse((await js('return document.documentElement.dataset.veilStatus ?? null')) ?? '{}');
  const ab = Date.now();
  while (Date.now() - ab < 30_000 && (await js("return document.getElementById('v1').getAttribute('data-veil-video-modus')")) === null) await warte(100);
  await warte(1500);
  const s0 = await stand();
  await warte(dauer);
  const s1 = await stand();
  const ms = (s1.videoZonenMs - s0.videoZonenMs) / Math.max(1, s1.videoZonenMsBilder - s0.videoZonenMsBilder);
  const neu = (s1.videoZonenRtt ?? []).slice(-Math.min(64, s1.videoZonenPruefungen - s0.videoZonenPruefungen));
  return {
    aufl,
    gesicht,
    bilder: s1.videoZonenMsBilder - s0.videoZonenMsBilder,
    msJeBild: Math.round(ms * 100) / 100,
    msGrau: Math.round(((s1.videoZonenMsGrau - s0.videoZonenMsGrau) / Math.max(1, s1.videoZonenMsBilder - s0.videoZonenMsBilder)) * 100) / 100,
    msVerfolgung: Math.round(((s1.videoZonenMsVerfolgung - s0.videoZonenMsVerfolgung) / Math.max(1, s1.videoZonenMsBilder - s0.videoZonenMsBilder)) * 100) / 100,
    msMalen: Math.round(((s1.videoZonenMsMalen - s0.videoZonenMsMalen) / Math.max(1, s1.videoZonenMsBilder - s0.videoZonenMsBilder)) * 100) / 100,
    pruefungen: s1.videoZonenPruefungen - s0.videoZonenPruefungen,
    prueJeS: Math.round(((s1.videoZonenPruefungen - s0.videoZonenPruefungen) / (dauer / 1000)) * 10) / 10,
    rttMedian: median(neu),
    rttP90: p90(neu),
    ganz: s1.videoZonenGanz - s0.videoZonenGanz,
    rueckfall: s1.videoZonenRueckfall,
  };
}

try {
  const ergebnisse = [];
  for (const [aufl, gesicht] of [[360, false], [360, true], [720, false], [1080, false]]) {
    const e = await misse(aufl, gesicht);
    ergebnisse.push(e);
    console.log(`${browser} ${JSON.stringify(e)}`);
  }
  console.log(`\nM1 und M2 (${browser}, Anzeige 1280 x 720):`);
  for (const e of ergebnisse) console.log(`  ${e.aufl}p ${e.gesicht ? 'mit Gesichtszonen' : 'ohne Gesicht'}: ${e.msJeBild} ms je Bild (davon Graustufen und Daumen ${e.msGrau}, Verfolgung ${e.msVerfolgung}, Malen ${e.msMalen}; ${e.bilder} Bilder), ${e.prueJeS} Pruefungen je s, Rundlauf Median ${e.rttMedian} ms, p90 ${e.rttP90} ms, Rueckfaelle ${JSON.stringify(e.rueckfall)}`);
} finally {
  if (ctx) await ctx.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  server.close();
  process.exit(0);
}
