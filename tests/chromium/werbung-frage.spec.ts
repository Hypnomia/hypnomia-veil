// Chromium: Session 17, Paket C (Entscheidung 179, UX-Fund 12). Die einmalige Frage "Show my ads?" steht in "Set me up" der Karte "Mia Pack"
// (Einstellungsseite): nur mit freigeschalteter Werbung, Ja und Nein speichern `kontrolle.werbung` und `werbungGefragt`, keine zweite Frage.
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
  seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'einrichtenFuer', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-werbung-frage-'));
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

test('Werbe-Frage: nur mit freigeschalteter Werbung, Ja und Nein speichern, keine zweite Frage', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    // Erst warten, bis die Seite gezeichnet ist und auf Aenderungen hoert (die Seite raeumt beim Laden einen Pack-Eintrag ohne Datenbank weg).
    await expect(seite.locator('#pack-status')).not.toHaveText('');
    await expect(seite.locator('#werbung-frage')).toBeHidden();
    // Pack ohne Werbe-Freischaltung: keine Frage.
    await schreibe(seite, { pack: packMit(['kontrolle:blitz']) });
    await expect(seite.locator('#einrichten')).toBeVisible();
    await expect(seite.locator('#werbung-frage')).toBeHidden();
    // Pack mit Werbung, frische Einstellungen: Frage sichtbar, Werbung aus.
    await schreibe(seite, { pack: packMit(['kontrolle:werbung', 'kontrolle:blitz']) });
    await expect(seite.locator('#werbung-frage')).toBeVisible();
    await expect(seite.locator('#werbung-frage-titel')).toHaveText('Show my ads?');
    await expect(seite.locator('#werbung-frage-ja')).toHaveText('Yes, show them');
    await expect(seite.locator('#werbung-frage-nein')).toHaveText('No ads');
    // Die Frage steht in der Karte "Mia Pack" (#stand) und ist die erste Frage von "Set me up".
    expect(await seite.evaluate(() => !!document.querySelector('#stand #einrichten #werbung-frage'))).toBe(true);
    expect((await lies(seite, 'einstellungen'))?.kontrolle?.werbung ?? false).toBe(false);
    await seite.locator('#werbung-frage-ja').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.werbung).toBe(true);
    expect((await lies(seite, 'einstellungen'))?.kontrolle?.werbungGefragt).toBe(true);
    await expect(seite.locator('#werbung-frage')).toBeHidden();
    // Der Fokus geht nicht verloren.
    await expect.poll(() => seite.evaluate(() => document.activeElement?.id ?? '')).not.toBe('');
    // Ein neues Pack (Ersetzen) fragt nicht noch einmal.
    await schreibe(seite, { pack: { ...packMit(['kontrolle:werbung']), version: '1.0.1' } });
    await seite.waitForTimeout(400);
    await expect(seite.locator('#werbung-frage')).toBeHidden();
    // "No ads": aus und beantwortet.
    await schreibe(seite, { einstellungen: { version: 1 } });
    await expect(seite.locator('#werbung-frage')).toBeVisible();
    await seite.locator('#werbung-frage-nein').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.werbungGefragt).toBe(true);
    expect((await lies(seite, 'einstellungen'))?.kontrolle?.werbung).toBe(false);
    await expect(seite.locator('#werbung-frage')).toBeHidden();
    // Ohne Pack gibt es keine Frage und keinen Block.
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen']));
    await expect(seite.locator('#einrichten')).toBeHidden();
    console.log('Werbe-Frage: erscheint nur mit Freischaltung, Ja und Nein gespeichert, keine zweite Frage, Frage in #stand > #einrichten');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Set me up: "Later" laesst die Werbe-Frage offen, "Done" schliesst den Rest, Antworten speichern sofort', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#pack-status')).not.toHaveText('');
    await schreibe(seite, {
      pack: packMit(['kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf', 'erwachsen:vorschau']),
    });
    await expect(seite.locator('#einrichten-titel')).toHaveText('Set me up');
    await expect(seite.locator('#einrichten-rest')).toBeVisible();
    // Antworten speichern sofort
    await seite.locator('#einrichten-stufe-zeile label', { hasText: 'Explicit' }).click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.stufe).toBe('explicit');
    await seite.locator('#einrichten-blitz').selectOption('oft');
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.blitz).toBe('oft');
    await seite.locator('label.schalter:has(#einrichten-leerlauf)').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.kontrolle?.leerlauf).toBe(false);
    await seite.locator('label.schalter:has(#einrichten-erw-an)').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.an).toBe(false);
    // Anfallswarnung ueber den Blitz-Fragen, "I understand" blendet sie aus
    await expect(seite.locator('#einrichten-warnung')).toBeVisible();
    await seite.locator('#einrichten-warnung-ok').click();
    await expect(seite.locator('#einrichten-warnung')).toBeHidden();
    // "Later": Standards bleiben, der Rest schliesst, die Werbe-Frage bleibt bis zur Antwort
    await seite.locator('#einrichten-spaeter').click();
    await expect(seite.locator('#einrichten-rest')).toBeHidden();
    await expect(seite.locator('#werbung-frage')).toBeVisible();
    expect((await lies(seite, 'einstellungen'))?.kontrolle?.werbungGefragt ?? false).toBe(false);
    expect(await lies(seite, 'einrichtenFuer')).toBe('t');
    // ein weiteres Pack-Schreiben (gleiche Kennung) oeffnet den Rest nicht wieder
    await schreibe(seite, { pack: { ...packMit(['kontrolle:werbung', 'kontrolle:blitz']), version: '1.0.1' } });
    await seite.waitForTimeout(400);
    await expect(seite.locator('#werbung-frage')).toBeVisible();
    await expect(seite.locator('#einrichten-rest')).toBeHidden();
    await seite.locator('#werbung-frage-nein').click();
    await expect(seite.locator('#einrichten')).toBeHidden();
    // "Done" bei einem anderen Pack
    await schreibe(seite, { pack: { ...packMit(['kontrolle:blitz']), id: 'anders' } });
    await expect(seite.locator('#einrichten-rest')).toBeVisible();
    await seite.locator('#einrichten-fertig').click();
    await expect(seite.locator('#einrichten')).toBeHidden();
    expect(await lies(seite, 'einrichtenFuer')).toBe('anders');
    console.log('Set me up: Antworten speichern sofort, Later laesst die Frage offen, Done schliesst, Zustand bleibt je Pack-Kennung');
  } finally {
    await zuruecksetzen(seite);
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('einrichtenFuer'));
    await seite.close();
  }
});
