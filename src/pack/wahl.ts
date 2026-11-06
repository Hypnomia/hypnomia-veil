// Wahl der Vorschau-Bilder nach Intensitaet und Seitenverhaeltnis (Phase 7, Auftrag I2, Entscheidung 148). Reine Logik ohne Browser-Zugriff,
// damit sie in Node getestet werden kann. Der Erkenner (src/erkenner/packbild.ts) ruft sie mit den Dateien aus dem Pack-Meta.
import type { StufeWahl } from '../einstellungen.ts';
import { hashe } from './hash.ts';
import type { Stufe } from './vertrag.ts';

// Von mild nach scharf. Kumulativ: die gewaehlte Stufe und alle milderen sind erlaubt, nie eine schaerfere.
export const STUFEN_REIHE: readonly Stufe[] = ['tease', 'hot', 'explicit'];

export function erlaubteStufen(stufe: StufeWahl): ReadonlySet<Stufe> {
  const i = STUFEN_REIHE.indexOf(stufe);
  // Unbekannter Wert: mildeste Stufe (Entscheidung 150, jeder Rueckfall ist tease).
  return new Set(STUFEN_REIHE.slice(0, (i < 0 ? 0 : i) + 1));
}

export type BildKlasse = 'hoch' | 'quadratisch' | 'quer';
const KLASSEN_REIHE: readonly BildKlasse[] = ['hoch', 'quadratisch', 'quer'];

// Quer ab Verhaeltnis 1,2, hoch unter 0,85, sonst quadratisch.
export const QUER_AB = 1.2;
export const HOCH_UNTER = 0.85;

export function bildKlasse(breite: number, hoehe: number): BildKlasse | null {
  if (!(breite > 0) || !(hoehe > 0) || !Number.isFinite(breite) || !Number.isFinite(hoehe)) return null;
  const v = breite / hoehe;
  return v >= QUER_AB ? 'quer' : v < HOCH_UNTER ? 'hoch' : 'quadratisch';
}

export interface WahlDatei {
  name: string;
  stufe?: Stufe;
  breite?: number;
  hoehe?: number;
}

// Liefert die Dateinamen in der Reihenfolge, in der der Erkenner sie versucht. Leer = kein erlaubtes Bild.
// 1. Nur Dateien erlaubter Stufen (`stufe` und milder). Fehlt dort jede, ist die Liste leer: es gibt nie ein Bild einer schaerferen Stufe.
// 2. Ohne Zielflaeche (`breite`/`hoehe` fehlen) oder wenn keine Datei Masse hat: alle erlaubten, stabil per Hash des Schluessels
//    (wie vor Phase 7).
// 3. Mit Zielflaeche: zuerst die Bilder derselben Klasse, sonst die Klasse, die dem Verhaeltnis der Flaeche am naechsten liegt. Innerhalb der
//    Klasse stabil per Hash des Schluessels. Danach die uebrigen erlaubten Bilder nach Naehe des Verhaeltnisses, damit ein nicht lesbares
//    Bild nicht zum Fehlschlag fuehrt. Dateien ohne Masse (alte Packs) stehen ganz hinten.
export function waehleVorschauNamen(dateien: readonly WahlDatei[], stufe: StufeWahl, schluessel: string, breite?: number, hoehe?: number): string[] {
  const erlaubt = erlaubteStufen(stufe);
  const pool = dateien.filter((d) => d.stufe !== undefined && erlaubt.has(d.stufe)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!pool.length) return [];
  const dreh = (liste: WahlDatei[]) => {
    if (liste.length < 2) return liste;
    const start = hashe(schluessel) % liste.length;
    return [...liste.slice(start), ...liste.slice(0, start)];
  };
  const soll = breite !== undefined && hoehe !== undefined ? bildKlasse(breite, hoehe) : null;
  const mitMass = pool.filter((d) => bildKlasse(d.breite ?? 0, d.hoehe ?? 0) !== null);
  if (!soll || !mitMass.length) return dreh(pool).map((d) => d.name);
  const sollVerh = breite! / hoehe!;
  const abstand = (d: WahlDatei) => Math.abs(Math.log(d.breite! / d.hoehe! / sollVerh));
  const ohneMass = pool.filter((d) => !mitMass.includes(d));
  // Klassenabstand zuerst (gleiche Klasse = 0), dann Naehe des Verhaeltnisses.
  const klasseAbstand = (d: WahlDatei) => Math.abs(KLASSEN_REIHE.indexOf(bildKlasse(d.breite!, d.hoehe!)!) - KLASSEN_REIHE.indexOf(soll));
  const sortiert = [...mitMass].sort((a, b) => klasseAbstand(a) - klasseAbstand(b) || abstand(a) - abstand(b) || (a.name < b.name ? -1 : 1));
  const besteKlasse = bildKlasse(sortiert[0]!.breite!, sortiert[0]!.hoehe!);
  const erste = sortiert.filter((d) => bildKlasse(d.breite!, d.hoehe!) === besteKlasse);
  const rest = sortiert.filter((d) => !erste.includes(d));
  return [...dreh(erste), ...rest, ...ohneMass].map((d) => d.name);
}

// Zwischenspeicher im Content-Script (VorschauSpeicher) kennt nur einen Schluessel je Quelle. Damit dieselbe Quelle in zwei Klassen zwei Bilder
// bekommen kann, haengt der Absender die Klasse an den Schluessel (Trenner U+0001, kommt in Adressen nicht vor) und trennt sie vor der
// Anfrage wieder ab. Die Anfrage schickt dann die Masse eines Vertreters der Klasse (16:9, 1:1, 9:16), nicht die der einzelnen Flaeche.
const TRENNER = '\u0001';
const VERTRETER: Record<BildKlasse, { breite: number; hoehe: number }> = {
  quer: { breite: 16, hoehe: 9 },
  quadratisch: { breite: 1, hoehe: 1 },
  hoch: { breite: 9, hoehe: 16 },
};

export function schluesselMitKlasse(schluessel: string, breite: number, hoehe: number): string {
  const k = bildKlasse(breite, hoehe);
  return k ? `${schluessel}${TRENNER}${k}` : schluessel;
}

export function trenneKlasse(zusammen: string): { schluessel: string; breite?: number; hoehe?: number } {
  const i = zusammen.lastIndexOf(TRENNER);
  if (i < 0) return { schluessel: zusammen };
  const k = zusammen.slice(i + 1) as BildKlasse;
  const v = VERTRETER[k];
  return v ? { schluessel: zusammen.slice(0, i), breite: v.breite, hoehe: v.hoehe } : { schluessel: zusammen.slice(0, i) };
}
