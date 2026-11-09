// Zonen aus Treffern: Gesichtsbaender, Filter nach aktiven Zonen, Zusammenfuehren, Sicherheitsrand.
// Vorbild fuer das Zusammenfuehren ist clean_boxes des alten Tools (gleiche Zone verschmelzen, Verschachteltes in Kopf oder Gesicht weglassen).

import type { Einstellungen, Zone } from '../einstellungen';
import { PRESETS, personenGruppen, type Preset } from '../presets.ts';
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

// Neigung der Augenlinie (rechtes zum linken Auge) in Bogenmass, Uhrzeigersinn positiv (y waechst nach unten), auf (-pi/2, pi/2] gebracht
// (ein auf dem Kopf stehendes Gesicht ergibt dieselbe Linie). Winkel unter AUGENBALKEN_MIN_WINKEL gelten als waagerecht und fehlen im Treffer.
export const AUGENBALKEN_MIN_WINKEL = (3 * Math.PI) / 180;
export function augenWinkel(g: YunetGesicht): number | undefined {
  const [re, le] = g.punkte;
  if (Math.hypot(le[0] - re[0], le[1] - re[1]) < 6) return undefined; // zu dicht: die Richtung ist Rauschen
  let w = Math.atan2(le[1] - re[1], le[0] - re[0]);
  if (w > Math.PI / 2) w -= Math.PI;
  else if (w <= -Math.PI / 2) w += Math.PI;
  return Math.abs(w) < AUGENBALKEN_MIN_WINKEL ? undefined : w;
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
  const ein = (zone: Treffer['zone'], b: Box, winkel?: number): Treffer => ({
    zone,
    bedeckt: false,
    score: g.score,
    box: begrenzeBox(b[0], b[1], b[2], b[3], breite, hoehe),
    quelle: 'yunet',
    ...(winkel === undefined ? {} : { winkel }),
  });
  const [x, y, w, h] = g.box;
  return [
    ein('face', g.box, augenWinkel(g)),
    ein('head', [x - 0.35 * w, y - 0.65 * h, 1.7 * w, 1.95 * h]),
    ein('eyes', yunetAugenBox(g), augenWinkel(g)),
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

// ---------- Stil Eye bar (Augenbalken) ----------
// Der Balken geht aus der Augenbox hervor (YuNet: Mitte zwischen den Augen, Breite 2,3 Augenabstaende; 320n: geschaetztes Band 0,9 der
// Gesichtsbreite) und ist etwas groesser, damit er wie ein echter Augenbalken wirkt und die Augen samt Lidern und Brauenansatz sicher
// deckt. YuNet: Hoehe Faktor 1,3 (die Augenbox ist hoch genug fuer die Augen, ein Balken darf Brauen und Lider noch mitnehmen), Breite
// Faktor 1,0 (2,3 Augenabstaende reichen schon ueber beide Augen hinaus, mehr wuerde bis zu den Schlaefen und darueber reichen).
// 320n-Rueckfall (YuNet fand das Gesicht nicht): das Band ist nur eine Schaetzung, sitzt im Mittel nicht genau und kennt weder Neigung
// noch Augenpunkte, ein zu knapper Balken liesse die Augen frei. Sicherheit zuerst, darum groessere Faktoren: Hoehe 1,6, Breite 1,2
// (Messung der Deckung der YuNet-Augenpunkte siehe Abgabe der Runde 2 und scripts/messung/yunet.mjs).
export const AUGENBALKEN_HOEHE_FAKTOR = 1.3;
export const AUGENBALKEN_BREITE_FAKTOR_YUNET = 1;
export const AUGENBALKEN_HOEHE_FAKTOR_320N = 1.6;
export const AUGENBALKEN_BREITE_FAKTOR_320N = 1.2;

interface BalkenKandidat { box: Box; winkel?: number; yunet: boolean }

// Balken aus einer Augenbox (Kommazahlen oder begrenzt). Mit Winkel: gedrehter Balken um die Mitte der Augenbox, `box` ist dann die
// umschliessende Box; ohne: achsenparallel, auf das Bild begrenzt. Die Drehung nutzt nur das, was YuNet liefert (die Augenpunkte);
// 320n kennt keine Augenpunkte, dort bleibt der Balken achsenparallel.
export function augenbalken(box: Box, yunet: boolean, winkel: number | undefined, breite: number, hoehe: number): Flaeche {
  const cx = box[0] + box[2] / 2;
  const cy = box[1] + box[3] / 2;
  const bw = box[2] * (yunet ? AUGENBALKEN_BREITE_FAKTOR_YUNET : AUGENBALKEN_BREITE_FAKTOR_320N);
  const bh = box[3] * (yunet ? AUGENBALKEN_HOEHE_FAKTOR : AUGENBALKEN_HOEHE_FAKTOR_320N);
  if (winkel === undefined || winkel === 0) {
    return { zone: 'eyes', box: begrenzeBox(cx - bw / 2, cy - bh / 2, bw, bh, breite, hoehe), behandlung: 'balken' };
  }
  const c = Math.abs(Math.cos(winkel));
  const s = Math.abs(Math.sin(winkel));
  const ub = bw * c + bh * s; // umschliessende Breite und Hoehe des gedrehten Rechtecks
  const uh = bw * s + bh * c;
  return {
    zone: 'eyes',
    box: begrenzeBox(cx - ub / 2, cy - uh / 2, ub, uh, breite, hoehe),
    balken: { mitte: [cx, cy], breite: bw, hoehe: bh, winkel },
    behandlung: 'balken',
  };
}

// Flaechen im Stil Eye bar: nur Augen aus Gesichtern (YuNet-Augen, bei 320n-Gesichtern das geschaetzte Band), unabhaengig von den
// Zonen-Schaltern. Kein Sicherheitsrand `rand`: der Balken bringt seinen eigenen Rand mit. Kein Gesicht, keine Flaeche (Bild bleibt frei).
export function berechneAugenbalken(treffer: readonly Treffer[], breite: number, hoehe: number): Flaeche[] {
  const kandidaten: BalkenKandidat[] = [];
  for (const t of treffer) {
    if (t.zone === 'face' && t.quelle !== 'yunet') {
      kandidaten.push({ box: gesichtsZonen(t.box, breite, hoehe).eyes, yunet: false });
    } else if (t.zone === 'eyes') {
      kandidaten.push({ box: t.box, winkel: t.winkel, yunet: t.quelle === 'yunet' });
    }
  }
  // Keine Doppelungen aussortieren: zwei Balken uebereinander sind in reinem Schwarz nicht zu sehen, und ein Vergleich der umschliessenden
  // Boxen koennte bei einem gedrehten Balken den Balken eines zweiten Gesichts in der Ecke der Huelle verlieren (Augen blieben frei).
  return kandidaten.map((k) => augenbalken(k.box, k.yunet, k.winkel, breite, hoehe));
}

// ---------- Mias Gesicht ----------
// Mindestrand um die Gesichtsbox, damit nichts vom fremden Gesicht neben Mias Gesicht durchscheint (Plan: Face-Box plus kleiner Rand). Der
// Sicherheitsrand `rand` der Einstellungen gilt auch hier: es wird nie weniger verdeckt als mit den Zonen-Flaechen (max aus beiden).
export const GESICHT_ZEICHEN_RAND = 0.1;

// Ein Rechteck um (cx, cy), `bw` x `bh`, bei Winkel gedreht (dann ist `box` die umschliessende Box, auf das Bild begrenzt).
function rechteck(cx: number, cy: number, bw: number, bh: number, winkel: number | undefined, breite: number, hoehe: number): Pick<Flaeche, 'box' | 'balken'> {
  if (winkel === undefined || winkel === 0) return { box: begrenzeBox(cx - bw / 2, cy - bh / 2, bw, bh, breite, hoehe) };
  const c = Math.abs(Math.cos(winkel));
  const s = Math.abs(Math.sin(winkel));
  const ub = bw * c + bh * s;
  const uh = bw * s + bh * c;
  return { box: begrenzeBox(cx - ub / 2, cy - uh / 2, ub, uh, breite, hoehe), balken: { mitte: [cx, cy], breite: bw, hoehe: bh, winkel } };
}

// Gesichtsflaechen fuer Mias Gesicht: je erkanntem Gesicht (YuNet: Box und Neigung der Augenlinie; 320n-Gesicht ohne YuNet-Partner:
// Box, achsenparallel) die Gesichtsbox plus GESICHT_ZEICHEN_RAND. Doppelte (Ueberdeckung ueber 0,8) fallen weg, das groessere bleibt.
export function berechneGesichter(treffer: readonly Treffer[], ersatz: Flaeche['ersatz'], breite: number, hoehe: number, rand = 0): Flaeche[] {
  const kand: Flaeche[] = [];
  const r = Math.max(GESICHT_ZEICHEN_RAND, rand);
  for (const t of treffer) {
    if (t.zone !== 'face') continue;
    const box = t.quelle === 'yunet' ? t.box : gesichtsZonen(t.box, breite, hoehe).face;
    const f = rechteck(box[0] + box[2] / 2, box[1] + box[3] / 2, box[2] * (1 + 2 * r), box[3] * (1 + 2 * r), t.quelle === 'yunet' ? t.winkel : undefined, breite, hoehe);
    kand.push({ zone: 'face', ...f, behandlung: 'mia-gesicht', ...(ersatz ? { ersatz } : {}) });
  }
  const behalten: Flaeche[] = [];
  for (const f of [...kand].sort((a, b) => flaecheVon(b.box) - flaecheVon(a.box))) {
    if (!behalten.some((k) => ueberdeckung(f.box, k.box) > 0.8)) behalten.push(f);
  }
  return behalten;
}

// ---------- Ganze Person ----------
// Aus allen Treffern eines Bildes (alle Klassen von 320n, auch bekleidete Teile und Gesichter, dazu YuNet) Gruppen bilden und je Gruppe die
// Huelle plus Rand als eine Flaeche liefern (src/presets.ts, personenGruppen). Nur Gruppen, in denen mindestens eine eingeschaltete Zone
// getroffen wurde (Schalter, bedeckt-Regel und Steigerung gelten wie sonst).
export function berechnePersonen(
  treffer: readonly Treffer[],
  zonen: Einstellungen['zonen'],
  behandlung: NonNullable<Flaeche['behandlung']>,
  breite: number,
  hoehe: number,
  rand = 0,
): Flaeche[] {
  // Jede Treffer-Box wird zuerst um den Sicherheitsrand der Einstellungen erweitert wie bei den Zonen-Flaechen: die Person ist nie kleiner
  // als das, was die Zonen allein deckten.
  const boxen = treffer.map((t) => begrenzeBox(t.box[0] - t.box[2] * rand, t.box[1] - t.box[3] * rand, t.box[2] * (1 + 2 * rand), t.box[3] * (1 + 2 * rand), breite, hoehe));
  const zaehlt = treffer.map((t) => aktiveZonenBoxen([t], zonen, breite, hoehe).length > 0);
  return personenGruppen(boxen, zaehlt, breite, hoehe).map((box) => {
    const drin = treffer.find((t, i) => zaehlt[i] && t.box[0] + t.box[2] / 2 >= box[0] && t.box[0] + t.box[2] / 2 <= box[0] + box[2] && t.box[1] + t.box[3] / 2 >= box[1] && t.box[1] + t.box[3] / 2 <= box[1] + box[3]);
    return { zone: drin?.zone ?? 'face', box, behandlung };
  });
}

export function berechneFlaechen(
  treffer: readonly Treffer[],
  einstellungen: Pick<Einstellungen, 'zonen' | 'rand'> & { preset?: Preset },
  breite: number,
  hoehe: number,
): Flaeche[] {
  const d = PRESETS[einstellungen.preset ?? 'mosaik'];
  if (d.augen === 'nur-balken') return berechneAugenbalken(treffer, breite, hoehe);
  if (d.person) return berechnePersonen(treffer, einstellungen.zonen, d.koerper!, breite, hoehe, einstellungen.rand);
  const mia = d.gesicht === 'mia-gesicht';
  let zonen = einstellungen.zonen;
  // Augenbalken uebernehmen die Augen; Mias Gesicht schluckt Augen und Mund (sie liegen im Gesicht). Abweichung vom Plan, der auch den Kopf nennt:
  // Head bleibt eine eigene Flaeche mit Koerper-Behandlung (Haare und Umgebung des Gesichts werden zusaetzlich verdeckt, Mias Gesicht liegt zuletzt darueber).
  // Das ist sicherer als den Kopf wegzulassen; der Hinweis HINWEIS_ZONEN_MIA nennt darum nur Eyes und Mouth.
  if (d.augen === 'balken-immer') zonen = { ...zonen, eyes: { an: false } };
  const gesichtTausch = mia && zonen.face.an;
  if (gesichtTausch) zonen = { ...zonen, face: { an: false }, eyes: { an: false }, mouth: { an: false } };
  const aktiv = aktiveZonenBoxen(treffer, zonen, breite, hoehe);
  const alle = mitRand(fuehreZusammen(aktiv), einstellungen.rand, breite, hoehe).map((f): Flaeche => {
    const b = f.zone === 'face' ? d.gesicht : d.koerper;
    return b ? { ...f, behandlung: b } : f;
  });
  if (gesichtTausch) alle.push(...berechneGesichter(treffer, d.koerper ?? undefined, breite, hoehe, einstellungen.rand));
  if (d.augen === 'balken-immer') alle.push(...berechneAugenbalken(treffer, breite, hoehe));
  return alle;
}
