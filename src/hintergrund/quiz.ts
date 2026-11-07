// Hintergrund-Handler fuer Quiz-Bank und Mias Saetze aus dem Pack (Auftrag Q, PHASE-4-BAUPLAN Abschnitt 3).
// Vertrag: NachrichtHintergrundPackDaten in src/nachrichten.ts. Liest die JSON-Datei der Rolle aus IndexedDB (src/pack/db.ts), prueft sie
// mit src/quiz/vertrag.ts und antwortet nur mit Freischaltung (`erwachsen:quiz` oder `quiz:freilegen` fuer quiz, `erwachsen:titel` oder
// eine Quiz-Freischaltung fuer texte); sonst `daten: null`. Kein Pack, kaputte Datei oder Fehler: `daten: null` (nie ein Fehler).
import type { AntwortPackDaten, NachrichtHintergrundPackDaten } from '../nachrichten';
import { leseDateiBytes, leseMeta, leseNamenMitRolle } from '../pack/db';
import type { Freischaltung } from '../pack/vertrag';
import { pruefeQuizBank, pruefeTexte, type QuizBank, type Texte } from '../quiz/vertrag';

const MAX_BYTES = 4_000_000;
const QUIZ_FREI: Freischaltung[] = ['erwachsen:quiz', 'quiz:freilegen'];
// zensur:steigerung: Mias Kommentar je Stufe (Gruppen stufe1 bis stufe4) steht in derselben Datei.
const TEXTE_FREI: Freischaltung[] = ['erwachsen:titel', 'erwachsen:quiz', 'quiz:freilegen', 'zensur:steigerung'];

// Zwischenspeicher je Importzeitpunkt (der Service Worker darf jederzeit enden; dann liest der naechste Aufruf neu).
let zwischen: { schluessel: string; quiz?: QuizBank | null; texte?: Texte | null } | null = null;

async function lade(rolle: 'quiz' | 'texte'): Promise<QuizBank | Texte | null> {
  const meta = await leseMeta();
  if (!meta || !Array.isArray(meta.freischaltungen)) return null;
  const erlaubt = (rolle === 'quiz' ? QUIZ_FREI : TEXTE_FREI).some((f) => meta.freischaltungen.includes(f));
  if (!erlaubt) return null;
  const schluessel = `${meta.id}:${meta.importiert}`;
  if (zwischen?.schluessel !== schluessel) zwischen = { schluessel };
  if (rolle in zwischen && zwischen[rolle] !== undefined) return zwischen[rolle] ?? null;
  let ergebnis: QuizBank | Texte | null = null;
  try {
    const name = (await leseNamenMitRolle(rolle))[0];
    // Grenze schon beim Lesen, Bytes bei offener Verbindung (siehe kopiereBlob in db.ts).
    const datei = name ? await leseDateiBytes(name, MAX_BYTES) : null;
    if (datei) {
      const roh = JSON.parse(new TextDecoder().decode(datei.bytes)) as unknown;
      ergebnis = rolle === 'quiz' ? pruefeQuizBank(roh) : pruefeTexte(roh);
    }
  } catch {
    ergebnis = null;
  }
  if (rolle === 'quiz') zwischen.quiz = ergebnis as QuizBank | null;
  else zwischen.texte = ergebnis as Texte | null;
  return ergebnis;
}

export async function bearbeitePackDaten(n: NachrichtHintergrundPackDaten): Promise<AntwortPackDaten> {
  if (n.rolle !== 'quiz' && n.rolle !== 'texte') return { ok: true, daten: null };
  try {
    return { ok: true, daten: await lade(n.rolle) };
  } catch {
    return { ok: true, daten: null };
  }
}
