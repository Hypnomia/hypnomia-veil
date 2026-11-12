// Zeichnen der Zensur auf der Zonen-Leinwand eines Videos (Bauplan Video-Zonen, Auftrag V4, Presets Auftrag 4). Je gezeigtem Bild werden die Flaechen auf die
// schon gemalte Leinwand gelegt, je Flaeche nach ihrer Zeichenart (= Behandlung des Presets, src/presets.ts; die Abbildung steht in video-zonen.ts
// `stilFuerZone`): Mosaik mit pinkem Rahmen, Blur, Schwarz oder Balken (deckend, ohne Rahmen), Wort auf Mosaik oder Schwarz, Mias Gesicht mit pinkem Rahmen.
// Wort und Mias Gesicht zeichnen dieselben Funktionen wie bei Bildern (src/erkenner/stile.ts). Hilfsleinwaende werden wiederverwendet (anders als dort,
// wo je Aufruf neue entstehen). Alle Rechtecke in Bildpunkten der Leinwand.

import { RAHMEN_FARBE, rahmenBreite, zeichneGesicht, zeichneSticker, zeichneWort } from '../erkenner/stile';
import { seitenFamilie } from '../oberflaeche/design/familie';
import { stickerFarbe } from '../sticker';
import type { Zeichenart } from './video-zonen';

const MOSAIK_ANTEIL = 0.1;
const MOSAIK_MINDEST = 4;
const BLUR_TEILER = 12;

// Hilfsmittel einer Flaeche: Mias Gesicht (Bild des Packs und Ausschnitt darin) und das Wort.
export interface FlaechenMittel {
  // Zeichenart, wenn Mias Gesicht nicht gezeichnet werden kann (stilFuerZone mit gesichtPasst=false: Koerper-Behandlung, ohne Wort, wo keins da ist); nie mia-gesicht.
  ersatz?: Zeichenart;
  gesicht: { bild: CanvasImageSource; ausschnitt: [number, number, number, number] } | null;
  wort: string;
  // Sticker-Zensur: Pastellfarbe der Flaeche (stabil je Motiv, src/sticker.ts stickerFarbe), der Sticker (null, solange er laedt oder fehlt: die Flaeche
  // steht dann ohne Sticker) und die Anzeigegroesse (CSS-Pixel je Leinwandpunkt, fuer stickerPasst).
  sticker?: { farbe: string; bild: CanvasImageSource | null; anzeige: number };
}

export interface ZeichenRechteck {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ctx = CanvasRenderingContext2D;

function neueKleine(b: number, h: number): { leinwand: HTMLCanvasElement; ctx: Ctx } {
  const leinwand = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
  leinwand.width = Math.max(1, Math.round(b));
  leinwand.height = Math.max(1, Math.round(h));
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error('kein 2D-Kontext');
  return { leinwand, ctx };
}

export class Zeichner {
  // Hilfsleinwaende: zwei zum schrittweisen Halbieren (mittelt sauber, ein einzelnes Verkleinern um den Faktor 10 oder mehr tastet nur ab).
  private arbeit: Array<{ leinwand: HTMLCanvasElement; ctx: Ctx } | null> = [null, null];

  private holeArbeit(i: number, b: number, h: number): { leinwand: HTMLCanvasElement; ctx: Ctx } {
    const k = this.arbeit[i];
    if (k && k.leinwand.width >= b && k.leinwand.height >= h) return k;
    const neu = neueKleine(Math.max(b, k?.leinwand.width ?? 0, 16), Math.max(h, k?.leinwand.height ?? 0, 16));
    this.arbeit[i] = neu;
    return neu;
  }

