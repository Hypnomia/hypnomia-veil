// Fenster-Schnittstelle mit Rueckfall (Auftrag F, Session 14). Firefox fuer Android hat kein `browser.windows` (ein Fenster, der aktive Tab ist
// vorn). Beide Funktionen werfen nie. Ohne die Schnittstelle gilt: das Fenster ist fokussiert und nicht im Vollbild, und "nach vorn holen"
// tut nichts. Die Schnittstelle wird zur Laufzeit aus dem Global gelesen (`browser` oder `chrome`), damit Einheitstests sie nachbauen koennen.

export interface FensterLage {
  fokus: boolean;
  vollbild: boolean;
}

interface FensterApi {
  get?: (id: number) => Promise<{ focused?: boolean; state?: string }>;
  update?: (id: number, info: { focused?: boolean }) => Promise<unknown>;
}

// Gleiche Pruefung wie fensterLage: nur eine echte `get`-Funktion zaehlt als Fenster-Schnittstelle.
export function hatFenster(): boolean {
  return typeof fensterApi()?.get === 'function';
}

// Eigenschaften fuer `tabs.create` eines Tabs neben dem Absender. Ohne `windows` (Android) kennt Firefox weder `openerTabId` noch `windowId`
// noch zuverlaessig `index`: dann nur Adresse und aktiv. Auf dem Desktop bleibt alles wie gehabt.
export function nebenTabEigenschaften(
  url: string,
  absender: { tabId?: number; windowId?: number; index?: number },
): { url: string; active: boolean; windowId?: number; index?: number; openerTabId?: number } {
  if (!hatFenster()) return { url, active: true };
  return {
    url,
    active: true,
    windowId: absender.windowId,
    ...(typeof absender.index === 'number' ? { index: absender.index + 1 } : {}),
    openerTabId: absender.tabId,
  };
}

function fensterApi(): FensterApi | null {
  const g = globalThis as unknown as { browser?: { windows?: FensterApi }; chrome?: { windows?: FensterApi } };
  return g.browser?.windows ?? g.chrome?.windows ?? null;
}

// Lage des Fensters. Fehlt die Schnittstelle (Android): fokussiert, kein Vollbild. Scheitert der Zugriff (Fenster weg): nicht fokussiert,
// damit nie ein Besuch in ein unbekanntes Fenster geraet. Nur im Hintergrund aufrufen: ohne `windows` gilt der Fokus als wahr, das ist
// nur dort richtig, wo der Aufrufer den aktiven Tab selbst prueft (Besuche).
export async function fensterLage(windowId: number | undefined): Promise<FensterLage> {
  const api = fensterApi();
  if (!api || typeof api.get !== 'function') return { fokus: true, vollbild: false };
  if (typeof windowId !== 'number') return { fokus: false, vollbild: false };
  try {
    const f = await api.get(windowId);
    return { fokus: f?.focused === true, vollbild: f?.state === 'fullscreen' };
  } catch {
    return { fokus: false, vollbild: false };
  }
}

// Holt das Fenster nach vorn. Ohne Schnittstelle oder bei Fehler passiert nichts.
export async function fensterNachVorn(windowId: number | undefined): Promise<void> {
  const api = fensterApi();
  if (!api || typeof api.update !== 'function' || typeof windowId !== 'number') return;
  try {
    await api.update(windowId, { focused: true });
  } catch {
    // Fenster war schon weg: nichts zu tun
  }
}
