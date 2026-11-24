// Die eine Bedingung, unter der die Pruefung Gesichter mit YuNet sucht (ohne onnxruntime, damit Erweiterungsseiten sie benutzen koennen).
// Der Erkenner ruft sie vor der Suche, die Vorschau waehlt mit ihr den Treffersatz (src/beispiel.ts, `trefferFuer`). Keine zweite Kopie.
import type { Einstellungen } from '../einstellungen';
import { presetDef } from '../preset-def.ts';
import { zonenFuerSuche } from '../presets.ts';

// Mindestens eine Gesichtszone an: dann braucht die Pruefung YuNet.
export function zonenBrauchenGesicht(zonen: Einstellungen['zonen']): boolean {
  return zonen.eyes.an || zonen.mouth.an || zonen.face.an || zonen.head.an;
}

// Sucht die Pruefung mit diesen Einstellungen Gesichter? Zonen der Suche (bei Balken laufen die Augen mit, auch mit dem Schalter Eye bar) und das
// aufgeloeste Preset ohne Pack-Blick (`gewaehlt`), genau wie der Erkenner.
export function brauchtGesichtssuche(e: Einstellungen): boolean {
  return zonenBrauchenGesicht(zonenFuerSuche(presetDef(e).gewaehlt, e.zonen));
}
