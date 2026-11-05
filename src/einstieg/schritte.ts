// Einstieg (Auftrag E): Schrittfolge der Willkommensseite. Rein, ohne Laufzeit.
// Reihenfolge wie SUBMERGE: Warnung, 18+, Einwilligung, Interview (INTERVIEW_SEITEN Seiten), Abschluss.
import { INTERVIEW_SEITEN, einstiegFertig, type EinstiegStand } from './vertrag.ts';

export const GATE_SCHRITTE = ['warnung', 'alter', 'einwilligung'] as const;
export type GateSchritt = (typeof GATE_SCHRITTE)[number];
export type InterviewSchritt = `interview-${1 | 2 | 3 | 4 | 5}`;
export type Schritt = GateSchritt | InterviewSchritt | 'ende';

export const INTERVIEW_SCHRITTE: readonly InterviewSchritt[] = Array.from(
  { length: INTERVIEW_SEITEN },
  (_, i) => `interview-${i + 1}` as InterviewSchritt,
);
export const ALLE_SCHRITTE: readonly Schritt[] = [...GATE_SCHRITTE, ...INTERVIEW_SCHRITTE, 'ende'];

export function naechster(s: Schritt): Schritt {
  const i = ALLE_SCHRITTE.indexOf(s);
  return ALLE_SCHRITTE[Math.min(ALLE_SCHRITTE.length - 1, i + 1)] ?? 'ende';
}

// Zurueck gibt es nur innerhalb des Interviews (Gate und Einwilligung gehen nicht zurueck, der Abschluss auch nicht).
export function vorheriger(s: Schritt): Schritt | null {
  const i = INTERVIEW_SCHRITTE.indexOf(s as InterviewSchritt);
  return (i > 0 ? INTERVIEW_SCHRITTE[i - 1] : undefined) ?? null;
}

export function istInterview(s: Schritt): s is InterviewSchritt {
  return INTERVIEW_SCHRITTE.includes(s as InterviewSchritt);
}

// Womit die Seite beginnt: erster offener Gate-Schritt; ist der Einstieg fertig, springt `#interview` zu Interview-Seite 1,
// sonst (Interview noch offen) ebenfalls dorthin, und nach einem beendeten Interview steht der Abschluss.
export function startSchritt(stand: EinstiegStand, adresse: string): Schritt {
  if (!einstiegFertig(stand)) {
    if (!stand.warnung) return 'warnung';
    if (!stand.alter) return 'alter';
    return 'einwilligung';
  }
  if (adresse === '#interview' || stand.interview === 'offen') return 'interview-1';
  return 'ende';
}

// Fortschritt als "Schritt n von m" ueber Gate und Interview (der Abschluss zaehlt nicht mit).
export function fortschritt(s: Schritt): { nr: number; von: number } {
  const von = GATE_SCHRITTE.length + INTERVIEW_SCHRITTE.length;
  const i = ALLE_SCHRITTE.indexOf(s);
  return { nr: Math.min(i + 1, von), von };
}
