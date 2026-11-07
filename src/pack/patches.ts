// Patch-Bilder fuer den Erkenner (PHASE-2-BAUPLAN Abschnitt 9.4 und 9.7). Liest nur aus IndexedDB (Offscreen-Dokument bzw.
// Firefox-Hintergrund, gleicher Ursprung wie die Einstellungsseite), nie aus storage.
// - Eine dauerhafte Verbindung, nicht eine je Flaeche. Der Stand (`importiert` und die Namen der Patch-Bilder) liegt als kleiner Eintrag
//   `stand` im Speicher `meta` und wird hoechstens einmal je Sekunde gelesen; ein Import oder Entfernen meldet sich ausserdem per
//   BroadcastChannel und macht den Stand sofort ungueltig.
// - Dekodierte Bilder bleiben im Speicher (hoechstens 12, laengste Seite 1024), beim Dekodieren verkleinert. Wer ein Bild zeichnet, leiht es
//   (`PatchWahl.freigeben()`); verworfene Bilder schliessen erst, wenn die letzte Leihe zurueck ist (leihe.ts).
// Fehlt etwas, liefert `waehlePatch` null (der Erkenner zeichnet dann Mosaik).

import { PACK_STORE_DATEIEN, type PackDateiGespeichert } from './vertrag';
import { anfrage, horchePackGeaendert, kopiereBlob, MAX_LESE_BYTES, leseStandAus, mitLesePlatz, oeffneDb, type PackStand } from './db';
import { BILDKOPF_BYTES, MAX_BILD_SEITE, leseBildmasse } from './format';
import { Zwischenspeicher, type Leihe } from './leihe';
import { hashe } from './hash';

// Laengste Seite eines gehaltenen Patch-Bildes: groesser als jede sinnvolle Flaeche, aber klein genug fuer den Speicher.
const MAX_SEITE = 1024;
// Hoechstens so viele dekodierte Bilder gleichzeitig im Speicher (aeltestes fliegt raus).
const MAX_IM_SPEICHER = 12;
// Wie oft nach einem nicht dekodierbaren Bild das naechste versucht wird.
const MAX_ERSATZ = 3;
// So alt darf der gelesene Stand hoechstens sein, ohne dass eine Meldung ihn ungueltig gemacht hat.
const LESE_ABSTAND_MS = 1000;

let stand: number | null = null; // `importiert` des geladenen Packs, null = keins
// `importiert` des zuletzt gelesenen Packs, auch ohne Patch-Bilder (0 = kein Pack): Vergleichswert fuer `packStand` aus der Anfrage.
let gelesen = 0;
// Fuer welchen `packStand` aus einer Anfrage schon neu gelesen wurde (jeder neue Wert liest einmal sofort).
let erzwungenFuer: number | null = null;
let namen: string[] = [];
// Zaehlt jeden Wechsel des Standes. Wer vor einem await eine Zahl merkt und danach eine andere findet, hat ein ueberholtes Bild.
let generation = 0;
const dekodiert = new Zwischenspeicher<ImageBitmap>(MAX_IM_SPEICHER);

let db: IDBDatabase | null = null;
let dbVersprechen: Promise<IDBDatabase> | null = null;
let ungueltig = true;
let letzteLese = -Infinity;
let leseLauf: Promise<void> | null = null;
let horcht = false;

// FNV-1a ueber einen Text: stabile Zahl fuer die Auswahl (nicht zufaellig je Aufruf).
export { hashe };

function holeDb(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  dbVersprechen ??= oeffneDb()
    .then((neu) => {
      neu.onversionchange = () => {
        neu.close();
        if (db === neu) db = null;
      };
      neu.onclose = () => {
        if (db === neu) db = null;
      };
      db = neu;
      return neu;
    })
    .finally(() => {
      dbVersprechen = null;
    });
  return dbVersprechen;
}

function uebernimm(neu: PackStand | null): void {
  gelesen = neu ? neu.importiert : 0;
  const neuerStand = neu && neu.patches.length > 0 ? neu.importiert : null;
  if (neuerStand === stand) return;
  generation++;
  dekodiert.leere();
  stand = neuerStand;
  namen = neu && neuerStand !== null ? [...neu.patches] : [];
}

// Liest den Stand (hoechstens einmal je Sekunde, sofort neu nach einer Meldung) und laedt neu, wenn sich `importiert` geaendert hat.
async function aktualisiere(packStand?: number): Promise<boolean> {
  if (!horcht) {
    horcht = true;
    horchePackGeaendert(() => {
      ungueltig = true;
    });
  }
  // Die Anfrage kennt einen anderen Stand als den gelesenen (Pack ersetzt oder entfernt, Meldung noch unterwegs): sofort neu lesen,
  // aber nur einmal je Wert, damit ein Pack ohne Patch-Bilder nicht jede Flaeche neu lesen laesst.
  if (typeof packStand === 'number' && packStand !== gelesen && packStand !== erzwungenFuer) {
    erzwungenFuer = packStand;
    ungueltig = true;
  }
  if (!ungueltig && performance.now() - letzteLese < LESE_ABSTAND_MS) return namen.length > 0;
  if (!leseLauf) {
    // Vor dem Lesen zuruecksetzen: eine Meldung waehrend des Lesens macht den Stand gleich wieder ungueltig.
    ungueltig = false;
    leseLauf = (async () => {
      try {
        uebernimm(await leseStandAus(await holeDb()));
        letzteLese = performance.now();
      } catch (e) {
        ungueltig = true;
        // Nicht von aussen schliessen, solange eine Dekodierung laeuft (sie liest ihre Bytes ueber diese Verbindung); die alte Verbindung
        // wird dann nur vergessen und schliesst mit ihrem Besitzer.
        if (dekodierend === 0) db?.close();
        db = null;
        throw e;
      }
    })().finally(() => {
      leseLauf = null;
    });
  }
  await leseLauf;
  return namen.length > 0;
}

