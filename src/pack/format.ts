// Lesen und Schreiben der `.miapack`-Datei (PHASE-2-BAUPLAN Abschnitt 9.1).
// Keine Laufzeit-Importe (nur `import type`), kein Browser-Zugriff: derselbe Code laeuft in der Einstellungsseite, im Pack-Bau
// (Node) und in den Einheitstests (`node --experimental-strip-types`). Hashen ueber `crypto.subtle` (Browser und Node).
// Das Pack ist nur Daten. Nichts daraus wird ausgefuehrt; Texte kommen als String zurueck und gehoeren per `textContent` angezeigt.

import type { Freischaltung, PackDateiEintrag, PackManifest, Rolle, Stufe, WerbeFormat } from './vertrag';
// Laufzeit-Werte aus vertrag.ts (ROLLEN, BENOETIGT) stehen hier als Kopie: diese Datei hat keine Laufzeit-Importe. Die Typpruefung unten
// stellt sicher, dass die Kopien zum Vertrag passen.

// ---------- Grenzen und Kennungen ----------
export const PACK_KENNUNG = 'MIAPACK1';
export const KOPF_BYTES = 12; // 8 Byte Kennung + 4 Byte Laenge des Manifests
export const MAX_MANIFEST_BYTES = 1024 * 1024; // 1 MiB
export const MAX_DATEIEN = 5000;
export const MAX_GESAMT_BYTES = 300_000_000; // 300 MB (Pack-Datei, Dezimal-MB wie in der Oberflaeche)
// So viel vom Dateianfang eines Bildes wird nach den Massen durchsucht (Import und Erkenner-Leser lesen denselben Bereich).
export const BILDKOPF_BYTES = 1024 * 1024;
export const MAX_BILD_SEITE = 4096; // Pixel je Seite eines Bildes (Schutz vor riesigen Massen im Dateikopf)
export const MAX_TITEL = 80;

const NAME_MUSTER = /^[a-z0-9][a-z0-9._/-]{0,100}$/;
const ID_MUSTER = /^[a-z0-9-]{1,40}$/;
const VERSION_MUSTER = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;
const SHA_MUSTER = /^[0-9a-f]{64}$/;
const TYPEN: readonly PackDateiEintrag['typ'][] = ['image/webp', 'image/jpeg', 'image/png', 'text/plain', 'application/json'];
const ROLLEN = ['patch', 'lizenz', 'vorschau', 'quiz', 'texte', 'chibi', 'werbung'] as const satisfies readonly Rolle[];
type _RollenVollstaendig = Exclude<Rolle, (typeof ROLLEN)[number]> extends never ? true : never;
const _rollenVollstaendig: _RollenVollstaendig = true;
void _rollenVollstaendig;
// Bild-Rollen und JSON-Rollen (JSON: hoechstens eine Datei, Typ application/json, muss als JSON lesbar sein).
const BILD_ROLLEN: readonly Rolle[] = ['patch', 'vorschau', 'chibi', 'werbung'];
const JSON_ROLLEN: readonly Rolle[] = ['quiz', 'texte'];
const STUFEN: readonly Stufe[] = ['tease', 'hot', 'explicit'];
// Kopie von WERBE_FORMATE aus vertrag.ts (Typpruefung unten).
const WERBE_FORMATE = ['300x250', '336x280', '728x90', '468x60', '160x600', '300x600', '320x50', '320x100', '970x250'] as const satisfies readonly WerbeFormat[];
type _FormateVollstaendig = Exclude<WerbeFormat, (typeof WERBE_FORMATE)[number]> extends never ? true : never;
const _formateVollstaendig: _FormateVollstaendig = true;
void _formateVollstaendig;

// Was diese Version der Erweiterung freischalten kann (muss zu FREISCHALTUNGEN in vertrag.ts passen; die Typpruefung unten
// stellt sicher, dass hier nichts steht, was der Vertrag nicht kennt, und nichts fehlt). Unbekanntes im Pack wird verworfen.
const BEKANNTE_FREISCHALTUNGEN = [
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
] as const satisfies readonly Freischaltung[];
// Kopie von BENOETIGT aus vertrag.ts: welche Rolle eine Freischaltung braucht (null = keine Datei).
const BENOETIGT: Readonly<Record<Freischaltung, Rolle | null>> = {
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
};
type _Vollstaendig = Exclude<Freischaltung, (typeof BEKANNTE_FREISCHALTUNGEN)[number]> extends never ? true : never;
const _vollstaendig: _Vollstaendig = true;
void _vollstaendig;

