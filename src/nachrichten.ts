// Nachrichten-Vertrag zwischen Content-Script, Hintergrund und Erkenner (PHASE-2-BAUPLAN Abschnitt 2).
// Alle Nachrichten sind reine JSON-Objekte (Chrome serialisiert runtime.sendMessage als JSON).
// Jeder Empfaenger antwortet nur auf sein `ziel`; auf fremde Ziele und unbekannte Typen gibt er undefined zurueck.

import type { Einstellungen, Zone } from './einstellungen';
import type { QuizBank, Texte } from './quiz/vertrag';
import type { WerbeFormat } from './pack/vertrag';

export type Ziel = 'hintergrund' | 'erkenner' | 'inhalt';

// ---------- Ziel hintergrund ----------
export interface NachrichtHintergrundWecke { ziel: 'hintergrund'; typ: 'wecke' }
export interface NachrichtHintergrundReferer { ziel: 'hintergrund'; typ: 'referer'; host: string; referer: string }
export interface NachrichtHintergrundPause { ziel: 'hintergrund'; typ: 'pause'; an?: boolean }
// Adresse des Tabs, aus dem die Nachricht kommt (fuer eingebettete Frames: die oberste Seite). Eigene Ausnahmen gelten je Tab.
export interface NachrichtHintergrundTab { ziel: 'hintergrund'; typ: 'tab' }
// Die oberste Seite eines Tabs meldet einen Adresswechsel ohne Neuladen (pushState, hashchange), nur wenn eigene Ausnahmen existieren.
// Der Hintergrund reicht die neue Adresse per tabs.sendMessage als `inhalt/tab` an alle Frames dieses Tabs weiter (kein Takt in Frames).
export interface NachrichtHintergrundAdresse { ziel: 'hintergrund'; typ: 'adresse'; url: string }
// ---------- Phase 4 (PHASE-4-BAUPLAN Abschnitte 2, 8, 9) ----------
// Quiz-Bank oder Mias Saetze aus dem Pack (IndexedDB, geprueft mit src/quiz/vertrag.ts). Nur mit Freischaltung, sonst `daten: null`.
// Handler: src/hintergrund/quiz.ts (Auftrag Q).
export interface NachrichtHintergrundPackDaten { ziel: 'hintergrund'; typ: 'packdaten'; rolle: 'quiz' | 'texte' }
// Steigerung der Zensur: die oberste Seite eines sichtbaren Tabs meldet einmal je Minute, ob sie eine Erwachsenenseite ist und wie viele
// neue Urteile `zensiert` (nur Bilder und Videos dieses Tabs) es seit der letzten Meldung gab. Der Hintergrund zaehlt je Uhr-Minute
// hoechstens eine Minute (mehrere Fenster), schreibt den Stand nach storage.local (src/steigerung.ts). Handler: src/hintergrund/steigerung.ts
// (Auftrag S). Testhaken (nur WXT_TESTHAKEN): `typ: 'steigerung-uhr'` stellt die Uhr der Steigerung vor.
export interface NachrichtHintergrundSteigerungMinute { ziel: 'hintergrund'; typ: 'steigerung-minute'; erwachsen: boolean; zensiert: number }
export interface NachrichtHintergrundSteigerungUhr { ziel: 'hintergrund'; typ: 'steigerung-uhr'; vorMs: number }
// Komplett-Ersatz (Auftrag G): die Galerie schaltet den ganzen Tab stumm (auch Audio ohne Element, iframes, WebAudio) und danach wieder
// auf den vorherigen Stand. `abgang`: die Seite wird verlassen (pagehide); der Ton kommt erst zurueck, wenn die neue Seite geladen ist
// (Firefox setzt den Ton sonst waehrend der Navigation wieder stumm). Der Tab kommt aus sender.tab.id. Handler: src/hintergrund/ersatz-stumm.ts.
export interface NachrichtHintergrundErsatzStumm { ziel: 'hintergrund'; typ: 'ersatz-stumm'; an: boolean; abgang?: boolean }
// Leerlauf-Spirale (Auftrag L, Phase 5): der Hintergrund erkennt Leerlauf mit `browser.idle` und schickt der obersten Seite des aktiven Tabs im
// zuletzt fokussierten Fenster `NachrichtInhaltLeerlauf`. Testhaken (nur WXT_TESTHAKEN): `typ: 'leerlauf-test'` spielt einen Zustandswechsel
// vor (der Testbau wertet `browser.idle` sonst nicht aus, damit die Spirale nicht in fremde Tests faellt). Handler: src/hintergrund/leerlauf.ts.
export interface NachrichtHintergrundLeerlaufTest { ziel: 'hintergrund'; typ: 'leerlauf-test'; zustand: 'active' | 'idle' | 'locked' }
// Session 10, Auftrag M (Meldungen): der Hintergrund entscheidet ueber alle Tabs, ob ein Anlass faellig ist (hoechstens eine Meldung je
// 10 Minuten, src/kontrolle/grenzen.ts), und schickt der obersten Seite des Tabs `NachrichtInhaltMeldung`. Quelle der Zahlen: die
// Minutenmeldungen `steigerung-minute` (background.ts reicht sie an src/hintergrund/meldungen.ts weiter) und der Stand der Steigerung.
// Testhaken (nur WXT_TESTHAKEN): `meldung-test` loest einen Anlass fuer den Tab des Absenders sofort aus (`vergiss`: Abstand vergessen).
export type MeldungAnlass = 'zensiert' | 'stufe' | 'erwachsen' | 'streng';
export const MELDUNG_ANLAESSE: readonly MeldungAnlass[] = ['zensiert', 'stufe', 'erwachsen', 'streng'];
export interface NachrichtHintergrundMeldungTest { ziel: 'hintergrund'; typ: 'meldung-test'; anlass?: MeldungAnlass; zahl?: number; vergiss?: boolean }
// Session 10, Auftrag Z2 (Pflicht-Besuche): die oberste Seite des sichtbaren, fokussierten Tabs bittet nach dem Hinweis um einen Besuch; der
// Hintergrund prueft Pack, Schalter, Pause, Fenster (fokussiert, nicht Vollbild) und den harten Abstand von 2 Stunden und oeffnet dann einen
// Tab mit einem Link aus data/links.json neben dem Absender. Antwort `AntwortBesuch`. Im Testbau oeffnet er statt der echten Adresse
// `about:blank#veil-besuch` (kein Netz in Tests) und nennt die gewaehlte Adresse in der Antwort. Testhaken `besuch-test { vergiss }`: den
// zuletzt gespeicherten Besuch vergessen. Handler: src/hintergrund/besuche.ts.
export interface NachrichtHintergrundBesuch { ziel: 'hintergrund'; typ: 'besuch' }
export interface NachrichtHintergrundBesuchTest { ziel: 'hintergrund'; typ: 'besuch-test'; vergiss: boolean }
export type AntwortBesuch = { ok: true; url: string; tabId: number | null } | { ok: false; grund: string };

