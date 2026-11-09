// Stand der Gesichtssuche in den Patch-Bildern des Packs (Mias Gesicht) fuer die Oberflaeche: wie viele Patch-Bilder ein brauchbares Gesicht
// haben, sobald der Erkenner im Hintergrund fertig ist. Fragt den Erkenner (weckt ihn vorher), gibt nie einen Fehler weiter.
export interface GesichterStand {
  gesamt: number;
  geprueft: number;
  mit: number;
  fertig: boolean;
}

const FRIST_MS = 3000;

export async function frageGesichter(): Promise<GesichterStand | null> {
  try {
    const frage = (async () => {
      await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }).catch(() => undefined);
      const a = (await browser.runtime.sendMessage({ ziel: 'erkenner', typ: 'status' })) as { ok?: boolean; patchGesichter?: GesichterStand } | undefined;
      return a && a.ok && a.patchGesichter ? a.patchGesichter : null;
    })();
    return await Promise.race([frage, new Promise<null>((ok) => setTimeout(() => ok(null), FRIST_MS))]);
  } catch {
    return null;
  }
}

// Fragt gleich und dann alle 2 s, bis der Scan fertig ist (hoechstens 40 Mal). Ruft `beiStand` mit jedem Ergebnis. Gibt eine Funktion zum Abbrechen zurueck.
export function beobachteGesichter(beiStand: (s: GesichterStand | null) => void): () => void {
  let aus = false;
  let n = 0;
  const lauf = async (): Promise<void> => {
    if (aus) return;
    const s = await frageGesichter();
    if (aus) return;
    beiStand(s);
    if (s?.fertig === true || ++n >= 40) return;
    setTimeout(() => void lauf(), 2000);
  };
  void lauf();
  return () => {
    aus = true;
  };
}
