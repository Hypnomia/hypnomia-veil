// Bilder aus dem Pack fuer das Content-Script (Auftrag E, PHASE-4-BAUPLAN Abschnitt 8 Punkt 1). Laeuft im Erkenner-Kontext (Chrome
// Offscreen, Firefox Hintergrund), liest aus IndexedDB (src/pack/db.ts: leseMeta, leseDatei), verkleinert auf PACKBILD_MAX_SEITE (Chibi
// PACKBILD_MAX_SEITE_CHIBI) und liefert eine Data-URL. Vertrag: NachrichtErkennerPackBild in src/nachrichten.ts.
// - Vorschau: nur mit Freischaltung `erwachsen:vorschau` im Meta; JPEG. Wahl nach Stufe (kumulativ, nie schaerfer als `stufe` der Nachricht) und
//   Seitenverhaeltnis der Flaeche, dann stabil per Hash des Schluessels (Quelladresse); Logik in src/pack/wahl.ts. Der Zwischenspeicher
//   (`fertig`) haelt das Ergebnis je Datei und Kantenlaenge: weil die Wahl von Stufe und Klasse vor dem Nachschlagen laeuft, landet ein
//   Stufenwechsel von selbst bei anderen Dateien, ohne dass alte Eintraege das falsche Bild liefern koennten.
// - Chibi: Schluessel = Pose. Mit `chibi:pack` ein passendes Pack-Chibi (passtZurPose), sonst das Demo-Chibi `/chibi/<pose>.webp` aus der
//   Erweiterung, fehlt beides `ok: false`. Chibis behalten ihre Transparenz (WebP oder PNG).
// Das Ergebnis je Datei bleibt im Speicher (kleine Menge), der Meta-Stand wird hoechstens einmal je Sekunde gelesen und bei einer Meldung
// ueber ein geaendertes Pack sofort neu.
import { CHIBI_DEMO_ORDNER, CHIBI_POSEN, passtZurPose, type ChibiPose } from '../chibi';
import {
  PACKBILD_MAX_BYTES,
  PACKBILD_MAX_SEITE,
  PACKBILD_MAX_SEITE_CHIBI,
  PACKBILD_MAX_SEITE_WERBUNG,
  type AntwortFehler,
  type AntwortPackBild,
  type NachrichtErkennerPackBild,
} from '../nachrichten';
import { horchePackGeaendert, leseDatei, leseMeta, mitLesePlatz } from '../pack/db';
import { BILDKOPF_BYTES, MAX_BILD_SEITE, leseBildmasse } from '../pack/format';
import { hashe } from '../pack/patches';
import { waehleVorschauNamen } from '../pack/wahl';
import { STUFEN_WAHL, type StufeWahl } from '../einstellungen';
import { formatMasse, WERBE_FORMATE, type Freischaltung, type PackMeta, type WerbeFormat } from '../pack/vertrag';

const LESE_ABSTAND_MS = 1000;
const MAX_IM_SPEICHER = 24;
const JPEG_STUFEN = [0.85, 0.7, 0.55, 0.4];

const fehler = (text: string): AntwortFehler => ({ ok: false, fehler: text });
const frei = (meta: PackMeta, f: Freischaltung) => Array.isArray(meta.freischaltungen) && meta.freischaltungen.includes(f);

// ---------- Stand (Meta) mit kurzer Gueltigkeit ----------

let meta: PackMeta | null = null;
let gelesenUm = -Infinity;
let ungueltig = true;
let horcht = false;
let leseLauf: Promise<PackMeta | null> | null = null;
const fertig = new Map<string, AntwortPackBild>();
// Laufende Verkleinerungen je Lauf, Art, Kantenlaenge und Datei (gleichzeitige Anfragen teilen sie).
const laufend = new Map<string, Promise<{ dataUrl: string; breite: number; hoehe: number } | null>>();
// Werbebilder haben einen eigenen Speicher: sie verdraengen keine Vorschau-Eintraege.
const fertigWerbung = new Map<string, AntwortPackBild>();
// Zaehlt jeden Wechsel des Packs (und jede Meldung darueber): ein Lauf, der mit Blob oder Namen des alten Packs begann, legt nichts mehr ab.
let generation = 0;

