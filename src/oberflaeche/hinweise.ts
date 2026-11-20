// Ein Hinweis je Element (Phase 11 E4t, Festlegung W5, Liste F der Textfreigabe): je Element eine reine Funktion, die aus dem Zustand hoechstens EINEN
// gewoehnlichen Hinweis waehlt, in der Reihenfolge der Vorrangliste. Nie verdraengt und nicht mitgezaehlt werden Sicherheits- und Warnsaetze (Anfallswarnung,
// Warnsatz zu Full replacement) und jeder Satz, der sagt, dass etwas NICHT verdeckt wird (HINWEIS_FACE_AUS, "nothing right now", HINWEIS_ZONEN_MIA, "Right now I cover
// nothing under clothes"): sie stehen neben dem gewaehlten Hinweis und weichen keinem anderen. Der Hinweis zu einer verworfenen Handlung verdraengt fuer
// seine Dauer nur gewoehnliche Hinweise. Reine Daten und Funktionen, keine Laufzeit-Importe (Einheitstests mit Node).
import type { Freischaltung, PackKurz } from '../pack/vertrag.ts';
import type { PresetDef } from '../presets.ts';
import { istFreigeschaltet } from '../preset-def.ts';
import { ERWACHSEN_TEXTE, KLEIDUNG_ANTWORT_GILT, KLEIDUNG_HEUTE, KLEIDUNG_HEUTE_NICHTS } from './bedienung-texte.ts';
import { HINWEIS_FACE_AUS, HINWEIS_FACE_EIN, HINWEIS_KEIN_GESICHT, HINWEIS_WORT_OHNE_PACK } from './gemeinsam.ts';
import { packHinweis } from './preset-texte.ts';

// ---------- Stilwahl (F1 Einstellungsseite, F2 Seite Cover style des Interviews) ----------

export type StilHinweisArt = 'pack' | 'kein-gesicht' | 'face-ein' | 'wort-ohne-pack';

export interface StilHinweisZustand {
  gilt: Pick<PresetDef, 'gesicht' | 'woerter'>; // das Preset, das wirklich gilt
  frei: boolean; // Freischaltung `stil:mia-patch`
  mitSticker: boolean; // Freischaltung `zensur:sticker`
  pack: PackKurz | null | undefined;
  faceAn: boolean; // Zone Face eingeschaltet
  faceGeradeEingeschaltet: boolean; // die Wahl hat Face eben eingeschaltet (kurzer Hinweis)
  gesichter: { fertig: boolean; gesamt: number; mit: number } | null; // Stand der Gesichtssuche in den Patch-Bildern
  woerterOhneThemen: boolean; // das Preset nutzt Woerter, das Pack bringt aber keine Themen (nur wo die Seite das fragt, sonst false)
}

export interface StilHinweise {
  // Nie verdraengt: Mias Gesicht gilt, Face steht aus (dann bleibt das Gesicht aus).
  nie: string;
  // Hoechstens ein gewoehnlicher Hinweis, Vorrang: (kein Pack und Stil mit Woertern: Wort ohne Pack, W21), Sperre des Packs, Gesicht nicht klar genug, Face gerade eingeschaltet, Wort ohne Themen.
  gewoehnlich: { art: StilHinweisArt; text: string } | null;
}

export function waehleStilHinweise(z: StilHinweisZustand): StilHinweise {
  const mia = z.gilt.gesicht === 'mia-gesicht';
  const nie = mia && !z.faceAn ? HINWEIS_FACE_AUS : '';
  // W21: kein Pack und der geltende Stil nutzt Woerter: "my word is MIA" sagt, was der Nutzer jetzt sieht, und geht vor dem allgemeinen Satz zum fehlenden Pack.
  if (!z.pack && z.gilt.woerter) return { nie, gewoehnlich: { art: 'wort-ohne-pack', text: HINWEIS_WORT_OHNE_PACK } };
  const sperre = packHinweis(z.frei, z.pack, z.mitSticker);
  if (sperre !== '') return { nie, gewoehnlich: { art: 'pack', text: sperre } };
  // Nur bei Face an: steht Face aus, bekommt Mias Gesicht ohnehin keine Flaeche (der Satz oben sagt es).
  if (z.frei && mia && z.faceAn && z.gesichter?.fertig === true && z.gesichter.gesamt > 0 && z.gesichter.mit === 0) {
    return { nie, gewoehnlich: { art: 'kein-gesicht', text: HINWEIS_KEIN_GESICHT } };
  }
  if (mia && z.faceAn && z.faceGeradeEingeschaltet) return { nie, gewoehnlich: { art: 'face-ein', text: HINWEIS_FACE_EIN } };
  if (z.gilt.woerter && z.woerterOhneThemen) return { nie, gewoehnlich: { art: 'wort-ohne-pack', text: HINWEIS_WORT_OHNE_PACK } };
  return { nie, gewoehnlich: null };
}

