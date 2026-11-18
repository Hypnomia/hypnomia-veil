// Einstellungsseite, Platz der festen Vorschau (Phase 11 E4d1, Entscheidung 279): neben dem Reiterinhalt (schmal als Streifen darueber) steht in jedem
// Reiter dieselbe Vorschau. Bis Etappe 5 zeigt sie die heutige Stilvorschau des gespeicherten Stils mit Etikett. Sie liest nur, sie schreibt nie
// und hat keine eigene Kopie der Einstellungen: grund.ts ruft `zeigeVorschau` mit dem Stil, der wirklich gilt.
import '../../src/oberflaeche/bausteine/bausteine.css';
import { baueVorschauPlatz } from '../../src/oberflaeche/bausteine/bausteine';
import { presetVorschau } from '../../src/oberflaeche/presets-ansicht';
import { VORSCHAU_KOPF, VORSCHAU_LABEL } from './reiter-daten';

const spalte = document.getElementById('vorschau-spalte');
const kopf = document.createElement('p');
kopf.className = 'vorschau-kopf';
kopf.textContent = VORSCHAU_KOPF;
const platz = baueVorschauPlatz({ label: VORSCHAU_LABEL });
spalte?.append(kopf, platz.element);

let gezeigt = '';

export function zeigeVorschau(kennung: string, name: string): void {
  // Nur bei einem anderen Stil neu zeichnen (die Seite ruft bei jeder Aenderung irgendeiner Einstellung).
  if (kennung === gezeigt) return;
  gezeigt = kennung;
  // Der Praefix `vorschau` haelt die Filter-Kennungen des Bildes getrennt von denen der Stilkarten (keine doppelte id im Dokument).
  platz.flaeche.innerHTML = presetVorschau(kennung as never, 'vorschau');
  platz.setzeEtikett(name);
}
