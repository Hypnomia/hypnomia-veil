// Firefox-Test Phase 6, Auftrag T (PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 7): Ton zu Quiz und Blitzwoertern. Dummy-Pack mit synthetischen
// Toenen, Abspielversuch im Content-Script (Testabbild `data-veil-ton`: Name, Lautstaerke, Ergebnis), nichts ohne Pack, ohne Freischaltung, bei
// Schalter aus, Pause (gespeichert und lokal), eigener Ausnahme; Abstand 300 ms, ein Klang zugleich, Pause beendet sofort; Schalter, Regler und
// "Play a sample" der Einstellungsseite mit echten Klicks, Wirkung im Speicher gemessen. Firefox zaehlt nur den sichtbaren Tab als sichtbar.
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
import { TON_TEXTE } from '../../src/ton/texte.ts';

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
const SEITE = `${basis}/ton.html`;
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 };
const EREIGNIS_ZU_NAME = { 'quiz-start': 'quiz', 'quiz-richtig': 'richtig', 'quiz-falsch': 'falsch', 'quiz-verweigert': 'verweigert', blitz: 'trigger' };

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
async function fall(name, fn) {
  try {
    await fn();
  } catch (e) {
    rot++;
    console.error(`firefox: ROT  ${name}: ${e instanceof Error ? e.message : e}`);
  }
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
const setzeSpeicher = (werte) => mitOptionen(() => imSeitenkontext(`await api.storage.local.set(args[0]); return true;`, werte));
const liesSpeicher = (k) => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]];`, k));
// Auf der gerade offenen Erweiterungsseite lesen (ohne neue Seite)
const liesHier = (k) => imSeitenkontext(`return (await api.storage.local.get(args[0]))[args[0]];`, k);
// Aus einem Rahmen heraus Einstellungen setzen: erst zum Hauptdokument, dann ueber die Optionsseite, danach zurueck in den Rahmen.
async function setzeEinstellungenAusRahmen(neu) {
  await driver.switchTo().defaultContent();
  await setzeEinstellungen(neu);
  await driver.switchTo().frame(await driver.findElement(By.css('#rahmen')));
}
const TON_AN = (lautstaerke) => ({ ton: { an: true, lautstaerke } });

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
  const roh = await attrVon('data-veil-ton');
  return roh ? JSON.parse(roh) : null;
};
const versucheVon = async () => (await abbildVon())?.versuche ?? [];
const nrVon = async () => (await abbildVon())?.nr ?? 0;
const sende = (ton) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ ton }));
async function spieleUndWarte(ereignis) {
  const vorher = await nrVon();
  await sende({ ereignis });
  await bis(`Versuch nach ${ereignis}`, async () => (await nrVon()) > vorher, 8000);
  return (await versucheVon()).at(-1);
}
async function erwarteStille(ereignis, beschreibung) {
  const vorher = await nrVon();
  await sende({ ereignis });
  await warte(900);
  pruefe((await nrVon()) === vorher, `${beschreibung}: kein Versuch (Zaehler ${vorher} -> ${await nrVon()})`);
}
async function neueSeite() {
  await driver.get(SEITE);
  await bis('Content-Script', () => driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')"), 15_000);
  await warte(800);
}
async function klickeAuf(r) {
  await driver.actions({ async: true }).move({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), origin: 'viewport' }).click().perform();
}
const riegelAbbild = async () => {
  const roh = await attrVon('data-veil-riegel');
  return roh ? JSON.parse(roh) : null;
};
const oeffneRiegel = (o) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ riegel: { oeffne: o } }));
const riegelBis = (name, fn, frist = 8000) => bis(name, async () => { const a = await riegelAbbild(); return a && fn(a) ? a : null; }, frist);
const namen = (v) => v.map((x) => x.name).join(',');

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-ton-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const ohneTonPfad = path.join(ordner, 'ohne-ton.miapack');
  await writeFile(ohneTonPfad, (await baueDummyPack({ ohneTon: true, id: 'ohne-ton' })).bytes);
  const altPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPfad, (await baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  // Autoplay-Sperre fuer den Test lockern, damit "gespielt" messbar ist (der Fall mit abgelehntem Abspielen bleibt still: siehe unten).
  optionen.setPreference('media.autoplay.default', 0);
  optionen.setPreference('media.autoplay.blocking_policy', 0);
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

  await fall('ohne Pack', async () => {
    await setzeEinstellungen(TON_AN(0.5));
    await neueSeite();
    for (const e of Object.keys(EREIGNIS_ZU_NAME)) await erwarteStille(e, `ohne Pack ${e}`);
    console.log('firefox ton: ohne Pack 5 Ereignisse, 0 Versuche');
  });

  await fall('Einstellungsseite ohne Pack', async () => {
    await loescheEinstellungen();
    await oeffneErweiterung('options.html');
    try {
      await bis('Abschnitt da', () => sichtbar('#ton-titel'));
      pruefe((await driver.findElement(By.css('#ton-titel')).getAttribute('textContent')) === TON_TEXTE.titel, 'Ueberschrift');
      pruefe((await driver.findElement(By.css('#ton')).getAttribute('aria-labelledby')) === 'ton-titel', 'aria-labelledby ton-titel');
      pruefe(!(await driver.findElement(By.css('#ton-an')).isSelected()), 'Schalter standardmaessig aus');
      pruefe((await driver.findElement(By.css('#ton-lautstaerke')).getAttribute('value')) === '60', 'Regler steht auf 60');
      pruefe((await text('#ton-lautstaerke-wert')) === '60%', 'Anzeige 60%');
      pruefe((await driver.findElement(By.css('#ton-pack-hinweis')).getAttribute('textContent')) === TON_TEXTE.hinweisOhnePack, 'Hinweis ohne Pack');
      pruefe(!(await driver.findElement(By.css('#ton-probe')).isEnabled()), 'Probe ohne Pack gesperrt');
      pruefe(await driver.findElement(By.css('#ton-lautstaerke')).isEnabled(), 'Regler ohne Pack stellbar');
      // echte Klicks
      await driver.findElement(By.css('#ton-an-zeile')).click();
      await bis('an gespeichert', async () => (await liesHier('einstellungen'))?.ton?.an === true, 5000);
      await driver.findElement(By.css('#ton-an-zeile')).click();
      await bis('aus gespeichert', async () => (await liesHier('einstellungen'))?.ton?.an === false, 5000);
      pruefe(true, 'Schalter: Klick an und aus im Speicher');
      const regler = driver.findElement(By.css('#ton-lautstaerke'));
      await regler.sendKeys(Key.END);
      await bis('Ende gespeichert', async () => (await liesHier('einstellungen'))?.ton?.lautstaerke === 1, 5000);
      pruefe((await text('#ton-lautstaerke-wert')) === '100%', 'Anzeige 100% nach Ende');
      await regler.sendKeys(Key.HOME);
      await bis('Anfang gespeichert', async () => (await liesHier('einstellungen'))?.ton?.lautstaerke === 0, 5000);
      pruefe((await text('#ton-lautstaerke-wert')) === '0%', 'Anzeige 0% nach Anfang');
      await driver.executeScript('arguments[0].scrollIntoView({ block: "center" })', regler);
      const r = await driver.executeScript('const b = arguments[0].getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height };', regler);
      await driver.actions({ async: true }).move({ x: Math.round(r.x + r.width * 0.25), y: Math.round(r.y + r.height / 2), origin: 'viewport' }).click().perform();
      await bis('Klick gespeichert', async () => ((await liesHier('einstellungen'))?.ton?.lautstaerke ?? 0) > 0.15, 5000);
      const l = (await liesHier('einstellungen')).ton.lautstaerke;
      console.log(`firefox ton: Schalter an/aus, Regler Ende 1, Anfang 0, Klick bei 25 Prozent der Breite ergibt ${l} (Speicher)`);
      pruefe(l > 0.15 && l < 0.35 && (await text('#ton-lautstaerke-wert')) === `${Math.round(l * 100)}%`, 'Reglerklick nahe 25 Prozent, Anzeige passt');
    } finally {
      await zurueckZumHaupt();
    }
  });

  await fall('Pack importieren und packton', async () => {
    await importierePack(packPfad);
    pruefe((await liesSpeicher('pack')).freischaltungen.includes('ton'), 'Freischaltung ton im Speicher');
    await oeffneErweiterung('options.html');
    try {
      await bis('Probe frei', () => driver.findElement(By.css('#ton-probe')).isEnabled());
      const erg = await imSeitenkontext(`
        const aus = {};
        for (const n of ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger', 'unsinn', '../quiz', 42]) aus[String(n)] = await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packton', name: n });
        return aus;`);
      let gut = 0;
      for (const n of ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger']) {
        const u = erg[n]?.dataUrl;
        if (typeof u === 'string' && u.startsWith('data:audio/wav;base64,')) {
          const b = Buffer.from(u.split(',')[1], 'base64');
          if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE') gut++;
        }
      }
      const schlecht = ['unsinn', '../quiz', '42'].filter((n) => erg[n]?.dataUrl === null).length;
      console.log(`firefox ton: packton liefert ${gut} von 5 echten WAV, ${schlecht} von 3 ungueltigen Namen null`);
      pruefe(gut === 5 && schlecht === 3, 'packton: 5 WAV, 3 ungueltige Namen null');
    } finally {
      await zurueckZumHaupt();
    }
  });

  await fall('Ton aus', async () => {
    await setzeEinstellungen({ ton: { an: false, lautstaerke: 0.5 } });
    await neueSeite();
    await erwarteStille('quiz-start', 'Standard aus');
    await erwarteStille('blitz', 'Schalter aus');
  });

  await fall('alle fuenf Anlaesse', async () => {
    await setzeEinstellungen(TON_AN(0.4));
    await neueSeite();
    const elemente = await driver.executeScript('return document.getElementsByTagName("*").length');
    for (const e of Object.keys(EREIGNIS_ZU_NAME)) {
      await spieleUndWarte(e);
      await warte(380);
    }
    const v = await versucheVon();
    console.log(`firefox ton: 5 Anlaesse bei Lautstaerke 0,4 -> ${v.map((x) => `${x.name}:${x.ergebnis}`).join(', ')}`);
    pruefe(namen(v) === 'quiz,richtig,falsch,verweigert,trigger' && v.every((x) => x.lautstaerke === 0.4), 'Namen in Reihenfolge, Lautstaerke 0,4');
    pruefe(v.every((x) => x.ergebnis === 'gespielt'), 'jeder Klang wirklich gestartet (gespielt)');
    pruefe((await driver.executeScript('return document.querySelectorAll("audio, source").length')) === 0, 'kein Audio-Element im DOM');
    pruefe((await driver.executeScript('return document.getElementsByTagName("*").length')) === elemente, 'Elementzahl der Seite unveraendert');
  });

  await fall('Abstand 300 ms', async () => {
    await setzeEinstellungen(TON_AN(0.6));
    await neueSeite();
    await driver.executeScript(`
      const s = (ereignis) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ton: { ereignis } }) }));
      s('quiz-richtig'); s('quiz-falsch'); s('quiz-falsch');`);
    await warte(500);
    let v = await versucheVon();
    console.log(`firefox ton: 3 Ereignisse in einem Augenblick -> ${v.length} Klang (${namen(v)})`);
    pruefe(namen(v) === 'richtig', 'drei Ereignisse gleichzeitig: ein Klang, der erste');
    await warte(100);
    await sende({ ereignis: 'quiz-falsch' });
    await bis('zweiter Klang', async () => (await versucheVon()).length === 2, 5000);
    pruefe(namen(await versucheVon()) === 'richtig,falsch', 'nach 300 ms wieder ein Klang');
  });

  await fall('ein Klang zugleich, Lautstaerke live', async () => {
    await setzeEinstellungen(TON_AN(0.8));
    await neueSeite();
    await spieleUndWarte('quiz-start');
    await bis('quiz laeuft', async () => (await abbildVon())?.laufend === 'quiz', 3000);
    pruefe(Math.abs((await abbildVon()).volume - 0.8) < 1e-6, 'Lautstaerke 0,8 am laufenden Klang');
    await setzeEinstellungen(TON_AN(0.25));
    await bis('Lautstaerke live', async () => Math.abs(((await abbildVon())?.volume ?? 0) - 0.25) < 1e-6, 3000);
    await warte(350);
    await spieleUndWarte('quiz-richtig');
    const a = await abbildVon();
    console.log(`firefox ton: neuer Klang ersetzt den laufenden, laeuft jetzt ${a.laufend} bei Lautstaerke ${a.volume}`);
    pruefe(a.laufend === 'richtig', 'neuer Klang ersetzt den laufenden');
  });

  await fall('Schalter aus, Lautstaerke 0 und Pause beenden sofort', async () => {
    await setzeEinstellungen(TON_AN(0.6));
    await neueSeite();
    await spieleUndWarte('quiz-start');
    await bis('quiz laeuft', async () => (await abbildVon())?.laufend === 'quiz', 3000);
    await setzeEinstellungen({ ton: { an: false, lautstaerke: 0.6 } });
    const t0 = Date.now();
    await bis('Schalter aus stoppt', async () => (await abbildVon())?.laufend === null, 3000);
    console.log(`firefox ton: Schalter aus beendet den Klang (Speicher bis Abbild ${Date.now() - t0} ms, mit WebDriver-Aufruf)`);
    pruefe(true, 'Schalter aus beendet den Klang');
    await warte(400);
    await setzeEinstellungen(TON_AN(0.6));
    await warte(300);
    await spieleUndWarte('quiz-start');
    await bis('quiz laeuft', async () => (await abbildVon())?.laufend === 'quiz', 3000);
    await setzeEinstellungen(TON_AN(0));
    await bis('Lautstaerke 0 stoppt', async () => (await abbildVon())?.laufend === null, 3000);
    await erwarteStille('quiz-richtig', 'Lautstaerke 0');
    // gespeicherte Pause
    await setzeEinstellungen(TON_AN(0.6));
    await warte(400);
    await spieleUndWarte('quiz-start');
    await bis('quiz laeuft', async () => (await abbildVon())?.laufend === 'quiz', 3000);
    await setzeEinstellungen({ pause: true });
    await bis('Pause stoppt', async () => (await abbildVon())?.laufend === null, 3000);
    await erwarteStille('quiz-richtig', 'gespeicherte Pause');
    await setzeEinstellungen({ pause: false });
    await warte(400);
    pruefe((await spieleUndWarte('quiz-richtig')).name === 'richtig', 'ohne Pause wieder ein Klang');
  });

  await fall('eigene Ausnahme', async () => {
    await setzeEinstellungen({ ...TON_AN(0.6), ausnahmen: ['127.0.0.1'] });
    await neueSeite();
    await erwarteStille('quiz-start', 'Ausnahme');
    await erwarteStille('blitz', 'Ausnahme');
    await setzeEinstellungen({ ausnahmen: [] });
    await warte(400);
    pruefe((await spieleUndWarte('blitz')).name === 'trigger', 'ohne Ausnahme wieder ein Klang');
    console.log('firefox ton: Ausnahme 127.0.0.1 -> 0 Versuche in 2 Ereignissen, ohne Ausnahme 1 Versuch');
  });

  await fall('echter Quiz-Riegel', async () => {
    await setzeEinstellungen(TON_AN(0.5));
    await neueSeite();
    // 0. lokale Pause WAEHREND des langen Klangs quiz (2 s)
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 400, pauseHaengt: true });
    let a = await riegelBis('Frage', (x) => x.zustand === 'frage');
    await bis('quiz laeuft', async () => (await abbildVon())?.laufend === 'quiz', 3000);
    const tPause = Date.now();
    await klickeAuf(a.pause);
    await bis('Klang endet', async () => (await abbildVon())?.laufend === null, 3000);
    const bisStill = Date.now() - tPause;
    pruefe(bisStill < 1500, `der Klang (2 s) endete durch die Pause, nicht durch sein Ende (${bisStill} ms mit WebDriver-Aufrufen)`);
    const nach = await nrVon();
    await sende({ ereignis: 'quiz-richtig' });
    await warte(900);
    pruefe((await nrVon()) === nach, 'lokale Pause: kein weiterer Klang');
    pruefe(((await liesSpeicher('einstellungen'))?.pause ?? false) === false, 'gespeicherte Pause kam nie an (pauseHaengt)');
    console.log(`firefox ton: lokale Pause mitten im Klang quiz beendete ihn (Klick bis Abbild ${bisStill} ms), danach kein Klang (Zaehler ${nach})`);

    // 1. Start und falsche Antwort
    await neueSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 400 });
    a = await riegelBis('Frage', (x) => x.zustand === 'frage');
    await bis('quiz-Klang', async () => namen(await versucheVon()) === 'quiz', 5000);
    await warte(400);
    await klickeAuf(a.antworten.find((b) => b.text === 'beta'));
    await bis('falsch-Klang', async () => namen(await versucheVon()) === 'quiz,falsch', 5000);

    await neueSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 400 });
    a = await riegelBis('Frage', (x) => x.zustand === 'frage');
    await warte(400);
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    await bis('richtig-Klang', async () => namen(await versucheVon()) === 'quiz,richtig', 5000);
    await bis('geloest', async () => (await attrVon('data-veil-riegel-ergebnis')) === 'geloest', 5000);

    await neueSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 1, zufall: [0.1], verweigertMs: 400, richtigMs: 200 });
    a = await riegelBis('Frage', (x) => x.zustand === 'frage');
    await warte(400);
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    await bis('verweigert-Klang', async () => namen(await versucheVon()) === 'quiz,verweigert', 5000);
    const v = await versucheVon();
    console.log(`firefox ton: Riegel richtig -> quiz,richtig; verweigert -> ${v.map((x) => `${x.name}:${x.lautstaerke}:${x.ergebnis}`).join(', ')}`);
    pruefe(true, 'Riegel: quiz, falsch, richtig und verweigert gaben ihren Klang');
  });

  await fall('echtes Blitzwort', async () => {
    await setzeEinstellungen({ ...TON_AN(0.7), kontrolle: { ...KONTROLLE } });
    await neueSeite();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ blitz: { ereignis: 'wort', zufall: [0.5] } }));
    await bis('trigger-Klang', async () => namen(await versucheVon()) === 'trigger', 10_000);
    const v = (await versucheVon())[0];
    console.log(`firefox ton: Blitzwort -> Klang ${v.name}, Lautstaerke ${v.lautstaerke}, ${v.ergebnis}, Quelle ${v.quelle}`);
    pruefe(v.lautstaerke === 0.7 && v.quelle === 'blitz', 'Blitzwort: Lautstaerke 0,7, Quelle blitz');
    await warte(1200);
    await setzeEinstellungen({ kontrolle: { ...KONTROLLE, blitz: 'aus' } });
    await warte(400);
    const nr = await nrVon();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ blitz: { ereignis: 'wort' } }));
    await warte(1200);
    pruefe((await nrVon()) === nr, 'Blitz aus: kein Wort, kein Klang');
  });

  await fall('Rahmen: Ausnahme der Tab-Adresse', async () => {
    // Seite auf 127.0.0.1, Rahmen auf localhost: die Ausnahme steht nur fuer die Tab-Adresse.
    await setzeEinstellungen({ ...TON_AN(0.6), ausnahmen: ['127.0.0.1'] });
    await driver.get(`${basis}/ton-rahmen.html`);
    await bis('Rahmen da', () => driver.executeScript("return !!document.getElementById('rahmen')"));
    await warte(1500);
    await driver.switchTo().frame(await driver.findElement(By.css('#rahmen')));
    try {
      await bis('Content-Script im Rahmen', () => driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')"), 15_000);
      pruefe((await driver.executeScript('return location.hostname')) === 'localhost', 'Rahmen liegt auf localhost');
      await sende({ ereignis: 'quiz-start' });
      await warte(1000);
      const still = await nrVon();
      pruefe(still === 0, `Tab-Ausnahme schweigt im Rahmen (Zaehler ${still})`);
      await setzeEinstellungenAusRahmen({ ausnahmen: [] });
      await warte(500);
      await sende({ ereignis: 'quiz-start' });
      await bis('Klang im Rahmen', async () => (await nrVon()) === 1, 8000);
      console.log(`firefox ton: Rahmen (localhost) in Tab 127.0.0.1: mit Tab-Ausnahme ${still} Versuche, ohne Ausnahme 1 Versuch`);
      pruefe(true, 'ohne Ausnahme spielt der Rahmen');
    } finally {
      await driver.switchTo().defaultContent();
    }
  });

  await fall('Seite mit CSP media-src self', async () => {
    await setzeEinstellungen(TON_AN(0.6));
    await driver.get(`${basis}/ton-csp.html`);
    await bis('Content-Script', () => driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')"), 15_000);
    await warte(800);
    const v = await spieleUndWarte('quiz-richtig');
    console.log(`firefox ton: Seite mit CSP media-src 'self' -> Ergebnis ${v.ergebnis}`);
    pruefe(v.ergebnis === 'gespielt' || v.ergebnis === 'abgelehnt', 'CSP-Seite: Ergebnis gemessen, kein Fehler');
    pruefe((await abbildVon()).laufend === (v.ergebnis === 'gespielt' ? 'richtig' : null), 'abgelehnt: nichts laeuft');
  });

  await fall('Probe auf der Einstellungsseite', async () => {
    await loescheEinstellungen();
    await oeffneErweiterung('options.html');
    try {
      const regler = driver.findElement(By.css('#ton-lautstaerke'));
      await regler.sendKeys(Key.HOME);
      for (let i = 0; i < 30; i++) await regler.sendKeys(Key.ARROW_RIGHT);
      await bis('30 gespeichert', async () => Math.abs(((await liesHier('einstellungen'))?.ton?.lautstaerke ?? 0) - 0.3) < 1e-6, 5000);
      await driver.findElement(By.css('#ton-probe')).click();
      await bis('Probe-Abbild', async () => (await driver.findElement(By.css('#ton-probe')).getAttribute('data-veil-ton')) !== null, 8000);
      const p = JSON.parse(await driver.findElement(By.css('#ton-probe')).getAttribute('data-veil-ton'));
      console.log(`firefox ton: Probe spielte ${p.name} bei ${p.lautstaerke} (${p.ergebnis})`);
      pruefe(p.name === 'richtig' && Math.abs(p.lautstaerke - 0.3) < 1e-6 && p.ergebnis === 'gespielt', 'Probe: richtig, 0,3, gespielt');
      pruefe((await driver.findElement(By.css('#ton-probe-meldung')).getAttribute('textContent')) === TON_TEXTE.probeGespielt, 'Probe-Meldung');
      pruefe((await liesHier('einstellungen')).ton.an === false, 'Probe unabhaengig vom Schalter');
      await regler.sendKeys(Key.HOME);
      await bis('0 gespeichert', async () => (await liesHier('einstellungen'))?.ton?.lautstaerke === 0, 5000);
      await driver.findElement(By.css('#ton-probe')).click();
      await bis('Probe bei 0', async () => JSON.parse((await driver.findElement(By.css('#ton-probe')).getAttribute('data-veil-ton')) ?? '{}').lautstaerke === 0, 8000);
      pruefe((await driver.findElement(By.css('#ton-probe-meldung')).getAttribute('textContent')) === TON_TEXTE.probeStumm, 'Probe bei 0: Meldung stumm');
      pruefe((await driver.executeScript('return document.querySelectorAll("audio").length')) === 0, 'kein Audio-Element auf der Einstellungsseite');
    } finally {
      await zurueckZumHaupt();
    }
  });

  await fall('Pack ohne Ton und altes Pack', async () => {
    for (const pfad of [ohneTonPfad, altPfad]) {
      await importierePack(pfad);
      await setzeEinstellungen(TON_AN(0.6));
      await neueSeite();
      await erwarteStille('quiz-start', 'Pack ohne Ton');
      await erwarteStille('blitz', 'Pack ohne Ton');
      await oeffneErweiterung('options.html');
      try {
        await bis('Hinweis da', async () => (await driver.findElement(By.css('#ton-pack-hinweis')).getAttribute('textContent')) === TON_TEXTE.hinweisAltesPack);
        pruefe(!(await driver.findElement(By.css('#ton-probe')).isEnabled()), 'Probe gesperrt');
        const a = await imSeitenkontext(`return await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packton', name: 'richtig' });`);
        pruefe(a.dataUrl === null, 'packton null ohne Freischaltung');
      } finally {
        await zurueckZumHaupt();
      }
    }
    console.log('firefox ton: Pack ohne Ton und Pack aus Phase 3: 0 Versuche, packton null, Probe gesperrt');
  });

  await fall('Pack entfernen', async () => {
    await importierePack(packPfad);
    await setzeEinstellungen(TON_AN(0.6));
    await neueSeite();
    await spieleUndWarte('quiz-start');
    await bis('quiz laeuft', async () => (await abbildVon())?.laufend === 'quiz', 3000);
    await entfernePack();
    await bis('Klang endet', async () => (await abbildVon())?.laufend === null, 5000);
    await warte(400);
    await erwarteStille('quiz-richtig', 'nach dem Entfernen');
    await importierePack(packPfad);
    await warte(500);
    pruefe((await spieleUndWarte('quiz-richtig')).name === 'richtig', 'nach neuem Import wieder ein Klang');
    console.log('firefox ton: Pack entfernt -> Klang endet und still, nach neuem Import wieder ein Klang');
  });
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: ton.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
