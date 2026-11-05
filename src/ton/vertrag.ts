// Ton (Vertrag Session 11, Auftrag T, PHASE-6-BAUPLAN Abschnitt 6, Entscheidungen 19 und 133): nur Quiz und Trigger (Blitzwoerter),
// Standard aus, nur mit Pack (Freischaltung `ton`, Pack-Rolle `ton`). Klaenge: kurze Effekte (Schnippen, Glocke), Mias Stimme spaeter.
// Je Datei der Rolle `ton` ein Name (Dateiname ohne Endung im Pack, z. B. `ton/richtig.ogg`); fehlt ein Name, bleibt der Anlass still.

export const TON_NAMEN = ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger'] as const;
export type TonName = (typeof TON_NAMEN)[number];
