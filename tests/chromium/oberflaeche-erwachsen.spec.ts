// Chromium: Phase 4, Auftrag O. Popup-Abschnitt "Adult sites" (nur mit Pack, Schalter wirken auf storage.local, Steigerungsanzeige mit
// gestelltem Stand) und Einstellungsseite (eigene Seiten, Verweigern-Anteil, Freilegen-Dauer, Ruhig-Modus). Kein Pack-Import noetig:
// die Kurzfassung in storage.local reicht, das Popup liest nur sie.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

const ALLE = ['stil:mia-patch', 'erwachsen:vorschau', 'erwachsen:quiz', 'erwachsen:titel', 'erwachsen:ersatz', 'quiz:freilegen', 'zensur:steigerung', 'chibi:pack'];
let profil = '';
let context: BrowserContext;
let id = '';

const popupUrl = () => `chrome-extension://${id}/popup.html`;
const optionsUrl = () => `chrome-extension://${id}/options.html`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const packMit = (freischaltungen: string[], importiert = 1) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 1, groesse: 1, importiert });
const stand = (s: Record<string, unknown>) => ({ version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: 0, letzteMinute: -1, pauseSeit: null, ...s });

// Speicher nach jedem Test zuruecksetzen (der Kontext wird geteilt).
const zuruecksetzen = (seite: Page) => seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'steigerung', 'einstellungen', 'begruesstFuer']));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-oberflaeche-'));
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

