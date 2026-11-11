// Firefox-Test Lagewecker (src/schleier/lagewecker.ts) ueber geckodriver/WebDriver. Verschiebt sich das Video ohne Groessenwechsel gegen den Bezug des
// Standbild-Hosts, liegt der Host spaetestens im zweiten Bild wieder genau darauf, ohne auf den Lage-Takt (400 ms) zu warten. Gegenstueck zu
// tests/chromium/lagewecker.spec.ts, Seite wie tests/firefox/standbild.test.mjs. Gemessen wird in der Seite: Fall 1 und 2 im rAF des dritten Bildes
// nach der Aenderung (Stand des zweiten gemalten Bildes). Fall 3 je Bild: ein ResizeObserver der Seite merkt das Rechteck des Videos nach dem Layout
// (so wird es gemalt), im rAF des naechsten Bildes wird es mit dem Host verglichen, bevor im neuen Bild irgendwer legt (der Host steht noch, wie er
// gemalt wurde). So haengt die Messung nicht an der Reihenfolge der ResizeObserver-Rueckrufe.
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
  console.error('firefox lagewecker: Zeitlimit von 240 s ueberschritten');
  process.exit(1);
}, 240_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const SEITE = `http://127.0.0.1:${port}/erwachsen-player.html`;
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();
const EINST = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'], stufe: 'tease' } };

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox lagewecker: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let rot = 0;
function pruefe(bedingung, text) {
  if (!bedingung) {
    rot++;
    console.error(`firefox lagewecker: ROT  ${text}`);
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
async function fall(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox lagewecker: ok   ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    rot++;
    console.error(`firefox lagewecker: ROT  ${name}: ${fehler?.message ?? fehler}`);
  }
}

let driver;
let server;
let ordner;
let inhaltFenster;

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
async function importierePack(pfad) {
  await oeffne('options.html');
  await driver.findElement(By.css('#datei')).sendKeys(pfad);
  await bis('Lizenz', () => driver.findElement(By.css('#lizenz-block')).isDisplayed());
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack-Titel', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'));
  await imSeitenkontext(`await api.storage.local.set({ quizWarnungGesehen: true }); const alt = (await api.storage.local.get('einstellungen')).einstellungen || {}; await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } }); return true;`, EINST);
  await schliesse();
}

const wecker = async () => JSON.parse((await driver.executeScript("return document.documentElement.getAttribute('data-veil-lagewecker')")) ?? 'null');
const fehlerAmFenster = () => driver.executeScript('return window.__fehler || null;');

// Seite mit Standbild auf dem Hauptvideo, Fehler-Zaehler am Fenster, Wecker eingeschlafen.
async function seiteMitStandbild() {
  await driver.get(SEITE);
  await bis('Film bereit', () => driver.executeScript("return document.documentElement.dataset.filmBereit === '1'"), 40_000);
  await driver.executeScript(`window.__fehler = []; addEventListener('error', (e) => window.__fehler.push(String(e.message || e.type)));
    window.neuesVideo({ id: 'haupt' }); return true;`);
  await bis('Standbild geladen', () => driver.executeScript("const h = document.querySelector('[data-veil-standbild]'); return !!h && h.getAttribute('data-veil-standbild-geladen') === '1';"), 15_000);
  await bis('Wecker schlaeft vor der Aenderung', async () => !(await wecker())?.wach, 5000);
}

