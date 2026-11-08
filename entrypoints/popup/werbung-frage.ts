// Popup: Werbe-Frage "Show my ads?" (Phase 9, Paket A, Fund 12). Erscheint als Karte unter der Pause, solange das Pack den Werbe-Tausch
// freischaltet (`kontrolle:werbung`) und `kontrolle.werbungGefragt` fehlt. Ja oder Nein schreiben `kontrolle.werbung` und
// `kontrolle.werbungGefragt: true` (wie die Frage auf der Einstellungsseite). Texte nur per textContent. Folgt Aenderungen im Speicher.
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';
import * as T from './texte';

const karte = document.getElementById('popup-werbung-frage');
const titel = document.getElementById('popup-werbung-frage-titel');
const text = document.getElementById('popup-werbung-frage-text');
const ja = document.getElementById('popup-werbung-frage-ja') as HTMLButtonElement | null;
const nein = document.getElementById('popup-werbung-frage-nein') as HTMLButtonElement | null;
const fehler = document.getElementById('popup-werbung-frage-fehler');

if (karte && titel && text && ja && nein && fehler) {
  titel.textContent = T.WERBUNG_FRAGE_TITEL;
  text.textContent = T.WERBUNG_FRAGE_TEXT;
  ja.textContent = T.WERBUNG_FRAGE_JA;
  nein.textContent = T.WERBUNG_FRAGE_NEIN;

  let einst: Einstellungen | null = null;
  let pack: PackKurz | null = null;
  const zeichne = (): void => {
    karte.hidden = !(einst && !einst.kontrolle.werbungGefragt && istFreigeschaltet(pack, 'kontrolle:werbung'));
  };

  const beantworte = (wert: boolean): void => {
    ja.disabled = nein.disabled = true;
    void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, werbung: wert, werbungGefragt: true } })).then(
      (neu) => {
        einst = neu;
        fehler.hidden = true;
        zeichne();
        ja.disabled = nein.disabled = false;
        // Der Fokus geht nicht verloren: die Karte verschwindet, er landet auf der Pause.
        if (karte.hidden) document.getElementById('pause')?.focus();
      },
      () => {
        fehler.textContent = FEHLER_SPEICHERN;
        fehler.hidden = false;
        ja.disabled = nein.disabled = false;
      },
    );
  };
  ja.addEventListener('click', () => beantworte(true));
  nein.addEventListener('click', () => beantworte(false));

  const abmelden = beiEinstellungsAenderung((e) => {
    einst = e;
    zeichne();
  });
  const horcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
    pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
    zeichne();
  };
  browser.storage.onChanged.addListener(horcher);
  window.addEventListener(
    'pagehide',
    () => {
      abmelden();
      browser.storage.onChanged.removeListener(horcher);
    },
    { once: true },
  );
  void Promise.all([ladeEinstellungen().catch(() => null), ladePackKurz().catch(() => null)]).then(([e, p]) => {
    einst = e;
    pack = p;
    zeichne();
  });
}
