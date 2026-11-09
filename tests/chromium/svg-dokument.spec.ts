// Chromium: eigenstaendige SVG-Dokumente (oben im Tab, im iframe, im object) mit <image>-Bildern (Nacht 18, Paket N4, Folge aus Entscheidung 197).
// Frage: werden die Bilder dort gelesen und geprueft, oder bleiben sie nur verdeckt? Erwartet: geprueft wie auf einer Seite, auch mit data: und
// blob: (die Pixelpruefung braucht dort ein Canvas im HTML-Namensraum), Treffer zensiert, harmlose frei, Hide-first, Pause gibt frei.
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const testbilder = existsSync(path.resolve(wurzel, '../05 Testbilder/nsfw/IMG_0260.jpg'));

let profil: string;
let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-svg-dokument-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

interface Dok {
  id: string;
  urteil: string;
  quelle: string;
  opacity: string;
}

const liesIn = (f: Frame): Promise<Dok[]> =>
  f.evaluate(() =>
    [...document.querySelectorAll('image')].map((el) => ({
      id: el.id,
      urteil: el.getAttribute('data-veil') ?? '',
      quelle: el.getAttribute('href') ?? '',
      opacity: getComputedStyle(el).opacity,
    })),
  );

const waechterIn = (f: Frame) => f.evaluate(() => ({ aufblitzen: (window as any).__svgAufblitzen as number, verborgen: (window as any).__svgVerborgen as number }));

// Die Dokumente: Quelle der Seite, Rahmen (null = oben im Tab), erwartete Urteile je Bild in Dokumentreihenfolge.
const HTTP = 'd-href:zensiert,d-sfw:frei';
const DATEN = 'dd-blob:zensiert,dd-data:zensiert,dd-sfw:frei';
const FAELLE: { name: string; seite: string; teil: string | null; erwartet: string }[] = [
  { name: 'Tab, Bilder per http', seite: '/svg-dokument.svg', teil: null, erwartet: HTTP },
  { name: 'Tab, Bilder aus data: und blob:', seite: '/svg-dokument-daten.svg', teil: null, erwartet: DATEN },
  { name: 'iframe, Bilder per http', seite: '/svg-dokument-rahmen.html', teil: '/svg-dokument.svg', erwartet: HTTP },
  { name: 'iframe, Bilder aus data: und blob:', seite: '/svg-dokument-rahmen.html', teil: '/svg-dokument-daten.svg', erwartet: DATEN },
  { name: 'object, Bilder per http', seite: '/svg-dokument-rahmen.html', teil: '#object-http', erwartet: HTTP },
  { name: 'object, Bilder aus data: und blob:', seite: '/svg-dokument-rahmen.html', teil: '#object-daten', erwartet: DATEN },
];

// Der Rahmen zum Fall. Zu jeder Adresse gibt es zwei Unterrahmen in Dokumentreihenfolge: erst der iframe, dann das object (die Kennungen
// in svg-dokument-rahmen.html). Ein object ist fuer Playwright ein Unterrahmen wie ein iframe, nur ohne contentFrame am Element.
async function finde(seite: Page, f: { teil: string | null }): Promise<Frame> {
  if (f.teil === null) return seite.mainFrame();
  const objekt = f.teil.startsWith('#object-');
  const adresse = objekt ? (f.teil === '#object-http' ? '/svg-dokument.svg' : '/svg-dokument-daten.svg') : f.teil;
  let rahmen: Frame | undefined;
  await expect
    .poll(() => (rahmen = seite.frames().filter((r) => r.url().endsWith(adresse))[objekt ? 1 : 0]) !== undefined, { timeout: 10_000 })
    .toBe(true);
  return rahmen!;
}

for (const fall of FAELLE) {
  test(`SVG-Dokument (${fall.name}): Bilder werden geprueft, Hide-first, Pause gibt frei`, async () => {
    test.skip(!testbilder, 'ohne Testbilder');
    const seite = await context.newPage();
    await seite.goto(`${basis}${fall.seite}`);
    const rahmen = await finde(seite, fall);
    const zeige = async () => (await liesIn(rahmen)).map((b) => `${b.id}:${b.urteil}`).join(',');
    let letzte = '';
    await expect
      .poll(async () => (letzte = await zeige().catch(() => '')), { timeout: 25_000, intervals: [200] })
      .toBe(fall.erwartet);
    console.log(`svg-dokument chromium: ${fall.name}: ${letzte}`);
    const w = await waechterIn(rahmen);
    console.log(`svg-dokument chromium: ${fall.name}: Waechter ${JSON.stringify(w)}`);
    expect(w.aufblitzen, 'ohne Urteil sichtbar').toBe(0);
    expect(w.verborgen).toBeGreaterThan(0);
    // Zensierte Bilder zeigen eine eigene Fassung, nie die Quelle der Seite.
    for (const b of await liesIn(rahmen)) {
      if (b.urteil === 'zensiert') expect(b.quelle, b.id).toMatch(/^data:image\//);
      expect(b.opacity, b.id).toBe('1');
    }
    try {
      await setze({ pause: true });
      await expect.poll(() => rahmen.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 5000 }).toBe('aus');
      const inPause = await liesIn(rahmen);
      for (const b of inPause) {
        expect(b.urteil, `${b.id} in der Pause`).toBe('');
        expect(b.opacity, `${b.id} in der Pause`).toBe('1');
        expect(b.quelle.startsWith('data:image/jpeg') && b.id !== 'dd-data', `${b.id}: Fassung statt Original`).toBe(false);
      }
    } finally {
      await setze({ pause: false });
    }
    await expect.poll(async () => (letzte = await zeige().catch(() => '')), { timeout: 25_000, intervals: [200] }).toBe(fall.erwartet);
    await seite.close();
  });
}
