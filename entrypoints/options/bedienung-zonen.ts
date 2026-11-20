// Einstellungsseite, Zonenwahl und Kleidungsfrage als Anschluss an den Speicher (Phase 11 E4d2, F1 und F2). Beide Bausteine lesen den gespeicherten
// Stand ueber `stand()` (keine eigene Kopie). Das Anzeigen und `setze()` schreiben nie. Geschrieben wird nur nach einer Handlung des Nutzers, und nur,
// wenn der gespeicherte Stand noch der ist, auf dem die Handlung gerechnet wurde (sonst wuerde ein alter Stand neuere Deckung ueberschreiben).
// Nach jeder Aenderung, jedem Speicherfehler und jeder Aenderung von aussen ruft die Seite `zeichne`, das beide Bausteine neu zeichnet.
import { STANDARD, type Einstellungen } from '../../src/einstellungen';
import { baueHinweis, baueKleidungsfrage, baueZonenwahl, zonenSchreibteil, type KleidungsfrageHandle, type ZonenwahlHandle } from '../../src/oberflaeche/bausteine/bausteine';
import type { ZonenStand } from '../../src/einstieg/zonen';
import { zonenUnterKleidung } from '../../src/oberflaeche/bausteine/bausteine';
import { waehleKleidungHinweis } from '../../src/oberflaeche/hinweise';
import { KLEIDUNG_TEXTE, ZONEN_NAMEN, ZONEN_TEXTE, ZONEN_VERWORFEN } from './bedienung-texte';
import { speichere } from './grund-speichern';

let stand: ZonenStand = STANDARD.zonen;
let zonenwahl: ZonenwahlHandle | null = null;
let kleidung: KleidungsfrageHandle | null = null;
let verworfen: { setzeSichtbar(an: boolean): void } | null = null;
// E4t W5: der Hinweis zu einer verworfenen Handlung verdraengt fuer seine Dauer die gewoehnlichen Hinweise des Elements (Kleidungshinweis, Absatz zu Censor bars).
let verworfenSichtbar = false;
let beiVerworfenWechsel: (() => void) | null = null;
export const zonenVerworfenSichtbar = (): boolean => verworfenSichtbar;
export function horcheAufVerworfen(f: () => void): void {
  beiVerworfenWechsel = f;
}
function zeichneKleidungHinweis(): void {
  kleidung?.setzeHinweis(waehleKleidungHinweis({ gemischt: kleidung.stand() === 'gemischt', namen: zonenUnterKleidung(stand).map((z) => ZONEN_NAMEN[z]), verworfen: verworfenSichtbar }));
}

function schreibe(neu: ZonenStand, zeichneAlles: (e: Einstellungen, erzwingen?: boolean) => void): void {
  verworfen?.setzeSichtbar(false); // der Hinweis zur letzten verworfenen Handlung gilt nur bis zur naechsten Handlung
  const vorher = stand; // der Stand, auf dem der Baustein gerade gerechnet hat
  stand = neu; // der Baustein zeigt schon `neu`; folgt eine zweite Handlung vor dem Speichern, rechnet sie auf diesem Stand
  let verworfenJetzt = false;
  // Bei Erfolg zeichnet `speichere` den gespeicherten Stand (auch wenn die Handlung verworfen wurde), bei einem Fehler den alten Stand und der Fehlersatz steht.
  // G3: eine Handlung gilt nur fuer den Stand, den der Nutzer gesehen hat; hat er sich geaendert, wird nichts geschrieben, KEIN zweiter Versuch, aber ein Hinweis.
  void speichere(
    (alt) => {
      const teil = zonenSchreibteil(alt.zonen, vorher, neu);
      if (teil === null) verworfenJetzt = true; // nichts schreiben
      return teil;
    },
    (e) => zeichneAlles(e, true),
  ).then(() => {
    if (verworfenJetzt) verworfen?.setzeSichtbar(true);
  });
}

export function zeichneZonenBedienung(e: Einstellungen, ortZonen: HTMLElement, ortKleidung: HTMLElement, zeichneAlles: (e: Einstellungen, erzwingen?: boolean) => void): void {
  stand = e.zonen;
  if (!zonenwahl) {
    zonenwahl = baueZonenwahl({
      titel: ZONEN_TEXTE.titel,
      beschriftetDurch: 'zonen-titel', // W8: die Ueberschrift "Zones" steht schon darueber
      karten: ZONEN_TEXTE.karten,
      einzeln: { titel: ZONEN_TEXTE.einzeln.titel, stand: ZONEN_TEXTE.einzeln.stand, gruppenLabel: ZONEN_TEXTE.einzeln.gruppenLabel, namen: ZONEN_NAMEN },
      zonen: () => stand,
      beiAenderung: (neu) => schreibe(neu, zeichneAlles),
    });
    zonenwahl.element.id = 'zonen-wahl';
    ortZonen.append(zonenwahl.element);
    // G3: der Hinweis zu einer verworfenen Handlung (ein Baustein `baueHinweis`, anfangs verborgen)
    const hinweis = baueHinweis(ZONEN_VERWORFEN);
    hinweis.id = 'zonen-verworfen';
    hinweis.setAttribute('role', 'status');
    hinweis.hidden = true;
    ortZonen.append(hinweis);
    verworfen = {
      setzeSichtbar: (an) => {
        hinweis.hidden = !an;
        verworfenSichtbar = an;
        zeichneKleidungHinweis();
        beiVerworfenWechsel?.();
      },
    };
  }
  if (!kleidung) {
    kleidung = baueKleidungsfrage({
      titel: KLEIDUNG_TEXTE.titel,
      erklaerung: KLEIDUNG_TEXTE.erklaerung,
      antworten: KLEIDUNG_TEXTE.antworten,
      zonen: () => stand,
      beiAenderung: (neu) => schreibe(neu, zeichneAlles),
    });
    kleidung.element.id = 'kleidung-frage';
    ortKleidung.append(kleidung.element);
  }
  zonenwahl.setze();
  kleidung.setze();
  // Der eine Hinweis der Frage: bei einem gemischten Stand (keine Antwort markiert) nennt er, was heute unter Kleidung gedeckt wird.
  zeichneKleidungHinweis();
}

export function zonenwahlHandle(): ZonenwahlHandle | null {
  return zonenwahl;
}
