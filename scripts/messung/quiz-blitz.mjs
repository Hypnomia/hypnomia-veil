// Messwerkzeug Phase 4 (kein Produktcode): Blitz-Grenzen im Quiz-Riegel (CLAUDE.md Regel 9, src/quiz/grenzen.ts).
// Der Riegel oeffnet ueber den Testhaken `veil-test` auf tests/fixtures/quiz-tasten.html (127.0.0.1). Gemessen wird
//   Chromium: CDP-Screencast (Bildfolge mit Zeitstempeln), mittlere Helligkeit je Bild, Wechsel = Aenderung um mehr als 10 Prozent der
//             Skala (absolut, 255 = 100 %) zwischen zwei Bildern; zusaetzlich die relative Variante (mehr als 10 % des Vorwerts).
//   beide:    In-Seite-Aufzeichnung der Abbild-Aenderungen (Woerter, Kartenfarbe, Zustand, offen) mit performance.now(),
//             Dauer der CSS-Animationen (document.getAnimations) fuer die Drehfrequenz.
// Firefox liefert kein dichtes Bild (WebDriver-Screenshots sind zu langsam), dort nur die In-Seite-Zahlen.
//   VEIL_AUSGABE=.output-messung VEIL_FIXTURE_PORT=47333 node scripts/messung/quiz-blitz.mjs --browser beide
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { baueDummyPack } from '../pack/baue-pack.mjs';
import { DUMMY_QUIZ } from '../pack/dummy-inhalte.mjs';
import { argumente, rund, warte, wurzel, zeitstempel } from './hilfe.mjs';
import { starteChromiumMitPack, starteFirefoxMitPack } from './pack-browser.mjs';

const arg = argumente();
const browser = String(arg.browser ?? 'beide');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47333);
const SEITE = `http://127.0.0.1:${port}/quiz-tasten.html`;

const ZAEHL = { wort: 'POP', woerter: 'POP,DOWN,OBEY,pink', anzahlWoerter: 10, wortMs: 600 };
const MESS_FRAGEN = [
  { id: 'm-sp', art: 'aufgabe', schwere: 'leicht', geraet: 'desktop', frage: 'Watch.', aufgabe: { typ: 'spirale-ansehen', param: { sekunden: 8 } } },
  { id: 'm-sp-x', art: 'aufgabe', schwere: 'leicht', geraet: 'desktop', frage: 'Watch.', aufgabe: { typ: 'spirale-ansehen', param: { sekunden: 99999, periode: 0.01, drehzahl: 500, arme: 40 } } },
  { id: 'm-za', art: 'aufgabe', schwere: 'mittel', geraet: 'beide', frage: 'Count every POP.', aufgabe: { typ: 'zaehlen', param: ZAEHL } },
  { id: 'm-za-x', art: 'aufgabe', schwere: 'mittel', geraet: 'beide', frage: 'Count every POP.', aufgabe: { typ: 'zaehlen', param: { ...ZAEHL, wortMs: 50, anzahlWoerter: 100000 } } },
  { id: 'm-bl', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'One word flashes once.', aufgabe: { typ: 'wort-blitz', param: { wort: 'OBEY' } } },
  { id: 'm-bl-x', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'One word flashes once.', aufgabe: { typ: 'wort-blitz', param: { wort: 'OBEY', zeigeMs: 1, wortMs: 50, anzahlWoerter: 100000 } } },
];

