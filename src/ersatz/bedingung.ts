// Wann gilt der Komplett-Ersatz? Die einzige Stelle, die das entscheidet (Auftrag G, Entscheidung 107). Reine Funktionen ohne Browser-Aufrufe,
// damit Einheitstests sie direkt pruefen koennen (darum die Endungen `.ts` in den Importen, wie in src/hintergrund/umleitung.ts).
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { seiteFuer } from '../adapter/liste.ts';
import type { Einstellungen } from '../einstellungen.ts';
import { istFreigeschaltet, type PackKurz } from '../pack/vertrag.ts';

// Gilt der Ersatz nach Einstellungen und Pack (ohne die Adresse)? Mit lesbaren Vorschau-Bildern (sonst haette die Galerie nichts zu zeigen)
// und nur bei eingeschaltetem Pornoseiten-Modus, nie bei Pause.
export function ersatzAktiv(e: Einstellungen, pack: PackKurz | null | undefined): boolean {
  return !e.pause && e.erwachsen.an && e.erwachsen.komplettErsatz && istFreigeschaltet(pack, 'erwachsen:ersatz') && (pack?.vorschau ?? 0) > 0;
}

export interface AdresseKurz {
  href: string;
  hostname: string;
  pathname: string;
}

// Gilt der Ersatz fuer genau diese Seite? Die Adresse muss auf der Liste oder bei den eigenen Seiten stehen (NIE nur am Inhalt erkannt:
// `erkennenAmInhalt` spielt hier keine Rolle) und darf nicht unter den eigenen Ausnahmen stehen.
export function ersatzGilt(e: Einstellungen, pack: PackKurz | null | undefined, adresse: AdresseKurz): boolean {
  if (!ersatzAktiv(e, pack)) return false;
  if (seiteFuer(adresse.href, e.erwachsen.eigeneSeiten) === null) return false;
  return !passtAusnahme(adresse, e.ausnahmen);
}

// Steht die Adresse schon ohne Einstellungen auf der Liste? Dann wird sofort verdeckt, bevor die Einstellungen geladen sind
// (eigene Seiten sind erst nach dem Laden bekannt).
export function frueherKandidat(href: string): boolean {
  return seiteFuer(href, []) !== null;
}

// Blitz-Grenze (CLAUDE.md Regel 9): Erscheinen und Verschwinden der Galerie sind vollflaechige Wechsel. Verschwinden geschieht immer sofort
// und wird nur gezaehlt; das Erscheinen wartet, bis im gleitenden Fenster hoechstens ein Wechsel liegt (es folgt immer ein Verschwinden,
// zusammen also nie mehr als 3 je Sekunde). Dieselbe Rechnung wie die Wechselzaehlung in src/riegel/riegel.ts.
export const WECHSEL_FENSTER_MS = 1250;

export class WechselZaehler {
  private zeiten: number[] = [];
  private readonly jetzt: () => number;
  constructor(jetzt: () => number) {
    this.jetzt = jetzt;
  }
  merke(): void {
    this.zeiten.push(this.jetzt());
    if (this.zeiten.length > 8) this.zeiten.shift();
  }
  // Wartezeit bis zum naechsten erlaubten Erscheinen in ms (0 = sofort).
  erscheinenIn(): number {
    if (this.zeiten.length < 2) return 0;
    return Math.max(0, this.zeiten[this.zeiten.length - 2]! + WECHSEL_FENSTER_MS - this.jetzt());
  }
}
