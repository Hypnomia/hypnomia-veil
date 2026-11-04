// Blitz-Grenzen und Parameter-Deckel der Hypno-Aufgaben (Auftrag Q, PHASE-4-BAUPLAN Abschnitt 8 Punkt 6, SICHERHEITSGRENZEN.md).
// Die Werte stehen im Code und gelten unabhaengig von dem, was das Pack in `param` schreibt: `begrenzeAufgabe` klemmt jeden Wert, auch
// Unsinn (NaN, negativ, riesig). Keine Laufzeit-Importe ausser Typen (Einheitstests mit `node --experimental-strip-types`).
import type { AufgabenTyp, FrageAufgabe } from './vertrag.ts';

// ---------- Harte Deckel (CLAUDE.md Regel 9) ----------
export const MAX_WECHSEL_JE_SEKUNDE = 3; // vollflaechige Hell-Dunkel-Wechsel
export const WECHSEL_SPERRE_MS = 334; // Sperre zwischen zwei Wechseln (SUBMERGE: SPERRE_MS)
export const MAX_STREIFEN_HZ = 2.5; // Streifen der Spirale: Arme mal Umdrehungen je Sekunde
export const MAX_WOERTER_JE_SEKUNDE = 2; // laufende Woerter in den Aufgaben (SUBMERGE erlaubt 5,4, hier bewusst darunter)
export const MIN_WORT_MS = 1000 / MAX_WOERTER_JE_SEKUNDE; // 500 ms
// Blitzwoerter-Schwarm (SUBMERGE): hoechstens 12 Woerter und 2500 ms am Stueck. Gilt fuer Schwaerme schnell aufblitzender Woerter (Phase 5),
// NICHT fuer die Zaehlfolgen der Aufgaben (hoechstens 2 Woerter je Sekunde); die Konstanten stehen hier fuer Phase 5.
export const SCHWARM_MAX_WORTE = 12;
export const SCHWARM_MAX_MS = 2500;
export const FOLGE_MAX_MS = 15000; // Gesamtdauer einer Wortfolge (zaehlen, pink-klicken)
export const ZAEHL_WOERTER_MIN = 8; // QUIZ-ENTWURF H03: 8 bis 14 Woerter
export const ZAEHL_WOERTER_MAX = 14;
export const RUHIG_DREHZAHL = 0.3; // Ruhig-Modus: Drehzahl der Spirale nach dem Deckel zusaetzlich auf 30 %

// ---------- Spirale ----------
export const SPIRALE_ARME = 2;
export const SPIRALE_STANDARD_PERIODE_S = 24; // eine Umdrehung in 24 s: Streifen 2 / 24 = 0,083 Hz

// Dauer einer Umdrehung in Sekunden oder null (Spirale steht: `prefers-reduced-motion`). Der Wunsch wird nach unten gedeckelt, sodass
// Arme / Periode nie ueber MAX_STREIFEN_HZ liegt; der Ruhig-Modus verlangsamt danach auf 30 % der Drehzahl.
export function spiralePeriodeS(
  wunschS: number | undefined,
  opt: { ruhig?: boolean; bewegungAus?: boolean; arme?: number } = {},
): number | null {
  if (opt.bewegungAus) return null;
  const arme = Number.isFinite(opt.arme) && opt.arme! >= 1 ? Math.floor(opt.arme!) : SPIRALE_ARME;
  const wunsch = typeof wunschS === 'number' && Number.isFinite(wunschS) && wunschS > 0 ? wunschS : SPIRALE_STANDARD_PERIODE_S;
  const periode = Math.max(wunsch, arme / MAX_STREIFEN_HZ);
  return opt.ruhig ? periode / RUHIG_DREHZAHL : periode;
}

// Streifenfrequenz in Hz bei gegebener Periode (null = steht = 0).
export function streifenHz(periodeS: number | null, arme: number = SPIRALE_ARME): number {
  return periodeS === null || !(periodeS > 0) ? 0 : arme / periodeS;
}

// ---------- Wechselsperre ----------
// Jeder vollflaechige Wechsel (Karte faerbt sich, Flaeche kippt) fragt hier an. Zwischen zwei erlaubten Wechseln liegen mindestens
// WECHSEL_SPERRE_MS, also nie mehr als 3 je Sekunde. Wer abgelehnt wird, laesst den Wechsel weg (kein Nachholen).
export class WechselSperre {
  private letzte = Number.NEGATIVE_INFINITY;
  private jetzt: () => number;
  constructor(jetzt: () => number) {
    this.jetzt = jetzt;
  }
  versuche(): boolean {
    const t = this.jetzt();
    if (t - this.letzte < WECHSEL_SPERRE_MS) return false;
    this.letzte = t;
    return true;
  }
}

// ---------- Parameter klemmen ----------
export interface AufgabeSicher {
  typ: AufgabenTyp;
  sekunden: number;
  wort: string;
  anzahl: number;
  abstandMs: number;
  woerter: string[];
  von: number;
  gemischt: string;
  // Laufende Woerter: Anzeigedauer je Wort (>= MIN_WORT_MS) und Zahl der Woerter (<= SCHWARM_MAX_WORTE).
  wortMs: number;
  anzahlWoerter: number;
  // wort-blitz: einmaliges Zeigen in ms.
  zeigeMs: number;
  // buchstaben-takt: erlaubter Abstand zwischen zwei Tasten.
  taktMinMs: number;
  taktMaxMs: number;
}

