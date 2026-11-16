// Auswertung Phase 11 (0c Ueberlappung, 0e Stoff gegen Haut), kein Produktcode. Liest die Rohdaten aus phase11-erkenner-roh.mjs und rechnet
// die Flaechen mit dem echten Produktcode (src/erkenner/zonen.ts, src/steigerung.ts, src/einstellungen.ts) offline.
// Aufruf: node --experimental-strip-types scripts/messung/phase11-erkenner-auswertung.mjs [--roh <ordner>] [--browser firefox]
// Ausgabe: <roh>/auswertung-0c.json, <roh>/auswertung-0e.json, <roh>/fuer-tests.json (nur Zahlen und Dateinamen).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { argumente, wurzel } from './hilfe.mjs';
import { STANDARD } from '../../src/einstellungen.ts';
import { wirksameZonen } from '../../src/steigerung.ts';
import { berechneFlaechen } from '../../src/erkenner/zonen.ts';

const args = argumente();
const projekt = path.resolve(wurzel, '..');
const roh = typeof args.roh === 'string' ? path.resolve(args.roh) : path.join(projekt, '03 Recherche', 'phase-11', 'erkenner');
const browser = args.browser === 'chromium' ? 'chromium' : 'firefox';
const lade = async (satz) => JSON.parse(await readFile(path.join(roh, `roh-${satz}-${browser}.json`), 'utf8'));

// ---------- Geometrie ----------
const schnitt = (a, b) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x2 <= x1 || y2 <= y1 ? 0 : (x2 - x1) * (y2 - y1);
};
const flaeche = (b) => b[2] * b[3];
const huelle = (boxen) => {
  const x1 = Math.min(...boxen.map((b) => b[0])), y1 = Math.min(...boxen.map((b) => b[1]));
  const x2 = Math.max(...boxen.map((b) => b[0] + b[2])), y2 = Math.max(...boxen.map((b) => b[1] + b[3]));
  return [x1, y1, x2 - x1, y2 - y1];
};

// Paare gleichrangiger Flaechen (aufgelegte Behandlungen mia-gesicht und balken ausgenommen), die sich schneiden.
function paareVon(flaechen) {
  const gleichrangig = flaechen.map((f, i) => ({ f, i })).filter(({ f }) => f.behandlung !== 'mia-gesicht' && f.behandlung !== 'balken');
  const paare = [];
  for (let a = 0; a < gleichrangig.length; a++) {
    for (let b = a + 1; b < gleichrangig.length; b++) {
      const s = schnitt(gleichrangig[a].f.box, gleichrangig[b].f.box);
      if (s > 0) {
        const klein = Math.min(flaeche(gleichrangig[a].f.box), flaeche(gleichrangig[b].f.box));
        paare.push({ a: gleichrangig[a].i, b: gleichrangig[b].i, klassen: [gleichrangig[a].f.zone, gleichrangig[b].f.zone].sort().join('+'), anteilKleiner: s / klein });
      }
    }
  }
  return paare;
}

// Zusammenhangskomponenten der Schnitt-Graphen; Huelle je Komponente und ueber alle beteiligten Flaechen.
function huellen(flaechen, paare) {
  const eltern = flaechen.map((_, i) => i);
  const finde = (x) => (eltern[x] === x ? x : (eltern[x] = finde(eltern[x])));
  for (const p of paare) eltern[finde(p.a)] = finde(p.b);
  const beteiligt = new Set(paare.flatMap((p) => [p.a, p.b]));
  const gruppen = new Map();
  for (const i of beteiligt) {
    const w = finde(i);
    gruppen.set(w, [...(gruppen.get(w) ?? []), flaechen[i].box]);
  }
  return {
    jeKomponente: [...gruppen.values()].map((l) => huelle(l)),
    ueberAlle: beteiligt.size ? huelle([...beteiligt].map((i) => flaechen[i].box)) : null,
  };
}

function flaechenFuer(treffer, b, stufe, preset) {
  const w = wirksameZonen({ ...STANDARD, preset }, stufe);
  return berechneFlaechen(treffer, { zonen: w.zonen, rand: STANDARD.rand, preset }, b.breite, b.hoehe, false);
}

const STUFEN = [0, 1, 2, 3];
const PRESETS = ['mosaik', 'mia-wort'];
const zuT = (t) => ({ zone: t.zone, bedeckt: t.bedeckt, score: t.score, box: t.box, quelle: t.quelle, ...(t.weiblich ? { weiblich: true } : {}) });