// ---------- Fehler ----------
// `code` ist stabil (die Oberflaeche ordnet daraus ihren englischen Text zu), `detail` ist eine deutsche Angabe fuer Logs und Tests.
export type PackFehlerCode =
  | 'zu-klein'
  | 'zu-gross'
  | 'kennung'
  | 'manifest-groesse'
  | 'manifest-ungueltig'
  | 'format'
  | 'format-version'
  | 'id'
  | 'version'
  | 'titel'
  | 'erstellt'
  | 'mindest-veil'
  | 'veil-zu-alt'
  | 'dateien'
  | 'zu-viele-dateien'
  | 'dateiname'
  | 'dateiname-doppelt'
  | 'dateityp'
  | 'dateiangabe'
  | 'bereich'
  | 'ueberlappung'
  | 'sha256'
  | 'signatur'
  | 'bildmasse'
  | 'bild-zu-gross'
  | 'utf8'
  | 'lizenz'
  | 'rolle'
  | 'stufe'
  | 'freischaltungen'
  | 'lesefehler';

export class PackFehler extends Error {
  readonly code: PackFehlerCode;
  readonly detail: string;
  constructor(code: PackFehlerCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'PackFehler';
    this.code = code;
    this.detail = detail;
  }
}

// ---------- Quellen ----------
// Wahlfreier Lesezugriff auf die Pack-Datei, damit grosse Packs nicht als Ganzes im Speicher liegen muessen.
export interface PackQuelle {
  groesse: number;
  lies(von: number, laenge: number): Promise<Uint8Array>;
}

export function quelleAusBytes(bytes: Uint8Array): PackQuelle {
  return {
    groesse: bytes.byteLength,
    lies: async (von, laenge) => bytes.subarray(von, von + laenge),
  };
}

// Blob oder File (Dateiauswahl der Einstellungsseite; in Node 26 gibt es Blob global).
export function quelleAusBlob(blob: Blob): PackQuelle {
  return {
    groesse: blob.size,
    lies: async (von, laenge) => new Uint8Array(await blob.slice(von, von + laenge).arrayBuffer()),
  };
}

// ---------- Hilfen ----------
const istObjekt = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const istGanzzahl = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

function dekodiereUtf8(bytes: Uint8Array, was: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new PackFehler('utf8', `${was} ist kein gueltiges UTF-8`);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Eigene Kopie, damit auch Ausschnitte (subarray) und SharedArrayBuffer-freie Eingaben sauber gehasht werden.
  const kopie = new Uint8Array(bytes.byteLength);
  kopie.set(bytes);
  const summe = new Uint8Array(await crypto.subtle.digest('SHA-256', kopie));
  let hex = '';
  for (const b of summe) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// Zerlegt "1.2.3" oder "1.2.3-beta" in [1, 2, 3] (Zusatz nach dem Strich zaehlt beim Vergleich nicht).
function zerlegeVersion(v: string): [number, number, number] {
  const teile = v.split('-')[0]!.split('.').map((z) => Number(z));
  return [teile[0] ?? 0, teile[1] ?? 0, teile[2] ?? 0];
}

// Ist a hoeher als b?
export function versionHoeher(a: string, b: string): boolean {
  const x = zerlegeVersion(a);
  const y = zerlegeVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x[i]! !== y[i]!) return x[i]! > y[i]!;
  }
  return false;
}

