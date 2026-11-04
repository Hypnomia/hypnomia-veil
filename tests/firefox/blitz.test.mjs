// Firefox-Test Phase 5, Auftrag B (PHASE-5-AUFTRAEGE-SESSION-9.md Abschnitt 4): Blitzwoerter. Einzelwort und Schwarm erscheinen und enden, Grenzen
// (185 ms je Wort, hoechstens 12 Woerter in 2500 ms) aus dem Testabbild UND aus Pixeln (Chrome-Kontext: drawWindow je Frame, Wortfarbe zaehlen),
// nichts bei Eingabe, Ruhig-Modus, in Rahmen, ohne Pack oder Freischaltung, bei aus, auf Ausnahme, ohne bestaetigte Warnung; Pause und Taste
// brechen ab; Zeitplan. Firefox zaehlt nur den sichtbaren Tab als sichtbar: gewartet wird immer im Tab der Seite.
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
  console.error('firefox: Zeitlimit von 420 s ueberschritten');
  process.exit(1);
}, 420_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const SEITE = `${basis}/blitz.html`;
const DUMMY_WOERTER = ['TESTWORD', 'TESTFLASH', 'TESTDOWN'];
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 };

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

const attrVon = (name) => driver.executeScript((n) => document.documentElement.getAttribute(n), name);
const abbildVon = async () => {
  const roh = await attrVon('data-veil-blitz');
  return roh ? JSON.parse(roh) : null;
};
const sende = (blitz) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ blitz }));
async function loeseAus(blitz) {
  const vorher = (await abbildVon())?.nr ?? 0;
  await sende(blitz);
  await bis('Antwort des Moduls', async () => ((await abbildVon())?.nr ?? 0) > vorher, 10_000);
  return abbildVon();
}
const warteEnde = async () => {
  await bis('Ereignis zu Ende', async () => (await abbildVon())?.laeuft === false, 10_000);
  return abbildVon();
};
async function erwarteAbgelehnt(grund, text, blitz = { ereignis: 'wort' }) {
  const a = await loeseAus(blitz);
  pruefe(a.abgelehnt === grund && a.woerter.length === 0, `${text} (abgelehnt=${a.abgelehnt})`);
}
async function neueSeite(abfrage = '') {
  await driver.get(SEITE + abfrage);
  await warte(1500);
}
const setzeSpeicher = (werte) => mitOptionen(() => imSeitenkontext(`await api.storage.local.set(args[0]); return true;`, werte));
const loescheSpeicher = (...k) => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove(args[0]); return true;`, k));
const liesSpeicher = (k) => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]];`, k));
const taste = (k) => driver.actions({ async: true }).sendKeys(k).perform();

