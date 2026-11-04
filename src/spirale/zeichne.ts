// Zeichnen der Spirale (Auftrag L): die Arme werden je Bild direkt gedreht auf die sichtbare Leinwand gemalt (keine Zwischenleinwand, die
// Speicher kostet). Gezeichnet wird nur per requestAnimationFrame (im verborgenen Tab ruht es von selbst, auch das erste Bild), hoechstens alle
// 33 ms, die laengste Seite der Leinwand hat hoechstens 1280 Pixel, nach 15 Minuten steht das Bild (kein Zeichnen mehr).
import { BILD_ABSTAND_MS, deckkraftNach, leinwandMasse, STEHEND_NACH_MS, type Drehung } from './logik';

const PFLAUME = '#2b0f33';
const PFLAUME_HELL = 'rgba(74, 26, 82, 1)';
const PFLAUME_HELL_AUS = 'rgba(74, 26, 82, 0)';
const PINK = '#ff5fae';
const SPIRAL_WINDUNGEN = 5;

// Testhaken-Uhr (nur der Testbau ruft `stelleUhrVor`): schiebt die Zeit der Spirale vor, damit das stehende Bild nach 15 Minuten ohne Warten
// pruefbar ist. Im Release-Bau bleibt der Wert 0.
let uhrVorschub = 0;
export function stelleUhrVor(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) uhrVorschub += ms;
}
const uhr = (): number => performance.now() + uhrVorschub;

// Zaehler aller je gezeichneten Bilder (der Test belegt damit: nach dem Ende wird nichts mehr gezeichnet).
let bilderGesamtZaehler = 0;
export const bilderGesamt = (): number => bilderGesamtZaehler;

export interface Bildstand {
  deckkraft: number;
  winkel: number; // gesamte Drehung seit dem Start in Bogenmass (waechst weiter, nicht auf 2 pi gekuerzt)
  winkelZeit: number; // Uhr der Spirale beim Zeichnen dieses Winkels
  stehend: boolean;
  bilder: number;
}

export class SpiralenZeichner {
  private readonly ziel: CanvasRenderingContext2D | null;
  private readonly breite: number;
  private readonly hoehe: number;
  private readonly arme: Float32Array[] = []; // je Arm: x0, y0, x1, y1 ... in Ruhe (Mitte = 0/0)
  private readonly rMax: number;
  private readonly strichBreite: number;
  private readonly glut: CanvasGradient | null;
  private raf = 0;
  private start = 0;
  private letzterBild = -Infinity;
  private winkel = 0;
  private winkelZeit = 0;
  private bilder = 0;
  private deckkraft = 0;
  private stehend = false;
  private laeuft = false;

  constructor(
    leinwand: HTMLCanvasElement,
    private readonly dreh: Drehung,
    private readonly beiBild: (stand: Bildstand) => void,
  ) {
    const m = leinwandMasse(window.innerWidth, window.innerHeight);
    this.breite = leinwand.width = m.breite;
    this.hoehe = leinwand.height = m.hoehe;
    this.ziel = leinwand.getContext('2d');
    this.rMax = Math.hypot(this.breite, this.hoehe) / 2;
    const abstand = this.rMax / SPIRAL_WINDUNGEN; // Abstand zweier Windungen desselben Arms
    const b = abstand / (2 * Math.PI);
    this.strichBreite = Math.max(2, abstand / dreh.arme / 2);
    for (let arm = 0; arm < dreh.arme; arm++) {
      const punkte: number[] = [];
      for (let t = 0; t <= SPIRAL_WINDUNGEN * 2 * Math.PI + 0.5; t += 0.05) {
        const a = t + (arm * 2 * Math.PI) / dreh.arme;
        punkte.push(b * t * Math.cos(a), b * t * Math.sin(a));
      }
      this.arme.push(Float32Array.from(punkte));
    }
    // Weicher Rand zur Mitte hin: dort steht Mias Satz.
    const g = this.ziel?.createRadialGradient(0, 0, 0, 0, 0, this.rMax * 0.35) ?? null;
    g?.addColorStop(0, PFLAUME_HELL);
    g?.addColorStop(1, PFLAUME_HELL_AUS);
    this.glut = g;
  }

  get aufloesung(): { breite: number; hoehe: number } {
    return { breite: this.breite, hoehe: this.hoehe };
  }

  starte(): void {
    if (this.laeuft) return;
    this.laeuft = true;
    this.start = uhr();
    // Auch das erste Bild kommt per requestAnimationFrame (im verborgenen Tab wird nichts gezeichnet).
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (t: number): void => {
    if (!this.laeuft) return;
    const jetzt = uhr();
    if (jetzt - this.start >= STEHEND_NACH_MS) {
      // Stehendes Bild: ein letztes Mal zeichnen, danach weder Zeichnen noch weitere Bild-Anforderungen.
      this.stehend = true;
      this.zeichne(jetzt);
      this.laeuft = false;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
    if (t - this.letzterBild < BILD_ABSTAND_MS) return;
    this.letzterBild = t;
    this.zeichne(jetzt);
  };

  private zeichne(jetzt: number): void {
    const dt = this.bilder === 0 ? 0 : Math.min(100, jetzt - this.winkelZeit); // nach einer Pause kein Sprung
    this.winkel += 2 * Math.PI * this.dreh.umdrehungenJeSekunde * (dt / 1000);
    this.winkelZeit = jetzt;
    this.deckkraft = deckkraftNach(jetzt - this.start);
    const c = this.ziel;
    if (c) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = PFLAUME;
      c.fillRect(0, 0, this.breite, this.hoehe);
      c.translate(this.breite / 2, this.hoehe / 2);
      c.rotate(this.winkel);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = this.strichBreite;
      c.strokeStyle = PINK;
      for (const arm of this.arme) {
        c.beginPath();
        c.moveTo(arm[0]!, arm[1]!);
        for (let i = 2; i < arm.length; i += 2) c.lineTo(arm[i]!, arm[i + 1]!);
        c.stroke();
      }
      c.rotate(-this.winkel);
      if (this.glut) {
        c.fillStyle = this.glut;
        c.fillRect(-this.breite / 2, -this.hoehe / 2, this.breite, this.hoehe);
      }
    }
    this.bilder++;
    bilderGesamtZaehler++;
    this.beiBild(this.stand());
  }

  stand(): Bildstand {
    return { deckkraft: this.deckkraft, winkel: this.winkel, winkelZeit: this.winkelZeit, stehend: this.stehend, bilder: this.bilder };
  }

  stoppe(): void {
    this.laeuft = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
