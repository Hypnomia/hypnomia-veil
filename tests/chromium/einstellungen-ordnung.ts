// Hilfe fuer die Tests der Einstellungsseite (Phase 9, Paket B): ohne Pack sind Adult sites, Mia’s control (bis auf Calm mode) und Sound
// zugeklappt. Wer dort etwas bedient, klappt sie zuerst auf, so wie die Person es mit "Set them now" tut.
import type { Page } from '@playwright/test';

export async function oeffneZugeklapptes(seite: Page): Promise<void> {
  await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  // Jeder Klick nimmt einen Knopf weg: immer den ersten sichtbaren nehmen.
  for (let i = 0; i < 5 && (await seite.locator('.zu-knopf:visible').count()) > 0; i++) await seite.locator('.zu-knopf:visible').first().click();
  // Das Aufklappen scrollt; die Tests starten wieder oben (der grosse Pause-Knopf im Bild, die kleine Pause in der Leiste verborgen).
  await seite.evaluate(() => window.scrollTo(0, 0));
}
