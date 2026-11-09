// Gemeinsame Bausteine fuer Popup, Einstellungsseite und Willkommensseite (Session 12, Vertragsschritt, PHASE-6-AUFTRAEGE-SESSION-12.md).
// Vom Orchestrator geschrieben, Bauer lesen nur. Texte sind Entwuerfe, der Texter liest gegen; Tests pruefen gegen diese Konstanten.

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

// UX-Fund 26: ueberall derselbe Satz, wenn das Speichern scheitert (Schalter und Regler springen dann auf den gespeicherten Stand zurueck).
export const HINWEIS_PACK_OHNE_PATCH = 'This Mia Pack has no pictures of my face to use, so the styles with my face stay locked. Classic and Whole person still work.';
// Zensur-Presets (ZENSUR-PRESETS-BAUPLAN, Texte vom Texter freigegeben): Hinweise bei den Zonen und zum Pack. Namen und Saetze der Karten
// stehen in src/presets.ts. In der Oberflaeche heisst es "style", "preset" bleibt intern.
export const HINWEIS_ZONEN_AUGENBALKEN = 'Eye bar covers only the eyes. Your other zones rest until you pick another style.';
export const HINWEIS_ZONEN_ZENSURBALKEN = 'Censor bars always black out the eyes. Your zones decide what else turns black.';
export const HINWEIS_ZONEN_MIA = 'My face only goes where Face is on. While it is, Eyes and Mouth add nothing on top.';
export const HINWEIS_MIA_PACK_FEHLT = 'The styles with my face need the Mia Pack. Once it’s in, every face I cover becomes mine.';
export const HINWEIS_KEINE_WOERTER = 'No topic picked, so I just write MIA.';
export const HINWEIS_KEIN_GESICHT = 'None of the pictures in this pack shows my face clearly enough, so faces get the same cover as everything else.';
export const HINWEIS_WORT_OHNE_PACK = 'Without the Mia Pack, my word is MIA.';
// Wer ein Mia-Preset waehlt (und beim ersten Pack-Import), bekommt die Zone Face eingeschaltet; Abschalten bleibt moeglich.
export const HINWEIS_FACE_EIN = 'I switched Face on under What I cover, so every face becomes mine. You can switch it off again.';
// Mia-Preset gewaehlt, Face steht aus (bewusst abgeschaltet oder aus dem Altbestand): kurzer Hinweis auf Einstellungsseite, Popup und Einstieg.
export const HINWEIS_FACE_AUS = 'My face only goes on faces. Switch Face on under What I cover and every face becomes mine.';
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
