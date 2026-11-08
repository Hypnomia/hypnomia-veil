// Beobachter: sammelt img, video, canvas, Bilder in Inline-SVG (image) und Elemente mit Inline-Hintergrundbild in Dokument und allen Shadow Roots,
// beim Start und bei jeder Mutation. Entdeckt Shadow Roots (auch geschlossene) und legt die Schleier-CSS hinein.

import { HG_SELEKTOR, TESTHAKEN, type Art } from './konstanten';
import { sichereStil, versorgeWurzel, wurzelVon } from './shadow';
import { eigeneSperreImTestAus, istEigeneWurzel } from './eigene';
import { istSvgBild } from './svg-bild';

// svg image: Bilder in Inline-SVG (dieselbe Auswahl wie die Versteck-Regel in style.css); melde prueft den Namensraum noch einmal.
const KANDIDAT = `img, video, canvas, svg image, ${HG_SELEKTOR}`;
// href, attributeName, id: SMIL-Animationen, die spaeter auf ein Bild in Inline-SVG umgelenkt werden oder dessen id treffen (svg-bild.ts).
const ATTRIBUTE = ['src', 'srcset', 'style', 'class', 'href', 'attributeName', 'id'];
// Elemente, die nie eine Shadow Root tragen oder fuer die sich die Suche nicht lohnt.
const KEIN_HOST = new Set(['img', 'script', 'style', 'link', 'meta', 'br', 'hr', 'source', 'track', 'title', 'head', 'wbr']);
const FRAME_BUDGET_MS = 3;
const NACHFRIST_NACH_LOAD_MS = 2000;
// Ereignis des Hakens in der Seitenwelt (entrypoints/wurzel-haken.content.ts) am Host einer neuen Shadow Root. Nur ein Hinweis.
const HINWEIS_WURZEL = 'veil-wurzel';

export interface BeobachterRueckrufe {
  // Kandidat gefunden (neu oder erneut gesehen).
  gefunden(el: Element, art: Exclude<Art, 'klasse'>): void;
  // Eines der beobachteten Attribute hat sich geaendert (auch an Elementen, die noch nicht verfolgt werden).
  geaendert(el: Element, attribut: string): void;
  // Ein Knoten wurde nach dem Start hinzugefuegt (fuer die Suche nach Hintergruenden aus Stylesheets).
  hinzugefuegt(knoten: Element): void;
  // Es wurden Knoten aus dem Dokument entfernt (der Schleier loest dann spaeter die Verweise auf getrennte Elemente).
  entfernt(): void;
  // Neue oder erneut gefundene Shadow Root (Ereignisse abhoeren).
  neueWurzel(wurzel: ShadowRoot): void;
  // true = Seite ist aus (Pause oder Ausnahme): neue Shadow-Root-Stile starten abgeschaltet.
  istAus(): boolean;
}

function artVon(el: Element): Exclude<Art, 'klasse'> {
  switch (el.localName) {
    case 'img':
      return 'bild';
    case 'video':
      return 'video';
    case 'canvas':
      return 'canvas';
    case 'image':
      return 'svgbild';
    default:
      return 'hintergrund';
  }
}

export class Beobachter {
  private readonly beobachter = new Map<Node, MutationObserver>();
  // Elemente, die noch eine Shadow Root bekommen koennten (Parser und attachShadow melden nichts).
  private kandidaten: Element[] = [];
  // Elemente, die schon als moeglicher Shadow-Host vorgemerkt wurden (nicht doppelt einreihen). Beim Stopp neu angelegt.
  private bekannt = new WeakSet<Element>();
  private rafId = 0;
  private laeuft = false;
  private fensterBis = Number.POSITIVE_INFINITY;
  // Bilder in Inline-SVG: ein eigener Beobachter je Element ohne attributeFilter. Ein attributeFilter meldet Attribute mit Namensraum nie
  // (DOM-Standard), xlink:href per setAttributeNS bliebe sonst ungesehen. Gemeldet wird jede Aenderung von href, gleich in welchem Namensraum.
  private readonly svgBeobachter = new MutationObserver((liste) => this.beiSvgMutation(liste));

