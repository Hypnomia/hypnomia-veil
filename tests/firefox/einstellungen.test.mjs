// Firefox-Test Phase 6, Session 11, Auftrag S: Einstellungen auf einem Bildschirm (Aufbau, Pause, Stimmung, Zonen, bedeckt, Stil, Strict,
// Ausnahmen, Popup und Einstellungsseite gleicher Stand, Pack-Sperre vor dem Einstieg, 360 px ohne Ueberlauf). Hilfsfunktionen wie kontrolle-optionen.test.mjs.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';

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

// Phase 9 (Paket B, Fund 4): ohne Pack sind Adult sites, Mia’s control (bis auf Calm mode) und Sound zugeklappt; wie die Person mit "Set them now" aufklappen.
const oeffneZu = async () => {
  const frist = Date.now() + 15_000;
  for (;;) {
    try {
      if (await driver.executeScript(`return document.body.getAttribute('data-veil-ordnung') === 'bereit'`)) break;
    } catch {
      /* Seite laedt noch */
    }
    if (Date.now() > frist) throw new Error('Ordnung der Einstellungsseite nicht bereit');
    await new Promise((r) => setTimeout(r, 100));
  }
  await driver.executeScript(`for (let i = 0; i < 5; i++) { const k = [...document.querySelectorAll('.zu-knopf')].find((e) => !e.hidden && e.getClientRects().length > 0); if (!k) break; k.click(); } window.scrollTo(0, 0);`);
};
const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const einst = async () => (await speicher('einstellungen')) ?? {};
const waehle = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, wert);
const zahl = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));


const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const setze = (o) => imSeitenkontext(`await api.storage.local.set(args[0]);`, o);
const entferne = (k) => imSeitenkontext(`await api.storage.local.remove(args[0]);`, k);
const packMit = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const anzeige = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return e.value ?? e.textContent;`, css);
// Echte WebDriver-Klicks und Tasten (Mausklick aufs Label, Pfeiltasten am Regler), kein element.click() im Seitenskript.
const wdKlick = async (by) => (await driver.findElement(by)).click();
const labelMit = (bereich, text) => By.xpath(`//*[@id='${bereich}']//label[contains(., '${text}')]`);
const zone = (text) => wdKlick(labelMit('zonen', text));
const stilWahl = (text) => wdKlick(By.xpath(`//div[contains(@class,'wahl')]//label[contains(., '${text}')]`));
const strictKlick = () => wdKlick(By.xpath(`//label[.//input[@id='strict']]`));
const tasten = async (css, key, n) => {
  const e = await driver.findElement(By.css(css));
  await e.sendKeys(...Array(n).fill(key));
};
const geklickt = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
// Session 17: Element fehlt waehrend die Seite noch laedt (Firefox 128 langsamer): null statt Ausnahme, damit `bis` weiter wartet.
const gesperrt = (css) => driver.executeScript(`return document.querySelector(arguments[0])?.disabled ?? null`, css);
const wertVon = (css) => driver.executeScript(`return document.querySelector(arguments[0]).value`, css);
const geprueft = (css) => driver.executeScript(`return document.querySelector(arguments[0])?.checked ?? null`, css);

