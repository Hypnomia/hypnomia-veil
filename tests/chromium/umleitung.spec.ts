// Chromium: Komplett-Ersatz (Phase 4, Auftrag U). Umleitung der Listen-Domains auf die Galerie per declarativeNetRequest: nur mit Pack
// plus Schalter, nie bei Pause, Pause in der Galerie fuehrt zur Originaladresse, Ausnahme und eigene Seite wirken, Testdomain nur im Testbau.
// Nur synthetische Bilder. Die Testdomains loest `--host-resolver-rules` auf den Testserver auf (Spezifikation: Aufgabenblatt Regel 7).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const ADULT = `http://pornhub.veil-erwachsen.test:${port}/hello.html`;
const ADULT2 = `http://xhamster.veil-erwachsen.test:${port}/hello.html?a=1&b=2`;
const EIGEN = `http://eigen.test:${port}/hello.html`;
const DUMMY_VORSCHAU = 4; // Anzahl der Vorschau-Bilder im Dummy-Pack (scripts/pack/baue-pack.mjs)
const NEUTRAL = `http://127.0.0.1:${port}/hello.html`;

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
let ext: Page;

const galerieStart = () => `chrome-extension://${erweiterungsId}/galerie.html?ziel=`;

// Einstellungen aendern, wie es die Oberflaeche tut: lesen, zusammenfuehren, schreiben (die Erweiterung fuellt Fehlendes auf).
async function setze(teil: { pause?: boolean; an?: boolean; komplettErsatz?: boolean; eigeneSeiten?: string[]; ausnahmen?: string[] }): Promise<void> {
  await ext.evaluate(async (t) => {
    const api = (globalThis as any).chrome;
    const alt = ((await api.storage.local.get('einstellungen')).einstellungen ?? {}) as any;
    const neu = { ...alt, erwachsen: { ...(alt.erwachsen ?? {}) } };
    if (t.pause !== undefined) neu.pause = t.pause;
    if (t.an !== undefined) neu.erwachsen.an = t.an;
    if (t.komplettErsatz !== undefined) neu.erwachsen.komplettErsatz = t.komplettErsatz;
    if (t.eigeneSeiten) neu.erwachsen.eigeneSeiten = t.eigeneSeiten;
    if (t.ausnahmen) neu.ausnahmen = t.ausnahmen;
    await api.storage.local.set({ einstellungen: neu });
  }, teil);
}

const regeln = (): Promise<any[]> => ext.evaluate(() => (globalThis as any).chrome.declarativeNetRequest.getDynamicRules());
const anzahlRegeln = async () => (await regeln()).length;
async function warteRegeln(n: number): Promise<number> {
  const t0 = Date.now();
  await expect.poll(anzahlRegeln, { timeout: 10_000, intervals: [25] }).toBe(n);
  return Date.now() - t0;
}

// Oeffnet eine Adresse in einem frischen Tab und liefert die Adresse, bei der die Navigation endet.
async function ziel(adresse: string): Promise<string> {
  const seite = await context.newPage();
  try {
    await seite.goto(adresse, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await seite.waitForLoadState('domcontentloaded').catch(() => undefined);
    return seite.url();
  } finally {
    await seite.close();
  }
}

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-umleitung-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-umleitung-datei-'));
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await (await ladeBau()).baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${erweiterung}`,
      `--load-extension=${erweiterung}`,
      '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1, MAP eigen.test 127.0.0.1',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  ext = await context.newPage();
  await ext.goto(`chrome-extension://${erweiterungsId}/options.html`);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('ohne Pack keine Regel, auch mit Schalter; Testdomain-Seite bleibt stehen', async () => {
  await setze({ komplettErsatz: true });
  // Abgleich anstossen und abwarten, erst dann zaehlen (kein Warten auf gut Glueck).
  await ext.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'umleitung-abgleich' }));
  expect(await anzahlRegeln()).toBe(0);
  expect(await ziel(ADULT)).toBe(ADULT);
  await setze({ komplettErsatz: false });
});

