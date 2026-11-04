// Zustand der Seite fuer die spaeteren Auftraege (P Player, F Freilegen, T Titel): steht die Seite auf der Liste (oder bei den eigenen Seiten
// des Nutzers), und wurde sie am Inhalt als erwachsen erkannt? Der Schleier (src/schleier/vorschau.ts) schreibt, alle anderen lesen.
// `liste`: Adapter-Name der Seite oder null. `amInhalt`: am Inhalt erkannt, gilt nur fuer Quiz und Freilegen (kein Vorschau-Tausch, keine
// Umleitung). Nur die eigene Seite dieses Content-Scripts (jeder Frame hat seinen Stand).

import type { SeitenName } from './liste';

export interface ErwachsenStatus {
  liste: SeitenName | null;
  amInhalt: boolean;
}

let stand: ErwachsenStatus = { liste: null, amInhalt: false };
const hoerer = new Set<(s: ErwachsenStatus) => void>();

export function erwachsenStatus(): ErwachsenStatus {
  return { ...stand };
}

// Ist die Seite fuer Quiz und Freilegen eine Erwachsenenseite (Liste oder am Inhalt erkannt)?
export function istErwachsenFuerQuiz(): boolean {
  return stand.liste !== null || stand.amInhalt;
}

// Meldet jede Aenderung des Standes (Seitenwechsel ohne Neuladen, Erkennung am Inhalt, geaenderte Einstellungen).
export function beiErwachsenStatus(rueckruf: (s: ErwachsenStatus) => void): () => void {
  hoerer.add(rueckruf);
  return () => hoerer.delete(rueckruf);
}

// Nur der Schleier ruft das auf.
export function setzeErwachsenStatus(neu: ErwachsenStatus): void {
  if (neu.liste === stand.liste && neu.amInhalt === stand.amInhalt) return;
  stand = { ...neu };
  for (const h of [...hoerer]) {
    try {
      h(erwachsenStatus());
    } catch {
      // ein fehlerhafter Hoerer stoert die anderen nicht
    }
  }
}
