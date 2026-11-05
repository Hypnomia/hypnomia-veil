// Einstellungsseite, Abschnitt "Adult sites": die drei Schalter, die es sonst nur im Popup (mit Pack) und im Interview gibt
// (Session 11, Auftrag S, Entscheidung 133). Auch ohne Pack einstellbar (wirkt erst mit Pack, der Hinweis steht in main.ts).
// "Full replacement" ist nur waehlbar, wenn "Adult-site mode" an ist. Folgt Speicher-Aenderungen.
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const an = el<HTMLInputElement>('erw-an');
const ersatz = el<HTMLInputElement>('erw-ersatz');
const inhalt = el<HTMLInputElement>('erw-inhalt');

function zeichne(e: Einstellungen): void {
  an.checked = e.erwachsen.an;
  ersatz.checked = e.erwachsen.komplettErsatz;
  ersatz.disabled = !e.erwachsen.an;
  ersatz.closest('label')?.classList.toggle('gesperrt', !e.erwachsen.an);
  inhalt.checked = e.erwachsen.erkennenAmInhalt;
}

// Wert beim Ereignis festhalten (ein Zeichnen aus fremder Aenderung darf ihn nicht ueberschreiben).
an.addEventListener('change', () => {
  const wert = an.checked;
  void aendereEinstellungen((alt) => ({ erwachsen: { ...alt.erwachsen, an: wert } })).then(zeichne);
});
ersatz.addEventListener('change', () => {
  const wert = ersatz.checked;
  void aendereEinstellungen((alt) => ({ erwachsen: { ...alt.erwachsen, komplettErsatz: wert } })).then(zeichne);
});
inhalt.addEventListener('change', () => {
  const wert = inhalt.checked;
  void aendereEinstellungen((alt) => ({ erwachsen: { ...alt.erwachsen, erkennenAmInhalt: wert } })).then(zeichne);
});

const abmelden = beiEinstellungsAenderung(zeichne);
window.addEventListener('pagehide', abmelden, { once: true });
void ladeEinstellungen().then(zeichne);
