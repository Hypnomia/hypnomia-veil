// Messwerkzeug Phase 5 (Auftrag W, kein Produktcode): Zeit bis Mias Werbebild SICHTBAR ist (Pixel: Rotanteil der Dummy-Farbe in der Mitte der Flaeche),
// ab dem Zeitpunkt, zu dem die Flaeche im Dokument steht und ihre Groesse hat (Date.now() der Seite, direkt hinter dem Element bzw. beim Einfuegen).
// Seite: scripts/messung/werbung-zeit-seite.html (4 feste Flaechen: ins.adsbygoogle 728x90, div 300x250 mit "Sponsored" davor, div 320x50 mit
// "Anzeige" davor, div.ad-container 336x280; spaet eingefuegt nach 3 s ein div.ad-slot 300x250 und nach 5 s ein ins.adsbygoogle 300x250).
// Fester Ablauf je Lauf: frischer Browser, Dummy-Pack importieren, kontrolle.werbung an, dann
//   Ladung 1 (kalt): erste Seite nach dem Browserstart; "erste Flaeche" = ins, "weitere" = die anderen drei fest stehenden, "spaet" = die zwei eingefuegten
//   Ladung 2 (warm): dieselbe Seite neu geladen (Erkenner und Pack warm)
// Chromium: CDP-Screencast (volle Groesse 1280 x 900), Zeitstempel der Bildschirmaenderung. Firefox: Chrome-Kontext, Schleife mit drawSnapshot (640 x 450),
// Zeit nach dem Zeichnen. Beide Uhren sind die Wanduhr (Date.now), also mit den Marken der Seite vergleichbar.
//   VEIL_AUSGABE=.output-m VEIL_FIXTURE_PORT=47413 VEIL_FIXTURE_PORT_FREMD=47415 node scripts/messung/werbung-zeit.mjs --browser beide --laeufe 5
import { createServer } from 'node:http';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import firefox from 'selenium-webdriver/firefox.js';
import { baueDummyPack } from '../pack/baue-pack.mjs';
import { argumente, firefoxVersion, median, rund, warte, wurzel, zeitstempel } from './hilfe.mjs';
import { starteChromiumMitPack, starteFirefoxMitPack } from './pack-browser.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const arg = argumente();
const browserWahl = String(arg.browser ?? 'beide');
const LAEUFE = Number(arg.laeufe ?? 5);
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47413);
const SEITE = `http://127.0.0.1:${port}/werbung-zeit-seite.html`;
const FENSTER = { breite: 1280, hoehe: 900 };
const DAUER_MS = 8500;

// Flaechen in CSS-Pixeln (wie in der Seite): [links, oben, breite, hoehe]
const FLAECHEN = {
  's-ins': [20, 20, 728, 90],
  's-sponsored': [20, 160, 300, 250],
  's-anzeige': [360, 160, 320, 50],
  's-container': [360, 240, 336, 280],
  spaet1: [800, 160, 300, 250],
  spaet2: [20, 460, 300, 250],
};
const IDS = Object.keys(FLAECHEN);
const GRUPPE = { 's-ins': 'erste', 's-sponsored': 'weitere', 's-anzeige': 'weitere', 's-container': 'weitere', spaet1: 'spaet', spaet2: 'spaet' };
const GRENZE_WARM_MS = 300;

// ---------- Last ----------
const LAST_GRENZE = 4.5;
let gewartetGesamt = 0;
const lastProtokoll = [];
async function pruefeLast(reihe) {
  const e = { reihe, lastVorher: rund(os.loadavg()[0], 2), gewartetS: 0 };
  while (!process.env.VEIL_LAST_OHNE && os.loadavg()[0] >= LAST_GRENZE && gewartetGesamt < 40 * 60_000) {
    console.log(`  Last ${os.loadavg()[0].toFixed(2)} >= ${LAST_GRENZE}: warte 60 s`);
    await warte(60_000);
    gewartetGesamt += 60_000;
    e.gewartetS += 60;
  }
  e.lastBeginn = rund(os.loadavg()[0], 2);
  lastProtokoll.push(e);
  return e;
}

// ---------- Bildauswertung (rein; wird auch in den Chrome-Kontext von Firefox kopiert) ----------
// Rotanteil (R ueber 170, G unter 90, B unter 100, wie in tests/chromium/werbung.spec.ts) in den mittleren 60 % der Breite jeder Flaeche, volle Hoehe.
function rotAnteile(d, w, h, ch, massstab, flaechen) {
  return flaechen.map(([l, t, fw, fh]) => {
    const bw = fw * 0.6;
    const x0 = Math.round((l + fw / 2 - bw / 2) * massstab);
    const x1 = Math.round((l + fw / 2 + bw / 2) * massstab);
    const y0 = Math.round(t * massstab);
    const y1 = Math.round((t + fh) * massstab);
    let n = 0;
    let z = 0;
    for (let y = y0; y < y1 && y < h; y++) {
      for (let x = x0; x < x1 && x < w; x++) {
        const i = (y * w + x) * ch;
        z++;
        if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 100) n++;
      }
    }
    return z ? n / z : 0;
  });
}

