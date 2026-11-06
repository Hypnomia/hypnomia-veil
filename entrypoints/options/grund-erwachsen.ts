// Einstellungsseite, Abschnitt "Adult sites": die drei Schalter, die es sonst nur im Popup (mit Pack) und im Interview gibt
// (Session 11, Auftrag S, Entscheidung 133). Auch ohne Pack einstellbar (wirkt erst mit Pack, der Hinweis steht in main.ts).
// "Full replacement" ist nur waehlbar, wenn "Adult-site mode" an ist. Folgt Speicher-Aenderungen.
import { STUFEN_WAHL, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen, type StufeWahl } from '../../src/einstellungen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { speichere } from './grund-speichern';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const an = el<HTMLInputElement>('erw-an');
const ersatz = el<HTMLInputElement>('erw-ersatz');
const inhalt = el<HTMLInputElement>('erw-inhalt');

// Intensitaet (Phase 7, Auftrag I1): nur mit Freischaltung `erwachsen:vorschau` sichtbar und schaltbar, sonst ein Satz. Die Zeile je Knopf
// (Mias Stimme) steht im Label des Knopfs (index.html).
const stufeWahl = el<HTMLDivElement>('stufe-wahl');
const stufeGesperrt = el<HTMLParagraphElement>('stufe-gesperrt');
const stufeKnoepfe = [...document.querySelectorAll<HTMLInputElement>('input[name="stufe"]')];
let stufeFrei = false;
let letzteEinstellung: Einstellungen | null = null;

function zeichneStufe(): void {
  stufeWahl.hidden = !stufeFrei;
  stufeGesperrt.hidden = stufeFrei;
  const stufe = letzteEinstellung?.erwachsen.stufe;
  for (const k of stufeKnoepfe) {
    k.checked = k.value === stufe;
    k.disabled = !stufeFrei;
  }
}

function zeichnePack(pack: PackKurz | null): void {
  stufeFrei = istFreigeschaltet(pack, 'erwachsen:vorschau');
  zeichneStufe();
}

for (const k of stufeKnoepfe) {
  k.addEventListener('change', () => {
    if (!k.checked || !stufeFrei || !(STUFEN_WAHL as readonly string[]).includes(k.value)) return;
    const wert = k.value as StufeWahl;
    void speichere((alt) => ({ erwachsen: { ...alt.erwachsen, stufe: wert } }), zeichne);
  });
}

function zeichne(e: Einstellungen): void {
  letzteEinstellung = e;
  zeichneStufe();
  an.checked = e.erwachsen.an;
  ersatz.checked = e.erwachsen.komplettErsatz;
  ersatz.disabled = !e.erwachsen.an;
  ersatz.closest('label')?.classList.toggle('gesperrt', !e.erwachsen.an);
  inhalt.checked = e.erwachsen.erkennenAmInhalt;
}

// Wert beim Ereignis festhalten (ein Zeichnen aus fremder Aenderung darf ihn nicht ueberschreiben).
an.addEventListener('change', () => {
  const wert = an.checked;
  void speichere((alt) => ({ erwachsen: { ...alt.erwachsen, an: wert } }), zeichne);
});
ersatz.addEventListener('change', () => {
  const wert = ersatz.checked;
  void speichere((alt) => ({ erwachsen: { ...alt.erwachsen, komplettErsatz: wert } }), zeichne);
});
inhalt.addEventListener('change', () => {
  const wert = inhalt.checked;
  void speichere((alt) => ({ erwachsen: { ...alt.erwachsen, erkennenAmInhalt: wert } }), zeichne);
});

const abmelden = beiEinstellungsAenderung(zeichne);
const packHorcher = (aenderungen: Record<string, unknown>, bereich: string): void => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) void ladePackKurz().then(zeichnePack, () => zeichnePack(null));
};
browser.storage.onChanged.addListener(packHorcher);
window.addEventListener('pagehide', () => {
  abmelden();
  browser.storage.onChanged.removeListener(packHorcher);
}, { once: true });
void ladePackKurz().then(zeichnePack, () => zeichnePack(null));
void ladeEinstellungen().then(zeichne);