async function ladeMeta(erzwingen = false): Promise<PackMeta | null> {
  if (erzwingen) ungueltig = true;
  if (!horcht) {
    horcht = true;
    horchePackGeaendert(() => {
      ungueltig = true;
      generation++;
      fertig.clear();
      fertigWerbung.clear();
    });
  }
  if (!ungueltig && performance.now() - gelesenUm < LESE_ABSTAND_MS) return meta;
  if (!leseLauf) {
    ungueltig = false; // eine Meldung waehrend des Lesens macht den Stand gleich wieder ungueltig
    leseLauf = leseMeta()
      .then((neu) => {
        if ((neu?.importiert ?? null) !== (meta?.importiert ?? null) || neu?.id !== meta?.id) { fertig.clear(); fertigWerbung.clear(); generation++; }
        meta = neu;
        gelesenUm = performance.now();
        return neu;
      })
      .catch((e) => {
        ungueltig = true;
        throw e;
      })
      .finally(() => {
        leseLauf = null;
      });
  }
  const gelesen = await leseLauf;
  // Meldete sich waehrend des Lesens ein geaendertes Pack, ist das Ergebnis schon veraltet: noch einmal lesen.
  return ungueltig && !erzwingen ? ladeMeta() : gelesen;
}

// ---------- Bild verkleinern und kodieren ----------

function neueLeinwand(b: number, h: number): { zeichne: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; kodiere(typ: string, q?: number): Promise<string> } {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = b;
    c.height = h;
    return { zeichne: c.getContext('2d')!, kodiere: async (typ, q) => c.toDataURL(typ, q) };
  }
  const c = new OffscreenCanvas(b, h);
  return {
    zeichne: c.getContext('2d')!,
    kodiere: async (typ, q) =>
      new Promise<string>((ok, fehl) => {
        c.convertToBlob({ type: typ, quality: q }).then((blob) => {
          const leser = new FileReader();
          leser.onload = () => ok(String(leser.result));
          leser.onerror = () => fehl(leser.error ?? new Error('Lesefehler'));
          leser.readAsDataURL(blob);
        }, fehl);
      }),
  };
}

