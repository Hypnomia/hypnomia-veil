// Titel ohne Aufblitzen (Nachlese Session 8, Auftrag N1): auf Listen-Seiten (synchron bekannt ueber seiteFuer(href, [])) bleiben die Titel-Elemente
// der Adapter vom ersten Zeichnen an unsichtbar und der Tab-Titel leer, bis src/titel/titel.ts entschieden hat. Danach kommt entweder der Satz
// (Modus aktiv) oder sofort das Original (nicht aktiv). Spaetestens nach FRIST_MS gibt dieses Modul von selbst frei (kein echter Lock).
// Solange der Modus aktiv ist, bleibt die Regel stehen, versteckt aber nur Titel ohne die Marke `data-veil-titel` (titel.ts markiert jeden Titel,
// den es bearbeitet hat, auch wenn kein Kommentar entsteht): spaeter eingefuegte Titel (Endlos-Scrollen, SPA) blitzen so nicht auf.
// Sicherung gegen dauerhaft versteckte Titel: die Regel gibt jedes Element nach FRIST_MS ueber eine CSS-Animation selbst frei (Animationen
// schlagen normale Seitenregeln, aber nicht deren !important; darum steht in der Regel kein !important, sonst ginge die Freigabe nicht).
// Restrisiken: Seitenskripte lesen bis zur Entscheidung (hoechstens FRIST_MS) `document.title === ''`, und der Tab-Titel kann beim Setzen
// kurz aufscheinen; Seitenregeln mit `visibility: visible !important` oder eigener Animation am Titel-Element schlagen das Verstecken.
// Die Versteck-Regel steht in einem mit `new CSSStyleSheet()` gebauten Blatt in `document.adoptedStyleSheets`: solche Blaetter unterliegen der
// style-src der Seite nicht (CSP). Fehlt die Technik, faellt das Modul auf ein <style>-Element zurueck, das eine strenge CSP blocken kann;
// dann bleibt nur der leere Tab-Titel. Verstecken ist `visibility: hidden` (die Seite behaelt ihr Layout, nichts springt).
import { adapterFuer } from '../adapter';
import { seiteFuer } from '../adapter/liste';

// Nach dieser Zeit ohne Entscheidung zeigt sich alles wieder (ms).
export const FRIST_MS = 3000;
// Marke an Titel-Elementen, die titel.ts bearbeitet hat: sie sind nicht mehr versteckt.
export const MARKE = 'data-veil-titel';

export class TitelFrueh {
  private blatt: CSSStyleSheet | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private beobachter: MutationObserver | null = null;
  private fristTimer: ReturnType<typeof setTimeout> | null = null;
  private original: string | null = null;
  private aktiv = false;
  private entschieden = false;

  // Laeuft das Verstecken noch?
  get haelt(): boolean {
    return this.aktiv;
  }

  // Hat titel.ts schon entschieden, dass hier ersetzt wird (die Regel steht dann nur noch fuer spaeter eingefuegte Titel)?
  get istEntschieden(): boolean {
    return this.entschieden;
  }

  // Startet das Verstecken, wenn die Adresse schon ohne Einstellungen auf der Liste steht. Gibt zurueck, ob es gestartet wurde.
  starte(): boolean {
    if (this.aktiv) return true;
    let name;
    try {
      name = seiteFuer(location.href, []);
    } catch {
      return false;
    }
    if (!name) return false;
    this.aktiv = true;
    const selektoren = adapterFuer(name).titel ?? [];
    if (selektoren.length > 0) {
      const sel = selektoren.map((x) => `${x}:not([${MARKE}])`).join(',');
      this.legeRegel(
        `@keyframes veilTitelFrei { 0%, 99.9% { visibility: hidden } 100% { visibility: visible } }\n` +
          `${sel} { visibility: hidden; animation: veilTitelFrei ${FRIST_MS}ms linear 1 forwards; }`,
      );
    }
    this.haltTitel();
    try {
      this.beobachter = new MutationObserver(() => this.haltTitel());
      this.beobachter.observe(document, { childList: true, subtree: true, characterData: true });
    } catch {
      // ohne Beobachter bleibt es beim einmaligen Leeren
    }
    this.fristTimer = setTimeout(() => this.gibFrei(), FRIST_MS);
    return true;
  }

  private legeRegel(css: string): void {
    try {
      const b = new CSSStyleSheet();
      b.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, b];
      this.blatt = b;
      return;
    } catch {
      // keine konstruierbaren Blaetter (oder Firefox verweigert den Zugriff aus dem Content-Script): <style> als Rueckfall
    }
    try {
      const s = document.createElement('style');
      s.textContent = css;
      (document.head ?? document.documentElement)?.appendChild(s);
      this.styleElement = s;
    } catch {
      // Dokument noch nicht bereit: dann gibt es nur den leeren Tab-Titel
    }
  }

  // Merkt einen neuen Titel der Seite als Original und leert den Tab-Titel wieder.
  private haltTitel(): void {
    if (!this.aktiv) return;
    try {
      const t = document.title;
      if (t !== '') {
        this.original = t;
        document.title = '';
      }
    } catch {
      // Dokument weg
    }
  }

  // Stellt den Tab-Titel wieder her (ohne die Versteck-Regel zu loesen): fuer den Durchlauf, der gleich den Satz einsetzt.
  stelleTitelHer(): void {
    if (this.original === null) return;
    try {
      if (document.title === '') document.title = this.original;
    } catch {
      // Dokument weg
    }
    this.original = null;
  }

  // Der Modus ist aktiv und titel.ts hat die ersten Titel gesetzt: Tab-Titel zurueck, Frist und Beobachter ab. Die Regel bleibt fuer spaetere Titel.
  entscheide(): void {
    if (!this.aktiv) return;
    this.entschieden = true;
    if (this.fristTimer) clearTimeout(this.fristTimer);
    this.fristTimer = null;
    this.beobachter?.disconnect();
    this.beobachter = null;
    this.stelleTitelHer();
  }

  // Alles frei: Regel weg, Beobachter ab, Tab-Titel wieder da. Mehrfach aufrufbar.
  gibFrei(): void {
    if (!this.aktiv) return;
    this.aktiv = false;
    if (this.fristTimer) clearTimeout(this.fristTimer);
    this.fristTimer = null;
    this.beobachter?.disconnect();
    this.beobachter = null;
    this.stelleTitelHer();
    // Erst die Regel leeren: hat die Seite eine Kopie der Blattliste gemerkt und setzt sie spaeter neu, bleibt das Blatt wirkungslos.
    try {
      this.blatt?.replaceSync('');
    } catch {
      // Blatt nicht mehr beschreibbar
    }
    try {
      if (this.blatt) this.blatt.disabled = true;
    } catch {
      // egal
    }
    try {
      const b = this.blatt;
      if (b) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== b);
    } catch {
      // Xray oder Dokument weg: das leere Blatt bleibt wirkungslos
    }
    try {
      if (this.styleElement) this.styleElement.textContent = '';
      this.styleElement?.remove();
    } catch {
      // Dokument weg
    }
    this.blatt = null;
    this.styleElement = null;
  }
}
