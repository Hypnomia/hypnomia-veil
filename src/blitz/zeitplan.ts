// Zeitplan der Blitzwoerter (Auftrag B, Phase 5): reine Logik ohne Browser-Aufrufe, laeuft auch in Einheitstests (`node --experimental-strip-types`).
// Der Plan liegt in storage.local (`blitzZeitplan`) und gilt ueber alle Tabs: `zuletzt` (Zeit des letzten Ereignisses oder der Installation, ms seit
// 1970) und `abstandMs` (so lange ruht Mia danach). Die Abstaende kommen aus `naechsterBlitzAbstand` (src/kontrolle/grenzen.ts).
import { BLITZ_ABSTAND_MS, naechsterBlitzAbstand } from '../kontrolle/grenzen.ts';

export const ZEITPLAN_SCHLUESSEL = 'blitzZeitplan';
// So oft schaut ein sichtbarer Tab nach (ms). Kein Zeitgeber im Hintergrund.
export const PRUEF_TAKT_MS = 30_000;

export interface Zeitplan {
  zuletzt: number;
  abstandMs: number;
}

export type Haeufigkeit = 'selten' | 'oft';

// Die wirksame Haeufigkeit. Eigene Funktion, weil die strengen Zeiten (Session 10) sie spaeter um eine Stufe anheben: Haeufigkeit nie direkt
// aus den Einstellungen lesen. Gibt null zurueck, wenn die Blitzwoerter aus sind.
export function wirksameHaeufigkeit(e: { kontrolle: { blitz: 'aus' | 'selten' | 'oft' } } | null): Haeufigkeit | null {
  const h = e?.kontrolle.blitz;
  return h === 'selten' || h === 'oft' ? h : null;
}

export function liesZeitplan(roh: unknown): Zeitplan | null {
  if (!roh || typeof roh !== 'object') return null;
  const r = roh as Record<string, unknown>;
  const { zuletzt, abstandMs } = r;
  if (typeof zuletzt !== 'number' || !Number.isFinite(zuletzt) || zuletzt < 0) return null;
  if (typeof abstandMs !== 'number' || !Number.isFinite(abstandMs) || abstandMs <= 0) return null;
  return { zuletzt, abstandMs };
}

export interface ZeitplanErgebnis {
  // Jetzt ist ein Ereignis faellig (der neue Plan ist dann schon der fuer das naechste Mal).
  faellig: boolean;
  // Der Plan, der gelten soll.
  plan: Zeitplan;
  // Der Plan hat sich geaendert und muss gespeichert werden (zuerst speichern, danach zeigen).
  schreibe: boolean;
}

const liegtImBereich = (abstandMs: number, h: Haeufigkeit): boolean => abstandMs >= BLITZ_ABSTAND_MS[h][0] && abstandMs <= BLITZ_ABSTAND_MS[h][1];

// Entscheidet, was beim Nachschauen gilt. `roh` ist der gelesene Wert aus dem Speicher (kann fehlen oder kaputt sein), `jetzt` die Uhrzeit in
// ms seit 1970, `zufall` 0 bis unter 1 (injizierbar).
// `importiert`: Zeitpunkt des Pack-Imports; ein Plan, der davor entstand, gilt wie ein fehlender (kein Wort sofort nach Installation oder Import).
export function pruefeZeitplan(roh: unknown, jetzt: number, haeufigkeit: Haeufigkeit, zufall: number, importiert: number = 0): ZeitplanErgebnis {
  let plan = liesZeitplan(roh);
  if (plan && Number.isFinite(importiert) && plan.zuletzt < importiert) plan = null;
  // Kein Plan (neu installiert, importiert, kaputt): ab jetzt zaehlen, kein Wort sofort.
  if (!plan) return { faellig: false, plan: { zuletzt: jetzt, abstandMs: naechsterBlitzAbstand(haeufigkeit, zufall) }, schreibe: true };
  // Die Uhr ging zurueck (oder der Plan stammt aus der Zukunft): neu ab jetzt, sonst bliebe Mia ewig still.
  if (plan.zuletzt > jetzt) return { faellig: false, plan: { zuletzt: jetzt, abstandMs: naechsterBlitzAbstand(haeufigkeit, zufall) }, schreibe: true };
  // Andere Haeufigkeit als beim Planen (der Abstand liegt nicht in ihrem Bereich): neuer Abstand ab `zuletzt`.
  const angepasst: Zeitplan = liegtImBereich(plan.abstandMs, haeufigkeit) ? plan : { zuletzt: plan.zuletzt, abstandMs: naechsterBlitzAbstand(haeufigkeit, zufall) };
  const schreibe = angepasst !== plan;
  if (jetzt - angepasst.zuletzt >= angepasst.abstandMs) {
    return { faellig: true, plan: { zuletzt: jetzt, abstandMs: naechsterBlitzAbstand(haeufigkeit, zufall) }, schreibe: true };
  }
  return { faellig: false, plan: angepasst, schreibe };
}
