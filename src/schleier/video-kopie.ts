// Kopie des geprueften Standbilds eines pausierten Videos (Phase 11, E3c Runde 1, Regel K). Das Video selbst wird in der Pause nie frei: sein Urteil bleibt `verdeckt`.
// Gezeigt wird stattdessen eine Kopie genau des Bilds, das dreimal sauber geprueft wurde: ein eigener Host mit geschlossener Shadow Root direkt hinter dem Video (gebaut und
// gelegt wie die Zonen-Leinwand, `video-leinwand.ts`), darin eine Leinwand mit dem EINMAL gemalten Bild. Keine Schleife je Bild, keine Erkennung ueber die Kopie.
// Reihenfolge (K3): malen (der Host ist dabei unsichtbar), der Aufrufer prueft den Daumen der Kopie und den Stand des Videos, erst dann `zeige()`: Host sichtbar und das
// Video per Attribut unsichtbar (style.css). Faellt die Kopie weg (Seite entfernt Host oder Attribut), steht das Video weichgezeichnet da: nie etwas Scharfes.
// Dieses Modul kennt weder den Takt (video.ts) noch den Erkenner.

import { eigeneWurzel } from './eigene';
import { ATTR_KOPIE, ATTR_VIDEO_STANDBILD, ATTR_VIDEO_STANDBILD_MS, VIDEO_ZONEN_DAUMEN_B, VIDEO_ZONEN_DAUMEN_H, VIDEO_ZONEN_GRAU_B, VIDEO_ZONEN_LEINWAND_MAX_SEITE } from './konstanten';
import { daumenAusGrau, GrauLeser } from './daumen';
import { istFestPositioniert, legeAufRechteck, zIndexFuerLeinwand } from './lage';
import { lagewecker, merkeEigenenHost, schattenWurzelnVon } from './lagewecker-seite';
import { beendePip, sperrePip } from './pip-sperre';
import { testhakenAktiv } from './status';
import { inhaltsRechteck, istObjektPassung, parsePosition } from './video-zonen';

const PIP_HALTER = 'kopie';

interface Masse {
  rect: DOMRect;
  inhalt: { x: number; y: number; w: number; h: number };
  flipX: boolean;
  flipY: boolean;
  untergrund: string | null;
}

export interface KopieHaken {
  // Der Schleier lebt und ist an.
  lebt(): boolean;
  // Lage oder Groesse des Videos haben sich geaendert: die Kopie gilt nicht mehr (der Aufrufer nimmt sie weg).
  beiAenderung(): void;
}

export class VideoKopie {
  private readonly el: HTMLVideoElement;
  private readonly host: HTMLElement;
  private readonly leinwand: HTMLCanvasElement;
  private readonly haken: KopieHaken;
  private readonly rect: DOMRect;
  private readonly kopieDaumen: Float32Array | null;
  private readonly testAn = !!ATTR_VIDEO_STANDBILD && testhakenAktiv();
  private gezeigt = false;
  private malText = '';
  private tot = false;
  private beob: ResizeObserver | null = null;
  private weckerAb: (() => void) | null = null;
  private zuletztZ = '';

  // Malt die Kopie (Host unsichtbar) und liest ihren Daumen. null = nicht moeglich (keine Flaeche, Leinwand nicht lesbar, Fehler): dann gibt es keine Kopie.
  static male(el: HTMLVideoElement, haken: KopieHaken): VideoKopie | null {
    try {
      return new VideoKopie(el, haken);
    } catch {
      return null;
    }
  }