// Neue Seite beobachten: Griffe vor dem Klick merken, danach den neuen Griff, seine Adresse lesen, schliessen, zurueckwechseln.
async function neueSeiteNach(aktion) {
  const vorher = await driver.getAllWindowHandles();
  const zurueck = await driver.getWindowHandle();
  await aktion();
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error('keine neue Seite');
  await driver.switchTo().window(neu);
  let url = await driver.getCurrentUrl();
  for (let i = 0; i < 100 && url === 'about:blank'; i++) {
    await warte(50);
    url = await driver.getCurrentUrl();
  }
  await driver.close();
  await driver.switchTo().window(zurueck);
  return url;
}

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

  const optionenSeite = await oeffne('options.html');
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`);
  await driver.navigate().refresh();
  await bis('Seite gezeichnet', async () => (await text('#status')).length > 0);
  await oeffneZu();

  // ---- Aufbau ----
  pruefe((await driver.getTitle()) === 'HYPNOMIA VEIL: Settings', 'Seitentitel "HYPNOMIA VEIL: Settings"');
  pruefe((await text('#status')).includes('On watch'), 'Status: On watch');
  pruefe((await text('#pause')) === 'Pause Mia', 'Pause-Knopf: Pause Mia');
  const reihenfolge = await driver.executeScript(`return [...document.querySelectorAll('main > section, main > .gruppe')].map((s) => s.id)`);
  // Phase 9 (Fund 4): sechs Gruppen, ohne Pack steht die Pack-Karte nach "Covering".
  const soll = ['covering', 'stand', 'erwachsen', 'kontrolle', 'ton', 'ledger', 'ueber'];
  pruefe(JSON.stringify(reihenfolge) === JSON.stringify(soll), `Abschnitte in der Reihenfolge des Auftrags (${reihenfolge.length})`);
  const links = await driver.executeScript(`return [...document.querySelectorAll('#sprung a[href^="#"]:not([hidden])')].every((a) => !!document.getElementById(a.getAttribute('href').slice(1))) ? document.querySelectorAll('#sprung a[href^="#"]:not([hidden])').length : -1`);
  pruefe(links === 7, `Sprungleiste: ${links} Links, alle mit Ziel`);
  pruefe((await driver.executeScript(`return document.querySelectorAll('#zonen input[data-zone]').length`)) === 10, '10 Zonen aufgebaut');
  pruefe((await driver.executeScript(`return document.querySelectorAll('#zonen input[data-bedeckt]').length`)) === 6, '6 "even when clothed"');

  // ---- Pause ----
  await klick('#pause');
  await bis('pause an', async () => (await einst()).pause === true);
  await bis('Status Paused', async () => (await text('#status')).includes('Paused'));
  pruefe((await text('#pause')) === 'Let Mia back in', 'Pause-Knopf wechselt den Text');
  await klick('#pause');
  await bis('pause aus', async () => (await einst()).pause === false);
  pruefe(true, 'Pause-Knopf schreibt pause true und wieder false');

  // ---- Stimmung ----
  await tasten('#stimmung', Key.ARROW_RIGHT, 8);
  await bis('schwelle 0.18', async () => Math.abs((await einst()).schwelle - 0.18) < 1e-6);
  pruefe((await text('#stimmung-wert')) === stimmungsWort(0.18), 'Stimmung 0.18 (8 Pfeiltasten) gespeichert, als Wort angezeigt');
  await tasten('#stimmung', Key.END, 1);
  await bis('schwelle 0.25', async () => Math.abs((await einst()).schwelle - 0.25) < 1e-6);
  await tasten('#stimmung', Key.ARROW_RIGHT, 1);
  await warte(300);
  pruefe(Math.abs((await einst()).schwelle - 0.25) < 1e-6, 'Stimmung: Ende setzt 0.25, weiter nach rechts bleibt bei 0.25');
  await tasten('#stimmung', Key.HOME, 1);
  await bis('schwelle 0.10', async () => Math.abs((await einst()).schwelle - 0.1) < 1e-6);
  await tasten('#stimmung', Key.ARROW_RIGHT, 8);
  await bis('schwelle 0.18 (2)', async () => Math.abs((await einst()).schwelle - 0.18) < 1e-6);

  // ---- Zonen und bedeckt ----
  await zone('Eyes');
  await bis('eyes an', async () => (await einst()).zonen?.eyes?.an === true);
  pruefe(await gesperrt('#zonen input[data-bedeckt="belly"]'), 'bedeckt-Feld Bauch gesperrt, solange die Zone aus ist');
  await zone('Belly');
  await bis('belly an', async () => (await einst()).zonen?.belly?.an === true);
  pruefe(!(await gesperrt('#zonen input[data-bedeckt="belly"]')), 'bedeckt-Feld Bauch frei, sobald die Zone an ist');
  await wdKlick(By.css('#zonen input[data-bedeckt="belly"]'));
  await bis('belly bedeckt', async () => (await einst()).zonen?.belly?.bedeckt === true);
  await zone('Breasts');
  await bis('breast aus', async () => (await einst()).zonen?.breast?.an === false);
  pruefe(true, 'Zonen: Augen an, Bauch an und bedeckt, Brueste aus gespeichert');

  // ---- Stil ----
  await stilWahl('Blur');
  await bis('stil blur', async () => (await einst()).stil === 'blur');
  pruefe(await gesperrt('input[name="stil"][value="mia-patch"]'), 'Mia patch ohne Pack gesperrt');
  pruefe((await text('#stil-hinweis')).includes('Mia Pack'), 'Hinweis nennt das Mia Pack');
  await setze({ pack: packMit(['stil:mia-patch']) });
  await bis('Mia patch frei', async () => !(await gesperrt('input[name="stil"][value="mia-patch"]')));
  pruefe((await text('#stil-hinweis')).includes('7 of my pictures'), 'Hinweis mit Pack nennt die Bilder');
  await stilWahl('Mia patch');
  await bis('stil mia-patch', async () => (await einst()).stil === 'mia-patch');
  await stilWahl('Mosaic');
  await bis('stil mosaik', async () => (await einst()).stil === 'mosaik');
  pruefe(true, 'Stil: Blur, Mia patch (mit Pack), Mosaic gespeichert');

  // ---- Strict ----
  await strictKlick();
  await bis('strict an', async () => (await einst()).strict === true);
  await strictKlick();
  await bis('strict aus', async () => (await einst()).strict === false);
  pruefe(true, 'Strict an und aus gespeichert');

  // ---- Ausnahmen ----
  await entferne('pack');
  const feld = async (wert) => {
    await driver.executeScript(`const e = document.querySelector('#ausnahme-feld'); e.value = arguments[0];`, wert);
    await klick('#ausnahme-add');
  };
  pruefe((await text('#status-ausnahmen')).includes('single site alone'), 'Ausnahmen: anfangs keine');
  pruefe((await text('#ausnahmen-standard')).match(/\d+/) !== null, 'Zahl der Standard-Ausnahmen genannt');
  await feld('https://WWW.Example.com/');
  await bis('example.com', async () => JSON.stringify((await einst()).ausnahmen) === '["example.com"]');
  pruefe((await text('#status-ausnahmen')).includes('1 site you asked me to leave alone'), 'Status nennt die Zahl der Ausnahmen');
  await feld('example.com');
  await bis('Meldung doppelt', async () => (await text('#ausnahme-meldung')).includes('already'));
  await feld('kein host');
  await bis('Meldung ungueltig', async () => (await text('#ausnahme-meldung')).includes('look like'));
  await feld('sub.example.com');
  await bis('Meldung abgedeckt', async () => (await text('#ausnahme-meldung')).includes('already on your list through example.com'));
  await feld('co.uk');
  await bis('Meldung Endung', async () => (await text('#ausnahme-meldung')).includes('whole crowd'));
  await feld('bücher.de');
  await bis('xn--Form', async () => JSON.stringify((await einst()).ausnahmen) === '["example.com","xn--bcher-kva.de"]');
  await klick('#ausnahmen-liste button[data-muster="xn--bcher-kva.de"]');
  await bis('xn-- weg', async () => JSON.stringify((await einst()).ausnahmen) === '["example.com"]');
  await feld('sparkasse.de');
  await bis('Meldung Standardliste', async () => (await text('#ausnahme-meldung')).includes('never-touch'));
  pruefe(JSON.stringify((await einst()).ausnahmen) === '["example.com"]', 'Doppelte, Ungueltige und Standardliste landen nicht im Speicher');
  await feld('zweite-seite.org/pfad');
  await bis('zwei Ausnahmen', async () => (await einst()).ausnahmen?.length === 2);
  await klick('#ausnahmen-liste button[data-muster="example.com"]');
  await bis('eine Ausnahme', async () => JSON.stringify((await einst()).ausnahmen) === '["zweite-seite.org/pfad"]');
  await klick('#ausnahmen-liste button');
  await bis('keine Ausnahme', async () => (await einst()).ausnahmen?.length === 0);
  pruefe(true, 'Ausnahmen: hinzufuegen (bereinigt), doppelt, ungueltig, Standardliste, zweimal entfernen');

  // ---- Popup und Einstellungsseite: derselbe Stand ----
  const popup = await oeffne('popup.html');
  await bis('Popup gezeichnet', async () => (await text('#pause')).length > 0);
  // Phase 9 (Paket A): Mood, Zonen und Strict liegen im Popup hinter "Change".
  if ((await driver.findElement(By.css('#aendern')).getAttribute('aria-expanded')) !== 'true') await driver.findElement(By.css('#aendern')).click();
  await driver.switchTo().window(optionenSeite);
  // Jede Aenderung einzeln im Speicher abwarten (das Popup liest seine Felder erst beim Schreiben, schnelle Folgeklicks wuerden sich ueberholen).
  await klick('#pause');
  await bis('pause an (2)', async () => (await einst()).pause === true);
  await tasten('#stimmung', Key.ARROW_RIGHT, 4);
  await bis('schwelle 0.22', async () => Math.abs((await einst()).schwelle - 0.22) < 1e-6);
  await strictKlick();
  await bis('strict an (2)', async () => (await einst()).strict === true);
  await zone('Mouth');
  await bis('mouth an', async () => (await einst()).zonen?.mouth?.an === true);
  await driver.switchTo().window(popup);
  await bis('Popup zeigt Aenderungen', async () => (await text('#pause')) === 'Let Mia back in' && (await wertVon('#stimmung')) === '0.22' && (await geprueft('#strict')) && (await geprueft('#zonen input[data-zone="mouth"]')));
  pruefe(true, 'Einstellungsseite aendert, das Popup zeigt Pause, Stimmung 0.22, Strict und Mund');
  await klick('#pause');
  await bis('pause aus (2)', async () => (await einst()).pause === false);
  await tasten('#stimmung', Key.ARROW_LEFT, 10);
  await bis('schwelle 0.12', async () => Math.abs((await einst()).schwelle - 0.12) < 1e-6);
  await warte(700); // Speicher-Ereignisse der zehn Tastendruecke im Popup abklingen lassen (es zeichnet sonst ueber den Klick)
  await strictKlick();
  await bis('strict aus (2)', async () => (await einst()).strict === false);
  await driver.switchTo().window(optionenSeite);
  await bis('Seite zeigt Aenderungen', async () => (await text('#pause')) === 'Pause Mia' && (await text('#stimmung-wert')) === stimmungsWort(0.12) && !(await geprueft('#strict')));
  pruefe(true, 'Popup aendert, die Einstellungsseite zeigt Pause aus, Stimmung 0.12 und Strict aus');

  // ---- Adult sites: drei Schalter ----
  await entferne('pack');
  await driver.switchTo().window(optionenSeite);
  const erwSchalter = (feld) => wdKlick(By.xpath(`//label[.//input[@id='${feld}']]`));
  const erwSpeicher = async () => (await einst()).erwachsen ?? {};
  pruefe((await text('#erw-pack-hinweis')).includes('they’ll be ready'), 'Adult sites ohne Pack: Hinweis "ready"');
  pruefe((await sichtbar('#erw-an')) || (await sichtbar('#erw-an + .regler')), 'Adult-site mode auch ohne Pack sichtbar');
  pruefe((await geprueft('#erw-an')) === true && (await geprueft('#erw-ersatz')) === false && (await geprueft('#erw-inhalt')) === true, 'Standard: Mode an, Replacement aus, Content an');
  await erwSchalter('erw-ersatz');
  await bis('ersatz an', async () => (await erwSpeicher()).komplettErsatz === true);
  await erwSchalter('erw-inhalt');
  await bis('inhalt aus', async () => (await erwSpeicher()).erkennenAmInhalt === false);
  await setze({ pack: packMit(['erwachsen:vorschau', 'erwachsen:ersatz']) });
  const popup2 = await oeffne('popup.html');
  await bis('Popup erw gezeichnet', async () => (await geprueft('#erw-ersatz')) === true);
  pruefe((await geprueft('#erw-inhalt')) === false, 'Popup zeigt Replacement an und Content aus wie die Seite');
  await driver.switchTo().window(optionenSeite);
  await erwSchalter('erw-an');
  await bis('mode aus', async () => (await erwSpeicher()).an === false);
  await bis('ersatz gesperrt', async () => await gesperrt('#erw-ersatz'));
  await erwSchalter('erw-an');
  await bis('mode an', async () => (await erwSpeicher()).an === true);
  await bis('ersatz frei', async () => !(await gesperrt('#erw-ersatz')));
  pruefe(true, 'Full replacement nur waehlbar, solange Adult-site mode an ist');
  await driver.switchTo().window(popup2);
  await warte(700);
  await wdKlick(By.xpath(`//label[.//input[@id='erw-inhalt']]`));
  await bis('inhalt an (Popup)', async () => (await erwSpeicher()).erkennenAmInhalt === true);
  await driver.switchTo().window(optionenSeite);
  await bis('Seite zeigt Content an', async () => (await geprueft('#erw-inhalt')) === true);
  pruefe(true, 'Popup aendert Content, die Seite folgt');

  // ---- Pack-Sperre vor dem Einstieg ----
  const antwort = await imSeitenkontext(`return await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'einstieg-test', zuruecksetzen: true });`);
  pruefe(antwort?.ok === true, 'Testhaken einstieg-test setzt den Einstieg zurueck');
  await driver.navigate().refresh();
  await oeffneZu();
  await bis('Dateifeld gesperrt', async () => await gesperrt('#datei'));
  pruefe((await driver.executeScript(`return document.querySelector('#datei').getAttribute('aria-describedby')`)).includes('pack-sperre-text'), 'Dateifeld nennt den Grund (aria-describedby)');
  pruefe(await sichtbar('#pack-sperre'), 'ohne Einstieg: Satz und Knopf "Meet Mia first" sichtbar');
  pruefe(!(await sichtbar('#abschnitt-interview')), 'ohne Einstieg: kein Interview-Knopf');
  // Dateiwurf: Sperre im Feld umgangen (wie ein Wurf aus dem Dateimanager), die Pruefung im Speicher weist die Datei ab
  const tmp = await mkdtemp(path.join(tmpdir(), 'veil-sperre-'));
  const dateiPfad = path.join(tmp, 'x.miapack');
  await writeFile(dateiPfad, 'kein echtes Pack');
  await driver.executeScript(`document.querySelector('#datei').disabled = false`);
  await (await driver.findElement(By.css('#datei'))).sendKeys(dateiPfad);
  await bis('Meldung Meet me first', async () => (await text('#meldung')).includes('Meet me first'));
  pruefe(!(await sichtbar('#lizenz-block')), 'Dateiwurf vor dem Einstieg: keine Lizenz, kein Import');
  const idb = await imSeitenkontext(`
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === 'veil-pack')) return 0;
    const db = await new Promise((ok, nein) => { const r = indexedDB.open('veil-pack'); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error); });
    if (!db.objectStoreNames.contains('dateien')) return 0;
    const n = await new Promise((ok) => { const r = db.transaction('dateien').objectStore('dateien').count(); r.onsuccess = () => ok(r.result); });
    db.close();
    return n;`);
  pruefe((await speicher('pack')) === null && idb === 0, `Dateiwurf vor dem Einstieg: pack leer, IndexedDB ${idb} Dateien`);
  await driver.executeScript(`document.querySelector('#datei').disabled = true`);
  await setze({ einstieg: { ...EINSTIEG_FERTIG, alter: false, einwilligung: false, interview: 'offen' } });
  await warte(300);
  pruefe(await gesperrt('#datei'), 'nur Warnung bestaetigt: Dateifeld bleibt gesperrt');
  const willkommen = await neueSeiteNach(() => klick('#pack-sperre-knopf'));
  pruefe(willkommen === `moz-extension://${uuid}/willkommen.html`, `"Meet Mia first" oeffnet ${willkommen.replace(uuid, '<uuid>')}`);
  await setze({ einstieg: EINSTIEG_FERTIG });
  await bis('Dateifeld frei', async () => !(await gesperrt('#datei')));
  pruefe(!(await sichtbar('#pack-sperre')) && (await sichtbar('#abschnitt-interview')), 'Einstieg fertig: Sperre faellt, Interview-Knopf erscheint');
  // Runde 3, N12: das Wiederholen laeuft im selben Tab (keine zweite Seite), danach zurueck zur Einstellungsseite.
  const tabsVorher = (await driver.getAllWindowHandles()).length;
  await klick('#interview-neu');
  await bis('Interview im selben Tab', async () => (await driver.getCurrentUrl()) === `moz-extension://${uuid}/willkommen.html#interview`);
  pruefe((await driver.getAllWindowHandles()).length === tabsVorher, '"Redo the interview" oeffnet willkommen.html#interview im selben Tab');
  await driver.navigate().back();
  await bis('zurueck auf der Einstellungsseite', async () => (await text('#status')).length > 0);
  await bis('Dateifeld wieder frei', async () => !(await gesperrt('#datei')));
  await (await driver.findElement(By.css('#datei'))).sendKeys(dateiPfad);
  await bis('Datei geprueft', async () => (await text('#meldung')).includes('doesn'));
  pruefe(true, 'Einstieg fertig: dieselbe Datei wird angenommen und geprueft (als kein Pack erkannt)');
  await rm(tmp, { recursive: true, force: true });
  await entferne('einstieg');
  await bis('wieder gesperrt', async () => await gesperrt('#datei'));
  pruefe(true, 'Einstieg geloescht: Dateifeld wieder gesperrt');

  // ---- 360 px (Iframe der Seite selbst, weil Firefox-Fenster nicht so schmal werden) ----
  await setze({
    einstieg: EINSTIEG_FERTIG,
    pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'kontrolle:zeitplan']),
    einstellungen: { ...(await einst()), ausnahmen: ['eine-ziemlich-lange-adresse-fuer-den-test.example.com/mit/langem/pfad', 'kurz.de'] },
  });
  const mass = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const f = document.createElement('iframe');
     f.style.cssText = 'width:360px;height:800px;position:fixed;left:0;top:0;border:0';
     f.src = location.href;
     f.onload = () => setTimeout(() => {
       const d = f.contentDocument;
       d.getElementById('kon-zeit-neu').click();
       setTimeout(() => fertig({ breite: d.documentElement.scrollWidth, fenster: d.documentElement.clientWidth, liste: d.querySelectorAll('#ausnahmen-liste li').length }), 400);
     }, 500);
     document.body.append(f);`,
  );
  console.log(`firefox: 360 px, scrollWidth ${mass.breite}, clientWidth ${mass.fenster}, ${mass.liste} Ausnahmen`);
  pruefe(mass.liste === 2 && mass.breite <= mass.fenster, `360 px ohne waagrechten Ueberlauf (${mass.breite} von ${mass.fenster})`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: einstellungen.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
