// Erkennen einer Erwachsenenseite am Inhalt (PHASE-4-BAUPLAN Abschnitt 8 Punkt 3). Reine Zaehlung, kein Browser-Zugriff.
// Gezaehlt werden nur echte Pruefungen von Bildern (img und Inline-Hintergruende), nie Videos, nie Ausfaelle (Fehler, Zeitgrenze) und nie
// eingesetzte Vorschau-Bilder. Jedes Bild zaehlt einmal (nach Adresse). Ab INHALT_MIN_BILDER Bildern mit mindestens INHALT_MIN_ANTEIL Treffern
// gilt die Seite bis zum Neuladen (oder bis zu einem Seitenwechsel ohne Neuladen) als erwachsen, aber nur fuer Quiz und Freilegen.

export const INHALT_MIN_BILDER = 12;
export const INHALT_MIN_ANTEIL = 0.5;
// Obergrenze der gemerkten Adressen: endlose Feeds dehnen den Speicher nicht aus (danach zaehlt nichts Neues mehr, der Stand bleibt).
export const INHALT_MAX_SCHLUESSEL = 2000;

export type InhaltsUrteil = 'frei' | 'treffer';

// Zonen, die als Treffer fuers Erkennen am Inhalt zaehlen (unbedeckt), unabhaengig von Zonen des Nutzers, Stufe und Stil.
const INHALT_ZONEN: readonly string[] = ['breast', 'genitals', 'buttocks'];
// Brust zaehlt nur mit `weiblich` (eine nackte Maennerbrust macht keine Seite erwachsen).
export function inhaltAusTreffern(treffer: ReadonlyArray<{ zone: string; bedeckt: boolean; weiblich?: boolean }> | undefined): InhaltsUrteil {
  return treffer?.some((t) => !t.bedeckt && INHALT_ZONEN.includes(t.zone) && (t.zone !== 'breast' || t.weiblich === true)) ? 'treffer' : 'frei';
}

// Zaehlt ein Ergebnis fuers Erkennen am Inhalt? Nur Bilder und Inline-Hintergruende, und nur echte Pruefungen (nie Fehler, Warten, Spiegel, Videos).
export function zaehltFuerInhalt(art: string, ergebnis: string): boolean {
  return (art === 'bild' || art === 'hintergrund') && (ergebnis === 'frei' || ergebnis === 'zensiert' || ergebnis === 'zensiertHg' || ergebnis === 'verdeckt');
}

export class InhaltsZaehler {
  private gesehen = new Set<string>();
  private gesamt = 0;
  private treffer = 0;
  private erkannt = false;

  get amInhalt(): boolean {
    return this.erkannt;
  }

  get stand(): { gesamt: number; treffer: number } {
    return { gesamt: this.gesamt, treffer: this.treffer };
  }

  // Verbucht ein beurteiltes Bild. Gibt true zurueck, wenn die Seite durch genau diese Buchung als erwachsen gilt.
  zaehle(schluessel: string, urteil: InhaltsUrteil): boolean {
    if (this.erkannt || !schluessel || this.gesehen.has(schluessel) || this.gesehen.size >= INHALT_MAX_SCHLUESSEL) return false;
    this.gesehen.add(schluessel);
    this.gesamt++;
    if (urteil === 'treffer') this.treffer++;
    if (this.gesamt >= INHALT_MIN_BILDER && this.treffer / this.gesamt >= INHALT_MIN_ANTEIL) {
      this.erkannt = true;
      return true;
    }
    return false;
  }

  // Seitenwechsel ohne Neuladen oder Abschalten des Erkennens: alles neu.
  neuStart(): void {
    this.gesehen = new Set();
    this.gesamt = 0;
    this.treffer = 0;
    this.erkannt = false;
  }
}
