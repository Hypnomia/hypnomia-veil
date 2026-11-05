// Firefox-Test der Nachbauten von TikTok, X, Instagram und Reddit (PHASE-3-BAUPLAN Auftrag S, S5 und S6) ueber geckodriver/WebDriver.
// Gleiche Faelle wie tests/chromium/seiten.spec.ts. Die Fixtures bilden nur die Struktur nach; Videos nimmt die Seite zur Laufzeit auf.
// Firefox liest Video-Pixel nur bei blob: und data: (Entscheidung 80): die aufgenommenen Videos sind blob:-Videos. Firefox ab 132 taktet ueber
// requestVideoFrameCallback, Firefox 128 ueber timeupdate (VEIL_FIREFOX_BIN waehlt den Browser). Geprueft werden Urteile ueber das Attribut data-veil.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

// Globaler Waechter: haengt irgendetwas, endet der Lauf nach 400 Sekunden mit Fehler.
setTimeout(() => {
  console.error('firefox: Zeitlimit von 400 s ueberschritten');
  process.exit(1);
}, 400_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const portFremd = port + 2;
const basis = `http://127.0.0.1:${port}`;
// Testbild, das der Erkenner mit den Standard-Zonen sicher trifft (belegt durch die Positivkontrolle in video.test.mjs).
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const ZENSIERT = /^(zensiert|verdeckt)$/;

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:test:firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(150);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

function pruefe(bedingung, text) {
  if (!bedingung) throw new Error(text);
}

async function test(name, fn) {
  if (process.env.VEIL_NUR && !name.startsWith(process.env.VEIL_NUR)) return; // zum Eingrenzen: nur Faelle, deren Name so beginnt
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

const urteile = () => driver.executeScript('return window.testUrteile()');

async function oeffne(datei, zusatz = '') {
  await driver.get(`${basis}/${datei}?bild=${encodeURIComponent(BILD)}${zusatz}`);
  await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 40_000);
}

// Wartet, bis alle erwarteten Urteile da sind (ein Video ohne Daten ist erst vorlaeufig verdeckt, dann folgt das echte Urteil).
async function warteUrteile(erwartet) {
  const passt = (u) =>
    Object.entries(erwartet)
      .filter(([id, soll]) => !(typeof soll === 'string' ? u[id] === soll : soll.test(u[id] ?? '')))
      .map(([id]) => id);
  let letzte = [];
  await bis('erwartete Urteile', async () => {
    const u = await urteile();
    letzte = passt(u);
    return letzte.length === 0 ? u : null;
  }, 40_000).catch(async (f) => {
    throw new Error(`${f.message} fehlend ${JSON.stringify(letzte)} Urteile ${JSON.stringify(await urteile())}`);
  });
  return urteile();
}

async function waechterOk() {
  const [blitz, proben, wer] = await driver.executeScript('return [window.__aufblitzen, window.__proben, window.__wer]');
  pruefe(proben > 0, 'Waechter hat nie geprueft');
  pruefe(blitz === 0, `Waechter: ${blitz} Aufblitzen ${JSON.stringify(wer)}`);
}

const alleWechsel = () => driver.executeScript('return window.__wechsel');
const folge = (liste, id, ab = 0) => liste.slice(ab).filter((w) => w.id === id);

async function tiktokLauf(name) {
  await warteUrteile({ avatar: 'frei', 'bild-sfw': 'frei', 'bild-nsfw': ZENSIERT });
  const ids = ['v1', 'c1', 'c1-leer', 'v2', 'c2', 'c2-leer'];
  const ohneNull = (liste, id) => folge(liste, id).filter((w) => w.v !== null);
  const sollA = ids.map(() => 'frei,verdeckt,frei').join(' | ');
  await bis(
    'frei, verdeckt, frei bei Video und Leinwaenden',
    async () => {
      const l = await alleWechsel();
      return ids.map((id) => ohneNull(l, id).slice(0, 3).map((w) => w.v).join(',')).join(' | ') === sollA;
    },
    60_000,
  );
  const l1 = await alleWechsel();
  const zeiten = [];
  let abstand = 0;
  for (const [video, leinwaende] of [['v1', ['c1', 'c1-leer']], ['v2', ['c2', 'c2-leer']]]) {
    const v = ohneNull(l1, video).slice(0, 3);
    zeiten.push(v[1].ct - 3);
    for (const c of leinwaende) {
      const m = ohneNull(l1, c).slice(0, 3);
      pruefe(m[1].ct >= 2.9, `${name} ${c} verdeckt schon bei ${m[1].ct}`);
      pruefe(m[1].ct - 3 <= 1.5, `${name} ${c}: verdeckt ${(m[1].ct - 3).toFixed(2)} s nach Beginn des Treffer-Abschnitts`);
      for (let i = 0; i < 3; i++) abstand = Math.max(abstand, Math.abs(m[i].t - v[i].t));
    }
  }
  pruefe(abstand < 150, `${name}: Zeitabstand Video zu Spiegel ${abstand} ms`);
  // Wischen: neue Quellen, Video und Leinwaende werden zurueckgesetzt, danach frei, dann wieder verdeckt.
  const ab = l1.length;
  await driver.executeScript('window.wische()');
  const sollB = ids.map(() => 'weg,frei,verdeckt').join(' | ');
  await bis(
    'nach dem Wischen weg, frei, verdeckt',
    async () => {
      const l = await alleWechsel();
      return ids.map((id) => folge(l, id, ab).slice(0, 3).map((w) => w.v ?? 'weg').join(',')).join(' | ') === sollB;
    },
    60_000,
  );
  const l2 = await alleWechsel();
  for (const [video, leinwaende] of [['v1', ['c1', 'c1-leer']], ['v2', ['c2', 'c2-leer']]]) {
    const v = folge(l2, video, ab).slice(0, 3);
    zeiten.push(v[2].ct - 3);
    pruefe(v[2].ct - 3 <= 1.5, `${name} ${video} nach dem Wischen: ${(v[2].ct - 3).toFixed(2)} s`);
    for (const c of leinwaende) {
      const m = folge(l2, c, ab).slice(0, 3);
      pruefe(m[2].ct - 3 <= 1.5, `${name} ${c} nach dem Wischen: ${(m[2].ct - 3).toFixed(2)} s`);
      for (let i = 0; i < 3; i++) abstand = Math.max(abstand, Math.abs(m[i].t - v[i].t));
    }
  }
  pruefe(abstand < 150, `${name}: Zeitabstand nach dem Wischen ${abstand} ms`);
  const [abweichung, wer] = await driver.executeScript('return [window.__abweichung, window.__abweichungWer]');
  pruefe(abweichung === 0, `Leinwand zeigte ein anderes Urteil als ihr Video: ${JSON.stringify(wer)}`);
  await waechterOk();
  console.log(`firefox: TikTok ${name}, Zeit bis verdeckt nach Beginn des Treffer-Abschnitts ${zeiten.map((x) => x.toFixed(2)).join(', ')} s, groesster Abstand Video zu Spiegel ${abstand.toFixed(0)} ms`);
}

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));

  const liste = (await (await fetch(`${basis}/api/testbilder?satz=nsfw`)).json()).bilder;
  const bilderDa = liste.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  if (!bilderDa) {
    console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Seiten-Tests uebersprungen');
    process.exit(0);
  }

  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`firefox: Version ${version}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  await test('X: das unsichtbare img und sein Hintergrund-Zwilling werden beurteilt, sfw frei, nsfw zensiert oder verdeckt', async () => {
    await oeffne('seite-x.html');
    const u = await warteUrteile({
      'x-nsfw-img': ZENSIERT,
      'x-nsfw-hg': ZENSIERT,
      'x-sfw-img': 'frei',
      'x-sfw-hg': 'frei',
      'x-video': 'frei',
      'x-avatar': 'frei',
      'x-avatar2': 'frei',
      'x-avatar3': 'frei',
    });
    await waechterOk();
    console.log(`firefox: X ${JSON.stringify(u)}`);
  });

  await test('Instagram: Bilder mit crossorigin, Story-Ringe, blob:-Video; das Karussell wird nach dem Quellenwechsel neu beurteilt', async () => {
    await oeffne('seite-instagram.html');
    await warteUrteile({
      'ig-nsfw': ZENSIERT,
      'ig-fremd-nsfw': ZENSIERT,
      'ig-sfw': 'frei',
      karussell: 'frei',
      'ig-video': 'frei',
      'ig-ring0': 'frei',
      'ig-ring1': 'frei',
      'ig-ring2': 'frei',
      'ig-ring3': 'frei',
      'ig-ring4': 'frei',
    });
    await driver.executeScript('window.weiter()');
    await bis('Karussell zensiert', async () => ZENSIERT.test((await urteile()).karussell ?? ''), 30_000);
    pruefe((await driver.executeScript('return window.__karussellFalsch')) === 0, 'Karussell war frei, waehrend seine Quelle das Testbild war');
    await waechterOk();
    console.log(`firefox: Instagram ${JSON.stringify(await urteile())}`);
  });

  await test('Reddit: Bilder mit loading=lazy und ein Player mit Video in offenen und geschlossenen Shadow Roots', async () => {
    await oeffne('seite-reddit.html');
    const u = await warteUrteile({
      'rd-nsfw-offen': ZENSIERT,
      'rd-nsfw-zu': ZENSIERT,
      'rd-sfw-zu': 'frei',
      'rd-video': 'frei',
    });
    await waechterOk();
    console.log(`firefox: Reddit ${JSON.stringify(u)}`);
  });

  await test('TikTok: die Leinwand folgt dem Video (verdeckt im Treffer-Abschnitt, frei im sauberen), auch nach dem Wischen', async () => {
    await oeffne('seite-tiktok.html');
    await tiktokLauf('2d');
  });

  await test('TikTok mit WebGL-Leinwand (nur wenn der Browser WebGL kann)', async () => {
    await oeffne('seite-tiktok.html', '&leinwand=webgl');
    const webgl = await driver.executeScript("return document.documentElement.dataset.webgl ?? ''");
    if (webgl !== 'ja') {
      console.log('firefox: TikTok WebGL UEBERSPRUNGEN, der Browser hat kein WebGL');
      return;
    }
    await tiktokLauf('webgl');
  });

  // ---------- Spiegel: Nachtrag S7 ----------

  const setzeTest = (detail) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify(detail));
  const keineAbweichung = async (was) => {
    const [abweichung, wer] = await driver.executeScript('return [window.__abweichung, window.__abweichungWer]');
    pruefe(abweichung === 0, `${was}: ${abweichung} Verstoesse ${JSON.stringify(wer)}`);
  };
  // Alle Karten gleich: jede Leinwand zeigt dasselbe Urteil wie ihr Video (und das Video hat eins).
  const kartenGleich = (urteil) =>
    driver.executeScript(
      `var u = arguments[0]; return window.__karten.every(function (k) { var s = k.v.getAttribute('data-veil'); return !!s && (!u || s === u) && k.cs.every(function (c) { return c.getAttribute('data-veil') === s; }); });`,
      urteil ?? null,
    );
  const warteKartenGleich = (urteil) => bis(`alle Karten gleich ${urteil ?? ''}`, () => kartenGleich(urteil), 60_000);
  const oeffneWebgl = async () => {
    await oeffne('seite-tiktok.html', '&leinwand=webgl');
    const webgl = await driver.executeScript("return document.documentElement.dataset.webgl ?? ''");
    if (webgl !== 'ja') {
      console.log('firefox: WebGL UEBERSPRUNGEN, der Browser hat kein WebGL');
      return false;
    }
    return true;
  };

  await test('S7 WebGL: das Video wird im Treffer-Abschnitt 300 ms und 800 ms aus- und wieder eingehaengt, die Leinwand wird nie frei', async () => {
    if (!(await oeffneWebgl())) return;
    await bis('beide Videos verdeckt', async () => {
      const u = await urteile();
      return u.v1 === 'verdeckt' && u.v2 === 'verdeckt';
    }, 60_000);
    // Karte 1: 300 ms ausgehaengt, Karte 2: 800 ms (laenger als die Wartezeit der eigenen Pruefung einer Leinwand).
    await Promise.all([driver.executeScript('window.haengeAus(1, "video", 300)'), driver.executeScript('window.haengeAus(2, "video", 800)')]);
    for (let i = 0; i < 12; i++) {
      const u = await urteile();
      pruefe(u.c1 !== 'frei', `Leinwand 1 nach dem Wiedereinhaengen frei (Video ${u.v1})`);
      pruefe(u.c2 !== 'frei', `Leinwand 2 nach dem Wiedereinhaengen frei (Video ${u.v2})`);
      await warte(100);
    }
    await warteKartenGleich('frei');
    await keineAbweichung('WebGL aus und ein');
    await waechterOk();
  });

  await test('S7 WebGL: Video und Leinwaende gemeinsam aus- und einhaengen, dann wischen: die neue Quelle erscheint nie ungeprueft', async () => {
    if (!(await oeffneWebgl())) return;
    await warteKartenGleich('frei');
    await driver.executeAsyncScript(
      `var fertig = arguments[arguments.length - 1];
       window.haengeAus(1, 'beide', 300).then(function () { return window.haengeAus(2, 'beide', 300); }).then(function () { window.wische(); fertig(true); });`,
    );
    await warteKartenGleich('frei');
    await warteKartenGleich('verdeckt');
    await keineAbweichung('gemeinsam aus und ein, wischen');
    await waechterOk();
  });

  await test('S7: Wischen bei verzoegertem Erkenner: die Leinwand ist versteckt, nicht unscharf', async () => {
    await oeffne('seite-tiktok.html');
    await warteKartenGleich();
    await setzeTest({ videoVerzoegerungMs: 4000 });
    await driver.executeScript('window.wische()');
    await warte(400); // loadstart und das Zuruecksetzen laufen asynchron
    const t0 = Date.now();
    while (Date.now() - t0 < 2800) {
      const u = await urteile();
      pruefe(u.v1 === '', `das Video wartet auf den verzoegerten Erkenner, zeigt aber ${u.v1}`);
      pruefe(u.c1 === '' && u['c1-leer'] === '' && u.c2 === '', `Leinwand ohne Urteil des Videos zeigt ${u.c1}/${u['c1-leer']}/${u.c2}`);
      await warte(100);
    }
    await setzeTest({ videoVerzoegerungMs: 0 });
    await warteKartenGleich();
    await keineAbweichung('verzoegerter Erkenner');
    await waechterOk();
  });

  await test('S7: die Leinwand wird vor dem Video eingehaengt: sie wird gebunden, sobald das Video da ist, und ist nie unscharf ohne Urteil', async () => {
    await oeffne('seite-tiktok.html', '&spaet=150');
    await warteKartenGleich();
    await keineAbweichung('Leinwand vor dem Video');
    await waechterOk();
  });

  await test('S7: Pause des Videos und Pause der Erweiterung mit Rueckkehr: die Leinwand folgt, nie frei bei verdecktem Video', async () => {
    await oeffne('seite-tiktok.html');
    await warteKartenGleich();
    await driver.executeScript('window.__karten[0].v.pause()');
    await warte(1500);
    await driver.executeScript('window.__karten[0].v.play()');
    await warteKartenGleich();
    await keineAbweichung('Video pausiert');
    await setzeTest({ einstellungen: { pause: true } });
    await bis('Seite aus', async () => (await driver.executeScript("return document.documentElement.getAttribute('data-veil-seite')")) === 'aus', 20_000);
    await warte(500);
    await setzeTest({ einstellungen: { pause: false } });
    await bis('Seite wieder an', async () => (await driver.executeScript("return document.documentElement.getAttribute('data-veil-seite')")) === null, 20_000);
    await warteKartenGleich();
    await keineAbweichung('Pause der Erweiterung');
  });

  await test('S7: Spiegel in Shadow Roots (offen und geschlossen) folgen dem Video wie im Dokument', async () => {
    await oeffne('seite-tiktok.html', '&schatten=1');
    await tiktokLauf('schatten');
  });

  await test('S7 Gegenfaelle: Leinwand mit unter 50 % Ueberdeckung und Leinwand unter einem Video nur mit Ton werden selbst geprueft', async () => {
    await oeffne('spiegel-gegenfall.html');
    const u = await warteUrteile({
      'g-nsfw-klein': ZENSIERT,
      'g-sfw-klein': 'frei',
      'g-nsfw-ton': ZENSIERT,
      'g-sfw-ton': 'frei',
      'g-ton': 'frei',
    });
    await waechterOk();
    console.log(`firefox: Spiegel-Gegenfaelle ${JSON.stringify(u)}`);
  });
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  fehlerListe.push('Aufbau');
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox: ${fehlerListe.length} Test(s) rot: ${fehlerListe.join('; ')}`);
  process.exit(1);
}
console.log('firefox: alle Seiten-Tests gruen');
process.exit(0);
