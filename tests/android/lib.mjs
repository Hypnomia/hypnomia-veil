// Hilfen fuer den Android-Durchlauf (Firefox fuer Android im Emulator): geckodriver mit androidPackage, feste Erweiterungs-UUID,
// temporaere Installation, Seiten im Chrome-Kontext laden, Fotos und Tipps per adb (Koordinaten aus uiautomator dump).
// Weg und Fallen: tests/android/LIES-MICH.md. Kein Produktcode.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
export const wurzel = path.resolve(hier, '../..');
export const fotoOrdner = path.resolve(wurzel, '../03 Recherche/emulator');
export const messOrdner = path.join(wurzel, 'scripts', 'messung');

export const GECKO_ID = 'veil@hypnomia';
// Feste UUID: die Erweiterungsseiten haben dann eine bekannte Adresse (moz-extension://<uuid>/...).
export const UUID = '5f0a3c1e-7b2d-4e8a-9c46-1d2e3f4a5b6c';
export const seriennummer = process.env.VEIL_ANDROID_SERIAL ?? 'emulator-5554';
export const paketName = process.env.VEIL_ANDROID_PACKAGE ?? 'org.mozilla.firefox';
// Testports (Auftrag): Hauptserver, zweiter Server; der Fremd-Ursprung der Fixtures liegt immer bei Hauptport plus 2.
export const PORT = Number(process.env.VEIL_ANDROID_FIXTURE_PORT ?? 47420);
export const PORT_ZWEI = PORT + 1;
export const PORT_FREMD = PORT + 2;
// Mit "adb reverse" ist der Mac im Emulator unter 127.0.0.1 erreichbar: nur dort greifen die Testhaken des Schleiers (Testhost).
export const basis = `http://127.0.0.1:${PORT}`;

export const warte = (ms) => new Promise((r) => setTimeout(r, ms));

export class NutzungsbedingungenDialog extends Error {
  constructor(text) {
    super(`Dialog mit Nutzungsbedingungen von Firefox im Emulator (nicht bestaetigt): ${text}`);
    this.name = 'NutzungsbedingungenDialog';
  }
}

// ---------- adb ----------

