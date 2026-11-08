// Chromium: Sicherheitsreste Phase 9 (Paket N3, Session 18). A4: Referer-Regeln nur fuer den genauen Host, nie fuer die Hosts des
// Versions-Checks, mit Haltezeit. A3: der Wurzel-Haken ist nicht per Symbol.for abfragbar und richtet sich trotzdem nur einmal ein.
// N1: CSP der Erweiterungsseiten mit default-src, und keine Seite (Popup, Einstellungen, Willkommen, Hilfe) und kein Erkenner-Lauf im
// Offscreen-Dokument verletzt sie. Ein eigener kleiner Server zeichnet die Koepfe jedes Abrufs auf.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
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
let id = '';
const koepfe: { host: string; pfad: string; kopf: IncomingHttpHeaders }[] = [];

test.beforeAll(async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 180, b: 220 } } }).png().toBuffer();
  server = createServer((req, res) => {
    koepfe.push({ host: req.headers.host ?? '', pfad: req.url ?? '', kopf: req.headers });
    if ((req.url ?? '').startsWith('/bild')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>leer</title><body></body>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
  profil = await mkdtemp(path.join(tmpdir(), 'veil-n3-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  if (profil) await rm(profil, { recursive: true, force: true });
});

const sende = (n: unknown) => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
// Nachrichten an den Hintergrund selbst kommen aus einer Erweiterungsseite (der Service Worker empfaengt seine eigenen nicht).
let absender: Page | null = null;
async function sendeAnHintergrund(n: unknown): Promise<any> {
  if (!absender) {
    absender = await context.newPage();
    await absender.goto(`chrome-extension://${id}/hilfe.html`);
  }
  return absender.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
}
// Eigener Abruf der Erweiterung (Service Worker, kein Tab, Art xmlhttprequest), wie die Abrufe, fuer die die Referer-Regeln gelten.
const holeImWorker = (u: string) =>
  worker.evaluate((adresse) => fetch(adresse, { credentials: 'omit', cache: 'no-store' }).then((r) => r.status, (e) => String(e)), u);
const kopfVon = (pfad: string) => koepfe.find((k) => k.pfad.startsWith(pfad))?.kopf;
const regeln = () => worker.evaluate(() => (globalThis as any).chrome.declarativeNetRequest.getSessionRules()) as Promise<any[]>;

test('A4: Referer-Regel trifft nur den genauen Host, keine Unterdomain', async () => {
  const antwort = await sendeAnHintergrund({ ziel: 'hintergrund', typ: 'referer', host: `localhost:${port}`, referer: 'http://seite-a.example/' });
  expect(antwort?.ok, JSON.stringify(antwort)).toBe(true);
  // Positivkontrolle: der Host selbst bekommt den Referer.
  expect(await holeImWorker(`http://localhost:${port}/bild-a1.png`)).toBe(200);
  expect(kopfVon('/bild-a1')?.referer).toBe('http://seite-a.example/');
  // Unterdomain desselben Hosts: kein Referer aus der Regel.
  expect(await holeImWorker(`http://unter.localhost:${port}/bild-a2.png`)).toBe(200);
  expect(kopfVon('/bild-a2'), 'Abruf an die Unterdomain kam an').toBeTruthy();
  console.log(`n3: Unterdomain referer=${kopfVon('/bild-a2')?.referer ?? '(keiner)'}`);
  expect(kopfVon('/bild-a2')?.referer).not.toBe('http://seite-a.example/');
});

test('A4: keine Referer-Regel fuer die Hosts des Versions-Checks', async () => {
  for (const host of ['raw.githubusercontent.com', 'RAW.githubusercontent.com:443', 'githubusercontent.com', 'github.com']) {
    const antwort = await sendeAnHintergrund({ ziel: 'hintergrund', typ: 'referer', host, referer: 'https://seite-b.example/' });
    expect(antwort?.ok, `${host}: ${JSON.stringify(antwort)}`).toBe(false);
  }
  const alle = await regeln();
  expect(alle.filter((r) => (r.condition?.requestDomains ?? []).some((d: string) => /github/.test(d)))).toEqual([]);
});

test('A4: Referer-Regel faellt nach der Haltezeit weg', async () => {
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ testRefererDauer: 1500 }));
  try {
    const antwort = await sendeAnHintergrund({ ziel: 'hintergrund', typ: 'referer', host: `127.0.0.1:${port}`, referer: 'http://seite-c.example/' });
    expect(antwort?.ok, JSON.stringify(antwort)).toBe(true);
    expect(await holeImWorker(`http://127.0.0.1:${port}/bild-c1.png`)).toBe(200);
    expect(kopfVon('/bild-c1')?.referer).toBe('http://seite-c.example/');
    await expect
      .poll(async () => (await regeln()).filter((r) => (r.condition?.requestDomains ?? []).includes('127.0.0.1')).length, { timeout: 8000 })
      .toBe(0);
    expect(await holeImWorker(`http://127.0.0.1:${port}/bild-c2.png`)).toBe(200);
    console.log(`n3: nach Ablauf referer=${kopfVon('/bild-c2')?.referer ?? '(keiner)'}`);
    expect(kopfVon('/bild-c2')?.referer).not.toBe('http://seite-c.example/');
  } finally {
    await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('testRefererDauer'));
  }
});

