// Zwischenspeicher fuer schliessbare Bilder (ImageBitmap) mit Leihen: ein Bild wird erst geschlossen, wenn es aus dem Speicher
// verdraengt oder verworfen wurde UND niemand es mehr geliehen hat. So kann ein laufendes Rendern sein Patch-Bild sicher zu Ende
// zeichnen, egal wie lange es dauert. Eine nie zurueckgegebene Leihe laeuft nach `ablaufMs` von selbst ab (kein dauerhaftes Leck).
// Kein Browser-Zugriff, nur ein `close()` auf den Werten: laeuft auch in den Einheitstests.

interface Eintrag<T> {
  wert: T;
  leihen: number;
  verworfen: boolean;
  geschlossen: boolean;
}

export interface Leihe<T> {
  wert: T;
  // Gibt die Leihe zurueck (mehrfaches Aufrufen schadet nicht).
  freigeben(): void;
}

export class Zwischenspeicher<T extends { close(): void }> {
  private readonly karte = new Map<string, Eintrag<T>>();
  private readonly max: number;
  private readonly ablaufMs: number;

  constructor(max: number, ablaufMs = 60_000) {
    this.max = max;
    this.ablaufMs = ablaufMs;
  }

  get groesse(): number {
    return this.karte.size;
  }

  private leihe(e: Eintrag<T>): Leihe<T> {
    e.leihen++;
    let frei = false;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => freigeben(), this.ablaufMs);
    (timer as { unref?: () => void }).unref?.();
    const freigeben = (): void => {
      if (frei) return;
      frei = true;
      clearTimeout(timer);
      e.leihen--;
      this.schliesseWennFrei(e);
    };
    return { wert: e.wert, freigeben };
  }

  private schliesseWennFrei(e: Eintrag<T>): void {
    if (!e.verworfen || e.leihen > 0 || e.geschlossen) return;
    e.geschlossen = true;
    try {
      e.wert.close();
    } catch {
      // schon geschlossen
    }
  }

  private verwirf(e: Eintrag<T>): void {
    e.verworfen = true;
    this.schliesseWennFrei(e);
  }

  // Bild unter `name`, als zuletzt benutzt vermerkt; null, wenn nicht im Speicher.
  hole(name: string): Leihe<T> | null {
    const e = this.karte.get(name);
    if (!e) return null;
    this.karte.delete(name);
    this.karte.set(name, e);
    return this.leihe(e);
  }

  // Legt ein frisch dekodiertes Bild ab und gibt die erste Leihe darauf zurueck. `ablegen = false`: das Bild ist schon ueberholt
  // (das Pack wurde waehrend des Dekodierens ersetzt); es wird nicht eingetragen und schliesst mit der Leihe. Steht unter `name`
  // schon ein Bild (gleichzeitiger Aufruf), gilt dieses, das neue wird geschlossen.
  lege(name: string, wert: T, ablegen: boolean): Leihe<T> {
    if (!ablegen) {
      return this.leihe({ wert, leihen: 0, verworfen: true, geschlossen: false });
    }
    const schon = this.karte.get(name);
    if (schon) {
      this.verwirf({ wert, leihen: 0, verworfen: false, geschlossen: false });
      return this.leihe(schon);
    }
    while (this.karte.size >= this.max) {
      const aeltester = this.karte.keys().next().value;
      if (aeltester === undefined) break;
      const weg = this.karte.get(aeltester);
      this.karte.delete(aeltester);
      if (weg) this.verwirf(weg);
    }
    const e: Eintrag<T> = { wert, leihen: 0, verworfen: false, geschlossen: false };
    this.karte.set(name, e);
    return this.leihe(e);
  }

  // Alles verwerfen (Pack gewechselt oder entfernt): geliehene Bilder schliessen erst bei der Rueckgabe.
  leere(): void {
    for (const e of this.karte.values()) this.verwirf(e);
    this.karte.clear();
  }
}
