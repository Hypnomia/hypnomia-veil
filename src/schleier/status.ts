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

// Host des Dokumentursprungs. In about:blank-, blob:- und srcdoc-Frames ist location.hostname leer, window.origin traegt dort den vom
// Erzeuger geerbten Ursprung (bei undurchsichtigem Ursprung "null": dann kein Testhost).
function ursprungsHost(): string {
  try {
    const ursprung = window.origin;
    if (ursprung && ursprung !== 'null') return new URL(ursprung).hostname;
  } catch {
    // ohne Ursprung faellt es auf die Adresse zurueck
  }
  return location.hostname;
}

export function istTesthost(): boolean {
  const host = ursprungsHost();
  return host === '127.0.0.1' || host === 'localhost';
}

// Testhaken aktiv: Testbau und Testhost. Ohne Schalter ist das beim Bauen immer false.
export function testhakenAktiv(): boolean {
  return TESTHAKEN && istTesthost();
}

// Testhaken "Freigabe sperren": die Seitenadresse enthaelt veil-freigabe=nie. Dann bekommt kein Element je ein Urteil-Attribut, es bleibt
// bei opacity 0 (weder frei noch zensiert noch verdeckt-unscharf). Gedacht fuer die Blitz-Aufnahme: ohne Freigabe darf nirgends Magenta
// auftauchen. Nur im Testbau und nur auf 127.0.0.1 und localhost. In about:blank-Frames zaehlt die Adresse der Basis (die des Erzeugers).
let gesperrt: boolean | null = null;
export function freigabeGesperrt(): boolean {
  if (!testhakenAktiv()) return false;
  if (gesperrt !== null) return gesperrt;
  try {
    // Eigene Abfrage; in Rahmen ohne eigene Abfrage (about:blank, blob:) die Basisadresse oder die Abfrage der Elternseite, soweit
    // sie gleichen Ursprungs ist (geerbter Ursprung). Fremde Rahmen bekommen den Parameter in ihre Adresse geschrieben.
    const quellen: string[] = [location.search, new URL(document.baseURI).search];
    try {
      quellen.push(window.parent.location.search);
    } catch {
      // Elternseite fremd: nicht lesbar
    }
    gesperrt = quellen.some((q) => new URLSearchParams(q).get('veil-freigabe') === 'nie');
  } catch {
    gesperrt = false;
  }
  return gesperrt;
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
