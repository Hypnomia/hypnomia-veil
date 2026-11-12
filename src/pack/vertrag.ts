// Vertrag fuer das Mia Pack (PHASE-2-BAUPLAN Abschnitt 9). Vom Orchestrator geschrieben, Bauer lesen nur.
// Das Pack ist eine einzige Datei mit Daten (Bilder, Lizenztext, spaeter Quiz-Daten), nie Code (Entscheidung O11).
// Ablage: Dateien in IndexedDB (Erweiterungs-Ursprung, `unlimitedStorage`, Entscheidung 25), eine kleine Kurzfassung
// in storage.local unter `pack`, damit Popup und Content-Script ohne IndexedDB wissen, was freigeschaltet ist.

import { OHNE_PACK_PRESET, PRESETS, packGenuegt, type Preset } from '../presets.ts';
import type { SatzGruppe } from '../quiz/vertrag';

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
// storage.local-Schluessel `gesichterStand` ({ importiert, mit, zeit }): der Erkenner meldet (ueber den Hintergrund), dass die Gesichtssuche in den Patch-Bildern
// fertig ist. Waehrend sie lief, bekamen Pruefungen den Ersatz; offene Seiten nehmen den Stand in ihren Pruefstand auf und bewerten dann neu.
export const GESICHTER_STAND_SCHLUESSEL = 'gesichterStand';

// ---------- Freischaltungen ----------
// Was ein Pack freischalten kann. Unbekannte Eintraege im Pack werden beim Import verworfen (ein Pack kann nichts
// freischalten, was diese Version der Erweiterung nicht kennt). Phase 4 (PHASE-4-BAUPLAN Abschnitte 2, 8 bis 10):
//   erwachsen:vorschau  Vorschaubilder auf Erwachsenenseiten werden Mia (Rolle `vorschau`)
//   erwachsen:quiz      Quiz vor jedem Video auf Erwachsenenseiten (Rolle `quiz`)
//   erwachsen:titel     Videotitel mit Mias Kommentar (Rolle `texte`, Gruppe `titel`)
//   erwachsen:ersatz    Komplett-Ersatz: Mia-Galerie in der Seite (Rolle `vorschau`)
//   quiz:freilegen      zensierte Flaeche per Quiz kurz freilegen (Rolle `quiz`)
//   zensur:steigerung   Steigerung der Zensur (Entscheidung 101), braucht keine Datei
//   chibi:pack          frechere Chibis aus dem Pack (Rolle `chibi`); die suessen Demo-Chibis gibt es ohne Pack
// Phase 5 (PHASE-5-AUFTRAEGE-SESSION-9.md, Version 0.5.0):
//   kontrolle:werbung   Werbe-Tausch: Werbeflaechen werden Mias Werbung (Rolle `werbung` mit `format`)
//   kontrolle:blitz     Blitzwoerter (Rolle `texte`, Gruppe `blitzwoerter`)
//   kontrolle:leerlauf  Leerlauf-Spirale (Rolle `texte`, Gruppe `leerlauf`)
// Session 10 (PHASE-5-AUFTRAEGE-SESSION-10.md, Version 0.5.1):
//   kontrolle:tabtitel  Tab-Titel im Hintergrund wird Mias Satz (Rolle `texte`, Gruppe `tabtitel`)
//   kontrolle:cursor    Mauszeiger Spirale oder Herz (braucht keine Datei, Zeiger werden gezeichnet)
//   kontrolle:meldungen kleine Meldungen mit Mini-Chibi (Rolle `texte`; je Anlass eine Gruppe `meldung*`, fehlt eine, schweigt nur der Anlass)
//   kontrolle:zeitplan  strenge Zeiten (braucht keine Datei)
//   kontrolle:besuche   Pflicht-Besuche: Mia oeffnet selbst einen Tab (Rolle `texte`, Gruppe `besuch`)
// Session 11 (PHASE-6-AUFTRAEGE-SESSION-11.md, Version 0.6.0):
//   ton                 kurze Klaenge zu Quiz und Blitzwoertern (Rolle `ton`, mindestens eine Audio-Datei mit Namen aus TON_NAMEN)
// Zensur-Presets (ZENSUR-PRESETS-BAUPLAN):
//   zensur:woerter      Woerter fuer die Presets mit Wort (Rolle `woerter`, JSON, Schema src/presets.ts pruefeWoerter)
// Sticker-Zensur (STICKER-BAUPLAN):
//   zensur:sticker      Sticker auf der Pastell-Flaeche der Presets `sticker` und `mia-sticker` (Rolle `sticker`, Bilder mit Transparenz)
export const FREISCHALTUNGEN = [
  'stil:mia-patch',
  'erwachsen:vorschau',
  'erwachsen:quiz',
  'erwachsen:titel',
  'erwachsen:ersatz',
  'quiz:freilegen',
  'zensur:steigerung',
  'chibi:pack',
  'kontrolle:werbung',
  'kontrolle:blitz',
  'kontrolle:leerlauf',
  'kontrolle:tabtitel',
  'kontrolle:cursor',
  'kontrolle:meldungen',
  'kontrolle:zeitplan',
  'kontrolle:besuche',
  'ton',
  'zensur:woerter',
  'zensur:sticker',
] as const;
export type Freischaltung = (typeof FREISCHALTUNGEN)[number];