// Laufende Dekodierungen je Datei: gleichzeitige Anfragen warten auf dieselbe Arbeit und leihen danach das fertige Bild aus dem Zwischenspeicher.
const laufend = new Map<string, Promise<unknown>>();
// Anzahl laufender Dekodierungen: solange eine laeuft, schliesst der Fehlerpfad von `aktualisiere` die Verbindung nicht von aussen.
let dekodierend = 0;

async function dekodiere(name: string): Promise<Leihe<ImageBitmap> | null> {
  const gemerkt = dekodiert.hole(name);
  if (gemerkt) return gemerkt;
  const schluessel = `${generation}|${name}`;
  const andere = laufend.get(schluessel);
  if (andere) {
    await andere.catch(() => {});
    return dekodiert.hole(name);
  }
  const arbeit = mitLesePlatz(async () => {
    dekodierend++;
    try {
      return await dekodiereNeu(name);
    } finally {
      dekodierend--;
    }
  }).finally(() => {
    laufend.delete(schluessel);
  });
  laufend.set(schluessel, arbeit);
  return arbeit;
}

async function dekodiereNeu(name: string): Promise<Leihe<ImageBitmap> | null> {
  const meineGeneration = generation;
  const datei = (await anfrage((await holeDb()).transaction(PACK_STORE_DATEIEN, 'readonly').objectStore(PACK_STORE_DATEIEN).get(name))) as
    | PackDateiGespeichert
    | undefined;
  if (!datei || datei.blob.size > MAX_LESE_BYTES) return null;
  // Den Blob sofort in den Speicher kopieren, bevor geschnitten und dekodiert wird (Grund: kopiereBlob in db.ts, Bad blob references in
  // Chrome). Die Verbindung kann auch von aussen enden (`versionchange` bei einem Datenbank-Upgrade, Fehlerpfad von `aktualisiere`);
  // ein Ersetzen oder Entfernen des Packs schliesst sie nicht.
  datei.blob = await kopiereBlob(datei.blob, datei.typ);
  // Masse aus dem Dateikopf, damit nie ein riesiges Bild voll dekodiert wird (derselbe Kopfbereich wie beim Import).
  const masse = leseBildmasse(datei.typ, new Uint8Array(await datei.blob.slice(0, BILDKOPF_BYTES).arrayBuffer()));
  if (!masse || masse.breite > MAX_BILD_SEITE || masse.hoehe > MAX_BILD_SEITE) return null;
  const skala = Math.min(1, MAX_SEITE / Math.max(masse.breite, masse.hoehe));
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
  // Wurde das Pack waehrend des Dekodierens ersetzt oder entfernt, wird das Bild nicht abgelegt (es schliesst mit der Leihe).
  return dekodiert.lege(name, bild, meineGeneration === generation);
}

export interface PatchWahl {
  name: string;
  bild: CanvasImageSource;
  // Nach dem Zeichnen aufrufen: erst dann darf ein verworfenes Bild schliessen.
  freigeben(): void;
}

// Waehlt je Schluessel (Bild plus Flaeche) ein Patch-Bild, stabil: derselbe Schluessel liefert dasselbe Bild, solange das Pack gleich bleibt.
// null: kein Pack, Mia-Patch nicht freigeschaltet, keine Patch-Bilder oder keines dekodierbar.
// `packStand`: `importiert` des Packs, das der Aufrufer kennt (0 = keins); weicht es vom gelesenen Stand ab, wird sofort neu gelesen.
export async function waehlePatch(schluessel: string, packStand?: number): Promise<PatchWahl | null> {
  let da: boolean;
  try {
    da = await aktualisiere(packStand);
  } catch {
    return null;
  }
  if (!da) return null;
  const liste = namen;
  const start = hashe(schluessel) % liste.length;
  for (let i = 0; i < Math.min(MAX_ERSATZ + 1, liste.length); i++) {
    const name = liste[(start + i) % liste.length]!;
    try {
      const leihe = await dekodiere(name);
      if (leihe) return { name, bild: leihe.wert, freigeben: leihe.freigeben };
    } catch {
      // naechstes Bild versuchen
    }
  }
  return null;
}

// Fuer Tests: wie viele Bilder gerade dekodiert gehalten werden.
export function anzahlImSpeicher(): number {
  return dekodiert.groesse;
}