test('Pack importiert, Schalter aus: keine Regel, keine Umleitung', async () => {
  await ext.locator('#datei').setInputFiles(packPfad);
  await ext.locator('#annehmen').click();
  await expect(ext.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
  expect(await anzahlRegeln()).toBe(0);
  expect(await ziel(ADULT)).toBe(ADULT);
});

test('Schalter an: Regel entsteht, Adresszeile wird auf die Galerie mit Originaladresse umgeleitet', async () => {
  await setze({ komplettErsatz: true });
  const ms = await warteRegeln(1);
  const regel = (await regeln())[0];
  expect(regel.condition.resourceTypes).toEqual(['main_frame']);
  expect(regel.condition.requestDomains).toContain('pornhub.com');
  expect(regel.condition.requestDomains).toContain('veil-erwachsen.test');
  console.log(`chromium: Regel nach ${ms} ms da, ${regel.condition.requestDomains.length} Domains`);

  const seite = await context.newPage();
  try {
    await seite.goto(ADULT2, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(`${galerieStart()}${ADULT2}`);
    // Alle Vorschau-Bilder des Dummy-Packs kommen (nacheinander aus IndexedDB).
    await expect.poll(() => seite.locator('#bilder img').count(), { timeout: 10_000 }).toBe(DUMMY_VORSCHAU);
    await expect(seite.locator('#pause')).toBeVisible();
    await expect(seite.locator('#link-patreon')).toHaveAttribute('href', /^https:\/\/www\.patreon\.com\//);
    await expect(seite.locator('#link-subscribestar')).toHaveAttribute('href', /^https:\/\/subscribestar\./);
    await expect(seite.locator('#ziel-zeile')).toContainText('xhamster.veil-erwachsen.test');
    // Bilder sind echte Bilder (Breite > 0), kein kaputtes Element.
    const breiten = await seite.locator('#bilder img').evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth));
    expect(breiten.every((b) => b > 0)).toBe(true);
    // Die Seite selbst kam nie: kein Treffer auf dem Testserver, Galerie zeigt die ganze Originaladresse mit & im Parameter.
  } finally {
    await seite.close();
  }
});

// Link in der Seite einer Listen-Domain: erst ohne Regel laden, dann Regel an, dann klicken (Anfrager liegt in einer Listen-Domain).
test('Link in der Seite einer Listen-Domain fuehrt zur Galerie', async () => {
  await setze({ komplettErsatz: false });
  await warteRegeln(0);
  const innen = await context.newPage();
  try {
    await innen.goto(ADULT);
    expect(innen.url()).toBe(ADULT);
    await setze({ komplettErsatz: true });
    await warteRegeln(1);
    await innen.evaluate((u) => {
      const a = document.createElement('a');
      a.id = 'l';
      a.href = u;
      a.textContent = 'los';
      document.body.append(a);
    }, ADULT2);
    await innen.click('#l');
    await expect.poll(() => innen.url(), { timeout: 10_000 }).toBe(`${galerieStart()}${ADULT2}`);
  } finally {
    await innen.close();
  }
});

// Fremde Seite (127.0.0.1) verlinkt auf eine Listen-Domain: der Anfrager liegt nicht in der Liste (web_accessible_resources.matches).
test('Link von einer fremden Seite endet in der Fehlerseite (Zwischenstand, Entscheidung 107)', async () => {
  const fremd = await context.newPage();
  try {
    await fremd.goto(NEUTRAL);
    await fremd.evaluate((u) => {
      const a = document.createElement('a');
      a.id = 'l';
      a.href = u;
      a.textContent = 'los';
      document.body.append(a);
    }, ADULT);
    await fremd.click('#l');
    // Zwischenstand bis Session 8, Entscheidung 107: web_accessible_resources nur fuer Listen-Domains, ein Link von einer fremden Seite
    // endet in der Chrome-Fehlerseite, die Galerie erscheint nicht.
    await expect.poll(() => fremd.url(), { timeout: 10_000 }).toBe('chrome-error://chromewebdata/');
  } finally {
    await fremd.close();
  }
});

test('Pause in der Galerie: Regel weg, zurueck zur Originaladresse, Pause steht in den Einstellungen', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(ADULT, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(`${galerieStart()}${ADULT}`);
    const t0 = Date.now();
    const anfragen: Record<string, string>[] = [];
    seite.on('request', (r) => {
      if (r.url() === ADULT && r.isNavigationRequest()) void r.allHeaders().then((h) => anfragen.push(h));
    });
    await seite.locator('#pause').click();
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(ADULT);
    // Kein Referer der Erweiterung bei der Rueckkehr (meta referrer = no-referrer).
    expect(await seite.evaluate(() => document.referrer)).toBe('');
    await expect.poll(() => anfragen.length).toBeGreaterThan(0);
    expect(anfragen.every((h) => !h['referer'])).toBe(true);
    console.log(`chromium: Pause in der Galerie bis Originaladresse ${Date.now() - t0} ms`);
    await expect(seite.locator('h1')).toHaveText('Hello Veil');
  } finally {
    await seite.close();
  }
  expect(await anzahlRegeln()).toBe(0);
  const pause = await ext.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen ?? {}).pause);
  expect(pause).toBe(true);
});