// Passt die Signatur der Bytes zum erklaerten Bildtyp? (Nur die ersten Bytes, keine Dekodierung.)
function signaturPasst(typ: PackDateiEintrag['typ'], b: Uint8Array): boolean {
  const gleich = (ab: number, soll: readonly number[]) => soll.every((v, i) => b[ab + i] === v);
  switch (typ) {
    case 'image/png':
      return b.length >= 8 && gleich(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return b.length >= 3 && gleich(0, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      // "RIFF", vier Byte Laenge, "WEBP"
      return b.length >= 12 && gleich(0, [0x52, 0x49, 0x46, 0x46]) && gleich(8, [0x57, 0x45, 0x42, 0x50]);
    default:
      return true;
  }
}

const istBild = (typ: PackDateiEintrag['typ']): boolean => typ.startsWith('image/');

// Liest Breite und Hoehe aus dem Dateikopf, ohne zu dekodieren: PNG (IHDR), WebP (VP8, VP8L, VP8X), JPEG (SOFn).
// null, wenn der Kopf nicht lesbar ist oder die Masse null sind.
export function leseBildmasse(typ: PackDateiEintrag['typ'], b: Uint8Array): { breite: number; hoehe: number } | null {
  const u16be = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u32be = (i: number) => (((b[i] ?? 0) * 0x1000000) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  const u16le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const u24le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
  const ascii = (i: number, t: string) => [...t].every((c, k) => b[i + k] === c.charCodeAt(0));
  let breite = 0;
  let hoehe = 0;
  if (typ === 'image/png') {
    // 8 Byte Signatur, dann Chunk: Laenge (4), "IHDR", Breite (4), Hoehe (4)
    if (b.length < 24 || !ascii(12, 'IHDR')) return null;
    breite = u32be(16);
    hoehe = u32be(20);
  } else if (typ === 'image/webp') {
    if (b.length < 30) return null;
    if (ascii(12, 'VP8X')) {
      breite = u24le(24) + 1;
      hoehe = u24le(27) + 1;
    } else if (ascii(12, 'VP8L')) {
      // Signaturbyte 0x2f, dann 14 Bit Breite-1 und 14 Bit Hoehe-1
      if (b[20] !== 0x2f) return null;
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) * 0x1000000);
      breite = (bits & 0x3fff) + 1;
      hoehe = ((bits >>> 14) & 0x3fff) + 1;
    } else if (ascii(12, 'VP8 ')) {
      // 3 Byte Frame-Tag, Startcode 9d 01 2a, dann 14 Bit Breite und 14 Bit Hoehe (little endian)
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      breite = u16le(26) & 0x3fff;
      hoehe = u16le(28) & 0x3fff;
    } else {
      return null;
    }
  } else if (typ === 'image/jpeg') {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) {
        i++; // Fuellbyte
        continue;
      }
      // Marker ohne Laenge
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        if (marker === 0xd9) return null;
        i += 2;
        continue;
      }
      const laenge = u16be(i + 2);
      const istSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (istSof) {
        if (i + 9 > b.length) return null;
        hoehe = u16be(i + 5);
        breite = u16be(i + 7);
        break;
      }
      if (marker === 0xda || laenge < 2) return null; // Bilddaten erreicht, ohne SOF gesehen zu haben
      i += 2 + laenge;
    }
  } else {
    return null;
  }
  return breite > 0 && hoehe > 0 ? { breite, hoehe } : null;
}

// ---------- Lesen ----------
export interface GeprueftesPack {
  // Bereinigtes Manifest (unbekannte Freischaltungen entfernt, nur bekannte Felder).
  manifest: PackManifest;
  lizenzText: string;
  groesse: number;
  // Beginn des Datenbereichs in der Datei; `offset` der Dateien zaehlt ab hier.
  datenStart: number;
  // Anzahl Dateien mit Rolle `patch`.
  patches: number;
  // Anzahl Dateien je Rolle (Phase 4). JSON-Rollen zaehlen nur, wenn die Datei als JSON lesbar war.
  rollen: Record<Rolle, number>;
  // Inhalt der JSON-Dateien (Rollen `quiz`, `texte`) als geparstes JSON, ungeprueft gegen das Schema (das prueft src/quiz/vertrag.ts
  // beim Import in speicher.ts). Fehlt die Rolle oder war die Datei kein JSON: undefined.
  json: Partial<Record<Rolle, unknown>>;
}

// Freischaltungen, deren Datei fehlt, verwerfen (eine Freischaltung gilt nur mit gueltiger Datei). `gueltig(rolle)` sagt, ob die
// Rolle vorhanden und brauchbar ist. Wird auch von speicher.ts nach der Schema-Pruefung der JSON-Dateien aufgerufen.
export function filtereFreischaltungen(freischaltungen: readonly Freischaltung[], gueltig: (rolle: Rolle) => boolean): Freischaltung[] {
  return freischaltungen.filter((f) => {
    const rolle = BENOETIGT[f];
    return rolle === null || gueltig(rolle);
  });
}

export type Fortschritt = (fertig: number, gesamt: number) => void;

