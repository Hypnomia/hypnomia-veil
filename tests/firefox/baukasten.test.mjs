// Firefox: Oberflaeche des Custom-Baukastens und Schau gesperrter Stile (Phase 11 E6b, S1 bis S6) ueber geckodriver/WebDriver, die echte Erweiterung, echte Klicks und Tasten.
// S1 Karte, Zeilen, Speichern, Vorschau, Face folgt Zonenwahl und Eye bar in beide Richtungen, Words nicht bedienbar; S2 ohne Pack: Schau (Speicher davor gleich danach, kein Radio
// wechselt, Marke in drei Groessen, kein Pixel des Beispielbilds im Gesicht, jedes Ende); S3 mit Pack: keine Sperre, keine Schau; S4 Handy 320, 360, 412 (Rahmen der Breite,
// weil Firefox-Fenster nicht schmal werden); S5 Interview; S6 Tastatur und Namen. Der Pack-Stand kommt als Kurzfassung in den Speicher (wie bei den Interview-Tests):
// die Sperre haengt nur an den Freischaltungen. Firefox stumm.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mitReitern } from './reiter-hilfe.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 600 s ueberschritten');
  process.exit(1);
}, 600_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();
const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:test:firefox)`);
  process.exit(1);
}
const MIT_BILDERN = ['vorn', 'hinten', 'sitzend', 'portraet'].length > 0 && existsSync(path.join(ausgabe, 'firefox-mv3', 'beispiel', 'portraet.webp'));
const TREFFER = JSON.parse(readFileSync(path.join(wurzel, 'data/beispiel-treffer.json'), 'utf8'));

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const fehler = [];
function pruefe(bedingung, text) {
  if (bedingung) ok++;
  else {
    fehler.push(text);
    console.error(`firefox: ROT  ${text}`);
  }
}
let driver;
const js = (code, ...a) => driver.executeScript(code, ...a);
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
const versuche = (fn) => fn().then(() => true, () => false);

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

// Code im Seitenkontext mit `api` (browser-Objekt); der Rueckgabewert muss JSON-tauglich sein.
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
const speicher = (k) => imSeitenkontext(`const r = await api.storage.local.get(args[0]); return JSON.parse(JSON.stringify(r[args[0]] ?? null));`, k);
const alles = () => imSeitenkontext(`return JSON.parse(JSON.stringify(await api.storage.local.get(null)));`);
const setze = (o) => imSeitenkontext(`await api.storage.local.set(args[0]); return true;`, o);
const entferne = (k) => imSeitenkontext(`await api.storage.local.remove(args[0]); return true;`, k);
const einst = () => speicher('einstellungen');

const FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 };
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
const zonen = (an) => Object.fromEntries(ALLE.map((n) => [n, BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) }]));
const KOERPER = ['breast', 'genitals', 'buttocks'];

// Frischer Stand: Einstieg fertig, Einstellungen nach Wunsch; ohne Pack (das Pack wird entfernt) oder mit dem importierten (`mitPack`), Seite neu laden.
async function stand(e, mitPack = false) {
  for (let versuch = 0; versuch < 4; versuch++) {
    await setze({ einstieg: FERTIG });
    await entferne(mitPack ? ['einstellungen'] : ['einstellungen', 'pack']);
    if (e) await setze({ einstellungen: { version: 1, ...e } });
    await driver.navigate().refresh();
    await bis('Seite bereit', async () => js(`return !!document.querySelector('#preset-karten input')`));
    await oeffneReiter('Cover style');
    await warte(300);
    // ein spaetes Ereignis des Hintergrunds (zum Beispiel nach dem Entfernen eines Packs) darf den Stand nicht ueberschreiben
    if (!e || (await einst())?.preset === e.preset) return;
  }
  throw new Error('Stand liess sich nicht setzen');
}
// Das Pack ueber die Oberflaeche entfernen (der Speicher allein reicht nicht: die Ablage haelt das Pack).
async function entfernePack() {
  if (!(await speicher('pack'))) return;
  const aus = await driver.findElement(By.css('#entfernen'));
  await js(`arguments[0].scrollIntoView({ block: 'center' })`, aus);
  await aus.click();
  const ja = await driver.findElement(By.css('#entfernen-ja'));
  await js(`arguments[0].scrollIntoView({ block: 'center' })`, ja);
  await ja.click();
  await bis('Pack entfernt', async () => (await speicher('pack')) === null);
  await warte(300);
}
// Das Pruefer-Pack (Dummy mit Patch-Bildern und Stickern) ueber die Oberflaeche importieren, wie eine Person es tut.
async function importierePack(neuLaden = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'veil-baukasten-'));
  const datei = path.join(dir, 'dummy.miapack');
  writeFileSync(datei, (await baueDummyPack()).bytes);
  if (neuLaden) await driver.navigate().refresh();
  await bis('Seite bereit', async () => js(`return !!document.querySelector('#datei')`));
  await driver.findElement(By.css('#datei')).sendKeys(datei);
  await bis('Lizenz-Block', async () => sichtbar('#lizenz-block'));
  const annehmen = await driver.findElement(By.css('#annehmen'));
  await js(`arguments[0].scrollIntoView({ block: 'center' })`, annehmen);
  await annehmen.click();
  await bis('Pack importiert', async () => (await speicher('pack'))?.freischaltungen?.includes('zensur:sticker'));
  await warte(500);
}
const haken = () => js(`const t = document.querySelector('[data-veil-vorschau]')?.getAttribute('data-veil-vorschau'); return t ? JSON.parse(t) : null;`);
const vorschauRuht = () => bis('Vorschau fertig', async () => { const h = await haken(); return h && h.angefordert && h.gezeigt === h.angefordert ? h : null; }, 60_000);
const kartenFeld = (id) => driver.findElement(By.css(`#preset-${id}`));
// Eine Person tippt die Karte (das Label); das Radio selbst ist unsichtbar.
const tippeKarte = async (id) => {
  const label = await js(`return document.getElementById('preset-' + arguments[0]).closest('label')`, id);
  await js(`arguments[0].scrollIntoView({ block: 'center' })`, label);
  await label.click();
};
const schauKnopf = (id) => js(`return document.getElementById('preset-' + arguments[0]).closest('.preset-huelle').querySelector('.preset-schau')`, id);
const bausteinKnopf = (zeile, wert) => js(`return document.querySelector('#baukasten-' + arguments[0] + ' .v-bk-knopf[data-id="' + arguments[1] + '"]')`, zeile, wert);
const bausteinSchau = (zeile, wert) => js(`return document.querySelector('#baukasten-' + arguments[0] + ' .v-bk-schau[data-schau="' + arguments[1] + '"]')`, zeile, wert);
const tippe = async (el) => {
  await js(`arguments[0].scrollIntoView({ block: 'center' })`, el);
  await el.click();
};
const gewaehlt = (zeile) => js(`const e = document.querySelector('#baukasten-' + arguments[0] + ' .v-bk-knopf[aria-checked="true"]'); return e ? e.dataset.id : null`, zeile);
const sichtbar = (css) => js(`const e = document.querySelector(arguments[0]); if (!e) return false; const r = e.getClientRects(); return r.length > 0 && getComputedStyle(e).visibility !== 'hidden';`, css);
const text = (css) => js(`const e = document.querySelector(arguments[0]); return e ? e.textContent : null`, css);
// Zaehlt die Schreibaufrufe der Seite auf `einstellungen`.
const zaehlerAn = () =>
  js(`const W = window.wrappedJSObject || window; const sl = (W.browser || window.browser).storage.local; if (!sl.__zaehlt) { const echt = sl.set.bind(sl); sl.__zaehlt = true; sl.set = (o, ...r) => { if (o && o.einstellungen) W.__sets = (W.__sets || 0) + 1; return echt(o, ...r); }; } W.__sets = 0; return true;`);
