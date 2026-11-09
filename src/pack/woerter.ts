// Woerter fuer die Presets mit Wort (ZENSUR-PRESETS-BAUPLAN, Rolle `woerter`): liest die JSON-Datei aus der Pack-Ablage (Erkenner), prueft
// sie gegen den Vertrag (src/presets.ts, pruefeWoerter) und haelt das Ergebnis im Speicher. Der Stand (`importiert`) wird hoechstens einmal je
// Sekunde gelesen, ein Import oder Entfernen meldet sich per BroadcastChannel und macht ihn sofort ungueltig; stimmt der `packStand` der
// Anfrage nicht mit dem gelesenen ueberein, wird sofort neu gelesen. Ohne Pack, ohne Freischaltung `zensur:woerter` oder bei einer
// ungueltigen Datei: null (dann steht das feste Wort "MIA" da).
import { horchePackGeaendert, leseDatei, leseMeta } from './db';
import { pruefeWoerter, type WoerterDatei } from '../presets.ts';

const LESE_ABSTAND_MS = 1000;
const MAX_BYTES = 256 * 1024;

let stand: { importiert: number; datei: WoerterDatei | null } | null = null;
let gelesenUm = -Infinity;
let ungueltig = true;
let horcht = false;
let lauf: Promise<void> | null = null;

async function lese(): Promise<void> {
  const meta = await leseMeta();
  if (!meta) {
    stand = { importiert: 0, datei: null };
    return;
  }
  let datei: WoerterDatei | null = null;
  const eintrag = meta.dateien.find((d) => d.rolle === 'woerter');
  if (eintrag && Array.isArray(meta.freischaltungen) && meta.freischaltungen.includes('zensur:woerter')) {
    try {
      const g = await leseDatei(eintrag.name, MAX_BYTES);
      if (g) datei = pruefeWoerter(JSON.parse(await g.blob.text()));
    } catch {
      datei = null;
    }
  }
  stand = { importiert: meta.importiert, datei };
}

export async function ladeWoerter(packStand?: number): Promise<WoerterDatei | null> {
  if (!horcht) {
    horcht = true;
    horchePackGeaendert(() => {
      ungueltig = true;
    });
  }
  if (typeof packStand === 'number' && stand && packStand !== stand.importiert) ungueltig = true;
  if (stand && !ungueltig && performance.now() - gelesenUm < LESE_ABSTAND_MS) return stand.datei;
  if (!lauf) {
    ungueltig = false;
    lauf = lese()
      .then(() => {
        gelesenUm = performance.now();
      })
      .catch(() => {
        ungueltig = true;
      })
      .finally(() => {
        lauf = null;
      });
  }
  await lauf;
  return stand?.datei ?? null;
}

// Die Themen des Packs fuer die Oberflaeche (Kennung und Titel), leer ohne gueltige Datei.
export async function ladeThemen(): Promise<{ id: string; titel: string }[]> {
  const d = await ladeWoerter();
  return d ? d.themen.map((t) => ({ id: t.id, titel: t.titel })) : [];
}
