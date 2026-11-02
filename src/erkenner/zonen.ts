// Zonen aus Treffern: Gesichtsbaender, Filter nach aktiven Zonen, Zusammenfuehren, Sicherheitsrand.
// Vorbild fuer das Zusammenfuehren ist clean_boxes des alten Tools (gleiche Zone verschmelzen, Verschachteltes in Kopf oder Gesicht weglassen).

import type { Einstellungen, Zone } from '../einstellungen';
import type { Box, Flaeche, Treffer } from '../nachrichten';

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
export function gesichtsZonen(gesicht: Box, breite: number, hoehe: number): Record<'face' | 'head' | 'eyes' | 'mouth', Box> {
  const [x, y, w, h] = gesicht;
  return {
    face: begrenzeBox(x, y, w, h, breite, hoehe),
    head: begrenzeBox(x - 0.35 * w, y - 0.65 * h, 1.7 * w, 1.95 * h, breite, hoehe),
    eyes: begrenzeBox(x + 0.05 * w, y + 0.22 * h, 0.9 * w, 0.24 * h, breite, hoehe),
    mouth: begrenzeBox(x + 0.2 * w, y + 0.66 * h, 0.6 * w, 0.24 * h, breite, hoehe),
  };
}

// Zonen, die laut Einstellungen gelten, aus den Modell-Treffern (Gesichtstreffer liefern auch Kopf, Augen, Mund).
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
      for (const z of ['face', 'head', 'eyes', 'mouth'] as const) {
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