async function leseExakt(quelle: PackQuelle, von: number, laenge: number, was: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await quelle.lies(von, laenge);
  } catch (e) {
    throw new PackFehler('lesefehler', `${was} nicht lesbar (${e instanceof Error ? e.message : String(e)})`);
  }
  if (bytes.byteLength !== laenge) throw new PackFehler('lesefehler', `${was}: ${bytes.byteLength} statt ${laenge} Bytes gelesen`);
  return bytes;
}

// Prueft ein rohes Manifest (geparstes JSON) und gibt das bereinigte zurueck. Wirft PackFehler.
export function pruefeManifest(roh: unknown, eigeneVersion: string, datenLaenge: number): PackManifest {
  if (!istObjekt(roh)) throw new PackFehler('manifest-ungueltig', 'Manifest ist kein Objekt');
  if (roh.format !== 'hypnomia-veil-pack') throw new PackFehler('format', 'format ist nicht "hypnomia-veil-pack"');
  if (roh.formatVersion !== 1) throw new PackFehler('format-version', `formatVersion ${String(roh.formatVersion)} wird nicht gelesen`);
  if (typeof roh.id !== 'string' || !ID_MUSTER.test(roh.id)) throw new PackFehler('id', 'id passt nicht zu ^[a-z0-9-]{1,40}$');
  if (typeof roh.version !== 'string' || !VERSION_MUSTER.test(roh.version)) throw new PackFehler('version', 'version ist keine Versionsnummer');
  if (typeof roh.titel !== 'string' || roh.titel.length === 0 || [...roh.titel].length > MAX_TITEL) {
    throw new PackFehler('titel', `titel fehlt oder ist laenger als ${MAX_TITEL} Zeichen`);
  }
  if (typeof roh.erstellt !== 'string' || roh.erstellt.length === 0 || roh.erstellt.length > 64) {
    throw new PackFehler('erstellt', 'erstellt fehlt oder ist zu lang');
  }
  if (typeof roh.mindestVeil !== 'string' || !VERSION_MUSTER.test(roh.mindestVeil)) {
    throw new PackFehler('mindest-veil', 'mindestVeil ist keine Versionsnummer');
  }
  if (versionHoeher(roh.mindestVeil, eigeneVersion)) {
    throw new PackFehler('veil-zu-alt', `Pack braucht VEIL ${roh.mindestVeil}, installiert ist ${eigeneVersion}`);
  }
  if (!Array.isArray(roh.dateien) || roh.dateien.length === 0) throw new PackFehler('dateien', 'dateien fehlt oder ist leer');
  if (roh.dateien.length > MAX_DATEIEN) throw new PackFehler('zu-viele-dateien', `mehr als ${MAX_DATEIEN} Dateien`);
  if (typeof roh.lizenz !== 'string') throw new PackFehler('lizenz', 'lizenz fehlt');
  if (!Array.isArray(roh.freischaltungen) || roh.freischaltungen.some((f) => typeof f !== 'string')) {
    throw new PackFehler('freischaltungen', 'freischaltungen ist keine Liste von Texten');
  }

  const namen = new Set<string>();
  const dateien: PackDateiEintrag[] = [];
  for (const d of roh.dateien as unknown[]) {
    if (!istObjekt(d)) throw new PackFehler('dateiangabe', 'Dateieintrag ist kein Objekt');
    const name = d.name;
    if (typeof name !== 'string' || !NAME_MUSTER.test(name) || name.includes('..')) {
      throw new PackFehler('dateiname', `Dateiname nicht erlaubt: ${typeof name === 'string' ? name.slice(0, 40) : typeof name}`);
    }
    if (namen.has(name)) throw new PackFehler('dateiname-doppelt', `Dateiname doppelt: ${name}`);
    namen.add(name);
    if (typeof d.typ !== 'string' || !(TYPEN as readonly string[]).includes(d.typ)) {
      throw new PackFehler('dateityp', `Typ nicht erlaubt: ${String(d.typ).slice(0, 40)} (${name})`);
    }
    if (!istGanzzahl(d.offset) || !istGanzzahl(d.laenge) || d.laenge < 1) {
      throw new PackFehler('dateiangabe', `offset oder laenge ungueltig (${name})`);
    }
    if (d.offset + d.laenge > datenLaenge) throw new PackFehler('bereich', `${name} reicht ueber das Dateiende hinaus`);
    if (typeof d.sha256 !== 'string' || !SHA_MUSTER.test(d.sha256)) throw new PackFehler('sha256', `sha256 hat nicht die Form 64 Hex-Zeichen (${name})`);
    const eintrag: PackDateiEintrag = { name, typ: d.typ as PackDateiEintrag['typ'], offset: d.offset, laenge: d.laenge, sha256: d.sha256 };
    if (d.rolle !== undefined) {
      if (typeof d.rolle !== 'string') throw new PackFehler('rolle', `Rolle ist kein Text (${name})`);
      // Unbekannte Rollen (aus spaeteren Versionen) verwerfen statt ablehnen (Entscheidung 100): die Datei bleibt ohne Rolle.
      if ((ROLLEN as readonly string[]).includes(d.rolle)) eintrag.rolle = d.rolle as Rolle;
    }
    if (d.stufe !== undefined) {
      if (typeof d.stufe !== 'string' || !(STUFEN as readonly string[]).includes(d.stufe)) throw new PackFehler('stufe', `Stufe unbekannt (${name})`);
      eintrag.stufe = d.stufe as Stufe;
    }
    if (eintrag.rolle && BILD_ROLLEN.includes(eintrag.rolle) && !istBild(eintrag.typ)) {
      throw new PackFehler('rolle', `Rolle ${eintrag.rolle} nur fuer Bilder (${name})`);
    }
    if (eintrag.rolle && JSON_ROLLEN.includes(eintrag.rolle) && eintrag.typ !== 'application/json') {
      throw new PackFehler('rolle', `Rolle ${eintrag.rolle} nur fuer application/json (${name})`);
    }
    if (eintrag.rolle === 'vorschau' && !eintrag.stufe) throw new PackFehler('stufe', `Rolle vorschau braucht eine Stufe (${name})`);
    // Phase 5: Werbebilder nennen ihr Format; `format` gibt es nur bei der Rolle `werbung` (bei anderen Rollen wird es ignoriert). Ohne
    // bekanntes Format (fehlt, oder ein Format einer spaeteren Version) verliert nur diese Datei ihre Rolle, das Pack bleibt gueltig
    // (vorwaertsvertraeglich wie bei unbekannten Rollen, Entscheidung 100).
    if (eintrag.rolle === 'werbung') {
      if (typeof d.format === 'string' && (WERBE_FORMATE as readonly string[]).includes(d.format)) eintrag.format = d.format as WerbeFormat;
      else delete eintrag.rolle;
    }
    dateien.push(eintrag);
  }

  // Ueberlappung: nach Beginn sortieren, jeder Bereich muss hinter dem vorigen beginnen.
  const sortiert = [...dateien].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sortiert.length; i++) {
    const vorher = sortiert[i - 1]!;
    if (sortiert[i]!.offset < vorher.offset + vorher.laenge) {
      throw new PackFehler('ueberlappung', `${vorher.name} und ${sortiert[i]!.name} ueberlappen`);
    }
  }

  // JSON-Rollen hoechstens einmal.
  for (const rolle of JSON_ROLLEN) {
    const anzahl = dateien.filter((d) => d.rolle === rolle).length;
    if (anzahl > 1) throw new PackFehler('rolle', `Rolle ${rolle} hoechstens einmal, gefunden ${anzahl}`);
  }

  // Genau eine Lizenzdatei: Rolle `lizenz`, Typ text/plain, `lizenz` zeigt darauf.
  const lizenzen = dateien.filter((d) => d.rolle === 'lizenz');
  const lizenzEintrag = lizenzen[0];
  if (lizenzen.length !== 1 || !lizenzEintrag) throw new PackFehler('lizenz', `erwartet genau eine Lizenzdatei, gefunden ${lizenzen.length}`);
  if (lizenzEintrag.typ !== 'text/plain') throw new PackFehler('lizenz', 'Lizenzdatei muss text/plain sein');
  if (roh.lizenz !== lizenzEintrag.name) throw new PackFehler('lizenz', '"lizenz" zeigt nicht auf die Datei mit Rolle lizenz');

  // Unbekannte Freischaltungen verwerfen, Doppelte entfernen.
  const freischaltungen = [...new Set(roh.freischaltungen as string[])].filter((f): f is Freischaltung =>
    (BEKANNTE_FREISCHALTUNGEN as readonly string[]).includes(f),
  );

  return {
    format: 'hypnomia-veil-pack',
    formatVersion: 1,
    id: roh.id,
    version: roh.version,
    titel: roh.titel,
    erstellt: roh.erstellt,
    mindestVeil: roh.mindestVeil,
    lizenz: lizenzEintrag.name,
    freischaltungen,
    dateien,
  };
}

