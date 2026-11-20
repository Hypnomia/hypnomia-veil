// Texte zur Preset-Wahl, gemeinsam fuer Einstellungsseite, Popup und Einstieg (ZENSUR-PRESETS-BAUPLAN). Reine Funktionen.
import { PERSON_GRENZE, type Preset } from '../presets.ts';
import { presetDefFuerKennung } from '../preset-def.ts';
import type { PackKurz } from '../pack/vertrag';
import {
  HINWEIS_PACK_OHNE_PATCH,
  HINWEIS_PACK_OHNE_STICKER,
  HINWEIS_MIA_PACK_FEHLT,
  HINWEIS_ZONEN_MIA,
  HINWEIS_ZONEN_ZENSURBALKEN,
} from './gemeinsam.ts';

// Satz zum gewaehlten (wirksamen) Preset: sein Satz, bei Mia-Presets mit Pack die Zahl der Bilder, bei "Ganze Person" die Grenze.
// `gesichtBilder`: Zahl der Patch-Bilder mit gefundenem Gesicht (nach fertigem Scan), null solange sie unbekannt ist oder ohne Pack.
export function presetSatz(gilt: Preset, mitPack: boolean, gesichtBilder: number | null): string {
  const d = presetDefFuerKennung(gilt);
  if (d.person) return `${d.satz} ${PERSON_GRENZE}`;
  if (d.gesicht === 'mia-gesicht' && mitPack) {
    return `${d.satz} I choose my face from ${gesichtBilder !== null && gesichtBilder > 0 ? (gesichtBilder === 1 ? '1 picture' : `${gesichtBilder} pictures`) : 'the pictures'} in your Mia Pack.`;
  }
  return d.satz;
}

// Hinweis zum Pack unter der Wahl, wenn Presets gesperrt sind (mit meinem Gesicht: kein Patch-Bild im Pack; mit Stickern: keine Sticker im Pack); sonst ''.
// Fehlt das Pack ganz, sagt ein Satz alles. `braucht`: das gewaehlte Preset (Feld `braucht` der Definition), dann steht nur der Hinweis dazu (Popup); ohne Angabe
// stehen beide, wo beide zutreffen (Einstellungsseite und Einstieg zeigen alle Karten).
export function packHinweis(mitPatch: boolean, pack: PackKurz | null | undefined, mitSticker = true, braucht?: 'pack' | 'sticker' | null): string {
  if (braucht === 'pack') mitSticker = true;
  else if (braucht === 'sticker') mitPatch = true;
  if (!pack && !(mitPatch && mitSticker)) return HINWEIS_MIA_PACK_FEHLT;
  return [mitPatch ? '' : HINWEIS_PACK_OHNE_PATCH, mitSticker ? '' : HINWEIS_PACK_OHNE_STICKER].filter((t) => t !== '').join(' ');
}

// Hinweise bei den Zonen je Preset, getrennt nach Gewicht (E4t W5): `nie` sagt, dass etwas NICHT verdeckt wird (Mias Gesicht: Eyes und Mouth legen nichts
// dazu), und wird nie verdraengt; `gewoehnlich` ist der gewoehnliche Hinweis (Censor bars). '' wenn die Schalter ganz normal gelten.
export function zonenHinweisTeile(gilt: Preset): { nie: string; gewoehnlich: string } {
  const d = presetDefFuerKennung(gilt);
  if (d.augen === 'balken-immer') return { nie: '', gewoehnlich: HINWEIS_ZONEN_ZENSURBALKEN };
  if (d.gesicht === 'mia-gesicht') return { nie: HINWEIS_ZONEN_MIA, gewoehnlich: '' };
  return { nie: '', gewoehnlich: '' };
}

// Hinweis bei den Zonen je Preset (der eine, der gilt); '' wenn die Schalter ganz normal gelten.
export function zonenHinweis(gilt: Preset): string {
  const t = zonenHinweisTeile(gilt);
  return t.nie || t.gewoehnlich;
}