// Pixel: im Chrome-Kontext je Frame den Inhalt des Tabs in eine kleine Leinwand zeichnen und die Wortfarbe (Mias Pink) zaehlen.
// Loest nach 200 ms das Testereignis aus (aus dem Chrome-Kontext, damit der WebDriver frei bleibt) und liefert die Bilder.
async function nimmAuf(blitz, dauerMs) {
  // Das Ereignis loest die Seite selbst nach 300 ms aus; die Aufnahme laeuft schon im Chrome-Kontext.
  await driver.executeScript("setTimeout(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] })), 300)", JSON.stringify({ blitz }));
  await driver.setContext(firefox.Context.CHROME);
  try {
    const roh = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const dauer = arguments[0];
       const win = Services.wm.getMostRecentWindow('navigator:browser');
       const br = win.gBrowser.selectedBrowser;
       const lw = 320, lh = 180;
       const c = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
       c.width = lw; c.height = lh;
       const g = c.getContext('2d', { willReadFrequently: true });
       const bilder = [];
       const t0 = win.performance.now();
       const schritt = async () => {
         try {
           const t = win.performance.now();
           const w = br.clientWidth, h = br.clientHeight;
           const bm = await br.drawSnapshot(0, 0, w, h, lw / w, 'rgb(0,0,0)');
           g.drawImage(bm, 0, 0, lw, lh);
           const d = g.getImageData(0, 0, lw, lh).data;
           let n = 0, sx = 0, rs = 0, rz = 0;
           for (let i = 0; i < d.length; i += 4) {
             if (Math.floor(i / 4 / lw) >= lh * 0.92) { rs += (d[i] + d[i + 1] + d[i + 2]) / 3; rz++; }
             if (d[i] > 200 && d[i + 1] < 140 && d[i + 2] > 100 && d[i + 2] < 230) { n++; sx += (i / 4) % lw; }
           }
           bilder.push({ ts: win.performance.now(), n, cx: n ? sx / n : -1, rand: rz ? rs / rz : 0 });
           if (t - t0 > dauer) return fertig(JSON.stringify(bilder));
         } catch (e) { return fertig(JSON.stringify({ fehlerText: String(e) })); }
         win.setTimeout(schritt, 0);
       };
       schritt();`,
      dauerMs,
    );
    const erg = JSON.parse(roh);
    if (erg.fehlerText) throw new Error(erg.fehlerText);
    return erg;
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}
// Ein "Wort erscheint": Sprung von keinem Pink zu Pink oder Sprung des Schwerpunkts um mehr als 20 (von 320) Pixel.
function pixelWorte(bilder, schwelle = 12) {
  const an = [];
  let vorher = null;
  for (const b of bilder) {
    const da = b.n >= schwelle;
    const war = vorher && vorher.n >= schwelle;
    if (da && (!war || Math.abs(b.cx - vorher.cx) > 20)) an.push(b.ts);
    vorher = b;
  }
  return an;
}
// Groesster Helligkeitsunterschied (von 255) der untersten 8 % der Zeilen (dort steht nie ein Wort) ueber alle Bilder: ohne Flaechenwechsel nahe 0.
const randSchwankung = (bilder) => Math.max(...bilder.map((b) => b.rand)) - Math.min(...bilder.map((b) => b.rand));
const minAbstand = (z) => (z.length < 2 ? Infinity : Math.min(...z.slice(1).map((t, i) => t - z[i])));
const maxLuecke = (bilder) => Math.max(...bilder.slice(1).map((b, i) => b.ts - bilder[i].ts));

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-blitz-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const altPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPfad, (await baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);

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
  await loescheEinstellungen();
  await setzeSpeicher({ quizWarnungGesehen: true });
  await warte(1000);

  // 1. Ohne Pack
  await neueSeite();
  await erwarteAbgelehnt('kein-pack', 'ohne Pack zeigt sich nichts');

  // 2. Pack importieren
  await importierePack(packPfad);
  await neueSeite('?regel=1');

  // 3. Einzelwort
  let a = await loeseAus({ ereignis: 'wort', zufall: [0.5] });
  pruefe(a.abgelehnt === undefined, `Einzelwort startet (${JSON.stringify(a).slice(0, 200)})`);
  a = await warteEnde();
  const w1 = a.woerter[0];
  console.log(`firefox B: Einzelwort Sichtdauer ${(w1.aus - w1.an).toFixed(0)} ms (Abbild)`);
  pruefe(a.abbruch === 'fertig' && a.woerter.length === 1 && DUMMY_WOERTER.includes(w1.text), 'Einzelwort: eines, aus dem Pack, regulaer beendet');
  pruefe(w1.aus - w1.an >= 280 && w1.aus - w1.an <= 380, 'Einzelwort: etwa 300 ms sichtbar');
  await warte(600);
  let bilder = await nimmAuf({ ereignis: 'wort', zufall: [0.5] }, 1400);
  let px = pixelWorte(bilder);
  const sicht = bilder.filter((b) => b.n >= 12);
  console.log(`firefox B: Einzelwort Pixel ${px.length} Wort, ${sicht.length} Bilder mit Pink, Schwerpunkt x ${sicht[0]?.cx.toFixed(0)} von 320, groesste Bildluecke ${maxLuecke(bilder).toFixed(0)} ms`);
  pruefe(px.length === 1 && sicht.length > 0 && Math.abs(sicht[0].cx - 160) < 25, 'Einzelwort in Pixeln: genau eines, in der Mitte');
  pruefe(bilder[bilder.length - 1].n < 12, 'Einzelwort in Pixeln: am Ende kein Pink mehr');
  console.log(`firefox B: Einzelwort Randstreifen schwankt um ${randSchwankung(bilder).toFixed(1)} von 255 (Seite mit groben div-Regeln)`);
  pruefe(randSchwankung(bilder) < 6, 'Einzelwort: kein vollflaechiger Wechsel trotz grober Seitenregeln (Randstreifen gleich hell)');
  await warteEnde();

  // 4. Schwarm: Abbild und Pixel
  for (const zufall of [[0.0], [0.9, 0.3, 0.6], [0.99, 0.5, 0.1, 0.8]]) {
    await warte(300);
    bilder = await nimmAuf({ ereignis: 'schwarm', zufall }, 3600);
    a = await warteEnde();
    const ws = a.woerter;
    const abst = ws.slice(1).map((w, i) => w.an - ws[i].an);
    const spanne = ws[ws.length - 1].aus - ws[0].an;
    px = pixelWorte(bilder);
    const pa = px.slice(1).map((t, i) => t - px[i]);
    const sichtbar = bilder.filter((b) => b.n >= 12);
    const pspanne = sichtbar.length ? sichtbar[sichtbar.length - 1].ts - px[0] : 0;
    const luecke = maxLuecke(bilder);
    console.log(`firefox B: Schwarm ${JSON.stringify(zufall)}: ${ws.length} Woerter, kleinster Abstand ${Math.min(...abst).toFixed(0)} ms, Spanne ${spanne.toFixed(0)} ms (Abbild); Pixel ${px.length} Woerter, kleinster Abstand ${Math.min(...pa).toFixed(0)} ms, Spanne ${pspanne.toFixed(0)} ms, groesste Bildluecke ${luecke.toFixed(0)} ms`);
    pruefe(a.abbruch === 'fertig' && ws.length >= 6 && ws.length <= 12, `Schwarm ${JSON.stringify(zufall)}: 6 bis 12 Woerter (${ws.length})`);
    pruefe(ws.every((w, i) => i === 0 || w.text !== ws[i - 1].text), 'Schwarm: nie dasselbe Wort zweimal in Folge');
    pruefe(Math.min(...abst) >= 185 && spanne <= 2500, 'Schwarm im Abbild: Abstand mindestens 185 ms, Spanne hoechstens 2500 ms');
    // Pixel: die Bildluecke der Aufnahme (drawWindow je Frame) wird als Toleranz gerechnet
    pruefe(px.length <= 12 && px.length >= ws.length - 1, `Schwarm in Pixeln: ${px.length} Woerter (Abbild ${ws.length})`);
    pruefe(Math.min(...pa) >= 185 - luecke && pspanne <= 2500 + luecke, 'Schwarm in Pixeln: Abstand und Spanne innerhalb der Grenzen (Toleranz eine Bildluecke)');
    pruefe(randSchwankung(bilder) < 6, 'Schwarm: kein vollflaechiger Wechsel (Randstreifen gleich hell)');
  }

  // 5. Eingabe: Eingabefeld, editierbarer Bereich, Rahmen, Taste
  await neueSeite();
  await driver.executeScript(() => document.getElementById('feld').focus());
  await erwarteAbgelehnt('eingabe', 'Fokus im Eingabefeld: nichts');
  await driver.executeScript(() => document.getElementById('bearbeitbar').focus());
  await erwarteAbgelehnt('eingabe', 'Fokus im editierbaren Bereich: nichts');
  await driver.executeScript(() => document.getElementById('rahmen').contentDocument.getElementById('innen').focus());
  await erwarteAbgelehnt('eingabe', 'Fokus im Rahmen: nichts');
  await neueSeite();
  await taste('a');
  await warte(300);
  await erwarteAbgelehnt('eingabe', 'Taste vor 0,3 s: nichts');
  await warte(1000);
  await erwarteAbgelehnt('eingabe', 'etwa 1,5 s nach der Taste: noch gesperrt');
  await warte(1000);
  a = await loeseAus({ ereignis: 'wort' });
  pruefe(a.abgelehnt === undefined, `2,3 s nach der Taste geht es wieder (abgelehnt=${a.abgelehnt})`);
  await warteEnde();

  // 6. Ruhig-Modus
  await setzeEinstellungen({ ruhig: true });
  await neueSeite();
  await erwarteAbgelehnt('ruhig', 'Ruhig-Modus: nichts');
  await setzeEinstellungen({ ruhig: false });

  // 7. Nur oberste Seite
  await neueSeite();
  await driver.executeScript(() => {
    const d = document.getElementById('rahmen').contentDocument;
    d.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ blitz: { ereignis: 'wort' } }) }));
  });
  await warte(1200);
  pruefe((await driver.executeScript(() => document.getElementById('rahmen').contentDocument.documentElement.hasAttribute('data-veil-status'))) === true, 'Gegenprobe: der Schleier lief im Rahmen');
  pruefe((await driver.executeScript(() => document.getElementById('rahmen').contentDocument.documentElement.getAttribute('data-veil-blitz'))) === null, 'im Rahmen kein Blitz-Modul');

  // 8. aus, Ausnahme, Pause, Warnung
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, blitz: 'aus' } });
  await neueSeite();
  await erwarteAbgelehnt('aus', 'Schalter aus: nichts');
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE }, ausnahmen: ['127.0.0.1'] });
  await neueSeite();
  await erwarteAbgelehnt('nicht-erlaubt', 'eigene Ausnahme: nichts');
  await setzeEinstellungen({ ausnahmen: [], pause: true });
  await neueSeite();
  await erwarteAbgelehnt('nicht-erlaubt', 'gespeicherte Pause: nichts');
  await setzeEinstellungen({ pause: false });
  await mitOptionen(() => imSeitenkontext(`await api.storage.local.remove(['quizWarnungGesehen', 'spiraleWarnungGesehen']); return true;`));
  await neueSeite();
  await erwarteAbgelehnt('warnung', 'Warnung nicht bestaetigt: nichts');
  await setzeSpeicher({ spiraleWarnungGesehen: true });
  a = await loeseAus({ ereignis: 'wort' });
  pruefe(a.abgelehnt === undefined, 'Warnung auf der Spirale bestaetigt: geht');
  await warteEnde();

  // 9. Pause bricht einen laufenden Schwarm ab (der Tab bleibt sichtbar: Pause per Testereignis aus der Seite)
  await neueSeite();
  await loeseAus({ ereignis: 'schwarm', zufall: [0.5] });
  await bis('zwei Woerter', async () => ((await abbildVon())?.woerter.length ?? 0) >= 2, 5000);
  const tp = Date.now();
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen: { pause: true } }));
  a = await warteEnde();
  console.log(`firefox B: Pause brach ab nach ${a.woerter.length} Woertern, Grund ${a.abbruch}, ${Date.now() - tp} ms`);
  pruefe(a.woerter.length < 12 && ['einstellung', 'pause'].includes(a.abbruch), `Pause bricht den Schwarm ab, Tab sichtbar (Grund ${a.abbruch})`);
  await setzeEinstellungen({ pause: false });

  // 10. Taste bricht ab
  await neueSeite();
  await loeseAus({ ereignis: 'schwarm', zufall: [0.5] });
  await bis('zwei Woerter', async () => ((await abbildVon())?.woerter.length ?? 0) >= 2, 5000);
  await taste('b');
  a = await warteEnde();
  console.log(`firefox B: Taste brach ab nach ${a.woerter.length} Woertern, Grund ${a.abbruch}`);
  pruefe(a.abbruch === 'taste' && a.woerter.length < 12, 'Taste bricht den Schwarm ab');

  // 10b. Riegel: mitten im Schwarm abbrechen, solange er steht nichts, Pause im Riegel (Hintergrund antwortet nie) haelt Blitzwoerter auf
  await neueSeite();
  await loeseAus({ ereignis: 'schwarm', zufall: [0.5] });
  await bis('zwei Woerter', async () => ((await abbildVon())?.woerter.length ?? 0) >= 2, 5000);
  const riegelAbbild = async () => JSON.parse((await attrVon('data-veil-riegel')) ?? 'null');
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ riegel: { oeffne: { frage: 'test-w1', pauseHaengt: true } } }));
  a = await warteEnde();
  console.log(`firefox B: Riegel brach den Schwarm ab nach ${a.woerter.length} Woertern, Grund ${a.abbruch}`);
  pruefe(a.abbruch === 'belegt', 'Riegel erscheint mitten im Schwarm: Abbruch (belegt)');
  const rg = await bis('Riegel zeigt die Frage', async () => {
    const r = await riegelAbbild();
    return r && r.zustand === 'frage' ? r : null;
  }, 10_000);
  await erwarteAbgelehnt('belegt', 'solange der Riegel steht: nichts');
  await driver.actions({ async: true }).move({ x: Math.round(rg.pause.x + rg.pause.w / 2), y: Math.round(rg.pause.y + rg.pause.h / 2), origin: 'viewport' }).click().perform();
  await bis('Riegel zu (Pause)', async () => (await attrVon('data-veil-riegel-ergebnis')) === 'pause', 6000);
  const gesp = await mitOptionen(() => imSeitenkontext(`return ((await api.storage.local.get('einstellungen')).einstellungen ?? {}).pause ?? false;`));
  await erwarteAbgelehnt('nicht-erlaubt', 'lokale Pause aus dem Riegel (nichts gespeichert): Blitzwoerter bleiben aus');
  pruefe(gesp === false, 'die Pause steht nur lokal, gespeichert ist keine');

  // 10c. Vollbild
  await neueSeite();
  await loeseAus({ ereignis: 'schwarm', zufall: [0.5] });
  await bis('zwei Woerter', async () => ((await abbildVon())?.woerter.length ?? 0) >= 2, 5000);
  await driver.findElement(By.css('#vollbild')).click();
  a = await warteEnde();
  console.log(`firefox B: Vollbild brach ab nach ${a.woerter.length} Woertern, Grund ${a.abbruch}`);
  pruefe(a.abbruch === 'vollbild', 'Vollbild bricht den Schwarm ab');
  await erwarteAbgelehnt('vollbild', 'im Vollbild: nichts');

  // 10d. Tab verborgen: Abbruch, und der Zeitgeber ruht, bis der Tab wieder sichtbar ist
  await neueSeite();
  await loeseAus({ ereignis: 'schwarm', zufall: [0.5] });
  await bis('zwei Woerter', async () => ((await abbildVon())?.woerter.length ?? 0) >= 2, 5000);
  await oeffneErweiterung('options.html');
  await warte(400);
  await zurueckZumHaupt();
  a = await abbildVon();
  console.log(`firefox B: verborgener Tab brach ab nach ${a.woerter.length} Woertern, Grund ${a.abbruch}`);
  pruefe(a.laeuft === false && a.abbruch === 'verborgen', 'verborgener Tab bricht den Schwarm ab (verborgen)');
  {
    // Zeitgeber: Pack-Import auf 1 setzen, Plan noch nicht faellig, Zeitgeber mit 200 ms einschalten; im verborgenen Tab wird der Plan faellig.
    // Die Optionsseite gleicht das Pack beim Laden mit der Datenbank ab und schreibt den Import-Zeitpunkt zurueck: die Vorbereitung laeuft darum
    // in der Popup-Seite, die das nicht tut.
    await oeffneErweiterung('popup.html');
    try {
      await imSeitenkontext(`const p = (await api.storage.local.get('pack')).pack; await api.storage.local.set({ pack: { ...p, importiert: 1 } }); await api.storage.local.set({ blitzZeitplan: { zuletzt: Date.now() - 60000, abstandMs: 600000 } }); return true;`);
    } finally {
      await zurueckZumHaupt();
    }
    
    await neueSeite();
    await warte(1200);
    pruefe((await abbildVon()) === null, 'Testbau: der Zeitgeber laeuft nicht von selbst');
    await sende({ taktMs: 200 });
    await oeffneErweiterung('popup.html');
    const vorher = await imSeitenkontext(`await api.storage.local.set({ blitzZeitplan: { zuletzt: Date.now() - 800000, abstandMs: 600000 } }); await new Promise((r) => setTimeout(r, 1500)); return (await api.storage.local.get('blitzZeitplan')).blitzZeitplan;`);
    await zurueckZumHaupt();
    pruefe(vorher.abstandMs === 600000 && Date.now() - vorher.zuletzt > 790000, 'Zeitgeber ruht im verborgenen Tab: der faellige Plan blieb 1,5 s unberuehrt');
    await bis('Wort nach der Rueckkehr', async () => ((await abbildVon())?.woerter.length ?? 0) > 0, 8000);
    pruefe(true, 'Zeitgeber laeuft wieder, sobald der Tab sichtbar ist: faelliges Wort kam');
    await warteEnde();
  }

  // 11. Zeitplan
  await neueSeite();
  await mitOptionen(() => imSeitenkontext(`await api.storage.local.remove('blitzZeitplan'); return true;`));
  const jetzt = Date.now();
  a = await loeseAus({ takt: true, jetzt });
  const plan = await liesSpeicher('blitzZeitplan');
  console.log(`firefox B: Zeitplan neu, Abstand ${(plan.abstandMs / 60000).toFixed(1)} min`);
  pruefe(a.abgelehnt === 'nicht-faellig' && plan.zuletzt === jetzt && plan.abstandMs >= 480_000 && plan.abstandMs <= 720_000, 'Zeitplan: fehlender Plan ab jetzt, 8 bis 12 min');
  a = await loeseAus({ takt: true, jetzt: jetzt + 300_000 });
  pruefe(a.abgelehnt === 'nicht-faellig', 'Zeitplan: nach 5 min nicht faellig');
  a = await loeseAus({ takt: true, jetzt: jetzt + 780_000, ereignis: 'wort' });
  pruefe(a.abgelehnt === undefined, 'Zeitplan: nach 13 min faellig, Wort');
  await warteEnde();
  pruefe((await liesSpeicher('blitzZeitplan')).zuletzt === jetzt + 780_000, 'Zeitplan: neuer Plan ab dem Ereignis');
  // Plan aus der Zeit vor dem Import gilt als fehlend
  {
    const imp = (await liesSpeicher('pack')).importiert;
    await setzeSpeicher({ blitzZeitplan: { zuletzt: imp - 3_600_000, abstandMs: 600_000 } });
    await neueSeite();
    const j = imp + 1000;
    a = await loeseAus({ takt: true, jetzt: j, ereignis: 'wort' });
    pruefe(a.abgelehnt === 'nicht-faellig' && (await liesSpeicher('blitzZeitplan')).zuletzt === j, 'nach erneutem Import: Plan von davor gilt als fehlend, kein Wort sofort');
  }

  // 12. Altes Pack ohne Freischaltung
  await importierePack(altPfad);
  await neueSeite();
  a = await loeseAus({ ereignis: 'wort' });
  pruefe(a.abgelehnt === 'nicht-erlaubt' && a.woerter.length === 0, `altes Pack: nichts (abgelehnt=${a.abgelehnt})`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: blitz.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
