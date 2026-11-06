// Chromium: Auftrag V (Session 11). Version und Update-Hinweis: Testserver liefert 9.9.9 (Hinweis im Popup, Anleitung auf der
// Einstellungsseite), 0.7.0 (kein Hinweis), 404 und kaputtes JSON (Fehlersatz), zweite Pruefung innerhalb von 24 Stunden ohne Abruf,
// "Check now" ruft ab, ohne Adresse im Testbau kein Netz. Der Abruf geht an einen lokalen Mini-Server (tests/version-server.mjs), nie ans echte GitHub.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error reines JS-Modul
import { starteVersionServer } from '../version-server.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';
let server: any;
let manifestVersion = '';
let links: Record<string, string> = {};

const optionsUrl = () => `chrome-extension://${id}/options.html`;
const popupUrl = () => `chrome-extension://${id}/popup.html`;
const sende = (seite: Page, nachricht: Record<string, unknown>) =>
  seite.evaluate((n) => (globalThis as any).chrome.runtime.sendMessage(n), nachricht) as Promise<any>;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
// Stand vergessen und Adresse setzen (Testhaken), Zaehler des Servers auf 0.
async function vorbereiten(seite: Page, name: string | null) {
  expect((await sende(seite, { ziel: 'hintergrund', typ: 'version-test', vergiss: true })).ok).toBe(true);
  if (name) expect((await sende(seite, { ziel: 'hintergrund', typ: 'version-test', url: server.adresse(name) })).ok).toBe(true);
  for (const k of Object.keys(server.zaehler)) delete server.zaehler[k];
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await starteVersionServer();
  manifestVersion = JSON.parse(await readFile(path.join(erweiterung, 'manifest.json'), 'utf8')).version;
  links = JSON.parse(await readFile(path.join(wurzel, 'data/links.json'), 'utf8'));
  profil = await mkdtemp(path.join(tmpdir(), 'veil-version-'));
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
  await server?.schliesse();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test('Neuere Version (9.9.9): Hinweis im Popup, Anleitung in vier Schritten, ein Abruf, kein Cookie', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, '9.9.9.json');
    // Ein Cookie fuer den Mini-Server liegt bereit; der Abruf darf es nicht mitschicken (credentials: 'omit').
    await context.addCookies([{ name: 'veil_test', value: '1', url: 'http://127.0.0.1:47487/' }]);
    // Gegenprobe: eine normale Seite mit credentials 'include' schickt es sehr wohl (sonst misst der Test nichts).
    const fremd = await context.newPage();
    await fremd.goto(`http://127.0.0.1:${process.env.VEIL_FIXTURE_PORT ?? 47173}/hello.html`);
    await fremd.evaluate((u) => fetch(u, { credentials: 'include', mode: 'no-cors' }).then(() => 0), server.adresse('0.7.0.json'));
    expect(String(server.kopfzeilen.at(-1).cookie)).toContain('veil_test=1');
    await fremd.close();
    server.kopfzeilen.length = 0;
    // Popup oeffnen: Hinweis erscheint.
    const popup = await context.newPage();
    await popup.goto(popupUrl());
    await expect(popup.locator('#version-hinweis')).toBeVisible();
    await expect(popup.locator('#version-satz')).toContainText('9.9.9');
    await expect(popup.locator('#version-anleitung')).toHaveText('How to update');
    expect(server.zaehler['/v/9.9.9.json']).toBe(1);
    // Ohne Anmeldedaten und ohne Zwischenspeicher.
    const abrufe = server.kopfzeilen.filter((k: any) => k.pfad === '/v/9.9.9.json');
    expect(abrufe.length).toBe(1);
    expect(abrufe.every((k: any) => k.cookie === null && k.auth === null)).toBe(true);
    expect(abrufe[0].cache).toBe('no-cache'); // das setzt Chromium bei cache: 'no-store'
    // Knopf klicken: neue Seite ist die Einstellungsseite bei #ueber.
    const neu = context.waitForEvent('page');
    await popup.locator('#version-anleitung').click();
    const ziel = await neu;
    await ziel.waitForLoadState();
    expect(ziel.url()).toBe(`${optionsUrl()}#ueber`);
    await expect(ziel.locator('#ueber-titel')).toHaveText('About');
    await expect(ziel.locator('#ue-stand')).toContainText('9.9.9');
    await expect(ziel.locator('#ue-anleitung')).toBeVisible();
    await expect(ziel.locator('#ue-anleitung li')).toHaveCount(4);
    const release = ziel.locator('#ue-anleitung li').first().locator('a');
    expect(await release.getAttribute('href')).toBe('https://github.com/Hypnomia/hypnomia-veil/releases/latest');
    expect(await release.getAttribute('rel')).toContain('noopener');
    // Das Oeffnen der Einstellungsseite innerhalb von 24 Stunden ruft nicht noch einmal ab.
    expect(server.zaehler['/v/9.9.9.json']).toBe(1);
    // Gespeicherter Stand.
    const stand = await lies(seite, 'versionPruefung');
    expect(stand.neueste).toBe('9.9.9');
    expect(stand.fehler).toBe(false);
    expect(typeof stand.geprueft).toBe('number');
    await ziel.close();
    await popup.close().catch(() => {});
  } finally {
    await seite.close();
  }
});

