// Popup-Texte als Konstanten (Entwuerfe, der Texter liest gegen; Tests pruefen gegen diese Konstanten, Session 12 Regel 2.5).
// Besitzwort fuer die eigene Liste: "my list of sites I leave alone" (Mias Liste, Woerterbuch in src/oberflaeche/gemeinsam.ts).
import {
  HINWEIS_FACE_AUS as GEMEINSAM_HINWEIS_FACE_AUS,
  HINWEIS_PACK_OHNE_PATCH,
  STIMMUNG_WOERTER,
} from '../../src/oberflaeche/gemeinsam.ts';

export const REGLER_ENDE_LINKS = STIMMUNG_WOERTER[0];
export const REGLER_ENDE_RECHTS = STIMMUNG_WOERTER[3];
export const AUSNAHME_KNOPF_AN = 'Leave this site alone';
export const AUSNAHME_KNOPF_ZURUECK = 'Let Mia back on this site';
export const AUSNAHME_VOR = (muster: string): string => `One tap, and I leave ${muster} alone, subdomains too.`;
export const AUSNAHME_NACH = (muster: string): string => `${muster} is on my list of sites I leave alone. You can undo it here anytime.`;
export const STATUS_AUSNAHME = 'You put this site on my list of sites I leave alone. I’m keeping my hands off it.';
export const PACK_KNOPF_OHNE = 'Get the Mia Pack';
export const PACK_KNOPF_MIT = 'Mia Pack settings';
export const PACK_HINWEIS_OHNE_PATCH = HINWEIS_PACK_OHNE_PATCH;
// Popup, Mia-Preset gewaehlt ohne Pack: der Hinweis nennt auch, was bis dahin gilt.
export const HINWEIS_FACE_AUS = GEMEINSAM_HINWEIS_FACE_AUS;
export const PACK_HINWEIS_BIS_DAHIN = ' Until then I use Mosaic.';
export const ERW_HINWEIS_AUS = 'Adult sites are off. I treat them like any other site: no swaps, no quiz.';
export const ERW_HINWEIS_OHNE_PACK = 'My thumbnail swaps and my quiz come with the Mia Pack.';
export const ERW_HINWEIS_PAUSE = 'Paused, so I’m keeping my hands off these sites too.';
export const ERW_HINWEIS_AN = 'I know the usual places, and I treat them as adult sites.';
// Der eine Hinweis zu den Erwachsenenseiten im Popup, je Zustand genau einer (E4t, Liste F9, X2). Pause: C17 (sagt, dass nichts verdeckt wird, weicht nie, auch nicht dem Satz ohne Pack);
// sonst kein Pack: C16; sonst An oder Aus.
export const erwachsenHinweis = (z: { ohnePack: boolean; pause: boolean; an: boolean }): string =>
  z.pause ? ERW_HINWEIS_PAUSE : z.ohnePack ? ERW_HINWEIS_OHNE_PACK : z.an ? ERW_HINWEIS_AN : ERW_HINWEIS_AUS;

// Phase 9, Paket A (Entwuerfe, der Texter liest gegen).
export const DIESE_SEITE_KEIN_ZUGRIFF = 'I can’t reach this page.';
export const ABDECKUNG_AUGENBALKEN = 'I cover: a black bar over the eyes.';
export const ABDECKUNG_NUR_GRIFF = 'I cover: only what my grip adds right now.';
// Kurzzeile (E4t W6, W13): die Zonen laut Schaltern, der Balken dazu; "nothing right now" nur, wenn keine Zone, kein Balken und kein Griff etwas verdeckt.
// `griff`: 'ja' (die Steigerung legt Zonen dazu), 'nein', 'unbekannt' (Stand nicht lesbar: dann nie "nothing", die Zeile bleibt leer, `null`).
export const ABDECKUNG_KURZ = (namen: readonly string[], mitBalken = false, griff: 'ja' | 'nein' | 'unbekannt' = 'nein'): string | null => {
  if (namen.length) return mitBalken ? `I cover: ${namen.join(', ')}, plus a black bar over the eyes.` : `I cover: ${namen.join(', ')}.`;
  if (mitBalken) return ABDECKUNG_AUGENBALKEN;
  if (griff === 'ja') return ABDECKUNG_NUR_GRIFF;
  return griff === 'nein' ? 'I cover: nothing right now.' : null;
};
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
