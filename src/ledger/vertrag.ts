// Mia’s Ledger (Vertrag Session 11, Auftrag L, PHASE-6-BAUPLAN Abschnitt 4, Entscheidung 20): Zaehler nur lokal, nur Zahlen, nie Adressen
// oder Titel. Ablage: storage.local, Schluessel `ledger`. Summen kommen gebuendelt aus den Content-Scripts (`hintergrund/ledger`) und
// aus dem Hintergrund selbst (Minuten auf Erwachsenenseiten, hoechste Stufe); der Hintergrund addiert nacheinander.

export const LEDGER_SCHLUESSEL = 'ledger';

// Zaehler, die per Summe wachsen (Reihenfolge = Anzeige-Reihenfolge, Auftrag L darf die Anzeige anders ordnen).
export const LEDGER_ZAEHLER = [
  'zensiert',
  'quizGeloest',
  'quizFalsch',
  'quizVerweigert',
  'erwachsenMinuten',
  'werbung',
  'blitzwoerter',
  'spiralen',
  'besuche',
] as const;
export type LedgerZaehler = (typeof LEDGER_ZAEHLER)[number];

export interface Ledger {
  version: 1;
  seit: number; // ms seit 1970: Installation bzw. letztes Loeschen
  tag: string; // Ortsdatum JJJJ-MM-TT, zu dem `heute` gehoert
  heute: Record<LedgerZaehler, number>; // dieselben Zaehler nur fuer `tag`
  gesamt: Record<LedgerZaehler, number>;
  hoechsteStufe: number; // hoechste je gesehene Stufe der Steigerung (0 bis 4)
}

// Summe aus einem Content-Script: nur nicht-negative ganze Zahlen, unbekannte Schluessel verworfen (Auftrag L prueft im Hintergrund).
export type LedgerPlus = Partial<Record<LedgerZaehler, number>>;