export type NachrichtHintergrund =
  | NachrichtHintergrundWecke
  | NachrichtHintergrundReferer
  | NachrichtHintergrundPause
  | NachrichtHintergrundTab
  | NachrichtHintergrundAdresse
  | NachrichtHintergrundPackDaten
  | NachrichtHintergrundSteigerungMinute
  | NachrichtHintergrundSteigerungUhr
  | NachrichtHintergrundErsatzStumm
  | NachrichtHintergrundLeerlaufTest
  | NachrichtHintergrundMeldungTest
  | NachrichtHintergrundBesuch
  | NachrichtHintergrundBesuchTest;

// Alle Typen, die der Hintergrund beantwortet (background.ts filtert damit; neue Typen hier und im Handler eintragen).
export const HINTERGRUND_TYPEN = [
  'wecke',
  'referer',
  'pause',
  'tab',
  'adresse',
  'packdaten',
  'steigerung-minute',
  'steigerung-uhr',
  'ersatz-stumm',
  'leerlauf-test',
  'meldung-test',
  'besuch',
  'besuch-test',
] as const satisfies readonly NachrichtHintergrund['typ'][];

export interface AntwortPackDaten { ok: true; daten: QuizBank | Texte | null }

export interface AntwortOk { ok: true }
export interface AntwortPause { ok: true; pause: boolean }
export interface AntwortTab { ok: true; url: string | null }
// Fehlerantworten tragen die id der Anfrage, wenn eine da war.
export interface AntwortFehler { ok: false; id?: string; fehler: string; status?: number }

