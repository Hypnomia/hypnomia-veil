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
// Video unter einer Zonen-Leinwand: das Video selbst ist unsichtbar (opacity 0 per CSS), die Leinwand daneben zeigt das zensierte Bild.
export const ATTR_LEINWAND = 'data-veil-leinwand';
// Testhaken der Zonen-Leinwand (nur Testbau, nur Testhost): Ansicht des Videos (frei, zonen, mosaik, ganz) und die gezeigten Boxen (JSON).
export const ATTR_VIDEO_MODUS = TESTHAKEN ? 'data-veil-video-modus' : '';
export const ATTR_VIDEO_BOXEN = TESTHAKEN ? 'data-veil-video-boxen' : '';

// Inline-Hintergrund (auch Kurzform `background: url(...)`): dieselbe Auswahl steht in entrypoints/content/style.css.
// Die Gross-/Kleinschreibung im Attributwert ist egal (`i`). Den Wert liest der Schleier ueber die Langform background-image des Style-Objekts.
export const HG_SELEKTOR = '[style*="background" i][style*="url(" i]';

export type Urteil = 'frei' | 'zensiert' | 'verdeckt';
// bild: img; video; canvas; hintergrund: Inline-background-image (hide-first per CSS); klasse: Hintergrund aus einem Stylesheet (nach load);
// svgbild: Bild in Inline-SVG (<svg><image href|xlink:href>, hide-first per CSS, svg-bild.ts).
export type Art = 'bild' | 'video' | 'canvas' | 'hintergrund' | 'klasse' | 'svgbild';

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

// ---------- Videos bereichsweise zensieren (Bauplan Video-Zonen, Leinwand-Wiedergabe) ----------
// Takt: nach der Antwort startet die naechste Pruefung sofort mit dem naechsten gezeigten Bild (Interview Punkt 2, "immer Maximum"). Es gibt nur
// eine kleine Untergrenze gegen Leerlauf-Schleifen. Ein schnellerer Erkenner ergibt von selbst mehr Pruefungen je Sekunde, ohne Umbau.
export const VIDEO_ZONEN_ABSTAND_MIN_MS = 15;
export const VIDEO_ZONEN_RTT_GRENZE_MS = 260; // Median der letzten 5 Rundlaeufe darueber: sauberer Rueckfall auf ganz verdecken mit Etikett (die Boxen sind bis zu zwei Rundlaeufe plus ein Bild alt: 2 x 260 ms + 50 ms = 0,57 s unter alterMax 0,6 s)
export const VIDEO_ZONEN_BILD_S = 0.05; // angenommene Bildzeit fuer die Rueckkehr zu den Zonen (rueckkehrOk)
export const VIDEO_ZONEN_RTT_FENSTER = 5;
export const VIDEO_ZONEN_ALTER_MAX_S = 0.6; // Boxen aelter als das (Medienzeit seit der letzten Antwort): ganzes Bild decken
export const VIDEO_ZONEN_SPUR_HALTEN_S = 1.0; // eine Spur haelt so lange Medienzeit ohne Treffer
export const VIDEO_ZONEN_ZUORDNUNG_IOU = 0.1;
export const VIDEO_ZONEN_FREI_NACH_S = 3.0; // saubere Medienzeit, bis ein Zonen-Video wieder frei wird (zusaetzlich zu VIDEO_FREI_NACH Pruefungen)
export const VIDEO_ZONEN_GANZ_ANTEIL = 0.6; // Boxen decken mehr als das vom Bild: ganzes Bild decken
export const VIDEO_ZONEN_MAX_JE_DOKUMENT = 1;
export const VIDEO_ZONEN_MIN_B = 200; // kleinere Flaechen (CSS px) gehen ganz verdeckt
export const VIDEO_ZONEN_MIN_H = 150;
export const VIDEO_ZONEN_LEINWAND_MAX_SEITE = 1920;
// Bewegungsschaetzung je Bild (V3b): Graustufenbild dieser Breite, Suchfenster in Bildpunkten dieses Bildes.
export const VIDEO_ZONEN_GRAU_B = 160;
export const VIDEO_ZONEN_SUCH_BASIS = 4;
export const VIDEO_ZONEN_SUCH_MAX = 14;
export const VIDEO_ZONEN_SAD_UNSICHER = 22; // mittlere Abweichung (von 255) der besten Verschiebung, darueber gilt die Verfolgung als unsicher
export const VIDEO_ZONEN_KONTRAST_MIN = 3; // flache Schablone: Verschiebung nicht verlaesslich
export const VIDEO_ZONEN_RAND_BASIS = 0.01; // Sicherheitsrand der gezeigten Box bei sicherer Verfolgung: Anteil der laengeren Bildseite
export const VIDEO_ZONEN_WACHSTUM_JE_S = 0.25; // bei unsicherer Verfolgung waechst die Box so schnell (Anteil der laengeren Bildseite je s Medienzeit)
export const VIDEO_ZONEN_ENTSPANNEN_S = 0.12; // so schnell zieht sich eine zu grosse Box wieder zusammen (Zeitkonstante, nur Schrumpfen)
// Szenenpruefung je gezeigtem Bild (Daumen 32 x 18, Leuchtdichte 0 bis 1).
export const VIDEO_ZONEN_DAUMEN_B = 32;
export const VIDEO_ZONEN_DAUMEN_H = 18;
export const VIDEO_ZONEN_SZENE_SCHWELLE = 0.12; // mittlere Abweichung darueber: Schnitt, dieses Bild ganz decken
export const VIDEO_ZONEN_ZELLE_SCHWELLE = 0.3; // Zellen mit mehr Abweichung zaehlen als stark veraendert
export const VIDEO_ZONEN_ZELLEN_ANTEIL = 0.1; // so viele starke Zellen: nur Sofortpruefung, kein Ganz-Decken
export const VIDEO_SCHNITT_MIN_MS = 300; // freie Videos: nach einem Schnitt fruehestens so lange nach der letzten Pruefung die Sofortpruefung
export const VIDEO_SPRUNG_MEDIA_S = 0.75; // Sprung der Medienzeit (vor oder zurueck) ueber diesem Wert ohne Ereignis gilt als Sprung
