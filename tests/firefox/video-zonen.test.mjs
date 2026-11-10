// Firefox-Test der Zonen-Leinwand fuer Videos (Bauplan Video-Zonen) ueber geckodriver/WebDriver: Faelle z1, z3, z5, z9, z11, z12, z14 und die Presets im Video (P1 bis P9). Gleiche Fixture wie
// tests/chromium/video-zonen.spec.ts (video-zonen.html: Aufnahme von 15 s, Testbild links, harter Schnitt bei 5 s, Waechter-Schachbrett im Bild).
// Firefox hat keinen Screencast: die Bilder kommen aus WebDriver-Aufnahmen der Seite (etwa 6 bis 10 je Sekunde), also Stichproben statt jedes Bildes.
// Ein scharfes Waechter-Schachbrett in einer Stichprobe waere ein Fehler. Firefox ab 132 taktet ueber requestVideoFrameCallback, Firefox 128 ueber
// requestAnimationFrame (die Leinwand benutzt dort den Rueckfall). Die Browser-Tests starten stumm (media.volume_scale 0).
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 900 s ueberschritten');
  process.exit(1);
}, 900_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const portFremd = port + 2;
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:test:firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}
const pruefe = (bedingung, text) => {
  if (!bedingung) throw new Error(text);
};
async function test(name, fn) {
  if (process.env.VEIL_NUR && !process.env.VEIL_NUR.split(',').some((n) => name.startsWith(n))) return;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

const attr = (id, name) => driver.executeScript("const e = document.getElementById(arguments[0]); return e ? e.getAttribute(arguments[1]) : null", id, name);
const ct = (id = 'v1') => driver.executeScript('return document.getElementById(arguments[0]).currentTime', id);
const status = async () => {
  const roh = await driver.executeScript('return document.documentElement.dataset.veilStatus ?? null');
  return roh ? JSON.parse(roh) : null;
};
const log = () => driver.executeScript('return window.__modus');
async function setze(einstellungen) {
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen }));
}
async function oeffne(abfrage = '') {
  await driver.get(`${basis}/video-zonen.html?bild=${encodeURIComponent(BILD)}${abfrage ? `&${abfrage}` : ''}`);
  await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 60_000);
  // Das Ereignis veil-test schreibt in den Speicher des Browsers: jeder Fall beginnt mit den Standardwerten (Zonen, nicht pausiert).
  await setze({ pause: false, video: 'zonen' });
}
const neuesVideo = (opt) => driver.executeScript('window.neuesVideo(arguments[0])', opt);

// Magenta und Gruen des Waechters, auch nach der Videokomprimierung: gezaehlt werden Uebergaenge zwischen den Farben nach einem Lauf von 2 bis 7 Bildpunkten
// (Felder zu 4; ein scharfes Schachbrett hat je Richtung rund 220, ein Mosaik mit Bloecken ab 12 und ein Blur keine).
function klasse(r, g, b) {
  if (r > 140 && b > 140 && g < 100) return 1;
  if (g > 160 && r < 110 && b < 110) return 2;
  return 0;
}
function zaehleUebergaenge(art, breite, hoehe, quer) {
  let n = 0;
  const aussen = quer ? hoehe : breite;
  const innen = quer ? breite : hoehe;
  for (let a = 0; a < aussen; a++) {
    let cur = 0;
    let len = 0;
    let luecke = 0;
    for (let i = 0; i < innen; i++) {
      const k = quer ? art[a * breite + i] : art[i * breite + a];
      if (k === 0) {
        if (++luecke > 3) {
          cur = 0;
          len = 0;
        }
        continue;
      }
      luecke = 0;
      if (k === cur) len++;
      else {
        if (cur !== 0 && len >= 2 && len <= 7) n++;
        cur = k;
        len = 1;
      }
    }
  }
  return n;
}