// ---------- 0c ----------
function auswertung0c(sets) {
  const aus = {};
  for (const preset of PRESETS) {
    aus[preset] = {};
    for (const stufe of STUFEN) {
      const z = { bilder: 0, mitPaar: 0, klassenPaare: {}, staerken: [], huelleKippt: { ueberAlle: 0, jeKomponente: 0 }, huelleAnteile: [], bilderMitPaar: [] };
      for (const [name, b] of Object.entries(sets)) {
        if (!b.ok) continue;
        z.bilder++;
        const fl = flaechenFuer(b.treffer.map(zuT), b, stufe, preset);
        const paare = paareVon(fl);
        if (!paare.length) continue;
        z.mitPaar++;
        const einBild = new Set();
        for (const p of paare) {
          z.klassenPaare[p.klassen] ??= { paare: 0, bilder: 0, staerken: [] };
          z.klassenPaare[p.klassen].paare++;
          z.klassenPaare[p.klassen].staerken.push(p.anteilKleiner);
          einBild.add(p.klassen);
          z.staerken.push(p.anteilKleiner);
        }
        for (const k of einBild) z.klassenPaare[k].bilder++;
        const h = huellen(fl, paare);
        const bildFl = b.breite * b.hoehe;
        const anteilAlle = flaeche(h.ueberAlle) / bildFl;
        const anteilMax = Math.max(...h.jeKomponente.map((x) => flaeche(x) / bildFl));
        if (anteilAlle > 0.6) z.huelleKippt.ueberAlle++;
        if (anteilMax > 0.6) z.huelleKippt.jeKomponente++;
        z.huelleAnteile.push(anteilAlle);
        z.bilderMitPaar.push({ name, paare: paare.length, anteilAlle: Math.round(anteilAlle * 1000) / 1000, anteilMax: Math.round(anteilMax * 1000) / 1000, klassen: [...einBild] });
      }
      aus[preset][stufe] = z;
    }
  }
  return aus;
}

const median = (l) => { const s = [...l].sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- 0e ----------
const HART = ['breast', 'genitals', 'buttocks'];
const VIER = ['breast', 'genitals', 'buttocks', 'belly'];
const ALLE_K = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];

function zoneInfo(treffer, zone, mind = 0) {
  const t = treffer.filter((x) => x.zone === zone && x.quelle === '320n' && x.score >= mind);
  const exp = t.filter((x) => !x.bedeckt).map((x) => x.score);
  const cov = t.filter((x) => x.bedeckt).map((x) => x.score);
  return { exp: exp.length ? Math.max(...exp) : null, cov: cov.length ? Math.max(...cov) : null };
}

