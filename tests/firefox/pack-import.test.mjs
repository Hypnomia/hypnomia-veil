// Firefox-Test Pack-Import fertig (Session 12, Auftrag P, Entscheidungen 88, 141): Lizenz jederzeit lesen, Ersetzen mit Hinweis je Fall,
// Einstellungen bleiben, Ziehen und Ablegen, veraenderte Datei, Datum, 360 px. Nur synthetische Bilder. Start stumm (Entscheidung 140).
// Erweiterungsseiten (moz-extension://) erreicht der Test wie scripts/messung/browser.mjs: feste interne UUID per Einstellung und
// ein Tab, den der Chrome-Kontext oeffnet (geckodriver verbietet Navigation zu moz-extension://).
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';
import {
  KNOPF_ANNEHMEN,
  KNOPF_ANNEHMEN_AELTER,
  KNOPF_LIZENZ_ZEIGEN,
  TEXT_EINSTIEG_ZUERST,
  TEXT_KEINE_DATEI,
  TEXT_LIZENZ_NICHT_LESBAR,
  TEXT_BESCHAEFTIGT,
  TEXT_MEHRERE_DATEIEN,
  TEXT_PACK_GEAENDERT,
  ersetzenHinweis,
} from '../../entrypoints/options/pack-texte.ts';
import { datumLang } from '../../src/oberflaeche/gemeinsam.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 180 s ueberschritten');
  process.exit(1);
}, 180_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}

// Erweiterung als temporaeres Add-on installieren, ueber den Pfad (nicht Base64 wie driver.installAddon): geckodriver 0.37 mit Firefox 128
// lehnt die Base64-Form ab (InvalidArgumentError), der Pfad geht in 128 und in neueren Versionen.
async function installiere(treiber, paketPfad) {
  await treiber.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let rot = 0;
function pruefe(bedingung, text) {
  if (bedingung) ok++;
  else {
    rot++;
    console.error(`firefox: ROT  ${text}`);
  }
}

let driver;
let server;
let ordner;
const uuid = randomUUID();

// Oeffnet eine Erweiterungsseite in einem neuen Tab und wechselt dorthin.
async function oeffne(seite) {
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
  return neu;
}

async function schliesse() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1) {
    await driver.close();
    await driver.switchTo().window((await driver.getAllWindowHandles())[0]);
  }
}