export function adb(...args) {
  return execFileSync('adb', ['-s', seriennummer, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
export function adbRoh(...args) {
  return execFileSync('adb', ['-s', seriennummer, ...args], { maxBuffer: 256 * 1024 * 1024 });
}
export const shell = (befehl) => adb('shell', befehl);

export function emulatorBereit() {
  try {
    return execFileSync('adb', ['-s', seriennummer, 'shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).trim() === '1';
  } catch {
    return false;
  }
}

// Firefox nach vorn (der Tab, der gerade im Browser gewaehlt ist, ist dann sichtbar).
export function holeFirefoxNachVorn() {
  shell(`am start -n ${paketName}/.App`);
}

// ---------- Fotos ----------

const fotoZaehler = new Map();
// Bildschirmfoto des Emulators nach ../03 Recherche/emulator/phase8-<schritt>-<nr>.png; gibt den Dateinamen zurueck.
export function foto(schritt, beschreibung = '') {
  mkdirSync(fotoOrdner, { recursive: true });
  const nr = (fotoZaehler.get(schritt) ?? 0) + 1;
  fotoZaehler.set(schritt, nr);
  const name = `phase8-${schritt}-${String(nr).padStart(2, '0')}.png`;
  writeFileSync(path.join(fotoOrdner, name), adbRoh('exec-out', 'screencap', '-p'));
  console.log(`android: Foto ${name}${beschreibung ? ` (${beschreibung})` : ''}`);
  return name;
}

// Foto als Puffer, ohne Datei (fuer Vergleiche).
export const fotoPuffer = () => adbRoh('exec-out', 'screencap', '-p');

// ---------- uiautomator: Knoten lesen, tippen ----------

export function leseOberflaeche() {
  const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  const knoten = [];
  const muster = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = muster.exec(xml))) {
    const a = m[1];
    const holen = (n) => {
      const r = new RegExp(`\\b${n}="([^"]*)"`).exec(a);
      return r ? r[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n') : '';
    };
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(holen('bounds'));
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    knoten.push({
      text: holen('text'),
      beschreibung: holen('content-desc'),
      id: holen('resource-id'),
      klasse: holen('class'),
      klickbar: holen('clickable') === 'true',
      x1, y1, x2, y2,
      mx: Math.round((x1 + x2) / 2),
      my: Math.round((y1 + y2) / 2),
    });
  }
  return knoten;
}

const DIALOG_MUSTER = /terms of use|terms of service|nutzungsbedingungen/i;
// Einrichtungskarten von Firefox nach dem Willkommensdialog: immer ablehnen.
const ABLEHNEN_MUSTER = /^(not now|cancel|skip|no thanks|maybe later)$/i;

// Willkommensdialog von Firefox im virtuellen Testhandy: geckodriver loescht bei jedem Start die App-Daten, der Dialog kommt jedes Mal.
// Die Inhaberin hat am 06.11.2026 im Chat freigegeben, dass das Testskript ihn in Phase 8 im Emulator mit "Continue" bestaetigt
// (Entscheidung 152; nur Emulator, nie ein echtes Geraet). Alle folgenden Einrichtungskarten werden abgelehnt.
// Gibt true zurueck, wenn ein Dialog weggetippt wurde. Mit VEIL_ANDROID_DIALOG_STOPP=1 bricht es stattdessen ab wie frueher.
export async function raeumeFirefoxDialogeWeg(frist = 15_000) {
  const t0 = Date.now();
  let etwas = false;
  while (Date.now() - t0 < frist) {
    const knoten = leseOberflaeche();
    const terms = knoten.find((k) => DIALOG_MUSTER.test(k.text) || DIALOG_MUSTER.test(k.beschreibung));
    if (terms) {
      if (process.env.VEIL_ANDROID_DIALOG_STOPP === '1') {
        foto('dialog-nutzungsbedingungen', 'Dialog nicht bestaetigt');
        throw new NutzungsbedingungenDialog(terms.text || terms.beschreibung);
      }
      const weiter = finde(knoten, /^continue$/i)[0];
      if (weiter) {
        tippe(weiter.mx, weiter.my);
        console.log('android: Firefox-Willkommensdialog im Emulator mit Continue bestaetigt (Entscheidung 152)');
        etwas = true;
        await warte(800);
        continue;
      }
    }
    const nein = finde(knoten, ABLEHNEN_MUSTER)[0];
    if (nein) {
      tippe(nein.mx, nein.my);
      console.log(`android: Einrichtungskarte abgelehnt (${nein.text || nein.beschreibung})`);
      etwas = true;
      await warte(800);
      continue;
    }
    // Nichts mehr zu tun: nach dem ersten Wegtippen noch kurz nachsehen, ob eine Karte folgt.
    if (!etwas || Date.now() - t0 > 4000) return etwas;
    await warte(500);
  }
  return etwas;
}

// Liegt der Willkommensdialog oben, wird er weggetippt (siehe oben); danach muessen die Knoten neu gelesen werden.
// Rueckgabe true: es wurde getippt.
export function pruefeKeinDialog(knoten = leseOberflaeche()) {
  const treffer = knoten.find((k) => DIALOG_MUSTER.test(k.text) || DIALOG_MUSTER.test(k.beschreibung));
  return Boolean(treffer);
}

export function finde(knoten, wie) {
  const t = typeof wie === 'string' ? (k) => k.text === wie || k.beschreibung === wie : wie instanceof RegExp ? (k) => wie.test(k.text) || wie.test(k.beschreibung) : wie;
  return knoten.filter(t);
}

export function tippe(x, y) {
  shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
}

// Tippt den ersten Knoten, der passt (Text oder Beschreibung), solange er auf dem Bildschirm steht. Wartet bis zu `frist` ms.
export async function tippeKnoten(wie, frist = 8000) {
  const t0 = Date.now();
  let letzte = [];
  while (Date.now() - t0 < frist) {
    letzte = leseOberflaeche();
    if (pruefeKeinDialog(letzte)) {
      await raeumeFirefoxDialogeWeg();
      continue;
    }
    const k = finde(letzte, wie)[0];
    if (k) {
      tippe(k.mx, k.my);
      return k;
    }
    await warte(300);
  }
  throw new Error(`Knoten nicht gefunden: ${String(wie)} (sichtbar: ${letzte.map((k) => k.text || k.beschreibung).filter(Boolean).slice(0, 25).join(' | ')})`);
}

export function wischeHoch() {
  shell('input swipe 540 1700 540 700 250');
}
export const zurueckTaste = () => shell('input keyevent 4');

// ---------- Fixture-Server und Weiterleitung ----------

export async function starteServer(starteFixtureServer) {
  const server = [];
  for (const p of [PORT, PORT_ZWEI, PORT_FREMD]) {
    try {
      server.push(await starteFixtureServer(p));
    } catch (e) {
      console.warn(`android: Port ${p} nicht frei (${e.code ?? e.message}), uebersprungen`);
      continue;
    }
    adb('reverse', `tcp:${p}`, `tcp:${p}`);
  }
  return server;
}
export function raeumeWeiterleitungenAuf() {
  for (const p of [PORT, PORT_ZWEI, PORT_FREMD]) {
    try {
      adb('reverse', '--remove', `tcp:${p}`);
    } catch {
      // schon weg
    }
  }
}

// ---------- geckodriver ----------

export function suchePaket(ausgabeOrdner) {
  const ordner = path.join(wurzel, ausgabeOrdner);
  if (!existsSync(ordner)) throw new Error(`Ausgabeordner fehlt: ${ausgabeOrdner} (VEIL_AUSGABE=${ausgabeOrdner} WXT_TESTHAKEN=1 npm run zip:test:firefox)`);
  const zips = readdirSync(ordner).filter((n) => /-firefox\.zip$/.test(n));
  if (zips.length === 0) throw new Error(`kein Firefox-Paket in ${ausgabeOrdner}`);
  zips.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return path.join(ordner, zips.at(-1));
}

export async function starteFahrer(zipPfad) {
  const geckodriver = process.env.VEIL_GECKODRIVER ?? execFileSync('which', ['geckodriver'], { encoding: 'utf8' }).trim();
  const optionen = new firefox.Options();
  optionen.set('moz:firefoxOptions', {
    androidPackage: paketName,
    androidDeviceSerial: seriennummer,
    prefs: {
      'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: UUID }),
      'media.volume_scale': '0.0',
    },
  });
  // Chrome-Kontext auf Android braucht --allow-system-access (die Umgebungsvariable per Capability lehnt geckodriver ab).
  const dienst = new firefox.ServiceBuilder(geckodriver).addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  // Solange der Willkommensdialog steht, hat die Seitenansicht 0 x 0 Pixel (EMULATOR-FIREFOX.md, Phase 6): zuerst wegtippen.
  await raeumeFirefoxDialogeWeg();
  const rueckgabe = await driver.installAddon(zipPfad, true);
  return { driver, kennung: rueckgabe };
}

export async function schliesse(driver) {
  if (!driver) return;
  await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}

// Seite im gewaehlten Tab laden, im Chrome-Kontext (driver.get kann moz-extension:// auf Android nicht laden).
export async function ladeUrl(driver, url) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow(null);
       const uri = Services.io.newURI(arguments[0]);
       w.browser.browsingContext.loadURI(uri, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      url,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

export const erweiterungsUrl = (seite) => `moz-extension://${UUID}/${seite}`;

// Wartet, bis die Seite im Inhaltskontext geladen ist und `adresse` (Teilstring) hat.
export async function bisSeite(driver, teil, frist = 20_000) {
  const t0 = Date.now();
  let letzte = '';
  while (Date.now() - t0 < frist) {
    try {
      letzte = await driver.executeScript('return location.href + "|" + document.readyState');
      if (letzte.includes(teil) && letzte.endsWith('|complete')) return Date.now() - t0;
    } catch {
      // Seite wechselt gerade
    }
    await warte(100);
  }
  throw new Error(`Seite ${teil} nicht geladen (zuletzt ${letzte})`);
}

// WebExtension-API aus einer Erweiterungsseite heraus (Seitenkontext, nicht Sandbox).
export async function imSeitenkontext(driver, code, ...args) {
  const text = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
     const args = JSON.parse(arguments[0]);
     const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
     Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
    JSON.stringify(args),
  );
  return JSON.parse(text);
}

export async function bis(beschreibung, fn, frist = 15_000, takt = 50) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(takt);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

// ---------- Messergebnis ----------

export function schreibeErgebnis(ergebnis) {
  mkdirSync(messOrdner, { recursive: true });
  const zeit = new Date().toISOString().replace(/[:.]/g, '-');
  const datei = path.join(messOrdner, `ergebnis-android-${zeit}.json`);
  writeFileSync(datei, JSON.stringify(ergebnis, null, 2));
  return datei;
}

export function ffmpegBilder(video, ordner, fps) {
  mkdirSync(ordner, { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${fps}`, path.join(ordner, 'bild-%04d.png')], { encoding: 'utf8' });
  return r.status === 0;
}
