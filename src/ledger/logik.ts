// Mia’s Ledger, reine Logik (Auftrag L, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 5): Stand vervollstaendigen, Summen pruefen und addieren,
// Tageswechsel nach Ortsdatum, Erwachsenen-Minute, Puffer im Content-Script. Ohne Browser-Zugriff, darum im Node-Test pruefbar.
// Es werden nur Zahlen gezaehlt, nie Adressen oder Titel.
import type { VeilEreignis } from '../ereignisse.ts';
import { LEDGER_ZAEHLER, type Ledger, type LedgerPlus, type LedgerZaehler } from './vertrag.ts';

// Hoechstens so viel je Zaehler in einer Nachricht (Auftrag L), und so viel puffert ein Frame zwischen zwei Sendungen.
export const MAX_JE_NACHRICHT = 10_000;
// Obergrenze eines gespeicherten Zaehlers (Schutz vor Unsinn im Speicher).
export const MAX_GESAMT = 1_000_000_000;
// Hoechstens einmal je Minute senden (Zeitgeber ab dem ersten Ereignis).
export const SENDE_ABSTAND_MS = 60_000;
export const MAX_STUFE = 4;

// Fehlertexte des Hintergrunds, bei denen eine Summe endgueltig verworfen wird (Pruefung nicht bestanden); jede andere Fehlerantwort
// (z. B. Speicherfehler) laesst die Summe im Puffer des Content-Scripts, bis sie ankommt.
export const FEHLER_SUMME = 'ungueltige Summe';
export const FEHLER_ABSENDER = 'nur von Seiten';
export const ENDGUELTIG_ABGELEHNT: readonly string[] = [FEHLER_SUMME, FEHLER_ABSENDER];

// Zaehler, die ein Content-Script melden darf; die Minuten auf Erwachsenenseiten zaehlt nur der Hintergrund.
export const INHALT_ZAEHLER: readonly LedgerZaehler[] = LEDGER_ZAEHLER.filter((z) => z !== 'erwachsenMinuten');

const zwei = (n: number): string => String(n).padStart(2, '0');

// Ortsdatum JJJJ-MM-TT (Zeitzone des Rechners).
export function ortsTag(d: Date): string {
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

function nullen(): Record<LedgerZaehler, number> {
  const r = {} as Record<LedgerZaehler, number>;
  for (const z of LEDGER_ZAEHLER) r[z] = 0;
  return r;
}

export function leererLedger(jetzt: Date): Ledger {
  return { version: 1, seit: jetzt.getTime(), tag: ortsTag(jetzt), heute: nullen(), gesamt: nullen(), hoechsteStufe: 0 };
}

const ganz = (x: unknown, min: number, max: number, standard: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.floor(x))) : standard;

function zaehlerAus(roh: unknown): Record<LedgerZaehler, number> {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const aus = nullen();
  for (const z of LEDGER_ZAEHLER) aus[z] = ganz(r[z], 0, MAX_GESAMT, 0);
  return aus;
}

// Fuellt einen rohen Speicherwert zu einem gueltigen Stand auf (unbekannte Felder fallen weg, fehlendes `seit` ist jetzt).
export function vervollstaendigeLedger(roh: unknown, jetzt: Date): Ledger {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const tag = typeof r.tag === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.tag) ? r.tag : ortsTag(jetzt);
  const seit = ganz(r.seit, 1, Number.MAX_SAFE_INTEGER, jetzt.getTime());
  return {
    version: 1,
    seit,
    tag,
    heute: zaehlerAus(r.heute),
    gesamt: zaehlerAus(r.gesamt),
    hoechsteStufe: ganz(r.hoechsteStufe, 0, MAX_STUFE, 0),
  };
}

// Tageswechsel nach Ortsdatum: ein neuer Tag setzt `heute` auf 0 (der Stand sonst bleibt).
export function neuerTag(l: Ledger, jetzt: Date): Ledger {
  const tag = ortsTag(jetzt);
  return l.tag === tag ? l : { ...l, tag, heute: nullen() };
}

