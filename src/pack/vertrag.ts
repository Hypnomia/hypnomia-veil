// Vertrag fuer das Mia Pack (PHASE-2-BAUPLAN Abschnitt 9). Vom Orchestrator geschrieben, Bauer lesen nur.
// Das Pack ist eine einzige Datei mit Daten (Bilder, Lizenztext, spaeter Quiz-Daten), nie Code (Entscheidung O11).
// Ablage: Dateien in IndexedDB (Erweiterungs-Ursprung, `unlimitedStorage`, Entscheidung 25), eine kleine Kurzfassung
// in storage.local unter `pack`, damit Popup und Content-Script ohne IndexedDB wissen, was freigeschaltet ist.

import type { Stil } from '../einstellungen';

// ---------- Ablage ----------
export const PACK_DB_NAME = 'veil-pack';
export const PACK_DB_VERSION = 1;
// Objektspeicher `meta`: Eintrag PACK_META_SCHLUESSEL (PackMeta) und ein kleiner Stand-Eintrag fuer den Erkenner
// (`PACK_STAND_SCHLUESSEL`, Typ `PackStand` in src/pack/db.ts: Importzeit und Patch-Namen, billig zu lesen).
export const PACK_STORE_META = 'meta';
export const PACK_META_SCHLUESSEL = 'aktiv';
// Objektspeicher `dateien`: Schluessel = Dateiname aus dem Pack, Wert = PackDateiGespeichert.
export const PACK_STORE_DATEIEN = 'dateien';
// storage.local-Schluessel der Kurzfassung (PackKurz). Fehlt er, gibt es kein Pack.
export const PACK_SPEICHER_SCHLUESSEL = 'pack';

// ---------- Freischaltungen ----------
// Was ein Pack freischalten kann. Unbekannte Eintraege im Pack werden beim Import verworfen (ein Pack kann nichts
// freischalten, was diese Version der Erweiterung nicht kennt). Phase 4 (PHASE-4-BAUPLAN Abschnitte 2, 8 bis 10):
//   erwachsen:vorschau  Vorschaubilder auf Erwachsenenseiten werden Mia (Rolle `vorschau`)
//   erwachsen:quiz      Quiz vor jedem Video auf Erwachsenenseiten (Rolle `quiz`)
//   erwachsen:titel     Videotitel mit Mias Kommentar (Rolle `texte`, Gruppe `titel`)
//   erwachsen:ersatz    Komplett-Ersatz: Umleitung auf die Mia-Galerie (Rolle `vorschau`)
//   quiz:freilegen      zensierte Flaeche per Quiz kurz freilegen (Rolle `quiz`)
//   zensur:steigerung   Steigerung der Zensur (Entscheidung 101), braucht keine Datei
//   chibi:pack          frechere Chibis aus dem Pack (Rolle `chibi`); die suessen Demo-Chibis gibt es ohne Pack
export const FREISCHALTUNGEN = [
  'stil:mia-patch',
  'erwachsen:vorschau',
  'erwachsen:quiz',
  'erwachsen:titel',
  'erwachsen:ersatz',
  'quiz:freilegen',
  'zensur:steigerung',
  'chibi:pack',
] as const;
export type Freischaltung = (typeof FREISCHALTUNGEN)[number];

export type Stufe = 'tease' | 'hot' | 'explicit';
// Rolle einer Datei im Pack. `patch`: Bild fuer den Stil Mia-Patch. `lizenz`: Lizenztext (genau eine Datei, Pflicht).
// `vorschau`: Bild fuer Vorschau-Tausch und Galerie (Stufe Pflicht). `quiz`: Quiz-Bank als JSON (hoechstens eine Datei,
// Schema src/quiz/vertrag.ts). `texte`: Mias Saetze als JSON (hoechstens eine Datei, Schema src/quiz/vertrag.ts). `chibi`: Chibi-Bild
// (WebP mit Transparenz, Name enthaelt die Pose, siehe src/chibi.ts). Unbekannte Rollen verwirft der Import (die Datei bleibt ohne Rolle).
export type Rolle = 'patch' | 'lizenz' | 'vorschau' | 'quiz' | 'texte' | 'chibi';
export const ROLLEN: readonly Rolle[] = ['patch', 'lizenz', 'vorschau', 'quiz', 'texte', 'chibi'];
// Rollen, die hoechstens einmal vorkommen duerfen (JSON-Dateien).
export const EINZEL_ROLLEN: readonly Rolle[] = ['quiz', 'texte'];

