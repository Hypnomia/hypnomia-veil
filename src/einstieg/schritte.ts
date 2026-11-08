// Einstieg (Auftrag E): Schrittfolge der Willkommensseite. Rein, ohne Laufzeit.
// Reihenfolge wie SUBMERGE: Warnung, 18+, Einwilligung, Interview (INTERVIEW_SEITEN Seiten), Abschluss.
import { INTERVIEW_SEITEN, INTERVIEW_SEITEN_OHNE_PACK, einstiegFertig, type EinstiegStand } from './vertrag.ts';

export const GATE_SCHRITTE = ['warnung', 'alter', 'einwilligung'] as const;
export type GateSchritt = (typeof GATE_SCHRITTE)[number];
export type InterviewSchritt = `interview-${1 | 2 | 3 | 4 | 5}`;
export type Schritt = GateSchritt | InterviewSchritt | 'ende';

export const INTERVIEW_SCHRITTE: readonly InterviewSchritt[] = Array.from(
  { length: INTERVIEW_SEITEN },
  (_, i) => `interview-${i + 1}` as InterviewSchritt,
);
export const ALLE_SCHRITTE: readonly Schritt[] = [...GATE_SCHRITTE, ...INTERVIEW_SCHRITTE, 'ende'];

// Zahl der Interview-Seiten: mit Pack beim Einstieg 5, ohne Pack 3 (UX-Fund 7).
export function interviewSeiten(mitPack: boolean): number {
  return mitPack ? INTERVIEW_SEITEN : INTERVIEW_SEITEN_OHNE_PACK;
}

export function naechster(s: Schritt, seiten: number = INTERVIEW_SEITEN): Schritt {
  const reihe: readonly Schritt[] = [...GATE_SCHRITTE, ...INTERVIEW_SCHRITTE.slice(0, seiten), 'ende'];
  const i = reihe.indexOf(s);
  if (i < 0) return 'ende'; // eine Seite jenseits der Zahl (z. B. gemerkter Schritt 4 bei 3 Seiten)
  return reihe[Math.min(reihe.length - 1, i + 1)] ?? 'ende';
}

// Etappen unter der Bahn (UX-Fund 19): Safety, Age, Consent, Questions.
export const ETAPPEN = ['warnung', 'alter', 'einwilligung', 'interview'] as const;
export type Etappe = (typeof ETAPPEN)[number];
export function etappe(s: Schritt): Etappe | null {
  if (s === 'ende') return null;
  return istInterview(s) ? 'interview' : (s as GateSchritt);
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

// Fortschritt als "Schritt n von m" ueber Gate und Interview (der Abschluss zaehlt nicht mit). Beim Wiederholen des Interviews
// (`nurInterview`, UX-Fund 19) zaehlen nur die Interview-Seiten: "Frage 1 von 5".
export function fortschritt(s: Schritt, nurInterview = false, seiten: number = INTERVIEW_SEITEN): { nr: number; von: number } {
  if (nurInterview) {
    const k = INTERVIEW_SCHRITTE.indexOf(s as InterviewSchritt);
    return { nr: Math.max(1, Math.min(k + 1, seiten)), von: seiten };
  }
  const von = GATE_SCHRITTE.length + seiten;
  const i = ALLE_SCHRITTE.indexOf(s);
  return { nr: Math.min(i + 1, von), von };
}