// ---------- Ziel erkenner ----------
export interface QuelleDaten { art: 'daten'; dataUrl: string }
export interface QuelleUrl { art: 'url'; url: string; referer: string }
export type Quelle = QuelleDaten | QuelleUrl;

export type Box = [x: number, y: number, w: number, h: number];

export interface PruefEinstellungen {
  schwelle: number;
  zonen: Einstellungen['zonen'];
  rand: number;
  stil: Einstellungen['stil'];
  // Steigerung Stufe 4 (src/steigerung.ts): jedes Bild mit einer erkannten Frau wird ganz verdeckt. Fehlt = aus.
  ganzVerdecken?: boolean;
  // Nur bei Stil mia-patch: `importiert` der Pack-Kurzfassung, die das Content-Script kennt (0 = kein Pack). Weicht der Stand im
  // Erkenner ab, liest er die Patch-Bilder neu, bevor er rendert (kein Rendern mit dem alten Pack nach einem Ersetzen).
  packStand?: number;
}

export interface NachrichtErkennerWecke { ziel: 'erkenner'; typ: 'wecke' }
export interface NachrichtErkennerStatus { ziel: 'erkenner'; typ: 'status' }
export interface NachrichtErkennerPruefe {
  ziel: 'erkenner';
  typ: 'pruefe';
  id: string;
  quelle: Quelle;
  breite: number;
  hoehe: number;
  einstellungen: PruefEinstellungen;
  rendern: boolean;
}
// Phase 4: ein Bild aus dem Pack fuer das Content-Script (Pruefer-Fund 1, wie Mia-Patch Entscheidung 65): der Erkenner (Chrome Offscreen,
// Firefox Hintergrund) liest das Bild aus IndexedDB und liefert eine verkleinerte Data-URL (laengste Seite hoechstens PACKBILD_MAX_SEITE,
// hoechstens PACKBILD_MAX_BYTES Zeichen). Wahl: stabil je `schluessel` (z. B. Adresse des Vorschaubilds, Pose des Chibis), immer
// dasselbe Bild fuer denselben Schluessel. Vorschau nur mit Freischaltung `erwachsen:vorschau` im Meta (die Galerie liest ihre Bilder selbst), sonst
// `ok: false`. Chibi: `schluessel` ist die Pose (src/chibi.ts); mit `chibi:pack` ein passendes Pack-Chibi, sonst das Demo-Chibi aus
// `/chibi/<pose>.webp`, fehlt beides `ok: false`. Chibis behalten Transparenz (WebP oder PNG), Vorschau als JPEG.
// Handler: src/erkenner/packbild.ts (Auftrag E; Chibi-Zweig nutzt Auftrag Q fuer den Riegel).
// Phase 5 (Auftrag W): Rolle `werbung` nur mit `kontrolle:werbung` im Meta; `format` ist das Format der Flaeche, gewaehlt wird stabil per
// Schluessel unter den Werbebildern dieses Formats (fehlt es, unter dem naechstliegenden Seitenverhaeltnis); JPEG oder WebP ohne Transparenz,
// laengste Seite hoechstens PACKBILD_MAX_SEITE_WERBUNG.
export interface NachrichtErkennerPackBild {
  ziel: 'erkenner';
  typ: 'packbild';
  rolle: 'vorschau' | 'chibi' | 'werbung';
  schluessel: string;
  maxSeite?: number;
  format?: WerbeFormat;
}
export type NachrichtErkenner = NachrichtErkennerWecke | NachrichtErkennerStatus | NachrichtErkennerPruefe | NachrichtErkennerPackBild;
export const PACKBILD_MAX_SEITE = 480;
export const PACKBILD_MAX_SEITE_CHIBI = 512;
export const PACKBILD_MAX_SEITE_WERBUNG = 970;
export const PACKBILD_MAX_BYTES = 600_000;
export interface AntwortPackBild { ok: true; dataUrl: string; breite: number; hoehe: number; name: string }

