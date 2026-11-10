// Begrenzte Wiederholung beim Laden der Seiten-Schriften (schrift.ts): nach einem Fehlschlag frueestens nach 2 s, dann 8 s, dann 30 s, danach wird aufgegeben.
// Reine Logik ohne Browser (Einheitstest). Die Aufrufer fragen nur `darfVersuchen`; zwischen den Versuchen kostet das nichts.
export const SCHRIFT_PAUSEN_MS: readonly number[] = [2000, 8000, 30000];

export class SchriftVersuche {
  private fehlschlaege = 0;
  private letzter = Number.NEGATIVE_INFINITY;

  get aufgegeben(): boolean {
    return this.fehlschlaege > SCHRIFT_PAUSEN_MS.length;
  }

  // Darf jetzt (Zeit in Millisekunden) ein neuer Versuch starten? Ohne bisherigen Fehlschlag immer.
  darfVersuchen(jetzt: number): boolean {
    if (this.fehlschlaege === 0) return true;
    if (this.aufgegeben) return false;
    return jetzt >= this.letzter + SCHRIFT_PAUSEN_MS[this.fehlschlaege - 1]!;
  }

  meldeFehl(jetzt: number): void {
    this.fehlschlaege++;
    this.letzter = jetzt;
  }

  meldeOk(): void {
    this.fehlschlaege = 0;
  }
}
