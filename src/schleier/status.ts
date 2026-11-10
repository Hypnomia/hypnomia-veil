// Testhaken: nur im Testbau (WXT_TESTHAKEN=1) und nur auf 127.0.0.1 und localhost schreibt der Schleier Debug-Attribute
// (data-veil-status, data-veil-ms). In Release-Bauten und auf allen anderen Hosts bleibt die Seite frei von Spuren
// ausser data-veil, data-veil-seite und data-veil-strict.

import { ATTR_STATUS, TESTHAKEN } from './konstanten';
import type { Zaehlung } from './zaehlung';

export type { Zaehlung } from './zaehlung';

export interface StatusAnzeige extends Zaehlung {
  start: number;
  fehler: number;
  sichtbarFreiMs: number | null;
  seiteFreiMs: number | null;
  // Video-Pruefungen (erste und laufende) und Urteilswechsel von Videos seit Start.
  videoPruefungen: number;
  videoWechsel: number;
  // Nachpruefungen, deren Antwort die Frist (2 Taktzeiten) ueberschritt und die wie ein Fehler galten.
  videoFristen: number;
  // Beginn der letzten 64 Video-Pruefungen (performance.now() des Content-Scripts, vom Content-Script selbst gestempelt) mit der Art:
  // erst = erste Pruefung eines Videos, takt = Nachpruefung.
  videoZeiten: Array<{ t: number; art: 'erst' | 'takt' }>;
  // Zonen-Leinwand (Bauplan Video-Zonen): gemalte Bilder, davon ganz gedeckte (Mosaik ueber das ganze Bild), Pruefungen im Zonen-Modus,
  // Rundlaeufe der letzten 64 Pruefungen in ms (Aufnahme des Bildes bis Antwort) und die Zeit fuer Malen plus Verfolgung (Summe und Anzahl der Bilder).
  videoZonenBilder: number;
  videoZonenGanz: number;
  videoZonenPruefungen: number;
  videoZonenRtt: number[];
  videoZonenMs: number;
  videoZonenMsBilder: number;
  // Aufteilung der Zeit je Bild (Summen in ms): Graustufenbild und Daumen, Verfolgung der Spuren, Malen.
  videoZonenMsGrau: number;
  videoZonenMsVerfolgung: number;
  videoZonenMsMalen: number;
  // Ruckfaelle auf Ganz-Verdecken (Grund je Fall, die letzten 16).
  videoZonenRueckfall: string[];
}

// Zaehler der Zonen-Leinwand, vom Status gehalten und von src/schleier/video-leinwand.ts beschrieben.
export interface VideoZonenZaehler {
  bilder: number;
  ganz: number;
  pruefungen: number;
  rtt: number[];
  ms: number;
  msBilder: number;
  msGrau: number;
  msVerfolgung: number;
  msMalen: number;
  rueckfall: string[];
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
  videoPruefungen = 0;
  videoWechsel = 0;
  videoFristen = 0;
  readonly zonen: VideoZonenZaehler = { bilder: 0, ganz: 0, pruefungen: 0, rtt: [], ms: 0, msBilder: 0, msGrau: 0, msVerfolgung: 0, msMalen: 0, rueckfall: [] };
  private videoZeiten: Array<{ t: number; art: 'erst' | 'takt' }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly zaehle: () => Zaehlung) {}

  // Eine Video-Pruefung beginnt (Zaehler und Zeitstempel fuer den Testhaken).
  // `zeit` ist derselbe Augenblick, den das Budget zaehlt (ohne Rundung): so misst der Test genau das Fenster, das das Budget begrenzt.
  zaehleVideoStart(art: 'erst' | 'takt', zeit: number): void {
    this.videoPruefungen++;
    if (this.aktiv) {
      this.videoZeiten.push({ t: zeit, art });
      if (this.videoZeiten.length > 64) this.videoZeiten.shift();
    }
    this.plane();
  }

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
      videoPruefungen: this.videoPruefungen,
      videoWechsel: this.videoWechsel,
      videoFristen: this.videoFristen,
      videoZeiten: this.videoZeiten,
      videoZonenBilder: this.zonen.bilder,
      videoZonenGanz: this.zonen.ganz,
      videoZonenPruefungen: this.zonen.pruefungen,
      videoZonenRtt: this.zonen.rtt,
      videoZonenMs: Math.round(this.zonen.ms * 100) / 100,
      videoZonenMsBilder: this.zonen.msBilder,
      videoZonenMsGrau: Math.round(this.zonen.msGrau * 100) / 100,
      videoZonenMsVerfolgung: Math.round(this.zonen.msVerfolgung * 100) / 100,
      videoZonenMsMalen: Math.round(this.zonen.msMalen * 100) / 100,
      videoZonenRueckfall: this.zonen.rueckfall,
    };
    wurzel.setAttribute(ATTR_STATUS, JSON.stringify(anzeige));
  }

  raeumeAuf(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.aktiv) document.documentElement?.removeAttribute(ATTR_STATUS);
  }
}
