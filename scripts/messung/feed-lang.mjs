// Messwerkzeug M1 (Phase 3): langer Feed mit Endlos-Nachladen, gleichmaessiges Scrollen, kein Produktcode.
// Aufruf: node scripts/messung/feed-lang.mjs [--ausgabe <ordner>] [--browser chromium|firefox|beide] [--laeufe 3] [--schritte 30] [--takt 1500] [--rueck] [--md <Pfad>]
//   --ausgabe <ordner>   Bauordner mit chrome-mv3 und dem Firefox-Zip, relativ zum Repo (sonst VEIL_AUSGABE, sonst .output-test)
//   VEIL_FIXTURE_PORT    Port des eigenen Testservers (sonst ein freier Port); VEIL_FIXTURE_PORT_FREMD wird nicht gebraucht,
//                        alle Bilder kommen vom selben Ursprung wie die Seite
// Seite: scripts/messung/feed-lang-seite.html (180 Beitraege, 240 Bilder, Endlos-Nachladen). Jeder Lauf startet einen frischen Browser.
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

const { starteChromium, starteFirefox } = await import('./browser.mjs');
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
      if (pfad === '/feed-lang-seite.html') return sende(res, 200, 'text/html; charset=utf-8', await readFile(path.join(hier, 'feed-lang-seite.html')));
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
  };
}

