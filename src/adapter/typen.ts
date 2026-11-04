// Adapter-Geruest (PHASE-4-BAUPLAN Abschnitt 8, Auftrag E): je Seite eine kleine Datei mit Selektoren. Reine Daten, kein Browser-Zugriff.
// Heute genutzt: Vorschau-Links, Vorschau-Bilder und Hover-Vorschauvideos (Vorschau-Tausch). `titel` und `player` sind fuer die
// spaeteren Auftraege (Titel mit Mias Kommentar, Player-Riegel) reserviert und werden hier noch nicht gelesen.
// Die Selektoren der echten Seiten sind Annahmen ueber deren Aufbau (nicht gegen die Live-Seiten gemessen): sie sind Daten und lassen sich
// ohne Code-Aenderung anpassen. Trifft ein Selektor nichts, greift der normale Schleier (Bilder werden dann geprueft, nicht getauscht).

import type { SeitenName } from './liste';

export interface Adapter {
  name: SeitenName;
  // Links (oder Karten) zu Videoseiten: ein Bild oder Inline-Hintergrund darin gilt als Vorschaubild.
  vorschauLinks: readonly string[];
  // Zusaetzliche Selektoren fuer Vorschaubilder selbst, auch ausserhalb von Links (z. B. Beitragsbilder bei Abo-Seiten).
  vorschauBilder: readonly string[];
  // Vorschauvideos, die beim Darueberfahren starten: im Tausch-Modus versteckt, nie gezeigt.
  hoverVideos: readonly string[];
  // Reserviert fuer Auftrag T (Titel) und P (Player).
  titel?: readonly string[];
  player?: readonly string[];
}

// Minimaler Teil eines Elements, den die Auswahl braucht (Einheitstests rufen sie ohne DOM mit einer Attrappe auf).
export interface ElementLike {
  matches(selektor: string): boolean;
  closest(selektor: string): { getAttribute(name: string): string | null } | null;
}
