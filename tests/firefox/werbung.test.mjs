// Firefox-Test Phase 5, Auftrag W (PHASE-5-AUFTRAEGE-SESSION-9 Abschnitt 3): Werbe-Tausch. Werbeflaechen werden Mias Werbung (Dummy: Rot mit
// Dunkelgrau oder Weiss), gekennzeichnet, klickbar auf einen Link der Marke; normale Bilder in Werbegroesse bleiben; Pause, Schalter, Ausnahme und
// fehlendes Pack geben die Originale sofort zurueck. Test-Hosts *.veil-werbung.test und *.veil-erwachsen.test (nur im Testbau); Firefox loest die
// genauen Hosts ueber network.dns.localDomains auf. Firefox zaehlt nur den sichtbaren Tab als sichtbar: gewartet wird im Tab der Seite.
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
import sharp from 'sharp';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 420 s ueberschritten');
  process.exit(1);
}, 420_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47373);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47375);
const nachrichten = `http://127.0.0.1:${port}/werbung-nachrichten.html?fremd=${portFremd}`;
const GECKO_ID = 'veil@hypnomia';
const HOSTS = ['pornhub.veil-erwachsen.test', 'ad.veil-werbung.test'];
const erwachsenSeite = `http://pornhub.veil-erwachsen.test:${port}/werbung-erwachsen.html`;
const MOTIVE = JSON.parse(readFileSync(path.join(wurzel, 'data/werbung-motive.json'), 'utf8')).plattformen;
const LINKS_JSON = JSON.parse(readFileSync(path.join(wurzel, 'data/links.json'), 'utf8'));
const LINKS = Object.values(JSON.parse(readFileSync(path.join(wurzel, 'data/links.json'), 'utf8'))).filter((v) => typeof v === 'string' && v.startsWith('https://'));

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

const attrStand = () =>
  driver.executeScript(() => {
    const a = document.documentElement.getAttribute('data-veil-werbung');
    return a ? JSON.parse(a) : null;
  });
