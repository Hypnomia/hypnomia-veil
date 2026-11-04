// Firefox-Test Phase 4, Auftrag S: Steigerung der Zensur (PHASE-4-BAUPLAN Abschnitt 9). Hilfen wie in oberflaeche-erwachsen.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { wirksameStufe } from '../../src/steigerung.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 120 s ueberschritten');
  process.exit(1);
}, 120_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
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
const uuid = randomUUID();

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

async function bis(beschreibung, fn, frist = 15_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}


// ---------- Steigerung (gleiche Faelle wie tests/chromium/steigerung.spec.ts) ----------
const ABBAU_MS = 12 * 60 * 60 * 1000;
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const pack = (f) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen: f, bilder: 0, vorschau: 0, chibis: 0, groesse: 1, importiert: 1 });
const schreibe = (o) => imSeitenkontext(`await api.storage.local.set(args[0]); return true;`, o);
const sende = (n) => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, { ziel: 'hintergrund', ...n });
const minute = (erwachsen, zensiert = 0) => sende({ typ: 'steigerung-minute', erwachsen, zensiert });
const uhrVor = (vorMs) => sende({ typ: 'steigerung-uhr', vorMs });
const aendere = (teil) =>
  imSeitenkontext(`const a = (await api.storage.local.get('einstellungen')).einstellungen ?? {}; await api.storage.local.set({ einstellungen: { ...a, ...args[0] } }); return true;`, teil);
// Wirksame Stufe aus src/steigerung.ts (Test laeuft mit --experimental-strip-types).
const wirksam = (s) => wirksameStufe(s, Date.now());
const stand = (s) => ({ version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: 0, letzteMinute: -1, pauseSeit: null, ...s });

