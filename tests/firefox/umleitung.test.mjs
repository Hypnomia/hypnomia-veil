// Firefox-Test Phase 4, Auftrag U (PHASE-4-BAUPLAN): Komplett-Ersatz per declarativeNetRequest in Firefox (geckodriver/WebDriver).
// Pack und Schalter noetig, Pause und Ausnahme nehmen die Regel weg, Pause in der Galerie fuehrt zur Originaladresse.
// Erweiterungsseiten erreicht der Test wie tests/firefox/pack.test.mjs (feste UUID, Tab ueber den Chrome-Kontext).
// Die Testdomains loest die Einstellung `network.dns.localDomains` auf 127.0.0.1 auf (genaue Hosts, kein Platzhalter).
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
  console.error('firefox: Zeitlimit von 150 s ueberschritten');
  process.exit(1);
}, 150_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const GECKO_ID = 'veil@hypnomia';
const DUMMY_VORSCHAU = 4;
const HOSTS = ['pornhub.veil-erwachsen.test', 'www.pornhub.veil-erwachsen.test', 'xhamster.veil-erwachsen.test', 'eigen.test'];
const ADULT = `http://pornhub.veil-erwachsen.test:${port}/hello.html`;
const ADULT2 = `http://xhamster.veil-erwachsen.test:${port}/hello.html?a=1&b=2`;
const EIGEN = `http://eigen.test:${port}/hello.html`;
const NEUTRAL = `http://127.0.0.1:${port}/hello.html`;

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}

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
let server;
let ordner;
const uuid = randomUUID();
let extTab; // Tab mit der Einstellungsseite (Werkzeug fuer Einstellungen und Regeln)
let inhaltTab; // Tab fuer die Testseiten
const galerieStart = () => `moz-extension://${uuid}/galerie.html?ziel=`;

