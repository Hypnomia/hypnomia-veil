// Pausen-Zeichen am Symbol (Session 17, UX-Pruefung Phase 9 Fund 9, Paket F): pausiert traegt das Symbol der Erweiterung ein graues "II"
// und den Titel "HYPNOMIA VEIL: paused"; aktiv weder Abzeichen noch Zusatz. Hoert auf storage.onChanged (kein neues Recht, `action` reicht).
// Firefox fuer Android zeigt kein Abzeichen; dort ist der Aufruf harmlos (Fehler werden verschluckt).
import { SPEICHER_SCHLUESSEL, ladeEinstellungen, vervollstaendige } from '../einstellungen';
import { WERTE } from '../oberflaeche/design/werte';

export const TITEL_AKTIV = 'HYPNOMIA VEIL';
export const TITEL_PAUSE = 'HYPNOMIA VEIL: paused';

interface ActionKlein {
  setBadgeText(d: { text: string }): Promise<void> | void;
  setBadgeBackgroundColor?(d: { color: string }): Promise<void> | void;
  setTitle(d: { title: string }): Promise<void> | void;
}

function aktion(): ActionKlein | null {
  const b = browser as unknown as { action?: ActionKlein; browserAction?: ActionKlein };
  return b.action ?? b.browserAction ?? null;
}

export async function zeigePause(pause: boolean): Promise<void> {
  const a = aktion();
  if (!a) return;
  try {
    await a.setBadgeText({ text: pause ? 'II' : '' });
    if (pause) await a.setBadgeBackgroundColor?.({ color: WERTE.rand ?? '#9c7e91' });
    await a.setTitle({ title: pause ? TITEL_PAUSE : TITEL_AKTIV });
  } catch {
    // Android oder alte Version: kein Abzeichen, nichts kaputt
  }
}

export function starteSymbol(): void {
  browser.storage.onChanged.addListener((aenderungen: Record<string, { newValue?: unknown }>, bereich: string) => {
    if (bereich !== 'local' || !(SPEICHER_SCHLUESSEL in aenderungen)) return;
    void zeigePause(vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.newValue).pause);
  });
  void ladeEinstellungen().then((e) => zeigePause(e.pause), () => {});
}
