// Reine Logik der Meldungen (Auftrag M, Phase 5 Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 5). Ohne Browser-Aufrufe, damit
// Einheitstests sie mit `node --experimental-strip-types` laden. Der Hintergrund (src/hintergrund/meldungen.ts) haelt den Stand in
// storage.local und ruft diese Funktionen nacheinander auf; die Seite (meldungen.ts) nutzt nur Satz- und Posenwahl.
//
// Anlaesse: `zensiert` (zensierte Bilder heute erreichen 50, 100, ...), `erwachsen` (je 20 Minuten auf Erwachsenenseiten heute), `stufe` (die
// wirksame Stufe der Steigerung steigt), `streng` (eine strenge Zeit beginnt). Ein Anlass, der nicht gezeigt werden kann, wartet hoechstens
// 30 Minuten (je Anlass hoechstens einer wartend); Vorrang stufe, streng, zensiert, erwachsen; hoechstens eine Meldung je 10 Minuten.
import type { StrengeZeit } from '../einstellungen.ts';
import { MELDUNG_ERWACHSEN_MS, MELDUNG_MIN_ABSTAND_MS, MELDUNG_ZENSIERT_SCHRITT } from '../kontrolle/grenzen.ts';
import { istStrengeZeit } from '../kontrolle/streng.ts';
import type { MeldungAnlass } from '../nachrichten.ts';

export const WARTE_MAX_MS = 30 * 60_000;
export const VORRANG: readonly MeldungAnlass[] = ['stufe', 'streng', 'zensiert', 'erwachsen'];
export const MELDUNG_STAND_SCHLUESSEL = 'meldungStand';

// Gruppe der Saetze und Pose des Mini-Chibis je Anlass (Pose-Namen wie CHIBI_POSEN in src/chibi.ts).
export const GRUPPE_JE_ANLASS = {
  zensiert: 'meldungZensiert',
  stufe: 'meldungStufe',
  erwachsen: 'meldungErwachsen',
  streng: 'meldungStreng',
} as const satisfies Record<MeldungAnlass, string>;
export const POSE_JE_ANLASS = { zensiert: 'jubeln', stufe: 'zwinkern', erwachsen: 'arme', streng: 'schild' } as const satisfies Record<MeldungAnlass, string>;

export interface Wartend {
  seit: number;
  zahl?: number;
}

export interface MeldungsStand {
  version: 1;
  // Ortszeit-Tag (JJJJ-MM-TT), auf den sich die Tageszaehler beziehen.
  tag: string;
  zensiert: number;
  // Wie viele Schritte (je 50) schon als Anlass gezaehlt sind (floor(zensiert / 50) nach dem letzten Anlass).
  zensiertSchritte: number;
  erwachsenMs: number;
  erwachsenSchritte: number;
  // Uhr-Minute der letzten gezaehlten Erwachsenen-Minute (mehrere Fenster in derselben Minute zaehlen einmal).
  erwachsenMinute: number;
  // Zuletzt gesehene wirksame Stufe der Steigerung (null: noch nie gesehen, dann loest der erste Wert nichts aus).
  stufe: number | null;
  // Beginn (ms) der strengen Zeit, fuer die schon gemeldet ist, und der Zeitpunkt der letzten Auswertung in ihr (null: keine).
  strengKennung: string | null;
  strengZuletzt: number;
  // Zeitpunkt der letzten gezeigten Meldung (ms, 0: nie).
  zuletzt: number;
  wartend: Partial<Record<MeldungAnlass, Wartend>>;
}

export interface Faellig {
  anlass: MeldungAnlass;
  zahl?: number;
}

