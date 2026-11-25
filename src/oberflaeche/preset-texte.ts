// Texte zur Preset-Wahl, gemeinsam fuer Einstellungsseite, Popup und Einstieg (ZENSUR-PRESETS-BAUPLAN). Reine Funktionen.
import { PERSON_GRENZE, packGenuegt, type AnyKennung, type PresetDef } from '../presets.ts';
import { BAUKASTEN_TEXTE } from './bedienung-texte.ts';
import { gespeichertGesperrt } from './baukasten.ts';
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
export function presetSatz(gilt: AnyKennung, mitPack: boolean, gesichtBilder: number | null): string {
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
export function zonenHinweisTeile(gilt: AnyKennung): { nie: string; gewoehnlich: string } {
  const d = presetDefFuerKennung(gilt);
  if (d.augen === 'balken-immer') return { nie: '', gewoehnlich: HINWEIS_ZONEN_ZENSURBALKEN };
  if (d.gesicht === 'mia-gesicht') return { nie: HINWEIS_ZONEN_MIA, gewoehnlich: '' };
  return { nie: '', gewoehnlich: '' };
}

// Hinweis bei den Zonen je Preset (der eine, der gilt); '' wenn die Schalter ganz normal gelten.
export function zonenHinweis(gilt: AnyKennung): string {
  const t = zonenHinweisTeile(gilt);
  return t.nie || t.gewoehnlich;
}

// Der Satz zum Stil im Popup (die Zeile unter dem Namen): ist der gewaehlte Stil gesperrt, steht der Hinweis zum Pack (ohne Pack dazu, was bis dahin gilt), sonst der Satz zum Stil.
// Custom (E6b, Ergaenzung der Leitung): ersetzt das Pack nur EINEN Baustein, sagt ein Satz genau das (auch wenn das Pack nur Sticker hat und Mias Gesicht fehlt, oder umgekehrt),
// nie "I use Mosaic" fuer den ganzen Stil. Rein, damit ein Einheitstest alle Lagen prueft. `gesperrt`: etwas des gewaehlten Stils gilt nicht (steuert den Hinweis zu Face).
export function popupStilText(a: {
  def: { gewaehlt: PresetDef; gilt: PresetDef };
  frei: boolean;
  mitSticker: boolean;
  pack: PackKurz | null | undefined;
  faceAn: boolean; // Zone Face an: nur dann wirkt der Baustein am Gesicht
  gesichterMit: number | null;
  bisDahin: string;
}): { text: string; gesperrt: boolean } {
  const { def, frei, mitSticker, pack } = a;
  if (def.gewaehlt.mischung) {
    // derselbe reine Entscheid wie die Zeile Face (`gespeichertGesperrt`): ein ersetzter Baustein zaehlt nur, wenn er wirkt (das Gesicht nur bei Face an)
    const g = gespeichertGesperrt({ zonen: { face: { an: a.faceAn } }, augenbalken: false, custom: def.gewaehlt.mischung }, { mia: frei, sticker: mitSticker });
    const teilGesperrt = g.face || g.flaeche;
    return { text: teilGesperrt ? BAUKASTEN_TEXTE.gespeichertGesperrt : presetSatz(def.gilt.id, frei, a.gesichterMit), gesperrt: teilGesperrt };
  }
  const gesperrt = !packGenuegt(def.gewaehlt.braucht, frei, mitSticker);
  return { text: gesperrt ? packHinweis(frei, pack, mitSticker, def.gewaehlt.braucht) + (pack ? '' : a.bisDahin) : presetSatz(def.gilt.id, frei, a.gesichterMit), gesperrt };
}
