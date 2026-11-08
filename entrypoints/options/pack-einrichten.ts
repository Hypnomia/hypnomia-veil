// Einstellungsseite, Block "Set me up" in der Pack-Karte (Session 17, Paket C, UX-Pruefung Phase 9 Funde 7 und 12): nach dem Import einmal
// die Fragen, die erst mit dem Pack wirken. Zuerst "Show my ads?" (werbung-frage.ts), dann Adult-site mode, Intensitaet, Blitzwoerter und
// Leerlauf-Spirale mit der Anfallswarnung. Antworten speichern sofort. "Done" und "Later" schliessen den Block fuer dieses Pack; "Later"
// laesst die Standards stehen, nur die Werbe-Frage bleibt offen, bis sie beantwortet ist (Opt-in).
import { BLITZ_HAEUFIGKEITEN, STUFEN_WAHL, beiEinstellungsAenderung, ladeEinstellungen, type BlitzHaeufigkeit, type Einstellungen, type StufeWahl } from '../../src/einstellungen';
import { QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL } from '../../src/kontrolle/grenzen';
import { hatErwachsenFunktionen } from '../../src/oberflaeche/erwachsen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { speichere, zeigeSpeicherFehler } from './grund-speichern';
import { baueWerbungFrage, frischeWerbungFrageAuf, werbungFrageOffen } from './werbung-frage';
import {
  TEXT_EINRICHTEN_FERTIG,
  TEXT_EINRICHTEN_SPAETER,
  TEXT_EINRICHTEN_SPAETER_HINWEIS,
  TEXT_EINRICHTEN_TEXT,
  TEXT_EINRICHTEN_TITEL,
  TEXT_EINRICHTEN_WARNUNG,
  TEXT_EINRICHTEN_WARNUNG_OK,
} from './pack-texte';

// storage.local: Kennung des Packs, fuer das "Done" oder "Later" gedrueckt wurde.
export const EINRICHTEN_SCHLUESSEL = 'einrichtenFuer';

let wurzel: HTMLElement;
let rest: HTMLElement;
let titel: HTMLElement;
let warnung: HTMLElement;
let erwAn: HTMLInputElement;
let stufeZeile: HTMLElement;
let stufeKnoepfe: HTMLInputElement[] = [];
let blitzZeile: HTMLElement;
let blitz: HTMLSelectElement;
let leerlaufZeile: HTMLElement;
let leerlauf: HTMLInputElement;
let erwZeile: HTMLElement;

let pack: PackKurz | null = null;
let einst: Einstellungen | null = null;
let erledigtFuer: string | null = null;
let warnungBestaetigt = false;

function schalter(id: string, name: string, klein: string): { zeile: HTMLLabelElement; feld: HTMLInputElement } {
  const zeile = document.createElement('label');
  zeile.className = 'schalter';
  const feld = document.createElement('input');
  feld.id = id;
  feld.type = 'checkbox';
  feld.setAttribute('role', 'switch');
  const regler = document.createElement('span');
  regler.className = 'regler';
  regler.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'text';
  const s = document.createElement('strong');
  s.textContent = name;
  const k = document.createElement('small');
  k.textContent = klein;
  text.append(s, k);
  zeile.append(feld, regler, text);
  return { zeile, feld };
}

function zeichne(): void {
  const hat = !!pack;
  const restOffen = hat && erledigtFuer !== pack!.id;
  const erwFrei = hatErwachsenFunktionen(pack);
  const stufeFrei = istFreigeschaltet(pack, 'erwachsen:vorschau');
  const blitzFrei = istFreigeschaltet(pack, 'kontrolle:blitz');
  const leerFrei = istFreigeschaltet(pack, 'kontrolle:leerlauf');
  erwZeile.hidden = !erwFrei;
  stufeZeile.hidden = !stufeFrei;
  blitzZeile.hidden = !blitzFrei;
  leerlaufZeile.hidden = !leerFrei;
  warnung.hidden = warnungBestaetigt || !(blitzFrei || leerFrei);
  const irgendwas = erwFrei || stufeFrei || blitzFrei || leerFrei;
  rest.hidden = !(restOffen && irgendwas);
  wurzel.hidden = !hat || (rest.hidden && !werbungFrageOffen());
  if (einst) {
    erwAn.checked = einst.erwachsen.an;
    for (const k of stufeKnoepfe) k.checked = k.value === einst.erwachsen.stufe;
    if (document.activeElement !== blitz) blitz.value = einst.kontrolle.blitz;
    leerlauf.checked = einst.kontrolle.leerlauf;
  }
}

