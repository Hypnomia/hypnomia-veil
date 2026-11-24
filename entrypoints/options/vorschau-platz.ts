// Einstellungsseite, Platz der festen Vorschau (Phase 11 E4d1, Entscheidung 279; E5: echtes Beispielbild): neben dem Reiterinhalt (schmal als Streifen darueber)
// steht in jedem Reiter dieselbe Vorschau. Sie zeigt ein Beispielbild, verdeckt wie die Erweiterung es auf einer Seite verdecken wuerde (src/oberflaeche/vorschau/),
// oder ohne Beispielbilder im Bau die Stilvorschau mit Etikett. Sie liest nur, sie schreibt nie und hat keine eigene Kopie der Einstellungen: grund.ts ruft
// `zeigeVorschau` mit dem Stand, der wirklich gilt.
import '../../src/oberflaeche/bausteine/bausteine.css';
import { baueLiveVorschau, type VorschauStand } from '../../src/oberflaeche/vorschau/ansicht';
import { VORSCHAU_KOPF, VORSCHAU_LABEL } from './reiter-daten';

const spalte = document.getElementById('vorschau-spalte');
const kopf = document.createElement('p');
kopf.className = 'vorschau-kopf';
kopf.textContent = VORSCHAU_KOPF;
// Der Praefix `vorschau` haelt die Filter-Kennungen der Strichzeichnung getrennt von denen der Stilkarten (keine doppelte id im Dokument).
const vorschau = baueLiveVorschau({ label: VORSCHAU_LABEL, praefix: 'vorschau' });
spalte?.append(kopf, vorschau.element);

export function zeigeVorschau(stand: VorschauStand): void {
  vorschau.aktualisiere(stand);
}