  // Begrenzt ein Rechteck auf die Leinwand und rundet auf ganze Bildpunkte nach aussen. null, wenn nichts bleibt.
  static begrenze(r: ZeichenRechteck, b: number, h: number): ZeichenRechteck | null {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(b, Math.ceil(r.x + r.w));
    const y1 = Math.min(h, Math.ceil(r.y + r.h));
    return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // Bereich der Leinwand auf kb x kh verkleinern, in Halbierungsschritten (jeder Schritt mittelt 2 x 2 Bildpunkte). Liefert die Hilfsleinwand,
  // in deren oberer linker Ecke das kleine Bild steht.
  private verkleinere(ctx: Ctx, r: ZeichenRechteck, kb: number, kh: number): HTMLCanvasElement {
    let quelle: HTMLCanvasElement = ctx.canvas;
    let sx = r.x;
    let sy = r.y;
    let sb = r.w;
    let sh = r.h;
    let i = 0;
    while (sb / 2 >= kb && sh / 2 >= kh) {
      const nb = Math.ceil(sb / 2);
      const nh = Math.ceil(sh / 2);
      const ziel = this.holeArbeit(i, nb, nh);
      ziel.ctx.imageSmoothingEnabled = true;
      ziel.ctx.imageSmoothingQuality = 'low';
      ziel.ctx.clearRect(0, 0, nb, nh);
      ziel.ctx.drawImage(quelle, sx, sy, sb, sh, 0, 0, nb, nh);
      quelle = ziel.leinwand;
      sx = 0;
      sy = 0;
      sb = nb;
      sh = nh;
      i ^= 1;
    }
    const ziel = this.holeArbeit(i, kb, kh);
    ziel.ctx.imageSmoothingEnabled = true;
    ziel.ctx.imageSmoothingQuality = 'low';
    ziel.ctx.clearRect(0, 0, kb, kh);
    ziel.ctx.drawImage(quelle, sx, sy, sb, sh, 0, 0, kb, kh);
    return ziel.leinwand;
  }

  // Mosaik: Bereich verkleinern und ohne Glaettung vergroessert zurueckmalen. Block = round(0,1 * Hoehe), mindestens 4.
  mosaik(ctx: Ctx, r: ZeichenRechteck): void {
    const block = Math.max(MOSAIK_MINDEST, Math.round(r.h * MOSAIK_ANTEIL));
    const kb = Math.max(1, Math.ceil(r.w / block));
    const kh = Math.max(1, Math.ceil(r.h / block));
    const klein = this.verkleinere(ctx, r, kb, kh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(klein, 0, 0, kb, kh, r.x, r.y, kb * block, kh * block);
    ctx.restore();
  }

  // Blur durch Verkleinern auf 1/12 und Vergroessern mit Glaettung (kein ctx.filter, das waere in Firefox und auf manchen Geraeten langsam).
  blur(ctx: Ctx, r: ZeichenRechteck): void {
    const kb = Math.max(2, Math.ceil(r.w / BLUR_TEILER));
    const kh = Math.max(2, Math.ceil(r.h / BLUR_TEILER));
    const klein = this.verkleinere(ctx, r, kb, kh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(klein, 0, 0, kb, kh, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // Schwarzer Balken ohne Rahmen (Behandlungen schwarz, schwarz-wort und balken).
  balken(ctx: Ctx, r: ZeichenRechteck): void {
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // Pinker Rahmen wie bei Bildern (Breite aus rahmenBreite, innerhalb der Flaeche).
  rahmen(ctx: Ctx, r: ZeichenRechteck): void {
    const b = rahmenBreite(r.w, r.h);
    ctx.save();
    ctx.fillStyle = RAHMEN_FARBE;
    ctx.fillRect(r.x, r.y, r.w, b);
    ctx.fillRect(r.x, r.y + r.h - b, r.w, b);
    ctx.fillRect(r.x, r.y + b, b, r.h - 2 * b);
    ctx.fillRect(r.x + r.w - b, r.y + b, b, r.h - 2 * b);
    ctx.restore();
  }

  // Eine Flaeche nach ihrer Zeichenart (Rahmen wie bei Bildern: Mosaik und Mias Gesicht ja, Blur, Schwarz und Balken nein).
  flaeche(ctx: Ctx, r: ZeichenRechteck, art: Zeichenart, mittel: FlaechenMittel): void {
    switch (art) {
      case 'schwarz':
      case 'balken':
        return this.balken(ctx, r);
      case 'schwarz-wort':
        this.balken(ctx, r);
        zeichneWort(ctx, mittel.wort, [r.x, r.y, r.w, r.h], false, seitenFamilie('VEIL Rounded'));
        return;
      case 'blur':
        this.blur(ctx, r);
        return;
      case 'mosaik-wort':
        this.mosaik(ctx, r);
        this.rahmen(ctx, r);
        zeichneWort(ctx, mittel.wort, [r.x, r.y, r.w, r.h], true, seitenFamilie('VEIL Rounded'));
        return;
      case 'sticker':
        // Flaeche und Rahmen sofort und ohne Abhaengigkeit vom Sticker (S1, S2); fehlt `sticker`, gilt ein fester Pastellton.
        zeichneSticker(ctx, [r.x, r.y, r.w, r.h], mittel.sticker?.farbe ?? stickerFarbe(''), mittel.sticker?.bild ?? null, mittel.sticker?.anzeige ?? 1);
        return;
      case 'mia-gesicht':
        // Kann das Gesicht nicht gezeichnet werden (leeres oder geschlossenes Bild), gilt die Ersatz-Behandlung der Flaeche: nie ein offenes Gesicht, nie leer.
        if (mittel.gesicht && zeichneGesicht(ctx, { box: [r.x, r.y, r.w, r.h] }, mittel.gesicht.bild, mittel.gesicht.ausschnitt)) return;
        if (mittel.ersatz && mittel.ersatz !== 'mia-gesicht') return this.flaeche(ctx, r, mittel.ersatz, { ...mittel, gesicht: null, ersatz: undefined });
        break;
      default:
    }
    this.mosaik(ctx, r);
    this.rahmen(ctx, r);
  }

  // Ganzes Bild kurz Mosaik (Schnitt, Sprung, altes Urteil), unabhaengig vom gewaehlten Stil, ohne Rahmen.
  ganz(ctx: Ctx, r: ZeichenRechteck): void {
    this.mosaik(ctx, r);
  }
}
