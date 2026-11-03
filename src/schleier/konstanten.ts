// Gemeinsame Konstanten und Typen des Schleiers (PHASE-2-BAUPLAN Abschnitt 5).

// Bauzeit-Schalter fuer die Testhaken (data-veil-status, data-veil-ms, veil-test, data-hypnomia-veil): nur gesetzt, wenn der Build mit
// WXT_TESTHAKEN=1 lief (npm test, npm run build:test). Ohne Schalter faellt der Test-Code beim Bauen weg, Release-Bauten enthalten ihn nicht.
export const TESTHAKEN: boolean = import.meta.env.WXT_TESTHAKEN === '1';

export const ATTR_URTEIL = 'data-veil';
// Verdeckt ohne Blur: nur der Hintergrund wurde entfernt (Klassen-Hintergrund, grosse Inline-Hintergruende), Element und Text bleiben lesbar.
export const ATTR_NUR_HG = 'data-veil-hg';
export const ATTR_SEITE = 'data-veil-seite';
export const ATTR_STRICT = 'data-veil-strict';
// Die Namen der Testhaken stehen nur im Testbau im Bundle (der Ausdruck faellt ohne Schalter zu einer leeren Zeichenkette zusammen).
export const ATTR_MS = TESTHAKEN ? 'data-veil-ms' : '';
export const ATTR_STATUS = TESTHAKEN ? 'data-veil-status' : '';

// Inline-Hintergrund (auch Kurzform `background: url(...)`): dieselbe Auswahl steht in entrypoints/content/style.css.
// Die Gross-/Kleinschreibung im Attributwert ist egal (`i`). Den Wert liest der Schleier ueber die Langform background-image des Style-Objekts.
export const HG_SELEKTOR = '[style*="background" i][style*="url(" i]';

export type Urteil = 'frei' | 'zensiert' | 'verdeckt';
// bild: img; video; canvas; hintergrund: Inline-background-image (hide-first per CSS); klasse: Hintergrund aus einem Stylesheet (nach load).
export type Art = 'bild' | 'video' | 'canvas' | 'hintergrund' | 'klasse';

export const MIN_KANTE = 32; // Elemente unter 32 x 32 werden sofort freigegeben
// Vorrang in der Warteschlange (src/schleier/vorrang.ts): kleine Elemente (laengste dargestellte Seite unter diesem Wert) kommen nach den
// grossen derselben Naehe; "nah" ist der Bereich zwei Bildschirmhoehen ueber und unter dem Sichtbereich (zweiter IntersectionObserver).
export const VORRANG_KLEIN_PX = 150;
export const VORRANG_NAH_FAKTOR = 2; // Bildschirmhoehen ueber und unter dem Sichtbereich
export const VORRANG_NAH_RAND = `${VORRANG_NAH_FAKTOR * 100}% 0px`;
export const PARALLEL = 3; // gleichzeitige Anfragen
export const LAENGSTE_SEITE = 1280; // Canvas-Weg: laengste Seite
export const JPEG_QUALITAET = 0.85;
export const ZWISCHENSPEICHER_MAX = 200;
export const ZWISCHENSPEICHER_BYTES = 20 * 1024 * 1024; // Obergrenze fuer die Data-URLs im Zwischenspeicher (je Frame)
export const STRICT_MAX_MS = 4000;
export const WECKEN_MAX_MS = 20_000;
export const WECKEN_TAKT_MS = 100;
export const ANTWORT_MAX_MS = 20_000; // so lange wartet eine Pruefanfrage auf den Erkenner, danach gilt sie als Fehler (zweiter Versuch, dann verdeckt)
export const GROSSFLAECHE_ANTEIL = 0.6; // Inline-Hintergrund ueber diesem Anteil der Fensterflaeche: bei Verdeckung nur der Hintergrund weg, kein Blur
export const ZWEITER_VERSUCH_MS = 10_000;
export const VIDEO_NACHFRIST_MS = 1000; // nach load: so lange auf Videodaten warten, danach unscharf zeigen (preload none oder metadata)
// Laufende Nachpruefung von Videos (PHASE-2-BAUPLAN 10.1).
// Nachpruefung: je Video hoechstens eine Pruefung in dieser Zeit (auch Sofortpruefungen), bleibt eine Antwort ueber 2 Taktzeiten aus, gilt das
// wie ein Fehler (verdecken). Die erste Pruefung eines Videos ist davon ausgenommen (kein Taktabstand), wartet aber hoechstens 2 Taktzeiten auf
// eine noch offene Pruefung desselben Videos.
export const VIDEO_TAKT_MS = 1000;
export const VIDEO_BUDGET_JE_S = 4; // je Dokument hoechstens so viele Video-Pruefungen je Sekunde
export const VIDEO_LAENGSTE_SEITE = 640; // Einzelbild fuer die Pruefung (das Modell rechnet ohnehin auf 320)
export const VIDEO_FREI_NACH = 3; // saubere Pruefungen in Folge, bis ein verdecktes Video wieder frei wird
export const VIDEO_WECHSEL_MIN_MS = 1000; // zwischen zwei Urteilswechseln desselben Videos (Blitz-Grenze)
export const BLITZ_SPERRE_MS = 334; // Freigaben im selben Dokument mindestens so weit auseinander (hoechstens 3 je Sekunde)
export const VIDEO_NACHFRIST_AUTOPLAY_MS = 5000; // Autoplay ohne Daten nach load: so lange unsichtbar, bevor es vorlaeufig unscharf wird
export const AUFRAEUM_VERZOEGERUNG_MS = 3000; // nach entfernten Knoten: so lange warten, dann Verweise auf getrennte Elemente loesen
export const TAB_FRIST_MS = 1500; // eingebettete Frames: so lange auf die Adresse des Tabs warten, danach zaehlt nur die eigene Adresse
export const ADRESS_TAKT_MS = 400; // Abfrage der eigenen Adresse, nur ohne Navigation API und nur bei vorhandenen Ausnahmen
export const TAUSCH_MAX_MS = 3000; // so lange darf das Laden des zensierten Bildes dauern, danach verdeckt
export const STARTPHASE_NACH_LOAD_MS = 250;
export const STARTPHASE_MAX_MS = 5000;
