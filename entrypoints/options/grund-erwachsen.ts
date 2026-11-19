// Einstellungsseite, Abschnitt "Adult sites": die Gruppe Off, Tease, Hot, Explicit und zwei Schalter, die es sonst nur im Popup (mit Pack) und im Interview gibt
// (Session 11, Auftrag S, Entscheidung 133). Die Zeile "Off" ist auch ohne Pack waehlbar, die Stufen erst mit Pack (der Hinweis steht in main.ts).
// "Full replacement" ist nur waehlbar, wenn die Gruppe nicht auf "Off" steht. Folgt Speicher-Aenderungen.
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { baueWahlkarten, type WahlkartenHandle } from '../../src/oberflaeche/bausteine/bausteine';
import { erwachsenGesperrt, erwachsenKarte, erwachsenKarten, erwachsenNachWahl } from '../../src/oberflaeche/bausteine/erwachsen-wahl';
import { ERWACHSEN_TEXTE } from './bedienung-texte';
import { speichere } from './grund-speichern';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const ersatz = el<HTMLInputElement>('erw-ersatz');
const inhalt = el<HTMLInputElement>('erw-inhalt');

// F4 (E4d2): eine Gruppe fuer `erwachsen.an` und `erwachsen.stufe`, Logik in src/oberflaeche/bausteine/erwachsen-wahl.ts. Ohne Freischaltung
// `erwachsen:vorschau` bleibt `an` an UND aus schaltbar wie bei HEAD (Karten Off und On), die Stufe gesperrt mit dem Hinweis von heute.
let wahl: WahlkartenHandle | null = null;
let stufeFrei = false;
let letzteEinstellung: Einstellungen | null = null;

// Die Gruppe hat zwei Formen (G1): mit Freischaltung Off, Tease, Hot, Explicit; ohne sie Off und On (waehlbar) und die drei Stufen gesperrt und nie markiert.
// Wechselt die Form (Pack kommt oder geht bei offener Seite), wird der Baustein neu gebaut und gezeichnet, nie geschrieben.
let form: boolean | null = null;

function zeichneStufe(): void {
  const e = letzteEinstellung;
  if (!e) return;
  if (!wahl || form !== stufeFrei) {
    const alt = wahl;
    wahl = baueWahlkarten({
      titel: ERWACHSEN_TEXTE.titel,
      karten: erwachsenKarten(stufeFrei).map((id) => ({ id, ...ERWACHSEN_TEXTE.karten[id] })),
      wert: null,
      spalten: stufeFrei ? 4 : 5,
      beiAenderung: waehleStufe,
    });
    wahl.element.id = 'erw-stufe-wahl';
    if (alt) alt.element.replaceWith(wahl.element);
    else el('erw-stufe-ort').append(wahl.element);
    form = stufeFrei;
  }
  // Erst sperren, dann markieren: die Markierung legt den Tab-Halt auf die gewaehlte, sonst auf die erste waehlbare Karte.
  wahl.setzeGesperrt(erwachsenGesperrt(stufeFrei));
  wahl.setze(erwachsenKarte(e.erwachsen, stufeFrei));
  wahl.setzeHinweis(stufeFrei ? null : ERWACHSEN_TEXTE.gesperrt);
}

function waehleStufe(id: string): void {
  // Die Wahl rechnet auf dem frisch gelesenen Stand; eine gesperrte Stufe schreibt nichts, die Anzeige zeigt wieder den gespeicherten Stand.
  let gilt = true;
  void speichere(
    (alt) => {
      const neu = erwachsenNachWahl(alt.erwachsen, id, stufeFrei);
      gilt = neu !== null;
      return neu ? { erwachsen: neu } : {};
    },
    zeichne,
  ).then(() => {
    if (!gilt) zeichneStufe();
  });
}

function zeichnePack(pack: PackKurz | null): void {
  stufeFrei = istFreigeschaltet(pack, 'erwachsen:vorschau');
  zeichneStufe();
}

function zeichne(e: Einstellungen): void {
  letzteEinstellung = e;
  zeichneStufe();
  ersatz.checked = e.erwachsen.komplettErsatz;
  ersatz.disabled = !e.erwachsen.an;
  ersatz.closest('label')?.classList.toggle('gesperrt', !e.erwachsen.an);
  inhalt.checked = e.erwachsen.erkennenAmInhalt;
}

// Wert beim Ereignis festhalten (ein Zeichnen aus fremder Aenderung darf ihn nicht ueberschreiben).
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
