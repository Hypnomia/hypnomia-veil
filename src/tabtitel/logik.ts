// Reine Logik des Tab-Titels (Auftrag K1, Phase 5 Session 10): Wahl des Satzes ohne Wiederholung, Grenze fuer Titel-Aenderungen der Seite,
// Abstand zwischen zwei Setzungen. Keine Laufzeit-Importe, damit der Einheitstest sie in Node laden kann.

// Aendert die Seite den Titel waehrend eines Besuchs im Hintergrund oefter als so viele Male in dieser Spanne, gibt Mia fuer diesen Besuch auf.
export const MAX_AENDERUNGEN = 10;
export const AENDERUNGS_FENSTER_MS = 60_000;
// Mias Satz kommt nach einer Aenderung der Seite hoechstens einmal je Sekunde wieder darueber.
export const MIN_ABSTAND_SETZEN_MS = 1000;

// Waehlt einen Satz; nie derselbe wie `letzter`, solange es einen anderen gibt. `zufall` liegt in [0, 1).
export function waehleSatz(saetze: readonly string[], letzter: string | null, zufall: number): string | null {
  if (saetze.length === 0) return null;
  let kandidaten = letzter === null ? [...saetze] : saetze.filter((s) => s !== letzter);
  if (kandidaten.length === 0) kandidaten = [...saetze];
  const z = Number.isFinite(zufall) ? Math.min(Math.max(zufall, 0), 0.999999) : 0;
  return kandidaten[Math.floor(z * kandidaten.length)]!;
}

// Zaehlt die Titel-Aenderungen der Seite in einem gleitenden Fenster.
export class AenderungsBremse {
  private zeiten: number[] = [];

  // Meldet eine Aenderung zum Zeitpunkt `jetzt` (ms). Wahr, wenn es jetzt mehr als MAX_AENDERUNGEN im Fenster sind (aufgeben).
  melde(jetzt: number): boolean {
    this.zeiten.push(jetzt);
    this.zeiten = this.zeiten.filter((t) => jetzt - t < AENDERUNGS_FENSTER_MS);
    return this.zeiten.length > MAX_AENDERUNGEN;
  }

  zuruecksetzen(): void {
    this.zeiten = [];
  }
}

// Wie lange noch warten, bis Mias Satz wieder gesetzt werden darf (0 = sofort).
export function wartezeitBisSetzen(jetzt: number, zuletztGesetzt: number | null): number {
  if (zuletztGesetzt === null) return 0;
  return Math.max(0, MIN_ABSTAND_SETZEN_MS - (jetzt - zuletztGesetzt));
}
