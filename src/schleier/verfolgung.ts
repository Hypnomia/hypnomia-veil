// Bewegungsschaetzung je Box auf einem kleinen Graustufenbild (Bauplan Video-Zonen, Auftrag V3b).
// Blockvergleich (Summe der Betragsabweichungen, SAD) der Schablone der Box aus dem alten Bild in einem Suchfenster des neuen Bildes, mit
// Verfeinerung unter einem Bildpunkt (Parabel). Reine Rechnung auf Zahlenfeldern, ohne Browser. Ist der Restfehler hoch, die Schablone flach
// oder die beste Verschiebung am Rand des Suchfensters, gilt die Verfolgung als unsicher: der Aufrufer laesst die Box dann wie ohne Verfolgung wachsen.

import type { GrauBild } from './daumen.ts';

export interface BoxF {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Verschiebung {
  dx: number;
  dy: number;
  // Mittlere Abweichung der besten Verschiebung (0 bis 255).
  sad: number;
  sicher: boolean;
}

export interface VerfolgungsOptionen {
  // Suchradius in Bildpunkten des Graustufenbildes.
  radius: number;
  // Darueber gilt die Verfolgung als unsicher.
  sadUnsicher: number;
  // Darunter ist die Schablone zu flach (mittlere Abweichung vom Mittelwert).
  kontrastMin: number;
}

// Strafe je Bildpunkt Verschiebung (in Graustufen): bei gleichem Fehler gewinnt die kleinere Verschiebung (Ruhe statt Zittern).
const STRAFE_JE_PIXEL = 0.05;
// Ziel der Stichprobe je Schablone (Anzahl Bildpunkte, grobe Schrittweite bei grossen Boxen).
const STICHPROBE = 600;
// Schablone: der innere Teil der Box (am Rand liegt oft Hintergrund, der sich nicht mit dem Koerper bewegt).
const SCHABLONE_INNEN = 0.15;

interface Schablone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  schritt: number;
}

function schabloneVon(box: BoxF, b: number, h: number): Schablone | null {
  const inx = box.w * SCHABLONE_INNEN;
  const iny = box.h * SCHABLONE_INNEN;
  let x0 = Math.round(box.x + inx);
  let y0 = Math.round(box.y + iny);
  let x1 = Math.round(box.x + box.w - inx);
  let y1 = Math.round(box.y + box.h - iny);
  if (x1 - x0 < 4 || y1 - y0 < 4) {
    x0 = Math.round(box.x);
    y0 = Math.round(box.y);
    x1 = Math.round(box.x + box.w);
    y1 = Math.round(box.y + box.h);
  }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(b, x1);
  y1 = Math.min(h, y1);
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  const schritt = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / STICHPROBE)));
  return { x0, y0, x1, y1, schritt };
}

// Summe der Betragsabweichungen der Schablone aus `alt` gegen `neu`, um (dx, dy) verschoben. Liegt die verschobene Schablone ausserhalb des
// Bildes, ist sie unendlich teuer. `grenze`: Abbruch, sobald die Summe darueber liegt (nur fuer die Suche, nicht fuer die Nachbarwerte).
function kosten(alt: GrauBild, neu: GrauBild, s: Schablone, dx: number, dy: number, grenze: number): number {
  if (s.x0 + dx < 0 || s.y0 + dy < 0 || s.x1 + dx > neu.b || s.y1 + dy > neu.h) return Infinity;
  let summe = 0;
  const ab = alt.b;
  const nb = neu.b;
  for (let y = s.y0; y < s.y1; y += s.schritt) {
    const za = y * ab;
    const zn = (y + dy) * nb + dx;
    for (let x = s.x0; x < s.x1; x += s.schritt) {
      const d = alt.px[za + x]! - neu.px[zn + x]!;
      summe += d < 0 ? -d : d;
    }
    if (summe > grenze) return Infinity;
  }
  return summe;
}

