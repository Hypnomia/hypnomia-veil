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
import { gesichtsAusschnitt } from '../presets.ts';
import { leseGesichter, schreibeGesichter, leereGesichter, type Box4 } from './gesichter-ablage';

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
// Gesichtsbox je Patch-Bild (in den Pixeln des dekodierten Bildes), null = kein Gesicht gefunden; gilt je Stand des Packs (siehe Mias Gesicht unten).
const gesichtsMemo = new Map<string, Box4 | null>();

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
  gesichtsMemo.clear();
  scanFertig = false;
  // scanLaeuft bleibt stehen: ein alter Lauf endet ueber die Generation von selbst, der neue beginnt erst danach (starteGesichtsScan)
  if (neu === null) void leereGesichter();
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

// ---------- Mias Gesicht (ZENSUR-PRESETS-BAUPLAN) ----------
// Ein Patch-Bild taugt fuer den Gesichtstausch, wenn YuNet darin ein Gesicht findet. Der Ausschnitt um das groesste Gesicht (Rand 25 %,
// Seitenverhaeltnis 3:4, src/presets.ts gesichtsAusschnitt) ist Mias Gesicht. Die Suche liefert der Erkenner (YuNet laeuft dort).
// Die Suche laeuft NIE innerhalb einer Pruefanfrage: nach einem Import, nach dem Laden des Modells und nach einem Wechsel des Packs stoesst
// der Erkenner sie im Hintergrund an (`starteGesichtsScan`), das Ergebnis je Stand des Packs liegt in einer eigenen Ablage
// (src/pack/gesichter-ablage.ts). Solange sie nicht fertig ist, gibt `waehleGesichtsPatch` null (die Pruefung nimmt die Koerper-Behandlung,
// das ist sicher: das Gesicht ist verdeckt, nur nicht mit Mias Gesicht).
export type GesichtsBox = Box4;
export type GesichtsSucher = (bild: ImageBitmap) => Promise<GesichtsBox | null>;
let sucher: GesichtsSucher | null = null;
// Fertig fuer den aktuellen Stand: alle Patch-Bilder sind geprueft (Speicher gesichtsMemo).
let scanFertig = false;
let scanLaeuft: Promise<void> | null = null;

export function setzeGesichtsSucher(f: GesichtsSucher | null): void {
  sucher = f;
}

// Wird gerufen, wenn die Suche fuer einen Stand fertig wird (Stand `importiert`, Zahl der Bilder mit Gesicht): der Erkenner meldet es weiter, damit offene
// Seiten, deren Pruefungen waehrend der Suche den Ersatz bekamen, neu bewerten.
let scanMelder: ((importiert: number, mit: number) => Promise<void>) | null = null;
export function setzeScanMelder(f: ((importiert: number, mit: number) => Promise<void>) | null): void {
  scanMelder = f;
}
let scanGen = -1;

export interface GesichtsWahl extends PatchWahl {
  // Ausschnitt in den Pixeln von `bild`: [x, y, w, h]
  ausschnitt: GesichtsBox;
}

// Prueft ein Bild (aus dem Speicher oder per YuNet) und merkt die Box. Wirft, wenn die Suche nicht geht (dann wird nichts gemerkt).
async function pruefeBild(name: string): Promise<GesichtsBox | null> {
  const bekannt = gesichtsMemo.get(name);
  if (bekannt !== undefined) return bekannt;
  if (!sucher) throw new Error('keine Gesichtssuche');
  const leihe = await dekodiere(name);
  if (!leihe) {
    // nicht dekodierbar: kein Gesicht, aber nicht abbrechen
    gesichtsMemo.set(name, null);
    return null;
  }
  const meine = generation;
  try {
    const box = await sucher(leihe.wert);
    if (meine === generation) gesichtsMemo.set(name, box);
    return box;
  } finally {
    leihe.freigeben();
  }
}

