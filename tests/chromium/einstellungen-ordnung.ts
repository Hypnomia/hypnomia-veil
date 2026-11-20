// Hilfe fuer die Tests der Einstellungsseite (Phase 9, Paket B; Phase 11 E4d1: Reiter). Ohne Pack sind Adult sites, Mia’s control (bis auf Calm mode)
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
  await reiter(seite, 'Cover style');
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

// ---------- Bedienelemente aus den Bausteinen (Phase 11 E4d2) ----------
// Jeder Baustein hat die Wurzel mit einer festen id (`stimmung-wahl`, `zonen-wahl`, `kleidung-frage`, `erw-stufe-wahl`, `verweigern-wahl`,
// `freilegen-wahl`, `lautstaerke-wahl`). Die Stufe oder Karte mit diesem Namen:
export const stufenKnopf = (seite: Page, wahl: string, name: string): Locator =>
  seite.locator(`#${wahl} [role=radio]`).filter({ has: seite.locator('.v-wahl-titel', { hasText: new RegExp(`^${name}$`) }) }).or(seite.locator(`#${wahl} button.v-stufe`).filter({ hasText: new RegExp(`^${name}$`) })).first();
// Wie ein Mensch: erst den Aufklapper "Exact value" (oder "Pick zones one by one") oeffnen, wenn er zu ist; gibt den Regler zurueck.
export async function oeffneAuf(seite: Page, wahl: string): Promise<Locator> {
  const kopf = seite.locator(`#${wahl} .v-aufklapper .v-auf-kopf`).first();
  if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
  return seite.locator(`#${wahl} input[type=range]`);
}
export async function zonenChip(seite: Page, zone: string): Promise<Locator> {
  const kopf = seite.locator('#zonen-wahl .v-aufklapper .v-auf-kopf').first();
  if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
  return seite.locator(`#zonen-wahl .v-chip[data-zone="${zone}"]`);
}
// Die Marke der Gruppe: id der markierten Karte (oder null), und der Wert des Reglers im Speichermass.
export const markiert = (seite: Page, wahl: string) =>
  seite.evaluate((w) => document.querySelector(`#${w} [role=radio][aria-checked=true]`)?.textContent ?? null, wahl);
