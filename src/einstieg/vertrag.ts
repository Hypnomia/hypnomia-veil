// Einstieg (Vertrag Session 11, Auftrag E, PHASE-6-BAUPLAN Abschnitt 2, Entscheidung 133). Reihenfolge wie SUBMERGE: Warnung vor
// Fotosensibilitaet, Altersgate 18+, Einwilligung, dann das Interview (5 Seiten, ueberspringbar). Der Schleier laeuft auch vor dem
// Einstieg (Inhaberin, Entscheidung 133); nur das Mia Pack wartet: Import erst nach `einstiegFertig`.
// Ablage: storage.local, Schluessel `einstieg`. Rein (keine Laufzeit-Importe ausser dem Speicher-Zugriff in ladeEinstieg).

export const EINSTIEG_SCHLUESSEL = 'einstieg';
export const INTERVIEW_SEITEN = 5;
// Session 17 (UX-Fund 7): ohne Mia Pack beim Einstieg fragt das Interview nur das, was ohne Pack wirkt (Mood und Strict, Zonen, Stil und Calm mode).
export const INTERVIEW_SEITEN_OHNE_PACK = 3;
// Erweiterungsseite des Einstiegs (entrypoints/willkommen/). `#interview` springt direkt ins Interview (ohne Gate, nur wenn fertig).
export const WILLKOMMEN_PFAD = '/willkommen.html';

export type InterviewStand = 'offen' | 'fertig' | 'uebersprungen';

export interface EinstiegStand {
  version: 1;
  warnung: boolean; // Warnung vor Fotosensibilitaet bestaetigt
  alter: boolean; // 18+ bestaetigt
  einwilligung: boolean; // Einwilligung bestaetigt
  interview: InterviewStand;
  zeit: number | null; // ms seit 1970, wann Gate und Einwilligung fertig wurden
}

export const EINSTIEG_LEER: EinstiegStand = { version: 1, warnung: false, alter: false, einwilligung: false, interview: 'offen', zeit: null };

export function vervollstaendigeEinstieg(roh: unknown): EinstiegStand {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const ja = (x: unknown) => x === true;
  const interview: InterviewStand = r.interview === 'fertig' || r.interview === 'uebersprungen' ? r.interview : 'offen';
  const zeit = typeof r.zeit === 'number' && Number.isFinite(r.zeit) ? r.zeit : null;
  return { version: 1, warnung: ja(r.warnung), alter: ja(r.alter), einwilligung: ja(r.einwilligung), interview, zeit };
}

// Gate und Einwilligung erledigt (das Interview zaehlt nicht dazu).
export function einstiegFertig(s: EinstiegStand | null | undefined): boolean {
  return !!s && s.warnung && s.alter && s.einwilligung;
}

export async function ladeEinstieg(): Promise<EinstiegStand> {
  const a = await browser.storage.local.get(EINSTIEG_SCHLUESSEL);
  return vervollstaendigeEinstieg(a[EINSTIEG_SCHLUESSEL]);
}