test('Popup: ohne Pack nur Hinweis, mit Pack Schalter, die auf storage.local wirken', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await expect(seite.locator('#erwachsen-titel')).toHaveText(/adult sites/i);
    await expect(seite.locator('#erwachsen-hinweis')).toContainText('Mia Pack');
    await expect(seite.locator('#erwachsen-schalter')).toBeHidden();
    await expect(seite.locator('#erwachsen-pack-link')).toBeVisible();
    await expect(seite.locator('#steigerung')).toBeHidden();

    await schreibe(seite, { pack: packMit(ALLE.filter((f) => f !== 'zensur:steigerung')) });
    await expect(seite.locator('#erwachsen-schalter')).toBeVisible();
    await expect(seite.locator('#erwachsen-pack-link')).toBeHidden();
    await expect(seite.locator('#steigerung')).toBeHidden();
    await expect(seite.locator('#erw-an')).toBeChecked();
    await expect(seite.locator('#erw-ersatz')).not.toBeChecked();
    await expect(seite.locator('#erw-ersatz-zeile')).toContainText('Careful');

    await seite.locator('#erw-an').evaluate((e: HTMLInputElement) => e.click());
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.an).toBe(false);
    await seite.locator('#erw-ersatz').evaluate((e: HTMLInputElement) => e.click());
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.komplettErsatz).toBe(true);
    expect((await lies(seite, 'einstellungen')).erwachsen.an).toBe(false);
    await seite.locator('#erw-inhalt').evaluate((e: HTMLInputElement) => e.click());
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.erkennenAmInhalt).toBe(false);

    // Ersatz-Schalter nur mit erwachsen:ersatz
    await schreibe(seite, { pack: packMit(['erwachsen:vorschau']) });
    await expect(seite.locator('#erw-ersatz-zeile')).toBeHidden();
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    await expect(seite.locator('#erwachsen-schalter')).toBeHidden();
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Popup: Steigerungsanzeige mit gestelltem Stand, Pause stellt die Uhr, Stufe folgt dem Speicher', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await schreibe(seite, { pack: packMit(ALLE), steigerung: stand({ stufe: 3, abbauAb: Date.now() - 3600_000 }) });
    await expect(seite.locator('#steigerung')).toBeVisible();
    await expect(seite.locator('#stufe-zeile')).toHaveText('Level 3 of 4');
    await expect(seite.locator('#stufe-zeit')).toHaveText(/^Next level down in (10|11) h \d\d min$/);
    await expect(seite.locator('#stufe-text')).not.toBeEmpty();
    await schreibe(seite, { steigerung: stand({ stufe: 4, abbauAb: Date.now() - 3600_000 }) });
    await expect(seite.locator('#stufe-zeile')).toHaveText('Level 4 of 4');
    await schreibe(seite, { steigerung: stand({ stufe: 4, abbauAb: Date.now() - 3600_000, pauseSeit: Date.now() - 1000 }) });
    await expect(seite.locator('#stufe-zeit')).toContainText('stands still');
    await schreibe(seite, { steigerung: stand({}) });
    await expect(seite.locator('#stufe-zeile')).toHaveText('Level 0 of 4');
    // Rueckfall: ohne Demo-Chibi bleibt das Bild verborgen, der Text steht
    await expect(seite.locator('#erwachsen-hinweis')).not.toBeEmpty();
    const chibi = await seite.locator('#erwachsen-chibi').evaluate((e: HTMLImageElement) => ({ hidden: e.hidden, src: e.getAttribute('src') }));
    expect(chibi.hidden === (chibi.src === null)).toBe(true);
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'steigerung']));
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Einstellungsseite: eigene Seiten, Verweigern-Anteil, Freilegen-Dauer, Ruhig-Modus', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await expect(seite.locator('#erw-titel')).toBeVisible();
    const anVorher = (await lies(seite, 'einstellungen'))?.erwachsen?.an;
    await seite.fill('#seite-feld', 'https://WWW.Example.com/irgendwas');
    await seite.click('#seite-add');
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.eigeneSeiten).toEqual(['example.com']);
    await expect(seite.locator('#seiten-liste')).toContainText('example.com');
    await seite.fill('#seite-feld', 'example.com');
    await seite.click('#seite-add');
    await expect(seite.locator('#seite-meldung')).toContainText('already');
    await seite.fill('#seite-feld', 'kein host');
    await seite.click('#seite-add');
    await expect(seite.locator('#seite-meldung')).toContainText("doesn't look like");
    expect((await lies(seite, 'einstellungen')).erwachsen.eigeneSeiten).toEqual(['example.com']);
    expect((await lies(seite, 'einstellungen')).erwachsen.an).toBe(anVorher ?? true);

    const setze = (css: string, wert: number) =>
      seite.locator(css).evaluate((e: HTMLInputElement, w) => {
        e.value = String(w);
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }, wert);
    await setze('#verweigern', 20);
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.quiz?.verweigern).toBeCloseTo(0.2, 5);
    await setze('#verweigern', 99);
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.quiz?.verweigern).toBeCloseTo(0.3, 5);
    await setze('#freilegen', 15);
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.quiz?.freilegenMs).toBe(15000);
    expect((await lies(seite, 'einstellungen')).quiz.verweigern).toBeCloseTo(0.3, 5);
    await seite.locator('#ruhig').evaluate((e: HTMLInputElement) => e.click());
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.ruhig).toBe(true);

    await seite.locator('#seiten-liste button').click();
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.eigeneSeiten).toEqual([]);

    // Begruessung nur mit Pack
    await expect(seite.locator('#begruessung')).toBeHidden();
    await schreibe(seite, { pack: packMit(['erwachsen:vorschau'], Date.now()) });
    await expect(seite.locator('#begruessung')).toBeVisible();
    await expect(seite.locator('#begruessung-text')).not.toBeEmpty();
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Popup: drei Lagen, Schalter nach Freischaltung, eigene Seiten bleiben stehen', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    // Pack ohne Erwachsenen-Freischaltung: kein Pack-Verweis, kein Abschnitt
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(seite.locator('#erwachsen')).toBeHidden();
    await expect(seite.locator('#erwachsen-pack-link')).toBeHidden();
    // Pack nur mit zensur:steigerung: Steigerung da, Schalter nicht
    await schreibe(seite, { pack: packMit(['zensur:steigerung']), steigerung: stand({ stufe: 2, abbauAb: Date.now() - 1000 }) });
    await expect(seite.locator('#steigerung')).toBeVisible();
    await expect(seite.locator('#erwachsen-schalter')).toBeHidden();
    await expect(seite.locator('#erwachsen-pack-link')).toBeHidden();
    // Mode-Schalter nur mit erwachsen:vorschau
    await schreibe(seite, { pack: packMit(['erwachsen:quiz']) });
    await expect(seite.locator('#erwachsen-schalter')).toBeVisible();
    await expect(seite.locator('#erw-an')).toBeHidden();
    await schreibe(seite, { pack: packMit(['erwachsen:vorschau']), einstellungen: { erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['example.com'] } } });
    await seite.locator('#erw-an').evaluate((e: HTMLInputElement) => e.click());
    await expect.poll(async () => (await lies(seite, 'einstellungen'))?.erwachsen?.an).toBe(false);
    expect((await lies(seite, 'einstellungen')).erwachsen.eigeneSeiten).toEqual(['example.com']);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Popup: Zeitgeber tickt unter einer Stunde, Abbau bei offenem Popup, Uhr vor abbauAb, Pause stellt Uhr und Pose', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await schreibe(seite, { pack: packMit(ALLE), steigerung: stand({ stufe: 2, abbauAb: Date.now() - 12 * 3600_000 + 90_000 }) });
    await expect(seite.locator('#stufe-zeit')).toHaveText(/^Next level down in 1 min \d\d s$/);
    const a = await seite.locator('#stufe-zeit').textContent();
    await expect.poll(async () => seite.locator('#stufe-zeit').textContent()).not.toBe(a);
    // Abbau bei offenem Popup
    await schreibe(seite, { steigerung: stand({ stufe: 3, abbauAb: Date.now() - 12 * 3600_000 + 2000 }) });
    await expect(seite.locator('#stufe-zeile')).toHaveText('Level 3 of 4');
    await expect(seite.locator('#stufe-zeile')).toHaveText('Level 2 of 4', { timeout: 6000 });
    // Uhr vor abbauAb: kein Abbau, volle 12 h
    await schreibe(seite, { steigerung: stand({ stufe: 3, abbauAb: Date.now() + 3600_000 }) });
    await expect(seite.locator('#stufe-zeile')).toHaveText('Level 3 of 4');
    await expect(seite.locator('#stufe-zeit')).toHaveText(/^Next level down in 12 h 00 min$/);
    // Pause aus den Einstellungen: Uhr steht sofort, Pose schmollen
    await schreibe(seite, { einstellungen: { pause: true } });
    await expect(seite.locator('#stufe-zeit')).toContainText('stands still');
    await expect(seite.locator('#erwachsen-chibi')).toHaveAttribute('data-pose', 'schmollen');
    // Pause bei Stufe 0: kein Pause-Satz der Uhr
    await schreibe(seite, { steigerung: stand({}) });
    await expect(seite.locator('#stufe-zeit')).not.toContainText('stands still');
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

