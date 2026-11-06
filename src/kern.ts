// Kern-Bilder (Phase 7, Auftrag I3, Entscheidung 147): Mia im Buero-Look, sicher fuer jede Umgebung. Sie gehoeren zur Demo (ohne Pack), keine
// Pack-Rolle. Beim Bau kopiert wxt.config.ts `../02 Assets Mia/kern/kern-NN.webp` (NN 01 bis 20) nach `kern/` in die Erweiterung, nie ins Repo
// (CLAUDE.md Regel 3). Fehlt der Ordner, gibt es keine Kern-Bilder und die Seiten zeigen keinen leeren Rahmen. Kein Netzverkehr: der Abruf
// betrifft nur die eigenen Dateien der Erweiterung, keine web_accessible_resources.

export const KERN_ORDNER = 'kern';
export const KERN_ANZAHL = 20;

export function kernName(nr: number): string {
  return `kern-${String(nr).padStart(2, '0')}.webp`;
}

// Alle Kern-Bilder, die der Bau mitgebracht hat (Adressen innerhalb der Erweiterung), in Reihenfolge der Nummern. HEAD-Abruf wie bei den Demo-Chibis.
export async function kernBilder(): Promise<string[]> {
  const getURL = browser.runtime.getURL as (pfad: string) => string;
  const probe = async (nr: number): Promise<string | null> => {
    const url = getURL(`/${KERN_ORDNER}/${kernName(nr)}`);
    try {
      const antwort = await fetch(url, { method: 'HEAD' });
      return antwort.ok ? url : null;
    } catch {
      return null;
    }
  };
  // Der Reihe nach ab kern-01 bis zur ersten Luecke: ohne Kern-Bilder genau ein (fehlgeschlagener) Abruf statt zwanzig, und der Bau
  // nummeriert lueckenlos (wxt.config.ts kopiert, was da ist).
  const gefunden: string[] = [];
  for (let nr = 1; nr <= KERN_ANZAHL; nr++) {
    const url = await probe(nr);
    if (!url) break;
    gefunden.push(url);
  }
  return gefunden;
}

// Tageszahl in Ortszeit (ein Wechsel nur um Mitternacht).
export function tagesZahl(jetzt: Date = new Date()): number {
  return Math.floor(Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()) / 86_400_000);
}

// Waehlt `anzahl` verschiedene Bilder, stabil je Tag: der Tag bestimmt den Anfang, die Folge laeuft rund um die Liste. Weniger Bilder als
// gewuenscht: alle (ohne Doppelte). Leere Liste: leer.
export function waehleKern(vorhanden: readonly string[], tag: number, anzahl = 1): string[] {
  if (!vorhanden.length || anzahl < 1) return [];
  const n = Math.min(anzahl, vorhanden.length);
  const start = ((tag % vorhanden.length) + vorhanden.length) % vorhanden.length;
  return Array.from({ length: n }, (_, i) => vorhanden[(start + i) % vorhanden.length]!);
}
