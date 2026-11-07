// Ansicht der Leerlauf-Spirale (Auftrag L): ein Host mit geschlossener Shadow Root ueber der ganzen Seite, in der obersten Ebene per Popover
// (die Seite kann ihn nicht ueberdecken). Zwei Gestalten: die Spirale (Leinwand mit Mias Satz) und die ruhige Warnkarte ohne Bewegung.
// Texte nur ueber textContent. Klicks und Tasten auf der eigenen Oberflaeche erreichen die Seite nicht (Host-Hoerer, Tasten ueber den
// Tastenschutz in src/riegel/tastatur.ts).
import type { Drehung } from './logik';
import { SpiralenZeichner, type Bildstand } from './zeichne';
import { HOST_MARKE } from './testspur';
import { SEITEN_TOKENS } from '../oberflaeche/design/tokens';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';

export const WARN_TEXT = 'Before my spiral and flash words: not for you if you have photosensitive epilepsy or are prone to seizures.';
export const WARN_OK = 'I understand';
export const WARN_NEIN = 'No spiral for me';

const CSS = `
:host { all: initial; }
${SEITEN_TOKENS}
* { box-sizing: border-box; }
.huelle { position: fixed; inset: 0; background: #2b0f33; opacity: 0; overflow: hidden; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.satz { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: min(80vw, 560px); margin: 0; padding: 14px 22px;
  text-align: center; color: #fff0f8; background: rgba(43, 15, 51, 0.72); border: 1px solid rgba(255, 179, 211, 0.7); border-radius: 26px;
  font: 800 clamp(18px, 3vw, 28px)/1.3 var(--v-schrift-display); outline: none; box-shadow: 0 0 0 4px rgba(226, 85, 154, 0.18); }
.fang { position: fixed; inset: 0; background: transparent; display: flex; align-items: center; justify-content: center; padding: 16px; }
.karte { width: 100%; max-width: 440px; padding: 20px 22px; background: rgba(255, 255, 255, 0.9); color: var(--v-text);
  border: 1px solid var(--v-glas-kante); border-radius: var(--v-r-l); box-shadow: 0 0 0 1px rgba(255, 179, 211, 0.4), var(--v-schatten); outline: none;
  font: 400 16px/1.5 var(--v-schrift-text); }
.marke { display: flex; align-items: center; gap: 8px; font: 800 13px/1.2 var(--v-schrift-display); letter-spacing: 0.14em; color: var(--v-rosa-800); margin: 0 0 10px; }
.text { margin: 0 0 14px; }
.knoepfe { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: 800 15px/1 var(--v-schrift-text); color: var(--v-rosa-800); background: var(--v-weiss); border: 1px solid var(--v-rosa-200);
  border-radius: var(--v-r-voll); padding: 0 20px; min-height: 48px; cursor: pointer; box-shadow: var(--v-schatten-klein); }
button:hover { background: var(--v-rosa-50); }
button:focus-visible { outline: 3px solid var(--v-lav-500); outline-offset: 2px; }
/* UX-Pruefung 8b Nr. 2: bei der Anfallswarnung stehen Zustimmen und Ablehnen gleich stark nebeneinander. */
.knoepfe button { flex: 1 1 140px; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
};


export class LeerlaufAnsicht {
  readonly host: HTMLDivElement;
  private readonly wurzel: ShadowRoot;
  private huelle: HTMLDivElement | null = null;
  private zeichner: SpiralenZeichner | null = null;
  private fokusZiel: HTMLElement | null = null;
  private vorherFokus: Element | null = null;
  satz = '';
  knoepfe: { ja: HTMLButtonElement; nein: HTMLButtonElement } | null = null;
  private karte: HTMLDivElement | null = null;

  constructor() {
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    if (HOST_MARKE) host.setAttribute(HOST_MARKE, '');
    this.wurzel = host.attachShadow({ mode: 'closed' });
    void ladeSeitenSchriften();
    const stil = el('style');
    stil.textContent = CSS;
    this.wurzel.append(stil);
    this.host = host;
    this.legeLage();
  }

  // Inline und wichtig: schlaegt Seitenregeln auf Popover, div und *.
  private legeLage(): void {
    const s = this.host.style;
    const setze = (k: string, v: string) => s.setProperty(k, v, 'important');
    setze('all', 'initial');
    setze('position', 'fixed');
    setze('inset', '0');
    setze('width', '100vw');
    setze('height', '100vh');
    setze('max-width', 'none');
    setze('max-height', 'none');
    setze('margin', '0');
    setze('padding', '0');
    setze('border', '0');
    setze('overflow', 'hidden');
    setze('display', 'block');
    setze('visibility', 'visible');
    setze('opacity', '1');
    setze('pointer-events', 'auto');
    setze('zoom', '1');
    setze('background', 'transparent');
    setze('z-index', '2147483647');
  }

  private haengeEin(): void {
    this.vorherFokus = document.activeElement;
    const wurzel = document.documentElement;
    if (!this.host.isConnected) wurzel.append(this.host);
    try {
      if (typeof this.host.showPopover === 'function' && !this.host.matches(':popover-open')) this.host.showPopover();
    } catch {
      // ohne Popover bleibt die feste Lage mit hohem z-index
    }
    try {
      this.fokusZiel?.focus({ preventScroll: true });
    } catch {
      // egal
    }
  }

  // Die Spirale mit Mias Satz. Beginnt unsichtbar (Deckkraft 0) und blendet ueber den Zeichner ein.
  zeigeSpirale(satz: string, dreh: Drehung, beiBild: (s: Bildstand) => void): void {
    this.satz = satz;
    const huelle = el('div', 'huelle');
    const leinwand = el('canvas');
    leinwand.setAttribute('aria-hidden', 'true');
    const text = el('p', 'satz', satz);
    text.tabIndex = -1;
    this.fokusZiel = text;
    huelle.append(leinwand, text);
    this.wurzel.append(huelle);
    this.huelle = huelle;
    this.zeichner = new SpiralenZeichner(leinwand, dreh, (s) => {
      huelle.style.opacity = String(s.deckkraft);
      beiBild(s);
    });
    this.haengeEin();
    this.zeichner.starte();
  }

  get aufloesung(): { breite: number; hoehe: number } | null {
    return this.zeichner?.aufloesung ?? null;
  }

  stand(): Bildstand | null {
    return this.zeichner?.stand() ?? null;
  }

  // Die ruhige Warnkarte: keine Bewegung, durchsichtiger Fang ueber der Seite. Klicks und Tasten wertet spirale.ts aus (frueher Schutz-Horcher
  // am Fenster, siehe dort); hier gibt es nur die Lage-Abfrage (`trifft`) und die Fokus-Fuehrung.
  zeigeWarnung(): void {
    const fang = el('div', 'fang');
    const karte = el('div', 'karte');
    karte.tabIndex = -1;
    karte.setAttribute('role', 'dialog');
    karte.setAttribute('aria-label', 'Mia');
    const ja = el('button', 'ja', WARN_OK);
    ja.type = 'button';
    const nein = el('button', undefined, WARN_NEIN);
    nein.type = 'button';
    const reihe = el('div', 'knoepfe');
    reihe.append(ja, nein);
    karte.append(el('p', 'marke', 'HYPNOMIA VEIL'), el('p', 'text', WARN_TEXT), reihe);
    fang.append(karte);
    this.wurzel.append(fang);
    this.knoepfe = { ja, nein };
    this.karte = karte;
    this.fokusZiel = karte;
    this.haengeEin();
  }

  // Was liegt an dieser Stelle (Fensterkoordinaten)? Knopf, Karte oder daneben.
  trifft(x: number, y: number): 'ja' | 'nein' | 'karte' | 'daneben' {
    const innen = (e: Element | null | undefined): boolean => {
      if (!e) return false;
      const b = e.getBoundingClientRect();
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    };
    if (innen(this.knoepfe?.ja)) return 'ja';
    if (innen(this.knoepfe?.nein)) return 'nein';
    return innen(this.karte) ? 'karte' : 'daneben';
  }

  // Welcher Knopf hat den Fokus (fuer Enter und Leertaste)?
  aktiverKnopf(): 'ja' | 'nein' | null {
    const a = this.wurzel.activeElement;
    if (a && a === this.knoepfe?.ja) return 'ja';
    if (a && a === this.knoepfe?.nein) return 'nein';
    return null;
  }

  // Tab bleibt auf der Karte: Karte, Ja, Nein, Karte ...
  fokusWeiter(rueckwaerts: boolean): void {
    const reihe: HTMLElement[] = this.karte && this.knoepfe ? [this.karte, this.knoepfe.ja, this.knoepfe.nein] : [];
    if (reihe.length === 0) return;
    const jetzt = reihe.findIndex((e) => e === this.wurzel.activeElement);
    const neu = (jetzt + (rueckwaerts ? -1 : 1) + reihe.length) % reihe.length;
    try {
      reihe[neu]!.focus({ preventScroll: true });
    } catch {
      // egal
    }
  }

  rect(e: Element | null | undefined): { x: number; y: number; w: number; h: number } | null {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  }

  knopfRechtecke(): { ja: ReturnType<LeerlaufAnsicht['rect']>; nein: ReturnType<LeerlaufAnsicht['rect']> } | null {
    return this.knoepfe ? { ja: this.rect(this.knoepfe.ja), nein: this.rect(this.knoepfe.nein) } : null;
  }

  // Sofort weg (ein einziger Wechsel, kein Ausblenden). Fokus zurueck auf das, was ihn vorher hatte.
  entferne(): void {
    this.zeichner?.stoppe();
    this.zeichner = null;
    try {
      if (this.host.matches(':popover-open')) this.host.hidePopover();
    } catch {
      // egal
    }
    this.host.remove();
    const f = this.vorherFokus;
    this.vorherFokus = null;
    try {
      if (f instanceof HTMLElement && f.isConnected && f !== document.body) f.focus({ preventScroll: true });
    } catch {
      // egal
    }
  }
}
