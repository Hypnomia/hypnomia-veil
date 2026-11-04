// IndexedDB des Mia Packs (Datenbank `veil-pack`, siehe vertrag.ts). Gemeinsame Hilfen fuer Einstellungsseite (Import, Entfernen)
// und Erkenner (nur Lesen). Kein storage-Zugriff hier: das Offscreen-Dokument hat kein `storage`.

import {
  PACK_DB_NAME,
  PACK_DB_VERSION,
  PACK_META_SCHLUESSEL,
  PACK_STORE_DATEIEN,
  PACK_STORE_META,
  type PackDateiGespeichert,
  type PackMeta,
} from './vertrag';

// Kleiner eigener Eintrag im Speicher `meta` (neben `aktiv`): nur das, was der Erkenner je Pruefung braucht, damit er nicht das ganze
// Meta mit dem Lizenztext lesen muss. Wird beim Import in derselben Transaktion geschrieben, beim Leeren mitgeleert.
export const PACK_STAND_SCHLUESSEL = 'stand';
export interface PackStand {
  importiert: number;
  // Patch-Bilder (Namen, sortiert), nur wenn `stil:mia-patch` freigeschaltet ist, sonst leer.
  patches: string[];
}

// Meldung an andere Kontexte desselben Ursprungs (Erkenner im Offscreen-Dokument bzw. Hintergrund): das Pack hat sich geaendert.
const KANAL = 'veil-pack';
export function meldePackGeaendert(): void {
  try {
    const k = new BroadcastChannel(KANAL);
    k.postMessage('geaendert');
    k.close();
  } catch {
    // Ohne BroadcastChannel greift der Zeitabstand des Lesers (hoechstens 1 s alt).
  }
}
export function horchePackGeaendert(rueckruf: () => void): () => void {
  try {
    const k = new BroadcastChannel(KANAL);
    k.onmessage = () => rueckruf();
    return () => k.close();
  } catch {
    return () => {};
  }
}

// Macht aus einer IDBRequest ein Versprechen.
export function anfrage<T>(a: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fehl) => {
    a.onsuccess = () => ok(a.result);
    a.onerror = () => fehl(a.error ?? new Error('IndexedDB-Fehler'));
  });
}

// Wartet auf das Ende einer Transaktion (complete) oder ihren Abbruch.
export function transaktionFertig(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, fehl) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => fehl(tx.error ?? new Error('Transaktion fehlgeschlagen'));
    tx.onabort = () => fehl(tx.error ?? new Error('Transaktion abgebrochen'));
  });
}

export function oeffneDb(): Promise<IDBDatabase> {
  return new Promise((ok, fehl) => {
    const a = indexedDB.open(PACK_DB_NAME, PACK_DB_VERSION);
    a.onupgradeneeded = () => {
      const db = a.result;
      if (!db.objectStoreNames.contains(PACK_STORE_META)) db.createObjectStore(PACK_STORE_META);
      if (!db.objectStoreNames.contains(PACK_STORE_DATEIEN)) db.createObjectStore(PACK_STORE_DATEIEN, { keyPath: 'name' });
    };
    a.onsuccess = () => ok(a.result);
    a.onerror = () => fehl(a.error ?? new Error('IndexedDB nicht oeffenbar'));
    a.onblocked = () => fehl(new Error('IndexedDB blockiert'));
  });
}

// Kurzlebige Verbindung: oeffnen, `arbeit` ausfuehren, schliessen.
export async function mitDb<T>(arbeit: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await oeffneDb();
  try {
    return await arbeit(db);
  } finally {
    db.close();
  }
}

export async function leseMeta(): Promise<PackMeta | null> {
  return mitDb(async (db) => {
    const tx = db.transaction(PACK_STORE_META, 'readonly');
    const meta = (await anfrage(tx.objectStore(PACK_STORE_META).get(PACK_META_SCHLUESSEL))) as PackMeta | undefined;
    return meta && typeof meta === 'object' && typeof meta.id === 'string' ? meta : null;
  });
}

// Stand aus dem kleinen Eintrag; Fallback auf das ganze Meta (aeltere Importe ohne `stand`).
export function standAusMeta(meta: PackMeta): PackStand {
  const frei = Array.isArray(meta.freischaltungen) && meta.freischaltungen.includes('stil:mia-patch');
  return {
    importiert: meta.importiert,
    patches: frei ? meta.dateien.filter((d) => d.rolle === 'patch' && d.typ.startsWith('image/')).map((d) => d.name).sort() : [],
  };
}

export function leseStandAus(db: IDBDatabase): Promise<PackStand | null> {
  return new Promise((ok, fehl) => {
    const tx = db.transaction(PACK_STORE_META, 'readonly');
    const speicher = tx.objectStore(PACK_STORE_META);
    const stand = speicher.get(PACK_STAND_SCHLUESSEL);
    stand.onerror = () => fehl(stand.error);
    stand.onsuccess = () => {
      const s = stand.result as PackStand | undefined;
      if (s && typeof s.importiert === 'number' && Array.isArray(s.patches)) return ok(s);
      // Ohne eigenen Eintrag: Meta lesen (einmalig, Altbestand).
      const meta = speicher.get(PACK_META_SCHLUESSEL);
      meta.onerror = () => fehl(meta.error);
      meta.onsuccess = () => {
        const m = meta.result as PackMeta | undefined;
        ok(m && typeof m.id === 'string' ? standAusMeta(m) : null);
      };
    };
  });
}

export async function leseDatei(name: string): Promise<PackDateiGespeichert | null> {
  return mitDb(async (db) => {
    const tx = db.transaction(PACK_STORE_DATEIEN, 'readonly');
    const d = (await anfrage(tx.objectStore(PACK_STORE_DATEIEN).get(name))) as PackDateiGespeichert | undefined;
    return d ?? null;
  });
}

// Namen aller Dateien einer Rolle aus dem Meta (sortiert, stabil fuer die Wahl je Quelle). Phase 4: Vorschau, Chibi, Quiz, Texte.
// Nur mit gueltiger Freischaltung benutzen (istFreigeschaltet in vertrag.ts); ohne Pack: leere Liste.
export async function leseNamenMitRolle(rolle: NonNullable<PackDateiGespeichert['rolle']>): Promise<string[]> {
  const meta = await leseMeta();
  if (!meta) return [];
  return meta.dateien.filter((d) => d.rolle === rolle).map((d) => d.name).sort();
}
