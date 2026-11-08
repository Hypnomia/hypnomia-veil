// Menue am Etikett von Mias Werbung (Session 17, UX-Pruefung Phase 9 Fund 13, Vorbild Grammarly: Ausschalten direkt am Element). Das
// Etikett ("Mia’s ad") ist ein Knopf; ein Klick oeffnet ein kleines Menue in derselben geschlossenen Shadow Root wie die Werbung:
// "Hide my ads on this site", "Turn my ads off", "Pause Mia". Auf Flaechen unter 80 px Hoehe gibt es nur "Turn my ads off".
// Escape schliesst und gibt den Fokus zurueck an das Etikett. Klicks und Tasten auf Mias Flaeche erreichen die Seite nie (Schutz in
// werbung.ts), darum haengen hier keine Horcher an den Knoepfen: werbung.ts reicht die echten Ereignisse an `beiEreignis` weiter, das
// den Knopf per Lage (Maus, Finger) oder Fokus (Tastatur) bestimmt. Texte nur per textContent.
import { aendereEinstellungen } from '../einstellungen';
import type { NachrichtHintergrundPause } from '../nachrichten';
import { meldeLokalePause } from '../pause-lokal';
import { TESTHAKEN } from '../schleier/konstanten';

export const ETIKETT_TEXTE = {
  verbergen: 'Hide my ads on this site',
  ausschalten: 'Turn my ads off',
  pause: 'Pause Mia',
  menue: 'About this ad',
} as const;

// Unter dieser Hoehe der Werbeflaeche (px) gibt es nur "Turn my ads off".
export const KLEIN_UNTER_PX = 80;

export type EtikettAktion = 'verbergen' | 'ausschalten' | 'pause';

export const ETIKETT_CSS = `
button.k{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;min-height:24px;min-width:24px;margin:0;border:0;text-align:left}
button.k:hover{text-decoration:underline;cursor:pointer}
button.k:focus-visible{outline:2px solid var(--v-lav-500,#8f6be8);outline-offset:-2px}
.m{position:fixed;left:0;top:0;z-index:3;display:none;flex-direction:column;gap:2px;min-width:200px;max-width:min(280px,calc(100vw - 16px));box-sizing:border-box;padding:6px;margin:0;
  background:var(--v-glas-stark,#fff);color:var(--v-text,#2b1630);border:1px solid var(--v-glas-kante,#ffd3e6);border-radius:14px;box-shadow:var(--v-schatten,0 10px 30px rgba(43,22,48,.25));
  font:700 14px/1.3 var(--v-schrift-text,system-ui,sans-serif);pointer-events:auto;cursor:default}
.m.offen{display:flex}
.m [hidden]{display:none!important}
.m button{display:block;width:100%;min-height:36px;margin:0;padding:6px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:normal;overflow-wrap:anywhere}
.m button:hover,.m button:focus-visible{background:var(--v-rosa-50,#fff0f8)}
.m button:focus-visible{outline:2px solid var(--v-lav-500,#8f6be8);outline-offset:-2px}
@media (pointer:coarse){.m button{min-height:44px}}
`;

export interface EtikettMenueOptionen {
  wurzel: ShadowRoot;
  // Host-Muster dieser Seite fuer `werbungAus` (ohne fuehrendes "www."), null wenn die Seite kein gueltiges Muster hergibt.
  muster(): string | null;
  // Wie `muster`, aber genau: im Rahmen erst die Adresse des Tabs erfragen. Fehlt es, gilt `muster`.
  musterGenau?(): Promise<string | null>;
  // Nach einer Aktion (fuer Testspur und Aufraeumen).
  beiAenderung(): void;
}

export class EtikettMenue {
  private readonly menue: HTMLDivElement;
  private readonly punkte = new Map<EtikettAktion, HTMLButtonElement>();
  private besitzer: HTMLButtonElement | null = null;
  private besitzerNr = -1;