function auswertung0e(nsfw, sfw, soll) {
  const aus = { schwellen: {}, faelle: {} };
  // Detektions-Schwelle d (0,10 Standard, 0,25 Maximum der Einstellung): Filtern nach Sicherheit ist exakt wie ein Lauf mit dieser Schwelle.
  for (const d of [0.1, 0.25]) {
    const s = { nsfw: {}, sfw: {}, sfwBilder: {}, nsfwImage: {} };
    for (const z of ALLE_K) {
      s.nsfw[z] = { sollSichtbar: 0, nurBedeckt: 0, exponiertGefunden: 0, nichts: 0, sollNurBedeckt: 0, stoffAlsHaut: 0, stoffRichtig: 0, stoffNichts: 0 };
    }
    for (const [name, b] of Object.entries(nsfw)) {
      const sl = soll[name];
      if (!b.ok || !sl) continue;
      for (const z of ALLE_K) {
        const i = zoneInfo(b.treffer, z, d);
        const c = s.nsfw[z];
        if (sl.sichtbar.includes(z)) {
          c.sollSichtbar++;
          if (i.exp !== null) c.exponiertGefunden++;
          else if (i.cov !== null) { c.nurBedeckt++; (aus.faelle[`d${d}:${z}`] ??= []).push({ name, covScore: i.cov }); }
          else c.nichts++;
        } else if (sl.bedeckt.includes(z)) {
          c.sollNurBedeckt++;
          if (i.exp !== null) c.stoffAlsHaut++;
          else if (i.cov !== null) c.stoffRichtig++;
          else c.stoffNichts++;
        }
      }
    }
    // Bild-Ebene nsfw: Bild mit Soll-sichtbar in einer harten Zone, aber keine EXPOSED-Klasse in harten Zonen gefunden (waere offen).
    let sollHart = 0, ohneExp = 0, nurBedeckt = 0, garNichts = 0;
    for (const [name, b] of Object.entries(nsfw)) {
      const sl = soll[name];
      if (!b.ok || !sl || !HART.some((z) => sl.sichtbar.includes(z))) continue;
      sollHart++;
      const infos = HART.map((z) => zoneInfo(b.treffer, z, d));
      if (infos.every((i) => i.exp === null)) {
        ohneExp++;
        if (infos.some((i) => i.cov !== null)) nurBedeckt++; else garNichts++;
      }
    }
    s.nsfwImage = { sollHart, ohneExposedInHartenZonen: ohneExp, davonNurBedeckt: nurBedeckt, davonGarNichts: garNichts };
    // sfw: Bilder mit EXPOSED je Zone (Fruehe Naeherung: sfw = bekleidet) und mit COVERED.
    for (const z of ALLE_K) s.sfw[z] = { bilder: 0, exposed: 0, covered: 0, exposedBilder: [] };
    let sfwN = 0, sfwHartExp = 0;
    for (const [name, b] of Object.entries(sfw)) {
      if (!b.ok) continue;
      sfwN++;
      let hart = false;
      for (const z of ALLE_K) {
        const i = zoneInfo(b.treffer, z, d);
        const c = s.sfw[z];
        c.bilder++;
        if (i.exp !== null) { c.exposed++; c.exposedBilder.push({ name, score: i.exp }); if (HART.includes(z)) hart = true; }
        if (i.cov !== null && i.exp === null) c.covered++;
      }
      if (hart) sfwHartExp++;
    }
    s.sfwBilder = { n: sfwN, mitExposedHart: sfwHartExp };
    aus.schwellen[d] = s;
  }
  return aus;
}

// Schwellenlauf: "eindeutig bekleidet" gilt nur, wenn die COVERED-Sicherheit mindestens t ist (und keine EXPOSED-Klasse in der Zone liegt).
// Erste Rate(t): Soll-sichtbar-Zonen (nsfw, Detektion 0,10), die nur COVERED >= t haben. Frei bleibende bekleidete Funde(t): Soll-nur-bedeckt-Zonen
// (nsfw), sfw-Zonen mit COVERED und ohne EXPOSED, und pack-tease-Zonen mit COVERED und ohne EXPOSED, jeweils mit COVERED >= t.
function schwellenlauf(nsfw, sfw, packTease, soll) {
  const zeilen = [];
  for (let t = 0.1; t <= 0.951; t += 0.05) {
    const tt = Math.round(t * 100) / 100;
    const z = { t: tt, hautAlsBedeckt: { gesamt: 0, vier: 0, jeKlasse: {} }, sollSichtbarZonen: 0, bekleidetFrei: { nsfwSollBedeckt: 0, nsfwSollBedecktNenner: 0, sfwZonen: 0, sfwZonenNenner: 0, packTeaseZonen: 0, packTeaseZonenNenner: 0 } };
    for (const k of VIER) z.hautAlsBedeckt.jeKlasse[k] = 0;
    for (const [name, b] of Object.entries(nsfw)) {
      const sl = soll[name];
      if (!b.ok || !sl) continue;
      for (const k of VIER) {
        const i = zoneInfo(b.treffer, k);
        if (sl.sichtbar.includes(k)) {
          if (t === 0.1) { /* Nenner unten */ }
          if (i.exp === null && i.cov !== null && i.cov >= tt) { z.hautAlsBedeckt.jeKlasse[k]++; z.hautAlsBedeckt.vier++; }
        } else if (sl.bedeckt.includes(k)) {
          z.bekleidetFrei.nsfwSollBedecktNenner++;
          if (i.exp === null && i.cov !== null && i.cov >= tt) z.bekleidetFrei.nsfwSollBedeckt++;
        }
      }
    }
    for (const b of Object.values(sfw)) {
      if (!b.ok) continue;
      for (const k of VIER) {
        const i = zoneInfo(b.treffer, k);
        if (i.cov !== null && i.exp === null) { z.bekleidetFrei.sfwZonenNenner++; if (i.cov >= tt) z.bekleidetFrei.sfwZonen++; }
      }
    }
    for (const b of Object.values(packTease)) {
      if (!b.ok) continue;
      for (const k of VIER) {
        const i = zoneInfo(b.treffer, k);
        if (i.cov !== null && i.exp === null) { z.bekleidetFrei.packTeaseZonenNenner++; if (i.cov >= tt) z.bekleidetFrei.packTeaseZonen++; }
      }
    }
    zeilen.push(z);
  }
  return zeilen;
}

