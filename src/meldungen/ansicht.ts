// Ansicht einer Meldung (Auftrag M): ein Host am Ende von `html` (nie Kind von Seitenelementen) mit geschlossener Shadow Root, unten rechts,
// in der obersten Ebene per Popover (die Seite kann ihn nicht ueberdecken). Mini-Chibi links (nur wenn ein Bild da ist), Satz rechts, Knopf zum
// Schliessen. Texte nur per textContent. Die Meldung nimmt nie den Fokus (kein focus()-Aufruf, Popover ohne autofocus).
import { HOST_MARKE, ZEIT_MARKE } from './testspur';

export const SCHLIESSEN_LABEL = 'Close note';
const BREITE = 360;
const RAND = 16;
const EINBLEND_MS = 250;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.karte { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; background: linear-gradient(160deg, #ffe3f1 0%, #efe6ff 100%);
  color: #3b2a4a; border: 2px solid #ffb3d6; border-radius: 16px; box-shadow: 0 6px 20px rgba(120, 70, 140, 0.35); opacity: 0;
  font: 15px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.karte.sanft { transition: opacity ${EINBLEND_MS}ms ease-out; }
.chibi { flex: none; width: 56px; height: 56px; object-fit: contain; display: block; }
.chibi[hidden] { display: none; }
.satz { flex: 1 1 auto; margin: 0; min-width: 0; overflow-wrap: anywhere; }
button { flex: none; align-self: flex-start; font: inherit; line-height: 1; color: #3b2a4a; background: #fff; border: 2px solid #d9a6ff; border-radius: 10px;
  width: 32px; height: 32px; padding: 0; cursor: pointer; }
button:hover { background: #fdf2ff; }
button:focus-visible { outline: 3px solid #7a4cff; outline-offset: 2px; }
`;

export class MeldungAnsicht {
  readonly host: HTMLDivElement;
  private readonly wurzel: ShadowRoot;
  readonly karte: HTMLDivElement;
  private readonly bild: HTMLImageElement;
  private readonly schliessen: HTMLButtonElement;
  satz = '';

  constructor(satz: string, anlass: string, ruhig: boolean) {
    this.satz = satz;
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    if (HOST_MARKE) host.setAttribute(HOST_MARKE, anlass);
    if (ZEIT_MARKE) host.setAttribute(ZEIT_MARKE, String(Date.now()));
    this.wurzel = host.attachShadow({ mode: 'closed' });
    const stil = document.createElement('style');
    stil.textContent = CSS;
    const karte = document.createElement('div');
    karte.className = ruhig ? 'karte' : 'karte sanft';
    karte.setAttribute('role', 'status');
    const bild = document.createElement('img');
    bild.className = 'chibi';
    bild.alt = '';
    bild.hidden = true;
    const text = document.createElement('p');
    text.className = 'satz';
    text.textContent = satz;
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.tabIndex = -1; // nimmt nie den Fokus (geschlossen wird per Klick)
    knopf.setAttribute('aria-label', SCHLIESSEN_LABEL);
    knopf.textContent = '×';
    karte.append(bild, text, knopf);
    this.wurzel.append(stil, karte);
    this.host = host;
    this.karte = karte;
    this.bild = bild;
    this.schliessen = knopf;
    this.legeLage();
  }

  // Inline und wichtig: schlaegt Seitenregeln auf Popover, div und *. Lage aus Fenster-Koordinaten (fixed, rechts unten).
  private legeLage(): void {
    const s = this.host.style;
    const setze = (k: string, v: string) => s.setProperty(k, v, 'important');
    setze('all', 'initial');
    setze('position', 'fixed');
    setze('right', `${RAND}px`);
    setze('bottom', `${RAND}px`);
    setze('left', 'auto');
    setze('top', 'auto');
    setze('width', `min(${BREITE}px, calc(100vw - ${2 * RAND}px))`);
    setze('height', 'auto');
    setze('max-width', `${BREITE}px`);
    setze('margin', '0');
    setze('padding', '0');
    setze('border', '0');
    setze('overflow', 'visible');
    setze('display', 'block');
    setze('visibility', 'visible');
    setze('opacity', '1');
    setze('pointer-events', 'auto');
    setze('zoom', '1');
    setze('background', 'transparent');
    setze('z-index', '2147483647');
  }

  // Am Ende von `html` einhaengen, in die oberste Ebene heben und ruhig einblenden (nur Deckkraft).
  zeige(ruhig: boolean): void {
    const wurzel = document.documentElement;
    if (!this.host.isConnected) wurzel.append(this.host);
    try {
      if (typeof this.host.showPopover === 'function' && !this.host.matches(':popover-open')) this.host.showPopover();
    } catch {
      // ohne Popover bleibt die feste Lage mit hohem z-index
    }
    if (!ruhig) void this.karte.offsetWidth; // Ausgangszustand (Deckkraft 0) festhalten, damit der Uebergang laeuft
    this.karte.style.opacity = '1';
  }

  setzeBild(url: string): void {
    this.bild.src = url;
    this.bild.hidden = false;
  }

  get hatBild(): boolean {
    return !this.bild.hidden;
  }

  // Liegt der Punkt (Fensterkoordinaten) auf dem Schliessen-Knopf?
  trifftSchliessen(x: number, y: number): boolean {
    const b = this.schliessen.getBoundingClientRect();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  }

  // Zeiger auf der Karte (Verlaengerung der Sichtzeit).
  beiZeiger(ein: () => void, aus: () => void): void {
    this.karte.addEventListener('pointerenter', ein);
    this.karte.addEventListener('pointerleave', aus);
  }

  zeigerDrauf(): boolean {
    try {
      return this.karte.matches(':hover');
    } catch {
      return false;
    }
  }

  rect(e: Element = this.host): { x: number; y: number; w: number; h: number } {
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  }

  schliessenRect(): { x: number; y: number; w: number; h: number } {
    return this.rect(this.schliessen);
  }

  deckkraft(): number {
    return Number(getComputedStyle(this.karte).opacity);
  }

  entferne(): void {
    try {
      if (this.host.matches(':popover-open')) this.host.hidePopover();
    } catch {
      // egal
    }
    this.host.remove();
  }
}
