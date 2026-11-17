// Kennung je Kachel und Gedaechtnis der vergebenen Ersatzbilder (Phase 11 Etappe 2, Regeln O3 und O4). Reine Logik ohne Browser-Zugriff
// (Node-testbar); die Zugriffe auf Seite und Element liefert src/schleier/vorschau.ts als Rueckrufe.
// - Kennungen: unterscheidet der Schluessel einer Kachel (Video-Kennung aus dem Link, sonst Quelle oder Link ohne Abfrage) sie wirklich von ihren
//   Nachbarn, bleibt er. Sonst (gleiche Platzhalter-Quelle, Link ohne Kennung, `leer`) bekommt jedes Element seine eigene Kennung und damit sein
//   eigenes Ersatzbild. Auch bei gleicher echter Video-Kennung gehoert der Schluessel nur der ersten Kachel, die noch in der Seite ist (O3 geht vor): eine
//   zweite, gleichzeitig verbundene Kachel desselben Videos bekommt eine eigene Kennung und ein anderes Bild.
// - Gedaechtnis: welcher Schluessel welches Pack-Bild bekam und wann es zuletzt vergeben oder gebraucht wurde. Daraus entsteht die Ausschlussliste fuer die Wahl
//   (src/pack/wahl.ts): alle vergebenen Namen, aelteste Vergabe zuerst; die Namen auf Kacheln im Blick bestimmt vorschau.ts. Die Namen der Pack-Bilder
//   bleiben im Content-Script.

// Muster fuer die Kennung eines Videos in einer Adresse (alle Seiten, die der Schleier kennt).
const KENNUNG_MUSTER: readonly RegExp[] = [/[?&]viewkey=([\w-]+)/i, /\/videos\/([^/?#]+)/i, /\/video[-.]?([\w]+)\//i, /\/video\/([\w-]+)/i, /\/post\/([\w-]+)/i];

function ausAdresse(adresse: string): string | null {
  for (const muster of KENNUNG_MUSTER) {
    const t = muster.exec(adresse);
    if (t?.[1]) return t[1];
  }
  return null;
}

// Kennung eines Videos aus dem Link. Haengt der Link die Zieladresse prozentkodiert in den Parameter `url` (xHamster-Premium:
// `/fh/out?url=%2Fvideos%2F<kennung>%3Futm...`), wird der Parameter entschluesselt und dort gesucht.
export function videoKennung(href: string): string | null {
  const direkt = ausAdresse(href);
  if (direkt) return direkt;
  const p = /[?&]url=([^&#]+)/i.exec(href);
  if (!p?.[1]) return null;
  try {
    return ausAdresse(decodeURIComponent(p[1]));
  } catch {
    return null;
  }
}

export interface KachelBeleg {
  // Der Schluessel, den die Kachel heute bekaeme: `video:<kennung>` (nur mit echter Video-Kennung im Link), sonst Quelle oder Link ohne Abfrage, sonst `leer`.
  kandidat: string;
}

interface Besitz {
  besitzer: WeakRef<object>;
}

export class Kennungen {
  private readonly eigene = new WeakMap<object, string>();
  private readonly belege = new Map<string, Besitz>();
  private zaehler = 0;
  private readonly lebendig: (el: object) => boolean;
  private readonly max: number;

  // `lebendig`: ist das Element noch in der Seite? Ein Besitzer, der weg ist, gibt seinen Schluessel frei (neu gebaute Kachel desselben Videos).
  constructor(lebendig: (el: object) => boolean = () => true, max = 4000) {
    this.lebendig = lebendig;
    this.max = max;
  }

  // Idempotent je Element: derselbe Beleg ergibt dieselbe Kennung, und ein Element, das einmal eine eigene Kennung bekam, behaelt sie.
  kennung(el: object, beleg: KachelBeleg): string {
    const eigen = this.eigene.get(el);
    if (eigen !== undefined) return eigen;
    const b = this.belege.get(beleg.kandidat);
    if (!b) return this.beanspruche(el, beleg.kandidat);
    const besitzer = b.besitzer.deref();
    if (besitzer === el) return beleg.kandidat;
    if (besitzer === undefined || !this.lebendig(besitzer)) return this.beanspruche(el, beleg.kandidat);
    // Der Kandidat gehoert einer anderen Kachel, die noch da ist (zweite Kachel desselben Videos, gleiche Quelle, gleicher Platzhalter-Link): eigene Kennung.
    const neu = `kachel:${++this.zaehler}`;
    this.eigene.set(el, neu);
    return neu;
  }

  private beanspruche(el: object, kandidat: string): string {
    if (!this.belege.has(kandidat) && this.belege.size >= this.max) this.belege.delete(this.belege.keys().next().value as string);
    this.belege.set(kandidat, { besitzer: new WeakRef(el) });
    return kandidat;
  }

  get anzahl(): number {
    return this.belege.size;
  }
}

interface Vergabe {
  name: string;
  stempel: number;
}

export class KachelGedaechtnis {
  private readonly vergaben = new Map<string, Vergabe>();
  private zaehler = 0;

  private readonly max: number;

  constructor(max = 4000) {
    this.max = max;
  }

  get anzahl(): number {
    return this.vergaben.size;
  }

  // Der laufende Stempel: alles, was nach einem Stand vergeben oder gebraucht wurde, hat einen groesseren.
  get stempel(): number {
    return this.zaehler;
  }

  name(schluessel: string): string | undefined {
    return this.vergaben.get(schluessel)?.name;
  }

  stempelVon(schluessel: string): number {
    return this.vergaben.get(schluessel)?.stempel ?? 0;
  }

  // Schluessel bekommt dieses Bild (neu oder geaendert) und gilt als eben gebraucht.
  merke(schluessel: string, name: string): void {
    this.vergaben.delete(schluessel); // Einfuegereihenfolge = aelteste Nutzung zuerst
    this.vergaben.set(schluessel, { name, stempel: ++this.zaehler });
    while (this.vergaben.size > this.max) this.vergaben.delete(this.vergaben.keys().next().value as string);
  }

  // Der Schluessel wurde wieder gebraucht (Neu-Bewertung, Wiedereinsetzen): zaehlt als eben gezeigt.
  beruehre(schluessel: string): void {
    const v = this.vergaben.get(schluessel);
    if (v) this.merke(schluessel, v.name);
  }

  vergiss(schluessel: string): void {
    this.vergaben.delete(schluessel);
  }

  leere(): void {
    this.vergaben.clear();
  }

  // Namen der vergebenen Bilder, je Name einmal, das am laengsten nicht vergebene zuerst (Reihenfolge der Vergabe; ein Name auf mehreren Schluesseln
  // zaehlt mit seiner juengsten Vergabe).
  ausschluss(): string[] {
    const je = new Map<string, number>();
    for (const v of this.vergaben.values()) je.set(v.name, Math.max(je.get(v.name) ?? 0, v.stempel));
    return [...je.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }

  // Namen auf Kacheln, die gerade im Blickfeld stehen (je Name einmal). `sichtbar(schluessel)`: steht eine Kachel mit diesem Schluessel im Blickfeld?
  sichtbareNamen(sichtbar: (schluessel: string) => boolean): string[] {
    const aus = new Set<string>();
    for (const [schluessel, v] of this.vergaben) if (sichtbar(schluessel)) aus.add(v.name);
    return [...aus];
  }
}
