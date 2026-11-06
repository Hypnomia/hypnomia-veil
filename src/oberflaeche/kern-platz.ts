// Kern-Bilder auf Erweiterungsseiten (Phase 7, Auftrag I3): setzt bis zu `anzahl` Bilder in `ziel`. Ohne Kern-Bilder im Bau, bei einem Ladefehler
// oder wenn `noch()` falsch wird, entsteht kein Bild (nie ein leerer Rahmen). Gibt die Anzahl der gesetzten Bilder zurueck.
import { kernBilder, tagesZahl, waehleKern } from '../kern';

export async function zeigeKernBilder(ziel: HTMLElement, anzahl: number, noch: () => boolean = () => true): Promise<number> {
  let adressen: string[] = [];
  try {
    adressen = waehleKern(await kernBilder(), tagesZahl(), anzahl);
  } catch {
    adressen = [];
  }
  if (!adressen.length || !noch()) return 0;
  // Erst laden, dann einsetzen: ein Bild, das nicht laedt, hinterlaesst nichts.
  const geladen = await Promise.all(
    adressen.map(
      (url) =>
        new Promise<HTMLImageElement | null>((ok) => {
          const bild = new Image();
          bild.alt = 'Mia';
          bild.decoding = 'async';
          bild.addEventListener('load', () => ok(bild), { once: true });
          bild.addEventListener('error', () => ok(null), { once: true });
          bild.src = url;
        }),
    ),
  );
  if (!noch()) return 0;
  const bilder = geladen.filter((b): b is HTMLImageElement => b !== null);
  if (!bilder.length) return 0;
  ziel.replaceChildren(...bilder);
  ziel.hidden = false;
  return bilder.length;
}