test('Zweite Pruefung innerhalb von 24 Stunden ruft nicht ab, "erzwingen" und "Check now" rufen ab', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, '9.9.9.json');
    const a = await sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true });
    expect(a).toMatchObject({ ok: true, browser: 'chrome', aktuell: manifestVersion, neueste: '9.9.9', neuer: true, fehler: false });
    expect(server.zaehler['/v/9.9.9.json']).toBe(1);
    const b = await sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true });
    expect(b.neuer).toBe(true);
    expect(b.geprueft).toBe(a.geprueft);
    expect(server.zaehler['/v/9.9.9.json']).toBe(1);
    // Ohne pruefen: nur der gespeicherte Stand.
    await sende(seite, { ziel: 'hintergrund', typ: 'version' });
    expect(server.gesamt()).toBe(1);
    // Zwei Anfragen zugleich teilen sich einen Abruf (Stand vorher vergessen).
    await vorbereiten(seite, '9.9.9.json');
    await Promise.all([1, 2, 3].map(() => sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true })));
    expect(server.gesamt()).toBe(1);
    // Nach 24 Stunden wieder faellig: Stand um 25 Stunden zurueckdatieren.
    await seite.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const s = (await c.storage.local.get('versionPruefung')).versionPruefung;
      await c.storage.local.set({ versionPruefung: { ...s, geprueft: Date.now() - 25 * 3600 * 1000 } });
    });
    await sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true });
    expect(server.gesamt()).toBe(2);
    // erzwingen: sofort wieder.
    await sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true });
    expect(server.gesamt()).toBe(3);
    // Knopf "Check now" auf der Einstellungsseite: ein weiterer Abruf, der Satz bleibt.
    await seite.reload();
    await expect(seite.locator('#ue-stand')).toContainText('9.9.9');
    expect(server.gesamt()).toBe(3);
    await seite.locator('#ue-pruefen').click();
    await expect.poll(() => server.gesamt()).toBe(4);
    await expect(seite.locator('#ue-pruefen')).toBeEnabled();
    await expect(seite.locator('#ue-stand')).toContainText('9.9.9');
  } finally {
    await seite.close();
  }
});

test('Gleiche Version (0.7.0): kein Hinweis im Popup, Einstellungsseite sagt newest, Baudatum steht da', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, '0.7.0.json');
    const popup = await context.newPage();
    await popup.goto(popupUrl());
    await expect.poll(() => server.zaehler['/v/0.7.0.json']).toBe(1);
    await popup.waitForTimeout(400);
    await expect(popup.locator('#version-hinweis')).toBeHidden();
    await popup.close();
    await seite.reload();
    await expect(seite.locator('#ue-stand')).toHaveText('You’re on my newest version.');
    await expect(seite.locator('#ue-anleitung')).toBeHidden();
    await expect(seite.locator('#ue-version')).toHaveText(manifestVersion);
    await expect(seite.locator('#ue-datum')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    const a = await sende(seite, { ziel: 'hintergrund', typ: 'version' });
    await expect(seite.locator('#ue-datum')).toHaveText(a.datum);
    expect(a.neuer).toBe(false);
    // Ein bestimmter Zeitraum: Baudatum liegt nicht in der Zukunft.
    expect(new Date(a.datum).getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000);
  } finally {
    await seite.close();
  }
});

