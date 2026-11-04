// Firefox-Test Phase 4, Auftrag T (PHASE-4-BAUPLAN Abschnitt 3): Titel mit Mias Kommentar. Kartentitel, Seitentitel und Tab-Titel werden zum
// Satz der Pack-Gruppe `titel` (Dummy: `Test title: {{title}}`), lange Titel gekuerzt, Pause stellt sofort zurueck, die Seite schreibt neu, ohne
// Pack oder Freischaltung oder Liste keine Aenderung, kein innerHTML. Die Seiten laufen auf *.veil-erwachsen.test (nur im Testbau); Firefox loest
// die genauen Hosts ueber die Einstellung network.dns.localDomains auf (kein Platzhalter). Firefox zaehlt nur den sichtbaren Tab als sichtbar:
// gewartet wird immer im Tab der Seite, erst danach geht es kurz in einen Erweiterungstab.
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
import { DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 300 s ueberschritten');
  process.exit(1);
}, 300_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const HOSTS = ['pornhub', 'xvideos', 'irgendeine'].map((n) => `${n}.veil-erwachsen.test`);
const seite = (name, datei = 'erwachsen-titel.html') => `http://${name}.veil-erwachsen.test:${port}/${datei}`;

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

const textVon = (id) => driver.executeScript((i) => document.getElementById(i).textContent, id);
const attrVon = (id, name) => driver.executeScript((i, n) => document.getElementById(i).getAttribute(n), id, name);
const tabTitel = () => driver.executeScript(() => document.title);
const imSeitenfenster = (fn, ...a) => driver.executeScript(fn, ...a);
const bisText = (beschreibung, id, soll, frist = 20_000) => bis(beschreibung, async () => (await textVon(id)) === soll, frist);
const bisTab = (beschreibung, soll, frist = 20_000) => bis(beschreibung, async () => (await tabTitel()) === soll, frist);
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const ORIGINAL_T3 = 'This is a very long original card title that goes on and on far beyond sixty characters in total';

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-titel-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const altPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPfad, (await baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);
  const mehrTexte = { ...DUMMY_TEXTE, gruppen: { ...DUMMY_TEXTE.gruppen, titel: ['Alpha {{title}}', 'Beta {{title}}', 'Gamma {{title}}'] } };
  const mehrPfad = path.join(ordner, 'mehr.miapack');
  await writeFile(mehrPfad, (await baueDummyPack({ texte: mehrTexte, id: 'mehr' })).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', HOSTS.join(','));
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

  // 1. Ohne Pack: nichts aendert sich
  await warte(1500);
  await driver.get(seite('pornhub'));
  await warte(2000);
  pruefe((await textVon('t1')) === 'Original card one' && (await tabTitel()) === 'Original tab title' && (await textVon('seitentitel-text')) === 'Original page title', 'ohne Pack: Karten, Seitentitel und Tab-Titel bleiben');

  // 2. Pack importieren
  await importierePack(packPfad);

  // 3. Pornhub: Karten, Seitentitel, Tab-Titel, Link-Titel, Symbol
  await driver.get(seite('pornhub'));
  await bisText('Karte 1 ersetzt', 't1', 'Test title: Original card one');
  pruefe((await textVon('t2')) === 'Test title: Original card two', 'Pornhub: zweite Karte ersetzt');
  pruefe((await textVon('seitentitel-text')) === 'Test title: Original page title', 'Pornhub: Seitentitel ersetzt');
  pruefe((await textVon('symbol')) === '*' && (await driver.executeScript(() => document.getElementById('seitentitel').querySelector('i#symbol') !== null)), 'Pornhub: Symbol neben dem Titel bleibt');
  await bisTab('Tab-Titel ersetzt', 'Test title: Original tab title');
  pruefe((await attrVon('t1', 'title')) === 'Test title: Original card one' && (await attrVon('t3', 'title')) === null, 'Pornhub: Attribut title am Link ersetzt, fehlendes bleibt fehlend');
  pruefe((await textVon('t7')) === 'Test title: Foo bar baz', 'Pornhub: Titel aus mehreren Textknoten als Ganzes ersetzt');
  pruefe((await textVon('dauer8')) === '10 min' && (await driver.executeScript(() => document.getElementById('t8').firstChild.nodeValue)) === 'Test title: Wow', 'Pornhub: Laufzeit neben dem Titel bleibt');
  pruefe((await textVon('t6')) === 'Not a title element', 'Pornhub: Element ausserhalb des Selektors bleibt');
  pruefe((await textVon('seitentitel-xv')) === 'Original xvideos page title' && (await textVon('t5')) === 'Original xvideos card', 'Pornhub: XVideos-Titel gehoeren nicht zum Adapter');

  // 4. Lange Titel gekuerzt
  const lang = await textVon('t3');
  console.log(`firefox T: gekuerzt ${JSON.stringify(lang)}`);
  pruefe(lang.startsWith('Test title: This is a very long original card title') && lang.endsWith('…') && lang.length <= 'Test title: '.length + 61 && !lang.includes('in total'), 'lange Titel auf etwa 60 Zeichen gekuerzt');

  // 5. Kein innerHTML
  pruefe((await textVon('t4')) === 'Test title: <b>bold</b> <img src=x onerror=window.__xss=1> title', 'Titel mit <b> bleibt Text');
  pruefe((await driver.executeScript(() => document.getElementById('t4').children.length)) === 0 && (await driver.executeScript(() => window.__xss ?? null)) === null, 'kein Element, kein Skript aus dem Titel');

  // 6. Pause und Ende der Pause
  await setzeEinstellungen({ pause: true });
  await bisText('Pause: Karte zurueck', 't1', 'Original card one', 8_000);
  await bisTab('Pause: Tab-Titel zurueck', 'Original tab title', 8_000);
  pruefe((await textVon('seitentitel-text')) === 'Original page title' && (await textVon('t3')) === ORIGINAL_T3 && (await attrVon('t1', 'title')) === 'Original card one', 'Pause: Seitentitel, langer Titel und Link-Titel zurueck');
  await driver.executeScript(() => window.schreibeKarteNeu('t2', 'Pause card'));
  await warte(500);
  pruefe((await textVon('t2')) === 'Pause card', 'Pause: neu geschriebener Text bleibt unveraendert');
  await setzeEinstellungen({ pause: false });
  await bisText('Ende der Pause: Karte 1', 't1', 'Test title: Original card one');
  await bisText('Ende der Pause: Karte 2', 't2', 'Test title: Pause card');
  await bisTab('Ende der Pause: Tab-Titel', 'Test title: Original tab title');

  // 7. Die Seite schreibt neu
  await driver.executeScript(() => window.schreibeKarteNeu('t2', 'Fresh card text'));
  await bisText('Neu geschriebene Karte', 't2', 'Test title: Fresh card text');
  await driver.executeScript(() => window.setzeTabTitel('Fresh tab title'));
  await bisTab('Neu gesetzter Tab-Titel', 'Test title: Fresh tab title');
  const neueId = await driver.executeScript(() => window.neueKarte('Late loaded card'));
  await bisText('Neue Karte (Endlos-Scrollen)', neueId, 'Test title: Late loaded card');
  await driver.executeScript(() => window.starteSturm());
  await warte(1500);
  const sturm = await driver.executeAsyncScript(`
    const fertig = arguments[arguments.length - 1];
    let n = 0;
    const o = new MutationObserver((l) => (n += l.length));
    o.observe(document.getElementById('liste'), { subtree: true, childList: true, characterData: true, attributes: true });
    const vorher = window.__sturmSchreibungen;
    setTimeout(() => { o.disconnect(); fertig({ alle: n, seite: window.__sturmSchreibungen - vorher }); }, 1000);`);
  await driver.executeScript(() => window.stoppeSturm());
  const unsere = sturm.alle - sturm.seite;
  console.log(`firefox T: Sturm, Seite ${sturm.seite} Schreibungen, wir ${unsere} in 1 s`);
  pruefe(sturm.seite > 20 && unsere <= 55, `Sturm: eigene Schreibungen hoechstens 50 plus Reserve (${JSON.stringify(sturm)})`);
  await bisText('Nach dem Sturm ersetzt', 't1', 'Test title: Original card one');
  await driver.executeScript(() => window.seitenwechsel('/neue/seite'));
  pruefe((await driver.executeScript(() => location.pathname)) === '/neue/seite', 'Seitenwechsel: Adresse hat sich ohne Neuladen geaendert');
  await bisTab('Seitenwechsel: Tab-Titel', 'Test title: Routed tab title');
  await bisText('Seitenwechsel: Seitentitel', 'seitentitel-text', 'Test title: Routed page title');
  const karten = await driver.executeScript(() => Array.from(document.querySelectorAll('#liste .title a')).map((a) => a.textContent));
  pruefe(JSON.stringify(karten) === JSON.stringify(['Test title: Routed card A', 'Test title: Routed card B']), `Seitenwechsel: neue Karten ersetzt (${JSON.stringify(karten)})`);

  // 7b. Die Seite kuerzt unseren Text selbst und schreibt ihn zurueck
  await driver.get(seite('pornhub'));
  await bisText('Karte 2 ersetzt', 't2', 'Test title: Original card two');
  await driver.executeScript(() => window.kuerzeSelbst('t2'));
  await warte(600);
  const gekuerzt = await textVon('t2');
  pruefe(gekuerzt === 'Test title: Original car...' && (gekuerzt.match(/Test title:/g) || []).length === 1, `selbst gekuerzter Text nicht doppelt umhuellt (${gekuerzt})`);
  await setzeEinstellungen({ pause: true });
  await bisText('Pause: selbst gekuerzte Karte zurueck', 't2', 'Original card two', 8_000);
  await setzeEinstellungen({ pause: false });

  // 7c. Adresswechsel ohne Neuladen und Ausnahme mit Pfad
  await setzeEinstellungen({ ausnahmen: ['pornhub.veil-erwachsen.test/gesperrt'] });
  await bisText('Pfad-Ausnahme: Start ersetzt', 't1', 'Test title: Original card one');
  await driver.executeScript(() => window.geheZu('/gesperrt/seite'));
  await bisText('Pfad-Ausnahme: Karte zurueck', 't1', 'Original card one', 8_000);
  await bisTab('Pfad-Ausnahme: Tab-Titel zurueck', 'Original tab title', 8_000);
  await driver.executeScript(() => window.schreibeKarteNeu('t2', 'Blocked path card'));
  await warte(400);
  pruefe((await textVon('t2')) === 'Blocked path card', 'Pfad-Ausnahme: neu geschriebener Text bleibt');
  await driver.executeScript(() => window.geheZu('/erwachsen-titel.html'));
  await bisText('Pfad frei: Karte ersetzt', 't1', 'Test title: Original card one');
  await bisText('Pfad frei: neu geschriebene Karte ersetzt', 't2', 'Test title: Blocked path card');
  await bisTab('Pfad frei: Tab-Titel ersetzt', 'Test title: Original tab title');
  await loescheEinstellungen();

  // 8. XVideos-Adapter
  await driver.get(seite('xvideos'));
  await bisText('XVideos: Seitentitel', 'seitentitel-xv', 'Test title: Original xvideos page title');
  pruefe((await textVon('t5')) === 'Test title: Original xvideos card' && (await textVon('t1')) === 'Original card one', 'XVideos: Kartentitel ersetzt, Pornhub-Titel nicht');

  // 9. Seite ohne eigene Titel-Selektoren (allgemein): nur der Tab-Titel
  await driver.get(seite('irgendeine'));
  await bisTab('allgemein: Tab-Titel', 'Test title: Original tab title');
  pruefe((await textVon('t1')) === 'Original card one', 'allgemein: Karten bleiben');

  // 10. Seite nicht auf der Liste
  await driver.get(`${basis}/erwachsen-titel.html`);
  await warte(2000);
  pruefe((await textVon('t1')) === 'Original card one' && (await tabTitel()) === 'Original tab title', 'Seite nicht auf der Liste: keine Aenderung');

  // 10b. Eigene Seite des Nutzers
  await driver.get(`${basis}/erwachsen-titel.html`);
  await warte(1500);
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } });
  await bisTab('eigene Seite: Tab-Titel ersetzt', 'Test title: Original tab title', 15_000);
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  await bisTab('eigene Seite entfernt: Tab-Titel zurueck', 'Original tab title', 8_000);
  await loescheEinstellungen();

  // 10c. Nur am Inhalt erkannte Seite: keine Aenderung
  if (OHNE_TESTBILDER) console.log('firefox T: Erkennen am Inhalt uebersprungen (VEIL_OHNE_TESTBILDER=1)');
  else {
    await driver.get(`${basis}/erwachsen-inhalt.html?satz=nsfw&n=16`);
    const titelVorher = await tabTitel();
    await bis('am Inhalt erkannt', async () => (await driver.executeScript(() => JSON.parse(document.documentElement.getAttribute('data-veil-erwachsen') ?? 'null')))?.amInhalt === true, 150_000);
    await warte(1000);
    pruefe((await tabTitel()) === titelVorher, 'nur am Inhalt erkannt: Tab-Titel bleibt');
  }

  // 11. Pornoseiten-Modus aus, wieder an, eigene Ausnahme
  await setzeEinstellungen({ erwachsen: { an: false, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  await driver.get(seite('pornhub'));
  await warte(2000);
  pruefe((await textVon('t1')) === 'Original card one' && (await tabTitel()) === 'Original tab title', 'Pornoseiten-Modus aus: keine Aenderung');
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  await bisText('Modus wieder an: ersetzt', 't1', 'Test title: Original card one');
  await setzeEinstellungen({ ausnahmen: ['pornhub.veil-erwachsen.test'] });
  await bisText('Ausnahme: Karte zurueck', 't1', 'Original card one', 8_000);
  await bisTab('Ausnahme: Tab-Titel zurueck', 'Original tab title', 8_000);
  await loescheEinstellungen();

  // 12. Stabile Satzwahl
  await entfernePack();
  await importierePack(mehrPfad);
  await driver.get(seite('pornhub'));
  const lesen = () => driver.executeScript(() => ['t1', 't2', 't3', 't4'].map((i) => document.getElementById(i).textContent));
  await bis('Satzwahl da', async () => /^(Alpha|Beta|Gamma) Original card one$/.test(await textVon('t1')));
  await warte(300);
  const erste = await lesen();
  pruefe((await textVon('t9')).split(' ')[0] === ((await attrVon('t9', 'title')) ?? '').split(' ')[0], 'Text und Tooltip bekommen denselben Satz');
  console.log(`firefox T: Satzwahl ${JSON.stringify(erste.map((t) => t.split(' ')[0]))}`);
  await driver.executeScript(() => {
    window.schreibeKarteNeu('t1', 'Original card one');
    window.schreibeKarteNeu('t2', 'Original card two');
  });
  await warte(600);
  pruefe(JSON.stringify(await lesen()) === JSON.stringify(erste), 'Satzwahl: nach Neuaufbau durch die Seite derselbe Satz');
  await driver.get(seite('pornhub'));
  await bis('Satzwahl nach Neuladen', async () => /^(Alpha|Beta|Gamma) /.test(await textVon('t1')));
  await warte(300);
  pruefe(JSON.stringify(await lesen()) === JSON.stringify(erste), 'Satzwahl: nach Neuladen derselbe Satz');

  // 13. Pack ohne Freischaltung
  await entfernePack();
  await importierePack(altPfad);
  await driver.get(seite('pornhub'));
  await warte(2000);
  pruefe((await textVon('t1')) === 'Original card one' && (await tabTitel()) === 'Original tab title', 'Pack ohne erwachsen:titel: keine Aenderung');

  // 14. Pack entfernt auf offener Seite
  await entfernePack();
  await importierePack(packPfad);
  await driver.get(seite('pornhub'));
  await bisText('Pack da: ersetzt', 't1', 'Test title: Original card one');
  await entfernePack();
  await bisText('Pack entfernt: Karte zurueck', 't1', 'Original card one', 10_000);
  await bisTab('Pack entfernt: Tab-Titel zurueck', 'Original tab title', 10_000);

  // 15. Titel ohne Aufblitzen (Nachlese Session 8): mit Pack kein gezeichneter Frame mit Originaltitel, ohne Pack bleiben die Titel sichtbar
  await entfernePack();
  await importierePack(packPfad);
  await driver.get(seite('pornhub') + '?sonde=1');
  await bisText('Sonde: Karte ersetzt', 't1', 'Test title: Original card one');
  await bisTab('Sonde: Tab-Titel ersetzt', 'Test title: Original tab title');
  await warte(400);
  const f1 = await driver.executeScript(() => window.__fr);
  console.log(`firefox T: Frames ${f1.frames}, davon Originalkarte sichtbar ${f1.karte}, Original-Tab-Titel ${f1.tab}`);
  pruefe(f1.frames > 3 && f1.karte === 0 && f1.tab === 0, `mit Pack: 0 gezeichnete Frames mit Originaltitel (${JSON.stringify(f1)})`);
  await entfernePack();
  await driver.get(seite('pornhub') + '?sonde=1');
  await bis('Sonde: ohne Pack sichtbar', async () => (await driver.executeScript(() => window.__fr)).frei !== null, 10_000);
  const f2 = await driver.executeScript(() => window.__fr);
  console.log(`firefox T: ohne Pack Titel nach ${Math.round(f2.frei)} ms sichtbar (ab Start der Sonde)`);
  pruefe(f2.frei < 400 && (await textVon('t1')) === 'Original card one' && (await tabTitel()) === 'Original tab title', `ohne Pack bleiben die Titel sichtbar (${Math.round(f2.frei)} ms)`);

  // 16. Spaet eingefuegte Titel: 0 Frames im Original
  await importierePack(packPfad);
  await driver.get(seite('pornhub'));
  await bisText('spaet: Karte 1 ersetzt', 't1', 'Test title: Original card one');
  await driver.executeScript(`
    const w = window;
    w.__spaet = { frames: 0, orig: 0, fertig: false };
    const ids = [];
    const f = () => {
      for (const id of ids) {
        const e = document.getElementById(id);
        if (e && e.textContent.startsWith('Late') && getComputedStyle(e).visibility === 'visible') w.__spaet.orig++;
      }
      w.__spaet.frames++;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
    (async () => {
      for (let i = 0; i < 6; i++) {
        ids.push(w.neueKarte('Late card ' + i));
        await new Promise((r) => setTimeout(r, 150));
      }
      w.__spaet.fertig = true;
    })();`);
  await bis('spaet: fertig', async () => (await driver.executeScript(() => window.__spaet)).fertig, 10_000);
  await bisText('spaet: Karte ersetzt', 't101', 'Test title: Late card 0', 5000);
  await warte(300);
  const sp = await driver.executeScript(() => window.__spaet);
  console.log(`firefox T: spaet eingefuegte Titel, Frames ${sp.frames}, davon im Original sichtbar ${sp.orig}`);
  pruefe(sp.frames > 5 && sp.orig === 0, `spaet eingefuegte Titel: 0 Frames im Original (${JSON.stringify(sp)})`);

  // 17. Seite kopiert die Blattliste und setzt sie spaeter neu (ohne Pack)
  await entfernePack();
  await driver.get(seite('pornhub') + '?kopie=1');
  await bis('Kopie: neu gesetzt', async () => (await driver.executeScript(() => window.__kopie)).gesetzt, 8000);
  await warte(300);
  const kp = await driver.executeScript(() => window.__kopie);
  console.log(`firefox T: Seite kopierte ${kp.n} Blatt/Blaetter und setzte sie neu`);
  pruefe((await driver.executeScript(() => getComputedStyle(document.getElementById('t1')).visibility)) === 'visible' && (await tabTitel()) === 'Original tab title', 'Kopie der Blattliste neu gesetzt: Titel bleibt sichtbar');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: titel.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
