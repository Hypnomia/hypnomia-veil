// Firefox-Test Phase 5, Auftrag K2 (PHASE-5-AUFTRAEGE-SESSION-10 Abschnitt 4): Mauszeiger. Berechneter cursor an Body, Link, Knopf (SVG-Data-URL),
// Textcursor an Textfeldern und editierbaren Bereichen; Wechsel Spirale/Herz/aus, Pause, lokale Pause, Ausnahme, Rahmen gleicher und fremder
// Herkunft, offene Shadow Root, Ersetzen der Blaetter durch die Seite, Pack entfernt, keine neuen Elemente. Dass Firefox den Zeiger wirklich
// zeichnet, zeigt nur der Live-Blick.
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
  console.error('firefox: Zeitlimit von 420 s ueberschritten');
  process.exit(1);
}, 420_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47413);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47415);
const seite = `http://127.0.0.1:${port}/cursor.html?fremd=${portFremd}`;
const GECKO_ID = 'veil@hypnomia';

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
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
async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 600)})`);
}

let driver;
let server;
let ordner;
const uuid = randomUUID();
let hauptFenster;

async function oeffneErweiterung(seiteName) {
  const vorher = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow('navigator:browser');
       w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/${seiteName}`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error(`Erweiterungsseite ${seiteName} nicht geoeffnet`);
  await driver.switchTo().window(neu);
  await bis('Erweiterungsseite geladen', async () => {
    try {
      return await driver.executeScript(`return document.readyState === 'complete' && !!(window.browser || window.chrome) && location.protocol === 'moz-extension:'`);
    } catch {
      return false;
    }
  });
}
async function zurueckZumHaupt() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1 && !alle[0]?.startsWith?.('x')) {
    await driver.close();
  }
  await driver.switchTo().window(hauptFenster);
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

// Aktion auf einer Erweiterungsseite (Einstellungen setzen, Pack importieren), danach zurueck zur Webseite.
async function mitOptionen(fn) {
  await oeffneErweiterung('options.html');
  try {
    return await fn();
  } finally {
    await zurueckZumHaupt();
  }
}
const setzeEinstellungen = (neu) =>
  mitOptionen(() =>
    imSeitenkontext(
      `const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
       await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } });
       return true;`,
      neu,
    ),
  );
