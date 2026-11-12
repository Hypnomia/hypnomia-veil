// Firefox-Test des Mia Packs ueber geckodriver/WebDriver (PHASE-2-BAUPLAN Abschnitt 9): Import ueber die Einstellungsseite,
// Status, storage.local, IndexedDB, Erkenner-Rendern mit Mia-Patch und pinkem Rahmen, Entfernen. Nur synthetische Bilder.
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
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 120 s ueberschritten');
  process.exit(1);
}, 120_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const ROSA = [255, 79, 163];
// Festes Testbild mit bekannten Flaechen (nsfw-Satz in ../05 Testbilder, nie im Repo). Ohne Bild ist der Test rot, ausser mit VEIL_OHNE_TESTBILDER=1.
const TESTBILD = '_DSC6278.JPG';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

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
const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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

// Pixelanalyse und Erkenner-Aufruf im Seitenkontext der Einstellungsseite (dort laufen fetch, Canvas und runtime.sendMessage).
async function rendereUndAnalysiere(preset, farben) {
  return imSeitenkontext(
    `
    const [basis, preset, farben] = args;
    const zonen = {};
    for (const n of ['eyes','mouth','face','head']) zonen[n] = { an: true };
    for (const n of ['breast','genitals','buttocks','belly','feet','armpits']) zonen[n] = { an: true, bedeckt: true };
    const alsDataUrl = (blob) => new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(blob); });
    // Festes Testbild mit bekannten Flaechen; fehlt es oder trifft es nichts, meldet das der Test als Fehler.
    const name = args[3];
    {
      const antwort = await fetch(basis + '/testbild/nsfw/' + encodeURIComponent(name));
      if (!antwort.ok) return { keinBild: true, grund: 'Testbild nicht ladbar: HTTP ' + antwort.status };
      const bitmap = await createImageBitmap(await antwort.blob());
      const f = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const c = new OffscreenCanvas(Math.round(bitmap.width * f), Math.round(bitmap.height * f));
      c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
      const dataUrl = await alsDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
      const roh = await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'pruefe', id: 'ff-' + name, quelle: { art: 'daten', dataUrl },
        breite: 0, hoehe: 0, einstellungen: { schwelle: 0.1, zonen, rand: 0.15, preset }, rendern: true });
      const a = JSON.parse(JSON.stringify(roh));
      if (!a.ok || a.flaechen.length === 0) return { keinBild: true, grund: 'Testbild ohne Flaechen (' + (a.ok ? 'leer' : a.fehler) + ')' };
      const box = [...a.flaechen].sort((p, q) => q.box[2] * q.box[3] - p.box[2] * p.box[3])[0].box.map(Math.round);
      const b = await createImageBitmap(await (await fetch(a.bild)).blob());
      const k = new OffscreenCanvas(b.width, b.height);
      const ctx = k.getContext('2d');
      ctx.drawImage(b, 0, 0);
      const [x, y, w, h] = box;
      const rb = Math.min(10, Math.max(2, Math.round(0.03 * Math.min(w, h))));
      const rand = rb + 3;
      const innen = ctx.getImageData(x + rand, y + rand, Math.max(1, w - 2 * rand), Math.max(1, h - 2 * rand)).data;
      let treffer = 0, gesamt = 0, dunkel = 0, wort = 0;
      for (let i = 0; i < innen.length; i += 4) {
        gesamt++;
        if (innen[i] < 60 && innen[i+1] < 60 && innen[i+2] < 60) dunkel++;
        if (Math.hypot(innen[i] - 255, innen[i+1] - 179, innen[i+2] - 211) < 45) wort++;
        if (farben.some((fa) => Math.hypot(innen[i] - fa[0], innen[i+1] - fa[1], innen[i+2] - fa[2]) < 70)) treffer++;
      }
      const streifen = ctx.getImageData(x, y + Math.round(h * 0.25), rb, Math.max(1, Math.round(h * 0.5))).data;
      const summe = [0, 0, 0]; let n = 0;
      for (let i = 0; i < streifen.length; i += 4) { summe[0] += streifen[i]; summe[1] += streifen[i+1]; summe[2] += streifen[i+2]; n++; }
      return { name, flaechen: a.flaechen.length, render: a.ms.render, dunkel: dunkel / gesamt, wort, anteilPack: treffer / gesamt, rahmen: summe.map((s) => Math.round(s / n)), rahmenBreite: rb };
    }`,
    basis,
    preset,
    farben,
    TESTBILD,
  );
}

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-pack-'));
  const bau = await baueDummyPack();
  const packPfad = path.join(ordner, 'dummy.miapack');
  const kaputtPfad = path.join(ordner, 'kaputt.miapack');
  await writeFile(packPfad, bau.bytes);
  const kaputt = Uint8Array.from(bau.bytes);
  kaputt[kaputt.length - 1] ^= 0xff;
  await writeFile(kaputtPfad, kaputt);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}, Pack ${bau.bytes.byteLength} Bytes, ${bau.bilder} Bilder`);

  // 1. Leerer Stand
  await oeffne('options.html');
  await bis('Status leer', textEnthaelt('#pack-status', 'No pack yet'));
  // Session 17 (Paket C): Karte "Mia Pack" ohne Pack: Kauf mit Preis und zwei Links, eigene Dateiwahl
  pruefe((await text('#stand-titel')) === 'Mia Pack', 'Karte heisst Mia Pack');
  pruefe((await text('#kauf-preis')).startsWith('€9.99, paid once'), 'Kaufblock nennt den Preis');
  pruefe((await text('#kauf-patreon')) === 'Get it on Patreon' && (await text('#kauf-subscribestar')) === 'Get it on SubscribeStar', 'zwei Kauf-Knoepfe');
  pruefe((await driver.findElement(By.css('#kauf-patreon')).getAttribute('target')) === '_blank', 'Kauf-Link oeffnet in neuem Tab');
  pruefe((await text('.pack-wahl-knopf')) === 'Choose the pack file' && (await text('#datei-name')) === 'No file chosen yet', 'eigene Dateiwahl in Mias Sprache');
  pruefe(!(await sichtbar('#pack-daten')), 'ohne Pack keine Pack-Daten sichtbar');
  pruefe(!(await sichtbar('#entfernen')), 'ohne Pack kein Entfernen-Knopf');
  pruefe((await speicher('pack')) === null, 'ohne Pack kein storage.local.pack');

  // 2. Beschaedigtes Pack wird abgelehnt
  await driver.findElement(By.css('#datei')).sendKeys(kaputtPfad);
  await bis('Fehlermeldung', textEnthaelt('#meldung', 'Nothing was stored'));
  pruefe(!(await sichtbar('#lizenz-block')), 'beschaedigtes Pack zeigt keine Lizenz');
  pruefe((await speicher('pack')) === null, 'beschaedigtes Pack: nichts in storage.local');
  const leer = await zaehleIdb();
  pruefe(leer.dateien === 0 && leer.meta === 0, `beschaedigtes Pack: IndexedDB leer (${JSON.stringify(leer)})`);

  // 3. Import: Lizenz zuerst, dann annehmen
  await driver.findElement(By.css('#datei')).sendKeys(packPfad);
  await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
  pruefe((await text('#lizenz-text')).includes('Mia'), 'Lizenztext aus dem Pack steht da');
  pruefe((await speicher('pack')) === null, 'vor dem Annehmen ist nichts gespeichert');
  const t0 = Date.now();
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack-Titel', textEnthaelt('#pack-titel', 'Dummy pack'));
  const importMs = Date.now() - t0;
  console.log(`firefox: Import ${importMs} ms, Pack ${bau.bytes.byteLength} Bytes, ${await text('#pack-bilder')} Bilder`);
  pruefe((await text('#pack-bilder')) === '6', 'Status zeigt 6 Bilder');
  pruefe((await text('#pack-version')) === '0.0.1', 'Status zeigt Version');
  pruefe((await text('#meldung')).includes('The pack is in'), 'Erfolgsmeldung');
  pruefe(await sichtbar('#werbung-frage'), 'Set me up: Frage "Show my ads?" steht nach dem Import da');
  // Der Fokus wandert nach dem Import im naechsten Schritt dorthin (Session 17: unter Last wackelte die sofortige Abfrage).
  let fokus = '';
  try {
    await bis('Fokus bei der Frage', async () => (fokus = await driver.switchTo().activeElement().getAttribute('id')) === 'werbung-frage-titel', 5000);
  } catch {
    // unten als rot gemeldet
  }
  pruefe(fokus === 'werbung-frage-titel', `Fokus liegt bei der Frage (${fokus})`);
  await bis('Bildreihe', async () => (await driver.findElements(By.css('#pack-bildreihe img'))).length > 0);
  pruefe(!(await sichtbar('#neu')), 'Kaufblock weg, wenn das Pack da ist');
  const pack = await speicher('pack');
  pruefe(pack && pack.id === 'dummy' && pack.bilder === 6 && pack.groesse === bau.bytes.byteLength, `storage.local.pack stimmt (${JSON.stringify(pack)})`);
  pruefe((await speicher('einstellungen'))?.preset === 'mia-wort', 'Preset steht auf mia-wort');
  const voll = await zaehleIdb();
  pruefe(voll.dateien === 35 && voll.meta === 2, `IndexedDB: 35 Dateien (Lizenz, 6 Patches, 4 Vorschau, 3 Chibis, 10 Werbebilder, Quiz, Texte, 5 Klaenge, Woerter, 3 Sticker), 2 Meta-Eintraege (${JSON.stringify(voll)})`);

  // 4. Seite neu oeffnen: Stand bleibt
  await schliesse();
  await oeffne('options.html');
  await bis('Stand nach Neuoeffnen', textEnthaelt('#pack-titel', 'Dummy pack'));
  pruefe(true, 'Stand nach erneutem Oeffnen der Seite');

  // 4b. Neustart der Erweiterung per runtime.reload(): Pack, IndexedDB und Stil muessen bleiben
  const packVor = await speicher('pack');
  const stilVor = (await speicher('einstellungen'))?.preset;
  await imSeitenkontext(`setTimeout(() => api.runtime.reload(), 100); return true;`);
  const tReload = Date.now();
  let nachReload = null;
  let reloadFehler = '';
  while (!nachReload && Date.now() - tReload < 25_000) {
    await warte(500);
    try {
      // Die alte Seite ist tot; in einen frischen Tab wechseln und die Seite neu oeffnen
      const handles = await driver.getAllWindowHandles();
      if (handles.length > 0) await driver.switchTo().window(handles[0]).catch(() => {});
      await oeffne('options.html');
      await bis('Seite nach Reload', textEnthaelt('#pack-status', 'Pack in place'), 8_000);
      nachReload = { pack: await speicher('pack'), stil: (await speicher('einstellungen'))?.preset, idb: await zaehleIdb() };
    } catch (e) {
      reloadFehler = String(e).slice(0, 160);
    }
  }
  if (!nachReload) {
    console.log(`firefox: MESSERGEBNIS runtime.reload() bringt die temporaere Erweiterung nicht zurueck (${reloadFehler})`);
    pruefe(false, 'Neustart per runtime.reload(): Erweiterung kam nicht zurueck');
  } else {
    console.log(`firefox: nach runtime.reload() nach ${Date.now() - tReload} ms: Pack ${nachReload.pack?.id}, ${nachReload.idb.dateien} Dateien, Stil ${nachReload.stil}`);
    pruefe(JSON.stringify(nachReload.pack) === JSON.stringify(packVor), 'nach runtime.reload() ist storage.local.pack unveraendert');
    pruefe(nachReload.idb.dateien === 35 && nachReload.idb.meta === 2, `nach runtime.reload() ist IndexedDB unveraendert (${JSON.stringify(nachReload.idb)})`);
    pruefe(nachReload.stil === stilVor && stilVor === 'mia-wort', `nach runtime.reload() steht das Preset auf ${stilVor}`);
  }

  // 5. Erkenner: Schwarz mit Wort (mia-wort, die Dummy-Patches haben kein Gesicht) und Mosaik
  const patch = await rendereUndAnalysiere('mia-wort', bau.farben);
  if (patch.keinBild) {
    if (OHNE_TESTBILDER) console.log(`firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Render-Test uebersprungen (${patch.grund})`);
    else pruefe(false, `Render-Test braucht das Testbild: ${patch.grund}`);
  } else {
    console.log(`firefox: mia-wort ${patch.name}: ${patch.flaechen} Flaechen, render ${patch.render} ms, dunkel ${(patch.dunkel * 100).toFixed(0)} %, Wortpixel ${patch.wort}, Pack-Farben ${(patch.anteilPack * 100).toFixed(0)} %`);
    pruefe(patch.dunkel > 0.6, `mia-wort: Koerper schwarz (${patch.dunkel})`);
    pruefe(patch.wort > 40, `mia-wort: pinkes Wort auf dem Schwarz (${patch.wort})`);
    pruefe(patch.anteilPack < 0.05, `mia-wort: keine Pack-Bilder auf Koerperstellen (${patch.anteilPack})`);
    const mosaik = await rendereUndAnalysiere('mosaik', bau.farben);
    console.log(`firefox: Mosaik: Rahmen ${mosaik.rahmen} (Breite ${mosaik.rahmenBreite}), ${(mosaik.anteilPack * 100).toFixed(0)} % Pack-Farben`);
    pruefe(mosaik.anteilPack < 0.3, `Mosaik: kaum Pack-Farben (${mosaik.anteilPack})`);
    pruefe(abstand(mosaik.rahmen, ROSA) < (mosaik.rahmenBreite >= 4 ? 90 : 120), `Mosaik: pinker Rahmen (${mosaik.rahmen})`);
  }

  // 6. Entfernen mit Rueckfrage
  await driver.findElement(By.css('#entfernen')).click();
  await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
  await driver.findElement(By.css('#entfernen-nein')).click();
  await bis('Rueckfrage zu', async () => !(await sichtbar('#entfernen-frage')));
  pruefe((await speicher('pack'))?.id === 'dummy', 'nach "Keep it" ist das Pack noch da');
  await driver.findElement(By.css('#entfernen')).click();
  await bis('Rueckfrage 2', () => sichtbar('#entfernen-frage'));
  await driver.findElement(By.css('#entfernen-ja')).click();
  await bis('Pack entfernt', textEnthaelt('#pack-status', 'No pack yet'));
  pruefe((await speicher('pack')) === null, 'nach Entfernen kein storage.local.pack');
  pruefe((await speicher('einstellungen'))?.preset === 'mosaik', 'nach Entfernen steht das Preset auf mosaik');
  const weg = await zaehleIdb();
  pruefe(weg.dateien === 0 && weg.meta === 0, `nach Entfernen ist IndexedDB leer (${JSON.stringify(weg)})`);
  if (!patch.keinBild) {
    const zurueck = await rendereUndAnalysiere('mia-wort', bau.farben);
    pruefe(!zurueck.keinBild && zurueck.anteilPack < 0.05 && zurueck.dunkel > 0.6, `ohne Pack: kein Pack-Bild, Koerper schwarz mit MIA (${zurueck.anteilPack}, ${zurueck.dunkel})`);
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: pack.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
