import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47175);
const basis = `http://127.0.0.1:${port}`;

const ZONEN_BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ZONEN_ALLE = ['eyes', 'mouth', 'face', 'head', ...ZONEN_BEDECKBAR];

function alleZonen(): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const name of ZONEN_ALLE) z[name] = ZONEN_BEDECKBAR.includes(name) ? { an: true, bedeckt: true } : { an: true };
  return z;
}

function pruefeNachricht(url: string, extra: Record<string, unknown> = {}) {
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    quelle: { art: 'url', url, referer: '' },
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: alleZonen(), rand: 0.15, stil: 'mosaik' },
    rendern: false,
    ...extra,
  };
}

// Sendet aus dem Service Worker (er kann sich nicht selbst benachrichtigen, erreicht aber das Offscreen-Dokument).
function ausWorker(worker: Worker, nachricht: unknown): Promise<any> {
  return worker.evaluate((n) => (globalThis as any).chrome.runtime.sendMessage(n), nachricht);
}

async function testbilder(satz: 'sfw' | 'nsfw'): Promise<string[]> {
  const antwort = await fetch(`${basis}/api/testbilder?satz=${satz}`);
  const json = (await antwort.json()) as { bilder: string[] };
  return json.bilder;
}

// Render-Tests brauchen die Testbilder aus ../05 Testbilder (nie im Repo). Fehlen sie, ist der Test ROT; nur mit VEIL_OHNE_TESTBILDER=1
// wird er uebersprungen, und das laut gemeldet.
function brauchtTestbilder(liste: string[], satz: string): void {
  if (liste.length > 0) return;
  if (process.env.VEIL_OHNE_TESTBILDER === '1') {
    console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Test mit Testsatz ${satz} uebersprungen`);
    test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
  }
  throw new Error(`Testsatz ${satz} ist leer oder fehlt (../05 Testbilder/${satz}); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
}

test.describe.configure({ mode: 'serial' });

let profil: string | undefined;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
// Zeitpunkt, ab dem der Service Worker da ist: Bezugspunkt fuer die erste Antwort des Erkenners.
let workerDaMs = 0;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-erkenner-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  workerDaMs = Date.now();
  // Das Offscreen-Dokument legt der Hintergrund bei onInstalled an; es hoert erst nach dem Laden zu: wecken mit Wiederholung.
  await expect
    .poll(
      async () => {
        try {
          const a = await ausWorker(worker, { ziel: 'erkenner', typ: 'wecke' });
          return a?.ok === true;
        } catch {
          return false;
        }
      },
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test('Erkenner: synthetisches Bild bleibt frei, Rundlauf unter 2 s, zweite Anfrage ist warm', async () => {
  // Die erste Pruefung kommt, sobald das Offscreen-Dokument zuhoert (`wecke` wartet nicht auf das Modell). Je nachdem,
  // wie weit das Vorladen ist, steckt der Kaltstart (siehe `status.kaltstartMs`) ganz, teilweise oder gar nicht im Rundlauf.
  const t0 = Date.now();
  const erste = await ausWorker(worker, pruefeNachricht(`${basis}/synthetisch/1.png`));
  const rundlauf = Date.now() - t0;
  const bisAntwort = Date.now() - workerDaMs;
  console.log(`chromium: pruefe 1 Rundlauf ${rundlauf} ms, kalt ${erste.kalt}, ${bisAntwort} ms seit Service Worker, ms ${JSON.stringify(erste.ms)}`);
  expect(erste.ok).toBe(true);
  expect(erste.flaechen).toEqual([]);
  expect(erste.breite).toBe(640);
  expect(erste.hoehe).toBe(480);
  expect(erste.bild).toBeUndefined();
  expect(erste.ms.inf).toBeLessThan(200);
  expect(rundlauf).toBeLessThan(2000);

  const t1 = Date.now();
  const zweite = await ausWorker(worker, pruefeNachricht(`${basis}/synthetisch/2.png`));
  const rundlauf2 = Date.now() - t1;
  console.log(`chromium: pruefe 2 Rundlauf ${rundlauf2} ms, ms ${JSON.stringify(zweite.ms)}`);
  expect(zweite.ok).toBe(true);
  expect(zweite.kalt).toBe(false);
  expect(zweite.flaechen).toEqual([]);
  expect(zweite.ms.inf).toBeLessThan(200);
});

test('Erkenner: status und wecke', async () => {
  const s = await ausWorker(worker, { ziel: 'erkenner', typ: 'status' });
  console.log(`chromium: status ${JSON.stringify(s)}`);
  expect(s.ok).toBe(true);
  expect(s.bereit).toBe(true);
  expect(s.modell).toBe('320n');
  // Kaltstart getrennt ausgewiesen: Modell laden, Session bauen, Leerlauf rechnen.
  expect(typeof s.kaltstartMs).toBe('number');
  console.log(`chromium: Kaltstart ${s.kaltstartMs} ms`);
  expect(s.kaltstartMs).toBeLessThan(2000);
  expect(s.laeufe).toBeGreaterThanOrEqual(2);
  expect(s.warteschlange).toBe(0);
  const w = await ausWorker(worker, { ziel: 'erkenner', typ: 'wecke' });
  expect(w).toEqual({ ok: true, bereit: true });
});

test('Erkenner: Testbild aus dem sfw-Satz, rendern liefert JPEG, wenn Flaechen da sind', async () => {
  const liste = await testbilder('sfw');
  brauchtTestbilder(liste, 'sfw');
  const antwort = await ausWorker(
    worker,
    pruefeNachricht(`${basis}/testbild/sfw/${encodeURIComponent(liste[0]!)}`, { rendern: true }),
  );
  console.log(`chromium: sfw ${liste[0]}: ${antwort.ok ? `${antwort.treffer.length} Treffer, ${antwort.flaechen.length} Flaechen, ms ${JSON.stringify(antwort.ms)}` : antwort.fehler}`);
  expect(antwort.ok).toBe(true);
  if (antwort.flaechen.length > 0) expect(String(antwort.bild).startsWith('data:image/jpeg')).toBe(true);
  else expect(antwort.bild).toBeUndefined();
});

test('Erkenner: Bild als Daten (Data-URL) und Rendern beider Stile', async () => {
  const liste = await testbilder('nsfw');
  brauchtTestbilder(liste, 'nsfw');
  // Das Bild kommt hier als Data-URL aus dem Seitenkontext (wie vom Content-Script), nicht ueber die Adresse.
  const seite = await context.newPage();
  await seite.goto(`${basis}/hello.html`);
  let gerendert = 0;
  try {
    for (const name of liste.slice(0, 6)) {
      const dataUrl = await seite.evaluate(async (adresse) => {
        const blob = await (await fetch(adresse)).blob();
        const bitmap = await createImageBitmap(blob);
        const f = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
        const c = new OffscreenCanvas(Math.round(bitmap.width * f), Math.round(bitmap.height * f));
        c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
        const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        return await new Promise<string>((ok) => {
          const l = new FileReader();
          l.onload = () => ok(String(l.result));
          l.readAsDataURL(out);
        });
      }, `${basis}/testbild/nsfw/${encodeURIComponent(name)}`);
      for (const stil of ['mosaik', 'blur']) {
        const antwort = await ausWorker(worker, {
          ...pruefeNachricht('', { rendern: true }),
          quelle: { art: 'daten', dataUrl },
          einstellungen: { schwelle: 0.1, zonen: alleZonen(), rand: 0.15, stil },
        });
        expect(antwort.ok, antwort.fehler).toBe(true);
        if (antwort.flaechen.length > 0) {
          expect(String(antwort.bild).startsWith('data:image/jpeg')).toBe(true);
          expect(antwort.bild.length).toBeGreaterThan(1000);
          gerendert++;
          if (gerendert <= 2) console.log(`chromium: ${stil} gerendert, ${antwort.flaechen.length} Flaechen, render ${antwort.ms.render} ms`);
        }
      }
    }
  } finally {
    await seite.close();
  }
  expect(gerendert).toBeGreaterThan(0);
});

test('Erkenner: Fehler bleiben Fehler (404, kaputte Adresse), danach laeuft es weiter', async () => {
  const nachricht404 = pruefeNachricht(`${basis}/synthetisch/gibtsnicht.png`);
  const nichtDa = await ausWorker(worker, nachricht404);
  expect(nichtDa.ok).toBe(false);
  expect(nichtDa.status).toBe(404);
  expect(nichtDa.id).toBe(nachricht404.id);
  const kaputt = await ausWorker(worker, pruefeNachricht('ftp://127.0.0.1/x.png'));
  expect(kaputt.ok).toBe(false);
  expect(typeof kaputt.fehler).toBe('string');
  const danach = await ausWorker(worker, pruefeNachricht(`${basis}/synthetisch/3.png`));
  expect(danach.ok).toBe(true);
});

// Sitzungsregeln aufraeumen, damit die Referer-Tests voneinander unabhaengig bleiben.
async function loescheRefererRegeln() {
  await worker.evaluate(async () => {
    const dnr = (globalThis as any).chrome.declarativeNetRequest;
    const alle = await dnr.getSessionRules();
    await dnr.updateSessionRules({ removeRuleIds: alle.map((r: { id: number }) => r.id) });
  });
}

test('Erkenner: Hotlink-Schutz (403 ohne Referer) wird ueber Referer-Regel und Wiederholung geholt', async () => {
  await loescheRefererRegeln();
  try {
    const adresse = `${basis}/synthetisch/5.png?nurReferer=1`;
    // Ohne Referer gibt es nichts zu setzen: die Verweigerung bleibt, mit Status und id.
    const ohne = pruefeNachricht(adresse);
    const abgelehnt = await ausWorker(worker, ohne);
    expect(abgelehnt.ok).toBe(false);
    expect(abgelehnt.status).toBe(403);
    expect(abgelehnt.id).toBe(ohne.id);
    // Mit Referer: erster Abruf 403, Regel gesetzt, Wiederholung klappt.
    const mit = await ausWorker(worker, pruefeNachricht(adresse, { quelle: { art: 'url', url: adresse, referer: `${basis}/` } }));
    expect(mit.ok, mit.fehler).toBe(true);
    expect(mit.breite).toBe(640);
    expect(mit.flaechen).toEqual([]);
    const regeln = await worker.evaluate(() => (globalThis as any).chrome.declarativeNetRequest.getSessionRules());
    expect(regeln).toHaveLength(1);
    expect(regeln[0].action.requestHeaders[0].value).toBe(`${basis}/`);
    // Die Regel gilt jetzt auch fuer weitere Abrufe desselben Hosts ohne eigene Wiederholung.
    const nochmal = await ausWorker(worker, pruefeNachricht(`${basis}/synthetisch/6.png?nurReferer=1`, { quelle: { art: 'url', url: `${basis}/synthetisch/6.png?nurReferer=1`, referer: `${basis}/` } }));
    expect(nochmal.ok, nochmal.fehler).toBe(true);
  } finally {
    await loescheRefererRegeln();
  }
});

test('Erkenner: dauerhaftes 403 bleibt Fehler mit Status und id, danach laeuft es weiter', async () => {
  await loescheRefererRegeln();
  try {
    const adresse = `${basis}/synthetisch/7.png?immer403=1`;
    const n = pruefeNachricht(adresse, { quelle: { art: 'url', url: adresse, referer: `${basis}/` } });
    const antwort = await ausWorker(worker, n);
    expect(antwort.ok).toBe(false);
    expect(antwort.status).toBe(403);
    expect(antwort.id).toBe(n.id);
    expect(typeof antwort.fehler).toBe('string');
    const danach = await ausWorker(worker, pruefeNachricht(`${basis}/synthetisch/8.png`));
    expect(danach.ok).toBe(true);
  } finally {
    await loescheRefererRegeln();
  }
});

test('Erkenner: mehrere Pruefungen gleichzeitig, alle werden beantwortet', async () => {
  const antworten = await Promise.all(
    Array.from({ length: 8 }, (_, i) => ausWorker(worker, pruefeNachricht(`${basis}/synthetisch/${10 + i}.png`))),
  );
  for (const a of antworten) {
    expect(a.ok, a.fehler).toBe(true);
    expect(a.flaechen).toEqual([]);
  }
  expect(new Set(antworten.map((a) => a.id)).size).toBe(8);
  const s = await ausWorker(worker, { ziel: 'erkenner', typ: 'status' });
  expect(s.warteschlange).toBe(0);
});

test('Erkenner: fremder Ursprung ohne CORS wird nachgeladen', async () => {
  const antwort = await ausWorker(worker, pruefeNachricht(`http://127.0.0.1:${portFremd}/synthetisch/4.png`));
  expect(antwort.ok).toBe(true);
  expect(antwort.flaechen).toEqual([]);
});

test('Hintergrund: referer, pause, wecke, fremde Ziele', async () => {
  // Hintergrund-Nachrichten kommen von einer Erweiterungsseite (der Service Worker kann sich nicht selbst erreichen).
  const seite = await context.newPage();
  await seite.goto(`chrome-extension://${erweiterungsId}/popup.html`);
  const senden = (n: unknown) => seite.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
  try {
    expect(await senden({ ziel: 'hintergrund', typ: 'wecke' })).toEqual({ ok: true });

    // Adresse des Tabs: hier ist die Erweiterungsseite selbst der Tab.
    const tab = await senden({ ziel: 'hintergrund', typ: 'tab' });
    expect(tab.ok).toBe(true);
    expect(tab.url).toBe(`chrome-extension://${erweiterungsId}/popup.html`);

    await loescheRefererRegeln();
    // Parallele Referer-Anfragen (verschiedene Hosts): keine darf an einer doppelten Regel-ID scheitern.
    const parallel = await Promise.all(
      Array.from({ length: 12 }, (_, i) => senden({ ziel: 'hintergrund', typ: 'referer', host: `parallel${i}.example.test`, referer: 'https://example.test/' })),
    );
    expect(parallel.every((a: { ok: boolean }) => a.ok === true)).toBe(true);
    const parallelRegeln = await worker.evaluate(() => (globalThis as any).chrome.declarativeNetRequest.getSessionRules());
    expect(parallelRegeln).toHaveLength(12);
    expect(new Set(parallelRegeln.map((r: { id: number }) => r.id)).size).toBe(12);
    await loescheRefererRegeln();

    // Referer: eine Sitzungsregel je Host, gleicher Host ersetzt die Regel.
    const regeln = () => worker.evaluate(() => (globalThis as any).chrome.declarativeNetRequest.getSessionRules());
    expect(await senden({ ziel: 'hintergrund', typ: 'referer', host: `127.0.0.1:${portFremd}`, referer: `${basis}/` })).toEqual({ ok: true });
    expect(await senden({ ziel: 'hintergrund', typ: 'referer', host: `127.0.0.1:${portFremd}`, referer: `${basis}/seite` })).toEqual({ ok: true });
    const nachher = await regeln();
    expect(nachher).toHaveLength(1);
    expect(nachher[0].action.requestHeaders[0].value).toBe(`${basis}/seite`);
    expect(nachher[0].condition.requestDomains).toEqual(['127.0.0.1']);
    const ungueltig = await senden({ ziel: 'hintergrund', typ: 'referer', host: 'x', referer: 'javascript:1' });
    expect(ungueltig.ok).toBe(false);
    // Obergrenze 50 Regeln.
    for (let i = 0; i < 55; i++) {
      await senden({ ziel: 'hintergrund', typ: 'referer', host: `bild${i}.example.test`, referer: 'https://example.test/' });
    }
    expect((await regeln()).length).toBe(50);

    // Pause: umschalten, gezielt setzen, Tastenkuerzel-Weg ist derselbe Pfad (schaltePause).
    expect(await senden({ ziel: 'hintergrund', typ: 'pause', an: true })).toEqual({ ok: true, pause: true });
    const gespeichert = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen?.pause);
    expect(gespeichert).toBe(true);
    expect(await senden({ ziel: 'hintergrund', typ: 'pause' })).toEqual({ ok: true, pause: false });
    expect(await senden({ ziel: 'hintergrund', typ: 'pause', an: false })).toEqual({ ok: true, pause: false });

    // Unbekannter Typ und fremdes Ziel: keine Antwort (undefined statt Fehlerobjekt).
    const unbekannt = await senden({ ziel: 'hintergrund', typ: 'gibtsnicht' }).catch(() => undefined);
    expect(unbekannt).toBeUndefined();
    const fremd = await senden({ ziel: 'inhalt', typ: 'wecke' }).catch(() => undefined);
    expect(fremd).toBeUndefined();
  } finally {
    await seite.close();
  }
});
