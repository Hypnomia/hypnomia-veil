import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);

// Erwartete Erweiterungs-ID aus dem oeffentlichen Schluessel: SHA-256 des DER-Schluessels,
// erste 32 Hex-Zeichen, Ziffern 0 bis f auf Buchstaben a bis p abgebildet.
function erwarteteId(): string {
  const der = Buffer.from(readFileSync(path.join(wurzel, 'data/chrome-key.pub'), 'utf8').trim(), 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((z) => String.fromCharCode('a'.charCodeAt(0) + parseInt(z, 16))).join('');
}

test('Chromium: Erweiterung laedt, Content-Script und Service Worker laufen', async () => {
  let profil: string | undefined;
  let context: BrowserContext | undefined;
  try {
    profil = await mkdtemp(path.join(tmpdir(), 'veil-chromium-'));
    // Neues Headless (channel 'chromium') erlaubt Erweiterungen.
    context = await chromium.launchPersistentContext(profil, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
    });

    const start = Date.now();
    const seite = await context.newPage();
    await seite.goto(`http://127.0.0.1:${port}/hello.html`);
    await expect
      .poll(() => seite.evaluate(() => document.documentElement.dataset.hypnomiaVeil))
      .toBe('hello');
    console.log(`chromium: Attribut nach ${Date.now() - start} ms`);

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    // Die ID in der Worker-URL muss der aus dem key abgeleiteten ID entsprechen.
    expect(new URL(worker.url()).host).toBe(erwarteteId());
    // Der Hintergrund hat beim Installieren sein Lebenszeichen gespeichert (kann kurz dauern).
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const ablage = await (globalThis as any).chrome.storage.local.get('veilHello');
          return ablage.veilHello ?? null;
        }),
      )
      .toBe(true);
  } finally {
    await context?.close();
    if (profil) await rm(profil, { recursive: true, force: true });
  }
});