export type Stufe = 'tease' | 'hot' | 'explicit';
// Rolle einer Datei im Pack. `patch`: Bild fuer den Stil Mia-Patch. `lizenz`: Lizenztext (genau eine Datei, Pflicht).
// `vorschau`: Bild fuer Vorschau-Tausch und Galerie (Stufe Pflicht). `quiz`: Quiz-Bank als JSON (hoechstens eine Datei,
// Schema src/quiz/vertrag.ts). `texte`: Mias Saetze als JSON (hoechstens eine Datei, Schema src/quiz/vertrag.ts). `chibi`: Chibi-Bild
// (WebP mit Transparenz, Name enthaelt die Pose, siehe src/chibi.ts). `werbung`: Mias Werbebild fuer den Werbe-Tausch (Phase 5, Feld
// `format` Pflicht). `ton` (Phase 6): kurzer Klang als Audio (ogg, mp3 oder wav, hoechstens 1 MB), der Dateiname ohne Ordner und Endung muss
// in TON_NAMEN (src/ton/vertrag.ts) stehen, sonst verwirft der Import die Datei; Audio gibt es nur in dieser Rolle und diese Rolle nur als Audio.
// `sticker` (Sticker-Zensur): kleines Bild mit Transparenz (WebP oder PNG), das mittig auf der Pastell-Flaeche sitzt.
// Unbekannte Rollen verwirft der Import (die Datei bleibt ohne Rolle).
export type Rolle = 'patch' | 'lizenz' | 'vorschau' | 'quiz' | 'texte' | 'chibi' | 'werbung' | 'ton' | 'woerter' | 'sticker';
export const ROLLEN: readonly Rolle[] = ['patch', 'lizenz', 'vorschau', 'quiz', 'texte', 'chibi', 'werbung', 'ton', 'woerter', 'sticker'];

// Werbeformate (Breite x Hoehe in CSS-Pixeln) fuer die Rolle `werbung`: jedes Werbebild nennt sein Format. Der Werbe-Tausch waehlt fuer eine
// Flaeche das Format, das ihr am naechsten kommt (Auftrag W).
export const WERBE_FORMATE = ['300x250', '336x280', '728x90', '468x60', '160x600', '300x600', '320x50', '320x100', '970x250'] as const;
export type WerbeFormat = (typeof WERBE_FORMATE)[number];
export function formatMasse(f: WerbeFormat): { breite: number; hoehe: number } {
  const [b, h] = f.split('x').map(Number);
  return { breite: b!, hoehe: h! };
}
// Rollen, die hoechstens einmal vorkommen duerfen (JSON-Dateien).
export const EINZEL_ROLLEN: readonly Rolle[] = ['quiz', 'texte', 'woerter'];

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
  'kontrolle:werbung': 'werbung',
  'kontrolle:blitz': 'texte',
  'kontrolle:leerlauf': 'texte',
  'kontrolle:tabtitel': 'texte',
  'kontrolle:cursor': null,
  'kontrolle:meldungen': 'texte',
  'kontrolle:zeitplan': null,
  'kontrolle:besuche': 'texte',
  ton: 'ton',
  'zensur:woerter': 'woerter',
  'zensur:sticker': 'sticker',
};

