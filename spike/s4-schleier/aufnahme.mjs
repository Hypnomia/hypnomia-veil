// Wegwerf-Messgeschirr fuer S4: Bildschirmaufnahme einer Browser-Sitzung, Magenta-Pixel je Einzelbild und je Kachel zaehlen.
// Kein Produktcode. Aufruf: node spike/s4-schleier/aufnahme.mjs --browser chromium|firefox --erweiterung <Pfad> | --ohne-erweiterung
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { starteS4Server } from './server.mjs';

// Selenium Manager soll keine Nutzungsstatistik senden.
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ffmpegBin = process.env.VEIL_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const BILDRATE_BILDSCHIRM = 60; // nur der Wunsch an ffmpeg; ausgewertet werden die echten Zeitstempel
const BILDRATE_VIDEO = 25;
const LUECKE_MS = 20; // Abstand zweier Frames, ab dem eine Luecke gemeldet wird
const SCROLL_NACH_NAVIGATION_MS = 2500;
const REFERENZ_MINDESTANTEIL = 0.9;

// ---------- Parameter ----------
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const browserName = arg('browser');
const ohneErweiterung = process.argv.includes('--ohne-erweiterung');
const erweiterung = arg('erweiterung');
const dauer = Number(arg('dauer') ?? 6);
if (!['chromium', 'firefox'].includes(browserName)) {
  console.error('aufnahme: --browser chromium|firefox ist Pflicht');
  process.exit(1);
}
if (!ohneErweiterung && !erweiterung) {
  console.error('aufnahme: entweder --erweiterung <Pfad> oder --ohne-erweiterung angeben');
  process.exit(1);
}
if (!(dauer > 0)) {
  console.error('aufnahme: --dauer muss eine positive Zahl sein');
  process.exit(1);
}
const erweiterungPfad = ohneErweiterung ? null : path.resolve(erweiterung);
if (erweiterungPfad && !existsSync(erweiterungPfad)) {
  console.error(`aufnahme: Erweiterung nicht gefunden: ${path.relative(wurzel, erweiterungPfad)}`);
  process.exit(1);
}
const name = (arg('name') ?? `${browserName}${ohneErweiterung ? '-kontrolle' : ''}`).replace(/[^a-z0-9-]/gi, '-');
const stempel = new Date().toISOString().replace(/[:.]/g, '-');
const arbeit = path.join(wurzel, '.output/spike-s4', name);
rmSync(arbeit, { recursive: true, force: true });
mkdirSync(arbeit, { recursive: true });

// ---------- Hilfen ----------
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const runde = (x, stellen = 1) => Math.round(x * 10 ** stellen) / 10 ** stellen;

