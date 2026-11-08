// Chromium: Hilfe-Seite (Session 17, Entscheidung 179). Die Anleitungen aus docs/ stehen offline in der Erweiterung; Adresse #name und
// #name/anker, Suche, Links (innen als #name, aussen nur https mit noopener), 360 px ohne waagrechtes Scrollen, Wege aus Popup, Einstellungen
// und Willkommensseite.
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const anzahlDocs = readdirSync(path.join(wurzel, 'docs')).filter((d) => d.endsWith('.md')).length;

let profil = '';
let context: BrowserContext;
let id = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-hilfe-'));
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

test('Hilfe-Seite: Themen, Adressen, Suche, Links', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(`chrome-extension://${id}/hilfe.html`);
    await expect(seite.locator('#themen-liste a')).toHaveCount(anzahlDocs);
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', 'readme');
    await expect(seite.locator('#inhalt h2').first()).toBeVisible();
    // Klick in der Liste
    await seite.locator('#themen-liste a[data-name="faq"]').click();
    await expect(seite).toHaveURL(/#faq$/);
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', 'faq');
    await expect(seite.locator('#themen-liste a[aria-current="page"]')).toHaveAttribute('data-name', 'faq');
    await expect(seite).toHaveTitle(/^HYPNOMIA VEIL: /);
    // Aeussere Links: nur https, neuer Tab, noopener
    const aussen = await seite.locator('#inhalt a.aussen').evaluateAll((as) => as.map((a) => [(a as HTMLAnchorElement).href, (a as HTMLAnchorElement).rel, (a as HTMLAnchorElement).target] as [string, string, string]));
    expect(aussen.length).toBeGreaterThan(0);
    for (const [href, rel, ziel] of aussen) {
      expect(href.startsWith('https://')).toBe(true);
      expect(rel).toContain('noopener');
      expect(ziel).toBe('_blank');
    }
    // Innere Links fuehren zu einem anderen Thema der Hilfe
    const innen = seite.locator('#inhalt a:not(.aussen)').first();
    if ((await innen.count()) > 0) {
      const ziel = (await innen.getAttribute('href'))!.slice(1).split('/')[0];
      await innen.click();
      await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', ziel ?? '');
    }
    // Direkte Adresse mit Anker auf eine Ueberschrift
    const anker = await seite.evaluate(() => document.querySelector('#inhalt h3[id]')?.id.slice(2) ?? '');
    const name = await seite.locator('#inhalt').getAttribute('data-anleitung');
    if (anker) {
      await seite.goto(`chrome-extension://${id}/hilfe.html#readme`);
      await seite.goto(`chrome-extension://${id}/hilfe.html#${name}/${anker}`);
      await expect(seite.locator(`#a-${anker}`)).toBeFocused();
    }
    // Suche filtert, Enter oeffnet den ersten Treffer, nichts gefunden zeigt den Satz
    await seite.locator('#suche').fill('android');
    const treffer = await seite.locator('#themen-liste a').evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.name));
    expect(treffer).toContain('install-firefox-android');
    expect(treffer.length).toBeLessThan(anzahlDocs);
    await seite.locator('#suche').press('Enter');
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', treffer[0]!);
    await seite.locator('#suche').fill('xyzzy-nichts');
    await expect(seite.locator('#themen-leer')).toBeVisible();
    // Sprunglink: Fokus auf die Anleitung, Adresse und Thema bleiben (Fund 5)
    await seite.goto(`chrome-extension://${id}/hilfe.html#faq`);
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', 'faq');
    await seite.locator('a.springen').focus();
    await seite.keyboard.press('Enter');
    await expect(seite.locator('#inhalt')).toBeFocused();
    await expect(seite).toHaveURL(/#faq$/);
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', 'faq');
    // Kaputtes Prozentzeichen in der Adresse: Startseite statt leerer Seite (Fund 14)
    await seite.goto(`chrome-extension://${id}/hilfe.html#%E0`);
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', 'readme');
    // Unbekannte Adresse: Startseite
    await seite.goto(`chrome-extension://${id}/hilfe.html#gibts-nicht`);
    await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', 'readme');
    // 360 px: kein waagrechtes Scrollen, Liste als Pillen ueber dem Inhalt
    await seite.setViewportSize({ width: 360, height: 740 });
    for (const n of ['readme', 'faq', 'install-chrome', 'install-firefox-android']) {
      await seite.goto(`chrome-extension://${id}/hilfe.html#${n}`);
      await expect(seite.locator('#inhalt')).toHaveAttribute('data-anleitung', n);
      expect(await seite.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    console.log(`hilfe: ${anzahlDocs} Anleitungen, ${aussen.length} aeussere Links in der FAQ, Suche "android": ${treffer.join(', ')}`);
  } finally {
    await seite.close();
  }
});

test('Wege zur Hilfe: Popup, Einstellungen, Willkommensseite', async () => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const neu = context.waitForEvent('page');
    await popup.locator('#hilfe').click();
    const hilfe = await neu;
    await expect(hilfe).toHaveURL(new RegExp(`chrome-extension://${id}/hilfe.html`));
    await expect(hilfe.locator('#themen-liste a')).toHaveCount(anzahlDocs);
    await hilfe.close();

    const optionen = await context.newPage();
    await optionen.goto(`chrome-extension://${id}/options.html`);
    await expect(optionen.locator('#hilfe-link')).toHaveAttribute('href', 'hilfe.html');
    await expect(optionen.locator('#hilfe-link')).toHaveAttribute('target', '_blank');
    await optionen.close();
    // Zurueck zu den Einstellungen von der Hilfe aus (kein offener Einstellungs-Tab, sonst holt Chrome nur den alten nach vorn)
    const hilfe2 = await context.newPage();
    await hilfe2.goto(`chrome-extension://${id}/hilfe.html`);
    const einst = context.waitForEvent('page');
    await hilfe2.locator('#zu-einstellungen').click();
    const o = await einst;
    await expect(o).toHaveURL(new RegExp(`chrome-extension://${id}/options.html`));
    await Promise.all([o.close(), hilfe2.close()]);
  } finally {
    if (!popup.isClosed()) await popup.close().catch(() => {});
  }
});