// Session 18: mehrere Speicher-Ereignisse beim Import starten mehrere Ladungen; nur die juengste gilt. Sonst setzte eine aeltere, spaeter
// fertige Ladung kurz den Stand ohne Pack, der Block verschwand und der Fokus (Frage "Show my ads?") fiel auf body.
// Wer ladeAlles abwartet, wartet bis zur juengsten Ladung: danach ist der Stand aktuell (fokussiereEinrichten verlaesst sich darauf).
let ladung = 0;
let juengste: Promise<void> = Promise.resolve();
async function ladeAlles(): Promise<void> {
  const p = ladeEinmal(++ladung);
  juengste = p;
  let warte = p;
  for (;;) {
    await warte;
    if (warte === juengste) return;
    warte = juengste;
  }
}
async function ladeEinmal(nr: number): Promise<void> {
  let neuErledigt: string | null = erledigtFuer;
  let neuWarnung = warnungBestaetigt;
  try {
    const a = await browser.storage.local.get([EINRICHTEN_SCHLUESSEL, QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL]);
    neuErledigt = typeof a[EINRICHTEN_SCHLUESSEL] === 'string' ? (a[EINRICHTEN_SCHLUESSEL] as string) : null;
    neuWarnung = a[QUIZ_WARNUNG_SCHLUESSEL] === true || a[WARNUNG_SPIRALE_SCHLUESSEL] === true;
  } catch {
    neuErledigt = null;
  }
  let neu: [PackKurz | null, Einstellungen] | null = null;
  try {
    neu = await Promise.all([ladePackKurz(), ladeEinstellungen()]);
  } catch {
    // der naechste Stand zeichnet
  }
  if (nr !== ladung) return;
  erledigtFuer = neuErledigt;
  warnungBestaetigt = neuWarnung;
  if (neu) [pack, einst] = neu;
  zeichne();
}

function schliesse(): void {
  if (!pack) return;
  const id = pack.id;
  void browser.storage.local.set({ [EINRICHTEN_SCHLUESSEL]: id }).then(
    () => {
      erledigtFuer = id;
      zeichne();
      // Der geklickte Knopf verschwindet: Fokus auf die Frage, falls sie noch offen ist, sonst auf die Karte.
      const ziel = werbungFrageOffen() ? document.getElementById('werbung-frage-titel') : document.getElementById('stand-titel');
      if (ziel) ziel.focus();
    },
    () => zeigeSpeicherFehler(),
  );
}

// Nach dem Import: Fokus zur Werbe-Frage, wenn sie offen ist, sonst zum Block, sonst false (dann bleibt der Fokus beim Erfolgssatz).
export async function fokussiereEinrichten(): Promise<boolean> {
  await ladeAlles();
  await frischeWerbungFrageAuf();
  zeichne();
  const ziel = werbungFrageOffen()
    ? document.getElementById('werbung-frage-titel')
    : !rest.hidden
      ? titel
      : null;
  if (!ziel) return false;
  ziel.focus();
  return true;
}

