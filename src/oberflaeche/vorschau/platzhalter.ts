// Platzhalter der Schau gesperrter Stile (Phase 11 E6b, B8 b): im Code gemalt, kein Bild aus dem Pack, kein Foto, kein Text im Bild. Mias Gesicht wird eine deckende Flaeche in
// Markenfarbe mit einfacher Strichzeichnung (Augen und Mund), ein Sticker ein Herz wie im Kartenbild. Beide laufen durch denselben Zeichner wie die echten Bilder
// (`rendereZensur`), sie decken also genau die Flaeche, die Mias Gesicht oder der Sticker decken wuerden. Farben nur aus werte.ts.
import { FARBEN } from '../design/werte';

export const PLATZHALTER_GESICHT_B = 300;
export const PLATZHALTER_GESICHT_H = 400; // 3:4, wie ein Patch-Bild von Mias Gesicht

function leinwand(b: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = b;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Keine Leinwand');
  return { c, ctx };
}

// Deckende Flaeche in Markenfarbe mit einer einfachen Strichzeichnung eines Gesichts (zwei Augen, ein Lächeln), nichts Lesbares.
export function malePlatzhalterGesicht(): HTMLCanvasElement {
  const { c, ctx } = leinwand(PLATZHALTER_GESICHT_B, PLATZHALTER_GESICHT_H);
  ctx.fillStyle = FARBEN['rosa-500'];
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = FARBEN.weiss;
  for (const x of [0.34, 0.66]) {
    ctx.beginPath();
    ctx.arc(c.width * x, c.height * 0.42, c.width * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = FARBEN.weiss;
  ctx.lineWidth = c.width * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c.width * 0.32, c.height * 0.62);
  ctx.quadraticCurveTo(c.width * 0.5, c.height * 0.74, c.width * 0.68, c.height * 0.62);
  ctx.stroke();
  return c;
}

// Ein Herz auf durchsichtigem Grund, mittig; `zeichneSticker` setzt es auf die Pastell-Flaeche (wie das Herz der Kartenbilder).
export function maleHerz(): HTMLCanvasElement {
  const g = 256;
  const { c, ctx } = leinwand(g, g);
  const cx = g / 2;
  const cy = g / 2;
  const k = g * 0.8;
  ctx.beginPath();
  ctx.moveTo(cx, cy + k * 0.42);
  ctx.bezierCurveTo(cx - k * 0.75, cy - k * 0.1, cx - k * 0.45, cy - k * 0.55, cx, cy - k * 0.2);
  ctx.bezierCurveTo(cx + k * 0.45, cy - k * 0.55, cx + k * 0.75, cy - k * 0.1, cx, cy + k * 0.42);
  ctx.closePath();
  ctx.fillStyle = FARBEN['rosa-500'];
  ctx.fill();
  ctx.lineWidth = g * 0.04;
  ctx.strokeStyle = FARBEN.weiss;
  ctx.stroke();
  return c;
}