  private constructor(el: HTMLVideoElement, haken: KopieHaken) {
    this.el = el;
    this.haken = haken;
    const t0 = performance.now();
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0) || !(el.videoWidth > 0) || !(el.videoHeight > 0)) throw new Error('keine Flaeche');
    const eltern = el.parentNode;
    if (!eltern) throw new Error('kein Elternknoten');
    this.rect = rect;
    const host = document.createElement('div');
    this.host = host;
    merkeEigenenHost(host);
    const s = host.style;
    for (const [n, w] of [
      ['all', 'initial'],
      ['position', 'absolute'],
      ['display', 'block'],
      ['margin', '0'],
      ['padding', '0'],
      ['border', '0'],
      ['overflow', 'hidden'],
      ['background', 'transparent'],
      ['pointer-events', 'none'],
      ['visibility', 'hidden'],
      ['opacity', '1'],
      ['box-sizing', 'border-box'],
      ['left', '0'],
      ['top', '0'],
    ] as const) s.setProperty(n, w, 'important');
    const wurzel = eigeneWurzel(host);
    const c = document.createElement('canvas');
    c.style.setProperty('display', 'block', 'important');
    c.style.setProperty('width', '100%', 'important');
    c.style.setProperty('height', '100%', 'important');
    wurzel.append(c);
    this.leinwand = c;
    const ctx = c.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('kein 2D-Kontext');
    const m = this.berechneMasse(rect);
    if (!m) throw new Error('keine Masse');
    // Malen: das gezeigte Bild des Videos (Inhaltsbereich, Spiegelung, Hintergrund des Elements), genau einmal. Der Daumen der Kopie wird aus diesen Bildpunkten gelesen.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (m.untergrund) {
      ctx.fillStyle = m.untergrund;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    const r = m.inhalt;
    ctx.save();
    if (m.flipX || m.flipY) {
      ctx.translate(m.flipX ? r.x * 2 + r.w : 0, m.flipY ? r.y * 2 + r.h : 0);
      ctx.scale(m.flipX ? -1 : 1, m.flipY ? -1 : 1);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(el, r.x, r.y, r.w, r.h);
    ctx.restore();
    const g = new GrauLeser(VIDEO_ZONEN_GRAU_B).liesLeinwand(c, r, m.flipX, m.flipY, el.videoWidth, el.videoHeight);
    this.kopieDaumen = g ? daumenAusGrau(g, VIDEO_ZONEN_DAUMEN_B, VIDEO_ZONEN_DAUMEN_H) : null;
    if (this.testAn) this.malText = JSON.stringify({ ms: Math.round((performance.now() - t0) * 100) / 100, b: c.width, h: c.height, bytes: c.width * c.height * 4 });
    // Host direkt hinter das Video (unsichtbar), Lage wie bei der Zonen-Leinwand.
    eltern.insertBefore(host, el.nextSibling);
    this.setzeZ();
    legeAufRechteck(host, rect, istFestPositioniert(el), true);
    try {
      this.beob = new ResizeObserver(() => this.lageNachLayout());
      this.beob.observe(el);
    } catch {
      this.beob = null;
    }
    this.weckerAb = lagewecker().melde(
      {
        lebt: () => !this.tot && this.haken.lebt(),
        jeBild: () => {
          if (this.beob) {
            this.beob.unobserve(el);
            this.beob.observe(el);
          } else this.lageNachLayout();
        },
      },
      schattenWurzelnVon(el),
    );
  }

  // Die Masse wie in der Zonen-Leinwand (berechneMasse), Leinwandgroesse hoechstens CSS-Groesse mal Geraete-Pixel (K7), hoechstens Videoaufloesung und 1920.
  private berechneMasse(rect: DOMRect): Masse | null {
    const el = this.el;
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el);
    } catch {
      return null;
    }
    const num = (s: string): number => Number.parseFloat(s) || 0;
    const offB = el.offsetWidth > 0 ? el.offsetWidth : rect.width;
    const offH = el.offsetHeight > 0 ? el.offsetHeight : rect.height;
    const sx = rect.width / offB;
    const sy = rect.height / offH;
    const padL = num(cs.paddingLeft);
    const padR = num(cs.paddingRight);
    const padT = num(cs.paddingTop);
    const padB = num(cs.paddingBottom);
    const innenB = Math.max(1, el.clientWidth - padL - padR);
    const innenH = Math.max(1, el.clientHeight - padT - padB);
    const passung = istObjektPassung(cs.objectFit) ? cs.objectFit : 'contain';
    const ir = inhaltsRechteck(innenB, innenH, el.videoWidth, el.videoHeight, passung, parsePosition(cs.objectPosition));
    const cssB = rect.width;
    const cssH = rect.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const grenzeSeite = VIDEO_ZONEN_LEINWAND_MAX_SEITE / Math.max(cssB, cssH);
    const grenzeVideo = el.videoWidth / Math.max(1, ir.w * sx);
    const q = Math.max(0.05, Math.min(dpr, grenzeSeite, grenzeVideo));
    this.leinwand.width = Math.max(1, Math.round(cssB * q));
    this.leinwand.height = Math.max(1, Math.round(cssH * q));
    const ox = (el.clientLeft + padL + ir.x) * sx * q;
    const oy = (el.clientTop + padT + ir.y) * sy * q;
    let flipX = false;
    let flipY = false;
    const tm = /^matrix\(([^)]*)\)$/.exec(cs.transform.trim());
    if (tm) {
      const w = tm[1]!.split(',').map((x) => Number(x));
      flipX = (w[0] ?? 1) < 0;
      flipY = (w[3] ?? 1) < 0;
    }
    const bg = cs.backgroundColor;
    const untergrund = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : null;
    return { rect, inhalt: { x: ox, y: oy, w: ir.w * sx * q, h: ir.h * sy * q }, flipX, flipY, untergrund };
  }

  // Daumen des gemalten Bilds (null = nicht lesbar).
  daumen(): Float32Array | null {
    return this.kopieDaumen;
  }

  // Alles an seinem Platz? Host hinter dem Video im selben Elternknoten, Attribut am Video, wenn gezeigt wird.
  intakt(): boolean {
    if (this.tot || !this.el.isConnected || !this.host.isConnected) return false;
    if (this.host.parentNode !== this.el.parentNode || this.host.previousSibling !== this.el) return false;
    if (this.gezeigt && !this.el.hasAttribute(ATTR_KOPIE)) return false;
    return true;
  }

  // Lage pflegen (Takt der Nachschau); false = die Groesse des Videos hat sich geaendert, die Kopie gilt nicht mehr.
  pflege(): boolean {
    if (this.tot) return false;
    this.setzeZ();
    const r = this.el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    if (Math.abs(r.width - this.rect.width) >= 0.5 || Math.abs(r.height - this.rect.height) >= 0.5) return false;
    legeAufRechteck(this.host, r, istFestPositioniert(this.el));
    return true;
  }

  private lageNachLayout(): void {
    if (this.tot || document.hidden || !this.el.isConnected) return;
    if (!this.pflege()) this.haken.beiAenderung();
  }

  private setzeZ(): void {
    const z = zIndexFuerLeinwand(this.el);
    if (z === this.zuletztZ) return;
    this.zuletztZ = z;
    if (z === 'auto') this.host.style.removeProperty('z-index');
    else this.host.style.setProperty('z-index', z, 'important');
  }

  // Zeigen: Host sichtbar, im selben Augenblick das Video unsichtbar. Bild-in-Bild des Videos ist gesperrt (dort laege das echte Bild offen).
  zeige(): void {
    if (this.tot || this.gezeigt) return;
    this.gezeigt = true;
    sperrePip(this.el, true, PIP_HALTER);
    beendePip(this.el);
    this.host.style.setProperty('visibility', 'visible', 'important');
    this.el.setAttribute(ATTR_KOPIE, '');
    if (this.testAn) {
      this.el.setAttribute(ATTR_VIDEO_STANDBILD_MS, this.malText);
      this.el.setAttribute(ATTR_VIDEO_STANDBILD, 'kopie');
    }
  }

  // Weg: sofort, ohne Bremse. Das Video steht danach weichgezeichnet da (sein Urteil blieb `verdeckt`).
  entferne(): void {
    if (this.tot) return;
    this.tot = true;
    this.gezeigt = false;
    this.weckerAb?.();
    this.weckerAb = null;
    try {
      this.beob?.disconnect();
    } catch {
      // egal
    }
    this.beob = null;
    this.host.remove();
    this.el.removeAttribute(ATTR_KOPIE);
    if (ATTR_VIDEO_STANDBILD) this.el.removeAttribute(ATTR_VIDEO_STANDBILD);
    if (ATTR_VIDEO_STANDBILD_MS) this.el.removeAttribute(ATTR_VIDEO_STANDBILD_MS);
    sperrePip(this.el, false, PIP_HALTER);
  }
}
