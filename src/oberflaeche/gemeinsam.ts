// Gemeinsame Bausteine fuer Popup, Einstellungsseite und Willkommensseite (Session 12, Vertragsschritt, PHASE-6-AUFTRAEGE-SESSION-12.md).
// Vom Orchestrator geschrieben, Bauer lesen nur. Texte sind Entwuerfe, der Texter liest gegen; Tests pruefen gegen diese Konstanten.
import type { Zone } from '../einstellungen.ts';


// Woerterbuch der Bedienung (Phase 11 E4t, Festlegung W1): ein Ding, ein Name auf Einstellungsseite, Interview und Popup. Die Namen stehen nur hier; die Inhaberin
// kann sie aendern. Kennungen im DOM, Anker und Speicherschluessel bleiben (der Schluessel `strict-times` heisst weiter so).
export const NAME_STIL = 'Cover style';
export const NAME_ABDECKUNG = 'What I cover'; // Reiter (traegt Stimmung, Zonen, Kleidung, Strict und Ausnahmen)
export const NAME_ZONEN = 'Zones';
export const NAME_KLEIDUNG = 'Under clothes';
export const NAME_STIMMUNG = 'Mia’s mood';
export const NAME_ERWACHSEN = 'Adult sites';
export const NAME_HITZE = 'How hot I get';
export const NAME_KONTROLLE = 'Mia’s control';
export const NAME_PACK_TON = 'Pack and sound';
export const NAME_VERWEIGERN = 'How often I refuse';
export const NAME_FREILEGEN = 'How long I reveal';
export const NAME_STRENG = 'Tight hours';

// Die zehn Zonen mit ihren Namen: die eine Quelle fuer Einstellungsseite, Interview und Popup (E4t W7). Nur ein Typ-Import, damit Node-Tests die Datei laden.
export const ZONEN_NAMEN: Record<Zone, string> = {
  eyes: 'Eyes',
  mouth: 'Mouth',
  face: 'Face',
  head: 'Head',
  breast: 'Breasts',
  genitals: 'Genitals',
  buttocks: 'Buttocks',
  belly: 'Belly',
  feet: 'Feet',
  armpits: 'Armpits',
};

// UX-Fund 6: die rohe Schwelle (0.10 bis 0.25) sagt der Person nichts. Ein Wort je Bereich, gleich in allen drei Oberflaechen,
// auch als `aria-valuetext` des Reglers. Grenzen in Hundertsteln, damit Gleitkomma-Reste (0.13000001) nicht kippen.
export const STIMMUNG_WOERTER = ['Very suspicious', 'Suspicious', 'Easygoing', 'Relaxed'] as const;
export function stimmungsWort(schwelle: number): string {
  const h = Math.round((Number.isFinite(schwelle) ? schwelle : 0.1) * 100);
  if (h <= 12) return STIMMUNG_WOERTER[0];
  if (h <= 16) return STIMMUNG_WOERTER[1];
  if (h <= 20) return STIMMUNG_WOERTER[2];
  return STIMMUNG_WOERTER[3];
}

// Live-Vorschau mit Beispielbildern (Phase 11 E5, V13): ein Hinweis unter der Vorschau, Namen der Punkte, der Kachel und das Alt der Bilder.
export const VORSCHAU_HINWEIS = 'Videos get a frame and can look a little different.';
export const VORSCHAU_PUNKTE_LABEL = 'Sample picture';
export const VORSCHAU_PUNKT_NAMEN: readonly string[] = ['Sample 1 of 4: front', '2 of 4: back', '3 of 4: sitting', '4 of 4: portrait'];
export const VORSCHAU_KACHEL = 'Enlarge preview';
export const VORSCHAU_SCHLIESSEN = 'Close';
export const VORSCHAU_NICHTS = 'Nothing to cover in this picture with your settings.';
export const VORSCHAU_ALT_OFFEN = 'Sample picture, nothing covered';
export const vorschauAlt = (stilName: string): string => `Sample picture, covered in style ${stilName}`;

