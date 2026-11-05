// Firefox-Test Phase 5, Auftrag Z2 (PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 7): Pflicht-Besuche. Der Testhaken `veil-test` loest die Pruefung sofort
// aus (als waere der Besuch faellig), der Hintergrund oeffnet im Testbau `about:blank#veil-besuch` statt einer echten Adresse. Geprueft: Hinweis,
// 5 s, neuer Tab neben dem Absender, Adresse aus links.json, 2-Stunden-Grenze im Hintergrund, "Not now", nichts beim Tippen, im Vollbild, bei
// verborgenem Tab, mit Schalter aus, ohne Pack, in der Pause, in Rahmen, Plan; Klicks auf den Hinweis erreichen die Seite nicht.
// Firefox zaehlt nur den sichtbaren Tab als sichtbar: gewartet wird immer im Tab der Seite.
import { Builder, By, Key } from 'selenium-webdriver';
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
  console.error('firefox: Zeitlimit von 600 s ueberschritten');
  process.exit(1);
}, 600_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const SEITE = `${basis}/besuche.html`;
const DUMMY_SATZ = 'Test visit line.';
const TEST_ADRESSE = 'about:blank#veil-besuch';
const H = 3_600_000;
const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: false, leerlaufMinuten: 2, besuche: true };

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

// Aktion auf einer Erweiterungsseite (Einstellungen setzen, Speicher lesen), danach zurueck zur Webseite. Standard ist die Popup-Seite: die
// Optionsseite gleicht das Pack beim Laden mit der Datenbank ab und schreibt den Import-Zeitpunkt zurueck, das wuerde Plaene "von vor dem Import" aendern.
async function mitOptionen(fn, seite = 'popup.html') {
  await oeffneErweiterung(seite);
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
  }, 'options.html');
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
  }, 'options.html');


