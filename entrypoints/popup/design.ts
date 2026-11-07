// Phase 8b, Auftrag U: Kopf des Popups im Look "Sakura Glas". Zeichnet nur Schmuck (Augenpaar, grosse Spirale) in den Kopf,
// keine Logik. Die Spirale dreht sich langsam (14 s); aus bei prefers-reduced-motion (tokens.css) und im Ruhig-Modus (html[data-ruhig]).
import { augenpaar, spiralAuge } from '../../src/oberflaeche/design/motive';

const kopf = document.querySelector<HTMLElement>('header');
const zeile = document.querySelector<HTMLElement>('.kopfzeile');
const titel = zeile?.querySelector('h1');
if (kopf && zeile && titel) {
  const marke = document.createElement('div');
  marke.className = 'marke';
  titel.replaceWith(marke);
  marke.append(augenpaar(22), titel);

  const spirale = document.createElement('span');
  spirale.className = 'spirale-gross';
  spirale.setAttribute('aria-hidden', 'true');
  spirale.append(spiralAuge(150, true));
  kopf.prepend(spirale);
}
