// Ablage des Mia Packs (PHASE-2-BAUPLAN Abschnitt 9.2): Import in EINER Transaktion, Entfernen, Kurzfassung in storage.local,
// Umschalten des Stils, Abgleich beider Ablagen. Laeuft auf Erweiterungsseiten mit `storage` (Einstellungsseite).
// Der Erkenner liest nur ueber patches.ts.

import { aendereEinstellungen, ladeEinstellungen } from '../einstellungen';
import {
  PACK_STAND_SCHLUESSEL,
  anfrage,
  leseMeta,
  meldePackGeaendert,
  mitDb,
  standAusMeta,
  transaktionFertig,
} from './db';
import { PackFehler, filtereFreischaltungen, sha256, type Fortschritt, type GeprueftesPack } from './format';
import { pruefeQuizBank, pruefeTexte } from '../quiz/vertrag';
import {
  FREISCHALTUNGEN,
  PACK_META_SCHLUESSEL,
  PACK_SPEICHER_SCHLUESSEL,
  PACK_STORE_DATEIEN,
  PACK_STORE_META,
  istFreigeschaltet,
  ladePackKurz,
  type Freischaltung,
  type PackDateiGespeichert,
  type PackKurz,
  type PackMeta,
} from './vertrag';

export { leseMeta };

// Wo ein Fehler passiert ist, damit die Oberflaeche ehrlich sagen kann, was sich geaendert hat:
//   'ablage'      IndexedDB hat nicht geschrieben bzw. nicht geleert: der alte Stand ist unveraendert.
//   'kurzfassung' IndexedDB ist fertig, aber storage.local konnte nicht nachgezogen werden: der Abgleich beim naechsten Oeffnen heilt das.
export class PackSpeicherFehler extends Error {
  readonly ort: 'ablage' | 'kurzfassung';
  constructor(ort: 'ablage' | 'kurzfassung', ursache: unknown) {
    super(`${ort}: ${ursache instanceof Error ? ursache.message : String(ursache)}`);
    this.name = 'PackSpeicherFehler';
    this.ort = ort;
  }
}

// Kurzfassung fuer storage.local aus den Meta-Daten.
export function kurzAusMeta(meta: PackMeta): PackKurz {
  return {
    id: meta.id,
    version: meta.version,
    titel: meta.titel,
    freischaltungen: meta.freischaltungen,
    bilder: meta.dateien.filter((d) => d.rolle === 'patch').length,
    vorschau: meta.dateien.filter((d) => d.rolle === 'vorschau').length,
    chibis: meta.dateien.filter((d) => d.rolle === 'chibi').length,
    groesse: meta.groesse,
    importiert: meta.importiert,
  };
}

async function schreibeKurz(kurz: PackKurz): Promise<void> {
  try {
    await browser.storage.local.set({ [PACK_SPEICHER_SCHLUESSEL]: kurz });
  } catch {
    // einmal wiederholen (kurze Stoerung)
    await browser.storage.local.set({ [PACK_SPEICHER_SCHLUESSEL]: kurz });
  }
}

export interface ImportErgebnis {
  kurz: PackKurz;
  // false: das Pack ist drin, aber der Stil liess sich nicht auf Mia-Patch stellen (im Popup waehlbar).
  stilGesetzt: boolean;
}

