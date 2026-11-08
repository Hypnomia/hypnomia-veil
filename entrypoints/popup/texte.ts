// Popup-Texte als Konstanten (Entwuerfe, der Texter liest gegen; Tests pruefen gegen diese Konstanten, Session 12 Regel 2.5).
// Besitzwort fuer die eigene Liste: "my list of sites I leave alone" (Mias Liste, Woerterbuch in src/oberflaeche/gemeinsam.ts).
import { HINWEIS_PACK_OHNE_PATCH, STIMMUNG_WOERTER } from '../../src/oberflaeche/gemeinsam.ts';

export const REGLER_ENDE_LINKS = STIMMUNG_WOERTER[0];
export const REGLER_ENDE_RECHTS = STIMMUNG_WOERTER[3];
export const AUSNAHME_KNOPF_AN = 'Leave this site alone';
export const AUSNAHME_KNOPF_ZURUECK = 'Let Mia back on this site';
export const AUSNAHME_VOR = (muster: string): string => `One tap, and I leave ${muster} alone, subdomains too.`;
export const AUSNAHME_NACH = (muster: string): string => `${muster} is on my list of sites I leave alone. You can undo it here anytime.`;
export const STATUS_AUSNAHME = 'You put this site on my list of sites I leave alone. I’m keeping my hands off it.';
export const PACK_KNOPF_OHNE = 'Get the Mia Pack';
export const PACK_KNOPF_MIT = 'Mia Pack settings';
export const PACK_HINWEIS_OHNE = 'Mia patch unlocks with the Mia Pack.';
export const PACK_HINWEIS_OHNE_PATCH = HINWEIS_PACK_OHNE_PATCH;
export const ERW_HINWEIS_AUS = 'Adult-site mode is off. I still cover pictures there, just no swaps and no quiz.';
export const PACK_HINWEIS_MIT = (n: number): string => `Mia patch uses ${n} of my pictures from the Mia Pack.`;

// Phase 9, Paket A (Entwuerfe, der Texter liest gegen).
export const DIESE_SEITE_KEIN_ZUGRIFF = 'I can’t reach this page.';
export const ABDECKUNG_KURZ = (namen: readonly string[]): string => (namen.length ? `I cover: ${namen.join(', ')}.` : 'I cover: nothing right now.');
export const AENDERN_ZU = 'Change';
export const AENDERN_AUF = 'Done';
export const PAUSE_ZEILE = 'Changes still save. They start when you let me back in.';
export const PAUSE_KUERZEL = (kuerzel: string): string => `or press ${kuerzel}`;
export const GRIP_SATZ = 'My grip tightens by itself and eases off with time.';
export const GRIP_HILFE = 'What is my grip?';
export const NEUES_LINK = 'What’s new';
// Werbe-Frage im Popup: dieselben Saetze wie auf der Einstellungsseite.
export const WERBUNG_FRAGE_TITEL = 'Show my ads?';
export const WERBUNG_FRAGE_TEXT =
  'I can swap the ad spaces on other sites for my own little posters, always labeled “Mia’s ad” and linking only to my pages. Nothing about you leaves your browser. Change it any time in my settings, under Mia’s control.';
export const WERBUNG_FRAGE_JA = 'Yes, show them';
export const WERBUNG_FRAGE_NEIN = 'No ads';