// UX-Fund 26: ueberall derselbe Satz, wenn das Speichern scheitert (Schalter und Regler springen dann auf den gespeicherten Stand zurueck).
export const HINWEIS_PACK_OHNE_PATCH = 'No usable face of mine here, so my face styles stay locked. Classic and Whole person work.';
// Zensur-Presets (ZENSUR-PRESETS-BAUPLAN, Texte vom Texter freigegeben): Hinweise bei den Zonen und zum Pack. Namen und Saetze der Karten
// stehen in src/presets.ts. In der Oberflaeche heisst es "style", "preset" bleibt intern.
// Schalter "Eye bar" (Phase 11 E4c, ersetzt den Stil Eye bar; Texter liest in Schritt (e) gegen): Name, Unterzeile an den Schaltern, ein Satz fuer das Popup.
export const EYE_BAR_TITEL = 'Eye bar';
export const EYE_BAR_TEXT = 'a black bar over the eyes of every face I find; where my face goes, it covers the bar';
export const HINWEIS_ZONEN_ZENSURBALKEN = 'Censor bars always black out the eyes. Your zones decide what else turns black.';
export const HINWEIS_ZONEN_MIA = 'My face only goes where Face is on. While it is, Eyes and Mouth add nothing on top.';
export const HINWEIS_MIA_PACK_FEHLT = 'Styles with my face or stickers need the Mia Pack. Then all I cover can carry a bit of me.';
// Sticker-Zensur (STICKER-BAUPLAN, Text aus STICKER-TEXTE.md): Pack ohne Sticker, die Sticker-Karten bleiben gesperrt.
export const HINWEIS_PACK_OHNE_STICKER = 'This pack has no stickers of me yet, so sticker styles stay locked. The newest has them.';
export const HINWEIS_KEINE_WOERTER = 'No topic picked, so I just write MIA.';
export const HINWEIS_KEIN_GESICHT = 'My face isn’t clear enough in this pack, so faces get the same cover as the rest.';
export const HINWEIS_WORT_OHNE_PACK = 'Without the Mia Pack, my word is MIA.';
// Wer ein Mia-Preset waehlt (und beim ersten Pack-Import), bekommt die Zone Face eingeschaltet; Abschalten bleibt moeglich.
export const HINWEIS_FACE_EIN = `I switched Face on under ${NAME_ZONEN}, so every face I find becomes mine. You can switch it off.`;
// Mia-Preset gewaehlt, Face steht aus (bewusst abgeschaltet oder aus dem Altbestand): kurzer Hinweis auf Einstellungsseite, Popup und Einstieg.
export const HINWEIS_FACE_AUS = `My face only goes on faces. Switch Face on under ${NAME_ZONEN} and every face I find becomes mine.`;
export const FEHLER_SPEICHERN = 'I couldn’t save that, so nothing changed. Try again in a moment.';

// UX-Fund 28: Daten ueberall amerikanisch mit ausgeschriebenem Monat ("Nov 5, 2026"), mit Uhrzeit "Nov 5, 2026, 2:03 PM".
export function datumLang(ms: number, mitZeit = false): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-US', mitZeit ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// UX-Fund 14: ein Wort je Ding (Woerterbuch der Oberflaeche, gilt fuer alle drei Oberflaechen und den Texter).
//   eigene Ausnahmen        "sites I leave alone" (Ueberschrift "Sites I leave alone"); Knopf im Popup "Leave this site alone"
//   feste Standard-Liste    "never-touch list" (Entscheidung 87, bleibt getrennt)
//   das Pack                "Mia Pack" in Ueberschriften, Knoepfen und Chips; im Fliesstext nach der ersten Nennung auch "the pack"
//   Stufe der Steigerung    "my grip", Wert immer "level n of 4"
export const STUFE_TEXT = (n: number): string => `level ${n} of 4`;
