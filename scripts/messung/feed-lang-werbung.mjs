// Messwerkzeug Phase 5 (Auftrag W, kein Produktcode): Kopie von feed-lang.mjs mit importiertem Dummy-Pack und eingestreuten Werbeflaechen
// (scripts/messung/feed-lang-werbung-seite.html: nach jedem 6. Beitrag eine Karte 300 x 250; gerade Nummern mit zweitem Merkmal und damit
// zu tauschen, ungerade nur mit Werbegroesse und damit zu behalten). Je Lauf abwechselnd Werbe-Tausch an (kontrolle.werbung true) und aus
// (false); gemessen werden die Kennzahlen des Originals plus Zahl getauschter und falsch getauschter Flaechen.
// Aufruf: VEIL_AUSGABE=.output-m VEIL_FIXTURE_PORT=47413 VEIL_FIXTURE_PORT_FREMD=47415 node scripts/messung/feed-lang-werbung.mjs --browser beide --laeufe 3
// Ursprung: Messwerkzeug M1 (Phase 3): langer Feed mit Endlos-Nachladen, gleichmaessiges Scrollen.
// Aufruf: node scripts/messung/feed-lang.mjs [--ausgabe <ordner>] [--browser chromium|firefox|beide] [--laeufe 3] [--schritte 30] [--takt 1500] [--rueck] [--md <Pfad>]
//   --ausgabe <ordner>   Bauordner mit chrome-mv3 und dem Firefox-Zip, relativ zum Repo (sonst VEIL_AUSGABE, sonst .output-test)
//   VEIL_FIXTURE_PORT    Port des eigenen Testservers (sonst ein freier Port); VEIL_FIXTURE_PORT_FREMD wird nicht gebraucht,
//                        alle Bilder kommen vom selben Ursprung wie die Seite
// Seite: scripts/messung/feed-lang-werbung-seite.html (180 Beitraege, 240 Bilder, Endlos-Nachladen). Jeder Lauf startet einen frischen Browser.
// Messgroessen je Lauf:
//   (a) Anteil der grossen Bilder und getrennt der Profilbilder (40 px), die beim Eintritt in den Sichtbereich schon ein Urteil (data-veil) haben
//   (b) Zeit vom Scroll-Schritt, bis alle Bilder im Sichtbereich ein Urteil haben (Median und p95 ueber die Schritte eines Laufs)
//   (d) Zusatz: Anteil der Bilder, die den Sichtbereich ohne Urteil verlassen (leer sichtbar, hide-first), und die Leerzeit je Bild
//   (c) Anzahl und Summe langer Aufgaben ueber 50 ms (PerformanceObserver longtask, nur wo vorhanden), dazu als Ersatz fuer beide
//       Browser die Haenger eines 10-ms-Zeitgebers ueber 50 ms
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));

// Argumente zuerst, denn hilfe.mjs liest VEIL_AUSGABE schon beim Laden.
function liesArgumente(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) a[argv[i].slice(2)] = true;
    else { a[argv[i].slice(2)] = n; i++; }
  }
  return a;
}
const args = liesArgumente(process.argv.slice(2));
if (typeof args.ausgabe === 'string') process.env.VEIL_AUSGABE = args.ausgabe;

const { starteChromiumMitPack, starteFirefoxMitPack } = await import('./pack-browser.mjs');
const { baueDummyPack } = await import('../pack/baue-pack.mjs');
const os = await import('node:os');
const { mkdtemp, rm } = await import('node:fs/promises');
const { ausgabeOrdner, fasse, firefoxVersion, freierPort, median, paketJson, perzentil, rund, warte, wurzel, zeitstempel } = await import('./hilfe.mjs');

const browserListe = args.browser === 'chromium' ? ['chromium'] : args.browser === 'firefox' ? ['firefox'] : ['chromium', 'firefox'];
const laeufe = Number(args.laeufe ?? 3);
const schritte = Number(args.schritte ?? 30);
const rueck = args.rueck === true || args.rueck === '1'; // nach dem Abwaerts-Lauf wieder nach oben scrollen (Wiedereintritt messen)
const takt = Number(args.takt ?? 1500); // ms je Schritt; 1500 ist der Auftrag, kleinere Werte sind Belastungsproben