test('A3: Wurzel-Haken ohne Symbol.for-Kennzeichen, zweites Einspritzen richtet nichts doppelt ein', async () => {
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${port}/seite-haken`);
  // Der Haken laeuft (Lebenszeichen: attachShadow ist umgehaengt).
  await expect.poll(() => seite.evaluate(() => !/\[native code\]/.test(Function.prototype.toString.call(Element.prototype.attachShadow)))).toBe(true);
  const befund = await seite.evaluate(() => ({
    perFor: Symbol.for('hypnomia-veil.wurzel-haken') in Element.prototype,
    namen: Object.getOwnPropertySymbols(Element.prototype).map((s) => String(s.description)),
  }));
  console.log(`n3: Symbole am Element.prototype: ${JSON.stringify(befund.namen)}`);
  expect(befund.perFor, 'Seite findet den Haken ueber Symbol.for').toBe(false);
  expect(befund.namen.filter((n) => /veil|hypnomia|haken/i.test(n))).toEqual([]);

  // Zweites Einspritzen des gebauten Hakens in dieselbe Seitenwelt: neue Wurzeln bekommen trotzdem genau einen Stil.
  const haken = readFileSync(path.join(erweiterung, 'content-scripts', 'wurzel-haken.js'), 'utf8');
  await seite.addScriptTag({ content: haken });
  const anzahl = await seite.evaluate(async () => {
    const h = document.createElement('div');
    document.body.append(h);
    const r = h.attachShadow({ mode: 'open' });
    await new Promise((f) => setTimeout(f, 300));
    return r.querySelectorAll('style[data-veil-haken], style[data-veil-eigen]').length;
  });
  expect(anzahl).toBe(1);
  await seite.close();
});

test('N1: CSP der Erweiterungsseiten mit default-src, Seiten und Erkenner ohne Verletzung', async () => {
  test.setTimeout(90_000);
  const csp: string = await worker.evaluate(() => (globalThis as any).chrome.runtime.getManifest().content_security_policy.extension_pages);
  console.log(`n3: CSP ${csp}`);
  const teile = new Map(
    csp
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => [t.split(/\s+/)[0], t.split(/\s+/).slice(1)] as const),
  );
  expect(teile.get('default-src')).toEqual(["'self'"]);
  expect(teile.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  expect(teile.get('object-src')).toEqual(["'self'"]);
  expect(teile.get('connect-src')).toBeTruthy();
  expect(teile.get('connect-src')).not.toContain('*');
  expect(teile.get('img-src')).not.toContain('http:');
  expect(teile.get('img-src')).not.toContain('https:');

  const verletzungen: string[] = [];
  const beobachte = (p: Page, name: string) => {
    p.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) verletzungen.push(`${name}: ${m.text()}`);
    });
    p.on('pageerror', (e) => verletzungen.push(`${name}: Fehler ${e.message}`));
  };
  for (const name of ['popup.html', 'options.html', 'willkommen.html', 'hilfe.html']) {
    const p = await context.newPage();
    beobachte(p, name);
    await p.goto(`chrome-extension://${id}/${name}`);
    await p.waitForLoadState('load');
    await p.waitForTimeout(1500);
    // Bilder und Schriften der Seite sind geladen (eine blockierte Quelle haette naturalWidth 0 bzw. Status error).
    const stand = await p.evaluate(async () => {
      await document.fonts.ready;
      const bilder = [...document.images].filter((b) => b.currentSrc && b.complete && b.naturalWidth === 0).map((b) => b.currentSrc.slice(0, 80));
      const schriften = [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family);
      return { bilder, schriften, text: (document.body?.innerText ?? '').trim().length };
    });
    console.log(`n3: ${name} ${JSON.stringify(stand)}`);
    expect(stand.bilder, `${name}: Bilder nicht geladen`).toEqual([]);
    expect(stand.schriften, `${name}: Schriften nicht geladen`).toEqual([]);
    expect(stand.text, `${name}: Seite leer`).toBeGreaterThan(0);
    await p.close();
  }

  // Gegenprobe des Detektors: ein fremdes Bild in einer Erweiterungsseite wird von der CSP blockiert und als Verletzung gemeldet.
  const probe = await context.newPage();
  const probeMeldungen: string[] = [];
  probe.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) probeMeldungen.push(m.text());
  });
  await probe.goto(`chrome-extension://${id}/popup.html`);
  await probe.evaluate((u) => {
    const b = document.createElement('img');
    b.src = u;
    document.body.append(b);
  }, `http://127.0.0.1:${port}/bild-csp-probe.png`);
  await expect.poll(() => probeMeldungen.length).toBeGreaterThan(0);
  expect(kopfVon('/bild-csp-probe'), 'fremdes Bild darf den Server nicht erreichen').toBeUndefined();
  await probe.close();

  // Offscreen-Dokument: der Erkenner laedt ein fremdes Bild nach und rendert die Zensur als Daten-Adresse (fetch http, data:, blob:).
  const nachricht = {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: 'n3-csp',
    quelle: { art: 'url', url: `http://127.0.0.1:${port}/bild-erkenner.png`, referer: `http://localhost:${port}/seite` },
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: { breast: { an: true, bedeckt: false } }, rand: 0.15, stil: 'mosaik' },
    rendern: true,
  };
  const antwort = await sende(nachricht);
  expect(antwort?.ok, JSON.stringify(antwort).slice(0, 300)).toBe(true);
  expect(kopfVon('/bild-erkenner'), 'Erkenner hat das Bild geholt').toBeTruthy();
  expect(verletzungen, verletzungen.join('\n')).toEqual([]);
});