test('Fehler (404, kaputtes JSON, falsche Form, zu gross, Umleitung): Satz "Couldn’t check just now", kein Hinweis im Popup, alter Stand bleibt', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    for (const name of ['404.json', 'kaputt.json', 'falsch.json', 'gross.json', 'umleiten.json']) {
      await vorbereiten(seite, name);
      const popup = await context.newPage();
      await popup.goto(popupUrl());
      await expect.poll(() => server.zaehler[`/v/${name}`]).toBe(1);
      await popup.waitForTimeout(300);
      await expect(popup.locator('#version-hinweis')).toBeHidden();
      await popup.close();
      await seite.reload();
      await expect(seite.locator('#ue-stand')).toHaveText('Couldn’t check just now. Try again later.');
      await expect(seite.locator('#ue-anleitung')).toBeHidden();
      const stand = await lies(seite, 'versionPruefung');
      expect(stand.fehler, name).toBe(true);
      expect(stand.neueste, name).toBeNull();
      // Nach einem Fehler nicht sofort wieder (15 Minuten), also kein zweiter Abruf beim erneuten Oeffnen.
      expect(server.zaehler[`/v/${name}`]).toBe(1);
    }
    // Ein Fehler loescht eine bekannte neuere Version nicht: erst 9.9.9, dann 404 erzwungen.
    await vorbereiten(seite, '9.9.9.json');
    await sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true });
    await sende(seite, { ziel: 'hintergrund', typ: 'version-test', url: server.adresse('404.json') });
    const f = await sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true });
    expect(f).toMatchObject({ fehler: true, neueste: '9.9.9', neuer: true });
    // Knopf "Check now" bei Fehler.
    await vorbereiten(seite, '404.json');
    await seite.reload();
    await seite.locator('#ue-pruefen').click();
    await expect(seite.locator('#ue-stand')).toHaveText('Couldn’t check just now. Try again later.');
  } finally {
    await seite.close();
  }
});

test('Testbau ohne Adresse: kein Netz; Links, Pause-Satz und Texte stehen auf der Seite', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, null);
    const a = await sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true });
    expect(a).toMatchObject({ ok: true, browser: 'chrome', neueste: null, neuer: false, geprueft: null, fehler: false });
    await sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true });
    expect(server.gesamt()).toBe(0);
    // Nur lokale Adressen sind als Testadresse erlaubt.
    const f = await sende(seite, { ziel: 'hintergrund', typ: 'version-test', url: 'https://raw.githubusercontent.com/x/y/main/version.json' });
    expect(f.ok).toBe(false);
    await seite.reload();
    const hrefs = await seite.locator('#ue-links a').evaluateAll((as) => as.map((x) => [x.textContent, (x as HTMLAnchorElement).href]));
    expect(hrefs).toEqual([
      ['lnk.bio', links.linkbio],
      ['Patreon', links.patreon],
      ['SubscribeStar', links.subscribestar],
    ]);
    await expect(seite.locator('#ue-netz')).toBeVisible();
    await expect(seite.locator('#ue-pause')).toContainText('Pausing');
    expect(await seite.locator('#ue-links a').evaluateAll((as) => as.every((x) => x.getAttribute('rel')?.includes('noopener') && x.getAttribute('target') === '_blank'))).toBe(true);
    // Abschnitt hat die vom Vertrag verlangte Ueberschrift und ist benannt.
    expect(await seite.locator('#ueber').getAttribute('aria-labelledby')).toBe('ueber-titel');
    // Das Popup bleibt ohne Adresse leer.
    const popup = await context.newPage();
    await popup.goto(popupUrl());
    await popup.waitForTimeout(400);
    await expect(popup.locator('#version-hinweis')).toBeHidden();
    await expect(popup.locator('#pause')).toBeVisible();
    expect(server.gesamt()).toBe(0);
    await popup.close();
  } finally {
    await seite.close();
  }
});

test('Vorabversion (9.9.9-beta) wird nie als Update gemeldet', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, 'vorab.json');
    const a = await sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true });
    expect(a).toMatchObject({ ok: true, neueste: '9.9.9-beta', neuer: false, fehler: false });
    expect(server.zaehler['/v/vorab.json']).toBe(1);
  } finally {
    await seite.close();
  }
});

