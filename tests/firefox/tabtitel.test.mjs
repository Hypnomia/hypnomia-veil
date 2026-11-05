// Firefox-Test Phase 5, Auftrag K1 (PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 3): Tab-Titel. Die Seite A liegt im Hauptfenster; ein zweiter Tab B
// (die Einstellungsseite der Erweiterung) kommt nach vorn, dann ist A wirklich verborgen (nur der Vordergrund-Tab gilt als sichtbar). Den Titel
// von A liest der Test im Chrome-Kontext (contentTitle des Tabs), Aenderungen in A loesen Zeitgeber aus, die vorher in A gesetzt wurden
// (Hintergrund-Zeitgeber laufen in Firefox hoechstens im Sekundentakt). Einstellungen, Pack und Pause werden aus B geaendert, ohne A zu zeigen.
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
const SEITE = `${basis}/tabtitel.html`;
const SEITE_OHNE = `${basis}/tabtitel-ohne.html`;
const SEITE_LEER = `${basis}/tabtitel-leer.html`;
const ORIGINAL = 'Fixture title original';
// Dummy-Saetze aus scripts/pack/dummy-inhalte.mjs, Gruppe tabtitel
const DUMMY = ['Test tab title one', 'Test tab title two'];
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2, tabtitel: true, cursor: 'spirale', meldungen: true, besuche: false, zeiten: [] };

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
async function bis(beschreibung, fn, frist = 30_000, takt = 100) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(takt);
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
  if (alle.length > 1) await driver.close();
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

// Aktion auf einer Erweiterungsseite (Einstellungen setzen, Pack importieren), danach zurueck zur Webseite (die dabei wieder sichtbar wird).
async function mitOptionen(fn) {
  await oeffneErweiterung('options.html');
  try {
    return await fn();
  } finally {
    await zurueckZumHaupt();
  }
}
const setzeEinstellungenImTab = (neu) =>
  imSeitenkontext(
    `const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
     await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } });
     return true;`,
    neu,
  );
