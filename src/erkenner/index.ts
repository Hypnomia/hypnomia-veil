// Einstieg des Erkenners: Start (Modell vorladen), Nachrichten-Empfang fuer das Ziel `erkenner`.
// Chrome: ruft entrypoints/offscreen/main.ts. Firefox: ruft entrypoints/background.ts (gleicher Kontext).

import { istFuer, type NachrichtErkenner } from '../nachrichten';
import { fehlerAntwortFuer } from './antwort';
import { lieferePackBild } from './packbild';
import { setzeScanMelder } from '../pack/patches';
import { gesichtsscan, istBereit, ladeModell, pruefe, setzeRefererSetzer, starteHintergrundArbeit, status } from './erkenner';
import { herkunftFuerEntscheidung, type AbsenderHerkunft, type RefererSetzer } from './nachladen';

export interface ErkennerOptionen {
  // Wie ein Referer fuer eigene Abrufe gesetzt wird (Chrome: Nachricht an den Hintergrund, Firefox: direkter Aufruf).
  setzeReferer: RefererSetzer;
  // Meldet, dass die Gesichtssuche in den Patch-Bildern fertig ist (Hintergrund legt `gesichterStand` in storage.local ab).
  meldeGesichter?: (importiert: number, mit: number) => Promise<void>;
}

// Modell vorladen, nicht erst bei der ersten Anfrage.
export function starteErkenner(optionen: ErkennerOptionen): void {
  setzeRefererSetzer(optionen.setzeReferer);
  setzeScanMelder(optionen.meldeGesichter ?? null);
  ladeModell().catch((e) => console.warn('Erkenner: Vorladen fehlgeschlagen', e));
  // Danach im Hintergrund: Wort-Schrift laden und die Patch-Bilder des Packs einmal auf Gesichter pruefen (Mias Gesicht).
  starteHintergrundArbeit();
}

// Beantwortet Nachrichten fuer `erkenner`. Gibt undefined zurueck, wenn die Nachricht nicht gemeint ist
// (dann antwortet der Empfaenger nicht, sonst verliert der andere Kontext in Chrome die Antwort).
export function bearbeiteErkennerNachricht(nachricht: unknown, absender?: AbsenderHerkunft | null): Promise<unknown> | undefined {
  if (!istFuer(nachricht, 'erkenner')) return undefined;
  const n = nachricht as NachrichtErkenner;
  switch (n.typ) {
    case 'wecke':
      return Promise.resolve({ ok: true, bereit: istBereit() });
    case 'status':
      return Promise.resolve(status());
    case 'gesichtsscan':
      return gesichtsscan(typeof n.packStand === 'number' ? n.packStand : undefined);
    case 'pruefe': {
      // Netzgrenze: die Herkunft kommt aus dem Absender (Tab, sender.origin), nicht allein aus dem Referer der Nachricht.
      const referer = n.quelle && n.quelle.art === 'url' ? (n.quelle.referer ?? '') : '';
      return pruefe(n, herkunftFuerEntscheidung(referer, absender));
    }
    case 'packbild':
      return lieferePackBild(n);
    default:
      return undefined;
  }
}

// Haengt den Empfaenger an runtime.onMessage (Offscreen-Dokument). Gibt eine Funktion zum Abmelden zurueck.
export function horcheErkenner(): () => void {
  const horcher = (nachricht: unknown, absender: AbsenderHerkunft | undefined, antworte: (antwort: unknown) => void): boolean | undefined => {
    const antwort = bearbeiteErkennerNachricht(nachricht, absender);
    if (!antwort) return undefined;
    antwort.then(antworte, (e) => antworte(fehlerAntwortFuer(nachricht, e)));
    return true;
  };
  browser.runtime.onMessage.addListener(horcher);
  return () => browser.runtime.onMessage.removeListener(horcher);
}
