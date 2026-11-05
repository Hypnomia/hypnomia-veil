// Hintergrund: Einstieg (Auftrag E, PHASE-6-AUFTRAEGE-SESSION-11.md). Nach der Installation oeffnet sich die Willkommensseite, bei einem
// Update nur, wenn der Einstieg noch fehlt. Testbau: der Einstieg gilt nach der Installation als erledigt, nichts oeffnet sich von selbst
// (sonst fallen Tabs in fremde Tests); der Testhaken `einstieg-test` setzt zurueck und oeffnet auf Verlangen.
import type { AntwortEinstiegTest, NachrichtHintergrundEinstiegTest } from '../nachrichten';
import { aendereEinstieg, oeffneWillkommen } from '../einstieg/speicher';
import { EINSTIEG_LEER, einstiegFertig, ladeEinstieg } from '../einstieg/vertrag';

const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1';

export function starteEinstieg(): void {
  // Listener gleich beim Start registrieren (der Service Worker wacht dafuer auf).
  browser.runtime.onInstalled.addListener((d) => {
    void behandleInstallation(d.reason).catch((e) => console.warn('Einstieg: Installation behandeln fehlgeschlagen', e));
  });
}

async function behandleInstallation(grund: string): Promise<void> {
  if (TESTBAU) {
    if (grund === 'install') {
      await aendereEinstieg({ warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: Date.now() });
    }
    return;
  }
  if (grund === 'install') {
    await oeffneWillkommen();
  } else if (grund === 'update' && !einstiegFertig(await ladeEinstieg())) {
    await oeffneWillkommen();
  }
}

export async function bearbeiteEinstiegTest(n: NachrichtHintergrundEinstiegTest): Promise<AntwortEinstiegTest> {
  if (!TESTBAU) return { ok: false, fehler: 'nur im Testbau' };
  // Spur 'veil-einstieg-test' steht nur im Testbau (Release-Pruefung in scripts/test-all.mjs).
  console.debug('veil-einstieg-test', n.zuruecksetzen ? 'zuruecksetzen' : '', n.oeffne ? 'oeffne' : '');
  if (n.zuruecksetzen) await aendereEinstieg({ ...EINSTIEG_LEER });
  if (n.oeffne) return { ok: true, tabId: (await oeffneWillkommen()) ?? null };
  return { ok: true };
}
