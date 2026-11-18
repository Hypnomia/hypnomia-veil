// Hilfe fuer die Tests der Einstellungsseite (Phase 9, Paket B; Phase 11 E4d1: Reiter). Ohne Pack sind Adult sites, Mia’s extras (bis auf Calm mode)
// und Sound zugeklappt. Wer dort etwas bedient, klappt sie zuerst auf, so wie die Person es mit "Set them now" tut. Seit E4d1 steht jeder Teil in
// einem Reiter und nur der gewaehlte Reiter ist sichtbar: wer ein Element bedient oder prueft, oeffnet zuerst seinen Reiter wie die Person, mit
// einem Klick auf den Reiter (`reiter` mit dem Namen, `reiterFuer` mit dem Selektor des Elements).
import type { Locator, Page } from '@playwright/test';
import { REITER } from '../../entrypoints/options/reiter-daten';

// Die Namen stehen nur in reiter-daten.ts (N11).
export const REITER_NAMEN = REITER.map((r) => r.name);
export type ReiterName = (typeof REITER)[number]['name'];

// Klickt den Reiter mit diesem Namen (nichts, wenn er schon gewaehlt ist) und wartet, bis sein Panel offen ist.
export async function reiter(seite: Page, name: ReiterName): Promise<void> {
  const tab = seite.locator('[role=tab]', { hasText: new RegExp(`^${name}$`) });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await seite.locator(`#${await tab.getAttribute('aria-controls')}`).waitFor({ state: 'visible' });
}

// Oeffnet den Reiter, in dem das Element mit diesem Selektor steht (das erste Element, das passt), mit einem Klick auf den Reiter.
export async function reiterFuer(seite: Page, selektor: string): Promise<void> {
  const name = await seite.evaluate((s) => {
    try {
      const panel = document.querySelector(s)?.closest<HTMLElement>('[role=tabpanel]');
      return panel ? (document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent ?? null) : null;
    } catch {
      return null; // kein CSS-Selektor (zum Beispiel ein Playwright-Selektor): kein Reiter zu oeffnen
    }
  }, selektor);
  if (name) await reiter(seite, name as ReiterName);
}

export async function oeffneZugeklapptes(seite: Page): Promise<void> {
  await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  // Jeder Klick nimmt einen Knopf weg: in jedem Reiter immer den ersten sichtbaren nehmen. Danach steht wieder Style offen.
  for (const name of REITER_NAMEN) {
    await reiter(seite, name);
    for (let i = 0; i < 5 && (await seite.locator('.zu-knopf:visible').count()) > 0; i++) await seite.locator('.zu-knopf:visible').first().click();
  }
  await reiter(seite, 'Style');
  // Das Aufklappen scrollt; die Tests starten wieder oben (der grosse Pause-Knopf im Bild, die kleine Pause in der Leiste verborgen).
  await seite.evaluate(() => window.scrollTo(0, 0));
}

// Eine Seite, die vor jeder Handlung an einem Element den Reiter dieses Elements oeffnet (mit einem echten Klick auf den Reiter), so wie die Person
// es tut, bevor sie ein Element bedient. Das gilt fuer Handlungen (click, fill, check, press, selectOption, hover, focus ...), nicht fuer Pruefungen:
// wer Sichtbarkeit oder Lage pruefen will, ruft `reiterFuer` oder `reiter` selbst. Alles andere der Seite bleibt unveraendert.
const HANDLUNGEN = new Set([
  'click', 'dblclick', 'fill', 'press', 'pressSequentially', 'type', 'check', 'uncheck', 'setChecked', 'selectOption', 'focus', 'hover', 'tap',
  'setInputFiles', 'dispatchEvent', 'clear', 'selectText', 'scrollIntoViewIfNeeded', 'dragTo',
]);
const KETTE = new Set(['locator', 'getByLabel', 'getByRole', 'getByText', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId', 'filter', 'first', 'last', 'nth', 'and', 'or']);

async function oeffneReiterVon(ort: Locator): Promise<void> {
  const seite = ort.page();
  if (!seite.url().includes('options.html')) return;
  const name = await ort
    .first()
    .evaluate((e) => {
      const panel = e.closest<HTMLElement>('[role=tabpanel]');
      return panel ? (document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent ?? null) : null;
    }, undefined, { timeout: 3000 })
    .catch(() => null);
  if (name) await reiter(seite, name as ReiterName);
}

function umhuelle(ort: Locator): Locator {
  return new Proxy(ort, {
    get(ziel, name, empfaenger) {
      const wert = Reflect.get(ziel, name, ziel);
      if (typeof wert !== 'function' || typeof name !== 'string') return wert;
      if (HANDLUNGEN.has(name)) return async (...a: unknown[]) => (await oeffneReiterVon(ziel), (wert as (...x: unknown[]) => unknown).apply(ziel, a));
      if (KETTE.has(name)) return (...a: unknown[]) => umhuelle((wert as (...x: unknown[]) => Locator).apply(ziel, a));
      return (wert as (...x: unknown[]) => unknown).bind(ziel);
    },
  });
}

export function mitReitern(seite: Page): Page {
  return new Proxy(seite, {
    get(ziel, name) {
      const wert = Reflect.get(ziel, name, ziel);
      if (typeof wert !== 'function' || typeof name !== 'string') return wert;
      if (KETTE.has(name)) return (...a: unknown[]) => umhuelle((wert as (...x: unknown[]) => Locator).apply(ziel, a));
      // Kurzformen der Seite mit Selektor als erstem Argument: ueber den Locator, damit der Reiter zuerst geoeffnet wird.
      if (HANDLUNGEN.has(name) && name !== 'scrollIntoViewIfNeeded') {
        return async (selektor: string, ...a: unknown[]) => {
          const ort = umhuelle(ziel.locator(selektor)) as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>;
          return ort[name]!(...a);
        };
      }
      return (wert as (...x: unknown[]) => unknown).bind(ziel);
    },
  });
}
