// Standbild des Hauptvideos ganz durch Mia (Phase 8, Auftrag K2). Solange das Hauptvideo einer Erwachsenenseite noch nicht durch das Quiz
// freigegeben ist, liegt ein Mia-Vorschau-Bild der gewaehlten Stufe ueber seiner Flaeche (Poster und erstes Bild des Videos sind nie zu sehen,
// auch keine Zonen-Flecken). Gewaehlt wird wie bei den Vorschaubildern: Rolle `vorschau`, Stufe `erwachsen.stufe`, Klasse der Flaeche
// (src/pack/wahl.ts), nie schaerfer als die Stufe. Der Player (src/player/player.ts) entscheidet, welche Videos ein Standbild bekommen, und
// ruft `setze` bei jeder Neubewertung; hier liegt nur Darstellung und Bildabruf.
//
// Aufbau: Ein Host-div als Geschwister direkt hinter dem Video (gleicher Stapelkontext, die Bedienelemente der Seite bleiben bedienbar,
// `pointer-events: none`), absolut auf die Flaeche des Videos gelegt, mit geschlossener Shadow Root (Versteck-Regel und Seitenstile reichen
// nicht hinein). Bis das Bild da ist, deckt der Host dunkel: das Video wird nie vor dem Tausch gezeigt (Hide-first). Kommt kein Bild (Pack ohne
// passendes Bild, Fehler, Seiten-CSP), verschwindet der Host und das Video bleibt wie bisher (Schleier mit Zonen).
import { STUFEN_WAHL, type StufeWahl } from '../einstellungen';
import type { AntwortFehler, AntwortPackBild, NachrichtErkennerPackBild } from '../nachrichten';
import { ANTWORT_MAX_MS } from '../schleier/konstanten';
import { vergissWecken, wecke } from '../schleier/pruefung';
import { FARBEN, WERTE } from '../oberflaeche/design/werte';
import { SEITEN_TEXT } from '../oberflaeche/design/familie';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';
import { spiralAuge } from '../oberflaeche/design/motive';
import { eigeneWurzel } from '../schleier/eigene';
import { legeAufRechteck, istFestPositioniert, zIndexFuerStandbild, Z_DECKEL } from '../schleier/lage';

// Testhaken nur im Testbau: ohne Schalter faellt das Attribut samt Code beim Bauen weg (Release-Pruefung).
const TESTHAKEN_S: boolean = import.meta.env.WXT_TESTHAKEN === '1';
const ATTR_STANDBILD = TESTHAKEN_S ? 'data-veil-standbild' : '';
const ATTR_GELADEN = TESTHAKEN_S ? 'data-veil-standbild-geladen' : '';

