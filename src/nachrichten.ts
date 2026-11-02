// Nachrichten-Vertrag zwischen Content-Script, Hintergrund und Erkenner (PHASE-2-BAUPLAN Abschnitt 2).
// Alle Nachrichten sind reine JSON-Objekte (Chrome serialisiert runtime.sendMessage als JSON).
// Jeder Empfaenger antwortet nur auf sein `ziel`; auf fremde Ziele und unbekannte Typen gibt er undefined zurueck.

import type { Einstellungen, Zone } from './einstellungen';

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
export type NachrichtHintergrund =
  | NachrichtHintergrundWecke
  | NachrichtHintergrundReferer
  | NachrichtHintergrundPause
  | NachrichtHintergrundTab
  | NachrichtHintergrundAdresse;

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
export type NachrichtErkenner = NachrichtErkennerWecke | NachrichtErkennerStatus | NachrichtErkennerPruefe;

export interface Treffer { zone: Zone; bedeckt: boolean; score: number; box: Box }
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
}

export interface AntwortErkennerWecke { ok: true; bereit: boolean }
export interface AntwortErkennerStatus {
  ok: true;
  bereit: boolean;
  modell: '320n';
  kaltstartMs: number | null;
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
export type NachrichtInhalt = NachrichtInhaltTab;

export type Nachricht = NachrichtHintergrund | NachrichtErkenner | NachrichtInhalt;

// Typwaechter fuer Empfaenger: nur das eigene Ziel beantworten.
export function istFuer<Z extends Ziel>(n: unknown, ziel: Z): n is Extract<Nachricht, { ziel: Z }> {
  return !!n && typeof n === 'object' && (n as { ziel?: unknown }).ziel === ziel && typeof (n as { typ?: unknown }).typ === 'string';
}
