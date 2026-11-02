// Rendern der Zensur auf einem OffscreenCanvas: Pixel-Mosaik oder Blur, Ausgabe als JPEG-Data-URL.

import type { Stil } from '../einstellungen';
import type { Box, Flaeche } from '../nachrichten';

const JPEG_QUALITAET = 0.85;
const MOSAIK_ANTEIL = 0.1;
const MOSAIK_MINDEST = 4;
const BLUR_ANTEIL = 0.35;

type Kontext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function neueLeinwand(b: number, h: number): { leinwand: OffscreenCanvas; ctx: Kontext } {
  const leinwand = new OffscreenCanvas(Math.max(1, Math.round(b)), Math.max(1, Math.round(h)));
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error('kein 2D-Kontext');
  return { leinwand, ctx };
}

// Zielleinwand fuer das fertige Bild: wo es ein Dokument gibt (Offscreen-Dokument, Firefox-Hintergrundseite), eine HTML-Leinwand.
function neueZielLeinwand(b: number, h: number): { leinwand: OffscreenCanvas | HTMLCanvasElement; ctx: Kontext } {
  if (typeof document === 'undefined') return neueLeinwand(b, h);
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.max(1, Math.round(b));
  leinwand.height = Math.max(1, Math.round(h));
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error('kein 2D-Kontext');
  return { leinwand, ctx };
}

// Beschneidet `quelle` auf (x, y, w, h) und verkleinert in Halbierungsschritten auf zb x zh (mittelt sauber, auch bei grossem Faktor).
function verkleinere(quelle: CanvasImageSource, x: number, y: number, w: number, h: number, zb: number, zh: number): OffscreenCanvas {
  let { leinwand: aktuell, ctx } = neueLeinwand(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(quelle, x, y, w, h, 0, 0, aktuell.width, aktuell.height);
  while (aktuell.width / 2 >= zb && aktuell.height / 2 >= zh) {
    const naechste = neueLeinwand(Math.ceil(aktuell.width / 2), Math.ceil(aktuell.height / 2));
    naechste.ctx.imageSmoothingQuality = 'high';
    naechste.ctx.drawImage(aktuell, 0, 0, aktuell.width, aktuell.height, 0, 0, naechste.leinwand.width, naechste.leinwand.height);
    aktuell = naechste.leinwand;
  }
  const ziel = neueLeinwand(zb, zh);
  ziel.ctx.imageSmoothingQuality = 'high';
  ziel.ctx.drawImage(aktuell, 0, 0, aktuell.width, aktuell.height, 0, 0, zb, zh);
  return ziel.leinwand;
}

function zeichneMosaik(ctx: Kontext, quelle: CanvasImageSource, box: Box): void {
  const [x, y, w, h] = box;
  const block = Math.max(MOSAIK_MINDEST, Math.round(h * MOSAIK_ANTEIL));
  const kb = Math.max(1, Math.ceil(w / block));
  const kh = Math.max(1, Math.ceil(h / block));
  const klein = verkleinere(quelle, x, y, w, h, kb, kh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(klein, 0, 0, kb, kh, x, y, kb * block, kh * block);
  ctx.restore();
}

// Kann der 2D-Kontext `filter`? (Rueckfall auf Mosaik, wenn nicht.)
function kannFilter(ctx: Kontext): boolean {
  if (!('filter' in ctx)) return false;
  ctx.filter = 'blur(1px)';
  const ok = ctx.filter === 'blur(1px)';
  ctx.filter = 'none';
  return ok;
}

function zeichneBlur(ctx: Kontext, quelle: CanvasImageSource, box: Box, bildB: number, bildH: number): void {
  const [x, y, w, h] = box;
  const r = Math.max(2, Math.round(BLUR_ANTEIL * Math.min(w, h)));
  // Mittelfarbe als Untergrund: an den Raendern der Flaeche und des Bildes darf der Blur nie das Original durchscheinen lassen.
  const mittel = verkleinere(quelle, x, y, w, h, 1, 1).getContext('2d')?.getImageData(0, 0, 1, 1).data;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = mittel ? `rgb(${mittel[0]},${mittel[1]},${mittel[2]})` : 'rgb(128,128,128)';
  ctx.fillRect(x, y, w, h);
  ctx.filter = `blur(${r}px)`;
  // Quellbereich um die Flaeche erweitern, damit der Blur Nachbarpixel mittelt.
  const pad = r * 2;
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sb = Math.min(bildB, x + w + pad) - sx;
  const sh = Math.min(bildH, y + h + pad) - sy;
  ctx.drawImage(quelle, sx, sy, sb, sh, sx, sy, sb, sh);
  ctx.restore();
}

function alsDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, fehl) => {
    const leser = new FileReader();
    leser.onload = () => ok(String(leser.result));
    leser.onerror = () => fehl(leser.error ?? new Error('Lesefehler'));
    leser.readAsDataURL(blob);
  });
}

// Zeichnet das Bild in Zielgroesse, legt die Zensur auf alle Flaechen und liefert ein JPEG als Data-URL.
export async function rendereZensur(
  quelle: CanvasImageSource,
  breite: number,
  hoehe: number,
  flaechen: readonly Flaeche[],
  stil: Stil,
): Promise<string> {
  const { leinwand, ctx } = neueZielLeinwand(breite, hoehe);
  ctx.drawImage(quelle, 0, 0, leinwand.width, leinwand.height);
  const blurOk = stil === 'blur' && kannFilter(ctx);
  for (const f of flaechen) {
    if (blurOk) zeichneBlur(ctx, quelle, f.box, leinwand.width, leinwand.height);
    else zeichneMosaik(ctx, quelle, f.box);
  }
  // Auf einer HTML-Leinwand kodiert toDataURL sofort. OffscreenCanvas.convertToBlob wartet in versteckten Dokumenten
  // (Offscreen-Dokument) auf gedrosselte Aufgaben und brauchte dort rund eine Sekunde.
  if (leinwand instanceof OffscreenCanvas) {
    return alsDataUrl(await leinwand.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITAET }));
  }
  return leinwand.toDataURL('image/jpeg', JPEG_QUALITAET);
}