// Liest und prueft ein Pack vollstaendig (Kopf, Manifest, jede Datei: Hash, Signatur, UTF-8). Wirft PackFehler bei der ersten
// Abweichung; gespeichert wird hier nichts. `eigeneVersion`: Version der Erweiterung (fuer `mindestVeil`).
export async function pruefePack(quelle: PackQuelle, eigeneVersion: string, fortschritt?: Fortschritt): Promise<GeprueftesPack> {
  const groesse = quelle.groesse;
  if (groesse < KOPF_BYTES) throw new PackFehler('zu-klein', 'Datei kuerzer als der Kopf');
  if (groesse > MAX_GESAMT_BYTES) throw new PackFehler('zu-gross', `Datei groesser als ${MAX_GESAMT_BYTES} Bytes`);

  const kopf = await leseExakt(quelle, 0, KOPF_BYTES, 'Kopf');
  for (let i = 0; i < PACK_KENNUNG.length; i++) {
    if (kopf[i] !== PACK_KENNUNG.charCodeAt(i)) throw new PackFehler('kennung', 'Kennung MIAPACK1 fehlt');
  }
  const L = new DataView(kopf.buffer, kopf.byteOffset, kopf.byteLength).getUint32(8, true);
  if (L > MAX_MANIFEST_BYTES) throw new PackFehler('manifest-groesse', `Manifest groesser als ${MAX_MANIFEST_BYTES} Bytes`);
  if (L === 0 || KOPF_BYTES + L > groesse) throw new PackFehler('manifest-groesse', 'Manifest reicht ueber das Dateiende hinaus');

  const manifestBytes = await leseExakt(quelle, KOPF_BYTES, L, 'Manifest');
  let roh: unknown;
  try {
    roh = JSON.parse(dekodiereUtf8(manifestBytes, 'Manifest'));
  } catch (e) {
    if (e instanceof PackFehler) throw e;
    throw new PackFehler('manifest-ungueltig', 'Manifest ist kein gueltiges JSON');
  }
  const datenStart = KOPF_BYTES + L;
  const manifest = pruefeManifest(roh, eigeneVersion, groesse - datenStart);

  // Gesamtgroesse der Dateien (zusaetzlich zur Dateigroesse: Summe der Bereiche darf die Grenze nicht reissen).
  const summe = manifest.dateien.reduce((s, d) => s + d.laenge, 0);
  if (summe > MAX_GESAMT_BYTES) throw new PackFehler('zu-gross', 'Dateien zusammen groesser als die Grenze');

  // Jede Datei lesen, Hash vergleichen, Signatur bzw. UTF-8 pruefen. Nach Dateiposition, damit der Lesekopf nur vorwaerts laeuft.
  let lizenzText = '';
  let patches = 0;
  const rollen = Object.fromEntries(ROLLEN.map((r) => [r, 0])) as Record<Rolle, number>;
  const json: Partial<Record<Rolle, unknown>> = {};
  const reihenfolge = [...manifest.dateien].sort((a, b) => a.offset - b.offset);
  let fertig = 0;
  fortschritt?.(0, reihenfolge.length);
  for (const d of reihenfolge) {
    const bytes = await leseExakt(quelle, datenStart + d.offset, d.laenge, d.name);
    if ((await sha256Hex(bytes)) !== d.sha256) throw new PackFehler('sha256', `Pruefsumme stimmt nicht: ${d.name}`);
    if (istBild(d.typ)) {
      if (!signaturPasst(d.typ, bytes)) throw new PackFehler('signatur', `Bild passt nicht zum Typ ${d.typ}: ${d.name}`);
      const masse = leseBildmasse(d.typ, bytes.subarray(0, BILDKOPF_BYTES));
      if (!masse) throw new PackFehler('bildmasse', `Bildmasse nicht lesbar (nicht in den ersten ${BILDKOPF_BYTES} Bytes): ${d.name}`);
      if (masse.breite > MAX_BILD_SEITE || masse.hoehe > MAX_BILD_SEITE) {
        throw new PackFehler('bild-zu-gross', `Bild ${d.name} ist ${masse.breite} x ${masse.hoehe}, erlaubt sind ${MAX_BILD_SEITE} je Seite`);
      }
    } else {
      const text = dekodiereUtf8(bytes, d.name);
      if (d.rolle === 'lizenz') lizenzText = text;
      if (d.rolle && JSON_ROLLEN.includes(d.rolle)) {
        // Kaputtes JSON lehnt das Pack nicht ab: die Rolle zaehlt dann nicht, ihre Freischaltungen fallen weg.
        try {
          json[d.rolle] = JSON.parse(text);
        } catch {
          json[d.rolle] = undefined;
        }
      }
    }
    if (d.rolle === 'patch') patches++;
    if (d.rolle && (!JSON_ROLLEN.includes(d.rolle) || json[d.rolle] !== undefined)) rollen[d.rolle]++;
    fertig++;
    fortschritt?.(fertig, reihenfolge.length);
  }
  if (lizenzText.trim().length === 0) throw new PackFehler('lizenz', 'Lizenztext ist leer');
  const gefiltert: PackManifest = { ...manifest, freischaltungen: filtereFreischaltungen(manifest.freischaltungen as Freischaltung[], (r) => rollen[r] > 0) };
  return { manifest: gefiltert, lizenzText, groesse, datenStart, patches, rollen, json };
}