// Fuehrt eine Aenderung aus und misst die Abweichung Host gegen Video im rAF von Bild 1, 2 und 3 danach.
async function messeAenderung(art) {
  return driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const host = document.querySelector('[data-veil-standbild]');
     const v = document.querySelector('video');
     const abw = () => { const h = host.getBoundingClientRect(); const r = v.getBoundingClientRect();
       return Math.max(Math.abs(h.x - r.x), Math.abs(h.y - r.y), Math.abs(h.width - r.width), Math.abs(h.height - r.height)); };
     const vorher = abw();
     if (arguments[0] === 'bezug') document.getElementById('player').style.position = 'relative';
     else { const b = document.createElement('div'); b.style.cssText = 'height:120px;background:#567'; document.body.prepend(b); }
     const bilder = [];
     const weg = abw(); // sofort nach der Aenderung im selben Task: kein Takt kann dazwischen legen
     const schritt = () => { bilder.push(abw()); if (bilder.length < 3) requestAnimationFrame(schritt); else fertig({ vorher, bilder, weg }); };
     requestAnimationFrame(schritt);`,
    art,
  );
}

try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-lagewecker-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('media.autoplay.default', 0);
  optionen.setPreference('media.autoplay.blocking_policy', 0);
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  inhaltFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox lagewecker: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await importierePack(packPfad);

  await fall('Belege: ResizeObserver meldet ein im rAF frisch beobachtetes Element im selben Bild', async () => {
    await driver.get(SEITE);
    const gleich = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const el = document.getElementById('player');
       let bild = 0; let beobachtetIn = -1; const gleich = [];
       const ro = new ResizeObserver(() => { if (beobachtetIn >= 0) gleich.push(bild === beobachtetIn); beobachtetIn = -1; });
       ro.observe(el);
       const schritt = () => { bild++; if (bild > 1) { ro.unobserve(el); ro.observe(el); beobachtetIn = bild; }
         if (bild < 30) requestAnimationFrame(schritt); else fertig(gleich); };
       requestAnimationFrame(schritt);`,
    );
    console.log(`firefox lagewecker: Rueckruf im selben Bild ${gleich.filter(Boolean).length} von ${gleich.length}`);
    pruefe(gleich.length >= 25 && gleich.every(Boolean), `ResizeObserver-Rueckruf im selben Bild (${JSON.stringify(gleich)})`);
  });

  await fall('A Fall 1: Player wird nach dem Legen zum Bezug, Host spaetestens im zweiten Bild genau auf dem Video', async () => {
    await seiteMitStandbild();
    const m = await messeAenderung('bezug');
    console.log(`firefox lagewecker A: vorher ${m.vorher}, Bild 1..3 ${m.bilder.join(' ')}`);
    pruefe(m.vorher <= 0.5, `A vorher genau (${m.vorher})`);
    pruefe(m.weg > 2, `A die Aenderung legt Host und Video auseinander (${m.weg})`);
    pruefe(m.bilder[2] <= 0.5, `A Host im zweiten Bild genau auf dem Video (${m.bilder.join(' ')})`);
    // D: Ruhe. 1 s nach dem letzten Anlass schlaeft der Wecker, obwohl das Standbild steht und eben nachgelegt wurde.
    await warte(1000);
    const w1 = await wecker();
    pruefe(w1?.wach === false, `D Wecker schlaeft 1 s nach dem letzten Anlass (${JSON.stringify(w1)})`);
    await warte(600);
    const w2 = await wecker();
    pruefe(w2?.wach === false && w2?.bilder === w1?.bilder, `D kein rAF mehr in der Ruhe (${JSON.stringify([w1, w2])})`);
    console.log(`firefox lagewecker D: ${JSON.stringify(w2)}`);
    const f = await fehlerAmFenster();
    pruefe(Array.isArray(f) && f.length === 0, `E A: kein error am Fenster (${JSON.stringify(f)})`);
  });

  await fall('B Fall 2: Block ueber dem Video, Bezug weit oben, Host spaetestens im zweiten Bild genau auf dem Video', async () => {
    await seiteMitStandbild();
    const m = await messeAenderung('block');
    console.log(`firefox lagewecker B: vorher ${m.vorher}, Bild 1..3 ${m.bilder.join(' ')}`);
    pruefe(m.vorher <= 0.5, `B vorher genau (${m.vorher})`);
    pruefe(m.weg > 2, `B die Aenderung legt Host und Video auseinander (${m.weg})`);
    pruefe(m.bilder[2] <= 0.5, `B Host im zweiten Bild genau auf dem Video (${m.bilder.join(' ')})`);
    const f = await fehlerAmFenster();
    pruefe(Array.isArray(f) && f.length === 0, `E B: kein error am Fenster (${JSON.stringify(f)})`);
  });

  await fall('C Fall 3: CSS-Uebergang von 300 ms, je Bild hoechstens 1 Pixel Abweichung', async () => {
    await seiteMitStandbild();
    const m = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const host = document.querySelector('[data-veil-standbild]');
       const v = document.querySelector('video');
       const p = document.getElementById('player');
       const werte = []; const lagen = [];
       let gemalt = null;
       const ro = new ResizeObserver(() => { gemalt = v.getBoundingClientRect(); lagen.push(Math.round(gemalt.x)); });
       let laeuft = true;
       p.addEventListener('transitionend', () => (laeuft = false), { once: true });
       p.style.transition = 'margin-left 300ms linear';
       void p.offsetWidth;
       p.style.marginLeft = '200px';
       let nach = 0;
       const schritt = () => {
         if (gemalt) { const h = host.getBoundingClientRect(); const r = gemalt;
           werte.push(Math.max(Math.abs(h.x - r.x), Math.abs(h.y - r.y), Math.abs(h.width - r.width), Math.abs(h.height - r.height))); gemalt = null; }
         ro.unobserve(v); ro.observe(v);
         if (!laeuft && ++nach > 3) return fertig({ werte, weg: lagen.length ? lagen[lagen.length - 1] - lagen[0] : 0, bilder: werte.length });
         requestAnimationFrame(schritt); };
       requestAnimationFrame(schritt);`,
    );
    const max = Math.max(...m.werte);
    console.log(`firefox lagewecker C: ${m.bilder} Bilder, Weg ${m.weg} px, groesste Abweichung ${max}`);
    pruefe(m.bilder > 8, `C genug Bilder (${m.bilder})`);
    pruefe(m.weg > 150, `C der Uebergang bewegt das Video (${m.weg})`);
    pruefe(max <= 1, `C groesste Abweichung je Bild hoechstens 1 Pixel (${max}; ${m.werte.map((x) => Math.round(x * 10) / 10).join(' ')})`);
    const f = await fehlerAmFenster();
    pruefe(Array.isArray(f) && f.length === 0, `E C: kein error am Fenster (${JSON.stringify(f)})`);
  });

  console.log(`firefox lagewecker: ${rot} rot`);
} catch (fehler) {
  console.error('firefox lagewecker: FEHLER', fehler);
  rot++;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
process.exit(rot > 0 ? 1 : 0);