// ---------- Zonenwahl (F4) ----------

export type ZonenHinweisArt = 'verworfen' | 'wahl-keine' | 'zensurbalken';

// Die Sprechblase der Zonenwahl (Interview) und der Absatz unter der Zonenwahl (Einstellungsseite) sind Hinweise desselben Elements: hoechstens einer.
// Vorrang: die verworfene Handlung, dann "keine der drei Karten passt" (nur Interview), dann der Hinweis zu Censor bars (nur Einstellungsseite).
// Der Satz zu Mias Gesicht (HINWEIS_ZONEN_MIA, "Eyes and Mouth add nothing on top") sagt, dass etwas NICHT dazukommt: er steht daneben und weicht nie.
export function waehleZonenHinweis(z: { verworfen: boolean; wahlKeine: boolean; zensurbalken: boolean }): ZonenHinweisArt | null {
  if (z.verworfen) return 'verworfen';
  if (z.wahlKeine) return 'wahl-keine';
  if (z.zensurbalken) return 'zensurbalken';
  return null;
}

// ---------- Kleidungsfrage (F5) ----------

// Der Hinweis der Kleidungsfrage bei einem gemischten Stand (keine Antwort markiert), sonst null. `namen`: die Zonen, die eingeschaltet UND unter Kleidung gedeckt sind.
// "Right now I cover nothing under clothes" sagt, dass etwas NICHT gedeckt wird, und bleibt auch bei einer verworfenen Handlung stehen; der gewoehnliche Teil
// ("Right now I also cover ..." und "Pick an answer ...") weicht der verworfenen Handlung.
export function waehleKleidungHinweis(z: { gemischt: boolean; namen: readonly string[]; verworfen: boolean }): string | null {
  if (!z.gemischt) return null;
  if (z.namen.length === 0) return z.verworfen ? KLEIDUNG_HEUTE_NICHTS : `${KLEIDUNG_HEUTE_NICHTS} ${KLEIDUNG_ANTWORT_GILT}`;
  return z.verworfen ? null : `${KLEIDUNG_HEUTE(z.namen)} ${KLEIDUNG_ANTWORT_GILT}`;
}

// ---------- Gruppe der Erwachsenenseiten (F7 Einstellungsseite, F8 Seite 5 des Interviews) ----------

export type ErwachsenHinweisArt = 'verworfen' | 'ohne-pack' | 'gesperrt';

// Der Wortlaut der gesperrten Stufen (K10): ohne Pack "unlock with the Mia Pack", mit einem Pack ohne Freischaltung `erwachsen:vorschau` "need a newer Mia Pack".
export function gesperrtText(pack: PackKurz | null | undefined): string {
  return pack ? ERWACHSEN_TEXTE.gesperrtAltesPack : ERWACHSEN_TEXTE.gesperrt;
}

// Hoechstens ein gewoehnlicher Hinweis. Vorrang: die verworfene Wahl, dann (nur Interview, `mitPackHinweis`) der Satz "Set these now" mit dem Link zum Pack
// (steht nur ohne Pack), dann der Satz der gesperrten Stufen (nur ohne Freischaltung `erwachsen:vorschau`). Der Warnsatz zu Full replacement ist hier nicht
// beteiligt: er steht neben der Gruppe und weicht nie.
export function waehleErwachsenHinweis(z: { verworfen: boolean; pack: PackKurz | null | undefined; mitPackHinweis: boolean }): ErwachsenHinweisArt | null {
  if (z.verworfen) return 'verworfen';
  if (z.mitPackHinweis && !z.pack) return 'ohne-pack';
  if (!istFreigeschaltet(z.pack, 'erwachsen:vorschau' as Freischaltung)) return 'gesperrt';
  return null;
}

// Der Warnsatz zu Full replacement im Interview (B33): er steht genau dann, wenn der Ersatz auf Erwachsenenseiten wirken wuerde (W4):
// `komplettErsatz` gespeichert an UND `erwachsen.an` UND das Pack hat `erwachsen:ersatz`. Sonst bleibt er verborgen (er sagte sonst etwas, das nicht gilt).
export function ersatzWarnungGilt(erwachsen: { an: boolean; komplettErsatz: boolean }, pack: PackKurz | null | undefined): boolean {
  return erwachsen.komplettErsatz === true && erwachsen.an === true && istFreigeschaltet(pack, 'erwachsen:ersatz' as Freischaltung);
}
