// Einstieg (Auftrag E): Ablage `einstieg` in storage.local. Aenderungen laufen nacheinander, damit zwei schnelle Schritte sich nicht
// ueberschreiben. Gemeinsam fuer Willkommensseite, Popup und Hintergrund.
import { EINSTIEG_SCHLUESSEL, WILLKOMMEN_PFAD, ladeEinstieg, vervollstaendigeEinstieg, type EinstiegStand } from './vertrag';

let kette: Promise<unknown> = Promise.resolve();

export function aendereEinstieg(teil: Partial<EinstiegStand> | ((alt: EinstiegStand) => Partial<EinstiegStand>)): Promise<EinstiegStand> {
  const schritt = kette.then(async () => {
    const alt = await ladeEinstieg();
    const neu = vervollstaendigeEinstieg({ ...alt, ...(typeof teil === 'function' ? teil(alt) : teil) });
    await browser.storage.local.set({ [EINSTIEG_SCHLUESSEL]: neu });
    return neu;
  });
  kette = schritt.catch(() => undefined);
  return schritt;
}

// Ruft `rueckruf` bei jeder Aenderung von `einstieg` (storage.onChanged). Gibt eine Funktion zum Abmelden zurueck.
export function beiEinstiegAenderung(rueckruf: (neu: EinstiegStand) => void): () => void {
  const horcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string) => {
    if (bereich !== 'local' || !(EINSTIEG_SCHLUESSEL in aenderungen)) return;
    rueckruf(vervollstaendigeEinstieg(aenderungen[EINSTIEG_SCHLUESSEL].newValue));
  };
  browser.storage.onChanged.addListener(horcher);
  return () => browser.storage.onChanged.removeListener(horcher);
}

// Adresse der Willkommensseite (Erweiterungsseite).
export function willkommenUrl(anker = ''): string {
  return (browser.runtime.getURL as (p: string) => string)(WILLKOMMEN_PFAD) + anker;
}

// Oeffnet die Willkommensseite in einem neuen, aktiven Tab und liefert dessen Nummer.
export async function oeffneWillkommen(anker = ''): Promise<number | undefined> {
  const tab = await browser.tabs.create({ url: willkommenUrl(anker), active: true });
  return tab.id;
}

// Zeigt die Willkommensseite: ist schon eine offen, kommt sie nach vorn (ohne `tabs`-Recht: die offene Seite antwortet auf dem Kanal mit ihrer
// Tab-Nummer, `tabs.update` braucht kein Recht), sonst oeffnet sich ein neuer Tab. Liefert die Tab-Nummer.
export const WILLKOMMEN_KANAL = 'veil-willkommen';
export async function zeigeWillkommen(anker = ''): Promise<number | undefined> {
  if (typeof BroadcastChannel !== 'undefined') {
    const kanal = new BroadcastChannel(WILLKOMMEN_KANAL);
    const tabId = await new Promise<number | null>((fertig) => {
      const frist = setTimeout(() => fertig(null), 400);
      kanal.onmessage = (e) => {
        const id = (e.data as { tabId?: unknown } | null)?.tabId;
        if (typeof id === 'number') {
          clearTimeout(frist);
          fertig(id);
        }
      };
      kanal.postMessage('ping');
    });
    kanal.close();
    if (tabId !== null) {
      try {
        const tab = await browser.tabs.update(tabId, { active: true });
        if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
        return tabId;
      } catch {
        // Tab war schon weg: neu oeffnen
      }
    }
  }
  return oeffneWillkommen(anker);
}
