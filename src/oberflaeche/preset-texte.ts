// Texte zur Preset-Wahl, gemeinsam fuer Einstellungsseite, Popup und Einstieg (ZENSUR-PRESETS-BAUPLAN). Reine Funktionen.
import { PERSON_GRENZE, PRESETS, type Preset } from '../presets.ts';
import type { PackKurz } from '../pack/vertrag';
import {
  HINWEIS_PACK_OHNE_PATCH,
  HINWEIS_MIA_PACK_FEHLT,
  HINWEIS_ZONEN_AUGENBALKEN,
  HINWEIS_ZONEN_MIA,
  HINWEIS_ZONEN_ZENSURBALKEN,
} from './gemeinsam';

// Satz zum gewaehlten (wirksamen) Preset: sein Satz, bei Mia-Presets mit Pack die Zahl der Bilder, bei "Ganze Person" die Grenze.
// `gesichtBilder`: Zahl der Patch-Bilder mit gefundenem Gesicht (nach fertigem Scan), null solange sie unbekannt ist oder ohne Pack.
export function presetSatz(gilt: Preset, mitPack: boolean, gesichtBilder: number | null): string {
  const d = PRESETS[gilt];
  if (d.person) return `${d.satz} ${PERSON_GRENZE}`;
  if (d.gesicht === 'mia-gesicht' && mitPack) {
    return `${d.satz} I choose my face from ${gesichtBilder !== null && gesichtBilder > 0 ? (gesichtBilder === 1 ? '1 picture' : `${gesichtBilder} pictures`) : 'the pictures'} in your Mia Pack.`;
  }
  return d.satz;
}

// Hinweis zum Pack unter der Wahl, wenn die Presets mit meinem Gesicht gesperrt sind; sonst ''.
export function packHinweis(mitPatch: boolean, pack: PackKurz | null | undefined): string {
  if (mitPatch) return '';
  return pack ? HINWEIS_PACK_OHNE_PATCH : HINWEIS_MIA_PACK_FEHLT;
}

// Hinweis bei "What I cover" je Preset; '' wenn die Schalter ganz normal gelten.
export function zonenHinweis(gilt: Preset): string {
  const d = PRESETS[gilt];
  if (d.augen === 'nur-balken') return HINWEIS_ZONEN_AUGENBALKEN;
  if (d.augen === 'balken-immer') return HINWEIS_ZONEN_ZENSURBALKEN;
  if (d.gesicht === 'mia-gesicht') return HINWEIS_ZONEN_MIA;
  return '';
}
