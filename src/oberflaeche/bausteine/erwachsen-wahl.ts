// Gruppe der Erwachsenenseiten, reine Logik (Phase 11 E4d2, Regel F4, Nacharbeit G1). Rein, ohne DOM.
// Mit Freischaltung `erwachsen:vorschau`: vier Karten Off, Tease, Hot, Explicit. Off schreibt nur `an: false`, die Stufe bleibt gespeichert; eine Stufe
// schreibt `an: true` und die Stufe.
// Ohne Freischaltung (kein Pack, oder ein Pack ohne `erwachsen:vorschau`): Off und On, beide waehlbar wie bei HEAD (`an` ist auch ohne Pack schaltbar und
// deckt dort mehr), darunter Tease, Hot, Explicit gesperrt und NIE markiert. On schreibt nur `an: true`, Off nur `an: false`, die Stufe bleibt in beiden
// Faellen unberuehrt. Alles andere im Block `erwachsen` (Full replacement, Erkennen am Inhalt, eigene Seiten) bleibt unberuehrt.
import { STUFEN_WAHL, type ErwachsenEinstellung, type StufeWahl } from '../../einstellungen.ts';

export const ERWACHSEN_KARTEN_FREI = ['off', ...STUFEN_WAHL] as const;
export const ERWACHSEN_KARTEN_OHNE = ['off', 'on', ...STUFEN_WAHL] as const;
export type ErwachsenKarte = 'off' | 'on' | StufeWahl;

// Die Karten der jeweiligen Form.
export function erwachsenKarten(stufeFrei: boolean): readonly ErwachsenKarte[] {
  return stufeFrei ? ERWACHSEN_KARTEN_FREI : ERWACHSEN_KARTEN_OHNE;
}

// Die Karten, die in dieser Form gesperrt sind: ohne Freischaltung die drei Stufen.
export function erwachsenGesperrt(stufeFrei: boolean): readonly ErwachsenKarte[] {
  return stufeFrei ? [] : STUFEN_WAHL;
}

// Die Karte, die der gespeicherte Stand markiert: `off`, wenn der Modus aus ist; sonst mit Freischaltung die gespeicherte Stufe, ohne sie `on`
// (eine Stufe wirkt ohne Pack nicht, sie wird nie als gewaehlt angezeigt).
export function erwachsenKarte(e: Pick<ErwachsenEinstellung, 'an' | 'stufe'>, stufeFrei: boolean): ErwachsenKarte {
  if (!e.an) return 'off';
  return stufeFrei ? e.stufe : 'on';
}

// Der neue Block nach einer Handlung des Nutzers, oder null, wenn die Wahl nicht gilt (unbekannte Karte, eine Stufe ohne Freischaltung, "on" mit Freischaltung,
// wo es keine Karte On gibt).
export function erwachsenNachWahl(alt: ErwachsenEinstellung, karte: string, stufeFrei: boolean): ErwachsenEinstellung | null {
  if (karte === 'off') return { ...alt, an: false };
  if (karte === 'on') return stufeFrei ? null : { ...alt, an: true };
  if (!stufeFrei || !(STUFEN_WAHL as readonly string[]).includes(karte)) return null;
  return { ...alt, an: true, stufe: karte as StufeWahl };
}
