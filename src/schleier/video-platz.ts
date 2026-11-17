// Platzregel der Zonen-Leinwand (Etappe 3, E3a): wer von mehreren Videos im Dokument die eine Leinwand bekommt. Reine Logik ohne Browser und ohne Zeitquelle,
// der Verwalter (video-zonen-verwalter.ts) fragt sie und setzt die Entscheidung um (Verlierer zuerst ganz verdecken, dann erst die Leinwand weg, Gewinner bleibt
// weichgezeichnet, bis seine eigene Leinwand ihr erstes Bild gemalt hat).
//
// Regel (PHASE-11-AUFTRAEGE-SESSION-21.md, Platzregel der Leitung 1 bis 5 mit P10 und P11, Entscheidung 265):
//   1 Der Halter behaelt den Platz, solange er berechtigt ist, egal was die anderen sind und wie lange er schon haelt (kein Wechsel nach Zeit).
//   2 Ist der Halter nicht mehr berechtigt und ein anderes Video ist berechtigt und hat eine Antwort mit Flaechen, wechselt der Platz zum ersten solchen
//     Video (Reihenfolge der ersten Antwort). Mindestabstand PLATZ_WECHSEL_MIN_MS zum letzten Wechsel, aber nur, wenn es einen Verlierer gibt, der noch
//     verdeckt werden muss (steht der Halter noch in der Liste); vorher "wartet", der Gewinner bleibt ganz verdeckt.
//   3 Will kein anderes Video den Platz, behaelt ihn der Halter (Zonen auf dem Standbild bleiben); ein entfernter Halter gibt ihn ab.
//   4 Ohne Halter geht ein berechtigtes Video mit Flaechen vor, sonst nimmt das erste Video mit Flaechen den Platz, auch pausiert. Ohne Wartezeit.
// Sicherheit: die Funktion entscheidet nur, wer die Leinwand bekommt. Sie macht nie ein Video frei; jedes Video ohne Leinwand ist ganz verdeckt.

// P10: Mindestabstand zwischen zwei Platzwechseln im Dokument (Millisekunden). Dazu gelten die Dokument-Bremse und die Video-Bremse des Verwalters.
export const PLATZ_WECHSEL_MIN_MS = 500;

export interface PlatzVideo {
  id: string;
  // geeignet (alle Punkte der Eignung ausser "ein anderes Video hat den Platz"), spielt (nicht pausiert, nicht zu Ende, Bilddaten da), sichtbar (P12)
  berechtigt: boolean;
  // Es gibt eine Antwort des Erkenners mit Flaechen, mit der die Leinwand beginnen kann.
  hatFlaechen: boolean;
}

export interface PlatzEingabe {
  // Kennung des Videos mit der Leinwand, null = niemand. Fehlt der Halter in `videos`, gilt er als entfernt (P11).
  halter: string | null;
  // Alle dem Verwalter bekannten Videos in der Reihenfolge ihrer ersten Antwort (aelteste zuerst).
  videos: readonly PlatzVideo[];
  // Zeit seit dem letzten Platzwechsel im Dokument (Millisekunden).
  seitWechselMs: number;
}

export type PlatzEntscheidung =
  | { art: 'bleibt' } // Halter (oder keiner) behaelt, was er hat
  | { art: 'wechselt'; zu: string } // der Platz geht jetzt an `zu`
  | { art: 'wartet'; zu: string } // Wechsel waere faellig, die Bremse haelt ihn zurueck: der Gewinner bleibt ganz verdeckt
  | { art: 'gibtAb' }; // der Halter ist weg (entfernt) und niemand nimmt den Platz

export function entscheidePlatz(e: PlatzEingabe): PlatzEntscheidung {
  const halter = e.halter === null ? undefined : e.videos.find((v) => v.id === e.halter);
  if (e.halter === null) {
    // Regel 4: ohne Halter ein berechtigtes Video mit Flaechen, sonst das erste Video mit Flaechen (auch pausiert).
    const wahl = e.videos.find((v) => v.berechtigt && v.hatFlaechen) ?? e.videos.find((v) => v.hatFlaechen);
    return wahl ? { art: 'wechselt', zu: wahl.id } : { art: 'bleibt' };
  }
  // Regel 1: der berechtigte Halter bleibt.
  if (halter?.berechtigt) return { art: 'bleibt' };
  // Regel 2: erster Kandidat (berechtigt und mit Flaechen), nie der Halter selbst.
  const kandidat = e.videos.find((v) => v.id !== e.halter && v.berechtigt && v.hatFlaechen);
  if (!kandidat) return halter ? { art: 'bleibt' } : { art: 'gibtAb' }; // Regel 3, P11
  if (!halter) return { art: 'wechselt', zu: kandidat.id }; // P11: kein Verlierer zu verdecken, sofort
  return e.seitWechselMs >= PLATZ_WECHSEL_MIN_MS ? { art: 'wechselt', zu: kandidat.id } : { art: 'wartet', zu: kandidat.id };
}

// ---------- P12: "sichtbar" fuer die Berechtigung ----------
// Anteil der Videoflaeche im Ausschnitt; sichtbar ab einem Viertel, verloren erst unter einem Zehntel (Zittern an der Sichtgrenze wechselt nicht).
export const SICHT_AB = 0.25;
export const SICHT_BIS = 0.1;

export interface SichtRechteck {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Anteil der Videoflaeche (0 bis 1), der im Ausschnitt [0, fensterB] mal [0, fensterH] liegt. Kein Mass (Breite oder Hoehe nicht > 0, NaN): 0 (unsichtbar).
export function sichtAnteil(r: SichtRechteck, fensterB: number, fensterH: number): number {
  const b = r.right - r.left;
  const h = r.bottom - r.top;
  if (!(b > 0 && h > 0 && fensterB > 0 && fensterH > 0)) return 0;
  const sb = Math.min(r.right, fensterB) - Math.max(r.left, 0);
  const sh = Math.min(r.bottom, fensterH) - Math.max(r.top, 0);
  if (!(sb > 0 && sh > 0)) return 0;
  return Math.min(1, (sb * sh) / (b * h));
}

// Zwei Schwellen: wer sichtbar war, bleibt es bis der Anteil unter SICHT_BIS fiel; wer es nicht war, wird es ab SICHT_AB.
export function sichtbarMitHysterese(anteil: number, warSichtbar: boolean): boolean {
  if (!(anteil >= 0)) return false;
  return warSichtbar ? anteil >= SICHT_BIS : anteil >= SICHT_AB;
}

// ---------- R6 und R8: Frische der Antwort, Abstand der Runden ----------
// Die Leinwand beginnt nur mit einer Antwort, die hoechstens so alt ist (Millisekunden seit der Aufnahme des Bildes). Eine alte Antwort startet keine Leinwand.
export const PLATZ_ANTWORT_MAX_MS = 400;
// Scrollen und Groesse stossen hoechstens so oft eine Runde der Platzregel an.
export const PLATZ_RUNDE_MIN_MS = 250;

export function antwortFrisch(alterMs: number): boolean {
  return alterMs >= 0 && alterMs <= PLATZ_ANTWORT_MAX_MS;
}
