// Fehlerantworten nach Vertrag (`{ ok: false, id, fehler }`): die id der Anfrage wird uebernommen, wenn die Nachricht eine trug.
// Kein Browser-Zugriff, nur Typen aus dem Vertrag.

import type { AntwortFehler } from '../nachrichten';

export function idVon(nachricht: unknown): string | undefined {
  const id = nachricht && typeof nachricht === 'object' ? (nachricht as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : undefined;
}

export function fehlerAntwortFuer(nachricht: unknown, e: unknown): AntwortFehler {
  const fehler = e instanceof Error ? e.message : String(e);
  const id = idVon(nachricht);
  return id === undefined ? { ok: false, fehler } : { ok: false, id, fehler };
}