const sichtIds = async () => ((await attrStand())?.flaechen ?? []).filter((f) => f.sichtbar).map((f) => f.id).sort();
const originalSichtbar = (id) => driver.executeScript((i) => getComputedStyle(document.getElementById(i)).visibility === 'visible', id);
const bisIds = (beschreibung, ids, frist = 20_000) => bis(beschreibung, async () => { const s = await sichtIds(); return ids.every((i) => s.includes(i)); }, frist);
const bisLeer = (beschreibung, frist = 10_000) => bis(beschreibung, async () => (await sichtIds()).length === 0, frist);
const rechteck = (id) => driver.executeScript((i) => { const e = document.getElementById(i); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; }, id);
async function maxVersatz() {
  let m = 0;
  for (const f of (await attrStand())?.flaechen ?? []) {
    if (!f.voll || !f.id || !f.sichtbar) continue;
    const r = await rechteck(f.id);
    if (!r) continue; // Flaeche in einem offenen Shadow Root
    m = Math.max(m, Math.abs(f.voll.l - r.left), Math.abs(f.voll.t - r.top), Math.abs(f.voll.w - r.width), Math.abs(f.voll.h - r.height));
  }
  return m;
}
// Rote Pixel (Dummy-Werbung) in den mittleren 60 % der Breite einer Flaeche: Bildschirmfoto, Ausschnitt nach Verhaeltnis zum Fenster.
async function rotAnteil(id) {
  await driver.executeScript((i) => document.getElementById(i).scrollIntoView({ block: 'center' }), id);
  let anteil = 0;
  // Bis zu 3 s Wiederholung: das Bildschirmfoto darf nicht vor dem Zeichnen der Flaeche entstehen.
  for (let versuch = 0; versuch < 15 && anteil <= 0.1; versuch++) {
    await warte(200);
    const r = await rechteck(id);
    const fenster = await driver.executeScript(() => ({ b: innerWidth, h: innerHeight }));
    const png = Buffer.from(await driver.takeScreenshot(), 'base64');
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const sx = info.width / fenster.b;
    const sy = info.height / fenster.h;
    const x0 = Math.round((r.left + r.width * 0.2) * sx);
    const x1 = Math.round((r.left + r.width * 0.8) * sx);
    const y0 = Math.round(r.top * sy);
    const y1 = Math.round((r.top + r.height) * sy);
    let rot = 0;
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * info.channels;
        n++;
        if (data[i] > 90 && data[i] > data[i + 1] * 2.2 && data[i] > data[i + 2] * 2) rot++;
      }
    anteil = n ? rot / n : 0;
  }
  return anteil;
}
const imRahmen = async (teil, fn) => {
  const rahmen = await driver.findElement(By.css(teil));
  await driver.switchTo().frame(rahmen);
  try {
    return await fn();
  } finally {
    await driver.switchTo().parentFrame();
  }
};
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 };
const ERWARTET = ['a-rahmen', 'a-ins', 'a-sponsored', 'a-anzeige', 'a-aussen'];
const layoutVon = () =>
  driver.executeScript(() => {
    const r = (i) => { const b = document.getElementById(i).getBoundingClientRect(); return [b.left, b.top + scrollY, b.width, b.height].map((x) => Math.round(x * 10) / 10).join(','); };
    return { bild: r('n-bild'), header: r('n-header'), shadow: r('n-shadow'), schluss: r('schluss'), hoehe: document.documentElement.scrollHeight };
  });

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-werbung-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);

  server = await starteFixtureServer(port);
  const serverFremd = await starteFixtureServer(portFremd);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
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
  await driver.get(nachrichten);
  await warte(3500);
  pruefe((await attrStand()) === null, 'ohne Pack: keine Werbe-Daten');
  let alleSichtbar = true;
  for (const id of [...ERWARTET, 'a-spaet', 'n-bild', 'n-header']) alleSichtbar = alleSichtbar && (await originalSichtbar(id));
  pruefe(alleSichtbar, 'ohne Pack: alle Originale sichtbar');
  pruefe(await imRahmen('#a-rahmen', () => driver.executeScript(() => !document.getElementById('v').paused)), 'ohne Pack: die Anzeige im Werbe-Rahmen laeuft');
  const layoutOhne = await layoutVon();

  // 2. Mit Pack: Tausch, Kennzeichnung, Layout
  await importierePack(packPfad);
  await driver.get(nachrichten);
  await driver.executeScript(() => {
    window.__spaetSicht = null;
    new MutationObserver(() => {
      const a = document.documentElement.getAttribute('data-veil-werbung');
      if (a && window.__spaetSicht === null && JSON.parse(a).flaechen.some((f) => f.id === 'a-spaet' && f.sichtbar)) window.__spaetSicht = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-veil-werbung'] });
  });
  const spaetSchonDa = (await driver.executeScript(() => window.__spaetAm)) !== null;
  const t0 = Date.now();
  await bisIds('fuenf Flaechen', ERWARTET);
  console.log(`firefox W: fuenf Flaechen sichtbar ${Date.now() - t0} ms nach goto`);
  const stand = await attrStand();
  const ids = await sichtIds();
  pruefe(!ids.includes('a-innen') && !ids.includes('n-bild') && !ids.includes('n-header') && !ids.includes('n-shadow') && !ids.includes('n-rahmen'), `nur der aeusserste Behaelter, normale Bilder und Elemente bleiben (${ids.join(',')})`);
  for (const id of ERWARTET) {
    const f = stand.flaechen.find((x) => x.id === id);
    pruefe(f.kennzeichnung === 'Test ad by Mia', `${id}: Kennzeichnung ${f.kennzeichnung}`);
    pruefe(f.hinweis === 'Advertisement by Mia, shown by the HYPNOMIA VEIL extension' && f.badge.klickbar === false, `${id}: Hinweis am Rahmen, Kennzeichnung nicht im Link`);
    pruefe(f.badge.schrift >= (f.box.h < 60 ? 8 : 11) && !f.badge.abgeschnitten, `${id}: Kennzeichnung lesbar (${f.badge.schrift}px) und nicht abgeschnitten`);
    {
      // Phase 8b (Auftrag R): Logo und Knopftext passen zur Plattform des Links, Etikett schneidet Knopf und Ueberschrift nicht
      const m = MOTIVE[f.plattform];
      pruefe(!!m && f.logo === m.logo && f.knopf === m.knopf && f.link === LINKS_JSON[m.link], `${id}: Logo ${f.logo} und Knopf "${f.knopf}" passen zur Plattform ${f.plattform}`);
      const b = f.badge;
      const schneidet = (x) => !!x && x.w > 0 && x.h > 0 && b.l < x.l + x.w - 0.5 && b.l + b.w > x.l + 0.5 && b.t < x.t + x.h - 0.5 && b.t + b.h > x.t + 0.5;
      pruefe(!schneidet(f.knopfBox) && !schneidet(f.titelBox) && f.badge.schrift >= 11, `${id} (${f.layout}): Etikett sichtbar (${f.badge.schrift}px), nicht ueber Knopf oder Ueberschrift`);
    }
    pruefe(f.badge.l >= f.box.l - 1 && f.badge.t >= f.box.t - 1 && f.badge.l + f.badge.w <= f.box.l + f.box.w + 1 && f.badge.t + f.badge.h <= f.box.t + f.box.h + 1, `${id}: Kennzeichnung liegt in der Flaeche`);
    pruefe(!(await originalSichtbar(id)), `${id}: Original unsichtbar`);
    const rot = await rotAnteil(id);
    console.log(`firefox W: ${id} ${f.format} Bild ${f.bildName} Rotanteil ${rot.toFixed(2)} Kennzeichnung ${f.badge.schrift}px, bis Bild ${f.bildMs} ms`);
    pruefe(rot > 0.1, `${id}: Pixel der Dummy-Farbe in der Mitte (${rot.toFixed(2)})`);
  }
  pruefe((await originalSichtbar('n-bild')) && (await originalSichtbar('n-header')), 'normales Bild und Header bleiben sichtbar');
  const frueh = await layoutVon();
  pruefe(JSON.stringify({ ...frueh, schluss: 0, hoehe: 0 }) === JSON.stringify({ ...layoutOhne, schluss: 0, hoehe: 0 }), 'Layout unveraendert (Bild, Header, Shadow)');
  await warte(1500);
  await bisIds('spaete Werbung', [...ERWARTET, 'a-spaet']);
  if (!spaetSchonDa) {
    const ms = await driver.executeScript(() => window.__spaetSicht - window.__spaetAm);
    console.log(`firefox W: spaete Werbung, Mias Bild ${Math.round(ms)} ms nach dem Einfuegen`);
    pruefe(ms > 0 && ms < 300, `spaete Werbung getauscht in ${Math.round(ms)} ms`);
  }
  pruefe(JSON.stringify(await layoutVon()) === JSON.stringify(layoutOhne), 'mit allen Flaechen: Layout wie ohne Pack');

  // 3. Medien
  await warte(1000);
  const rahmenMedium = await imRahmen('#a-rahmen', () => driver.executeScript(() => ({ pausiert: document.getElementById('v').paused, stumm: document.getElementById('v').muted })));
  const flaecheMedium = await driver.executeScript(() => ({ pausiert: document.getElementById('a-video').paused, stumm: document.getElementById('a-video').muted }));
  console.log(`firefox W: Werbe-Rahmen ${JSON.stringify(rahmenMedium)}, Video in der Flaeche ${JSON.stringify(flaecheMedium)}`);
  pruefe(rahmenMedium.pausiert && rahmenMedium.stumm, 'Anzeige im Werbe-Rahmen angehalten und stumm');
  pruefe(flaecheMedium.pausiert && flaecheMedium.stumm, 'Video in der Flaeche angehalten und stumm');
  await bis('Werbung im Rahmen getauscht', async () => imRahmen('#n-rahmen', async () => ((await attrStand())?.flaechen ?? []).filter((f) => f.sichtbar).length === 1), 15_000);

  // 4. Klick oeffnet genau einen Link der Marke in neuem Tab
  const fl = (await attrStand()).flaechen.find((x) => x.id === 'a-sponsored');
  pruefe(fl.ziel === '_blank' && fl.rel === 'noopener noreferrer' && LINKS.includes(fl.link), `Link ${fl.link}: neuer Tab, noopener noreferrer, aus links.json`);
  await driver.executeScript(() => document.getElementById('a-sponsored').scrollIntoView({ block: 'center' }));
  await warte(300);
  const vorher = await driver.getAllWindowHandles();
  const el = await driver.findElement(By.id('a-sponsored'));
  await driver.actions().move({ origin: el }).click().perform();
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(100);
  }
  pruefe(!!neu && (await driver.getAllWindowHandles()).length === vorher.length + 1, 'Klick oeffnete genau einen neuen Tab');
  if (neu) {
    await driver.switchTo().window(neu);
    await driver.close();
  }
  await driver.switchTo().window(hauptFenster);

  // 5. Rotation je Seitenaufruf
  const namen = new Set();
  for (let i = 0; i < 10; i++) {
    await driver.get(nachrichten);
    await bisIds('Rotation', ['a-sponsored']);
    namen.add((await attrStand()).flaechen.find((x) => x.id === 'a-sponsored').bildName);
  }
  console.log(`firefox W: Rotation, ${namen.size} verschiedene Bilder in 10 Aufrufen`);
  pruefe(namen.size >= 2, `Rotation: ${namen.size} verschiedene Bilder`);

  // 6. Scrollen, Groessenwechsel, Transformation
  await bisIds('Flaechen fuer Lage', ERWARTET);
  await driver.executeScript(() => scrollTo(0, 500));
  await warte(600);
  const v1 = await maxVersatz();
  await driver.executeScript(() => window.setzeGroesse('a-sponsored', 336, 280));
  await bis('Format wechselt', async () => (await attrStand()).flaechen.find((x) => x.id === 'a-sponsored')?.format === '336x280');
  await warte(500);
  const v2 = await maxVersatz();
  await driver.executeScript(() => window.setzeGroesse('a-sponsored', 500, 400));
  await bis('Groesse ohne Format: Original zurueck', async () => !(await sichtIds()).includes('a-sponsored'));
  pruefe(await originalSichtbar('a-sponsored'), 'Groesse ohne Format: Original sichtbar');
  await driver.executeScript(() => window.setzeGroesse('a-sponsored', 300, 250));
  await bisIds('wieder getauscht', ['a-sponsored']);
  await driver.executeScript(() => (document.getElementById('a-ins').parentElement.style.transform = 'translate(40px, 15px)'));
  await warte(1200);
  const v3 = await maxVersatz();
  console.log(`firefox W: Versatz nach Scrollen ${v1.toFixed(2)}, Groessenwechsel ${v2.toFixed(2)}, Transformation ${v3.toFixed(2)} px`);
  pruefe(v1 <= 2 && v2 <= 2 && v3 <= 2, `hoechstens 2 px Versatz (${v1}, ${v2}, ${v3})`);

  // 7. Pause, Schalter aus, Ausnahme
  await driver.get(nachrichten);
  await bisIds('vor Pause', ERWARTET);
  for (const [name, aus, an] of [
    ['Pause', { pause: true }, { pause: false }],
    ['Schalter aus', { kontrolle: { ...KONTROLLE, werbung: false } }, { kontrolle: KONTROLLE }],
    ['eigene Ausnahme', { ausnahmen: ['127.0.0.1'] }, { ausnahmen: [] }],
  ]) {
    const tp = Date.now();
    await setzeEinstellungen(aus);
    await bisLeer(`${name}: Flaechen weg`);
    const ms = Date.now() - tp;
    let alle = true;
    for (const id of ERWARTET) alle = alle && (await originalSichtbar(id));
    const innen = await imRahmen('#n-rahmen', async () => ((await attrStand())?.flaechen ?? []).filter((f) => f.sichtbar).length);
    console.log(`firefox W: ${name}: Originale zurueck (inklusive Einstellungswechsel ${ms} ms)`);
    pruefe(alle && innen === 0, `${name}: alle Originale sichtbar, auch im Rahmen`);
    await setzeEinstellungen(an);
    await bisIds(`${name}: wieder getauscht`, ERWARTET);
  }

  // 7b. Eigene Ausnahme des Tabs gilt auch in fremden Rahmen
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await driver.get(nachrichten);
  await warte(4000);
  pruefe((await attrStand()) === null, 'Tab auf Ausnahme: nichts getauscht');
  const adLaeuft = await imRahmen('#a-rahmen', () => driver.executeScript(() => !document.getElementById('v').paused));
  pruefe(adLaeuft, 'Tab auf Ausnahme: Anzeige im Werbe-Rahmen laeuft weiter');
  pruefe((await imRahmen('#n-rahmen2', () => attrStand())) === null && (await imRahmen('#n-rahmen', () => attrStand())) === null, 'Tab auf Ausnahme: auch Rahmen tauschen nichts');
  await setzeEinstellungen({ ausnahmen: [] });
  await bisIds('Ausnahme beendet', ERWARTET);
  await bis('Rahmen anderer Herkunft getauscht', async () => imRahmen('#n-rahmen2', async () => ((await attrStand())?.flaechen ?? []).filter((f) => f.sichtbar).length === 1), 15_000);

  // 7c. Lage: Karussell, Kopfleiste, Dialog, Scrollbereich, Ereignisse
  const lage = `http://127.0.0.1:${port}/werbung-lage.html`;
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, werbung: false } });
  await driver.get(lage);
  await warte(2500);
  const ohneMass = await driver.executeScript(() => ({ b: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await setzeEinstellungen({ kontrolle: KONTROLLE });
  await driver.get(lage);
  await bisIds('Lage-Flaechen', ['a-kar', 'a-wichtig', 'a-aus', 'a-wachs', 'a-fest', 'sh-ins']);
  const lageStand = await attrStand();
  const kar = lageStand.flaechen.find((x) => x.id === 'a-kar');
  const klemm = await rechteck('kar');
  pruefe(kar.box.w > 145 && kar.box.w < 155 && kar.box.l + kar.box.w <= klemm.left + klemm.width + 1 && kar.voll.w > 295, `Karussell beschneidet auf den sichtbaren Teil (${kar.box.w} von ${kar.voll.w})`);
  pruefe(!(await sichtIds()).includes('a-kar-weit'), 'Flaeche ganz ausserhalb des Karussells bleibt weg');
  pruefe(!(await originalSichtbar('a-wichtig')), 'Seiten-CSS mit !important: Original bleibt unsichtbar');
  const mitMass = await driver.executeScript(() => ({ b: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  pruefe(JSON.stringify(ohneMass) === JSON.stringify(mitMass), `Scrollbereich waechst nicht (${JSON.stringify(ohneMass)} und ${JSON.stringify(mitMass)})`);
  await driver.executeScript(() => { const b = document.getElementById('a-wichtig').getBoundingClientRect(); scrollTo(0, scrollY + b.top - 20); });
  await warte(500);
  const oben = await driver.executeScript(() => { const b = document.getElementById('a-wichtig').getBoundingClientRect(); return document.elementsFromPoint(b.left + b.width / 2, 30)[0].id; });
  pruefe(oben === 'kopf', `Kopfleiste liegt ueber der Flaeche (${oben})`);
  await driver.executeScript(() => window.zeigeModal(true));
  const dlg = await driver.executeScript(() => { const b = document.getElementById('a-wichtig').getBoundingClientRect(); return document.elementsFromPoint(b.left + b.width / 2, Math.max(80, b.top + b.height / 2))[0].id; });
  pruefe(dlg === 'modal', `Dialog liegt ueber der Flaeche (${dlg})`);
  await driver.executeScript(() => window.zeigeModal(false));
  await driver.executeScript(() => window.blendeAus(true));
  await bis('Vorfahr blendet aus', async () => !(await sichtIds()).includes('a-aus'), 5000);
  await driver.executeScript(() => window.blendeAus(false));
  await bis('Vorfahr blendet ein', async () => (await sichtIds()).includes('a-aus'), 5000);
  await driver.executeScript(() => window.scrollTo(0, 900));
  await warte(500);
  pruefe((await maxVersatz()) <= 2, 'fixierte Flaeche bleibt am Platz');
  // Ereignisse auf der Flaeche erreichen die Seite nicht (fruehe Zaehler am Fenster)
  await driver.executeScript(() => { document.getElementById('a-wichtig').scrollIntoView({ block: 'center' }); });
  await warte(500);
  await driver.executeScript(() => { window.__ev = { gesamt: 0, aufHost: 0, typen: {} }; });
  const wichtig = await driver.findElement(By.id('a-wichtig'));
  const vorherF = await driver.getAllWindowHandles();
  await driver.actions().move({ origin: wichtig }).click().perform();
  await warte(800);
  const nachF = await driver.getAllWindowHandles();
  for (const h of nachF.filter((x) => !vorherF.includes(x))) {
    await driver.switchTo().window(h);
    await driver.close();
  }
  await driver.switchTo().window(hauptFenster);
  const ev = await driver.executeScript(() => window.__ev);
  console.log(`firefox W: Ereignisse der Seite auf der Flaeche: ${JSON.stringify(ev)}`);
  pruefe(ev.gesamt === 0, 'Ereignisse auf Mias Flaeche erreichen die Seite nicht');

  // 7d. K3: Mias Werbung nie ueber fremdem Dialog (body fest, Huelle mit Hintergrund ueber das Fenster, modales dialog), Skin, Rollsperre
  await driver.get(`http://127.0.0.1:${port}/werbung-dialog.html`);
  const ALLE_D = ['a-oben', 'a-neben', 'a-eigen'];
  await bisIds('Dialog-Seite Flaechen', ALLE_D);
  const obenAn = (x, y, sel) =>
    driver.executeScript((px, py, q) => { const e = document.elementsFromPoint(px, py)[0]; return { id: e.id, imDialog: !!e.closest(q) }; }, x, y, sel);
  const rotBereich = async (x, y, b, h) => {
    const fenster = await driver.executeScript(() => ({ b: innerWidth, h: innerHeight }));
    const png = Buffer.from(await driver.takeScreenshot(), 'base64');
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const sx = info.width / fenster.b;
    const sy = info.height / fenster.h;
    let rot = 0;
    let n = 0;
    for (let yy = Math.round(y * sy); yy < Math.round((y + h) * sy); yy++)
      for (let xx = Math.round(x * sx); xx < Math.round((x + b) * sx); xx++) {
        const i = (yy * info.width + xx) * info.channels;
        n++;
        if (data[i] > 90 && data[i] > data[i + 1] * 2.2 && data[i] > data[i + 2] * 2) rot++;
      }
    return n ? rot / n : 0;
  };
  const gleich = async (erwartet) => JSON.stringify(await sichtIds()) === JSON.stringify([...erwartet].sort());
  // Kennzeichnung jeder sichtbaren Flaeche sichtbar und zuoberst
  const kennzeichnungOben = async (ids) => {
    const st = await attrStand();
    for (const id of ids) {
      const f = st.flaechen.find((x) => x.id === id);
      const t = f && f.badge ? await driver.executeScript((x, y) => { const e = document.elementsFromPoint(x, y)[0]; return { id: e.id, eltern: e.parentElement ? e.parentElement.tagName : '' }; }, f.badge.l + f.badge.w / 2, f.badge.t + f.badge.h / 2) : null;
      pruefe(!!f && f.sichtbar && f.kennzeichnung.length > 0 && !!t && t.id === '' && (t.eltern === 'BODY' || t.eltern === 'HTML'), `K3: Kennzeichnung von ${id} sichtbar und zuoberst (${JSON.stringify(t)})`);
    }
  };
  await warte(600);
  await kennzeichnungOben(ALLE_D);
  // (a) fester Dialog, body fest
  await driver.executeScript(() => window.oeffneCookie(true));
  await warte(1500);
  const ro = await rechteck('a-oben');
  const t1 = await obenAn(ro.left + ro.width / 2, ro.top + 100, '#cookie');
  pruefe(t1.imDialog, `K3: fester Cookie-Dialog liegt ueber Mias Werbung (oben: ${JSON.stringify(t1)})`);
  pruefe((await rotBereich(Math.round(ro.left + ro.width / 2 - 100), Math.round(ro.top + 60), 200, 80)) < 0.02, 'K3: kein Rot im Dialogbereich');
  // Zweite Lesung K3, Fund 1: Flaechen unter dem Dialog (auch unter seinem dimmenden Hintergrund) sind ganz weg, jede noch sichtbare hat
  // ihre Kennzeichnung zuoberst.
  const nochDa = await sichtIds();
  pruefe(!nochDa.includes('a-oben'), 'K3: Flaeche unter dem Dialog ganz verborgen');
  await kennzeichnungOben(nochDa);
  // Nach dem Schliessen kommen alle zurueck (unten geprueft).
  await driver.executeScript(() => window.oeffneCookie(false));
  await bis('Flaechen nach dem Cookie-Dialog zurueck', async () => await gleich(ALLE_D), 4000);
  pruefe(!(await originalSichtbar('a-oben')), 'K3: nach dem Schliessen wieder Mias Werbung');
  await kennzeichnungOben(ALLE_D);
  // (b) Huelle: alle Flaechen weg, nach dem Schliessen wieder da
  await driver.executeScript(() => window.oeffneDrin(true));
  await bis('Huelle-Dialog verbirgt alle Flaechen', async () => (await sichtIds()).length === 0, 4000);
  await warte(1200);
  pruefe((await sichtIds()).length === 0 && !(await originalSichtbar('a-oben')), 'K3: Flaechen bleiben verborgen, Original versteckt');
  await driver.executeScript(() => window.oeffneDrin(false));
  await bis('Flaechen nach dem Schliessen zurueck', () => gleich(ALLE_D), 4000);
  await kennzeichnungOben(ALLE_D);
  // (c) modales dialog
  await driver.executeScript(() => window.oeffneModal(true));
  await warte(1000);
  const dr = await rechteck('modal-dialog');
  const t3 = await obenAn(dr.left + dr.width / 2, dr.top + dr.height / 2, '#modal-dialog');
  pruefe(t3.imDialog, `K3: modales dialog liegt ueber Mias Werbung (oben: ${JSON.stringify(t3)})`);
  await driver.executeScript(() => window.oeffneModal(false));
  await warte(600);
  // (d) Skin mit z-index -1
  await driver.executeScript(() => window.zeigeSkin(true));
  await warte(1200);
  pruefe(await gleich(ALLE_D), 'K3: fester Hintergrund mit z-index -1 laesst Mia unveraendert');
  await driver.executeScript(() => window.zeigeSkin(false));
  // (e) Rollsperre mit negativem top
  await driver.executeScript(() => scrollTo(0, 400));
  await warte(800);
  const vorRoll = await sichtIds();
  await driver.executeScript(() => window.rollSperre(true));
  await warte(1500);
  pruefe(JSON.stringify(await sichtIds()) === JSON.stringify(vorRoll) && vorRoll.length >= 2, `K3: Flaechen bleiben waehrend der Rollsperre (${vorRoll.join(',')})`);
  pruefe((await maxVersatz()) <= 2, 'K3: Versatz unter der Rollsperre hoechstens 2 px');
  for (const f of (await attrStand()).flaechen.filter((x) => x.sichtbar && x.voll && x.voll.t >= 0 && x.voll.t + x.voll.h <= 700)) {
    pruefe(Math.abs(f.box.h - f.voll.h) <= 1, `K3: ${f.id} unter der Rollsperre nicht beschnitten`);
  }
  await driver.executeScript(() => window.rollSperre(false));
  await warte(1200);
  pruefe(JSON.stringify(await sichtIds()) === JSON.stringify(vorRoll), 'K3: nach der Rollsperre unveraendert');

  // 8. Erwachsenenseite: nur nach Groesse
  await driver.get(erwachsenSeite);
  await bisIds('Erwachsenenseite', ['e-flaeche', 'e-kopf']);
  const eids = await sichtIds();
  console.log(`firefox W: Erwachsenenseite getauscht: ${eids.join(', ')}`);
  pruefe(['e-link-gross', 'e-vorschau', 'e-karte', 'e-karte-link', 'e-video', 'e-klein'].every((n) => !eids.includes(n)), 'Erwachsenenseite: Videolinks, Videos und Vorschau bleiben');
  await driver.executeScript(() => window.fuegeVideoEin());
  await bis('Video kommt spaeter: Flaeche weicht', async () => !(await sichtIds()).includes('e-flaeche'), 6000);
  await bis('Vorschau-Tausch', () => driver.executeScript(() => document.getElementById('e-vorschau').hasAttribute('data-veil-ersetzt')), 20_000);
  await driver.get(`http://127.0.0.1:${port}/werbung-erwachsen.html`);
  await warte(2500);
  pruefe((await sichtIds()).length === 0, 'dieselbe Seite auf einem normalen Host: ohne zweites Merkmal nichts');

  // 9. Pack entfernt
  await driver.get(nachrichten);
  await bisIds('vor dem Entfernen', ERWARTET);
  await entfernePack();
  await bisLeer('Pack weg: Flaechen weg');
  let wieder = true;
  for (const id of ERWARTET) wieder = wieder && (await originalSichtbar(id));
  pruefe(wieder, 'Pack entfernt: alle Originale sichtbar');
  serverFremd.close();
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: werbung.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
