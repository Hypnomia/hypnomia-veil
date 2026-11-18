// Einstellungsseite, Reiter (Phase 11 E4d1, Entscheidungen 245 und 279): die sieben Reiter, ihre Namen und die Zuordnung der alten Anker.
// Reine Daten ohne DOM-Zugriff, damit ein Einheitstest sie lesen kann. Die Namen sind vorlaeufig (die Texterin legt sie in Schritt (e) fest)
// und stehen nur hier; reiter.ts baut daraus die Leiste.

export const REITER = [
  { id: 'stil', name: 'Style', anker: 'abschnitt-stil' },
  { id: 'zonen', name: 'What I cover', anker: 'covering' },
  { id: 'erwachsen', name: 'Adult sites', anker: 'erwachsen' },
  { id: 'extras', name: 'Mia’s extras', anker: 'kontrolle' },
  { id: 'pack', name: 'Pack and sound', anker: 'stand' },
  { id: 'ledger', name: 'Ledger', anker: 'ledger' },
  { id: 'ueber', name: 'About', anker: 'ueber' },
] as const;

export type ReiterId = (typeof REITER)[number]['id'];

// Ohne Anker in der Adresse oeffnet die Seite diesen Reiter.
export const STANDARD_REITER: ReiterId = 'stil';

// Der Anker in der Adresse eines Reiters (das alte Ziel des Reiters, damit der Weg ueber den Reiter und der alte Weg dieselbe Adresse haben).
export function ankerFuerReiter(id: ReiterId): string {
  return REITER.find((r) => r.id === id)!.anker;
}

// Texte des Platzes der festen Vorschau (vorlaeufig, Texterin in Schritt (e)).
export const VORSCHAU_KOPF = 'Preview';
export const VORSCHAU_LABEL = 'Preview of your cover style';
