// Die Einstellungen, die eine Pruefanfrage an den Erkenner traegt (Nachricht `pruefe`): eine einzige reine Funktion, von beiden Wegen benutzt, die so eine Anfrage
// bauen: dem Schleier (src/schleier/pruefung.ts) und der Live-Vorschau (src/oberflaeche/vorschau/rechnung.ts). Sie liest nichts aus dem Browser und baut nur das Objekt;
// welche Wahl (Preset samt Mischung), welche Zonen und welche Zusaetze gelten, entscheidet der Aufrufer.
import type { Einstellungen } from './einstellungen.ts';
import type { PruefEinstellungen } from './nachrichten.ts';

export interface PruefZusatz {
  // Zonen der aktuellen Steigerungsstufe; fehlt das Feld, gelten die eingestellten.
  zonen?: Einstellungen['zonen'];
  // Pack-Stand (`importiert`) fuer Presets, die das Pack brauchen; fehlt das Feld, geht keiner mit.
  packStand?: number;
  // Steigerung Stufe 4: jedes Bild mit einer erkannten Frau ganz verdecken.
  ganzVerdecken?: boolean;
}

export function baueErkennerEinstellungen(
  e: Pick<Einstellungen, 'schwelle' | 'zonen' | 'rand' | 'augenbalken' | 'woerterThemen'>,
  wahl: Pick<PruefEinstellungen, 'preset' | 'custom'>,
  zusatz: PruefZusatz = {},
): PruefEinstellungen {
  return {
    schwelle: e.schwelle,
    zonen: zusatz.zonen ?? e.zonen,
    rand: e.rand,
    ...wahl,
    ...(e.augenbalken ? { augenbalken: true as const } : {}),
    ...(e.woerterThemen === null ? {} : { woerterThemen: e.woerterThemen }),
    ...(zusatz.packStand === undefined ? {} : { packStand: zusatz.packStand }),
    ...(zusatz.ganzVerdecken ? { ganzVerdecken: true } : {}),
  };
}
