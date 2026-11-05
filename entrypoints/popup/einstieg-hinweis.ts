// Popup: Platz #einstieg-hinweis (Auftrag E). Solange der Einstieg (Warnung, 18+, Einwilligung) fehlt: eine Zeile und der Knopf "Meet Mia",
// der die Willkommensseite oeffnet. Danach bleibt der Platz verborgen. Folgt Aenderungen von `einstieg` im Speicher.
import { beiEinstiegAenderung, zeigeWillkommen } from '../../src/einstieg/speicher';
import { einstiegFertig, ladeEinstieg, type EinstiegStand } from '../../src/einstieg/vertrag';

const platz = document.getElementById('einstieg-hinweis');

// Entwuerfe fuer den Texter.
const HINWEIS_TEXT = 'We haven’t properly met yet. Say hello, then the Mia Pack opens up.';
const HINWEIS_KNOPF = 'Meet Mia';

if (platz) {
  const karte = document.createElement('section');
  const text = document.createElement('p');
  text.className = 'hinweis';
  text.textContent = HINWEIS_TEXT;
  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.id = 'einstieg-knopf';
  knopf.className = 'klein';
  knopf.textContent = HINWEIS_KNOPF;
  knopf.addEventListener('click', () => {
    void zeigeWillkommen().then(() => window.close(), () => {});
  });
  karte.append(text, knopf);
  platz.append(karte);

  const zeichne = (s: EinstiegStand) => {
    platz.hidden = einstiegFertig(s);
  };
  void ladeEinstieg().then(zeichne, () => {});
  beiEinstiegAenderung(zeichne);
}
