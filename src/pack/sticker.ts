// Sticker fuer den Erkenner (STICKER-BAUPLAN Stufe A, nach dem Muster von patches.ts). Laeuft im Erkenner-Kontext (Chrome Offscreen,
// Firefox Hintergrund), liest nur aus IndexedDB, nie aus storage.
// - Stand (`importiert` und die Namen der Sticker) liegt im kleinen Eintrag `stand` im Speicher `meta` und wird hoechstens einmal je Sekunde
//   gelesen; ein Import oder Entfernen meldet sich per BroadcastChannel und macht den Stand sofort ungueltig. Die Namen kommen nur mit
//   `zensur:sticker` ins Stand (db.ts standAusMeta, Regel S5): ohne Freischaltung gibt es hier nie einen Sticker.
// - Dekodierte Sticker bleiben im Speicher (hoechstens 16, laengste Seite 512). Wer einen Sticker zeichnet, leiht ihn (`freigeben()`).
// - Wahl stabil je Schluessel (Start bei hashe(schluessel) % n), bei Dekodierfehler der naechste, hoechstens MAX_VERSUCHE. Ein nicht
//   dekodierbarer Sticker wird je Stand des Packs vergessen (kein ewiges Neuversuchen). Fehlt alles, liefert `waehleSticker` null: die Flaeche
//   steht dann ohne Sticker (Hide-first, Regel S2).

import { horchePackGeaendert, leseDatei, leseStandAus, mitDb, mitLesePlatz, type PackStand } from './db';
import { MAX_BILD_SEITE, leseBildmasse, BILDKOPF_BYTES } from './format';
import { Zwischenspeicher, type Leihe } from './leihe';
import { STICKER_MAX_VERSUCHE, waehleNaechsten } from '../sticker.ts';

// Laengste Seite eines gehaltenen Stickers (Sticker im Pack sind hoechstens 512 px, groessere werden verkleinert).
export const STICKER_MAX_SEITE = 512;
const MAX_IM_SPEICHER = 16;
const LESE_ABSTAND_MS = 1000;

let stand: number | null = null; // `importiert` des Packs mit Stickern, null = keins oder ohne Sticker
let gelesen = 0; // `importiert` des zuletzt gelesenen Packs (0 = keins)
let erzwungenFuer: number | null = null;
let namen: string[] = [];
let generation = 0;
const dekodiert = new Zwischenspeicher<ImageBitmap>(MAX_IM_SPEICHER);
// Namen, die in diesem Stand nicht dekodierbar waren.
const kaputt = new Set<string>();
const laufend = new Map<string, Promise<unknown>>();

let ungueltig = true;
let letzteLese = -Infinity;
let leseLauf: Promise<void> | null = null;
let horcht = false;

function uebernimm(neu: PackStand | null): void {
  gelesen = neu ? neu.importiert : 0;
  const liste = neu && Array.isArray(neu.sticker) ? neu.sticker : [];
  const neuerStand = neu && liste.length > 0 ? neu.importiert : null;
  if (neuerStand === stand) return;
  generation++;
  dekodiert.leere();
  kaputt.clear();
  stand = neuerStand;
  namen = neuerStand !== null ? [...liste] : [];
}

async function aktualisiere(packStand?: number): Promise<boolean> {
  if (!horcht) {
    horcht = true;
    horchePackGeaendert(() => {
      ungueltig = true;
    });
  }
  if (typeof packStand === 'number' && packStand !== gelesen && packStand !== erzwungenFuer) {
    erzwungenFuer = packStand;
    ungueltig = true;
  }
  if (!ungueltig && performance.now() - letzteLese < LESE_ABSTAND_MS) return namen.length > 0;
  if (!leseLauf) {
    ungueltig = false;
    leseLauf = (async () => {
      try {
        uebernimm(await mitDb(leseStandAus));
        letzteLese = performance.now();
      } catch (e) {
        ungueltig = true;
        throw e;
      }
    })().finally(() => {
      leseLauf = null;
    });
  }
  await leseLauf;
  return namen.length > 0;
}