export function baueEinrichten(): HTMLElement {
  wurzel = document.createElement('div');
  wurzel.id = 'einrichten';
  wurzel.className = 'einrichten';
  wurzel.hidden = true;

  const frage = baueWerbungFrage(
    () => {
      // Antwort gegeben: Fokus auf den Block darunter, sonst auf die Karte.
      (!rest.hidden ? titel : document.getElementById('stand-titel'))?.focus();
    },
    () => zeichne(),
  );

  titel = document.createElement('h3');
  titel.id = 'einrichten-titel';
  titel.tabIndex = -1;
  titel.textContent = TEXT_EINRICHTEN_TITEL;

  rest = document.createElement('div');
  rest.id = 'einrichten-rest';
  const text = document.createElement('p');
  text.id = 'einrichten-text';
  text.className = 'hinweis';
  text.textContent = TEXT_EINRICHTEN_TEXT;

  const e1 = schalter('einrichten-erw-an', 'Adult-site mode', 'on the sites I know, I swap the thumbnails for mine');
  erwZeile = e1.zeile;
  erwAn = e1.feld;
  erwAn.addEventListener('change', () => {
    const wert = erwAn.checked;
    void speichere((alt) => ({ erwachsen: { ...alt.erwachsen, an: wert } }), (e) => { einst = e; zeichne(); });
  });

  stufeZeile = document.createElement('div');
  stufeZeile.id = 'einrichten-stufe-zeile';
  const stufeTitel = document.createElement('h4');
  stufeTitel.id = 'einrichten-stufe-titel';
  stufeTitel.textContent = 'How hot do I get?';
  const wahl = document.createElement('div');
  wahl.className = 'wahl stufen';
  wahl.setAttribute('role', 'radiogroup');
  wahl.setAttribute('aria-labelledby', 'einrichten-stufe-titel');
  const stufen: [StufeWahl, string, string][] = [
    ['tease', 'Tease', 'I only hint.'],
    ['hot', 'Hot', 'I show more.'],
    ['explicit', 'Explicit', 'Nothing held back.'],
  ];
  stufeKnoepfe = [];
  for (const [wert, name, klein] of stufen) {
    const lab = document.createElement('label');
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'einrichten-stufe';
    r.value = wert;
    const sp = document.createElement('span');
    const s = document.createElement('strong');
    s.textContent = name;
    const k = document.createElement('small');
    k.textContent = klein;
    sp.append(s, k);
    lab.append(r, sp);
    wahl.append(lab);
    stufeKnoepfe.push(r);
    r.addEventListener('change', () => {
      if (!r.checked || !(STUFEN_WAHL as readonly string[]).includes(wert)) return;
      void speichere((alt) => ({ erwachsen: { ...alt.erwachsen, stufe: wert } }), (e) => { einst = e; zeichne(); });
    });
  }
  stufeZeile.append(stufeTitel, wahl);

  warnung = document.createElement('div');
  warnung.id = 'einrichten-warnung';
  warnung.className = 'warnblock';
  warnung.hidden = true;
  const warnText = document.createElement('p');
  warnText.id = 'einrichten-warnung-text';
  warnText.textContent = TEXT_EINRICHTEN_WARNUNG;
  const warnOk = document.createElement('button');
  warnOk.id = 'einrichten-warnung-ok';
  warnOk.type = 'button';
  warnOk.className = 'klein';
  warnOk.textContent = TEXT_EINRICHTEN_WARNUNG_OK;
  warnung.append(warnText, warnOk);
  warnOk.addEventListener('click', () => {
    void browser.storage.local.set({ [WARNUNG_SPIRALE_SCHLUESSEL]: true }).then(
      () => {
        warnungBestaetigt = true;
        zeichne();
        (blitzZeile.hidden ? leerlauf : blitz).focus();
      },
      () => zeigeSpeicherFehler(),
    );
  });

  blitzZeile = document.createElement('div');
  blitzZeile.className = 'regel';
  const blitzLabel = document.createElement('label');
  blitzLabel.htmlFor = 'einrichten-blitz';
  blitzLabel.textContent = 'Flash words';
  blitz = document.createElement('select');
  blitz.id = 'einrichten-blitz';
  const namen: Record<string, string> = { aus: 'Off', selten: 'Now and then', oft: 'Often' };
  for (const w of BLITZ_HAEUFIGKEITEN) {
    const o = document.createElement('option');
    o.value = w;
    o.textContent = namen[w] ?? w;
    blitz.append(o);
  }
  blitzZeile.append(blitzLabel, blitz);
  blitz.addEventListener('change', () => {
    const wert = blitz.value as BlitzHaeufigkeit;
    if (!(BLITZ_HAEUFIGKEITEN as readonly string[]).includes(wert)) return;
    void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, blitz: wert } }), (e) => { einst = e; zeichne(); });
  });

  const e2 = schalter('einrichten-leerlauf', 'Idle spiral', 'Sit still too long and my spiral comes. Any move or key ends it.');
  leerlaufZeile = e2.zeile;
  leerlauf = e2.feld;
  leerlauf.addEventListener('change', () => {
    const wert = leerlauf.checked;
    void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, leerlauf: wert } }), (e) => { einst = e; zeichne(); });
  });

  const knoepfe = document.createElement('div');
  knoepfe.className = 'knoepfe';
  const fertig = document.createElement('button');
  fertig.id = 'einrichten-fertig';
  fertig.type = 'button';
  fertig.className = 'klein';
  fertig.textContent = TEXT_EINRICHTEN_FERTIG;
  const spaeter = document.createElement('button');
  spaeter.id = 'einrichten-spaeter';
  spaeter.type = 'button';
  spaeter.className = 'klein ruhig';
  spaeter.textContent = TEXT_EINRICHTEN_SPAETER;
  spaeter.setAttribute('aria-describedby', 'einrichten-spaeter-hinweis');
  const spaeterHinweis = document.createElement('p');
  spaeterHinweis.id = 'einrichten-spaeter-hinweis';
  spaeterHinweis.className = 'hinweis';
  spaeterHinweis.textContent = TEXT_EINRICHTEN_SPAETER_HINWEIS;
  knoepfe.append(fertig, spaeter);
  fertig.addEventListener('click', schliesse);
  spaeter.addEventListener('click', schliesse);

  rest.append(text, erwZeile, stufeZeile, warnung, blitzZeile, leerlaufZeile, knoepfe, spaeterHinweis);
  wurzel.append(titel, frage, rest);

  const abmelden = beiEinstellungsAenderung((e) => {
    einst = e;
    zeichne();
  });
  const horcher = (aenderungen: Record<string, unknown>, bereich: string): void => {
    if (bereich !== 'local') return;
    if (PACK_SPEICHER_SCHLUESSEL in aenderungen || EINRICHTEN_SCHLUESSEL in aenderungen || QUIZ_WARNUNG_SCHLUESSEL in aenderungen || WARNUNG_SPIRALE_SCHLUESSEL in aenderungen) void ladeAlles();
  };
  browser.storage.onChanged.addListener(horcher);
  window.addEventListener('pagehide', () => {
    abmelden();
    browser.storage.onChanged.removeListener(horcher);
  }, { once: true });
  void ladeAlles();
  return wurzel;
}
