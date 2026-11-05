// Zeitplan und Schutzregeln der Pflicht-Besuche (Auftrag Z2, Session 10): reine Logik ohne Browser-Aufrufe, laeuft auch in Einheitstests
// (`node --experimental-strip-types`). Der Plan der Seite liegt in storage.local (`besuchZeitplan`) und gilt ueber alle Tabs; die harte Grenze
// (`besuchZuletzt`, mindestens 2 Stunden) pruefen die Seite NICHT, sondern allein der Hintergrund (`besuchAblehnung`).
import { BESUCH_ABSTAND_MS, BESUCH_MIN_ABSTAND_MS, naechsterBesuchAbstand } from '../kontrolle/grenzen.ts';

export const BESUCH_PLAN_SCHLUESSEL = 'besuchZeitplan';
export const BESUCH_ZULETZT_SCHLUESSEL = 'besuchZuletzt';
// So oft schaut ein sichtbarer Tab nach (ms). Kein Zeitgeber im Hintergrund.
export const BESUCH_PRUEF_TAKT_MS = 60_000;

export interface BesuchPlan {
  zuletzt: number;
  abstandMs: number;
}

export function liesBesuchPlan(roh: unknown): BesuchPlan | null {
  if (!roh || typeof roh !== 'object') return null;
  const { zuletzt, abstandMs } = roh as Record<string, unknown>;
  if (typeof zuletzt !== 'number' || !Number.isFinite(zuletzt) || zuletzt < 0) return null;
  if (typeof abstandMs !== 'number' || !Number.isFinite(abstandMs) || abstandMs <= 0) return null;
  return { zuletzt, abstandMs };
}

export interface BesuchPlanErgebnis {
  // Jetzt ist ein Besuch faellig (der Plan bleibt dann unberuehrt: erst nach dem Besuch oder "Not now" kommt ein neuer).
  faellig: boolean;
  plan: BesuchPlan;
  // Der Plan hat sich geaendert und muss gespeichert werden.
  schreibe: boolean;
}

export function neuerBesuchPlan(jetzt: number, zufall: number): BesuchPlan {
  return { zuletzt: jetzt, abstandMs: naechsterBesuchAbstand(zufall) };
}

// Entscheidet, was beim Nachschauen gilt. `roh`: gelesener Wert (kann fehlen oder kaputt sein), `jetzt` ms seit 1970, `zufall` 0 bis unter 1,
// `importiert`: Zeitpunkt des Pack-Imports (ein Plan davor gilt als fehlend), `neuStart`: der Schalter wurde gerade eingeschaltet.
export function pruefeBesuchPlan(roh: unknown, jetzt: number, zufall: number, importiert: number = 0, neuStart: boolean = false): BesuchPlanErgebnis {
  let plan = liesBesuchPlan(roh);
  if (plan && Number.isFinite(importiert) && plan.zuletzt < importiert) plan = null;
  // Kein Plan, gerade eingeschaltet oder die Uhr ging zurueck: ab jetzt zaehlen, kein Besuch sofort.
  if (neuStart || !plan || plan.zuletzt > jetzt) return { faellig: false, plan: neuerBesuchPlan(jetzt, zufall), schreibe: true };
  // Abstand ausserhalb 2 bis 4 Stunden (kaputt oder von Hand gesetzt): in den Bereich holen, nie unter 2 Stunden.
  const [min, max] = BESUCH_ABSTAND_MS;
  const abstand = Math.min(Math.max(plan.abstandMs, Math.max(min, BESUCH_MIN_ABSTAND_MS)), max);
  const angepasst: BesuchPlan = abstand === plan.abstandMs ? plan : { zuletzt: plan.zuletzt, abstandMs: abstand };
  return { faellig: jetzt - angepasst.zuletzt >= angepasst.abstandMs, plan: angepasst, schreibe: angepasst !== plan };
}

// ---------- Harte Regeln des Hintergrunds ----------
export interface BesuchLage {
  frameNull: boolean;
  tabBekannt: boolean;
  packFrei: boolean;
  schalterAn: boolean;
  pause: boolean;
  ausnahme: boolean;
  tabAktiv: boolean;
  fensterFokus: boolean;
  fensterVollbild: boolean;
  // Zeit des letzten Besuchs aus dem Speicher (null: nie), `jetzt` ms seit 1970.
  zuletzt: number | null;
  jetzt: number;
}

// Liefert den Grund der Ablehnung oder null. Reihenfolge: erst wer fragt, dann ob Mia darf, dann der Zustand des Fensters, zuletzt der Abstand.
export function besuchAblehnung(l: BesuchLage): string | null {
  if (!l.frameNull || !l.tabBekannt) return 'kein-tab';
  if (!l.packFrei) return 'kein-pack';
  if (!l.schalterAn) return 'aus';
  if (l.pause) return 'pause';
  if (l.ausnahme) return 'ausnahme';
  if (!l.tabAktiv) return 'tab-nicht-aktiv';
  if (!l.fensterFokus) return 'kein-fokus';
  if (l.fensterVollbild) return 'vollbild';
  // Ein Wert aus der Zukunft (Uhr ging zurueck) gilt als `jetzt` (der Hintergrund schreibt ihn neu): das sperrt hoechstens 2 Stunden echter Zeit.
  if (l.zuletzt !== null && Number.isFinite(l.zuletzt) && (l.zuletzt > l.jetzt || l.jetzt - l.zuletzt < BESUCH_MIN_ABSTAND_MS)) return 'zu-frueh';
  return null;
}