// Speicherbedarf: die Bytes jeder Datei werden einmal gelesen, gehasht und als Blob gehalten, bis die Transaktion steht. Faustwert
// kurzzeitig bis etwa das Doppelte der Pack-Groesse an freiem Arbeitsspeicher (Blobs legt der Browser bei Bedarf auf die Platte).
// Schreibt ein geprueftes Pack (siehe pruefePack) aus `datei` in die Ablage. Die Bytes jeder Datei werden hier noch einmal gelesen und
// gegen den Hash aus dem Manifest geprueft; gespeichert wird genau das, was gehasht wurde (die Datei darf sich zwischen Pruefung und
// Import nicht mehr aendern). Dann EINE Transaktion: altes Pack leeren, neue Dateien, Stand und Meta schreiben. Scheitert etwas davor oder
// darin, bleibt das alte Pack unveraendert. Danach storage.local.pack und, mit Freischaltung, der Stil Mia-Patch (Entscheidung 12).
export async function importierePack(datei: Blob, geprueft: GeprueftesPack, fortschritt?: Fortschritt): Promise<ImportErgebnis> {
  const m = geprueft.manifest;
  const meta: PackMeta = {
    id: m.id,
    version: m.version,
    titel: m.titel,
    erstellt: m.erstellt,
    // pruefePack hat Unbekanntes und Freischaltungen ohne Datei schon verworfen; hier zusaetzlich die Schema-Pruefung der JSON-Dateien
    // (Quiz-Bank, Mias Saetze): eine ungueltige Datei nimmt ihre Freischaltungen mit, das Pack bleibt sonst brauchbar.
    freischaltungen: filtereFreischaltungen(
      m.freischaltungen.filter((f): f is Freischaltung => (FREISCHALTUNGEN as readonly string[]).includes(f)),
      (rolle) =>
        rolle === 'quiz' ? pruefeQuizBank(geprueft.json.quiz) !== null : rolle === 'texte' ? pruefeTexte(geprueft.json.texte) !== null : geprueft.rollen[rolle] > 0,
    ),
    lizenzText: geprueft.lizenzText,
    dateien: m.dateien.map((d) => {
      const e: PackMeta['dateien'][number] = { name: d.name, typ: d.typ, laenge: d.laenge };
      if (d.rolle) e.rolle = d.rolle;
      if (d.stufe) e.stufe = d.stufe;
      return e;
    }),
    groesse: geprueft.groesse,
    importiert: Date.now(),
  };

  // 1. Bytes lesen und gegen den Hash halten. Die Blobs entstehen aus genau diesen Bytes.
  const eintraege: PackDateiGespeichert[] = [];
  fortschritt?.(0, m.dateien.length);
  for (const d of m.dateien) {
    const von = geprueft.datenStart + d.offset;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(await datei.slice(von, von + d.laenge).arrayBuffer());
    } catch (e) {
      // Der Browser verweigert das Lesen, wenn die Datei seit dem Auswaehlen veraendert wurde.
      throw new PackFehler('lesefehler', `${d.name} nicht mehr lesbar (${e instanceof Error ? e.message : String(e)})`);
    }
    if (bytes.byteLength !== d.laenge || (await sha256(bytes)) !== d.sha256) {
      throw new PackFehler('sha256', `Datei hat sich seit der Pruefung veraendert: ${d.name}`);
    }
    const e: PackDateiGespeichert = { name: d.name, typ: d.typ, blob: new Blob([bytes], { type: d.typ }) };
    if (d.rolle) e.rolle = d.rolle;
    if (d.stufe) e.stufe = d.stufe;
    eintraege.push(e);
    fortschritt?.(eintraege.length, m.dateien.length);
  }

  // 2. Eine Transaktion.
  try {
    await mitDb(async (db) => {
      const tx = db.transaction([PACK_STORE_META, PACK_STORE_DATEIEN], 'readwrite');
      const fertig = transaktionFertig(tx);
      try {
        const dateien = tx.objectStore(PACK_STORE_DATEIEN);
        const metaSpeicher = tx.objectStore(PACK_STORE_META);
        dateien.clear();
        metaSpeicher.clear();
        for (const e of eintraege) dateien.put(e);
        metaSpeicher.put(standAusMeta(meta), PACK_STAND_SCHLUESSEL);
        metaSpeicher.put(meta, PACK_META_SCHLUESSEL);
      } catch (e) {
        tx.abort();
        await fertig.catch(() => {});
        throw e;
      }
      await fertig;
    });
  } catch (e) {
    throw new PackSpeicherFehler('ablage', e);
  }
  meldePackGeaendert();

  // 3. storage.local: erst `pack`, dann der Stil (wer den Stil sieht, findet das Pack schon). IndexedDB bleibt in jedem Fall stehen;
  //    was fehlt, schreibt der Abgleich beim naechsten Oeffnen der Einstellungsseite aus dem Meta nach.
  const kurz = kurzAusMeta(meta);
  try {
    await schreibeKurz(kurz);
  } catch (e) {
    throw new PackSpeicherFehler('kurzfassung', e);
  }
  let stilGesetzt = true;
  if (istFreigeschaltet(kurz, 'stil:mia-patch')) {
    try {
      await aendereEinstellungen({ stil: 'mia-patch' });
    } catch {
      stilGesetzt = false;
    }
  }
  return { kurz, stilGesetzt };
}

