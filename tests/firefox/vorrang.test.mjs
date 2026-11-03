// Firefox-Test zu PHASE-3-BAUPLAN Auftrag D+V ueber geckodriver/WebDriver. Gleiche Faelle wie tests/chromium/vorrang.spec.ts:
// (D4) Deckkraft der Seite bleibt nach dem Urteil erhalten, Hide-first gilt nur ohne Urteil; (V4) fuenf Vorrang-Stufen der Warteschlange.
// Fixtures deckkraft.html und vorrang.html (synthetische Bilder, keine Testbilder noetig). Testhaken ueber das CustomEvent `veil-test`
// (nur Testbau, nur 127.0.0.1): einstellungen, warteschlangeHalt, pruefVerzoegerungMs.
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
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
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

const setzeTest = (detail) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify(detail));
const setze = (einstellungen) => setzeTest({ einstellungen });

// ---------- D4 ----------

// Elemente der Seite (Id im Dokument) und der Shadow Root (Ids mit s-): [Urteil, Deckkraft, Filter].
const stil = (id) =>
  driver.executeScript(
    "const el = document.getElementById(arguments[0]) ?? window.wurzel.getElementById(arguments[0]); const st = getComputedStyle(el); return [el.getAttribute('data-veil'), st.opacity, st.filter]",
    id,
  );
const MIT_URTEIL = ['x-img', 'x-div', 'einblenden', 'offen', 'halb', 'wechsel', 'leer', 's-stumm', 's-halb', 's-offen', 's-leer', 's-wechsel', 'fremd-leer', 'fremd-x', 'fremd-frei'];

async function oeffneDeckkraft(abfrage = '') {
  await driver.get(`${basis}/deckkraft.html${abfrage}`);
  await bis('Seite bereit', () => driver.executeScript('return document.documentElement.dataset.deckkraftBereit ?? null'), 10_000);
}
const warteAufUrteile = () =>
  bis('alle Urteile', async () => (await Promise.all(MIT_URTEIL.map((i) => stil(i)))).every((s) => s[0] !== null), 40_000);
const seiteAttr = () => driver.executeScript('return document.documentElement.getAttribute("data-veil-seite")');

// ---------- V4 ----------

const STUFE = { sg: 1, sk: 2, ng: 3, nk: 4, fern: 5 };
const gruppe = (id) => id.split('-')[1];
const VERZOEGERUNG = 600;
const urteile = () => driver.executeScript('return window.__urteile');
const anzahl = () => driver.executeScript('return window.__urteile.length');

