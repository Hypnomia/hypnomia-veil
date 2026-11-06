// Chromium: Phase 7, Auftrag I3 (Kern-Bilder). Zwei Baue: der Standard-Testbau (hat Kern-Bilder, wenn `../02 Assets Mia/kern/` beim Bau da war) und ein Bau
// ohne Kern-Bilder (`VEIL_AUSGABE_OHNE_KERN`, Standard `.output-test-ohnekern`, gebaut mit VEIL_KERN auf einen fehlenden Ordner).
// Mit: Willkommensseite (Einwilligung) zeigt ein Bild, Warn- und 18+-Seite nicht, Einstellungsseite ohne Pack einen Streifen mit 3 Bildern und Text,
// mit Pack keinen. Ohne: nirgends ein Rahmen oder ein Streifen. Keine Netzanfrage nach aussen, kein web_accessible_resources.
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const mitKern = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const ohneKern = path.join(wurzel, process.env.VEIL_AUSGABE_OHNE_KERN ?? '.output-test-ohnekern', 'chrome-mv3');
const bauModul = '../../scripts/pack/baue-pack.mjs';
// Gesamtlauf (scripts/test-all.mjs): beide Baue muessen da sein, ein fehlender Bau ist rot statt uebersprungen.
const PFLICHT = process.env.VEIL_KERN_PFLICHT === '1';

test.describe.configure({ mode: 'serial' });

async function starte(erweiterung: string): Promise<{ context: BrowserContext; id: string; profil: string }> {
  const profil = await mkdtemp(path.join(tmpdir(), 'veil-kern-'));
  const context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  return { context, id: new URL(worker.url()).host, profil };
}

const EINSTIEG = (o: Record<string, unknown>) => ({ version: 1, warnung: true, alter: true, einwilligung: false, interview: 'offen', zeit: null, ...o });

