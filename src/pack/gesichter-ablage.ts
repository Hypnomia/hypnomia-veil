// Ablage der Gesichtssuche in den Patch-Bildern (Mias Gesicht, ZENSUR-PRESETS-BAUPLAN): je Stand des Packs (`importiert`) die gefundene
// Gesichtsbox jedes Patch-Bildes. Eigene kleine Datenbank, nicht die Pack-Datenbank und nicht die Pack-Metadaten: so aendert sich an der
// Pack-Ablage und ihren Zaehlern nichts, und der Erkenner schreibt nie in den Import. Nach einem Wechsel des Packs gilt ein anderer Stand,
// alte Eintraege werden beim Schreiben entfernt. Fehler sind nie schlimm: ohne Ablage wird neu gesucht.
export type Box4 = [number, number, number, number];
export interface GesichterErgebnis {
  importiert: number;
  // Patch-Name zu Gesichtsbox, null = in diesem Bild keins gefunden
  boxen: Record<string, Box4 | null>;
}

const DB_NAME = 'veil-pack-gesichter';
const STORE = 'ergebnis';

function oeffne(): Promise<IDBDatabase> {
  return new Promise((ok, fehl) => {
    const a = indexedDB.open(DB_NAME, 1);
    a.onupgradeneeded = () => a.result.createObjectStore(STORE);
    a.onsuccess = () => ok(a.result);
    a.onerror = () => fehl(a.error);
  });
}

export async function leseGesichter(importiert: number): Promise<GesichterErgebnis | null> {
  try {
    const db = await oeffne();
    try {
      const wert = await new Promise<unknown>((ok, fehl) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(importiert);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fehl(r.error);
      });
      const e = wert as GesichterErgebnis | undefined;
      return e && e.importiert === importiert && e.boxen && typeof e.boxen === 'object' ? e : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// Schreibt das Ergebnis dieses Stands und entfernt die aller anderen.
export async function schreibeGesichter(e: GesichterErgebnis): Promise<void> {
  try {
    const db = await oeffne();
    try {
      await new Promise<void>((ok, fehl) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.objectStore(STORE).put(e, e.importiert);
        tx.oncomplete = () => ok();
        tx.onerror = () => fehl(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ohne Ablage wird beim naechsten Start neu gesucht
  }
}

export async function leereGesichter(): Promise<void> {
  try {
    const db = await oeffne();
    try {
      await new Promise<void>((ok, fehl) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => ok();
        tx.onerror = () => fehl(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // nichts
  }
}
