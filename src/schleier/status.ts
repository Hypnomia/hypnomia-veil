// Testhaken: nur im Testbau (WXT_TESTHAKEN=1) und nur auf 127.0.0.1 und localhost schreibt der Schleier Debug-Attribute
// (data-veil-status, data-veil-ms). In Release-Bauten und auf allen anderen Hosts bleibt die Seite frei von Spuren
// ausser data-veil, data-veil-seite und data-veil-strict.

import { ATTR_STATUS, TESTHAKEN } from './konstanten';

export interface Zaehlung {
  gesamt: number;
  offen: number;
  frei: number;
  zensiert: number;
  verdeckt: number;
}

export interface StatusAnzeige extends Zaehlung {
  start: number;
  fehler: number;
  sichtbarFreiMs: number | null;
  seiteFreiMs: number | null;
}

export function istTesthost(): boolean {
  return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
}

// Testhaken aktiv: Testbau und Testhost. Ohne Schalter ist das beim Bauen immer false.
export function testhakenAktiv(): boolean {
  return TESTHAKEN && istTesthost();
}

export class Status {
  readonly aktiv = testhakenAktiv();
  readonly start = performance.now();
  fehler = 0;
  sichtbarFreiMs: number | null = null;
  seiteFreiMs: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly zaehle: () => Zaehlung) {}

  // Millisekunden seit dem Start des Content-Scripts.
  seitStart(): number {
    return Math.round(performance.now() - this.start);
  }

  // Schreibt den Status gedrosselt (hoechstens alle 30 ms) in das Wurzelelement.
  plane(): void {
    if (!this.aktiv || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.schreibe();
    }, 30);
  }

  schreibe(): void {
    if (!this.aktiv) return;
    const wurzel = document.documentElement;
    if (!wurzel) return;
    const anzeige: StatusAnzeige = {
      start: Math.round(this.start),
      ...this.zaehle(),
      fehler: this.fehler,
      sichtbarFreiMs: this.sichtbarFreiMs,
      seiteFreiMs: this.seiteFreiMs,
    };
    wurzel.setAttribute(ATTR_STATUS, JSON.stringify(anzeige));
  }

  raeumeAuf(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.aktiv) document.documentElement?.removeAttribute(ATTR_STATUS);
  }
}
