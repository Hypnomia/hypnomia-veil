// Firefox-Test der laufenden Video-Nachpruefung ueber geckodriver/WebDriver (PHASE-2-BAUPLAN 10.1, Punkt 9). Gleiche Faelle wie
// tests/chromium/video.spec.ts. Die Fixture video-lauf.html nimmt zur Laufzeit ein Video auf: neutral 0 bis 3 s, Testbild (Satz nsfw)
// 3 bis 6 s, neutral 6 bis 10 s, als blob: mit loop. Firefox ab 132 taktet ueber requestVideoFrameCallback, Firefox 128 ueber timeupdate.
// Einstellungen setzt die Seite ueber das CustomEvent `veil-test` (nur auf 127.0.0.1).
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

// Globaler Waechter: haengt irgendetwas, endet der Lauf nach 400 Sekunden mit Fehler.
setTimeout(() => {
  console.error('firefox: Zeitlimit von 400 s ueberschritten');
  process.exit(1);
}, 400_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const portFremd = port + 2;
const basis = `http://127.0.0.1:${port}`;
// Testbild, das der Erkenner mit den Standard-Zonen sicher trifft (belegt durch die Positivkontrolle unten).
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

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
let letzterStatus = null;

async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)}, Status ${JSON.stringify(letzterStatus)})`);
}

const status = async () => {
  const roh = await driver.executeScript('return document.documentElement.dataset.veilStatus ?? null');
  letzterStatus = roh ? JSON.parse(roh) : null;
  return letzterStatus;
};
const pruefungen = async () => (await status())?.videoPruefungen ?? 0;
const urteil = (id) => driver.executeScript("const e = document.getElementById(arguments[0]); return e ? (e.getAttribute('data-veil') ?? '') : ''", id);
const wechsel = (id) => driver.executeScript('return window.__wechsel.filter((w) => w.id === arguments[0])', id);
const attribut = (name) => driver.executeScript('return document.documentElement.getAttribute(arguments[0])', name);

async function setze(einstellungen) {
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen }));
}

// Auswertung der Urteilsfolge eines Videos: Abstand jeder Freigabe zum vorigen Wechsel (Verdecken ist nie gebremst) und zwischen zwei Freigaben.
function freigabeAbstaende(eintraege) {
  const liste = eintraege.filter((w) => w.v !== null);
  let nachWechsel = Infinity;
  let zwischenFreigaben = Infinity;
  let letzteFreigabe = null;
  for (let i = 0; i < liste.length; i++) {
    if (liste[i].v !== 'frei') continue;
    if (i > 0) nachWechsel = Math.min(nachWechsel, liste[i].t - liste[i - 1].t);
    if (letzteFreigabe !== null) zwischenFreigaben = Math.min(zwischenFreigaben, liste[i].t - letzteFreigabe);
    letzteFreigabe = liste[i].t;
  }
  return { nachWechsel, zwischenFreigaben };
}

async function oeffne(modus = '') {
  await driver.get(`${basis}/video-lauf.html?bild=${encodeURIComponent(BILD)}${modus ? `&modus=${modus}` : ''}`);
  await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 40_000);
}

const neuesVideo = (opt) => driver.executeScript('window.neuesVideo(arguments[0])', opt);

async function waechterOk() {
  const [blitz, unsichtbar, wer] = await driver.executeScript('return [window.__aufblitzen, window.__unsichtbar, window.__wer]');
  if (blitz !== 0 || unsichtbar !== 0) throw new Error(`Waechter: ${blitz} Aufblitzen, ${unsichtbar} unsichtbar ${JSON.stringify(wer)}`);
}

function pruefe(bedingung, text) {
  if (!bedingung) throw new Error(text);
}

async function test(name, fn) {
  if (process.env.VEIL_NUR && !name.startsWith(process.env.VEIL_NUR)) return; // zum Eingrenzen: nur Faelle, deren Name so beginnt
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));

  const liste = (await (await fetch(`${basis}/api/testbilder?satz=nsfw`)).json()).bilder;
  const bilderDa = liste.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  if (!bilderDa) {
    console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Video-Tests uebersprungen');
    process.exit(0);
  }

  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`firefox: Version ${version}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  let verlaufA = [];
  let rateA = 0;

  await test('Positivkontrolle: dasselbe Testbild als img wird zensiert', async () => {
    await driver.get(`${basis}/video-lauf.html?bild=${encodeURIComponent(BILD)}`);
    await driver.executeScript(
      "const i = document.createElement('img'); i.id = 'kontrolle'; i.style.width = '240px'; i.src = '/testbild/nsfw/' + encodeURIComponent(arguments[0]); document.getElementById('platz').appendChild(i);",
      BILD,
    );
    await bis('Testbild zensiert', async () => (await urteil('kontrolle')) === 'zensiert', 30_000);
  });

  await test('a) beginnt frei, wird im Treffer-Abschnitt verdeckt (spaetestens 1,5 s nach dessen Beginn) und danach wieder frei', async () => {
    await oeffne();
    const taktart = await driver.executeScript("return 'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'requestVideoFrameCallback' : 'timeupdate'");
    console.log(`firefox: Takt ueber ${taktart}`);
    await neuesVideo({ id: 'v1', autoplay: true });
    await bis(
      'frei, verdeckt, frei',
      async () => (await wechsel('v1')).filter((w) => w.v !== null).slice(0, 3).map((w) => w.v).join(',') === 'frei,verdeckt,frei',
      45_000,
    );
    const p0 = await pruefungen();
    const t0 = Date.now();
    await warte(10_000);
    rateA = ((await pruefungen()) - p0) / ((Date.now() - t0) / 1000);
    verlaufA = await wechsel('v1');
    const erstes = verlaufA.filter((w) => w.v !== null);
    const bisVerdeckt = erstes[1].ct - 3;
    console.log(`firefox: Zeit bis verdeckt ${bisVerdeckt.toFixed(2)} s nach Beginn des Treffer-Abschnitts (Abspielposition ${erstes[1].ct.toFixed(2)} s), wieder frei bei ${erstes[2].ct.toFixed(2)} s`);
    pruefe(erstes[1].ct >= 2.9, `verdeckt schon bei ${erstes[1].ct}`);
    pruefe(bisVerdeckt <= 1.5, `verdeckt erst ${bisVerdeckt.toFixed(2)} s nach Beginn des Treffer-Abschnitts`);
    await waechterOk();
  });

  await test('b) Freigaben desselben Videos nie unter 1000 ms nach dem vorigen Wechsel', async () => {
    const e = verlaufA.filter((w) => w.v !== null);
    pruefe(e.length >= 3, `nur ${e.length} Urteile`);
    const { nachWechsel } = freigabeAbstaende(verlaufA);
    console.log(`firefox: ${e.length - 1} Wechsel, kleinster Abstand einer Freigabe zum vorigen Wechsel ${nachWechsel.toFixed(0)} ms`);
    pruefe(nachWechsel >= 1000, `Abstand ${nachWechsel} ms`);
  });

  await test('c) Pruefungen je Sekunde und Video im Mittel ueber 10 s hoechstens 1,1', async () => {
    console.log(`firefox: ${rateA.toFixed(2)} Pruefungen je Sekunde bei einem Video`);
    pruefe(rateA > 0.5, `Rate ${rateA}`);
    pruefe(rateA <= 1.1, `Rate ${rateA}`);
  });

  // Firefox springt in einer Aufnahme ohne Suchindex nicht bildgenau (jeder Sprung landet auf demselben neutralen Bild): der Sprung auf den
  // Treffer-Abschnitt ist dort nicht pruefbar (Chromium prueft ihn). Hier: ein pausiertes Video wird durch drei Spruenge mit sauberem Bild
  // (jeder loest eine Sofortpruefung aus) nach der Hysterese wieder frei, und im Stand gibt es sonst keine Pruefungen.
  await test('d) pausiertes Video: keine Pruefungen im Stand; jeder Sprung (seeked) loest eine Pruefung aus, drei saubere geben frei', async () => {
    await oeffne();
    await neuesVideo({ id: 'p1' });
    await bis('frei', async () => (await urteil('p1')) === 'frei', 30_000);
    await bis('verdeckt im Treffer-Abschnitt', async () => (await urteil('p1')) === 'verdeckt', 20_000);
    await driver.executeScript("document.getElementById('p1').pause()");
    await warte(500);
    const p0 = await pruefungen();
    await warte(3500);
    pruefe((await pruefungen()) === p0, 'Pruefungen im Stand');
    const t0 = Date.now();
    let letzte = p0;
    // Ziele nahe dem Anfang: dort liegt das erste Schluesselbild (neutral). Wohin Firefox bei anderen Zielen springt, haengt von der
    // Aufnahme ab (ohne Suchindex landet es auf irgendeinem Schluesselbild, auch im Treffer-Abschnitt): die Landestelle wird darum geprueft.
    const ziele = [0.5, 0.4, 0.3];
    for (let i = 0; i < 3; i++) {
      const rot = await driver.executeAsyncScript(
        "const fertig = arguments[arguments.length - 1]; const v = document.getElementById('p1'); v.addEventListener('seeked', () => fertig(window.kennfeldRot(v)), { once: true }); v.currentTime = arguments[0];",
        ziele[i],
      );
      pruefe(rot === false, `Sprung ${i + 1} landete im Treffer-Abschnitt (Landestelle rot)`);
      await bis(`Pruefung nach Sprung ${i + 1}`, async () => (await pruefungen()) > letzte, 5000);
      letzte = await pruefungen();
      await warte(2000); // das Ergebnis abwarten: ein weiterer Sprung vor der Antwort verwirft es (Bild veraltet)
      if (i < 2) pruefe((await urteil('p1')) === 'verdeckt', `nach ${i + 1} sauberer Pruefung schon ${await urteil('p1')}`);
    }
    await bis('frei nach drei sauberen Spruengen', async () => (await urteil('p1')) === 'frei', 5000);
    console.log(`firefox: drei Spruenge im Stand, frei nach ${Date.now() - t0} ms`);
    const p2 = await pruefungen();
    await warte(2500);
    pruefe((await pruefungen()) === p2, 'Pruefungen im Stand nach den Spruengen');
  });

  // Firefox springt in einer Aufnahme ohne Suchindex nur auf ein Schluesselbild, in dieser Aufnahme auf das erste. Darum liegt der Treffer in der
  // Fixture-Variante "zuerst" am Anfang (0 bis 1,5 s): der Sprung landet auf einem Bild des Treffer-Abschnitts (das rote Kennfeld belegt es).
  await test('d3) Sprung im Stand auf ein Bild des Treffer-Abschnitts verdeckt ein freies Video', async () => {
    await oeffne('zuerst');
    await neuesVideo({ id: 'z1' });
    await bis('verdeckt (Treffer am Anfang)', async () => (await urteil('z1')) === 'verdeckt', 30_000);
    await bis('frei (neutraler Abschnitt)', async () => (await urteil('z1')) === 'frei', 20_000);
    await driver.executeScript("document.getElementById('z1').pause()");
    await warte(600);
    const t0 = Date.now();
    const rot = await driver.executeAsyncScript(
      "const fertig = arguments[arguments.length - 1]; const v = document.getElementById('z1'); v.addEventListener('seeked', () => fertig(window.kennfeldRot(v)), { once: true }); v.currentTime = 0.5;",
    );
    pruefe(rot === true, 'Landestelle zeigt nicht das Kennfeld des Treffer-Abschnitts');
    await bis('verdeckt nach dem Sprung', async () => (await urteil('z1')) === 'verdeckt', 10_000);
    console.log(`firefox: Sprung auf den Treffer, verdeckt nach ${Date.now() - t0} ms`);
  });

  await test('e) unsichtbar gescrolltes Video: keine Pruefungen; beim Zurueckscrollen geht es weiter', async () => {
    await oeffne();
    await neuesVideo({ id: 's1' });
    await bis('frei', async () => (await urteil('s1')) === 'frei', 30_000);
    await driver.executeScript('window.scrollTo(0, 2800)');
    await warte(1500);
    const p0 = await pruefungen();
    await warte(3500);
    const p1 = await pruefungen();
    console.log(`firefox: unsichtbar, Pruefungen in 3,5 s: ${p1 - p0} (sichtbar waeren etwa 3)`);
    pruefe(p1 === p0, `${p1 - p0} Pruefungen bei unsichtbarem Video`);
    await driver.executeScript('window.scrollTo(0, 0)');
    await bis('Pruefungen gehen weiter', async () => (await pruefungen()) - p1 >= 1, 8000);
  });

  await test('e2) Video weit ausserhalb des Sichtbereichs: nach dem ersten Urteil keine Pruefungen', async () => {
    await oeffne();
    await neuesVideo({ id: 'weit', unten: true });
    await bis('Urteil', async () => /^(frei|verdeckt)$/.test(await urteil('weit')), 30_000);
    await warte(500);
    const p0 = await pruefungen();
    await warte(4000);
    pruefe((await pruefungen()) === p0, 'Pruefungen bei weit entferntem Video');
  });

  await test('f) Autoplay-Video, dessen Quelle 1,5 s nach load kommt: nie verdeckt vor dem ersten Urteil frei', async () => {
    await oeffne('spaet');
    pruefe((await driver.executeScript('return document.documentElement.dataset.filmQuelle')) === 'speicher', 'Film nicht aus dem Speicher');
    await bis('Quelle gesetzt', () => driver.executeScript('return document.documentElement.dataset.spaetQuelle ?? null'), 10_000);
    const abstand = await driver.executeScript('return Number(document.documentElement.dataset.spaetQuelle) - window.__load');
    pruefe(abstand > 1400, `Quelle nur ${abstand} ms nach load`);
    await bis('frei', async () => (await urteil('spaet')) === 'frei', 20_000);
    const folge = (await wechsel('spaet')).map((w) => w.v);
    console.log(`firefox: Quelle ${abstand.toFixed(0)} ms nach load, Urteilsfolge ${JSON.stringify(folge)}`);
    pruefe(folge[0] === 'frei', `erstes Urteil ${folge[0]}`);
    await waechterOk();
  });

  await test('g) Pause der Erweiterung stoppt den Takt, Pause aus nimmt ihn wieder auf', async () => {
    await oeffne();
    await neuesVideo({ id: 'g1' });
    await bis('frei', async () => (await urteil('g1')) === 'frei', 30_000);
    await setze({ pause: true });
    await bis('Pause gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    await warte(500);
    const p0 = await pruefungen();
    await warte(3500);
    pruefe((await pruefungen()) === p0, 'Pruefungen waehrend der Pause');
    pruefe((await driver.executeScript("return document.getElementById('g1').hasAttribute('data-veil')")) === false, 'data-veil nach Pause');
    await setze({ pause: false });
    await bis('Urteil nach Pause', async () => /^(frei|verdeckt)$/.test(await urteil('g1')), 30_000);
    await bis('Takt laeuft wieder', async () => (await pruefungen()) - p0 >= 3, 10_000);
  });

  await test('h) acht Videos gleichzeitig: in jedem Fenster von 1000 ms hoechstens vier Nachpruefungen, im Mittel nahe vier', async () => {
    await oeffne();
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']) await neuesVideo({ id });
    await warte(14_000);
    // Beginn jeder Pruefung mit Art, vom Content-Script selbst gestempelt (die letzten 64). Erst-Pruefungen zaehlen im Budget mit, warten aber
    // nicht darauf: gemessen werden nur die Nachpruefungen (Art takt).
    const alle = (await status()).videoZeiten;
    pruefe(alle.filter((z) => z.art === 'erst').length >= 8, 'weniger als acht Erst-Pruefungen');
    const nach = alle.filter((z) => z.art === 'takt').map((z) => z.t);
    pruefe(nach.length > 30, `nur ${nach.length} Nachpruefungen`);
    let spitze = 0;
    for (let i = 0; i < nach.length; i++) {
      let n = 0;
      for (let j = i; j < nach.length && nach[j] - nach[i] < 1000; j++) n++;
      spitze = Math.max(spitze, n);
    }
    const rate = (nach.length - 1) / ((nach[nach.length - 1] - nach[0]) / 1000);
    console.log(`firefox: acht Videos, ${nach.length} Nachpruefungen, ${rate.toFixed(2)} je Sekunde, groesste Zahl in einem Fenster von 1000 ms ${spitze}`);
    pruefe(spitze <= 4, `${spitze} Pruefungen in einem Fenster`);
    pruefe(rate >= 3.2, `nur ${rate.toFixed(2)} Pruefungen je Sekunde`);
  });

  await test('i) Quellenwechsel: Urteil verworfen, wieder verdeckt (unsichtbar), neu geprueft, Freigabe fruehestens 1000 ms nach dem Verbergen', async () => {
    await oeffne();
    await neuesVideo({ id: 'q1' });
    await bis('frei', async () => (await urteil('q1')) === 'frei', 30_000);
    await driver.executeScript("document.getElementById('q1').src = window.neueQuelle()");
    await bis('frei, entfernt, frei', async () => (await wechsel('q1')).slice(0, 3).map((w) => w.v).join(',') === 'frei,,frei', 20_000);
    const e = await wechsel('q1');
    const abstand = e[2].t - e[1].t;
    console.log(`firefox: Quellenwechsel, Freigabe ${abstand.toFixed(0)} ms nach dem Verbergen`);
    pruefe(abstand >= 1000, `Freigabe schon ${abstand} ms nach dem Verbergen`);
    await waechterOk();
  });

  await test('j) schnelle Quellenwechsel: nie zwei Freigaben desselben Videos unter 1000 ms, nie zwei Freigaben im Dokument unter 334 ms', async () => {
    await oeffne();
    const ids = ['r1', 'r2', 'r3'];
    for (const id of ids) await neuesVideo({ id });
    for (const id of ids) await bis(`${id} frei`, async () => (await urteil(id)) === 'frei', 30_000);
    const wechsleAlle = () =>
      driver.executeScript('for (const id of arguments[0]) document.getElementById(id).src = window.neueQuelle()', ids);
    // Erst mehrmals je Sekunde (die Freigabe verhungert, das Verbergen bleibt sofort), dann etwa im Sekundentakt (Freigaben kommen durch).
    for (let i = 0; i < 12; i++) {
      await wechsleAlle();
      await warte(300);
    }
    for (let i = 0; i < 6; i++) {
      await wechsleAlle();
      await warte(1150);
    }
    for (const id of ids) await bis(`${id} frei am Ende`, async () => (await urteil(id)) === 'frei', 30_000);
    let kleinsterJeVideo = Infinity;
    let freigaben = [];
    for (const id of ids) {
      const verlauf = await wechsel(id);
      const frei = verlauf.filter((w) => w.v === 'frei').map((w) => w.t);
      freigaben = freigaben.concat(frei);
      for (let i = 1; i < frei.length; i++) kleinsterJeVideo = Math.min(kleinsterJeVideo, frei[i] - frei[i - 1]);
      const { nachWechsel } = freigabeAbstaende(verlauf);
      pruefe(nachWechsel >= 1000, `${id}: Freigabe nur ${nachWechsel} ms nach dem vorigen Wechsel`);
    }
    freigaben.sort((a, b) => a - b);
    let kleinsterImDokument = Infinity;
    for (let i = 1; i < freigaben.length; i++) kleinsterImDokument = Math.min(kleinsterImDokument, freigaben[i] - freigaben[i - 1]);
    console.log(`firefox: ${freigaben.length} Freigaben bei schnellen Quellenwechseln, kleinster Abstand je Video ${kleinsterJeVideo.toFixed(0)} ms, im Dokument ${kleinsterImDokument.toFixed(0)} ms`);
    pruefe(freigaben.length >= 6, `nur ${freigaben.length} Freigaben`);
    pruefe(kleinsterJeVideo >= 1000, `je Video ${kleinsterJeVideo} ms`);
    pruefe(kleinsterImDokument >= 334, `im Dokument ${kleinsterImDokument} ms`);
    await waechterOk();
  });
  const setzeTest = (detail) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify(detail));

  // Firefox springt in dieser Aufnahme nur auf ein neutrales Schluesselbild: der Sprung kann den Treffer nicht erreichen. Belegt wird darum, dass die
  // erste Pruefung wiederholt wird (zwei Erst-Pruefungen), in Chromium zusaetzlich, dass das Video nie frei war und am Ende verdeckt ist.
  await test('k) Sprung waehrend der ersten Pruefung: ein "sauber" von vor dem Sprung wird verworfen, das Video bleibt verborgen und wird neu geprueft', async () => {
    await oeffne();
    await neuesVideo({ id: 'k1', abspielen: false, springe: 4 });
    await bis('Urteil', async () => /^(frei|verdeckt)$/.test(await urteil('k1')), 30_000);
    await warte(1500);
    const folge = (await wechsel('k1')).map((w) => w.v);
    const erst = (await status()).videoZeiten.filter((z) => z.art === 'erst').length;
    console.log(`firefox: Sprung waehrend der ersten Pruefung, Urteilsfolge ${JSON.stringify(folge)}, ${erst} Erst-Pruefungen`);
    pruefe(erst >= 2, `nur ${erst} Erst-Pruefung`);
  });

  await test('l) Entfernen waehrend einer wartenden Erst-Freigabe: beim Wiedereinhaengen wird das Video neu bewertet', async () => {
    await oeffne();
    await neuesVideo({ id: 'e1' });
    await bis('frei', async () => (await urteil('e1')) === 'frei', 30_000);
    await driver.executeScript("document.getElementById('e1').src = window.neueQuelle()");
    await warte(450);
    await driver.executeScript("window.__knoten = document.getElementById('e1'); window.__knoten.remove()");
    await warte(1500);
    await driver.executeScript("document.getElementById('platz').appendChild(window.__knoten)");
    await bis('frei nach dem Wiedereinhaengen', async () => (await urteil('e1')) === 'frei', 15_000);
  });

  await test('m) Pause der Erweiterung, waehrend die Erst-Pruefung auf eine offene Pruefung wartet: danach keine weitere Pruefung', async () => {
    await oeffne();
    await neuesVideo({ id: 'w1' });
    await bis('frei', async () => (await urteil('w1')) === 'frei', 30_000);
    await setzeTest({ videoVerzoegerungMs: 6000 });
    const p0 = await pruefungen();
    await bis('haengende Nachpruefung gestartet', async () => (await pruefungen()) > p0, 5000);
    await driver.executeScript("document.getElementById('w1').src = window.neueQuelle()");
    await warte(300);
    await setze({ pause: true });
    await bis('Pause gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    const p1 = await pruefungen();
    await warte(4000);
    pruefe((await pruefungen()) === p1, 'Pruefung nach der Pause');
    await setze({ pause: false }); // die Einstellungen bleiben im Browser stehen: fuer die folgenden Faelle zuruecknehmen
    await bis('Pause aus', async () => (await attribut('data-veil-seite')) === null, 5000);
  });

  await test('n) haengender Erkenner: eine Nachpruefung ueber 2 Taktzeiten verdeckt das Video, ohne zweite Anfrage', async () => {
    await oeffne();
    await neuesVideo({ id: 'h1' });
    await bis('frei', async () => (await urteil('h1')) === 'frei', 30_000);
    await setzeTest({ videoVerzoegerungMs: 6000 });
    const p0 = await pruefungen();
    await bis('haengende Nachpruefung gestartet', async () => (await pruefungen()) > p0, 5000);
    const start = (await status()).videoZeiten.filter((z) => z.art === 'takt').pop().t;
    await bis('verdeckt', async () => (await urteil('h1')) === 'verdeckt', 5000);
    const verdeckt = (await wechsel('h1')).filter((w) => w.v === 'verdeckt')[0].t;
    console.log(`firefox: haengende Antwort, verdeckt ${(verdeckt - start).toFixed(0)} ms nach Beginn der Pruefung`);
    pruefe(verdeckt - start >= 1900 && verdeckt - start <= 3000, `verdeckt nach ${verdeckt - start} ms`);
    const p1 = await pruefungen();
    await warte(2500);
    pruefe((await pruefungen()) === p1, 'zweite Anfrage waehrend die erste offen ist');
  });

  await test('o) Wiedereinhaengen mit anderer Quelle: Urteil verworfen, Video neu bewertet', async () => {
    await oeffne();
    await neuesVideo({ id: 'a1' });
    await bis('frei', async () => (await urteil('a1')) === 'frei', 30_000);
    await driver.executeScript("const v = document.getElementById('a1'); window.__knoten = v; v.remove(); v.src = window.neueQuelle()");
    await warte(1500);
    await driver.executeScript("document.getElementById('platz').appendChild(window.__knoten)");
    await bis('frei, entfernt, frei', async () => (await wechsel('a1')).slice(0, 3).map((w) => w.v).join(',') === 'frei,,frei', 20_000);
  });

  await test('p) vorlaeufig verdecktes Video: das echte Urteil "verdeckt" ist kein Wechsel', async () => {
    await oeffne('zuerst');
    await neuesVideo({ id: 'vl', abspielen: false, preload: 'none' });
    await bis('vorlaeufig verdeckt', async () => (await urteil('vl')) === 'verdeckt', 15_000);
    await bis('ein Wechsel', async () => (await status())?.videoWechsel === 1, 3000);
    await driver.executeScript("document.getElementById('vl').play().catch(() => {})");
    await bis('geprueft', async () => (await pruefungen()) >= 1, 15_000);
    await warte(2500);
    pruefe((await urteil('vl')) === 'verdeckt', 'nicht mehr verdeckt');
    pruefe((await status()).videoWechsel === 1, `videoWechsel ${(await status()).videoWechsel}`);
  });
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
console.log('firefox: alle Video-Tests gruen');
process.exit(0);