async function leereAblage(): Promise<void> {
  await mitDb(async (db) => {
    const tx = db.transaction([PACK_STORE_META, PACK_STORE_DATEIEN], 'readwrite');
    const fertig = transaktionFertig(tx);
    tx.objectStore(PACK_STORE_DATEIEN).clear();
    tx.objectStore(PACK_STORE_META).clear();
    await fertig;
  });
}

// Stil von Mia-Patch zurueck auf Mosaik, aber nur, wenn er auch so steht (jede Speicherung setzt alle Seiten neu).
async function setzeStilZurueck(): Promise<void> {
  if ((await ladeEinstellungen()).stil === 'mia-patch') await aendereEinstellungen({ stil: 'mosaik' });
}

// Entfernt das Pack: zuerst IndexedDB leeren, dann Kurzfassung weg, dann Stil zurueck auf Mosaik. Bleibt nach dem Leeren etwas
// stehen, ist das ein 'kurzfassung'-Fehler; der Abgleich beim naechsten Oeffnen raeumt den Rest auf.
export async function entfernePack(): Promise<void> {
  try {
    await leereAblage();
  } catch (e) {
    throw new PackSpeicherFehler('ablage', e);
  }
  meldePackGeaendert();
  try {
    await browser.storage.local.remove(PACK_SPEICHER_SCHLUESSEL);
    await setzeStilZurueck();
  } catch (e) {
    throw new PackSpeicherFehler('kurzfassung', e);
  }
}

// Anzahl der Dateien in der Ablage (fuer Tests, den Abgleich und die Statusanzeige).
export async function zaehleDateien(): Promise<number> {
  return mitDb(async (db) => anfrage(db.transaction(PACK_STORE_DATEIEN, 'readonly').objectStore(PACK_STORE_DATEIEN).count()));
}

export type Abgleich =
  | 'leer' // weder Pack noch Reste
  | 'ok' // IndexedDB und storage.local stimmen ueberein
  | 'nachgeschrieben' // Pack in IndexedDB, Kurzfassung fehlte oder war veraltet: aus dem Meta neu geschrieben
  | 'kurzfassung-entfernt' // Kurzfassung ohne Pack in IndexedDB: entfernt, Stil zurueckgesetzt
  | 'verwaiste-dateien'; // Dateien in IndexedDB ohne Meta: nicht benutzbar, aber entfernbar

export interface AbgleichErgebnis {
  ergebnis: Abgleich;
  kurz: PackKurz | null;
}

// Gleicht IndexedDB (die Wahrheit) und storage.local ab. Wird beim Oeffnen der Einstellungsseite aufgerufen.
export async function gleicheAb(): Promise<AbgleichErgebnis> {
  const meta = await leseMeta();
  const kurz = await ladePackKurz();
  if (meta) {
    const soll = kurzAusMeta(meta);
    // Eigener Stand-Eintrag fehlt (Altbestand): nachziehen, ohne das Pack anzufassen.
    await mitDb(async (db) => {
      const tx = db.transaction(PACK_STORE_META, 'readwrite');
      const fertig = transaktionFertig(tx);
      const s = tx.objectStore(PACK_STORE_META);
      if ((await anfrage(s.count(PACK_STAND_SCHLUESSEL))) === 0) s.put(standAusMeta(meta), PACK_STAND_SCHLUESSEL);
      await fertig;
    });
    if (kurz && kurz.id === soll.id && kurz.importiert === soll.importiert && kurz.bilder === soll.bilder) return { ergebnis: 'ok', kurz };
    await schreibeKurz(soll);
    return { ergebnis: 'nachgeschrieben', kurz: soll };
  }
  if (kurz) {
    await browser.storage.local.remove(PACK_SPEICHER_SCHLUESSEL);
    await setzeStilZurueck();
    return { ergebnis: 'kurzfassung-entfernt', kurz: null };
  }
  await setzeStilZurueck();
  return { ergebnis: (await zaehleDateien()) > 0 ? 'verwaiste-dateien' : 'leer', kurz: null };
}
