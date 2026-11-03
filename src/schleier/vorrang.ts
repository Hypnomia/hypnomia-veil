// Vorrang in der Warteschlange (PHASE-3-BAUPLAN Auftrag V): fuenf Stufen, innerhalb der Stufe in Einreihungsfolge.
//   1 sichtbar und gross, 2 sichtbar und klein, 3 nah und gross, 4 nah und klein, 5 Rest.
// Reine Logik ohne Werte aus anderen Modulen (laeuft in den Einheitstests ohne Browser). Grenzwerte kommen als Parameter herein,
// ihre Konstanten stehen in konstanten.ts.

export type Stufe = 1 | 2 | 3 | 4 | 5;

export interface Rechteck {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export function vorrangStufe(sichtbar: boolean, nah: boolean, klein: boolean): Stufe {
  if (sichtbar) return klein ? 2 : 1;
  if (nah) return klein ? 4 : 3;
  return 5;
}

// Ein Durchlauf, keine Sortierung: liefert den Kandidaten mit der niedrigsten Stufe, bei gleicher Stufe den frueheren.
// stufeVon liefert 0 (oder weniger) fuer "ueberspringen". Stufe 1 beendet den Durchlauf sofort (besser geht es nicht).
export function waehleNachVorrang<T>(kandidaten: Iterable<T>, stufeVon: (kandidat: T) => number): T | null {
  let bester: T | null = null;
  let besteStufe = Infinity;
  for (const k of kandidaten) {
    const s = stufeVon(k);
    if (s <= 0 || s >= besteStufe) continue;
    bester = k;
    besteStufe = s;
    if (s <= 1) break;
  }
  return bester;
}

// Dargestellte Groesse: die laengste Seite liegt unter der Grenze. Ohne Flaeche (nicht dargestellt) gilt das Element nicht als klein.
export function istKleinDargestellt(r: Pick<Rechteck, 'width' | 'height'>, grenzePx: number): boolean {
  return r.width > 0 && r.height > 0 && Math.max(r.width, r.height) < grenzePx;
}

// Liegt das Rechteck im Fenster, das oben und unten um `faktor` Fensterhoehen erweitert ist (0 = Sichtbereich selbst)? Seitlich ohne Rand,
// wie der IntersectionObserver mit Rand `<faktor * 100>% 0px`.
export function liegtImBereich(r: Rechteck, fensterHoehe: number, fensterBreite: number, faktor: number): boolean {
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > -faktor * fensterHoehe &&
    r.top < (1 + faktor) * fensterHoehe &&
    r.right > 0 &&
    r.left < fensterBreite
  );
}

// Zwei IntersectionObserver unter einer Oberflaeche: `beiSicht` meldet den Sichtbereich, `beiNah` den erweiterten Bereich (nahRand).
export class SichtBeobachter {
  sicht: IntersectionObserver;
  nah: IntersectionObserver;

  constructor(beiSicht: IntersectionObserverCallback, beiNah: IntersectionObserverCallback, nahRand: string) {
    this.sicht = new IntersectionObserver(beiSicht);
    this.nah = new IntersectionObserver(beiNah, { rootMargin: nahRand });
  }

  observe(el: Element): void {
    this.sicht.observe(el);
    this.nah.observe(el);
  }

  unobserve(el: Element): void {
    this.sicht.unobserve(el);
    this.nah.unobserve(el);
  }

  disconnect(): void {
    this.sicht.disconnect();
    this.nah.disconnect();
  }
}