// ---------- Schreiben ----------
export interface PackDateiEingabe {
  name: string;
  typ: PackDateiEintrag['typ'];
  daten: Uint8Array;
  rolle?: Rolle;
  stufe?: Stufe;
  format?: WerbeFormat;
}

export interface PackKopfEingabe {
  id: string;
  version: string;
  titel: string;
  erstellt: string;
  mindestVeil: string;
  freischaltungen: string[];
}

// Setzt Kopf, Manifest und Datenbereich zusammen. Fuer Tests auch mit absichtlich fehlerhaftem Manifest nutzbar.
export function baueContainer(manifestJson: string, datenbereich: Uint8Array, kennung: string = PACK_KENNUNG): Uint8Array {
  const manifestBytes = new TextEncoder().encode(manifestJson);
  const aus = new Uint8Array(KOPF_BYTES + manifestBytes.byteLength + datenbereich.byteLength);
  for (let i = 0; i < 8; i++) aus[i] = kennung.charCodeAt(i) || 0;
  new DataView(aus.buffer).setUint32(8, manifestBytes.byteLength, true);
  aus.set(manifestBytes, KOPF_BYTES);
  aus.set(datenbereich, KOPF_BYTES + manifestBytes.byteLength);
  return aus;
}

// Schreibt ein Pack: Dateien nacheinander in den Datenbereich, Hash und Offsets ins Manifest. Die Lizenzdatei ist die
// Datei mit Rolle `lizenz`. Das Ergebnis wird nicht noch einmal geprueft (das macht pruefePack beim Lesen).
export async function schreibePack(kopf: PackKopfEingabe, dateien: readonly PackDateiEingabe[]): Promise<Uint8Array> {
  const lizenz = dateien.filter((d) => d.rolle === 'lizenz');
  if (lizenz.length !== 1) throw new PackFehler('lizenz', `erwartet genau eine Datei mit Rolle lizenz, gefunden ${lizenz.length}`);
  const eintraege: PackDateiEintrag[] = [];
  let offset = 0;
  for (const d of dateien) {
    const eintrag: PackDateiEintrag = {
      name: d.name,
      typ: d.typ,
      offset,
      laenge: d.daten.byteLength,
      sha256: await sha256Hex(d.daten),
    };
    if (d.rolle) eintrag.rolle = d.rolle;
    if (d.stufe) eintrag.stufe = d.stufe;
    if (d.format) eintrag.format = d.format;
    eintraege.push(eintrag);
    offset += d.daten.byteLength;
  }
  const daten = new Uint8Array(offset);
  dateien.forEach((d, i) => daten.set(d.daten, eintraege[i]!.offset));
  const manifest: PackManifest = {
    format: 'hypnomia-veil-pack',
    formatVersion: 1,
    id: kopf.id,
    version: kopf.version,
    titel: kopf.titel,
    erstellt: kopf.erstellt,
    mindestVeil: kopf.mindestVeil,
    lizenz: lizenz[0]!.name,
    freischaltungen: kopf.freischaltungen,
    dateien: eintraege,
  };
  return baueContainer(JSON.stringify(manifest), daten);
}

// Hash fuer Tests und Bau-Skript.
export const sha256 = sha256Hex;
