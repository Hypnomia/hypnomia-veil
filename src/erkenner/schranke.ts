// Zaehlende Schranke (Semaphore): hoechstens `plaetze` Laeufe gleichzeitig, die uebrigen warten der Reihe nach.
// Reines TypeScript ohne Browser-Zugriff, damit die Einheitstests sie laden koennen.

export class Schranke {
  private frei: number;
  private readonly wartende: Array<() => void> = [];

  constructor(plaetze: number) {
    this.frei = Math.max(1, Math.floor(plaetze));
  }

  // Wartet auf einen freien Platz und liefert die Funktion, die den Platz wieder abgibt (einmalig wirksam).
  async betrete(): Promise<() => void> {
    if (this.frei > 0) {
      this.frei--;
    } else {
      await new Promise<void>((weiter) => this.wartende.push(weiter));
    }
    let abgegeben = false;
    return () => {
      if (abgegeben) return;
      abgegeben = true;
      const naechster = this.wartende.shift();
      // Der Platz geht direkt an den naechsten Wartenden, ohne zwischendurch frei zu sein.
      if (naechster) naechster();
      else this.frei++;
    };
  }

  // Fuehrt `arbeit` auf einem Platz aus und gibt ihn danach auch bei Fehlern wieder frei.
  async mitPlatz<T>(arbeit: () => Promise<T>): Promise<T> {
    const abgeben = await this.betrete();
    try {
      return await arbeit();
    } finally {
      abgeben();
    }
  }

  get wartend(): number {
    return this.wartende.length;
  }
}
