// Stufenlisten der vier Regler (Phase 11 E4c0, Regel B5) als Daten. Die Werte liegen innerhalb der heutigen Grenzen aus src/einstellungen.ts
// und der heutige Standard ist jeweils eine Stufe. Die Namen sind Platzhalter aus dem Entwurf: die Texterin entscheidet in Schritt (e),
// die Oberflaeche bekommt ihre Namen als Eingabe und darf eine Kopie der Liste mit anderen Namen uebergeben.
import { FREILEGEN_MAX_MS, FREILEGEN_MIN_MS, SCHWELLE_MAX, SCHWELLE_MIN, STANDARD, TON_LAUTSTAERKE_STANDARD, VERWEIGERN_MAX, VERWEIGERN_MIN } from '../../einstellungen.ts';
import type { StufenListe } from './stufen.ts';

export const STUFENLISTEN = {
  // Stimmung (`schwelle`, Hundertstel)
  stimmung: {
    einheit: 0.01,
    min: SCHWELLE_MIN,
    max: SCHWELLE_MAX,
    schritt: 0.01,
    standard: STANDARD.schwelle,
    stufen: [
      { name: 'Careful', wert: 0.1 },
      { name: 'Normal', wert: 0.15 },
      { name: 'Relaxed', wert: 0.22 },
    ],
  },
  // Verweigern (`quiz.verweigern`, Hundertstel)
  verweigern: {
    einheit: 0.01,
    min: VERWEIGERN_MIN,
    max: VERWEIGERN_MAX,
    schritt: 0.01,
    standard: STANDARD.quiz.verweigern,
    stufen: [
      { name: 'Never', wert: 0 },
      { name: 'Sometimes', wert: 0.1 },
      { name: 'Often', wert: 0.25 },
    ],
  },
  // Freilegen (`quiz.freilegenMs`, gespeichert in Millisekunden, verglichen in ganzen Sekunden)
  freilegen: {
    einheit: 1000,
    min: FREILEGEN_MIN_MS,
    max: FREILEGEN_MAX_MS,
    schritt: 1000,
    standard: STANDARD.quiz.freilegenMs,
    stufen: [
      { name: 'Short', wert: 5000 },
      { name: 'Medium', wert: 10000 },
      { name: 'Long', wert: 20000 },
    ],
  },
  // Lautstaerke (`ton.lautstaerke`, Hundertstel)
  lautstaerke: {
    einheit: 0.01,
    min: 0,
    max: 1,
    schritt: 0.01,
    standard: TON_LAUTSTAERKE_STANDARD,
    stufen: [
      { name: 'Soft', wert: 0.3 },
      { name: 'Medium', wert: 0.6 },
      { name: 'Loud', wert: 0.9 },
    ],
  },
} as const satisfies Record<string, StufenListe>;

export type StufenSchluessel = keyof typeof STUFENLISTEN;