// Pack-Satz: Stufe aus pack.json. Bildweise: Explicit ohne EXPOSED in harten Zonen (waere offen), Tease mit EXPOSED (Stoff als Haut oder echte Teilbloesse).
function auswertungPack(pack) {
  const aus = {};
  for (const stufe of ['tease', 'hot', 'explicit']) {
    const l = Object.entries(pack).filter(([, b]) => b.ok && b.stufe === stufe);
    const z = { n: l.length, mitExposedHart: 0, nurCoveredHart: 0, nichtsHart: 0, mitExposedVier: 0, jeKlasseExposedBilder: {}, jeKlasseCoveredNurBilder: {}, offeneBilder: [] };
    for (const k of ALLE_K) { z.jeKlasseExposedBilder[k] = 0; z.jeKlasseCoveredNurBilder[k] = 0; }
    for (const [name, b] of l) {
      const info = Object.fromEntries(ALLE_K.map((k) => [k, zoneInfo(b.treffer, k)]));
      for (const k of ALLE_K) {
        if (info[k].exp !== null) z.jeKlasseExposedBilder[k]++;
        else if (info[k].cov !== null) z.jeKlasseCoveredNurBilder[k]++;
      }
      if (HART.some((k) => info[k].exp !== null)) z.mitExposedHart++;
      else if (HART.some((k) => info[k].cov !== null)) z.nurCoveredHart++;
      else z.nichtsHart++;
      if (VIER.some((k) => info[k].exp !== null)) z.mitExposedVier++;
      if (stufe === 'explicit' && !HART.some((k) => info[k].exp !== null)) z.offeneBilder.push({ name, hartCov: HART.map((k) => [k, info[k].cov]).filter(([, v]) => v !== null) });
    }
    aus[stufe] = z;
  }
  return aus;
}

