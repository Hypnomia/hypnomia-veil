// Daumenbilder fuer die Szenenpruefung und Graustufenbilder fuer die Bewegungsschaetzung (Bauplan Video-Zonen, Auftraege V2 und V3b).
// Reine Rechnung auf Zahlenfeldern (laeuft in den Einheitstests ohne Browser) plus ein kleiner Leser, der ein Video-Einzelbild auf ein
// Graustufenbild fester Breite zieht. Je gezeigtem Bild genuegt ein einziges Verkleinern: der Daumen 32 x 18 entsteht aus dem Graustufenbild.

export interface GrauBild {
  b: number;
  h: number;
  px: Uint8Array;
}

// Leuchtdichte 0 bis 255 aus RGBA (ganzzahlig, Gewichte 77/150/29 durch 256).
export function grauAusRgba(rgba: Uint8ClampedArray | Uint8Array, b: number, h: number, aus?: Uint8Array): Uint8Array {
  const n = b * h;
  const ziel = aus && aus.length >= n ? aus : new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) ziel[i] = (77 * rgba[j]! + 150 * rgba[j + 1]! + 29 * rgba[j + 2]!) >> 8;
  return ziel;
}

// Daumen: Mittelwert je Zelle, Leuchtdichte 0 bis 1. Die Zellgrenzen folgen dem Seitenverhaeltnis (Bruchteile werden auf ganze Bildpunkte gerundet,
// jede Zelle hat mindestens einen Bildpunkt).
export function daumenAusGrau(grau: GrauBild, db: number, dh: number, aus?: Float32Array): Float32Array {
  const ziel = aus && aus.length >= db * dh ? aus : new Float32Array(db * dh);
  const { b, h, px } = grau;
  for (let cy = 0; cy < dh; cy++) {
    const y0 = Math.min(h - 1, Math.floor((cy * h) / dh));
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor(((cy + 1) * h) / dh)));
    for (let cx = 0; cx < db; cx++) {
      const x0 = Math.min(b - 1, Math.floor((cx * b) / db));
      const x1 = Math.max(x0 + 1, Math.min(b, Math.floor(((cx + 1) * b) / db)));
      let summe = 0;
      for (let y = y0; y < y1; y++) {
        const zeile = y * b;
        for (let x = x0; x < x1; x++) summe += px[zeile + x]!;
      }
      ziel[cy * db + cx] = summe / ((y1 - y0) * (x1 - x0) * 255);
    }
  }
  return ziel;
}

export type SzenenArt = 'keiner' | 'sofort' | 'schnitt';

export interface SzenenBefund {
  // Mittlere Abweichung ueber alle Zellen (0 bis 1).
  mittel: number;
  // Anteil der Zellen, deren Abweichung ueber der Zellschwelle liegt (0 bis 1).
  stark: number;
  art: SzenenArt;
}

export interface SzenenSchwellen {
  szene: number;
  zelle: number;
  anteil: number;
}

// Mittlere Abweichung ueber `szene`: Schnitt (das Bild gehoert zu einer neuen Szene, ganz decken und sofort pruefen). Sonst mindestens `anteil`
// der Zellen ueber `zelle` (ein grosser Teil des Bildes hat sich stark veraendert): nur sofort pruefen.
export function vergleicheDaumen(alt: Float32Array, neu: Float32Array, s: SzenenSchwellen): SzenenBefund {
  const n = Math.min(alt.length, neu.length);
  if (n === 0) return { mittel: 0, stark: 0, art: 'keiner' };
  let summe = 0;
  let stark = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(alt[i]! - neu[i]!);
    summe += d;
    if (d > s.zelle) stark++;
  }
  const mittel = summe / n;
  const anteil = stark / n;
  const art: SzenenArt = mittel > s.szene ? 'schnitt' : anteil >= s.anteil ? 'sofort' : 'keiner';
  return { mittel, stark: anteil, art };
}

// ---------- Leser (DOM) ----------

// Zieht ein Video-Einzelbild auf ein Graustufenbild der festen Breite `breite` (Hoehe nach Seitenverhaeltnis des Videos). Wiederverwendet Leinwand und
// Puffer. `lies` wirft nie: bei nicht lesbarer Quelle (verschmutzte Leinwand) kommt null.
export class GrauLeser {
  // Wie `lies`, aber aus der eigenen Leinwand der Zonen-Wiedergabe statt aus dem Video: das Videobild liegt dort schon gemalt, das Graustufenbild stammt aus
  // genau diesen Bildpunkten (`inhalt`: wo das Video in der Leinwand liegt, `flipX`/`flipY`: die Leinwand zeigt es gespiegelt). Das Video wird je Bild nur
  // einmal gelesen: ein zweites Lesen kann in manchen Browsern (Firefox 128) schon das naechste Bild liefern, und ein Schnitt bliebe unerkannt.
  liesLeinwand(quelle: HTMLCanvasElement, inhalt: { x: number; y: number; w: number; h: number }, flipX: boolean, flipY: boolean, vb: number, vh: number): GrauBild | null {
    if (!(vb > 0) || !(vh > 0) || !(inhalt.w > 0) || !(inhalt.h > 0)) return null;
    const b = Math.min(this.breite, vb);
    const h = Math.max(1, Math.round((b * vh) / vb));
    try {
      if (!this.leinwand || this.b !== b || this.h !== h) {
        this.leinwand = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
        this.leinwand.width = b;
        this.leinwand.height = h;
        this.ctx = this.leinwand.getContext('2d', { willReadFrequently: true });
        this.b = b;
        this.h = h;
      }
      const ctx = this.ctx;
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, b, h);
      if (flipX || flipY) {
        ctx.translate(flipX ? b : 0, flipY ? h : 0);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(quelle, inhalt.x, inhalt.y, inhalt.w, inhalt.h, 0, 0, b, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const daten = ctx.getImageData(0, 0, b, h).data;
      return { b, h, px: grauAusRgba(daten, b, h) };
    } catch {
      this.leinwand = null;
      this.ctx = null;
      return null;
    }
  }

  private leinwand: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private b = 0;
  private h = 0;
  private readonly breite: number;

  constructor(breite: number) {
    this.breite = breite;
  }

  // Neues Graustufenbild (eigener Puffer je Aufruf, damit der Aufrufer es behalten kann).
  lies(quelle: HTMLVideoElement): GrauBild | null {
    const vb = quelle.videoWidth;
    const vh = quelle.videoHeight;
    if (!(vb > 0) || !(vh > 0)) return null;
    const b = Math.min(this.breite, vb);
    const h = Math.max(1, Math.round((b * vh) / vb));
    try {
      if (!this.leinwand || this.b !== b || this.h !== h) {
        // Im HTML-Namensraum anlegen (eigenstaendige SVG-Dokumente kennen createElement('canvas') nicht, siehe pruefung.ts lesePixel).
        this.leinwand = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
        this.leinwand.width = b;
        this.leinwand.height = h;
        this.ctx = this.leinwand.getContext('2d', { willReadFrequently: true });
        this.b = b;
        this.h = h;
      }
      const ctx = this.ctx;
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(quelle, 0, 0, b, h);
      const daten = ctx.getImageData(0, 0, b, h).data;
      return { b, h, px: grauAusRgba(daten, b, h) };
    } catch {
      // Verschmutzte Leinwand (fremdes Video ohne CORS) bleibt verschmutzt, auch wenn danach ein lesbares Bild kommt: verwerfen, die naechste Quelle
      // bekommt eine frische.
      this.leinwand = null;
      this.ctx = null;
      return null;
    }
  }
}
