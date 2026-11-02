// Zustand je beobachtetem Element (WeakMap, damit entfernte Elemente freigegeben werden koennen).

import type { Art, Urteil } from './konstanten';

export interface QuellenOriginal {
  el: Element;
  srcset: string | null;
  src: string | null;
  sizes: string | null;
}

// Alles, was beim Tauschen eines img verloren ginge (Pause stellt es wieder her).
export interface BildOriginal {
  src: string | null;
  srcset: string | null;
  sizes: string | null;
  loading: string | null;
  quellen: QuellenOriginal[];
}

// Inline-background-image vor dem Tausch (Wert und Prioritaet), null = war nicht gesetzt.
export interface HintergrundOriginal {
  wert: string;
  prio: string;
  // Ganzer style-Attributtext, wenn der Wert nur ueber var() zustande kam (die Langform liest dann leer): der Tausch ueberschreibt
  // die Langform, removeProperty allein stellte den Ursprung nicht wieder her. null = nicht noetig.
  stil: string | null;
}

export interface Zustand {
  art: Art;
  // Wird bei jedem Zuruecksetzen erhoeht: Antworten zu einer aelteren Generation werden verworfen (Rennen bei schnell wechselnder src).
  generation: number;
  // Signatur der Quelle (src, srcset, Hintergrundwert), auf der das Urteil beruht.
  signatur: string | null;
  // currentSrc zum Zeitpunkt des Urteils (erkennt Quellenwechsel ohne Attributaenderung, z. B. per Medienabfrage).
  adresse: string | null;
  // Millisekunden seit Start des Content-Scripts, als das Urteil fiel.
  urteilMs: number | null;
  urteil: Urteil | null;
  // In der Warteschlange oder unterwegs.
  eingereiht: boolean;
  // Wartet nach einer Attributaenderung auf das naechste load/error-Ereignis.
  erwarteLoad: boolean;
  versuche: number;
  sichtbarBeiStart: boolean;
  sichtbar: boolean;
  // Eigene Data-URL (zensiertes Bild bzw. eigener Hintergrundwert): wird nie erneut geprueft.
  eigen: string | null;
  // Tausch laeuft: das zensierte Bild wird geladen, das Element bleibt bis dahin verdeckt.
  tauschLaeuft: boolean;
  bildOriginal: BildOriginal | null;
  hgOriginal: HintergrundOriginal | null;
  // Das Bild hat ein error-Ereignis gemeldet (kaputtes Bild: freigeben). Ohne Ereignis gilt "fertig, aber ohne Groesse" als Bild ohne Eigengroesse (SVG).
  fehlerGesehen: boolean;
  // Video ohne Daten (preload none oder metadata) wurde nach load vorlaeufig unscharf gezeigt: beim ersten loadeddata wird neu geprueft.
  vorlaeufig: boolean;
  // Der IntersectionObserver hat schon einmal gemeldet (dann gilt `sichtbar`, vorher die Messung beim Einreihen).
  sichtMeldung: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function neuerZustand(art: Art): Zustand {
  return {
    art,
    generation: 0,
    signatur: null,
    adresse: null,
    urteilMs: null,
    urteil: null,
    eingereiht: false,
    erwarteLoad: false,
    versuche: 0,
    sichtbarBeiStart: false,
    sichtbar: false,
    eigen: null,
    tauschLaeuft: false,
    bildOriginal: null,
    hgOriginal: null,
    fehlerGesehen: false,
    vorlaeufig: false,
    sichtMeldung: false,
    timer: null,
  };
}
