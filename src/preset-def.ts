// Aufloeser der Zensur-Presets (Phase 11 E4b): die eine Stelle, die aus den Einstellungen die vollstaendige Behandlung liefert.
// Rein: keine Laufzeit-Importe ausser src/presets.ts (Einheitstests mit `node --experimental-strip-types`), kein Speicher, kein Pack-Zugriff.
// Das Pack kommt als Wert herein (Kurzfassung), nie als Abfrage. Ausserhalb von src/presets.ts und dieser Datei liest keine Stelle die Tabelle direkt.
// Die Nachschlage-Regel (unbekannt gilt als Mosaik) steht in `presetOderMosaik`, die Rueckfall-Regel (Pack fehlt) in `presetFuerPack`, beide in src/presets.ts.
import { PRESET_IDS, presetFuerPack, presetOderMosaik, type PresetDef } from './presets.ts';
import type { Freischaltung, PackKurz } from './pack/vertrag.ts';

// Die Definition zu einer Kennung ohne Pack-Blick (= `gewaehlt`): fuer Stellen, die nur eine Kennung halten (Videozensur, Kartenbilder, Texte).
// Unbekannt oder fehlend gilt als Mosaik. Liefert immer dasselbe Objekt der Tabelle.
export function presetDefFuerKennung(kennung: string | undefined | null): PresetDef {
  return presetOderMosaik(kennung);
}

// Hat das Pack diese Freischaltung? (Die eine Regel; src/pack/vertrag.ts reicht sie unter demselben Namen weiter.)
export function istFreigeschaltet(pack: PackKurz | null | undefined, f: Freischaltung): boolean {
  return !!pack && Array.isArray(pack.freischaltungen) && pack.freischaltungen.includes(f);
}

// `gewaehlt`: die Definition der eingestellten Kennung (so wie die Karte sie nennt). `gilt`: die Definition, die wirklich wirkt: Mia-Presets nur mit
// Pack (`stil:mia-patch`), Sticker-Presets nur mit Stickern (`zensur:sticker`), sonst Mosaik. Ohne `pack` gilt: kein Pack.
export function presetDef(e: { preset?: string | null }, pack?: PackKurz | null): { gewaehlt: PresetDef; gilt: PresetDef } {
  const gewaehlt = presetOderMosaik(e.preset);
  const gilt = presetOderMosaik(presetFuerPack(gewaehlt.id, istFreigeschaltet(pack, 'stil:mia-patch'), istFreigeschaltet(pack, 'zensur:sticker')));
  return { gewaehlt, gilt };
}

// Alle 13 Definitionen in der Reihenfolge von PRESET_IDS (Raster der Karten, Kartenbilder, Sperre je Karte).
export function presetKatalog(): readonly PresetDef[] {
  return PRESET_IDS.map((id) => presetOderMosaik(id));
}