function zahl(roh: unknown, standard: number, min: number, max: number): number {
  const z = typeof roh === 'number' && Number.isFinite(roh) ? roh : standard;
  return Math.min(max, Math.max(min, z));
}
function ganz(roh: unknown, standard: number, min: number, max: number): number {
  return Math.round(zahl(roh, standard, min, max));
}
// Ein Wort: Buchstaben, Ziffern, Leerzeichen und Bindestrich, hoechstens `max` Zeichen; sonst der Standard.
// `einWort`: ohne Leerzeichen (Eingabe wird an Leerraum getrennt, "SLEEP NOW" waere unloesbar); sonst der Standard.
function wortText(roh: unknown, standard: string, max = 24, einWort = false): string {
  if (typeof roh !== 'string') return standard;
  const t = roh.replace(/\s+/g, ' ').trim();
  if (einWort && !/^[\p{L}\p{N}]+$/u.test(t)) return standard; // nur Buchstaben und Ziffern, auch kein Bindestrich
  return t.length > 0 && [...t].length <= max && /^[\p{L}\p{N} -]+$/u.test(t) ? t : standard;
}
function wortListe(roh: unknown, standard: string[]): string[] {
  if (typeof roh !== 'string') return standard;
  const liste = [...new Set(roh.split(',').map((w) => wortText(w, '', 16, true)).filter(Boolean))].slice(0, 8);
  return liste.length >= 2 ? liste : standard;
}

// Zahl der Woerter einer Folge: zaehlen 8 bis 14, pink-klicken 4 bis 12; die Gesamtdauer bleibt unter FOLGE_MAX_MS (zuerst weniger Woerter).
function folgeLaenge(roh: unknown, typ: AufgabenTyp, wortMs: number): number {
  const [min, max, standard] = typ === 'zaehlen' ? [ZAEHL_WOERTER_MIN, ZAEHL_WOERTER_MAX, 10] : [4, 12, 8];
  const n = ganz(roh, standard, min, max);
  return Math.max(1, Math.min(n, Math.floor(FOLGE_MAX_MS / wortMs)));
}

export const STANDARD_ZAEHL_WOERTER = ['POP', 'DOWN', 'OBEY', 'pink'];
export const STANDARD_PINK_WOERTER = ['DROP', 'SLEEP', 'DEEP', 'OBEY', 'POP', 'DOWN'];

// Klemmt die Parameter einer Aufgabe auf sichere Werte. Gilt fuer alle Typen; nicht benutzte Felder tragen Standardwerte.
export function begrenzeAufgabe(typ: AufgabenTyp, param: FrageAufgabe['aufgabe']['param'] | undefined): AufgabeSicher {
  const p = (param ?? {}) as Record<string, unknown>;
  const wort = wortText(p.wort, typ === 'zaehlen' ? 'POP' : typ === 'wort-tippen' || typ === 'countdown' ? 'DOWN' : 'OBEY', 24, typ === 'zaehlen' || typ === 'wort-tippen' || typ === 'countdown');
  let woerter = wortListe(p.woerter, typ === 'pink-klicken' ? STANDARD_PINK_WOERTER : STANDARD_ZAEHL_WOERTER);
  if (typ === 'zaehlen' && !woerter.some((w) => w.toLowerCase() === wort.toLowerCase())) woerter = [wort, ...woerter].slice(0, 8);
  const sekundenStandard: Partial<Record<AufgabenTyp, number>> = {
    'spirale-ansehen': 10,
    'im-kreis': 8,
    'leertaste-halten': 5,
    widerstehen: 10,
    'finger-halten': 5,
  };
  const sekunden = zahl(p.sekunden, sekundenStandard[typ] ?? 5, typ === 'leertaste-halten' ? 2 : 3, typ === 'leertaste-halten' ? 15 : 30);
  // zaehlen: mindestens 8 Woerter in hoechstens 15 s, also hoechstens 1875 ms je Wort
  const wortMs = ganz(p.wortMs, typ === 'pink-klicken' ? 1000 : 600, MIN_WORT_MS, typ === 'zaehlen' ? Math.floor(FOLGE_MAX_MS / ZAEHL_WOERTER_MIN) : 3000);
  const gemischtRoh = typeof p.gemischt === 'string' ? wortText(p.gemischt, '') : '';
  const sortiere = (s: string) => [...s.replace(/\s+/g, '').toLowerCase()].sort().join('');
  // Leer = der Riegel mischt selbst (mit seinem Zufall)
  const gemischt = gemischtRoh && sortiere(gemischtRoh) === sortiere(wort) && gemischtRoh.replace(/\s+/g, '').toLowerCase() !== wort.replace(/\s+/g, '').toLowerCase() ? gemischtRoh : '';
  return {
    typ,
    sekunden,
    wort,
    anzahl: ganz(p.anzahl, typ === 'wort-tippen' ? 5 : 7, 1, typ === 'wort-tippen' ? 10 : 12),
    abstandMs: ganz(p.abstandMs, 500, 200, 5000),
    woerter,
    von: ganz(p.von, 10, 3, 20),
    gemischt,
    // Anzeigedauer nie unter 500 ms (hoechstens 2 Woerter je Sekunde), nie ueber 3 s; Zahl der Woerter hoechstens SCHWARM_MAX_WORTE.
    wortMs,
    anzahlWoerter: folgeLaenge(p.anzahlWoerter, typ, wortMs),
    zeigeMs: ganz(p.zeigeMs, 500, 300, 1000),
    taktMinMs: 800,
    taktMaxMs: 2000,
  };
}