// Freischaltungen, die zusaetzlich eine Satz-Gruppe in der Texte-Datei brauchen (mindestens ein gueltiger Satz nach `pruefeTexte`).
// Fehlt die Gruppe, faellt beim Import nur diese Freischaltung weg (src/pack/speicher.ts).
export const BENOETIGT_GRUPPE: Readonly<Partial<Record<Freischaltung, SatzGruppe>>> = {
  'kontrolle:blitz': 'blitzwoerter',
  'kontrolle:leerlauf': 'leerlauf',
  'kontrolle:tabtitel': 'tabtitel',
  'kontrolle:besuche': 'besuch',
};

// Behaelt nur Freischaltungen, deren Satz-Gruppe (falls noetig) in den geprueften Texten mindestens einen Satz hat.
export function filtereNachGruppen(
  freischaltungen: readonly Freischaltung[],
  texte: { gruppen: Partial<Record<SatzGruppe, string[]>> } | null,
): Freischaltung[] {
  return freischaltungen.filter((f) => {
    const gruppe = BENOETIGT_GRUPPE[f];
    return !gruppe || !!texte?.gruppen[gruppe]?.length;
  });
}

// Eintrag im Pack-Manifest (siehe src/pack/format.ts fuer Dateiaufbau und Grenzen).
export interface PackDateiEintrag {
  name: string;
  typ: 'image/webp' | 'image/jpeg' | 'image/png' | 'text/plain' | 'application/json' | 'audio/ogg' | 'audio/mpeg' | 'audio/wav';
  offset: number;
  laenge: number;
  sha256: string;
  rolle?: Rolle;
  stufe?: Stufe;
  format?: WerbeFormat; // nur Rolle `werbung` (dort Pflicht)
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
  dateien: { name: string; typ: PackDateiEintrag['typ']; rolle?: Rolle; stufe?: Stufe; format?: WerbeFormat; laenge: number; breite?: number; hoehe?: number }[];
  // `breite` und `hoehe` (Phase 7): Pixelmasse bei Bildern, beim Import einmal gelesen. Fehlen bei Packs, die vor 0.7.0 importiert wurden.
  groesse: number; // Bytes der Pack-Datei
  importiert: number; // Date.now()
}

// In IndexedDB unter `dateien`/<name>.
export interface PackDateiGespeichert {
  name: string;
  typ: PackDateiEintrag['typ'];
  rolle?: Rolle;
  stufe?: Stufe;
  format?: WerbeFormat;
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
  werbung: number; // Phase 5: Anzahl Werbebilder (fehlt bei aelteren Importen, dann 0)
  sticker: number; // Sticker-Zensur: Anzahl Sticker (fehlt bei Packs ohne Sticker und aelteren Importen, dann 0)
  groesse: number;
  importiert: number;
}

export function istFreigeschaltet(pack: PackKurz | null | undefined, f: Freischaltung): boolean {
  return !!pack && Array.isArray(pack.freischaltungen) && pack.freischaltungen.includes(f);
}

// Preset, das tatsaechlich gilt: Mia-Presets nur mit Pack (Freischaltung `stil:mia-patch`), Sticker-Presets nur mit Stickern im Pack
// (`zensur:sticker`), sonst Mosaik (Demo: Klassisch und Ganze Person).
export function presetFuerPackKurz(preset: Preset, pack: PackKurz | null | undefined): Preset {
  return packGenuegt(PRESETS[preset].braucht, istFreigeschaltet(pack, 'stil:mia-patch'), istFreigeschaltet(pack, 'zensur:sticker')) ? preset : OHNE_PACK_PRESET;
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
    werbung: zahl(p.werbung),
    sticker: zahl(p.sticker),
  };
}
