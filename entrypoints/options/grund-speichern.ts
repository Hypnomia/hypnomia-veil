// Einstellungsseite, gemeinsames Speichern (Session 12, Auftrag O, UX-Fund 26): jeder Schalter, Regler, jede Auswahl und jedes Feld speichert
// ueber `speichere`. Scheitert das Speichern, steht `FEHLER_SPEICHERN` sichtbar in der klebenden Leiste (`#speicher-meldung`, ohne Scrollen
// zu sehen), und das Element springt auf den gespeicherten Stand zurueck (`zeichneNeu` bekommt den frisch gelesenen Stand). Gelingt ein
// Speichern, verschwindet die Meldung wieder.
import { aendereEinstellungen, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';

function meldung(): HTMLElement | null {
  return document.getElementById('speicher-meldung');
}

export function zeigeSpeicherFehler(): void {
  const m = meldung();
  if (!m) return;
  // Auch ein zweiter Fehler wird neu angesagt: Text leeren, im naechsten Frame neu setzen (role="alert") und kurz hervorheben.
  m.textContent = '';
  m.hidden = false;
  m.classList.remove('neu');
  requestAnimationFrame(() => {
    m.textContent = FEHLER_SPEICHERN;
    m.classList.add('neu');
  });
}

export function loescheSpeicherFehler(): void {
  const m = meldung();
  if (!m) return;
  m.textContent = '';
  m.hidden = true;
}

// Speichert und zeichnet den gespeicherten Stand neu (bei Erfolg nur mit `auchBeiErfolg`, sonst nur beim Scheitern). Rueckgabe: der neue
// Stand, bei Fehler null (nach Meldung und Zuruecksetzen).
export async function speichere(
  teil: (alt: Einstellungen) => Partial<Einstellungen>,
  zeichneNeu: (e: Einstellungen) => void,
  auchBeiErfolg = true,
): Promise<Einstellungen | null> {
  try {
    const neu = await aendereEinstellungen(teil);
    loescheSpeicherFehler();
    if (auchBeiErfolg) zeichneNeu(neu);
    return neu;
  } catch {
    zeigeSpeicherFehler();
    try {
      zeichneNeu(await ladeEinstellungen());
    } catch {
      // Lesen scheitert auch: die Meldung steht, mehr geht nicht.
    }
    return null;
  }
}
