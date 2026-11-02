// Wegwerf-Spike S0: Zonen-Vorschlag mit NudeNet 640m (ONNX) in Node.
// Kein Produktcode. Wendet das Modell auf alle Bilder von nsfw und sfw an und schreibt
// einen Vorschlag fuer die Soll-Zonen, den der Inhaber im Markierwerkzeug nur bestaetigt.
//
// Vor- und Nachverarbeitung nach dem NudeNet-Paket, das der alte Detektor benutzt:
//   Bild lesen (EXIF drehen), unten und rechts mit Schwarz auf ein Quadrat auffuellen
//   (NICHT mittig), bilinear auf 640x640 skalieren (wie cv2, ohne Glaettung), Farbreihenfolge RGB, Teilen durch 255, NCHW.
//   Ausgabe YOLOv8 [1, 4+18, 8400]: cx, cy, w, h, dann 18 Klassenwerte.
//   NMS klassenuebergreifend mit IoU 0.45. Boxen zurueck auf Originalpixel (Faktor max/640).
// Start: node spike/s0-zonen-vorschlag/vorschlag.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '../..');
const BILDER = path.resolve(REPO, '../05 Testbilder');
const MODELL = path.resolve(REPO, '../04 Alt-Code Referenz/modelle/640m.onnx');
const AUSGABE_VORSCHLAG = path.join(BILDER, 'soll-zonen-vorschlag.json');

const EINGABE = 640;
const SCHWELLE = Number.parseFloat(process.env.VEIL_SCHWELLE ?? '') || 0.2;
const NMS_IOU = 0.45;
const ANBIETER = process.env.VEIL_EP || 'cpu';

// Zonenliste und Satznamen exakt wie im Markierwerkzeug (scripts/annotate/server.mjs).
const SAETZE = ['nsfw', 'sfw'];
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Klassenreihenfolge des Modells (18 Klassen), wie im NudeNet-Paket.
const KLASSEN = [
  'FEMALE_GENITALIA_COVERED', 'FACE_FEMALE', 'BUTTOCKS_EXPOSED', 'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED', 'MALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEET_EXPOSED',
  'BELLY_COVERED', 'FEET_COVERED', 'ARMPITS_COVERED', 'ARMPITS_EXPOSED', 'FACE_MALE',
  'BELLY_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'ANUS_COVERED', 'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED',
];

// NUDENET_MAP aus engine/zones.py: Klasse -> [Zone, bedeckt, Geschlecht].
// Achseln (armpits) kommen aus ARMPITS_EXPOSED (sichtbar) und ARMPITS_COVERED (bedeckt).
// Die fruehere Zone "hands" ist entfallen (Entscheidung 48), sie hatte keine NudeNet-Klasse.
const ZUORDNUNG = {
  FEMALE_GENITALIA_EXPOSED: ['genitals', false, 'female'],
  FEMALE_GENITALIA_COVERED: ['genitals', true, 'female'],
  MALE_GENITALIA_EXPOSED: ['genitals', false, 'male'],
  MALE_GENITALIA_COVERED: ['genitals', true, 'male'],
  BUTTOCKS_EXPOSED: ['buttocks', false, null],
  BUTTOCKS_COVERED: ['buttocks', true, null],
  ANUS_EXPOSED: ['buttocks', false, null],
  ANUS_COVERED: ['buttocks', true, null],
  FEMALE_BREAST_EXPOSED: ['breast', false, 'female'],
  FEMALE_BREAST_COVERED: ['breast', true, 'female'],
  MALE_BREAST_EXPOSED: ['breast', false, 'male'],
  MALE_BREAST_COVERED: ['breast', true, 'male'],
  BELLY_EXPOSED: ['belly', false, null],
  BELLY_COVERED: ['belly', true, null],
  FEET_EXPOSED: ['feet', false, null],
  FEET_COVERED: ['feet', true, null],
  ARMPITS_EXPOSED: ['armpits', false, null],
  ARMPITS_COVERED: ['armpits', true, null],
  FACE_FEMALE: ['face', false, 'female'],
  FACE_MALE: ['face', false, 'male'],
};
// Aus einem erkannten Gesicht abgeleitete Zonen (beim alten Tool kommen sie aus YuNet).
const GESICHTS_ZONEN = ['face', 'head', 'eyes', 'mouth'];

// ---------- Bilderliste (wie leseSatz im Markierwerkzeug) ----------