interface PackBau { baueDummyPack(): Promise<{ bytes: Uint8Array }> }
const bauModul = '../../scripts/pack/baue-pack.mjs';

test('Echt importiertes Dummy-Pack: Stufentexte und Chibi aus dem Pack, Begruessung nur nach dem Import', async () => {
  const ordner = await mkdtemp(path.join(tmpdir(), 'veil-oberflaeche-pack-'));
  const seite = await context.newPage();
  try {
    const bau = (await import(bauModul)) as PackBau;
    const pfad = path.join(ordner, 'dummy.miapack');
    await writeFile(pfad, (await bau.baueDummyPack()).bytes);
    await seite.goto(optionsUrl());
    await expect(seite.locator('#begruessung')).toBeHidden();
    await seite.locator('#datei').setInputFiles(pfad);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-status')).toContainText('Pack in place');
    await expect(seite.locator('#begruessung')).toBeVisible();
    await expect(seite.locator('#begruessung-text')).toHaveText('Test greeting line.');
    await expect.poll(async () => seite.locator('#begruessung-chibi').evaluate((e: HTMLImageElement) => !e.hidden && e.src.startsWith('blob:'))).toBe(true);
    expect((await lies(seite, 'pack')).freischaltungen).toContain('chibi:pack');
    // Spaeter geoeffnet (Uhr der Seite 10 Minuten vor): kein neuer Import, keine Begruessung.
    const spaet = await context.newPage();
    try {
      await spaet.addInitScript(() => {
        const jetzt = Date.now.bind(Date);
        Date.now = () => jetzt() + 600_000;
      });
      await spaet.goto(optionsUrl());
      await expect(spaet.locator('#pack-status')).toContainText('Pack in place');
      await expect(spaet.locator('#begruessung')).toBeHidden();
    } finally {
      await spaet.close();
    }

    await seite.goto(popupUrl());
    await schreibe(seite, { steigerung: stand({ stufe: 3, abbauAb: Date.now() - 1000 }) });
    await expect(seite.locator('#stufe-text')).toHaveText('Test level three line.');
    await expect(seite.locator('#erwachsen-chibi')).toHaveAttribute('data-pose', 'arme');
    await schreibe(seite, { steigerung: stand({}) });
    await expect.poll(async () => seite.locator('#erwachsen-chibi').evaluate((e: HTMLImageElement) => !e.hidden && e.src.startsWith('blob:'))).toBe(true);
  } finally {
    // Pack ganz entfernen (IndexedDB), nicht nur storage.local
    await seite.goto(optionsUrl()).catch(() => undefined);
    if (await seite.locator('#entfernen').isVisible().catch(() => false)) {
      await seite.locator('#entfernen').click();
      await seite.locator('#entfernen-ja').click();
      await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    }
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
    await rm(ordner, { recursive: true, force: true });
  }
});
