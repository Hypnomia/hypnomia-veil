// Firefox-Test Phase 4, Auftrag O: Popup-Abschnitt "Adult sites" (nur mit Pack, Schalter wirken auf storage.local, Steigerungsanzeige mit
// gestelltem Stand) und Einstellungsseite (eigene Seiten, Verweigern-Anteil, Freilegen-Dauer, Ruhig-Modus).
// Das Popup wird als Tab geoeffnet (moz-extension://<uuid>/popup.html), siehe tests/firefox/pack.test.mjs.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

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

const radio = (wert) => `input[name="stil"][value="${wert}"]`;
const eigenschaft = (css, name) => driver.executeScript(`return document.querySelector(arguments[0])[arguments[1]]`, css, name);
const text = async (css) => (await driver.executeScript(`return document.querySelector(arguments[0]).textContent.trim()`, css));

const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const einst = async () => (await speicher('einstellungen')) ?? {};
const ALLE = ['stil:mia-patch', 'erwachsen:vorschau', 'erwachsen:quiz', 'erwachsen:titel', 'erwachsen:ersatz', 'quiz:freilegen', 'zensur:steigerung', 'chibi:pack'];

let code = 0;
let ordner = '';
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);

  // ---------- Popup ohne Pack ----------
  await oeffne('popup.html');
  await bis('Popup gezeichnet', async () => (await text('#status')).length > 0);
  console.log(`firefox: Version ${version}`);
  pruefe((await text('#erwachsen-titel')) === 'ADULT SITES' || (await text('#erwachsen-titel')).toLowerCase() === 'adult sites', 'Abschnitt "Adult sites" ist da');
  pruefe(!(await sichtbar('#erwachsen-schalter')), 'ohne Pack keine Schalter');
  pruefe(await sichtbar('#erwachsen-pack-link'), 'ohne Pack Verweis auf das Pack');
  pruefe((await text('#erwachsen-hinweis')).includes('Mia Pack'), 'ohne Pack Hinweis nennt das Pack');
  pruefe(!(await sichtbar('#steigerung')), 'ohne Pack keine Steigerungsanzeige');

  // ---------- Popup mit Pack ohne Steigerung ----------
  const packOhne = ALLE.filter((f) => f !== 'zensur:steigerung');
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: args[0], bilder: 1, groesse: 1, importiert: 1 } });`, packOhne);
  await bis('Schalter sichtbar', async () => sichtbar('#erwachsen-schalter'));
  pruefe(!(await sichtbar('#erwachsen-pack-link')), 'mit Pack kein Pack-Verweis');
  pruefe(!(await sichtbar('#steigerung')), 'ohne zensur:steigerung keine Steigerungsanzeige');
  pruefe((await eigenschaft('#erw-an', 'checked')) === true, 'Pornoseiten-Modus steht standardmaessig an');
  pruefe((await eigenschaft('#erw-ersatz', 'checked')) === false, 'Komplett-Ersatz steht standardmaessig aus');
  pruefe((await text('#erw-ersatz-zeile')).includes('Careful'), 'Komplett-Ersatz traegt eine Warnung');

  await klick('#erw-an');
  await bis('an aus', async () => (await einst()).erwachsen?.an === false);
  pruefe(true, 'Schalter Pornoseiten-Modus schreibt erwachsen.an = false');
  await klick('#erw-ersatz');
  await bis('ersatz an', async () => (await einst()).erwachsen?.komplettErsatz === true);
  pruefe((await einst()).erwachsen.an === false, 'Aenderung des einen Schalters ueberschreibt den anderen nicht');
  await klick('#erw-inhalt');
  await bis('inhalt aus', async () => (await einst()).erwachsen?.erkennenAmInhalt === false);
  pruefe(true, 'Schalter Erkennen am Inhalt schreibt erwachsen.erkennenAmInhalt = false');
  await klick('#erw-an');
  await bis('an wieder', async () => (await einst()).erwachsen?.an === true);

  // ---------- Steigerung mit gestelltem Stand ----------
  await imSeitenkontext(
    `const jetzt = Date.now();
     await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: args[0], bilder: 1, groesse: 1, importiert: 1 },
       steigerung: { version: 1, stufe: 3, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: jetzt - 3600_000, letzteMinute: -1, pauseSeit: null } });`,
    ALLE,
  );
  await bis('Steigerung sichtbar', async () => sichtbar('#steigerung'));
  await bis('Stufe 3', async () => (await text('#stufe-zeile')) === 'Level 3 of 4');
  pruefe(true, 'Anzeige "Level 3 of 4"');
  const zeit = await text('#stufe-zeit');
  pruefe(/^Next level down in (10|11) h \d\d min$/.test(zeit), `Zeitgeber zeigt 12 h minus 1 h (${zeit})`);
  pruefe((await text('#stufe-text')).length > 5, 'Mias Kommentar zur Stufe ist da (eingebauter Text)');
  // Stand aendert sich im Speicher: Anzeige folgt ohne Neuladen
  await imSeitenkontext(`const a = (await api.storage.local.get('steigerung')).steigerung; await api.storage.local.set({ steigerung: { ...a, stufe: 4 } });`);
  await bis('Stufe 4', async () => (await text('#stufe-zeile')) === 'Level 4 of 4');
  pruefe(true, 'Anzeige folgt dem Speicher (Stufe 4)');
  // Pause: Uhr steht
  await imSeitenkontext(`const a = (await api.storage.local.get('steigerung')).steigerung; await api.storage.local.set({ steigerung: { ...a, pauseSeit: Date.now() - 1000 } });`);
  await bis('steht', async () => (await text('#stufe-zeit')).includes('stands still'));
  pruefe(true, 'in der Pause steht der Zeitgeber ("stands still")');
  // ohne Stufe
  await imSeitenkontext(`await api.storage.local.set({ steigerung: { version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: 0, letzteMinute: -1, pauseSeit: null } });`);
  await bis('Stufe 0', async () => (await text('#stufe-zeile')) === 'Level 0 of 4');
  pruefe(true, 'Stufe 0 zeigt "Level 0 of 4"');
  // Pack weg: Abschnitt faellt zurueck
  await imSeitenkontext(`await api.storage.local.remove('pack');`);
  await bis('Schalter weg', async () => !(await sichtbar('#erwachsen-schalter')));
  pruefe(!(await sichtbar('#steigerung')), 'Pack weg: Schalter und Steigerung verschwinden');

  // ---------- Drei Lagen, Schalter nach Freischaltung, eigene Seiten bleiben stehen ----------
  const setzePack = (f) => imSeitenkontext(`await api.storage.local.set({ pack: { id: 't', version: '1.0.0', titel: 'T', freischaltungen: args[0], bilder: 1, groesse: 1, importiert: 1 } });`, f);
  await setzePack(['stil:mia-patch']);
  await bis('Abschnitt weg', async () => !(await sichtbar('#erwachsen')));
  pruefe(!(await sichtbar('#erwachsen-pack-link')), 'Pack ohne Erwachsenen-Freischaltung: kein Pack-Verweis, kein Abschnitt');
  await setzePack(['zensur:steigerung']);
  await bis('Steigerung allein', async () => sichtbar('#steigerung'));
  pruefe(!(await sichtbar('#erwachsen-schalter')), 'nur zensur:steigerung: Steigerung da, Schalter nicht');
  await setzePack(['erwachsen:quiz']);
  await bis('Schalter da', async () => sichtbar('#erwachsen-schalter'));
  pruefe(!(await sichtbar('#erw-an')) && !(await sichtbar('#erw-ersatz-zeile')), 'Mode-Schalter und Ersatz-Zeile fehlen ohne ihre Freischaltung');
  await setzePack(['erwachsen:vorschau']);
  await imSeitenkontext(`const e = (await api.storage.local.get('einstellungen')).einstellungen ?? {}; await api.storage.local.set({ einstellungen: { ...e, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['example.com'] } } });`);
  await bis('Mode-Schalter da', async () => (await eigenschaft('#erw-an', 'checked')) === true);
  await klick('#erw-an');
  await bis('an aus', async () => (await einst()).erwachsen?.an === false);
  pruefe(JSON.stringify((await einst()).erwachsen.eigeneSeiten) === '["example.com"]', 'Popup-Schalter lassen eigeneSeiten stehen');

  // ---------- Zeitgeber ----------
  await setzePack(ALLE);
  await imSeitenkontext(`await api.storage.local.set({ einstellungen: { ...(await api.storage.local.get('einstellungen')).einstellungen, pause: false }, steigerung: { version: 1, stufe: 2, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now() - 12 * 3600_000 + 90_000, letzteMinute: -1, pauseSeit: null } });`);
  await bis('unter einer Stunde', async () => /^Next level down in 1 min \d\d s$/.test(await text('#stufe-zeit')));
  const t1 = await text('#stufe-zeit');
  await bis('tickt', async () => (await text('#stufe-zeit')) !== t1);
  pruefe(true, 'Zeitgeber tickt unter einer Stunde');
  await imSeitenkontext(`await api.storage.local.set({ steigerung: { version: 1, stufe: 3, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now() - 12 * 3600_000 + 2000, letzteMinute: -1, pauseSeit: null } });`);
  await bis('Stufe 3', async () => (await text('#stufe-zeile')) === 'Level 3 of 4');
  await bis('Abbau bei offenem Popup', async () => (await text('#stufe-zeile')) === 'Level 2 of 4');
  pruefe(true, 'Abbau bei offenem Popup: Level faellt von 3 auf 2');
  await imSeitenkontext(`await api.storage.local.set({ steigerung: { version: 1, stufe: 3, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now() + 3600_000, letzteMinute: -1, pauseSeit: null } });`);
  await bis('Uhr vor abbauAb', async () => (await text('#stufe-zeile')) === 'Level 3 of 4' && /12 h 00 min$/.test(await text('#stufe-zeit')));
  pruefe(true, 'Uhr vor abbauAb: kein Abbau, volle 12 h');
  await imSeitenkontext(`await api.storage.local.set({ einstellungen: { ...(await api.storage.local.get('einstellungen')).einstellungen, pause: true } });`);
  await bis('Pause steht', async () => (await text('#stufe-zeit')).includes('stands still'));
  pruefe((await driver.executeScript(`return document.querySelector('#erwachsen-chibi').dataset.pose`)) === 'schmollen', 'Pose bei Pause: schmollen');
  await imSeitenkontext(`await api.storage.local.set({ steigerung: { version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: 0, letzteMinute: -1, pauseSeit: null } });`);
  await bis('Stufe 0 in Pause', async () => (await text('#stufe-zeile')) === 'Level 0 of 4');
  pruefe(!(await text('#stufe-zeit')).includes('stands still'), 'Pause-Satz der Uhr nur bei Stufe > 0');
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'steigerung', 'einstellungen', 'begruesstFuer']);`);


  // ---------- Echt importiertes Dummy-Pack ----------
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-oberflaeche-pack-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  await oeffne('options.html');
  await bis('Optionen ohne Pack', async () => (await text('#pack-status')).length > 0);
  pruefe(!(await sichtbar('#begruessung')), 'ohne Pack keine Begruessung');
  await driver.findElement(By.css('#datei')).sendKeys(packPfad);
  await bis('Lizenz da', async () => sichtbar('#lizenz-block'));
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack drin', async () => (await text('#pack-status')).includes('Pack in place'));
  await bis('Begruessung', async () => sichtbar('#begruessung'));
  pruefe((await text('#begruessung-text')) === 'Test greeting line.', 'Begruessungstext kommt aus dem Pack');
  const blobBild = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !e.hidden && e.src.startsWith('blob:')`, css);
  await bis('Pack-Chibi', async () => blobBild('#begruessung-chibi'));
  pruefe(((await speicher('pack')).freischaltungen ?? []).includes('chibi:pack'), 'Begruessungs-Chibi kommt als blob: aus dem Pack');
  // Zweites Oeffnen, schon begruesst: keine Begruessung
  await oeffne('options.html');
  await bis('Optionen mit Pack', async () => (await text('#pack-status')).includes('Pack in place'));
  await warte(500);
  pruefe(!(await sichtbar('#begruessung')), 'beim zweiten Oeffnen keine Begruessung');
  // Popup: Stufentext und Chibi aus dem Pack
  await imSeitenkontext(`await api.storage.local.set({ steigerung: { version: 1, stufe: 3, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now() - 1000, letzteMinute: -1, pauseSeit: null } });`);
  await oeffne('popup.html');
  await bis('Stufentext aus dem Pack', async () => (await text('#stufe-text')) === 'Test level three line.');
  pruefe(true, 'Stufentext aus dem Pack (Test level three line.)');
  await imSeitenkontext(`await api.storage.local.set({ steigerung: { version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: 0, letzteMinute: -1, pauseSeit: null } });`);
  await bis('Pack-Chibi im Popup', async () => blobBild('#erwachsen-chibi'));
  pruefe(true, 'Popup-Chibi (sprechblase) kommt als blob: aus dem Pack');
  // Pack ganz entfernen (IndexedDB), damit nichts zurueckbleibt
  await oeffne('options.html');
  await bis('Optionen', async () => (await text('#pack-status')).includes('Pack in place'));
  await klick('#entfernen');
  await klick('#entfernen-ja');
  await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));

  // ---------- Einstellungsseite ----------
  await oeffne('options.html');
  await bis('Optionen gezeichnet', async () => (await text('#pack-status')).length > 0);
  pruefe(await sichtbar('#erw-titel'), 'Einstellungsseite hat den Abschnitt "Adult sites"');
  const feld = By.css('#seite-feld');
  await driver.findElement(feld).sendKeys('https://WWW.Example.com/irgendwas');
  await driver.findElement(By.css('#seite-add')).click();
  await bis('Seite gespeichert', async () => ((await einst()).erwachsen?.eigeneSeiten ?? []).includes('example.com'));
  pruefe(true, 'eigene Seite landet als Host (example.com) in erwachsen.eigeneSeiten');
  pruefe((await text('#seiten-liste')).includes('example.com'), 'Seite steht in der Liste');
  pruefe((await einst()).erwachsen.an === true, 'Hinzufuegen laesst die anderen erwachsen-Felder stehen');
  await driver.findElement(feld).sendKeys('example.com');
  await driver.findElement(By.css('#seite-add')).click();
  await bis('Doppelt gemeldet', async () => (await text('#seite-meldung')).includes('already'));
  pruefe(((await einst()).erwachsen.eigeneSeiten ?? []).length === 1, 'Doppelte Seite wird nicht noch einmal gespeichert');
  await driver.findElement(feld).sendKeys('kein host');
  await driver.findElement(By.css('#seite-add')).click();
  await bis('Fehler gemeldet', async () => (await text('#seite-meldung')).includes('doesn’t look like'));
  pruefe(((await einst()).erwachsen.eigeneSeiten ?? []).length === 1, 'ungueltige Eingabe wird abgewiesen');

  await setzeRange('#verweigern', 20);
  await bis('verweigern', async () => Math.abs(((await einst()).quiz?.verweigern ?? 0) - 0.2) < 1e-9);
  pruefe(true, 'Verweigern-Anteil 20 % schreibt quiz.verweigern = 0.2');
  await setzeRange('#verweigern', 99);
  await bis('verweigern gedeckelt', async () => Math.abs(((await einst()).quiz?.verweigern ?? 0) - 0.3) < 1e-9);
  pruefe(true, 'Verweigern-Anteil ist bei 30 % gedeckelt');
  await setzeRange('#freilegen', 15);
  await bis('freilegen', async () => (await einst()).quiz?.freilegenMs === 15000);
  pruefe((await einst()).quiz.verweigern > 0.29, 'Freilegen-Dauer 15 s schreibt quiz.freilegenMs = 15000, Verweigern bleibt');
  await klick('#ruhig');
  await bis('ruhig', async () => (await einst()).ruhig === true);
  pruefe(true, 'Ruhig-Modus schreibt ruhig = true');

  // Entfernen
  await driver.findElement(By.css('#seiten-liste button')).click();
  await bis('Seite entfernt', async () => ((await einst()).erwachsen?.eigeneSeiten ?? []).length === 0);
  pruefe(true, 'Entfernen nimmt die Seite aus der Liste');

  // Begruessung: mit Pack da, ohne Demo-Chibi bleibt der Text
  await imSeitenkontext(`await api.storage.local.set({ pack: { id: 't2', version: '1.0.0', titel: 'T', freischaltungen: ['erwachsen:vorschau'], bilder: 1, groesse: 1, importiert: Date.now() } });`);
  await bis('Begruessung', async () => sichtbar('#begruessung'));
  await bis('Begruessungstext', async () => (await text('#begruessung-text')).length > 3);
  pruefe(true, 'Begruessung mit Text (Chibi nur, wenn eins mitgebaut ist)');
  console.log(`firefox: Begruessungs-Chibi sichtbar: ${await sichtbar('#begruessung-chibi')}`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (ordner) await rm(ordner, { recursive: true, force: true }).catch(() => {});
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'steigerung', 'einstellungen', 'begruesstFuer']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: oberflaeche-erwachsen.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