async function oeffneExt(seite) {
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

// Code mit `api` (browser-Objekt der Erweiterungsseite) im Tab `extTab`; der Code liefert einen JSON-tauglichen Wert.
async function imExt(code, ...args) {
  await driver.switchTo().window(extTab);
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

const setze = (teil) =>
  imExt(
    `const t = args[0];
     const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
     const neu = { ...alt, erwachsen: { ...(alt.erwachsen ?? {}) } };
     if (t.pause !== undefined) neu.pause = t.pause;
     if (t.an !== undefined) neu.erwachsen.an = t.an;
     if (t.komplettErsatz !== undefined) neu.erwachsen.komplettErsatz = t.komplettErsatz;
     if (t.eigeneSeiten) neu.erwachsen.eigeneSeiten = t.eigeneSeiten;
     if (t.ausnahmen) neu.ausnahmen = t.ausnahmen;
     await api.storage.local.set({ einstellungen: neu });
     return true;`,
    teil,
  );
const regeln = () => imExt(`return await api.declarativeNetRequest.getDynamicRules();`);

async function bis(beschreibung, fn, frist = 15_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return Date.now() - t0;
    await warte(40);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}
const warteRegeln = (n) => bis(`Regelzahl ${n}`, async () => (await regeln()).length === n);

// Navigiert im Inhalts-Tab und liefert die Adresse, bei der es endet. Die Navigation zu moz-extension kann einen Fehler melden, die Adresse zaehlt.
async function ziel(adresse) {
  await driver.switchTo().window(inhaltTab);
  try {
    await driver.get(adresse);
  } catch {
    // Seite wurde auf eine Erweiterungsadresse umgeleitet; geckodriver meldet das teils als Fehler.
  }
  await warte(400);
  return await driver.getCurrentUrl();
}

async function klickLink(vonAdresse, aufAdresse) {
  await driver.switchTo().window(inhaltTab);
  await driver.get(vonAdresse);
  await driver.executeScript(
    `const a = document.createElement('a'); a.id = 'l'; a.href = arguments[0]; a.textContent = 'los'; document.body.append(a); a.click();`,
    aufAdresse,
  );
  await warte(400);
}
const inhaltUrl = async () => {
  await driver.switchTo().window(inhaltTab);
  return await driver.getCurrentUrl();
};

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-umleitung-'));
  const bau = await baueDummyPack();
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, bau.bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', HOSTS.join(','));
  // Ereignisseite schlaeft nach 3 s Leerlauf (Standard 30 s), damit Tests den schlafenden Hintergrund erreichen.
  optionen.setPreference('extensions.background.idle.timeout', 3000);
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  inhaltTab = (await driver.getAllWindowHandles())[0];
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);
  extTab = await oeffneExt('options.html');

  // 1. Ohne Pack: keine Regel, auch mit Schalter
  await setze({ komplettErsatz: true });
  // Abgleich anstossen und abwarten, erst dann zaehlen.
  await imExt(`return await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'umleitung-abgleich' });`);
  pruefe((await regeln()).length === 0, 'ohne Pack keine Regel, auch mit Schalter');
  pruefe((await ziel(ADULT)) === ADULT, 'ohne Pack bleibt die Testdomain-Seite stehen');
  await setze({ komplettErsatz: false });

  // 2. Pack importieren, Schalter aus
  await driver.switchTo().window(extTab);
  await driver.findElement(By.css('#datei')).sendKeys(packPfad);
  await bis('Lizenz sichtbar', () => driver.findElement(By.css('#lizenz-block')).isDisplayed());
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack-Titel', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'));
  pruefe((await regeln()).length === 0, 'Pack da, Schalter aus: keine Regel');
  pruefe((await ziel(ADULT)) === ADULT, 'Pack da, Schalter aus: keine Umleitung');

  // 3. Schalter an: Regel, Umleitung in der Adresszeile
  await setze({ komplettErsatz: true });
  const msRegel = await warteRegeln(1);
  const regel = (await regeln())[0];
  console.log(`firefox: Regel nach ${msRegel} ms, ${regel.condition.requestDomains.length} Domains, Umleitung ${JSON.stringify(regel.action.redirect).slice(0, 60)}`);
  pruefe(JSON.stringify(regel.condition.resourceTypes) === '["main_frame"]', 'Regel nur fuer main_frame');
  pruefe(regel.condition.requestDomains.includes('pornhub.com') && regel.condition.requestDomains.includes('veil-erwachsen.test'), 'Regel enthaelt Listen- und Testdomain');
  const nach = await ziel(ADULT2);
  console.log(`firefox: Umleitung ADULT2 endet bei ${nach.slice(0, 80)}`);
  pruefe(nach === `${galerieStart()}${ADULT2}`, `Adresszeile: Galerie mit Originaladresse (${nach})`);
  await bis('Galerie-Bilder', async () => (await driver.findElements(By.css('#bilder img'))).length === DUMMY_VORSCHAU).catch(() => {});
  const bilder = (await driver.findElements(By.css('#bilder img'))).length;
  pruefe(bilder === DUMMY_VORSCHAU, `Galerie zeigt ${DUMMY_VORSCHAU} Bilder (${bilder})`);
  const breiten = await driver.executeScript(`return [...document.querySelectorAll('#bilder img')].map((i) => i.naturalWidth);`);
  pruefe(breiten.length > 0 && breiten.every((b) => b > 0), `Galerie-Bilder sind geladen (${breiten})`);
  pruefe((await driver.findElement(By.css('#link-patreon')).getAttribute('href')).startsWith('https://www.patreon.com/'), 'Link Patreon');
  pruefe((await driver.findElement(By.css('#link-subscribestar')).getAttribute('href')).startsWith('https://subscribestar.'), 'Link SubscribeStar');

  // 4. Link von fremder Seite und Link in der Seite einer Listen-Domain
  await setze({ komplettErsatz: false });
  await warteRegeln(0);
  await driver.switchTo().window(inhaltTab);
  await driver.get(ADULT);
  await setze({ komplettErsatz: true });
  await warteRegeln(1);
  await driver.switchTo().window(inhaltTab);
  await driver.executeScript(
    `const a = document.createElement('a'); a.href = arguments[0]; a.textContent = 'los'; document.body.append(a); a.click();`,
    ADULT2,
  );
  await warte(500);
  const innen = await inhaltUrl();
  pruefe(innen === `${galerieStart()}${ADULT2}`, `Link in der Seite einer Listen-Domain fuehrt zur Galerie (${innen})`);
  await klickLink(NEUTRAL, ADULT);
  const fremd = await inhaltUrl();
  pruefe(fremd === `${galerieStart()}${ADULT}`, `Link von fremder Seite fuehrt zur Galerie (${fremd})`);

  // 5. Pause in der Galerie: Knopf, zurueck zur Originaladresse
  await ziel(ADULT);
  await driver.switchTo().window(inhaltTab);
  const t0 = Date.now();
  await driver.findElement(By.css('#pause')).click();
  await bis('zurueck zur Originaladresse', async () => (await inhaltUrl()) === ADULT);
  pruefe((await driver.executeScript('return document.referrer;')) === '', 'Rueckkehr ohne Referer der Erweiterung');
  console.log(`firefox: Pause in der Galerie bis Originaladresse ${Date.now() - t0} ms`);
  pruefe((await regeln()).length === 0, 'Pause in der Galerie: Regel weg');
  pruefe((await imExt(`return (await api.storage.local.get('einstellungen')).einstellungen.pause;`)) === true, 'Pause steht in den Einstellungen');

  // 6. Pause von aussen
  pruefe((await ziel(ADULT)) === ADULT, 'bei Pause keine Umleitung');
  await setze({ pause: false });
  await warteRegeln(1);
  const t1 = Date.now();
  await setze({ pause: true });
  await warteRegeln(0);
  const msPause = Date.now() - t1;
  console.log(`firefox: Pause bis Regel weg ${msPause} ms`);
  pruefe(msPause < 2000, `Pause nimmt die Regel in unter 2 s weg (${msPause} ms)`);
  const direkt = await ziel(`${galerieStart()}${ADULT}`);
  pruefe(direkt === ADULT, `Galerie-Adresse bei Pause geht sofort zurueck (${direkt})`);
  await setze({ pause: false });
  await warteRegeln(1);

  // 7. Offene Galerie reagiert auf Pause ohne Klick
  await ziel(ADULT);
  pruefe((await inhaltUrl()) === `${galerieStart()}${ADULT}`, 'Galerie offen');
  await setze({ pause: true });
  await bis('offene Galerie geht zurueck', async () => (await inhaltUrl()) === ADULT);
  pruefe(true, 'offene Galerie geht bei Pause zurueck');
  await setze({ pause: false });
  await warteRegeln(1);

  // 8. Ausnahme (Host)
  await setze({ ausnahmen: ['pornhub.veil-erwachsen.test'] });
  await bis('Ausnahme in der Regel', async () => ((await regeln())[0]?.condition.excludedRequestDomains?.length ?? 0) === 1);
  pruefe((await ziel(ADULT)) === ADULT, 'Ausnahme: dieser Host wird nicht umgeleitet');
  pruefe((await ziel(ADULT2)) === `${galerieStart()}${ADULT2}`, 'Ausnahme: andere Listen-Domain wird weiter umgeleitet');
  await setze({ ausnahmen: [] });
  await bis('Ausnahme weg', async () => ((await regeln())[0]?.condition.excludedRequestDomains?.length ?? 0) === 0);
  pruefe((await ziel(ADULT)) === `${galerieStart()}${ADULT}`, 'ohne Ausnahme wieder umgeleitet');

  // 9. Eigene Seite
  pruefe((await ziel(EIGEN)) === EIGEN, 'eigene Seite vorher: keine Umleitung');
  await setze({ eigeneSeiten: ['eigen.test'] });
  await bis('eigene Seite in der Regel', async () => ((await regeln())[0]?.condition.requestDomains ?? []).includes('eigen.test'));
  pruefe((await ziel(EIGEN)) === `${galerieStart()}${EIGEN}`, 'eigene Seite wird umgeleitet');
  await klickLink(NEUTRAL, EIGEN);
  pruefe((await inhaltUrl()) === `${galerieStart()}${EIGEN}`, 'Link von fremder Seite auf eine eigene Seite fuehrt zur Galerie');
  await setze({ eigeneSeiten: [] });
  await bis('eigene Seite weg', async () => !((await regeln())[0]?.condition.requestDomains ?? []).includes('eigen.test'));
  pruefe((await ziel(EIGEN)) === EIGEN, 'eigene Seite entfernt: keine Umleitung');

  // 9b. Galerie: Ziel-Pruefung, Zustand, iframe, Modus aus
  const keineBilder = async () => (await driver.findElements(By.css('#bilder img'))).length === 0;
  for (const z of ['javascript:alert(1)', 'data:text/html,hallo', `moz-extension://${uuid}/options.html`, NEUTRAL]) {
    const url = await ziel(`${galerieStart()}${z}`);
    await warte(600);
    pruefe(url === `${galerieStart()}${z}` && (await inhaltUrl()) === url, `Galerie mit Ziel ${z.slice(0, 20)}: kein Sprung`);
    pruefe(await keineBilder(), `Galerie mit Ziel ${z.slice(0, 20)}: keine Bilder`);
  }
  // fremder Host: auch nach Pause bleibt die Galerie stehen
  await driver.findElement(By.css('#pause')).click();
  await warte(700);
  pruefe((await inhaltUrl()) === `${galerieStart()}${NEUTRAL}`, 'fremder Host: nach Pause kein Sprung');
  await setze({ pause: false });
  await warteRegeln(1);
  // www im Ziel: gezeigt, spaetere Pause springt zurueck
  const WWW = `http://www.pornhub.veil-erwachsen.test:${port}/hello.html`;
  await ziel(`${galerieStart()}${WWW}`);
  await bis('Bilder mit www-Ziel', async () => (await driver.findElements(By.css('#bilder img'))).length === DUMMY_VORSCHAU);
  await setze({ pause: true });
  await bis('www-Ziel: zurueck bei Pause', async () => (await inhaltUrl()) === WWW);
  pruefe(true, 'www-Ziel gezeigt und bei Pause zurueck');
  // Pause ohne Ziel: keine Bilder
  await ziel(`moz-extension://${uuid}/galerie.html`);
  await warte(700);
  pruefe(await keineBilder(), 'Pause ohne Ziel: keine Bilder');
  await setze({ pause: false });
  await warteRegeln(1);
  // iframe: nichts zeigen, nichts tun
  await driver.switchTo().window(inhaltTab);
  await driver.get(NEUTRAL);
  await driver.executeScript(`const f = document.createElement('iframe'); f.id = 'rahmen'; f.src = arguments[0]; document.body.append(f);`, `${galerieStart()}${ADULT}`);
  await warte(1200);
  await driver.switchTo().frame(await driver.findElement(By.id('rahmen')));
  pruefe((await driver.executeScript('return document.body.children.length;')) === 0, 'Galerie im iframe zeigt nichts');
  await driver.switchTo().defaultContent();
  pruefe((await inhaltUrl()) === NEUTRAL, 'Galerie im iframe: Seite bleibt');
  // Pornoseiten-Modus aus
  await ziel(ADULT);
  await setze({ an: false });
  await warteRegeln(0);
  await bis('Modus aus: Galerie springt zurueck', async () => (await inhaltUrl()) === ADULT);
  pruefe(true, 'Modus aus: keine Regel, offene Galerie springt zurueck');
  await setze({ an: true });
  await warteRegeln(1);

  // 9c. Schlafende Ereignisseite (Punkt 6 und 18): storage.onChanged weckt sie, Pause nimmt die Regel weg
  const hintergrundStatus = async () => {
    await driver.setContext(firefox.Context.CHROME);
    try {
      return await driver.executeScript(`return WebExtensionPolicy.getByID(arguments[0])?.extension?.backgroundState ?? null;`, GECKO_ID);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
  };
  let schlaeft = '';
  try {
    await bis('Ereignisseite schlaeft', async () => ((schlaeft = await hintergrundStatus()) === 'stopped'), 25_000);
  } catch {
    // unten ausgewertet
  }
  console.log(`firefox: Zustand der Ereignisseite vor der Pause: ${schlaeft}`);
  pruefe(schlaeft === 'stopped', `Ereignisseite schlaeft vor der Pause (${schlaeft})`);
  const t2 = Date.now();
  await setze({ pause: true });
  let weg = true;
  try {
    await warteRegeln(0);
  } catch {
    weg = false;
  }
  console.log(`firefox: schlafende Ereignisseite, Pause bis Regel weg ${weg ? `${Date.now() - t2} ms` : 'NIE (Regel blieb)'}`);
  pruefe(weg, 'storage.onChanged weckt die schlafende Ereignisseite: Pause nimmt die Regel weg');
  await setze({ pause: false });
  await warteRegeln(1);

  // 10. Abgleich per Nachricht und Pack entfernen
  await imExt(`await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] }); return true;`);
  pruefe((await regeln()).length === 0, 'Regel von Hand geloescht');
  await imExt(`return await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'umleitung-abgleich' });`);
  pruefe((await regeln()).length === 1, 'Abgleich-Nachricht setzt die Regel wieder');
  await driver.switchTo().window(extTab);
  await driver.findElement(By.css('#entfernen')).click();
  await bis('Rueckfrage', () => driver.findElement(By.css('#entfernen-frage')).isDisplayed());
  await driver.findElement(By.css('#entfernen-ja')).click();
  await bis('Pack entfernt', async () => (await driver.findElement(By.css('#pack-status')).getText()).includes('No pack yet'));
  await warteRegeln(0);
  pruefe((await ziel(ADULT)) === ADULT, 'Pack entfernt: keine Regel, keine Umleitung');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: umleitung.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
