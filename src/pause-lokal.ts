// Gemeinsames lokales Pause-Signal je Frame (Vertrag Session 8, Pruefer-Fund T3): der Knopf "Pause Mia" im Riegel (und in der Galerie)
// gibt SOFORT alles frei, auch wenn der Hintergrund nicht antwortet und die gespeicherte Pause darum spaeter oder nie ankommt.
// Player, Titel, Freilegen und Galerie hoeren hier zu (`beiLokalerPause`) und fragen `istLokalePause()` in ihrer Bedingung ab.
// Zurueckgesetzt wird das Signal erst, wenn die gespeicherte Pause einmal an war und danach wieder aus ist (Pause beendet).
import { beiEinstellungsAenderung } from './einstellungen';

let lokal = false;
let gespeichertGesehen = false;
let abmelden: (() => void) | null = null;
const hoerer = new Set<() => void>();

// Mit `aktuell` (die gerade gelesenen Einstellungen) haengt das Ergebnis nicht von der Reihenfolge der Speicher-Hoerer ab: wer bei einer
// Einstellungsaenderung fragt, bevor der Hoerer dieses Moduls lief, bekommt trotzdem den neuen Stand (Pause an gesehen, jetzt aus = vorbei).
export function istLokalePause(aktuell?: { pause: boolean }): boolean {
  if (lokal && aktuell) {
    if (aktuell.pause) gespeichertGesehen = true;
    else if (gespeichertGesehen) setzeZurueck();
  }
  return lokal;
}

function setzeZurueck(): void {
  lokal = false;
  gespeichertGesehen = false;
  abmelden?.();
  abmelden = null;
}

export function meldeLokalePause(): void {
  if (!abmelden) {
    try {
      abmelden = beiEinstellungsAenderung((neu) => {
        if (neu.pause) gespeichertGesehen = true;
        else if (gespeichertGesehen) setzeZurueck();
      });
    } catch {
      // ohne Speicher-Zugriff bleibt die lokale Pause bis zum Neuladen an
    }
  }
  const neu = !lokal;
  lokal = true;
  if (!neu) return;
  for (const h of [...hoerer]) {
    try {
      h();
    } catch {
      // ein fehlerhafter Hoerer stoert die anderen nicht
    }
  }
}

// Meldet jede neue lokale Pause; liefert die Abmeldung.
export function beiLokalerPause(rueckruf: () => void): () => void {
  hoerer.add(rueckruf);
  return () => hoerer.delete(rueckruf);
}
