// Zwischenspeicher der Vorschau-Bilder je Tab im Content-Script (PHASE-4-BAUPLAN Abschnitt 8 Punkt 1). Reine Logik, kein Browser-Zugriff.
// - Gleiche Quelle = ein Abruf: laufende Anfragen werden geteilt, fertige Antworten sofort geliefert.
// - Viele Quellen teilen sich wenige Pack-Bilder: die Data-URL liegt einmal je Bildname, die Quellen merken nur den Namen.
// - Grenzen: hoechstens `maxBilder` Data-URLs und `maxBytes` Zeichen insgesamt (aeltestes fliegt zuerst), hoechstens `maxQuellen` gemerkte Quellen.

import type { AntwortPackBild } from '../nachrichten';
import type { KachelGedaechtnis } from './vorschau-wahl';

export interface SpeicherGrenzen {
  maxBilder: number;
  maxBytes: number;
  maxQuellen: number;
}

export const VORSCHAU_GRENZEN: SpeicherGrenzen = { maxBilder: 64, maxBytes: 24 * 1024 * 1024, maxQuellen: 4000 };

// Zusatz einer Anfrage (Phase 11 Etappe 2): `nurWahl` fragt nur den Namen des gewaehlten Bildes (Antwort ohne Bild), `ausschluss` sind alle
// vergebenen Namen (aelteste Vergabe zuerst), `sichtbar` die Namen auf anderen Kacheln im Blick, `fenster` die Groesse des Ausschnitts in Kacheln (Entscheidung 257),
// `bevorzugt` das Bild, das dieser Schluessel schon hatte.
export interface HolZusatz {
  nurWahl?: boolean;
  ausschluss?: string[];
  sichtbar?: string[];
  fenster?: number;
  bevorzugt?: string;
}
export type PackBildHolen = (schluessel: string, zusatz?: HolZusatz) => Promise<AntwortPackBild | null>;

// Wahl ohne Wiederholung: Gedaechtnis der Vergaben und die Namen der Vergaben (siehe vorschau-wahl.ts). Ohne diesen Teil verhaelt sich der Speicher wie
// vor Etappe 2 (eine Anfrage je Schluessel, die Wahl allein per Hash).
export interface SpeicherWahl {
  gedaechtnis: KachelGedaechtnis;
  // Alle vergebenen Namen (aelteste Vergabe zuerst) und die auf sichtbaren Kacheln (src/pack/wahl.ts: Raenge der Wahl); `sichtbar` nur, wenn die Kachel `schluessel` selbst im Blick steht.
  daten(schluessel: string): { ausschluss: string[]; sichtbar: string[]; fenster?: number };
  // Gilt die Wahl noch? Eine Kachel, die aus der Seite ist, belegt die Kette nicht (die Anfrage entfaellt).
  aktuell?(schluessel: string): boolean;
}

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
  private readonly wahl: SpeicherWahl | null;
  // Die Wahl der Namen laeuft strikt nacheinander (jede Antwort kennt die Vergabe davor), das Lesen der Bilder danach gleichzeitig.
  private kette: Promise<unknown> = Promise.resolve();
  // Zaehlt Transportfehler der Wahl: wartende Wahlen aus der Zeit davor scheitern sofort, statt jede die Zeitgrenze abzuwarten.
  private kettenEpoche = 0;

  constructor(holen: PackBildHolen, grenzen: SpeicherGrenzen = VORSCHAU_GRENZEN, wahl: SpeicherWahl | null = null) {
    this.holen = holen;
    this.grenzen = grenzen;
    this.wahl = wahl;
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
      const abruf: Promise<AntwortPackBild | null> = this.beschaffe(schluessel, meinLauf).then(
        (a) => {
          if (this.laufend.get(schluessel) === abruf) this.laufend.delete(schluessel);
          if (a && a.ok && meinLauf === this.lauf) {
            this.lege(schluessel, a);
            // Ist der Name schon vergeben (bei der Wahl), bleibt sein Stempel: die Reihenfolge der Vergabe zaehlt, nicht die der Ankunft.
            if (this.wahl && this.wahl.gedaechtnis.name(schluessel) !== a.name) this.wahl.gedaechtnis.merke(schluessel, a.name);
          } else if (!(a && a.ok) && meinLauf === this.lauf) this.wahl?.gedaechtnis.vergiss(schluessel);
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

  private async beschaffe(schluessel: string, lauf: number): Promise<AntwortPackBild | null> {
    const w = this.wahl;
    if (!w) return this.holen(schluessel);
    // Hatte der Schluessel schon ein Bild (nur das Bild wurde verdraengt), kommt dasselbe wieder; sonst waehlt der Erkenner nach den Raengen aus src/pack/wahl.ts.
    let bevorzugt = w.gedaechtnis.name(schluessel);
    if (bevorzugt === undefined) {
      const gewaehlt = await this.waehleNacheinander(schluessel, lauf, w);
      if (gewaehlt === null) return null;
      bevorzugt = gewaehlt ?? undefined;
    }
    return this.holen(schluessel, { bevorzugt, ...w.daten(schluessel) });
  }

  // null = kein Bild; undefined = die Wahl entfaellt (alter Lauf oder Kachel weg), das Bild wird ohne Vergabe geholt.
  private waehleNacheinander(schluessel: string, lauf: number, w: SpeicherWahl): Promise<string | null | undefined> {
    const epoche = this.kettenEpoche;
    const schritt = this.kette.then(async () => {
      if (epoche !== this.kettenEpoche) throw new Error('Wahl abgebrochen');
      if (lauf !== this.lauf || w.aktuell?.(schluessel) === false) return undefined; // alter Lauf oder Kachel weg: kein Schritt der Kette
      try {
        const a = await this.holen(schluessel, { nurWahl: true, ...w.daten(schluessel) });
        if (!a) return null;
        if (lauf === this.lauf) w.gedaechtnis.merke(schluessel, a.name); // gilt ab jetzt als vergeben, noch bevor das Bild da ist
        return a.name;
      } catch (e) {
        this.kettenEpoche++;
        throw e;
      }
    });
    this.kette = schritt.catch(() => undefined);
    return schritt;
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
    this.wahl?.gedaechtnis.leere();
  }
}

// Merkt Elemente, die waehrend der Transport-Sperre den normalen Schleier bekamen und nach Ende der Sperre erneut getauscht werden sollen.
// Reine Logik: ein Eintrag gilt nur, solange die Generation des Zustands gleich blieb (sonst wurde das Element inzwischen neu bewertet).
export class NachtauschMerker<E extends object, Z extends { generation: number }> {
  private readonly eintraege = new Map<E, { z: Z; generation: number }>();

  private readonly max: number;

  constructor(max = 2000) {
    this.max = max;
  }

  get anzahl(): number {
    return this.eintraege.size;
  }

  merke(el: E, z: Z): void {
    if (!this.eintraege.has(el) && this.eintraege.size >= this.max) return;
    this.eintraege.set(el, { z, generation: z.generation });
  }

  // Alle noch gueltigen Eintraege; die Liste ist danach leer.
  nimm(): Array<[E, Z]> {
    const aus: Array<[E, Z]> = [];
    for (const [el, e] of this.eintraege) if (e.z.generation === e.generation) aus.push([el, e.z]);
    this.eintraege.clear();
    return aus;
  }

  leere(): void {
    this.eintraege.clear();
  }
}