// Die 43 Bilder gruppenweise in einer Folge anlegen, die NICHT der Stufenfolge entspricht (window.GRUPPEN), und nach jeder Gruppe warten, bis ihre
// Bilder geladen und eingereiht sind: die Einreihungsfolge ist fast die umgekehrte Stufenfolge, nur eine echte Stufenwahl ordnet sie um.
async function baueVorrang() {
  await driver.get(`${basis}/vorrang.html`);
  await bis('Seite bereit', () => driver.executeScript('return document.documentElement.dataset.vorrangBereit ?? null'), 10_000);
  await setzeTest({ warteschlangeHalt: true, pruefVerzoegerungMs: VERZOEGERUNG });
  const gruppen = await driver.executeScript('return window.GRUPPEN');
  let erwartet = 0;
  for (const g of gruppen) {
    erwartet += await driver.executeScript('const v = document.images.length; window.baueGruppe(arguments[0]); return document.images.length - v', g);
    await bis(`${erwartet} Bilder geladen`, async () => (await driver.executeScript('return [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length')) === erwartet, 30_000);
    await warte(300);
  }
  pruefe(erwartet === 43, `${erwartet} Bilder statt 43`);
  await warte(1000);
  pruefe((await anzahl()) === 0, 'Urteile trotz angehaltener Warteschlange');
}

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));

  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  await driver.manage().window().setRect({ width: 1100, height: 900 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`firefox: Version ${version}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  await test('Aufwaermen: der Erkenner antwortet', async () => {
    await oeffneDeckkraft();
    await warteAufUrteile();
  });

  await test('D4 a) X-Muster: img mit Seiten-Deckkraft 0 bleibt 0, Nachbar-div mit Inline-Hintergrund ist 1', async () => {
    await oeffneDeckkraft();
    await warteAufUrteile();
    const img = await stil('x-img');
    const div = await stil('x-div');
    console.log(`firefox D4a: img ${JSON.stringify(img)}, div ${JSON.stringify(div)}`);
    pruefe(img[0] === 'frei' && img[1] === '0', `img ${JSON.stringify(img)}`);
    pruefe(/^(frei|zensiert)$/.test(div[0]) && div[1] === '1', `div ${JSON.stringify(div)}`);
    pruefe((await stil('offen'))[1] === '1', 'Seitenregel opacity 1 verloren');
    pruefe((await stil('halb'))[1] === '0.5', 'Seitenregel opacity 0,5 verloren');
  });

  await test('D4 b) Einblenden: die Seite setzt spaeter eine Klasse von 0 auf 1, Ergebnis 1', async () => {
    await oeffneDeckkraft();
    await warteAufUrteile();
    const vorher = await stil('einblenden');
    pruefe(vorher[0] === 'frei' && vorher[1] === '0', `vor dem Einblenden ${JSON.stringify(vorher)}`);
    await driver.executeScript('window.einblenden()');
    await bis('opacity 1', async () => (await stil('einblenden'))[1] === '1', 5000);
  });

  await test('D4 c) vor dem Urteil ist jedes Element 0, auch mit Seitenregel opacity 1 (Freigabe gesperrt)', async () => {
    await oeffneDeckkraft('?veil-freigabe=nie');
    await warte(4000);
    for (const id of ['x-img', 'x-div', 'einblenden', 'offen', 'halb', 'wechsel', 's-stumm', 's-halb', 's-offen', 's-wechsel', 'fremd-leer', 'fremd-x', 'fremd-frei']) {
      const s = await stil(id);
      pruefe(s[0] === null && s[1] === '0', `${id} ${JSON.stringify(s)}`);
    }
  });

  await test('D4 d) verdeckt zeigt Blur und behaelt die Seiten-Deckkraft (Seite und Shadow Root)', async () => {
    await oeffneDeckkraft();
    await warteAufUrteile();
    for (const id of ['leer', 's-leer']) {
      const s = await stil(id);
      console.log(`firefox D4d: ${id} ${JSON.stringify(s)}`);
      pruefe(s[0] === 'verdeckt' && s[1] === '0.6' && s[2].includes('blur'), `${id} ${JSON.stringify(s)}`);
    }
  });

  // Erwartete Deckkraft, sobald der Schleier aus ist (Pause oder Ausnahme): was die Seite festlegt, ohne Blur, ohne Urteil.
  const SEITE_AUS = {
    'x-img': '0', 'x-div': '1', einblenden: '0', offen: '1', halb: '0.5', leer: '0.6',
    's-stumm': '0', 's-halb': '0.5', 's-offen': '1', 's-leer': '0.6', 's-wechsel': '1',
  };
  for (const [name, an, aus] of [
    ['Pause', { pause: true }, { pause: false }],
    ['eigene Ausnahme fuer den Testhost', { ausnahmen: ['127.0.0.1'] }, { ausnahmen: [] }],
  ]) {
    await test(`D4 e) ${name}: Seiten-Deckkraft, kein Blur; danach wieder beurteilt`, async () => {
      await oeffneDeckkraft();
      await warteAufUrteile();
      await setze(an);
      await bis('Seite aus', async () => (await seiteAttr()) === 'aus', 5000);
      for (const [id, opacity] of Object.entries(SEITE_AUS)) {
        const s = await stil(id);
        pruefe(s[1] === opacity && s[2] === 'none' && s[0] === null, `${id} bei ausgeschaltetem Schleier ${JSON.stringify(s)}, erwartet ${opacity}`);
      }
      await setze(aus);
      await bis('Seite wieder an', async () => (await seiteAttr()) === null, 5000);
      await warteAufUrteile();
    });
  }

  await test('D4 f) Shadow Root: Seiten-Deckkraft nach dem Urteil', async () => {
    await oeffneDeckkraft();
    await warteAufUrteile();
    for (const [id, opacity] of [['s-stumm', '0'], ['s-halb', '0.5'], ['s-offen', '1']]) {
      const s = await stil(id);
      pruefe(s[0] === 'frei' && s[1] === opacity, `${id} ${JSON.stringify(s)}`);
    }
  });

  for (const [name, id, setzeSrc] of [
    ['Seite', 'wechsel', "document.getElementById('wechsel').src = '/synthetisch/20.png'"],
    ['Shadow Root', 's-wechsel', "window.wurzel.getElementById('s-wechsel').src = '/synthetisch/21.png'"],
  ]) {
    await test(`D4 g) Quellenwechsel nach der Freigabe (${name}): wieder 0 bis zum neuen Urteil`, async () => {
      await oeffneDeckkraft();
      await warteAufUrteile();
      const vorher = await stil(id);
      pruefe(vorher[0] === 'frei' && vorher[1] === '1', `vorher ${JSON.stringify(vorher)}`);
      await setzeTest({ warteschlangeHalt: true });
      await driver.executeScript(setzeSrc);
      await bis('Urteil entfernt', async () => (await stil(id))[0] === null, 5000);
      for (let i = 0; i < 6; i++) {
        const s = await stil(id);
        pruefe(s[0] === null && s[1] === '0', `waehrend des Haltens ${JSON.stringify(s)}`);
        await warte(120);
      }
      await setzeTest({ warteschlangeHalt: false });
      await bis('neues Urteil', async () => (await stil(id))[0] === 'frei', 20_000);
      pruefe((await stil(id))[1] === '1', 'nach dem neuen Urteil nicht 1');
    });
  }

  await test('D4 h) fremde Werte von data-veil (leer, fremd, frei): nach dem eigenen Urteil frei und sichtbar', async () => {
    await oeffneDeckkraft();
    await warteAufUrteile();
    for (const id of ['fremd-leer', 'fremd-x', 'fremd-frei']) {
      const s = await stil(id);
      pruefe(s[0] === 'frei' && s[1] === '1', `${id} ${JSON.stringify(s)}`);
    }
  });

  await test('V4 a) Reihenfolge der Urteile folgt den fuenf Stufen', async () => {
    await baueVorrang();
    await setzeTest({ warteschlangeHalt: false });
    await bis('43 Urteile', async () => (await anzahl()) === 43, 90_000);
    const liste = await urteile();
    const stufen = liste.map((u) => STUFE[gruppe(u.id)]);
    console.log(`firefox V4a: Stufen in Urteilsfolge ${stufen.join('')}`);
    // Je drei Urteile (Parallelitaet 3) sind eine Welle: Wellen folgen einander in Stufenfolge.
    for (let k = 0; k + 3 < stufen.length; k += 3) {
      const hierMax = Math.max(...stufen.slice(k, k + 3));
      const danachMin = Math.min(...stufen.slice(k + 3, k + 6));
      pruefe(hierMax <= danachMin, `Welle ${k / 3 + 1} (max ${hierMax}) vor der folgenden (min ${danachMin}): ${stufen.join('')}`);
    }
    pruefe(liste.slice(0, 3).every((u) => gruppe(u.id) === 'sg'), 'die ersten drei sind nicht die grossen sichtbaren');
    pruefe(stufen.filter((s) => s === 5).length === 30, 'Stufe 5 nicht vollstaendig abgearbeitet');
    pruefe(liste.every((u) => u.v === 'frei'), 'nicht alle frei');
  });

  await test('V4 b) Scrollen waehrend der Pruefung zieht Neu-Sichtbares vor', async () => {
    await baueVorrang();
    await setzeTest({ warteschlangeHalt: false });
    await bis('erste Welle', async () => (await anzahl()) >= 3, 30_000);
    await driver.executeScript('window.scrollTo(0, window.ziel)');
    await bis('15 Urteile', async () => (await anzahl()) >= 15, 90_000);
    const ids = (await urteile()).map((u) => u.id);
    console.log(`firefox V4b: Urteilsfolge ${ids.map((i) => i.replace('g-', '')).join(' ')}`);
    const ziel = new Set(Array.from({ length: 8 }, (_, i) => `g-fern-${i}`));
    pruefe(ids.slice(0, 3).every((i) => gruppe(i) === 'sg'), 'Welle 1 nicht sg');
    pruefe(ids.slice(3, 6).every((i) => gruppe(i) === 'sk'), 'Welle 2 nicht sk');
    pruefe(ids.slice(6, 12).every((i) => ziel.has(i)), `nach dem Scrollen zuerst Nicht-Neu-Sichtbares: ${ids.slice(6, 12).join(',')}`);
    pruefe(ids.slice(6, 15).filter((i) => ziel.has(i)).length === 8, 'nicht alle 8 neu sichtbaren in den ersten 9 danach');
    // fern-8 bis fern-11 sind durch das Scrollen nah geworden (nicht sichtbar): sie kommen vor den uebrigen fernen, obwohl spaeter eingereiht.
    await bis('43 Urteile', async () => (await anzahl()) === 43, 90_000);
    const alle = (await urteile()).map((u) => u.id);
    const welle = (i) => Math.floor(alle.indexOf(i) / 3);
    const nahWellen = [8, 9, 10, 11].map((n) => welle(`g-fern-${n}`));
    const fernWellen = Array.from({ length: 18 }, (_, k) => welle(`g-fern-${k + 12}`));
    console.log(`firefox V4b: Wellen nach dem Scrollen nah ${nahWellen.join(',')}, fern ab ${Math.min(...fernWellen)}`);
    pruefe(Math.max(...nahWellen) <= Math.min(...fernWellen), 'nah gewordene Bilder kommen nicht vor den fernen');
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
console.log('firefox: alle Vorrang-Tests gruen');
process.exit(0);
