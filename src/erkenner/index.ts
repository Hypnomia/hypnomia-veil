// Einstieg des Erkenners: Start (Modell vorladen), Nachrichten-Empfang fuer das Ziel `erkenner`.
// Chrome: ruft entrypoints/offscreen/main.ts. Firefox: ruft entrypoints/background.ts (gleicher Kontext).

import { istFuer, type NachrichtErkenner } from '../nachrichten';
import { fehlerAntwortFuer } from './antwort';
import { istBereit, ladeModell, pruefe, setzeRefererSetzer, status } from './erkenner';
import type { RefererSetzer } from './nachladen';

export interface ErkennerOptionen {
  // Wie ein Referer fuer eigene Abrufe gesetzt wird (Chrome: Nachricht an den Hintergrund, Firefox: direkter Aufruf).
  setzeReferer: RefererSetzer;
}

// Modell vorladen, nicht erst bei der ersten Anfrage.
export function starteErkenner(optionen: ErkennerOptionen): void {
  setzeRefererSetzer(optionen.setzeReferer);
  ladeModell().catch((e) => console.warn('Erkenner: Vorladen fehlgeschlagen', e));
}

// Beantwortet Nachrichten fuer `erkenner`. Gibt undefined zurueck, wenn die Nachricht nicht gemeint ist
// (dann antwortet der Empfaenger nicht, sonst verliert der andere Kontext in Chrome die Antwort).
export function bearbeiteErkennerNachricht(nachricht: unknown): Promise<unknown> | undefined {
  if (!istFuer(nachricht, 'erkenner')) return undefined;
  const n = nachricht as NachrichtErkenner;
  switch (n.typ) {
    case 'wecke':
      return Promise.resolve({ ok: true, bereit: istBereit() });
    case 'status':
      return Promise.resolve(status());
    case 'pruefe':
      return pruefe(n);
    default:
      return undefined;
  }
}

// Haengt den Empfaenger an runtime.onMessage (Offscreen-Dokument). Gibt eine Funktion zum Abmelden zurueck.
export function horcheErkenner(): () => void {
  const horcher = (nachricht: unknown, _absender: unknown, antworte: (antwort: unknown) => void): boolean | undefined => {
    const antwort = bearbeiteErkennerNachricht(nachricht);
    if (!antwort) return undefined;
    antwort.then(antworte, (e) => antworte(fehlerAntwortFuer(nachricht, e)));
    return true;
  };
  browser.runtime.onMessage.addListener(horcher);
  return () => browser.runtime.onMessage.removeListener(horcher);
}
