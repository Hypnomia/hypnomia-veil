// Popup-Texte als Konstanten (Entwuerfe, der Texter liest gegen; Tests pruefen gegen diese Konstanten, Session 12 Regel 2.5).
// Besitzwort fuer die eigene Liste: "my list of sites I leave alone" (Mias Liste, Woerterbuch in src/oberflaeche/gemeinsam.ts).
import { HINWEIS_PACK_OHNE_PATCH, STIMMUNG_WOERTER } from '../../src/oberflaeche/gemeinsam.ts';

export const REGLER_ENDE_LINKS = STIMMUNG_WOERTER[0];
export const REGLER_ENDE_RECHTS = STIMMUNG_WOERTER[3];
export const AUSNAHME_KNOPF_AN = 'Leave this site alone';
export const AUSNAHME_KNOPF_ZURUECK = 'Let Mia back on this site';
export const AUSNAHME_VOR = (muster: string): string => `Tap and I’ll leave ${muster} alone, subdomains too.`;
export const AUSNAHME_NACH = (muster: string): string => `${muster} is on my list of sites I leave alone. You can undo it here anytime.`;
export const STATUS_AUSNAHME = 'You put this site on my list of sites I leave alone. I’m keeping my hands off it.';
export const PACK_KNOPF_OHNE = 'Add the Mia Pack';
export const PACK_KNOPF_MIT = 'Mia Pack settings';
export const PACK_HINWEIS_OHNE = 'Add the Mia Pack and I can cover things with my own pictures.';
export const PACK_HINWEIS_OHNE_PATCH = HINWEIS_PACK_OHNE_PATCH;
export const ERW_HINWEIS_AUS = 'Adult-site mode is off. I still cover pictures there, just no swaps and no quiz.';
export const PACK_HINWEIS_MIT = (n: number): string => `Mia patch uses ${n} of my pictures from the Mia Pack.`;
