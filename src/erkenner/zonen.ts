// Zonen aus Treffern: Gesichtsbaender, Filter nach aktiven Zonen, Zusammenfuehren, Sicherheitsrand.
// Vorbild fuer das Zusammenfuehren ist clean_boxes des alten Tools (gleiche Zone verschmelzen, Verschachteltes in Kopf oder Gesicht weglassen).

import type { Einstellungen, Zone } from '../einstellungen';
import type { Box, Flaeche, Treffer } from '../nachrichten';
import type { YunetGesicht } from './yunet';

// Gleiche Zone: Vereinigung, wenn IoU ueber diesem Wert oder Ueberdeckung ueber dem zweiten Wert.
const ZUSAMMEN_IOU = 0.3;
const ZUSAMMEN_UEBERDECKUNG = 0.6;
// Kleine Box zu mehr als diesem Anteil in einer deckenden Zone (Kopf, Gesicht): weglassen.
const SCHLUCK_ANTEIL = 0.8;
const DECKENDE_ZONEN: ReadonlySet<Zone> = new Set<Zone>(['head', 'face']);

function flaecheVon(b: Box): number {
  return b[2] * b[3];
}

function schnittflaeche(a: Box, b: Box): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x2 <= x1 || y2 <= y1 ? 0 : (x2 - x1) * (y2 - y1);
}

function iouVon(a: Box, b: Box): number {
  const s = schnittflaeche(a, b);
  return s === 0 ? 0 : s / (flaecheVon(a) + flaecheVon(b) - s);
}

// Anteil von a, der in b liegt (0 bis 1).
function ueberdeckung(a: Box, b: Box): number {
  return schnittflaeche(a, b) / Math.max(1, flaecheVon(a));
}

function vereinigung(a: Box, b: Box): Box {
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x1, y1, x2 - x1, y2 - y1];
}

// Auf das Bild begrenzen, auf ganze Pixel runden; Ergebnis hat mindestens 1 x 1.
export function begrenzeBox(x: number, y: number, w: number, h: number, breite: number, hoehe: number): Box {
  const x1 = Math.min(Math.max(0, Math.floor(x)), Math.max(0, breite - 1));
  const y1 = Math.min(Math.max(0, Math.floor(y)), Math.max(0, hoehe - 1));
  const x2 = Math.min(breite, Math.max(x1 + 1, Math.ceil(x + w)));
  const y2 = Math.min(hoehe, Math.max(y1 + 1, Math.ceil(y + h)));
  return [x1, y1, x2 - x1, y2 - y1];
}

// Aus einer Gesichtsbox die Zonen Kopf, Augen und Mund ableiten (Baender sind eine Schaetzung, im Messlauf anschauen).
// Augen 18 bis 42 %, Mund 62 bis 86 % der Boxhoehe: gegenueber 22 bis 46 % und 66 bis 90 % um 0,04 nach oben verschoben,
// weil die 320n-Box im Mittel tiefer sitzt als das Gesicht (MESSUNG-PHASE-2 Abschnitt 8.3 und 8.4).
export function gesichtsZonen(gesicht: Box, breite: number, hoehe: number): Record<'face' | 'head' | 'eyes' | 'mouth', Box> {
  const [x, y, w, h] = gesicht;
  return {
    face: begrenzeBox(x, y, w, h, breite, hoehe),
    head: begrenzeBox(x - 0.35 * w, y - 0.65 * h, 1.7 * w, 1.95 * h, breite, hoehe),
    eyes: begrenzeBox(x + 0.05 * w, y + 0.18 * h, 0.9 * w, 0.24 * h, breite, hoehe),
    mouth: begrenzeBox(x + 0.2 * w, y + 0.62 * h, 0.6 * w, 0.24 * h, breite, hoehe),
  };
}

