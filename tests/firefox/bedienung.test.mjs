// Firefox: Phase 11 E4d2, die Bedienelemente der Einstellungsseite aus den Bausteinen (F1 bis F7): der Weg ueber die echte Seite und den echten Speicher
// (waehlen, Speicher lesen, neu laden), gemischter Stand ohne Antwort mit Hinweis, Zwischenwert ohne Stufe, Aenderung von aussen, Speicherfehler,
// Aufbau, Reiterwechsel, Aufklappen und Pfeiltasten schreiben nichts (F5), Tab-Halt (NN1), das "?" ueberdeckt nichts (F6), Fingerziel. Hilfsfunktionen
// wie reiter.test.mjs, stumm gestartet (media.volume_scale 0.0).
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REITER as REITERDATEN } from '../../entrypoints/options/reiter-daten.ts';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';
import { STANDARD } from '../../src/einstellungen.ts';
import { mitReitern, oeffneAuf, stufeKlick, chipKlick, markierteKarte, reglerCss } from './reiter-hilfe.mjs';

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


const text = async (css) => (await driver.executeScript(`return document.querySelector(arguments[0]).textContent.trim()`, css));
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const setze = (o) => imSeitenkontext(`await api.storage.local.set(args[0]);`, o);
const packMit = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const einst = async () => (await speicher('einstellungen')) ?? {};
const wdKlick = async (by) => (await driver.findElement(by)).click();
const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const imBlick = (css) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); if (!e || e.getClientRects().length === 0) return false; const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;`, css);
const gewaehlt = () => driver.executeScript(`return [...document.querySelectorAll('[role=tab][aria-selected=true]')].map((t) => t.textContent)`);
const tabKlick = (name) => wdKlick(By.xpath(`//*[@role='tab'][normalize-space(.)='${name}']`));

// Die Namen stehen nur in reiter-daten.ts (N11).
const REITER = REITERDATEN.map((r) => r.name);
const ID_REITER = Object.fromEntries(REITERDATEN.map((r) => [r.id, r.name]));

async function warteBereit() {
  await bis('Seite gezeichnet', async () => driver.executeScript(`return document.body.getAttribute('data-veil-ordnung') === 'bereit'`).catch(() => false));
}

// Horcher auf alle Aenderungen des Speichers in einer zweiten Erweiterungsseite (RM1): jedes Ereignis nennt Bereich, Schluessel, ob alt und neu gleich
// sind, die Zeit seit Beginn des Zaehlens und die offenen Tabs; ein roter Lauf gibt sie aus.
const HORCHER_START = `const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
  window.__t0 = Date.now(); window.__ereignisse = [];
  api.storage.onChanged.addListener((a, bereich) => {
    const e = { bereich, t: Date.now() - window.__t0, schluessel: Object.keys(a).map((k) => ({ k, gleich: JSON.stringify(a[k].oldValue) === JSON.stringify(a[k].newValue) })), tabs: null };
    window.__ereignisse.push(e);
    try { api.tabs.query({}).then((l) => { e.tabs = l.map((t) => String(t.url || '').replace(/^moz-extension:\\/\\/[^/]+\\//, '')); }, () => {}); } catch { /* ohne Tabs-API */ }
  });`;
const liesHorcher = () => driver.executeScript(`return window.__ereignisse`);
const zaehle = async (beschreibung, text) => {
  const e = await liesHorcher();
  pruefe(e.length === 0, `${beschreibung}${e.length ? ' ' + JSON.stringify(e) : ''}`);
};

