// Firefox-Test Phase 8, Auftrag K2: Standbild des Hauptvideos ganz durch Mia (ueber geckodriver/WebDriver). Solange das Quiz nicht geloest ist, liegt ein
// Mia-Vorschau-Bild der gewaehlten Stufe ueber dem Hauptvideo (Host `data-veil-standbild`, nur im Testbau). Vorlage: tests/firefox/player.test.mjs.
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
import { DUMMY_QUIZ } from '../../scripts/pack/dummy-inhalte.mjs';

setTimeout(() => {
  console.error('firefox standbild: Zeitlimit von 300 s ueberschritten');
  process.exit(1);
}, 300_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const SEITE = `http://127.0.0.1:${port}/erwachsen-player.html`;
const ADAPTER_SEITE = `http://pornhub.veil-erwachsen.test:${port}/erwachsen-player.html`;
const NEUTRAL = `http://localhost:${port}/erwachsen-player.html`;
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();
const FRAGEN = DUMMY_QUIZ.fragen.filter((f) => f.art === 'wissen' || f.art === 'allgemein');
const EINST = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } };

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox standbild: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let rot = 0;
function pruefe(bedingung, text) {
  if (!bedingung) {
    rot++;
    console.error(`firefox standbild: ROT  ${text}`);
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
  try {
    await bis('Riegel zu', async () => !(await hostDa()), 10_000);
  } catch (e) {
    throw new Error(`${e.message} Abbild nach Klick: ${JSON.stringify(await abbild()).slice(0, 500)} Frage ${f.id}`);
  }
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
async function entfernePack() {
  await oeffne('options.html');
  await driver.findElement(By.css('#entfernen')).click();
  await driver.findElement(By.css('#entfernen-ja')).click();
  await bis('Pack weg', async () => (await driver.findElement(By.css('#pack-status')).getText()).includes('No pack yet'));
  await schliesse();
}

let code = 0;
async function fall(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox standbild: ok   ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    rot++;
    console.error(`firefox standbild: ROT  ${name}: ${fehler?.message ?? fehler}`);
  }
}
const standbild = () =>
  driver.executeScript(`
    const h = document.querySelector('[data-veil-standbild]');
    if (!h) return null;
    const v = document.querySelector('video');
    const r = h.getBoundingClientRect(); const vr = v.getBoundingClientRect();
    return { name: h.getAttribute('data-veil-standbild'), geladen: h.getAttribute('data-veil-standbild-geladen'), r: [r.x, r.y, r.width, r.height], vr: [vr.x, vr.y, vr.width, vr.height], anzahl: document.querySelectorAll('[data-veil-standbild]').length };`);
const standbildBereit = () => bis('Standbild geladen', async () => {
  const a = await standbild();
  return a && a.geladen === '1' ? a : null;
}, 15_000);
const standbildWeg = (text) => bis(text, async () => (await standbild()) === null, 10_000);

try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-standbild-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack({ quiz: { version: 1, fragen: FRAGEN } })).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', 'pornhub.veil-erwachsen.test');
  optionen.setPreference('media.autoplay.default', 0);
  optionen.setPreference('media.autoplay.blocking_policy', 0);
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  inhaltFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox standbild: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await einstellungenAendern(EINST);

  await fall('ohne Pack: kein Standbild, das Video laeuft wie heute', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'ohne Pack');
    await warte(800);
    pruefe((await standbild()) === null, 'ohne Pack kein Standbild');
  });

  await fall('mit Pack: Standbild auf dem Hauptvideo (Stufe Tease), nach geloestem Quiz weg und Video laeuft', async () => {
    await importierePack(packPfad);
    await einstellungenAendern({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'tease' } });
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    const a = await standbildBereit();
    pruefe(a.anzahl === 1, `genau ein Standbild (${a.anzahl})`);
    pruefe(['vorschau/dummy-1.webp', 'vorschau/dummy-3.webp'].includes(a.name), `Bild der Stufe Tease (${a.name})`);
    pruefe(a.r.every((w, i) => Math.abs(w - a.vr[i]) <= 1), `Standbild deckt die Flaeche des Videos (${JSON.stringify([a.r, a.vr])})`);
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {})");
    await riegelOffen();
    pruefe((await standbild())?.geladen === '1', 'Standbild bleibt waehrend des Quiz');
    await bleibtStehen('haupt', 'vor dem Quiz');
    await loese();
    await standbildWeg('Standbild nach geloestem Quiz weg');
    await laeuft('haupt', 'nach dem Quiz');
  });

  await fall('Stufe Hot und Wechsel zurueck auf Tease ohne Neuladen', async () => {
    await einstellungenAendern({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'hot' } });
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    const a = await standbildBereit();
    pruefe(/^vorschau\/dummy-[1-4]\.webp$/.test(a.name), `Bild der Stufe Hot (${a.name})`);
    await einstellungenAendern({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'tease' } });
    await bis('Bild der Stufe Tease', async () => /^vorschau\/dummy-[13]\.webp$/.test((await standbild())?.name ?? ''), 10_000);
  });

  await fall('Pause gibt alles frei, Pause aus bringt das Standbild zurueck', async () => {
    await einstellungenAendern(EINST);
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    await einstellungenAendern({ pause: true });
    await standbildWeg('Standbild in der Pause weg');
    await einstellungenAendern({ pause: false });
    await standbildBereit();
  });

  const hostOben = () =>
    driver.executeScript(`
      const h = document.querySelector('[data-veil-standbild]');
      h.style.setProperty('pointer-events', 'auto', 'important');
      const r = h.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      h.style.setProperty('pointer-events', 'none', 'important');
      return e === h;`);
  const nahe = (a, b, tol = 2) => a.every((w, i) => Math.abs(w - b[i]) <= tol);
  const alsVideo = () => driver.executeScript('return window.findeVideo("haupt") !== null');

  await fall('z-index: ein Video mit eigenem z-index malt nicht ueber dem Standbild', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await driver.executeScript("const v = window.findeVideo('haupt'); v.style.position = 'relative'; v.style.zIndex = '50';");
    await standbildBereit();
    await bis('Host oben', hostOben, 5000);
  });

  await fall('Adapter-Seite: Poster-Ebene des Players liegt unter dem Standbild, der Anker wird gedeckt', async () => {
    await oeffneSeite(ADAPTER_SEITE);
    await neuesVideo({ id: 'haupt' });
    await driver.executeScript('window.posterEbene(); return true;');
    const a = await standbildBereit();
    const anker = await driver.executeScript("const r = document.getElementById('player').getBoundingClientRect(); return [r.x, r.y, r.width, r.height];");
    pruefe(nahe(a.r, anker), `Standbild deckt den Anker (${JSON.stringify([a.r, anker])})`);
    pruefe((await driver.executeScript("return parseInt(getComputedStyle(document.querySelector('[data-veil-standbild]')).zIndex, 10)")) >= 7, 'z-index ueber der Poster-Ebene');
    pruefe(await hostOben(), 'Host oben');
  });

  // K2, zweite Lesung (Orchestrator): nur die Videoflaeche, Cookie-Dialog bleibt oben, klebender Player beim Rollen.
  await fall('Adapter-Seite: Leiste neben dem Video sichtbar, Cookie-Dialog oben, klebender Player beim Rollen', async () => {
    await oeffneSeite(ADAPTER_SEITE);
    await neuesVideo({ id: 'haupt' });
    await driver.executeScript(`const p = document.getElementById('player'); p.style.position = 'relative';
      const l = document.createElement('div'); l.id = 'leiste'; l.style.cssText = 'height:48px;background:rgb(0,0,255);position:relative;z-index:3'; l.textContent = 'Like'; p.appendChild(l); return true;`);
    await standbildBereit();
    // Die Seite macht den Player hier erst nach dem Legen des Hosts zum Bezug (position: relative); der Lage-Takt (400 ms) zieht den Host nach.
    const a = await bis('Host liegt genau auf dem Video', async () => {
      const b = await standbild();
      return b && nahe(b.r, b.vr) ? b : null;
    }, 1500);
    const leisteOben = await driver.executeScript("return document.getElementById('leiste').getBoundingClientRect().y;");
    pruefe(a.r[1] + a.r[3] <= leisteOben + 1, 'Host deckt die Leiste nicht');
    pruefe(await hostOben(), 'Host oben ueber dem Video');
    const dialog = await driver.executeScript(`const d = document.createElement('div'); d.id = 'cookie';
      d.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;background:rgba(255,255,255,0.9)'; document.body.appendChild(d);
      const h = document.querySelector('[data-veil-standbild]'); const r = h.getBoundingClientRect();
      h.style.setProperty('pointer-events', 'auto', 'important'); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      h.style.setProperty('pointer-events', 'none', 'important'); d.remove(); return e ? e.id : '';`);
    pruefe(dialog === 'cookie', `Cookie-Dialog liegt ueber dem Standbild (${dialog})`);
    await driver.executeScript(`const p = document.getElementById('player'); p.style.position = 'sticky'; p.style.top = '0px';
      const lang = document.createElement('div'); lang.style.height = '3000px'; document.body.appendChild(lang); return true;`);
    let schlecht = 0;
    for (let y = 100; y <= 1500; y += 200) {
      await driver.executeScript(`scrollTo(0, ${y}); return true;`);
      await warte(60);
      const b = await standbild();
      if (!nahe(b.r, b.vr, 3)) schlecht++;
    }
    pruefe(schlecht === 0, `Host folgt dem klebenden Player beim Rollen (${schlecht} Abweichungen)`);
  });

  await fall('Video nur mit Poster und ohne Quelle (preload none) bekommt das Standbild', async () => {
    for (const url of [ADAPTER_SEITE, SEITE]) {
      await oeffneSeite(url);
      await driver.executeScript(`const v = document.createElement('video'); v.id = 'haupt'; v.preload = 'none'; v.poster = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; document.getElementById('player').appendChild(v); return true;`);
      await standbildBereit();
    }
  });

  await fall('Video mit Groesse 0, das spaeter waechst', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await driver.executeScript("window.findeVideo('haupt').style.cssText = 'width:0px;height:0px'; return true;");
    await warte(800);
    pruefe((await standbild()) === null, 'bei Groesse 0 kein Standbild');
    await driver.executeScript("window.findeVideo('haupt').style.cssText = ''; return true;");
    await standbildBereit();
  });

  await fall('Lage: zentriertes, skaliertes und festes Video', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    await driver.executeScript("document.getElementById('player').style.position = 'relative'; window.findeVideo('haupt').style.cssText = 'position:absolute;left:50%;top:50%;width:320px;height:180px;transform:translate(-50%,-50%) scale(1.5)'; return true;");
    await bis('zentriert und skaliert', async () => { const a = await standbild(); return a && nahe(a.r, a.vr); }, 6000);
    await driver.executeScript("window.findeVideo('haupt').style.cssText = 'position:fixed;left:100px;top:50px;width:300px;height:170px'; return true;");
    await bis('fest', async () => { const a = await standbild(); return a && nahe(a.r, a.vr); }, 6000);
  });

  await fall('Stufenwechsel Hot zu Tease: nie ein Name der schaerferen Stufe', async () => {
    await einstellungenAendern({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'hot' } });
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    await driver.executeScript(`window.namen = []; new MutationObserver(() => window.namen.push(document.querySelector('[data-veil-standbild]')?.getAttribute('data-veil-standbild'))).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-veil-standbild'] }); return true;`);
    await einstellungenAendern({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'tease' } });
    await bis('Bild der Stufe Tease', async () => /^vorschau\/dummy-[13]\.webp$/.test((await standbild())?.name ?? ''), 10_000);
    const namen = await driver.executeScript('return window.namen');
    pruefe(namen.includes('wartet'), 'dunkle Decke dazwischen');
    pruefe(namen.filter((n) => /dummy-[24]/.test(n)).length === 0, `kein schaerferes Bild (${JSON.stringify(namen)})`);
  });

  await fall('Mausklick, Tastatur und pushState mit neuer Quelle', async () => {
    await einstellungenAendern(EINST);
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await driver.executeScript("window.klickSpielt('haupt'); return true;");
    const a = await standbildBereit();
    await klickeAuf({ x: a.vr[0], y: a.vr[1], w: a.vr[2], h: a.vr[3] });
    await riegelOffen();
    pruefe((await standbild())?.geladen === '1', 'Standbild bleibt waehrend des Quiz');
    await bleibtStehen('haupt', 'nach Mausklick');
    await loese();
    await standbildWeg('Standbild nach dem Quiz weg');
    await driver.executeScript("history.pushState({}, '', '?viewkey=zz1'); window.findeVideo('haupt').src = window.datenQuelle(1); return true;");
    await standbildBereit();
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    await driver.findElement(By.css('#spielen')).sendKeys(Key.ENTER);
    await riegelOffen();
    pruefe((await standbild())?.geladen === '1', 'Standbild bleibt nach Tastatur');
    await bleibtStehen('haupt', 'nach Tastatur');
  });

  await fall('Bild-in-Bild gesperrt, solange das Standbild liegt, danach zurueck', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    pruefe((await driver.executeScript("return window.findeVideo('haupt').disablePictureInPicture")) === true, 'Bild-in-Bild gesperrt');
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {}); return true;");
    await riegelOffen();
    await loese();
    await bis('Bild-in-Bild frei', async () => (await driver.executeScript("return window.findeVideo('haupt').disablePictureInPicture")) === false, 5000);
  });

  await fall('Vollbild unter dem Standbild wird verlassen', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    await driver.executeScript("window.vb = 0; document.addEventListener('fullscreenchange', () => window.vb++); return true;");
    await driver.findElement(By.css('#vollbild')).click();
    let ging = true;
    try {
      await bis('Vollbild an', async () => (await driver.executeScript('return window.vb')) >= 1, 4000);
    } catch {
      ging = false;
    }
    if (!ging) {
      console.log('firefox standbild: Vollbild ueber WebDriver nicht moeglich, nicht geprueft');
      return;
    }
    await bis('Vollbild endet', async () => (await driver.executeScript('return window.vb')) >= 2, 6000);
    pruefe(await driver.executeScript('return document.fullscreenElement === null'), 'Vollbild beendet');
  });

  await fall('Seite ohne Erwachsenen-Stand: kein Standbild', async () => {
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt' });
    await warte(1000);
    pruefe((await standbild()) === null, 'neutrale Seite ohne Standbild');
  });

  await fall('Pack entfernt: Standbild weg', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt' });
    await standbildBereit();
    await entfernePack();
    await standbildWeg('Standbild nach Pack entfernen weg');
  });

  if (rot > 0) code = 1;
  console.log(`firefox standbild: ${rot} rot`);
} catch (fehler) {
  console.error('firefox standbild: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
process.exit(code);
