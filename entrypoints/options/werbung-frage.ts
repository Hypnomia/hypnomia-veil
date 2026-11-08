// Einstellungsseite, einmalige Frage "Show my ads?" nach dem Pack-Import (Session 17, Entscheidung 179, Paket C, Fund 12). Frueher in
// kontrolle.ts, jetzt Teil von "Set me up" in der Pack-Karte. Die Frage steht, solange das Pack den Werbe-Tausch freischaltet und noch keine
// Antwort gespeichert ist. Ja und Nein schreiben `kontrolle.werbung` und `kontrolle.werbungGefragt: true`. ids wie in Session 17 (C2).
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { speichere } from './grund-speichern';
import { TEXT_WERBUNG_JA, TEXT_WERBUNG_NEIN, TEXT_WERBUNG_TEXT, TEXT_WERBUNG_TITEL } from './pack-texte';

let zuletzt: Einstellungen | null = null;
let pack: PackKurz | null = null;
let frage: HTMLElement | null = null;
let beiAenderung: () => void = () => {};

export function werbungFrageOffen(): boolean {
  return !!zuletzt && !zuletzt.kontrolle.werbungGefragt && istFreigeschaltet(pack, 'kontrolle:werbung');
}

function zeichne(): void {
  if (frage) frage.hidden = !werbungFrageOffen();
  beiAenderung();
}

// Liest Pack und Einstellungen jetzt und zeichnet neu (nach dem Import, bevor der Fokus gesetzt wird).
export async function frischeWerbungFrageAuf(): Promise<void> {
  try {
    [pack, zuletzt] = await Promise.all([ladePackKurz(), ladeEinstellungen()]);
  } catch {
    // die Horcher zeichnen beim naechsten Stand
  }
  zeichne();
}

export function baueWerbungFrage(nachAntwort: () => void, bei: () => void): HTMLElement {
  beiAenderung = bei;
  const wurzel = document.createElement('div');
  wurzel.id = 'werbung-frage';
  wurzel.className = 'frage werbung-frage';
  wurzel.setAttribute('role', 'group');
  wurzel.setAttribute('aria-labelledby', 'werbung-frage-titel');
  wurzel.hidden = true;
  frage = wurzel;
  const titel = document.createElement('p');
  titel.id = 'werbung-frage-titel';
  titel.tabIndex = -1;
  const fett = document.createElement('strong');
  fett.textContent = TEXT_WERBUNG_TITEL;
  titel.append(fett);
  const text = document.createElement('p');
  text.id = 'werbung-frage-text';
  text.className = 'hinweis';
  text.textContent = TEXT_WERBUNG_TEXT;
  const knoepfe = document.createElement('div');
  knoepfe.className = 'knoepfe';
  const ja = document.createElement('button');
  ja.id = 'werbung-frage-ja';
  ja.className = 'klein';
  ja.type = 'button';
  ja.textContent = TEXT_WERBUNG_JA;
  const nein = document.createElement('button');
  nein.id = 'werbung-frage-nein';
  nein.className = 'klein ruhig';
  nein.type = 'button';
  nein.textContent = TEXT_WERBUNG_NEIN;
  knoepfe.append(ja, nein);
  wurzel.append(titel, text, knoepfe);

  const beantworte = (wert: boolean): void => {
    void speichere(
      (alt) => ({ kontrolle: { ...alt.kontrolle, werbung: wert, werbungGefragt: true } }),
      (e) => {
        zuletzt = e;
        zeichne();
      },
    ).then((neu) => {
      if (neu) nachAntwort();
    });
  };
  ja.addEventListener('click', () => beantworte(true));
  nein.addEventListener('click', () => beantworte(false));

  const abmelden = beiEinstellungsAenderung((e) => {
    zuletzt = e;
    zeichne();
  });
  const horcher = (aenderungen: Record<string, unknown>, bereich: string): void => {
    if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) void ladePackKurz().then((p) => { pack = p; zeichne(); }, () => {});
  };
  browser.storage.onChanged.addListener(horcher);
  window.addEventListener('pagehide', () => {
    abmelden();
    browser.storage.onChanged.removeListener(horcher);
  }, { once: true });
  void frischeWerbungFrageAuf();
  return wurzel;
}
