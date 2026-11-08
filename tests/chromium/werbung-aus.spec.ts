// Chromium: Session 17, Fund 3. Die Liste "Sites without my ads" (kontrolle.werbungAus) steht in "Mia’s control" hinter dem Schalter "My ads";
// jeder Eintrag laesst sich mit "Show my ads here again" zuruecknehmen; leere Liste: Block verborgen; die Liste ist auf 200 Eintraege begrenzt
// (die neuesten bleiben).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oeffneZugeklapptes } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';

const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-werbung-aus-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test('Sites without my ads: Liste, Knopf nimmt zurueck, leer verborgen, Obergrenze 200', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(`chrome-extension://${id}/options.html`);
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen']));
    await seite.reload();
    await oeffneZugeklapptes(seite);
    // Leer: Block verborgen
    await expect(seite.locator('#kon-werbung-aus')).toBeHidden();
    // Der Block steht gleich hinter dem Schalter "My ads"
    expect(
      await seite.evaluate(() => {
        const z = document.getElementById('kon-werbung-zeile')!;
        const huelle = z.parentElement?.classList.contains('mit-hilfe') ? z.parentElement : z;
        return huelle.nextElementSibling?.id;
      }),
    ).toBe('kon-werbung-aus');
    // Zwei Eintraege (eigene Liste ueber den Speicher, so wie das Etikett-Menue sie schreibt)
    await schreibe(seite, { einstellungen: { version: 1, kontrolle: { werbungAus: ['a.example', 'b.example'] } } });
    await expect(seite.locator('#kon-werbung-aus')).toBeVisible();
    await expect(seite.locator('#kon-werbung-aus-titel')).toHaveText('Sites without my ads');
    await expect(seite.locator('#kon-werbung-aus-liste li')).toHaveCount(2);
    await expect(seite.locator('#kon-werbung-aus-liste button').first()).toHaveText('Show my ads here again');
    // Den ersten zuruecknehmen
    await seite.locator('#kon-werbung-aus-liste button[data-muster="a.example"]').click();
    await expect(seite.locator('#kon-werbung-aus-liste li')).toHaveCount(1);
    await expect(seite.locator('#kon-werbung-aus-meldung')).toHaveText('a.example gets my ads again.');
    expect((await lies(seite, 'einstellungen')).kontrolle.werbungAus).toEqual(['b.example']);
    // Der Fokus bleibt auf einem Knopf der Liste
    expect(await seite.evaluate(() => document.activeElement?.getAttribute('data-muster'))).toBe('b.example');
    // Den letzten zuruecknehmen: Block weg
    await seite.locator('#kon-werbung-aus-liste button').click();
    await expect(seite.locator('#kon-werbung-aus')).toBeHidden();
    expect((await lies(seite, 'einstellungen')).kontrolle.werbungAus).toEqual([]);
    // Obergrenze: 250 Eintraege gespeichert, ueber die Seite geschrieben (aendereEinstellungen laeuft durch vervollstaendige): 200 bleiben
    const viele = Array.from({ length: 250 }, (_, i) => `site${i}.example`);
    await schreibe(seite, { einstellungen: { version: 1, kontrolle: { werbungAus: viele } } });
    await expect(seite.locator('#kon-werbung-aus-liste li')).toHaveCount(200);
    await expect(seite.locator('#kon-werbung-aus-liste li').first()).toContainText('site50.example');
    await expect(seite.locator('#kon-werbung-aus-liste li').last()).toContainText('site249.example');
    console.log('werbung-aus chromium: Liste, Zuruecknehmen, leer verborgen, 250 -> 200 Eintraege');
  } finally {
    await seite.close();
  }
});
