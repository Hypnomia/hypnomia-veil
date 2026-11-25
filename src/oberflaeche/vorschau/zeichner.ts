// Zeichner der Live-Vorschau (Phase 11 E5, V1, V3, V4, V9): laedt das Beispielbild aus der Erweiterung, wartet die Wort-Schrift ab, holt Gesicht, Sticker und Wort
// ueber dieselben Funktionen wie der Erkenner (src/erkenner/auswahl.ts) und malt mit `rendereZensur`. Gezeigt wird nur das Ergebnis als Data-Adresse; das Rohbild
// liegt nur als Bitmap im Speicher und ist nie sichtbar. Kein Erkenner, kein onnxruntime, kein Netz, keine offenen Blob-Adressen, nur lesend.
import { dekodiereBild } from '../../erkenner/dekodiere';
import { gesichterFuer, stickerFuer, woerterFuer } from '../../erkenner/auswahl';
import { hatTransparenz, kannAlpha, rendereZensur } from '../../erkenner/stile';
import { starteGesichtsScan } from '../../pack/patches';
import { rechneVorschau, type VorschauEingabe } from './rechnung';
import { PLATZHALTER_GESICHT_B, PLATZHALTER_GESICHT_H, maleHerz, malePlatzhalterGesicht } from './platzhalter';

export interface ZeichenErgebnis {
  bild: string; // Data-Adresse (JPEG oder PNG wie beim Erkenner)
  // true: eine Flaeche sollte Mias Gesicht tragen, die Gesichtssuche der Patch-Bilder ist in dieser Seite aber (noch) nicht lesbar, es gilt der Ersatz.
  gesichtOffen: boolean;
  // true: mit diesen Einstellungen gibt es auf diesem Bild nichts zu verdecken (null Flaechen aus rechnung.ts), `bild` ist das unverdeckte Bild, ueber die Leinwand gelaufen
  // und als Data-Adresse geliefert (nie als Dateipfad der Erweiterung). Nur bei genau null Flaechen.
  offen: boolean;
}

// Bei null Flaechen kommt das Bild unverdeckt (`offen`), wie es die Erweiterung auf einer Seite liese. Wirft bei einem Fehler (Bild nicht ladbar), die Ansicht bleibt beim alten Bild.
export async function zeichneBeispiel(a: VorschauEingabe, adresse: string): Promise<ZeichenErgebnis> {
  const r = rechneVorschau(a);
  const offen = r.flaechen.length === 0;
  const antwort = await fetch(adresse);
  if (!antwort.ok) throw new Error('Beispielbild nicht ladbar');
  const blob = await antwort.blob();
  const bitmap = await dekodiereBild(blob, { breite: a.breite, hoehe: a.hoehe });
  try {
    // Das Arbeitsbild des Erkenners ist das Bild selbst, solange seine lange Seite nicht ueber 1600 liegt (die Beispielbilder sind 960 hoch).
    const b = bitmap.width;
    const h = bitmap.height;
    const e = r.e;
    // Mias Gesicht: die Suche in den Patch-Bildern liest in dieser Seite nur die Ablage des Erkenners (V3: kein YuNet hier). Erst lesen, dann waehlen.
    if (r.nutztGesicht) await starteGesichtsScan(r.packStand).catch(() => undefined);
    // Schau gesperrter Stile (E6b B8): statt Mias Gesicht und der Sticker aus dem Pack die gemalten Platzhalter, sonst derselbe Weg.
    const platzGesicht = r.schau ? malePlatzhalterGesicht() : null;
    const platzHerz = r.schau ? maleHerz() : null;
    const gesichter = r.nutztGesicht
      ? await gesichterFuer(r.kennung, r.flaechen, r.packStand)
      : platzGesicht
        ? { bilder: r.flaechen.map((f) => (f.behandlung === 'mia-gesicht' ? { bild: platzGesicht as CanvasImageSource, ausschnitt: [0, 0, PLATZHALTER_GESICHT_B, PLATZHALTER_GESICHT_H] as [number, number, number, number] } : null)), freigeben: () => undefined }
        : null;
    const anzeigeSkala = 1;
    let sticker: Awaited<ReturnType<typeof stickerFuer>> | null = null;
    if (platzHerz) sticker = { bilder: r.flaechen.map((f) => (f.behandlung === 'sticker' || (f.behandlung === 'mia-gesicht' && f.ersatz === 'sticker') ? (platzHerz as CanvasImageSource) : null)), schluessel: r.flaechen.map((f) => `schau|${f.zone}|${f.box.join(',')}`), freigeben: () => undefined } as unknown as Awaited<ReturnType<typeof stickerFuer>>;
    try {
      if (r.nutztSticker) sticker = await stickerFuer(r.kennung, r.flaechen, r.packStand, anzeigeSkala);
    } catch {
      sticker = null;
    }
    try {
      // Woerter erst, wenn `VEIL Wort` wirklich geladen ist (V9): woerterFuer wartet darauf, sobald ein Wort gebraucht wird.
      // Schau: das Wort ist immer MIA (leere Themenwahl), nie aus dem Pack.
      const woerter = await woerterFuer(r.kennung, r.flaechen, r.schau ? [] : e.woerterThemen, r.packStand, r.gilt.id);
      const nurSchwarz = r.gilt.augen !== 'wie-koerper';
      const png = nurSchwarz && kannAlpha(blob.type) && hatTransparenz(bitmap, b, h);
      const bild = await rendereZensur(bitmap, b, h, r.flaechen, r.gilt.id, {
        anzeigeSkala,
        png,
        gesichter: gesichter?.bilder,
        woerter,
        sticker: sticker?.bilder,
        stickerSchluessel: sticker?.schluessel,
      });
      const gesichtOffen = !!gesichter && r.flaechen.some((f, i) => f.behandlung === 'mia-gesicht' && !gesichter.bilder[i]);
      return { bild, gesichtOffen, offen };
    } finally {
      gesichter?.freigeben();
      sticker?.freigeben();
    }
  } finally {
    bitmap.close();
  }
}