const LAGE_TAKT_MS = 400;
const SCHLUESSEL_MAX = 512;
// Session 16 (UX 8b Nr. 20): kleines Etikett mit Spiral-Auge oben links, damit das Standbild als Mias Deckel erkennbar ist und sagt, dass erst
// das Quiz kommt. Kein Knopf: der Host laesst alle Klicks zum Player der Seite durch (Abspielen oeffnet den Riegel mit "Pause Mia").
export const ETIKETT_TEXT = 'Mia’s cover. Press play and answer first.';
const GRUND_STIL =
  '.b{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;background-size:cover;background-position:center;background-repeat:no-repeat}' +
  // Huelle mit container-type (am Host selbst setzt `all: initial` es zurueck, Lesung Nr. 1): unter 240 px Breite kein Etikett.
  '.h{position:absolute;inset:0;container-type:size;pointer-events:none}' +
  `.e{position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:6px;max-width:calc(100% - 20px);box-sizing:border-box;padding:4px 10px 4px 4px;border-radius:${WERTE['r-voll']};background:${WERTE['glas-kante']};color:${FARBEN['rosa-800']};font:800 12px/1.3 '${SEITEN_TEXT}',system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:${WERTE['schatten-klein']};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
  '.e svg{flex:none}@container (max-width:239px){.e{display:none}}';

interface Flaeche {
  host: HTMLElement;
  bild: HTMLDivElement;
  // Stylesheet der Wurzel: adoptiert (CSSOM, von einer strengen Seiten-CSP unberuehrt) oder, wenn das nicht geht, ein style-Element.
  blatt: CSSStyleSheet | null;
  stil: HTMLStyleElement | null;
  beob: ResizeObserver | null;
  // Woran die Wahl hing (Schluessel, Klasse, Stufe, Pack): aendert sich das, wird neu geholt.
  stand: string;
  generation: number;
  // Das Element, dessen Flaeche gedeckt wird: der Anker des Players (Adapter, samt Poster-Ebenen der Seite) oder das Video selbst.
  deckt: Element;
  zuletztZ: number;
  // Nur dunkler Deckel ohne Bild (wartendes Video, dessen Bild fehlt oder scheiterte).
  deckelNur: boolean;
}

export interface StandbildQuelle {
  lebt(): boolean;
}

// Schluessel der Wahl: die Video-Kennung der Adresse (wie bei den Vorschau-Karten desselben Videos), sonst Adresse ohne Abfrage.
export function standbildSchluessel(href: string, basis: string): string {
  try {
    const u = new URL(href, basis);
    const k = /[?&]viewkey=([\w-]+)/i.exec(u.search) ?? /\/videos?\/([^/?#]+)/i.exec(u.pathname) ?? /\/video[-.]?(\w+)\//i.exec(u.pathname);
    if (k?.[1]) return `video:${k[1]}`.slice(0, SCHLUESSEL_MAX);
    return `${u.origin}${u.pathname}`.slice(0, SCHLUESSEL_MAX);
  } catch {
    return 'standbild';
  }
}

// Alle Hosts dieses Content-Scripts: der Player ignoriert ihr Kommen und Gehen in seinem MutationObserver (sonst weckte jedes Verschieben des
// Hosts eine neue Bewertung, die ihn wieder verschiebt).
const hosts = new WeakSet<Node>();
export const istStandbildHost = (n: Node): boolean => hosts.has(n);
// Session 16 (Live-Lauf): stehende Hosts zum Nachsehen per Punkt. Der Host hat `pointer-events: none` und fehlt darum in elementsFromPoint;
// Freilegen fragt hier, ob ein Standbild den Punkt deckt (dann kein "Reveal" auf Mias Deckel). Schwache Verweise, abgehaengte fallen heraus.
const stehende = new Set<WeakRef<HTMLElement>>();
export function standbildDecktPunkt(x: number, y: number): boolean {
  for (const ref of stehende) {
    const h = ref.deref();
    if (!h || !h.isConnected) {
      if (!h) stehende.delete(ref);
      continue;
    }
    const r = h.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

export class Standbild {
  private readonly flaechen = new Map<HTMLVideoElement, Flaeche>();
  // Videos, deren Bild nicht kam oder nicht geladen werden konnte, mit dem Stand, bei dem das passierte: erst ein anderer Stand versucht es neu.
  private readonly gescheitert = new WeakMap<HTMLVideoElement, string>();
  private deckel: ReadonlySet<HTMLVideoElement> = new Set();
  private bildErlaubt = true;
  private takt: ReturnType<typeof setInterval> | null = null;
  private naechsteGeneration = 1;
  // Rollen: klebende oder feste Player bewegen sich gegen ihren Bezug; die Lage folgt per requestAnimationFrame (passiv, capture).
  private rollBild = 0;
  private readonly beimRollen = (): void => {
    if (this.rollBild) return;
    this.rollBild = requestAnimationFrame(() => {
      this.rollBild = 0;
      for (const [v, f] of this.flaechen) this.lege(v, f);
    });
  };

  // Hat dieses Video gerade einen Host (dann gelten Sperren fuer Bild-in-Bild und Vollbild)?
  hat(v: HTMLVideoElement): boolean {
    return this.flaechen.has(v);
  }

  constructor(private readonly q: StandbildQuelle) {}

  // Genau diese Videos bekommen ein Standbild (Wert: das Element, dessen Flaeche gedeckt wird, Anker oder Video); alle anderen verlieren es.
  // `deckel`: wartende Videos (Listenseite ohne Geste, kein Riegel darueber): scheitert ihr Bild oder ist keins erlaubt (`bildErlaubt` false),
  // bleibt ein schlichter dunkler Deckel stehen statt des offenen Einzelbilds. Alle anderen verlieren den Host, wenn kein Bild kommt.
  setze(ziele: ReadonlyMap<HTMLVideoElement, Element>, stufe: StufeWahl, packStand: number, deckel: ReadonlySet<HTMLVideoElement> = new Set(), bildErlaubt = true): void {
    this.deckel = deckel;
    this.bildErlaubt = bildErlaubt;
    for (const [v, f] of [...this.flaechen]) if (!ziele.has(v) || !v.isConnected || (f.deckelNur && !deckel.has(v))) this.entferne(v);
    for (const [v, anker] of ziele) {
      if (!v.isConnected) continue;
      this.sichere(v, anker, stufe, packStand);
    }
    this.pflegeTakt();
  }

  alleWeg(): void {
    for (const v of [...this.flaechen.keys()]) this.entferne(v);
    this.pflegeTakt();
  }

  private pflegeTakt(): void {
    if (this.flaechen.size && !this.takt) {
      addEventListener('scroll', this.beimRollen, { capture: true, passive: true });
      this.takt = setInterval(() => {
        if (!this.q.lebt()) return this.alleWeg();
        // Ein verborgener Tab braucht keine Lagepflege (sie holt beim Sichtbarwerden der Takt und der ResizeObserver nach).
        if (document.hidden) return;
        for (const [v, f] of this.flaechen) {
          // Session 17: hebt die Seite spaeter den z-index des Videos selbst (ohne Mutation im Anker), zieht der Host nach. Billig: nur der
          // eigene z-index des Videos wird gelesen; die volle Rechnung laeuft erst, wenn er den Host erreicht.
          try {
            const zv = parseInt(getComputedStyle(v).zIndex, 10);
            if (Number.isFinite(zv) && f.zuletztZ !== undefined && zv >= f.zuletztZ) {
              const z = this.zFuer(v, f);
              if (z !== f.zuletztZ) {
                f.zuletztZ = z;
                f.host.style.setProperty('z-index', String(z), 'important');
              }
            }
          } catch {
            // Video weg: der naechste Takt raeumt auf
          }
          this.lege(v, f);
        }
      }, LAGE_TAKT_MS);
    } else if (!this.flaechen.size && this.takt) {
      clearInterval(this.takt);
      this.takt = null;
      removeEventListener('scroll', this.beimRollen, { capture: true });
      if (this.rollBild) cancelAnimationFrame(this.rollBild);
      this.rollBild = 0;
    }
  }

  private sichere(v: HTMLVideoElement, anker: Element, stufe: StufeWahl, packStand: number): void {
    const deckt = anker !== v && anker.contains(v) && anker.nodeType === 1 ? anker : v;
    const eltern = deckt === v ? v.parentNode : deckt;
    if (!eltern) return;
    let b = 0;
    let h = 0;
    try {
      const r = deckt.getBoundingClientRect();
      b = r.width;
      h = r.height;
    } catch {
      return;
    }
    if (!(b > 0 && h > 0)) return;
    // Klasse der Flaeche wie src/pack/wahl.ts (quer, quadratisch, hoch): die Anfrage schickt die Masse der Flaeche, der Erkenner waehlt.
    const kennung = `${standbildSchluessel(location.href, document.baseURI)}|${STUFEN_WAHL.indexOf(stufe)}|${packStand}`;
    const ohneBild = !this.bildErlaubt || this.gescheitert.get(v) === kennung;
    if (ohneBild && !this.deckel.has(v)) return;
    let f = this.flaechen.get(v);
    if (f && f.deckt !== deckt) {
      this.entferne(v);
      f = undefined;
    }
    if (!f) {
      f = this.baue(v, deckt);
      this.flaechen.set(v, f);
    }
    // Deckt der Host den Anker, steht er darin (oberhalb der Poster-Ebenen des Players), sonst als Geschwister hinter dem Video.
    // Die Reihenfolge im DOM entscheidet nicht: der z-index des Hosts liegt ueber allem im Anker, darum genuegt es, dass er im richtigen Elternknoten steht.
    if (f.host.parentNode !== eltern) {
      try {
        if (deckt === v) eltern.insertBefore(f.host, v.nextSibling);
        else (eltern as Element).append(f.host);
      } catch {
        this.entferne(v);
        return;
      }
    }
    // z-index nur hier (bei jeder Bewertung des Players, also auch nach Mutationen im Anker) neu rechnen, nicht in jedem Lage-Takt.
    const z = this.zFuer(v, f);
    if (z !== f.zuletztZ) {
      f.zuletztZ = z;
      f.host.style.setProperty('z-index', String(z), 'important');
    }
    this.lege(v, f, true);
    if (ohneBild) {
      this.setzeDeckel(f);
      return;
    }
    f.deckelNur = false;
    // Neu holen nur bei anderer Wahl (Schluessel, Stufe, Pack oder Klasse der Flaeche); eine kleine Groessenaenderung innerhalb der Klasse nicht.
    const klasse = b / h >= 1.2 ? 'quer' : b / h < 0.85 ? 'hoch' : 'quadratisch';
    const wahlStand = `${kennung}|${klasse}`;
    if (f.stand === wahlStand) return;
    f.stand = wahlStand;
    // Jede neue Wahl (Stufenwechsel, anderes Pack, andere Klasse) deckt sofort dunkel: das alte Bild darf nie stehen bleiben, auch nicht, wenn die
    // neue Stufe milder ist (Entscheidung 150).
    this.setzeBlatt(f, GRUND_STIL);
    if (ATTR_STANDBILD) f.host.setAttribute(ATTR_STANDBILD, 'wartet');
    if (ATTR_GELADEN) f.host.removeAttribute(ATTR_GELADEN);
    void this.hole(v, f, wahlStand, kennung, b, h, stufe);
  }

  // Stile des Hosts ueber CSSOM, Stylesheet der Wurzel ueber adoptedStyleSheets: eine strenge Seiten-CSP (style-src ohne unsafe-inline) sperrt
  // style-Attribute und style-Elemente, nicht aber das CSSOM.
  private baue(v: HTMLVideoElement, deckt: Element): Flaeche {
    const host = document.createElement('div');
    hosts.add(host);
    for (const ref of stehende) if (!ref.deref()?.isConnected) stehende.delete(ref); // Lesung Nr. 4: kein Wachsen auf langen Seiten
    stehende.add(new WeakRef(host));
    const s = host.style;
    for (const [n, w] of [
      ['all', 'initial'],
      ['position', 'absolute'],
      ['display', 'block'],
      ['margin', '0'],
      ['padding', '0'],
      ['border', '0'],
      ['overflow', 'hidden'],
      ['background-color', '#1b1018'],
      ['pointer-events', 'none'],
      ['visibility', 'visible'],
      ['opacity', '1'],
      ['box-sizing', 'border-box'],
      ['left', '0'],
      ['top', '0'],
    ] as const) s.setProperty(n, w, 'important');
    if (ATTR_STANDBILD) host.setAttribute(ATTR_STANDBILD, 'wartet');
    const wurzel = eigeneWurzel(host);
    // Das Bild ist ein Hintergrund aus dem Stylesheet der Wurzel, kein img und kein style-Attribut: Versteck-Regel und Schleier (die auch in
    // Shadow Roots wirken und img sowie Inline-Hintergruende nie als eigen erkennen) fassen es so nicht an.
    const bild = document.createElement('div');
    bild.className = 'b';
    let blatt: CSSStyleSheet | null = null;
    let stil: HTMLStyleElement | null = null;
    try {
      blatt = new CSSStyleSheet();
      blatt.replaceSync(GRUND_STIL);
      wurzel.adoptedStyleSheets = [blatt];
    } catch {
      blatt = null;
      stil = document.createElement('style');
      stil.textContent = GRUND_STIL;
      wurzel.append(stil);
    }
    const etikett = document.createElement('div');
    etikett.className = 'e';
    etikett.append(spiralAuge(20), document.createTextNode(ETIKETT_TEXT));
    void ladeSeitenSchriften();
    const huelle = document.createElement('div');
    huelle.className = 'h';
    huelle.append(etikett);
    wurzel.append(bild, huelle);
    const f: Flaeche = { host, bild, blatt, stil, beob: null, stand: '', generation: this.naechsteGeneration++, deckt, zuletztZ: Number.NaN, deckelNur: false };
    try {
      f.beob = new ResizeObserver(() => this.lege(v, f));
      f.beob.observe(deckt);
      if (deckt !== v) f.beob.observe(v);
    } catch {
      f.beob = null;
    }
    return f;
  }

  private setzeBlatt(f: Flaeche, css: string): void {
    try {
      if (f.blatt) f.blatt.replaceSync(css);
      else if (f.stil) f.stil.textContent = css;
    } catch {
      // Stylesheet nicht beschreibbar: das Bild bleibt beim dunklen Grund
    }
  }

  // z-index des Hosts (Rechnung in src/schleier/lage.ts).
  private zFuer(v: HTMLVideoElement, f: Flaeche): number {
    return zIndexFuerStandbild(v, f.deckt, f.host);
  }

  // Legt den Host auf die Flaeche des Videos (Rechnung in src/schleier/lage.ts). Gedeckt wird nur die Videoflaeche (Bedienleisten und Knoepfe
  // daneben im Anker bleiben sichtbar); der Host steht im Anker, damit sein z-index ueber dessen Poster-Ebenen liegt (K2, zweite Lesung, Fund 1).
  private lege(v: HTMLVideoElement, f: Flaeche, zwingen = false): void {
    if (!v.isConnected || !f.deckt.isConnected) return;
    const t = v.getBoundingClientRect();
    if (!(t.width > 0 && t.height > 0)) return;
    // Im Anker (positioniert, auch fest oder klebend) ist der Anker der Bezug: absolute. Als Geschwister eines festen Videos: fixed.
    // Klebende Videos folgen ueber den Rollen-Horcher.
    legeAufRechteck(f.host, t, f.deckt === v && istFestPositioniert(v), zwingen);
  }

  private entferne(v: HTMLVideoElement): void {
    const f = this.flaechen.get(v);
    if (!f) return;
    this.flaechen.delete(v);
    f.generation = -1;
    try {
      f.beob?.disconnect();
    } catch {
      // egal
    }
    f.host.remove();
  }

  private async hole(v: HTMLVideoElement, f: Flaeche, wahlStand: string, kennung: string, b: number, h: number, stufe: StufeWahl): Promise<void> {
    const generation = f.generation;
    const gueltig = () => this.q.lebt() && this.flaechen.get(v) === f && f.generation === generation && f.stand === wahlStand;
    const schluessel = kennung.split('|')[0]!;
    let antwort: AntwortPackBild | null = null;
    try {
      antwort = await frageBild(() => this.q.lebt(), schluessel, b, h, stufe);
    } catch {
      antwort = null;
    }
    if (!gueltig()) return;
    if (!antwort) return this.scheitert(v, kennung);
    // Vorladen ausserhalb des Dokuments: erst wenn das Bild dekodiert ist, wird es eingesetzt (bis dahin deckt der dunkle Host).
    const probe = new Image();
    probe.decoding = 'async';
    probe.addEventListener('load', () => {
      if (!gueltig()) return;
      this.setzeBlatt(f, `${GRUND_STIL}.b{background-image:url("${antwort.dataUrl}")}`);
      if (ATTR_STANDBILD) f.host.setAttribute(ATTR_STANDBILD, antwort.name);
      if (ATTR_GELADEN) f.host.setAttribute(ATTR_GELADEN, '1');
    }, { once: true });
    probe.addEventListener('error', () => {
      if (gueltig()) this.scheitert(v, kennung);
    }, { once: true });
    probe.src = antwort.dataUrl;
  }

  private scheitert(v: HTMLVideoElement, kennung: string): void {
    this.gescheitert.set(v, kennung);
    const f = this.flaechen.get(v);
    if (f && this.deckel.has(v)) {
      this.setzeDeckel(f);
      return;
    }
    this.entferne(v);
    this.pflegeTakt();
  }

  // Dunkler Deckel mit Etikett, ohne Bild.
  private setzeDeckel(f: Flaeche): void {
    f.deckelNur = true;
    f.stand = 'deckel';
    this.setzeBlatt(f, GRUND_STIL);
    if (ATTR_STANDBILD) f.host.setAttribute(ATTR_STANDBILD, 'deckel');
    if (ATTR_GELADEN) f.host.removeAttribute(ATTR_GELADEN);
  }
}

// Eine Anfrage an den Erkenner, nach einem Transportfehler einmal mit frischem Wecken. null = kein Bild.
async function frageBild(lebt: () => boolean, schluessel: string, breite: number, hoehe: number, stufe: StufeWahl): Promise<AntwortPackBild | null> {
  const einmal = async (): Promise<AntwortPackBild | AntwortFehler | 'transport'> => {
    if (!(await wecke(lebt))) return 'transport';
    const n: NachrichtErkennerPackBild = { ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel, breite, hoehe, stufe };
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const zeit = new Promise<null>((fertig) => {
      uhr = setTimeout(() => fertig(null), ANTWORT_MAX_MS);
    });
    try {
      const a = (await Promise.race([browser.runtime.sendMessage(n) as Promise<AntwortPackBild | AntwortFehler | undefined>, zeit])) as AntwortPackBild | AntwortFehler | undefined | null;
      if (a && a.ok === false) return a;
      return a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a : 'transport';
    } catch {
      return 'transport';
    } finally {
      clearTimeout(uhr);
    }
  };
  let a = await einmal();
  if (a === 'transport') {
    vergissWecken();
    a = await einmal();
  }
  return a !== 'transport' && a.ok === true ? a : null;
}
