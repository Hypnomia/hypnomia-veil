// Hilfe-Seite aus einer Flaeche in der Seite oeffnen (Session 17, UX-Pruefung Phase 9 Fund 24). Ein Content-Script darf die Adresse der
// Erweiterung nicht selbst oeffnen (kein `web_accessible_resources`, Chrome und Firefox blocken die Navigation einer Webseite dorthin):
// der Hintergrund oeffnet den Tab neben dem Absender. Nur bekannte Kurzadressen (`HILFE_ANKER`), nie eine Adresse aus der Seite.
import { nebenTabEigenschaften } from '../fenster';
import { HILFE_ANKER, hilfeAdresse, type HilfeAnker } from '../hilfe/anker';
import type { NachrichtHintergrundHilfe } from '../nachrichten';

interface Absender {
  tab?: { id?: number; windowId?: number; index?: number };
}

export async function bearbeiteHilfe(n: NachrichtHintergrundHilfe, absender?: Absender): Promise<{ ok: boolean }> {
  if (typeof n.anker !== 'string' || !Object.prototype.hasOwnProperty.call(HILFE_ANKER, n.anker)) return { ok: false };
  const url = browser.runtime.getURL('/hilfe.html') + hilfeAdresse(n.anker as HilfeAnker).slice('hilfe.html'.length);
  try {
    const tab = absender?.tab;
    await browser.tabs.create(tab ? nebenTabEigenschaften(url, { tabId: tab.id, windowId: tab.windowId, index: tab.index }) : { url, active: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
