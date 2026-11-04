// Mia-Chibis (PHASE-4-BAUPLAN Abschnitt 10, Entscheidung 102). Vertrag vom Orchestrator: Posen, Groessen, Ablage der Demo-Chibis.
// Text steht nie im Bild: Sprechblase und Schild bleiben leer, Mias Satz kommt als echter Text darueber (`textContent`).
// Jeder Ort (Popup, Riegel, Galerie, Einstellungsseite, Mini-Meldung) hat einen Platz `chibi`, der ohne Bild sauber auf Text zurueckfaellt.
//
// Woher die Bilder kommen:
//   Demo (ohne Pack): wenige suesse SFW-Chibis, beim Bau aus `../02 Assets Mia/chibi/<pose>.webp` nach `/chibi/<pose>.webp` in die
//     Erweiterung kopiert (wxt.config.ts, nie ins Repo). Fehlt der Ordner, gibt es keine Demo-Chibis (Rueckfall auf Text).
//   Pack (Freischaltung `chibi:pack`): Dateien mit Rolle `chibi`, der Dateiname enthaelt die Pose (z. B. `chibi/jubeln-2.webp`).
// Erweiterungsseiten (Popup, Optionen, Galerie) laden Demo-Chibis direkt ueber `demoChibiAdresse`, Pack-Chibis aus IndexedDB.
// Das Content-Script (Riegel, Mini-Meldung) fragt den Erkenner (`erkenner/packbild`, rolle `chibi`, schluessel = Pose); der liefert ein
// Pack-Chibi mit Freischaltung, sonst das Demo-Chibi, als Data-URL (keine web_accessible_resources noetig).

export const CHIBI_POSEN = ['schild', 'sprechblase', 'arme', 'nein', 'zwinkern', 'jubeln', 'schmollen', 'spirale', 'thron'] as const;
export type ChibiPose = (typeof CHIBI_POSEN)[number];

export const CHIBI_MAX_SEITE = 512; // Popup, Riegel, Galerie, Einstellungsseite
export const CHIBI_MINI_SEITE = 256; // kleine Meldungen auf Seiten
export const CHIBI_DEMO_ORDNER = 'chibi';

// Adresse eines Demo-Chibis in der Erweiterung oder null, wenn es nicht mitgebaut wurde (HEAD-Abruf der eigenen Datei, kein Netz).
export async function demoChibiAdresse(pose: ChibiPose): Promise<string | null> {
  // getURL kennt nur gebaute Seiten als Typ; die Chibis kopiert erst der Bau hinein (wxt.config.ts), darum die Umwandlung.
  const url = (browser.runtime.getURL as (pfad: string) => string)(`/${CHIBI_DEMO_ORDNER}/${pose}.webp`);
  try {
    const antwort = await fetch(url, { method: 'HEAD' });
    return antwort.ok ? url : null;
  } catch {
    return null;
  }
}

// Passt ein Pack-Dateiname zur Pose? (`chibi/jubeln-2.webp` passt zu `jubeln`.)
export function passtZurPose(name: string, pose: ChibiPose): boolean {
  const datei = name.split('/').pop() ?? '';
  return datei === `${pose}.webp` || datei === `${pose}.png` || datei.startsWith(`${pose}-`) || datei.startsWith(`${pose}.`);
}
