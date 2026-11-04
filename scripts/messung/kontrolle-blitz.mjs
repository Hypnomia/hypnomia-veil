// Messwerkzeug Phase 5 (kein Produktcode): Blitzwoerter (Auftrag B) und Leerlauf-Spirale (Auftrag L) PIXELBASIERT gegen die Grenzen
// aus ../00 Planung/SICHERHEITSGRENZEN.md. Die Seite bleibt auf 127.0.0.1 (Fixtures blitz.html und spirale.html), ausgeloest wird ueber den
// Testhaken `veil-test` (nur Testbau). Gemessen wird nur, was auf dem Bildschirm ankommt:
//   Chromium: CDP-Screencast (jedes Bild mit Zeitstempel, JPEG), Auswertung je Bild mit sharp.
//   Firefox:  Chrome-Kontext, in einer Schleife `browser.drawSnapshot` (so dicht wie moeglich) in eine kleine Leinwand (320 x 180).
// Je Bild: mittlere Helligkeit, Helligkeit ausserhalb der Mitte (nie ein Wort dort), Pink (#ff4fa3 mit Toleranz) zaehlen und als grobe Maske
// (40 x 23 Zellen) merken, Helligkeit an festen Punkten (Spirale). Alles andere folgt aus diesen Zeitreihen.
//   VEIL_AUSGABE=.output-m VEIL_FIXTURE_PORT=47413 VEIL_FIXTURE_PORT_FREMD=47415 node scripts/messung/kontrolle-blitz.mjs --browser beide [--laeufe 5]
//   Firefox 128: VEIL_FIREFOX_BIN=<Binary> davor setzen (nie in Dateien schreiben).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'selenium-webdriver/lib/command.js';
import firefox from 'selenium-webdriver/firefox.js';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { baueDummyPack } from '../pack/baue-pack.mjs';
import { argumente, firefoxBin, median, perzentil, rund, warte, wurzel, zeitstempel } from './hilfe.mjs';
import { starteChromiumMitPack, starteFirefoxMitPack } from './pack-browser.mjs';

const arg = argumente();
const browserWahl = String(arg.browser ?? 'beide');
const LAEUFE = Number(arg.laeufe ?? 5);
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47413);
const SEITE_BLITZ = `http://127.0.0.1:${port}/blitz.html`;
const SEITE_SPIRALE = `http://127.0.0.1:${port}/spirale.html`;

// ---------- Grenzen ----------
const G = { abstandMs: 185, woerter: 12, spanneMs: 2500, rateHz: 5.4, wechselJeS: 3, sprungProzent: 10, streifenHz: 2.5, ruhigAnteil: 0.3, einblendenMs: 1200 };
const SPRUNG = (G.sprungProzent / 100) * 255; // 25,5 von 255

// ---------- Last ----------
const LAST_GRENZE = 4.5;
const MAX_WARTEN_MS = 40 * 60_000;
let gewartetGesamt = 0;
const lastProtokoll = [];
const last1 = () => os.loadavg()[0];
async function pruefeLast(reihe) {
  const e = { reihe, lastVorher: rund(last1(), 2), gewartetS: 0, unterLast: false };
  let n = 0;
  while (!process.env.VEIL_LAST_OHNE && last1() >= LAST_GRENZE && gewartetGesamt < MAX_WARTEN_MS) {
    if (n++ % 5 === 0) console.log(`  Last ${last1().toFixed(2)} >= ${LAST_GRENZE}: warte 60 s (${Math.round(gewartetGesamt / 60000)} von 40 min)`);
    await warte(60_000);
    gewartetGesamt += 60_000;
    e.gewartetS += 60;
  }
  e.lastBeginn = rund(last1(), 2);
  e.unterLast = last1() >= LAST_GRENZE;
  if (e.unterLast) console.log(`  UNTER LAST: ${last1().toFixed(2)} nach ${Math.round(gewartetGesamt / 60000)} min Warten, miss trotzdem`);
  lastProtokoll.push(e);
  return e;
}
const schliesseLast = (e) => {
  e.lastEnde = rund(last1(), 2);
  if (last1() >= LAST_GRENZE) e.unterLast = true;
};