async function haupt() {
  const port = Number(process.env.VEIL_FIXTURE_PORT) || (await freierPort());
  const server = await starteServer(port);
  const url = `http://127.0.0.1:${port}/feed-lang-seite.html?schritte=${schritte}&takt=${takt}${rueck ? '&rueck=1' : ''}`;
  const lastVorLauf = loadavg()[0];
  const ergebnis = { meta: {}, messungen: [] };
  try {
    for (const art of browserListe) {
      const reihe = [];
      let version = '';
      for (let i = 1; i <= laeufe; i++) {
        const b = art === 'chromium' ? await starteChromium() : await starteFirefox();
        try {
          version = b.version || version;
          const r = art === 'chromium' ? await laufChromium(b, url) : await laufFirefox(b, url);
          if (r.fehler || !r.ergebnis) throw new Error(`Lauf ${i} (${art}): ${r.fehler ?? 'kein Ergebnis'}`);
          const k = kennzahlen(r.ergebnis);
          reihe.push({ lauf: i, kennzahlen: k, roh: r.ergebnis });
          console.log(`${art} Lauf ${i}: gross ${dez(k.grossAnteil)} (${k.grossN}), profil ${dez(k.profilAnteil)} (${k.profilN}), Schritt Median ${k.schrittMedianMs} ms, p95 ${k.schrittP95Ms} ms, ohne Urteil ${k.schritteOhneUrteil}, longtask ${k.langeAufgaben ? `${k.langeAufgaben.anzahl}/${k.langeAufgaben.summeMs} ms` : 'n/a'}, Haenger ${k.haenger.anzahl}/${k.haenger.summeMs} ms${k.rueck ? `, Rueckweg gross ${dez(k.rueck.grossAnteil)} (${k.rueck.grossN}), profil ${dez(k.rueck.profilAnteil)}, Median ${k.rueck.schrittMedianMs} ms` : ''}`);
        } finally {
          await b.schliesse();
        }
      }
      ergebnis.messungen.push({ browser: art, version: version || (art === 'firefox' ? firefoxVersion() : ''), reihe });
    }
  } finally {
    server.close();
  }
  ergebnis.meta = {
    werkzeug: 'scripts/messung/feed-lang.mjs',
    befehl: `${process.env.VEIL_FIXTURE_PORT ? 'VEIL_FIXTURE_PORT=<port> ' : ''}node scripts/messung/feed-lang.mjs --ausgabe ${path.relative(wurzel, ausgabeOrdner)} --browser ${args.browser ?? 'beide'} --laeufe ${laeufe}${args.schritte ? ` --schritte ${schritte}` : ''}${args.takt ? ` --takt ${takt}` : ''}${rueck ? ' --rueck' : ''}`,
    datum: new Date().toISOString(),
    paket: `${paketJson.name} ${paketJson.version}`,
    ausgabe: path.relative(wurzel, ausgabeOrdner),
    seite: 'scripts/messung/feed-lang-seite.html (180 Beitraege, 240 Bilder, Endlos-Nachladen)',
    fenster: FENSTER,
    laeufe,
    schritte,
    taktMs: takt,
    lastmittelVorLauf: rund(lastVorLauf, 2),
    rueck,
  };
  const datei = path.join(hier, `ergebnis-feed-lang-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);

  const md = [];
  md.push('| Browser | Messgroesse | Median (Spannweite) | Einzelwerte der Laeufe |');
  md.push('|---|---|---|---|');
  for (const m of ergebnis.messungen) {
    const kz = m.reihe.map((r) => r.kennzahlen);
    const f = (feld, st = 0) => fasse(kz.map((k) => k[feld]), st);
    const tab = (name, x, einheit = '') => md.push(`| ${m.browser} ${m.version} | ${name} | ${dez(x.median)}${einheit} (${dez(x.min)} bis ${dez(x.max)}) | ${x.werte.map(dez).join(', ')} |`);
    const proz = (feld) => fasse(kz.map((k) => (k[feld] === null ? null : k[feld] * 100)), 1);
    tab('(a) grosse Bilder mit Urteil beim Eintritt', proz('grossAnteil'), ' %');
    tab('(a) Profilbilder mit Urteil beim Eintritt', proz('profilAnteil'), ' %');
    tab('(b) Schritt bis Sichtbereich frei, Median je Lauf', f('schrittMedianMs'), ' ms');
    tab('(b) Schritt bis Sichtbereich frei, p95 je Lauf', f('schrittP95Ms'), ' ms');
    tab('(b) Schritte ohne Urteil bis zum Ende', f('schritteOhneUrteil'));
    if (kz[0].langeAufgaben) {
      tab('(c) lange Aufgaben ueber 50 ms, Anzahl', fasse(kz.map((k) => k.langeAufgaben.anzahl), 0));
      tab('(c) lange Aufgaben ueber 50 ms, Summe', fasse(kz.map((k) => k.langeAufgaben.summeMs), 0), ' ms');
    } else md.push(`| ${m.browser} ${m.version} | (c) lange Aufgaben ueber 50 ms | nicht messbar (kein longtask im Browser) | |`);
    tab('(c) Ersatz: Haenger des Hauptfadens ueber 50 ms, Anzahl', fasse(kz.map((k) => k.haenger.anzahl), 0));
    tab('(d) Bilder, die den Sichtbereich ohne Urteil verliessen', fasse(kz.map((k) => (k.leer.verlassenOhneUrteilAnteil === null ? null : k.leer.verlassenOhneUrteilAnteil * 100)), 1), ' %');
    tab('(d) Leerzeit im Sichtbereich je grossem Bild', fasse(kz.map((k) => k.leer.leerMsJeBildGross), 0), ' ms');
    tab('(d) Leerzeit im Sichtbereich je Profilbild', fasse(kz.map((k) => k.leer.leerMsJeBildProfil), 0), ' ms');
    if (kz[0].rueck) {
      tab('Rueckweg: grosse Bilder mit Urteil beim Wiedereintritt', fasse(kz.map((k) => (k.rueck.grossAnteil === null ? null : k.rueck.grossAnteil * 100)), 1), ' %');
      tab('Rueckweg: Profilbilder mit Urteil beim Wiedereintritt', fasse(kz.map((k) => (k.rueck.profilAnteil === null ? null : k.rueck.profilAnteil * 100)), 1), ' %');
      tab('Rueckweg: Schritt bis frei, Median je Lauf', fasse(kz.map((k) => k.rueck.schrittMedianMs), 0), ' ms');
      tab('Rueckweg: Schritt bis frei, p95 je Lauf', fasse(kz.map((k) => k.rueck.schrittP95Ms), 0), ' ms');
    }
    tab('(c) Ersatz: Haenger des Hauptfadens, Summe', fasse(kz.map((k) => k.haenger.summeMs), 0), ' ms');
  }
  if (typeof args.md === 'string') await writeFile(args.md, md.join('\n'));
  console.log(md.join('\n'));
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