test('Pause von aussen nimmt die Regel sofort weg; Galerie-Adresse bei Pause geht sofort zurueck', async () => {
  expect(await ziel(ADULT)).toBe(ADULT); // Pause aus dem vorigen Test steht noch
  await setze({ pause: false });
  await warteRegeln(1);
  const ms = await (async () => {
    const t0 = Date.now();
    await setze({ pause: true });
    await warteRegeln(0);
    return Date.now() - t0;
  })();
  console.log(`chromium: Pause bis Regel weg ${ms} ms`);
  expect(ms).toBeLessThan(2000);
  // Eine offene Galerie (alter Tab) geht bei Pause beim Laden sofort zurueck.
  const seite = await context.newPage();
  try {
    await seite.goto(`${galerieStart()}${ADULT}`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(ADULT);
  } finally {
    await seite.close();
  }
  // Ende der Pause: Regel wieder da.
  await setze({ pause: false });
  await warteRegeln(1);
});

test('offene Galerie geht zurueck, sobald Pause gesetzt wird (ohne Klick)', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(ADULT, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(`${galerieStart()}${ADULT}`);
    await setze({ pause: true });
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(ADULT);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
  await warteRegeln(1);
});

test('Ausnahme des Nutzers (Host) nimmt genau diesen Host aus, andere Listen-Domains bleiben', async () => {
  await setze({ ausnahmen: ['pornhub.veil-erwachsen.test'] });
  await expect.poll(async () => (await regeln())[0]?.condition.excludedRequestDomains?.length ?? 0, { timeout: 10_000 }).toBe(1);
  expect(await ziel(ADULT)).toBe(ADULT);
  expect(await ziel(ADULT2)).toBe(`${galerieStart()}${ADULT2}`);
  await setze({ ausnahmen: [] });
  await expect.poll(async () => (await regeln())[0]?.condition.excludedRequestDomains?.length ?? 0, { timeout: 10_000 }).toBe(0);
  expect(await ziel(ADULT)).toBe(`${galerieStart()}${ADULT}`);
});

test('eigene Seite des Nutzers wird in Chrome bis Session 8 nicht umgeleitet (Entscheidung 107)', async () => {
  // Zwischenstand: die Galerie ist in Chrome nur fuer Listen-Domains abrufbar; jeder Klick auf eine eigene Seite endete auf der
  // Fehlerseite. Darum kommen eigene Seiten in Chrome nicht in die Regel (Firefox: siehe tests/firefox/umleitung.test.mjs).
  expect(await ziel(EIGEN)).toBe(EIGEN);
  await setze({ eigeneSeiten: ['eigen.test'] });
  await ext.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'umleitung-abgleich' }));
  expect(((await regeln())[0]?.condition.requestDomains ?? []).includes('eigen.test')).toBe(false);
  expect(((await regeln())[0]?.condition.requestDomains ?? []).length).toBeGreaterThan(0);
  expect(await ziel(EIGEN)).toBe(EIGEN);
  await setze({ eigeneSeiten: [] });
});

// ---------- Runde 2: Galerie-Zustand, Ziel-Pruefung, schlafender Hintergrund ----------
const galerieSeite = async (ziel: string | null, warteMs = 700): Promise<Page> => {
  const seite = await context.newPage();
  await seite.goto(ziel === null ? `chrome-extension://${erweiterungsId}/galerie.html` : `${galerieStart()}${ziel}`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, warteMs));
  return seite;
};

test('Galerie: Ziel javascript:, data: und Erweiterungsadresse ergeben keine Bilder und keinen Sprung', async () => {
  for (const z of ['javascript:alert(1)', 'data:text/html,hallo', `chrome-extension://${erweiterungsId}/options.html`]) {
    const seite = await galerieSeite(z);
    try {
      expect(seite.url(), z).toBe(`${galerieStart()}${z}`);
      expect(await seite.locator('#bilder img').count(), z).toBe(0);
      await expect(seite.locator('#ziel-zeile')).toBeHidden();
    } finally {
      await seite.close();
    }
  }
});

test('Galerie: fremder Host im Ziel bleibt Text, kein Sprung, auch nicht nach Pause', async () => {
  const seite = await galerieSeite(NEUTRAL);
  try {
    expect(seite.url()).toBe(`${galerieStart()}${NEUTRAL}`);
    expect(await seite.locator('#bilder img').count()).toBe(0);
    await expect(seite.locator('#ziel-zeile')).toContainText('127.0.0.1');
    await seite.locator('#pause').click();
    await new Promise((r) => setTimeout(r, 700));
    expect(seite.url()).toBe(`${galerieStart()}${NEUTRAL}`);
    expect(await seite.locator('#bilder img').count()).toBe(0);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
  await warteRegeln(1);
});

test('Galerie: https mit www im Ziel wird gezeigt; spaetere Pause leert die Bilder und springt zurueck', async () => {
  const ENDE = 'https://www.pornhub.com/video/abc?x=1&y=2';
  await context.route('https://www.pornhub.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title><h1>stub</h1>' }));
  const seite = await galerieSeite(ENDE, 100);
  try {
    await expect.poll(() => seite.locator('#bilder img').count(), { timeout: 10_000 }).toBe(DUMMY_VORSCHAU);
    await expect(seite.locator('#ziel-zeile')).toContainText('www.pornhub.com');
    await setze({ pause: true });
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(ENDE);
  } finally {
    await seite.close();
    await context.unroute('https://www.pornhub.com/**');
  }
  await setze({ pause: false });
  await warteRegeln(1);
});