// Index des Eintrags "Capture screen 0" in der AVFoundation-Geraeteliste.
function findeBildschirmIndex() {
  const lauf = spawnSync(ffmpegBin, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' });
  const treffer = /\[(\d+)\] Capture screen 0/.exec(`${lauf.stderr ?? ''}${lauf.stdout ?? ''}`);
  return treffer ? Number(treffer[1]) : null;
}

// Wiederholrate der Bildschirme laut Systemauskunft (ProMotion: bis 120 Hz). Ohne Auskunft: null.
function leseBildschirmHz() {
  const lauf = spawnSync('system_profiler', ['SPDisplaysDataType'], { encoding: 'utf8', timeout: 20_000 });
  const treffer = [...(lauf.stdout ?? '').matchAll(/@\s*(\d+(?:\.\d+)?)\s*Hz/g)].map((t) => Number(t[1]));
  return treffer.length ? treffer : null;
}

// Liest Fenster- und Kachellage im Seitenkontext (gleiches Skript fuer beide Browser).
const GEO_JS = `(() => {
  const rechteck = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, b: b.width, h: b.height }; };
  const marke = document.getElementById('phasenmarke');
  const kacheln = [...document.querySelectorAll('.fall')].map((e) => ({ fall: e.dataset.fall, ...rechteck(e) }));
  return {
    screenX: window.screenX, screenY: window.screenY,
    outerWidth: window.outerWidth, outerHeight: window.outerHeight,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    dpr: window.devicePixelRatio, screenBreite: screen.width, screenHoehe: screen.height,
    geladenMs: document.documentElement.dataset.s4Geladen ?? null,
    marke: marke ? rechteck(marke) : null,
    kacheln,
  };
})()`;

// Scrollt zur Kachel lazy-scroll (sie liegt weit unter dem Ausschnitt), 300 px unter den Fensterrand.
const SCROLL_JS = `(() => {
  const k = document.querySelector('[data-fall="lazy-scroll"]');
  if (!k) return false;
  window.scrollTo(0, k.getBoundingClientRect().top + window.scrollY - 300);
  return true;
})()`;

// ffmpeg als Bildschirmaufnahme starten. Gibt ein Objekt mit Versprechen "gestartet" und "beendet" zurueck.
function starteAufnahme(index, ziel) {
  const argumente = [
    '-hide_banner', '-y', '-stats', '-stats_period', '0.05',
    '-f', 'avfoundation', '-framerate', String(BILDRATE_BILDSCHIRM), '-capture_cursor', '0',
    '-i', `${index}:none`,
    '-t', String(dauer),
    '-pix_fmt', 'yuv444p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0',
    ziel,
  ];
  const kind = spawn(ffmpegBin, argumente, { stdio: ['pipe', 'ignore', 'pipe'] });
  let log = '';
  let beendetFlag = false;
  let meldeStart;
  const gestartet = new Promise((r) => { meldeStart = r; });
  kind.stderr.on('data', (t) => {
    log += t.toString();
    if (log.length > 20000) log = log.slice(-20000);
    if (/frame=\s*[1-9]\d*/.test(log)) meldeStart(true);
  });
  const beendet = new Promise((r) => {
    kind.on('close', (code) => { beendetFlag = true; meldeStart(false); r(code); });
  });
  return { kind, gestartet, beendet, log: () => log, istBeendet: () => beendetFlag };
}

// Letzte Fortschrittszeile von ffmpeg: wie viele Bilder wirklich geschrieben wurden.
function statistikAusLog(text) {
  const bilder = [...text.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
  const tempo = [...text.matchAll(/speed=\s*([\d.]+)x/g)].at(-1)?.[1];
  const dup = [...text.matchAll(/dup=(\d+)/g)].at(-1)?.[1];
  const drop = [...text.matchAll(/drop=(\d+)/g)].at(-1)?.[1];
  return { geschriebeneBilder: bilder ? Number(bilder) : null, tempo: tempo ? Number(tempo) : null, dup: dup ? Number(dup) : 0, drop: drop ? Number(drop) : 0 };
}

function sieheRechtFehler(text) {
  return /Input\/output error|not permitted|permission|Operation not|denied|Could not|Cannot/i.test(text);
}

// Einzelbilder mit ihren echten Zeitstempeln extrahieren (kein Auffuellen auf eine feste Bildrate).
// Gibt die Dateinamen und die Zeit je Frame in Millisekunden zurueck (Null = erstes Frame).
function extrahiere(eingabe, zielOrdner, zuschnitt) {
  rmSync(zielOrdner, { recursive: true, force: true });
  mkdirSync(zielOrdner, { recursive: true });
  const filter = [zuschnitt ? `crop=${zuschnitt.w}:${zuschnitt.h}:${zuschnitt.x}:${zuschnitt.y}` : null, 'showinfo'].filter(Boolean).join(',');
  const lauf = spawnSync(ffmpegBin, ['-hide_banner', '-loglevel', 'info', '-y', '-i', eingabe, '-vf', filter, '-fps_mode', 'passthrough', path.join(zielOrdner, 'frame-%04d.png')], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (lauf.status !== 0) throw new Error(`Einzelbilder extrahieren scheiterte: ${(lauf.stderr ?? '').slice(-400)}`);
  const dateien = readdirSync(zielOrdner).filter((d) => /^frame-\d+\.png$/.test(d)).sort();
  const zeitenSek = [...(lauf.stderr ?? '').matchAll(/Parsed_showinfo[^\n]*?\sn:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:\s*(-?[\d.]+)/g)].map((t) => Number(t[2]));
  if (zeitenSek.length !== dateien.length) throw new Error(`Zeitstempel (${zeitenSek.length}) und Einzelbilder (${dateien.length}) passen nicht zusammen`);
  const ms = zeitenSek.map((t) => (t - zeitenSek[0]) * 1000);
  return { dateien, ms };
}

// Groesse des Videostroms aus der ffmpeg-Ausgabe.
function videoGroesse(datei) {
  const lauf = spawnSync(ffmpegBin, ['-hide_banner', '-i', datei], { encoding: 'utf8' });
  const zeile = (lauf.stderr ?? '').split('\n').find((z) => /Stream #.*Video:/.test(z)) ?? '';
  const t = /,\s*(\d{2,5})x(\d{2,5})[,\s\[]/.exec(zeile);
  return t ? { breite: Number(t[1]), hoehe: Number(t[2]) } : null;
}

// Rechtecke (CSS-Pixel) in Bildpixel umrechnen.
function inBildpixel(r, skala) {
  return { x0: Math.round(r.x * skala), y0: Math.round(r.y * skala), x1: Math.round((r.x + r.b) * skala), y1: Math.round((r.y + r.h) * skala) };
}

function baueKarte(rechtecke, breite, hoehe) {
  const karte = new Int16Array(breite * hoehe).fill(-1);
  rechtecke.forEach((r, k) => {
    if (!r) return;
    for (let y = Math.max(0, r.y0); y < Math.min(hoehe, r.y1); y += 1) {
      for (let x = Math.max(0, r.x0); x < Math.min(breite, r.x1); x += 1) karte[y * breite + x] = k;
    }
  });
  return karte;
}

// Zaehlt je Frame: Magenta (R>200, G<60, B>200) gesamt, je Kachel und ausserhalb aller Kacheln; Gruen (R<60, G>200, B<60) in der Referenzkachel.
// Die Seite hat zwei Phasen: oben (blaue Phasenmarke sichtbar, Lage A) und nach dem Scrollen (Lage B: nur lazy-scroll und Referenz).
async function zaehleFolge(ordner, dateien, plan, breite, hoehe) {
  const karteA = baueKarte(plan.rechteckeA, breite, hoehe);
  const karteB = baueKarte(plan.rechteckeB, breite, hoehe);
  const marke = plan.marke;
  const markeFlaeche = Math.max(1, (marke.x1 - marke.x0) * (marke.y1 - marke.y0));
  const n = plan.namen.length;
  const ergebnisse = new Array(dateien.length);
  const zaehleEins = async (i) => {
    const { data, info } = await sharp(path.join(ordner, dateien[i])).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== breite || info.height !== hoehe) throw new Error(`Bildgroesse weicht ab: ${info.width}x${info.height}`);
    // Phase bestimmen: ist die blaue Marke (R<60, G<60, B>200) zu mindestens 30 Prozent zu sehen?
    let blau = 0;
    for (let y = Math.max(0, marke.y0); y < Math.min(hoehe, marke.y1); y += 1) {
      for (let x = Math.max(0, marke.x0); x < Math.min(breite, marke.x1); x += 1) {
        const p = (y * breite + x) * 3;
        if (data[p] < 60 && data[p + 1] < 60 && data[p + 2] > 200) blau += 1;
      }
    }
    const oben = blau >= 0.3 * markeFlaeche;
    const karte = oben ? karteA : karteB;
    const je = new Array(n).fill(0);
    let gesamt = 0;
    let ausserhalb = 0;
    let gruen = 0;
    for (let p = 0, q = 0; p < data.length; p += 3, q += 1) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (r > 200 && g < 60 && b > 200) {
        gesamt += 1;
        const k = karte[q];
        if (k >= 0) je[k] += 1; else ausserhalb += 1;
      } else if (r < 60 && g > 200 && b < 60 && karte[q] === plan.referenzIndex) {
        gruen += 1;
      }
    }
    ergebnisse[i] = { gesamt, je, ausserhalb, gruen, oben };
  };
  const parallel = 4;
  for (let i = 0; i < dateien.length; i += parallel) {
    await Promise.all(Array.from({ length: Math.min(parallel, dateien.length - i) }, (_, j) => zaehleEins(i + j)));
  }
  return ergebnisse;
}

// Zaehlung zu einem Ergebnisobjekt verdichten.
function verdichte({ quelle, rate, ergebnisse, ms, namen, skala, flaechePixel, nachNavigationAbMs }) {
  const mitMagenta = [];
  const kacheln = {};
  for (const n of namen) kacheln[n] = { framesMitMagenta: 0, framesVoll: 0, ersterFrame: null, ersterFrameMs: null, maxPixel: 0, erfasst: false };
  const ohneKachel = { frames: 0, maxPixel: 0 };
  ergebnisse.forEach((e, i) => {
    const nr = i + 1;
    if (e.gesamt > 0) {
      const belegt = {};
      e.je.forEach((px, k) => { if (px > 0) belegt[namen[k]] = px; });
      mitMagenta.push({ frame: nr, ms: runde(ms[i]), magentaPixel: e.gesamt, ausserhalbKachel: e.ausserhalb, kacheln: belegt });
    }
    if (e.ausserhalb > 0) {
      ohneKachel.frames += 1;
      if (e.ausserhalb > ohneKachel.maxPixel) ohneKachel.maxPixel = e.ausserhalb;
    }
    e.je.forEach((px, k) => {
      if (px > 0) {
        const z = kacheln[namen[k]];
        z.framesMitMagenta += 1;
        z.erfasst = true;
        if (px >= 0.9 * flaechePixel) z.framesVoll += 1;
        if (z.ersterFrame === null) { z.ersterFrame = nr; z.ersterFrameMs = runde(ms[i]); }
        if (px > z.maxPixel) z.maxPixel = px;
      }
    });
  });

  // Luecken zwischen zwei aufeinanderfolgenden Frames (echte Zeitstempel).
  const luecken = [];
  for (let i = 1; i < ms.length; i += 1) {
    const d = ms[i] - ms[i - 1];
    if (d > LUECKE_MS) luecken.push({ nachFrame: i, ms: runde(d) });
  }
  const dauerMs = ms.length > 1 ? ms.at(-1) - ms[0] : 0;

  // Positivkontrolle: Referenzkachel (reines Gruen, immer sichtbar). Gezaehlt ab dem ersten Frame, in dem sie erscheint.
  const ersterGruen = ergebnisse.findIndex((e) => e.gruen >= 0.5 * flaechePixel);
  let referenz;
  if (ersterGruen < 0) {
    referenz = { framesMitGruen: 0, anteil: 0, basisFrames: 0, ersterGruenFrame: null, ersterGruenMs: null };
  } else {
    const basis = ergebnisse.slice(ersterGruen);
    const mitGruen = basis.filter((e) => e.gruen >= 0.5 * flaechePixel).length;
    referenz = { framesMitGruen: mitGruen, anteil: runde(mitGruen / basis.length, 4), basisFrames: basis.length, ersterGruenFrame: ersterGruen + 1, ersterGruenMs: runde(ms[ersterGruen]) };
  }
  const spaetesterErlaubterGruenMs = nachNavigationAbMs + 3000;
  const ungueltig = referenz.ersterGruenMs === null || referenz.anteil < REFERENZ_MINDESTANTEIL || referenz.ersterGruenMs > spaetesterErlaubterGruenMs;
  const ungueltigGrund = ungueltig
    ? (referenz.ersterGruenMs === null ? 'Referenz nie sichtbar'
      : referenz.anteil < REFERENZ_MINDESTANTEIL ? `Referenz nur in ${runde(referenz.anteil * 100)} Prozent der Frames` : 'Referenz erscheint erst mehr als 3 s nach der Navigation')
    : null;

  return {
    quelle,
    bildrate: rate,
    frames: ergebnisse.length,
    bildrateEffektiv: dauerMs > 0 ? runde(((ms.length - 1) * 1000) / dauerMs) : null,
    dauerMs: runde(dauerMs),
    ungueltig,
    ...(ungueltigGrund ? { ungueltigGrund } : {}),
    referenz,
    ersterMagentaFrame: mitMagenta[0]?.frame ?? null,
    letzterMagentaFrame: mitMagenta.at(-1)?.frame ?? null,
    framesMitMagenta: mitMagenta.length,
    magentaOhneKachel: ohneKachel,
    skala,
    kachelFlaechePixel: flaechePixel,
    kurzblitze: Object.fromEntries(['blitz-1frame', 'blitz-50ms'].filter((n) => kacheln[n]).map((n) => [n, { erfasst: kacheln[n].erfasst, framesMitMagenta: kacheln[n].framesMitMagenta, ersterFrame: kacheln[n].ersterFrame, ersterFrameMs: kacheln[n].ersterFrameMs }])),
    luecken,
    lueckenGroessteMs: luecken.length ? Math.max(...luecken.map((l) => l.ms)) : 0,
    lueckenSummeMs: runde(luecken.reduce((s, l) => s + l.ms, 0)),
    kacheln,
    magentaFrames: mitMagenta,
  };
}

function schreibe(kopf, auswertung, dateiName) {
  const datei = path.join(hier, dateiName);
  writeFileSync(datei, JSON.stringify({ ...kopf, ...auswertung }, null, 2));
  return datei;
}

function kurzAusgabe(a) {
  console.log(`aufnahme: Quelle ${a.quelle}: ${a.frames} Frames (effektiv ${a.bildrateEffektiv}/s), ${a.framesMitMagenta} mit Magenta (erster ${a.ersterMagentaFrame}, letzter ${a.letzterMagentaFrame})${a.ungueltig ? `  UNGUELTIG: ${a.ungueltigGrund}` : ''}`);
  console.log(`  Referenz: ${a.referenz.framesMitGruen}/${a.referenz.basisFrames} Frames gruen (Anteil ${a.referenz.anteil}), erster Frame ${a.referenz.ersterGruenFrame}`);
  console.log(`  Luecken > ${LUECKE_MS} ms: ${a.luecken.length} (groesste ${a.lueckenGroessteMs} ms), Magenta ausserhalb der Kacheln: ${a.magentaOhneKachel.frames} Frames (max ${a.magentaOhneKachel.maxPixel} Pixel)`);
  for (const [fall, k] of Object.entries(a.kacheln)) {
    console.log(`  ${fall.padEnd(20)} Frames mit Magenta ${String(k.framesMitMagenta).padStart(4)}  voll ${String(k.framesVoll).padStart(4)}  erster Frame ${k.ersterFrame ?? '-'}  max ${k.maxPixel}`);
  }
}

// Plan fuer die Zaehlung: Rechtecke je Lage (A: oben, B: nach dem Scrollen).
function baueZaehlplan(geoSpaet, geoNach, skala) {
  const namen = geoSpaet.kacheln.map((k) => k.fall);
  const referenzIndex = namen.indexOf('referenz');
  const lazyIndex = namen.indexOf('lazy-scroll');
  const rechteckeA = geoSpaet.kacheln.map((k) => inBildpixel(k, skala));
  const rechteckeB = namen.map(() => null);
  if (referenzIndex >= 0) rechteckeB[referenzIndex] = rechteckeA[referenzIndex];
  const nachLazy = geoNach?.kacheln.find((k) => k.fall === 'lazy-scroll');
  if (lazyIndex >= 0 && nachLazy) rechteckeB[lazyIndex] = inBildpixel(nachLazy, skala);
  // Vor dem Scrollen liegt lazy-scroll weit ausserhalb des Ausschnitts: in Lage A ohne Pixel.
  const marke = inBildpixel(geoSpaet.marke ?? { x: 0, y: 0, b: 1, h: 1 }, skala);
  return { namen, referenzIndex, rechteckeA, rechteckeB, marke };
}

// ---------- Hauptablauf ----------
let server;
let ctx;
let driver;
let seite;
let code = 0;
let bildschirmFehler = null;
const zeiten = {};
try {
  server = await starteS4Server();
  const url = arg('url') ?? `http://127.0.0.1:${server.ports.haupt}/blitz.html`;
  const index = findeBildschirmIndex();
  if (index === null) throw new Error('Kein Eintrag "Capture screen 0" in der AVFoundation-Liste');
  const bildschirmHz = leseBildschirmHz();

  // Browser sichtbar starten, zuerst about:blank.
  const videoOrdner = path.join(arbeit, 'pw-video');
  const liesGeo = async () => (browserName === 'chromium' ? seite.evaluate(GEO_JS) : driver.executeScript(`return ${GEO_JS}`));
  if (browserName === 'chromium') {
    const argumente = ['--window-position=0,0', '--window-size=1280,800', '--no-first-run', '--no-default-browser-check'];
    if (erweiterungPfad) argumente.push(`--disable-extensions-except=${erweiterungPfad}`, `--load-extension=${erweiterungPfad}`);
    ctx = await chromium.launchPersistentContext(path.join(arbeit, 'profil'), {
      channel: 'chromium',
      headless: false,
      viewport: null,
      args: argumente,
      recordVideo: { dir: videoOrdner, size: { width: 1280, height: 720 } },
    });
    seite = ctx.pages()[0] ?? (await ctx.newPage());
    await seite.goto('about:blank');
    await seite.bringToFront().catch(() => {});
  } else {
    // "eager": driver.get kehrt nach DOMContentLoaded zurueck, damit die fruehe Kachellage gemessen werden kann.
    const optionen = new firefox.Options().setBinary(firefoxBin).setPageLoadStrategy('eager');
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
    await driver.manage().setTimeouts({ pageLoad: 20_000 });
    await driver.manage().window().setRect({ x: 0, y: 0, width: 1280, height: 800 });
    if (erweiterungPfad) await driver.installAddon(erweiterungPfad, true);
    await driver.get('about:blank');
  }
  await warte(500);

  // Bildschirmaufnahme starten, auf das erste Bild warten, dann 300 ms und erst dann die Zieladresse laden.
  const mkv = path.join(arbeit, `${name}.mkv`);
  const aufnahme = starteAufnahme(index, mkv);
  const lief = await Promise.race([aufnahme.gestartet, warte(15_000).then(() => false)]);
  if (!lief) {
    bildschirmFehler = aufnahme.log();
    try { aufnahme.kind.kill('SIGKILL'); } catch { /* egal */ }
  }
  zeiten.aufnahmeStart = Date.now();
  await warte(300);
  zeiten.navigation = Date.now();
  if (browserName === 'chromium') await seite.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  else await driver.get(url);
  zeiten.domcontentloaded = Date.now();
  const geoFrueh = await liesGeo();
  // Auf das load-Ereignis der Seite warten (die Seite setzt dataset.s4Geladen).
  const tLaden = Date.now();
  while (Date.now() - tLaden < 15_000) {
    const geladen = browserName === 'chromium'
      ? await seite.evaluate(() => document.documentElement.dataset.s4Geladen ?? null)
      : await driver.executeScript('return document.documentElement.dataset.s4Geladen ?? null');
    if (geladen) break;
    await warte(25);
  }
  zeiten.geladen = Date.now();
  const geoSpaet = await liesGeo();

  // 2,5 s nach der Navigation zur lazy-scroll-Kachel scrollen und die Lage danach neu lesen.
  await warte(Math.max(0, zeiten.navigation + SCROLL_NACH_NAVIGATION_MS - Date.now()));
  zeiten.scroll = Date.now();
  const gescrollt = browserName === 'chromium' ? await seite.evaluate(SCROLL_JS) : await driver.executeScript(`return ${SCROLL_JS}`);
  await warte(50);
  const geoNach = gescrollt ? await liesGeo() : null;

  // Aufnahme zu Ende laufen lassen (Zeitlimit: Dauer + 20 s, dann sauber beenden).
  if (lief) {
    const ende = await Promise.race([aufnahme.beendet, warte((dauer + 20) * 1000).then(() => 'zeit')]);
    if (ende === 'zeit') {
      try { aufnahme.kind.stdin.write('q'); } catch { /* egal */ }
      await Promise.race([aufnahme.beendet, warte(5000)]);
      try { aufnahme.kind.kill('SIGKILL'); } catch { /* egal */ }
    } else if (ende !== 0) {
      bildschirmFehler = aufnahme.log();
    }
  }

  // Browser schliessen (Playwright schreibt das Video erst beim Schliessen).
  let pwVideoDatei = null;
  if (browserName === 'chromium') {
    const video = seite.video();
    await Promise.race([ctx.close(), warte(15_000)]);
    ctx = null;
    try { pwVideoDatei = video ? await video.path() : null; } catch { pwVideoDatei = null; }
  } else {
    await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
    driver = null;
  }

  // Kachellage fruh (nach DOMContentLoaded) gegen spaet (nach load) vergleichen.
  const verschiebungen = [];
  for (const k of geoSpaet.kacheln) {
    const f = geoFrueh.kacheln.find((x) => x.fall === k.fall);
    if (!f) { verschiebungen.push({ fall: k.fall, grund: 'frueh nicht vorhanden' }); continue; }
    const dx = k.x - f.x;
    const dy = k.y - f.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) verschiebungen.push({ fall: k.fall, dx: runde(dx), dy: runde(dy) });
  }

  const kopf = {
    browser: browserName,
    erweiterung: !ohneErweiterung,
    erweiterungName: erweiterungPfad ? path.basename(erweiterungPfad) : null,
    url: url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''),
    dauerSekunden: dauer,
    bildschirmHz,
    navigationNachAufnahmestartMsUngefaehr: zeiten.navigation - zeiten.aufnahmeStart,
    domcontentloadedNachNavigationMs: zeiten.domcontentloaded - zeiten.navigation,
    seiteGeladenNachNavigationMs: zeiten.geladen - zeiten.navigation,
    scrollNachNavigationMs: zeiten.scroll - zeiten.navigation,
    seiteGeladenPerformanceNowMs: geoSpaet.geladenMs === null ? null : Number(geoSpaet.geladenMs),
    fenster: { screenX: geoSpaet.screenX, screenY: geoSpaet.screenY, outerWidth: geoSpaet.outerWidth, outerHeight: geoSpaet.outerHeight, innerWidth: geoSpaet.innerWidth, innerHeight: geoSpaet.innerHeight, dpr: geoSpaet.dpr, screenBreite: geoSpaet.screenBreite, screenHoehe: geoSpaet.screenHoehe },
    kachelnVerschoben: verschiebungen.length > 0,
    ...(verschiebungen.length ? { verschiebungen } : {}),
    lazyScrollGescrollt: Boolean(gescrollt),
    zeitstempel: new Date().toISOString(),
    aufnahmeStatistik: statistikAusLog(aufnahme.log()),
  };
  const leiste = geoSpaet.outerHeight - geoSpaet.innerHeight;
  const ausgaben = [];
  const hatKacheln = geoSpaet.kacheln.some((k) => k.fall === 'referenz');
  if (!hatKacheln) console.warn('aufnahme: Warnung: keine Kacheln (.fall) auf der Seite, Auswertung nach Kacheln entfaellt');
  // Die Navigation liegt in der Aufnahme ungefaehr hier (fuer die Referenzpruefung "nach der Navigation").
  const navigationMs = kopf.navigationNachAufnahmestartMsUngefaehr;

  // Quelle 1: Bildschirmaufnahme.
  if (bildschirmFehler === null && existsSync(mkv)) {
    const groesse = videoGroesse(mkv);
    if (!groesse) throw new Error('Videogroesse der Aufnahme nicht lesbar');
    const skala = groesse.breite / geoSpaet.screenBreite;
    const skalaH = groesse.hoehe / geoSpaet.screenHoehe;
    const warnung = Math.abs(skala - skalaH) / skala > 0.02 ? `Seitenverhaeltnis von Aufnahme (${groesse.breite}x${groesse.hoehe}) und Bildschirm (${geoSpaet.screenBreite}x${geoSpaet.screenHoehe}) passt nicht, Browser liegt evtl. auf einem anderen Bildschirm` : null;
    const zuschnitt = {
      x: Math.max(0, Math.round(geoSpaet.screenX * skala)),
      y: Math.max(0, Math.round((geoSpaet.screenY + leiste) * skala)),
      w: Math.round(geoSpaet.innerWidth * skala),
      h: Math.round(geoSpaet.innerHeight * skala),
    };
    zuschnitt.w = Math.min(zuschnitt.w, groesse.breite - zuschnitt.x);
    zuschnitt.h = Math.min(zuschnitt.h, groesse.hoehe - zuschnitt.y);
    const rahmenOrdner = path.join(arbeit, 'bildschirm');
    const { dateien, ms } = extrahiere(mkv, rahmenOrdner, zuschnitt);
    const plan = baueZaehlplan(geoSpaet, geoNach, skala);
    const ergebnisse = await zaehleFolge(rahmenOrdner, dateien, plan, zuschnitt.w, zuschnitt.h);
    const a = verdichte({ quelle: 'bildschirm', rate: BILDRATE_BILDSCHIRM, ergebnisse, ms, namen: plan.namen, skala, flaechePixel: Math.round(200 * skala) ** 2, nachNavigationAbMs: navigationMs });
    a.aufnahmeGroesse = groesse;
    a.zuschnitt = zuschnitt;
    if (warnung) a.warnung = warnung;
    if (a.framesMitMagenta === 0) a.hinweis = 'Kein Magenta in der Aufnahme: Bildschirmaufnahme-Recht, Fensterlage oder Bildschirmwahl pruefen';
    const datei = schreibe(kopf, a, `ergebnis-${name}-${stempel}.json`);
    console.log(`aufnahme: geschrieben ${path.relative(wurzel, datei)}`);
    ausgaben.push(a);
  } else {
    const text = bildschirmFehler ?? '';
    if (sieheRechtFehler(text) || !existsSync(mkv)) {
      console.error('aufnahme: macOS-Recht Bildschirmaufnahme fehlt (Systemeinstellungen, Datenschutz, Bildschirm- und Systemaudioaufnahme, fuer das startende Programm freigeben)');
      console.error(`aufnahme: ffmpeg-Ausgabe (Ende): ${text.split('\n').slice(-4).join(' | ').slice(0, 400)}`);
    } else {
      console.error(`aufnahme: Bildschirmaufnahme scheiterte: ${text.slice(-400)}`);
    }
    code = 2;
  }

  // Quelle 2: Playwright-Video (nur Chromium).
  if (pwVideoDatei && existsSync(pwVideoDatei)) {
    const groesse = videoGroesse(pwVideoDatei);
    if (groesse) {
      const rahmenOrdner = path.join(arbeit, 'pw-frames');
      const { dateien, ms } = extrahiere(pwVideoDatei, rahmenOrdner, null);
      // Der Seitenausschnitt wird auf das Video verkleinert (Seitenverhaeltnis bleibt), Ursprung links oben.
      const skala = Math.min(groesse.breite / geoSpaet.innerWidth, groesse.hoehe / geoSpaet.innerHeight);
      const plan = baueZaehlplan(geoSpaet, geoNach, skala);
      const ergebnisse = await zaehleFolge(rahmenOrdner, dateien, plan, groesse.breite, groesse.hoehe);
      // Das Video beginnt mit der Seitenerzeugung, nicht mit der Navigation: die Referenzzeit ist hier nicht vergleichbar, darum Grenze weit offen.
      const a = verdichte({ quelle: 'playwright-video', rate: BILDRATE_VIDEO, ergebnisse, ms, namen: plan.namen, skala, flaechePixel: Math.round(200 * skala) ** 2, nachNavigationAbMs: Number.POSITIVE_INFINITY });
      a.aufnahmeGroesse = groesse;
      a.hinweis = 'Das Video beginnt mit der Seitenerzeugung (about:blank), die Zeit ist nicht mit der Bildschirmaufnahme abgeglichen. Playwright liefert Bilder nur bei Aenderungen, Luecken sind hier normal. Die Kachellage ist aus dem Seitenverhaeltnis geschaetzt.';
      const datei = schreibe(kopf, a, `ergebnis-${name}-pwvideo-${stempel}.json`);
      console.log(`aufnahme: geschrieben ${path.relative(wurzel, datei)}`);
      ausgaben.push(a);
    }
  }
  for (const a of ausgaben) kurzAusgabe(a);
  if (ausgaben.some((a) => a.quelle === 'bildschirm' && a.ungueltig)) {
    console.error('aufnahme: Lauf UNGUELTIG (Positivkontrolle der Referenzkachel nicht erfuellt)');
    code = code || 3;
  }
} catch (fehler) {
  console.error('aufnahme: FEHLER', fehler);
  code = code || 1;
} finally {
  if (ctx) await Promise.race([ctx.close().catch(() => {}), warte(10_000)]);
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) await Promise.race([server.schliessen(), warte(3000)]);
}
process.exit(code);