// Stoesst die Suche im Hintergrund an (oder wartet auf die laufende) und liefert, wenn sie fertig ist. Wirft nie.
export function starteGesichtsScan(packStand?: number): Promise<void> {
  if (scanLaeuft) {
    // gehoert der laufende Lauf zu einem alten Stand, beginnt der neue nach seinem Ende
    return scanGen === generation ? scanLaeuft : scanLaeuft.then(() => starteGesichtsScan(packStand));
  }
  let lauf: Promise<void> | undefined;
  lauf = (async () => {
    try {
      if (!(await aktualisiere(packStand))) {
        scanFertig = true; // keine Patch-Bilder: nichts zu pruefen
        return;
      }
      if (scanFertig) return;
      const meine = generation;
      const meinStand = stand;
      const gespeichert = meinStand !== null ? await leseGesichter(meinStand) : null;
      if (gespeichert) for (const n of namen) if (n in gespeichert.boxen) gesichtsMemo.set(n, gespeichert.boxen[n] ?? null);
      for (const n of [...namen]) {
        if (meine !== generation) return; // das Pack hat gewechselt, der naechste Lauf beginnt neu
        await pruefeBild(n);
      }
      if (meine !== generation) return;
      scanFertig = true;
      if (scanMelder && meinStand !== null) void scanMelder(meinStand, [...gesichtsMemo.values()].filter((b) => b !== null).length).catch(() => undefined);
      if (meinStand !== null && (!gespeichert || namen.some((n) => !(n in gespeichert.boxen)))) {
        const boxen: Record<string, GesichtsBox | null> = {};
        for (const n of namen) boxen[n] = gesichtsMemo.get(n) ?? null;
        await schreibeGesichter({ importiert: meinStand, boxen });
      }
    } catch {
      // YuNet noch nicht bereit oder Lesefehler: nicht fertig, ein spaeterer Anstoss versucht es wieder
    } finally {
      if (scanLaeuft === lauf) scanLaeuft = null;
    }
  })();
  scanLaeuft = lauf;
  scanGen = generation;
  return lauf;
}

// Waehlt stabil je Schluessel ein Patch-Bild mit Gesicht (ab dem Hash-Platz das erste mit Gesicht). null: Scan noch nicht fertig (dann wird er
// angestossen und diese Pruefung nimmt die Koerper-Behandlung), kein Pack, keine Patch-Bilder oder in keinem ein Gesicht.
export async function waehleGesichtsPatch(schluessel: string, packStand?: number): Promise<GesichtsWahl | null> {
  try {
    if (!(await aktualisiere(packStand))) return null;
  } catch {
    return null;
  }
  if (!scanFertig) {
    void starteGesichtsScan(packStand);
    return null;
  }
  const liste = namen;
  const start = hashe(schluessel) % liste.length;
  for (let i = 0; i < liste.length; i++) {
    const name = liste[(start + i) % liste.length]!;
    const box = gesichtsMemo.get(name);
    if (!box) continue;
    try {
      const leihe = await dekodiere(name);
      if (!leihe) continue;
      const b = leihe.wert;
      return { name, bild: b, ausschnitt: gesichtsAusschnitt(box, b.width, b.height), freigeben: leihe.freigeben };
    } catch {
      // naechstes Bild versuchen
    }
  }
  return null;
}

export interface GesichtsStatistik {
  gesamt: number; // Patch-Bilder im Pack
  geprueft: number; // davon schon auf ein Gesicht geprueft
  mit: number; // davon mit Gesicht
  fertig: boolean; // alle geprueft (der Scan ist durch)
}

export function gesichtsStatistik(): GesichtsStatistik {
  let geprueft = 0;
  let mit = 0;
  for (const n of namen) {
    const b = gesichtsMemo.get(n);
    if (b === undefined) continue;
    geprueft++;
    if (b) mit++;
  }
  return { gesamt: namen.length, geprueft, mit, fertig: scanFertig };
}

// Prueft alle Patch-Bilder (wartet auf den Scan) und liefert die Zahlen. Fuer den Erkenner und die Tests.
export async function scanneGesichter(packStand?: number): Promise<GesichtsStatistik> {
  await starteGesichtsScan(packStand);
  return gesichtsStatistik();
}

// Hoert auf Wechsel des Packs (Import, Ersetzen, Entfernen) und stoesst danach den Scan an. Einmal beim Start des Erkenners.
let ueberwacht = false;
export function starteGesichtsUeberwachung(): void {
  if (ueberwacht) return;
  ueberwacht = true;
  horchePackGeaendert(() => {
    ungueltig = true;
    setTimeout(() => void starteGesichtsScan(), 300);
  });
}
