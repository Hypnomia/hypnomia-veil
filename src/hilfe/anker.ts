// Hilfe-Anker (Session 17, UX-Pruefung Phase 9 Fund 14, Paket F): feste Kurzadressen der Hilfe-Seite, ein Vertrag fuer alle Oberflaechen.
// Popup, Einstellungen, Willkommensseite, Riegel, Galerie und Werbung verlinken nur auf `hilfeAdresse(<kurz>)`; die Hilfe-Seite loest die
// Kurzadresse auf Anleitung und Abschnitt auf. Die Ziel-Ueberschriften stehen in docs/ (Einheitstest prueft, dass es sie gibt).
export const HILFE_ANKER = {
  pin: 'how-i-work/pin-me',
  pause: 'pause',
  pack: 'mia-pack',
  ads: 'how-i-work/my-ads',
  adult: 'how-i-work/adult-sites',
  'full-replacement': 'how-i-work/full-replacement',
  'strict-times': 'how-i-work/strict-times',
  grip: 'how-i-work/my-grip',
  quiz: 'how-i-work/the-quiz',
  calm: 'safety/calm-mode',
  uninstall: 'uninstall',
  updates: 'updates/whats-new',
} as const;

export type HilfeAnker = keyof typeof HILFE_ANKER;

// Adresse der Hilfe-Seite relativ zur Wurzel der Erweiterung (fuer Erweiterungsseiten `hilfe.html#...`, fuer Content-Scripts mit
// runtime.getURL davor).
export function hilfeAdresse(kurz?: HilfeAnker): string {
  return kurz ? `hilfe.html#${kurz}` : 'hilfe.html';
}

// Loest eine Kurzadresse auf (`pin` -> `how-i-work/pin-me`); alles andere bleibt, wie es ist.
export function loeseKurzadresse(hash: string): string {
  const roh = hash.replace(/^#/, '');
  return (HILFE_ANKER as Record<string, string>)[roh] ?? roh;
}