const FENSTER = { breite: 1280, hoehe: 800 };
const dez = (v) => (v === null || v === undefined ? 'n/a' : String(v).replace('.', ','));
const testbilder = path.resolve(wurzel, '../05 Testbilder');
const ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TYPEN = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function leseSatz(satz) {
  const e = await readdir(path.join(testbilder, satz), { withFileTypes: true });
  return e.filter((x) => x.isFile() && !x.name.startsWith('.') && ENDUNGEN.has(path.extname(x.name).toLowerCase()))
    .map((x) => x.name).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

// Eigener kleiner Testserver: die Seite, die Namensliste, Originale und verkleinerte Profilbilder (alles vom selben Ursprung).
async function starteServer(port) {
  const listen = { sfw: await leseSatz('sfw'), nsfw: await leseSatz('nsfw') };
  const klein = new Map();
  const sende = (res, status, typ, inhalt) => { res.writeHead(status, { 'Content-Type': typ, 'Cache-Control': 'no-store' }); res.end(inhalt); };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pfad = decodeURIComponent(url.pathname);
      if (pfad === '/feed-lang-werbung-seite.html') return sende(res, 200, 'text/html; charset=utf-8', await readFile(path.join(hier, 'feed-lang-werbung-seite.html')));
      if (pfad === '/api/liste') return sende(res, 200, 'application/json; charset=utf-8', JSON.stringify(listen));
      const m = /^\/(testbild|avatar)\/(sfw|nsfw)\/([^/]+)$/.exec(pfad);
      if (m) {
        if (!listen[m[2]].includes(m[3])) throw new Error('unbekannt');
        const datei = path.join(testbilder, m[2], m[3]);
        if (m[1] === 'testbild') return sende(res, 200, TYPEN[path.extname(m[3]).toLowerCase()] ?? 'application/octet-stream', await readFile(datei));
        const schluessel = `${m[2]}/${m[3]}`;
        if (!klein.has(schluessel)) {
          const { default: sharp } = await import('sharp');
          klein.set(schluessel, await sharp(datei).rotate().resize(128, 128, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer());
        }
        return sende(res, 200, 'image/jpeg', klein.get(schluessel));
      }
      res.writeHead(404);
      res.end('nicht gefunden');
    } catch {
      res.writeHead(404);
      res.end('nicht gefunden');
    }
  });
  await new Promise((ok, fehl) => { server.once('error', fehl); server.listen(port, '127.0.0.1', ok); });
  return server;
}

