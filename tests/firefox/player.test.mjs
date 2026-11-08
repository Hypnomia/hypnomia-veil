// Firefox-Test Phase 4, Auftrag P (PHASE-4-BAUPLAN Abschnitt 8): Player-Riegel ueber geckodriver/WebDriver. Das Hauptvideo einer Erwachsenenseite
// bleibt angehalten und stumm, bis das Quiz geloest ist. Seite tests/fixtures/erwachsen-player.html auf 127.0.0.1 (dort gibt es das Riegel-Abbild
// data-veil-riegel; die Seite gilt ueber `erwachsen.eigeneSeiten` als Erwachsenenseite), das Video nimmt die Seite zur Laufzeit auf.
// Pack mit synthetischer Quiz-Bank (nur Auswahlfragen), ueber die Einstellungsseite importiert.
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

setTimeout(() => {
  console.error('firefox player: Zeitlimit von 300 s ueberschritten');
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
  console.error(`firefox player: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let rot = 0;
function pruefe(bedingung, text) {
  if (!bedingung) {
    rot++;
    console.error(`firefox player: ROT  ${text}`);
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
  // Das Mia Pack wartet auf den Einstieg (Entscheidung 133): erledigt setzen.
  await imSeitenkontext(`await api.storage.local.set({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 } }); return true;`);
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
    console.log(`firefox player: ok   ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    rot++;
    console.error(`firefox player: ROT  ${name}: ${fehler?.message ?? fehler}`);
  }
}

