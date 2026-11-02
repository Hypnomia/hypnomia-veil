// Modell 320n: Klassenliste, Zuordnung Klasse zu Zone und Nachverarbeitung der Modellausgabe (YOLOv8-Form).
// Eingabe [1, 3, 320, 320] float32 RGB 0 bis 1, Ausgabe [1, 4 + 18, N]: Mittelpunkt, Breite, Hoehe, dann 18 Klassenwerte.

import type { Zone } from '../einstellungen';
import type { Box, Treffer } from '../nachrichten';

export const MODELL_GROESSE = 320;
// Ueberlappung, ab der zwei Treffer als Doppelung gelten (NMS ueber alle Klassen).
export const NMS_IOU = 0.45;

// Reihenfolge wie im Modell (Entscheidung 54).
export const KLASSEN = [
  'FEMALE_GENITALIA_COVERED', 'FACE_FEMALE', 'BUTTOCKS_EXPOSED', 'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED', 'MALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEET_EXPOSED',
  'BELLY_COVERED', 'FEET_COVERED', 'ARMPITS_COVERED', 'ARMPITS_EXPOSED', 'FACE_MALE',
  'BELLY_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'ANUS_COVERED', 'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED',
] as const;

// Klasse -> [Zone, bedeckt]
export const ZUORDNUNG: Readonly<Record<string, readonly [Zone, boolean]>> = {
  FEMALE_GENITALIA_EXPOSED: ['genitals', false], FEMALE_GENITALIA_COVERED: ['genitals', true],
  MALE_GENITALIA_EXPOSED: ['genitals', false],
  BUTTOCKS_EXPOSED: ['buttocks', false], BUTTOCKS_COVERED: ['buttocks', true],
  ANUS_EXPOSED: ['buttocks', false], ANUS_COVERED: ['buttocks', true],
  FEMALE_BREAST_EXPOSED: ['breast', false], FEMALE_BREAST_COVERED: ['breast', true],
  MALE_BREAST_EXPOSED: ['breast', false],
  BELLY_EXPOSED: ['belly', false], BELLY_COVERED: ['belly', true],
  FEET_EXPOSED: ['feet', false], FEET_COVERED: ['feet', true],
  ARMPITS_EXPOSED: ['armpits', false], ARMPITS_COVERED: ['armpits', true],
  FACE_FEMALE: ['face', false], FACE_MALE: ['face', false],
};

// Abbildung der Originalgroesse auf das 320er Feld (Seitenverhaeltnis bleibt, Auffuellen rechts und unten).
export interface Geometrie {
  skala: number;
  breite: number;
  hoehe: number;
}

export function geometrieFuer(breite: number, hoehe: number): Geometrie {
  return { skala: MODELL_GROESSE / Math.max(breite, hoehe), breite, hoehe };
}

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const schnitt = (x2 - x1) * (y2 - y1);
  return schnitt / (a[2] * a[3] + b[2] * b[3] - schnitt);
}

interface Kandidat {
  klasse: number;
  score: number;
  box: Box;
}

// Rohausgabe -> Treffer ueber der Schwelle in Bildkoordinaten (ganze Pixel), nach NMS, hoechster Wert zuerst.
export function nachverarbeite(daten: Float32Array, dims: readonly number[], geo: Geometrie, schwelle: number): Treffer[] {
  const kanaele = dims[1] ?? 0;
  const n = dims[2] ?? 0;
  const klassenAnzahl = kanaele - 4;
  const kandidaten: Kandidat[] = [];
  for (let i = 0; i < n; i++) {
    let beste = -1;
    let best = -Infinity;
    for (let c = 0; c < klassenAnzahl; c++) {
      const s = daten[(4 + c) * n + i] ?? 0;
      if (s > best) {
        best = s;
        beste = c;
      }
    }
    if (best < schwelle) continue;
    const mx = daten[i] ?? 0;
    const my = daten[n + i] ?? 0;
    const cw = daten[2 * n + i] ?? 0;
    const ch = daten[3 * n + i] ?? 0;
    // Mit Ecken rechnen und beidseitig begrenzen: Teile im schwarzen Auffuellrand kuerzen die Box, statt sie zu verschieben.
    const x1 = Math.max(0, (mx - cw / 2) / geo.skala);
    const y1 = Math.max(0, (my - ch / 2) / geo.skala);
    const x2 = Math.min(geo.breite, (mx + cw / 2) / geo.skala);
    const y2 = Math.min(geo.hoehe, (my + ch / 2) / geo.skala);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 1 || h < 1) continue;
    kandidaten.push({ klasse: beste, score: best, box: [x1, y1, w, h] });
  }
  kandidaten.sort((p, q) => q.score - p.score);
  const behalten: Kandidat[] = [];
  for (const k of kandidaten) {
    if (behalten.every((b) => iou(k.box, b.box) <= NMS_IOU)) behalten.push(k);
  }
  const treffer: Treffer[] = [];
  for (const k of behalten) {
    const name = KLASSEN[k.klasse];
    const zuordnung = name ? ZUORDNUNG[name] : undefined;
    if (!zuordnung) continue;
    treffer.push({
      zone: zuordnung[0],
      bedeckt: zuordnung[1],
      score: Math.round(k.score * 1000) / 1000,
      box: [Math.trunc(k.box[0]), Math.trunc(k.box[1]), Math.max(1, Math.trunc(k.box[2])), Math.max(1, Math.trunc(k.box[3]))],
    });
  }
  return treffer;
}
