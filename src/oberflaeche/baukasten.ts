// Logik der Oberflaeche des Custom-Baukastens (Phase 11 E6b, B3 bis B6): reine Funktionen ohne Browser und ohne Laufzeit-Importe ausser src/presets.ts. Die Seite rechnet nichts
// selbst, sie zeigt `faceAnzeige` und schreibt, was `faceSchreibteil`, `flaecheSchreibteil` und `woerterSchreibteil` liefern (je Tipp genau ein Schreibvorgang).
import { CUSTOM_GESICHT, CUSTOM_ID, CUSTOM_STANDARD, pruefeCustom, type CustomFlaeche, type CustomGesicht, type CustomMischung } from '../presets.ts';

// Die Zeile Face hat sieben Knoepfe (Entscheidung 299 b): "Nothing" und "Bar" sind keine Behandlung von Custom, sondern Zustaende der Zone Face und des Schalters Eye bar.
export const FACE_WAHLEN = ['nothing', 'bar', 'mia', 'sticker', 'mosaik', 'blur', 'schwarz'] as const;
export type FaceWahl = (typeof FACE_WAHLEN)[number];
// Die Zeile "Everything else" in der Reihenfolge der Anzeige.
export const FLAECHE_WAHLEN: readonly CustomFlaeche[] = ['schwarz', 'mosaik', 'blur', 'sticker'];

export const istFaceWahl = (x: unknown): x is FaceWahl => typeof x === 'string' && (FACE_WAHLEN as readonly string[]).includes(x);
export const istFlaechenWahl = (x: unknown): x is CustomFlaeche => typeof x === 'string' && (FLAECHE_WAHLEN as readonly string[]).includes(x);

// Der Teil des gespeicherten Standes, den die Zeilen lesen und schreiben.
export interface BaukastenStand {
  zonen: { face: { an: boolean } } & Record<string, { an: boolean; bedeckt?: boolean }>;
  augenbalken: boolean;
  custom?: unknown;
}

// Was Pack und Freischaltungen erlauben: `mia` = `stil:mia-patch`, `sticker` = `zensur:sticker`.
export interface BaukastenFrei {
  mia: boolean;
  sticker: boolean;
}

const mischungVon = (s: { custom?: unknown }): CustomMischung => ({ ...(pruefeCustom(s.custom) ?? CUSTOM_STANDARD) });

// Anzeige der Zeile Face (B3): Face aus und Eye bar aus ist "Nothing", Face aus und Eye bar an ist "Bar", Face an zeigt den Baustein aus `custom.gesicht`.
// Jede Lage gehoert zu genau einer Wahl.
export function faceAnzeige(s: BaukastenStand): FaceWahl {
  if (!s.zonen.face.an) return s.augenbalken ? 'bar' : 'nothing';
  return mischungVon(s).gesicht;
}

// Wahl in der Zeile Face (B3): ein Teil der Einstellungen, der in einem Zug geschrieben wird. "Nothing" schreibt Face aus und `augenbalken: false`, "Bar" Face aus und
// `augenbalken: true`; jede deckende Wahl schreibt Face an und `custom.gesicht` (`augenbalken` bleibt). In `custom.gesicht` steht nie etwas anderes als die fuenf Werte aus C1.
// Eine unbekannte Wahl und ein gesperrter Baustein (ohne die Freischaltung in `frei`) schreiben nichts (null).
export function faceSchreibteil(alt: BaukastenStand, wahl: unknown, frei: BaukastenFrei): { preset: typeof CUSTOM_ID; custom: CustomMischung; zonen: BaukastenStand['zonen']; augenbalken: boolean } | null {
  if (!istFaceWahl(wahl) || faceGesperrt(wahl, frei)) return null; // ein gesperrter Baustein ist nicht speicherbar (B6)
  const custom = mischungVon(alt);
  const face = (an: boolean): BaukastenStand['zonen'] => ({ ...alt.zonen, face: { ...alt.zonen.face, an } });
  if (wahl === 'nothing') return { preset: CUSTOM_ID, custom, zonen: face(false), augenbalken: false };
  if (wahl === 'bar') return { preset: CUSTOM_ID, custom, zonen: face(false), augenbalken: true };
  return { preset: CUSTOM_ID, custom: { ...custom, gesicht: wahl as CustomGesicht }, zonen: face(true), augenbalken: alt.augenbalken };
}

// Wahl in der Zeile "Everything else" (B4): schreibt `custom.flaeche`, sonst nichts.
export function flaecheSchreibteil(alt: { custom?: unknown }, wahl: unknown, frei: BaukastenFrei): { preset: typeof CUSTOM_ID; custom: CustomMischung } | null {
  if (!istFlaechenWahl(wahl) || flaecheGesperrt(wahl, frei)) return null;
  return { preset: CUSTOM_ID, custom: { ...mischungVon(alt), flaeche: wahl } };
}

// Der Schalter Words (B5): schreibt `custom.woerter`, sonst nichts.
export function woerterSchreibteil(alt: { custom?: unknown }, an: unknown): { preset: typeof CUSTOM_ID; custom: CustomMischung } | null {
  if (typeof an !== 'boolean') return null;
  return { preset: CUSTOM_ID, custom: { ...mischungVon(alt), woerter: an } };
}

// B5: kann nach der GELTENDEN Mischung (nach dem Pack ersetzt) irgendwo ein Wort stehen? Nur Schwarz und Mosaik tragen eines: die Flaeche, oder das Gesicht, wenn Face an ist.
export function wortMoeglich(gilt: Pick<CustomMischung, 'gesicht' | 'flaeche'>, faceAn: boolean): boolean {
  if (gilt.flaeche === 'schwarz' || gilt.flaeche === 'mosaik') return true;
  return faceAn && (gilt.gesicht === 'mosaik' || gilt.gesicht === 'schwarz');
}

// B6: ist dieser Baustein ohne die Freischaltung gesperrt? Mias Gesicht braucht `stil:mia-patch`, Sticker (Gesicht wie Flaeche) `zensur:sticker`. "Nothing" und "Bar" nie.
export function faceGesperrt(wahl: FaceWahl, frei: BaukastenFrei): boolean {
  return (wahl === 'mia' && !frei.mia) || (wahl === 'sticker' && !frei.sticker);
}
export function flaecheGesperrt(wahl: CustomFlaeche, frei: BaukastenFrei): boolean {
  return wahl === 'sticker' && !frei.sticker;
}

// B6: steht in der gespeicherten Mischung ein Baustein, der ohne Pack gesperrt ist (dann gilt dort Mosaik)? Das Gesicht zaehlt nur, wenn Face an ist (sonst wird es nirgends benutzt).
export function gespeichertGesperrt(s: BaukastenStand, frei: BaukastenFrei): { face: boolean; flaeche: boolean } {
  const m = mischungVon(s);
  return { face: s.zonen.face.an && faceGesperrt(m.gesicht, frei), flaeche: flaecheGesperrt(m.flaeche, frei) };
}

export { CUSTOM_GESICHT };
