// Firefox-Test Phase 5, Vertrag Session 9: Einstellungsseite, Abschnitt "Mia’s control" (Schalter, Auswahl, Minuten mit Grenzen, Warnung).
// Hilfsfunktionen wie tests/firefox/oberflaeche-erwachsen.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 150 s ueberschritten');
  process.exit(1);
}, 150_000).unref();

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

const eigenschaft = (css, name) => driver.executeScript(`return document.querySelector(arguments[0])[arguments[1]]`, css, name);
const text = async (css) => (await driver.executeScript(`return document.querySelector(arguments[0]).textContent.trim()`, css));

const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const einst = async () => (await speicher('einstellungen')) ?? {};
const waehle = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, wert);
const zahl = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  await oeffne('options.html');
  await bis('Abschnitt gezeichnet', async () => (await text('#kon-pack-hinweis')).length > 0);
  pruefe((await text('#kon-titel')) === 'Mia’s control', 'Ueberschrift "Mia’s control"');
  pruefe((await text('#kon-pack-hinweis')).includes('Mia Pack'), 'ohne Pack Hinweis nennt das Pack');
  pruefe((await eigenschaft('#kon-werbung', 'checked')) === true, 'Werbung standardmaessig an');
  pruefe((await eigenschaft('#kon-blitz', 'value')) === 'selten', 'Blitzwoerter standardmaessig selten');
  pruefe((await eigenschaft('#kon-leerlauf', 'checked')) === true, 'Spirale standardmaessig an');
  pruefe((await eigenschaft('#kon-minuten', 'value')) === '2', 'Spirale nach 2 Minuten');

  await klick('#kon-werbung');
  await bis('werbung aus', async () => (await einst()).kontrolle?.werbung === false);
  pruefe(true, 'Schalter Werbung schreibt kontrolle.werbung = false');
  await waehle('#kon-blitz', 'oft');
  await bis('blitz oft', async () => (await einst()).kontrolle?.blitz === 'oft');
  pruefe(true, 'Auswahl Often schreibt kontrolle.blitz = oft');
  await zahl('#kon-minuten', 9);
  await bis('minuten 9', async () => (await einst()).kontrolle?.leerlaufMinuten === 9);
  pruefe(true, 'Minuten 9 gespeichert');
  await zahl('#kon-minuten', 0);
  await bis('minuten 1', async () => (await einst()).kontrolle?.leerlaufMinuten === 1);
  await bis('Feld zeigt 1', async () => (await eigenschaft('#kon-minuten', 'value')) === '1');
  pruefe(true, 'Minuten 0 wird 1 und das Feld zeigt 1');
  await zahl('#kon-minuten', 500);
  await bis('minuten 60', async () => (await einst()).kontrolle?.leerlaufMinuten === 60);
  await bis('Feld zeigt 60', async () => (await eigenschaft('#kon-minuten', 'value')) === '60');
  pruefe(true, 'Minuten 500 wird 60 und das Feld zeigt 60');
  await zahl('#kon-minuten', '');
  await warte(400);
  pruefe((await einst()).kontrolle?.leerlaufMinuten === 60 && (await eigenschaft('#kon-minuten', 'value')) === '60', 'leeres Feld behaelt 60');
  await klick('#kon-leerlauf');
  await bis('leerlauf aus', async () => (await einst()).kontrolle?.leerlauf === false);
  await bis('Minuten-Zeile weg', async () => !(await sichtbar('#kon-minuten-zeile')));
  pruefe(true, 'Spirale aus versteckt die Minuten-Zeile');

  pruefe(await sichtbar('#kon-warnung'), 'Warnung sichtbar, solange nicht bestaetigt');
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: ['kontrolle:leerlauf'], bilder: 1, groesse: 1, importiert: 1 } });`);
  await bis('Hinweis mit Pack', async () => (await text('#kon-pack-hinweis')).includes('Pause Mia'));
  pruefe(true, 'mit Pack nennt der Hinweis Pause Mia');
  await klick('#kon-warnung-ok');
  await bis('Warnung weg', async () => !(await sichtbar('#kon-warnung')));
  pruefe((await speicher('spiraleWarnungGesehen')) === true, 'I understand merkt die Warnung');

  // Session 10: Tab-Titel, Zeiger, Meldungen, Besuche (Standard aus), strenge Zeiten.
  const k = async () => (await einst()).kontrolle ?? {};
  pruefe((await eigenschaft('#kon-tabtitel', 'checked')) === true, 'Tab-Titel ab Werk an');
  pruefe((await eigenschaft('#kon-cursor', 'value')) === 'spirale', 'Zeiger ab Werk Spirale');
  pruefe((await eigenschaft('#kon-besuche', 'checked')) === false, 'Besuche ab Werk aus');
  await klick('#kon-tabtitel');
  await bis('tabtitel aus', async () => (await k()).tabtitel === false);
  await waehle('#kon-cursor', 'herz');
  await bis('cursor herz', async () => (await k()).cursor === 'herz');
  await klick('#kon-meldungen');
  await bis('meldungen aus', async () => (await k()).meldungen === false);
  await klick('#kon-besuche');
  await bis('besuche an', async () => (await k()).besuche === true);
  pruefe(true, '4 Schalter Session 10 gespeichert');
  await klick('#kon-zeit-neu');
  await bis('eine strenge Zeit', async () => (await k()).zeiten?.length === 1);
  await driver.executeScript(
    `const z = document.querySelector('#kon-zeiten .zeit-zeile'); const von = z.querySelector('.zeit-von'); von.value = '22:30';
     von.dispatchEvent(new Event('change', { bubbles: true })); von.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));`,
  );
  await bis('von 22:30', async () => (await k()).zeiten?.[0]?.von === 1350);
  await driver.executeScript(
    `const z = document.querySelector('#kon-zeiten .zeit-zeile'); for (const b of z.querySelectorAll('input[data-tag]')) { if (b.dataset.tag !== '3') { b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); } }`,
  );
  await bis('nur Mittwoch', async () => JSON.stringify((await k()).zeiten?.[0]?.tage) === '[3]');
  pruefe(true, 'strenge Zeit: Uhrzeit und Tage gespeichert');
  await klick('#kon-zeit-neu');
  await klick('#kon-zeit-neu');
  await bis('drei strenge Zeiten', async () => (await k()).zeiten?.length === 3);
  await bis('Knopf weg bei 3', async () => !(await sichtbar('#kon-zeit-neu')));
  pruefe(true, 'hoechstens 3 strenge Zeiten');
  await klick('#kon-zeiten .zeit-zeile .zeit-weg');
  await bis('zwei strenge Zeiten', async () => (await k()).zeiten?.length === 2);
  pruefe((await k()).zeiten.every((z) => z.von === 1260), 'Entfernen nimmt die richtige Zeile');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'spiraleWarnungGesehen']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: kontrolle-optionen.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
