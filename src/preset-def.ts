// Aufloeser der Zensur-Presets (Phase 11 E4b): die eine Stelle, die aus den Einstellungen die vollstaendige Behandlung liefert.
// Rein: keine Laufzeit-Importe ausser src/presets.ts (Einheitstests mit `node --experimental-strip-types`), kein Speicher, kein Pack-Zugriff.
// Das Pack kommt als Wert herein (Kurzfassung), nie als Abfrage. Ausserhalb von src/presets.ts und dieser Datei liest keine Stelle die Tabelle direkt.
// Die Nachschlage-Regel (unbekannt gilt als Mosaik) steht in `presetOderMosaik`, die Rueckfall-Regel (Pack fehlt) in `presetFuerPack`, beide in src/presets.ts.
import { PRESET_IDS, presetFuerPack, presetOderMosaik, wirkKennungVon, type AnyKennung, type PresetDef } from './presets.ts';
import type { Freischaltung, PackKurz } from './pack/vertrag.ts';

// Die Definition zu einer Kennung ohne Pack-Blick (= `gewaehlt`): fuer Stellen, die nur eine Kennung halten (Videozensur, Kartenbilder, Texte).
// Unbekannt oder fehlend gilt als Mosaik. Liefert immer dasselbe Objekt der Tabelle.
export function presetDefFuerKennung(kennung: AnyKennung | string | undefined | null): PresetDef {
  return presetOderMosaik(kennung);
}

// Hat das Pack diese Freischaltung? (Die eine Regel; src/pack/vertrag.ts reicht sie unter demselben Namen weiter.)
export function istFreigeschaltet(pack: PackKurz | null | undefined, f: Freischaltung): boolean {
  return !!pack && Array.isArray(pack.freischaltungen) && pack.freischaltungen.includes(f);
}

// Der Schalter "Eye bar" (Phase 11 E4c, `Einstellungen.augenbalken`): ist er an, traegt die Definition die wirksame Augen-Art `balken-immer` (der Balken
// kommt ueber jedes erkannte Gesicht, auch bei ausgeschaltetem Zonen-Schalter `eyes`, derselbe Weg wie beim Zensurbalken). Je Kennung genau eine
// abgeleitete Definition (dasselbe Objekt bei jedem Aufruf, eingefroren); ist der Schalter aus (oder fehlt er), kommt das Objekt der Tabelle selbst.
// Nur der Wert `true` zaehlt (ein Nicht-Boolean gilt als aus, vervollstaendige macht daraus ohnehin false).
const MIT_BALKEN = new Map<string, PresetDef>();
function mitSchalter(d: PresetDef, augenbalken: unknown): PresetDef {
  if (augenbalken !== true || d.augen === 'balken-immer') return d;
  let abgeleitet = MIT_BALKEN.get(d.id);
  if (!abgeleitet) {
    abgeleitet = Object.freeze({ ...d, augen: 'balken-immer' as const });
    MIT_BALKEN.set(d.id, abgeleitet);
  }
  return abgeleitet;
}

// `gewaehlt`: die Definition der eingestellten Kennung (so wie die Karte sie nennt). `gilt`: die Definition, die wirklich wirkt: Mia-Presets nur mit
// Pack (`stil:mia-patch`), Sticker-Presets nur mit Stickern (`zensur:sticker`), sonst Mosaik. Ohne `pack` gilt: kein Pack. Beide tragen die Augen-Art
// mit dem Schalter `augenbalken` (E4c): kein Aufrufer verrechnet den Schalter selbst.
// Custom (E6a): `preset: 'custom'` mit der Mischung `e.custom`; fehlt sie oder ist auch nur ein Feld ungueltig, ist die Definition die von Mosaik (C4, `wirkKennungVon`).
// Mit Pack ersetzt `gilt` die Mischung bausteinweise (Mias Gesicht ohne `stil:mia-patch`, Sticker ohne `zensur:sticker` werden Mosaik), `gewaehlt` bleibt, wie gespeichert.
export function presetDef(e: { preset?: string | null; augenbalken?: boolean | null; custom?: unknown }, pack?: PackKurz | null): { gewaehlt: PresetDef; gilt: PresetDef } {
  const gewaehlt = presetOderMosaik(wirkKennungVon(e));
  const gilt = presetOderMosaik(presetFuerPack(gewaehlt.id, istFreigeschaltet(pack, 'stil:mia-patch'), istFreigeschaltet(pack, 'zensur:sticker')));
  return { gewaehlt: mitSchalter(gewaehlt, e.augenbalken), gilt: mitSchalter(gilt, e.augenbalken) };
}

// Alle 12 Definitionen in der Reihenfolge von PRESET_IDS (Raster der Karten, Kartenbilder, Sperre je Karte); ohne Schalter, so wie die Karte sie nennt.
export function presetKatalog(): readonly PresetDef[] {
  return PRESET_IDS.map((id) => presetOderMosaik(id));
}
