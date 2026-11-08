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

// Listenseite (Startseite, Suche, Kategorien, Kanaele, Ranglisten): dort starten Seiten Vorschau-Videos von selbst. Rein nach dem Pfad: die
// Startseite ("/") immer, bekannte Listen-Pfade (mit oder ohne Sprachpraefix wie /de/). Alles andere gilt als Videoseite (Rueckfall: Riegel wie bisher).
const LISTE_MIT_ENDE = /^(?:\/[a-z]{2})?\/(?:search|s|categories|category|tags?|playlists?|video\/search)(?:\/.*)?$/i;
// Uebersichten von Modellen, Kanaelen und Darstellern gelten nur ohne weiteren Pfadteil als Liste: darunter liegen Videoseiten ("/model/x/video/1"), dort gilt der Riegel wie bisher (Session 17 Fund 7).
const LISTE_UEBERSICHT = /^(?:\/[a-z]{2})?\/(?:channels?|pornstars?|models?)\/?$/i;
const LISTE_EXAKT = /^(?:\/[a-z]{2})?\/(?:new|newest|latest|popular|trending|hot|best|top|top-rated|most-popular|recommended|videos?)\/?$/i;
export const istListenPfad = (pfad: string): boolean => pfad === '' || pfad === '/' || LISTE_MIT_ENDE.test(pfad) || LISTE_UEBERSICHT.test(pfad) || LISTE_EXAKT.test(pfad);

export const GESTE_MS = 1500; // so kurz vor dem Abspielversuch darf die Geste der Person her sein

export interface Geste {
  t: number; // Zeitpunkt (ms, performance.now)
  taste: boolean; // Taste (oder Klick ohne Zeigerposition): zaehlt fuer jedes Video
  x: number;
  y: number;
}
export interface Rechteck {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Gehoert der Abspielversuch zu einer echten Geste der Person? Eine Taste zaehlt immer (kurz davor), ein Zeigen oder Tippen nur ueber dem Video oder
// seinem Player (`flaechen`). So loest ein Klick auf die Altersabfrage oder ein Menue kein Abspielen aus.
export function istGesteFuer(geste: Geste | null, jetzt: number, flaechen: readonly Rechteck[]): boolean {
  if (!geste || jetzt - geste.t > GESTE_MS || jetzt < geste.t) return false;
  if (geste.taste) return true;
  return flaechen.some((r) => geste.x >= r.left && geste.x <= r.right && geste.y >= r.top && geste.y <= r.bottom);
}