function leseSatz(satz) {
  let eintraege;
  try {
    eintraege = fs.readdirSync(path.join(BILDER, satz), { withFileTypes: true });
  } catch {
    return [];
  }
  return eintraege
    .filter((e) => e.isFile() && !e.name.startsWith('.') && ENDUNGEN.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

// ---------- Vorverarbeitung ----------

/** Index und Gewicht je Zielpixel fuer bilineare Skalierung wie cv2.resize (INTER_LINEAR). */
function achsenTabelle(max, grenze) {
  const faktor = max / EINGABE;
  const i0 = new Int32Array(EINGABE);
  const i1 = new Int32Array(EINGABE);
  const f = new Float32Array(EINGABE);
  for (let d = 0; d < EINGABE; d++) {
    let s = (d + 0.5) * faktor - 0.5;
    if (s < 0) s = 0;
    let a = Math.floor(s);
    f[d] = s - a;
    // Ueber die Bildkante hinaus liegt das schwarze Auffuellen (Index -1 = Schwarz).
    i0[d] = a < grenze ? a : -1;
    i1[d] = a + 1 < grenze ? a + 1 : -1;
  }
  return { i0, i1, f };
}

/** Liest ein Bild, dreht es nach EXIF und liefert den fertigen Eingabetensor. */
async function bereiteVor(datei) {
  const { data, info } = await sharp(datei)
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const B = info.width;
  const H = info.height;
  const kan = info.channels;
  if (kan !== 3) throw new Error(`Unerwartete Kanalzahl: ${kan}`);
  const max = Math.max(B, H);
  // Quadratisch unten/rechts mit Schwarz auffuellen und auf 640 skalieren, ohne das
  // Quadrat wirklich anzulegen: die Gewichte greifen bei Index -1 auf Schwarz zu.
  const xs = achsenTabelle(max, B);
  const ys = achsenTabelle(max, H);
  const flaeche = EINGABE * EINGABE;
  const tensor = new Float32Array(3 * flaeche);
  const px = (zeile, x, c) => (x < 0 ? 0 : data[(zeile * B + x) * 3 + c]);
  for (let dy = 0; dy < EINGABE; dy++) {
    const y0 = ys.i0[dy];
    const y1 = ys.i1[dy];
    const fy = ys.f[dy];
    for (let dx = 0; dx < EINGABE; dx++) {
      const x0 = xs.i0[dx];
      const x1 = xs.i1[dx];
      const fx = xs.f[dx];
      for (let c = 0; c < 3; c++) {
        const oben = y0 < 0 ? 0 : px(y0, x0, c) * (1 - fx) + px(y0, x1, c) * fx;
        const unten = y1 < 0 ? 0 : px(y1, x0, c) * (1 - fx) + px(y1, x1, c) * fx;
        // Kanalreihenfolge RGB wie im Original (sharp liefert RGB), Teilen durch 255.
        tensor[c * flaeche + dy * EINGABE + dx] = (oben * (1 - fy) + unten * fy) / 255;
      }
    }
  }
  return { tensor, B, H, max };
}

// ---------- Nachverarbeitung ----------

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const schnitt = (x2 - x1) * (y2 - y1);
  return schnitt / (a[2] * a[3] + b[2] * b[3] - schnitt);
}

/** Greedy-NMS ueber alle Klassen, absteigend nach Score (wie cv2.dnn.NMSBoxes). */
function nms(kandidaten) {
  const sortiert = [...kandidaten].sort((p, q) => q.score - p.score);
  const behalten = [];
  for (const k of sortiert) {
    if (behalten.every((b) => iou(k.rohBox, b.rohBox) <= NMS_IOU)) behalten.push(k);
  }
  return behalten;
}

/** Zerlegt die Ausgabe [1, 4+K, N] in Treffer mit Box in Originalpixeln. */
function nachverarbeite(ausgabe, B, H, max) {
  const [, kanaele, n] = ausgabe.dims;
  const daten = ausgabe.data;
  const klassenAnzahl = kanaele - 4;
  if (klassenAnzahl !== KLASSEN.length) throw new Error(`Unerwartete Klassenzahl: ${klassenAnzahl}`);
  const faktor = max / EINGABE;
  const kandidaten = [];
  for (let i = 0; i < n; i++) {
    let beste = -1;
    let bestScore = -Infinity;
    for (let c = 0; c < klassenAnzahl; c++) {
      const s = daten[(4 + c) * n + i];
      if (s > bestScore) {
        bestScore = s;
        beste = c;
      }
    }
    if (bestScore < SCHWELLE) continue;
    const cw = daten[2 * n + i];
    const ch = daten[3 * n + i];
    let x = (daten[i] - cw / 2) * faktor;
    let y = (daten[n + i] - ch / 2) * faktor;
    let w = cw * faktor;
    let h = ch * faktor;
    x = Math.max(0, Math.min(x, B));
    y = Math.max(0, Math.min(y, H));
    w = Math.min(w, B - x);
    h = Math.min(h, H - y);
    kandidaten.push({ klasse: KLASSEN[beste], score: bestScore, rohBox: [x, y, w, h] });
  }
  return nms(kandidaten).map((k) => ({
    klasse: k.klasse,
    score: Math.round(k.score * 10000) / 10000,
    box: k.rohBox.map((v) => Math.trunc(v)),
  }));
}

// ---------- Zonenvorschlag ----------

function baueEintrag(treffer) {
  const sichtbar = new Set();
  const bedeckt = new Set();
  const ohneZone = [];
  let gesicht = false;
  for (const t of treffer) {
    const z = ZUORDNUNG[t.klasse];
    if (!z) continue;
    const [zone, istBedeckt] = z;
    if (!ZONEN.includes(zone)) {
      if (!ohneZone.includes(t.klasse)) ohneZone.push(t.klasse);
      continue;
    }
    if (zone === 'face') gesicht = true;
    (istBedeckt ? bedeckt : sichtbar).add(zone);
  }
  // Gesicht erkannt: face, head, eyes, mouth als sichtbar vorschlagen (abgeleitet).
  if (gesicht) for (const z of GESICHTS_ZONEN) sichtbar.add(z);
  // Eine Zone steht nie in beiden Listen: sichtbar gewinnt.
  for (const z of sichtbar) bedeckt.delete(z);
  const geordnet = (menge) => ZONEN.filter((z) => menge.has(z));
  const maxScore = treffer.reduce((m, t) => Math.max(m, t.score), 0);
  const keinTreffer = treffer.length === 0;
  let notiz = `Vorschlag Modell 640m, Schwelle ${SCHWELLE.toFixed(2)}`;
  // Das Modell kennt keine Personenklasse: ohne Treffer ist "kein Mensch" nicht ableitbar.
  notiz += keinTreffer ? '; keine Treffer, bitte pruefen' : `; max score ${maxScore.toFixed(2)}`;
  if (gesicht) notiz += '; abgeleitet aus Gesichtsklasse: face, head, eyes, mouth';
  if (ohneZone.length) notiz += `; ohne Werkzeugzone: ${ohneZone.join(', ')}`;
  return {
    sichtbar: geordnet(sichtbar),
    bedeckt: geordnet(bedeckt),
    kein_mensch: false,
    notiz: notiz.slice(0, 500),
    geprueft: '',
  };
}

// ---------- Statistik ----------

function perzentil(werte, p) {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}
const runde = (v) => Math.round(v * 10) / 10;

// ---------- Hauptablauf ----------

async function main() {
  if (!fs.existsSync(MODELL)) throw new Error('Modelldatei 640m.onnx nicht gefunden (04 Alt-Code Referenz/modelle)');
  const sitzung = await ort.InferenceSession.create(MODELL, { executionProviders: [ANBIETER] });
  const eingabeName = sitzung.inputNames[0];
  const ausgabeName = sitzung.outputNames[0];

  // Aufwaermlauf, zaehlt nicht in die Zeiten.
  await sitzung.run({ [eingabeName]: new ort.Tensor('float32', new Float32Array(3 * EINGABE * EINGABE), [1, 3, EINGABE, EINGABE]) });

  const vorschlag = { version: 1, zonen: [...ZONEN], bilder: {} };
  const ergebnis = {
    erzeugt: new Date().toISOString(),
    modell: '640m',
    schwelle: SCHWELLE,
    nms_iou: NMS_IOU,
    anbieter: ANBIETER,
    skalierung: 'bilinear wie cv2 INTER_LINEAR',
    eingabe: eingabeName,
    bilder: {},
  };
  const zeitenGesamt = [];
  const zeitenInfer = [];
  const zonenSichtbar = {};
  const zonenBedeckt = {};
  const anzahl = {};
  const ohneTreffer = [];
  const fehler = [];

  for (const satz of SAETZE) {
    const liste = leseSatz(satz);
    anzahl[satz] = liste.length;
    for (const name of liste) {
      const schluessel = `${satz}/${name}`;
      const voll = path.join(BILDER, satz, name);
      try {
        const t0 = performance.now();
        const { tensor, B, H, max } = await bereiteVor(voll);
        const t1 = performance.now();
        const aus = await sitzung.run({ [eingabeName]: new ort.Tensor('float32', tensor, [1, 3, EINGABE, EINGABE]) });
        const t2 = performance.now();
        const treffer = nachverarbeite(aus[ausgabeName], B, H, max);
        const t3 = performance.now();
        const eintrag = baueEintrag(treffer);
        vorschlag.bilder[schluessel] = eintrag;
        ergebnis.bilder[schluessel] = {
          breite: B,
          hoehe: H,
          treffer,
          vorschlag: { sichtbar: eintrag.sichtbar, bedeckt: eintrag.bedeckt, kein_mensch: eintrag.kein_mensch },
          abgeleitet: treffer.some((t) => t.klasse.startsWith('FACE_')) ? GESICHTS_ZONEN : [],
          ms: { vorverarbeitung: runde(t1 - t0), inferenz: runde(t2 - t1), nachverarbeitung: runde(t3 - t2), gesamt: runde(t3 - t0) },
        };
        zeitenGesamt.push(t3 - t0);
        zeitenInfer.push(t2 - t1);
        for (const z of eintrag.sichtbar) zonenSichtbar[z] = (zonenSichtbar[z] ?? 0) + 1;
        for (const z of eintrag.bedeckt) zonenBedeckt[z] = (zonenBedeckt[z] ?? 0) + 1;
        if (treffer.length === 0) ohneTreffer.push(schluessel);
      } catch (e) {
        fehler.push(`${schluessel}: ${e.message}`);
        ergebnis.bilder[schluessel] = { fehler: e.message };
      }
    }
  }

  // Schluessel sortiert schreiben, atomar (erst Temp-Datei, dann umbenennen).
  const sortiert = { version: 1, zonen: vorschlag.zonen, bilder: {} };
  for (const k of Object.keys(vorschlag.bilder).sort()) sortiert.bilder[k] = vorschlag.bilder[k];
  const tmp = `${AUSGABE_VORSCHLAG}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(sortiert, null, 2) + '\n');
  fs.renameSync(tmp, AUSGABE_VORSCHLAG);

  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const ergebnisDatei = path.join(HIER, `ergebnis-node-${stempel}.json`);
  ergebnis.zusammenfassung = {
    anzahl,
    ms_gesamt: { median: runde(perzentil(zeitenGesamt, 50)), p90: runde(perzentil(zeitenGesamt, 90)) },
    ms_inferenz: { median: runde(perzentil(zeitenInfer, 50)), p90: runde(perzentil(zeitenInfer, 90)) },
    zonen_sichtbar: zonenSichtbar,
    zonen_bedeckt: zonenBedeckt,
    ohne_treffer: ohneTreffer,
    fehler,
  };
  fs.writeFileSync(ergebnisDatei, JSON.stringify(ergebnis, null, 2) + '\n');

  const z = ergebnis.zusammenfassung;
  const zeile = (o) => ZONEN.map((n) => `${n} ${o[n] ?? 0}`).join(', ');
  console.log(`Bilder: ${SAETZE.map((s) => `${s} ${anzahl[s]}`).join(', ')}`);
  console.log(`ms je Bild gesamt: Median ${z.ms_gesamt.median}, p90 ${z.ms_gesamt.p90}`);
  console.log(`ms je Bild nur Inferenz: Median ${z.ms_inferenz.median}, p90 ${z.ms_inferenz.p90}`);
  console.log(`Zonen sichtbar: ${zeile(zonenSichtbar)}`);
  console.log(`Zonen bedeckt:  ${zeile(zonenBedeckt)}`);
  console.log(`Ohne Treffer (${ohneTreffer.length}): ${ohneTreffer.join(', ') || 'keine'}`);
  console.log(`Fehler (${fehler.length}): ${fehler.join(' | ') || 'keine'}`);
  console.log(`Geschrieben: ${path.relative(REPO, ergebnisDatei)} und ${path.relative(path.dirname(REPO), AUSGABE_VORSCHLAG)}`);
}

main().catch((e) => {
  console.error('Abbruch:', e.message);
  process.exit(1);
});
