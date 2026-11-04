// Firefox-Test Phase 4, Auftrag F (Freilegen) ueber geckodriver/WebDriver, Gegenstueck zu tests/chromium/freilegen.spec.ts. Knoepfe sieht der Test im Abbild
// data-veil-freilegen, den Riegel im Abbild data-veil-riegel (beide Shadow Roots bleiben geschlossen). Erweiterungsseiten erreicht der Test wie tests/firefox/pack.test.mjs (feste interne UUID, Tab ueber den Chrome-Kontext).
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
import { DUMMY_QUIZ, DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';

const FRAGEN = DUMMY_QUIZ.fragen.filter((q) => q.art === 'wissen' || q.art === 'allgemein');

setTimeout(() => {
  console.error('firefox freilegen: Zeitlimit von 300 s ueberschritten');
  process.exit(1);
}, 300_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const SEITE = `${basis}/freilegen.html`;
const FREILEGEN_MS = 3000;
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();
const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox freilegen: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
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
    console.error(`firefox freilegen: ROT  ${text}`);
  }
}
async function bis(beschreibung, fn, frist = 8000) {
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

// ---------- Erweiterungsseiten ----------
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
  // Die Seite muss wirklich geladen sein (sonst ist `browser` noch nicht da)
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
// Fuehrt Code in einer Erweiterungsseite aus und kehrt zum Inhalts-Tab zurueck.
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
const speicherLesen = (k) => ausErweiterung(`const a = await api.storage.local.get(args[0]); return a[args[0]] ?? null;`, k);
// teil: oberste Felder; `quiz` wird mit dem alten Wert verschmolzen.
const einstellungenMerge = (teil) =>
  ausErweiterung(
    `const alt = (await api.storage.local.get('einstellungen')).einstellungen || {}; const neu = { ...alt, ...args[0] };
     if (args[0].quiz) neu.quiz = { ...(alt.quiz || {}), ...args[0].quiz };
     await api.storage.local.set({ einstellungen: neu }); return true;`,
    teil,
  );

// ---------- Inhaltsseite ----------
const riegel = async () => JSON.parse((await driver.executeScript("return document.documentElement.getAttribute('data-veil-riegel')")) ?? 'null');
const knoepfe = async () => JSON.parse((await driver.executeScript("return document.documentElement.getAttribute('data-veil-freilegen')")) ?? '{"knoepfe":[]}').knoepfe;
const meldung = () => driver.executeScript("return document.documentElement.getAttribute('data-veil-freilegen-meldung')");
const veil = (id) => driver.executeScript("const e = document.getElementById(arguments[0]); return e ? e.getAttribute('data-veil') : null", id);
const seiteAus = () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite')");
const srcVon = (id) => driver.executeScript("return document.getElementById(arguments[0]).getAttribute('src')", id);

async function frischeSeite() {
  await driver.get(SEITE);
  await bis('Content-Script', () => driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')"), 15_000);
}
async function klickeAuf(r) {
  await driver.actions({ async: true }).move({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), origin: 'viewport' }).click().perform();
}
async function warteZensiert(ids = ['a', 'hg']) {
  for (const id of ids) await bis(`${id} zensiert`, async () => (await veil(id)) === 'zensiert', 60_000);
}
const knopfFuer = async (id) => (await knoepfe()).find((k) => k.id === id);
const knopfBis = (id) => bis(`Knopf ${id}`, () => knopfFuer(id), 10_000);

// Loest den Riegel: Rechtecke erst nach zwei gleichen Messungen, verfehlte Klicks werden wiederholt.
async function loeseRiegel() {
  for (let versuch = 0; versuch < 6; versuch++) {
    let a = await bis('Frage', async () => {
      const x = await riegel();
      return x && x.zustand === 'frage' ? x : null;
    }, 15_000);
    for (let i = 0; i < 20; i++) {
      await warte(150);
      const b = await riegel();
      if (!b || b.zustand !== 'frage') break;
      const gleich = JSON.stringify(b.antworten) === JSON.stringify(a.antworten);
      a = b;
      if (gleich) break;
    }
    if (a.zustand !== 'frage') return;
    const f = FRAGEN.find((q) => q.id === a.frage.id);
    await klickeAuf(a.antworten.find((b) => b.text === f.antworten[f.richtig]));
    await warte(600);
    const danach = await riegel();
    if (!danach || danach.zustand !== 'frage' || danach.frage.id !== a.frage.id) return;
  }
  throw new Error('Riegel nicht zu loesen');
}

let code = 0;
async function fall(name, fn) {
  if (process.env.VEIL_FALL && !process.env.VEIL_FALL.split('|').some((n) => name.includes(n)) && !name.startsWith('Pack importieren')) return;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox freilegen: ok   ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    rot++;
    console.error(`firefox freilegen: ROT  ${name}: ${fehler?.message ?? fehler}`);
  }
}

