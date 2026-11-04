// Gemeinsames fuer Popup und Einstellungsseite (Auftrag O, PHASE-4-BAUPLAN Abschnitte 8 Punkt 12, 9, 10): reine Funktionen und die
// eingebauten Texte (Entwurf in Mias Stimme, der Texter liest sie gegen). Keine Laufzeit-Importe, damit Einheitstests in Node laufen.
import type { PackKurz, Freischaltung } from '../pack/vertrag';

// Freischaltungen, mit denen der Abschnitt "Adult sites" Sinn hat.
const ERWACHSEN_FREISCHALTUNGEN: readonly Freischaltung[] = [
  'erwachsen:vorschau',
  'erwachsen:quiz',
  'erwachsen:titel',
  'erwachsen:ersatz',
  'quiz:freilegen',
];

export function hatErwachsenFunktionen(pack: PackKurz | null | undefined): boolean {
  return !!pack && Array.isArray(pack.freischaltungen) && ERWACHSEN_FREISCHALTUNGEN.some((f) => pack.freischaltungen.includes(f));
}

// "11 h 42 min" ab einer Stunde, sonst "42 min 10 s". Immer aufgerundet auf die Sekunde, nie negativ.
export function formatiereRest(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}

// Eingebaute Kommentare je Stufe (0 bis 4), wenn das Pack keine Gruppe `stufeN` mitbringt.
export const STUFEN_TEXT: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "Nothing extra yet. Behave and it stays that way.",
  1: "A little more covered now. I'm only warming up.",
  2: 'Faces, eyes and mouths are covered too. I do enjoy this level.',
  3: "Belly, feet and armpits as well. Hardly anything gets past me now.",
  4: "Every picture where I spot a woman is covered. Time away from adult sites brings the level down.",
};

// Wahl eines Satzes aus der Pack-Gruppe, sonst der eingebaute Text. `zufall` 0 bis unter 1 (injizierbar).
export function waehleSatz(gruppe: readonly string[] | undefined, eingebaut: string, zufall: number): string {
  const sauber = (gruppe ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (sauber.length === 0) return eingebaut;
  return sauber[Math.min(sauber.length - 1, Math.floor(zufall * sauber.length))]!;
}

// Pose je Lage fuer den Platz `chibi` im Popup.
export function posePopup(pausiert: boolean, stufe: number): 'sprechblase' | 'schmollen' | 'zwinkern' | 'nein' | 'arme' | 'thron' {
  if (pausiert) return 'schmollen';
  if (stufe >= 4) return 'thron';
  if (stufe === 3) return 'arme';
  if (stufe === 2) return 'nein';
  if (stufe === 1) return 'zwinkern';
  return 'sprechblase';
}
