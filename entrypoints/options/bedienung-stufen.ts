// Einstellungsseite, Stufenwahl als Anschluss an den Speicher (Phase 11 E4d2, F3): baut einen Baustein `baueStufenwahl` in einen Platz der Seite und haelt ihn
// mit dem gespeicherten Stand zusammen. Das Anzeigen und das Setzen schreiben nie; geschrieben wird nur nach einer Handlung des Nutzers (Stufe oder
// Regler "Exact value" losgelassen). Scheitert das Speichern, steht der Fehlersatz in der Leiste und das Element zeigt wieder den gespeicherten Stand.
import type { Einstellungen } from '../../src/einstellungen';
import { baueStufenwahl, type StufenAnsicht, type StufenListe, type StufenwahlHandle } from '../../src/oberflaeche/bausteine/bausteine';
import type { ErklaerungEingabe } from '../../src/oberflaeche/bausteine/dom';
import { speichere } from './grund-speichern';

export interface StufenAnschluss {
  titel: string;
  erklaerung?: ErklaerungEingabe;
  liste: StufenListe;
  exakt: { titel: string; formatiere: (wert: number) => string; reglerLabel: string };
  hinweisFuer?: (ansicht: StufenAnsicht, wert: number) => string | null;
  lies: (e: Einstellungen) => number; // gespeicherter Wert im Speichermass
  schreibe: (alt: Einstellungen, wert: number) => Partial<Einstellungen>; // Teil, der geschrieben wird (auf den frisch gelesenen Stand aufgesetzt)
  nachAnzeige?: (wert: number) => void; // zum Beispiel das Stimmungswort im Kopf
}

export interface StufenElement {
  handle: StufenwahlHandle | null;
  // Zeichnet den gespeicherten Stand; baut den Baustein beim ersten Mal. `erzwingen`: auch der Regler mit Fokus (nach einem gescheiterten Speichern).
  zeichne(e: Einstellungen, erzwingen?: boolean): void;
}

// `ort`: der Platz in der Seite; `kennung`: die id der Wurzel des Bausteins (ein Behaelter, den die Tests nach fester Regel pruefen).
export function haengeStufenwahl(ort: HTMLElement, kennung: string, a: StufenAnschluss): StufenElement {
  let letzter: Einstellungen | null = null; // der zuletzt gesehene gespeicherte Stand, auch wenn der Regler ihn gerade nicht zeigen durfte
  const el: StufenElement = {
    handle: null,
    zeichne(e, erzwingen = false) {
      letzter = e;
      const wert = a.lies(e);
      if (!el.handle) {
        const h = baueStufenwahl({
          titel: a.titel,
          erklaerung: a.erklaerung,
          liste: a.liste,
          wert,
          exakt: a.exakt,
          hinweisFuer: a.hinweisFuer,
          beiAenderung: (neu) => {
            void speichere((alt) => a.schreibe(alt, neu), (s) => el.zeichne(s, true), false).then((gespeichert) => {
              if (gespeichert) el.zeichne(gespeichert);
            });
          },
        });
        h.element.id = kennung;
        h.regler.addEventListener('input', () => a.nachAnzeige?.(Number(h.regler.value)));
        // G2: verliert der Regler den Fokus, zeigt das Element wieder den gespeicherten Stand (Regler und Stufen); ein Zug ohne Loslassen schreibt nichts.
        h.regler.addEventListener('blur', () => {
          if (letzter) el.zeichne(letzter, true);
        });
        ort.append(h.element);
        el.handle = h;
        a.nachAnzeige?.(wert);
        return;
      }
      // Ein Regler, an dem der Nutzer gerade zieht, wird nicht unter der Hand zurueckgestellt, ausser nach einem Speicherfehler.
      if (!erzwingen && document.activeElement === el.handle.regler) return;
      el.handle.setze(wert);
      a.nachAnzeige?.(wert);
    },
  };
  return el;
}
