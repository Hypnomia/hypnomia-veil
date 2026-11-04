// Zwischenspeicher der Vorschau-Bilder je Tab im Content-Script (PHASE-4-BAUPLAN Abschnitt 8 Punkt 1). Reine Logik, kein Browser-Zugriff.
// - Gleiche Quelle = ein Abruf: laufende Anfragen werden geteilt, fertige Antworten sofort geliefert.
// - Viele Quellen teilen sich wenige Pack-Bilder: die Data-URL liegt einmal je Bildname, die Quellen merken nur den Namen.
// - Grenzen: hoechstens `maxBilder` Data-URLs und `maxBytes` Zeichen insgesamt (aeltestes fliegt zuerst), hoechstens `maxQuellen` gemerkte Quellen.

import type { AntwortPackBild } from '../nachrichten';

export interface SpeicherGrenzen {
  maxBilder: number;
  maxBytes: number;
  maxQuellen: number;
}

export const VORSCHAU_GRENZEN: SpeicherGrenzen = { maxBilder: 64, maxBytes: 24 * 1024 * 1024, maxQuellen: 4000 };

export type PackBildHolen = (schluessel: string) => Promise<AntwortPackBild | null>;

export class VorschauSpeicher {
  private readonly bilder = new Map<string, AntwortPackBild>();
  private readonly quellen = new Map<string, string>();
  private readonly laufend = new Map<string, Promise<AntwortPackBild | null>>();
  private bytes = 0;
  // Zaehlt jede Leerung: Antworten, die vor einer Leerung angefragt wurden, werden danach nicht mehr abgelegt.
  private lauf = 0;
  abrufe = 0;

  private readonly holen: PackBildHolen;
  private readonly grenzen: SpeicherGrenzen;

  constructor(holen: PackBildHolen, grenzen: SpeicherGrenzen = VORSCHAU_GRENZEN) {
    this.holen = holen;
    this.grenzen = grenzen;
  }

  get anzahlBilder(): number {
    return this.bilder.size;
  }
  get anzahlBytes(): number {
    return this.bytes;
  }

  // Fertige Antwort ohne Wartezeit, sonst null.
  sofort(schluessel: string): AntwortPackBild | null {
    const name = this.quellen.get(schluessel);
    return name !== undefined ? (this.bilder.get(name) ?? null) : null;
  }

  // null = der Erkenner hat endgueltig kein Bild (ok:false). Wirft, wenn der Erkenner nicht erreichbar war.
  async hole(schluessel: string): Promise<AntwortPackBild | null> {
    const da = this.sofort(schluessel);
    if (da) return da;
    let offen = this.laufend.get(schluessel);
    if (!offen) {
      const meinLauf = this.lauf;
      this.abrufe++;
      const abruf: Promise<AntwortPackBild | null> = this.holen(schluessel).then(
        (a) => {
          if (this.laufend.get(schluessel) === abruf) this.laufend.delete(schluessel);
          if (a && a.ok && meinLauf === this.lauf) this.lege(schluessel, a);
          return a && a.ok ? a : null;
        },
        (e) => {
          // Transportfehler (Erkenner nicht erreichbar): nicht als "kein Bild" verschlucken, der Aufrufer unterscheidet das.
          if (this.laufend.get(schluessel) === abruf) this.laufend.delete(schluessel);
          throw e;
        },
      );
      offen = abruf;
      this.laufend.set(schluessel, abruf);
    }
    return offen;
  }

  private lege(schluessel: string, a: AntwortPackBild): void {
    if (!this.bilder.has(a.name)) {
      const groesse = a.dataUrl.length;
      // Ein Bild allein groesser als die Gesamtgrenze wird nicht gehalten (die Antwort selbst geht trotzdem an den Aufrufer).
      if (groesse > this.grenzen.maxBytes) return;
      this.bilder.set(a.name, a);
      this.bytes += groesse;
      while ((this.bilder.size > this.grenzen.maxBilder || this.bytes > this.grenzen.maxBytes) && this.bilder.size > 1) {
        const aeltester = this.bilder.keys().next().value as string;
        const weg = this.bilder.get(aeltester)!;
        this.bilder.delete(aeltester);
        this.bytes -= weg.dataUrl.length;
        // Quellen, die auf das verdraengte Bild zeigten, werden beim naechsten Zugriff neu gefragt.
        for (const [q, n] of this.quellen) if (n === aeltester) this.quellen.delete(q);
      }
    }
    if (this.quellen.size >= this.grenzen.maxQuellen) this.quellen.delete(this.quellen.keys().next().value as string);
    this.quellen.set(schluessel, a.name);
  }

  leere(): void {
    this.lauf++;
    this.bilder.clear();
    this.quellen.clear();
    this.laufend.clear();
    this.bytes = 0;
  }
}