let code = 0;
let server;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  const ext = await oeffne('options.html');
  console.log(`firefox: Version ${version}`);

  // a) ohne Freischaltung zaehlt keine Minute
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'steigerung']); return true;`);
  pruefe((await minute(true)).gezaehlt === false, 'a) ohne Pack zaehlt keine Minute');
  await schreibe({ pack: pack(['erwachsen:vorschau']) });
  pruefe((await minute(true)).gezaehlt === false, 'a) ohne zensur:steigerung zaehlt keine Minute');

  // b) 15 Minuten heben auf Stufe 1, 12 Stunden senken
  await schreibe({ pack: pack(['zensur:steigerung']) });
  await imSeitenkontext(`await api.storage.local.remove('steigerung'); return true;`);
  pruefe((await minute(false, 2)).gezaehlt === false, 'b) 2 neue Urteile zensiert reichen nicht');
  const zwei = await Promise.all([minute(true), minute(true)]);
  pruefe(zwei.filter((a) => a.gezaehlt).length === 1, 'b) zwei gleichzeitige Meldungen: genau eine zaehlt');
  await uhrVor(60_000);
  await imSeitenkontext(`await api.storage.local.remove('steigerung'); return true;`);
  let doppelt = 0;
  for (let i = 0; i < 15; i++) {
    pruefe((await minute(i % 2 === 0, 3)).gezaehlt === true, `b) Minute ${i + 1} zaehlt`);
    if ((await minute(true)).gezaehlt !== false) doppelt++;
    await uhrVor(60_000);
  }
  pruefe(doppelt === 0, `b) dieselbe Uhr-Minute zaehlt nur einmal (${doppelt} doppelt)`);
  let s = await speicher('steigerung');
  pruefe(s.stufe === 1 && wirksam(s) === 1, `b) Stufe 1 nach 15 Minuten (${JSON.stringify(s)})`);
  pruefe(s.naechsterAnstiegNach >= 10 && s.naechsterAnstiegNach <= 20, `b) naechste Schwelle 10 bis 20 (${s.naechsterAnstiegNach})`);
  await uhrVor(ABBAU_MS);
  s = await speicher('steigerung');
  pruefe(wirksam(s) === 0, 'b) 12 Stunden ohne Zensur senken auf Stufe 0');

  // c) Pause
  await schreibe({ steigerung: stand({ stufe: 2, abbauAb: Date.now() }) });
  await aendere({ pause: true });
  await bis('Pause vermerkt', async () => (await speicher('steigerung'))?.pauseSeit != null);
  pruefe((await minute(true)).gezaehlt === false, 'c) in der Pause zaehlt keine Minute');
  await uhrVor(3 * ABBAU_MS);
  pruefe(wirksam(await speicher('steigerung')) === 2, 'c) in der Pause steht der Abbau');
  await aendere({ pause: false });
  await bis('Pause beendet', async () => (await speicher('steigerung'))?.pauseSeit === null);
  pruefe(wirksam(await speicher('steigerung')) === 2, 'c) nach der Pause gleiche Stufe');

  // d) Seite meldet ihre Minute, Stufe 2 schaltet Gesichtszonen an (YuNet-Laeufe steigen)
  await schreibe({ steigerung: stand({}) });
  await aendere({ pause: false, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } });
  await driver.switchTo().newWindow('tab');
  const seite = await driver.getWindowHandle();
  await driver.get(`http://127.0.0.1:${port}/steigerung.html?veil-steigerung-takt=400`);
  // Nur ein sichtbarer Tab meldet: im Vordergrund der Seite warten, dann im Erweiterungstab nachsehen.
  await warte(2500);
  await driver.switchTo().window(ext);
  pruefe(((await speicher('steigerung'))?.minutenSeitAnstieg ?? 0) >= 1, 'd) die sichtbare Seite meldet ihre Minute');
  await driver.switchTo().window(seite);
  await bis('Bild beurteilt', async () => /frei|zensiert|verdeckt/.test((await driver.executeScript(`return document.getElementById('bild')?.getAttribute('data-veil') ?? ''`)) ?? ''), 20_000);
  let nr = 0;
  const laeufe = async () => {
    const n = ++nr;
    await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ erkennerStatus: arguments[0] }) }))`, n);
    const w = await bis('Erkenner-Status', async () => {
      const t = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-erkenner')`);
      const j = t ? JSON.parse(t) : null;
      return j && j.nr === n ? j : null;
    });
    return w.antwort?.gesichtLaeufe ?? -1;
  };
  const vorher = await laeufe();
  await warte(1500);
  pruefe((await laeufe()) === vorher, 'd) Stufe 0: YuNet laeuft nicht');
  await driver.switchTo().window(ext);
  await schreibe({ steigerung: stand({ stufe: 2, abbauAb: Date.now() }) });
  await driver.switchTo().window(seite);
  const nachher = await bis('YuNet laeuft nach Stufe 2', async () => {
    const l = await laeufe();
    return l > vorher ? l : null;
  }, 20_000);
  pruefe(nachher > vorher, `d) Stufe 2: Gesichtszonen an, YuNet-Laeufe ${vorher} auf ${nachher}`);
  await driver.switchTo().window(ext);

  // e) Stufe 4: Bild mit einer Frau ganz verdeckt (Testbild ausserhalb des Repos)
  const datei = path.join(wurzel, '..', '05 Testbilder', 'nsfw', 'IMG_0260.jpg');
  if (!existsSync(datei)) {
    if (process.env.VEIL_OHNE_TESTBILDER === '1') console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Stufe-4-Test uebersprungen');
    else pruefe(false, 'e) Stufe-4-Test braucht ../05 Testbilder/nsfw/IMG_0260.jpg');
  } else {
    const dataUrl = `data:image/jpeg;base64,${readFileSync(datei).toString('base64')}`;
    const zonen = { eyes: { an: false }, mouth: { an: false }, face: { an: false }, head: { an: false }, breast: { an: false, bedeckt: false },
      genitals: { an: false, bedeckt: false }, buttocks: { an: false, bedeckt: false }, belly: { an: false, bedeckt: false },
      feet: { an: true, bedeckt: false }, armpits: { an: false, bedeckt: false } };
    const pruefeBild = (ganz) =>
      imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, {
        ziel: 'erkenner', typ: 'pruefe', id: `s4-${ganz}`, quelle: { art: 'daten', dataUrl }, breite: 0, hoehe: 0, rendern: false,
        einstellungen: { schwelle: 0.1, zonen, rand: 0, stil: 'mosaik', ...(ganz ? { ganzVerdecken: true } : {}) },
      });
    const ohne = await bis('Erkenner antwortet', async () => {
      const a = await pruefeBild(false);
      return a && a.ok ? a : null;
    }, 30_000);
    pruefe(ohne.treffer.some((t) => t.weiblich), 'e) Testbild hat einen Treffer einer Frau');
    pruefe(ohne.flaechen.every((f) => f.box[2] * f.box[3] < ohne.breite * ohne.hoehe), 'e) ohne Stufe 4 keine Flaeche ueber das ganze Bild');
    const mit = await pruefeBild(true);
    pruefe(mit.flaechen.length === 1 && JSON.stringify(mit.flaechen[0].box) === JSON.stringify([0, 0, mit.breite, mit.hoehe]), `e) Stufe 4: eine Flaeche ueber das ganze Bild (${JSON.stringify(mit.flaechen)})`);
  }
  console.log(`firefox: steigerung.test ${ok} gruen, ${rot} rot`);
  code = rot === 0 ? 0 : 1;
} catch (e) {
  console.error('firefox: steigerung.test FEHLER', e);
  code = 1;
} finally {
  try {
    await driver?.quit();
  } catch {}
  server?.close();
}
process.exit(code);
