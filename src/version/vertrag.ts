// Version und Update-Hinweis (Vertrag Session 11, Auftrag V, PHASE-6-BAUPLAN Abschnitt 5, Entscheidungen 22 und 26).
// Chrome/Edge: der Hintergrund liest hoechstens einmal je 24 Stunden `version.json` aus dem oeffentlichen Repo (ohne Anmeldedaten).
// Firefox: kein eigener Abruf, Status ueber runtime.requestUpdateCheck.

export const VERSION_URL = 'https://raw.githubusercontent.com/Hypnomia/hypnomia-veil/main/version.json';
export const RELEASE_URL = 'https://github.com/Hypnomia/hypnomia-veil/releases/latest';
export const VERSION_SCHLUESSEL = 'versionPruefung';
export const VERSION_ABSTAND_MS = 24 * 60 * 60 * 1000;

// Inhalt von `version.json` im Repo (Release-Skript pflegt sie, Phase 10): { "version": "0.7.0", "datum": "2026-11-06" }.
export interface VersionDatei {
  version: string;
  datum?: string;
}

// Gespeicherter Stand der letzten Pruefung (storage.local).
export interface VersionStand {
  geprueft: number | null; // ms seit 1970
  neueste: string | null; // Version aus version.json
  fehler: boolean; // letzter Abruf fehlgeschlagen
}

// Baudatum: `import.meta.env.VEIL_BAUDATUM` (JJJJ-MM-TT, beim Bau eingesetzt, wxt.config.ts). Nur in Laufzeit-Modulen lesen (nicht hier,
// damit diese Datei in Node-Einheitstests ladbar bleibt); src/hintergrund/version.ts liefert es in AntwortVersion.datum.
