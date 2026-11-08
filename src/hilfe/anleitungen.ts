// Hilfe-Seite (Session 17): Liste der Anleitungen aus `docs/` (beim Bau eingebettet, offline). Reihenfolge fest nach dem Weg einer neuen
// Person; unbekannte Dateien kommen alphabetisch dahinter. `README.md` heisst in der Hilfe "readme" und ist die Startseite.
import { lies, suchText, titel, type Block } from './markdown.ts';
import { loeseKurzadresse } from './anker.ts';

export interface Anleitung {
  name: string; // Dateiname ohne .md, klein
  titel: string;
  bloecke: Block[];
  such: string;
}

export const REIHENFOLGE = [
  'readme',
  'install-chrome',
  'install-edge',
  'install-firefox',
  'install-firefox-android',
  'install-orion-ios',
  'mia-pack',
  'how-i-work',
  'pause',
  'safety',
  'updates',
  'uninstall',
  'faq',
] as const;

// `quellen`: Dateipfad (beliebiger Ordner) auf den Rohtext.
export function baueAnleitungen(quellen: Record<string, string>): Anleitung[] {
  const liste: Anleitung[] = [];
  for (const [pfad, text] of Object.entries(quellen)) {
    const datei = pfad.split('/').pop() ?? '';
    const m = /^([A-Za-z0-9-]+)\.md$/.exec(datei);
    if (!m || typeof text !== 'string') continue;
    const name = (m[1] ?? '').toLowerCase();
    const bloecke = lies(text);
    liste.push({ name, titel: titel(bloecke, name), bloecke, such: `${name} ${suchText(bloecke)}` });
  }
  const rang = (n: string): number => {
    const i = (REIHENFOLGE as readonly string[]).indexOf(n);
    return i < 0 ? REIHENFOLGE.length : i;
  };
  return liste.sort((a, b) => rang(a.name) - rang(b.name) || a.name.localeCompare(b.name));
}

// Filtert nach allen Woertern der Suche (jedes Wort muss vorkommen), Gross- und Kleinschreibung egal.
export function filtere(liste: readonly Anleitung[], suche: string): Anleitung[] {
  const woerter = suche.toLowerCase().split(/\s+/).filter(Boolean);
  if (!woerter.length) return [...liste];
  return liste.filter((a) => woerter.every((w) => a.such.includes(w) || a.titel.toLowerCase().includes(w)));
}

// Adresse `#name` oder `#name/anker` lesen; unbekannte Namen fuehren zur Startseite.
export function leseAdresse(hash: string, liste: readonly Anleitung[]): { name: string; anker: string } {
  let ohneRaute = hash.replace(/^#/, '');
  try {
    ohneRaute = decodeURIComponent(ohneRaute);
  } catch {
    // kaputtes Prozentzeichen: der Rohtext zaehlt (unbekannt, fuehrt zur Startseite)
  }
  const roh = loeseKurzadresse(ohneRaute);
  const [name = '', anker = ''] = roh.split('/');
  const gibt = liste.some((a) => a.name === name);
  return { name: gibt ? name : (liste[0]?.name ?? ''), anker: gibt ? anker.replace(/[^a-z0-9-]/g, '') : '' };
}