// Augenbox aus YuNet-Punkten (Formeln wie engine/detector.py des alten Tools): Mitte zwischen den Augen, Breite 2,3 mal Augenabstand
// (Abstand mindestens 6 px), Hoehe mindestens 0,24 Gesichtshoehe und 0,75 Augenabstand. Kommazahlen, nicht begrenzt.
export function yunetAugenBox(g: YunetGesicht): Box {
  const [re, le] = g.punkte;
  const abstand = Math.max(6, Math.hypot(le[0] - re[0], le[1] - re[1]));
  const bw = abstand * 2.3;
  const bh = Math.max(g.box[3] * 0.24, abstand * 0.75);
  return [(re[0] + le[0]) / 2 - bw / 2, (re[1] + le[1]) / 2 - bh / 2, bw, bh];
}

// Mundbox: Mitte der Mundwinkel, Breite 2 mal Winkelabstand (mindestens 10 px), Hoehe mindestens 0,22 Gesichtshoehe
// und die halbe Boxbreite (wie im alten Tool und im Messwerkzeug).
export function yunetMundBox(g: YunetGesicht): Box {
  const rm = g.punkte[3];
  const lm = g.punkte[4];
  const bw = Math.max(10, Math.hypot(lm[0] - rm[0], lm[1] - rm[1])) * 2;
  const bh = Math.max(g.box[3] * 0.22, bw * 0.5);
  return [(rm[0] + lm[0]) / 2 - bw / 2, (rm[1] + lm[1]) / 2 - bh / 2, bw, bh];
}

// Treffer eines YuNet-Gesichts: Gesicht, Kopf, Augen und Mund. Der Kopf wird aus der unbegrenzten YuNet-Box gerechnet und erst danach
// auf das Bild begrenzt (wie im alten Tool), nicht aus der schon begrenzten Gesichtsbox: sonst wird er an einem Bildrand zu klein.
export function yunetTreffer(g: YunetGesicht, breite: number, hoehe: number): Treffer[] {
  const ein = (zone: Treffer['zone'], b: Box): Treffer => ({
    zone,
    bedeckt: false,
    score: g.score,
    box: begrenzeBox(b[0], b[1], b[2], b[3], breite, hoehe),
    quelle: 'yunet',
  });
  const [x, y, w, h] = g.box;
  return [
    ein('face', g.box),
    ein('head', [x - 0.35 * w, y - 0.65 * h, 1.7 * w, 1.95 * h]),
    ein('eyes', yunetAugenBox(g)),
    ein('mouth', yunetMundBox(g)),
  ];
}

// Ab dieser Ueberdeckung gilt ein 320n-Gesicht als dasselbe Gesicht wie ein YuNet-Gesicht.
export const GESICHT_GLEICH_IOU = 0.3;

// 320n-Treffer plus YuNet-Gesichter: Gesichter beider Modelle werden eins zu eins gepaart (Paare mit IoU ab 0,3, groesste IoU zuerst);
// ein gepaartes 320n-Gesicht entfaellt (YuNet ist genauer). Jedes YuNet-Gesicht verbraucht hoechstens ein 320n-Gesicht, uebrige
// 320n-Gesichter behalten die geschaetzten Baender. Alle YuNet-Gesichter kommen dazu.
export function kombiniereGesichter(treffer: readonly Treffer[], yunet: readonly YunetGesicht[], breite: number, hoehe: number): Treffer[] {
  // Die YuNet-Box kann ueber den Bildrand reichen, die 320n-Box nicht: erst begrenzen, dann vergleichen.
  const begrenzt = yunet.map((g) => begrenzeBox(g.box[0], g.box[1], g.box[2], g.box[3], breite, hoehe));
  const paare: { n: number; y: number; iou: number }[] = [];
  treffer.forEach((t, n) => {
    if (t.zone !== 'face') return;
    begrenzt.forEach((b, y) => {
      const wert = iouVon(t.box, b);
      if (wert >= GESICHT_GLEICH_IOU) paare.push({ n, y, iou: wert });
    });
  });
  paare.sort((p, q) => q.iou - p.iou);
  const verbraucht = new Set<number>();
  const vergeben = new Set<number>();
  for (const p of paare) {
    if (verbraucht.has(p.n) || vergeben.has(p.y)) continue;
    verbraucht.add(p.n);
    vergeben.add(p.y);
  }
  const rest = treffer.filter((_, n) => !verbraucht.has(n));
  return [...rest, ...yunet.flatMap((g) => yunetTreffer(g, breite, hoehe))];
}

