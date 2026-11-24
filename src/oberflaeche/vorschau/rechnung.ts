// Rechnung der Live-Vorschau (Phase 11 E5, V1, V2, V6): rein, ohne Browser und ohne onnxruntime. Aus den Einstellungen des Nutzers, dem Pack-Kurzstand und der
// Kennung des Beispielbilds werden hier die Einstellungen der echten Zensur (das aufgeloeste Preset, genau wie sie der Schleier an den Erkenner schickt), der
// passende Treffersatz und die Flaechen. Flaechen nur ueber `berechneBildFlaechen` (mit `verschmelzen = true` wie im Bild-Weg), keine zweite Rechnung.
import { vervollstaendige, type Einstellungen } from '../../einstellungen.ts';
import { presetDef } from '../../preset-def.ts';
import { nutztMiasGesicht, nutztSticker, type PresetDef } from '../../presets.ts';
import type { PackKurz } from '../../pack/vertrag.ts';
import type { Flaeche, Treffer } from '../../nachrichten.ts';
import { trefferFuer, type BeispielKennung } from '../../beispiel.ts';
import { brauchtGesichtssuche } from '../../erkenner/gesichtssuche.ts';
import { berechneBildFlaechen } from '../../erkenner/zonen.ts';

// Stand der Gesichtssuche in den Patch-Bildern (Teil von `GesichterStand` aus src/oberflaeche/gesichter-status.ts).
export interface GesichterKurz {
  fertig: boolean;
  mit: number;
}

export interface VorschauEingabe {
  einstellungen: Einstellungen;
  pack: PackKurz | null;
  gesichter: GesichterKurz | null;
  bild: BeispielKennung;
  breite: number; // natuerliche Groesse des Bildes (die Vorschau rechnet fuer anzeigeSkala 1)
  hoehe: number;
  // Nur der Testbau: die Kennung, aus der die Wahl von Wort, Gesicht und Sticker gewuerfelt wird (sonst `beispiel:<bild>`).
  kennungTest?: string;
}

export interface VorschauRechnung {
  gilt: PresetDef; // das Preset, das wirklich gilt (ohne Pack gilt der Ersatz)
  e: Einstellungen; // so sieht der Erkenner die Einstellungen: aufgeloestes Preset, Zonen, Rand, Schwelle, Eye bar, Wort-Themen
  mitGesichtssuche: boolean;
  treffer: Treffer[];
  flaechen: Flaeche[];
  kennung: string;
  packStand: number | undefined;
  nutztGesicht: boolean;
  nutztSticker: boolean;
}

// Die Kennung des Bildes im Produkt (Quelle der stabilen Wahl).
export const kennungImProdukt = (bild: BeispielKennung): string => `beispiel:${bild}`;

// Einstellungen, wie sie der Schleier an den Erkenner schickt (pruefung.ts `sendePruefe`): ohne Steigerung (Mias Kontrolle gehoert nicht zur Vorschau).
export function erkennerEinstellungen(einst: Einstellungen, pack: PackKurz | null): { e: Einstellungen; gilt: PresetDef } {
  const gilt = presetDef(einst, pack).gilt;
  const e = vervollstaendige({
    schwelle: einst.schwelle,
    zonen: einst.zonen,
    rand: einst.rand,
    preset: gilt.id,
    ...(einst.augenbalken ? { augenbalken: true } : {}),
    ...(einst.woerterThemen === null ? {} : { woerterThemen: einst.woerterThemen }),
  });
  return { e, gilt };
}

export function rechneVorschau(a: VorschauEingabe): VorschauRechnung {
  const { e, gilt } = erkennerEinstellungen(a.einstellungen, a.pack);
  const mitGesichtssuche = brauchtGesichtssuche(e);
  // Abgelegt sind die Treffer bei der kleinsten Schwelle; die Vorschau filtert wie die Schwelle der Einstellung (V6).
  // Treffer der Gesichtssuche (YuNet) filtert der Erkenner nicht nach dieser Schwelle, die Vorschau darum auch nicht.
  const treffer = trefferFuer(a.bild, mitGesichtssuche).filter((t) => t.quelle === 'yunet' || t.score >= e.schwelle);
  const flaechen = berechneBildFlaechen(treffer, treffer, e, false, a.breite, a.hoehe, true);
  const nutztPack = gilt.braucht !== null || gilt.woerter;
  return {
    gilt,
    e,
    mitGesichtssuche,
    treffer,
    flaechen,
    kennung: a.kennungTest ?? kennungImProdukt(a.bild),
    packStand: nutztPack ? (a.pack?.importiert ?? 0) : undefined,
    nutztGesicht: nutztMiasGesicht(e.preset),
    nutztSticker: nutztSticker(e.preset),
  };
}

// Schluessel des Zeichnens aus ALLEN Eingaben (V8): aendert sich einer, wird neu gezeichnet; bleibt er gleich, nicht.
export function zeichenSchluessel(a: VorschauEingabe): string {
  const { e, gilt } = erkennerEinstellungen(a.einstellungen, a.pack);
  const gesichtStand = nutztMiasGesicht(e.preset) ? (a.gesichter ? [a.gesichter.fertig, a.gesichter.mit] : null) : 0;
  return JSON.stringify([a.bild, gilt.id, e.schwelle, e.zonen, e.rand, e.augenbalken, e.woerterThemen, a.pack?.id ?? null, a.pack?.importiert ?? 0, a.pack?.sticker ?? 0, gesichtStand, a.breite, a.hoehe, a.kennungTest ?? '']);
}