async function seiten(extern: { context: BrowserContext; id: string }, erwarteBilder: boolean, kernDa: boolean) {
  const { context, id } = extern;
  const s = await context.newPage();
  const anfragen: string[] = [];
  s.on('request', (r) => anfragen.push(r.url()));
  await s.goto(`chrome-extension://${id}/options.html`);
  const setze = (o: Record<string, unknown>) => s.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
  await setze({ einstieg: EINSTIEG({}) });
  // ---- Willkommensseite ----
  const w = await context.newPage();
  await w.setViewportSize({ width: 360, height: 640 });
  await w.goto(`chrome-extension://${id}/willkommen.html`);
  await expect(w.locator('#schritt-titel')).toBeVisible();
  // Schritt 1 Warnung: ohne Bild
  await setze({ einstieg: EINSTIEG({ warnung: false, alter: false }) });
  await w.reload();
  await expect(w.locator('#warnung-ok')).toBeVisible();
  expect(await w.locator('.mia-bild, #kern-bild').count()).toBe(0);
  // Schritt 2 18+: ohne Bild
  await setze({ einstieg: EINSTIEG({ alter: false }) });
  await w.reload();
  await expect(w.locator('#schritt-titel')).toBeVisible();
  expect(await w.locator('[data-schritt="alter"]').count()).toBe(1);
  expect(await w.locator('.mia-bild, #kern-bild').count()).toBe(0);
  // Schritt 3 Einwilligung: Bild, wenn gebaut
  await setze({ einstieg: EINSTIEG({}) });
  await w.reload();
  await expect(w.locator('#einwilligung-ok')).toBeVisible();
  if (erwarteBilder) {
    const bild = w.locator('#kern-bild img');
    await expect(bild).toBeVisible({ timeout: 10_000 });
    await expect(bild).toHaveAttribute('alt', 'Mia');
    const m = await w.evaluate(() => {
      const i = document.querySelector('#kern-bild img') as HTMLImageElement;
      const r = i.getBoundingClientRect();
      return { h: r.height, b: r.width, nat: i.naturalWidth, src: i.src, fenster: window.innerHeight, scrollB: document.documentElement.scrollWidth, innen: document.documentElement.clientWidth, y: r.top, textY: document.getElementById('einwilligung-laeuft')!.getBoundingClientRect().top };
    });
    console.log(`chromium I3: Willkommen Bild ${Math.round(m.b)} x ${Math.round(m.h)} bei Fenster 360 x ${m.fenster}, natuerlich ${m.nat} px`);
    expect(m.nat).toBeGreaterThan(0);
    expect(m.h).toBeLessThanOrEqual(m.fenster * 0.4 + 1);
    expect(m.src.startsWith(`chrome-extension://${id}/kern/kern-`)).toBe(true);
    expect(m.scrollB).toBeLessThanOrEqual(m.innen);
    expect(m.y).toBeLessThan(m.textY); // bei 360 px ueber dem Text
  } else {
    await w.waitForTimeout(800);
    expect(await w.locator('#kern-bild img').count()).toBe(0);
    expect(await w.locator('#kern-bild').isVisible()).toBe(false);
  }
  await w.close();
  // ---- Einstellungsseite ----
  await setze({ einstieg: EINSTIEG({ einwilligung: true }) });
  const o = await context.newPage();
  await o.setViewportSize({ width: 360, height: 800 });
  await o.goto(`chrome-extension://${id}/options.html`);
  await expect(o.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
  if (erwarteBilder) {
    await expect(o.locator('#kern-streifen')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => o.locator('#kern-bilder img').count()).toBe(3);
    await expect(o.locator('#kern-text')).toHaveText('This is me dressed for the office. The Mia Pack is me off duty.');
    const m = await o.evaluate(() => ({
      geladen: [...document.querySelectorAll('#kern-bilder img')].every((i) => (i as HTMLImageElement).naturalWidth > 0),
      namen: [...document.querySelectorAll('#kern-bilder img')].map((i) => (i as HTMLImageElement).src.split('/').pop()),
      scrollB: document.documentElement.scrollWidth,
      innen: document.documentElement.clientWidth,
    }));
    console.log(`chromium I3: Streifen ${m.namen.join(', ')}`);
    expect(m.geladen).toBe(true);
    expect(new Set(m.namen).size).toBe(3);
    expect(m.scrollB).toBeLessThanOrEqual(m.innen);
    // mit Pack kein Streifen
    const dummy = await ((await import(bauModul)) as any).baueDummyPack();
    const ordner = await mkdtemp(path.join(tmpdir(), 'veil-kern-pack-'));
    const pfad = path.join(ordner, 'dummy.miapack');
    await writeFile(pfad, dummy.bytes);
    await o.locator('#datei').setInputFiles(pfad);
    await o.locator('#annehmen').click();
    await expect(o.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
    await expect(o.locator('#kern-streifen')).toBeHidden({ timeout: 10_000 });
    // Pack wieder weg: der Streifen kommt zurueck
    await o.locator('#entfernen').click();
    await o.locator('#entfernen-ja').click();
    await expect(o.locator('#kern-streifen')).toBeVisible({ timeout: 15_000 });
    await rm(ordner, { recursive: true, force: true });
  } else {
    await o.waitForTimeout(800);
    expect(await o.locator('#kern-streifen').isVisible()).toBe(false);
    expect(await o.locator('#kern-bilder img').count()).toBe(0);
    expect(await o.locator('#kern-text').isVisible()).toBe(false);
  }
  await o.close();
  // Nur Anfragen an die eigene Erweiterung
  const fremd = anfragen.filter((u) => !u.startsWith(`chrome-extension://${id}/`) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(fremd, `fremde Anfragen: ${fremd.join(', ')}`).toEqual([]);
  expect(kernDa || !erwarteBilder).toBe(true);
  await s.close();
}

test('Standardbau mit Kern-Bildern: Einwilligung zeigt ein Bild, Warnung und 18+ nicht, Streifen nur ohne Pack', async () => {
  test.setTimeout(120_000);
  const kernDa = existsSync(path.join(mitKern, 'kern'));
  if (!kernDa) {
    console.log('chromium I3: UEBERSPRUNGEN Fall "mit": der Standardbau hat keinen Ordner kern/ (Bau mit VEIL_KERN auf einen Ordner mit kern-NN.webp)');
    expect(PFLICHT, 'Standardbau ohne kern/ im Gesamtlauf').toBe(false);
    test.skip();
  }
  const manifest = JSON.parse(await readFile(path.join(mitKern, 'manifest.json'), 'utf8'));
  expect(manifest.web_accessible_resources).toBeUndefined();
  const ext = await starte(mitKern);
  try {
    await seiten(ext, true, kernDa);
  } finally {
    await ext.context.close();
    await rm(ext.profil, { recursive: true, force: true });
  }
});

test('Bau ohne Kern-Bilder: kein Rahmen, kein Streifen, kein Text ohne Bild', async () => {
  test.setTimeout(120_000);
  if (!existsSync(ohneKern)) {
    console.log(`chromium I3: UEBERSPRUNGEN Fall "ohne": ${path.relative(wurzel, ohneKern)} fehlt (Bau mit VEIL_KERN auf einen fehlenden Ordner)`);
    expect(PFLICHT, 'Bau ohne Kern-Bilder im Gesamtlauf').toBe(false);
    test.skip();
  }
  expect(existsSync(path.join(ohneKern, 'kern'))).toBe(false);
  const ext = await starte(ohneKern);
  try {
    await seiten(ext, false, false);
  } finally {
    await ext.context.close();
    await rm(ext.profil, { recursive: true, force: true });
  }
});
