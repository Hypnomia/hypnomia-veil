// Messung Phase 11 E1 (kein Produktcode): Anteil verdeckter Flaeche je Steigerungsstufe 0 bis 3, vorher (alte Regel: zusammenfuehren, Rand, keine
// Huelle) und nachher (berechneFlaechen mit Verschmelzen), aus den Rohtreffern einer Messdatei. Aufruf (Node mit Typ-Entfernung):
//   node --experimental-strip-types scripts/messung/phase11-e1-flaechen.mjs <roh-testbilder-firefox.json> [preset]
import { readFileSync } from 'node:fs';
import { STANDARD } from '../../src/einstellungen.ts';
import { wirksameZonen } from '../../src/steigerung.ts';
import { aktiveZonenBoxen, berechneFlaechen, fuehreZusammen, mitRand } from '../../src/erkenner/zonen.ts';

const datei = process.argv[2];
const preset = process.argv[3] ?? 'mosaik';
const roh = JSON.parse(readFileSync(datei, 'utf8')).jeBild;

function vereinigung(boxen, b, h) {
  const xs = [...new Set([0, b, ...boxen.flatMap((x) => [x[0], x[0] + x[2]])])].sort((p, q) => p - q);
  const ys = [...new Set([0, h, ...boxen.flatMap((x) => [x[1], x[1] + x[3]])])].sort((p, q) => p - q);
  let a = 0;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const mx = (xs[i] + xs[i + 1]) / 2, my = (ys[j] + ys[j + 1]) / 2;
    if (boxen.some((x) => mx > x[0] && mx < x[0] + x[2] && my > x[1] && my < x[1] + x[3])) a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  return a / (b * h);
}
const median = (l) => { const s = [...l].sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

const aus = {};
for (const stufe of [0, 1, 2, 3]) {
  const vor = [], nach = [];
  let gross60Vor = 0, gross60Nach = 0, mitFlaechen = 0, ohneSchnittVor = 0, zahlVor = [], zahlNach = [];
  let nachNurMehr = true;
  for (const [name, r] of Object.entries(roh)) {
    if (!r.ok) continue;
    const einst = { zonen: wirksameZonen({ zonen: STANDARD.zonen, preset }, stufe).zonen, rand: STANDARD.rand, preset };
    const alt = mitRand(fuehreZusammen(aktiveZonenBoxen(r.treffer, einst.zonen, r.breite, r.hoehe)), einst.rand, r.breite, r.hoehe).map((f) => f.box);
    const neu = berechneFlaechen(r.treffer, einst, r.breite, r.hoehe, true).map((f) => f.box);
    if (!alt.length) continue;
    mitFlaechen++;
    const a = vereinigung(alt, r.breite, r.hoehe);
    const n = vereinigung(neu, r.breite, r.hoehe);
    if (n + 1e-9 < a) nachNurMehr = false;
    vor.push(a); nach.push(n);
    zahlVor.push(alt.length); zahlNach.push(neu.length);
    if (alt.some((x) => x[2] * x[3] / (r.breite * r.hoehe) > 0.6)) gross60Vor++;
    if (neu.some((x) => x[2] * x[3] / (r.breite * r.hoehe) > 0.6)) gross60Nach++;
  }
  aus[stufe] = {
    bilderMitFlaechen: mitFlaechen,
    verdecktVor: { median: +median(vor).toFixed(4), max: +Math.max(...vor).toFixed(4) },
    verdecktNach: { median: +median(nach).toFixed(4), max: +Math.max(...nach).toFixed(4) },
    bilderHuelleUeber60Vor: gross60Vor, bilderHuelleUeber60Nach: gross60Nach,
    flaechenVorSumme: zahlVor.reduce((p, q) => p + q, 0), flaechenNachSumme: zahlNach.reduce((p, q) => p + q, 0),
    S1_nachMindestensSoVielWieVor: nachNurMehr,
  };
}
console.log(JSON.stringify({ preset, datei: datei.split('/').pop(), stufen: aus }, null, 1));