const loescheEinstellungen = () => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove('einstellungen'); return true;`));
const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();

const importierePack = (pfad) =>
  mitOptionen(async () => {
    await driver.findElement(By.css('#datei')).sendKeys(pfad);
    await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Erfolgsmeldung', async () => (await text('#meldung')).includes('The pack is in'));
  });
const entfernePack = () =>
  mitOptionen(async () => {
    await bis('Optionsseite da', async () => (await text('#pack-status').catch(() => '')).length > 0);
    await warte(300);
    if (await sichtbar('#entfernen')) {
      await driver.findElement(By.css('#entfernen')).click();
      await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
      await driver.findElement(By.css('#entfernen-ja')).click();
      await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));
    }
  });


// Berechneter cursor: 'spirale' / 'herz' (Kennung im SVG der Data-URL), 'url?' oder der Rohwert ('text', 'pointer', 'auto').
const ARTSKRIPT = `
  const [sel, host] = arguments;
  const el = host ? document.querySelector(host).shadowRoot.querySelector(sel) : document.querySelector(sel);
  const c = getComputedStyle(el).cursor;
  const m = c.match(/url\\("data:image\\/svg\\+xml,([^"]*)"\\)/);
  if (!m) return c;
  const k = decodeURIComponent(m[1]).match(/id='veil-(\\w+)'/);
  return k ? k[1] : 'url?';`;
const art = (sel, host) => driver.executeScript(ARTSKRIPT, sel, host ?? null);
const warteArt = (sel, erwartet, host, frist = 15_000) =>
  bis(`cursor ${sel} = ${erwartet}`, async () => (await art(sel, host)) === erwartet, frist);
const elemente = () => driver.executeScript(() => document.getElementsByTagName('*').length);
const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: false, tabtitel: false, meldungen: false, besuche: false };
const setzeArt = (cursor) => setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: { ...KONTROLLE, cursor } });
const imRahmen = async (teil, fn) => {
  const rahmen = await driver.findElement(By.css(teil));
  await driver.switchTo().frame(rahmen);
  try {
    return await fn();
  } finally {
    await driver.switchTo().parentFrame();
  }
};
const artImRahmen = (teil, sel) => imRahmen(teil, () => art(sel));
const warteRahmen = (teil, sel, erwartet, frist = 15_000) => bis(`${teil} ${sel} = ${erwartet}`, async () => (await artImRahmen(teil, sel).catch(() => null)) === erwartet, frist);

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-cursor-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);

  server = await starteFixtureServer(port);
  const serverFremd = await starteFixtureServer(portFremd);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.setContext(firefox.Context.CHROME).catch(() => {});
  await driver.setContext(firefox.Context.CONTENT);
  await driver.executeScript('return 1');
  await driver.switchTo().window(hauptFenster);
  await driver.manage();
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await loescheEinstellungen();

  // 1. Ohne Pack
  await warte(1500);
  await driver.get(seite);
  await warte(2500);
  pruefe((await art('#link')) === 'pointer' && (await art('body')) !== 'spirale', `ohne Pack: normaler Zeiger (${await art('#link')})`);
  pruefe((await driver.executeScript(() => document.adoptedStyleSheets.length)) === 0, 'ohne Pack: keine Blaetter');

  // 2. Mit Pack: Spirale
  await importierePack(packPfad);
  await setzeArt('spirale');
  await driver.get(seite);
  const vorher = await elemente();
  await warteArt('body', 'spirale');
  let ok1 = true;
  for (const sel of ['body', '#text', '#link', '#knopf', '#in-box', '#nicht-edit']) ok1 = ok1 && (await art(sel)) === 'spirale';
  pruefe(ok1, 'Spirale an Body, Text, Link, Knopf, Checkbox, nicht editierbarem Bereich');
  let ok2 = true;
  for (const sel of ['#in-text', '#in-ohne', '#in-suche', '#area', '#edit', '#edit-kind']) ok2 = ok2 && (await art(sel)) === 'text';
  pruefe(ok2, 'Textcursor an Textfeldern, Suchfeld, textarea, editierbarem Bereich und Kind');
  const bild = await driver.executeAsyncScript(`
    const fertig = arguments[arguments.length - 1];
    const c = getComputedStyle(document.body).cursor;
    const i = new Image();
    i.onload = () => fertig({ w: i.naturalWidth, h: i.naturalHeight, hot: c.replace(/^url\\("[^"]*"\\)\\s*/, ''), url: c.length > 0 });
    i.onerror = () => fertig({ w: 0, h: 0, hot: c });
    i.src = c.match(/url\\("([^"]*)"\\)/)[1];`);
  console.log(`firefox K2: Spirale ${bild.w} x ${bild.h} px, Klickpunkt/Rueckfall "${bild.hot}", Elemente vorher ${vorher}`);
  pruefe(bild.w > 0 && bild.w <= 32 && bild.h > 0 && bild.h <= 32 && bild.hot === '16 16, auto', 'Zeiger laedt als Bild, hoechstens 32 x 32, Klickpunkt 16 16');
  pruefe((await elemente()) === vorher, `keine neuen Elemente im DOM (${vorher} vor, ${await elemente()} nach)`);
  pruefe((await driver.executeScript(() => document.querySelectorAll('style, link[rel=stylesheet]').length)) === 1, 'kein zusaetzliches style-Element');
  pruefe((await driver.executeScript(() => document.adoptedStyleSheets.length)) >= 1, 'Blatt in adoptedStyleSheets');

  // 3. Wechsel
  await setzeArt('herz');
  await warteArt('#link', 'herz');
  pruefe((await art('#in-text')) === 'text', 'Herz: Textfeld bleibt text');
  await setzeArt('aus');
  await warteArt('#link', 'pointer');
  pruefe((await driver.executeScript(() => document.adoptedStyleSheets.length)) === 0, 'aus: kein Blatt');
  await setzeArt('spirale');
  await warteArt('#link', 'spirale');

  // 4. Pause, Ausnahme, lokale Pause
  for (const [name, an, aus] of [
    ['Pause', { pause: true }, { pause: false }],
    ['Ausnahme', { ausnahmen: ['127.0.0.1'] }, { ausnahmen: [] }],
  ]) {
    const t0 = Date.now();
    await setzeEinstellungen(an);
    await warteArt('#link', 'pointer', undefined, 6000);
    console.log(`firefox K2: ${name}: Zeiger zurueck, ${Date.now() - t0} ms inkl. Einstellungswechsel`);
    pruefe(true, `${name} gibt frei`);
    await setzeEinstellungen(aus);
    await warteArt('#link', 'spirale');
  }
  await driver.executeScript(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { lokalePause: true } }) })));
  await warteArt('#link', 'pointer', undefined, 4000);
  pruefe(true, 'lokale Pause gibt frei');

  // 5. Rahmen gleicher und fremder Herkunft
  await setzeArt('herz');
  await driver.get(seite);
  await warteArt('#link', 'herz');
  await bis('Rahmen geladen', () => driver.executeScript(() => [...document.querySelectorAll('iframe')].every((f) => { try { return f.contentDocument ? f.contentDocument.readyState === 'complete' : true; } catch { return true; } })));
  await warteRahmen('#innen', '#i-link', 'herz');
  await warteRahmen('#fremd', '#i-link', 'herz');
  pruefe((await artImRahmen('#innen', '#i-text')) === 'text' && (await artImRahmen('#fremd', '#i-text')) === 'text', 'Rahmen: Herz am Link, Textfeld text');
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await warteArt('#link', 'pointer');
  await warteRahmen('#fremd', '#i-link', 'pointer', 10_000);
  await warteRahmen('#innen', '#i-link', 'pointer', 10_000);
  pruefe(true, 'Ausnahme des Tabs gilt in gleichem und fremdem Rahmen');
  await setzeEinstellungen({ ausnahmen: [] });
  await warteRahmen('#fremd', '#i-link', 'herz');

  // 6. Offene Shadow Root nach Beruehrung, Seite ersetzt die Blaetter
  await setzeArt('spirale');
  await driver.get(seite);
  await warteArt('#link', 'spirale');
  const el = await driver.findElement(By.css('#wirt'));
  await driver.actions().move({ origin: el, x: 5, y: 0 }).perform();
  await driver.actions().move({ origin: el, x: 10, y: 0 }).perform();
  const sl = await art('#s-link', '#wirt');
  const sk = await art('#s-knopf', '#wirt');
  const st = await art('#s-text', '#wirt');
  console.log(`firefox K2: Shadow Root nach Beruehrung: Link ${sl}, Knopf ${sk}, Text ${st}`);
  pruefe(sl === 'spirale' && sk === 'spirale' && st === 'text', 'offene Shadow Root nach Beruehrung: Spirale, Textfeld text');
  await driver.executeScript(() => { document.wrappedJSObject ? (document.wrappedJSObject.adoptedStyleSheets = []) : (document.adoptedStyleSheets = []); });
  pruefe((await art('#link')) === 'pointer', 'Seite warf die Blaetter weg: Zeiger normal');
  await driver.actions().move({ origin: el, x: 40, y: 0 }).perform();
  await driver.executeScript(() => window.dispatchEvent(new Event('focus')));
  await warteArt('#link', 'spirale', undefined, 6000);
  pruefe(true, 'Blatt kommt beim naechsten Anlass wieder');

  // 7. Vollbild
  await setzeArt('spirale');
  await driver.get(seite);
  await warteArt('#link', 'spirale');
  await driver.findElement(By.css('#voll')).click();
  await bis('Vollbild', () => driver.executeScript(() => !!document.fullscreenElement), 8000);
  const tv = Date.now();
  await warteArt('#link', 'pointer', undefined, 5000);
  const blaetterVoll = await driver.executeScript(() => document.adoptedStyleSheets.length);
  console.log(`firefox K2: Vollbild: Zeiger weg nach ${Date.now() - tv} ms, Blaetter ${blaetterVoll}`);
  pruefe(blaetterVoll === 0, 'Vollbild: kein Blatt');
  await driver.executeScript(() => document.exitFullscreen());
  await warteArt('#link', 'spirale', undefined, 5000);
  pruefe(true, 'Vollbild verlassen: Zeiger zurueck');

  // 8. Pack entfernt
  await entfernePack();
  await warteArt('#link', 'pointer');
  pruefe((await driver.executeScript(() => document.adoptedStyleSheets.length)) === 0, 'Pack entfernt: Zeiger normal, kein Blatt');
  serverFremd.close();
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: cursor.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