async function dekodiereNeu(name: string): Promise<Leihe<ImageBitmap> | null> {
  const meine = generation;
  const datei = await leseDatei(name);
  if (!datei) return null;
  const masse = leseBildmasse(datei.typ, new Uint8Array(await datei.blob.slice(0, BILDKOPF_BYTES).arrayBuffer()));
  if (!masse || masse.breite > MAX_BILD_SEITE || masse.hoehe > MAX_BILD_SEITE) return null;
  const skala = Math.min(1, STICKER_MAX_SEITE / Math.max(masse.breite, masse.hoehe));
  let bild: ImageBitmap;
  try {
    bild =
      skala < 1
        ? await createImageBitmap(datei.blob, {
            resizeWidth: Math.max(1, Math.round(masse.breite * skala)),
            resizeHeight: Math.max(1, Math.round(masse.hoehe * skala)),
            resizeQuality: 'high',
          })
        : await createImageBitmap(datei.blob);
  } catch {
    return null;
  }
  // Wurde das Pack waehrend des Dekodierens gewechselt, wird das Bild nicht abgelegt (es schliesst mit der Leihe).
  return dekodiert.lege(name, bild, meine === generation);
}

async function dekodiere(name: string): Promise<Leihe<ImageBitmap> | null> {
  const gemerkt = dekodiert.hole(name);
  if (gemerkt) return gemerkt;
  const schluessel = `${generation}|${name}`;
  const andere = laufend.get(schluessel);
  if (andere) {
    await andere.catch(() => {});
    return dekodiert.hole(name);
  }
  const arbeit = mitLesePlatz(() => dekodiereNeu(name)).finally(() => {
    laufend.delete(schluessel);
  });
  laufend.set(schluessel, arbeit);
  return arbeit;
}

export interface StickerWahl {
  name: string;
  bild: CanvasImageSource;
  // Nach dem Zeichnen aufrufen: erst dann darf ein verworfenes Bild schliessen.
  freigeben(): void;
}

// Waehlt je Schluessel ein Sticker-Bild, stabil: derselbe Schluessel liefert denselben Sticker, solange das Pack gleich bleibt (und der Sticker
// dekodierbar ist). `wahl: null`: kein Pack, keine Freischaltung `zensur:sticker`, keine Sticker oder keiner dekodierbar. `fehler: true`: die Datenbank
// hat nicht geantwortet (Lesefehler oder Zeitgrenze): der Aufrufer fordert fuer diese Pruefung nichts weiter an. `packStand`: `importiert` des Packs, das
// der Aufrufer kennt (0 = keins); weicht es vom gelesenen Stand ab, wird sofort neu gelesen.
export async function waehleSticker(schluessel: string, packStand?: number): Promise<{ wahl: StickerWahl | null; fehler: boolean }> {
  let da: boolean;
  try {
    da = await aktualisiere(packStand);
  } catch {
    return { wahl: null, fehler: true };
  }
  if (!da) return { wahl: null, fehler: false };
  const meine = generation;
  const r = await waehleNaechsten<Leihe<ImageBitmap>>(schluessel, namen, kaputt, async (name) => {
    const leihe = await dekodiere(name); // wirft bei Lesefehler und Zeitgrenze
    // nicht dekodierbar fuer einen Stand, der inzwischen gewechselt hat: nicht vergessen (der Name gehoert zum alten Stand)
    if (!leihe && meine !== generation) throw new Error('Stand gewechselt');
    return leihe;
  });
  if (r.wert) return { wahl: { name: r.wert.name, bild: r.wert.wert.wert, freigeben: r.wert.wert.freigeben }, fehler: false };
  return { wahl: null, fehler: r.fehler };
}

// Fuer Tests: wie viele Sticker gerade dekodiert gehalten werden.
export function anzahlStickerImSpeicher(): number {
  return dekodiert.groesse;
}