// ---------- Aufnahme ----------
async function aufnahmeChromium(b, url, dauerMs) {
  const { default: sharp } = await import('sharp');
  const seite = await b.context.newPage();
  try {
    await seite.setViewportSize({ width: FENSTER.breite, height: FENSTER.hoehe });
    await seite.bringToFront();
    const cdp = await b.context.newCDPSession(seite);
    const roh = [];
    cdp.on('Page.screencastFrame', async (f) => {
      roh.push({ ts: f.metadata.timestamp * 1000, daten: f.data });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: FENSTER.breite, maxHeight: FENSTER.hoehe, everyNthFrame: 1 });
    await warte(300);
    const t0 = Date.now();
    await seite.goto(url);
    await warte(dauerMs);
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
    const marken = await seite.evaluate('window.__t');
    const abbild = await seite.evaluate(() => document.documentElement.getAttribute('data-veil-werbung'));
    const bilder = [];
    for (const f of roh) {
      const { data, info } = await sharp(Buffer.from(f.daten, 'base64')).raw().toBuffer({ resolveWithObject: true });
      bilder.push({ ts: f.ts, rot: rotAnteile(data, info.width, info.height, info.channels, info.width / FENSTER.breite, IDS.map((i) => FLAECHEN[i])) });
    }
    return { t0, marken, abbild: abbild ? JSON.parse(abbild) : null, bilder };
  } finally {
    await seite.close().catch(() => {});
  }
}