  constructor(private readonly opt: EtikettMenueOptionen) {
    const m = document.createElement('div');
    m.className = 'm';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', ETIKETT_TEXTE.menue);
    for (const [aktion, text] of [
      ['verbergen', ETIKETT_TEXTE.verbergen],
      ['ausschalten', ETIKETT_TEXTE.ausschalten],
      ['pause', ETIKETT_TEXTE.pause],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.aktion = aktion;
      b.textContent = text;
      m.append(b);
      this.punkte.set(aktion, b);
    }
    this.menue = m;
    // Nur Testbau: die Testspur zeigt, wo der Fokus in der geschlossenen Wurzel liegt (von aussen ist nur der Host fokussiert). Den Eintritt
    // schreibt schon der Schutz in werbung.ts (focusin zaehlt dort zu den Tasten und erreicht die Wurzel nie); hier fehlt nur das Verlassen.
    if (TESTHAKEN) opt.wurzel.addEventListener('focusout', () => setTimeout(() => opt.beiAenderung(), 0));
  }

  // Der Knopf fuer das Etikett einer Flaeche. Text bleibt der Satz der Flaeche.
  baueKnopf(): HTMLButtonElement {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'k';
    k.setAttribute('aria-haspopup', 'menu');
    k.setAttribute('aria-expanded', 'false');
    return k;
  }

  offen(): boolean {
    return this.menue.classList.contains('offen');
  }

  gehoertZu(nr: number): boolean {
    return this.offen() && this.besitzerNr === nr;
  }

  private istKnopf(el: Element | null): el is HTMLButtonElement {
    return !!el && el instanceof HTMLButtonElement && el.classList.contains('k');
  }

  private sichtbarePunkte(): HTMLButtonElement[] {
    return [...this.punkte.values()].filter((b) => !b.hidden);
  }

  // `knopf` ist das Etikett, `hoehe` die Hoehe der Werbeflaeche in px, `nr` ihre Nummer.
  oeffne(knopf: HTMLButtonElement, hoehe: number, nr: number, mitFokus = true): void {
    if (this.besitzer && this.besitzer !== knopf) this.besitzer.setAttribute('aria-expanded', 'false');
    const klein = hoehe < KLEIN_UNTER_PX;
    this.punkte.get('verbergen')!.hidden = klein || !this.opt.muster();
    this.punkte.get('ausschalten')!.hidden = false;
    this.punkte.get('pause')!.hidden = klein;
    // Ans Ende der Wurzel: zuoberst ueber allen Flaechen von Mia.
    this.opt.wurzel.append(this.menue);
    this.menue.classList.add('offen');
    this.besitzer = knopf;
    this.besitzerNr = nr;
    knopf.setAttribute('aria-expanded', 'true');
    this.lege(knopf);
    if (mitFokus) this.sichtbarePunkte()[0]?.focus({ preventScroll: true });
    this.opt.beiAenderung();
  }

  private lege(knopf: HTMLElement): void {
    const vb = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const k = knopf.getBoundingClientRect();
    const s = this.menue.style;
    s.left = '0px';
    s.top = '0px';
    const w = this.menue.offsetWidth;
    const h = this.menue.offsetHeight;
    let l = k.right - w;
    l = Math.max(8, Math.min(l, vb - w - 8));
    let t = k.bottom + 4;
    if (t + h > vh - 8) t = Math.max(8, k.top - h - 4);
    s.left = `${Math.round(l)}px`;
    s.top = `${Math.round(t)}px`;
  }

  schliesse(fokusZurueck = false): void {
    if (!this.offen()) return;
    this.menue.classList.remove('offen');
    this.menue.remove();
    const b = this.besitzer;
    this.besitzer = null;
    this.besitzerNr = -1;
    if (b) {
      b.setAttribute('aria-expanded', 'false');
      if (fokusZurueck) {
        try {
          b.focus({ preventScroll: true });
        } catch {
          // Knopf schon weg
        }
      }
    }
    this.opt.beiAenderung();
  }

  // Abbild fuer die Testspur.
  abbild(): {
    offen: boolean;
    nr: number;
    punkte: Array<{ aktion: string; text: string; x: number; y: number; w: number; h: number }>;
    fokus: { art: 'etikett' | 'punkt' | 'anderes'; aktion: string; x: number; y: number; w: number; h: number } | null;
  } {
    // Fokus in der Wurzel: Etikett, Menuepunkt (mit Aktion) oder etwas anderes (Mias Link), jeweils mit Rechteck.
    const a = this.opt.wurzel.activeElement;
    let fokus: ReturnType<EtikettMenue['abbild']>['fokus'] = null;
    if (a instanceof HTMLElement) {
      const r = a.getBoundingClientRect();
      const art = this.istKnopf(a) ? 'etikett' : a.closest('.m button') ? 'punkt' : 'anderes';
      fokus = { art, aktion: a.dataset.aktion ?? '', x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return {
      fokus,
      offen: this.offen(),
      nr: this.besitzerNr,
      punkte: this.offen()
        ? // Alle Punkte mit ihrem echten Rechteck (ein verborgener Punkt hat 0 x 0): so sieht der Test, was wirklich zu sehen ist.
          [...this.punkte.values()].map((b) => {
            const r = b.getBoundingClientRect();
            return { aktion: b.dataset.aktion ?? '', text: b.textContent ?? '', x: r.left, y: r.top, w: r.width, h: r.height };
          })
        : [],
    };
  }

  // Aktion ausfuehren (Klick auf einen Menuepunkt).
  private async fuehreAus(aktion: EtikettAktion): Promise<void> {
    this.schliesse(false);
    try {
      if (aktion === 'pause') {
        // Wie im Riegel: zuerst lokal und sofort (alles frei), dann festhalten.
        meldeLokalePause();
        const n: NachrichtHintergrundPause = { ziel: 'hintergrund', typ: 'pause', an: true };
        void Promise.resolve(browser.runtime.sendMessage(n)).catch(() => undefined);
      } else if (aktion === 'ausschalten') {
        await aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, werbung: false, werbungGefragt: true } }));
      } else {
        const muster = this.opt.musterGenau ? await this.opt.musterGenau() : this.opt.muster();
        if (muster) await aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, werbungAus: [...new Set([...alt.kontrolle.werbungAus, muster])] } }));
      }
    } catch {
      // Kontext weg oder Speicher nicht erreichbar: das Menue ist zu, mehr geschieht nicht
    }
  }

  // Wertet ein echtes Ereignis aus, das auf Mias Host zielt (Aufruf aus dem Schutz in werbung.ts). Gibt zurueck, ob es das Etikett oder das
  // Menue betraf (dann bleibt die Standardaktion; das Ereignis erreicht die Seite ohnehin nie). `hoeheVon` liefert die Hoehe der Flaeche
  // zu einem Etikett, `nrVon` ihre Nummer.
  beiEreignis(ev: Event, hoeheVon: (k: HTMLButtonElement) => number, nrVon: (k: HTMLButtonElement) => number): boolean {
    if (!ev.isTrusted) return false;
    const typ = ev.type;
    const maus = ev as MouseEvent;
    const mitLage = typ === 'pointerdown' || typ === 'mousedown' || typ === 'click';
    let ziel: Element | null = null;
    try {
      if (mitLage) {
        // Ein Klick per Tastatur (Enter, Leertaste) hat keine Lage: dann zaehlt der Fokus.
        const ohneLage = typ === 'click' && maus.detail === 0 && maus.clientX === 0 && maus.clientY === 0;
        ziel = ohneLage ? this.opt.wurzel.activeElement : this.opt.wurzel.elementFromPoint(maus.clientX, maus.clientY);
      } else if (typ === 'keydown') {
        ziel = this.opt.wurzel.activeElement;
      }
    } catch {
      ziel = null;
    }
    const knopf = ziel && this.istKnopf(ziel) ? ziel : (ziel?.closest?.('button.k') as HTMLButtonElement | null) ?? null;
    const punkt = ziel?.closest?.('.m button') as HTMLButtonElement | null;
    if (typ === 'pointerdown' || typ === 'mousedown') {
      if (!knopf && !punkt && this.offen()) this.schliesse(false);
      return !!(knopf || punkt);
    }
    if (typ === 'click') {
      if (punkt) {
        void this.fuehreAus((punkt.dataset.aktion ?? 'pause') as EtikettAktion);
        return true;
      }
      if (knopf) {
        const nr = nrVon(knopf);
        if (this.gehoertZu(nr)) this.schliesse(false);
        else this.oeffne(knopf, hoeheVon(knopf), nr, true);
        return true;
      }
      if (this.offen()) this.schliesse(false);
      return false;
    }
    if (typ === 'keydown') {
      const t = ev as KeyboardEvent;
      if (!this.offen()) return !!knopf;
      if (t.key === 'Escape') {
        this.schliesse(true);
        return true;
      }
      const liste = this.sichtbarePunkte();
      const nun = punkt ? liste.indexOf(punkt) : -1;
      if (t.key === 'ArrowDown' || t.key === 'ArrowUp' || t.key === 'Home' || t.key === 'End') {
        if (liste.length > 0) {
          let neu = nun;
          if (t.key === 'ArrowDown') neu = (nun + 1) % liste.length;
          else if (t.key === 'ArrowUp') neu = (nun - 1 + liste.length) % liste.length;
          else neu = t.key === 'Home' ? 0 : liste.length - 1;
          liste[neu]!.focus({ preventScroll: true });
        }
        if (t.cancelable) t.preventDefault();
        return true;
      }
      if (t.key === 'Tab') {
        // Pruefer N2 Fund 6: der Fokus geht zuerst zurueck aufs Etikett, die Standardaktion von Tab wandert dann von dort weiter (sonst
        // begann sie am Anfang der Seite, weil der fokussierte Punkt mit dem Menue verschwindet).
        this.schliesse(true);
        return true;
      }
      return !!(punkt || knopf);
    }
    return false;
  }
}