test('Galerie: Pause ohne Ziel zeigt keine Bilder', async () => {
  await setze({ pause: true });
  const seite = await galerieSeite(null);
  try {
    expect(await seite.locator('#bilder img').count()).toBe(0);
    expect(seite.url()).toBe(`chrome-extension://${erweiterungsId}/galerie.html`);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
  await warteRegeln(1);
});

test('Galerie im iframe zeigt nichts und tut nichts', async () => {
  // Rahmen nur von einer Listen-Seite aus moeglich (Zwischenstand, Entscheidung 107: matches nur Listen-Domains).
  await setze({ komplettErsatz: false });
  await warteRegeln(0);
  const seite = await context.newPage();
  try {
    await seite.goto(ADULT);
    await seite.evaluate((u) => {
      const f = document.createElement('iframe');
      f.id = 'rahmen';
      f.src = u;
      document.body.append(f);
    }, `${galerieStart()}${ADULT}`);
    await new Promise((r) => setTimeout(r, 1000));
    const rahmen = seite.frames().find((f) => f.url().startsWith('chrome-extension://'));
    expect(rahmen).toBeTruthy();
    expect(rahmen!.url()).toBe(`${galerieStart()}${ADULT}`);
    expect(await rahmen!.locator('body *').count()).toBe(0);
    expect(seite.url()).toBe(ADULT);
  } finally {
    await seite.close();
  }
  await setze({ komplettErsatz: true });
  await warteRegeln(1);
});

test('Pornoseiten-Modus aus: keine Regel; offene Galerie springt zurueck', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(ADULT, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(`${galerieStart()}${ADULT}`);
    await setze({ an: false });
    await warteRegeln(0);
    await expect.poll(() => seite.url(), { timeout: 10_000 }).toBe(ADULT);
  } finally {
    await seite.close();
  }
  expect(await ziel(ADULT)).toBe(ADULT);
  await setze({ an: true });
  await warteRegeln(1);
});

test('schlafender Service Worker: Pause per Speicher nimmt die Regel trotzdem weg', async () => {
  const cdp = await context.newCDPSession(ext);
  const versionen = new Map<string, string>();
  cdp.on('ServiceWorker.workerVersionUpdated', (e: any) => {
    for (const v of e.versions) versionen.set(v.versionId, v.runningStatus);
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versionen.size, { timeout: 5_000 }).toBeGreaterThan(0);
  for (const id of versionen.keys()) await cdp.send('ServiceWorker.stopWorker', { versionId: id }).catch(() => undefined);
  await cdp.send('ServiceWorker.stopAllWorkers').catch(() => undefined);
  // Playwright haelt das Worker-Objekt noch eine Weile; massgeblich ist der Status, den der Browser meldet.
  await expect.poll(() => [...versionen.values()].every((st) => st === 'stopped'), { timeout: 10_000 }).toBe(true);
  const t0 = Date.now();
  await setze({ pause: true });
  await warteRegeln(0);
  console.log(`chromium: Service Worker schlief, Pause bis Regel weg ${Date.now() - t0} ms`);
  expect(await ziel(ADULT)).toBe(ADULT);
  await setze({ pause: false });
  await warteRegeln(1);
  await cdp.detach().catch(() => undefined);
});

test('Abgleich per Nachricht setzt eine von Hand geloeschte Regel wieder; Pack entfernen nimmt sie weg', async () => {
  // Regel von Hand loeschen, dann die Abgleich-Nachricht der Galerie schicken (derselbe Weg wie bei onStartup und onInstalled).
  await ext.evaluate(() => (globalThis as any).chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] }));
  expect(await anzahlRegeln()).toBe(0);
  await ext.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'umleitung-abgleich' }));
  expect(await anzahlRegeln()).toBe(1);

  await ext.goto(`chrome-extension://${erweiterungsId}/options.html`);
  await ext.locator('#entfernen').click();
  await ext.locator('#entfernen-ja').click();
  await expect(ext.locator('#pack-status')).toContainText('No pack yet');
  await warteRegeln(0);
  expect(await ziel(ADULT)).toBe(ADULT);
});