const loescheEinstellungen = () => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove('einstellungen'); return true;`));
const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();

// Pack importieren und entfernen auf der gerade offenen Einstellungsseite.
async function importiereImTab(pfad) {
  await driver.findElement(By.css('#datei')).sendKeys(pfad);
  await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Erfolgsmeldung', async () => (await text('#meldung')).includes('The pack is in'));
}
async function entferneImTab() {
  await bis('Optionsseite da', async () => (await text('#pack-status').catch(() => '')).length > 0);
  await warte(300);
  if (await sichtbar('#entfernen')) {
    await driver.findElement(By.css('#entfernen')).click();
    await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
    await driver.findElement(By.css('#entfernen-ja')).click();
    await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));
  }
}
const importierePack = (pfad) => mitOptionen(() => importiereImTab(pfad));
const entfernePack = () => mitOptionen(entferneImTab);

// ---------- Tab A und Tab B ----------
async function oeffne(url) {
  await loescheEinstellungen();
  await driver.get(url);
}
// Tab A verlassen: B (Einstellungsseite) kommt nach vorn.
const weg = () => oeffneErweiterung('options.html');
// Zurueck zu A: B schliessen, A auswaehlen. Liefert die Zeit in ms bis der Titel von A gelesen ist (inklusive WebDriver-Aufrufe) und den Titel.
async function zurueck() {
  const t0 = Date.now();
  await driver.close();
  await driver.switchTo().window(hauptFenster);
  const titel = await driver.executeScript('return document.title');
  return { ms: Date.now() - t0, titel };
}
// Titel und Aktivitaet des Tabs, dessen Adresse `teil` enthaelt, aus dem Chrome-Kontext.
async function tabInfo(teil) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeScript(
      `const win = Services.wm.getMostRecentWindow('navigator:browser');
       for (const tab of win.gBrowser.tabs) {
         const b = tab.linkedBrowser;
         if (b.currentURI.spec.includes(arguments[0])) return { titel: b.contentTitle, aktiv: b.docShellIsActive };
       }
       return null;`,
      teil,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}
const titelVon = async (teil) => (await tabInfo(teil))?.titel ?? null;
const istDummy = (t) => DUMMY.includes(t);
const A = 'tabtitel.html';
async function warteDummy(teil = A, frist = 20_000) {
  return bis('Dummy-Satz als Tab-Titel', async () => {
    const t = await titelVon(teil);
    return istDummy(t) ? t : false;
  }, frist, 80);
}
async function warteTitel(erwartet, teil = A, frist = 15_000) {
  return bis(`Tab-Titel "${erwartet}"`, async () => (await titelVon(teil)) === erwartet, frist, 80);
}
// Bleibt der Titel ueber `ms` unveraendert `erwartet`?
async function bleibt(erwartet, ms = 1800, teil = A) {
  const ende = Date.now() + ms;
  let gleich = true;
  while (Date.now() < ende) {
    if ((await titelVon(teil)) !== erwartet) gleich = false;
    await warte(100);
  }
  return gleich;
}
// Zeitgeber in A, im Hauptkontext der Seite als eigenes Skript (der Zeitgeber des WebDriver-Skripts laeuft im Hintergrund nicht verlaesslich);
// laeuft auch im verborgenen Tab, dort hoechstens im Sekundentakt. Das Skript-Element wird sofort wieder entfernt.
const inA = (code, ms) =>
  driver.executeScript(
    `const s = document.createElement('script');
     s.textContent = 'setTimeout(function () { ' + arguments[0] + ' }, ' + arguments[1] + ')';
     document.head.appendChild(s); s.remove();`,
    code,
    ms,
  );
const schnappschuss = () =>
  driver.executeScript(
    `return JSON.stringify({ zahl: document.querySelectorAll('*').length,
      kopf: [...document.head.children].map((e) => e.tagName + (e.tagName === 'TITLE' ? '' : e.outerHTML.length)).join(','),
      koerper: document.body.outerHTML,
      wurzelKinder: [...document.documentElement.children].map((e) => e.tagName).join(',') })`,
  );

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-tabtitel-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const altPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPfad, (await baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', 'pornhub.veil-erwachsen.test');
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
  await warte(1000);

  // 1. Ohne Pack bleibt der Titel
  await oeffne(SEITE);
  await weg();
  pruefe((await tabInfo(A))?.aktiv === false, 'Tab A ist verborgen, sobald B vorn liegt (docShellIsActive)');
  pruefe(await bleibt(ORIGINAL, 1800), 'ohne Pack: der Titel im Hintergrund bleibt das Original');
  await zurueck();

  // 2. Pack importieren
  await importierePack(packPfad);

  // 3. Kernfall
  await oeffne(SEITE);
  await weg();
  let satz = await warteDummy();
  console.log(`firefox K1: Hintergrund-Titel "${satz}"`);
  pruefe(true, 'Kernfall: im Hintergrund steht ein Dummy-Satz');
  let r = await zurueck();
  const wechsel = await driver.executeScript("return document.documentElement.getAttribute('data-wechsel')");
  console.log(`firefox K1: Zeit bis Original ${r.ms} ms (Schliessen von B bis gelesen, inklusive WebDriver), Seite sah beim Wechsel ${wechsel}`);
  pruefe(r.titel === ORIGINAL, `Kernfall: zurueck steht das Original (${r.titel})`);
  pruefe(JSON.parse(wechsel).at(-1) === `visible|${ORIGINAL}`, 'Kernfall: schon im visibilitychange der Seite war das Original zurueck');
  pruefe(r.ms < 3000, 'Kernfall: Original in unter 3 s (Messung enthaelt Tab-Wechsel und WebDriver)');

  // 4. Der Satz wechselt
  await oeffne(SEITE);
  const folge = [];
  for (let i = 0; i < 6; i++) {
    await weg();
    folge.push(await warteDummy());
    const z = await zurueck();
    if (z.titel !== ORIGINAL) pruefe(false, `Zyklus ${i}: Original zurueck (${z.titel})`);
  }
  console.log(`firefox K1: Saetze in Folge ${JSON.stringify(folge)}`);
  pruefe(folge.every((s, i) => i === 0 || s !== folge[i - 1]), 'nie derselbe Satz zweimal hintereinander');
  pruefe(new Set(folge).size === 2, 'beide Saetze kommen vor');

  // 5. Seite aendert den Titel im Hintergrund. Das Zwischenbild (Titel der Seite) dauert nur Millisekunden, wenn Mia schon lange nichts gesetzt
  // hat; darum zaehlt das Abbild des Moduls (Anzahl Aenderungen und Setzungen), gelesen nach der Rueckkehr.
  await oeffne(SEITE);
  await inA(`document.title = '(3) Messages'`, 5000); // Zeitgeber in A setzen, solange A noch vorn ist
  await weg();
  await warteDummy();
  await warte(5000);
  pruefe(istDummy(await titelVon(A)), 'Seite aendert den Titel: danach steht wieder Mias Satz');
  r = await zurueck();
  {
    const ab = JSON.parse(await driver.executeScript("return document.documentElement.getAttribute('data-veil-tabtitel')"));
    console.log(`firefox K1: Titel-Aenderung der Seite: ${ab.aenderungen} Aenderung, ${ab.setzungen} Setzungen`);
    pruefe(ab.aenderungen === 1 && ab.setzungen === 2, `Seite aendert den Titel: eine Aenderung bemerkt, Mias Satz zweimal gesetzt (${ab.aenderungen}/${ab.setzungen})`);
    pruefe(r.titel === '(3) Messages', `Seite aendert den Titel: zurueck steht die neue Fassung der Seite (${r.titel})`);
  }

  // 6. Austausch des title-Elements (Einzelseiten-App)
  await oeffne(SEITE);
  await inA(`const neu = document.createElement('title'); neu.textContent = '(4) Replaced'; document.querySelector('title').replaceWith(neu);`, 5000);
  await weg();
  await warteDummy();
  await warte(5000);
  pruefe(istDummy(await titelVon(A)), 'title-Element ausgetauscht: Mias Satz steht wieder darueber');
  r = await zurueck();
  {
    const ab = JSON.parse(await driver.executeScript("return document.documentElement.getAttribute('data-veil-tabtitel')"));
    pruefe(ab.aenderungen === 1 && ab.setzungen === 2, `title-Element ausgetauscht: eine Aenderung, zwei Setzungen (${ab.aenderungen}/${ab.setzungen})`);
    pruefe(r.titel === '(4) Replaced', `title-Element ausgetauscht: zurueck steht die neue Fassung (${r.titel})`);
  }

  // 7. Flackern: mehr als 10 Aenderungen je Minute, Mia gibt auf
  await oeffne(SEITE);
  await inA(`var i = 0; var id = setInterval(function () { document.title = 'Flicker ' + (++i); if (i >= 14) clearInterval(id); }, 1100);`, 5000);
  await weg();
  await warteDummy();
  await warteTitel('Flicker 14', A, 60_000);
  pruefe(await bleibt('Flicker 14', 2500), 'Flackern: nach dem Aufgeben bleibt der Titel der Seite stehen (kein Wettlauf)');
  r = await zurueck();
  {
    const ab = JSON.parse(await driver.executeScript("return document.documentElement.getAttribute('data-veil-tabtitel')"));
    console.log(`firefox K1: Flackern: ${ab.aenderungen} Aenderungen der Seite, ${ab.setzungen} Setzungen von Mia, aufgegeben=${ab.aufgegeben}`);
    pruefe(ab.aufgegeben === true && ab.aenderungen <= 12, `Flackern: Mia hat aufgegeben (nach ${ab.aenderungen} Aenderungen)`);
  }
  pruefe(r.titel === 'Flicker 14', `Flackern: zurueck steht der Titel der Seite (${r.titel})`);
  await weg();
  await warteDummy();
  pruefe(true, 'Flackern: der naechste Besuch bekommt wieder einen Satz');
  await zurueck();

  // 8. Seite ohne title-Element
  await oeffne(SEITE_OHNE);
  const kopfVorher = await driver.executeScript(`return [...document.head.children].map((e) => e.tagName).join(',')`);
  await weg();
  const titelVorher = await titelVon('tabtitel-ohne.html');
  pruefe(await bleibt(titelVorher, 2500, 'tabtitel-ohne.html'), `ohne title-Element: der Tab-Titel aendert sich nicht (${JSON.stringify(titelVorher)})`);
  await zurueck();
  pruefe((await driver.executeScript(`return document.querySelectorAll('title').length`)) === 0, 'ohne title-Element: Mia hat keines angelegt');
  pruefe((await driver.executeScript(`return [...document.head.children].map((e) => e.tagName).join(',')`)) === kopfVorher, 'ohne title-Element: head unveraendert');
  await inA(`var t = document.createElement('title'); t.textContent = 'Late title'; document.head.appendChild(t);`, 5000);
  await weg();
  await warteDummy('tabtitel-ohne.html');
  pruefe(true, 'ohne title-Element: legt die Seite eines an, kommt der Satz');
  r = await zurueck();
  pruefe(r.titel === 'Late title', `ohne title-Element: zurueck steht der spaete Titel (${r.titel})`);

  // 9. Titel noch leer
  await oeffne(SEITE_LEER);
  await inA(`document.title = 'Late title'`, 7000);
  await weg();
  const leerVorher = await titelVon('tabtitel-leer.html');
  pruefe(await bleibt(leerVorher, 2000, 'tabtitel-leer.html'), 'leerer Titel: Mia setzt nichts, solange die Seite keinen hat');
  await warteDummy('tabtitel-leer.html');
  pruefe(true, 'leerer Titel: sobald die Seite einen hat, kommt der Satz');
  r = await zurueck();
  pruefe(r.titel === 'Late title', `leerer Titel: zurueck steht der Titel der Seite (${r.titel})`);

  // 10. Tab, der verborgen geladen wird (Hintergrund-Tab, etwa Mittelklick)
  await loescheEinstellungen();
  {
    const vorher = await driver.getAllWindowHandles();
    await driver.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript(
        `const w = Services.wm.getMostRecentWindow('navigator:browser');
         w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
        SEITE,
      );
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
    await driver.get('about:blank');
    await bis('Hintergrund-Tab geladen und verborgen', async () => {
      const i = await tabInfo(A);
      return i && i.aktiv === false;
    }, 15_000);
    const t = await warteDummy();
    console.log(`firefox K1: Hintergrund-Tab bekommt "${t}", ohne je sichtbar gewesen zu sein`);
    pruefe(true, 'Hintergrund-Tab bekommt den Satz');
    const neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    await driver.switchTo().window(neu);
    const titelNeu = await driver.executeScript('return document.title');
    pruefe(titelNeu === ORIGINAL, `Hintergrund-Tab: nach dem Auswaehlen steht das Original (${titelNeu})`);
    await driver.close();
    await driver.switchTo().window(hauptFenster);
  }

  // 11. Rahmen und kein neues Element
  await oeffne(SEITE);
  const vor = await schnappschuss();
  // Ein Zeitgeber in A legt mitten im Hintergrund einen Schnappschuss am html-Element ab (nach der Rueckkehr gelesen).
  await driver.executeScript(
    `setTimeout(() => { document.documentElement.setAttribute('data-k1-schnapp', JSON.stringify({ titel: document.title, zahl: document.querySelectorAll('*').length,
      kopf: [...document.head.children].map((e) => e.tagName + (e.tagName === 'TITLE' ? '' : e.outerHTML.length)).join(','), koerper: document.body.outerHTML })); }, 3500)`,
  );
  await weg();
  await warteDummy();
  await warte(3500);
  await zurueck();
  {
    const s = JSON.parse(await driver.executeScript(`return document.documentElement.getAttribute('data-k1-schnapp')`));
    const v = JSON.parse(vor);
    console.log(`firefox K1: Elemente vorher ${v.zahl}, im Hintergrund ${s.zahl}`);
    pruefe(istDummy(s.titel) && s.zahl === v.zahl && s.kopf === v.kopf && s.koerper === v.koerper, 'im Hintergrund: gleiche Elemente, nur der Titel-Text ist Mias Satz');
    pruefe((await schnappschuss()) === vor, 'nach der Rueckkehr: keine Aenderung am Dokument ausser dem Titel-Text');
    const rahmenTitel = await driver.executeScript(`const f = document.getElementById('rahmen').contentDocument; return JSON.stringify([f.title, f.documentElement.getAttribute('data-veil-tabtitel')])`);
    pruefe(rahmenTitel === JSON.stringify(['Frame title original', null]), `Rahmen: Titel unberuehrt und kein Abbild des Moduls (${rahmenTitel})`);
  }

  // 12. Gespeicherte Pause (aus B)
  await oeffne(SEITE);
  await weg();
  await warteDummy();
  let t0 = Date.now();
  await setzeEinstellungenImTab({ pause: true });
  await warteTitel(ORIGINAL);
  console.log(`firefox K1: Pause, Original nach ${Date.now() - t0} ms (inklusive Schreiben und Chrome-Kontext)`);
  pruefe(await bleibt(ORIGINAL, 1200), 'Pause: das Original bleibt');
  await setzeEinstellungenImTab({ pause: false });
  await warteDummy();
  pruefe(true, 'Pause aus: der Satz kommt wieder');
  await zurueck();

  // 13. Lokale Pause (Hintergrund antwortet nie)
  await oeffne(SEITE);
  await inA(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { lokalePause: true } }) }))`, 5000);
  await weg();
  await warteDummy();
  await warteTitel(ORIGINAL);
  pruefe(true, 'lokale Pause: das Original ist wieder da');
  r = await zurueck();
  await weg();
  pruefe(await bleibt(ORIGINAL, 1500), 'lokale Pause: auch der naechste Besuch bekommt keinen Satz');
  await zurueck();

  // 14. Schalter aus
  await oeffne(SEITE);
  await weg();
  await warteDummy();
  await setzeEinstellungenImTab({ kontrolle: { ...KONTROLLE, tabtitel: false } });
  await warteTitel(ORIGINAL);
  pruefe(await bleibt(ORIGINAL, 1200), 'Schalter aus: das Original bleibt');
  await setzeEinstellungenImTab({ kontrolle: { ...KONTROLLE, tabtitel: true } });
  await warteDummy();
  pruefe(true, 'Schalter wieder an: der Satz kommt');
  await zurueck();

  // 15. Pack weg, altes Pack, Dummy-Pack wieder
  await oeffne(SEITE);
  await weg();
  await warteDummy();
  await entferneImTab();
  await warteTitel(ORIGINAL);
  pruefe(true, 'Pack entfernt: das Original ist wieder da');
  await importiereImTab(altPfad);
  pruefe(await bleibt(ORIGINAL, 1500), 'altes Pack ohne Freischaltung: nichts');
  await entferneImTab();
  await importiereImTab(packPfad);
  await warteDummy();
  pruefe(true, 'Dummy-Pack wieder: der Satz kommt');
  await zurueck();

  // 16. Eigene Ausnahme, auch per pushState
  await oeffne(SEITE);
  await weg();
  await warteDummy();
  await setzeEinstellungenImTab({ ausnahmen: ['127.0.0.1'] });
  await warteTitel(ORIGINAL);
  pruefe(await bleibt(ORIGINAL, 1200), 'eigene Ausnahme: das Original bleibt');
  await setzeEinstellungenImTab({ ausnahmen: ['127.0.0.1/sperre'] });
  await warteDummy();
  await zurueck();
  // Einzelseiten-App: Adresse und Titel wechseln zusammen (Firefox 128 kennt keine Navigation API, im verborgenen Tab ruht der Adress-Takt)
  await inA(`history.pushState({}, '', '/sperre/seite'); document.title = 'Spa page';`, 5000);
  await weg();
  await warteDummy();
  await warteTitel('Spa page', 'sperre/seite'); // die Adresse des Tabs ist jetzt /sperre/seite
  pruefe(await bleibt('Spa page', 2500, 'sperre/seite'), 'pushState auf eine Ausnahme mit Titelwechsel: der Titel der Seite bleibt stehen');
  r = await zurueck();
  pruefe(r.titel === 'Spa page', `pushState auf eine Ausnahme: zurueck steht ihr Titel (${r.titel})`);

  // 17. pagehide
  await oeffne(SEITE);
  await inA(`window.dispatchEvent(new Event('pagehide'))`, 5000);
  await weg();
  await warteDummy();
  await warteTitel(ORIGINAL);
  pruefe(true, 'pagehide: steht Mias Satz, kommt das Original zurueck');
  await zurueck();
  // 18. Erwachsenenseite: das Titel-Modul (Kommentar vor dem Titel) und K1 streiten nicht
  await loescheEinstellungen();
  await mitOptionen(() => setzeEinstellungenImTab({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } }));
  await driver.get(`http://pornhub.veil-erwachsen.test:${port}/erwachsen-titel.html`);
  const MIT_KOMMENTAR = 'Test title: Original tab title';
  await bis('Titel mit Kommentar sichtbar', async () => (await driver.executeScript('return document.title')) === MIT_KOMMENTAR, 20_000);
  const AE = 'erwachsen-titel.html';
  for (let i = 0; i < 2; i++) {
    await weg();
    const sz = await warteDummy(AE);
    await warte(4000);
    pruefe(await bleibt(sz, 1500, AE), `Erwachsenenseite: im Hintergrund bleibt Mias Tab-Satz stehen, kein Kommentar davor (Besuch ${i + 1})`);
    r = await zurueck();
    pruefe(r.titel === MIT_KOMMENTAR, `Erwachsenenseite: zurueck steht der Titel mit Kommentar (${r.titel})`);
    await warte(1500);
    pruefe((await driver.executeScript('return document.title')) === MIT_KOMMENTAR, 'Erwachsenenseite: der Titel mit Kommentar bleibt stehen');
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: tabtitel.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