async function haupt() {
  const tb = (await lade('testbilder')).jeBild;
  const pack = (await lade('pack')).jeBild;
  const soll = JSON.parse(await readFile(path.join(projekt, '05 Testbilder', 'soll-zonen.json'), 'utf8')).bilder;
  const nsfw = Object.fromEntries(Object.entries(tb).filter(([k]) => k.startsWith('nsfw/')));
  const sfw = Object.fromEntries(Object.entries(tb).filter(([k]) => k.startsWith('sfw/')));
  const packTease = Object.fromEntries(Object.entries(pack).filter(([, b]) => b.stufe === 'tease'));

  const a0c = auswertung0c(tb);
  const a0cPack = auswertung0c(pack);
  const e = auswertung0e(nsfw, sfw, soll);
  const lauf = schwellenlauf(nsfw, sfw, packTease, soll);
  const ap = auswertungPack(pack);

  // Nenner Soll-sichtbar je Klasse (nsfw)
  const nenner = {};
  for (const k of ALLE_K) nenner[k] = Object.values(soll).filter((s) => s.sichtbar.includes(k)).length;
  await writeFile(path.join(roh, 'auswertung-0c.json'), JSON.stringify({ testbilder: a0c, pack: a0cPack }, (k, v) => (k === 'huelleAnteile' ? undefined : v), 1));
  await writeFile(path.join(roh, 'auswertung-0e.json'), JSON.stringify({ nenner, schwellen: e.schwellen, faelle: e.faelle, schwellenlauf: lauf, pack: ap }, null, 1));

  // fuer-tests.json: drei jugendfreie Bilder, die Bild 6 am naechsten kommen (bekleidete Person, zwei bis drei bedeckte Flaechen dicht beieinander).
  // Auswahl von Hand nach Ansicht (sfw-009, sfw-015, sfw-022); die Rohtreffer sind die des Erkenners bei Schwelle 0,10 (nur 320n, ohne Gesichter).
  const wahl = ['sfw/sfw-009-portraet.jpg', 'sfw/sfw-015-figur.jpg', 'sfw/sfw-022-figur.jpg'];
  const klasse = (t) => `${t.zone.toUpperCase()}_${t.bedeckt ? 'COVERED' : 'EXPOSED'}`;
  const fuerTests = {
    hinweis: 'Rohtreffer des Produkt-Erkenners (320n, Schwelle 0,10, Firefox 160, Bits identisch in drei Laeufen). zone und bedeckt entsprechen src/erkenner/modell.ts ZUORDNUNG; weiblich nur bei Klassen einer Frau. Flaechen: berechneFlaechen mit Standard-Einstellungen (Preset mosaik, rand 0,15), Stufe 1 und 2 der Steigerung. Keine Bilder, nur Zahlen.',
    ahnlichZu: '01 Uebergabe/blick-session-20/6-ueberlappung-schwarz-woerter.webp (Abendkleid: BREAST_COVERED und BELLY oder GENITALS_COVERED dicht beieinander, zwei schwarze Flaechen ueberlappen)',
    bilder: wahl.map((name) => {
      const b = tb[name];
      const t320 = b.treffer.filter((t) => t.quelle === '320n' && t.zone !== 'face');
      const je = {};
      for (const stufe of [1, 2]) {
        const fl = flaechenFuer(t320.map(zuT), b, stufe, 'mosaik');
        const paare = paareVon(fl);
        je[`stufe${stufe}`] = { flaechen: fl.map((f) => ({ zone: f.zone, box: f.box })), schneidendePaare: paare.map((p) => ({ klassen: p.klassen, anteilKleiner: Math.round(p.anteilKleiner * 100) / 100 })), huelleAnteilBild: paare.length ? Math.round((flaeche(huellen(fl, paare).ueberAlle) / (b.breite * b.hoehe)) * 1000) / 1000 : null };
      }
      return { name, breite: b.breite, hoehe: b.hoehe, rohtreffer: t320.map((t) => ({ klasse: klasse(t), zone: t.zone, bedeckt: t.bedeckt, score: t.score, box: t.box, ...(t.weiblich ? { weiblich: true } : {}) })), erwartet: je };
    }),
  };
  await writeFile(path.join(roh, 'fuer-tests.json'), JSON.stringify(fuerTests, null, 1));

  // Kurzausgabe 0c
  for (const preset of PRESETS) {
    for (const stufe of STUFEN) {
      const z = a0c[preset][stufe];
      console.log(`0c ${preset} Stufe ${stufe}: Bilder ${z.bilder}, mit Paar ${z.mitPaar}, Huelle kippt (alle) ${z.huelleKippt.ueberAlle}, (je Komponente) ${z.huelleKippt.jeKomponente}, Staerke Median ${median(z.staerken)?.toFixed(2)}`);
    }
  }
  for (const stufe of STUFEN) console.log(`0c pack mosaik Stufe ${stufe}: ${a0cPack.mosaik[stufe].mitPaar} von ${a0cPack.mosaik[stufe].bilder}, kippt ${a0cPack.mosaik[stufe].huelleKippt.ueberAlle}`);
  console.log('0e nenner', JSON.stringify(nenner));
  for (const d of [0.1, 0.25]) {
    const s = e.schwellen[d];
    console.log(`0e d=${d}: nsfwImage ${JSON.stringify(s.nsfwImage)}; sfw n ${s.sfwBilder.n} mitExposedHart ${s.sfwBilder.mitExposedHart}`);
    for (const k of ALLE_K) console.log(`   ${k}: nsfw ${JSON.stringify(s.nsfw[k])}; sfw exposed ${s.sfw[k].exposed} covered-only ${s.sfw[k].covered}`);
  }
  for (const z of lauf) console.log(`lauf t=${z.t}: HautAlsBedeckt vier=${z.hautAlsBedeckt.vier} ${JSON.stringify(z.hautAlsBedeckt.jeKlasse)}; frei nsfwSollBedeckt ${z.bekleidetFrei.nsfwSollBedeckt}/${z.bekleidetFrei.nsfwSollBedecktNenner}, sfw ${z.bekleidetFrei.sfwZonen}/${z.bekleidetFrei.sfwZonenNenner}, tease ${z.bekleidetFrei.packTeaseZonen}/${z.bekleidetFrei.packTeaseZonenNenner}`);
  for (const st of ['tease', 'hot', 'explicit']) console.log(`pack ${st}: ${JSON.stringify({ ...ap[st], offeneBilder: ap[st].offeneBilder.length })}`);
}

haupt().catch((e) => { console.error(e); process.exit(1); });
