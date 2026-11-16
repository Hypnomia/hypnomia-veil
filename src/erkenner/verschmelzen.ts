// Flaechen verschmelzen (Phase 11, Etappe 1, Regeln O1, O2, S1). Reine Logik ohne Browser.
// Gleichrangige Flaechen, die sich schneiden, werden eine Huelle: das umschliessende Rechteck aller ihrer Flaechen (mit Rand), mit der
// staerksten Behandlung ihrer Ausgangsflaechen. Sicherheit (S1): die Huelle enthaelt jede Ausgangsbox ganz, sie ist nie kleiner und nie
// verschoben, ihre Behandlung nie schwaecher. Aufgelegte Flaechen (Mias Gesicht, Augenbalken) werden nie verschmolzen.
// Der Video-Teil (E1v) nutzt `huellenGruppen` und `huelleVon` als Kern.

import { staerksteBehandlung, type Behandlung } from '../presets.ts';
import type { Box, Flaeche } from '../nachrichten';

function schneidet(a: Box, b: Box): boolean {
  return Math.min(a[0] + a[2], b[0] + b[2]) > Math.max(a[0], b[0]) && Math.min(a[1] + a[3], b[1] + b[3]) > Math.max(a[1], b[1]);
}

// Umschliessendes Rechteck mehrerer Boxen (leer: [0, 0, 0, 0]).
export function huelleVon(boxen: readonly Box[]): Box {
  if (boxen.length === 0) return [0, 0, 0, 0];
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const [x, y, w, h] of boxen) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + w);
    y2 = Math.max(y2, y + h);
  }
  return [x1, y1, x2 - x1, y2 - y1];
}

// Gruppen von Indizes, deren Boxen sich schneiden (Schnittflaeche groesser null; blosses Beruehren zaehlt nicht), transitiv. Danach
// werden die Huellen der Gruppen gegeneinander geprueft und wieder zusammengefasst, bis keine Huelle mehr eine andere schneidet (eine
// Huelle kann erst durch das Verschmelzen eine weitere Box schneiden). Jeder Index kommt in genau einer Gruppe vor, auch allein; die
// Indizes einer Gruppe sind aufsteigend, die Gruppen nach ihrem kleinsten Index geordnet.
export function huellenGruppen(boxen: readonly Box[]): number[][] {
  let gruppen: number[][] = boxen.map((_, i) => [i]);
  let huellen: Box[] = boxen.map((b) => [b[0], b[1], b[2], b[3]]);
  for (;;) {
    let a = -1;
    let b = -1;
    suche: for (let i = 0; i < huellen.length; i++) {
      for (let j = i + 1; j < huellen.length; j++) {
        if (schneidet(huellen[i]!, huellen[j]!)) {
          a = i;
          b = j;
          break suche;
        }
      }
    }
    if (a < 0) break;
    gruppen[a] = [...gruppen[a]!, ...gruppen[b]!].sort((p, q) => p - q);
    huellen[a] = huelleVon([huellen[a]!, huellen[b]!]);
    gruppen = gruppen.filter((_, k) => k !== b);
    huellen = huellen.filter((_, k) => k !== b);
  }
  return gruppen.sort((p, q) => p[0]! - q[0]!);
}

function flaecheVon(b: Box): number {
  return b[2] * b[3];
}

// Verschmilzt gleichrangige Flaechen: je Gruppe (huellenGruppen) eine Flaeche mit der Huelle als Box, der staerksten Behandlung
// (src/presets.ts staerksteBehandlung; `standard` gilt fuer Flaechen ohne Behandlung) und der Zone der groessten Ausgangsflaeche. Einzelne Flaechen
// bleiben unveraendert. Aufgelegte Flaechen (Mias Gesicht, Augenbalken) werden nie verschmolzen, sie bleiben unveraendert hinten. Die Huelle uebernimmt
// `ersatz` der staerksten Ausgangsflaeche, falls eine eines traegt. Reihenfolge: nach dem kleinsten Index der Gruppe.
const AUFGELEGT: ReadonlySet<Behandlung> = new Set<Behandlung>(['mia-gesicht', 'balken']);
export function verschmelze(flaechen: readonly Flaeche[], standard: Behandlung): Flaeche[] {
  const gleich = flaechen.filter((f) => !(f.behandlung && AUFGELEGT.has(f.behandlung)));
  const oben = flaechen.filter((f) => f.behandlung && AUFGELEGT.has(f.behandlung));
  const huellen = huellenGruppen(gleich.map((f) => f.box)).map((idx): Flaeche => {
    const teile = idx.map((i) => gleich[i]!);
    if (teile.length === 1) return teile[0]!;
    const groesste = teile.reduce((m, f) => (flaecheVon(f.box) > flaecheVon(m.box) ? f : m));
    const behandlung = staerksteBehandlung(teile.map((f) => f.behandlung), standard);
    const ersatz = teile.find((f) => (f.behandlung ?? standard) === behandlung && f.ersatz)?.ersatz ?? teile.find((f) => f.ersatz)?.ersatz;
    return { zone: groesste.zone, box: huelleVon(teile.map((f) => f.box)), behandlung, ...(ersatz ? { ersatz } : {}) };
  });
  return [...huellen, ...oben];
}