  constructor(private readonly ruf: BeobachterRueckrufe) {}

  start(): void {
    if (this.laeuft) return;
    this.laeuft = true;
    this.beobachteWurzel(document);
    this.scanne(document);
  }

  // Beendet die Beobachtung (Pause, Ausnahme, Abbau). Unverarbeitete Mutationen werden verworfen.
  stopp(): void {
    this.laeuft = false;
    for (const [wurzel, mo] of this.beobachter) {
      wurzel.removeEventListener(HINWEIS_WURZEL, this.beiHinweis, true);
      mo.takeRecords();
      mo.disconnect();
    }
    this.beobachter.clear();
    this.svgBeobachter.takeRecords();
    this.svgBeobachter.disconnect();
    this.kandidaten = [];
    this.bekannt = new WeakSet();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  // Alle beobachteten Wurzeln (Dokument und Shadow Roots).
  wurzeln(): ParentNode[] {
    return [...this.beobachter.keys()] as ParentNode[];
  }

  // Nach dem load-Ereignis noch 2 s Wiederholungen, danach nur noch Mutationen.
  markiereGeladen(): void {
    this.fensterBis = performance.now() + NACHFRIST_NACH_LOAD_MS;
  }

  private beobachteWurzel(wurzel: Document | ShadowRoot): void {
    if (this.beobachter.has(wurzel)) return;
    const mo = new MutationObserver((liste) => this.beiMutation(liste));
    mo.observe(wurzel, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRIBUTE });
    this.beobachter.set(wurzel, mo);
    // Der Haken meldet neue Wurzeln im Augenblick des Anlegens. Das Ereignis steigt auf (composed): jede beobachtete Wurzel hoert es, damit
    // auch ein Host in einer geschlossenen Wurzel sein eigenes Ziel im Ereignispfad hat.
    wurzel.addEventListener(HINWEIS_WURZEL, this.beiHinweis, true);
  }

  // Hinweis, nichts weiter: gesucht wird die Wurzel wie bei jedem Host selbst (pruefeHost), der Inhalt des Ereignisses zaehlt nicht. Ein gefaelschtes
  // Ereignis kostet hoechstens eine zusaetzliche Suche.
  private readonly beiHinweis = (e: Event): void => {
    if (!this.laeuft) return;
    try {
      const ziel = e.composedPath()[0];
      if (ziel instanceof Element) this.pruefeHost(ziel);
    } catch {
      // Hinweis unbrauchbar: die Suche im naechsten Frame findet die Wurzel trotzdem
    }
  };

