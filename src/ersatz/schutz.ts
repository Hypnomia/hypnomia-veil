// Schutz der Galerie vor der Seite (Auftrag G, Runde 2): Maus-, Zeiger-, Touch- und Tastenereignisse aus der geschlossenen Shadow Root sind
// `composed` und kaemen mit dem Host als Ziel bei `document` und `window` der Seite an (Popunder per Klick-Listener, Kuerzel wie "f" fuer
// Vollbild). Wie src/riegel/tastatur.ts liegt ein Capture-Listener auf `window` (ab document_start vor den Seitenskripten); liegt der Host im
// `composedPath()`, stoppt er das Ereignis mit stopImmediatePropagation. preventDefault ruft er nie: Links oeffnen sich, Tasten wirken.
// Folge: Listener INNERHALB der Galerie bekaemen nichts; darum wertet dieser Listener den Klick auf "Pause Mia" selbst aus (nur echte
// Ereignisse, `isTrusted`). document.open() loescht Listener auf document und window: `installiere` ist wiederholbar.
const TYPEN = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend',
  'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
] as const;

export interface SchutzZiel {
  host: Element;
  // Gilt dieses echte Klick-Ereignis dem Pause-Knopf? (composedPath() zeigt von aussen nichts aus einer geschlossenen Wurzel.)
  istPauseKlick(e: MouseEvent): boolean;
}

export class Schutz {
  private ziel: SchutzZiel | null = null;
  private an = false;
  constructor(private readonly beiPause: () => void) {}

  setzeZiel(ziel: SchutzZiel | null): void {
    this.ziel = ziel;
  }

  private readonly hoere = (e: Event): void => {
    const z = this.ziel;
    if (!z) return;
    const pfad = e.composedPath();
    // Tasten gehen bei fehlendem Fokus an body: solange die Galerie steht, sieht die Seite gar keine (Kuerzel wie "f" fuer Vollbild).
    if (!pfad.includes(z.host) && !e.type.startsWith('key')) return;
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.isTrusted && z.istPauseKlick(e as MouseEvent)) this.beiPause();
  };

  // Idempotent und wiederholbar (nach document.open() sind die Listener weg).
  installiere(): void {
    this.entferne();
    this.an = true;
    for (const t of TYPEN) window.addEventListener(t, this.hoere, true);
  }

  entferne(): void {
    if (!this.an) return;
    this.an = false;
    for (const t of TYPEN) window.removeEventListener(t, this.hoere, true);
  }
}
