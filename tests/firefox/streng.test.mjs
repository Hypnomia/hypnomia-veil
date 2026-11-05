// Firefox-Test Auftrag Z1 (Session 10): strenge Zeiten. Popup (Stufe plus eins, Zeile "Strict time until"), Steigerung im Content-Script (YuNet
// laeuft bei Stufe 1 plus eins), Player-Riegel auf einer normalen Seite (localhost) in einem Fenster. Gleiche Faelle wie tests/chromium/streng.spec.ts.
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
import { DUMMY_QUIZ } from '../../scripts/pack/dummy-inhalte.mjs';
import { textAusMinuten } from '../../src/kontrolle/streng.ts';

setTimeout(() => {
  console.error('firefox streng: Zeitlimit von 400 s ueberschritten');
  process.exit(1);
}, 400_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const SEITE = `http://127.0.0.1:${port}/erwachsen-player.html`;
const ADAPTER_SEITE = `http://pornhub.veil-erwachsen.test:${port}/erwachsen-player.html`;
const NEUTRAL = `http://localhost:${port}/erwachsen-player.html`;
const STEIGERUNG_SEITE = `http://127.0.0.1:${port}/steigerung.html?veil-steigerung-takt=400`;
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();
const FRAGEN = DUMMY_QUIZ.fragen.filter((f) => f.art === 'wissen' || f.art === 'allgemein');
const EINST = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } };

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox streng: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let rot = 0;
function pruefe(bedingung, text) {
  if (!bedingung) {
    rot++;
    console.error(`firefox streng: ROT  ${text}`);
  }
}
async function bis(beschreibung, fn, frist = 10_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(40);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 300)})`);
}

let driver;
let server;
let ordner;
let inhaltFenster;

// ---------- Erweiterungsseiten (wie tests/firefox/quiz.test.mjs) ----------
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
  await bis('Erweiterungsseite geladen', async () => (await driver.executeScript('return location.protocol + String(document.readyState)')) === 'moz-extension:complete', 10_000);
}
async function schliesse() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1) {
    await driver.close();
    await driver.switchTo().window(inhaltFenster);
  }
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
async function ausErweiterung(code, ...args) {
  await oeffne('options.html');
  try {
    const r = await imSeitenkontext(code, ...args);
    if (r && typeof r === 'object' && r.fehlerText) throw new Error(`Erweiterungsseite: ${r.fehlerText}`);
    return r;
  } finally {
    await schliesse();
  }
}
const einstellungenAendern = (teil) =>
  ausErweiterung(`const alt = (await api.storage.local.get('einstellungen')).einstellungen || {}; await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } }); return true;`, teil);
const gespeichertePause = () => ausErweiterung(`return ((await api.storage.local.get('einstellungen')).einstellungen || {}).pause === true;`);

// ---------- Inhaltsseite ----------
const abbild = async () => JSON.parse((await driver.executeScript("return document.documentElement.getAttribute('data-veil-riegel')")) ?? 'null');
const hostDa = () => driver.executeScript("return document.querySelector('[data-veil-riegel-host]') !== null");
const abbildBis = (beschr, pred, frist) =>
  bis(beschr, async () => {
    const a = await abbild();
    return a && pred(a) ? a : null;
  }, frist);
const riegelOffen = () => abbildBis('Riegel offen', (a) => a.offen && a.zustand === 'frage');
async function oeffneSeite(url = SEITE) {
  await driver.get(url);
  await bis('Film bereit', () => driver.executeScript("return document.documentElement.dataset.filmBereit === '1'"), 40_000);
}
const neuesVideo = (o) => driver.executeScript('window.neuesVideo(arguments[0]); return true;', o);
const video = (id) => driver.executeScript('const v = window.findeVideo(arguments[0]); return { paused: v.paused, t: v.currentTime, muted: v.muted, ended: v.ended };', id);
async function bleibtStehen(id, text) {
  const a = await video(id);
  await warte(700);
  const b = await video(id);
  pruefe(a.paused && b.paused && b.t - a.t < 0.02, `${text}: Video bleibt stehen (${JSON.stringify([a, b])})`);
}
async function laeuft(id, text) {
  const a = await video(id);
  try {
    await bis(`${text}: laeuft`, async () => (await video(id)).t - a.t > 0.2, 6000);
  } catch (e) {
    pruefe(false, String(e.message));
    return;
  }
  pruefe(!(await video(id)).paused, `${text}: nicht pausiert`);
}

async function klickeAuf(r) {
  await driver.actions({ async: true }).move({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), origin: 'viewport' }).click().perform();
}
async function loese() {
  const a = await riegelOffen();
  const f = FRAGEN.find((q) => q.id === a.frage.id);
  await klickeAuf(a.antworten.find((b) => b.text === f.antworten[f.richtig]));
  await bis('Riegel zu', async () => !(await hostDa()), 10_000);
}
async function importierePack(pfad) {
  await oeffne('options.html');
  await driver.findElement(By.css('#datei')).sendKeys(pfad);
  await bis('Lizenz', () => driver.findElement(By.css('#lizenz-block')).isDisplayed());
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack-Titel', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'));
  await imSeitenkontext(`await api.storage.local.set({ quizWarnungGesehen: true }); return true;`);
  await schliesse();
}

const heute = new Date().getDay();
const morgen = (heute + 1) % 7;
const GANZ_HEUTE = [{ tage: [heute], von: 0, bis: 0 }];
const NUR_MORGEN = [{ tage: [morgen], von: 0, bis: 0 }];
const kurz = (f) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen: f, bilder: 0, vorschau: 0, chibis: 0, groesse: 1, importiert: 1 });
const stand = (s) => ({ version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null, ...s });
// Ueber popup.html statt options.html: die Einstellungsseite gleicht beim Oeffnen das Pack mit IndexedDB ab und wuerde ein Test-Pack ohne Daten entfernen.
async function ausPopupSeite(code, ...args) {
  await oeffne('popup.html');
  try {
    const r = await imSeitenkontext(code, ...args);
    if (r && typeof r === 'object' && r.fehlerText) throw new Error(`Popup: ${r.fehlerText}`);
    return r;
  } finally {
    await schliesse();
  }
}
const speichere = (o) => ausPopupSeite(`await api.storage.local.set(args[0]); return true;`, o);
const lies = (k) => ausPopupSeite(`return (await api.storage.local.get(args[0]))[args[0]] ?? null;`, k);
const pauseSetzen = (an) =>
  ausPopupSeite(`const alt = (await api.storage.local.get('einstellungen')).einstellungen || {}; await api.storage.local.set({ einstellungen: { ...alt, pause: args[0] } }); return true;`, an);
const zeitenSetzen = (z) =>
  ausPopupSeite(`const alt = (await api.storage.local.get('einstellungen')).einstellungen || {}; await api.storage.local.set({ einstellungen: { ...alt, kontrolle: { ...(alt.kontrolle || {}), zeiten: args[0] } } }); return true;`, z);

let popupNr = 0;
async function popupText() {
  popupNr++;
  await oeffne('popup.html');
  try {
    try {
      await bis('Popup gezeichnet', () => driver.executeScript("return document.getElementById('stufe-zeile').textContent.length > 0 || !document.getElementById('streng-zeile').hidden"), 15_000);
    } catch (e) {
      throw new Error(`Aufruf ${popupNr}: ${e.message} ${await driver.executeScript("return document.getElementById('erwachsen').hidden + ' | ' + document.getElementById('steigerung').hidden + ' | ' + document.getElementById('stufe-zeile').outerHTML + ' | ' + location.href")}`);
    }
    await warte(300);
    return await driver.executeScript("const z = document.getElementById('streng-zeile'); return { stufe: document.getElementById('stufe-zeile').textContent, streng: z.textContent, sichtbar: !z.hidden };");
  } finally {
    await schliesse();
  }
}

async function fall(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox streng: ok   ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    rot++;
    console.error(`firefox streng: ROT  ${name}: ${fehler?.message ?? fehler}`);
  }
}

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-streng-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack({ quiz: { version: 1, fragen: FRAGEN } })).bytes);
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('media.autoplay.default', 0);
  optionen.setPreference('media.autoplay.blocking_policy', 0);
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  inhaltFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox streng: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await einstellungenAendern(EINST);

  await fall('Popup: Stufe 0 wird 1 im Fenster mit Zeile, nicht ohne Freischaltung, ausserhalb und in der Pause', async () => {
    await speichere({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']), steigerung: stand({ stufe: 0 }) });
    const m = new Date().getHours() * 60 + new Date().getMinutes();
    const von = (m - 10 + 1440) % 1440;
    const bis_ = (m + 60) % 1440;
    await zeitenSetzen([{ tage: [heute, (heute + 6) % 7], von, bis: bis_ }]);
    let p = await popupText();
    pruefe(p.stufe.includes('Level 1 of 4'), `Stufe 1 im Fenster (${p.stufe})`);
    pruefe(p.sichtbar && new RegExp(`^Strict time until .*[:.]${String(bis_ % 60).padStart(2, '0')}`).test(p.streng), `Zeile mit Ende (${p.streng})`);
    pruefe((await lies('steigerung')).stufe === 0, 'gespeicherter Stand bleibt 0');
    await speichere({ steigerung: stand({ stufe: 3 }) });
    pruefe((await popupText()).stufe.includes('Level 4 of 4'), 'Stufe 3 wird 4');
    await speichere({ steigerung: stand({ stufe: 0 }), pack: kurz(['zensur:steigerung']) });
    p = await popupText();
    pruefe(p.stufe.includes('Level 0 of 4') && !p.sichtbar, `ohne Freischaltung keine Anhebung (${p.stufe})`);
    await speichere({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']) });
    await zeitenSetzen(NUR_MORGEN);
    p = await popupText();
    pruefe(p.stufe.includes('Level 0 of 4') && !p.sichtbar, 'Fenster nicht heute: Stufe 0');
    await zeitenSetzen(GANZ_HEUTE);
    await pauseSetzen(true);
    p = await popupText();
    pruefe(p.stufe.includes('Level 0 of 4') && !p.sichtbar, 'Pause: Stufe 0, keine Zeile');
    await pauseSetzen(false);
  });

  await fall('Steigerung: eine Stufe hoeher im Fenster, YuNet laeuft; nicht ohne Freischaltung, nicht ausserhalb', async () => {
    await speichere({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']), steigerung: stand({ stufe: 1 }) });
    await einstellungenAendern({ ...EINST, pause: false });
    await zeitenSetzen(NUR_MORGEN);
    await driver.switchTo().newWindow('tab');
    await driver.get(STEIGERUNG_SEITE);
    await bis('Bild beurteilt', async () => /frei|zensiert|verdeckt/.test((await driver.executeScript("return document.getElementById('bild')?.getAttribute('data-veil') ?? ''")) ?? ''), 30_000);
    let nr = 0;
    const laeufe = async () => {
      const n = ++nr;
      await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ erkennerStatus: arguments[0] }) }))", n);
      const w = await bis('Erkenner-Status', async () => {
        const t = await driver.executeScript("return document.documentElement.getAttribute('data-veil-erkenner')");
        const j = t ? JSON.parse(t) : null;
        return j && j.nr === n ? j : null;
      });
      return w.antwort?.gesichtLaeufe ?? -1;
    };
    const vorher = await laeufe();
    await warte(1500);
    pruefe((await laeufe()) === vorher, 'Fenster nicht heute: kein YuNet');
    // Einstellungen und Pack aendert der Erweiterungstab; danach zurueck in die sichtbare Seite
    const seite = await driver.getWindowHandle();
    await speichere({ pack: kurz(['zensur:steigerung']) });
    await zeitenSetzen(GANZ_HEUTE);
    await driver.switchTo().window(seite);
    await warte(2000);
    pruefe((await laeufe()) === vorher, 'ohne Freischaltung kontrolle:zeitplan kein YuNet');
    await speichere({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']) });
    await driver.switchTo().window(seite);
    const nachher = await bis('YuNet im Fenster', async () => {
      const l = await laeufe();
      return l > vorher ? l : null;
    }, 30_000);
    pruefe(nachher > vorher, `Stufe 1 plus eins: YuNet-Laeufe ${vorher} auf ${nachher}`);
    pruefe((await lies('steigerung')).stufe === 1, 'gespeicherter Stand bleibt 1');
    await driver.switchTo().window(seite);
    await driver.close();
    await driver.switchTo().window(inhaltFenster);
  });

  await fall('Player: Riegel auf normaler Seite im Fenster, Pause frei, ohne Freischaltung nicht', async () => {
    await importierePack(packPfad);
    await einstellungenAendern(EINST);
    await zeitenSetzen(NUR_MORGEN);
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'ausserhalb des Fensters');
    pruefe(!(await hostDa()), 'ausserhalb kein Riegel');
    await zeitenSetzen(GANZ_HEUTE);
    await driver.switchTo().window(inhaltFenster);
    await riegelOffen();
    await bleibtStehen('haupt', 'im Fenster');
    await einstellungenAendern({ pause: true });
    await driver.switchTo().window(inhaltFenster);
    await bis('Riegel zu', async () => !(await hostDa()), 10_000);
    await laeuft('haupt', 'Pause');
    await einstellungenAendern({ pause: false });
    await driver.switchTo().window(inhaltFenster);
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    pruefe((await video('haupt')).muted === true, 'gesperrt und stumm');
    await loese();
    await laeuft('haupt', 'nach dem Loesen');
    // ohne Freischaltung
    const roh = await lies('pack');
    await speichere({ pack: { ...roh, freischaltungen: roh.freischaltungen.filter((f) => f !== 'kontrolle:zeitplan') } });
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'ohne Freischaltung');
    await warte(1200);
    pruefe(!(await hostDa()), 'ohne Freischaltung kein Riegel');
    await speichere({ pack: roh });
  });

  await fall('Player: Fenster endet, offenes Quiz bleibt, neue Quelle frei', async () => {
    await zeitenSetzen(GANZ_HEUTE);
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    await zeitenSetzen(NUR_MORGEN);
    await driver.switchTo().window(inhaltFenster);
    await warte(1500);
    pruefe(await hostDa(), 'Quiz bleibt nach Ende des Fensters');
    await loese();
    await laeuft('haupt', 'nach dem Loesen');
    await driver.executeScript("const v = window.findeVideo('haupt'); v.src = window.datenQuelle(1); v.play().catch(() => {});");
    await laeuft('haupt', 'neue Quelle');
    await warte(800);
    pruefe(!(await hostDa()), 'neue Quelle ohne Riegel');
  });

  await fall('Player: Zeitgeber greift beim Fensterbeginn', async () => {
    await zeitenSetzen(NUR_MORGEN);
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'vor dem Fenster');
    const n = new Date(Date.now() + 60_000);
    const von = n.getHours() * 60 + n.getMinutes();
    await zeitenSetzen([{ tage: [n.getDay(), (n.getDay() + 6) % 7], von, bis: (von + 30) % 1440 }]);
    await driver.switchTo().window(inhaltFenster);
    const t0 = Date.now();
    await bis('Riegel durch Zeitgeber', async () => (await abbild())?.offen === true, 150_000);
    await bleibtStehen('haupt', 'durch Zeitgeber');
    console.log(`firefox streng: Zeitgeber griff nach ${Math.round((Date.now() - t0) / 1000)} s`);
    await zeitenSetzen([]);
  });

  console.log(`firefox streng: ${rot} rot`);
  code = rot === 0 ? 0 : 1;
} catch (fehler) {
  console.error('firefox streng: FEHLER', fehler);
  code = 1;
} finally {
  try {
    await driver?.quit();
  } catch {}
  server?.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
process.exit(code);