// Erreichbare Schriftgroesse in einer Box, nach den Regeln von `zeichneWort` (src/erkenner/stile.ts): hoechstens 80 % der Breite, hoechstens die
// halbe Hoehe. Die Breite des Wortes ist hier nicht bekannt: Ansatz WORT_ZEICHEN_BREITE Schrifthoehen je Wort (ein mittellanges Wort).
export const WORT_ZEICHEN_BREITE = 4;
export function wortGroesse(b: Box): number {
  return Math.min((0.8 * b[2]) / WORT_ZEICHEN_BREITE, 0.5 * b[3]);
}

// Bestes freies Rechteck in `huelle` fuer ein Wort (groesste erreichbare Schriftgroesse), das von keinem Hindernis geschnitten wird. Ohne wirksames
// Hindernis die Huelle selbst; null, wenn die Hindernisse alles bedecken. Gleiche Schriftgroesse: die groessere Flaeche, dann das breitere, dann das obere, dann das linke.
export function groesstesFreiesRechteck(huelle: Box, hindernisse: readonly Box[]): Box | null {
  const [hx, hy, hw, hh] = huelle;
  const hx2 = hx + hw;
  const hy2 = hy + hh;
  const im = hindernisse
    .map((o): Box => [Math.max(o[0], hx), Math.max(o[1], hy), Math.min(o[0] + o[2], hx2) - Math.max(o[0], hx), Math.min(o[1] + o[3], hy2) - Math.max(o[1], hy)])
    .filter((o) => o[2] > 0 && o[3] > 0);
  if (im.length === 0) return huelle;
  const xs = [...new Set([hx, hx2, ...im.flatMap((o) => [o[0], o[0] + o[2]])])].sort((p, q) => p - q);
  let beste: Box | null = null;
  const besser = (k: Box): boolean => {
    if (!beste) return true;
    // Kriterium ist die erreichbare Schriftgroesse (wie zeichneWort sie rechnet), nicht die Flaeche; erst danach die Flaeche.
    const sk = wortGroesse(k);
    const sb = wortGroesse(beste);
    if (sk !== sb) return sk > sb;
    const fk = flaecheVon(k);
    const fb = flaecheVon(beste);
    if (fk !== fb) return fk > fb;
    if (k[2] !== beste[2]) return k[2] > beste[2];
    if (k[1] !== beste[1]) return k[1] < beste[1];
    return k[0] < beste[0];
  };
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const x1 = xs[i]!;
      const x2 = xs[j]!;
      // Hindernisse, die den Streifen x1 bis x2 schneiden: ihre y-Bereiche sperren; die groesste Luecke dazwischen ist der Kandidat.
      const sperren = im.filter((o) => o[0] < x2 && o[0] + o[2] > x1).map((o) => [o[1], o[1] + o[3]] as const).sort((p, q) => p[0] - q[0]);
      let y = hy;
      const luecke = (von: number, bis: number): void => {
        if (bis > von) {
          const k: Box = [x1, von, x2 - x1, bis - von];
          if (besser(k)) beste = k;
        }
      };
      for (const [s1, s2] of sperren) {
        luecke(y, s1);
        y = Math.max(y, s2);
      }
      luecke(y, hy2);
    }
  }
  return beste;
}

// Setzt `wortBox` an jeder Flaeche, auf der eine aufgelegte Flaeche (Mias Gesicht, Augenbalken) liegt: dort stehen Wort und Sticker im
// groessten freien Rechteck, nie unter dem Gesicht. Ohne aufgelegte Flaeche bleibt das Feld weg (die Flaeche selbst gilt). null: kein freies
// Rechteck, dann gibt es kein Wort und keinen Sticker, die Flaeche deckt weiter. Die Boxen der Flaechen aendern sich nie.
export function setzeWortBoxen(flaechen: readonly Flaeche[], aufgelegt: readonly Box[]): Flaeche[] {
  return flaechen.map((f) => {
    if (!aufgelegt.some((a) => schneidet(a, f.box))) return f;
    return { ...f, wortBox: groesstesFreiesRechteck(f.box, aufgelegt) };
  });
}
