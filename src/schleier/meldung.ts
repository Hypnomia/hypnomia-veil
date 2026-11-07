// Kleine Meldung von Mia nach dem Freilegen (Auftrag F): eine geschlossene Shadow Root, ein Statusfeld mit aria-live="polite", hoechstens eine
// Meldung gleichzeitig. Optional ein Mini-Chibi aus dem Pack (Rolle chibi); ohne Bild nur Text. Alle Texte laufen nur ueber textContent.

import { CHIBI_MINI_SEITE, type ChibiPose } from '../chibi';
import type { AntwortPackBild, NachrichtErkennerPackBild } from '../nachrichten';
import { testhakenAktiv } from './status';
import { TESTHAKEN } from './konstanten';
import { SEITEN_TOKENS } from '../oberflaeche/design/tokens';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';
import { eigeneWurzel } from './eigene';

const ANZEIGE_MS = 4500;
const BILD_FRIST_MS = 3000;
const ABBILD_ATTR: string = TESTHAKEN ? 'data-veil-freilegen-meldung' : '';

const CSS = `
:host { all: initial; }
${SEITEN_TOKENS}
/* Phase 8b ("Sakura Glas"): Glas-Kaertchen wie die Meldungen, ohne Knopf (nicht klickbar). */
.box { position: fixed; right: 16px; bottom: 16px; max-width: min(320px, calc(100vw - 32px)); display: flex; gap: 10px; align-items: center;
  box-sizing: border-box; padding: 9px 14px 9px 12px; border-radius: var(--v-r-m); background: rgba(255, 255, 255, 0.86); color: var(--v-rosa-800);
  border: 1px solid var(--v-glas-kante); font: 700 14px/1.4 var(--v-schrift-text); box-shadow: 0 0 0 1px rgba(255, 179, 211, 0.35), var(--v-schatten);
  pointer-events: none; }
.box[hidden] { display: none; }
img { width: 48px; height: 48px; object-fit: contain; flex: none; filter: drop-shadow(0 3px 6px rgba(168, 50, 111, 0.25)); }
img[hidden] { display: none; }
`;

export class Meldung {
  private host: HTMLElement | null = null;
  private feld: HTMLElement | null = null;
  private kasten: HTMLElement | null = null;
  private bild: HTMLImageElement | null = null;
  private uhr: ReturnType<typeof setTimeout> | null = null;
  private nummer = 0;
  private readonly chibis = new Map<string, Promise<string | null>>();

  // Das Statusfeld muss vor dem Text da sein, sonst liest der Bildschirmleser die erste Meldung nicht vor.
  private baue(): void {
    if (this.host?.isConnected) return;
    void ladeSeitenSchriften();
    const host = document.createElement('div');
    const wurzel = eigeneWurzel(host);
    const stil = document.createElement('style');
    stil.textContent = CSS;
    const kasten = document.createElement('div');
    kasten.className = 'box';
    kasten.hidden = true;
    const bild = document.createElement('img');
    bild.alt = '';
    bild.hidden = true;
    const feld = document.createElement('div');
    feld.setAttribute('role', 'status');
    feld.setAttribute('aria-live', 'polite');
    kasten.append(bild, feld);
    wurzel.append(stil, kasten);
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    document.documentElement.append(host);
    this.host = host;
    this.kasten = kasten;
    this.feld = feld;
    this.bild = bild;
  }

  private ladeChibi(pose: ChibiPose): Promise<string | null> {
    let p = this.chibis.get(pose);
    if (!p) {
      const n: NachrichtErkennerPackBild = { ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: pose, maxSeite: CHIBI_MINI_SEITE };
      const frage = Promise.resolve()
        .then(() => browser.runtime.sendMessage(n) as Promise<AntwortPackBild | { ok: false } | undefined>)
        .then((a) => (a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a.dataUrl : null))
        .catch(() => null);
      const frist = new Promise<null>((ok) => setTimeout(() => ok(null), BILD_FRIST_MS));
      p = Promise.race([frage, frist]);
      this.chibis.set(pose, p);
      void p.then((u) => {
        if (!u) this.chibis.delete(pose);
      });
    }
    return p;
  }

  // Ersetzt eine offene Meldung. Leerer Text zeigt nichts.
  zeige(text: string, pose: ChibiPose | null): void {
    if (!text) return;
    try {
      this.baue();
      if (!this.feld || !this.kasten || !this.bild) return;
      const nr = ++this.nummer;
      this.feld.textContent = text;
      this.bild.hidden = true;
      this.kasten.hidden = false;
      this.schreibeAbbild(text);
      if (this.uhr) clearTimeout(this.uhr);
      this.uhr = setTimeout(() => this.weg(), ANZEIGE_MS);
      if (pose) {
        void this.ladeChibi(pose).then((url) => {
          if (url && nr === this.nummer && this.bild) {
            this.bild.src = url;
            this.bild.hidden = false;
          }
        });
      }
    } catch {
      // Dokument weg: keine Meldung
    }
  }

  private schreibeAbbild(text: string | null): void {
    if (!TESTHAKEN || !testhakenAktiv()) return;
    try {
      if (text === null) document.documentElement.removeAttribute(ABBILD_ATTR);
      else document.documentElement.setAttribute(ABBILD_ATTR, text);
    } catch {
      // Dokument weg
    }
  }

  weg(): void {
    this.nummer++;
    if (this.uhr) clearTimeout(this.uhr);
    this.uhr = null;
    if (this.kasten) this.kasten.hidden = true;
    if (this.feld) this.feld.textContent = '';
    this.schreibeAbbild(null);
  }

  raeumeAuf(): void {
    this.weg();
    this.host?.remove();
    this.host = this.feld = this.kasten = this.bild = null;
  }
}
