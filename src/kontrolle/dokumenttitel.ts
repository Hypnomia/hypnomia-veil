// Absprache am Dokumenttitel (Session 10, Orchestrator nach dem Gesamtlauf): zwei Teile schreiben `document.title`, der Tab-Titel (K1, Mias
// Satz im verborgenen Tab) und der Titel mit Kommentar (Auftrag T, Erwachsenenseiten). Stellt T zurueck (Pause, Pack weg), waehrend K1 gerade
// seinen Satz zeigt, steht im Titel nicht T's Fassung; ohne Absprache stellte K1 danach T's Fassung mit Kommentar als "Original" her und sie
// bliebe in der Pause stehen. Darum meldet K1 hier, wie es sein gemerktes Original ersetzen kann.
type Ersetzer = (alt: string, neu: string) => boolean;
let ersetzer: Ersetzer | null = null;

// K1 meldet sich an (null zum Abmelden).
export function meldeTabtitelErsetzer(f: Ersetzer | null): void {
  ersetzer = f;
}

// T: haelt K1 gerade `alt` als Original, soll es stattdessen `neu` herstellen. Wahr, wenn K1 es uebernommen hat.
export function ersetzeTabtitelOriginal(alt: string, neu: string): boolean {
  try {
    return ersetzer ? ersetzer(alt, neu) : false;
  } catch {
    return false;
  }
}
