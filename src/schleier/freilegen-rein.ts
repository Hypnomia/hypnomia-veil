// Freilegen (Auftrag F): reine Teile ohne DOM und ohne Imports, damit der Einheitstest sie unter Node laden kann.

// Kleinste Kante einer Flaeche, an der ein Knopf erscheint.
export const FREILEGEN_MIN_KANTE = 80;
// Hoechstens so viele Knoepfe gleichzeitig (die groessten Flaechen zuerst).
export const FREILEGEN_MAX_KNOEPFE = 24;
// Groesse des Knopfs und Abstand zur Ecke der Flaeche in CSS-Pixeln.
export const KNOPF_BREITE = 68;
export const KNOPF_HOEHE = 28;
export const KNOPF_RAND = 4;

export interface FlaechenInfo {
  art: string;
  urteil: string | null;
  // Vorschau-Bild der Erwachsenenseiten statt des Seitenbilds (Auftrag E): nie freilegen.
  ersetzt: boolean;
  freigelegt: boolean;
  breite: number;
  hoehe: number;
}

// Darf an dieser Flaeche ein Knopf stehen? Nur zensierte Bilder und Inline-Hintergruende ab 80 px Kante, keine eingesetzten Vorschauen,
// nie Videos und nie `verdeckt`; eine gerade freigelegte Flaeche braucht keinen Knopf.
export function istFreilegbar(f: FlaechenInfo): boolean {
  if (f.art !== 'bild' && f.art !== 'hintergrund') return false;
  if (f.urteil !== 'zensiert' || f.ersetzt || f.freigelegt) return false;
  return f.breite >= FREILEGEN_MIN_KANTE && f.hoehe >= FREILEGEN_MIN_KANTE;
}

export interface Rechteck {
  links: number;
  oben: number;
  rechts: number;
  unten: number;
}

export interface Anwaerter<T> {
  ziel: T;
  rechteck: Rechteck;
}

// Sichtbarer Teil eines Rechtecks im Fenster (null = nichts sichtbar).
export function beschneide(r: Rechteck, fensterBreite: number, fensterHoehe: number): Rechteck | null {
  const links = Math.max(0, r.links);
  const oben = Math.max(0, r.oben);
  const rechts = Math.min(fensterBreite, r.rechts);
  const unten = Math.min(fensterHoehe, r.unten);
  return rechts > links && unten > oben ? { links, oben, rechts, unten } : null;
}

// Position des Knopfs: obere rechte Ecke des sichtbaren Teils. null, wenn der sichtbare Teil den Knopf nicht fasst
// (dann scrollt die Seite erst weiter, bevor ein Knopf erscheint).
export function knopfPosition(sichtbar: Rechteck): { x: number; y: number } | null {
  const breite = sichtbar.rechts - sichtbar.links;
  const hoehe = sichtbar.unten - sichtbar.oben;
  if (breite < KNOPF_BREITE + 2 * KNOPF_RAND || hoehe < KNOPF_HOEHE + 2 * KNOPF_RAND) return null;
  return { x: sichtbar.rechts - KNOPF_BREITE - KNOPF_RAND, y: sichtbar.oben + KNOPF_RAND };
}

// Auswahl der Knoepfe: nur Flaechen mit mindestens 80 px Kante (ganze Flaeche, nicht der sichtbare Teil), die grossen zuerst, hoechstens `max`.
// Bei gleicher Flaeche gewinnt die weiter oben liegende, danach die weiter links (stabile Reihenfolge, damit Knoepfe beim Scrollen nicht tauschen).
export function waehleKnoepfe<T>(liste: Anwaerter<T>[], max = FREILEGEN_MAX_KNOEPFE): Anwaerter<T>[] {
  const flaeche = (r: Rechteck) => (r.rechts - r.links) * (r.unten - r.oben);
  return liste
    .filter((a) => a.rechteck.rechts - a.rechteck.links >= FREILEGEN_MIN_KANTE && a.rechteck.unten - a.rechteck.oben >= FREILEGEN_MIN_KANTE)
    .sort((a, b) => flaeche(b.rechteck) - flaeche(a.rechteck) || a.rechteck.oben - b.rechteck.oben || a.rechteck.links - b.rechteck.links)
    .slice(0, Math.max(0, max));
}

// Zeitrechnung: Millisekunden bis zum Ende (nie negativ) und ob die Frist abgelaufen ist.
export function restMs(bisMs: number, jetztMs: number): number {
  return Math.max(0, bisMs - jetztMs);
}
export function istAbgelaufen(bisMs: number, jetztMs: number): boolean {
  return jetztMs >= bisMs;
}
// Sekunden fuer Mias Satz (`{{seconds}}`): gerundet, mindestens 1.
export function sekundenFuerSatz(dauerMs: number): number {
  return Math.max(1, Math.round(dauerMs / 1000));
}
