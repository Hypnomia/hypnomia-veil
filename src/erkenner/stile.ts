// Rendern der Zensur auf einem OffscreenCanvas: Pixel-Mosaik (mit pinkem Rahmen), Blur oder Mia-Patch (Bild aus dem Mia Pack, mit
// pinkem Rahmen), Ausgabe als JPEG-Data-URL.

import type { Stil } from '../einstellungen';
import type { Box, Flaeche } from '../nachrichten';

const JPEG_QUALITAET = 0.85;
const MOSAIK_ANTEIL = 0.1;
const MOSAIK_MINDEST = 4;
const BLUR_ANTEIL = 0.35;
// Pinker Rahmen (Entscheidung 73, PHASE-2-BAUPLAN 9.4): Breite max(2, round(0,03 * kleinere Seite)), hoechstens 10 px, innerhalb der Flaeche.
export const RAHMEN_FARBE = '#ff4fa3';
const RAHMEN_ANTEIL = 0.03;
const RAHMEN_MINDEST = 2;
const RAHMEN_HOECHSTENS = 10;

export function rahmenBreite(w: number, h: number): number {
  const b = Math.min(RAHMEN_HOECHSTENS, Math.max(RAHMEN_MINDEST, Math.round(RAHMEN_ANTEIL * Math.min(w, h))));
  // Bei winzigen Flaechen nie mehr als die halbe Seite, damit der Rahmen die Flaeche nicht ganz fuellt.
  return Math.min(b, Math.max(1, Math.floor(Math.min(w, h) / 2)));
}

function zeichneRahmen(ctx: Kontext, box: Box): void {
  const [x, y, w, h] = box;
  const b = rahmenBreite(w, h);
  ctx.save();
  ctx.fillStyle = RAHMEN_FARBE;
  ctx.fillRect(x, y, w, b); // oben
  ctx.fillRect(x, y + h - b, w, b); // unten
  ctx.fillRect(x, y + b, b, h - 2 * b); // links
  ctx.fillRect(x + w - b, y + b, b, h - 2 * b); // rechts
  ctx.restore();
}

// Breite und Hoehe eines Patch-Bildes (ImageBitmap, OffscreenCanvas, HTML-Leinwand).
function bildMass(q: CanvasImageSource): { b: number; h: number } {
  const o = q as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return { b: o.naturalWidth ?? o.width ?? 0, h: o.naturalHeight ?? o.height ?? 0 };
}

// Patch formatfuellend einpassen (zentriert beschnitten), auf die Flaeche begrenzt. false, wenn das Bild nicht zu zeichnen ist
// (leer oder inzwischen geschlossen): der Aufrufer faellt dann auf Mosaik zurueck.
function zeichnePatch(ctx: Kontext, patch: CanvasImageSource, box: Box): boolean {
  const [x, y, w, h] = box;
  const { b: sb, h: sh } = bildMass(patch);
  if (sb <= 0 || sh <= 0 || w <= 0 || h <= 0) return false;
  const skala = Math.max(w / sb, h / sh);
  const cb = w / skala;
  const ch = h / skala;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(patch, (sb - cb) / 2, (sh - ch) / 2, cb, ch, x, y, w, h);
    return true;
  } catch {
    // Geschlossenes oder sonst unzeichenbares Bitmap (InvalidStateError): nichts wurde gezeichnet.
    return false;
  } finally {
    ctx.restore();
  }
}

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
  zeichneRahmen(ctx, box);
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
// `patches`: je Flaeche das Patch-Bild fuer den Stil Mia-Patch (gleiche Reihenfolge wie `flaechen`); fehlt eins, wird diese Flaeche Mosaik.
export async function rendereZensur(
  quelle: CanvasImageSource,
  breite: number,
  hoehe: number,
  flaechen: readonly Flaeche[],
  stil: Stil,
  patches?: readonly (CanvasImageSource | null)[],
): Promise<string> {
  const { leinwand, ctx } = neueZielLeinwand(breite, hoehe);
  ctx.drawImage(quelle, 0, 0, leinwand.width, leinwand.height);
  const blurOk = stil === 'blur' && kannFilter(ctx);
  flaechen.forEach((f, i) => {
    const patch = stil === 'mia-patch' ? patches?.[i] : null;
    if (patch && zeichnePatch(ctx, patch, f.box)) zeichneRahmen(ctx, f.box);
    else if (blurOk) zeichneBlur(ctx, quelle, f.box, leinwand.width, leinwand.height);
    else zeichneMosaik(ctx, quelle, f.box);
  });
  // Auf einer HTML-Leinwand kodiert toDataURL sofort. OffscreenCanvas.convertToBlob wartet in versteckten Dokumenten
  // (Offscreen-Dokument) auf gedrosselte Aufgaben und brauchte dort rund eine Sekunde.
  if (leinwand instanceof OffscreenCanvas) {
    return alsDataUrl(await leinwand.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITAET }));
  }
  return leinwand.toDataURL('image/jpeg', JPEG_QUALITAET);
}