const schreibaufrufe = () => js(`return (window.wrappedJSObject || window).__sets`);

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  mitReitern(driver);
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 120_000 });
  await driver.manage().window().setRect({ width: 1400, height: 1500 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await oeffne('options.html');
  await bis('Seite bereit', async () => js(`return !!document.querySelector('#preset-karten input')`));

  // ======================= S1: Karte, Zeilen, Speichern, Vorschau =======================
  await stand(null);
  pruefe((await js(`return document.querySelectorAll('input[name="preset"]').length`)) === 13, 'S1: eine Radiogruppe mit 13 Karten (12 und Custom)');
  pruefe((await text('#preset-gruppe-custom')) === 'Your own mix', 'S1: Gruppe "Your own mix"');
  pruefe((await js(`return document.querySelector('#preset-custom').closest('label').textContent.trim()`)) === 'Custom', 'S1: Karte "Custom"');
  pruefe((await js(`return !!document.querySelector('#preset-gruppe-custom').closest('#preset-karten')`)) && (await js(`const g = [...document.querySelectorAll('#preset-karten .preset-gruppe-titel')]; return g.at(-1).id === 'preset-gruppe-custom' && g.at(-2).id === 'preset-gruppe-person'`)), 'S1: die Gruppe steht unter "Whole person"');
  // ohne Custom: die Zeilen sind nicht sichtbar und nicht im Tastaturweg
  pruefe(!(await sichtbar('#preset-custom-ort')), 'S1: ohne Custom sind die drei Zeilen nicht sichtbar');
  pruefe((await js(`return [...document.querySelectorAll('#preset-custom-ort button, #preset-custom-ort [tabindex]')].filter((e) => e.getClientRects().length > 0).length`)) === 0, 'S1: ohne Custom nichts davon im Tastaturweg');
  pruefe((await js(`return !!document.getElementById('preset-mosaik').checked`)) === true, 'S1: Mosaic ist gewaehlt');
  await zaehlerAn();
  await tippeKarte('custom');
  await bis('Custom gespeichert', async () => (await einst())?.preset === 'custom');
  let e = await einst();
  pruefe(gleich(e.custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false }), `S1: Custom speichert preset custom mit der vorhandenen Mischung (${JSON.stringify(e.custom)})`);
  pruefe((await schreibaufrufe()) === 1, `S1: Custom waehlen schreibt genau einmal (${await schreibaufrufe()})`);
  pruefe(await sichtbar('#preset-custom-ort'), 'S1: Custom gewaehlt: die Zeilen stehen direkt unter der Karte');
  pruefe((await js(`return document.getElementById('preset-custom').checked`)) === true, 'S1: Custom ist angehakt');
  pruefe((await js(`return [...document.querySelectorAll('input[name="preset"]')].filter((f) => f.checked).length`)) === 1, 'S1: genau eine Karte angehakt');
  pruefe((await js(`const o = document.getElementById('preset-custom-ort'); const h = document.getElementById('preset-karten'); return o.previousElementSibling === h && !!h.querySelector('#preset-gruppe-custom') && h.lastElementChild.querySelector('#preset-custom') !== null`)), 'S1: die Zeilen stehen direkt unter der Gruppe mit der Karte Custom (der letzten)');
  pruefe((await text('#stil-hinweis')) === 'You pick the face, the rest and the words. I do it your way.', `S1: der Satz unter der Wahl (${await text('#stil-hinweis')})`);
  pruefe((await text('#baukasten-face .v-titeltext')) === 'Face' && (await text('#baukasten-flaeche .v-titeltext')) === 'Everything else' && (await text('#baukasten-woerter .v-titeltext')) === 'Words', 'S1: die drei Zeilen heissen Face, Everything else, Words');
  pruefe(gleich(await js(`return [...document.querySelectorAll('#baukasten-face .v-bk-knopf')].map((b) => b.textContent)`), ['Nothing', 'Bar', 'My face', 'Sticker', 'Mosaic', 'Blur', 'Black']), 'S1: sieben Knoepfe in der Zeile Face');
  pruefe(gleich(await js(`return [...document.querySelectorAll('#baukasten-flaeche .v-bk-knopf')].map((b) => b.textContent)`), ['Black', 'Mosaic', 'Blur', 'Stickers']), 'S1: vier Knoepfe in "Everything else"');
  await vorschauRuht();
  const h0 = await haken();
  pruefe(h0.stil === 'custom:mosaik:mosaik:-', `S1: die Vorschau zeigt Custom (${h0.stil})`);
  // Karten-Bild folgt der Mischung
  const bild0 = await js(`return document.getElementById('preset-custom').closest('label').querySelector('.preset-bild').innerHTML`);

  // Face aus (Standard): die Zeile Face zeigt "Nothing" mit dem Hinweis
  pruefe((await gewaehlt('face')) === 'nothing', `S1: Face aus und Eye bar aus zeigt Nothing (${await gewaehlt('face')})`);
  pruefe((await text('#baukasten-face .v-hinweis')) === 'Faces stay open. Face is off in your zones.', 'S1: Hinweis zu Nothing');

  // Jeder Baustein speichert (je Tipp ein Schreiben) und aendert die Vorschau; ohne Pack nur die freien
  const folge = [
    ['face', 'bar', (x) => x.zonen.face.an === false && x.augenbalken === true],
    ['face', 'nothing', (x) => x.zonen.face.an === false && x.augenbalken === false],
    ['face', 'schwarz', (x) => x.zonen.face.an === true && x.custom.gesicht === 'schwarz'],
    ['face', 'blur', (x) => x.custom.gesicht === 'blur'],
    ['face', 'mosaik', (x) => x.custom.gesicht === 'mosaik'],
    ['flaeche', 'schwarz', (x) => x.custom.flaeche === 'schwarz'],
    ['flaeche', 'blur', (x) => x.custom.flaeche === 'blur'],
    ['flaeche', 'mosaik', (x) => x.custom.flaeche === 'mosaik'],
  ];
  for (const [zeile, wert, soll] of folge) {
    const vorherStil = (await haken()).stil;
    const vorherZahl = await schreibaufrufe();
    await tippe(await bausteinKnopf(zeile, wert));
    await bis(`${zeile} ${wert} gespeichert`, async () => soll(await einst()));
    pruefe((await schreibaufrufe()) === vorherZahl + 1, `S1: ${zeile} ${wert}: genau ein Schreiben (${(await schreibaufrufe()) - vorherZahl})`);
    pruefe((await gewaehlt(zeile)) === wert, `S1: ${zeile} ${wert}: die Zeile zeigt die Wahl (${await gewaehlt(zeile)})`);
    const neuStil = (await vorschauRuht()).stil;
    const c = (await einst()).custom;
    pruefe(neuStil === `custom:${c.gesicht}:${c.flaeche}:${c.woerter ? 'w' : '-'}`, `S1: ${zeile} ${wert}: die Vorschau zeigt die Mischung (${neuStil})`);
    if (!(zeile === 'face' && (wert === 'bar' || wert === 'nothing'))) pruefe(vorherStil !== neuStil, `S1: ${zeile} ${wert}: die Vorschau folgt (${vorherStil} bleibt)`);
  }
  // Wahl zweimal: keine Aenderung im Speicher
  const vorZweit = JSON.stringify(await einst());
  await tippe(await bausteinKnopf('flaeche', 'mosaik'));
  await warte(400);
  pruefe(JSON.stringify(await einst()) === vorZweit, 'S1: dieselbe Wahl zweimal aendert nichts');
  // Words: schreibt, die Vorschau zeigt das Wort (Stil mit Wort)
  await tippe(await bausteinKnopf('face', 'mosaik'));
  await tippe(await js(`return document.querySelector('#baukasten-woerter .v-schalter-knopf')`));
  await bis('Words gespeichert', async () => (await einst()).custom.woerter === true);
  pruefe((await vorschauRuht()).stil === 'custom:mosaik:mosaik:w', 'S1: Words an: die Vorschau folgt');
  pruefe((await js(`return document.querySelector('#baukasten-woerter .v-schalter-knopf').getAttribute('aria-checked')`)) === 'true', 'S1: Words zeigt an');
  pruefe((await js(`return !document.getElementById('wort-themen').hidden || document.getElementById('wort-ohne-pack').hidden === false`)), 'S1: die Themen-Chips oder der Satz "ohne Pack" erscheinen wie bei den Presets');
  // das Kartenbild folgt
  const bild1 = await js(`return document.getElementById('preset-custom').closest('label').querySelector('.preset-bild').innerHTML`);
  await tippe(await bausteinKnopf('flaeche', 'blur'));
  await bis('blur', async () => (await einst()).custom.flaeche === 'blur');
  const bild2 = await js(`return document.getElementById('preset-custom').closest('label').querySelector('.preset-bild').innerHTML`);
  pruefe(bild0 !== bild1 || bild1 !== bild2, 'S1: das Kartenbild von Custom folgt jeder Aenderung');
  pruefe(bild1 !== bild2, 'S1: Blur an der Flaeche aendert das Kartenbild');

  // Zeile Face und Zonenwahl und Eye bar folgen einander in beide Richtungen
  await setze({ einstellungen: { ...(await einst()), zonen: zonen(['face']), augenbalken: false, custom: { gesicht: 'blur', flaeche: 'blur', woerter: false } } });
  await bis('Face an: Zeile zeigt Blur', async () => (await gewaehlt('face')) === 'blur');
  // Zonenwahl -> Zeile: "Body" schaltet Face aus
  await oeffneReiter('What I cover');
  await tippe(await driver.findElement(By.css('#zonen-wahl [data-id="koerper"]')));
  await bis('Face aus nach Body', async () => (await einst()).zonen.face.an === false);
  await oeffneReiter('Cover style');
  pruefe((await gewaehlt('face')) === 'nothing', `S1: Zonenwahl Body: Face aus, Zeile zeigt Nothing (${await gewaehlt('face')})`);
  await oeffneReiter('What I cover');
  await tippe(await driver.findElement(By.css('#zonen-wahl [data-id="koerper-gesicht"]')));
  await bis('Face an nach Body and face', async () => (await einst()).zonen.face.an === true);
  await oeffneReiter('Cover style');
  pruefe((await gewaehlt('face')) === 'blur', `S1: Zonenwahl Body and face: Face an, Zeile zeigt den Baustein (${await gewaehlt('face')})`);
  // Eye bar (Schalter) -> Zeile
  await tippe(await tippeSchalterLabel());
  async function tippeSchalterLabel() {
    return js(`return document.getElementById('augenbalken-zeile')`);
  }
  await bis('Eye bar an', async () => (await einst()).augenbalken === true);
  pruefe((await gewaehlt('face')) === 'blur', 'S1: Eye bar an bei Face an: die Zeile zeigt weiter den Baustein');
  // Zeile -> Zonenwahl und Eye bar: "Bar" schaltet Face aus und Eye bar an, "Nothing" Face aus und Eye bar aus
  await tippe(await bausteinKnopf('face', 'bar'));
  await bis('Bar', async () => { const x = await einst(); return x.zonen.face.an === false && x.augenbalken === true; });
  pruefe((await js(`return document.getElementById('augenbalken').checked`)) === true, 'S1: Bar: der Schalter Eye bar steht an');
  pruefe((await text('#baukasten-face .v-hinweis')) === 'Just a black bar over the eyes. The rest of the face stays open.', 'S1: Hinweis zu Bar');
  await oeffneReiter('What I cover');
  pruefe((await js(`return document.querySelector('#zonen-wahl [data-id="koerper"]').getAttribute('aria-checked')`)) === 'true', 'S1: Bar: die Zonenwahl zeigt Body (Face aus)');
  await oeffneReiter('Cover style');
  await tippe(await bausteinKnopf('face', 'nothing'));
  await bis('Nothing', async () => { const x = await einst(); return x.zonen.face.an === false && x.augenbalken === false; });
  pruefe((await js(`return document.getElementById('augenbalken').checked`)) === false, 'S1: Nothing: der Schalter Eye bar steht aus');
  // Eye bar -> Zeile (Face aus): Bar
  await tippe(await tippeSchalterLabel());
  await bis('Eye bar an (2)', async () => (await einst()).augenbalken === true);
  pruefe((await gewaehlt('face')) === 'bar', 'S1: Eye bar an bei Face aus: die Zeile zeigt Bar');
  await tippe(await tippeSchalterLabel());
  await bis('Eye bar aus', async () => (await einst()).augenbalken === false);
  pruefe((await gewaehlt('face')) === 'nothing', 'S1: Eye bar aus bei Face aus: die Zeile zeigt Nothing');
  // eine deckende Wahl laesst Eye bar, wie es ist
  await setze({ einstellungen: { ...(await einst()), augenbalken: true } });
  await bis('Eye bar von aussen', async () => (await gewaehlt('face')) === 'bar');
  await tippe(await bausteinKnopf('face', 'schwarz'));
  await bis('schwarz', async () => (await einst()).custom.gesicht === 'schwarz');
  pruefe((await einst()).augenbalken === true && (await einst()).zonen.face.an === true, 'S1: eine deckende Wahl schaltet Face an und laesst Eye bar');
  // einzeln: der Baustein am Gesicht bei jeder Lage nie ausserhalb der fuenf Werte
  pruefe(['mia', 'sticker', 'mosaik', 'blur', 'schwarz'].includes((await einst()).custom.gesicht), 'S1: custom.gesicht bleibt in der Menge aus C1');

  // Words nicht bedienbar (B5): Flaeche Blur und Gesicht Mosaic mit Face aus
  await setze({ einstellungen: { ...(await einst()), zonen: zonen([]), augenbalken: false, custom: { gesicht: 'mosaik', flaeche: 'blur', woerter: true } } });
  await bis('Words gesperrt', async () => (await js(`return document.querySelector('#baukasten-woerter .v-schalter-knopf').getAttribute('aria-disabled')`)) === 'true');
  pruefe((await text('#baukasten-woerter .v-hinweis')) === 'Words need Black or Mosaic to sit on.', 'S1: Words nicht bedienbar: der Hinweis steht da');
  const vorW = JSON.stringify(await einst());
  await tippe(await js(`return document.querySelector('#baukasten-woerter .v-schalter-knopf')`));
  await warte(400);
  pruefe(JSON.stringify(await einst()) === vorW, 'S1: Words nicht bedienbar: ein Tipp aendert nichts, der gespeicherte Wert bleibt');
  pruefe((await js(`return document.querySelector('#baukasten-woerter .v-schalter-knopf').getAttribute('aria-checked')`)) === 'true', 'S1: Words zeigt den gespeicherten Wert');
  // Face an mit Mosaic macht Words wieder bedienbar
  await tippe(await bausteinKnopf('face', 'mosaik'));
  await bis('Words frei', async () => (await js(`return document.querySelector('#baukasten-woerter .v-schalter-knopf').getAttribute('aria-disabled')`)) !== 'true');
  pruefe((await js(`return document.querySelector('#baukasten-woerter .v-hinweis')`)) === null, 'S1: Words bedienbar: kein Hinweis');

  // ======================= S2: ohne Pack, Schau =======================
  if (!MIT_BILDERN) console.log('firefox: AUSNAHME: Beispielbilder fehlen im Testbau, S2 laeuft mit der Strichzeichnung');
  const GESICHT_AN = zonen(['face', ...KOERPER]);
  await stand({ preset: 'mosaik', zonen: GESICHT_AN });
  await vorschauRuht();
  const gesperrteKarten = ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'sticker'];
  for (const id of gesperrteKarten) {
    pruefe(await sichtbar(`#preset-${id}`) || (await js(`return document.getElementById('preset-' + arguments[0]).disabled`, id)) === true, `S2: Karte ${id} ist gesperrt (nicht waehlbar)`);
    pruefe(await js(`const k = document.getElementById('preset-' + arguments[0]).closest('.preset-huelle').querySelector('.preset-schau'); return !!k && !k.hidden`, id), `S2: Karte ${id} hat ein Bedienelement fuer die Schau`);
  }
  for (const id of ['mosaik', 'blur', 'mosaik-wort', 'person-mosaik']) pruefe(await js(`const k = document.getElementById('preset-' + arguments[0]).closest('.preset-huelle').querySelector('.preset-schau'); return !k || k.hidden`, id), `S2: freie Karte ${id} hat keine Schau`);
  pruefe((await js(`return document.getElementById('preset-mia-wort').closest('.preset-huelle').querySelector('.preset-schau').getAttribute('aria-label')`)) === 'My face, black, words, comes with my Pack, preview', 'S2: klarer Name des Bedienelements der Schau');
  pruefe((await js(`return document.getElementById('preset-mia-wort').closest('.preset-huelle').querySelector('.preset-schau').closest('label')`)) === null, 'S2: das Bedienelement liegt in keinem anderen (nicht im Label)');
  const markeSichtbar = () => sichtbar('.vorschau-spalte .v-vorschau-marke');
  pruefe(!(await markeSichtbar()), 'S2: ohne Schau keine Marke');
  const vorSchau = await alles();
  const radiosVor = await js(`return [...document.querySelectorAll('input[name="preset"]')].map((f) => f.checked)`);
  await tippe(await schauKnopf('mia-wort'));
  await bis('Schau laeuft', async () => { const h = await haken(); return h && h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
  pruefe(gleich(await alles(), vorSchau), 'S2: der Speicher ist nach dem Start der Schau gleich (tiefer Vergleich)');
  pruefe(gleich(await js(`return [...document.querySelectorAll('input[name="preset"]')].map((f) => f.checked)`), radiosVor), 'S2: kein Radio wechselt');
  pruefe((await js(`return document.getElementById('preset-mia-wort').checked`)) === false, 'S2: die gesperrte Karte ist nie checked');
  pruefe(await markeSichtbar(), 'S2: die Marke steht an der Kachel im breiten Raster');
  pruefe((await text('.vorschau-spalte .v-vorschau-marke')) === 'Pack', 'S2: die Marke heisst Pack (Text im DOM)');
  pruefe((await text('.vorschau-spalte .v-vorschau-schau')) === 'With my Pack it looks like this. Right now I use Mosaic for you.', `S2: der Satz der Schau (${await text('.vorschau-spalte .v-vorschau-schau')})`);
  pruefe(await sichtbar('.vorschau-spalte .v-vorschau-schau'), 'S2: der Satz steht im breiten Raster');
  pruefe((await text('.vorschau-spalte .v-vorschau-zurueck')) === 'Back to yours', 'S2: Knopf Back to yours');
  pruefe((await haken()).stil === 'mia-wort', 'S2: gerechnet wird der angetippte Stil, wie mit Pack gewaehlt');
  const schauBild = await js(`const i = document.querySelector('.vorschau-spalte .v-vorschau-kachel img'); return i ? i.src : null`);
  pruefe(!!schauBild && schauBild.startsWith('data:image/'), 'S2: ein gezeigtes Bild (Data-Adresse)');
  // im Bereich des Gesichts kein Pixel des Beispielbilds (N7): die ganze Flaeche, die der Platzhalter laut Zeichner deckt (gedreht, Ecken mit Radius 0,14 der kleineren Seite),
  // bis auf einen schmalen Rand an der Kante (FLAECHE_RAND_PX); gleich heisst Summe der Kanalabweichungen hoechstens 9, erlaubt sind hoechstens GLEICH_MAX der Pixel
  if (MIT_BILDERN) {
    const FLAECHE_RAND_PX = 4;
    const GLEICH_MAX = 0.005;
    const { rechneVorschau } = await import('../../src/oberflaeche/vorschau/rechnung.ts');
    const { vervollstaendige } = await import('../../src/einstellungen.ts');
    const { BEISPIELE } = await import('../../src/beispiel.ts');
    const bb = BEISPIELE.find((x) => x.kennung === 'portraet');
    const rr = rechneVorschau({ einstellungen: vervollstaendige({ version: 1, preset: 'mia-wort', zonen: GESICHT_AN }), pack: null, gesichter: null, bild: 'portraet', breite: bb.breite, hoehe: bb.hoehe, schau: true });
    const gesichter = rr.flaechen.filter((f) => f.behandlung === 'mia-gesicht').map((f) => (f.balken ? { mitte: f.balken.mitte, breite: f.balken.breite, hoehe: f.balken.hoehe, winkel: f.balken.winkel } : { mitte: [f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] / 2], breite: f.box[2], hoehe: f.box[3], winkel: 0 }));
    pruefe(gesichter.length >= 1, `S2: die Schau hat mindestens eine Gesichtsflaeche (${gesichter.length})`);
    const r = await imSeitenkontext(
      `const [url, flaechen, rand, quelle] = args;
       const holen = async (u) => createImageBitmap(await (await fetch(u)).blob());
       const a = await holen(quelle); const o = await holen(url);
       const lies = (bm) => { const c = new OffscreenCanvas(a.width, a.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0, a.width, a.height); return g.getImageData(0, 0, a.width, a.height).data; };
       const p = lies(a), q = lies(o);
       let n = 0, gleich = 0;
       for (const f of flaechen) {
         const rad = Math.min(f.breite, f.hoehe) * 0.14;
         const m = Math.ceil(Math.hypot(f.breite, f.hoehe) / 2);
         for (let y = Math.max(0, Math.floor(f.mitte[1] - m)); y < Math.min(a.height, f.mitte[1] + m); y++) for (let x = Math.max(0, Math.floor(f.mitte[0] - m)); x < Math.min(a.width, f.mitte[0] + m); x++) {
           const dx = x + 0.5 - f.mitte[0], dy = y + 0.5 - f.mitte[1];
           const lx = Math.abs(dx * Math.cos(-f.winkel) - dy * Math.sin(-f.winkel)), ly = Math.abs(dx * Math.sin(-f.winkel) + dy * Math.cos(-f.winkel));
           const hb = f.breite / 2 - rand, hh = f.hoehe / 2 - rand;
           if (lx > hb || ly > hh) continue;
           const qx = lx - (hb - rad), qy = ly - (hh - rad);
           if (qx > 0 && qy > 0 && Math.hypot(qx, qy) > rad) continue;
           const i = (y * a.width + x) * 4; n++;
           if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) <= 9) gleich++;
         }
       }
       return { n, gleich, breite: a.width, hoehe: a.height };`,
      'beispiel/portraet.webp',
      gesichter,
      FLAECHE_RAND_PX,
      schauBild,
    );
    console.log(`firefox: S2 ganze Gesichtsflaeche ${JSON.stringify(gesichter)}: ${JSON.stringify(r)}`);
    pruefe(r.n > 5000 && r.gleich / r.n <= GLEICH_MAX, `S2: in der ganzen Gesichtsflaeche steht kein Pixel des Beispielbilds (${JSON.stringify(r)})`);
  }
  // Marke in anderen Groessen: Streifen (unter 1000 px) und Fenster
  await driver.manage().window().setRect({ width: 900, height: 1500 });
  await warte(400);
  pruefe(await markeSichtbar(), 'S2: die Marke steht auch im Streifen');
  const streifenHoehe = await js(`return document.querySelector('.vorschau-spalte .v-vorschau-rahmen').getBoundingClientRect().height`);
  pruefe(await js(`const m = document.querySelector('.vorschau-spalte .v-vorschau-marke'); const r = document.querySelector('.vorschau-spalte .v-vorschau-rahmen'); const a = m.getBoundingClientRect(), b = r.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1`), `S2: im Streifen liegt die Marke in der Kachel (Kachelhoehe ${streifenHoehe})`);
  pruefe(!(await sichtbar('.vorschau-spalte .v-vorschau-schau')), 'S2: im Streifen steht der Satz nicht in der Spalte (er steht im Fenster)');
  await tippe(await js(`return document.querySelector('.vorschau-spalte .v-vorschau-kachel')`));
  await bis('Fenster offen', async () => js(`return !!document.querySelector('.vorschau-spalte dialog[open]')`));
  pruefe(await sichtbar('.vorschau-spalte dialog[open] .v-vorschau-dialog-hinweis:not([hidden])'), 'S2: im Fenster steht der Satz der Schau');
  pruefe((await js(`return [...document.querySelectorAll('.vorschau-spalte dialog[open] .v-vorschau-dialog-hinweis')].filter((e) => !e.hidden).map((e) => e.textContent)`)).includes('With my Pack it looks like this. Right now I use Mosaic for you.'), 'S2: der Satz im Fenster ist der der Schau');
  await js(`document.querySelector('.vorschau-spalte dialog[open]').close()`);
  await driver.manage().window().setRect({ width: 1400, height: 1500 });
  await warte(300);
  // der Satz wird einmal gehoert: genau ein sichtbares Element mit dem Satz (das Fenster ist zu)
  pruefe((await js(`return [...document.querySelectorAll('[role="status"], [aria-live]')].filter((e) => e.getClientRects().length && e.textContent.includes('With my Pack it looks like this')).length`)) === 1, 'S2: ein Vorleser hoert den Satz einmal');

  // Ende 1: Back to yours (der Fokus kehrt zum Bedienelement zurueck)
  await tippe(await js(`return document.querySelector('.vorschau-spalte .v-vorschau-zurueck')`));
  await bis('Schau zu (Knopf)', async () => { const h = await haken(); return h && h.schau === false && h.gezeigt === h.angefordert; });
  pruefe(!(await markeSichtbar()) && !(await sichtbar('.vorschau-spalte .v-vorschau-zurueck')), 'S2: Ende per Back to yours: Marke und Knopf weg');
  pruefe((await haken()).stil === 'mosaik', 'S2: danach zeigt die Vorschau wieder, was gilt (Mosaic)');
  pruefe((await js(`return document.activeElement && document.activeElement.classList.contains('preset-schau')`)) === true, 'S2: der Fokus kehrt zum Bedienelement der Schau zurueck');
  pruefe(gleich(await alles(), vorSchau), 'S2: der Speicher ist nach dem Ende gleich');
  // Ende 2: eine freie Karte waehlen
  await tippe(await schauKnopf('mia-blur'));
  await bis('Schau 2', async () => (await haken()).schau === true);
  await tippeKarte('blur');
  await bis('Ende durch freie Karte', async () => { const h = await haken(); return h.schau === false && h.stil === 'blur'; });
  // Ende 2b (N6): ein Tipp auf die schon gewaehlte freie Karte loest kein change aus und beendet die Schau trotzdem
  await tippe(await schauKnopf('mia-wort'));
  await bis('Schau 2b', async () => (await haken()).schau === true);
  pruefe((await js(`return document.getElementById('preset-blur').checked`)) === true, 'S2: Blur ist schon gewaehlt');
  await tippeKarte('blur');
  await bis('Ende durch Tipp auf die gewaehlte Karte', async () => (await haken()).schau === false);
  // Ende 3: eine Einstellung aendert sich (der Schalter fuer Videos)
  await tippe(await schauKnopf('sticker'));
  await bis('Schau 3', async () => (await haken()).schau === true);
  pruefe((await haken()).stil === 'sticker', 'S2: Sticker-Karte gerechnet');
  await tippe(await js(`return document.getElementById('video-zonen').closest('label')`));
  await bis('Ende durch Einstellung', async () => (await haken()).schau === false);
  // Ende 4: ein freier Baustein (Custom waehlen, gesperrten Baustein antippen, freien waehlen)
  await tippeKarte('custom');
  await bis('custom', async () => (await einst()).preset === 'custom');
  await vorschauRuht();
  const vorBaustein = await alles();
  pruefe((await js(`return document.querySelector('#baukasten-face .v-bk-knopf[data-id="mia"]').disabled`)) === true && (await js(`return document.querySelector('#baukasten-face .v-bk-knopf[data-id="sticker"]').disabled`)) === true && (await js(`return document.querySelector('#baukasten-flaeche .v-bk-knopf[data-id="sticker"]').disabled`)) === true, 'S2: My face, Sticker und Stickers sind gesperrt (nicht waehlbar)');
  pruefe((await bausteinSchau('face', 'mia')) !== null && (await js(`return document.querySelector('#baukasten-face .v-bk-schau[data-schau="mia"]').getAttribute('aria-label')`)) === 'My face, comes with my Pack, preview', 'S2: klarer Name des Bedienelements am Baustein');
  pruefe((await js(`return document.querySelector('#baukasten-flaeche .v-bk-schau[data-schau="sticker"]').getAttribute('aria-label')`)) === 'Stickers, comes with my Pack, preview', 'S2: Name am Baustein Stickers');
  await tippe(await bausteinSchau('face', 'mia'));
  await bis('Schau Baustein', async () => { const h = await haken(); return h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
  pruefe(gleich(await alles(), vorBaustein), 'S2: Schau eines Bausteins: der Speicher ist gleich');
  pruefe((await gewaehlt('face')) !== 'mia', 'S2: der gesperrte Baustein wird nie gewaehlt');
  pruefe((await haken()).stil.startsWith('custom:mia:'), `S2: der Baustein wird so gerechnet, wie er gewaehlt waere (${(await haken()).stil})`);
  pruefe((await text('.vorschau-spalte .v-vorschau-schau')) === 'With my Pack it looks like this. Right now that part is Mosaic.', `S2: der Satz der Schau eines Bausteins (${await text('.vorschau-spalte .v-vorschau-schau')})`);
  pruefe(await markeSichtbar(), 'S2: Marke bei der Schau eines Bausteins');
  await tippe(await bausteinKnopf('flaeche', 'schwarz'));
  await bis('Ende durch Baustein', async () => { const h = await haken(); return h.schau === false && h.stil === 'custom:mosaik:schwarz:-'; });
  // Ende 5: Pack kommt (Import)
  await tippe(await schauKnopf('mia-wort').catch(() => null) ?? (await bausteinSchau('face', 'mia')));
  await bis('Schau 5', async () => (await haken()).schau === true);
  await importierePack(false); // ein echter Import in derselben Seite, waehrend die Schau laeuft
  await bis('Ende durch Pack', async () => (await haken()).schau === false);
  await entfernePack();
  // Ende 6: Neuladen
  await stand({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } });
  await bis('Sperre da', async () => js(`const k = document.querySelector('#baukasten-face .v-bk-schau[data-schau="mia"]'); return !!k && !k.hidden`));
  await tippe(await bausteinSchau('face', 'mia'));
  await bis('Schau 6', async () => (await haken()).schau === true);
  await driver.navigate().refresh();
  await bis('bereit 2', async () => js(`return !!document.querySelector('#preset-karten input')`));
  await vorschauRuht();
  pruefe((await haken()).schau === false && !(await markeSichtbar()), 'S2: nach dem Neuladen keine Schau');
  // Schau mit "nichts zu verdecken" (Entscheidung 295): alle Zonen aus, die Schau zeigt das Bild offen mit dem Hinweis
  await stand({ preset: 'mosaik', zonen: zonen([]) });
  await tippe(await schauKnopf('sticker'));
  await bis('Schau offen', async () => { const h = await haken(); return h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
  if (MIT_BILDERN) pruefe((await haken()).offen === true && (await sichtbar('.vorschau-spalte .v-vorschau-offen')), 'S2: ohne Zonen zeigt die Schau das offene Bild mit dem Hinweis (Entscheidung 295)');
  await tippe(await js(`return document.querySelector('.vorschau-spalte .v-vorschau-zurueck')`));

  // Gespeicherter, gesperrter Baustein (Pack entfernt): gewaehlt und gesperrt mit dem einen Satz
  await stand({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } });
  pruefe((await gewaehlt('face')) === 'mia' && (await gewaehlt('flaeche')) === 'sticker', 'S2: gespeicherte gesperrte Bausteine stehen gewaehlt da');
  pruefe((await js(`return document.querySelector('#baukasten-face .v-bk-knopf[data-id="mia"]').disabled`)) === true, 'S2: und gesperrt');
  pruefe((await text('#baukasten-face .v-hinweis')) === 'Part of your mix needs my Pack. That part is Mosaic for now.' && (await text('#baukasten-flaeche .v-hinweis')) === 'Part of your mix needs my Pack. That part is Mosaic for now.', 'S2: der eine Satz zum ersetzten Baustein');
  pruefe((await einst()).custom.gesicht === 'mia', 'S2: gespeichert bleibt, wie es war');
  pruefe((await vorschauRuht()).stil.startsWith('custom:mosaik:mosaik'), `S2: es gilt Mosaik an beiden Stellen (${(await haken()).stil})`);

  // ======================= S3: mit Pack =======================
  await importierePack();
  await stand({ preset: 'mosaik', zonen: GESICHT_AN }, true);
  await bis('Pack gelesen', async () => js(`return !document.getElementById('preset-mia-wort').disabled`));
  pruefe((await js(`return [...document.querySelectorAll('.preset-schau')].filter((k) => !k.hidden).length`)) === 0, 'S3: mit dem Pack gibt es keine Sperre und keine Schau (keine Bedienelemente)');
  await tippeKarte('custom');
  await bis('custom (Pack)', async () => (await einst()).preset === 'custom');
  pruefe((await js(`return document.querySelectorAll('#preset-custom-ort button:disabled').length`)) === 0, 'S3: kein Baustein gesperrt');
  pruefe((await js(`return [...document.querySelectorAll('#preset-custom-ort .v-bk-schau')].filter((k) => !k.hidden).length`)) === 0, 'S3: keine Schau an den Bausteinen');
  await tippe(await bausteinKnopf('face', 'mia'));
  await tippe(await bausteinKnopf('flaeche', 'sticker'));
  await bis('mia und sticker gespeichert', async () => { const c = (await einst()).custom; return c.gesicht === 'mia' && c.flaeche === 'sticker'; });
  pruefe((await einst()).zonen.face.an === true, 'S3: My face bei Face an gespeichert');
  await bis('Vorschau S3', async () => { const h = await vorschauRuht(); return h.stil === 'custom:mia:sticker:-'; });
  pruefe((await haken()).schau === false, 'S3: die Vorschau zeigt die Wahl ohne Schau');
  pruefe(!(await markeSichtbar()), 'S3: keine Marke');
  pruefe((await text('#baukasten-face .v-hinweis')) === null, 'S3: kein Sperr-Hinweis');
  // eine gesperrte Karte gibt es nicht: die Karte Mias Gesicht ist waehlbar
  await tippeKarte('mia-wort');
  await bis('mia-wort', async () => (await einst()).preset === 'mia-wort');
  pruefe((await haken()).schau === false, 'S3: die Wahl einer Pack-Karte startet keine Schau');
  await entfernePack();

  // ======================= S4: Handy, 320, 360, 412 =======================
  await stand({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mia', flaeche: 'sticker', woerter: true } });
  const optionsUrl = `moz-extension://${uuid}/options.html`;
  await js(`document.body.innerHTML = ''; document.body.style.margin = '0'`);
  for (const breite of [320, 360, 412]) {
    for (const mitSchau of [false, true]) {
      await driver.get(`moz-extension://${uuid}/hilfe.html`);
      await js(`document.body.innerHTML = ''; const f = document.createElement('iframe'); f.id = 'schmal'; f.src = arguments[0]; f.style.cssText = 'width:' + arguments[1] + 'px;height:1700px;border:0'; document.body.appendChild(f);`, optionsUrl, breite);
      await bis('Rahmen geladen', async () => js(`try { return !!document.getElementById('schmal').contentDocument.querySelector('#preset-karten input') } catch { return false }`));
      await driver.switchTo().frame(await driver.findElement(By.id('schmal')));
      await bis('Zeilen', async () => sichtbar('#baukasten-face .v-bk-knopf'));
      if (mitSchau) {
        await tippe(await bausteinSchau('face', 'mia'));
        await bis('Schau im Rahmen', async () => { const h = await haken(); return h && h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
      }
      const m = await js(`
        const klein = [];
        for (const e of document.querySelectorAll('#preset-custom-ort button:not([hidden]), #preset-custom-ort [role=switch], .v-vorschau-zurueck')) {
          const r = e.getBoundingClientRect();
          if (r.width && r.height && (r.width < 43.5 || r.height < 43.5)) klein.push(e.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
        const breiter = [...document.querySelectorAll('#preset-custom-ort *, .vorschau-spalte *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.getClientRects().length).map((e) => e.className).slice(0, 5);
        return { innen: innerWidth, dokument: document.documentElement.scrollWidth, klein, breiter };`);
      console.log(`firefox: S4 ${breite} ${mitSchau ? 'mit Schau' : 'ohne Schau'}: ${JSON.stringify(m)}`);
      pruefe(m.innen === breite, `S4: Messbreite ${m.innen} gleich ${breite}`);
      pruefe(m.dokument <= m.innen, `S4 ${breite} ${mitSchau ? 'mit Schau' : ''}: kein waagerechtes Scrollen (Dokument ${m.dokument}, Fenster ${m.innen})`);
      pruefe(m.klein.length === 0, `S4 ${breite} ${mitSchau ? 'mit Schau' : ''}: Trefferflaechen mindestens 44 px (${m.klein.join('; ')})`);
      pruefe(m.breiter.length === 0, `S4 ${breite} ${mitSchau ? 'mit Schau' : ''}: nichts ragt rechts hinaus (${m.breiter.join('; ')})`);
      await driver.switchTo().defaultContent();
    }
  }

  // ======================= S5: Interview =======================
  await driver.get(`moz-extension://${uuid}/willkommen.html#interview`);
  await setze({ einstieg: FERTIG });
  await entferne(['pack']);
  await setze({ einstellungen: { version: 1, preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } } });
  await driver.navigate().refresh();
  await bis('Interview', async () => js(`return document.getElementById('schritt') && document.getElementById('schritt').dataset.schritt === 'interview-1'`));
  await js(`document.getElementById('iv-weiter').click()`);
  await js(`document.getElementById('iv-weiter').click()`);
  await bis('Seite Stil', async () => js(`return document.getElementById('schritt').dataset.schritt === 'interview-3'`));
  pruefe((await js(`return document.querySelectorAll('input[name="iv-preset"]').length`)) === 12, 'S5: das Interview hat zwoelf Karten, keine Custom-Karte');
  pruefe((await js(`return document.getElementById('iv-preset-custom')`)) === null, 'S5: keine Karte Custom im Interview');
  pruefe((await js(`return [...document.querySelectorAll('input[name="iv-preset"]')].filter((f) => f.checked).length`)) === 0, 'S5: steht custom im Speicher, ist keine Karte gewaehlt');
  pruefe((await text('#iv-stil-custom')) === 'Your own mix is on. You change it in the settings.' && (await sichtbar('#iv-stil-custom')), 'S5: die Zeile sagt es');
  const vorI = await alles();
  pruefe(await js(`const k = document.getElementById('iv-preset-mia-wort').closest('.preset-huelle').querySelector('.preset-schau'); return !!k && !k.hidden`), 'S5: gesperrte Karten haben die Schau auch im Interview');
  await tippe(await js(`return document.getElementById('iv-preset-mia-wort').closest('.preset-huelle').querySelector('.preset-schau')`));
  await bis('Schau im Interview', async () => { const h = await haken(); return h && h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
  pruefe(gleich(await alles(), vorI), 'S5: der Speicher bleibt gleich');
  pruefe(await sichtbar('.iv-vorschau .v-vorschau-marke'), 'S5: Marke an der Kachel im Interview');
  pruefe((await text('.iv-vorschau .v-vorschau-zurueck')) === 'Back to yours', 'S5: Knopf Back to yours');
  pruefe((await js(`return document.getElementById('iv-preset-mia-wort').checked`)) === false, 'S5: die gesperrte Karte bleibt ungewaehlt');
  // die Wahl einer freien Karte beendet die Schau und ersetzt Custom wie ueblich
  await js(`const l = document.getElementById('iv-preset-blur').closest('label'); l.scrollIntoView({block:'center'}); `);
  await (await js(`return document.getElementById('iv-preset-blur').closest('label')`)).click();
  await bis('Karte gewaehlt', async () => (await einst())?.preset === 'blur');
  await bis('Schau zu', async () => (await haken()).schau === false);
  pruefe((await js(`return document.getElementById('iv-preset-blur').checked`)) === true && !(await sichtbar('#iv-stil-custom')), 'S5: die Wahl ersetzt Custom wie ueblich, die Zeile ist weg');
  pruefe((await einst()).custom.gesicht === 'mia', 'S5: die Mischung bleibt im Speicher');

  // S5 schmal: das Interview bei 320 px mit laufender Schau (Rahmen der Breite): kein waagerechtes Scrollen, Knopf mindestens 44 px
  await entferne(['pack']);
  await setze({ einstellungen: { version: 1, preset: 'mosaik', zonen: GESICHT_AN } });
  await driver.get(`moz-extension://${uuid}/hilfe.html`);
  await js(`document.body.innerHTML = ''; const f = document.createElement('iframe'); f.id = 'schmal'; f.src = 'willkommen.html#interview'; f.style.cssText = 'width:320px;height:1800px;border:0'; document.body.appendChild(f);`);
  await bis('Interview im Rahmen', async () => js(`try { return !!document.getElementById('schmal').contentDocument.getElementById('iv-weiter') } catch { return false }`));
  await driver.switchTo().frame(await driver.findElement(By.id('schmal')));
  await bis('Interview im Rahmen bereit', async () => js(`return !!document.getElementById('schritt') && !!document.getElementById('schritt').dataset.schritt`));
  // die Seite merkt sich den Schritt je Tab: bis zur Seite Stil weiterklicken
  for (let i = 0; i < 4 && (await js(`return document.getElementById('schritt').dataset.schritt`)) !== 'interview-3'; i++) {
    await js(`const w = document.getElementById('iv-weiter'); if (w) w.click()`);
    await warte(500);
  }
  await bis('Seite Stil im Rahmen', async () => js(`return document.getElementById('schritt').dataset.schritt === 'interview-3'`));
  await bis('Sperre da (Interview)', async () => js(`const k = document.getElementById('iv-preset-mia-wort'); return !!k && k.closest('.preset-huelle').querySelector('.preset-schau:not([hidden])') !== null`));
  await tippe(await js(`return document.getElementById('iv-preset-mia-wort').closest('.preset-huelle').querySelector('.preset-schau')`));
  await bis('Schau im Rahmen (Interview)', async () => { const h = await haken(); return h && h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
  const mi = await js(`const z = document.querySelector('.v-vorschau-zurueck'); const r = z.getBoundingClientRect(); return { innen: innerWidth, dokument: document.documentElement.scrollWidth, hoehe: r.height, breite: r.width };`);
  pruefe(mi.innen === 320 && mi.dokument <= mi.innen, `S5: Interview bei 320 px mit Schau: kein waagerechtes Scrollen (${JSON.stringify(mi)})`);
  pruefe(mi.hoehe >= 43.5 && mi.breite >= 43.5, `S5: Knopf Back to yours mindestens 44 px (${JSON.stringify(mi)})`);
  await driver.switchTo().defaultContent();

  // ======================= S6: Tastatur und Namen =======================
  await driver.get(`moz-extension://${uuid}/options.html`);
  await stand({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } });
  for (const zeile of ['face', 'flaeche']) {
    pruefe(await js(`const g = document.querySelector('#baukasten-' + arguments[0] + ' [role=radiogroup]'); return !!g && !!g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')).textContent.length > 0`, zeile), `S6: die Zeile ${zeile} ist eine Radiogruppe mit Namen`);
  }
  // Tab-Halt: genau ein Radio je Zeile
  pruefe((await js(`return [...document.querySelectorAll('#baukasten-face .v-bk-knopf')].filter((k) => k.tabIndex === 0).length`)) === 1, 'S6: genau ein Tab-Halt in der Zeile Face');
  const mosaikKnopf = await bausteinKnopf('face', 'mosaik');
  await js(`arguments[0].focus()`, mosaikKnopf);
  await driver.actions().sendKeys(Key.ARROW_RIGHT).perform();
  pruefe((await js(`return document.activeElement.dataset.id`)) === 'blur', `S6: Pfeil nach rechts bewegt den Fokus (${await js('return document.activeElement.dataset.id')})`);
  pruefe((await einst()).custom.gesicht === 'mosaik', 'S6: der Pfeil speichert nichts');
  await driver.actions().sendKeys(Key.SPACE).perform();
  await bis('Leertaste waehlt', async () => (await einst()).custom.gesicht === 'blur');
  await driver.actions().sendKeys(Key.ARROW_LEFT).perform();
  await driver.actions().sendKeys(Key.ARROW_LEFT).perform();
  pruefe((await js(`return document.activeElement.dataset.id`)) === 'sticker' || (await js(`return document.activeElement.dataset.id`)) === 'mia' || (await js(`return !!document.activeElement.dataset.id`)), 'S6: Pfeile laufen in der Zeile');
  // ohne Pack: das Bedienelement der Schau ist per Tab erreichbar und startet mit Eingabe
  await stand({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } });
  const mia = await bausteinSchau('face', 'mia');
  await js(`arguments[0].focus()`, mia);
  pruefe((await js(`return document.activeElement.dataset.schau`)) === 'mia', 'S6: das Bedienelement der Schau nimmt den Fokus');
  await driver.actions().sendKeys(Key.ENTER).perform();
  await bis('Schau per Tastatur', async () => { const h = await haken(); return h && h.schau === true && h.gezeigt === h.angefordert; }, 60_000);
  // Fokus nach dem Ende bleibt auf einem sinnvollen Element
  await js(`document.querySelector('.vorschau-spalte .v-vorschau-zurueck').focus()`);
  await driver.actions().sendKeys(Key.ENTER).perform();
  await bis('Ende per Tastatur', async () => (await haken()).schau === false);
  pruefe((await js(`return document.activeElement.dataset.schau`)) === 'mia', 'S6: nach dem Ende liegt der Fokus wieder auf dem Bedienelement der Schau');
  // gesperrte Karte: per Tastatur erreichbar mit klarem Namen
  await stand({ preset: 'mosaik', zonen: GESICHT_AN });
  const karte = await schauKnopf('sticker');
  await js(`arguments[0].focus()`, karte);
  pruefe((await js(`return document.activeElement.getAttribute('aria-label')`)) === 'Stickers, comes with my Pack, preview', 'S6: gesperrte Karte: das Bedienelement hat den klaren Namen');
  await driver.actions().sendKeys(Key.SPACE).perform();
  await bis('Schau Karte per Tastatur', async () => (await haken()).schau === true);
  await js(`document.querySelector('.vorschau-spalte .v-vorschau-zurueck').focus()`);
  await driver.actions().sendKeys(Key.ENTER).perform();
  await bis('Ende', async () => (await haken()).schau === false);
  pruefe((await js(`return document.activeElement.classList.contains('preset-schau')`)) === true, 'S6: Fokus nach dem Ende der Schau einer Karte auf deren Bedienelement');
} catch (f) {
  console.error('firefox: FEHLER', f);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: baukasten.test ${ok} gruen, ${fehler.length} rot`);
if (fehler.length) code = 1;
process.exit(code);

async function oeffneReiter(name) {
  await js(`const t = [...document.querySelectorAll('[role=tab]')].find((e) => e.textContent === arguments[0]); if (t && t.getAttribute('aria-selected') !== 'true') t.click();`, name);
  await warte(150);
}
