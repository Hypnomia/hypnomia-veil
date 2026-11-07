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

// Testhaken nur im Testbau: ohne Schalter faellt das Attribut samt Code beim Bauen weg (Release-Pruefung).
const TESTHAKEN_S: boolean = import.meta.env.WXT_TESTHAKEN === '1';
const ATTR_STANDBILD = TESTHAKEN_S ? 'data-veil-standbild' : '';
const ATTR_GELADEN = TESTHAKEN_S ? 'data-veil-standbild-geladen' : '';

const LAGE_TAKT_MS = 400;
const Z_DECKEL = 9999; // hoechster z-index des Hosts: nie ueber Dialoge und Leisten der Seite ausserhalb des Players (K2, zweite Lesung)
const SCHLUESSEL_MAX = 512;
const GRUND_STIL = '.b{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;background-size:cover;background-position:center;background-repeat:no-repeat}';

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

export class Standbild {
  private readonly flaechen = new Map<HTMLVideoElement, Flaeche>();
  // Videos, deren Bild nicht kam oder nicht geladen werden konnte, mit dem Stand, bei dem das passierte: erst ein anderer Stand versucht es neu.
  private readonly gescheitert = new WeakMap<HTMLVideoElement, string>();
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
  setze(ziele: ReadonlyMap<HTMLVideoElement, Element>, stufe: StufeWahl, packStand: number): void {
    for (const v of [...this.flaechen.keys()]) if (!ziele.has(v) || !v.isConnected) this.entferne(v);
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
        for (const [v, f] of this.flaechen) this.lege(v, f);
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
    if (this.gescheitert.get(v) === kennung) return;
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
    const wurzel = host.attachShadow({ mode: 'closed' });
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
    wurzel.append(bild);
    const f: Flaeche = { host, bild, blatt, stil, beob: null, stand: '', generation: this.naechsteGeneration++, deckt, zuletztZ: Number.NaN };
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

  // z-index des Hosts: um eins ueber dem hoechsten numerischen z-index von Video und (beim Anker) den positionierten Nachfahren des Ankers, damit
  // weder ein Video mit eigenem z-index noch eine Poster-Ebene des Players darueber malt. Ein Video ohne z-index ergibt 0.
  private zFuer(v: HTMLVideoElement, f: Flaeche): number {
    let z = 0;
    const lies = (el: Element): void => {
      try {
        const n = parseInt(getComputedStyle(el).zIndex, 10);
        if (Number.isFinite(n) && n > z) z = n;
      } catch {
        // Element weg
      }
    };
    lies(v);
    if (f.deckt !== v) {
      // Nur Nachfahren, deren Rechteck die Videoflaeche schneidet (Poster-Ebenen, Huellen): Bedienleisten daneben und Teile der Seite zaehlen nicht.
      let vr: DOMRect;
      try {
        vr = v.getBoundingClientRect();
      } catch {
        return Math.min(z + 1, Z_DECKEL);
      }
      let i = 0;
      for (const el of f.deckt.querySelectorAll('*')) {
        if (el === f.host || el === v) continue;
        if (++i > 400) break;
        const r = el.getBoundingClientRect();
        if (r.right <= vr.left || r.left >= vr.right || r.bottom <= vr.top || r.top >= vr.bottom) continue;
        lies(el);
      }
      // Auch Vorfahren des Videos bis zum Anker (positionierte Huellen mit z-index).
      for (let p: Element | null = v.parentElement; p && p !== f.deckt; p = p.parentElement) lies(p);
    }
    return Math.min(z + 1, Z_DECKEL);
  }

  // Legt den Host auf die Flaeche des Videos (getBoundingClientRect, damit Transform, translate(-50%), Skalierung und fixed stimmen): der
  // Bezugspunkt des Hosts wird gemessen, indem er mit bekannter Groesse auf 0/0 liegt. Stimmt die Lage schon, kostet es nur zwei Messungen.
  private lege(v: HTMLVideoElement, f: Flaeche, zwingen = false): void {
    if (!v.isConnected || !f.deckt.isConnected) return;
    // Gedeckt wird nur die Videoflaeche (Bedienleisten und Knoepfe daneben im Anker bleiben sichtbar); der Host steht im Anker, damit sein
    // z-index ueber dessen Poster-Ebenen liegt (K2, zweite Lesung, Fund 1).
    const t = v.getBoundingClientRect();
    if (!(t.width > 0 && t.height > 0)) return;
    const s = f.host.style;
    const h = f.host.getBoundingClientRect();
    const nah = (a: number, b: number) => Math.abs(a - b) < 0.5;
    if (!zwingen && nah(t.left, h.left) && nah(t.top, h.top) && nah(t.width, h.width) && nah(t.height, h.height)) return;
    // Im Anker (positioniert, auch fest oder klebend) ist der Anker der Bezug: absolute. Als Geschwister eines festen Videos: fixed.
    // Klebende Videos folgen ueber den Rollen-Horcher.
    let fest = false;
    if (f.deckt === v) {
      try {
        fest = getComputedStyle(v).position === 'fixed';
      } catch {
        fest = false;
      }
    }
    s.setProperty('position', fest ? 'fixed' : 'absolute', 'important');
    s.setProperty('left', '0', 'important');
    s.setProperty('top', '0', 'important');
    s.setProperty('width', '100px', 'important');
    s.setProperty('height', '100px', 'important');
    const m = f.host.getBoundingClientRect();
    const sx = m.width > 0 ? m.width / 100 : 1;
    const sy = m.height > 0 ? m.height / 100 : 1;
    s.setProperty('left', `${(t.left - m.left) / sx}px`, 'important');
    s.setProperty('top', `${(t.top - m.top) / sy}px`, 'important');
    s.setProperty('width', `${t.width / sx}px`, 'important');
    s.setProperty('height', `${t.height / sy}px`, 'important');
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
    this.entferne(v);
    this.pflegeTakt();
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