// Prueft eine Summe aus einem Content-Script. Unbekannte Schluessel (und `erwachsenMinuten`, das nur der Hintergrund zaehlt) fallen weg.
// Ein bekannter Schluessel mit etwas anderem als einer ganzen Zahl von 0 bis 10 000 verwirft die ganze Nachricht (null). Ohne Zaehlung null.
export function pruefePlus(roh: unknown): LedgerPlus | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  const r = roh as Record<string, unknown>;
  const plus: LedgerPlus = {};
  let summe = 0;
  for (const z of INHALT_ZAEHLER) {
    if (!Object.prototype.hasOwnProperty.call(r, z)) continue;
    const w = r[z];
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > MAX_JE_NACHRICHT) return null;
    if (w > 0) {
      plus[z] = w;
      summe += w;
    }
  }
  return summe > 0 ? plus : null;
}

// Addiert eine gepruefte Summe auf `heute` und `gesamt` (nach dem Tageswechsel).
export function addiere(alt: Ledger, plus: LedgerPlus, jetzt: Date): Ledger {
  const l = neuerTag(alt, jetzt);
  const heute = { ...l.heute };
  const gesamt = { ...l.gesamt };
  for (const z of LEDGER_ZAEHLER) {
    const w = plus[z];
    if (typeof w !== 'number' || w <= 0) continue;
    heute[z] = Math.min(MAX_GESAMT, heute[z] + w);
    gesamt[z] = Math.min(MAX_GESAMT, gesamt[z] + w);
  }
  return { ...l, heute, gesamt };
}

// Uhr-Minute (ms / 60000, abgerundet): gegen Doppelzaehlung ueber mehrere Tabs.
export const uhrMinute = (ms: number): number => Math.floor(ms / 60_000);
// `!==` statt `>`: wird die Uhr zurueckgestellt, sperrt die gespeicherte Minute das Zaehlen nicht, bis die Uhr aufgeholt hat.
export const minuteFaellig = (letzte: number, jetztMs: number): boolean => uhrMinute(jetztMs) !== letzte;

// Hoechste je gesehene Stufe: nur anheben, nie senken.
export function mitStufe(l: Ledger, stufe: number): Ledger {
  const s = ganz(stufe, 0, MAX_STUFE, 0);
  return s > l.hoechsteStufe ? { ...l, hoechsteStufe: s } : l;
}

// Alles auf 0, `seit` jetzt (Knopf "Clear my ledger").
export const geloescht = (jetzt: Date): Ledger => leererLedger(jetzt);

// Ganze Kalendertage seit `seit` (Ortszeit), 0 am selben Tag.
export function tageSeit(seit: number, jetzt: Date): number {
  const a = new Date(seit);
  const mitternacht = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((mitternacht(jetzt) - mitternacht(a)) / 86_400_000));
}

// ---------- Puffer im Content-Script ----------
// Welcher Zaehler und wie viel ein Ereignis zaehlt; null = zaehlt nicht (quiz-start).
export function zaehlungFuer(e: VeilEreignis): [LedgerZaehler, number] | null {
  switch (e.art) {
    case 'zensiert':
      return ['zensiert', 1];
    case 'quiz-richtig':
      return ['quizGeloest', 1];
    case 'quiz-falsch':
      return ['quizFalsch', 1];
    case 'quiz-verweigert':
      return ['quizVerweigert', 1];
    case 'werbung':
      return ['werbung', 1];
    case 'blitz': {
      const w = typeof e.woerter === 'number' && Number.isFinite(e.woerter) ? Math.min(MAX_JE_NACHRICHT, Math.max(0, Math.floor(e.woerter))) : 0;
      return w > 0 ? ['blitzwoerter', w] : null;
    }
    case 'spirale':
      return ['spiralen', 1];
    case 'besuch':
      return ['besuche', 1];
    default:
      return null;
  }
}

export class Puffer {
  private summe: LedgerPlus = {};

  zaehle(e: VeilEreignis): boolean {
    const z = zaehlungFuer(e);
    if (!z) return false;
    this.summe[z[0]] = Math.min(MAX_JE_NACHRICHT, (this.summe[z[0]] ?? 0) + z[1]);
    return true;
  }

  get leer(): boolean {
    return Object.keys(this.summe).length === 0;
  }

  // Gibt die Summe heraus und leert den Puffer.
  nimm(): LedgerPlus {
    const s = this.summe;
    this.summe = {};
    return s;
  }

  // Nach einer fehlgeschlagenen Sendung zurueck in den Puffer (ohne die Obergrenze zu ueberschreiten).
  zurueck(s: LedgerPlus): void {
    for (const z of INHALT_ZAEHLER) {
      const w = s[z];
      if (typeof w === 'number' && w > 0) this.summe[z] = Math.min(MAX_JE_NACHRICHT, (this.summe[z] ?? 0) + w);
    }
  }
}
