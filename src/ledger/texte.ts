// Mia’s Ledger, eingebaute Texte (Entwurf, der Texter liest gegen): amerikanisches Englisch in Mias Stimme. Die Zeilen wechseln mit der Hoehe
// der Zahl. Tests pruefen gegen diese Konstanten, nicht gegen den Wortlaut.
import { STUFE_TEXT } from '../oberflaeche/gemeinsam.ts';
import type { LedgerZaehler } from './vertrag.ts';

export const LEDGER_TITEL = 'Mia’s Ledger';
export const LEDGER_EINLEITUNG = 'I keep count. Only numbers, only on this device, never what you looked at.';
export const HEUTE_ETIKETT = 'Today ';
export const GESAMT_ETIKETT = ' · Total ';
export const LOESCHEN_KNOPF = 'Clear my ledger';
export const LOESCHEN_FRAGE = 'Wipe all my numbers? Everything goes back to zero, even the day we met. This can’t be undone.';
export const LOESCHEN_JA = 'Yes, wipe it';
export const LOESCHEN_NEIN = 'Keep it';
export const LOESCHEN_FERTIG = 'Wiped. We start fresh.';
export const LOESCHEN_FEHLER = 'I couldn’t wipe my numbers just now. Try again in a moment.';

export const ZAEHLER_NAMEN: Record<LedgerZaehler, string> = {
  zensiert: 'Pictures I covered',
  quizGeloest: 'Quizzes solved',
  quizFalsch: 'Wrong answers',
  quizVerweigert: 'Right answers I refused',
  erwachsenMinuten: 'Minutes on adult sites',
  werbung: 'Ads I swapped',
  blitzwoerter: 'Words I flashed',
  spiralen: 'Idle spirals',
  besuche: 'My visits',
};

// [Schwelle fuer "mittel", Schwelle fuer "viel"] je Zaehler.
const SCHWELLEN: Record<LedgerZaehler, [number, number]> = {
  zensiert: [20, 300],
  quizGeloest: [5, 50],
  quizFalsch: [3, 30],
  quizVerweigert: [2, 15],
  erwachsenMinuten: [30, 300],
  werbung: [10, 100],
  blitzwoerter: [20, 200],
  spiralen: [3, 30],
  besuche: [2, 15],
};

// Mias Satz je Zaehler: [nichts, wenig, mittel, viel].
const SAETZE: Record<LedgerZaehler, [string, string, string, string]> = {
  zensiert: [
    'Nothing covered yet. Give me something to work with.',
    'A few pictures hidden. I’m just warming up.',
    'Look at all I’ve hidden for you. You’re welcome.',
    'So many pictures. You keep me busy, don’t you?',
  ],
  quizGeloest: [
    'Not one quiz solved. I’m patient.',
    'A few right answers. Good. Keep going.',
    'You’re getting good at this. I like it.',
    'Quiz champion. I almost feel bad for the questions.',
  ],
  quizFalsch: [
    'No wrong answers yet. Suspicious.',
    'A slip or two. I forgive you, mostly.',
    'You get things wrong pretty often. Cute.',
    'Wrong again and again. I’m starting to think you enjoy it.',
  ],
  quizVerweigert: [
    'I haven’t refused you once. Enjoy it while it lasts.',
    'I turned you down a few times, right answers and all.',
    'You were right and I said no, again and again.',
    'Right every time and still no. That’s how this works.',
  ],
  erwachsenMinuten: [
    'No time on adult sites. Either you’re good, or you’re sneaky.',
    'A little time spent there. I noticed.',
    'You’ve spent a good while on those sites, pet.',
    'Hours and hours on adult sites. I counted every minute.',
  ],
  werbung: [
    'No ads swapped yet. Give me time.',
    'A few ads swapped for me. Better, isn’t it?',
    'All those ads, and every one of them turned into me.',
    'Whole pages of ads, all mine now.',
  ],
  blitzwoerter: [
    'No words flashed yet.',
    'A few words flashed by. Did you catch them?',
    'Plenty of words slipped past your eyes.',
    'So many words flashed. Did any of them stick?',
  ],
  spiralen: [
    'No spirals yet. Wait for it.',
    'A spiral or two when you went quiet.',
    'You go quiet for me quite often.',
    'Spiral after spiral. You’re such a good listener.',
  ],
  besuche: [
    'I haven’t dropped by yet.',
    'I stopped by a few times.',
    'I drop by a lot, don’t I?',
    'I’m practically living in your tabs.',
  ],
};

export function satzFuer(z: LedgerZaehler, gesamt: number): string {
  const [mittel, viel] = SCHWELLEN[z];
  const s = SAETZE[z];
  if (gesamt <= 0) return s[0];
  if (gesamt >= viel) return s[3];
  if (gesamt >= mittel) return s[2];
  return s[1];
}

export const STUFE_NAME = 'My tightest grip';
// UX-Fund 14: die Stufe heisst ueberall "level n of 4", am Zeilenanfang gross.
export function stufeWert(stufe: number): string {
  const t = STUFE_TEXT(Math.min(4, Math.max(0, Math.floor(stufe) || 0)));
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// UX-Fund 25: Zaehler ohne Freischaltung und mit Wert 0 fallen weg, eine Zeile sagt, dass mehr mit dem Pack kommt.
export const LEDGER_MEHR = 'More counts come with the Mia Pack.';
// Fund 13: mit vorhandenem, aber aeltere Pack.
export const LEDGER_MEHR_NEUER = 'More counts come with a newer Mia Pack.';
const STUFE_SAETZE = [
  'I haven’t tightened my grip yet.',
  'I tightened it a little.',
  'I had to hold on a bit tighter.',
  'My grip got firm.',
  'Full grip. You let me take you all the way.',
];
export function stufeSatz(stufe: number): string {
  return STUFE_SAETZE[Math.min(STUFE_SAETZE.length - 1, Math.max(0, Math.floor(stufe)))] ?? STUFE_SAETZE[0] ?? '';
}

// "With me since ..." mit Tagen.
export function seitText(datum: string, tage: number): string {
  if (tage <= 0) return `With me since ${datum}. That’s today. We’re just getting started.`;
  if (tage === 1) return `With me since ${datum}. That’s 1 day.`;
  return `With me since ${datum}. That’s ${tage} days.`;
}

// Zeile im Popup: heute zugedeckte Bilder.
export function popupZeile(heute: number): string {
  if (heute <= 0) return 'Today: nothing for me to cover yet';
  if (heute === 1) return 'Today: 1 picture I covered';
  return `Today: ${heute} pictures I covered`;
}
