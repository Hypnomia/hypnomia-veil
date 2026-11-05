// Firefox-Test Phase 5, Auftrag M (PHASE-5-AUFTRAEGE-SESSION-10 Abschnitt 5): Meldungen. Der Testhaken `meldung-test` loest einen Anlass fuer den Tab des
// Absenders aus (Hintergrund, dann echte Nachricht `inhalt/meldung`). Gemessen werden Zeit bis zur Antwort, Sichtzeit, Lage, Abstand, Zaehler und alle
// Faelle ohne Meldung, dazu ein verborgener Tab. Firefox zaehlt nur den sichtbaren Tab als sichtbar: gewartet wird immer im Tab der Seite.
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
  console.error('firefox: Zeitlimit von 300 s ueberschritten');
  process.exit(1);
}, 300_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47423);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const seite = (query = '') => `${basis}/meldungen.html${query}`;

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


// ---------- Hilfen fuer die Meldungen ----------
let nr = 100;
const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: false, leerlaufMinuten: 2, tabtitel: false, cursor: 'aus', meldungen: true, besuche: false, zeiten: [] };
const setzeKontrolle = (teil) => setzeEinstellungen({ kontrolle: { ...KONTROLLE, ...teil } });
const schreibe = (k, w) => mitOptionen(() => imSeitenkontext(`await api.storage.local.set({ [args[0]]: args[1] }); return true;`, k, w));
const entferneSchluessel = (k) => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove(args[0]); return true;`, k));
const liesSpeicher = (k) => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]] ?? null;`, k));
const abbild = async () => {
  const t = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-meldung')`);
  return t ? JSON.parse(t) : null;
};
async function bisAbbild(beschreibung, pruefFn, frist = 15_000, schritt = 15) {
  const t0 = Date.now();
  let a = null;
  while (Date.now() - t0 < frist) {
    a = await abbild();
    if (a && pruefFn(a)) return a;
    await warte(schritt);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen, letztes Abbild ${JSON.stringify(a)?.slice(0, 400)}`);
}
async function sende(teil) {
  const n = ++nr;
  await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ meldung: { ...JSON.parse(arguments[0]), nr: arguments[1] } }) }))`, JSON.stringify(teil), n);
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    const a = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-meldung-antwort')`);
    if (a && JSON.parse(a).nr === n) return JSON.parse(a).antwort ?? { ok: false };
    await warte(10);
  }
  throw new Error('keine Antwort des Hintergrunds');
}
const einstellungImTab = (teil) => driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ einstellungen: arguments[0] }) }))`, teil);
const hostAnzahl = () => driver.executeScript(`return document.querySelectorAll('[data-veil-meldung-host]').length`);
const zaehler = () => driver.executeScript(`return window.zaehler`);
const capture = () => driver.executeScript(`return window.zaehlerCapture`);
async function oeffne(query = '') {
  await driver.get(seite(query));
  await bis('Testspur da', () => driver.executeScript(`return document.documentElement.hasAttribute('data-veil-meldung')`));
  await driver.actions({ async: true }).move({ x: 150, y: 130, origin: 'viewport' }).perform();
  await warte(300);
}
async function zeige(anlass = 'zensiert', zahl = 50) {
  const t0 = Date.now();
  const antwort = await sende({ anlass, zahl, vergiss: true });
  return { ms: Date.now() - t0, antwort };
}
async function bisWeg() {
  const a = await bisAbbild('Meldung weg', (x) => x.phase === 'ruhend', 15_000, 5);
  pruefe((await hostAnzahl()) === 0, 'Host nach dem Ende weg');
  return a;
}
const aktionen = () => driver.actions({ async: true });
const mitte = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), origin: 'viewport' });
const heuteKennung = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-meldungen-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`firefox: Version ${version}`);
  await driver.setContext(firefox.Context.CHROME).catch(() => {});
  await driver.setContext(firefox.Context.CONTENT);
  await driver.executeScript('return 1');
  await driver.switchTo().window(hauptFenster);
  await driver.manage();
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await warte(1500);
  await loescheEinstellungen();

  // 1. Ohne Pack: nichts
  await oeffne();
  let antwort = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  await warte(400);
  pruefe(antwort.gezeigt === false && (await hostAnzahl()) === 0 && (await abbild()).gezeigt === 0, 'ohne Pack: keine Meldung, kein Host');
  console.log('firefox meldungen: ohne Pack 0 Meldungen, 0 Hosts');

  // 2. Pack und Einstellungen
  await importierePack(packPfad);
  await setzeKontrolle({});
  await entferneSchluessel('meldungStand');

  // 3. Meldung: Lage, Satz, Chibi, kein Fokus
  await oeffne();
  const z1 = await zeige();
  pruefe(z1.antwort.gezeigt === true, `Meldung gezeigt (Antwort ${JSON.stringify(z1.antwort)})`);
  const a = await bisAbbild('steht mit Chibi', (x) => x.phase === 'steht' && (x.deckkraft ?? 0) > 0.95 && x.chibi, 8000, 10);
  const g = await driver.executeScript(`return { b: innerWidth, h: innerHeight, letzter: document.documentElement.lastElementChild?.hasAttribute('data-veil-meldung-host') ?? false, imBody: document.body.querySelectorAll('[data-veil-meldung-host]').length, aktiv: document.activeElement?.tagName }`);
  pruefe(a.satz === 'Test censored 50 line.' && a.anlass === 'zensiert' && a.pose === 'jubeln', `Satz ${a.satz}, Anlass ${a.anlass}, Pose ${a.pose}`);
  pruefe(g.letzter && g.imBody === 0 && g.aktiv === 'BODY' && a.fokusImHost === false, `Host am Ende von html ${g.letzter}, im body ${g.imBody}, Fokus ${g.aktiv}`);
  pruefe(a.host.w <= 360 && a.host.x + a.host.w > g.b - 40 && a.host.y + a.host.h > g.h - 40, `Lage unten rechts (${JSON.stringify(a.host)}), Breite ${a.host.w}`);
  console.log(`firefox meldungen: Antwort gezeigt nach ${z1.ms} ms, Breite ${a.host.w} px (Grenze 360), Chibi ${a.chibi}`);

  // 4. Klick auf die Meldung erreicht die Seite nicht; Klick daneben schon; Schliessen
  await aktionen().move({ x: a.host.x + 90, y: a.host.y + a.host.h - 6, origin: 'viewport' }).click().perform();
  await warte(300);
  let z = await zaehler();
  let c = await capture();
  pruefe((await abbild()).phase === 'steht' && z.click + z.mousedown + z.mouseup + z.untenClick === 0 && c.click + c.mousedown + c.mouseup === 0, `Klick auf Meldung: Seite zaehlt click ${z.click}, mousedown ${z.mousedown}, frueher Horcher ${c.click}/${c.mousedown}`);
  // Fokus: ein Textfeld der Seite behaelt ihn bei Klick, Ziehen und Schliessen, keine Textauswahl
  await driver.executeScript(`const f = document.getElementById('feld'); window.blurs = 0; f.addEventListener('blur', () => { window.blurs++; }); f.value = 'abc'; f.focus();`);
  await aktionen().move({ x: a.host.x + 90, y: a.host.y + a.host.h - 6, origin: 'viewport' }).click().perform();
  await aktionen().move({ x: a.host.x + 40, y: a.host.y + 40, origin: 'viewport' }).press().move({ x: a.host.x + 200, y: a.host.y + 50, origin: 'viewport' }).release().perform();
  const fokus1 = await driver.executeScript(`return { id: document.activeElement.id, blurs: window.blurs, auswahl: String(getSelection()) }`);
  pruefe(fokus1.id === 'feld' && fokus1.blurs === 0 && fokus1.auswahl === '', `Fokus nach Klick und Ziehen: ${fokus1.id}, blur ${fokus1.blurs}, Auswahl "${fokus1.auswahl}"`);
  const tz = Date.now();
  await aktionen().move(mitte(a.schliessen)).click().perform();
  const zu = await bisWeg();
  const msZu = Date.now() - tz;
  pruefe(zu.endeGrund === 'schliessen', `Schliessen-Knopf, Grund ${zu.endeGrund}`);
  pruefe((await driver.executeScript(`return document.activeElement.id + '/' + window.blurs`)) === 'feld/0', 'Fokus nach Schliessen noch im Textfeld, 0 blur');
  z = await zaehler();
  pruefe(z.click + z.mousedown + z.mouseup + z.untenClick === 0, `Schliessen erreicht die Seite nicht (click ${z.click})`);
  await zeige();
  const d = await bisAbbild('steht', (x) => x.phase === 'steht');
  await aktionen().move({ x: d.host.x - 30, y: d.host.y + 20, origin: 'viewport' }).click().perform();
  await warte(300);
  z = await zaehler();
  pruefe(z.untenClick === 1 && (await abbild()).phase === 'steht', `Klick daneben geht an die Seite (untenClick ${z.untenClick})`);
  console.log(`firefox meldungen: Schliessen nach ${msZu} ms, Klick auf Meldung Seite zaehlt 0, daneben untenClick ${z.untenClick}`);

  // 5. Sichtzeit 8 s
  await oeffne();
  await zeige();
  const s1 = await bisAbbild('steht', (x) => x.phase === 'steht');
  const weg = await bisWeg();
  const sicht = weg.endeZeit - s1.sichtbarSeit;
  pruefe(weg.endeGrund === 'zeit' && sicht > 7500 && sicht < 9500, `Sichtzeit ${Math.round(sicht)} ms, Grund ${weg.endeGrund}`);
  console.log(`firefox meldungen: Sichtzeit ${Math.round(sicht)} ms (Soll 8000)`);

  // 6. Abstand
  await oeffne();
  const e1 = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  const s2 = await bisAbbild('steht', (x) => x.phase === 'steht');
  await aktionen().move(mitte(s2.schliessen)).click().perform();
  await bisWeg();
  const e2 = await sende({ anlass: 'stufe' });
  pruefe(e1.gezeigt === true && e2.gezeigt === false && e2.grund === 'abstand' && (await hostAnzahl()) === 0, `zweite Meldung: gezeigt ${e2.gezeigt} (${e2.grund})`);
  const e3 = await sende({ anlass: 'stufe', vergiss: true });
  pruefe(e3.gezeigt === true, 'nach vergiss wieder moeglich');
  console.log(`firefox meldungen: zweite Meldung gezeigt ${e2.gezeigt} (${e2.grund}), nach vergiss ${e3.gezeigt}`);

  // 7. Zaehler: 49 + 1
  await oeffne();
  await entferneSchluessel('meldungStand');
  await schreibe('meldungStand', { version: 1, tag: heuteKennung(), zensiert: 49, zensiertSchritte: 0, erwachsenMs: 0, erwachsenSchritte: 0, erwachsenMinute: -1, stufe: 0, strengKennung: null, zuletzt: 0, wartend: {} });
  const r1 = await sende({ zahl: 1 });
  const s3 = await bisAbbild('steht', (x) => x.phase === 'steht', 8000);
  pruefe(r1.gezeigt === true && r1.anlass === 'zensiert' && s3.satz === 'Test censored 50 line.' && s3.zahl === 50, `Zaehler 49+1: Anlass ${r1.anlass}, Satz ${s3.satz}`);
  await aktionen().move(mitte(s3.schliessen)).click().perform();
  await bisWeg();
  console.log(`firefox meldungen: Zaehler 49+1 -> Meldung mit ${s3.zahl}`);

  // 8. Pause, Schalter aus, Ausnahme
  await entferneSchluessel('meldungStand');
  await setzeEinstellungen({ pause: true });
  await warte(300);
  const p1 = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  await setzeEinstellungen({ pause: false });
  await setzeKontrolle({ meldungen: false });
  const p2 = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  await setzeKontrolle({});
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await warte(300);
  const p3 = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  await setzeEinstellungen({ ausnahmen: [] });
  pruefe(p1.gezeigt === false && p2.gezeigt === false && p3.gezeigt === false && (await hostAnzahl()) === 0, `Pause ${p1.gezeigt}, Schalter aus ${p2.gezeigt}, Ausnahme ${p3.gezeigt}`);
  // Pause waehrend sie steht
  await warte(300);
  await zeige();
  await bisAbbild('steht', (x) => x.phase === 'steht');
  const tp = Date.now();
  await einstellungImTab({ pause: true });
  const wp = await bisWeg();
  pruefe(wp.endeGrund === 'einstellung', `Pause waehrend sie steht: Grund ${wp.endeGrund}`);
  await einstellungImTab({ pause: false });
  // lokale Pause
  await warte(300);
  await zeige();
  await bisAbbild('steht', (x) => x.phase === 'steht');
  const tl = Date.now();
  await driver.executeScript(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ meldung: { lokalePause: true } }) }))`);
  const wl = await bisWeg();
  const msLokal = Date.now() - tl;
  pruefe(wl.endeGrund === 'pause', `lokale Pause: Grund ${wl.endeGrund}`);
  console.log(`firefox meldungen: Pause/Schalter/Ausnahme 0 Meldungen, lokale Pause weg nach ${msLokal} ms`);

  // 8b. Schalter aus, waehrend sie steht
  await oeffne();
  await zeige();
  await bisAbbild('steht', (x) => x.phase === 'steht');
  const tsa = Date.now();
  await einstellungImTab({ kontrolle: { ...KONTROLLE, meldungen: false } });
  const wsa = await bisWeg();
  const msSa = Date.now() - tsa;
  pruefe(wsa.endeGrund === 'einstellung' && msSa < 500, `Schalter aus waehrend sie steht: Grund ${wsa.endeGrund}, ${msSa} ms`);
  await einstellungImTab({ kontrolle: KONTROLLE });
  await warte(300);

  // 8c. Zeiger auf der Meldung verlaengert die Sichtzeit
  await zeige();
  const zv = await bisAbbild('steht', (x) => x.phase === 'steht' && (x.deckkraft ?? 0) > 0.95);
  await aktionen().move(mitte(zv.host)).perform();
  await warte(9500);
  const nochDa = (await abbild()).phase === 'steht';
  await aktionen().move({ x: 150, y: 130, origin: 'viewport' }).perform();
  const wz = await bisWeg();
  pruefe(nochDa && wz.endeGrund === 'zeit', `mit Zeiger darauf nach 9,5 s noch da ${nochDa}, danach weg (${wz.endeGrund})`);
  console.log(`firefox meldungen: Schalter aus waehrend sie steht weg nach ${msSa} ms; mit Zeiger darauf nach 9,5 s noch da ${nochDa}`);

  // 8d. Stufe und strenge Zeit (regulaere Auswertung ohne Anlass)
  await entferneSchluessel('meldungStand');
  await schreibe('meldungStand', { version: 1, tag: heuteKennung(), zensiert: 0, zensiertSchritte: 0, erwachsenMs: 0, erwachsenSchritte: 0, erwachsenMinute: -1, stufe: 0, strengKennung: null, strengZuletzt: 0, zuletzt: 0, wartend: {} });
  await schreibe('steigerung', { version: 1, stufe: 2, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null });
  await oeffne();
  const rs = await sende({ vergiss: true, zahl: 0 });
  const ss = await bisAbbild('steht', (x) => x.phase === 'steht', 8000);
  pruefe(rs.anlass === 'stufe' && ss.satz === 'Test level up line.', `Stufe 0->2: Anlass ${rs.anlass}, Satz ${ss.satz}`);
  await aktionen().move(mitte(ss.schliessen)).click().perform();
  await bisWeg();
  const jetztMin = await driver.executeScript(`return new Date().getHours() * 60 + new Date().getMinutes()`);
  await setzeKontrolle({ zeiten: [{ tage: [0, 1, 2, 3, 4, 5, 6], von: (jetztMin - 29 + 1440) % 1440, bis: (jetztMin + 30) % 1440 }] });
  const rt = await sende({ vergiss: true, zahl: 0 });
  const st = await bisAbbild('steht', (x) => x.phase === 'steht', 8000);
  pruefe(rt.anlass === 'streng' && st.satz === 'Test strict time line.', `strenge Zeit: Anlass ${rt.anlass}, Satz ${st.satz}`);
  await aktionen().move(mitte(st.schliessen)).click().perform();
  await bisWeg();
  const rt2 = await sende({ vergiss: true, zahl: 0 });
  pruefe(rt2.gezeigt === false, `strenge Zeit nur einmal je Fenster (zweite Auswertung gezeigt ${rt2.gezeigt})`);
  await setzeKontrolle({});
  console.log(`firefox meldungen: Stufe 0->2 gezeigt, strenge Zeit einmal gezeigt (zweite Auswertung ${rt2.gezeigt})`);

  // 9. Verborgener Tab und Rahmen
  await oeffne('?rahmen=1');
  const erstes = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(`${basis}/hello.html`);
  await warte(300);
  const zweites = (await driver.getAllWindowHandles()).find((h) => h !== erstes);
  // Der Testhaken feuert aus einem Zeitgeber der Seite erst, wenn Tab 2 vorn ist (die Seite sieht dann visibilityState hidden).
  await driver.switchTo().window(erstes);
  await driver.executeScript(`setTimeout(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ meldung: { anlass: 'zensiert', zahl: 50, vergiss: true, nr: 9001 } }) })), 1200)`);
  await driver.switchTo().window(zweites);
  await warte(4000);
  await driver.switchTo().window(erstes);
  const antwort9 = await bis('Antwort des verborgenen Tabs', () => driver.executeScript(`return document.documentElement.getAttribute('data-veil-meldung-antwort')`), 10_000);
  const verborgen = JSON.parse(antwort9).antwort;
  pruefe(verborgen && verborgen.gezeigt === false, `verborgener Tab: gezeigt ${verborgen?.gezeigt}`);
  const sichtbar = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  pruefe(sichtbar.gezeigt === true, 'sichtbarer Tab bekommt die Meldung');
  const imRahmen = await driver.executeScript(`const f = document.getElementById('rahmen'); return f ? f.contentDocument.querySelectorAll('[data-veil-meldung-host]').length : -1`);
  pruefe(imRahmen === 0, `Hosts in Rahmen ${imRahmen}`);
  await driver.switchTo().window(zweites);
  await driver.close();
  await driver.switchTo().window(erstes);
  console.log(`firefox meldungen: verborgener Tab gezeigt ${verborgen?.gezeigt}, sichtbarer ${sichtbar.gezeigt}, Hosts in Rahmen ${imRahmen}`);

  // 10. Pack weg: keine Meldung mehr (die Meldung selbst auf einer Seite zu entfernen, geht in Firefox nur ueber einen zweiten Tab, der sie verbirgt;
  // das Weggehen bei Pack-Wechsel im Vordergrund prueft Chromium)
  await entferneSchluessel('meldungStand');
  await entfernePack();
  await oeffne();
  const ende = await sende({ anlass: 'zensiert', zahl: 50, vergiss: true });
  await warte(300);
  pruefe(ende.gezeigt === false && (await hostAnzahl()) === 0, `Pack entfernt: gezeigt ${ende.gezeigt}`);
  void tp;
  console.log('firefox meldungen: Pack entfernt: 0 Meldungen');
} catch (e) {
  console.error('firefox: FEHLER', e?.stack ?? e);
  code = 1;
} finally {
  try {
    await driver?.quit();
  } catch {
    // egal
  }
  await server?.close?.();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox meldungen: ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