// Fuehrt Code mit `api` (browser-Objekt der Seite) aus; der Code ruft `fertig(wert)` mit einem JSON-tauglichen Wert.
async function imSeitenkontext(code, ...args) {
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

const speicher = (schluessel) => imSeitenkontext(`const a = await api.storage.local.get(args[0]); return a[args[0]] ?? null;`, schluessel);

function zaehleIdb() {
  return imSeitenkontext(`
    return await new Promise((ok, fehl) => {
      const a = window.indexedDB.open('veil-pack', 1);
      a.onerror = () => fehl(a.error);
      a.onupgradeneeded = () => { a.result.createObjectStore('meta'); a.result.createObjectStore('dateien', { keyPath: 'name' }); };
      a.onsuccess = () => {
        const db = a.result;
        const tx = db.transaction(['dateien', 'meta'], 'readonly');
        const d = tx.objectStore('dateien').count();
        const m = tx.objectStore('meta').count();
        tx.oncomplete = () => { db.close(); ok({ dateien: d.result, meta: m.result }); };
      };
    });`);
}

// Fragt `fn` im Takt ab, bis es einen wahren Wert liefert.
async function bis(beschreibung, fn, frist = 20_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    // Session 17: die Karte "Mia Pack" entsteht erst beim Laden des Skripts, ein noch fehlendes Element heisst warten.
    try {
      letzter = await fn();
    } catch (e) {
      if (e?.name !== 'NoSuchElementError') throw e;
      letzter = null;
    }
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();
const textEnthaelt = (css, teil) => async () => (await text(css)).includes(teil);


const TITEL = 'Dummy pack (synthetic pictures)';
const DATEIEN = 35; // inklusive 3 Sticker
const DATEIEN_OHNE_TON = 30; // ohne die 5 Klaenge: andere Zahl, damit die Zahl der Dateien etwas aussagt
// Klick mit Scrollen in die Mitte (die feste Sprungleiste verdeckt sonst Elemente am oberen Rand)
const klick = async (css) => {
  const e = await driver.findElement(By.css(css));
  await driver.executeScript(`arguments[0].scrollIntoView({ block: 'center' })`, e);
  await e.click();
};
const attr = (css, name) => driver.findElement(By.css(css)).getAttribute(name);
const verborgen = async (css) => !(await sichtbar(css));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// Meta-Eintrag "aktiv" aus IndexedDB (die Wahrheit)
const leseMetaIdb = () =>
  imSeitenkontext(`
    return await new Promise((ok, fehl) => {
      const a = window.indexedDB.open('veil-pack', 1);
      a.onerror = () => fehl(a.error);
      a.onsuccess = () => {
        const db = a.result; const tx = db.transaction('meta', 'readonly'); const g = tx.objectStore('meta').get('aktiv');
        tx.oncomplete = () => { db.close(); ok(g.result ? { id: g.result.id, version: g.result.version, dateienImMeta: g.result.dateien.length } : null); };
      };
    });`);
const json = (x) => JSON.stringify(x);

// Oeffnet die Einstellungsseite, wartet auf den Pack-Status und darauf, dass das Dateifeld frei ist (grund-pack.ts).
async function oeffneOptionen() {
  await oeffne('options.html');
  await bis('Pack-Status', async () => (await text('#pack-status')).length > 0);
  await bis('Dateifeld frei', async () => (await attr('#datei', 'disabled')) === null);
}

// Wirft Dateien per synthetischem DragEvent auf ein Element.
function wirf(css, dateien, ohneDateien = false, link = false) {
  return driver.executeScript(
    `const [css, dateien, ohne, link] = arguments;
     const dt = new DataTransfer();
     let gesetzt = 'none';
     Object.defineProperty(dt, 'dropEffect', { get: () => gesetzt, set: (v) => { gesetzt = v; }, configurable: true });
     if (link) dt.setData('text/uri-list', 'https://example.com/pack.miapack');
     if (!ohne) for (const d of dateien) {
       const roh = atob(d.b64); const b = new Uint8Array(roh.length);
       for (let i = 0; i < roh.length; i++) b[i] = roh.charCodeAt(i);
       dt.items.add(new File([b], d.name, { type: '' }));
     }
     const ziel = document.querySelector(css);
     const ereignis = (t) => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
     ziel.dispatchEvent(ereignis('dragenter'));
     const ueber = ereignis('dragover'); ziel.dispatchEvent(ueber);
     const effekt = gesetzt;
     const hervor = document.querySelector('#ablage').classList.contains('ueber');
     const ab = ereignis('drop'); ziel.dispatchEvent(ab);
     return { ueber: ueber.defaultPrevented, drop: ab.defaultPrevented, hervor, effekt };`,
    css,
    dateien,
    ohneDateien,
    link,
  );
}

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-packimp-'));
  const bytes = {};
  const pfad = {};
  for (const [name, opts] of [['v100', { version: '1.0.0' }], ['v110', { version: '1.1.0', ohneTon: true }], ['andere', { id: 'anderes', version: '2.0.0' }]]) {
    bytes[name] = (await baueDummyPack(opts)).bytes;
    pfad[name] = path.join(ordner, `${name}.miapack`);
    await writeFile(pfad[name], bytes[name]);
  }
  // Entscheidung 88: ein Byte mitten im Datenteil verfaelscht
  bytes.kaputt = Uint8Array.from(bytes.v110);
  bytes.kaputt[Math.floor(bytes.kaputt.length / 2)] ^= 0xff;
  pfad.kaputt = path.join(ordner, 'kaputt.miapack');
  await writeFile(pfad.kaputt, bytes.kaputt);

  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}, Packs ${bytes.v100.byteLength} Bytes`);
  await oeffneOptionen();
  await imSeitenkontext(
    `await api.storage.local.set({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 } }); return true;`,
  );

  // 1. Lizenz jederzeit
  pruefe(await verborgen('#lizenz-zeile'), 'ohne Pack ist die Lizenz-Zeile verborgen');
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v100);
  await bis('Lizenz-Block', () => sichtbar('#lizenz-block'));
  pruefe(await verborgen('#ersetzen-hinweis'), 'erstes Pack: kein Hinweis zum Ersetzen');
  pruefe((await text('#annehmen')) === KNOPF_ANNEHMEN, 'erstes Pack: Knopf wie immer');
  const lizenzImPack = await driver.findElement(By.css('#lizenz-text')).getAttribute('textContent');
  pruefe(lizenzImPack.length > 20, `Lizenztext im Pack gelesen (${lizenzImPack.length} Zeichen)`);
  await klick('#annehmen');
  await bis('Version 1.0.0', textEnthaelt('#pack-version', '1.0.0'));
  await bis('Lizenz-Zeile', () => sichtbar('#lizenz-zeile'));
  pruefe((await text('#lizenz-zeigen')) === KNOPF_LIZENZ_ZEIGEN, 'Knopf heisst "Read the license"');
  pruefe((await attr('#lizenz-zeigen', 'aria-expanded')) === 'false', 'Lizenz zu: aria-expanded false');
  pruefe(await verborgen('#lizenz-ansicht'), 'Lizenz-Ansicht zu');
  await klick('#lizenz-zeigen');
  await bis('Lizenz-Ansicht offen', () => sichtbar('#lizenz-ansicht'));
  pruefe((await attr('#lizenz-zeigen', 'aria-expanded')) === 'true', 'Lizenz auf: aria-expanded true');
  await bis('Lizenztext gefuellt', async () => (await driver.findElement(By.css('#lizenz-ansicht-text')).getAttribute('textContent')).length > 0);
  const ansicht = await driver.findElement(By.css('#lizenz-ansicht-text')).getAttribute('textContent');
  pruefe(ansicht === lizenzImPack, `Text in der Ansicht gleich dem im Pack (${ansicht.length} Zeichen)`);
  console.log(`firefox: Lizenz in der Ansicht ${ansicht.length} Zeichen, gleich dem Text im Pack`);
  await klick('#lizenz-zeigen');
  await bis('Lizenz-Ansicht zu', async () => await verborgen('#lizenz-ansicht'));
  pruefe((await attr('#lizenz-zeigen', 'aria-expanded')) === 'false', 'zugeklappt: aria-expanded false');
  const kurz1 = await speicher('pack');
  pruefe((await text('#pack-datum')) === datumLang(kurz1.importiert, true), `Pack-Datum amerikanisch (${await text('#pack-datum')})`);
  pruefe(!/\d\d\/\d\d\/\d{4}/.test(await text('#pack-datum')), 'Pack-Datum nicht britisch');

  // 2. Ersetzen: Einstellungen aendern, 1.1.0 (neuer), 1.0.0 (aelter), anderes Pack; nach jedem Schritt der ganze Speicher gleich
  const e0 = await speicher('einstellungen');
  await imSeitenkontext(
    `const a = (await api.storage.local.get('einstellungen')).einstellungen;
     await api.storage.local.set({ einstellungen: { ...a, preset: 'blur', zonen: { ...a.zonen, belly: { ...a.zonen.belly, an: true } }, erwachsen: { ...a.erwachsen, an: false } } }); return true;`,
  );
  const alles = async () => {
    const o = await imSeitenkontext(`return await api.storage.local.get(null);`);
    delete o.pack;
    delete o.begruesstFuer; // Begruessungs-Merker folgt jedem Import (main.ts, Auftrag O)
    delete o.gesichterStand; // Meldung "Gesichtssuche fertig" des Erkenners folgt jedem Import (Zensur-Presets)
    return JSON.stringify(o);
  };
  const vorher = await alles();
  pruefe((await speicher('einstellungen')).preset === 'blur' && e0.preset !== 'blur', 'Einstellungen geaendert: Preset Blur');
  const m0 = await leseMetaIdb();
  pruefe(m0?.version === '1.0.0' && m0.dateienImMeta === DATEIEN, `Meta vor dem Ersetzen: 1.0.0 mit ${DATEIEN} Dateien (${json(m0)})`);

  await driver.findElement(By.css('#datei')).sendKeys(pfad.v110);
  await bis('Hinweis neuer', () => sichtbar('#ersetzen-hinweis'));
  const hNeuer = ersetzenHinweis('neuer', { titel: TITEL, version: '1.0.0' }, { titel: TITEL, version: '1.1.0' });
  pruefe((await text('#ersetzen-hinweis')) === hNeuer, 'Hinweis neuer mit beiden Versionen');
  pruefe((await text('#ersetzen-hinweis')).includes('settings stay'), 'Hinweis nennt: Einstellungen bleiben');
  pruefe(!(await attr('#ersetzen-hinweis', 'class')).includes('stark'), 'neuer: keine starke Warnung');
  pruefe((await text('#annehmen')) === KNOPF_ANNEHMEN, 'neuer: Knopf wie immer');
  pruefe((await speicher('pack')).version === '1.0.0', 'vor dem Annehmen noch 1.0.0');
  await klick('#annehmen');
  await bis('Version 1.1.0', textEnthaelt('#pack-version', '1.1.0'));
  pruefe((await alles()) === vorher, 'nach 1.1.0: Einstellungen, Einstieg und alle anderen Schluessel unveraendert');
  const idb = await zaehleIdb();
  pruefe(idb.dateien === DATEIEN_OHNE_TON && idb.meta === 2, `IndexedDB nach 1.1.0: ${DATEIEN_OHNE_TON} Dateien, 2 Meta (${json(idb)})`);
  const m1 = await leseMetaIdb();
  pruefe(m1?.id === 'dummy' && m1.version === '1.1.0' && m1.dateienImMeta === DATEIEN_OHNE_TON, `Meta in IndexedDB: 1.1.0 mit ${DATEIEN_OHNE_TON} Dateien (${json(m1)})`);
  console.log(`firefox: 1.0.0 -> 1.1.0 ersetzt, Meta 1.1.0 mit ${idb.dateien} Dateien (vorher ${DATEIEN}), Speicher gleich`);

  await driver.findElement(By.css('#datei')).sendKeys(pfad.v100);
  await bis('Hinweis aelter', () => sichtbar('#ersetzen-hinweis'));
  pruefe((await text('#ersetzen-hinweis')) === ersetzenHinweis('aelter', { titel: TITEL, version: '1.1.0' }, { titel: TITEL, version: '1.0.0' }), 'Hinweis aelter mit beiden Versionen');
  pruefe((await attr('#ersetzen-hinweis', 'class')).includes('stark'), 'aelter: starke Warnung (eigene Klasse)');
  pruefe((await text('#annehmen')) === KNOPF_ANNEHMEN_AELTER, 'aelter: Knopf Replace with the older version');
  pruefe((await speicher('pack')).version === '1.1.0', 'Warnung allein ersetzt nichts');
  await klick('#abbrechen');
  await bis('Block zu', async () => await verborgen('#lizenz-block'));
  pruefe((await speicher('pack')).version === '1.1.0' && (await leseMetaIdb()).version === '1.1.0', 'Abbrechen laesst 1.1.0');
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v100);
  await bis('Knopf aelter', async () => (await text('#annehmen')) === KNOPF_ANNEHMEN_AELTER);
  await klick('#annehmen');
  await bis('Version 1.0.0 wieder', textEnthaelt('#pack-version', '1.0.0'));
  pruefe((await alles()) === vorher, 'nach 1.0.0 ueber 1.1.0: ganzer Speicher unveraendert');
  const m2 = await leseMetaIdb();
  pruefe(m2?.version === '1.0.0' && m2.dateienImMeta === DATEIEN && (await zaehleIdb()).dateien === DATEIEN, `Meta wieder 1.0.0 mit ${DATEIEN} Dateien`);
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v100);
  await bis('Hinweis gleich', async () => (await text('#ersetzen-hinweis')).includes('already in'));
  pruefe(!(await attr('#ersetzen-hinweis', 'class')).includes('stark'), 'gleich: keine starke Warnung');
  pruefe((await text('#annehmen')) === KNOPF_ANNEHMEN, 'gleich: Knopf wieder Standardtext');
  await klick('#abbrechen');

  await driver.findElement(By.css('#datei')).sendKeys(pfad.andere);
  await bis('Hinweis anderes', () => sichtbar('#ersetzen-hinweis'));
  pruefe((await text('#ersetzen-hinweis')) === ersetzenHinweis('anderes', { titel: TITEL, version: '1.0.0' }, { titel: TITEL, version: '2.0.0' }), 'Hinweis anderes nennt den Titel des vorhandenen Packs');
  await klick('#annehmen');
  await bis('Version 2.0.0', textEnthaelt('#pack-version', '2.0.0'));
  pruefe((await speicher('pack')).id === 'anderes', 'anderes Pack ersetzt das vorhandene');
  pruefe((await alles()) === vorher, 'nach anderem Pack: ganzer Speicher unveraendert');
  const m3 = await leseMetaIdb();
  pruefe(m3?.id === 'anderes' && m3.version === '2.0.0', `Meta: anderes 2.0.0 (${json(m3)})`);

  // 2b. Zwei Seiten: ersetzt eine andere Seite das Pack nach der Pruefung, bricht der Import ab
  const handleA = await driver.getWindowHandle();
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v110);
  await bis('Hinweis anderes (A)', async () => (await text('#ersetzen-hinweis')).includes('different pack'));
  await oeffneOptionen();
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v100);
  await bis('Lizenz-Block (B)', () => sichtbar('#lizenz-block'));
  await klick('#annehmen');
  await bis('B: Version 1.0.0', textEnthaelt('#pack-version', '1.0.0'));
  await driver.close();
  await driver.switchTo().window(handleA);
  await klick('#annehmen');
  await bis('A: Pack geaendert', async () => (await text('#meldung')) === TEXT_PACK_GEAENDERT);
  pruefe(await verborgen('#lizenz-block'), 'A: Auswahl verworfen');
  const m4 = await leseMetaIdb();
  pruefe((await speicher('pack')).version === '1.0.0' && m4?.id === 'dummy' && m4.version === '1.0.0' && (await zaehleIdb()).dateien === DATEIEN, 'A: Stand 1.0.0 unveraendert, kein stiller Import');
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v110);
  await bis('A: neu geprueft als neuer', async () => (await text('#ersetzen-hinweis')).includes('replaces the old one'));
  await klick('#abbrechen');
  console.log('firefox: Pack zwischen Pruefung und Annehmen anderswo ersetzt: Import abgebrochen, Stand 1.0.0 unveraendert');

  // 3. Ziehen und Ablegen
  const url = await driver.getCurrentUrl();
  const w1 = await wirf('#ablage', [{ name: 'v110.miapack', b64: b64(bytes.v110) }]);
  pruefe(w1.ueber && w1.drop && w1.hervor, `Ablegen: dragover und drop abgefangen, Ablage hervorgehoben (${JSON.stringify(w1)})`);
  await bis('Lizenz-Block nach Ablegen', () => sichtbar('#lizenz-block'));
  pruefe((await text('#lizenz-kopf')).includes('version 1.1.0'), 'abgelegte Datei geprueft (Version 1.1.0 im Kopf)');
  pruefe((await text('#ersetzen-hinweis')).includes('replaces the old one'), 'abgelegte Datei: Hinweis neuer');
  pruefe(!(await attr('#ablage', 'class')).includes('ueber'), 'Hervorhebung nach dem Ablegen weg');
  pruefe((await speicher('pack')).version === '1.0.0', 'Ablegen allein importiert nichts');
  await klick('#abbrechen');
  await wirf('#ablage', [{ name: 'a.miapack', b64: b64(bytes.v100) }, { name: 'b.miapack', b64: b64(bytes.v110) }]);
  pruefe((await text('#meldung')) === TEXT_MEHRERE_DATEIEN, 'zwei Dateien: Satz');
  pruefe(await verborgen('#lizenz-block'), 'zwei Dateien: nichts geprueft');
  const wl = await wirf('#ablage', [], false, true);
  pruefe(wl.ueber && wl.effekt === 'copy', `Link-Wurf: dragover abgefangen, Zeiger copy (${json(wl)})`);
  pruefe((await text('#meldung')) === TEXT_KEINE_DATEI, 'Link ohne Datei: Satz');
  await wirf('#ablage', [], true);
  pruefe((await text('#meldung')) === TEXT_KEINE_DATEI, 'kein File: Satz');
  await wirf('#ablage', [{ name: 'x.txt', b64: b64(Buffer.from('kein Pack')) }]);
  await bis('Fehlersatz fuer Fremddatei', textEnthaelt('#meldung', 'Nothing was stored'));
  const w2 = await wirf('body', [{ name: 'v110.miapack', b64: b64(bytes.v110) }]);
  pruefe(w2.ueber && w2.drop && w2.effekt === 'none', `Wurf daneben: abgefangen, Zeiger none (${json(w2)})`);
  const w3 = await wirf('body', [], false, true);
  pruefe(w3.ueber && w3.effekt === 'none', 'Link daneben: abgefangen, Zeiger none');
  await warte(300);
  pruefe((await driver.getCurrentUrl()) === url && (await verborgen('#lizenz-block')), 'Wurf daneben: Seite bleibt, nichts gelesen');
  console.log('firefox: Ablegen eine Datei angenommen, zwei, keine und fremde Datei abgewiesen, Wurf daneben abgefangen');

  // 4. Entscheidung 88: veraenderte Datei
  const packVor = await speicher('pack');
  const idbVor = await zaehleIdb();
  const einstVor = await speicher('einstellungen');
  await driver.findElement(By.css('#datei')).sendKeys(pfad.kaputt);
  await bis('Fehlersatz veraenderte Datei', textEnthaelt('#meldung', 'Nothing was stored'));
  pruefe(await verborgen('#lizenz-block'), 'veraenderte Datei: keine Lizenz');
  pruefe(await verborgen('#ersetzen-hinweis'), 'veraenderte Datei: kein Hinweis');
  await wirf('#ablage', [{ name: 'kaputt.miapack', b64: b64(bytes.kaputt) }]);
  await warte(500);
  pruefe((await text('#meldung')).includes('Nothing was stored'), 'veraenderte Datei per Ablage: Fehlersatz');
  pruefe(JSON.stringify(await speicher('pack')) === JSON.stringify(packVor), 'veraenderte Datei: Pack unveraendert');
  pruefe(JSON.stringify(await zaehleIdb()) === JSON.stringify(idbVor), `veraenderte Datei: IndexedDB unveraendert (${idbVor.dateien} Dateien)`);
  pruefe(JSON.stringify(await speicher('einstellungen')) === JSON.stringify(einstVor), 'veraenderte Datei: Einstellungen unveraendert');
  console.log(`firefox: veraenderte Datei abgelehnt, Pack ${packVor.version} und ${idbVor.dateien} Dateien unveraendert`);

  // 4b. Datei nach der Pruefung veraendert, mit vorhandenem Pack: altes Pack samt Meta unveraendert
  {
    const wechselt = path.join(ordner, 'wechselt.miapack');
    await writeFile(wechselt, bytes.v110);
    const metaVor = json(await leseMetaIdb());
    await driver.findElement(By.css('#datei')).sendKeys(wechselt);
    await bis('Lizenz-Block (wechselt)', () => sichtbar('#lizenz-block'));
    const geaendert = Uint8Array.from(bytes.v110);
    geaendert[geaendert.length - 5] ^= 0xff;
    await warte(1100);
    await writeFile(wechselt, geaendert);
    await klick('#annehmen');
    await bis('Fehlersatz nach Aenderung', textEnthaelt('#meldung', 'Nothing was stored'));
    pruefe(json(await leseMetaIdb()) === metaVor && json(await zaehleIdb()) === json(idbVor), 'Datei nach der Pruefung veraendert: Meta und Dateien des alten Packs unveraendert');
    pruefe(json(await speicher('pack')) === json(packVor), 'Datei nach der Pruefung veraendert: storage.local.pack unveraendert');
    console.log(`firefox: Datei nach der Pruefung veraendert: Pack ${packVor.version}, Meta und ${idbVor.dateien} Dateien unveraendert`);
  }

  // 4c. Wurf und Doppelklick, sobald der Import laeuft (alles in einem Skriptlauf, bevor irgendein await fertig ist)
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v110);
  await bis('Lizenz-Block (busy)', () => sichtbar('#lizenz-block'));
  const busy = await driver.executeScript(
    `const [b64] = arguments;
     const knopf = document.querySelector('#annehmen');
     knopf.click(); knopf.click();
     const gesperrt = document.querySelector('#abbrechen').disabled && knopf.disabled;
     const roh = atob(b64); const bt = new Uint8Array(roh.length);
     for (let i = 0; i < roh.length; i++) bt[i] = roh.charCodeAt(i);
     const dt = new DataTransfer(); dt.items.add(new File([bt], 'x.miapack', { type: '' }));
     const ziel = document.querySelector('#ablage');
     const ev = (t) => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
     ziel.dispatchEvent(ev('dragover')); ziel.dispatchEvent(ev('drop'));
     return { gesperrt, meldung: document.querySelector('#meldung').textContent };`,
    b64(bytes.v100),
  );
  pruefe(busy.gesperrt && busy.meldung === TEXT_BESCHAEFTIGT, `waehrend des Imports: Abbrechen gesperrt, Wurf bekommt den Satz (${json(busy)})`);
  await bis('Version 1.1.0 nach Doppelklick', textEnthaelt('#pack-version', '1.1.0'));
  const mb = await leseMetaIdb();
  pruefe(mb?.version === '1.1.0' && mb.dateienImMeta === DATEIEN_OHNE_TON && (await zaehleIdb()).dateien === DATEIEN_OHNE_TON, 'Doppelklick: genau ein Import, Stand 1.1.0 mit 30 Dateien');
  console.log('firefox: Wurf und Doppelklick waehrend des Imports abgewiesen, ein Import');

  // 5. Lizenz nicht lesbar: Satz statt leerem Kasten
  await imSeitenkontext(`
    await new Promise((ok, fehl) => {
      const a = window.indexedDB.open('veil-pack', 1);
      a.onerror = () => fehl(a.error);
      a.onsuccess = () => {
        const db = a.result; const tx = db.transaction('meta', 'readwrite'); const s = tx.objectStore('meta'); const g = s.get('aktiv');
        g.onsuccess = () => s.put({ ...g.result, lizenzText: '' }, 'aktiv');
        tx.oncomplete = () => { db.close(); ok(); };
      };
    });
    return true;`);
  await klick('#lizenz-zeigen');
  await bis('Lizenz nicht lesbar', async () => (await text('#lizenz-ansicht-text')) === TEXT_LIZENZ_NICHT_LESBAR);
  pruefe(true, 'Lizenz nicht lesbar: Satz steht da');
  await klick('#entfernen');
  await klick('#entfernen-ja');
  await bis('Pack entfernt', textEnthaelt('#pack-status', 'No pack yet'));
  pruefe((await verborgen('#lizenz-zeile')) && (await verborgen('#lizenz-ansicht')), 'nach Entfernen: Lizenz-Zeile und Ansicht verborgen');

  // 6. Ablegen vor dem Einstieg
  const z = await imSeitenkontext(`return await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'einstieg-test', zuruecksetzen: true });`);
  pruefe(z?.ok === true, 'Testhaken setzt den Einstieg zurueck');
  await driver.navigate().refresh();
  await bis('Dateifeld gesperrt', async () => (await attr('#datei', 'disabled')) !== null);
  await wirf('#ablage', [{ name: 'v110.miapack', b64: b64(bytes.v110) }]);
  await bis('Satz Einstieg', async () => (await text('#meldung')) === TEXT_EINSTIEG_ZUERST);
  pruefe((await verborgen('#lizenz-block')) && (await speicher('pack')) === null, 'vor dem Einstieg: nichts gelesen, nichts gespeichert');
  await imSeitenkontext(
    `await api.storage.local.set({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 } }); return true;`,
  );

  // 7. 360 px: kein waagrechtes Scrollen
  await driver.navigate().refresh();
  await bis('Dateifeld frei', async () => (await attr('#datei', 'disabled')) === null);
  await driver.manage().window().setRect({ width: 360, height: 800 });
  await driver.findElement(By.css('#datei')).sendKeys(pfad.v100);
  await bis('Lizenz-Block 360', () => sichtbar('#lizenz-block'));
  const breite = await driver.executeScript(`return { s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth };`);
  console.log(`firefox: schmalstes Fenster (Firefox laesst headless nicht unter 500 px, 360 px misst der Chromium-Test), scrollWidth ${breite.s}, clientWidth ${breite.c}`);
  pruefe(breite.s <= breite.c, `kein waagrechtes Scrollen (${breite.s} <= ${breite.c})`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: pack-import.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
