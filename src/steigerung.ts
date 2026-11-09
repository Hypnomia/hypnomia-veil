// Steigerung der Zensur (PHASE-4-BAUPLAN Abschnitt 9, Entscheidung 101). Vertrag vom Orchestrator: Typen, Ablage-Schluessel,
// reine Funktionen `wirksameZonen`, `wirksameStufe`, `anzeigeStufe`. Auftrag S baut darauf das Zaehlen (Anstieg mit Zufall, Pause,
// Hintergrund-Handler src/hintergrund/steigerung.ts) und darf diese Datei ergaenzen; andere Auftraege lesen nur.
// Laufzeit-Abhaengigkeiten nur `zonenFuerPreset` (einstellungen.ts) und die Preset-Tabelle (presets.ts), beide rein und mit `.ts`-Endung importiert,
// damit die Einheitstests mit `node --experimental-strip-types` laufen. Ablage nur lokal (storage.local), kein Netzverkehr.

import { zonenFuerPreset, type Einstellungen, type Zone, type ZonenEinstellung } from './einstellungen.ts';
import { PRESETS, type Preset } from './presets.ts';

export const STEIGERUNG_SCHLUESSEL = 'steigerung';
export const MAX_STUFE = 4;
export type SteigerungStufe = 0 | 1 | 2 | 3 | 4;

// Anstieg: eine Stufe je etwa 15 gezaehlten Minuten, zufaellig je Stufe zwischen MIN und MAX (festgelegt beim letzten Anstieg).
export const ANSTIEG_MIN_MINUTEN = 10;
export const ANSTIEG_MAX_MINUTEN = 20;
// Eine Minute zaehlt, wenn der sichtbare Tab eine Erwachsenenseite ist oder in dieser Minute mindestens so viele neue Urteile
// `zensiert` hatte.
export const ZENSIERT_JE_MINUTE = 3;
// Abbau: eine Stufe je 12 Stunden echter Zeit ohne gezaehlte Minute (Uhrzeit, laeuft auch bei geschlossenem Browser).
export const ABBAU_MS = 12 * 60 * 60 * 1000;

export interface SteigerungStand {
  version: 1;
  // Stufe zum Zeitpunkt `abbauAb` (vor dem Abbau). Die wirksame Stufe rechnet `wirksameStufe` aus.
  stufe: SteigerungStufe;
  // Gezaehlte Minuten seit dem letzten Anstieg und die (zufaellige) Zahl Minuten bis zum naechsten.
  minutenSeitAnstieg: number;
  naechsterAnstiegNach: number;
  // Uhrzeit (ms), ab der der 12-Stunden-Abbau laeuft: die letzte gezaehlte Minute, verschoben um Zeit in Pause.
  abbauAb: number;
  // Uhr-Minute (Math.floor(ms / 60000)) der letzten gezaehlten Minute, gegen Doppelzaehlung aus mehreren Fenstern.
  letzteMinute: number;
  // Seit wann Pause an ist (ms) oder null. Endet die Pause, wird `abbauAb` um die Pausendauer nach hinten geschoben.
  pauseSeit: number | null;
}

export const STAND_START: SteigerungStand = {
  version: 1,
  stufe: 0,
  minutenSeitAnstieg: 0,
  naechsterAnstiegNach: 15,
  abbauAb: 0,
  letzteMinute: -1,
  pauseSeit: null,
};