test('Popup: gespeicherter Stand sofort, langsamer Abruf verschiebt den Pause-Knopf nicht, Hinweis steht unter dem Knopf', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, 'langsam.json');
    // Gespeicherter Stand: 9.9.9 bekannt, aber seit 25 Stunden nicht geprueft (also faellig, der Abruf dauert 2,5 s).
    await seite.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({ versionPruefung: { geprueft: Date.now() - 25 * 3600 * 1000, neueste: '9.9.9', fehler: false } });
    });
    const popup = await context.newPage();
    await popup.goto(popupUrl());
    const t0 = Date.now();
    await expect(popup.locator('#version-hinweis')).toBeVisible({ timeout: 2000 });
    const dauer = Date.now() - t0;
    expect(dauer).toBeLessThan(2000); // vor der Antwort des langsamen Servers
    expect(server.zaehler['/v/langsam.json']).toBe(1);
    const pause = await popup.locator('#pause').boundingBox();
    const hinweis = await popup.locator('#version-hinweis').boundingBox();
    expect(hinweis!.y).toBeGreaterThan(pause!.y + pause!.height - 1); // Hinweis liegt unter dem Knopf
    // Die Antwort kommt spaeter; der Knopf bleibt, wo er war.
    await expect.poll(async () => (await lies(seite, 'versionPruefung')).geprueft, { timeout: 8000 }).toBeGreaterThan(Date.now() - 20 * 1000);
    const pause2 = await popup.locator('#pause').boundingBox();
    expect(pause2!.y).toBe(pause!.y);
    await expect(popup.locator('#version-hinweis')).toBeVisible();
    await popup.close();
  } finally {
    await seite.close();
  }
});

test('Content-Script darf nicht erzwingen und nicht pruefen: Zaehler bleibt, nur der gespeicherte Stand kommt zurueck', async () => {
  const seite = await context.newPage();
  const fremd = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, '9.9.9.json');
    await fremd.goto(`http://127.0.0.1:${process.env.VEIL_FIXTURE_PORT ?? 47173}/hello.html`);
    // Die Isolated World des Content-Scripts ueber CDP finden und dort sendMessage aufrufen (Absender: Seite, nicht Erweiterungsseite).
    const cdp = await context.newCDPSession(fremd);
    const welten: { id: number; origin: string }[] = [];
    cdp.on('Runtime.executionContextCreated', (e: any) => welten.push({ id: e.context.id, origin: e.context.origin }));
    await cdp.send('Runtime.enable');
    await expect.poll(() => welten.some((w) => w.origin.startsWith(`chrome-extension://${id}`)), { timeout: 10_000 }).toBe(true);
    const inhalt = welten.find((w) => w.origin.startsWith(`chrome-extension://${id}`))!;
    const schick = async (n: object) => {
      const r: any = await cdp.send('Runtime.evaluate', {
        contextId: inhalt.id,
        expression: `chrome.runtime.sendMessage(${JSON.stringify(n)})`,
        awaitPromise: true,
        returnByValue: true,
      });
      return r.result.value;
    };
    const e1 = await schick({ ziel: 'hintergrund', typ: 'version', erzwingen: true });
    expect(e1).toMatchObject({ ok: true, neueste: null, neuer: false, geprueft: null });
    const e2 = await schick({ ziel: 'hintergrund', typ: 'version', pruefen: true });
    expect(e2).toMatchObject({ ok: true, neueste: null, neuer: false, geprueft: null });
    await fremd.waitForTimeout(300);
    expect(server.gesamt()).toBe(0);
    // Gegenprobe: dieselbe Nachricht von der Einstellungsseite ruft ab.
    const e3 = await sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true });
    expect(e3.neueste).toBe('9.9.9');
    expect(server.gesamt()).toBe(1);
  } finally {
    await fremd.close();
    await seite.close();
  }
});

test('"Check now" waehrend eines nicht faelligen Laufs ruft trotzdem ab', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await vorbereiten(seite, '9.9.9.json');
    await sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true });
    expect(server.gesamt()).toBe(1);
    // Ein nicht faelliger Lauf und gleichzeitig ein erzwungener: der erzwungene fragt noch einmal.
    await Promise.all([sende(seite, { ziel: 'hintergrund', typ: 'version', pruefen: true }), sende(seite, { ziel: 'hintergrund', typ: 'version', erzwingen: true })]);
    expect(server.gesamt()).toBe(2);
  } finally {
    await seite.close();
  }
});