const ganz = (x: unknown, min: number, max: number, standard: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : standard;

export function tagKennung(d: Date): string {
  const z = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function leererStand(jetzt: Date): MeldungsStand {
  return {
    version: 1,
    tag: tagKennung(jetzt),
    zensiert: 0,
    zensiertSchritte: 0,
    erwachsenMs: 0,
    erwachsenSchritte: 0,
    erwachsenMinute: -1,
    stufe: null,
    strengKennung: null,
    strengZuletzt: 0,
    zuletzt: 0,
    wartend: {},
  };
}

// Fuellt einen rohen storage-Wert zu einem gueltigen Stand auf (unbekannte Felder fallen weg).
export function vervollstaendigeStand(roh: unknown, jetzt: Date): MeldungsStand {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const leer = leererStand(jetzt);
  const wartend: MeldungsStand['wartend'] = {};
  const w = r.wartend && typeof r.wartend === 'object' ? (r.wartend as Record<string, unknown>) : {};
  for (const anlass of VORRANG) {
    const eintrag = w[anlass] as Record<string, unknown> | undefined;
    if (!eintrag || typeof eintrag !== 'object') continue;
    if (typeof eintrag.seit !== 'number' || !Number.isFinite(eintrag.seit) || eintrag.seit < 0) continue;
    const seit = Math.round(eintrag.seit);
    wartend[anlass] = typeof eintrag.zahl === 'number' && Number.isFinite(eintrag.zahl) ? { seit, zahl: Math.max(0, Math.round(eintrag.zahl)) } : { seit };
  }
  return {
    version: 1,
    tag: typeof r.tag === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.tag) ? r.tag : leer.tag,
    zensiert: ganz(r.zensiert, 0, 1_000_000, 0),
    zensiertSchritte: ganz(r.zensiertSchritte, 0, 1_000_000, 0),
    erwachsenMs: ganz(r.erwachsenMs, 0, 10 * 86_400_000, 0),
    erwachsenSchritte: ganz(r.erwachsenSchritte, 0, 1_000_000, 0),
    erwachsenMinute: ganz(r.erwachsenMinute, -1, Number.MAX_SAFE_INTEGER, -1),
    stufe: typeof r.stufe === 'number' && Number.isFinite(r.stufe) ? ganz(r.stufe, 0, 4, 0) : null,
    strengKennung: typeof r.strengKennung === 'string' && r.strengKennung.length <= 40 ? r.strengKennung : null,
    strengZuletzt: ganz(r.strengZuletzt, 0, Number.MAX_SAFE_INTEGER, 0),
    zuletzt: ganz(r.zuletzt, 0, Number.MAX_SAFE_INTEGER, 0),
    wartend,
  };
}

// Tageswechsel (Ortszeit): die Tageszaehler beginnen von vorn, wartende Anlaesse der Tageszaehler fallen weg. Stufe, strenge Zeit und der
// Abstand zur letzten Meldung bleiben.
export function neuerTag(stand: MeldungsStand, jetzt: Date): MeldungsStand {
  const tag = tagKennung(jetzt);
  if (stand.tag === tag) return stand;
  const wartend = { ...stand.wartend };
  delete wartend.zensiert;
  delete wartend.erwachsen;
  return { ...stand, tag, zensiert: 0, zensiertSchritte: 0, erwachsenMs: 0, erwachsenSchritte: 0, erwachsenMinute: -1, wartend };
}

export interface MinuteEingabe {
  erwachsen: boolean;
  zensiert: number;
}

// Eine Minutenmeldung der Steigerung: zaehlt zensierte Bilder und Erwachsenen-Minuten; liefert die neu erreichten Anlaesse.
export function zaehleMinute(stand: MeldungsStand, minute: MinuteEingabe, jetzt: Date): { stand: MeldungsStand; faellig: Faellig[] } {
  const faellig: Faellig[] = [];
  let neu = neuerTag(stand, jetzt);
  const zensiert = Number.isFinite(minute.zensiert) ? Math.max(0, Math.round(minute.zensiert)) : 0;
  if (zensiert > 0) {
    const summe = Math.min(1_000_000, neu.zensiert + zensiert);
    const schritte = Math.floor(summe / MELDUNG_ZENSIERT_SCHRITT);
    neu = { ...neu, zensiert: summe };
    if (schritte > neu.zensiertSchritte) {
      neu = { ...neu, zensiertSchritte: schritte };
      faellig.push({ anlass: 'zensiert', zahl: summe });
    }
  }
  const uhrMinute = Math.floor(jetzt.getTime() / 60_000);
  if (minute.erwachsen === true && uhrMinute !== neu.erwachsenMinute) {
    const ms = neu.erwachsenMs + 60_000;
    const schritte = Math.floor(ms / MELDUNG_ERWACHSEN_MS);
    neu = { ...neu, erwachsenMs: ms, erwachsenMinute: uhrMinute };
    if (schritte > neu.erwachsenSchritte) {
      neu = { ...neu, erwachsenSchritte: schritte };
      faellig.push({ anlass: 'erwachsen' });
    }
  }
  return { stand: neu, faellig };
}

// Die wirksame Stufe der Steigerung ist `wirksam` (null: unbekannt). Steigt sie gegenueber der zuletzt gesehenen, ist `stufe` faellig.
export function pruefeStufe(stand: MeldungsStand, wirksam: number | null): { stand: MeldungsStand; faellig: Faellig[] } {
  if (wirksam === null || !Number.isFinite(wirksam)) return { stand, faellig: [] };
  const s = Math.max(0, Math.min(4, Math.round(wirksam)));
  if (stand.stufe === s) return { stand, faellig: [] };
  const faellig: Faellig[] = stand.stufe !== null && s > stand.stufe ? [{ anlass: 'stufe' }] : [];
  return { stand: { ...stand, stufe: s }, faellig };
}

const MINUTE_MS = 60_000;

// Beginn (ms, auf die Minute) des strengen Fensters, in dem `jetzt` liegt; null ausserhalb oder wenn es seit mehr als 8 Tagen ununterbrochen gilt.
// Rueckwaerts in Schritten von 10 Minuten (hoechstens 1152 Aufrufe), dann minutengenau im letzten Schritt. Eine Luecke von weniger als 10 Minuten
// zwischen zwei Fenstern, die genau auf dem Raster liegt, wuerde die beiden zu einem Fenster zusammenfassen (so enge Luecken sind nicht gewollt).
const GROB = 10;
export function fensterBeginnMs(zeiten: readonly StrengeZeit[], jetzt: Date): number | null {
  const t = jetzt.getTime();
  if (!Number.isFinite(t) || !istStrengeZeit(zeiten, jetzt)) return null;
  const start = Math.floor(t / MINUTE_MS) * MINUTE_MS;
  const streng = (ms: number): boolean => istStrengeZeit(zeiten, new Date(ms));
  for (let i = 1; i <= (8 * 1440) / GROB; i++) {
    const davor = start - i * GROB * MINUTE_MS;
    if (streng(davor)) continue;
    // Zwischen `davor` (nicht streng) und `davor + 10 min` (streng) liegt der Beginn.
    for (let k = 1; k < GROB; k++) {
      if (streng(davor + k * MINUTE_MS)) return davor + k * MINUTE_MS;
    }
    return davor + GROB * MINUTE_MS;
  }
  return null;
}

// Beginnt eine strenge Zeit (erste Auswertung im neuen Fenster, einmal je Fenster)? `frei`: Freischaltung `kontrolle:zeitplan`.
export function pruefeStreng(stand: MeldungsStand, zeiten: readonly StrengeZeit[], frei: boolean, jetzt: Date): { stand: MeldungsStand; faellig: Faellig[] } {
  const ms = jetzt.getTime();
  // Lueckenlos beobachtet (letzte Auswertung in diesem Fenster vor hoechstens 5 Minuten) und noch streng: dasselbe Fenster, keine Suche noetig.
  if (frei && stand.strengKennung !== null && ms >= stand.strengZuletzt && ms - stand.strengZuletzt <= 5 * MINUTE_MS && istStrengeZeit(zeiten, jetzt)) {
    return { stand: { ...stand, strengZuletzt: ms }, faellig: [] };
  }
  const beginn = frei ? fensterBeginnMs(zeiten, jetzt) : null;
  if (beginn === null) return stand.strengKennung === null ? { stand, faellig: [] } : { stand: { ...stand, strengKennung: null, strengZuletzt: 0 }, faellig: [] };
  const kennung = String(beginn);
  if (stand.strengKennung === kennung) return { stand: { ...stand, strengZuletzt: ms }, faellig: [] };
  return { stand: { ...stand, strengKennung: kennung, strengZuletzt: ms }, faellig: [{ anlass: 'streng' }] };
}

// Neue Anlaesse vormerken (je Anlass hoechstens einer, der neueste zaehlt, `seit` ist der erste Zeitpunkt der noch wartenden) und
// Verfallenes (aelter als 30 Minuten) entfernen.
export function merkeWartend(stand: MeldungsStand, faellig: readonly Faellig[], jetztMs: number): MeldungsStand {
  const wartend: MeldungsStand['wartend'] = {};
  for (const anlass of VORRANG) {
    const alt = stand.wartend[anlass];
    if (alt && jetztMs - alt.seit <= WARTE_MAX_MS && jetztMs >= alt.seit - 1) wartend[anlass] = alt;
  }
  // `seit` bleibt der erste Zeitpunkt des noch wartenden Anlasses (sonst verfiele ein immer wieder erneuerter Anlass nie), nur `zahl` wird erneuert.
  for (const f of faellig) {
    const seit = wartend[f.anlass]?.seit ?? jetztMs;
    wartend[f.anlass] = f.zahl === undefined ? { seit } : { seit, zahl: f.zahl };
  }
  return { ...stand, wartend };
}

// Eine Uhr, die zurueckgestellt wurde (`zuletzt` liegt in der Zukunft), zaehlt wie "gerade gezeigt": `zuletzt` wird auf jetzt gekuerzt.
export function klemmeZuletzt(stand: MeldungsStand, jetztMs: number): MeldungsStand {
  return stand.zuletzt > jetztMs ? { ...stand, zuletzt: jetztMs } : stand;
}

// Kandidaten in der Reihenfolge des Vorrangs; leer, solange der Abstand zur letzten Meldung nicht erreicht ist.
export function kandidaten(stand: MeldungsStand, jetztMs: number): Faellig[] {
  if (stand.zuletzt > 0 && jetztMs - stand.zuletzt < MELDUNG_MIN_ABSTAND_MS) return [];
  const liste: Faellig[] = [];
  for (const anlass of VORRANG) {
    const w = stand.wartend[anlass];
    if (!w || jetztMs - w.seit > WARTE_MAX_MS) continue;
    liste.push(w.zahl === undefined ? { anlass } : { anlass, zahl: w.zahl });
  }
  return liste;
}

// Die Meldung zu `anlass` wurde gezeigt: Abstand beginnt, der Anlass wartet nicht mehr.
export function nachGezeigt(stand: MeldungsStand, anlass: MeldungAnlass, jetztMs: number): MeldungsStand {
  const wartend = { ...stand.wartend };
  delete wartend[anlass];
  return { ...stand, zuletzt: jetztMs, wartend };
}

// Satz zufaellig, nie derselbe wie `letzter`, solange die Gruppe mehr als einen hat. `zufall` 0 bis unter 1.
export function waehleSatz(saetze: readonly string[], zufall: number, letzter?: string | null): string | null {
  if (saetze.length === 0) return null;
  const z = Number.isFinite(zufall) ? Math.min(Math.max(zufall, 0), 0.999999) : 0.5;
  const frei = letzter && saetze.length > 1 ? saetze.filter((s) => s !== letzter) : saetze;
  return frei[Math.floor(z * frei.length)] ?? saetze[0] ?? null;
}