function stichprobenZahl(s: Schablone): number {
  return Math.ceil((s.x1 - s.x0) / s.schritt) * Math.ceil((s.y1 - s.y0) / s.schritt);
}

function kontrastVon(alt: GrauBild, s: Schablone): number {
  let summe = 0;
  let n = 0;
  for (let y = s.y0; y < s.y1; y += s.schritt) {
    for (let x = s.x0; x < s.x1; x += s.schritt) {
      summe += alt.px[y * alt.b + x]!;
      n++;
    }
  }
  if (!n) return 0;
  const mittel = summe / n;
  let abw = 0;
  for (let y = s.y0; y < s.y1; y += s.schritt) {
    for (let x = s.x0; x < s.x1; x += s.schritt) abw += Math.abs(alt.px[y * alt.b + x]! - mittel);
  }
  return abw / n;
}

// Verfeinerung unter einem Bildpunkt: Scheitel der Parabel durch die Kosten bei -1, 0, +1 (Betrag hoechstens 0,5).
function scheitel(links: number, mitte: number, rechts: number): number {
  if (!Number.isFinite(links) || !Number.isFinite(rechts)) return 0;
  const nenner = links - 2 * mitte + rechts;
  if (!(nenner > 1e-9)) return 0;
  const v = (0.5 * (links - rechts)) / nenner;
  return Math.max(-0.5, Math.min(0.5, v));
}

// Kandidaten der Verschiebungen je Radius, von der Mitte nach aussen sortiert (der Abbruch in `kosten` greift dann frueh).
const kandidatenListen = new Map<number, Array<[number, number]>>();
function kandidaten(r: number): Array<[number, number]> {
  let liste = kandidatenListen.get(r);
  if (!liste) {
    liste = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) liste.push([dx, dy]);
    liste.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
    kandidatenListen.set(r, liste);
  }
  return liste;
}

// Verfolgt eine Box von `alt` nach `neu` (beide Graustufenbilder gleicher Groesse, Box in deren Bildpunkten).
export function verfolgeBox(alt: GrauBild, neu: GrauBild, box: BoxF, o: VerfolgungsOptionen): Verschiebung {
  const unsicher = (sad = 255): Verschiebung => ({ dx: 0, dy: 0, sad, sicher: false });
  if (alt.b !== neu.b || alt.h !== neu.h) return unsicher();
  const s = schabloneVon(box, alt.b, alt.h);
  if (!s) return unsicher();
  const n = stichprobenZahl(s);
  const kontrast = kontrastVon(alt, s);
  const r = Math.max(1, Math.round(o.radius));
  let beste = Infinity;
  let bdx = 0;
  let bdy = 0;
  const strafe = STRAFE_JE_PIXEL * n;
  for (const [dx, dy] of kandidaten(r)) {
    const aufschlag = strafe * (Math.abs(dx) + Math.abs(dy));
    const c = kosten(alt, neu, s, dx, dy, beste - aufschlag);
    if (c === Infinity) continue;
    const gesamt = c + aufschlag;
    if (gesamt < beste) {
      beste = gesamt;
      bdx = dx;
      bdy = dy;
    }
  }
  if (!Number.isFinite(beste)) return unsicher();
  const mitte = kosten(alt, neu, s, bdx, bdy, Infinity);
  const sad = mitte / n;
  const sx = scheitel(kosten(alt, neu, s, bdx - 1, bdy, Infinity), mitte, kosten(alt, neu, s, bdx + 1, bdy, Infinity));
  const sy = scheitel(kosten(alt, neu, s, bdx, bdy - 1, Infinity), mitte, kosten(alt, neu, s, bdx, bdy + 1, Infinity));
  const amRand = Math.abs(bdx) >= r || Math.abs(bdy) >= r;
  const sicher = sad <= o.sadUnsicher && kontrast >= o.kontrastMin && !amRand;
  return { dx: bdx + sx, dy: bdy + sy, sad, sicher };
}
