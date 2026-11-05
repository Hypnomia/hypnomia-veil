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

test('Mia’s control Session 10: Tab-Titel, Zeiger, Meldungen, Besuche, strenge Zeiten', async () => {
  const seite = await context.newPage();
  const kontrolle = async () => (await lies(seite, 'einstellungen'))?.kontrolle;
  try {
    await seite.goto(optionsUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    // Standard: Tab-Titel an, Spirale, Meldungen an, Besuche AUS (Entscheidung 125), keine strengen Zeiten.
    await expect(seite.locator('#kon-tabtitel')).toBeChecked();
    await expect(seite.locator('#kon-cursor')).toHaveValue('spirale');
    await expect(seite.locator('#kon-meldungen')).toBeChecked();
    await expect(seite.locator('#kon-besuche')).not.toBeChecked();
    await expect(seite.locator('#kon-zeiten .zeit-zeile')).toHaveCount(0);

    await seite.locator('#kon-tabtitel-zeile').click();
    await expect.poll(async () => (await kontrolle())?.tabtitel).toBe(false);
    await seite.locator('#kon-cursor').selectOption('herz');
    await expect.poll(async () => (await kontrolle())?.cursor).toBe('herz');
    await seite.locator('#kon-cursor').selectOption('aus');
    await expect.poll(async () => (await kontrolle())?.cursor).toBe('aus');
    await seite.locator('#kon-meldungen-zeile').click();
    await expect.poll(async () => (await kontrolle())?.meldungen).toBe(false);
    await seite.locator('#kon-besuche-zeile').click();
    await expect.poll(async () => (await kontrolle())?.besuche).toBe(true);

    // Strenge Zeiten: neu (jeden Tag 21:00 bis 23:00), aendern, letzter Tag bleibt, hoechstens 3, entfernen.
    await seite.locator('#kon-zeit-neu').click();
    await expect.poll(async () => (await kontrolle())?.zeiten).toEqual([{ tage: [0, 1, 2, 3, 4, 5, 6], von: 1260, bis: 1380 }]);
    const zeile = seite.locator('#kon-zeiten .zeit-zeile').first();
    await zeile.locator('.zeit-von').fill('22:30');
    await zeile.locator('.zeit-von').blur();
    await zeile.locator('.zeit-bis').fill('01:15');
    await zeile.locator('.zeit-bis').blur();
    await expect.poll(async () => (await kontrolle())?.zeiten?.[0]).toEqual({ tage: [0, 1, 2, 3, 4, 5, 6], von: 1350, bis: 75 });
    for (const tag of [0, 1, 2, 3, 4, 5]) await zeile.locator(`input[data-tag="${tag}"]`).uncheck();
    await expect.poll(async () => (await kontrolle())?.zeiten?.[0]?.tage).toEqual([6]);
    // Den letzten Tag abwaehlen geht nicht: der Haken kommt zurueck, gespeichert bleibt Samstag.
    await zeile.locator('input[data-tag="6"]').click();
    await expect(zeile.locator('input[data-tag="6"]')).toBeChecked();
    expect((await kontrolle())?.zeiten?.[0]?.tage).toEqual([6]);
    await seite.locator('#kon-zeit-neu').click();
    await expect(seite.locator('#kon-zeiten .zeit-zeile')).toHaveCount(2);
    await seite.locator('#kon-zeit-neu').click();
    await expect(seite.locator('#kon-zeiten .zeit-zeile')).toHaveCount(3);
    await expect(seite.locator('#kon-zeit-neu')).toBeHidden();
    await seite.locator('#kon-zeiten .zeit-zeile').first().locator('.zeit-weg').click();
    await expect.poll(async () => (await kontrolle())?.zeiten?.length).toBe(2);
    await expect(seite.locator('#kon-zeit-neu')).toBeVisible();
    // Die geaenderte Zeile war die erste: weg; die beiden neuen bleiben.
    expect((await kontrolle())?.zeiten?.every((z: { von: number }) => z.von === 1260)).toBe(true);
    // Nach Remove steht der Fokus auf dem naechsten Remove (Pruefer-Fund 4); erst ausserhalb der Liste zeichnet die Seite fremde Aenderungen.
    expect(await seite.evaluate(() => (document.activeElement as HTMLElement | null)?.className)).toContain('zeit-weg');
    await seite.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Aenderung aus einem anderen Fenster erscheint hier.
    await schreibe(seite, { einstellungen: { ...(await lies(seite, 'einstellungen')), kontrolle: { ...(await kontrolle()), zeiten: [] } } });
    await expect(seite.locator('#kon-zeiten .zeit-zeile')).toHaveCount(0);
    const e = await lies(seite, 'einstellungen');
    expect(e.kontrolle.werbung).toBe(true);
    expect(e.kontrolle.leerlaufMinuten).toBe(2);
    console.log('Mia’s control Session 10: 5 Schalter und 9 Schritte der strengen Zeiten gespeichert');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});