const PACK_VOLL = packMit(['stil:mia-patch', 'erwachsen:vorschau', 'zensur:sticker', 'kontrolle:blitz', 'ton']);
const alleZonen = (an, bedeckt) =>
  Object.fromEntries(Object.keys(STANDARD.zonen).map((z) => [z, ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'].includes(z) ? { an, bedeckt } : { an }]));
const ZWISCHEN = { version: 1, schwelle: 0.1049, quiz: { verweigern: 0.123, freilegenMs: 7500 }, ton: { an: false, lautstaerke: 0.45 } };
const STAENDE = {
  Standard: {},
  'alle bedeckt': { version: 1, zonen: alleZonen(true, true) },
  'keine bedeckt': { version: 1, zonen: alleZonen(true, false) },
  'alle Zonen aus': { version: 1, zonen: alleZonen(false, true) },
  Zwischenwerte: ZWISCHEN,
};
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const STUFEN = [
  { wahl: 'stimmung-wahl', pfad: (e) => e.schwelle, zwischen: 0.1049, zahl: '0.1049', stufen: [['Very suspicious', 0.1], ['Suspicious', 0.15], ['Relaxed', 0.22]] },
  { wahl: 'verweigern-wahl', pfad: (e) => e.quiz.verweigern, zwischen: 0.123, zahl: '12.3%', stufen: [['Never', 0], ['Sometimes', 0.1], ['Often', 0.25]] },
  { wahl: 'freilegen-wahl', pfad: (e) => e.quiz.freilegenMs, zwischen: 7500, zahl: '7.5 s', stufen: [['Short', 5000], ['Medium', 10000], ['Long', 20000]] },
  { wahl: 'lautstaerke-wahl', pfad: (e) => e.ton.lautstaerke, zwischen: 0.45, zahl: '45%', stufen: [['Soft', 0.3], ['Medium', 0.6], ['Loud', 0.9]] },
];
const nah = (a, b) => Math.abs(a - b) < 1e-9;
const markiertText = (wahl) => markierteKarte(driver, wahl);

// Ein Pack im Speicher vor dem Laden raeumt die Seite weg (keine Pack-Datei dazu): `pack` wird nach dem Laden geschrieben.
async function seite(vorher, mitPack = false) {
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`);
  await setze({ einstieg: EINSTIEG_FERTIG, ...(vorher ? { einstellungen: vorher } : {}) });
  await driver.get(`moz-extension://${uuid}/options.html`);
  await driver.navigate().refresh();
  await warteBereit();
  await bis('Bausteine da', () => driver.executeScript(`return !!document.getElementById('zonen-wahl') && !!document.getElementById('stimmung-wahl')`));
  if (mitPack) await packDazu();
}
async function packDazu() {
  await setze({ pack: PACK_VOLL });
  await bis('Pack gelesen', async () => (await driver.executeScript(`return document.getElementById('erwachsen').dataset.zu`)) === '0');
}
const oeffneAlleAufklapper = () => driver.executeScript(`for (const k of document.querySelectorAll('.v-auf-kopf[aria-expanded=false]')) if (k.getClientRects().length > 0 || true) k.click();`);


let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  mitReitern(driver);
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);
  await oeffne('options.html');

  // `VEIL_BEDIENUNG_NUR=f5` fuehrt nur den Zaehler der Schreibereignisse (F5) aus (Mutationsbeleg, ohne dass ein frueherer Teil davor rot wird).
  if (process.env.VEIL_BEDIENUNG_NUR !== 'f5') {
  // ---- F1 und F2: Karten, Chips und Kleidungsfrage ueber die echte Seite, Speicher lesen, neu laden ----
  await seite(null);
  pruefe((await markiertText('zonen-wahl')).startsWith('Body') && !(await markiertText('zonen-wahl')).startsWith('Body and'), 'Standard: Karte Body markiert');
  pruefe((await text('#zonen-wahl .v-auf-stand')) === '3 of 10 on', 'Standard: 3 of 10 on');
  pruefe((await markiertText('kleidung-frage')) === null, 'F2: der gemischte Standard markiert keine Antwort');
  pruefe((await text('#kleidung-frage .v-hinweis')).includes('Genitals') && !(await text('#kleidung-frage .v-hinweis')).includes('Breasts'), 'F2: der Hinweis nennt genau Genitals');
  await stufeKlick(driver, 'zonen-wahl', 'Everything');
  await bis('alle zehn an', async () => Object.values((await einst()).zonen ?? {}).every((z) => z.an === true));
  pruefe((await einst()).zonen.genitals.bedeckt === true && (await einst()).zonen.breast.bedeckt === false, 'Karte Everything: bedeckt bleibt wie gespeichert');
  await driver.navigate().refresh();
  await warteBereit();
  pruefe((await markiertText('zonen-wahl')).includes('Everything') && (await text('#zonen-wahl .v-auf-stand')) === '10 of 10 on', 'nach dem Neuladen: Everything markiert');
  await chipKlick(driver, 'genitals');
  await bis('genitals aus', async () => (await einst()).zonen.genitals.an === false);
  pruefe((await einst()).zonen.genitals.bedeckt === true && (await einst()).zonen.breast.an === true, 'Chip Genitals: nur diese Zone aus, bedeckt bleibt');
  await driver.navigate().refresh();
  await warteBereit();
  pruefe((await markiertText('zonen-wahl')) === null, 'nach dem Neuladen: keine Karte markiert (neun von zehn an)');
  const anVorher = JSON.stringify(Object.values((await einst()).zonen).map((z) => z.an));
  await stufeKlick(driver, 'kleidung-frage', 'Under clothes too');
  await bis('alle bedeckt', async () => { const e = await einst(); return BEDECKBAR.every((z) => e.zonen?.[z]?.bedeckt === true); });
  pruefe(JSON.stringify(Object.values((await einst()).zonen).map((z) => z.an)) === anVorher, 'Antwort aendert kein an');
  await driver.navigate().refresh();
  await warteBereit();
  pruefe((await markiertText('kleidung-frage')).includes('Under clothes too') && !(await driver.executeScript(`return !!document.querySelector('#kleidung-frage .v-hinweis')`)), 'nach dem Neuladen: Under clothes too markiert, kein Hinweis');
  await stufeKlick(driver, 'kleidung-frage', 'Bare skin only');
  await bis('keine bedeckt', async () => { const e = await einst(); return BEDECKBAR.every((z) => e.zonen?.[z]?.bedeckt === false); });
  pruefe(true, 'F1 und F2: Karten, Chips und Kleidungsfrage ueber Seite und Speicher');
  // Aenderung von aussen: der Hinweis folgt dem Speicher
  await setze({ einstellungen: { version: 1, zonen: { ...STANDARD.zonen, breast: { an: true, bedeckt: true } } } });
  await bis('Hinweis folgt', async () => (await text('#kleidung-frage .v-hinweis')).includes('Breasts, Genitals'));
  await setze({ einstellungen: { version: 1, zonen: alleZonen(true, true) } });
  await bis('Antwort folgt', async () => ((await markiertText('kleidung-frage')) ?? '').includes('Under clothes too'));
  pruefe(true, 'F2: Aenderung von aussen zeichnet Hinweis und Antwort neu');

  // ---- F3: Zwischenwerte ----
  await seite(ZWISCHEN, true);
  pruefe((await text('#stimmung-wert')) === stimmungsWort(0.1049), 'Kopf: Wort ohne "(my default)" bei 0.1049');
  for (const s of STUFEN) {
    pruefe((await markiertText(s.wahl)) === null, `${s.wahl}: keine Stufe markiert`);
    pruefe((await driver.executeScript(`return document.querySelector('#' + arguments[0] + ' .v-aufklapper .v-auf-kopf').getAttribute('aria-expanded')`, s.wahl)) === 'true', `${s.wahl}: Exact value offen`);
    pruefe((await text(`#${s.wahl} .v-wert`)) === s.zahl, `${s.wahl}: Zahl genau (${s.zahl})`);
  }
  await warte(600);
  const e0 = await einst();
  pruefe(STUFEN.every((s) => nah(s.pfad(e0), s.zwischen)), 'Anzeigen schreibt nichts: Zwischenwerte unveraendert');
  for (const s of STUFEN) {
    const [name, wert] = s.stufen[2];
    await stufeKlick(driver, s.wahl, name);
    await bis(`${s.wahl} geschrieben`, async () => nah(s.pfad(await einst()), wert));
    pruefe((await markiertText(s.wahl)) === name, `${s.wahl}: Stufe ${name} markiert`);
  }
  pruefe(true, 'F3: Stufen schreiben ihren Wert');

  // ---- F3: Aenderung von aussen ----
  await setze({ einstellungen: { version: 1, schwelle: 0.22, quiz: { verweigern: 0, freilegenMs: 20000 }, ton: { an: false, lautstaerke: 0.3 }, zonen: alleZonen(true, true), erwachsen: { ...STANDARD.erwachsen, an: false, stufe: 'explicit' } } });
  await bis('Stimmung folgt', async () => (await markiertText('stimmung-wahl')) === 'Relaxed');
  pruefe((await text('#stimmung-wert')) === stimmungsWort(0.22), 'Kopf folgt dem Speicher');
  pruefe((await markiertText('verweigern-wahl')) === 'Never' && (await markiertText('freilegen-wahl')) === 'Long' && (await markiertText('lautstaerke-wahl')) === 'Soft', 'Aenderung von aussen zeichnet die Stufen neu');
  pruefe((await markiertText('erw-stufe-wahl')).includes('Off'), 'Aenderung von aussen: Gruppe der Erwachsenenseiten auf Off');

  // ---- F4: Off laesst die Stufe stehen ----
  await seite({ version: 1, erwachsen: { ...STANDARD.erwachsen, stufe: 'explicit', komplettErsatz: true, eigeneSeiten: ['a.example'] } }, true);
  pruefe((await markiertText('erw-stufe-wahl')).includes('Explicit'), 'F4: Explicit markiert');
  await stufeKlick(driver, 'erw-stufe-wahl', 'Off');
  await bis('an aus', async () => (await einst()).erwachsen.an === false);
  const eo = (await einst()).erwachsen;
  pruefe(eo.stufe === 'explicit' && eo.komplettErsatz === true && JSON.stringify(eo.eigeneSeiten) === '["a.example"]', 'F4: Off schreibt nur an: false, Stufe und Rest bleiben');
  await driver.navigate().refresh();
  await warteBereit();
  await packDazu();
  pruefe((await markiertText('erw-stufe-wahl')).includes('Off'), 'F4: nach dem Neuladen Off markiert');
  await stufeKlick(driver, 'erw-stufe-wahl', 'Tease');
  await bis('Tease', async () => (await einst()).erwachsen.an === true && (await einst()).erwachsen.stufe === 'tease');
  pruefe(true, 'F4: eine Stufe schreibt an: true und die Stufe');

  // ---- F5: Speicherfehler ----
  await seite(ZWISCHEN, true);
  const kaputt = (an) =>
    driver.executeScript(
      `const sl = (window.wrappedJSObject && window.wrappedJSObject.browser || window.browser).storage.local;
       if (!sl.__echtSet) sl.__echtSet = sl.set.bind(sl);
       const echt = sl.__echtSet;
       sl.set = (o) => (arguments[0] && 'einstellungen' in o ? Promise.reject(new Error('Test')) : echt(o));`,
      an,
    );
  const gespeichert = JSON.stringify(await einst());
  await kaputt(true);
  const fehlerBei = async (name, aktion, zurueck) => {
    await driver.executeScript(`const m = document.getElementById('speicher-meldung'); m.textContent = ''; m.hidden = true;`);
    await aktion();
    await bis(`Fehlersatz ${name}`, async () => (await sichtbar('#speicher-meldung')) && (await text('#speicher-meldung')) === FEHLER_SPEICHERN);
    await bis(`${name} zurueck`, zurueck);
  };
  await fehlerBei('Karte', () => stufeKlick(driver, 'zonen-wahl', 'Everything'), async () => (await text('#zonen-wahl .v-auf-stand')) === '3 of 10 on' && (await markiertText('zonen-wahl')).startsWith('Body'));
  await fehlerBei('Chip', () => chipKlick(driver, 'eyes'), async () => (await driver.executeScript(`return document.querySelector('#zonen-wahl .v-chip[data-zone=eyes]').getAttribute('aria-pressed')`)) === 'false');
  await fehlerBei('Kleidungsfrage', () => stufeKlick(driver, 'kleidung-frage', 'Under clothes too'), async () => (await markiertText('kleidung-frage')) === null);
  for (const s of STUFEN) await fehlerBei(s.wahl, () => stufeKlick(driver, s.wahl, s.stufen[0][0]), async () => (await markiertText(s.wahl)) === null && (await text(`#${s.wahl} .v-wert`)) === s.zahl);
  pruefe(JSON.stringify(await einst()) === gespeichert, 'F5: nichts gespeichert');
  await kaputt(false);

  // ---- K1 (E4k): nach einem gescheiterten Speichern und dem Zuruecksetzen meldet Firefox kein `change` fuer dieselbe Taste; der Baustein meldet selbst ----
  // Je Stufenwahl (alle vier): Taste links zweimal, Taste rechts zweimal bei gesperrtem Speicher: jede Taste genau ein Schreibversuch, danach steht der gespeicherte
  // Stand da (Regler, Stufe) und der Fehlersatz; dann gelingt eine Taste: Anzeige gleich Speicher, wieder genau ein Schreibversuch.
  const MITTE = { version: 1, schwelle: 0.15, quiz: { verweigern: 0.1, freilegenMs: 10000 }, ton: { an: false, lautstaerke: 0.6 } };
  for (const s of STUFEN) {
    await seite(MITTE, true);
    await oeffneAuf(driver, s.wahl);
    const css = reglerCss(s.wahl);
    const [mitteName, mitte] = s.stufen[1];
    const schritt = Number(await driver.executeScript(`return document.querySelector(arguments[0]).step`, css));
    await driver.executeScript(`
      const sl = (window.wrappedJSObject && window.wrappedJSObject.browser || window.browser).storage.local;
      if (!sl.__echtSet) sl.__echtSet = sl.set.bind(sl);
      const echt = sl.__echtSet; window.__k1 = 0; window.__k1kaputt = true;
      sl.set = (o) => { if ('einstellungen' in o) window.__k1++; return window.__k1kaputt && 'einstellungen' in o ? Promise.reject(new Error('Test')) : echt(o); };`);
    const regler = await driver.findElement(By.css(css));
    await driver.executeScript(`arguments[0].focus()`, regler);
    const reglerWert = async () => Number(await driver.executeScript(`return document.querySelector(arguments[0]).value`, css));
    const versuche = () => driver.executeScript(`return window.__k1`);
    for (const [taste, name] of [[Key.ARROW_LEFT, 'links'], [Key.ARROW_RIGHT, 'rechts']]) {
      for (let i = 1; i <= 2; i++) {
        await driver.executeScript(`const m = document.getElementById('speicher-meldung'); m.textContent = ''; m.hidden = true;`);
        const n0 = await versuche();
        await regler.sendKeys(taste);
        await bis(`${s.wahl} ${name} ${i}: Fehlersatz`, async () => (await sichtbar('#speicher-meldung')) && (await text('#speicher-meldung')) === FEHLER_SPEICHERN);
        await bis(`${s.wahl} ${name} ${i}: gespeicherter Stand`, async () => nah(await reglerWert(), mitte) && (await markiertText(s.wahl)) === mitteName);
        pruefe((await versuche()) === n0 + 1, `K1 ${s.wahl} Taste ${name} ${i}: genau ein Schreibversuch (waren ${(await versuche()) - n0})`);
      }
    }
    pruefe(nah(s.pfad(await einst()), mitte), `K1 ${s.wahl}: nach den gescheiterten Versuchen steht der gespeicherte Stand im Speicher`);
    await driver.executeScript(`window.__k1kaputt = false`);
    const n1 = await versuche();
    await regler.sendKeys(Key.ARROW_LEFT);
    await bis(`${s.wahl}: gelungen gespeichert`, async () => nah(s.pfad(await einst()), mitte - schritt));
    await warte(300);
    pruefe(nah(await reglerWert(), mitte - schritt) && (await versuche()) === n1 + 1, `K1 ${s.wahl}: gelungen, Anzeige gleich Speicher, ein Schreibversuch`);
  }
  pruefe(true, 'K1: vier Stufenwahlen, beide Richtungen');

  // ---- L1 (E4k Nachr.): kein Schreibversuch ohne Handlung am Regler, auch bei einem gespeicherten Zwischenwert ----
  const ZW_L1 = { version: 1, schwelle: 0.1051, quiz: { verweigern: 0.1051, freilegenMs: 10500 }, ton: { an: false, lautstaerke: 0.4051 } };
  for (const [name, mitPackL1] of [['ohne Pack', false], ['mit Pack nach dem Laden', true]]) {
    await seite(ZW_L1, mitPackL1);
    await driver.executeScript(`
      const sl = (window.wrappedJSObject && window.wrappedJSObject.browser || window.browser).storage.local;
      if (!sl.__echtSet) sl.__echtSet = sl.set.bind(sl);
      const echt = sl.__echtSet; window.__k1 = 0;
      sl.set = (o) => { window.__k1++; return echt(o); };`);
    const roh = JSON.stringify(await einst());
    let gemessenL1 = 0;
    for (const st of STUFEN) {
      const css = reglerCss(st.wahl);
      if (!(await driver.executeScript(`return !!document.querySelector(arguments[0])`, css))) continue;
      await oeffneAuf(driver, st.wahl);
      if (!(await driver.executeScript(`const r = document.querySelector(arguments[0]); return !!r && r.getClientRects().length > 0`, css))) continue; // ohne Pack sind drei der vier Abschnitte verborgen
      gemessenL1 += 1;
      const reg = await driver.findElement(By.css(css));
      await driver.executeScript(`arguments[0].focus()`, reg);
      for (const t of [Key.SHIFT, Key.CONTROL, 'a', Key.ESCAPE]) await reg.sendKeys(t);
      const pos = await driver.executeScript(`const r = arguments[0]; const b = r.getBoundingClientRect(); const a = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)); return [b.left + 8 + (b.width - 16) * a, b.top + b.height / 2];`, reg);
      await driver.executeScript(`arguments[0].scrollIntoView({ block: 'center' })`, reg);
      const pos2 = await driver.executeScript(`const r = arguments[0]; const b = r.getBoundingClientRect(); const a = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)); return [b.left + 8 + (b.width - 16) * a, b.top + b.height / 2];`, reg);
      void pos;
      await driver.actions({ async: true }).move({ x: Math.round(pos2[0]), y: Math.round(pos2[1]) }).press().release().perform();
      await driver.actions({ async: true }).sendKeys(Key.TAB).perform();
      await driver.executeScript(`arguments[0].focus()`, reg);
      await driver.actions({ async: true }).sendKeys(Key.chord(Key.SHIFT, Key.TAB)).perform();
      await driver.executeScript(`arguments[0].blur()`, reg);
    }
    await warte(500);
    pruefe(gemessenL1 >= (mitPackL1 ? 4 : 1), `L1 ${name}: gemessene Stufenwahlen ${gemessenL1}`);
    pruefe((await driver.executeScript('return window.__k1')) === 0, `L1 ${name}: null Schreibaufrufe ohne Handlung (waren ${await driver.executeScript('return window.__k1')})`);
    pruefe(JSON.stringify(await einst()) === roh, `L1 ${name}: der gespeicherte Wert bleibt Bit fuer Bit`);
  }

  // ---- G1: ohne Freischaltung bleibt `an` an UND aus schaltbar ----
  const EXPLICIT = { version: 1, erwachsen: { ...STANDARD.erwachsen, stufe: 'explicit' } };
  for (const [name, pack] of [['ohne Pack', null], ['Pack ohne erwachsen:vorschau', packMit(['erwachsen:quiz'])]]) {
    await seite(EXPLICIT);
    if (pack) {
      await setze({ pack });
      await bis('Pack gelesen', async () => (await driver.executeScript(`return document.getElementById('erwachsen').dataset.zu`)) === '0');
    }
    await tabKlick('Adult sites');
    // ohne Pack steht Adult sites zugeklappt ("Set them now"): wie die Person aufklappen
    await driver.executeScript(`for (let i = 0; i < 5; i++) { const k = [...document.querySelectorAll('.zu-knopf')].find((e) => !e.hidden && e.getClientRects().length > 0); if (!k) break; k.click(); }`);
    pruefe((await driver.executeScript(`return document.querySelectorAll('#erw-stufe-wahl [role=radio]').length`)) === 5, `G1 ${name}: fuenf Karten (Off, On, drei Stufen)`);
    pruefe((await markiertText('erw-stufe-wahl')).includes('On'), `G1 ${name}: gespeichertes an markiert On, keine Stufe`);
    pruefe((await driver.executeScript(`return [...document.querySelectorAll('#erw-stufe-wahl [role=radio]')].map((k) => k.disabled).join()`)) === 'false,false,true,true,true', `G1 ${name}: Off und On waehlbar, die drei Stufen gesperrt`);
    const vorher = JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`));
    // Klick (WebDriver kann ein gesperrtes Element nicht druecken: Fehler gilt als nichts geschrieben), Pfeile und Eingabe auf dem Fokus schreiben nichts
    try { await stufeKlick(driver, 'erw-stufe-wahl', 'Explicit'); } catch { /* gesperrt */ }
    await (await driver.findElement(By.xpath(`//*[@id='erw-stufe-wahl']//*[@role='radio'][./strong[normalize-space(.)='Off']]`))).sendKeys(Key.ARROW_RIGHT, Key.ARROW_RIGHT, Key.ARROW_RIGHT, Key.END, Key.HOME);
    const fokus = await driver.executeScript(`return document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id || '' : ''`);
    pruefe(fokus === 'off' || fokus === 'on', `G1 ${name}: der Fokus kommt nie auf eine gesperrte Stufe (${fokus})`);
    await warte(400);
    pruefe(JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`)) === vorher, `G1 ${name}: gesperrte Stufe, Pfeile schreiben nichts`);
    await stufeKlick(driver, 'erw-stufe-wahl', 'Off');
    await bis('Off', async () => (await einst()).erwachsen.an === false);
    pruefe((await einst()).erwachsen.stufe === 'explicit', `G1 ${name}: Off laesst explicit stehen`);
    await stufeKlick(driver, 'erw-stufe-wahl', 'On');
    await bis('On', async () => (await einst()).erwachsen.an === true);
    pruefe((await einst()).erwachsen.stufe === 'explicit' && (await markiertText('erw-stufe-wahl')).includes('On'), `G1 ${name}: On schreibt nur an, explicit bleibt`);
  }
  // Form wechselt bei offener Seite: nur gezeichnet, nie geschrieben
  await seite(EXPLICIT);
  await tabKlick('Adult sites');
  const vorForm = JSON.stringify(await einst());
  await setze({ pack: PACK_VOLL });
  await bis('Form mit Freischaltung', async () => (await driver.executeScript(`return document.querySelectorAll('#erw-stufe-wahl [role=radio]').length`)) === 4);
  pruefe((await markiertText('erw-stufe-wahl')).includes('Explicit'), 'G1: mit Freischaltung zeigt die Gruppe die gespeicherte Stufe');
  await imSeitenkontext(`await api.storage.local.remove('pack');`);
  await bis('Form ohne Freischaltung', async () => (await driver.executeScript(`return document.querySelectorAll('#erw-stufe-wahl [role=radio]').length`)) === 5);
  pruefe(JSON.stringify(await einst()) === vorForm, 'G1: der Wechsel der Form schreibt nichts');

  // ---- G2: ein Regler, der den Fokus verliert, zeigt den gespeicherten Stand ----
  await seite(ZWISCHEN, true);
  for (const s of STUFEN) {
    const [name, wert] = s.stufen[0];
    const css = reglerCss(s.wahl);
    await driver.executeScript(`document.querySelector(arguments[0]).focus()`, css);
    const schluessel = s.wahl === 'stimmung-wahl' ? ['schwelle'] : s.wahl === 'lautstaerke-wahl' ? ['ton', 'lautstaerke'] : ['quiz', s.wahl === 'verweigern-wahl' ? 'verweigern' : 'freilegenMs'];
    const e = JSON.parse(JSON.stringify(await einst()));
    let ziel = e;
    for (const k of schluessel.slice(0, -1)) ziel = ziel[k];
    ziel[schluessel.at(-1)] = wert;
    await setze({ einstellungen: e });
    await warte(300);
    await driver.executeScript(`document.querySelector(arguments[0]).blur()`, css);
    await bis(`${s.wahl} zeigt den gespeicherten Stand`, async () => (await markiertText(s.wahl)) === name && nah(Number(await driver.executeScript(`return document.querySelector(arguments[0]).value`, css)), wert));
  }
  pruefe(true, 'G2: nach dem Verlassen zeigt jede der vier Stufenwahlen den gespeicherten Stand');

  // ---- G3: eine verworfene Zonen-Handlung zeigt einen Hinweis, kein zweiter Versuch ----
  await seite(null);
  await oeffneAuf(driver, 'zonen-wahl');
  await driver.executeScript(
    `const b = window.wrappedJSObject && window.wrappedJSObject.browser || window.browser;
     b.storage.local.set({ einstellungen: arguments[0] });
     document.querySelector('#zonen-wahl .v-chip[data-zone=eyes]').click();`,
    { version: 1, zonen: alleZonen(true, true) },
  );
  await bis('Hinweis', () => sichtbar('#zonen-verworfen'));
  await warte(400);
  const zg = (await einst()).zonen;
  pruefe(Object.entries(alleZonen(true, true)).every(([k, v]) => JSON.stringify(zg[k]) === JSON.stringify(v)), 'G3: die verworfene Handlung schreibt nichts, kein zweiter Versuch');
  pruefe((await markiertText('zonen-wahl')).includes('Everything') && (await text('#zonen-wahl .v-auf-stand')) === '10 of 10 on', 'G3: der gespeicherte Stand wird angezeigt');
  await chipKlick(driver, 'mouth');
  await bis('Hinweis weg', async () => !(await sichtbar('#zonen-verworfen')));
  pruefe(true, 'G3: die naechste Handlung nimmt den Hinweis weg');

  // ---- NN1: Tab-Halt ----
  await seite(null, true);
  const halt = (wahl) => driver.executeScript(`return [...document.querySelectorAll('#' + arguments[0] + ' [role=radio]')].map((k) => k.tabIndex)`, wahl);
  pruefe(JSON.stringify(await halt('erw-stufe-wahl')) === '[-1,-1,0,-1]', 'NN1: Halt auf Hot');
  await (await driver.findElement(By.xpath(`//*[@id='erw-stufe-wahl']//*[@role='radio'][./strong[normalize-space(.)='Hot']]`))).sendKeys(Key.ARROW_RIGHT);
  pruefe(JSON.stringify(await halt('erw-stufe-wahl')) === '[-1,-1,-1,0]', 'NN1: Halt wandert mit dem Fokus');
  pruefe((await markiertText('erw-stufe-wahl')).includes('Hot') && (await speicher('einstellungen')) === null, 'NN1: ein Pfeil waehlt nichts und schreibt nichts');
  // der Fokus verlaesst die Gruppe
  await driver.executeScript(`document.getElementById('erw-ersatz').focus()`);
  await bis('Halt zurueck', async () => JSON.stringify(await halt('erw-stufe-wahl')) === '[-1,-1,0,-1]');
  pruefe(true, 'NN1: nach dem Verlassen wieder auf der gewaehlten Stufe');
  await tabKlick('What I cover');
  pruefe(JSON.stringify(await halt('kleidung-frage')) === '[0,-1]', 'NN1: keine gewaehlt, Halt auf der ersten');
  await (await driver.findElement(By.css('#kleidung-frage [role=radio]'))).sendKeys(Key.ARROW_RIGHT);
  pruefe(JSON.stringify(await halt('kleidung-frage')) === '[-1,0]', 'NN1: Halt wandert mit dem Fokus');
  await driver.executeScript(`document.getElementById('strict').focus()`);
  await bis('Halt zurueck (Frage)', async () => JSON.stringify(await halt('kleidung-frage')) === '[0,-1]');
  pruefe((await markiertText('kleidung-frage')) === null, 'NN1: ein Pfeil hat nichts gewaehlt');

  // ---- F6: das "?" ueberdeckt nichts Bedienbares ----
  for (const name of REITER) {
    await tabKlick(name);
    await driver.executeScript(`for (let i = 0; i < 30; i++) { const k = document.querySelector('[role=tabpanel]:not([hidden]) .v-frage[aria-expanded=false], [role=tabpanel]:not([hidden]) .v-auf-kopf[aria-expanded=false]'); if (!k) break; k.click(); }`);
    const m = await driver.executeScript(`
      const BEDIENBAR = 'button, input, select, textarea, a[href], [role=radio], [role=switch], [role=tab], [tabindex]:not([tabindex="-1"])';
      const fehler = []; let n = 0;
      for (const f of document.querySelectorAll('[role=tabpanel]:not([hidden]) .v-frage')) {
        n += 1; f.scrollIntoView({ block: 'center' });
        const r = f.getBoundingClientRect();
        if (r.width < 43.5 || r.height < 43.5) fehler.push('klein ' + r.width + 'x' + r.height);
        for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) {
          const st = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy);
          const ich = st.findIndex((e) => e === f || f.contains(e));
          if (ich !== 0) fehler.push('liegt nicht oben bei ' + fx + ',' + fy);
          for (const e of st.slice(ich + 1)) if (e.matches(BEDIENBAR) && !e.contains(f)) fehler.push('ueberdeckt ' + e.tagName + '.' + e.className);
        }
      }
      return { n, fehler };`);
    pruefe(m.fehler.length === 0, `F6: "?" im Reiter ${name}: ${JSON.stringify(m)}`);
  }

  // ---- Fingerziel 44 px bei 1280 und in jedem Reiter ----
  await seite(ZWISCHEN, true);
  let gemessen = 0;
  for (const name of REITER) {
    await tabKlick(name);
    await driver.executeScript(`for (let i = 0; i < 30; i++) { const k = document.querySelector('[role=tabpanel]:not([hidden]) .v-auf-kopf[aria-expanded=false]'); if (!k) break; k.click(); }`);
    const kl = await driver.executeScript(`return [...document.querySelectorAll('[role=tabpanel]:not([hidden]) :is(.v-stufe, .v-wahl-karte, .v-chip, .v-frage, .v-auf-kopf, .v-regler-eingabe)')].filter((e) => e.getClientRects().length > 0).map((e) => { const b = e.getBoundingClientRect(); return { k: e.className, b: Math.round(b.width), h: Math.round(b.height) }; })`);
    gemessen += kl.length;
    pruefe(kl.every((k) => k.b >= 44 && k.h >= 44), `Fingerziel im Reiter ${name}: ${JSON.stringify(kl.filter((k) => k.b < 44 || k.h < 44))}`);
  }
  pruefe(gemessen >= 30, `Fingerziel: ${gemessen} Elemente gemessen`);
  // 360 px im Iframe (Firefox-Fenster werden nicht so schmal), jeder Reiter
  const m360 = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const f = document.createElement('iframe');
     f.style.cssText = 'width:360px;height:800px;position:fixed;left:0;top:0;border:0';
     f.src = location.href;
     f.onload = () => setTimeout(() => { const d = f.contentDocument; const kl = []; let breite = 0;
       for (const t of d.querySelectorAll('[role=tab]')) { t.click(); breite = Math.max(breite, d.documentElement.scrollWidth);
         for (const k of d.querySelectorAll('.v-auf-kopf[aria-expanded=false]')) k.click();
         for (const e of d.querySelectorAll('[role=tabpanel]:not([hidden]) :is(.v-stufe, .v-wahl-karte, .v-chip, .v-frage, .v-auf-kopf, .v-regler-eingabe)')) if (e.getClientRects().length > 0) { const b = e.getBoundingClientRect(); kl.push({ b: Math.round(b.width), h: Math.round(b.height) }); } }
       fertig({ kl, breite, fenster: d.documentElement.clientWidth }); }, 900);
     document.body.append(f);`,
  );
  console.log(`firefox: 360 px Fingerziele ${m360.kl.length} Elemente, Seite ${m360.breite}/${m360.fenster}`);
  pruefe(m360.kl.length >= 20 && m360.kl.every((k) => k.b >= 44 && k.h >= 44) && m360.breite <= m360.fenster, 'Fingerziel 44 px bei 360 px in jedem Reiter, kein Ueberlauf');

  }
  // ---- F5: Aufbau, Reiterwechsel, Aufklappen und Pfeiltasten schreiben nichts (Zaehler schon vor dem Laden) ----
  for (const [name, vorher] of Object.entries(STAENDE)) {
    await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`);
    await setze({ einstieg: EINSTIEG_FERTIG, ...(Object.keys(vorher).length ? { einstellungen: vorher } : {}) });
    const horcher = await oeffne('hilfe.html');
    await bis('Hilfeseite geladen', async () => (await driver.executeScript(`return location.protocol === 'moz-extension:' && document.readyState === 'complete'`).catch(() => false)) === true);
    await driver.executeScript(HORCHER_START);
    for (const h of await driver.getAllWindowHandles()) {
      if (h === horcher) continue;
      await driver.switchTo().window(h);
      await driver.close();
    }
    await driver.switchTo().window(horcher);
    for (let still = Date.now(), beginn = Date.now(), n = 0; Date.now() - still < 1000; ) {
      if (Date.now() - beginn > 30000) throw new Error(`keine Ruhe im Speicher nach 30 s: ${JSON.stringify(await liesHorcher())}`);
      const jetzt = (await liesHorcher()).length;
      if (jetzt !== n) {
        n = jetzt;
        still = Date.now();
      }
      await warte(100);
    }
    await driver.executeScript(`window.__t0 = Date.now(); window.__ereignisse = [];`);
    const vorherSpeicher = JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`));
    await oeffne('options.html');
    await warteBereit();
    await warte(600);
    const optionenTab = await driver.getWindowHandle();
    await driver.switchTo().window(horcher);
    await zaehle(`${name}: keine Schreibereignisse beim Oeffnen (Zaehler schon vor dem Laden)`);
    await driver.switchTo().window(optionenTab);
    pruefe(JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`)) === vorherSpeicher, `${name}: Speicher nach dem Oeffnen gleich`);
    // Pack dazu (Schreiben des Tests), dann Zaehler nullen und alle Reiter, Aufklapper und Pfeiltasten
    await setze({ pack: PACK_VOLL });
    await bis('Pack gelesen', async () => (await driver.executeScript(`return document.getElementById('erwachsen').dataset.zu`)) === '0');
    await warte(300);
    const mitPackSpeicher = JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`));
    await driver.switchTo().window(horcher);
    await driver.executeScript(`window.__t0 = Date.now(); window.__ereignisse = [];`);
    await driver.switchTo().window(optionenTab);
    for (const r of REITER) {
      await tabKlick(r);
      await driver.executeScript(`for (let i = 0; i < 30; i++) { const k = document.querySelector('[role=tabpanel]:not([hidden]) .v-auf-kopf[aria-expanded=false]'); if (!k) break; k.click(); }`);
      for (const g of await driver.findElements(By.css('[role=tabpanel]:not([hidden]) .v-baustein [role=radiogroup]'))) {
        const erster = await g.findElement(By.css('[role=radio]:not(:disabled)'));
        await erster.sendKeys(Key.ARROW_RIGHT, Key.ARROW_RIGHT, Key.END, Key.ARROW_LEFT, Key.HOME, Key.ARROW_DOWN, Key.ARROW_UP);
      }
    }
    await warte(600);
    pruefe(JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`)) === mitPackSpeicher, `${name}: Speicher nach Reiterwechsel, Aufklappen und Pfeiltasten gleich`);
    await driver.switchTo().window(horcher);
    await zaehle(`${name}: keine Schreibereignisse bei Reiterwechsel, Aufklappen und Pfeiltasten`);
    await driver.close();
    await driver.switchTo().window(optionenTab); // bleibt offen, bis der naechste Durchlauf alle anderen Tabs schliesst
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: bedienung.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