try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-freilegen-'));
  const bau = await baueDummyPack({ quiz: { version: 1, fragen: FRAGEN } });
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, bau.bytes);
  if (!existsSync(path.join(wurzel, '..', '05 Testbilder', 'nsfw', 'IMG_0260.jpg')) && process.env.VEIL_OHNE_TESTBILDER !== '1') {
    throw new Error('Freilegen-Test braucht ../05 Testbilder/nsfw/IMG_0260.jpg');
  }

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  await installiere(driver, paket);
  inhaltFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox freilegen: Version ${(await driver.getCapabilities()).get('browserVersion')}`);

  await fall('ohne Pack: nie ein Knopf', async () => {
    await frischeSeite();
    await warteZensiert();
    await warte(1500);
    pruefe((await knoepfe()).length === 0, 'ohne Pack keine Knoepfe');
    pruefe(!(await driver.executeScript("return document.documentElement.hasAttribute('data-veil-freilegen')")), 'ohne Pack kein Abbild');
  });

  await fall('Pack importieren, Quiz ohne Verweigern, kurze Dauer', async () => {
    await oeffne('options.html');
    await driver.findElement(By.css('#datei')).sendKeys(packPfad);
    await bis('Lizenz', () => driver.findElement(By.css('#lizenz-block')).isDisplayed());
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Pack-Titel', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'));
    await imSeitenkontext(`await api.storage.local.set({ quizWarnungGesehen: true }); return true;`);
    await schliesse();
    await einstellungenMerge({ pause: false, quiz: { verweigern: 0, freilegenMs: FREILEGEN_MS } });
  });

  await fall('Knoepfe nur an zensierten Flaechen ab 80 px (nicht klein, nicht Video)', async () => {
    await frischeSeite();
    await warteZensiert();
    await bis('2 Knoepfe', async () => (await knoepfe()).length === 2, 10_000);
    await bis('Video verdeckt', async () => (await veil('video')) === 'verdeckt', 30_000);
    const ids = (await knoepfe()).map((k) => k.id).sort();
    pruefe(JSON.stringify(ids) === JSON.stringify(['a', 'hg']), `Knoepfe an ${ids}`);
    pruefe((await driver.executeScript('return document.querySelectorAll("button").length')) === 0, 'keine Knoepfe im offenen DOM');
    console.log(`firefox freilegen: Knoepfe an ${ids.join(', ')}`);
  });

  await fall('Quiz loesen zeigt das Original, nach freilegenMs wieder zensiert, Dauer gemessen', async () => {
    await frischeSeite();
    await warteZensiert();
    await driver.executeScript(`const el = document.getElementById('a'); window.__log = [];
      new MutationObserver(() => window.__log.push([performance.now(), el.getAttribute('data-veil')])).observe(el, { attributes: true, attributeFilter: ['data-veil'] });`);
    await klickeAuf(await knopfBis('a'));
    await loeseRiegel();
    await bis('frei', async () => (await veil('a')) === 'frei', 8000);
    pruefe((await srcVon('a')) === '/testbild/nsfw/IMG_0260.jpg', 'Originalquelle zurueck');
    await bis('Meldung freigelegt', async () => (await meldung()) === 'Test reveal line, 3 seconds.', 4000);
    await bis('wieder zensiert', async () => (await veil('a')) === 'zensiert', 8000);
    const log = await driver.executeScript('return window.__log');
    const tFrei = log.find((l) => l[1] === 'frei')[0];
    const tWeg = log.find((l) => l[0] > tFrei && l[1] === null)[0];
    const dauer = tWeg - tFrei;
    pruefe(Math.abs(dauer - FREILEGEN_MS) <= 300, `Dauer ${Math.round(dauer)} ms`);
    await bis('Meldung wieder zensiert', async () => (await meldung()) === 'Test censored again line.', 4000);
    pruefe(String(await srcVon('a')).startsWith('data:'), 'zensierte Fassung wieder eingesetzt');
    console.log(`firefox freilegen: Original ${Math.round(dauer)} ms sichtbar (Soll ${FREILEGEN_MS}), danach wieder zensiert`);
  });

  await fall('Klick auf das Bild selbst folgt dem Link, kein Riegel', async () => {
    await frischeSeite();
    await warteZensiert();
    const r = await driver.executeScript("const b = document.getElementById('a').getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2, w: 20, h: 0 };");
    await klickeAuf(r);
    await bis('Hash', async () => (await driver.executeScript('return location.hash')) === '#geklickt', 3000);
    pruefe((await riegel()) === null, 'kein Riegel');
  });

  await fall('Pause im Riegel legt nichts frei', async () => {
    await einstellungenMerge({ pause: false });
    await frischeSeite();
    await warteZensiert();
    await klickeAuf(await knopfBis('hg'));
    const a = await bis('Frage', async () => {
      const x = await riegel();
      return x && x.zustand === 'frage' ? x : null;
    }, 15_000);
    await warte(600);
    await klickeAuf((await riegel()).pause);
    await bis('Seite aus', async () => (await seiteAus()) === 'aus', 8000);
    pruefe((await veil('hg')) !== 'frei', 'nichts freigelegt');
    pruefe(!(await driver.executeScript("return document.documentElement.hasAttribute('data-veil-freilegen-meldung')")), 'keine Meldung');
    await bis('Knoepfe weg', async () => (await knoepfe()).length === 0, 5000);
    await einstellungenMerge({ pause: false });
    await bis('hg wieder zensiert', async () => (await veil('hg')) === 'zensiert', 60_000);
    await bis('Knopf kehrt zurueck', async () => !!(await knopfFuer('hg')), 10_000);
    void a;
  });

  await fall('Pause waehrend des Freilegens gibt frei, danach normale Pruefung', async () => {
    await einstellungenMerge({ pause: false, quiz: { freilegenMs: 30000 } });
    await frischeSeite();
    await warteZensiert();
    await klickeAuf(await knopfBis('a'));
    await loeseRiegel();
    await bis('frei', async () => (await veil('a')) === 'frei', 8000);
    await einstellungenMerge({ pause: true });
    await bis('Seite aus', async () => (await seiteAus()) === 'aus', 8000);
    pruefe((await srcVon('a')) === '/testbild/nsfw/IMG_0260.jpg', 'Original in der Pause');
    await einstellungenMerge({ pause: false });
    const t0 = Date.now();
    await bis('wieder zensiert', async () => (await veil('a')) === 'zensiert', 20_000);
    await warte(500);
    pruefe((await veil('a')) === 'zensiert', 'bleibt zensiert (kein Rest-Freilegen)');
    console.log(`firefox freilegen: Pause waehrend Freilegen, ${Date.now() - t0} ms nach Pause-Ende wieder zensiert`);
    await einstellungenMerge({ quiz: { freilegenMs: FREILEGEN_MS } });
  });

  await fall('Pack entfernt: Knoepfe sofort weg', async () => {
    await frischeSeite();
    await warteZensiert();
    await bis('2 Knoepfe', async () => (await knoepfe()).length === 2, 10_000);
    await ausErweiterung(`await api.storage.local.remove('pack'); return true;`);
    await bis('Knoepfe weg', async () => (await knoepfe()).length === 0, 5000);
  });

  console.log(`firefox freilegen: ${ok} Pruefungen gruen, ${rot} rot`);
  if (rot > 0) code = 1;
} catch (fehler) {
  console.error('firefox freilegen: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
process.exit(code);
