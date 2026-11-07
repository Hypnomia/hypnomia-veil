// Familiennamen der Schriften in fremden Seiten (Phase 8b, Lesung S2/R Nr. 1): je Content-Script einmal zufaellig gewaehlt, damit eine Seite
// sie nicht mit eigenen @font-face-Regeln gleichen Namens ueberschreiben kann. Erweiterungsseiten nutzen die festen Namen aus tokens.css.
const ZUFALL = Math.random().toString(36).slice(2, 8);

export const SEITEN_ROUNDED = `VEIL Rounded ${ZUFALL}`;
export const SEITEN_TEXT = `VEIL Text ${ZUFALL}`;

/** Fester Name aus werte.ts (VEIL Rounded, VEIL Text) auf den Namen dieser Seite abbilden. */
export function seitenFamilie(familie: string): string {
  if (familie === 'VEIL Rounded') return SEITEN_ROUNDED;
  if (familie === 'VEIL Text') return SEITEN_TEXT;
  return familie;
}
