// Chromium: Session 17, Paket C (UX-Funde 1, 5, 6, 7, 12 und Wunsch Bildreihe). Karte "Mia Pack" der Einstellungsseite: ohne Pack Kaufblock mit
// Preis und zwei Links, eigene Dateiwahl (Pillenknopf, Dateiname), mit Pack Begruessung/Daten/Bildreihe (nur Tease), zugeklappt "Update or
// replace the pack", Entfernen abgesetzt unten. Nur synthetische Bilder.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import links from '../../data/links.json' with { type: 'json' };
import { TEXT_DATEI_KEINE, TEXT_KAUF_PREIS } from '../../entrypoints/options/pack-texte';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const bauModul = '../../scripts/pack/baue-pack.mjs';
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };

test.describe.configure({ mode: 'serial' });

let profil = '';
let ordner = '';
let packPfad = '';
let context: BrowserContext;
let id = '';
const optionsUrl = () => `chrome-extension://${id}/options.html`;

async function oeffne(): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  await expect(seite.locator('#pack-status')).not.toHaveText('');
  await expect(seite.locator('#datei')).toBeEnabled();
  return seite;
}

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-pack-karte-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-pack-karte-datei-'));
  const bau = (await import(bauModul)) as { baueDummyPack(o?: object): Promise<{ bytes: Uint8Array }> };
  packPfad = path.join(ordner, 'karte.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack({ version: '1.0.0' })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
  await worker.evaluate((e) => (globalThis as any).chrome.storage.local.set({ einstieg: e }), EINSTIEG_FERTIG);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('Ohne Pack: eine Karte, Kaufblock mit Preis und zwei Links, eigene Dateiwahl in der eigenen Sprache', async () => {
  const seite = await oeffne();
  try {
    await expect(seite.locator('#stand-titel')).toHaveText('Mia Pack');
    // keine zweite Karte "Add the Mia Pack"
    expect(await seite.locator('#neu-titel').textContent()).toBe('Get the Mia Pack');
    expect(await seite.locator('section#neu').count()).toBe(0);
    expect(await seite.evaluate(() => !!document.querySelector('#stand #neu'))).toBe(true);
    await expect(seite.locator('#kauf-preis')).toHaveText(TEXT_KAUF_PREIS);
    const patreon = seite.locator('#kauf-patreon');
    const star = seite.locator('#kauf-subscribestar');
    await expect(patreon).toHaveText('Get it on Patreon');
    await expect(star).toHaveText('Get it on SubscribeStar');
    await expect(patreon).toHaveAttribute('href', links.patreon);
    await expect(star).toHaveAttribute('href', links.subscribestar);
    for (const a of [patreon, star]) {
      await expect(a).toHaveAttribute('target', '_blank');
      await expect(a).toHaveAttribute('rel', /noopener/);
      await expect(a.locator('svg')).toHaveCount(1);
    }
    await expect(seite.locator('#datei-trenner')).toHaveText('Already have the file?');
    // Fund 6: eigener Pillenknopf, Zeile "No file chosen yet", kein "Datei auswählen" des Browsers sichtbar
    await expect(seite.locator('.pack-wahl-knopf')).toHaveText('Choose the pack file');
    await expect(seite.locator('.pack-wahl-knopf')).toBeVisible();
    await expect(seite.locator('#datei-name')).toHaveText(TEXT_DATEI_KEINE);
    // ohne Pack steht die Dateiwahl offen und ohne Aufklapp-Zeile
    await expect(seite.locator('#datei-details')).toHaveJSProperty('open', true);
    await expect(seite.locator('#datei-summary')).toBeHidden();
    // Tastatur: Tab erreicht das Feld, der Fokusrahmen sitzt am Knopf
    await seite.locator('#datei').focus();
    const rahmen = await seite.locator('.pack-wahl-knopf').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(rahmen).not.toBe('none');
    // Dateiname erscheint nach der Wahl
    await seite.locator('#datei').setInputFiles(packPfad);
    await expect(seite.locator('#datei-name')).toHaveText('karte.miapack');
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    await seite.locator('#abbrechen').click();
    await expect(seite.locator('#datei-name')).toHaveText(TEXT_DATEI_KEINE);
    console.log('Karte ohne Pack: Kauf (Preis, 2 Links mit Logo, noopener), eigene Dateiwahl mit Namen, Fokusrahmen');
  } finally {
    await seite.close();
  }
});

test('Mit Pack: Erfolgssatz oben, Fokus zur Werbe-Frage, Set me up, Bildreihe nur Tease, Update zugeklappt, Entfernen unten', async () => {
  const seite = await oeffne();
  try {
    await seite.locator('#datei').setInputFiles(packPfad);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-version')).toHaveText('1.0.0');
    // Erfolgssatz oben in der Karte, vor den Daten
    await expect(seite.locator('#meldung')).toContainText('There it is');
    const reihenfolge = await seite.evaluate(() => {
      const pos = (s: string) => document.querySelector(s)!.getBoundingClientRect().top;
      return { meldung: pos('#meldung'), einrichten: pos('#einrichten'), daten: pos('#pack-daten'), details: pos('#datei-details'), entfernen: pos('#entfernen-zeile') };
    });
    expect(reihenfolge.meldung).toBeLessThan(reihenfolge.einrichten);
    expect(reihenfolge.einrichten).toBeLessThan(reihenfolge.daten);
    expect(reihenfolge.details).toBeLessThan(reihenfolge.entfernen);
    // Fokus bei der Frage "Show my ads?" (Dummy-Pack schaltet Werbung frei)
    await expect(seite.locator('#werbung-frage')).toBeVisible();
    await expect.poll(() => seite.evaluate(() => document.activeElement?.id ?? '')).toBe('werbung-frage-titel');
    // Zustand "mit Pack": Kaufblock weg, Dateiwahl zugeklappt, Aufklapp-Zeile da
    await expect(seite.locator('#neu')).toBeHidden();
    await expect(seite.locator('#datei-details')).toHaveJSProperty('open', false);
    await expect(seite.locator('#datei-summary')).toHaveText('Update or replace the pack');
    await expect(seite.locator('#ablage')).toBeHidden();
    await seite.locator('#datei-summary').click();
    await expect(seite.locator('#ablage')).toBeVisible();
    await seite.locator('#datei-summary').click();
    // Block "Set me up" sichtbar
    await expect(seite.locator('#einrichten-titel')).toHaveText('Set me up');
    // Bildreihe: nur Bilder der Stufe Tease aus dem Pack
    const reihe = seite.locator('#pack-bildreihe');
    await expect(reihe.locator('img')).not.toHaveCount(0);
    const namen = ((await reihe.getAttribute('data-veil-bildreihe')) ?? '').split(',').filter(Boolean);
    const stufen = await seite.evaluate(
      () =>
        new Promise<Record<string, string | undefined>>((ok, fehl) => {
          const a = indexedDB.open('veil-pack', 1);
          a.onerror = () => fehl(a.error);
          a.onsuccess = () => {
            const g = a.result.transaction('meta', 'readonly').objectStore('meta').get('aktiv');
            g.onsuccess = () => {
              const out: Record<string, string | undefined> = {};
              for (const d of g.result.dateien as { name: string; stufe?: string }[]) out[d.name] = d.stufe;
              a.result.close();
              ok(out);
            };
          };
        }),
    );
    expect(namen.length).toBeGreaterThan(0);
    for (const n of namen) expect(stufen[n]).toBe('tease');
    expect(Object.values(stufen).some((s) => s === 'hot')).toBe(true); // es gab schaerfere Bilder, sie sind nicht dabei
    const sichtbar = await reihe.locator('img').evaluateAll((l) => l.every((i) => (i as HTMLImageElement).naturalWidth > 0 && (i as HTMLImageElement).alt === ''));
    expect(sichtbar).toBe(true);
    await expect(seite.locator('#pack-bildreihe-text')).toHaveText('A few of my pictures from your pack.');
    // Entfernen: abgesetzt, funktioniert wie vorher; danach wieder der Zustand ohne Pack
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#meldung')).toContainText('Mia Pack removed');
    await expect(seite.locator('#neu')).toBeVisible();
    await expect(seite.locator('#einrichten')).toBeHidden();
    await expect(seite.locator('#pack-bildreihe-zeile')).toBeHidden();
    await expect(seite.locator('#datei-details')).toHaveJSProperty('open', true);
    console.log(`Karte mit Pack: Reihenfolge, Fokus bei der Frage, Bildreihe ${namen.length} Bild(er) nur Tease (${namen.join(', ')}), Update zugeklappt, Entfernen wieder ohne Pack`);
  } finally {
    await seite.close();
  }
});

test('360 px: Karte ohne und mit Pack ohne waagrechtes Scrollen, alle Fingerziele mindestens 40 px', async () => {
  const seite = await oeffne();
  try {
    await seite.setViewportSize({ width: 360, height: 800 });
    const pruefe = () =>
      seite.evaluate(() => {
        const breit = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const klein = [...document.querySelectorAll<HTMLElement>('#stand a.kauf-knopf, #stand .pack-wahl-knopf, #stand button, #stand summary')]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => ({ id: e.id || e.className, h: Math.round(e.getBoundingClientRect().height) }))
          .filter((x) => x.h < 40);
        return { breit, klein };
      });
    const ohne = await pruefe();
    expect(ohne.breit).toBeLessThanOrEqual(0);
    expect(ohne.klein).toEqual([]);
    await seite.locator('#datei').setInputFiles(packPfad);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-version')).toHaveText('1.0.0');
    await expect(seite.locator('#pack-bildreihe img').first()).toBeVisible();
    const mit = await pruefe();
    expect(mit.breit).toBeLessThanOrEqual(0);
    expect(mit.klein).toEqual([]);
    await seite.locator('#stand').screenshot({ path: path.join(ordner, 'karte-360.png') });
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    console.log('360 px: kein waagrechtes Scrollen, Fingerziele >= 40 px (ohne und mit Pack)');
  } finally {
    await seite.close();
  }
});