// Eine Freischaltung gilt nur, wenn das Pack die Datei dafuer gueltig mitbringt (Entscheidung 100, Pruefer-Fund 5).
// `null`: braucht keine Datei. Bilder: mindestens ein Bild dieser Rolle. JSON: die Datei ist da und besteht die Schema-Pruefung.
export const BENOETIGT: Readonly<Record<Freischaltung, Rolle | null>> = {
  'stil:mia-patch': 'patch',
  'erwachsen:vorschau': 'vorschau',
  'erwachsen:quiz': 'quiz',
  'erwachsen:titel': 'texte',
  'erwachsen:ersatz': 'vorschau',
  'quiz:freilegen': 'quiz',
  'zensur:steigerung': null,
  'chibi:pack': 'chibi',
};

// Eintrag im Pack-Manifest (siehe src/pack/format.ts fuer Dateiaufbau und Grenzen).
export interface PackDateiEintrag {
  name: string;
  typ: 'image/webp' | 'image/jpeg' | 'image/png' | 'text/plain' | 'application/json';
  offset: number;
  laenge: number;
  sha256: string;
  rolle?: Rolle;
  stufe?: Stufe;
}

export interface PackManifest {
  format: 'hypnomia-veil-pack';
  formatVersion: 1;
  id: string;
  version: string;
  titel: string;
  erstellt: string;
  mindestVeil: string;
  lizenz: string; // Name der Lizenzdatei unter `dateien`
  freischaltungen: string[];
  dateien: PackDateiEintrag[];
}

// In IndexedDB unter `meta`/`aktiv`: Manifest ohne Offsets plus Importzeitpunkt.
export interface PackMeta {
  id: string;
  version: string;
  titel: string;
  erstellt: string;
  freischaltungen: Freischaltung[];
  lizenzText: string;
  dateien: { name: string; typ: PackDateiEintrag['typ']; rolle?: Rolle; stufe?: Stufe; laenge: number }[];
  groesse: number; // Bytes der Pack-Datei
  importiert: number; // Date.now()
}

// In IndexedDB unter `dateien`/<name>.
export interface PackDateiGespeichert {
  name: string;
  typ: PackDateiEintrag['typ'];
  rolle?: Rolle;
  stufe?: Stufe;
  blob: Blob;
}

// In storage.local unter `pack`.
export interface PackKurz {
  id: string;
  version: string;
  titel: string;
  freischaltungen: Freischaltung[];
  bilder: number; // Anzahl Patch-Bilder (Rolle `patch`)
  // Phase 4: Anzahl Bilder je Rolle. Fehlen bei Packs, die vor 0.4.0 importiert wurden (dann 0, ladePackKurz fuellt auf).
  vorschau: number;
  chibis: number;
  groesse: number;
  importiert: number;
}

export function istFreigeschaltet(pack: PackKurz | null | undefined, f: Freischaltung): boolean {
  return !!pack && Array.isArray(pack.freischaltungen) && pack.freischaltungen.includes(f);
}

// Stil, der tatsaechlich gilt: Mia-Patch nur mit Pack, sonst Mosaik (Demo: nur Mosaik und Blur, Entscheidung 12).
export function wirksamerStil(stil: Stil, pack: PackKurz | null | undefined): Stil {
  if (stil === 'mia-patch' && !istFreigeschaltet(pack, 'stil:mia-patch')) return 'mosaik';
  return stil;
}

// Liest die Kurzfassung aus storage.local (Popup, Optionsseite, Content-Script).
export async function ladePackKurz(): Promise<PackKurz | null> {
  const ablage = await browser.storage.local.get(PACK_SPEICHER_SCHLUESSEL);
  return kurzAusRoh(ablage[PACK_SPEICHER_SCHLUESSEL]);
}

// Kurzfassung aus einem rohen storage-Wert (auch fuer storage.onChanged): fehlende Zaehler werden 0, sonst null.
export function kurzAusRoh(roh: unknown): PackKurz | null {
  const p = roh as Partial<PackKurz> | undefined;
  if (!p || typeof p !== 'object' || typeof p.id !== 'string') return null;
  const zahl = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    ...(p as PackKurz),
    freischaltungen: Array.isArray(p.freischaltungen) ? p.freischaltungen : [],
    bilder: zahl(p.bilder),
    vorschau: zahl(p.vorschau),
    chibis: zahl(p.chibis),
  };
}
