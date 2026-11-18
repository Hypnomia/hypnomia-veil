// Einstieg, Interview Seite 2 (Auftrag E): die zehn Zonen als drei einfache Wahlen plus "even when clothed". Rein, ohne Laufzeit.
// Body = Zonen ab Werk (STANDARD), Body and face = dazu `face`, Everything = alle Zonen. Passt der Stand zu keiner Wahl, ist keine vorgewaehlt.
import { BEDECKBARE_ZONEN, STANDARD, ZONEN, type Zone, type ZonenEinstellung } from '../einstellungen.ts';

export const ZONEN_WAHLEN = ['koerper', 'koerper-gesicht', 'alles'] as const;
export type ZonenWahl = (typeof ZONEN_WAHLEN)[number];
export type ZonenStand = Record<Zone, ZonenEinstellung>;

// Welche Zonen eine Wahl einschaltet.
export function zonenDerWahl(wahl: ZonenWahl): ReadonlySet<Zone> {
  const werk = ZONEN.filter((z) => STANDARD.zonen[z].an);
  if (wahl === 'koerper') return new Set<Zone>(werk);
  if (wahl === 'koerper-gesicht') return new Set<Zone>([...werk, 'face']);
  return new Set<Zone>(ZONEN);
}

// Die Wahl, die genau zum Stand passt (nur das `an` der Zonen zaehlt, `bedeckt` ist die zweite Frage), sonst null.
export function zonenWahl(zonen: ZonenStand): ZonenWahl | null {
  for (const w of ZONEN_WAHLEN) {
    const soll = zonenDerWahl(w);
    if (ZONEN.every((z) => zonen[z].an === soll.has(z))) return w;
  }
  return null;
}

// "Even when clothed" gilt als gesetzt, wenn mindestens eine bedeckbare Zone an ist und alle eingeschalteten bedeckbaren Zonen bedeckt sind.
export function bedecktAlle(zonen: ZonenStand): boolean {
  const an = ZONEN.filter((z) => BEDECKBARE_ZONEN.has(z) && zonen[z].an);
  return an.length > 0 && an.every((z) => zonen[z].bedeckt === true);
}

// Setzt eine Wahl. Neu eingeschaltete bedeckbare Zonen bekommen `bedeckt`, wenn "even when clothed" gesetzt ist oder sie es schon gespeichert hatten (nie weniger Deckung als vorher);
// ausgeschaltete Zonen behalten ihr `bedeckt`, damit Hin und Zurueck nichts verliert.
export function setzeZonenWahl(zonen: ZonenStand, wahl: ZonenWahl): ZonenStand {
  const soll = zonenDerWahl(wahl);
  const bedeckt = bedecktAlle(zonen);
  const neu = {} as ZonenStand;
  for (const z of ZONEN) {
    const alt = zonen[z];
    const e: ZonenEinstellung = { an: soll.has(z) };
    // Eine neu eingeschaltete Zone verliert nie ein gespeichertes `bedeckt` (Phase 11 E4c0 Nacharbeit R2): sie behaelt es, oder sie bekommt es durch "even when clothed".
    if (BEDECKBARE_ZONEN.has(z)) e.bedeckt = !alt.an && e.an ? bedeckt || alt.bedeckt === true : alt.bedeckt === true;
    neu[z] = e;
  }
  return neu;
}

// "Even when clothed" an oder aus: gilt fuer ALLE bedeckbaren Zonen, auch fuer ausgeschaltete (Nacharbeit R15): an gibt allen `bedeckt`, aus nimmt es allen.
// Sonst kehrte ein altes `bedeckt` einer ausgeschalteten Zone zurueck, nachdem der Nutzer den Haken ausdruecklich abgewaehlt hat. `an` aendert sich nie.
export function setzeBedeckt(zonen: ZonenStand, bedeckt: boolean): ZonenStand {
  const neu = {} as ZonenStand;
  for (const z of ZONEN) {
    const alt = zonen[z];
    neu[z] = BEDECKBARE_ZONEN.has(z) ? { ...alt, bedeckt } : { ...alt };
  }
  return neu;
}