const attrVon = (name) => driver.executeScript((n) => document.documentElement.getAttribute(n), name);
const abbildVon = async () => {
  const roh = await attrVon('data-veil-besuch');
  return roh ? JSON.parse(roh) : null;
};
const sende = (besuch) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ besuch }));
async function loeseAus(besuch = { faellig: true }) {
  const vorher = (await abbildVon())?.nr ?? 0;
  await sende(besuch);
  await bis('Antwort des Moduls', async () => ((await abbildVon())?.nr ?? 0) > vorher, 15_000);
  return abbildVon();
}
const warteEnde = async (frist = 20_000) => {
  await bis('Hinweis zu Ende', async () => (await abbildVon())?.phase === 'ende', frist);
  return abbildVon();
};
async function erwarteAbgelehnt(grund, text, besuch = { faellig: true }) {
  const a = await loeseAus(besuch);
  pruefe(a.phase === 'abgelehnt' && a.abgelehnt === grund, `${text} (abgelehnt=${a.abgelehnt})`);
}
async function neueSeite() {
  await driver.get(SEITE);
  await warte(1500);
}
const setzeKontrolle = (teil = {}) => setzeEinstellungen({ kontrolle: { ...KONTROLLE, ...teil } });
const setzeSpeicher = (werte) => mitOptionen(() => imSeitenkontext(`await api.storage.local.set(args[0]); return true;`, werte));
const loescheSpeicher = (...k) => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove(args[0]); return true;`, k));
const liesSpeicher = (k) => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]];`, k));
const taste = (k) => driver.actions({ async: true }).sendKeys(k).perform();
const gesehen = () => driver.executeScript(`return { ...window.gesehen }`);
const klickAuf = (x, y) => driver.actions({ async: true }).move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).click().perform();
// Nachricht an den Hintergrund aus einer Erweiterungsseite (Absender: Frame 0 des Options-Tabs)
const anHintergrund = (n) => mitOptionen(() => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, n));
// Alle Tabs aus Sicht des Browsers (Index, Eroeffner, aktiv) und die Handles der Webdriver-Fenster
const tabsListe = () => mitOptionen(() => imSeitenkontext(`return (await api.tabs.query({})).map((t) => ({ id: t.id, index: t.index, openerTabId: t.openerTabId, active: t.active, windowId: t.windowId }));`));
// Die vom Besuch geoeffneten Tabs: Handles ausser dem Haupt-Tab. Liefert die Adressen (about:blank#veil-besuch) und schliesst sie.
async function besuchsHandles() {
  return (await driver.getAllWindowHandles()).filter((h) => h !== hauptFenster);
}
async function schliesseBesuche() {
  const gesehenUrls = [];
  for (const h of await besuchsHandles()) {
    await driver.switchTo().window(h);
    gesehenUrls.push(await driver.executeScript('return location.href'));
    await driver.close();
  }
  await driver.switchTo().window(hauptFenster);
  return gesehenUrls;
}
const linkWerte = Object.entries(JSON.parse(readFileSync(path.join(wurzel, 'data/links.json'), 'utf8'))).filter(([k]) => k !== 'LIES-MICH').map(([, v]) => v);

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-besuche-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
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
  const loescheAlles = () => loescheSpeicher('einstellungen', 'besuchZeitplan', 'besuchZuletzt');
  await loescheAlles();
  await warte(1000);

  // 1. Ohne Pack
  await setzeKontrolle();
  await neueSeite();
  await erwarteAbgelehnt('kein-pack', 'ohne Pack zeigt sich nichts');
  let antwort = await anHintergrund({ ziel: 'hintergrund', typ: 'besuch' });
  pruefe(antwort?.ok === false && antwort.grund === 'kein-pack', `Hintergrund ohne Pack lehnt ab (${JSON.stringify(antwort)})`);

  // 2. Pack importieren, Schalter ab Werk aus
  await importierePack(packPfad);
  await loescheAlles();
  await neueSeite();
  await erwarteAbgelehnt('aus', 'Schalter ab Werk aus: nichts');
  antwort = await anHintergrund({ ziel: 'hintergrund', typ: 'besuch' });
  pruefe(antwort?.ok === false && antwort.grund === 'aus', `Hintergrund mit Schalter aus lehnt ab (${JSON.stringify(antwort)})`);
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE }, pause: true });
  antwort = await anHintergrund({ ziel: 'hintergrund', typ: 'besuch' });
  pruefe(antwort?.ok === false && antwort.grund === 'pause', `Hintergrund in der Pause lehnt ab (${JSON.stringify(antwort)})`);
  await setzeEinstellungen({ pause: false, ausnahmen: [] });
  pruefe((await besuchsHandles()).length === 0, 'bis hier kein Besuchs-Tab');

  // 3. Hinweis, 5 s, neuer Tab neben dem Absender, Adresse aus links.json, neuer Plan
  await setzeKontrolle();
  await neueSeite();
  let t0 = Date.now();
  let a = await loeseAus({ faellig: true });
  pruefe(a.phase === 'hinweis' && a.satz === DUMMY_SATZ, `Hinweis steht mit dem Satz aus dem Pack (${a.phase}, ${a.satz})`);
  const vp = await driver.executeScript('return { w: innerWidth, h: innerHeight }');
  console.log(`firefox Z2: Hinweis Host ${JSON.stringify(a.host)}, Fenster ${vp.w}x${vp.h}`);
  pruefe(Math.abs(a.host.x + a.host.w / 2 - vp.w / 2) < 4 && a.host.y + a.host.h > vp.h - 60 && a.host.w < vp.w, 'Hinweis: unten mittig, kleine Karte');
  const aufbau = await driver.executeScript(`const h = document.documentElement.lastElementChild; return { tag: h.tagName.toLowerCase(), shadow: !!h.shadowRoot, imBody: !!document.body.querySelector('mia-hinweis'), text: document.body.textContent.includes('Not now') };`);
  pruefe(aufbau.tag === 'mia-hinweis' && !aufbau.shadow && !aufbau.imBody && !aufbau.text, 'Hinweis: Host am Ende von html, geschlossene Shadow Root, nichts im Seiten-DOM');
  pruefe((await besuchsHandles()).length === 0, 'waehrend des Hinweises noch kein Tab');
  a = await warteEnde();
  console.log(`firefox Z2: Hinweisdauer ${a.dauerMs} ms, gesamt ${Date.now() - t0} ms, Ergebnis ${a.ergebnis}, Adresse ${a.url}`);
  pruefe(a.ergebnis === 'ok', `Besuch geoeffnet (${JSON.stringify(a)})`);
  pruefe(a.dauerMs >= 4900 && a.dauerMs < 8000, `Hinweis etwa 5 s (${a.dauerMs} ms)`);
  pruefe(linkWerte.includes(a.url), 'Adresse stammt aus data/links.json');
  await bis('Tab da', async () => (await besuchsHandles()).length >= 1, 8000);
  {
    const tabs = await tabsListe();
    const neu = tabs.find((t) => t.openerTabId !== undefined);
    const absender = tabs.find((t) => t.id === neu?.openerTabId);
    console.log(`firefox Z2: neuer Tab Index ${neu?.index}, Absender Index ${absender?.index}, Tab-Id ${neu?.id} (Antwort ${a.tabId})`);
    pruefe(!!neu && !!absender && neu.index === absender.index + 1 && neu.windowId === absender.windowId, 'neuer Tab liegt direkt neben dem Absender, im selben Fenster, aktiv');
    pruefe(neu?.id === a.tabId, 'Antwort nennt die Tab-Id des neuen Tabs');
  }
  const urls = await schliesseBesuche();
  pruefe(urls.length === 1 && urls[0] === TEST_ADRESSE, `der neue Tab hat die Testadresse (${JSON.stringify(urls)})`);
  const zuletzt = await liesSpeicher('besuchZuletzt');
  const plan = await liesSpeicher('besuchZeitplan');
  pruefe(Math.abs(Date.now() - zuletzt) < 30_000, 'besuchZuletzt steht');
  console.log(`firefox Z2: neuer Plan, Abstand ${(plan.abstandMs / H).toFixed(2)} h`);
  pruefe(Math.abs(Date.now() - plan.zuletzt) < 30_000 && plan.abstandMs >= 2 * H && plan.abstandMs <= 4 * H, 'neuer Plan ab jetzt, 2 bis 4 Stunden');

  // 4. Zweiter Versuch innerhalb von 2 Stunden
  await neueSeite();
  await setzeSpeicher({ besuchZuletzt: Date.now() - 30 * 60_000 });
  await loeseAus({ faellig: true, hinweisMs: 400 });
  a = await warteEnde();
  pruefe(a.ergebnis === 'abgelehnt' && a.grund === 'zu-frueh', `2-Stunden-Grenze: abgelehnt (${a.ergebnis}, ${a.grund})`);
  pruefe((await besuchsHandles()).length === 0, 'kein zweiter Tab');
  await setzeSpeicher({ besuchZuletzt: Date.now() - 2 * H - 5000 });
  await loeseAus({ faellig: true, hinweisMs: 400 });
  a = await warteEnde();
  pruefe(a.ergebnis === 'ok', `genau 2 Stunden her: erlaubt (${a.ergebnis}, ${a.grund})`);
  await schliesseBesuche();
  antwort = await anHintergrund({ ziel: 'hintergrund', typ: 'besuch-test', vergiss: true });
  console.log(`firefox Z2: besuch-test: ${JSON.stringify(antwort)}`);
  pruefe(antwort?.ok === true && (await liesSpeicher('besuchZuletzt')) == null, 'Testhaken vergisst den letzten Besuch');

  // 5. "Not now": nichts offen, neuer Plan, Klicks auf den Hinweis erreichen die Seite nicht
  await neueSeite();
  await loescheSpeicher('besuchZeitplan');
  a = await loeseAus({ faellig: true, hinweisMs: 9000 });
  const fokusVor = await driver.executeScript('return document.activeElement && document.activeElement.tagName');
  await klickAuf(a.host.x + 6, a.host.y + a.host.h / 2);
  await warte(300);
  pruefe((await abbildVon()).phase === 'hinweis', 'Klick neben dem Knopf: Hinweis bleibt');
  await klickAuf(a.knopf.x + a.knopf.w / 2, a.knopf.y + a.knopf.h / 2);
  a = await warteEnde(6000);
  const g1 = await gesehen();
  console.log(`firefox Z2: Not now: ${a.ergebnis} nach ${a.dauerMs} ms, Ereignisse der Seite ${JSON.stringify(g1)}`);
  pruefe(a.ergebnis === 'nicht-jetzt', 'Not now beendet den Hinweis');
  pruefe(Object.keys(g1).length === 0, 'Klicks auf den Hinweis erreichen die Seite nicht (auch kein focusin)');
  const fokusNach = await driver.executeScript('return document.activeElement && document.activeElement.tagName');
  pruefe(fokusVor === fokusNach, `Fokus der Seite bleibt (${fokusVor} / ${fokusNach})`);
  await bis('Plan geschrieben', async () => (await abbildVon())?.geplant === true, 5000);
  pruefe(Math.abs(Date.now() - (await liesSpeicher('besuchZeitplan')).zuletzt) < 30_000, 'Not now: neuer Plan ab jetzt');
  await warte(500);
  pruefe((await besuchsHandles()).length === 0 && (await liesSpeicher('besuchZuletzt')) == null, 'Not now: kein Tab, kein besuchZuletzt');
  await klickAuf(50, 50);
  await bis('Klick kommt an', async () => ((await gesehen()).click ?? 0) > 0, 3000);
  pruefe(true, 'Gegenprobe: ein Klick auf die Seite kommt an');

  // 6. Nichts beim Tippen
  await loescheSpeicher('besuchZeitplan', 'besuchZuletzt');
  await neueSeite();
  const planVor = JSON.stringify(await liesSpeicher('besuchZeitplan'));
  await driver.executeScript(() => document.getElementById('feld').focus());
  await erwarteAbgelehnt('eingabe', 'Fokus im Eingabefeld: nichts');
  await driver.executeScript(() => document.getElementById('rahmen').contentDocument.getElementById('innen').focus());
  await erwarteAbgelehnt('eingabe', 'Fokus im Rahmen: nichts');
  await driver.executeScript(() => { document.activeElement.blur(); document.getElementById('knopf').focus(); });
  await taste('a');
  await warte(300);
  await erwarteAbgelehnt('eingabe', 'Taste vor 0,3 s: nichts');
  await warte(2300);
  await loeseAus({ faellig: true, hinweisMs: 2500 });
  await warte(300);
  await driver.executeScript('window.gesehen = {}');
  await taste('b');
  a = await warteEnde(6000);
  console.log(`firefox Z2: Taste im Hinweis: ${a.ergebnis} (${a.grund}) nach ${a.dauerMs} ms`);
  pruefe(a.ergebnis === 'abbruch' && a.grund === 'taste', 'eine Taste im Hinweis bricht ab');
  pruefe(((await gesehen()).keydown ?? 0) > 0, 'die Taste gehoert der Seite');
  await warte(2300);
  await loeseAus({ faellig: true, hinweisMs: 2500 });
  await driver.executeScript(() => document.getElementById('feld').focus());
  a = await warteEnde(6000);
  pruefe(a.ergebnis === 'abbruch' && a.grund === 'eingabe', `Fokus ins Eingabefeld im Hinweis bricht ab (${a.grund})`);
  await warte(2800);
  pruefe((await besuchsHandles()).length === 0 && JSON.stringify(await liesSpeicher('besuchZeitplan')) === planVor && (await liesSpeicher('besuchZuletzt')) == null, 'Abbruch ohne Tab und ohne neuen Plan');

  // 7. Vollbild
  await neueSeite();
  await driver.findElement(By.css('#vollbild')).click();
  await bis('Vollbild', () => driver.executeScript('return !!document.fullscreenElement'), 6000).catch(() => false);
  const imVollbild = await driver.executeScript('return !!document.fullscreenElement');
  if (imVollbild) {
    await erwarteAbgelehnt('vollbild', 'im Vollbild: nichts');
    await driver.executeScript('document.exitFullscreen()');
    await bis('Vollbild zu', async () => !(await driver.executeScript('return !!document.fullscreenElement')), 6000);
    await warte(2300);
    await loeseAus({ faellig: true, hinweisMs: 4000 });
    await driver.findElement(By.css('#vollbild')).click();
    a = await warteEnde(8000);
    pruefe(a.ergebnis === 'abbruch' && a.grund === 'vollbild', `Vollbild im Hinweis bricht ab (${a.grund})`);
    await driver.executeScript('document.exitFullscreen()').catch(() => {});
  } else console.log('firefox Z2: Vollbild in dieser Umgebung nicht erreichbar, uebersprungen');
  pruefe((await besuchsHandles()).length === 0, 'Vollbild: kein Tab');

  // 8. Tab verborgen: Hinweis bricht ab, Takt ruht
  await neueSeite();
  await warte(2300);
  await loeseAus({ faellig: true, hinweisMs: 9000 });
  await oeffneErweiterung('options.html');
  await warte(500);
  await zurueckZumHaupt();
  a = await bis('Abbild', async () => {
    const x = await abbildVon();
    return x?.phase === 'ende' ? x : null;
  }, 6000);
  console.log(`firefox Z2: verborgener Tab: ${a.ergebnis} (${a.grund})`);
  pruefe(a.ergebnis === 'abbruch' && (a.grund === 'verborgen' || a.grund === 'fokus-weg'), `verborgener Tab bricht den Hinweis ab (${a.grund})`);
  pruefe((await besuchsHandles()).length === 0, 'verborgener Tab: kein Besuch');

  // 9. Pause und Schalter aus im Hinweis, Ausnahme
  await neueSeite();
  await setzeEinstellungen({ pause: true });
  await warte(300);
  await erwarteAbgelehnt('nicht-erlaubt', 'Pause: nichts');
  await setzeEinstellungen({ pause: false, ausnahmen: ['127.0.0.1'] });
  await warte(300);
  await erwarteAbgelehnt('nicht-erlaubt', 'eigene Ausnahme: nichts');
  await setzeEinstellungen({ ausnahmen: [] });
  await warte(2400);
  for (const wie of ['pause', 'aus']) {
    a = await loeseAus({ faellig: true, hinweisMs: 9000 });
    pruefe(a.phase === 'hinweis', `${wie}: Hinweis steht (${a.phase}, ${a.abgelehnt})`);
    t0 = Date.now();
    // Aus der Seite heraus (Testhaken), ohne Tabwechsel: der Fokusverlust bricht sonst zuerst ab
    await sende(wie === 'pause' ? { einstellungen: { pause: true } } : { einstellungen: { kontrolle: { besuche: false } } });
    a = await warteEnde(6000);
    console.log(`firefox Z2: ${wie} im Hinweis: ${a.ergebnis} (${a.grund}) nach ${Date.now() - t0} ms`);
    pruefe(a.ergebnis === 'abbruch' && a.grund === 'einstellung', `${wie} im Hinweis bricht ab (${a.grund})`);
    await setzeEinstellungen({ pause: false });
    await setzeKontrolle();
    await warte(2400);
  }

  // 10. Rahmen
  await neueSeite();
  await driver.switchTo().frame(await driver.findElement(By.css('#rahmen')));
  await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ besuch: { faellig: true } }) }))`);
  await warte(1500);
  const imRahmen = await driver.executeScript(`return { abbild: document.documentElement.getAttribute('data-veil-besuch'), hinweis: document.querySelectorAll('mia-hinweis').length, status: document.documentElement.hasAttribute('data-veil-status') }`);
  await driver.switchTo().defaultContent();
  pruefe(imRahmen.abbild === null && imRahmen.hinweis === 0, 'nichts in Rahmen: das Modul laeuft nur in der obersten Seite');
  pruefe(imRahmen.status === true, 'Gegenprobe: das Content-Script lief im Rahmen sehr wohl');

  // 11. Plan
  await neueSeite();
  await loescheSpeicher('besuchZeitplan');
  const jetzt = Date.now();
  a = await loeseAus({ takt: true, jetzt });
  let p = await liesSpeicher('besuchZeitplan');
  pruefe(a.abgelehnt === 'nicht-faellig' && p.zuletzt === jetzt && p.abstandMs >= 2 * H && p.abstandMs <= 4 * H, 'Plan: fehlender Plan ab jetzt, 2 bis 4 Stunden');
  a = await loeseAus({ takt: true, jetzt: jetzt + H });
  pruefe(a.abgelehnt === 'nicht-faellig' && (await liesSpeicher('besuchZeitplan')).zuletzt === jetzt, 'Plan: nach 1 Stunde nicht faellig, unveraendert');
  {
    const imp = (await liesSpeicher('pack')).importiert;
    await setzeSpeicher({ besuchZeitplan: { zuletzt: imp - 6 * H, abstandMs: 2 * H } });
    a = await loeseAus({ takt: true, jetzt: imp + 1000 });
    pruefe(a.abgelehnt === 'nicht-faellig' && (await liesSpeicher('besuchZeitplan')).zuletzt === imp + 1000, 'Plan von vor dem Import gilt als fehlend');
    // Die Vorbereitung laeuft in der Popup-Seite: die Optionsseite gleicht das Pack beim Laden mit der Datenbank ab und schreibt den Import-Zeitpunkt zurueck.
    await oeffneErweiterung('popup.html');
    try {
      await imSeitenkontext(`const p = (await api.storage.local.get('pack')).pack; await api.storage.local.set({ pack: { ...p, importiert: 1 } }); await api.storage.local.set({ besuchZeitplan: { zuletzt: Date.now() - 5 * 3600000, abstandMs: 7200000 } }); return true;`);
    } finally {
      await zurueckZumHaupt();
    }
  }
  await neueSeite();
  a = await loeseAus({ takt: true, hinweisMs: 300 });
  pruefe(a.phase === 'hinweis', `Plan: faellig zeigt den Hinweis (${a.phase}, ${a.abgelehnt})`);
  a = await warteEnde();
  pruefe(a.ergebnis === 'ok', `Plan: faelliger Besuch geht durch (${a.ergebnis}, ${a.grund})`);
  pruefe(Math.abs(Date.now() - (await liesSpeicher('besuchZeitplan')).zuletzt) < 30_000, 'Plan: danach neuer Plan ab jetzt');
  await schliesseBesuche();

  // 12. Schalter gerade eingeschaltet; Zeitgeber nur nach dem Testereignis
  await setzeKontrolle({ besuche: false });
  await setzeSpeicher({ besuchZeitplan: { zuletzt: Date.now() - 5 * H, abstandMs: 2 * H } });
  await neueSeite();
  await warte(500);
  await setzeKontrolle({ besuche: true });
  await warte(600);
  a = await loeseAus({ takt: true });
  pruefe(a.abgelehnt === 'nicht-faellig' && Math.abs(Date.now() - (await liesSpeicher('besuchZeitplan')).zuletzt) < 30_000, 'gerade eingeschaltet: alter Plan zaehlt neu ab jetzt');
  await setzeSpeicher({ besuchZeitplan: { zuletzt: Date.now() - 5 * H, abstandMs: 2 * H } });
  await warte(1500);
  pruefe((await abbildVon()).phase === 'abgelehnt', 'Testbau: der Zeitgeber laeuft nicht von selbst');
  await sende({ taktMs: 200 });
  await bis('Hinweis vom Zeitgeber', async () => (await abbildVon())?.phase === 'hinweis', 10_000);
  pruefe(true, 'nach taktMs zeigt der Zeitgeber den faelligen Besuch');
  await sende({ abbruch: true });
  await bis('Abbruch', async () => (await abbildVon())?.phase === 'ende', 5000);
  pruefe((await besuchsHandles()).length === 0, 'Abbruch: kein Tab');

  // 13. Lokale Pause: im Hinweis sofortiger Abbau, danach nichts
  await neueSeite();
  await warte(1500);
  a = await loeseAus({ faellig: true, hinweisMs: 9000 });
  pruefe(a.phase === 'hinweis', 'Hinweis steht vor der lokalen Pause');
  t0 = Date.now();
  await sende({ lokalePause: true });
  a = await warteEnde(5000);
  console.log(`firefox Z2: lokale Pause im Hinweis: ${a.ergebnis} (${a.grund}), Abbau nach ${Date.now() - t0} ms`);
  pruefe(a.ergebnis === 'abbruch' && a.grund === 'pause', `lokale Pause bricht den Hinweis ab (${a.grund})`);
  await erwarteAbgelehnt('nicht-erlaubt', 'nach der lokalen Pause nichts mehr');
  pruefe(!((await liesSpeicher('einstellungen')) ?? {}).pause, 'lokale Pause: gespeichert ist keine');

  // 14. Zwei gleichzeitige Anfragen: genau eine kommt durch
  await neueSeite();
  await loescheSpeicher('besuchZuletzt');
  {
    const zwei = await mitOptionen(() => imSeitenkontext(`return await Promise.all([1, 2].map(() => api.runtime.sendMessage(args[0])));`, { ziel: 'hintergrund', typ: 'besuch' }));
    console.log(`firefox Z2: zwei gleichzeitige Anfragen: ${JSON.stringify(zwei.map((z) => (z.ok ? 'ok' : z.grund)))}`);
    pruefe(zwei.filter((z) => z.ok).length === 1 && zwei.filter((z) => !z.ok && ['zu-frueh', 'tab-nicht-aktiv'].includes(z.grund)).length === 1, 'zwei gleichzeitige Anfragen: genau ein Besuch');
    await schliesseBesuche();
  }

  // 15. Hintergrund sieht Fenster ohne Fokus und im Vollbild (Antwort, die die Seite nicht kennt)
  await neueSeite();
  await loescheSpeicher('besuchZuletzt');
  {
    await oeffneErweiterung('popup.html');
    const pop = await driver.getWindowHandle();
    await imSeitenkontext(`window.__a = null; setTimeout(() => api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' }).then((r) => { window.__a = r; }), 2500); return true;`);
    await driver.switchTo().newWindow('window');
    await warte(4500);
    await driver.close();
    await driver.switchTo().window(pop);
    const ohneFokus = await imSeitenkontext(`return window.__a;`);
    console.log(`firefox Z2: Hintergrund, Fenster ohne Fokus: ${JSON.stringify(ohneFokus)}`);
    pruefe(ohneFokus && ohneFokus.ok === false && ohneFokus.grund === 'kein-fokus', `Fenster ohne Fokus: der Hintergrund lehnt mit kein-fokus ab (${JSON.stringify(ohneFokus)})`);
    const voll = await imSeitenkontext(
      `const w = await api.windows.getCurrent(); await api.windows.update(w.id, { state: 'fullscreen' }); await new Promise((r) => setTimeout(r, 2000));
       const stand = (await api.windows.get(w.id)).state; const r = await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'besuch' });
       await api.windows.update(w.id, { state: 'normal' }); return { stand, r };`,
    );
    console.log(`firefox Z2: Hintergrund, Fenster im Vollbild: ${JSON.stringify(voll)}`);
    if (voll.stand === 'fullscreen') pruefe(voll.r.ok === false && voll.r.grund === 'vollbild', `Fenster im Vollbild: der Hintergrund lehnt ab (${JSON.stringify(voll.r)})`);
    else console.log(`firefox Z2: UEBERSPRUNGEN: Vollbild des Fensters nicht erreicht (Stand ${voll.stand})`);
    await zurueckZumHaupt();
    await schliesseBesuche();
  }

  // 16. Pack veraendern im Hinweis (ohne Tabwechsel), danach entfernen
  await neueSeite();
  await warte(1500);
  a = await loeseAus({ faellig: true, hinweisMs: 20_000 });
  pruefe(a.phase === 'hinweis', 'Hinweis steht vor der Pack-Aenderung');
  await sende({ packAnstossen: true });
  a = await warteEnde(10_000);
  pruefe(a.ergebnis === 'abbruch' && a.grund === 'pack', `Pack geaendert im Hinweis: Abbruch (${a.grund})`);
  await entfernePack();
  await neueSeite();
  await erwarteAbgelehnt('kein-pack', 'danach ohne Pack nichts mehr');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: besuche.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