async function bis(beschreibung, lies, frist = 30_000) {
  const t0 = Date.now();
  let letzter = null;
  while (Date.now() - t0 < frist) {
    try { letzter = await lies(); if (letzter) return letzter; } catch { /* Seite wechselt gerade */ }
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert ${JSON.stringify(letzter)})`);
}

async function laufChromium(b, url) {
  const seite = await b.context.newPage();
  try {
    await seite.setViewportSize({ width: FENSTER.breite, height: FENSTER.hoehe });
    await seite.goto(url);
    await bis('Seite bereit', () => seite.evaluate('window.__feedLang && window.__feedLang.bereit'));
    await seite.evaluate(`window.__feedLang.los()`);
    await bis('Lauf fertig', () => seite.evaluate('window.__feedLang.fertig'), 240_000);
    return JSON.parse(await seite.evaluate('JSON.stringify({ fehler: window.__feedLang.fehler, ergebnis: window.__feedLang.ergebnis })'));
  } finally {
    await seite.close();
  }
}

async function laufFirefox(b, url) {
  const d = b.driver;
  // Innenhoehe auf die Zielgroesse bringen (Aussenmasse minus Rahmen).
  await d.manage().window().setRect({ width: FENSTER.breite, height: FENSTER.hoehe + 200 });
  await d.get(url);
  for (let i = 0; i < 3; i++) {
    const [iw, ih, ow, oh] = await d.executeScript('return [innerWidth, innerHeight, outerWidth, outerHeight]');
    if (iw === FENSTER.breite && ih === FENSTER.hoehe) break;
    await d.manage().window().setRect({ width: FENSTER.breite + (ow - iw), height: FENSTER.hoehe + (oh - ih) });
    await warte(200);
  }
  await bis('Seite bereit', () => d.executeScript('return window.__feedLang && window.__feedLang.bereit'));
  await d.executeScript('window.__feedLang.los()');
  await bis('Lauf fertig', () => d.executeScript('return window.__feedLang.fertig'), 240_000);
  return JSON.parse(await d.executeScript('return JSON.stringify({ fehler: window.__feedLang.fehler, ergebnis: window.__feedLang.ergebnis })'));
}

// Kennzahlen eines Laufs aus dem Rohergebnis der Seite.
function kennzahlen(e) {
  const dauern = e.schritte.map((s) => s.dauerMs ?? s.untergrenzeMs);
  const offen = e.schritte.filter((s) => s.dauerMs === null).length;
  const anteil = (z) => (z.n ? z.mitUrteil / z.n : null);
  const lt = e.langeAufgaben;
  const stufen = [1, 2, 3, 4, 5].map((n) => (e.stufenFolge.match(new RegExp(String(n), 'g')) ?? []).length);
  const lz = e.leerzeit;
  const leerGesamt = lz.gross.n + lz.profil.n;
  const leerKz = {
    verlassenOhneUrteilAnteil: rund(leerGesamt ? (lz.gross.ohneUrteil + lz.profil.ohneUrteil) / leerGesamt : null, 3),
    verlassenOhneUrteilGross: rund(lz.gross.n ? lz.gross.ohneUrteil / lz.gross.n : null, 3),
    verlassenOhneUrteilProfil: rund(lz.profil.n ? lz.profil.ohneUrteil / lz.profil.n : null, 3),
    leerMsJeBildGross: rund(lz.gross.n ? lz.gross.leerMs / lz.gross.n : null, 0),
    leerMsJeBildProfil: rund(lz.profil.n ? lz.profil.leerMs / lz.profil.n : null, 0),
    bilder: leerGesamt,
  };
  const rk = e.rueck;
  const rd = rk ? rk.schritte.map((s) => s.dauerMs ?? s.untergrenzeMs) : [];
  return {
    leer: leerKz,
    stufen,
    rueck: rk ? {
      grossAnteil: rund(rk.gross.n ? rk.gross.mitUrteil / rk.gross.n : null, 3), grossN: rk.gross.n,
      profilAnteil: rund(rk.profil.n ? rk.profil.mitUrteil / rk.profil.n : null, 3), profilN: rk.profil.n,
      schrittMedianMs: rund(median(rd), 0), schrittP95Ms: rund(perzentil(rd, 0.95), 0),
    } : null,
    grossAnteil: rund(anteil(e.eintritt.gross), 3),
    grossN: e.eintritt.gross.n,
    profilAnteil: rund(anteil(e.eintritt.profil), 3),
    profilN: e.eintritt.profil.n,
    schrittMedianMs: rund(median(dauern), 0),
    schrittP95Ms: rund(perzentil(dauern, 0.95), 0),
    schrittMaxMs: rund(Math.max(...dauern), 0),
    schritteOhneUrteil: offen,
    schritteGemacht: e.schritteGemacht,
    langeAufgaben: lt.unterstuetzt ? { anzahl: lt.imLauf.anzahl, summeMs: rund(lt.imLauf.summeMs, 0), laengsterMs: rund(lt.imLauf.laengsterMs, 0) } : null,
    haenger: { anzahl: e.haenger.imLauf.anzahl, summeMs: rund(e.haenger.imLauf.summeMs, 0), laengsterMs: rund(e.haenger.imLauf.laengsterMs, 0) },
    ersterBildschirmMs: rund(e.ersterBildschirm.bisUrteilMs, 0),
    werbung: e.werbung,
  };
}

const LAST_GRENZE = 4.5;
let gewartetGesamt = 0;
async function warteAufLast(name) {
  const e = { reihe: name, lastVorher: rund(loadavg()[0], 2), gewartetS: 0 };
  while (!process.env.VEIL_LAST_OHNE && loadavg()[0] >= LAST_GRENZE && gewartetGesamt < 40 * 60_000) {
    console.log(`  Last ${loadavg()[0].toFixed(2)} >= ${LAST_GRENZE}: warte 60 s`);
    await warte(60_000);
    gewartetGesamt += 60_000;
    e.gewartetS += 60;
  }
  e.lastBeginn = rund(loadavg()[0], 2);
  return e;
}

async function haupt() {
  const port = Number(process.env.VEIL_FIXTURE_PORT) || (await freierPort());
  const server = await starteServer(port);
  const url = `http://127.0.0.1:${port}/feed-lang-werbung-seite.html?schritte=${schritte}&takt=${takt}${rueck ? '&rueck=1' : ''}`;
  const ordner = await mkdtemp(path.join(os.tmpdir(), 'veil-feedwerbung-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const ergebnis = { meta: {}, messungen: [] };
  const lastProtokoll = [];
  try {
    for (const art of browserListe) {
      const reihen = { an: [], aus: [] };
      let version = '';
      lastProtokoll.push(await warteAufLast(`${art} langer Feed mit Werbung`));
      for (let i = 1; i <= laeufe; i++) {
        for (const v of i % 2 ? ['an', 'aus'] : ['aus', 'an']) {
          const lastLauf = rund(loadavg()[0], 2);
          const b = art === 'chromium' ? await starteChromiumMitPack() : await starteFirefoxMitPack();
          try {
            version = b.version || version;
            if (art === 'chromium') await b.warteAufErkenner();
            await b.importierePack(packPfad);
            await b.setzeEinstellungen({ kontrolle: { werbung: v === 'an', blitz: 'aus', leerlauf: false, leerlaufMinuten: 2 }, pause: false, ruhig: false });
            await warte(500);
            const r = art === 'chromium' ? await laufChromium(b, url) : await laufFirefox(b, url);
            if (r.fehler || !r.ergebnis) throw new Error(`Lauf ${i} (${art}, ${v}): ${r.fehler ?? 'kein Ergebnis'}`);
            const k = kennzahlen(r.ergebnis);
            reihen[v].push({ lauf: i, last: lastLauf, lastEnde: rund(loadavg()[0], 2), kennzahlen: k, roh: r.ergebnis });
            const w = k.werbung;
            console.log(`${art} Lauf ${i} Werbe-Tausch ${v}: gross ${dez(k.grossAnteil)} (${k.grossN}), profil ${dez(k.profilAnteil)}, Schritt Median ${k.schrittMedianMs} ms, p95 ${k.schrittP95Ms} ms, ohne Urteil ${k.schritteOhneUrteil}, longtask ${k.langeAufgaben ? `${k.langeAufgaben.anzahl}/${k.langeAufgaben.summeMs} ms` : 'n/a'}, Haenger ${k.haenger.anzahl}/${k.haenger.summeMs} ms, leer verlassen ${dez(k.leer.verlassenOhneUrteilAnteil)}; Werbung: getauscht mit ${w.getauschtMit}/${w.erzeugtMit}, ohne (falsch) ${w.getauschtOhne}/${w.erzeugtOhne}, andere ${w.getauschtAndere}, Last ${lastLauf}`);
          } finally {
            await b.schliesse();
          }
        }
      }
      ergebnis.messungen.push({ browser: art, version: version || (art === 'firefox' ? firefoxVersion() : ''), reihen });
    }
  } finally {
    server.close();
    await rm(ordner, { recursive: true, force: true });
  }
  ergebnis.meta = {
    werkzeug: 'scripts/messung/feed-lang-werbung.mjs',
    datum: new Date().toISOString(),
    paket: `${paketJson.name} ${paketJson.version}`,
    ausgabe: path.relative(wurzel, ausgabeOrdner),
    seite: 'scripts/messung/feed-lang-werbung-seite.html (180 Beitraege, 240 Bilder, 30 Werbekarten: 15 mit zweitem Merkmal, 15 nur Groesse)',
    fenster: FENSTER,
    laeufe,
    schritte,
    taktMs: takt,
    lastProtokoll,
  };
  const datei = path.join(hier, `ergebnis-feed-lang-werbung-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