// ---------- Bildauswertung (rein, wird auch in den Chrome-Kontext von Firefox kopiert) ----------
// d: Pixel (RGB oder RGBA), ch: Kanaele je Pixel. minPink <= 0 schaltet das Pink-Zaehlen aus. punkte: [[bruchX, bruchY], ...].
function analysiereBild(d, w, h, ch, punkte, minPink, zellenMin) {
  const GX = 40;
  const GY = 23;
  let summe = 0;
  let aussen = 0;
  let aussenZahl = 0;
  let n = 0;
  let sx = 0;
  const zellen = new Uint16Array(GX * GY);
  const x0 = w * 0.2;
  const x1 = w * 0.8;
  const y0 = h * 0.2;
  const y1 = h * 0.8;
  const mitPink = minPink > 0;
  for (let y = 0; y < h; y++) {
    const zy = Math.min(GY - 1, ((y * GY) / h) | 0);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const gr = (r + g + b) / 3;
      summe += gr;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) {
        aussen += gr;
        aussenZahl++;
      }
      // Pink #ff4fa3 (255, 79, 163) mit Toleranz: R ueber 200, G unter 140, B zwischen 100 und 230 (wie in den Tests der Bauer).
      if (mitPink && r > 200 && g < 140 && b > 100 && b < 230) {
        n++;
        sx += x;
        zellen[zy * GX + Math.min(GX - 1, ((x * GX) / w) | 0)]++;
      }
    }
  }
  const maske = [];
  if (mitPink && n >= minPink) for (let k = 0; k < zellen.length; k++) if (zellen[k] >= zellenMin) maske.push(k);
  const pts = (punkte || []).map(([fx, fy]) => {
    const px = Math.round(fx * w);
    const py = Math.round(fy * h);
    let s = 0;
    let z = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = ((py + dy) * w + (px + dx)) * ch;
        s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        z++;
      }
    }
    return s / z;
  });
  return { mean: summe / (w * h), aussen: aussen / aussenZahl, n, cx: n ? sx / n : -1, maske, pts };
}

// ---------- Aufnahme ----------
// Seiten-Plan: Liste { t, d } (d = Detail des Testereignisses); Spiral-Ereignisse bekommen laufende Nummern. Wird nach dem Start der Aufnahme geplant.
const planJs = (plan) => `
  const p = ${JSON.stringify(plan)};
  window.__nr = window.__nr || 9000;
  for (const e of p) setTimeout(() => {
    const d = e.d.spirale ? { spirale: { ...e.d.spirale, nr: ++window.__nr } } : e.d;
    document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) }));
  }, e.t);
  return true;`;

function normiere(rohe) {
  if (!rohe.length) return [];
  const t0 = rohe[0].ts;
  return rohe.map((f) => ({ t: f.ts - t0, mean: f.mean, aussen: f.aussen, n: f.n, cx: f.cx, maske: f.maske, pts: f.pts }));
}