// Eine Stichprobe: Uebergaenge des Waechters, Rosa der Rahmen, Kantenenergie der rechten Haelfte des Videos.
async function messe() {
  const png = Buffer.from(await driver.takeScreenshot(), 'base64');
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const n = info.channels;
  const art = new Uint8Array(w * info.height);
  let rosa = 0;
  for (let i = 0, p = 0; i < data.length; i += n, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    art[p] = klasse(r, g, b);
    if (r > 240 && Math.abs(g - 79) < 14 && Math.abs(b - 163) < 14) rosa++;
  }
  const quer = zaehleUebergaenge(art, w, info.height, true);
  const hoch = zaehleUebergaenge(art, w, info.height, false);
  let kante = 0;
  let zahl = 0;
  for (let y = 50; y < 310 && y < info.height; y++) {
    for (let x = 330; x < 630 && x + 1 < w; x++) {
      const i = (y * w + x) * n;
      const j = i + n;
      kante += Math.abs(data[i] + data[i + 1] + data[i + 2] - data[j] - data[j + 1] - data[j + 2]) / 3;
      zahl++;
    }
  }
  return { quer, hoch, rosa, kante: zahl ? kante / zahl : 0 };
}
const scharf = (b) => b.quer >= 100 && b.hoch >= 100;
const median = (l) => (l.length ? [...l].sort((a, b) => a - b)[l.length >> 1] : 0);
async function stichproben(ms) {
  const aus = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) aus.push(await messe());
  return aus;
}
const warteZonen = (id = 'v1') => bis('Zonen-Modus', async () => (await attr(id, 'data-veil-video-modus')) === 'zonen', 30_000);

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));
  const liste = (await (await fetch(`${basis}/api/testbilder?satz=nsfw`)).json()).bilder;
  const bilderDa = liste.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  if (!bilderDa) {
    console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Video-Zonen-Tests uebersprungen');
    process.exit(0);
  }
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  // Feste Adresse der Erweiterung (fuer die Optionsseite: Pack importieren) und Zugriff auf den Chrome-Kontext zum Oeffnen von Tabs
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 60_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  let referenzKante = 0;

  await test('z1 Zonen mit Rahmen links, rechte Haelfte scharf', async () => {
    // Referenz: dieselbe Stelle ohne Erweiterung (Pause)
    await oeffne();
    await setze({ pause: true });
    await neuesVideo({ id: 'v1' });
    await bis('Testbild-Abschnitt', async () => (await ct()) > 2.6 && (await ct()) < 4.8, 20_000);
    const refProben = await stichproben(1200);
    // Gegenprobe der Messung: ohne Erweiterung muss das Schachbrett als scharf erkannt werden (sonst sind alle "nie scharf"-Aussagen leer erfuellt)
    pruefe(refProben.filter(scharf).length >= 3, `Referenz: Schachbrett nie scharf erkannt (${JSON.stringify(refProben.map((b) => [b.quer, b.hoch]))})`);
    referenzKante = median(refProben.map((b) => b.kante));
    pruefe(referenzKante > 1, `Referenz hat keine Kanten (${referenzKante})`);
    await oeffne();
    const takt = await driver.executeScript("return 'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'requestVideoFrameCallback' : 'requestAnimationFrame'");
    console.log(`firefox: Leinwand-Takt ueber ${takt}`);
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    await bis('Testbild-Abschnitt', async () => (await ct()) > 3.3 && (await ct()) < 3.8, 20_000); // Leinwand beginnt bei etwa 3,2 s (erst Blur, dann Zonen)
    const s = await stichproben(900); // endet vor dem Schnitt bei 5 s (danach liegt kein Rahmen mehr, das ganze Bild ist Mosaik)
    pruefe(s.length >= 3, `zu wenige Stichproben (${s.length})`);
    pruefe(s.filter(scharf).length === 0, 'Waechter scharf');
    pruefe(s.filter((b) => b.rosa > 150).length / s.length > 0.7, `pinker Rahmen fehlt: ${JSON.stringify(s.map((b) => b.rosa))}`);
    const kante = median(s.map((b) => b.kante));
    pruefe(kante >= 0.8 * referenzKante, `rechte Haelfte nicht scharf genug (${kante.toFixed(2)} gegen ${referenzKante.toFixed(2)})`);
    const boxen = JSON.parse(await attr('v1', 'data-veil-video-boxen'));
    pruefe(boxen.boxen.length > 0, 'keine Boxen');
    for (const k of boxen.boxen) pruefe(k[0] + k[2] / 2 < 330, `Box nicht links: ${JSON.stringify(k)}`);
    pruefe((await attr('v1', 'data-veil')) === 'zensiert', 'data-veil nicht zensiert');
    const st = await status();
    console.log(`firefox: M2 ${(st.videoZonenMs / Math.max(1, st.videoZonenMsBilder)).toFixed(2)} ms je Bild (${st.videoZonenMsBilder} Bilder); M1 Rundlauf Median ${median(st.videoZonenRtt)} ms (${st.videoZonenRtt.length} Werte)`);
  });

  await test('z3 harter Schnitt: Bild ganz Mosaik, keine scharfe Stichprobe', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    const proben = [];
    const t0 = Date.now();
    while ((await ct()) < 6.3 && Date.now() - t0 < 30_000) proben.push(await messe());
    pruefe(proben.length > 5, 'zu wenige Stichproben');
    pruefe(proben.filter(scharf).length === 0, 'Waechter scharf beim Schnitt');
    const schnitt = (await log()).find((e) => e.was === 'data-veil-video-modus' && e.v === 'mosaik' && e.ct > 4.9 && e.ct < 5.6);
    pruefe(!!schnitt, 'kein Mosaik am Schnitt bei 5 s');
    pruefe(schnitt.ct < 5.3, `Mosaik erst bei ${schnitt.ct}`);
  });

  await test('z5 Pause: Boxen bleiben, eine Sofortpruefung, nie scharf', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    await bis('Testbild-Abschnitt', async () => (await ct()) > 3.0 && (await ct()) < 4.4, 20_000);
    // Ursache des Wackelns unter Last: zwischen "Zeit im Fenster" und dem Pause-Befehl vergingen mehrere WebDriver-Aufrufe, das Video lief dabei am harten Schnitt bei 5 s
    // vorbei (dann steht das ganze Bild unter Mosaik und die Boxen sind weg). Darum wird in der Seite selbst pausiert, im Augenblick, in dem die Zeit im Fenster liegt.
    const pausiertBei = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1]; const v = document.getElementById('v1'); const t0 = performance.now();
       const schritt = () => { if (v.currentTime > 3.0 && v.currentTime < 4.2) { const n = JSON.parse(document.documentElement.dataset.veilStatus).videoZonenPruefungen; v.pause(); fertig([v.currentTime, n]); } else if (performance.now() - t0 > 20000) fertig(null); else requestAnimationFrame(schritt); };
       schritt();`,
    );
    pruefe(pausiertBei !== null, 'Video kam nie in das Fenster zum Pausieren');
    const vorher = pausiertBei[1]; // Zaehlerstand im selben Augenblick wie die Pause
    await warte(700);
    const nach1 = (await status()).videoZonenPruefungen;
    await warte(1300);
    const nach2 = (await status()).videoZonenPruefungen;
    pruefe(nach1 - vorher >= 1, 'keine Sofortpruefung nach der Pause');
    pruefe(nach2 - nach1 <= 1, `in der Pause weitere Pruefungen (${nach2 - nach1})`);
    const boxen = JSON.parse(await attr('v1', 'data-veil-video-boxen'));
    pruefe(boxen.boxen.length > 0, 'Boxen weg');
    pruefe((await stichproben(800)).filter(scharf).length === 0, 'Waechter scharf in der Pause');
  });

  await test('z9 fremdes http-Video: nie Zonen, ganz verdeckt, Etikett sagt warum', async () => {
    await oeffne();
    await driver.executeAsyncScript(
      "const fertig = arguments[arguments.length - 1]; fetch(window.neueQuelle()).then((r) => r.blob()).then((b) => fetch('/ablage/film.webm', { method: 'POST', body: b, headers: { 'content-type': b.type || 'video/webm' } })).then(() => fertig(true));",
    );
    await neuesVideo({ id: 'f1', quelle: `http://127.0.0.1:${portFremd}/ablage/film.webm` });
    await bis('verdeckt', async () => (await attr('f1', 'data-veil')) === 'verdeckt', 30_000);
    await bis('Position', async () => (await ct('f1')) > 3.5, 30_000);
    pruefe((await attr('f1', 'data-veil-leinwand')) === null, 'Leinwand bei fremdem Video');
    pruefe((await attr('f1', 'data-veil-video-modus')) === null, 'Zonen-Modus bei fremdem Video');
    const etikett = await attr('f1', 'data-veil-video-etikett');
    pruefe(!!etikett && etikett.includes('can’t see inside'), `Etikett fehlt: ${etikett}`);
    pruefe((await stichproben(600)).filter(scharf).length === 0, 'Waechter scharf');
  });

  await test('R1 Treffer, dann saubere Antworten: ganz gedeckt bis die Hysterese frei gibt; R6 frei, dann Treffer: erst verdeckt, Leinwand nach 1000 ms', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1' });
    await bis('Ende des Testbild-Abschnitts', async () => (await ct()) > 12.2, 40_000);
    const l = await log();
    const folge = l.filter((e) => e.was === 'data-veil' && e.v !== null);
    pruefe(folge[0].v === 'frei' && folge[1].v === 'verdeckt', `Folge ${JSON.stringify(folge.map((e) => e.v))}`);
    const zens = folge.find((e) => e.v === 'zensiert');
    pruefe(zens && zens.t - folge[1].t >= 950, 'Leinwand zu frueh nach dem Blur');
    const schnitt12 = l.find((e) => e.was === 'data-veil-video-modus' && e.v === 'mosaik' && e.ct > 11.9);
    pruefe(!!schnitt12, 'kein Mosaik bei 12 s');
    await warte(1800);
    const danach = (await log()).filter((e) => e.was === 'data-veil-video-modus' && e.t > schnitt12.t);
    pruefe(danach.filter((e) => e.v === 'zonen').length === 0, `Zonen ohne Boxen nach dem Schnitt: ${JSON.stringify(danach.map((e) => [e.v, e.ct]))}`);
  });

  await test('R13a Rueckrufschleife ueber requestAnimationFrame erzwungen, auch bei Bewegung', async () => {
    await oeffne();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ohneRvfc: true }) }))");
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    await bis('Bewegung', async () => (await ct()) > 9.0 && (await ct()) < 10.5, 30_000);
    const s = await stichproben(1000);
    pruefe(s.filter(scharf).length === 0, 'Waechter scharf (rAF)');
    pruefe((await attr('v1', 'data-veil')) === 'zensiert', 'nicht zensiert');
  });

  await test('R13h Untertitel showing: nie Zonen, ganz verdeckt mit Etikett', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    await driver.executeScript("const t = document.getElementById('v1').addTextTrack('subtitles', 'Test', 'en'); t.mode = 'showing';");
    await bis('verdeckt', async () => (await attr('v1', 'data-veil')) === 'verdeckt', 6000);
    pruefe((await attr('v1', 'data-veil-leinwand')) === null, 'Leinwand trotz Untertitel');
    pruefe(!!(await attr('v1', 'data-veil-video-etikett')), 'Etikett fehlt');
  });

  await test('R13g Langsam-Rueckfall: ganz verdeckt mit Etikett', async () => {
    await oeffne();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ videoVerzoegerungMs: 600 }) }))");
    await neuesVideo({ id: 'v1' });
    await bis('Etikett langsam', async () => ((await attr('v1', 'data-veil-video-etikett')) ?? '').includes('Too slow'), 40_000);
    pruefe((await attr('v1', 'data-veil')) === 'verdeckt' && (await attr('v1', 'data-veil-leinwand')) === null, 'nicht ganz verdeckt');
  });

  await test('N1 Sprung weit nach vorn mit nur sauberen Antworten: ganz gedeckt (leer), nie klar; danach frei nach 3 s beobachteter Zeit', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    await bis('Testbild-Abschnitt', async () => (await ct()) > 3.4 && (await ct()) < 4.3, 20_000);
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ erzwingeSauber: true }) }))");
    await driver.executeScript("document.getElementById('v1').currentTime = 5.5");
    const folge = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      const b = await attr('v1', 'data-veil-video-boxen');
      folge.push(`${(await attr('v1', 'data-veil-video-modus')) ?? 'null'}/${b ? JSON.parse(b).grund ?? '' : ''}`);
      await warte(100);
    }
    const ab = folge.slice(Math.max(0, folge.findIndex((f) => f.startsWith('mosaik'))));
    pruefe(ab.filter((f) => f.startsWith('zonen') || f.startsWith('null')).length === 0, `nicht gedeckt: ${JSON.stringify(folge)}`);
    pruefe(ab.some((f) => f === 'mosaik/leer'), `nie leer gehalten: ${JSON.stringify(folge)}`);
    await bis('frei nach 3 s', async () => (await attr('v1', 'data-veil')) === 'frei', 9000);
  });

  await test('N2 Rundlauf ueber der Grenze (Antwort 280 ms verzoegert): sauberer Rueckfall mit Etikett', async () => {
    await oeffne();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ videoVerzoegerungMs: 280 }) }))");
    await neuesVideo({ id: 'v1' });
    await bis('Etikett langsam', async () => ((await attr('v1', 'data-veil-video-etikett')) ?? '').includes('Too slow'), 40_000);
    pruefe((await attr('v1', 'data-veil')) === 'verdeckt' && (await attr('v1', 'data-veil-leinwand')) === null, 'nicht ganz verdeckt');
  });

  await test('N3 Erste-Bild-Frist: unsichtbar gewordenes Video loest keine Stoerung aus, sichtbar wieder schon', async () => {
    await oeffne();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ malenAus: true }) }))");
    await neuesVideo({ id: 'v1' });
    await bis('Leinwand', async () => (await attr('v1', 'data-veil-leinwand')) !== null, 30_000);
    await driver.executeScript('window.scrollTo(0, 1500)');
    await warte(1800);
    pruefe((await attr('v1', 'data-veil')) === 'zensiert', 'Stoerung trotz unsichtbarem Video');
    await driver.executeScript('window.scrollTo(0, 0)');
    await bis('Stoerung nach dem Sichtbarwerden', async () => (await attr('v1', 'data-veil')) === 'verdeckt', 6000);
  });

  await test('z11 Pause der Erweiterung: alles weg, danach wieder Zonen', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1' });
    await warteZonen();
    await setze({ pause: true });
    await bis('Leinwand weg', async () => (await attr('v1', 'data-veil-leinwand')) === null, 5000);
    pruefe((await attr('v1', 'data-veil')) === null, 'data-veil nach der Pause');
    const huellen = await driver.executeScript("return document.querySelectorAll('#platz > div').length");
    pruefe(huellen === 1, `Host der Leinwand noch da (${huellen} Divs)`);
    await setze({ pause: false });
    await warteZonen();
  });

  await test('z12 video ganz: wie heute, nie Leinwand', async () => {
    await oeffne();
    await setze({ video: 'ganz' });
    await neuesVideo({ id: 'v1' });
    await bis('verdeckt', async () => (await attr('v1', 'data-veil')) === 'verdeckt', 30_000);
    await bis('Position', async () => (await ct()) > 4.5, 30_000);
    pruefe((await attr('v1', 'data-veil-leinwand')) === null && (await attr('v1', 'data-veil-video-modus')) === null, 'Leinwand im Modus ganz');
    const huellen = await driver.executeScript("return document.querySelectorAll('#platz > div').length");
    pruefe(huellen === 1, `zusaetzlicher Host (${huellen} Divs)`);
    pruefe((await stichproben(800)).filter(scharf).length === 0, 'Waechter scharf');
  });

  await test('z14 Video mit controls: nie Zonen', async () => {
    await oeffne();
    await neuesVideo({ id: 'v1', controls: true });
    await bis('verdeckt', async () => (await attr('v1', 'data-veil')) === 'verdeckt', 30_000);
    await warte(2500);
    pruefe((await attr('v1', 'data-veil-leinwand')) === null, 'Leinwand bei controls');
    pruefe(!!(await attr('v1', 'data-veil-video-etikett')), 'Etikett fehlt');
  });

  // ---------- Presets im Video (Auftrag 4) ----------
  // Pixeltests je Preset-Gruppe wie in tests/chromium/video-zonen.spec.ts (P1 bis P9): Referenz (Pause an) und Zensur im stillen Abschnitt des Films
  // (2 bis 5 s), verglichen in den wirklich gemalten Flaechen (`flaechen` in data-veil-video-boxen). Stichproben statt jedes Bildes.
  // Synthetische Wort-Themen fuer die Tests (keine echten Woerter): alpha schmal, beta breit; die Breite des Wortes auf der Flaeche zeigt das Thema
  const PACK_WOERTER = {
    themen: [
      { id: 'alpha', titel: 'Alpha', woerter: ['I', '!', '1', 'L', 'J'] },
      { id: 'beta', titel: 'Beta', woerter: ['WWWWW', 'WWWWWW', 'WWWWWWW', 'WWWWWWWW', 'WWWWWWWWW'] },
    ],
  };
  const KOERPER = '_DSC6278.JPG';
  const GESICHT = 'sfw-001-portraet.jpg';
  const PATCH_GESICHT = 'sfw-003-portraet.jpg';
  const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
  const ALLE_ZONEN = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
  const zonenNur = (an) => Object.fromEntries(ALLE_ZONEN.map((n) => [n, BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) }]));
  const istRosa = (r, g, b) => r > 225 && b - g > 20 && g < 215;
  const pix = async (png) => {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { daten: data, b: info.width, h: info.height };
  };
  const bild = async () => pix(Buffer.from(await driver.takeScreenshot(), 'base64'));
  function kenn(ref, aus, box, inset = 0) {
    const [bx, by, bw, bh] = box;
    let n = 0;
    let dunkel = 0;
    let summe = 0;
    let wort = 0;
    let rahmen = 0;
    const RING = 6;
    for (let y = Math.max(0, by - RING); y < Math.min(aus.h, by + bh + RING); y++) {
      for (let x = Math.max(0, bx - RING); x < Math.min(aus.b, bx + bw + RING); x++) {
        const i = (y * aus.b + x) * 3;
        const r = aus.daten[i];
        const g = aus.daten[i + 1];
        const b = aus.daten[i + 2];
        const innen = x >= bx && x < bx + bw && y >= by && y < by + bh;
        const abstand = Math.min(Math.abs(x - bx), Math.abs(x - (bx + bw - 1)), Math.abs(y - by), Math.abs(y - (by + bh - 1)));
        if (istRosa(r, g, b)) {
          if (!innen || abstand <= RING) rahmen++;
          else wort++;
        }
        if (innen && x >= bx + inset && x < bx + bw - inset && y >= by + inset && y < by + bh - inset) {
          n++;
          if (r < 60 && g < 60 && b < 60) dunkel++;
          summe += (Math.abs(r - ref.daten[i]) + Math.abs(g - ref.daten[i + 1]) + Math.abs(b - ref.daten[i + 2])) / 3;
        }
      }
    }
    return { n, dunkel: dunkel / Math.max(1, n), wort, rahmen, mittel: summe / Math.max(1, n) };
  }
  function ausserhalb(ref, aus, flaechen) {
    let n = 0;
    let summe = 0;
    for (let y = 0; y < 360; y++) {
      for (let x = 0; x < 320; x++) {
        if (flaechen.some(([bx, by, bw, bh]) => x >= bx - 8 && x < bx + bw + 8 && y >= by - 8 && y < by + bh + 8)) continue;
        if (x < 100 && y > 315) continue;
        const i = (y * aus.b + x) * 3;
        summe += (Math.abs(aus.daten[i] - ref.daten[i]) + Math.abs(aus.daten[i + 1] - ref.daten[i + 1]) + Math.abs(aus.daten[i + 2] - ref.daten[i + 2])) / 3;
        n++;
      }
    }
    return summe / Math.max(1, n);
  }
  function kante(aus, box, inset) {
    const [bx, by, bw, bh] = box;
    let n = 0;
    let summe = 0;
    for (let y = by + inset; y < by + bh - inset; y++) {
      for (let x = bx + inset; x < bx + bw - inset - 1; x++) {
        const i = (y * aus.b + x) * 3;
        summe += (Math.abs(aus.daten[i] - aus.daten[i + 3]) + Math.abs(aus.daten[i + 1] - aus.daten[i + 4]) + Math.abs(aus.daten[i + 2] - aus.daten[i + 5])) / 3;
        n++;
      }
    }
    return summe / Math.max(1, n);
  }
  function wortMaske(aus, box) {
    const [bx, by, bw, bh] = box;
    const m = new Set();
    for (let y = by + 8; y < by + bh - 8; y++) for (let x = bx + 8; x < bx + bw - 8; x++) {
      const i = (y * aus.b + x) * 3;
      if (istRosa(aus.daten[i], aus.daten[i + 1], aus.daten[i + 2])) m.add(y * aus.b + x);
    }
    return m;
  }
  function wortBreite(aus, box) {
    const [bx, by, bw, bh] = box;
    let min = Infinity;
    let max = -Infinity;
    for (let y = by + 6; y < by + bh - 6; y++) for (let x = bx + 6; x < bx + bw - 6; x++) {
      const i = (y * aus.b + x) * 3;
      if (istRosa(aus.daten[i], aus.daten[i + 1], aus.daten[i + 2])) {
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
    }
    return max >= min ? max - min + 1 : 0;
  }
  function relMaske(aus, box) {
    const [bx, by, bw, bh] = box;
    const cx = Math.round(bx + bw / 2);
    const cy = Math.round(by + bh / 2);
    const m = new Set();
    for (const k of wortMaske(aus, box)) m.add((Math.floor(k / aus.b) - cy + 500) * 1000 + ((k % aus.b) - cx + 500));
    return m;
  }
  function deckung(a, b, breite, tol = 2) {
    let treffer = 0;
    for (const p of a) {
      let da = false;
      for (let dy = -tol; dy <= tol && !da; dy++) for (let dx = -tol; dx <= tol && !da; dx++) if (b.has(p + dy * breite + dx)) da = true;
      if (da) treffer++;
    }
    return treffer / Math.max(1, a.size);
  }
  const anteilInHuelle = (t, huellen) =>
    Math.max(
      ...huellen.map((h) => {
        const b = Math.max(0, Math.min(t[0] + t[2], h[0] + h[2]) - Math.max(t[0], h[0]));
        const hh = Math.max(0, Math.min(t[1] + t[3], h[1] + h[3]) - Math.max(t[1], h[1]));
        return (b * hh) / Math.max(1, t[2] * t[3]);
      }),
    );
  const naechste = (v, art, bezug) => {
    let best = null;
    let dist = Infinity;
    v.flaechen.forEach((f, i) => {
      if (v.arten[i] !== art) return;
      const d = Math.hypot(f[0] + f[2] / 2 - (bezug[0] + bezug[2] / 2), f[1] + f[3] / 2 - (bezug[1] + bezug[3] / 2));
      if (d < dist) {
        dist = d;
        best = f;
      }
    });
    return best;
  };
  const groesste = (v, art) => {
    let best = null;
    v.flaechen.forEach((f, i) => {
      if (v.arten[i] === art && (!best || f[2] * f[3] > best[2] * best[3])) best = f;
    });
    return best;
  };
  const lies = async () => {
    const roh = await attr('v1', 'data-veil-video-boxen');
    return roh ? JSON.parse(roh) : null;
  };
  async function oeffneBild(satz, name, abfrage = 'ohne=1&kurz=1') {
    await driver.get(`${basis}/video-zonen.html?satz=${satz}&bild=${encodeURIComponent(name)}${abfrage ? `&${abfrage}` : ''}`);
    await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 90_000);
  }
  // `von` bis `bis`: Fenster der Medienzeit (das Bild steht in 2 bis 5 s still). Firefox braucht nach einem Neustart der Leinwand laenger bis zu den Zonen (Blur, dann Zonen),
  // darum nehmen die Faelle nach einem Wechsel ein weiteres Fenster.
  async function augenblick(art, von = 2.6, bis_ = 4.8) {
    let diag = null;
    try {
      return await augenblick1(art, von, bis_, (d) => { diag = d; });
    } catch (fehler) {
      // Die Angaben fuer die Fehlersuche erst jetzt holen (je Abfrage kostet jeder Aufruf Zeit, die den Augenblick verpasst)
      const extra = await driver.executeScript('const v = document.getElementById("v1"); return [v.currentTime, v.paused, document.hidden, [...document.fonts].map((f) => f.family + ":" + f.status).join("|")]').catch(() => null);
      throw new Error(`${fehler.message}; zuletzt gesehen: ${JSON.stringify({ ...diag, extra, v: await lies(), etikett: await attr('v1', 'data-veil-video-etikett'), rueckfall: (await status())?.videoZonenRueckfall })}`);
    }
  }
  async function augenblick1(art, von, bis_, merke) {
    return bis('stimmiger Augenblick', async () => {
      const modus = await attr('v1', 'data-veil-video-modus');
      const veil = await attr('v1', 'data-veil');
      merke({ modus, veil });
      if (modus !== 'zonen' || veil !== 'zensiert') return null;
      const vor = await lies();
      if (!vor || vor.ansicht !== 'zonen' || vor.arten.length === 0 || (art && !art(vor.arten)) || vor.mt < von || vor.mt > bis_) return null;
      const aus = await bild();
      const nach = await lies();
      const gleich = !!nach && nach.flaechen.length === vor.flaechen.length && nach.flaechen.every((f, i) => f.every((x, j) => Math.abs(x - vor.flaechen[i][j]) <= 6));
      if (!nach || nach.mt > bis_ + 0.4 || !gleich || JSON.stringify(nach.arten) !== JSON.stringify(vor.arten) || (await attr('v1', 'data-veil')) !== 'zensiert') return null;
      return { v: vor, aus };
    }, 90_000);
  }
  async function messePreset(o) {
    await oeffneBild(o.satz, o.bild);
    await setze({ preset: o.preset, zonen: zonenNur(o.an), rand: 0.15, schwelle: 0.1, pause: true, video: 'zonen', ...(o.extra ?? {}) });
    await neuesVideo({ id: 'v1' });
    await bis('stiller Abschnitt', async () => (await ct()) > 2.9 && (await ct()) < 4.0, 30_000);
    const ref = await bild();
    await setze({ pause: false });
    const { v, aus } = await augenblick(o.art);
    console.log(`firefox: ${o.preset} (${o.bild}): Zeichenarten ${JSON.stringify(v.arten)}, Flaechen ${JSON.stringify(v.flaechen)}`);
    return { ref, aus, v };
  }

  // Erweiterungsseiten (Pack importieren): wie tests/firefox/presets.test.mjs
  async function oeffneErw(seite) {
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
  }
  async function schliesse() {
    const alle = await driver.getAllWindowHandles();
    if (alle.length > 1) {
      await driver.close();
      await driver.switchTo().window((await driver.getAllWindowHandles())[0]);
    }
    // Der Tab der Testseite muss im Vordergrund sein: in einem Hintergrund-Tab laeuft kein Video (Takt gedrosselt, `document.hidden`)
    await driver.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript(`const w = Services.wm.getMostRecentWindow('navigator:browser'); w.gBrowser.selectedTab = w.gBrowser.tabs[0];`);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
  }
  const imSeitenkontext = async (code) => {
    const text = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
       const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
       Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
    );
    return JSON.parse(text);
  };
  const sichtbar = async (css) => {
    const e = await driver.findElements(By.css(css));
    return e.length > 0 && (await e[0].isDisplayed());
  };
  async function importierePack(pfad) {
    await oeffneErw('options.html');
    await bis('Optionsseite bereit', async () => (await driver.findElements(By.css('#datei'))).length > 0, 30_000);
    await driver.findElement(By.css('#datei')).sendKeys(pfad);
    await bis('Lizenz', () => sichtbar('#lizenz-block'));
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Pack da', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'), 60_000);
    const scan = await imSeitenkontext(`return JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'gesichtsscan' })));`);
    await schliesse();
    return scan;
  }
  async function entfernePack() {
    await oeffneErw('options.html');
    await bis('Optionsseite bereit', async () => (await driver.findElements(By.css('#pack-status'))).length > 0, 30_000);
    await bis('Stand der Seite', async () => /Pack in place|No pack yet/.test(await driver.findElement(By.css('#pack-status')).getText()));
    if (await sichtbar('#entfernen')) {
      await driver.findElement(By.css('#entfernen')).click();
      await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
      await driver.findElement(By.css('#entfernen-ja')).click();
    }
    await bis('Pack entfernt', async () => (await driver.findElement(By.css('#pack-status')).getText()).includes('No pack yet'));
    await schliesse();
  }
  const ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-video-presets-'));

  await test('P1 mosaik und blur im Video: Rahmen nur beim Mosaik, ausserhalb unveraendert', async () => {
    const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: BEDECKBAR, art: (a) => a.includes('mosaik') });
    pruefe(m.v.arten.every((a) => a === 'mosaik'), `Arten ${m.v.arten}`);
    const k = kenn(m.ref, m.aus, m.v.flaechen[0], 0);
    pruefe(k.rahmen > Math.min(m.v.flaechen[0][2], m.v.flaechen[0][3]) * 2, `pinker Rahmen fehlt (${k.rahmen})`);
    pruefe(k.mittel > 8, `Mosaik hat nichts veraendert (${k.mittel})`);
    pruefe(ausserhalb(m.ref, m.aus, m.v.flaechen) < 6, `ausserhalb veraendert (${ausserhalb(m.ref, m.aus, m.v.flaechen)})`);
    const b = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'blur', an: BEDECKBAR, art: (a) => a.length > 0 && a.every((x) => x === 'blur') });
    const kb = kenn(b.ref, b.aus, b.v.flaechen[0], 3);
    pruefe(kb.rahmen < 10, `Blur hat einen Rahmen (${kb.rahmen})`);
    pruefe(kb.mittel > 5, `Blur hat nichts veraendert (${kb.mittel})`);
  });

  await test('P2 mosaik-wort im Video: Wort "MIA" ohne Pack auf Mosaik mit Unterlage und Rahmen', async () => {
    const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik-wort', an: BEDECKBAR, art: (a) => a.includes('mosaik-wort') });
    const mo = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: BEDECKBAR, art: (a) => a.includes('mosaik') });
    const f = groesste(m.v, 'mosaik-wort');
    const k = kenn(m.ref, m.aus, f, 0);
    const km = kenn(mo.ref, mo.aus, groesste(mo.v, 'mosaik'), 0);
    console.log(`firefox: P2 mosaik-wort ${JSON.stringify(k)} gegen mosaik ${JSON.stringify(km)}`);
    pruefe(k.rahmen > Math.min(f[2], f[3]) * 2 * 0.8, `Rahmen (${k.rahmen})`);
    pruefe(k.wort - km.wort > 80, `das Wort fehlt (${k.wort} gegen ${km.wort})`);
  });

  await test('P6 augenbalken: nur schwarze Balken; zensurbalken: Augen Balken, Gesicht schwarz', async () => {
    const a = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'augenbalken', an: [], art: (x) => x.includes('balken') });
    pruefe(a.v.arten.every((x) => x === 'balken'), `Arten ${a.v.arten}`);
    for (const f of a.v.flaechen) {
      pruefe(kenn(a.ref, a.aus, f, Math.round(Math.min(f[2], f[3]) * 0.25)).dunkel > 0.95, `Balken ${f} nicht schwarz`);
      pruefe(kenn(a.ref, a.aus, f, 0).rahmen < 10, 'Balken mit Rahmen');
      pruefe(f[2] > f[3], `Balken ${f} nicht breiter als hoch`);
    }
    pruefe(ausserhalb(a.ref, a.aus, a.v.flaechen) < 6, 'ausserhalb der Balken veraendert');
    const z = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'zensurbalken', an: ['face'], art: (x) => x.includes('balken') && x.includes('schwarz') });
    for (const art of ['balken', 'schwarz']) {
      const f = groesste(z.v, art);
      pruefe(kenn(z.ref, z.aus, f, Math.round(Math.min(f[2], f[3]) * 0.25)).dunkel > 0.95, `zensurbalken ${art} nicht schwarz`);
    }
  });

  await test('P7 person-mosaik und person-blur: die Huelle deckt die Zonen-Flaechen, eine Flaeche je Person', async () => {
    const einzeln = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: ['feet'], art: (x) => x.includes('mosaik') });
    const teile = einzeln.v.flaechen;
    for (const [preset, art] of [['person-mosaik', 'mosaik'], ['person-blur', 'blur']]) {
      const p = await messePreset({ satz: 'nsfw', bild: KOERPER, preset, an: ['feet'], art: (x) => x.length > 0 && x.every((y) => y === art) });
      const huellen = p.v.flaechen;
      const flaecheH = huellen.reduce((s2, f) => s2 + f[2] * f[3], 0);
      const flaecheT = teile.reduce((s2, f) => s2 + f[2] * f[3], 0);
      console.log(`firefox: P7 ${preset}: ${huellen.length} Huellen (${flaecheH} px) gegen ${teile.length} Zonen-Flaechen (${flaecheT} px)`);
      pruefe(flaecheH > flaecheT, `${preset}: Huelle nicht groesser als die Zone`);
      // Die Zonen-Flaechen stammen aus einem eigenen Lauf (andere Aufnahme des Films, die Erkennung schwankt um einzelne Flaechen): die groesste Zone liegt ganz in einer Huelle
      const grosse = [...teile].sort((a, b) => b[2] * b[3] - a[2] * a[3])[0];
      pruefe(anteilInHuelle(grosse, huellen) > 0.95, `${preset}: die groesste Zone ${grosse} liegt nicht in einer Huelle ${JSON.stringify(huellen)}`);
      pruefe(kenn(p.ref, p.aus, huellen[0], 3).mittel > 5, `${preset}: Huelle nicht veraendert`);
      pruefe(ausserhalb(p.ref, p.aus, huellen) < 6, `${preset}: ausserhalb veraendert`);
    }
  });

  await test('P9 Rueckfall "ganzes Bild kurz Mosaik": bleibt Mosaik ohne Rahmen, auch mit dem Preset Zensurbalken', async () => {
    await oeffneBild('sfw', GESICHT);
    await setze({ preset: 'zensurbalken', zonen: zonenNur(['face']), rand: 0.15, schwelle: 0.1, pause: false, video: 'zonen' });
    await neuesVideo({ id: 'v1' });
    const g = await bis('ganzes Bild', async () => {
      const v = await lies();
      if (!v || v.ansicht !== 'ganz') return null;
      const png = await bild();
      const nach = await lies();
      if (!nach || nach.ansicht !== 'ganz') return null;
      let dunkel = 0;
      let rosa = 0;
      let n = 0;
      for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
        if (x < 100 && y > 315) continue;
        const i = (y * png.b + x) * 3;
        n++;
        if (png.daten[i] < 12 && png.daten[i + 1] < 12 && png.daten[i + 2] < 12) dunkel++;
        if (png.daten[i] > 240 && Math.abs(png.daten[i + 1] - 79) < 14 && Math.abs(png.daten[i + 2] - 163) < 14) rosa++;
      }
      return { dunkel: dunkel / n, rosa };
    }, 60_000);
    console.log(`firefox: P9 ganzes Bild: ${JSON.stringify(g)}`);
    pruefe(g.dunkel < 0.15, `das ganze Bild ist schwarz (${g.dunkel})`);
    pruefe(g.rosa < 20, `Rahmen im ganzen Bild (${g.rosa})`);
  });

  // Mit Pack: Mias Gesicht (Portraet-Patch aus den Testbildern, nie Mia), Woerter des Dummy-Packs
  const patchRoh = await fetch(`${basis}/testbild/sfw/${encodeURIComponent(PATCH_GESICHT)}`);
  if (patchRoh.ok) {
    const patch = await sharp(Buffer.from(await patchRoh.arrayBuffer())).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
    const bau = await baueDummyPack({ extraPatches: [{ name: 'patch/mit-gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patch) }], woerter: PACK_WOERTER });
    const packPfad = path.join(ordner, 'dummy-gesicht.miapack');
    await writeFile(packPfad, bau.bytes);

    await test('P3 Mias Gesicht im Video: Gesicht aus dem Pack mit pinkem Rahmen, ein Foto statt Blockkanten', async () => {
      const scan = await importierePack(packPfad);
      console.log(`firefox: Gesichtsscan Dummy-Pack mit einem Portraet-Patch: ${JSON.stringify(scan)}`);
      pruefe(scan.mit === 1, `Gesichtsscan ohne Gesicht (${JSON.stringify(scan)})`);
      const m = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mia-mosaik', an: ['face'], art: (a) => a.includes('mia-gesicht') });
      const f = groesste(m.v, 'mia-gesicht');
      const k = kenn(m.ref, m.aus, f, 0);
      const kP = kante(m.aus, f, 8);
      console.log(`firefox: P3 mia-gesicht ${JSON.stringify(k)} Kantenstaerke ${kP.toFixed(2)}`);
      pruefe(k.rahmen > Math.min(f[2], f[3]) * 2, `pinker Rahmen (${k.rahmen})`);
      pruefe(k.mittel > 20, `Gesicht nicht getauscht (${k.mittel})`);
      pruefe(ausserhalb(m.ref, m.aus, m.v.flaechen) < 6, 'ausserhalb der Flaechen veraendert');
      const mo = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mosaik', an: ['face'], art: (a) => a.includes('mosaik') });
      const kM = kante(mo.aus, groesste(mo.v, 'mosaik'), 8);
      console.log(`firefox: P3 Kantenstaerke Mosaik ${kM.toFixed(2)} gegen Mias Gesicht ${kP.toFixed(2)}`);
      pruefe(kM < kP * 0.75, `Mias Gesicht sieht aus wie Mosaik (${kM} gegen ${kP})`);
    });

    await test('P4 schwarz-wort im Video (mia-wort): Koerper schwarz mit Wort, stabil je Spur, Themenwechsel und Packwechsel zeichnen neu', async () => {
      const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mia-wort', an: BEDECKBAR, art: (a) => a.includes('schwarz-wort'), extra: { woerterThemen: ['alpha'] } });
      const f = groesste(m.v, 'schwarz-wort');
      const k = kenn(m.ref, m.aus, f, 0);
      console.log(`firefox: P4 schwarz-wort ${JSON.stringify(k)}`);
      pruefe(k.dunkel > 0.6, `nicht ueberwiegend schwarz (${k.dunkel})`);
      pruefe(k.wort > 80, `Wort fehlt (${k.wort})`);
      pruefe(k.rahmen < 10, `Rahmen bei Schwarz mit Wort (${k.rahmen})`);
      // stabil je Spur: nur Aufnahmen mit derselben Spur (Kennung `ids`, Testhaken), Wortmaske relativ zur Mitte der Flaeche; bei Spurwechsel (unter Last) hoechstens 5 neue Paare
      let vergleich = null;
      let alt = { v: m.v, aus: m.aus };
      for (let versuch = 0; versuch < 5 && !vergleich; versuch++) {
        const neu = await augenblick((a) => a.includes('schwarz-wort'), 2.6, 4.8);
        const gem = neu.v.ids.findIndex((id, i) => neu.v.arten[i] === 'schwarz-wort' && id >= 0 && alt.v.ids.some((x, j) => x === id && alt.v.arten[j] === 'schwarz-wort'));
        if (gem >= 0) {
          const id = neu.v.ids[gem];
          const fa = alt.v.flaechen[alt.v.ids.findIndex((x, j) => x === id && alt.v.arten[j] === 'schwarz-wort')];
          vergleich = { w1: relMaske(alt.aus, fa), w2: relMaske(neu.aus, neu.v.flaechen[gem]), b1: wortBreite(alt.aus, fa), b2: wortBreite(neu.aus, neu.v.flaechen[gem]) };
        }
        alt = neu;
      }
      pruefe(!!vergleich, 'in 5 Aufnahmepaaren nie dieselbe Spur zweimal gezeigt');
      const stabil = vergleich ? deckung(vergleich.w1, vergleich.w2, 1000, 1) : 0;
      console.log(`firefox: P4 Wort stabil je Spur: Deckung ${(stabil * 100).toFixed(0)} %, Breite ${vergleich?.b1} und ${vergleich?.b2} px`);
      pruefe(!!vergleich && stabil > 0.85 && Math.abs(vergleich.b1 - vergleich.b2) <= 3, `Wort nicht stabil (${stabil})`);
      // Themenwechsel: erst abwarten, bis die Seite den Wechsel aufgenommen hat (das Urteil des Videos wird neu gefasst), sonst saehe die Aufnahme noch das alte Bild.
      // Die Spuren beginnen neu: verglichen wird, wie breit die Woerter aller Flaechen sind.
      const breitenAlt = m.v.flaechen.filter((_, i) => m.v.arten[i] === 'schwarz-wort').map((fl) => wortBreite(m.aus, fl));
      const vorher = (await log()).length;
      await setze({ woerterThemen: ['beta'] });
      await bis('Seite nimmt den Themenwechsel auf', async () => (await log()).slice(vorher).some((e) => e.was === 'data-veil'), 20_000);
      const beta = await augenblick((a) => a.includes('schwarz-wort'), 2.6, 4.8);
      const breitenNeu = beta.v.flaechen.filter((_, i) => beta.v.arten[i] === 'schwarz-wort').map((fl) => wortBreite(beta.aus, fl));
      console.log(`firefox: P4 Themenwechsel: Breiten der Woerter alpha ${JSON.stringify(breitenAlt)} px gegen beta ${JSON.stringify(breitenNeu)} px`);
      pruefe(Math.min(...breitenNeu) > Math.max(...breitenAlt) * 1.2, `noch ein Wort des alten Themas (${breitenAlt} gegen ${breitenNeu})`);
      // Pack weg: Mia-Presets gelten ohne Pack nicht, die Videozensur zeichnet Mosaik. Danach eine frische Seite (waehrend die Erweiterungsseite vorn war, lag der Tab der Testseite
      // im Hintergrund und das Video lief nicht weiter; das laufende Video deckt Chromium ab).
      await entfernePack();
      const ohne = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mia-wort', an: BEDECKBAR, art: (a) => a.length > 0 });
      pruefe(ohne.v.arten.every((x) => x === 'mosaik'), `ohne Pack nicht Mosaik: ${ohne.v.arten}`);
    });

    await test('P8 Mias Gesicht ohne Gesicht im Pack: die Koerper-Behandlung deckt das Gesicht, nie offen, nie Mias Gesicht', async () => {
      await entfernePack();
      const ohneGesicht = path.join(ordner, 'dummy-ohne-gesicht.miapack');
      await writeFile(ohneGesicht, (await baueDummyPack()).bytes);
      const scan = await importierePack(ohneGesicht);
      pruefe(scan.mit === 0, `Pack ohne Gesicht hat ein Gesicht (${JSON.stringify(scan)})`);
      const m = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mia-mosaik', an: ['face'], art: (a) => a.length > 0 });
      pruefe(!m.v.arten.includes('mia-gesicht'), `Mias Gesicht ohne Bild mit Gesicht (${m.v.arten})`);
      pruefe(m.v.arten.every((a) => a === 'mosaik'), `Ersatz nicht Mosaik (${m.v.arten})`);
      const f = groesste(m.v, 'mosaik');
      pruefe(kenn(m.ref, m.aus, f, 0).rahmen > Math.min(f[2], f[3]) * 2, 'Ersatz-Mosaik ohne Rahmen');
      const w = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mia-wort', an: ['face'], art: (a) => a.includes('schwarz-wort') });
      pruefe(w.v.arten.every((a) => a === 'schwarz-wort'), `Ersatz nicht Schwarz mit Wort (${w.v.arten})`);
      const fw = groesste(w.v, 'schwarz-wort');
      pruefe(kenn(w.ref, w.aus, fw, 8).dunkel > 0.6, 'Ersatz nicht schwarz');
      pruefe(kenn(w.ref, w.aus, fw, 0).wort > 80, 'Wort fehlt auf dem Ersatz');
      await entfernePack();
    });
  } else if (OHNE_TESTBILDER) console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: P3 und P4 uebersprungen');
  else fehlerListe.push(`Testbild ${PATCH_GESICHT} fehlt`);
  await rm(ordner, { recursive: true, force: true });
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  fehlerListe.push('Aufbau');
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox: ${fehlerListe.length} Test(s) rot: ${fehlerListe.join('; ')}`);
  process.exit(1);
}
console.log('firefox: alle Video-Zonen-Tests gruen');
process.exit(0);
