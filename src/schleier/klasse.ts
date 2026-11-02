// Hintergrundbilder, die ein Stylesheet per Klasse setzt (nicht per Inline-Style): nach dem load-Ereignis einmal alle Elemente
// ansehen, danach nachtraeglich Hinzugefuegtes und Klassenwechsel. Diese Elemente werden nicht vorab versteckt (Entscheidung: einfache Behandlung).

import { zerlegeEbenen, urlAusEbene } from './pruefung';

const UEBERSPRINGEN = new Set(['img', 'video', 'canvas', 'script', 'style', 'link', 'meta', 'head', 'title', 'br', 'source', 'track', 'wbr', 'html']);
const SCHEIBE_MS = 6;
const MAX_JE_KNOTEN = 400;

// Liefert die erste fremde url()-Ebene eines berechneten background-image (kein data:, kein Verlauf), sonst null.
export function hatKlassenHintergrund(el: Element): boolean {
  let wert = '';
  try {
    wert = getComputedStyle(el).backgroundImage;
  } catch {
    return false;
  }
  if (!wert || wert === 'none' || !wert.includes('url(')) return false;
  for (const ebene of zerlegeEbenen(wert)) {
    const url = urlAusEbene(ebene);
    if (url && /^(https?|blob):/i.test(url)) return true;
  }
  return false;
}

export class KlassenSucher {
  private warteschlange: Element[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aktiv = true;

  constructor(
    // Wird fuer jedes Element mit Klassen-Hintergrund gerufen.
    private readonly gefunden: (el: Element) => void,
    // Elemente, die schon als Inline-Hintergrund verfolgt werden, ueberspringen.
    private readonly schonVerfolgt: (el: Element) => boolean,
  ) {}

  planeWurzel(wurzel: ParentNode): void {
    for (const el of wurzel.querySelectorAll('*')) this.einreihen(el);
    this.plane();
  }

  planeKnoten(knoten: Element): void {
    this.einreihen(knoten);
    let n = 0;
    for (const el of knoten.querySelectorAll('*')) {
      if (++n > MAX_JE_KNOTEN) break;
      this.einreihen(el);
    }
    this.plane();
  }

  planeElement(el: Element): void {
    this.einreihen(el);
    this.plane();
  }

  private einreihen(el: Element): void {
    if (!UEBERSPRINGEN.has(el.localName)) this.warteschlange.push(el);
  }

  private plane(): void {
    if (this.timer || !this.aktiv || !this.warteschlange.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const t0 = performance.now();
      while (this.warteschlange.length && performance.now() - t0 < SCHEIBE_MS) {
        const el = this.warteschlange.pop()!;
        if (el.isConnected && !this.schonVerfolgt(el) && hatKlassenHintergrund(el)) this.gefunden(el);
      }
      this.plane();
    }, 0);
  }

  stopp(): void {
    this.aktiv = false;
    this.warteschlange = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Nach einer Pause wieder erlauben.
  erlaube(): void {
    this.aktiv = true;
  }
}
