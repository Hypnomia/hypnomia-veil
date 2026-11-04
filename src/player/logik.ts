// Reine Teile des Player-Riegels (Auftrag P): Hauptvideo waehlen, Schluessel eines Videos, Wille zum Abspielen, Vollbild-Bezug.
// Kein Browser-Zugriff, nur Typen: laeuft im Einheitstest ohne DOM (tests/einheit/player.test.mjs).

// Kleinste dargestellte Groesse (Pixel), ab der ein Video ohne Adapter-Treffer als Hauptvideo zaehlt.
export const MIN_BREITE = 200;
export const MIN_HOEHE = 150;

export interface Kandidat<T> {
  el: T;
  breite: number;
  hoehe: number;
}

// Groesstes Video ab MIN_BREITE x MIN_HOEHE (nach Flaeche); bei Gleichstand das erste. Keins gross genug: null.
export function waehleGroessten<T>(kandidaten: readonly Kandidat<T>[]): T | null {
  let beste: Kandidat<T> | null = null;
  for (const k of kandidaten) {
    if (!(k.breite >= MIN_BREITE && k.hoehe >= MIN_HOEHE)) continue;
    if (!beste || k.breite * k.hoehe > beste.breite * beste.hoehe) beste = k;
  }
  return beste ? beste.el : null;
}

export interface VideoQuelle {
  getAttribute(name: string): string | null;
  src: string;
  currentSrc: string;
}

// Quelle eines Videos: ein gesetztes `src` zaehlt sofort (currentSrc zieht erst nach), sonst `currentSrc` (source-Kinder). Leer = keine Quelle.
export function quelleVon(v: VideoQuelle): string {
  return v.getAttribute('src') !== null ? v.src : v.currentSrc;
}

// Schluessel einer Quelle fuer den Vergleich: alle blob:-Adressen gelten als dieselbe Quelle (Entscheidung Orchestrator: ein Wechsel von einer
// blob:-Quelle auf eine andere blob:-Quelle am selben Element ist Qualitaetswechsel oder Fehlererholung bei MediaSource, kein neues Video).
// Jede andere Adresse zaehlt fuer sich; ein Wechsel von blob: auf eine Nicht-blob-Adresse (oder umgekehrt) ist eine neue Quelle.
export const quellSchluessel = (quelle: string): string => (quelle.startsWith('blob:') ? 'blob:' : quelle);

// Ist dieses Video mit dieser Quelle schon geloest? `gemerkt` ist die Quelle, bei der das Quiz bestanden wurde.
export const istGeloest = (gemerkt: string | undefined, quelle: string): boolean =>
  gemerkt !== undefined && quellSchluessel(gemerkt) === quellSchluessel(quelle);

export interface VideoStand {
  paused: boolean;
  ended: boolean;
  autoplay: boolean;
  currentTime: number;
}

// Will das Video spielen (laeuft, oder Autoplay steht bevor)?
export const willSpielen = (v: VideoStand): boolean => !v.ended && (!v.paused || (v.autoplay && v.currentTime === 0));

// Betrifft das Vollbild-Element dieses Video (es ist das Video, enthaelt es, oder liegt darin)?
export function vollbildBetrifft(vollbild: { contains(n: unknown): boolean } | null, video: { contains(n: unknown): boolean }): boolean {
  if (!vollbild) return false;
  return (vollbild as unknown) === (video as unknown) || vollbild.contains(video) || video.contains(vollbild);
}
