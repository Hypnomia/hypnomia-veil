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
// 4. Phase 11 Etappe 2 (Regel O3, Entscheidung 256, Regel v2): `optionen.ausschluss` sind alle Namen, die auf der Seite schon vergeben sind (aelteste
//    Vergabe zuerst), `optionen.sichtbar` die Namen auf ANDEREN Kacheln im Blick; der Absender schickt sie nur, wenn die Kachel, fuer die gewaehlt wird,
//    selbst im Blick steht (sonst ist kein Kandidat "imBlick"). Beides ordnet nur um und fuegt nie etwas hinzu. Je erlaubtem Kandidaten (aus 1., Stufenfilter):
//      nah: unter den letzten `fenster` verschiedenen Namen von `ausschluss` (noch nie vergeben ist nicht nah). `optionen.fenster` schickt der Absender nach der
//        Groesse des Ausschnitts (Entscheidung 257: ceil(1,5 x Flaeche des Fensters / Flaeche der Kachel)); der Erkenner klemmt es auf
//        VERGABE_FENSTER_MIN bis VERGABE_FENSTER_MAX, fehlt es oder ist es keine endliche Zahl, gilt VERGABE_FENSTER_MIN. Es beeinflusst nur die Reihenfolge.
//      imBlick: steht in `sichtbar`.
//    Rang 0: weder imBlick noch nah: zuerst das Format (Reihenfolge aus 2. und 3.), dann noch nie vergeben vor am laengsten her, dann der stabile Hash.
//    Rang 1: nicht imBlick, aber nah: am laengsten her zuerst (das Format zaehlt hier nicht), dann Hash.
//    Rang 2: imBlick (Wiederholung im Blick unvermeidbar): zuerst das Format, dann am laengsten her, dann Hash.
//    Gewaehlt wird aus dem besten nicht leeren Rang. `optionen.bevorzugt` (ein Name, den dieser Schluessel schon hatte) kommt an den Anfang, aber nur,
//    wenn er in der Liste steht. Der Stufenfilter steht vor allem anderen: ein Name einer schaerferen Stufe steht nie in der Liste, auch nicht, um eine
//    Wiederholung zu vermeiden.
export interface WahlOptionen {
  ausschluss?: readonly string[];
  sichtbar?: readonly string[];
  fenster?: unknown;
  bevorzugt?: string;
}

// So viele der letzten Vergaben gelten mindestens als "gerade erst gezeigt" (Rang 0 gegen Rang 1); der Absender vergroessert das Fenster fuer Raster (bis MAX).
export const VERGABE_FENSTER_MIN = 24;
export const VERGABE_FENSTER_MAX = 200;
export const VERGABE_FENSTER = VERGABE_FENSTER_MIN;

// Klemmt ein vom Absender geschicktes Fenster: keine endliche Zahl ergibt MIN, sonst gerundet zwischen MIN und MAX.
export function klemmeFenster(wert: unknown): number {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) return VERGABE_FENSTER_MIN;
  return Math.min(VERGABE_FENSTER_MAX, Math.max(VERGABE_FENSTER_MIN, Math.round(wert)));
}

interface Stufung {
  name: string;
  // Format: [Klassenabstand, Verhaeltnisabstand], kleiner ist besser; die beste Klasse ist [0, 0].
  format: [number, number];
}

export function waehleVorschauNamen(
  dateien: readonly WahlDatei[],
  stufe: StufeWahl,
  schluessel: string,
  breite?: number,
  hoehe?: number,
  optionen?: WahlOptionen,
): string[] {
  const basis = stufeNamen(dateien, stufe, schluessel, breite, hoehe);
  if (!optionen || basis.length < 2) return basis.map((b) => b.name);
  const aus = optionen.ausschluss ?? [];
  const sicht = new Set(optionen.sichtbar ?? []);
  const alter = new Map<string, number>();
  aus.forEach((n, i) => alter.set(n, i)); // spaeter in der Liste = juenger; ein doppelter Name zaehlt mit der juengeren Vergabe
  const fenster = klemmeFenster(optionen.fenster);
  const letzte = new Set<string>();
  for (let i = aus.length - 1; i >= 0 && letzte.size < fenster; i--) letzte.add(aus[i]!); // die letzten `fenster` verschiedenen Namen
  const rang = (n: string) => (sicht.has(n) ? 2 : letzte.has(n) ? 1 : 0);
  const sortiert = basis
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const rx = rang(x.b.name);
      const ry = rang(y.b.name);
      if (rx !== ry) return rx - ry;
      const format = rx === 1 ? 0 : x.b.format[0] - y.b.format[0] || x.b.format[1] - y.b.format[1];
      return format || (alter.get(x.b.name) ?? -1) - (alter.get(y.b.name) ?? -1) || x.i - y.i;
    })
    .map((e) => e.b.name);
  const b = optionen.bevorzugt;
  return b !== undefined && sortiert.includes(b) ? [b, ...sortiert.filter((n) => n !== b)] : sortiert;
}

function stufeNamen(dateien: readonly WahlDatei[], stufe: StufeWahl, schluessel: string, breite?: number, hoehe?: number): Stufung[] {
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
  if (!soll || !mitMass.length) return dreh(pool).map((d) => ({ name: d.name, format: [0, 0] }));
  const sollVerh = breite! / hoehe!;
  const abstand = (d: WahlDatei) => Math.abs(Math.log(d.breite! / d.hoehe! / sollVerh));
  const ohneMass = pool.filter((d) => !mitMass.includes(d));
  // Klassenabstand zuerst (gleiche Klasse = 0), dann Naehe des Verhaeltnisses.
  const klasseAbstand = (d: WahlDatei) => Math.abs(KLASSEN_REIHE.indexOf(bildKlasse(d.breite!, d.hoehe!)!) - KLASSEN_REIHE.indexOf(soll));
  const sortiert = [...mitMass].sort((a, b) => klasseAbstand(a) - klasseAbstand(b) || abstand(a) - abstand(b) || (a.name < b.name ? -1 : 1));
  const besteKlasse = bildKlasse(sortiert[0]!.breite!, sortiert[0]!.hoehe!);
  const erste = sortiert.filter((d) => bildKlasse(d.breite!, d.hoehe!) === besteKlasse);
  const rest = sortiert.filter((d) => !erste.includes(d));
  return [
    ...dreh(erste).map((d): Stufung => ({ name: d.name, format: [0, 0] })),
    ...rest.map((d): Stufung => ({ name: d.name, format: [klasseAbstand(d), abstand(d)] })),
    ...ohneMass.map((d): Stufung => ({ name: d.name, format: [99, 0] })),
  ];
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