try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-player-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack({ quiz: { version: 1, fragen: FRAGEN } })).bytes);
  const kleinPfad = path.join(ordner, 'klein.miapack');
  const kleinBank = [
    FRAGEN[0],
    { id: 'k-z', art: 'aufgabe', schwere: 'mittel', geraet: 'beide', frage: 'Count every POP.', aufgabe: { typ: 'zaehlen', param: { wort: 'POP', woerter: 'POP,DOWN,OBEY,pink', anzahlWoerter: 8 } } },
    { id: 'k-b', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'One word flashes once. Type it.', aufgabe: { typ: 'wort-blitz', param: { wort: 'OBEY' } } },
  ];
  await writeFile(kleinPfad, (await baueDummyPack({ id: 'klein', quiz: { version: 1, fragen: kleinBank } })).bytes);

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
  console.log(`firefox player: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await einstellungenAendern(EINST);

  await fall('ohne Pack: kein Riegel, das Video laeuft', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'ohne Pack');
    pruefe(!(await hostDa()), 'ohne Pack kein Riegel');
  });

  await fall('Kleine Bank, Ruhig-Modus: Video bleibt frei, keine Endlosschleife; Ruhig aus bringt den Riegel', async () => {
    await importierePack(kleinPfad);
    await einstellungenAendern({ ...EINST, ruhig: true });
    await oeffneSeite();
    await driver.executeScript("window.plays = 0; document.addEventListener('play', () => window.plays++, true);");
    await neuesVideo({ id: 'haupt', autoplay: true });
    await laeuft('haupt', 'kleine Bank');
    await warte(2500);
    pruefe(!(await hostDa()), 'kleine Bank ohne Riegel');
    const n = await driver.executeScript('return window.plays');
    pruefe(n <= 4, `Anzahl play-Ereignisse begrenzt (${n})`);
    await laeuft('haupt', 'kleine Bank spaeter');
    await einstellungenAendern({ ruhig: false });
    await bis('Riegel nach Ruhig aus', () => hostDa(), 10_000);
    await bleibtStehen('haupt', 'nach Ruhig aus');
    await entfernePack();
    await importierePack(packPfad);
    await einstellungenAendern(EINST);
  });

  await fall('Seite ohne Erwachsenen-Stand: kein Riegel, das Video laeuft', async () => {
    await oeffneSeite(NEUTRAL);
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'neutrale Seite');
    pruefe(!(await hostDa()), 'neutrale Seite ohne Riegel');
  });

  await fall('Autoplay gesperrt, richtig geloest laeuft, zweites Abspielen ohne Quiz, neue Quelle neues Quiz', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    pruefe((await video('haupt')).muted === true, 'gesperrt und stumm');
    await bleibtStehen('haupt', 'vor dem Loesen');
    await loese();
    await laeuft('haupt', 'nach dem Loesen');
    await driver.executeScript("const v = window.findeVideo('haupt'); v.pause(); v.currentTime = 0; v.play().catch(() => {});");
    await laeuft('haupt', 'zweites Abspielen');
    await warte(400);
    pruefe(!(await hostDa()), 'zweites Abspielen ohne Riegel');
    await driver.executeScript("const v = window.findeVideo('haupt'); v.src = window.neueQuelle(); v.play().catch(() => {});");
    await laeuft('haupt', 'blob auf blob');
    await warte(400);
    pruefe(!(await hostDa()), 'blob auf blob ohne neues Quiz');
    await driver.executeScript("const v = window.findeVideo('haupt'); v.src = window.datenQuelle(1); v.play().catch(() => {});");
    await riegelOffen();
    await bleibtStehen('haupt', 'neue Quelle');
    await loese();
    await laeuft('haupt', 'neue Quelle geloest');
  });

  await fall('Klick auf Abspielen: Ton kommt nach dem Loesen zurueck', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', muted: false });
    await driver.findElement(By.css('#spielen')).click();
    await riegelOffen();
    pruefe((await video('haupt')).muted === true, 'gesperrt und stumm');
    await bleibtStehen('haupt', 'Klick-Abspielen');
    await loese();
    pruefe((await video('haupt')).muted === false, 'Ton zurueck');
    await laeuft('haupt', 'nach dem Loesen');
  });

  await fall('Pause im Riegel gibt frei, nach Pause-Ende wieder Riegel', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true });
    const a = await riegelOffen();
    await klickeAuf(a.pause);
    await bis('Riegel zu', async () => !(await hostDa()), 10_000);
    await laeuft('haupt', 'nach Pause im Riegel');
    await bis('Pause gespeichert', () => gespeichertePause(), 15_000);
    await warte(400);
    pruefe(!(await hostDa()) && !(await video('haupt')).paused, 'waehrend der Pause kein Riegel');
    await einstellungenAendern({ pause: false });
    await riegelOffen();
    await bleibtStehen('haupt', 'nach Pause-Ende');
    await loese();
    await laeuft('haupt', 'nach erneutem Loesen');
  });

  await fall('Pause von aussen gibt ein gesperrtes Video frei', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    await einstellungenAendern({ pause: true });
    await bis('Riegel zu', async () => !(await hostDa()), 10_000);
    await laeuft('haupt', 'nach Pause von aussen');
    await einstellungenAendern({ pause: false });
    await riegelOffen();
    await bleibtStehen('haupt', 'nach Pause-Ende von aussen');
  });

  await fall('Hover-Vorschauvideo bekommt keinen Riegel, das Hauptvideo schon', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'vorschau', ziel: 'karte', autoplay: true, abspielen: true, klasse: 'thumbVideo' });
    await warte(1500);
    pruefe(!(await hostDa()), 'Vorschauvideo ohne Riegel (400 x 225, nur der Link schliesst aus)');
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    await bleibtStehen('haupt', 'Hauptvideo');
    await loese();
    await laeuft('haupt', 'Hauptvideo nach dem Loesen');
  });

  await fall('Hover-Vorschauvideo der Adapter-Seite ausserhalb eines Links (mit Ton) bleibt unberuehrt', async () => {
    await oeffneSeite(ADAPTER_SEITE);
    await neuesVideo({ id: 'vorschau', ziel: 'fremd', autoplay: true, abspielen: true, muted: false, klasse: 'thumbVideo' });
    await warte(1800);
    const v = await video('vorschau');
    pruefe(!v.paused && !v.muted, `Vorschau unberuehrt ${JSON.stringify(v)}`);
  });

  await fall('Adapter-Selektor: nur das Video in #player gesperrt, groesseres daneben laeuft frei', async () => {
    await oeffneSeite(ADAPTER_SEITE);
    await neuesVideo({ id: 'haupt', autoplay: true });
    // Groesstes Video der Videoseite: von der Regel fuer Vorschauen und Anzeigen ausgenommen (Live-Lauf 18, Fund 1; Pruefung Runde 7, Nr. 1).
    await neuesVideo({ id: 'gross', ziel: 'fremd', autoplay: true, abspielen: true });
    await bis('haupt steht', async () => (await video('haupt')).paused, 10_000);
    await warte(1200);
    await bleibtStehen('haupt', 'Adapter-Hauptvideo');
    await laeuft('gross', 'groesseres Video daneben');
    await einstellungenAendern({ pause: true });
    await laeuft('haupt', 'nach Pause');
    await einstellungenAendern({ pause: false });
  });

  await fall('Video in offener Shadow Root bekommt den Riegel', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', ziel: 'schatten', autoplay: true });
    await riegelOffen();
    await bleibtStehen('haupt', 'Shadow Root');
    await loese();
    await laeuft('haupt', 'Shadow Root nach dem Loesen');
  });

  await fall('Rueckfall-Video gesperrt, danach Adapter-Treffer: nur dieser bleibt gesperrt, das andere bekommt den Ton zurueck und startet nicht', async () => {
    await oeffneSeite(ADAPTER_SEITE);
    await neuesVideo({ id: 'rueckfall', ziel: 'fremd', autoplay: true, abspielen: true, muted: false });
    await bis('Rueckfall steht', async () => (await video('rueckfall')).paused, 10_000);
    pruefe((await video('rueckfall')).muted === true, 'Rueckfall gesperrt: stumm');
    await neuesVideo({ id: 'haupt', autoplay: true });
    await bis('haupt steht', async () => (await video('haupt')).paused, 10_000);
    await bis('Rueckfall: Ton zurueck', async () => (await video('rueckfall')).muted === false, 5000);
    await warte(800);
    pruefe((await video('rueckfall')).paused === true, 'Rueckfall startet nicht von selbst');
    await bleibtStehen('haupt', 'Adapter-Hauptvideo nach dem Treffer');
    pruefe((await video('haupt')).muted === true, 'Adapter-Hauptvideo bleibt stumm');
  });

  await fall('Leeres Platzhalter-Video in #player verdraengt das gesperrte Rueckfall-Video nicht; erst der echte Treffer', async () => {
    await oeffneSeite(ADAPTER_SEITE);
    await neuesVideo({ id: 'rueckfall', ziel: 'fremd', autoplay: true, abspielen: true, muted: false });
    await bis('Rueckfall steht', async () => (await video('rueckfall')).paused, 10_000);
    await driver.executeScript("const l = document.createElement('video'); l.id = 'platzhalter'; document.getElementById('player').appendChild(l);");
    await warte(1200);
    const r = await video('rueckfall');
    pruefe(r.paused === true && r.muted === true, `Platzhalter verdraengt das Rueckfall-Video nicht (${JSON.stringify(r)})`);
    await neuesVideo({ id: 'haupt', autoplay: true });
    await bis('haupt steht', async () => (await video('haupt')).paused, 10_000);
    await bis('Rueckfall: Ton zurueck', async () => (await video('rueckfall')).muted === false, 5000);
  });

  await fall('Video in einer deklarativen Shadow Root (template shadowrootmode) bekommt den Riegel', async () => {
    await oeffneSeite();
    await driver.executeScript(`
      const h = document.createElement('div');
      document.body.appendChild(h);
      h.setHTMLUnsafe('<div id="dsd"><template shadowrootmode="open"><style>video{width:640px;height:360px;display:block}</style><video id="dsdv" autoplay muted playsinline></video></template></div>');
      const v = document.getElementById('dsd').shadowRoot.getElementById('dsdv');
      v.src = window.neueQuelle();
      v.play().catch(() => {});`);
    await riegelOffen();
    const stand = () => driver.executeScript(`const v = document.getElementById('dsd').shadowRoot.getElementById('dsdv'); return { paused: v.paused, t: v.currentTime };`);
    const x = await stand();
    await warte(700);
    const y = await stand();
    pruefe(x.paused && y.paused && y.t - x.t < 0.02, `deklarative Wurzel: Video bleibt stehen (${JSON.stringify([x, y])})`);
  });

  await fall('Galerie des Komplett-Ersatzes: kein Riegel; danach wieder Riegel', async () => {
    await oeffneSeite();
    await driver.executeScript("document.documentElement.setAttribute('data-veil-ersatz', '')");
    await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
    await laeuft('haupt', 'unter der Galerie');
    await warte(500);
    pruefe(!(await hostDa()), 'unter der Galerie kein Riegel');
    await driver.executeScript("document.documentElement.removeAttribute('data-veil-ersatz')");
    await riegelOffen();
    await bleibtStehen('haupt', 'nach der Galerie');
  });

  await fall('Anderer Riegel offen (Freilegen): Video bleibt gesperrt, naechster Versuch fragt erneut', async () => {
    await oeffneSeite();
    await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ riegel: { oeffne: { grund: 'freilegen', frage: 'test-w1', verweigern: 0 } } }));
    const a = await riegelOffen();
    pruefe(a.frage.id === 'test-w1', 'Freilegen-Riegel offen');
    await neuesVideo({ id: 'haupt', autoplay: true });
    await warte(1500);
    await bleibtStehen('haupt', 'bei offenem Freilegen-Riegel');
    await loese();
    await warte(1200);
    pruefe((await video('haupt')).paused, 'bleibt gesperrt nach dem Freilegen-Riegel');
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {})");
    await riegelOffen();
    await bleibtStehen('haupt', 'zweiter Versuch');
    await loese();
    await laeuft('haupt', 'nach dem Loesen');
  });

  await fall('Ende ohne loop und erneutes Abspielen: kein neues Quiz', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true, loop: false });
    await riegelOffen();
    await loese();
    await bis('Ende', async () => (await video('haupt')).ended, 15_000);
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {})");
    await warte(800);
    const v = await video('haupt');
    pruefe(!(await hostDa()) && !v.ended && !v.paused, `Wiederholung ohne Riegel ${JSON.stringify(v)}`);
  });

  await fall('Seitenwechsel ohne Neuladen: Ausnahmepfad auf Videoseite', async () => {
    await einstellungenAendern({ ausnahmen: ['127.0.0.1/erwachsen-player'] });
    try {
      await oeffneSeite();
      await neuesVideo({ id: 'haupt', autoplay: true, abspielen: true });
      await laeuft('haupt', 'auf dem Ausnahmepfad');
      await warte(500);
      pruefe(!(await hostDa()), 'Ausnahmepfad ohne Riegel');
      await driver.executeScript("history.pushState({}, '', '/watch?v=2')");
      await riegelOffen();
      await bleibtStehen('haupt', 'nach pushState');
      await driver.executeScript('history.back()');
      await bis('Riegel zu', async () => !(await hostDa()), 10_000);
      await laeuft('haupt', 'zurueck auf dem Ausnahmepfad');
    } finally {
      await einstellungenAendern({ ausnahmen: [] });
    }
  });

  await fall('Vollbild endet, solange das Video gesperrt ist', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', muted: false });
    await driver.executeScript("window.vb = 0; document.addEventListener('fullscreenchange', () => window.vb++);");
    await driver.findElement(By.css('#vollbild')).click();
    let ging = true;
    try {
      await bis('Vollbild an', async () => (await driver.executeScript('return window.vb')) >= 1, 4000);
    } catch {
      ging = false; // WebDriver erlaubt hier kein Vollbild: offen
    }
    if (!ging) {
      console.log('firefox player: Vollbild ueber WebDriver nicht moeglich, nicht geprueft');
      return;
    }
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {})");
    await bis('Vollbild endet', async () => (await driver.executeScript('return window.vb')) >= 2, 6000);
    pruefe(await driver.executeScript('return document.fullscreenElement === null'), 'Vollbild beendet');
    await riegelOffen();
  });

  // Listenseite (Live-Lauf 17, MITTEL 2): Autoplay ohne Geste bleibt angehalten und ohne Riegel, eine Geste auf dem Video oeffnet ihn.
  const aufListe = (pfad) => driver.executeScript('history.pushState({}, "", arguments[0]); return true;', pfad);
  const videoRechteck = (id) =>
    driver.executeScript('const b = window.findeVideo(arguments[0]).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height };', id);
  await fall('Listenseite (Suche): Autoplay ohne Geste ohne Riegel, Klick auf das Video oeffnet den Riegel', async () => {
    await oeffneSeite();
    await aufListe('/search/mia');
    await neuesVideo({ id: 'haupt', autoplay: true });
    await driver.executeScript("window.klickSpielt('haupt'); return true;");
    await warte(1800);
    pruefe(!(await hostDa()), 'Autoplay ohne Geste: kein Riegel');
    pruefe((await video('haupt')).muted, 'Autoplay ohne Geste: stumm');
    await bleibtStehen('haupt', 'Autoplay ohne Geste auf der Liste');
    await klickeAuf(await videoRechteck('haupt'));
    await riegelOffen();
    await bleibtStehen('haupt', 'nach Klick, Riegel offen');
    await loese();
    await laeuft('haupt', 'nach dem Loesen');
  });
  await fall('Listenseite (Startseite): Klick daneben ist keine Geste; nach Wechsel auf eine Videoseite kommt der Riegel', async () => {
    await oeffneSeite();
    await aufListe('/');
    await neuesVideo({ id: 'haupt', autoplay: true });
    await warte(600);
    await driver.actions({ async: true }).move({ x: 1, y: 1, origin: 'viewport' }).click().perform();
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {}); return true;");
    await warte(1500);
    pruefe(!(await hostDa()), 'Klick daneben: kein Riegel');
    await bleibtStehen('haupt', 'Klick daneben');
    await aufListe('/video/12345');
    await riegelOffen();
    await bleibtStehen('haupt', 'Videoseite nach Adresswechsel');
  });

  await fall('Videoseite unter /model/<name>/video/<nr> ist keine Liste: Riegel ohne Geste (Fund 7)', async () => {
    await oeffneSeite();
    await aufListe('/model/mia/video/123');
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    await bleibtStehen('haupt', 'Videoseite unter /model');
  });
  await fall('Listenseite: Capture-Horcher der Seite auf window, der Klicks stoppt, nimmt die Geste nicht (Fund 6)', async () => {
    await oeffneSeite();
    await aufListe('/search/mia');
    await driver.executeScript("for (const t of ['pointerdown', 'mousedown', 'click', 'keydown']) window.addEventListener(t, (e) => e.stopImmediatePropagation(), true); return true;");
    await neuesVideo({ id: 'haupt', autoplay: true });
    await warte(800);
    pruefe(!(await hostDa()), 'ohne Geste kein Riegel');
    await driver.actions({ async: true }).move({ x: 5, y: 5, origin: 'viewport' }).perform();
    const r = await driver.executeScript("const b = window.findeVideo('haupt').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };");
    await driver.actions({ async: true }).move({ x: r.x, y: r.y, origin: 'viewport' }).click().perform();
    await driver.executeScript("window.findeVideo('haupt').play().catch(() => {}); return true;");
    await riegelOffen();
    await bleibtStehen('haupt', 'nach Geste trotz Horcher');
  });

  await fall('Pack entfernt: Sperre weg, Video laeuft', async () => {
    await oeffneSeite();
    await neuesVideo({ id: 'haupt', autoplay: true });
    await riegelOffen();
    await entfernePack();
    await bis('Riegel zu', async () => !(await hostDa()), 10_000);
    await laeuft('haupt', 'nach Pack entfernt');
  });

  if (rot > 0) code = 1;
  console.log(`firefox player: ${rot} rot`);
} catch (fehler) {
  console.error('firefox player: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
process.exit(code);