const ganz = (x: unknown, min: number, max: number, standard: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : standard;

// Fuellt einen rohen storage-Wert zu einem gueltigen Stand auf (unbekannte Felder fallen weg).
export function vervollstaendigeStand(roh: unknown): SteigerungStand {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Partial<Record<keyof SteigerungStand, unknown>>;
  return {
    version: 1,
    stufe: ganz(r.stufe, 0, MAX_STUFE, 0) as SteigerungStufe,
    minutenSeitAnstieg: ganz(r.minutenSeitAnstieg, 0, 10_000, 0),
    naechsterAnstiegNach: ganz(r.naechsterAnstiegNach, ANSTIEG_MIN_MINUTEN, ANSTIEG_MAX_MINUTEN, 15),
    abbauAb: ganz(r.abbauAb, 0, Number.MAX_SAFE_INTEGER, 0),
    letzteMinute: ganz(r.letzteMinute, -1, Number.MAX_SAFE_INTEGER, -1),
    pauseSeit: typeof r.pauseSeit === 'number' && Number.isFinite(r.pauseSeit) ? ganz(r.pauseSeit, 0, Number.MAX_SAFE_INTEGER, 0) : null,
  };
}

// Wirksame Stufe zur Uhrzeit `jetzt`: je volle 12 Stunden seit `abbauAb` eine Stufe weniger. Waehrend einer Pause steht die Uhr
// (Pause zaehlt nicht als Abbau). Eine Uhr, die vor `abbauAb` steht, baut nichts ab.
export function wirksameStufe(stand: SteigerungStand, jetzt: number): SteigerungStufe {
  if (stand.stufe === 0) return 0;
  const bis = stand.pauseSeit !== null ? Math.min(jetzt, stand.pauseSeit) : jetzt;
  // Ein `abbauAb` in der Zukunft (Uhr zurueckgestellt) zaehlt wie jetzt: der Abbau beginnt dann von vorn.
  const abgebaut = Math.max(0, Math.floor((bis - Math.min(stand.abbauAb, jetzt)) / ABBAU_MS));
  return Math.max(0, stand.stufe - abgebaut) as SteigerungStufe;
}

// Fuer das Popup: wirksame Stufe und Millisekunden bis zur naechsten Absenkung (null bei Stufe 0 oder waehrend der Pause, dann steht die Uhr).
export function anzeigeStufe(stand: SteigerungStand, jetzt: number): { stufe: SteigerungStufe; bisAbsenkungMs: number | null; pausiert: boolean } {
  const stufe = wirksameStufe(stand, jetzt);
  const pausiert = stand.pauseSeit !== null;
  if (stufe === 0 || pausiert) return { stufe, bisAbsenkungMs: null, pausiert };
  const vergangen = Math.max(0, jetzt - Math.min(stand.abbauAb, jetzt));
  return { stufe, bisAbsenkungMs: ABBAU_MS - (vergangen % ABBAU_MS), pausiert };
}

// Zonen, die bei einer Stufe zusaetzlich gelten. Die Stufe hebt nur an, sie schaltet nie ab, was der Nutzer angeschaltet hat.
//   1: bedeckte Varianten von Brust, Po und Genitalien (Genitalien zusaetzlich zum Bauplan, Entscheidung 106)
//   2: zusaetzlich Gesicht, Augen, Mund (YuNet laeuft dann, Entscheidung 85)
//   3: zusaetzlich Bauch, Fuesse, Achseln, auch bedeckt
//   4: zusaetzlich jedes Bild und Video mit einer erkannten Frau ganz verdecken (`ganzVerdecken`)
const STUFE_ZONEN: Record<1 | 2 | 3, { an: Zone[]; bedeckt: Zone[] }> = {
  1: { an: ['breast', 'buttocks', 'genitals'], bedeckt: ['breast', 'buttocks', 'genitals'] },
  2: { an: ['face', 'eyes', 'mouth'], bedeckt: [] },
  3: { an: ['belly', 'feet', 'armpits'], bedeckt: ['belly', 'feet', 'armpits'] },
};

export interface WirksameZonen {
  zonen: Record<Zone, ZonenEinstellung>;
  ganzVerdecken: boolean;
}

// Was der Erkenner bekommt (statt `einstellungen.zonen`). `stufe` ist die wirksame Stufe; ohne Freischaltung `zensur:steigerung`
// gibt der Aufrufer 0. Pause regelt der Schleier selbst (dann wird gar nicht geprueft).
// Preset Augenbalken: die Steigerung (und damit auch strenge Zeiten, die nur die Stufe heben) fasst es nicht an. Es bleibt bei den Augen
// (Stufe 2 und 3 fuegen keine Zonen hinzu, Stufe 4 verdeckt kein ganzes Bild), denn das Preset zensiert nur den Augenbereich. Die Regel
// "nur Augen" steht an einer Stelle: `zonenFuerPreset` in src/einstellungen.ts (src/presets.ts); der Erkenner wendet sie ebenfalls an, damit
// auch eine Anfrage ohne Steigerung nur die Augen sucht. Der Popup-Abschnitt "My grip" sagt das (entrypoints/popup/texte.ts).
// Zensurbalken: die Steigerung wirkt wie gewohnt, die Augen bleiben zusaetzlich immer an.
export function wirksameZonen(einstellungen: Pick<Einstellungen, 'zonen'> & { preset?: Preset }, stufe: SteigerungStufe): WirksameZonen {
  if (einstellungen.preset && PRESETS[einstellungen.preset].augen === 'nur-balken') {
    return { zonen: zonenFuerPreset(einstellungen.preset, einstellungen.zonen), ganzVerdecken: false };
  }
  const zonen = Object.fromEntries(
    Object.entries(einstellungen.zonen).map(([z, e]) => [z, { ...e }]),
  ) as Record<Zone, ZonenEinstellung>;
  for (const s of [1, 2, 3] as const) {
    if (stufe < s) break;
    for (const z of STUFE_ZONEN[s].an) zonen[z] = { ...zonen[z], an: true };
    for (const z of STUFE_ZONEN[s].bedeckt) zonen[z] = { ...zonen[z], bedeckt: true };
  }
  return { zonen: zonenFuerPreset(einstellungen.preset, zonen), ganzVerdecken: stufe >= 4 };
}

// ---------- Zaehlen (Auftrag S) ----------

// Zahl gezaehlter Minuten bis zum naechsten Anstieg: gleichverteilt ANSTIEG_MIN_MINUTEN bis ANSTIEG_MAX_MINUTEN (ganze Minuten).
// `zufall` liefert [0, 1) wie Math.random (Tests stellen ihn).
export function naechsteSchwelle(zufall: () => number): number {
  const z = Math.min(0.999999, Math.max(0, zufall()));
  return ANSTIEG_MIN_MINUTEN + Math.floor(z * (ANSTIEG_MAX_MINUTEN - ANSTIEG_MIN_MINUTEN + 1));
}

// Zaehlt diese Minute? Erwachsenenseite im sichtbaren Tab oder mindestens ZENSIERT_JE_MINUTE neue Urteile `zensiert`.
export function minuteZaehlt(erwachsen: boolean, zensiert: number): boolean {
  return erwachsen || zensiert >= ZENSIERT_JE_MINUTE;
}

// Verbucht eine gezaehlte Minute zur Uhrzeit `jetzt`. Dieselbe Uhr-Minute zaehlt nur einmal (mehrere Fenster), waehrend der Pause
// zaehlt nichts. Zuerst wird der Abbau seit `abbauAb` eingerechnet (wer nach 12 Stunden zurueckkommt, beginnt eine Stufe tiefer und
// ohne angefangene Minuten), dann startet der 12-Stunden-Abbau neu und die Minute zaehlt Richtung naechster Stufe.
export function verbucheMinute(roh: SteigerungStand, jetzt: number, zufall: () => number): SteigerungStand {
  const stand = klemmeAufJetzt(roh, jetzt);
  const minute = Math.floor(jetzt / 60_000);
  if (minute === stand.letzteMinute || stand.pauseSeit !== null) return stand;
  const wirksam = wirksameStufe(stand, jetzt);
  let stufe: SteigerungStufe = wirksam;
  let minuten = wirksam < stand.stufe ? 0 : stand.minutenSeitAnstieg;
  let schwelle = stand.naechsterAnstiegNach;
  if (stufe < MAX_STUFE) {
    minuten += 1;
    if (minuten >= schwelle) {
      stufe = (stufe + 1) as SteigerungStufe;
      minuten = 0;
      schwelle = naechsteSchwelle(zufall);
    }
  }
  return { ...stand, stufe, minutenSeitAnstieg: minuten, naechsterAnstiegNach: schwelle, abbauAb: jetzt, letzteMinute: minute };
}

// Zeitpunkte aus der Zukunft (Uhr war vorgestellt und wurde zurueckgestellt) auf `jetzt` klemmen: sonst stuende der Abbau, bis die
// echte Zeit aufgeholt hat, und schon gezaehlte Minuten zaehlten nach dem Zurueckstellen erneut. Unveraendert: dasselbe Objekt.
export function klemmeAufJetzt(stand: SteigerungStand, jetzt: number): SteigerungStand {
  const minute = Math.floor(jetzt / 60_000);
  if (stand.abbauAb <= jetzt && stand.letzteMinute <= minute && (stand.pauseSeit === null || stand.pauseSeit <= jetzt)) return stand;
  return {
    ...stand,
    abbauAb: Math.min(stand.abbauAb, jetzt),
    letzteMinute: Math.min(stand.letzteMinute, minute),
    pauseSeit: stand.pauseSeit === null ? null : Math.min(stand.pauseSeit, jetzt),
  };
}

// Pause an oder aus. Waehrend der Pause steht der Abbau (Pause ist kein Weg um die Steigerung); beim Ende wird `abbauAb` um die
// Pausendauer verschoben. Eine Uhr, die waehrend der Pause zurueckgestellt wurde, verschiebt nichts.
export function setzePause(stand: SteigerungStand, an: boolean, jetzt: number): SteigerungStand {
  if (an) return stand.pauseSeit === null ? { ...stand, pauseSeit: jetzt } : stand;
  if (stand.pauseSeit === null) return stand;
  const dauer = Math.max(0, jetzt - stand.pauseSeit);
  return { ...stand, pauseSeit: null, abbauAb: stand.abbauAb > 0 ? stand.abbauAb + dauer : stand.abbauAb };
}

// Testhaken "Uhr vorstellen" (nur Testbau): alle gespeicherten Zeitpunkte um `vorMs` in die Vergangenheit schieben. Wirkt wie eine
// vorgestellte Uhr, ohne dass Hintergrund, Content-Script und Popup eine verstellte Uhr kennen muessen.
export function verschiebeZeit(stand: SteigerungStand, vorMs: number): SteigerungStand {
  const v = Math.max(0, Math.round(vorMs));
  return {
    ...stand,
    abbauAb: stand.abbauAb > 0 ? stand.abbauAb - v : 0,
    letzteMinute: stand.letzteMinute >= 0 ? stand.letzteMinute - Math.ceil(v / 60_000) : -1,
    pauseSeit: stand.pauseSeit === null ? null : stand.pauseSeit - v,
  };
}