// ---------- In-Seite-Aufzeichnung ----------
const AUFZEICHNER = `
window.__rec = [];
const lies = () => {
  const roh = document.documentElement.getAttribute('data-veil-riegel');
  const a = roh ? JSON.parse(roh) : null;
  window.__rec.push({ t: performance.now(), offen: a ? a.offen : null, zustand: a ? a.zustand : null, wort: a ? a.wort : null,
    k: a ? a.kartenFarbe : null, eingabe: !!(a && a.eingabe), typ: a && a.frage ? a.frage.typ : null,
    p: a ? a.augenPeriodeS : null, dreht: a ? a.augenDrehen : null, erg: document.documentElement.getAttribute('data-veil-riegel-ergebnis') });
};
new MutationObserver(lies).observe(document.documentElement, { attributes: true, attributeFilter: ['data-veil-riegel', 'data-veil-riegel-ergebnis'] });
window.__oeffne = (o) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ riegel: { oeffne: o } }) }));
window.__einst = (t) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ einstellungen: t }) }));
return true;`;
const DUNKEL = `
const st = document.createElement('style');
st.textContent = 'html, body { background: #000 !important; } #player { background: #000 !important; }';
document.head.append(st);
return true;`;

// ---------- Browser-Adapter ----------
function adapter(b) {
  if (b.art === 'chromium') {
    return {
      async neueSeite(dunkel) {
        const s = await b.context.newPage();
        await s.goto(SEITE);
        await s.waitForFunction(() => document.documentElement.hasAttribute('data-veil-status'), null, { timeout: 15_000 });
        this.s = s;
        await this.js(AUFZEICHNER);
        if (dunkel) await this.js(DUNKEL);
        await warte(200);
      },
      js: (code) => adapterSeite.s.evaluate(`(async()=>{${code}})()`),
      async schliesseSeite() {
        await this.s.close().catch(() => {});
      },
    };
  }
  return {
    async neueSeite(dunkel) {
      await b.driver.get(SEITE);
      for (let i = 0; i < 100; i++) {
        if (await b.driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')")) break;
        await warte(150);
      }
      await this.js(AUFZEICHNER);
      if (dunkel) await this.js(DUNKEL);
      await warte(200);
    },
    async js(code) {
      const t = await b.driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         Promise.resolve((async () => {${code}})()).then((w) => done(JSON.stringify(w === undefined ? null : w)), (e) => done(JSON.stringify({ fehlerText: String(e) })));`,
      );
      return JSON.parse(t);
    },
    async schliesseSeite() {},
  };
}
let adapterSeite = null;

// ---------- Bildfolge (nur Chromium) ----------
async function starteBildfolge(seite) {
  const cdp = await seite.context().newCDPSession(seite);
  const bilder = [];
  cdp.on('Page.screencastFrame', async (f) => {
    bilder.push({ ts: f.metadata.timestamp * 1000, daten: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 50, maxWidth: 320, maxHeight: 180, everyNthFrame: 1 });
  return {
    async stoppe() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      return bilder;
    },
  };
}

async function helligkeiten(bilder) {
  const { default: sharp } = await import('sharp');
  const aus = [];
  for (const b of bilder) {
    const st = await sharp(Buffer.from(b.daten, 'base64')).greyscale().stats();
    aus.push({ ts: b.ts, h: st.channels[0].mean });
  }
  return aus;
}

// Hoechstzahl von Ereignissen in einem beliebigen Fenster von 1000 ms.
function maxJeSekunde(zeiten) {
  let m = 0;
  for (let i = 0, j = 0; i < zeiten.length; i++) {
    while (zeiten[i] - zeiten[j] >= 1000) j++;
    m = Math.max(m, i - j + 1);
  }
  return m;
}

function bildAuswertung(h) {
  if (h.length < 2) return { bilder: h.length };
  const dauer = (h[h.length - 1].ts - h[0].ts) / 1000;
  const abst = h.slice(1).map((x, i) => x.ts - h[i].ts).sort((a, b) => a - b);
  const abs = [];
  const rel = [];
  let maxDelta = 0;
  for (let i = 1; i < h.length; i++) {
    const d = Math.abs(h[i].h - h[i - 1].h);
    maxDelta = Math.max(maxDelta, d / 255);
    if (d / 255 > 0.1) abs.push(h[i].ts);
    if (d > 0.1 * Math.max(h[i - 1].h, 1)) rel.push(h[i].ts);
  }
  // Bilder je Sekunde im dichtesten Fenster und im Mittel
  const dichte = maxJeSekunde(h.map((x) => x.ts));
  return {
    bilder: h.length,
    dauerS: rund(dauer, 2),
    bilderJeSekundeMittel: rund(h.length / dauer, 1),
    bilderJeSekundeMax: dichte,
    medianAbstandMs: rund(abst[Math.floor(abst.length / 2)], 1),
    maxAbstandMs: rund(abst[abst.length - 1], 1),
    maxSprungProzent: rund(maxDelta * 100, 2),
    wechselAbs: abs.length,
    wechselAbsMaxJeS: maxJeSekunde(abs),
    wechselRel: rel.length,
    wechselRelMaxJeS: maxJeSekunde(rel),
  };
}

function recAuswertung(rec, t0) {
  const r = rec.filter((x) => x.t >= t0);
  const woerter = [];
  let letztes = '';
  for (const x of r) {
    if (x.wort !== null && x.wort !== letztes) {
      if (x.wort !== '') woerter.push(x.t);
      letztes = x.wort;
    }
  }
  const abst = woerter.slice(1).map((t, i) => t - woerter[i]);
  const kz = [];
  let k = null;
  for (const x of r) {
    if (x.k !== null && x.k !== k) {
      if (k !== null) kz.push(x.t);
      k = x.k;
    }
  }
  const offenWechsel = [];
  let o = false;
  for (const x of r) {
    const jetzt = x.offen === true;
    if (jetzt !== o) {
      offenWechsel.push(x.t);
      o = jetzt;
    }
  }
  const typ = r.find((x) => x.typ)?.typ ?? null;
  const p = r.find((x) => x.p)?.p ?? null;
  return {
    typ,
    woerter: woerter.length,
    woerterMaxJeS: maxJeSekunde(woerter),
    kuerzesterWortAbstandMs: abst.length ? rund(Math.min(...abst), 0) : null,
    medianWortAbstandMs: abst.length ? rund([...abst].sort((a, b) => a - b)[Math.floor(abst.length / 2)], 0) : null,
    kartenfarbeWechsel: kz.length,
    kartenfarbeMaxJeS: maxJeSekunde(kz),
    offenWechsel: offenWechsel.length,
    offenWechselMaxJeS: maxJeSekunde(offenWechsel),
    augenPeriodeS: p,
    hatEingabe: r.some((x) => x.eingabe),
  };
}

// ---------- Szenarien ----------
async function lauf(b, a, bild, titel, o) {
  adapterSeite = a;
  await a.neueSeite(o.dunkel);
  await a.js(`window.__einst({ ruhig: ${!!o.ruhig} }); return true;`);
  await warte(400);
  let folge = null;
  if (bild && b.art === 'chromium') folge = await starteBildfolge(a.s);
  await warte(300);
  const t0 = await a.js(`const t = performance.now(); window.__oeffne(${JSON.stringify(o.oeffne)}); return t;`);
  const start = Date.now();
  // Warten: Dauer fest oder bis zur Eingabezeile
  while (Date.now() - start < (o.maxMs ?? 12_000)) {
    await warte(100);
    if (o.bisEingabe) {
      const fertig = await a.js(`return window.__rec.some((x) => x.eingabe);`);
      if (fertig) break;
    } else if (Date.now() - start >= o.dauerMs) break;
  }
  if (o.bisEingabe) await warte(o.nachMs ?? 800);
  const animationen = await a.js(`return document.getAnimations().map((x) => { const t = x.effect && x.effect.getComputedTiming(); return t ? t.duration : null; });`);
  // Schliessen ueber Pause (Testhaken), Merker zuruecksetzen
  await a.js(`window.__einst({ pause: true }); return true;`);
  await warte(500);
  await a.js(`window.__einst({ pause: false }); return true;`);
  const bilder = folge ? await folge.stoppe() : null;
  const rec = await a.js(`return window.__rec;`);
  const ergebnis = { titel, optionen: { ...o }, rec: recAuswertung(rec, t0), animationDauernMs: animationen };
  if (bilder) ergebnis.bild = bildAuswertung(await helligkeiten(bilder));
  const dauern = (animationen ?? []).filter((x) => typeof x === 'number' && x > 0);
  if (dauern.length) {
    const d = Math.min(...dauern);
    ergebnis.drehHz = rund(1000 / d, 4);
    ergebnis.streifenHz = rund(2000 / d, 4);
  } else {
    ergebnis.drehHz = ergebnis.rec.augenPeriodeS ? rund(1 / parseFloat(ergebnis.rec.augenPeriodeS), 4) : 0;
    ergebnis.streifenHz = rund(2 * ergebnis.drehHz, 4);
  }
  await a.schliesseSeite();
  return ergebnis;
}

async function zehnmalPausieren(b, a, titel, o) {
  adapterSeite = a;
  await a.neueSeite(o.dunkel);
  let folge = null;
  if (b.art === 'chromium') folge = await starteBildfolge(a.s);
  await warte(300);
  const t0 = await a.js(`return performance.now();`);
  const start = Date.now();
  const lg = [];
  for (let i = 0; i < 10; i++) {
    await a.js(`window.__oeffne(${JSON.stringify(o.oeffne)}); return true;`);
    let ok = false;
    // Wartegrenze 6 s (das Oeffnen wird seit der Nachbesserung auf hoechstens 3 Wechsel je Sekunde gedrosselt)
    for (let w = 0; w < 300 && !ok; w++) {
      ok = await a.js(`const a = JSON.parse(document.documentElement.getAttribute('data-veil-riegel') || 'null'); return !!a && a.offen && a.zustand === 'frage';`);
      if (!ok) await warte(20);
    }
    lg.push(ok);
    await a.js(`window.__einst({ pause: true }); return true;`);
    for (let w = 0; w < 100; w++) {
      if ((await a.js(`return document.documentElement.getAttribute('data-veil-riegel-ergebnis');`)) === 'pause') break;
      await warte(20);
    }
    await a.js(`window.__einst({ pause: false }); return true;`);
  }
  const gesamtMs = Date.now() - start;
  await warte(300);
  const bilder = folge ? await folge.stoppe() : null;
  const rec = await a.js(`return window.__rec;`);
  const ergebnis = { titel, optionen: { ...o }, gesamtMs, geoeffnet: lg.filter(Boolean).length, rec: recAuswertung(rec, t0) };
  if (bilder) ergebnis.bild = bildAuswertung(await helligkeiten(bilder));
  await a.schliesseSeite();
  return ergebnis;
}

// Antworten auf test-w1 schnell hintereinander: bis zu 10 Klicks je Sekunde auf falsche Antworten (Kartenfarbe nur ueber die Sperre).
async function schnelleAntworten(b, a, titel) {
  adapterSeite = a;
  await a.neueSeite(true);
  let folge = null;
  if (b.art === 'chromium') folge = await starteBildfolge(a.s);
  const t0 = await a.js(`return performance.now();`);
  await a.js(`window.__oeffne({ frage: 'test-w1', verweigern: 0, richtigMs: 50, verweigertMs: 50 }); return true;`);
  await warte(600);
  // wiederholt die jeweils erste Antwort anklicken (Klick ueber die Seite, Rechtecke aus dem Abbild)
  for (let i = 0; i < 30; i++) {
    const r = await a.js(`const a = JSON.parse(document.documentElement.getAttribute('data-veil-riegel') || 'null'); return a && a.antworten && a.antworten[0] ? a.antworten[0] : null;`);
    if (r) {
      const x = r.x + r.w / 2;
      const y = r.y + r.h / 2;
      if (b.art === 'chromium') await a.s.mouse.click(x, y);
      else await b.driver.actions().move({ x: Math.round(x), y: Math.round(y) }).click().perform();
    }
    await warte(100);
  }
  await warte(500);
  const bilder = folge ? await folge.stoppe() : null;
  const rec = await a.js(`return window.__rec;`);
  const ergebnis = { titel, rec: recAuswertung(rec, t0) };
  if (bilder) ergebnis.bild = bildAuswertung(await helligkeiten(bilder));
  await a.js(`window.__einst({ pause: true }); return true;`);
  await warte(300);
  await a.js(`window.__einst({ pause: false }); return true;`);
  await a.schliesseSeite();
  return ergebnis;
}

const server = await starteFixtureServer(port);
const ordner = await mkdtemp(path.join(tmpdir(), 'veil-quizblitz-'));
const ergebnis = { werkzeug: 'scripts/messung/quiz-blitz.mjs', datum: new Date().toISOString(), browser: {} };
try {
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack({ quiz: { version: 1, fragen: [...DUMMY_QUIZ.fragen, ...MESS_FRAGEN] } })).bytes);
  for (const art of browser === 'beide' ? ['chromium', 'firefox'] : [browser]) {
    const b = art === 'chromium' ? await starteChromiumMitPack() : await starteFirefoxMitPack();
    console.log(`${art} ${b.version}`);
    const liste = [];
    try {
      if (art === 'chromium') await b.warteAufErkenner();
      await b.importierePack(packPfad);
      const a = adapter(b);
      const hinzu = async (p) => {
        const e = await p;
        liste.push(e);
        console.log(`${art} ${e.titel}: bild=${JSON.stringify(e.bild ? { b: e.bild.bilder, fps: e.bild.bilderJeSekundeMittel, sprung: e.bild.maxSprungProzent, wechsel: e.bild.wechselAbsMaxJeS } : null)} rec=${JSON.stringify(e.rec)} dreh=${e.drehHz ?? ''}/${e.streifenHz ?? ''}`);
      };
      // Aufgaben: normal, Ruhig, Pack ueberhoeht (VEIL_NUR_ZYKLEN=1 ueberspringt sie)
      if (!process.env.VEIL_NUR_ZYKLEN) for (const [name, normal, extrem, bisEingabe] of [
        ['Spirale', 'm-sp', 'm-sp-x', false],
        ['Zaehlfolge', 'm-za', 'm-za-x', true],
        ['Wort-Blitz', 'm-bl', 'm-bl-x', true],
      ]) {
        for (const [variante, frage, ruhig] of [['normal', normal, false], ['ruhig', normal, true], ['pack-ueberhoeht', extrem, false], ['ruhig+pack-ueberhoeht', extrem, true]]) {
          await hinzu(lauf(b, a, true, `${name} ${variante}`, { oeffne: { frage, verweigern: 0 }, ruhig, dunkel: true, bisEingabe, dauerMs: 6000, maxMs: 25_000 }));
        }
      }
      if (!process.env.VEIL_NUR_ZYKLEN) await hinzu(schnelleAntworten(b, a, 'schnelle Antworten (Kartenfarbe)'));
      for (const [v, dunkel, anker] of [['vollflaechig hell', false, null], ['vollflaechig dunkel', true, null], ['ueber Player (dunkel)', true, '#player']]) {
        await hinzu(zehnmalPausieren(b, a, `10x oeffnen und schliessen, ${v}`, { oeffne: { frage: 'test-w1', verweigern: 0, ...(anker ? { anker } : {}) }, dunkel }));
      }
      ergebnis.browser[art] = { version: b.version, szenarien: liste };
    } finally {
      await b.schliesse();
    }
  }
} finally {
  server.close?.();
  await rm(ordner, { recursive: true, force: true });
}
const datei = path.join(wurzel, 'scripts/messung', `ergebnis-quiz-blitz-${zeitstempel()}.json`);
writeFileSync(datei, JSON.stringify(ergebnis, null, 1));
console.log(`geschrieben: ${path.relative(wurzel, datei)}`);
process.exit(0);
