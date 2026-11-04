// Zustand je beobachtetem Element (WeakMap, damit entfernte Elemente freigegeben werden koennen).

import type { Art, Urteil } from './konstanten';
import type { VideoLauf } from './video';

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

// Eigene Inline-Stile, die der Vorschau-Tausch (vorschau.ts) gesetzt hat, mit den Werten davor (Pause stellt sie zurueck).
export interface ErsetztInfo {
  // Schluessel der Wahl (Video-Kennung oder Quelle), unter dem das Pack-Bild eingesetzt wurde: bleibt er nach einer Quellaenderung gleich, wird sofort neu eingesetzt.
  schluessel?: string;
  stile: Array<{ name: string; wert: string; prio: string }>;
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
  // Vorrang in der Warteschlange (vorrang.ts): `klein` (laengste dargestellte Seite unter VORRANG_KLEIN_PX) wird beim Einreihen gemessen
  // und von den Beobachtern nachgefuehrt; `nah` (im Bereich zwei Bildschirmhoehen um den Sichtbereich) kommt vom zweiten
  // IntersectionObserver (`nahMeldung`: hat schon einmal gemeldet), davor aus der Messung beim Einreihen.
  klein: boolean;
  nah: boolean;
  nahMeldung: boolean;
  // Video: das Urteil beruht auf einer echten Pruefung (nicht vorlaeufig, nicht "nicht lesbar"): nur dann laeuft die Nachpruefung.
  videoEcht: boolean;
  // Video: Zaehler der Spruenge (seeking, seeked), auch vor dem ersten Urteil. Eine Pruefung, die ueber einen Sprung hinweg lief, zeigt ein
  // altes Bild. `schleife`: der letzte Sprung war der Umlauf bei loop und zaehlt nicht.
  sprung: number;
  schleife: boolean;
  // Video: laufende Nachpruefung (Takt, Hysterese), null = keine.
  video: VideoLauf | null;
  timer: ReturnType<typeof setTimeout> | null;
  // Vorschau-Tausch (Auftrag E): das Element zeigt ein Pack-Bild statt der Seite (wird nicht geprueft). null = nicht ersetzt.
  ersetzt: ErsetztInfo | null;
  // Erkennen am Inhalt: Ergebnis der letzten echten Pruefung dieses Elements ('treffer' = unbedeckte Brust, Genitalien oder Po erkannt), null = keine Wertung.
  inhalt: 'frei' | 'treffer' | null;
  // Der Tausch ist fuer dieses Element gescheitert (kein Bild, Seiten-CSP): es geht den normalen Weg, bis die Seite die Quelle aendert.
  ohneVorschau: boolean;
  // Freilegen (Auftrag F, Session 8): das Original ist nach geloestem Quiz bis `bisMs` (performance.now()) sichtbar; der Beobachter prueft
  // waehrenddessen nicht, danach wird wieder zensiert. null = nicht freigelegt.
  freigelegt: { bisMs: number } | null;
  // Bild: Adresse des Originals bei der Pruefung (bleibt, wenn das Urteil die Quelle gegen die zensierte Fassung tauscht). Das Freilegen vergleicht damit.
  pruefAdresse: string | null;
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
    klein: false,
    nah: false,
    nahMeldung: false,
    videoEcht: false,
    sprung: 0,
    schleife: false,
    video: null,
    timer: null,
    ersetzt: null,
    inhalt: null,
    ohneVorschau: false,
    freigelegt: null,
    pruefAdresse: null,
  };
}