async function aufnahmeFirefox(b, url, dauerMs) {
  const d = b.driver;
  await d.get('about:blank');
  await d.manage().window().setRect({ width: FENSTER.breite, height: FENSTER.hoehe + 200 });
  for (let i = 0; i < 3; i++) {
    const [iw, ih, ow, oh] = await d.executeScript('return [innerWidth, innerHeight, outerWidth, outerHeight]');
    if (iw === FENSTER.breite && ih === FENSTER.hoehe) break;
    await d.manage().window().setRect({ width: FENSTER.breite + (ow - iw), height: FENSTER.hoehe + (oh - ih) });
    await warte(200);
  }
  const t0 = Date.now() + 300;
  // Die Navigation startet die Seite selbst nach 300 ms (aus about:blank), damit die Aufnahme schon laeuft.
  await d.executeScript('const u = arguments[0]; setTimeout(() => { location.href = u; }, 300);', url);
  await d.setContext(firefox.Context.CHROME);
  let bilder;
  try {
    const roh = await d.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const [dauer, flaechen] = JSON.parse(arguments[0]);
       const rotAnteile = ${rotAnteile.toString()};
       const win = Services.wm.getMostRecentWindow('navigator:browser');
       const br = win.gBrowser.selectedBrowser;
       const lw = 640;
       const c = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
       const g = c.getContext('2d', { willReadFrequently: true });
       const bilder = [];
       const start = Date.now();
       let fehler = 0;
       const schritt = async () => {
         try {
           const w = br.clientWidth, h = br.clientHeight;
           const lh = Math.round(lw * h / w);
           if (c.width !== lw || c.height !== lh) { c.width = lw; c.height = lh; }
           const bm = await br.drawSnapshot(0, 0, w, h, lw / w, 'rgb(255,255,255)');
           const ts = Date.now();
           g.drawImage(bm, 0, 0, lw, lh);
           const d = g.getImageData(0, 0, lw, lh).data;
           bilder.push({ ts, rot: rotAnteile(d, lw, lh, 4, lw / w, flaechen) });
           if (ts - start > dauer) return fertig(JSON.stringify(bilder));
         } catch (e) { if (++fehler > 100) return fertig(JSON.stringify({ fehlerText: String(e) })); if (Date.now() - start > dauer) return fertig(JSON.stringify(bilder)); }
         win.setTimeout(schritt, 0);
       };
       schritt();`,
      JSON.stringify([dauerMs, IDS.map((i) => FLAECHEN[i])]),
    );
    bilder = JSON.parse(roh);
    if (bilder.fehlerText) throw new Error(bilder.fehlerText);
  } finally {
    await d.setContext(firefox.Context.CONTENT);
  }
  const marken = await d.executeScript('return window.__t');
  const abbildRoh = await d.executeScript("return document.documentElement.getAttribute('data-veil-werbung')");
  return { t0, marken, abbild: abbildRoh ? JSON.parse(abbildRoh) : null, bilder };
}

// ---------- Auswertung ----------
function auswerten(auf) {
  const aus = {};
  const stand = new Map((auf.abbild?.flaechen ?? []).map((f) => [f.id, f]));
  IDS.forEach((id, k) => {
    const tGr = auf.marken?.[id] ?? null;
    const rot = auf.bilder.map((f) => [f.ts, f.rot[k]]);
    const erste = rot.find(([, r]) => r >= 0.1);
    const letzter = rot.length ? rot[rot.length - 1][1] : null;
    const vorherRot = tGr !== null && erste ? erste[0] < tGr : false;
    aus[id] = {
      gruppe: GRUPPE[id],
      markeGesetzt: tGr !== null,
      sichtbarMs: tGr !== null && erste ? rund(erste[0] - tGr, 0) : null,
      rotEnde: rund(letzter, 2),
      rotVorMarke: vorherRot,
      bildMsAbbild: stand.get(id)?.bildMs ?? null,
      abbildSichtbar: stand.get(id)?.sichtbar ?? null,
    };
  });
  const ab = auf.bilder.slice(1).map((f, i) => f.ts - auf.bilder[i].ts);
  return { flaechen: aus, bilder: auf.bilder.length, bildAbstandMaxMs: rund(ab.length ? Math.max(...ab) : null, 0), bildAbstandMedianMs: rund(median(ab), 1) };
}

async function lauf(art, nr, packPfad, url) {
  const b = art === 'chromium' ? await starteChromiumMitPack() : await starteFirefoxMitPack();
  const e = { lauf: nr, last: rund(os.loadavg()[0], 2), version: b.version };
  try {
    await b.importierePack(packPfad);
    await b.setzeEinstellungen({ kontrolle: { werbung: true, blitz: 'aus', leerlauf: false, leerlaufMinuten: 2 }, pause: false, ruhig: false });
    await warte(300);
    const nimm = art === 'chromium' ? aufnahmeChromium : aufnahmeFirefox;
    e.kalt = auswerten(await nimm(b, `${url}?ladung=1`, DAUER_MS));
    await warte(500);
    e.warm = auswerten(await nimm(b, `${url}?ladung=2`, DAUER_MS));
  } finally {
    await b.schliesse();
  }
  e.lastEnde = rund(os.loadavg()[0], 2);
  return e;
}

const fmt = (x) => (x === null || x === undefined ? 'kein Bild' : x);
async function haupt() {
  const html = await readFile(path.join(hier, 'werbung-zeit-seite.html'));
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/werbung-zeit-seite.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end('nicht gefunden');
    }
  });
  await new Promise((ok, fehl) => { server.once('error', fehl); server.listen(port, '127.0.0.1', ok); });
  const ordner = await mkdtemp(path.join(os.tmpdir(), 'veil-werbungzeit-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const ergebnis = { werkzeug: 'scripts/messung/werbung-zeit.mjs', datum: new Date().toISOString(), laeufe: LAEUFE, flaechen: FLAECHEN, browser: {} };
  try {
    for (const art of browserWahl === 'beide' ? ['chromium', 'firefox'] : [browserWahl]) {
      const e = await pruefeLast(`${art} Werbung Zeit`);
      const liste = [];
      let version = '';
      for (let i = 1; i <= LAEUFE; i++) {
        const l = await lauf(art, i, packPfad, SEITE);
        version = l.version || version;
        liste.push(l);
        const f = (ph, id) => fmt(l[ph].flaechen[id].sichtbarMs);
        console.log(`${art} Lauf ${i}: kalt ins ${f('kalt', 's-ins')} ms, weitere ${f('kalt', 's-sponsored')}/${f('kalt', 's-anzeige')}/${f('kalt', 's-container')}, spaet ${f('kalt', 'spaet1')}/${f('kalt', 'spaet2')}; warm ins ${f('warm', 's-ins')}, weitere ${f('warm', 's-sponsored')}/${f('warm', 's-anzeige')}/${f('warm', 's-container')}, spaet ${f('warm', 'spaet1')}/${f('warm', 'spaet2')}; Bilder ${l.kalt.bilder}/${l.warm.bilder} (Abstand max ${l.kalt.bildAbstandMaxMs}/${l.warm.bildAbstandMaxMs} ms), Last ${l.last}`);
      }
      e.lastEnde = rund(os.loadavg()[0], 2);
      ergebnis.browser[art] = { version: version || (art === 'firefox' ? firefoxVersion() : ''), laeufe: liste, last: e };
    }
  } finally {
    server.close();
    await rm(ordner, { recursive: true, force: true });
  }
  ergebnis.lastProtokoll = lastProtokoll;
  const datei = path.join(hier, `ergebnis-werbung-zeit-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`geschrieben: ${path.relative(wurzel, datei)} (Ziel warm ${GRENZE_WARM_MS} ms)`);
}
haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
