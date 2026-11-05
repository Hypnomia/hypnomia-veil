// Strenge Zeiten (Auftrag Z1, Phase 5 Session 10, Vertrag vom Orchestrator; Bauer lesen nur). Reine Logik ohne Browser-Aufrufe und ohne
// Laufzeit-Importe (Einheitstests mit `node --experimental-strip-types`). In einer strengen Zeit (Entscheidung 116): Steigerung eine Stufe
// hoeher, Blitzwoerter eine Stufe haeufiger (aus bleibt aus), Quiz vor Videos auf allen Seiten. Wirkt nur mit Freischaltung `kontrolle:zeitplan`
// (Pruefung in src/kontrolle/gemeinsam.ts `strengJetzt`). Pause gibt weiter alles frei.
import type { StrengeZeit } from '../einstellungen';

const TAG_MIN = 1440;

// Liegt `datum` (Ortszeit) in einem der Fenster? Siehe `StrengeZeit` in src/einstellungen.ts (ueber Mitternacht, ganzer Tag).
export function istStrengeZeit(zeiten: readonly StrengeZeit[], datum: Date): boolean {
  const t = datum.getTime();
  if (!Number.isFinite(t)) return false;
  const tag = datum.getDay();
  const vortag = (tag + 6) % 7;
  const m = datum.getHours() * 60 + datum.getMinutes();
  for (const z of zeiten) {
    if (z.von === z.bis) {
      if (z.tage.includes(tag)) return true;
    } else if (z.von < z.bis) {
      if (z.tage.includes(tag) && m >= z.von && m < z.bis) return true;
    } else {
      if (z.tage.includes(tag) && m >= z.von) return true;
      if (z.tage.includes(vortag) && m < z.bis) return true;
    }
  }
  return false;
}

// Millisekunden bis zum naechsten Wechsel (streng zu nicht streng oder umgekehrt), auf die volle Minute genau; null ohne Wechsel in 8 Tagen
// (keine Fenster oder dauerhaft streng). Fuer Zeitgeber, die zum Wechsel neu bewerten (hoechstens einmal je Minute nachrechnen).
export function naechsterWechselMs(zeiten: readonly StrengeZeit[], datum: Date): number | null {
  const t = datum.getTime();
  if (!Number.isFinite(t) || zeiten.length === 0) return null;
  const jetzt = istStrengeZeit(zeiten, datum);
  // In echter Zeit weiterzaehlen (nicht mit setMinutes in Ortszeit): sonst rechnet die Funktion beim Zurueckstellen der Uhr falsch
  // (Pruefer-Fund 1). Volle Minuten in echter Zeit sind auch volle Minuten in Ortszeit (Zeitzonen haben ganze Minuten als Abstand).
  const start = t - (((t % 60_000) + 60_000) % 60_000);
  for (let i = 1; i <= 8 * TAG_MIN; i++) {
    const kandidat = start + i * 60_000;
    if (istStrengeZeit(zeiten, new Date(kandidat)) !== jetzt) return Math.max(1, kandidat - t);
  }
  return null;
}

// Haeufigkeit der Blitzwoerter in einer strengen Zeit: eine Stufe haeufiger, aus bleibt aus.
export function hebeHaeufigkeit(h: 'aus' | 'selten' | 'oft', streng: boolean): 'aus' | 'selten' | 'oft' {
  if (!streng || h === 'aus') return h;
  return 'oft';
}

// Stufe der Steigerung in einer strengen Zeit: eine Stufe hoeher, hoechstens 4.
export function hebeStufe(stufe: number, streng: boolean): number {
  const s = Number.isFinite(stufe) ? Math.max(0, Math.min(4, Math.round(stufe))) : 0;
  return streng ? Math.min(4, s + 1) : s;
}

// "HH:MM" <-> Minuten (Einstellungsseite).
export function minutenAusText(text: string): number | null {
  // Zeitfelder mit `step` unter 60 liefern Sekunden mit (HH:MM:SS oder HH:MM:SS.mmm); die Sekunden fallen weg.
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
export function textAusMinuten(minuten: number): string {
  const m = Math.max(0, Math.min(TAG_MIN - 1, Math.round(minuten)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
