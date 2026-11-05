// Ereignis-Kanal im Content-Script (Vertrag Session 11, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 1).
// Schleier, Riegel, Blitz, Werbung, Spirale und Besuche melden hier, was passiert ist; der Ledger (Auftrag L) zaehlt mit, der Ton
// (Auftrag T) spielt dazu. Nur innerhalb eines Frames, kein Netz, keine Nachricht. Hoerer laufen synchron; ein Fehler eines Hoerers
// erreicht weder den Melder noch die anderen Hoerer.

export type VeilEreignis =
  | { art: 'zensiert' } // ein Element hat gerade das Urteil `zensiert` bekommen (neuer Inhalt)
  | { art: 'quiz-start' } // der Quiz-Riegel zeigt seine erste Frage
  | { art: 'quiz-richtig' } // richtig, der Riegel ist geloest
  | { art: 'quiz-falsch' } // falsch, naechste Frage
  | { art: 'quiz-verweigert' } // richtig, aber Mia verweigert
  | { art: 'blitz'; woerter: number } // eine Folge von Blitzwoertern beginnt; `woerter` = geplante Woerter (hoechstens 12, ein Abbruch
  // im Lauf zaehlt trotzdem mit, bewusst: der Ledger zaehlt Mias Absicht)
  | { art: 'werbung' } // eine Werbeflaeche zeigt erstmals Mias Werbung (je Seitenelement einmal)
  | { art: 'spirale' } // die Leerlauf-Spirale erscheint
  | { art: 'besuch' }; // Mia hat einen Besuch geoeffnet (Antwort des Hintergrunds ok)

export type EreignisArt = VeilEreignis['art'];
export const EREIGNIS_ARTEN = [
  'zensiert',
  'quiz-start',
  'quiz-richtig',
  'quiz-falsch',
  'quiz-verweigert',
  'blitz',
  'werbung',
  'spirale',
  'besuch',
] as const satisfies readonly EreignisArt[];
type _ArtenVollstaendig = Exclude<EreignisArt, (typeof EREIGNIS_ARTEN)[number]> extends never ? true : never;
const _artenVollstaendig: _ArtenVollstaendig = true;
void _artenVollstaendig;

type Hoerer = (e: VeilEreignis) => void;
const hoerer = new Set<Hoerer>();

export function melde(e: VeilEreignis): void {
  for (const h of [...hoerer]) {
    try {
      h(e);
    } catch {
      // ein kaputter Hoerer stoert niemanden
    }
  }
}

// Meldet `fn` fuer jedes Ereignis an; gibt die Abmeldung zurueck.
export function beiEreignis(fn: Hoerer): () => void {
  hoerer.add(fn);
  return () => hoerer.delete(fn);
}