async function aufnahmeChromium(a, { dauerMs, plan, breite, hoehe, qualitaet, punkte, minPink, zellenMin }) {
  const { default: sharp } = await import('sharp');
  const cdp = await a.b.context.newCDPSession(a.s);
  const roh = [];
  cdp.on('Page.screencastFrame', async (f) => {
    roh.push({ ts: f.metadata.timestamp * 1000, daten: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: qualitaet, maxWidth: breite, maxHeight: hoehe, everyNthFrame: 1 });
  await a.js(planJs(plan));
  await warte(dauerMs);
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.detach().catch(() => {});
  const aus = [];
  for (const f of roh) {
    const { data, info } = await sharp(Buffer.from(f.daten, 'base64')).raw().toBuffer({ resolveWithObject: true });
    aus.push({ ts: f.ts, ...analysiereBild(data, info.width, info.height, info.channels, punkte, minPink, zellenMin) });
  }
  return normiere(aus);
}

async function aufnahmeFirefox(a, { dauerMs, plan, punkte, minPink, zellenMin }) {
  const { driver } = a.b;
  await driver.executeScript(planJs(plan).replace(/^\s*/, 'return (function(){') + '})()');
  await driver.setContext(firefox.Context.CHROME);
  try {
    const roh = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const [dauer, punkte, minPink, zellenMin] = JSON.parse(arguments[0]);
       const analysiereBild = ${analysiereBild.toString()};
       const win = Services.wm.getMostRecentWindow('navigator:browser');
       const br = win.gBrowser.selectedBrowser;
       const lw = 320, lh = 180;
       const c = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
       c.width = lw; c.height = lh;
       const g = c.getContext('2d', { willReadFrequently: true });
       const bilder = [];
       const t0 = win.performance.now();
       const schritt = async () => {
         try {
           const t = win.performance.now();
           const w = br.clientWidth, h = br.clientHeight;
           const bm = await br.drawSnapshot(0, 0, w, h, lw / w, 'rgb(0,0,0)');
           const ts = win.performance.now();
           g.drawImage(bm, 0, 0, lw, lh);
           const d = g.getImageData(0, 0, lw, lh).data;
           const r = analysiereBild(d, lw, lh, 4, punkte, minPink, zellenMin);
           bilder.push({ ts, ...r });
           if (t - t0 > dauer) return fertig(JSON.stringify(bilder));
         } catch (e) { return fertig(JSON.stringify({ fehlerText: String(e) })); }
         win.setTimeout(schritt, 0);
       };
       schritt();`,
      JSON.stringify([dauerMs, punkte, minPink, zellenMin]),
    );
    const erg = JSON.parse(roh);
    if (erg.fehlerText) throw new Error(erg.fehlerText);
    return normiere(erg);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

// ---------- Browser-Adapter ----------
async function adapter(art) {
  const b = art === 'chromium' ? await starteChromiumMitPack() : await starteFirefoxMitPack();
  const a = { art, b, version: b.version, s: null };
  if (art === 'chromium') {
    a.speicher = async (werte, entfernen = []) => {
      const s = await b.context.newPage();
      try {
        await s.goto(b.optionsUrl);
        await s.evaluate(async ([w, e]) => {
          const c = globalThis.chrome;
          if (Object.keys(w).length) await c.storage.local.set(w);
          if (e.length) await c.storage.local.remove(e);
        }, [werte, entfernen]);
      } finally {
        await s.close();
      }
    };
    a.oeffne = async (url) => {
      await a.schliesse();
      a.s = await b.context.newPage();
      await a.s.goto(url);
      await a.s.bringToFront();
      await a.s.mouse.move(150, 130);
      await warte(1500);
    };
    a.js = (code) => a.s.evaluate(`(async()=>{${code}})()`);
    a.schliesse = async () => {
      if (a.s) await a.s.close().catch(() => {});
      a.s = null;
    };
    a.nimmAuf = (o) => aufnahmeChromium(a, o);
  } else {
    const { driver, uuid, hauptFenster } = b;
    a.speicher = async (werte, entfernen = []) => {
      const vorher = await driver.getAllWindowHandles();
      await driver.setContext(firefox.Context.CHROME);
      try {
        await driver.executeScript(
          `const w = Services.wm.getMostRecentWindow('navigator:browser');
           w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
          `moz-extension://${uuid}/options.html`,
        );
      } finally {
        await driver.setContext(firefox.Context.CONTENT);
      }
      let neu;
      for (let i = 0; i < 100 && !neu; i++) {
        neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
        if (!neu) await warte(50);
      }
      await driver.switchTo().window(neu);
      try {
        for (let i = 0; i < 100; i++) {
          if (await driver.executeScript(`return document.readyState === 'complete' && !!(window.browser || window.chrome) && location.protocol === 'moz-extension:'`)) break;
          await warte(100);
        }
        const t = await driver.executeAsyncScript(
          `const fertig = arguments[arguments.length - 1];
           const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
           const [w, e] = JSON.parse(arguments[0]);
           (async () => { if (Object.keys(w).length) await api.storage.local.set(w); if (e.length) await api.storage.local.remove(e); return true; })()
             .then(() => fertig('true'), (x) => fertig(JSON.stringify({ fehlerText: String(x) })));`,
          JSON.stringify([werte, entfernen]),
        );
        if (t !== 'true') throw new Error(t);
      } finally {
        if ((await driver.getAllWindowHandles()).length > 1) await driver.close();
        await driver.switchTo().window(hauptFenster);
      }
    };
    a.oeffne = async (url) => {
      await driver.get(url);
      await driver.actions({ async: true }).move({ x: 150, y: 130, origin: 'viewport' }).perform();
      await warte(1800);
    };
    a.js = async (code) => {
      const t = await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         Promise.resolve((async () => {${code}})()).then((w) => done(JSON.stringify(w === undefined ? null : w)), (e) => done(JSON.stringify({ fehlerText: String(e) })));`,
      );
      return JSON.parse(t);
    };
    a.schliesse = async () => {};
    a.nimmAuf = (o) => aufnahmeFirefox(a, o);
  }
  return a;
}

// ---------- Zeitreihen-Hilfen ----------
const iou = (x, y) => {
  if (!x.length && !y.length) return 1;
  const sx = new Set(x);
  let gem = 0;
  for (const k of y) if (sx.has(k)) gem++;
  return gem / (x.length + y.length - gem);
};
// Hoechstzahl von Zeitpunkten in einem halboffenen Fenster [t, t + 1000).
function maxJeSekunde(zeiten) {
  let m = 0;
  for (let i = 0, j = 0; i < zeiten.length; i++) {
    while (zeiten[i] - zeiten[j] >= 1000) j++;
    m = Math.max(m, i - j + 1);
  }
  return m;
}
function bildStatistik(fr) {
  const ab = fr.slice(1).map((f, i) => f.t - fr[i].t);
  return { bilder: fr.length, dauerS: rund(fr.length ? fr[fr.length - 1].t / 1000 : 0, 2), abstandMedianMs: rund(median(ab), 1), abstandP95Ms: rund(perzentil(ab, 0.95), 1), abstandMaxMs: rund(ab.length ? Math.max(...ab) : null, 1) };
}
// Vollflaechige Wechsel: Sprung der Helligkeit (Reihe `schluessel`) zwischen zwei aufeinanderfolgenden Bildern um mehr als 10 % der Skala.
function wechselDerHelligkeit(fr, schluessel) {
  const zeiten = [];
  let maxSprung = 0;
  for (let i = 1; i < fr.length; i++) {
    const s = Math.abs(fr[i][schluessel] - fr[i - 1][schluessel]);
    maxSprung = Math.max(maxSprung, s);
    if (s > SPRUNG) zeiten.push(fr[i].t);
  }
  return { anzahl: zeiten.length, jeSekundeMax: maxJeSekunde(zeiten), maxSprungProzent: rund((maxSprung / 255) * 100, 2), zeiten: zeiten.map((z) => rund(z, 0)) };
}

// ---------- Blitzwoerter ----------
function pixelWoerter(fr, minPink) {
  const w = [];
  let cur = null;
  let vorher = [];
  for (const f of fr) {
    if (f.n >= minPink) {
      if (!cur) {
        cur = { an: f.t, aus: null };
        w.push(cur);
      } else if (iou(vorher, f.maske) < 0.5) {
        cur.aus = f.t;
        cur = { an: f.t, aus: null };
        w.push(cur);
      }
      vorher = f.maske;
    } else if (cur) {
      cur.aus = f.t;
      cur = null;
      vorher = [];
    }
  }
  return w;
}
function wertBlitz(fr, minPink) {
  const w = pixelWoerter(fr, minPink);
  const an = w.map((x) => x.an);
  const abst = an.slice(1).map((t, i) => t - an[i]);
  const letztesPink = [...fr].reverse().find((f) => f.n >= minPink);
  const spanne = w.length ? (w[w.length - 1].aus ?? letztesPink?.t ?? an[an.length - 1]) - an[0] : 0;
  // Dichte: aus drei aufeinanderfolgenden Abstaenden gemittelt (glaettet die Bildraster-Schwankung), in Woertern je Sekunde.
  let rate = null;
  if (abst.length >= 3) {
    let kleinst = Infinity;
    for (let i = 0; i + 3 <= abst.length; i++) kleinst = Math.min(kleinst, (abst[i] + abst[i + 1] + abst[i + 2]) / 3);
    rate = 1000 / kleinst;
  } else if (abst.length) rate = 1000 / (abst.reduce((s, x) => s + x, 0) / abst.length);
  const dauern = w.filter((x) => x.aus !== null).map((x) => x.aus - x.an);
  // Bildluecke waehrend der Woerter (Aufloesung der Zeitangaben)
  const luecken = [];
  for (let i = 1; i < fr.length; i++) if (fr[i - 1].t >= (an[0] ?? Infinity) && fr[i].t <= (letztesPink?.t ?? -1)) luecken.push(fr[i].t - fr[i - 1].t);
  return {
    woerter: w.length,
    kleinsterAbstandMs: abst.length ? rund(Math.min(...abst), 0) : null,
    spanneMs: rund(spanne, 0),
    fensterAnzahlMax: maxJeSekunde(an),
    rateHz: rund(rate, 2),
    sichtMedianMs: rund(median(dauern), 0),
    bildLueckeImWortMaxMs: luecken.length ? rund(Math.max(...luecken), 0) : null,
    wechselAussen: wechselDerHelligkeit(fr, 'aussen'),
    wechselGanz: wechselDerHelligkeit(fr, 'mean'),
    randSchwankungProzent: rund(((Math.max(...fr.map((f) => f.aussen)) - Math.min(...fr.map((f) => f.aussen))) / 255) * 100, 2),
    anfaenge: an.map((t) => rund(t, 0)),
    bild: bildStatistik(fr),
  };
}

const abbildBlitz = async (a) => {
  const roh = await a.js(`return document.documentElement.getAttribute('data-veil-blitz');`);
  return roh ? JSON.parse(roh) : null;
};
async function warteBlitzEnde(a) {
  for (let i = 0; i < 200; i++) {
    const x = await abbildBlitz(a);
    if (!x || x.laeuft === false) return x;
    await warte(50);
  }
  return await abbildBlitz(a);
}
function zufallsReihe(erstes) {
  const r = [erstes];
  for (let i = 0; i < 60; i++) r.push(Math.random());
  return r;
}

async function blitzReihen(a, ergebnis) {
  const MIN_PINK = a.art === 'chromium' ? 40 : 12;
  const ZELLEN = a.art === 'chromium' ? 2 : 1;
  const bildGroesse = a.art === 'chromium' ? { breite: 640, hoehe: 360, qualitaet: 80 } : {};
  const messe = async (ereignis, zufall, dauerMs) => {
    const vorher = (await abbildBlitz(a))?.nr ?? 0;
    const fr = await a.nimmAuf({ dauerMs, plan: [{ t: 600, d: { blitz: { ereignis, ...(zufall ? { zufall } : {}) } } }], punkte: [], minPink: MIN_PINK, zellenMin: ZELLEN, ...bildGroesse });
    const x = await warteBlitzEnde(a);
    return { fr, abbild: x && x.nr > vorher ? x : null };
  };
  await a.b.loescheEinstellungen();
  await a.b.setzeEinstellungen({ kontrolle: { werbung: false, blitz: 'selten', leerlauf: false, leerlaufMinuten: 2 }, ruhig: false, pause: false });
  await a.speicher({ quizWarnungGesehen: true, spiraleWarnungGesehen: true }, ['blitzZeitplan']);
  await warte(400);
  await a.oeffne(SEITE_BLITZ);

  // B1: Einzelwort und Schwarm
  let e = await pruefeLast(`${a.art} Blitzwoerter normal`);
  const normal = { einzel: [], schwarm: [] };
  const erste = [0.99, 0.0, 0.5, 0.85, 0.2, 0.7, 0.95, 0.35];
  for (let i = 0; i < LAEUFE; i++) {
    const lastLauf = rund(last1(), 2);
    const ew = await messe('wort', zufallsReihe(Math.random()), 2200);
    const ewW = wertBlitz(ew.fr, MIN_PINK);
    normal.einzel.push({ lauf: i + 1, last: lastLauf, ...ewW, abbildWoerter: ew.abbild?.woerter?.length ?? null, abbildAbbruch: ew.abbild?.abbruch ?? null, abbildAbgelehnt: ew.abbild?.abgelehnt ?? null, reihe: kompakt(ew.fr) });
    await warte(400);
    const sw = await messe('schwarm', zufallsReihe(erste[i % erste.length]), 4800);
    const swW = wertBlitz(sw.fr, MIN_PINK);
    const ws = sw.abbild?.woerter ?? [];
    const abst = ws.slice(1).map((w, k) => w.an - ws[k].an);
    normal.schwarm.push({
      lauf: i + 1,
      last: lastLauf,
      ...swW,
      abbildWoerter: ws.length,
      abbildKleinsterAbstandMs: abst.length ? rund(Math.min(...abst), 0) : null,
      abbildSpanneMs: ws.length ? rund(ws[ws.length - 1].aus - ws[0].an, 0) : null,
      abbildAbbruch: sw.abbild?.abbruch ?? null,
      reihe: kompakt(sw.fr),
    });
    console.log(`${a.art} Blitz Lauf ${i + 1}: Einzel ${ewW.woerter} Wort, ${ewW.sichtMedianMs} ms sichtbar, Wechsel aussen ${ewW.wechselAussen.jeSekundeMax}; Schwarm ${swW.woerter} Woerter (Abbild ${ws.length}), min Abstand ${swW.kleinsterAbstandMs} ms, Spanne ${swW.spanneMs} ms, Rate ${swW.rateHz} Hz, Fenster ${swW.fensterAnzahlMax}, Wechsel aussen ${swW.wechselAussen.jeSekundeMax}, Bildluecke max ${swW.bildLueckeImWortMaxMs} ms`);
    await warte(500);
  }
  schliesseLast(e);
  ergebnis.blitz = { normal, last: e };

  // B2: Ruhig-Modus
  e = await pruefeLast(`${a.art} Blitzwoerter Ruhig`);
  await a.b.setzeEinstellungen({ ruhig: true });
  await warte(500);
  const ruhig = { einzel: [], schwarm: [] };
  for (let i = 0; i < LAEUFE; i++) {
    for (const [ereignis, liste] of [['wort', ruhig.einzel], ['schwarm', ruhig.schwarm]]) {
      const r = await messe(ereignis, null, 1800);
      const px = wertBlitz(r.fr, MIN_PINK);
      liste.push({ lauf: i + 1, woerterPixel: px.woerter, abbildAbgelehnt: r.abbild?.abgelehnt ?? null, abbildWoerter: r.abbild?.woerter?.length ?? null, wechselAussen: px.wechselAussen.jeSekundeMax, bild: px.bild });
    }
    await warte(300);
  }
  console.log(`${a.art} Blitz Ruhig: Woerter in Pixeln ${[...ruhig.einzel, ...ruhig.schwarm].map((x) => x.woerterPixel).join(',')}, Abbild ${[...ruhig.einzel, ...ruhig.schwarm].map((x) => x.abbildAbgelehnt).join(',')}`);
  await a.b.setzeEinstellungen({ ruhig: false });
  schliesseLast(e);
  ergebnis.blitz.ruhig = { ...ruhig, last: e };
  await a.schliesse();
}

// ---------- Spirale ----------
const PUNKTE = [[0.25, 0.3], [0.75, 0.3], [0.3, 0.75], [0.7, 0.7], [0.18, 0.5], [0.82, 0.5]];

// Steigende Schnittzeiten (mit Huelle von 15 % der Amplitude) einer Reihe, Zeiten linear zwischen den Bildern.
function steigendeSchnitte(t, v) {
  const s = [...v].sort((p, q) => p - q);
  const lo = s[Math.floor(s.length * 0.05)];
  const hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  const amp = hi - lo;
  const mitte = (lo + hi) / 2;
  const oben = mitte + amp * 0.15;
  const unten = mitte - amp * 0.15;
  const aus = [];
  let zustand = v[0] > mitte;
  for (let i = 1; i < v.length; i++) {
    if (!zustand && v[i] > oben) {
      const bruch = (oben - v[i - 1]) / (v[i] - v[i - 1] || 1);
      aus.push(t[i - 1] + bruch * (t[i] - t[i - 1]));
      zustand = true;
    } else if (zustand && v[i] < unten) zustand = false;
  }
  return { amp, zeiten: aus };
}
// Hauptfrequenz per Fourier-Suche (0,1 bis 6 Hz), Reihe vorher gleichmaessig mit 50 Hz abgetastet, Hann-Fenster; Leistung ueber alle Punkte addiert.
function dftHz(reihen, t) {
  const dt = 20;
  const t0 = t[0];
  const t1 = t[t.length - 1];
  const N = Math.floor((t1 - t0) / dt);
  if (N < 60) return null;
  const gleich = reihen.map((v) => {
    const a = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
      const x = t0 + k * dt;
      while (j < t.length - 2 && t[j + 1] < x) j++;
      const f = (x - t[j]) / (t[j + 1] - t[j] || 1);
      a.push(v[j] + f * (v[j + 1] - v[j]));
    }
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    return a.map((x, k) => (x - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1))));
  });
  let bestF = 0;
  let bestP = -1;
  for (let f = 0.1; f <= 6; f += 0.01) {
    let p = 0;
    for (const a of gleich) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < N; k++) {
        const w = 2 * Math.PI * f * ((k * dt) / 1000);
        re += a[k] * Math.cos(w);
        im += a[k] * Math.sin(w);
      }
      p += re * re + im * im;
    }
    if (p > bestP) {
      bestP = p;
      bestF = f;
    }
  }
  return bestF;
}

function wertSpirale(fr) {
  const grund = median(fr.slice(0, 3).map((f) => f.mean));
  const ende = fr[fr.length - 1].t;
  const fertig = median(fr.filter((f) => f.t >= ende - 3000).map((f) => f.mean));
  const delta = fertig - grund;
  const tA = fr.find((f) => Math.abs(f.mean - grund) >= 0.1 * Math.abs(delta))?.t ?? null;
  const tB = fr.find((f) => tA !== null && f.t > tA && Math.abs(f.mean - grund) >= 0.9 * Math.abs(delta))?.t ?? null;
  const einblenden1090 = tA !== null && tB !== null ? tB - tA : null;
  // Streifenfrequenz im eingeschwungenen Teil: ab 0,5 s nach dem Erreichen von 90 %.
  const stabil = fr.filter((f) => tB !== null && f.t >= tB + 500 && f.t <= ende - 150);
  let hz = null;
  let dft = null;
  let punktHz = [];
  let amplituden = [];
  if (stabil.length > 30) {
    const t = stabil.map((f) => f.t);
    const reihen = PUNKTE.map((_, k) => stabil.map((f) => f.pts[k]));
    for (const v of reihen) {
      const s = steigendeSchnitte(t, v);
      amplituden.push(rund(s.amp, 0));
      // nur Punkte, an denen die Arme wirklich vorbeilaufen (Amplitude ueber 40, wie im Test der Bauer)
      punktHz.push(s.amp > 40 && s.zeiten.length >= 2 ? (s.zeiten.length - 1) / ((s.zeiten[s.zeiten.length - 1] - s.zeiten[0]) / 1000) : null);
    }
    hz = median(punktHz.filter((x) => x !== null));
    const gut = reihen.filter((_, k) => amplituden[k] > 40);
    dft = gut.length ? dftHz(gut, t) : null;
  }
  return {
    grundHelligkeit: rund(grund, 1),
    endHelligkeit: rund(fertig, 1),
    einblenden1090Ms: rund(einblenden1090, 0),
    einblendenGeschaetztMs: einblenden1090 === null ? null : rund(einblenden1090 / 0.8, 0),
    streifenHz: rund(hz, 3),
    streifenHzDft: rund(dft, 2),
    streifenHzJePunkt: punktHz.map((x) => rund(x, 3)),
    amplituden,
    stabilSekunden: stabil.length ? rund((stabil[stabil.length - 1].t - stabil[0].t) / 1000, 1) : 0,
    wechselGanz: wechselDerHelligkeit(fr, 'mean'),
    bild: bildStatistik(fr),
  };
}

const abbildSpirale = async (a) => {
  const roh = await a.js(`return document.documentElement.getAttribute('data-veil-spirale');`);
  return roh ? JSON.parse(roh) : null;
};
const sendeSpirale = (a, zustand) => a.js(`document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { zustand: ${JSON.stringify(zustand)}, nr: ++window.__nr } }) })); return true;`);

async function spiralReihen(a, ergebnis) {
  const bildGroesse = a.art === 'chromium' ? { breite: 320, hoehe: 180, qualitaet: 70 } : {};
  await a.b.loescheEinstellungen();
  await a.b.setzeEinstellungen({ kontrolle: { werbung: false, blitz: 'aus', leerlauf: true, leerlaufMinuten: 2 }, ruhig: false, pause: false });
  await a.speicher({ quizWarnungGesehen: true, spiraleWarnungGesehen: true });
  await warte(400);
  await a.oeffne(SEITE_SPIRALE);
  await a.js('window.__nr = window.__nr || 9000; return true;');
  const ruheWieder = async () => {
    await sendeSpirale(a, 'active');
    await warte(600);
  };
  const aufn = (plan, dauerMs) => a.nimmAuf({ dauerMs, plan, punkte: PUNKTE, minPink: 0, zellenMin: 1, ...bildGroesse });

  const lang = async (name, dauerMs) => {
    const e = await pruefeLast(`${a.art} ${name}`);
    const liste = [];
    for (let i = 0; i < LAEUFE; i++) {
      const lastLauf = rund(last1(), 2);
      await ruheWieder();
      const fr = await aufn([{ t: 600, d: { spirale: { zustand: 'idle' } } }], dauerMs);
      const ab = await abbildSpirale(a);
      await ruheWieder();
      const w = wertSpirale(fr);
      liste.push({ lauf: i + 1, last: lastLauf, ...w, abbildHz: ab?.hz ?? null, abbildRuhig: ab?.ruhig ?? null, abbildErgebnis: ab?.ergebnis ?? null, reihe: kompakt(fr, true) });
      console.log(`${a.art} ${name} Lauf ${i + 1}: Streifen ${w.streifenHz} Hz (DFT ${w.streifenHzDft}, Abbild ${ab?.hz}), einblenden 10-90 ${w.einblenden1090Ms} ms (geschaetzt ${w.einblendenGeschaetztMs}), Wechsel ganz je s ${w.wechselGanz.jeSekundeMax}, groesster Sprung ${w.wechselGanz.maxSprungProzent} %, Bilder ${w.bild.bilder} (Abstand Median ${w.bild.abstandMedianMs} ms, max ${w.bild.abstandMaxMs} ms)`);
    }
    schliesseLast(e);
    return { last: e, laeufe: liste };
  };
  ergebnis.spirale = {};
  ergebnis.spirale.normal = await lang('Spirale normal', 11_500);
  await a.b.setzeEinstellungen({ ruhig: true });
  await warte(600);
  ergebnis.spirale.ruhig = await lang('Spirale Ruhig', 15_000);
  await a.b.setzeEinstellungen({ ruhig: false });
  await warte(600);

  // Schneller Wechsel: 10 Wechsel in 2 s (idle, active, ...), alle 200 ms.
  const e = await pruefeLast(`${a.art} Spirale schneller Wechsel`);
  const schnell = [];
  for (let i = 0; i < LAEUFE; i++) {
    const lastLauf = rund(last1(), 2);
    await ruheWieder();
    const plan = [];
    for (let k = 0; k < 10; k++) plan.push({ t: 600 + k * 200, d: { spirale: { zustand: k % 2 === 0 ? 'idle' : 'active' } } });
    const fr = await aufn(plan, 4200);
    const ab = await abbildSpirale(a);
    await ruheWieder();
    const w = wechselDerHelligkeit(fr, 'mean');
    // zusaetzlich: Ausschlag der Helligkeit insgesamt (zeigt, wie weit die Spirale in 200 ms ueberhaupt eingeblendet wird)
    const mins = Math.min(...fr.map((f) => f.mean));
    const maxs = Math.max(...fr.map((f) => f.mean));
    schnell.push({ lauf: i + 1, last: lastLauf, wechselGanz: w, helligkeitSpanneProzent: rund(((maxs - mins) / 255) * 100, 1), entscheidungen: ab?.entscheidungen ?? null, ergebnis: ab?.ergebnis ?? null, bild: bildStatistik(fr), reihe: kompakt(fr, true) });
    console.log(`${a.art} Spirale schnell Lauf ${i + 1}: Wechsel ganz ${w.anzahl} (je Sekunde max ${w.jeSekundeMax}), groesster Sprung ${w.maxSprungProzent} %, Helligkeitsspanne ${rund(((maxs - mins) / 255) * 100, 1)} %, Entscheidungen ${ab?.entscheidungen}`);
  }
  schliesseLast(e);
  ergebnis.spirale.schnell = { last: e, laeufe: schnell };
  await a.schliesse();
}

// Kompakte Zeitreihe fuer die Rohdaten: [t, mean, aussen, n] (Spirale: ohne Pink-Anzahl, mit Punkten).
function kompakt(fr, mitPunkten = false) {
  return fr.map((f) => [rund(f.t, 0), rund(f.mean, 1), rund(f.aussen, 1), f.n, ...(mitPunkten ? f.pts.map((p) => rund(p, 0)) : [])]);
}

// ---------- Ablauf ----------
const server = await starteFixtureServer(port);
const ordner = await mkdtemp(path.join(os.tmpdir(), 'veil-kontrolle-blitz-'));
const ergebnis = { werkzeug: 'scripts/messung/kontrolle-blitz.mjs', datum: new Date().toISOString(), laeufe: LAEUFE, grenzen: G, lastGrenze: LAST_GRENZE, browser: {} };
try {
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  for (const art of browserWahl === 'beide' ? ['chromium', 'firefox'] : [browserWahl]) {
    const a = await adapter(art);
    console.log(`${art} ${a.version}`);
    const erg = { version: a.version, firefoxBinaer: art === 'firefox' ? (firefoxBin.includes('128') ? '128 (Mindestversion)' : 'Standard') : undefined };
    try {
      if (art === 'chromium') await a.b.warteAufErkenner();
      await a.b.importierePack(packPfad);
      await blitzReihen(a, erg);
      await spiralReihen(a, erg);
    } finally {
      await a.schliesse().catch(() => {});
      await a.b.schliesse();
    }
    ergebnis.browser[art] = erg;
  }
} finally {
  server.close?.();
  await rm(ordner, { recursive: true, force: true });
}
ergebnis.lastProtokoll = lastProtokoll;
ergebnis.gewartetMinutenGesamt = Math.round(gewartetGesamt / 60000);
const datei = path.join(wurzel, 'scripts/messung', `ergebnis-kontrolle-blitz-${zeitstempel()}.json`);
writeFileSync(datei, JSON.stringify(ergebnis));
console.log(`geschrieben: ${path.relative(wurzel, datei)}`);
process.exit(0);