// Zonen, die laut Einstellungen gelten, aus den Modell-Treffern (Gesichtstreffer aus 320n liefern auch Kopf, Augen, Mund;
// aus YuNet nur das Gesicht, Kopf, Augen und Mund kommen dort als eigene Treffer).
export function aktiveZonenBoxen(
  treffer: readonly Treffer[],
  zonen: Einstellungen['zonen'],
  breite: number,
  hoehe: number,
): Flaeche[] {
  const roh: Flaeche[] = [];
  for (const t of treffer) {
    if (t.zone === 'face') {
      const abgeleitet = gesichtsZonen(t.box, breite, hoehe);
      const abgeleiteteZonen = t.quelle === 'yunet' ? (['face'] as const) : (['face', 'head', 'eyes', 'mouth'] as const);
      for (const z of abgeleiteteZonen) {
        if (zonen[z].an) roh.push({ zone: z, box: abgeleitet[z] });
      }
      continue;
    }
    const einst = zonen[t.zone];
    if (!einst.an) continue;
    if (t.bedeckt && !einst.bedeckt) continue;
    roh.push({ zone: t.zone, box: begrenzeBox(t.box[0], t.box[1], t.box[2], t.box[3], breite, hoehe) });
  }
  return roh;
}

// Ein Durchgang: Verschmelzen und Verschachteltes weglassen (grosse Flaechen zuerst).
function einDurchgang(flaechen: readonly Flaeche[]): Flaeche[] {
  const sortiert = [...flaechen].sort((a, b) => flaecheVon(b.box) - flaecheVon(a.box));
  const behalten: Flaeche[] = [];
  for (const r of sortiert) {
    let weg = false;
    for (const k of behalten) {
      if (k.zone === r.zone) {
        if (iouVon(r.box, k.box) > ZUSAMMEN_IOU || ueberdeckung(r.box, k.box) > ZUSAMMEN_UEBERDECKUNG) {
          k.box = vereinigung(k.box, r.box);
          weg = true;
          break;
        }
      } else if (DECKENDE_ZONEN.has(k.zone) && ueberdeckung(r.box, k.box) > SCHLUCK_ANTEIL) {
        weg = true;
        break;
      }
    }
    if (!weg) behalten.push({ zone: r.zone, box: [...r.box] as Box });
  }
  return behalten;
}

// Wiederholt die Durchgaenge bis zum Fixpunkt: waechst eine Box durch Vereinigung, muss sie gegen die frueher
// verglichenen Boxen erneut geprueft werden (sonst ist das Zusammenfuehren nicht transitiv).
// Eine Box aendert sich nur, wenn eine andere wegfaellt; gleiche Anzahl heisst also: nichts mehr zu tun.
export function fuehreZusammen(flaechen: readonly Flaeche[]): Flaeche[] {
  let aktuell = einDurchgang(flaechen);
  for (;;) {
    const naechste = einDurchgang(aktuell);
    if (naechste.length === aktuell.length) return naechste;
    aktuell = naechste;
  }
}

// Sicherheitsrand: `rand` mal Boxgroesse je Seite, auf das Bild begrenzt.
export function mitRand(flaechen: readonly Flaeche[], rand: number, breite: number, hoehe: number): Flaeche[] {
  return flaechen.map((f) => {
    const dx = f.box[2] * rand;
    const dy = f.box[3] * rand;
    return { zone: f.zone, box: begrenzeBox(f.box[0] - dx, f.box[1] - dy, f.box[2] + 2 * dx, f.box[3] + 2 * dy, breite, hoehe) };
  });
}

export function berechneFlaechen(
  treffer: readonly Treffer[],
  einstellungen: Pick<Einstellungen, 'zonen' | 'rand'>,
  breite: number,
  hoehe: number,
): Flaeche[] {
  const aktiv = aktiveZonenBoxen(treffer, einstellungen.zonen, breite, hoehe);
  return mitRand(fuehreZusammen(aktiv), einstellungen.rand, breite, hoehe);
}
