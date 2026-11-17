// Huellen in der Zonen-Leinwand (Phase 11, E3b, Regeln O1, O2, S1 im Video). Reine Logik ohne Browser und ohne Zeitquelle (die Zeit kommt als Argument).
// Spuren bleiben einzeln (die Verfolgung aendert sich nicht). Gemalt wird je Gruppe sich schneidender gleichrangiger Spuren eine Huelle: das umschliessende
// Rechteck der gezeigten Kanten ihrer Spuren (`huellenGruppen`, `huelleVon` aus src/erkenner/verschmelzen.ts), mit der staerksten Behandlung ihrer Spuren.
// Gleichrangig sind alle Spuren ausser den aufgelegten (Mias Gesicht, Augenbalken): die ruft der Aufrufer gar nicht erst hier an.
// Sicherheit (S1): je Bild wird die Huelle aus den aktuellen Kanten neu gerechnet und enthaelt jede ihrer Spuren ganz; sie ist nie kleiner, nie verschoben,
// ihre Behandlung nie schwaecher als die ihrer Spuren.
// Ruhe (Blitz-Grenzen): eine Huelle loest sich erst auf, wenn sich ihre Spuren mindestens HUELLE_RUHE_MS lang nicht mehr geschnitten haben, und fruehestens
// HUELLE_MIN_MS nach ihrer Bildung; bis dahin deckt sie weiter alle ihre Spuren. Bilden und Aufloesen liegen so mindestens 1 s auseinander (hoechstens 2
// Wechsel je Sekunde). Endet eine Spur, bleibt die Huelle fuer die uebrigen. Wort, Sticker (Motiv) kommen von der aeltesten Spur der Gruppe und bleiben.

import { huellenGruppen, huelleVon } from '../erkenner/verschmelzen.ts';
import { staerksteBehandlung, type Behandlung } from '../presets.ts';
import type { Kanten } from './video-zonen.ts';

export const HUELLE_RUHE_MS = 1000;
export const HUELLE_MIN_MS = 500;

export interface HuellenSpur {
  // Aufsteigend mit dem Alter: eine kleinere Kennung ist eine aeltere Spur.
  id: number;
  motiv: number;
  // Behandlung dieser Spur (Tabelle des Presets, nie mia-gesicht oder balken).
  behandlung: Behandlung;
  kanten: Kanten;
}

export interface Huelle {
  // Kennungen der Spuren, aufsteigend; eine einzelne Spur ist eine Huelle mit einer Kennung.
  ids: number[];
  // Motiv fuer Wort und Sticker: bei einer Gruppe das der aeltesten Spur (bleibt, auch wenn die Spur endet).
  motiv: number;
  kanten: Kanten;
  behandlung: Behandlung;
}

interface Gespeichert {
  ids: Set<number>;
  bildung: number;
  zuletzt: number;
  aelteste: number;
  motiv: number;
}

type BoxA = [number, number, number, number];
const alsBox = (k: Kanten): BoxA => [k.l, k.t, k.r - k.l, k.b - k.t];
// Umschliessende Kanten direkt aus den Kanten (ohne Umweg ueber Breite und Hoehe: kein Rundungsverlust, die Huelle enthaelt jede Spur genau).
const umschlag = (liste: readonly Kanten[]): Kanten => ({
  l: Math.min(...liste.map((k) => k.l)),
  t: Math.min(...liste.map((k) => k.t)),
  r: Math.max(...liste.map((k) => k.r)),
  b: Math.max(...liste.map((k) => k.b)),
});

export class HuellenSpeicher {
  private gruppen: Gespeichert[] = [];

  leere(): void {
    this.gruppen = [];
  }

  // Zahl der Gruppen, die gerade gehalten werden (nur fuer Tests).
  get gehalten(): number {
    return this.gruppen.length;
  }

