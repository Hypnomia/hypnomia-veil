// Chromium: Phase 5, Vertrag Session 9. Einstellungsseite, Abschnitt "Mia’s control": Schalter und Auswahl wirken auf storage.local,
// Minuten werden begrenzt, die Warnung verschwindet nach "I understand" (und wenn sie im Quiz schon bestaetigt wurde), Hinweis je Pack.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';

const optionsUrl = () => `chrome-extension://${id}/options.html`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const packMit = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 1, groesse: 1, importiert: 1 });
const zuruecksetzen = (seite: Page) =>
  seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-kontrolle-optionen-'));
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

test('Mia’s control: Standardwerte, Schalter, Auswahl und Minuten wirken auf storage.local', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#kon-titel')).toHaveText('Mia’s control');
    await expect(seite.locator('#kon-pack-hinweis')).toContainText('Mia Pack');
    await expect(seite.locator('#kon-werbung')).toBeChecked();
    await expect(seite.locator('#kon-blitz')).toHaveValue('selten');
    await expect(seite.locator('#kon-leerlauf')).toBeChecked();
    await expect(seite.locator('#kon-minuten')).toHaveValue('2');

    await seite.locator('#kon-werbung-zeile').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.werbung).toBe(false);
    await seite.locator('#kon-blitz').selectOption('oft');
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.blitz).toBe('oft');
    await seite.locator('#kon-minuten').fill('7');
    await seite.locator('#kon-minuten').blur();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.leerlaufMinuten).toBe(7);
    // Ausserhalb der Grenzen: 0 wird 1, 500 wird 60; die Seite zeigt danach den gespeicherten Wert.
    await seite.locator('#kon-minuten').fill('0');
    await seite.locator('#kon-minuten').blur();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.leerlaufMinuten).toBe(1);
    await expect(seite.locator('#kon-minuten')).toHaveValue('1');
    await seite.locator('#kon-minuten').fill('500');
    await seite.locator('#kon-minuten').blur();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.leerlaufMinuten).toBe(60);
    await expect(seite.locator('#kon-minuten')).toHaveValue('60');
    // Leeres Feld: alter Wert bleibt (nie still die kuerzeste Zeit).
    await seite.locator('#kon-minuten').fill('');
    await seite.locator('#kon-minuten').blur();
    await seite.waitForTimeout(300);
    expect((await lies(seite, 'einstellungen'))?.kontrolle?.leerlaufMinuten).toBe(60);
    await expect(seite.locator('#kon-minuten')).toHaveValue('60');
    // Mit Enter bestaetigt, Fokus bleibt: das Feld zeigt den gespeicherten Wert.
    await seite.locator('#kon-minuten').fill('1.5');
    await seite.locator('#kon-minuten').press('Enter');
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.leerlaufMinuten).toBe(2);
    await expect(seite.locator('#kon-minuten')).toHaveValue('2');
    // Spirale aus: Minuten-Zeile verschwindet.
    await seite.locator('#kon-leerlauf-zeile').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.leerlauf).toBe(false);
    await expect(seite.locator('#kon-minuten-zeile')).toBeHidden();
    // Andere Felder bleiben unberuehrt.
    const e = await lies(seite, 'einstellungen');
    expect(e.pause).toBe(false);
    expect(e.erwachsen.an).toBe(true);
    console.log('Mia’s control: 6 Aenderungen gespeichert, Minuten begrenzt auf 1 bis 60');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Mia’s control: Hinweis mit Pack, Warnung bis zur Bestaetigung', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#kon-warnung')).toBeVisible();
    await expect(seite.locator('#kon-warnung-text')).toContainText('photosensitive epilepsy');
    // Pack von vor 0.5.0 (ohne kontrolle:*): Hinweis auf einen neueren Import.
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(seite.locator('#kon-pack-hinweis')).toContainText('newer Mia Pack');
    await schreibe(seite, { pack: packMit(['kontrolle:blitz']) });
    await expect(seite.locator('#kon-pack-hinweis')).toContainText('Pause Mia');
    await seite.locator('#kon-warnung-ok').click();
    await expect(seite.locator('#kon-warnung')).toBeHidden();
    expect(await lies(seite, 'spiraleWarnungGesehen')).toBe(true);

    // Im Quiz bestaetigt reicht ebenso.
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#kon-warnung')).toBeVisible();
    await schreibe(seite, { quizWarnungGesehen: true });
    await expect(seite.locator('#kon-warnung')).toBeHidden();
    console.log('Mia’s control: Warnung 2 von 2 Wegen bestaetigt');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});