// quelle: welches Modell den Treffer lieferte (fehlt = 320n). Gesichtszonen aus YuNet tragen 'yunet' (PHASE-2-BAUPLAN 10.4).
// weiblich: Klasse einer Frau (nur 320n); Steigerung Stufe 4 verdeckt dann das ganze Bild.
export interface Treffer { zone: Zone; bedeckt: boolean; score: number; box: Box; quelle?: '320n' | 'yunet'; weiblich?: true }
export interface Flaeche { zone: Zone; box: Box }

export interface ZeitenPruefung {
  netz: number;
  dekod: number;
  vor: number;
  warte: number;
  inf: number;
  nach: number;
  render: number;
  gesamt: number;
  // Gesichtsmodell YuNet (nur wenn eine Gesichtszone an ist), Vorverarbeitung plus Inferenz plus Nachverarbeitung.
  gesicht?: number;
}

export interface AntwortErkennerWecke { ok: true; bereit: boolean }
export interface AntwortErkennerStatus {
  ok: true;
  bereit: boolean;
  modell: '320n';
  kaltstartMs: number | null;
  // Gesichtsmodell YuNet: bereit und Kaltstart (Sitzung bauen), null solange nicht geladen.
  gesichtBereit?: boolean;
  gesichtKaltstartMs?: number | null;
  // Anzahl der YuNet-Laeufe seit Start (Beleg, dass ohne Gesichtszonen nichts rechnet).
  gesichtLaeufe?: number;
  laeufe: number;
  warteschlange: number;
}
export interface AntwortPruefeOk {
  ok: true;
  id: string;
  breite: number;
  hoehe: number;
  treffer: Treffer[];
  flaechen: Flaeche[];
  bild?: string;
  ms: ZeitenPruefung;
  kalt: boolean;
}
export interface AntwortPruefeFehler { ok: false; id: string; fehler: string; status?: number }
export type AntwortPruefe = AntwortPruefeOk | AntwortPruefeFehler;

// ---------- Ziel inhalt (Content-Script, per tabs.sendMessage vom Hintergrund) ----------
// Neue Adresse des Tabs nach einem Adresswechsel der obersten Seite. Antwort: keine (undefined).
export interface NachrichtInhaltTab { ziel: 'inhalt'; typ: 'tab'; url: string }
// Phase 5 (Auftrag L): Leerlauf beginnt (`an: true`, Zustand idle) oder endet (`an: false`, active oder locked). Antwort: keine.
export interface NachrichtInhaltLeerlauf { ziel: 'inhalt'; typ: 'leerlauf'; an: boolean }
// Session 10 (Auftrag M): eine Meldung zeigen. `zahl`: zensierte Bilder heute (nur Anlass `zensiert`). Antwort `{ gezeigt: boolean }`
// (nicht gezeigt: Pause, Schalter aus, Ausnahme, Tab nicht sichtbar oder ohne Fokus, kein Satz; der Hintergrund zaehlt den Anlass dann nicht).
export interface NachrichtInhaltMeldung { ziel: 'inhalt'; typ: 'meldung'; anlass: MeldungAnlass; zahl?: number }
export type NachrichtInhalt = NachrichtInhaltTab | NachrichtInhaltLeerlauf | NachrichtInhaltMeldung;

export type Nachricht = NachrichtHintergrund | NachrichtErkenner | NachrichtInhalt;

// Typwaechter fuer Empfaenger: nur das eigene Ziel beantworten.
export function istFuer<Z extends Ziel>(n: unknown, ziel: Z): n is Extract<Nachricht, { ziel: Z }> {
  return !!n && typeof n === 'object' && (n as { ziel?: unknown }).ziel === ziel && typeof (n as { typ?: unknown }).typ === 'string';
}
