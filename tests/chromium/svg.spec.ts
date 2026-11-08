// Chromium: SVG-Logos bleiben nie dauerhaft verdeckt (Live-Lauf 17, MITTEL 1). Die SVG kommen von einem eigenen Server eines fremden Ursprungs
// (Typ image/svg+xml, ohne CORS), wie die Logos der Erwachsenenseiten. Ein SVG mit eingebettetem Rasterbild wird geprueft, nie blind frei.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const svgPort = port + 1;
const nsfwBild = path.resolve(wurzel, '../05 Testbilder/nsfw/IMG_0260.jpg');

const VEKTOR = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><rect width="150" height="40" fill="#e91e63"/></svg>';
const VIEWBOX = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 40"><rect width="150" height="40" fill="#e91e63"/></svg>';

// Fund 9: SVG mit Bewegung oder Skript. Zum Ladezeitpunkt harmlos, spaeter etwas anderes: darf nie frei werden.
const SMIL = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><rect width="150" height="40" fill="#e91e63"><set attributeName="fill" to="#000" begin="1s"/></rect></svg>';
const CSS_ANIMIERT = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><style>@keyframes a{from{opacity:0}to{opacity:1}}rect{animation:a 2s infinite}</style><rect width="150" height="40" fill="#e91e63"/></svg>';
const SKRIPT = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><script>document.documentElement.setAttribute("x","1")</script><rect width="150" height="40" fill="#e91e63"/></svg>';
const FREMDOBJEKT = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><foreignObject width="150" height="40"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>';

let svgServer: Server;
let profil: string;
let context: BrowserContext;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const roh = existsSync(nsfwBild) ? (await readFile(nsfwBild)).toString('base64') : '';
  const raster = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="400"><image width="400" height="400" xlink:href="data:image/jpeg;base64,${roh}"/></svg>`;
  svgServer = createServer((req, res) => {
    const pfad = (req.url ?? '').split('?')[0];
    const koerper = pfad === '/logo.svg' ? VEKTOR : pfad === '/logo-viewbox.svg' ? VIEWBOX : pfad === '/raster.svg' ? raster : pfad === '/smil.svg' ? SMIL : pfad === '/css-animiert.svg' ? CSS_ANIMIERT : pfad === '/skript.svg' ? SKRIPT : pfad === '/fremdobjekt.svg' ? FREMDOBJEKT : null;
    if (koerper === null) {
      res.writeHead(404);
      return res.end('nicht gefunden');
    }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    res.end(koerper);
  });
  await new Promise<void>((ok) => svgServer.listen(svgPort, '127.0.0.1', ok));
  profil = await mkdtemp(path.join(tmpdir(), 'veil-svg-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  if (!context.serviceWorkers()[0]) await context.waitForEvent('serviceworker', { timeout: 15_000 });
});

test.afterAll(async () => {
  await context?.close();
  svgServer?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

const urteil = (seite: Page, id: string) => seite.evaluate((i) => document.getElementById(i)?.getAttribute('data-veil') ?? '', id);

// Wartet, bis das Element ein Urteil hat, und liefert die Zeit in ms seit dem Aufruf.
async function zeitBisUrteil(seite: Page, id: string, frist = 8000): Promise<{ ms: number; urteil: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < frist) {
    const u = await urteil(seite, id);
    if (u) return { ms: Date.now() - t0, urteil: u };
    await seite.waitForTimeout(50);
  }
  return { ms: Date.now() - t0, urteil: '' };
}

test('SVG-Logos (img, Data-URL, Hintergrund) bekommen binnen 5 s ein Urteil frei', async () => {
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${port}/svg-logo.html`);
  for (const id of ['logo', 'logo-viewbox', 'logo-data', 'hg']) {
    const r = await zeitBisUrteil(seite, id);
    console.log(`svg chromium: ${id} ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
    expect(r.urteil, `${id} ohne Urteil nach ${r.ms} ms`).toBe('frei');
    expect(r.ms).toBeLessThan(5000);
  }
  expect(await seite.evaluate(() => (window as any).__aufblitzen)).toBe(0);
  await seite.close();
});

test('SVG mit eingebettetem Rasterbild wird geprueft und nie frei', async () => {
  test.skip(!existsSync(nsfwBild), 'ohne Testbilder');
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${port}/svg-logo.html?raster=1`);
  const r = await zeitBisUrteil(seite, 'logo-raster', 15_000);
  console.log(`svg chromium: logo-raster ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
  expect(['zensiert', 'verdeckt']).toContain(r.urteil);
  await seite.waitForTimeout(500);
  expect(await urteil(seite, 'logo-raster')).not.toBe('frei');
  await seite.close();
});

test('nicht ladbares SVG bleibt nicht ewig offen', async () => {
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${port}/svg-logo.html?kaputt=1`);
  const r = await zeitBisUrteil(seite, 'logo-kaputt', 6000);
  console.log(`svg chromium: logo-kaputt ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
  expect(r.urteil).not.toBe('');
  await seite.close();
});

test('SVG mit Animation (SMIL, CSS), Skript oder foreignObject wird nie frei', async () => {
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${port}/svg-logo.html?animiert=1`);
  for (const id of ['logo-smil', 'logo-css', 'logo-skript', 'logo-fo']) {
    const r = await zeitBisUrteil(seite, id, 10_000);
    console.log(`svg chromium: ${id} ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
    expect(['zensiert', 'verdeckt'], `${id}: ${r.urteil}`).toContain(r.urteil);
  }
  await seite.waitForTimeout(1500);
  for (const id of ['logo-smil', 'logo-css', 'logo-skript', 'logo-fo']) expect(await urteil(seite, id), id).not.toBe('frei');
  await seite.close();
});
