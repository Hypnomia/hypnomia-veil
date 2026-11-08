// Chromium: eigene Bildabrufe der Erweiterung tragen keinen Origin-Kopf mit der Erweiterungs-Kennung (Session 17, Sicherheitspruefung
// Phase 9 Fund A1). Ein eigener kleiner Server zeichnet die Koepfe jedes Abrufs auf; der Erkenner laedt ein Bild von dort nach (fremder
// Ursprung ohne CORS, wie in erkenner.spec.ts). Gegenprobe: derselbe Abruf aus einer normalen Seite per fetch traegt Origin.
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let worker: Worker;
let server: Server;
let port = 0;
const koepfe: { pfad: string; kopf: IncomingHttpHeaders }[] = [];

test.beforeAll(async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 180, b: 220 } } }).png().toBuffer();
  server = createServer((req, res) => {
    koepfe.push({ pfad: req.url ?? '', kopf: req.headers });
    if ((req.url ?? '').startsWith('/bild')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>leer</title>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
  profil = await mkdtemp(path.join(tmpdir(), 'veil-kopf-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  if (profil) await rm(profil, { recursive: true, force: true });
});

test('Nachladen des Erkenners: kein Origin mit der Erweiterungs-Kennung, Referer bleibt wie gesetzt', async () => {
  test.setTimeout(60_000);
  // Gegenprobe: ein cors-Abruf aus einer Seite mit anderem Ursprung traegt Origin (sonst bewiese das Fehlen unten nichts).
  const seite = await context.newPage();
  await seite.goto(`http://localhost:${port}/seite`);
  await seite.evaluate((u) => fetch(u, { mode: 'cors', credentials: 'omit' }).catch(() => null), `http://127.0.0.1:${port}/bild-gegenprobe.png`);
  await expect.poll(() => koepfe.find((k) => k.pfad.startsWith('/bild-gegenprobe'))?.kopf.origin ?? null).toBe(`http://localhost:${port}`);
  await seite.close();

  const nachricht = {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: 'kopf-1',
    quelle: { art: 'url', url: `http://127.0.0.1:${port}/bild-erkenner.png`, referer: `http://localhost:${port}/seite` },
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: { breast: { an: true, bedeckt: false } }, rand: 0.15, stil: 'mosaik' },
    rendern: false,
  };
  const antwort = await worker.evaluate((n) => (globalThis as any).chrome.runtime.sendMessage(n), nachricht);
  expect(antwort?.ok, JSON.stringify(antwort)).toBe(true);
  const abruf = koepfe.find((k) => k.pfad.startsWith('/bild-erkenner'));
  expect(abruf, 'der Erkenner hat das Bild vom Server geholt').toBeTruthy();
  console.log(`kopf: Abruf des Erkenners origin=${abruf!.kopf.origin ?? '(keiner)'} referer=${abruf!.kopf.referer ?? '(keiner)'} sec-fetch-site=${abruf!.kopf['sec-fetch-site'] ?? '-'}`);
  expect(abruf!.kopf.origin ?? '').not.toMatch(/extension:\/\//);
  expect(abruf!.kopf.origin).toBeUndefined();
});
