// Kleines Etikett auf einem Video, das ganz verdeckt bleibt, obwohl "Only the naughty bits" gewaehlt ist (Bauplan Video-Zonen, Rueckfall).
// Es sagt, warum: Mia kann in dieses Video nicht hineinsehen (fremde Quelle, geschuetzte Wiedergabe) oder es ist zu knifflig fuer die Zonen-Leinwand.
// Aufbau wie das Etikett des Standbilds (src/player/standbild.ts): `pointer-events: none`, geschlossene Wurzel, Stile ueber CSSOM (eine strenge
// Seiten-CSP sperrt nur style-Attribute und -Elemente). Anders als dort steht der Host am Ende von html, nicht neben dem Video: das DOM der Seite
// (Kinder, Geschwister, :empty, :last-child) bleibt unberuehrt, wie bei Mias Meldungen und der Werbung. Die Lage folgt dem Video im Takt.

import { SEITEN_TEXT } from '../oberflaeche/design/familie';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';
import { spiralAuge } from '../oberflaeche/design/motive';
import { FARBEN, WERTE } from '../oberflaeche/design/werte';
import { eigeneWurzel } from './eigene';
import { istFestPositioniert, legeAufRechteck } from './lage';
import { TESTHAKEN } from './konstanten';
import { testhakenAktiv } from './status';
import type { EignungsGrund } from './video-zonen';

// Texte des Etiketts (Oberflaeche Englisch, Stimme von Mia; der Texter schaerft sie).
export const ETIKETT_UNLESBAR = 'I can’t see inside this one, so all of it stays hidden.';
export const ETIKETT_LANGSAM = 'Too slow to follow closely here. I’m covering the whole video.';
export const ETIKETT_KNIFFLIG = 'Too tricky to cover piece by piece, so all of it stays hidden.';

export function etikettTextFuer(grund: EignungsGrund): string | null {
  switch (grund) {
    case 'vorschau':
      return null; // Vorschauen und Anzeigen auf Erwachsenenseiten sind verdeckt, wie es dort immer war: kein Etikett
    case 'einstellung':
      return null; // "The whole video" gewaehlt: kein Etikett, so soll es sein
    case 'klein':
    case 'andere':
      return null; // kleine Videos (Werbeflaechen, Symbole) und das zweite Video im Dokument: ein Etikett waere nur Laerm
    case 'unlesbar':
    case 'drm':
      return ETIKETT_UNLESBAR;
    default:
      return ETIKETT_KNIFFLIG;
  }
}

const ATTR_ETIKETT = TESTHAKEN ? 'data-veil-video-etikett' : '';
const STIL =
  '.h{position:absolute;inset:0;container-type:size;pointer-events:none}' +
  `.e{position:absolute;left:8px;top:8px;display:flex;align-items:center;gap:6px;max-width:calc(100% - 16px);box-sizing:border-box;padding:4px 10px 4px 4px;border-radius:${WERTE['r-voll']};background:${WERTE['glas-kante']};color:${FARBEN['rosa-800']};font:800 12px/1.3 '${SEITEN_TEXT}',system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:${WERTE['schatten-klein']};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
  '.e svg{flex:none}@container (max-width:239px){.e{display:none}}';

interface Eintrag {
  host: HTMLElement;
  text: HTMLElement;
  beob: ResizeObserver | null;
  aktuell: string;
}

export class VideoEtikett {
  private readonly eintraege = new Map<HTMLVideoElement, Eintrag>();
  private takt: ReturnType<typeof setInterval> | null = null;
  private readonly testAn = TESTHAKEN && testhakenAktiv();

  // Zeigt das Etikett mit diesem Text oder nimmt es weg (text null).
  setze(el: HTMLVideoElement, text: string | null): void {
    if (!text || !el.isConnected) return this.entferne(el);
    let e = this.eintraege.get(el);
    if (!e) {
      const neu = this.baue(el, text);
      if (!neu) return;
      e = neu;
      this.eintraege.set(el, e);
    }
    if (e.aktuell !== text) {
      e.aktuell = text;
      e.text.textContent = text;
    }
    if (e.host.parentNode !== document.documentElement) document.documentElement.append(e.host);
    this.lege(el, e);
    if (this.testAn && ATTR_ETIKETT) el.setAttribute(ATTR_ETIKETT, text);
    this.pflegeTakt();
  }

  entferne(el: HTMLVideoElement): void {
    const e = this.eintraege.get(el);
    if (!e) return;
    this.eintraege.delete(el);
    try {
      e.beob?.disconnect();
    } catch {
      // egal
    }
    e.host.remove();
    if (ATTR_ETIKETT) el.removeAttribute(ATTR_ETIKETT);
    this.pflegeTakt();
  }

  alleWeg(): void {
    for (const el of [...this.eintraege.keys()]) this.entferne(el);
  }

  hat(el: HTMLVideoElement): boolean {
    return this.eintraege.has(el);
  }

  private baue(el: HTMLVideoElement, text: string): Eintrag | null {
    const host = document.createElement('div');
    const s = host.style;
    for (const [n, w] of [
      ['all', 'initial'],
      ['position', 'absolute'],
      ['display', 'block'],
      ['margin', '0'],
      ['padding', '0'],
      ['border', '0'],
      ['overflow', 'hidden'],
      ['pointer-events', 'none'],
      ['visibility', 'visible'],
      ['opacity', '1'],
      ['box-sizing', 'border-box'],
      ['left', '0'],
      ['top', '0'],
      ['z-index', '2147483000'],
    ] as const) s.setProperty(n, w, 'important');
    const wurzel = eigeneWurzel(host);
    try {
      const blatt = new CSSStyleSheet();
      blatt.replaceSync(STIL);
      wurzel.adoptedStyleSheets = [blatt];
    } catch {
      const stil = document.createElement('style');
      stil.textContent = STIL;
      wurzel.append(stil);
    }
    const huelle = document.createElement('div');
    huelle.className = 'h';
    const etikett = document.createElement('div');
    etikett.className = 'e';
    const t = document.createElement('span');
    t.textContent = text;
    etikett.append(spiralAuge(20), t);
    huelle.append(etikett);
    wurzel.append(huelle);
    void ladeSeitenSchriften();
    document.documentElement.append(host);
    const e: Eintrag = { host, text: t, beob: null, aktuell: text };
    try {
      e.beob = new ResizeObserver(() => this.lege(el, e));
      e.beob.observe(el);
    } catch {
      e.beob = null;
    }
    return e;
  }

  private lege(el: HTMLVideoElement, e: Eintrag): void {
    if (!el.isConnected) return;
    const t = el.getBoundingClientRect();
    if (!(t.width > 0 && t.height > 0)) return;
    legeAufRechteck(e.host, t, istFestPositioniert(el));
  }

  private pflegeTakt(): void {
    if (this.eintraege.size && !this.takt) {
      this.takt = setInterval(() => {
        if (document.hidden) return;
        for (const [el, e] of this.eintraege) {
          if (!el.isConnected) {
            this.entferne(el);
            continue;
          }
          this.lege(el, e);
        }
      }, 400);
    } else if (!this.eintraege.size && this.takt) {
      clearInterval(this.takt);
      this.takt = null;
    }
  }
}
