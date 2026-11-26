// Rechnung der Live-Vorschau (Phase 11 E5, V1, V2, V6): rein, ohne Browser und ohne onnxruntime. Aus den Einstellungen des Nutzers, dem Pack-Kurzstand und der
// Kennung des Beispielbilds werden hier die Einstellungen der echten Zensur (das aufgeloeste Preset, genau wie sie der Schleier an den Erkenner schickt), der
// passende Treffersatz und die Flaechen. Flaechen nur ueber `berechneBildFlaechen` (mit `verschmelzen = true` wie im Bild-Weg), keine zweite Rechnung.
import { vervollstaendige, type Einstellungen } from '../../einstellungen.ts';
import { presetDef } from '../../preset-def.ts';
import { baueErkennerEinstellungen } from '../../pruef-einstellungen.ts';
import { nutztMiasGesicht, nutztSticker, wahlAusDef, type PresetDef } from '../../presets.ts';
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
  // Schau gesperrter Stile ohne Pack (E6b B8): `einstellungen` ist dann die gedachte Wahl (der angetippte Stil, wie er mit Pack gewaehlt waere), und es wird gerechnet, als
  // haette das Pack alle Freischaltungen. Mias Gesicht und Sticker malt der Zeichner dann als Platzhalter, nie aus dem Pack. Fehlt das Feld: wie bisher.
  schau?: boolean;
  // Nur der Testbau: die Kennung, aus der die Wahl von Wort, Gesicht und Sticker gewuerfelt wird (sonst `beispiel:<bild>`).
  kennungTest?: string;
}

// Das gedachte Pack der Schau: alles frei, sonst leer. Es wird nie gespeichert und nie an einen Erkenner geschickt.
export const SCHAU_PACK: PackKurz = {
  id: 'schau',
  version: '0',
  titel: '',
  freischaltungen: ['stil:mia-patch', 'zensur:sticker'],
  bilder: 0,
  vorschau: 0,
  chibis: 0,
  werbung: 0,
  sticker: 0,
  groesse: 0,
  importiert: 0,
};

// Die gedachten Einstellungen der Schau: die des Nutzers mit dem angetippten Stil (der Teil kommt aus `waehlePreset`, `waehleCustom`, `faceSchreibteil`, `flaecheSchreibteil`).
export const schauEinstellungen = (einst: Einstellungen, teil: Partial<Einstellungen>): Einstellungen => vervollstaendige({ ...einst, ...teil });

export interface VorschauRechnung {
  schau: boolean;
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
  // bei Custom `preset: 'custom'` samt der (nach dem Pack ersetzten) Mischung, wie die Nachricht an den Erkenner (E6a C7); die Bauart ist die des Schleiers
  const e = vervollstaendige(baueErkennerEinstellungen(einst, wahlAusDef(gilt)));
  return { e, gilt };
}

export function rechneVorschau(a: VorschauEingabe): VorschauRechnung {
  const { e, gilt } = erkennerEinstellungen(a.einstellungen, a.schau ? SCHAU_PACK : a.pack);
  const mitGesichtssuche = brauchtGesichtssuche(e);
  // Abgelegt sind die Treffer bei der kleinsten Schwelle; die Vorschau filtert wie die Schwelle der Einstellung (V6).
  // Treffer der Gesichtssuche (YuNet) filtert der Erkenner nicht nach dieser Schwelle, die Vorschau darum auch nicht.
  const treffer = trefferFuer(a.bild, mitGesichtssuche).filter((t) => t.quelle === 'yunet' || t.score >= e.schwelle);
  const flaechen = berechneBildFlaechen(treffer, treffer, e, false, a.breite, a.hoehe, true);
  const nutztPack = gilt.braucht !== null || gilt.woerter;
  return {
    schau: !!a.schau,
    gilt,
    e,
    mitGesichtssuche,
    treffer,
    flaechen,
    kennung: a.kennungTest ?? kennungImProdukt(a.bild),
    packStand: nutztPack && !a.schau ? (a.pack?.importiert ?? 0) : undefined,
    // In der Schau kommt nichts aus dem Pack: Gesicht und Sticker sind Platzhalter (zeichner.ts)
    nutztGesicht: !a.schau && nutztMiasGesicht(gilt.id),
    nutztSticker: !a.schau && nutztSticker(gilt.id),
  };
}

// Schluessel des Zeichnens aus ALLEN Eingaben (V8): aendert sich einer, wird neu gezeichnet; bleibt er gleich, nicht. Die Schau steht als eigenes Objekt an der Stelle der
// Pack-Kennung (eine Zeichenkette oder null): eine Pack-Kennung, wie auch immer sie lautet, kann damit nie den Schluessel der Schau ergeben.
export function zeichenSchluessel(a: VorschauEingabe): string {
  const { e, gilt } = erkennerEinstellungen(a.einstellungen, a.schau ? SCHAU_PACK : a.pack);
  const gesichtStand = nutztMiasGesicht(gilt.id) && !a.schau ? (a.gesichter ? [a.gesichter.fertig, a.gesichter.mit] : null) : 0;
  return JSON.stringify([a.bild, gilt.id, e.schwelle, e.zonen, e.rand, e.augenbalken, e.woerterThemen, a.schau ? { schau: true } : (a.pack?.id ?? null), a.schau ? 0 : (a.pack?.importiert ?? 0), a.schau ? 0 : (a.pack?.sticker ?? 0), gesichtStand, a.breite, a.hoehe, a.kennungTest ?? '']);
}
