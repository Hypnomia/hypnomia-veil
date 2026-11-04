// Ein Blitz-Ereignis planen (Auftrag B, Phase 5): reine Logik ohne Browser-Aufrufe. 80 % ein Wort (300 ms sichtbar, genau in der Mitte), 20 % ein
// Schwarm aus 6 bis 12 Woertern (je etwa 200 ms Takt, verteilt im mittleren Bereich). Jeder Plan geht durch `deckleWortPlan` (185 ms Mindestabstand,
// hoechstens 12 Woerter, hoechstens 2500 ms), nie dasselbe Wort zweimal in Folge.
import { deckleWortPlan, type WortPlan } from '../kontrolle/grenzen.ts';

export const WORT_EINZEL_MS = 300;
export const SCHWARM_MIN = 6;
export const SCHWARM_MAX = 12;
// Anteil der Schwaerme an den Ereignissen.
export const SCHWARM_ANTEIL = 0.2;
// Takt im Schwarm: 200 bis 220 ms zwischen zwei Wortanfaengen, Sichtdauer 170 ms (dazwischen eine kurze Luecke).
const TAKT_MIN_MS = 200;
const TAKT_SPIELRAUM_MS = 20;
const SCHWARM_SICHT_MS = 170;
// Der Schwarm liegt im mittleren Bereich: Mittelpunkte der Woerter zwischen 20 % und 80 % von Breite und Hoehe.
const BEREICH_VON = 0.2;
const BEREICH_BREITE = 0.6;

export interface GeplantesWort extends WortPlan {
  text: string;
  // Mittelpunkt in Anteilen der Sichtflaeche (0 bis 1).
  x: number;
  y: number;
}

export type Art = 'wort' | 'schwarm';

export function waehleArt(zufall: number): Art {
  return zufall < SCHWARM_ANTEIL ? 'schwarm' : 'wort';
}

// `zufall` liefert Zahlen von 0 bis unter 1. `vorher`: das zuletzt gezeigte Wort (das erste Wort des Plans ist ein anderes, wenn es eines gibt).
export function planeEreignis(woerter: readonly string[], art: Art, zufallRoh: () => number, vorher: string | null = null): GeplantesWort[] {
  // Zufallswerte immer auf 0 bis unter 1 begrenzen (auch aus Testhaken), kaputte Werte werden 0,5.
  const zufall = (): number => {
    const v = zufallRoh();
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.999999) : 0.5;
  };
  const pool = [...new Set(woerter.filter((w) => w.length > 0))];
  if (pool.length === 0) return [];
  const wahl = (nicht: string | null): string => {
    const frei = pool.filter((w) => w !== nicht);
    const aus = frei.length > 0 ? frei : pool;
    return aus[Math.min(aus.length - 1, Math.floor(zufall() * aus.length))]!;
  };
  // Mit nur einem Wort gibt es keinen Schwarm ohne Wiederholung in Folge: dann bleibt es beim einzelnen Wort.
  if (art === 'wort' || pool.length < 2) {
    const einzel: GeplantesWort[] = [{ text: wahl(vorher), beginnMs: 0, dauerMs: WORT_EINZEL_MS, x: 0.5, y: 0.5 }];
    return deckle(einzel);
  }
  const anzahl = SCHWARM_MIN + Math.min(SCHWARM_MAX - SCHWARM_MIN, Math.floor(zufall() * (SCHWARM_MAX - SCHWARM_MIN + 1)));
  const roh: GeplantesWort[] = [];
  let beginn = 0;
  let letztes = vorher;
  for (let i = 0; i < anzahl; i++) {
    const text = wahl(letztes);
    letztes = text;
    roh.push({
      text,
      beginnMs: beginn,
      dauerMs: SCHWARM_SICHT_MS,
      x: BEREICH_VON + BEREICH_BREITE * zufall(),
      y: BEREICH_VON + BEREICH_BREITE * zufall(),
    });
    beginn += TAKT_MIN_MS + Math.floor(zufall() * (TAKT_SPIELRAUM_MS + 1));
  }
  return deckle(roh);
}

// Der Deckel arbeitet auf Beginn und Dauer; Text und Ort bleiben beim Wort (gleiche Reihenfolge, der Deckel wirft nur hinten weg).
function deckle(roh: GeplantesWort[]): GeplantesWort[] {
  // Zuerst nach Beginn sortieren, so wie es der Deckel intern tut: Text und Ort bleiben beim richtigen Wort. Der Deckel wirft nur hinten weg.
  const sortiert = [...roh].sort((a, b) => a.beginnMs - b.beginnMs);
  const gedeckelt = deckleWortPlan(sortiert.map((w) => ({ beginnMs: w.beginnMs, dauerMs: w.dauerMs })));
  return gedeckelt.map((g, i) => ({ ...sortiert[i]!, beginnMs: g.beginnMs, dauerMs: g.dauerMs }));
}