  private beiMutation(liste: MutationRecord[]): void {
    if (!this.laeuft) return;
    const attribute = new Map<Element, Set<string>>();
    let entfernt = false;
    for (const m of liste) {
      if (m.type === 'childList') {
        // Wurzel geleert (innerHTML und Aehnliches): den eigenen Stil sofort wieder einlegen, noch in diesem Mikrotask.
        if (m.removedNodes.length && m.target instanceof ShadowRoot) sichereStil(m.target);
        if (m.removedNodes.length) entfernt = true;
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          this.scanneKnoten(n as Element);
          this.ruf.hinzugefuegt(n as Element);
        }
      } else if (m.type === 'attributes' && m.attributeName) {
        const t = m.target as Element;
        let satz = attribute.get(t);
        if (!satz) attribute.set(t, (satz = new Set()));
        satz.add(m.attributeName);
      }
    }
    for (const [el, satz] of attribute) for (const a of satz) this.ruf.geaendert(el, a);
    if (entfernt) this.ruf.entfernt();
  }

  private beiSvgMutation(liste: MutationRecord[]): void {
    if (!this.laeuft) return;
    const gesehen = new Set<Element>();
    for (const m of liste) if (m.attributeName === 'href' && m.target instanceof Element) gesehen.add(m.target);
    for (const el of gesehen) this.ruf.geaendert(el, 'href');
  }

  // Kandidat melden; ein Bild in Inline-SVG bekommt dabei seinen Attribut-Beobachter (mehrfaches observe desselben Elements ist unschaedlich).
  private melde(el: Element): void {
    const art = artVon(el);
    if (art === 'svgbild') {
      if (!istSvgBild(el)) return;
      this.svgBeobachter.observe(el, { attributes: true });
    }
    this.ruf.gefunden(el, art);
  }

  // Alle Kandidaten und moeglichen Shadow-Hosts unterhalb einer Wurzel (Dokument oder Shadow Root).
  private scanne(wurzel: ParentNode): void {
    for (const el of wurzel.querySelectorAll(KANDIDAT)) this.melde(el);
    for (const el of wurzel.querySelectorAll('*')) this.pruefeHost(el);
  }

  private scanneKnoten(knoten: Element): void {
    if (knoten.matches(KANDIDAT)) this.melde(knoten);
    this.pruefeHost(knoten);
    this.scanne(knoten);
  }

  private pruefeHost(el: Element): void {
    if (KEIN_HOST.has(el.localName)) return;
    const wurzel = wurzelVon(el);
    if (wurzel) {
      this.entdeckeWurzel(wurzel);
      return;
    }
    if (performance.now() < this.fensterBis && !this.bekannt.has(el)) {
      this.bekannt.add(el);
      this.kandidaten.push(el);
      this.planeFrame();
    }
  }

  private entdeckeWurzel(wurzel: ShadowRoot): void {
    // Schon beobachtet (das composed-Ereignis des Hakens trifft jede Wurzel auf dem Pfad): nichts weiter zu tun.
    if (this.beobachter.has(wurzel)) return;
    // Eigene Wurzeln der Erweiterung (Galerie, Werbung, Riegel ...) nie betreten: Mias Bilder darin sind keine Seitenbilder.
    if (istEigeneWurzel(wurzel) && !(TESTHAKEN && eigeneSperreImTestAus())) return;
    versorgeWurzel(wurzel, this.ruf.istAus());
    this.ruf.neueWurzel(wurzel);
    this.beobachteWurzel(wurzel);
    this.scanne(wurzel);
  }

  // Vor jedem Zeichnen nachsehen, ob Kandidaten inzwischen eine Shadow Root haben. Zeitbudget je Frame, reihum.
  // Ein Kandidat bleibt im Rennen, bis er eine Wurzel bekommt, aus dem Dokument fliegt oder das Fenster (2 s nach load) endet:
  // keine Obergrenze je Kandidat, damit auch spaet angehaengte Wurzeln (Frameworks, Komponenten nach dem Laden) gefunden werden.
  private planeFrame(): void {
    if (this.rafId || !this.laeuft) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.laeuft) return;
      const liste = this.kandidaten;
      this.kandidaten = [];
      const behalten: Element[] = [];
      const t0 = performance.now();
      let i = 0;
      for (; i < liste.length; i++) {
        if (performance.now() - t0 > FRAME_BUDGET_MS) break;
        const el = liste[i]!;
        const wurzel = el.isConnected ? wurzelVon(el) : null;
        if (wurzel) {
          this.entdeckeWurzel(wurzel);
          continue;
        }
        if (el.isConnected) behalten.push(el);
        else this.bekannt.delete(el); // darf bei erneutem Einfuegen wieder vorgemerkt werden
      }
      this.kandidaten = liste.slice(i).concat(behalten, this.kandidaten);
      if (performance.now() > this.fensterBis) this.kandidaten = [];
      if (this.kandidaten.length) this.planeFrame();
    });
  }
}