// Dekodiert verkleinert (laengste Seite hoechstens maxSeite) und kodiert: Vorschau als JPEG, Chibi mit Transparenz.
async function verkleinere(blob: Blob, typ: string, maxSeite: number, mitAlpha: boolean): Promise<{ dataUrl: string; breite: number; hoehe: number } | null> {
  const masse = leseBildmasse(typ as never, new Uint8Array(await blob.slice(0, BILDKOPF_BYTES).arrayBuffer()));
  if (!masse || masse.breite > MAX_BILD_SEITE || masse.hoehe > MAX_BILD_SEITE) return null;
  // Immer ueber die Leinwand neu kodieren (keine Rohbytes aus dem Pack in die Seite).
  const skala = Math.min(1, maxSeite / Math.max(masse.breite, masse.hoehe));
  const b = Math.max(1, Math.round(masse.breite * skala));
  const h = Math.max(1, Math.round(masse.hoehe * skala));
  const bitmap = await createImageBitmap(blob, skala < 1 ? { resizeWidth: b, resizeHeight: h, resizeQuality: 'high' } : undefined);
  try {
    const l = neueLeinwand(b, h);
    if (!mitAlpha) {
      // JPEG kennt keine Transparenz: auf Weiss zeichnen, damit nichts Schwarzes entsteht.
      (l.zeichne as CanvasRenderingContext2D).fillStyle = '#fff';
      (l.zeichne as CanvasRenderingContext2D).fillRect(0, 0, b, h);
    }
    (l.zeichne as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, b, h);
    if (mitAlpha) {
      for (const art of ['image/webp', 'image/png']) {
        const url = await l.kodiere(art, 0.9);
        if (url.startsWith(`data:${art}`) && url.length <= PACKBILD_MAX_BYTES) return { dataUrl: url, breite: b, hoehe: h };
      }
      return null;
    }
    for (const q of JPEG_STUFEN) {
      const url = await l.kodiere('image/jpeg', q);
      if (url.startsWith('data:image/jpeg') && url.length <= PACKBILD_MAX_BYTES) return { dataUrl: url, breite: b, hoehe: h };
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function merke(schluessel: string, antwort: AntwortPackBild, lauf: number, speicher: Map<string, AntwortPackBild> = fertig): void {
  if (lauf !== generation) return;
  if (speicher.size >= MAX_IM_SPEICHER) speicher.delete(speicher.keys().next().value as string);
  speicher.set(schluessel, antwort);
}

// Waehlt stabil (Hash des Schluessels) und versucht bei einer nicht lesbaren Datei die naechsten.
async function ausPack(
  namen: string[],
  schluessel: string,
  maxSeite: number,
  mitAlpha: boolean,
  speicher: Map<string, AntwortPackBild> = fertig,
  geordnet = false, // true: `namen` ist schon in der Versuchsreihenfolge (Vorschau, src/pack/wahl.ts)
): Promise<AntwortPackBild | null> {
  if (!namen.length) return null;
  const lauf = generation;
  const start = geordnet ? 0 : hashe(schluessel) % namen.length;
  for (let i = 0; i < Math.min(4, namen.length); i++) {
    const name = namen[(start + i) % namen.length]!;
    const zwischen = `${mitAlpha ? 'c' : 'v'}|${maxSeite}|${name}`;
    const gemerkt = speicher.get(zwischen);
    if (gemerkt) return gemerkt;
    try {
      // Gleichzeitige Anfragen fuer dieselbe Datei und Kantenlaenge teilen eine laufende Arbeit (Schluessel mit Lauf, damit ein
      // ersetztes Pack nie ein altes Ergebnis teilt); insgesamt hoechstens 4 Lesungen gleichzeitig (mitLesePlatz).
      const laufSchluessel = `${lauf}|${mitAlpha ? 'c' : 'v'}|${maxSeite}|${name}`;
      let arbeit = laufend.get(laufSchluessel);
      if (!arbeit) {
        arbeit = mitLesePlatz(async () => {
          const datei = await leseDatei(name);
          if (!datei || !datei.typ.startsWith('image/')) return null;
          return verkleinere(datei.blob, datei.typ, maxSeite, mitAlpha);
        }).finally(() => {
          laufend.delete(laufSchluessel);
        });
        laufend.set(laufSchluessel, arbeit);
      }
      const k = await arbeit;
      if (!k) continue;
      const antwort: AntwortPackBild = { ok: true, dataUrl: k.dataUrl, breite: k.breite, hoehe: k.hoehe, name };
      merke(zwischen, antwort, lauf, speicher);
      return antwort;
    } catch {
      // naechstes Bild versuchen
    }
  }
  return null;
}

// Demo-Chibi aus der Erweiterung (ohne Pack).
async function demoChibi(pose: ChibiPose, maxSeite: number): Promise<AntwortPackBild | null> {
  const zwischen = `d|${maxSeite}|${pose}`;
  const lauf = generation;
  const gemerkt = fertig.get(zwischen);
  if (gemerkt) return gemerkt;
  try {
    const url = (browser.runtime.getURL as (pfad: string) => string)(`/${CHIBI_DEMO_ORDNER}/${pose}.webp`);
    const antwort = await fetch(url);
    if (!antwort.ok) return null;
    const blob = await antwort.blob();
    const k = await verkleinere(blob, 'image/webp', maxSeite, true);
    if (!k) return null;
    const ergebnis: AntwortPackBild = { ok: true, dataUrl: k.dataUrl, breite: k.breite, hoehe: k.hoehe, name: `${CHIBI_DEMO_ORDNER}/${pose}.webp` };
    merke(zwischen, ergebnis, lauf);
    return ergebnis;
  } catch {
    return null;
  }
}

function begrenze(wunsch: number | undefined, standard: number): number {
  return typeof wunsch === 'number' && Number.isFinite(wunsch) ? Math.min(standard, Math.max(32, Math.round(wunsch))) : standard;
}

export async function lieferePackBild(n: NachrichtErkennerPackBild): Promise<AntwortPackBild | AntwortFehler> {
  try {
    if (typeof n.schluessel !== 'string' || n.schluessel.length === 0 || n.schluessel.length > 2048) return fehler('Schluessel fehlt oder ist zu lang');
    let m = await ladeMeta();
    // Kein Pack oder keine Freischaltung kann auch ein veralteter Stand sein (die Meldung ueber ein neues Pack kommt nicht immer an):
    // einmal frisch lesen, bevor die Antwort negativ ausfaellt.
    const braucht: Freischaltung = n.rolle === 'vorschau' ? 'erwachsen:vorschau' : n.rolle === 'werbung' ? 'kontrolle:werbung' : 'chibi:pack';
    if (!m || !frei(m, braucht)) m = await ladeMeta(true);
    if (n.rolle === 'vorschau') {
      if (!m || !frei(m, 'erwachsen:vorschau')) return fehler('keine Vorschau-Bilder freigeschaltet');
      // Fehlt die Stufe oder ist sie unbekannt, gilt die mildeste ("unbekannt ergibt hot" gilt nur fuer die gespeicherte Einstellung).
      const stufe: StufeWahl = (STUFEN_WAHL as readonly unknown[]).includes(n.stufe) ? (n.stufe as StufeWahl) : 'tease';
      const namen = waehleVorschauNamen(
        m.dateien.filter((d) => d.rolle === 'vorschau' && d.typ.startsWith('image/')),
        stufe,
        n.schluessel,
        n.breite,
        n.hoehe,
      );
      if (!namen.length) return fehler('kein Vorschau-Bild in dieser Stufe');
      const a = await ausPack(namen, n.schluessel, begrenze(n.maxSeite, PACKBILD_MAX_SEITE), false, fertig, true);
      return a ?? fehler('kein Vorschau-Bild lesbar');
    }
    if (n.rolle === 'werbung') {
      // Phase 5 (Auftrag W): Werbebild fuer das Format der Flaeche; stabil per Schluessel, ohne Bild dieses Formats das naechste Seitenverhaeltnis.
      if (!m || !frei(m, 'kontrolle:werbung')) return fehler('keine Werbung freigeschaltet');
      const format = (WERBE_FORMATE as readonly string[]).includes(n.format as string) ? (n.format as WerbeFormat) : null;
      if (!format) return fehler('Format fehlt');
      const bilder = m.dateien.filter((d) => d.rolle === 'werbung' && d.typ.startsWith('image/') && !!d.format);
      const verh = (f: WerbeFormat) => {
        const x = formatMasse(f);
        return x.breite / x.hoehe;
      };
      const soll = verh(format);
      // Reihenfolge: erst Bilder dieses Formats, dann die Formate nach naechstem Seitenverhaeltnis (auch wenn die ersten nicht lesbar sind).
      const formate = [...new Set(bilder.map((d) => d.format!))].sort((x, y) => (x === format ? -1 : y === format ? 1 : Math.abs(Math.log(verh(x) / soll)) - Math.abs(Math.log(verh(y) / soll))));
      let a: AntwortPackBild | null = null;
      for (const f of formate) {
        const namen = bilder.filter((d) => d.format === f).map((d) => d.name).sort();
        a = await ausPack(namen, n.schluessel, begrenze(n.maxSeite, PACKBILD_MAX_SEITE_WERBUNG), false, fertigWerbung);
        if (a) break;
      }
      return a ?? fehler('kein Werbebild lesbar');
    }
    if (n.rolle === 'chibi') {
      const pose = (CHIBI_POSEN as readonly string[]).includes(n.schluessel) ? (n.schluessel as ChibiPose) : null;
      if (!pose) return fehler('unbekannte Pose');
      const maxSeite = begrenze(n.maxSeite, PACKBILD_MAX_SEITE_CHIBI);
      if (m && frei(m, 'chibi:pack')) {
        const namen = m.dateien.filter((d) => d.rolle === 'chibi' && d.typ.startsWith('image/') && passtZurPose(d.name, pose)).map((d) => d.name).sort();
        const a = await ausPack(namen, pose, maxSeite, true);
        if (a) return a;
      }
      return (await demoChibi(pose, maxSeite)) ?? fehler('kein Chibi fuer diese Pose');
    }
    return fehler('unbekannte Rolle');
  } catch (e) {
    return fehler(String((e as Error)?.message ?? e));
  }
}
