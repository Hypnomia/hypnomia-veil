// Auswahl der Pack-Inhalte je Flaeche (Mias Gesicht, Sticker, Woerter): stabil je Bild und Flaeche ueber den Schluessel `kennung|zone|box`. Der Erkenner (Hintergrund,
// Offscreen-Dokument) und die Live-Vorschau der Erweiterungsseiten (src/oberflaeche/vorschau/) benutzen dieses Modul gemeinsam, damit die Vorschau genau die Wahl
// trifft, die die echte Zensur trifft (Phase 11 E5, V1). Reine Verschiebung aus erkenner.ts, ohne onnxruntime.
import { ganzesBildBehandlung, hatWort, waehleWort } from '../presets.ts';
import { holeJeFlaeche, stickerPasst } from '../sticker.ts';
import type { Einstellungen } from '../einstellungen';
import type { Flaeche } from '../nachrichten';
import { waehleGesichtsPatch } from '../pack/patches';
import { ladeWoerter } from '../pack/woerter';
import { waehleSticker } from '../pack/sticker';
import { ladeWortSchrift } from './wort-schrift';
import type { GesichtsBild } from './stile';

// Zu jeder Flaeche mit Mias Gesicht ein Gesichts-Patch aus dem Pack (Auswahl stabil je Bild und Flaeche), dazu die Rueckgabe der geliehenen
// Bilder (nach dem Rendern aufrufen). `null` an einer Stelle: dort ist keiner zu haben (kein Pack, kein Gesicht in den Patches), die
// Flaeche faellt auf ihren Ersatz zurueck. `packStand`: das Pack, das der Aufrufer kennt.
export async function gesichterFuer(
  kennung: string,
  flaechen: readonly Flaeche[],
  packStand: number | undefined,
): Promise<{ bilder: (GesichtsBild | null)[]; freigeben: () => void }> {
  const bilder: (GesichtsBild | null)[] = [];
  const frei: (() => void)[] = [];
  for (const f of flaechen) {
    if (f.behandlung !== 'mia-gesicht') {
      bilder.push(null);
      continue;
    }
    const wahl = await waehleGesichtsPatch(`${kennung}|${f.zone}|${f.box.join(',')}`, packStand);
    bilder.push(wahl ? { bild: wahl.bild, ausschnitt: wahl.ausschnitt } : null);
    if (wahl) frei.push(wahl.freigeben);
  }
  return { bilder, freigeben: () => frei.forEach((x) => x()) };
}

// Zu jeder Flaeche, die mit Sticker enden kann (Behandlung `sticker`, oder Mias Gesicht mit Ersatz `sticker`), ein Sticker aus dem Pack (Wahl
// stabil je Bild und Flaeche, derselbe Schluessel wie beim Gesicht) und der Schluessel fuer die Pastellfarbe. Flaechen, die zu klein fuer einen Sticker
// sind (src/sticker.ts stickerPasst), laden keinen. `null` an einer Stelle: dort ist keiner zu haben (kein Pack, ohne `zensur:sticker`, nicht
// dekodierbar): die Flaeche steht ohne Sticker, sie wird trotzdem gemalt (Hide-first). Dazu die Rueckgabe der geliehenen Bilder (nach dem Rendern aufrufen).
export async function stickerFuer(
  kennung: string,
  flaechen: readonly Flaeche[],
  packStand: number | undefined,
  anzeigeSkala: number,
): Promise<{ bilder: (CanvasImageSource | null)[]; schluessel: string[]; freigeben: () => void }> {
  const frei: (() => void)[] = [];
  const schluessel = flaechen.map((f) => `${kennung}|${f.zone}|${f.box.join(',')}`);
  const kannSticker = (f: Flaeche): boolean => f.behandlung === 'sticker' || (f.behandlung === 'mia-gesicht' && f.ersatz === 'sticker');
  // Nach dem ersten Lesefehler oder der ersten Zeitueberschreitung der Pack-Datenbank wird fuer diese Pruefung nichts weiter angefordert (holeJeFlaeche).
  const bilder = await holeJeFlaeche<CanvasImageSource>(
    flaechen.length,
    (i) => kannSticker(flaechen[i]!) && stickerPasst(flaechen[i]!.wortBox === undefined ? flaechen[i]!.box : (flaechen[i]!.wortBox ?? [0, 0, 0, 0]), anzeigeSkala),
    async (i) => {
      try {
        const r = await waehleSticker(schluessel[i]!, packStand);
        if (r.wahl) frei.push(r.wahl.freigeben);
        return { wert: r.wahl ? r.wahl.bild : null, fehler: r.fehler };
      } catch {
        return { wert: null, fehler: true }; // nie ein Fehler fuer die Pruefung: die Flaeche steht ohne Sticker
      }
    },
  );
  return { bilder, schluessel, freigeben: () => frei.forEach((x) => x()) };
}

// Je Flaeche das Wort fuer die Behandlungen mit Wort (stabil je Bild und Flaeche), sonst ''.
export async function woerterFuer(
  kennung: string,
  flaechen: readonly Flaeche[],
  themen: string[] | null,
  packStand: number | undefined,
  preset: Einstellungen['preset'],
): Promise<string[]> {
  const standard = ganzesBildBehandlung(preset);
  const braucht = (f: Flaeche): boolean => hatWort(f.behandlung ?? standard) || (f.behandlung === 'mia-gesicht' && !!f.ersatz && hatWort(f.ersatz));
  if (!flaechen.some(braucht)) return flaechen.map(() => '');
  const datei = await ladeWoerter(packStand).catch(() => null);
  await ladeWortSchrift();
  return flaechen.map((f) => (braucht(f) ? waehleWort(`${kennung}|${f.zone}|${f.box.join(',')}`, datei, themen) : ''));
}