  berechne(spuren: readonly HuellenSpur[], jetzt: number, standard: Behandlung): Huelle[] {
    const nach = new Map(spuren.map((s) => [s.id, s]));
    // Frische Gruppen aus den aktuellen Kanten.
    const frisch = huellenGruppen(spuren.map((s) => alsBox(s.kanten)))
      .filter((g) => g.length >= 2)
      .map((g) => new Set(g.map((i) => spuren[i]!.id)));
    // Gespeicherte Gruppen: tote Spuren fallen weg, unter zwei bleibt keine Gruppe; ohne Schnitt nach Ruhe und Mindestzeit loest sie sich auf.
    const behalten: Gespeichert[] = [];
    for (const g of this.gruppen) {
      const ids = new Set([...g.ids].filter((i) => nach.has(i)));
      if (ids.size < 2) continue;
      const ganzGeschnitten = frisch.some((f) => [...ids].every((i) => f.has(i)));
      const zuletzt = ganzGeschnitten ? jetzt : g.zuletzt;
      if (!ganzGeschnitten && jetzt - zuletzt >= HUELLE_RUHE_MS && jetzt - g.bildung >= HUELLE_MIN_MS) continue;
      behalten.push({ ...g, ids, zuletzt });
    }
    // Komponenten: Spuren, die in einer frischen oder gehaltenen Gruppe stehen, haengen zusammen.
    const eltern = new Map<number, number>(spuren.map((s) => [s.id, s.id]));
    const wurzel = (i: number): number => {
      let w = i;
      while (eltern.get(w) !== w) w = eltern.get(w)!;
      eltern.set(i, w);
      return w;
    };
    const verbinde = (ids: Iterable<number>): void => {
      let erste: number | null = null;
      for (const i of ids) {
        if (erste === null) erste = i;
        else eltern.set(wurzel(i), wurzel(erste));
      }
    };
    for (const g of frisch) verbinde(g);
    for (const g of behalten) verbinde(g.ids);
    let komp = new Map<number, number[]>();
    for (const s of spuren) komp.set(wurzel(s.id), [...(komp.get(wurzel(s.id)) ?? []), s.id]);
    // Huellen, die einander schneiden, werden eine (auch Gruppen, die erst durch das Zusammenfassen eine andere schneiden).
    const liste = [...komp.values()];
    const huellenBoxen = liste.map((ids) => huelleVon(ids.map((i) => alsBox(nach.get(i)!.kanten))));
    const super_ = huellenGruppen(huellenBoxen).map((g) => g.flatMap((k) => liste[k]!));
    komp = new Map(super_.map((ids) => [Math.min(...ids), ids.slice().sort((a, b) => a - b)]));
    const neu: Gespeichert[] = [];
    const aus: Huelle[] = [];
    for (const ids of [...komp.values()].sort((a, b) => a[0]! - b[0]!)) {
      const mitglieder = ids.map((i) => nach.get(i)!);
      const kanten = umschlag(mitglieder.map((s) => s.kanten));
      const behandlung = staerksteBehandlung(mitglieder.map((s) => s.behandlung), standard);
      if (ids.length === 1) {
        aus.push({ ids, motiv: mitglieder[0]!.motiv, kanten, behandlung });
        continue;
      }
      const menge = new Set(ids);
      const alte = behalten.filter((g) => [...g.ids].every((i) => menge.has(i)));
      const eigene = frisch.some((f) => f.size === menge.size && [...f].every((i) => menge.has(i)));
      let aelteste = mitglieder[0]!.id;
      let motiv = mitglieder[0]!.motiv;
      for (const g of alte) {
        if (g.aelteste < aelteste) {
          aelteste = g.aelteste;
          motiv = g.motiv;
        }
      }
      neu.push({
        ids: menge,
        bildung: alte.length ? Math.min(...alte.map((g) => g.bildung)) : jetzt,
        zuletzt: eigene || !alte.length ? jetzt : Math.max(...alte.map((g) => g.zuletzt)),
        aelteste,
        motiv,
      });
      aus.push({ ids, motiv, kanten, behandlung });
    }
    this.gruppen = neu;
    return aus;
  }
}
