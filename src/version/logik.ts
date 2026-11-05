// Reine Logik fuer Version und Update-Hinweis (Auftrag V, PHASE-6-BAUPLAN Abschnitt 5). Kein Browser-Zugriff, in Node-Einheitstests ladbar.
import { versionHoeher } from '../pack/format.ts';
import { VERSION_ABSTAND_MS, type VersionDatei, type VersionStand } from './vertrag.ts';

// Eine Versionsnummer: drei Zahlen, optional ein Zusatz nach dem Strich (wie zerlegeVersion in src/pack/format.ts).
const VERSION_MUSTER = /^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.]{1,20})?$/;
const DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;

export const STAND_LEER: VersionStand = { geprueft: null, neueste: null, fehler: false };

// Prueft den Inhalt von version.json. Alles, was nicht dem Vertrag entspricht, ergibt null (der Aufrufer wertet das als Fehler).
export function pruefeVersionDatei(roh: unknown): VersionDatei | null {
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return null;
  const o = roh as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION_MUSTER.test(o.version)) return null;
  const datei: VersionDatei = { version: o.version };
  if (typeof o.datum === 'string' && DATUM_MUSTER.test(o.datum)) datei.datum = o.datum;
  return datei;
}

// Liest einen gespeicherten Stand und verwirft Unsinn (kaputter Speicher heisst: noch nie geprueft).
export function vervollstaendigeStand(roh: unknown): VersionStand {
  if (typeof roh !== 'object' || roh === null) return { ...STAND_LEER };
  const o = roh as Record<string, unknown>;
  return {
    geprueft: typeof o.geprueft === 'number' && Number.isFinite(o.geprueft) ? o.geprueft : null,
    neueste: typeof o.neueste === 'string' && VERSION_MUSTER.test(o.neueste) ? o.neueste : null,
    fehler: o.fehler === true,
  };
}

// Ist eine neue Pruefung faellig? Nie geprueft: ja. Zeit in der Zukunft (Uhr zurueckgestellt): ja. Auch nach einem Fehler gilt der volle Abstand
// (hoechstens ein Abruf je 24 Stunden); frueher ruft nur "Check now" ab.
export function istFaellig(stand: VersionStand, jetzt: number, abstandMs: number = VERSION_ABSTAND_MS): boolean {
  if (stand.geprueft === null) return true;
  const vergangen = jetzt - stand.geprueft;
  if (vergangen < 0) return true;
  return vergangen >= abstandMs;
}

// Ist die gemeldete Version neuer als die installierte? Eine Vorabversion (Zusatz nach dem Strich) wird nie als Update gemeldet.
export function istNeuer(neueste: string | null, aktuell: string): boolean {
  return neueste !== null && !neueste.includes('-') && versionHoeher(neueste, aktuell);
}
