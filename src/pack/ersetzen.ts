// Vergleich eines geprueften Packs mit dem vorhandenen (Session 12, Auftrag P, Entscheidung 141). Reine Funktion, kein Speicher, kein DOM.
// Die Einstellungsseite zeigt danach je Fall einen Hinweis, der Import selbst merkt sich den Fall, um Einstellungen nur beim ersten Pack
// anzufassen. Versionen vergleicht `versionHoeher` (nur die drei Zahlen, ein Zusatz wie "-beta" zaehlt nicht).
import { versionHoeher } from './format.ts';
import type { PackKurz } from './vertrag.ts';

export type PackVergleich = 'erstes' | 'neuer' | 'gleich' | 'aelter' | 'anderes';

// Was vom neuen Pack schon vor dem Import bekannt ist (aus dem Manifest).
export interface NeuesPack {
  id: string;
  version: string;
  titel: string;
}

// `alt`: das vorhandene Pack oder null.
//   erstes   nichts vorhanden
//   anderes  andere Pack-Kennung: das vorhandene Pack wird ersetzt
//   neuer    gleiche Kennung, hoehere Version
//   gleich   gleiche Kennung, gleiche Version (erneutes Hinzufuegen repariert)
//   aelter   gleiche Kennung, niedrigere Version (nur nach Bestaetigung)
export function vergleichePacks(alt: Pick<PackKurz, 'id' | 'version' | 'titel'> | null, neu: NeuesPack): PackVergleich {
  if (!alt) return 'erstes';
  if (alt.id !== neu.id) return 'anderes';
  if (versionHoeher(neu.version, alt.version)) return 'neuer';
  if (versionHoeher(alt.version, neu.version)) return 'aelter';
  return 'gleich';
}

// Ersetzt der Fall ein vorhandenes Pack? Dann bleiben Einstellungen, Ledger, Steigerung und Einstieg, wie sie sind.
export function ersetztVorhandenes(fall: PackVergleich): boolean {
  return fall !== 'erstes';
}
