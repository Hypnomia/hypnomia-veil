// Aufraeum-Stelle fuer die Umleitung aus Version 0.4.0 (Session 8, Entscheidung 107): der Komplett-Ersatz zeigt die Galerie jetzt im
// Content-Script der Seite (src/ersatz/), es gibt keine Umleitung und keine Erweiterungsseite dafuer mehr. Eine aktualisierte Installation
// koennte aber noch die dynamische Regel mit dieser ID tragen; sie wuerde auf eine Seite umleiten, die es nicht mehr gibt. Darum wird sie
// beim Start (onInstalled, onStartup, jedes Aufwachen) entfernt, falls sie steht.

// Dynamische Regeln haben ihren eigenen ID-Raum (die Referer-Regeln sind Sitzungsregeln ab 1000).
export const UMLEITUNG_REGEL_ID = 1;

interface DnrKlein {
  getDynamicRules(): Promise<Array<{ id: number }>>;
  updateDynamicRules(opt: { removeRuleIds: number[] }): Promise<void>;
}

// Entfernt die alte Regel, falls sie steht. Gibt zurueck, ob eine entfernt wurde. Fehler werden verschluckt (kein Abbruch des Starts).
export async function entferneAlteUmleitungRegel(dnr: DnrKlein): Promise<boolean> {
  try {
    const regeln = await dnr.getDynamicRules();
    if (!regeln.some((r) => r.id === UMLEITUNG_REGEL_ID)) return false;
    await dnr.updateDynamicRules({ removeRuleIds: [UMLEITUNG_REGEL_ID] });
    return true;
  } catch {
    return false;
  }
}

export function raeumeUmleitungAuf(): void {
  const lauf = () => void entferneAlteUmleitungRegel(browser.declarativeNetRequest as unknown as DnrKlein);
  browser.runtime.onInstalled.addListener(lauf);
  browser.runtime.onStartup.addListener(lauf);
  lauf();
}
