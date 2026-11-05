// Chromium: Auftrag L (PHASE-6-AUFTRAEGE-SESSION-11 Abschnitt 5), Mia’s Ledger. Gemessen wird: ein verdecktes Bild ergibt nach dem Senden
// `zensiert >= 1` (im Testbau kein Zeitgeber), der Zeitgeber fasst Ereignisse zu einer Nachricht zusammen, Tageswechsel, Pruefung der Werte
// und Absender, Erwachsenen-Minute einmal je Minute, hoechste Stufe, Popup-Zeile, Einstellungsseite mit Loeschen und Rueckfrage.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_TITEL, LOESCHEN_FERTIG, LOESCHEN_FRAGE, ZAEHLER_NAMEN, popupZeile, stufeWert } from '../../src/ledger/texte';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const seite = `http://127.0.0.1:${port}/ledger.html`;

interface Stand { seit: number; tag: string; heute: Record<string, number>; gesamt: Record<string, number>; hoechsteStufe: number }
test.describe.configure({ mode: 'serial' });

let profil: string;
let context: BrowserContext;
let worker: Worker;
let id = '';
const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-ledger-'));
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
  if (profil) await rm(profil, { recursive: true, force: true });
});

const lies = <T>(k: string) => worker.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as any)[k] as T, k);
const schreibe = (k: string, w: unknown) => worker.evaluate(async ([k, w]) => (globalThis as any).chrome.storage.local.set({ [k as string]: w }), [k, w] as const);
const ledger = () => lies<Stand>('ledger');
const setzeEinstellungen = (n: Record<string, unknown>) =>
  worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, n);

// Nachricht von einer Erweiterungsseite (Einstellungsseite) an den Hintergrund.
async function vonOptionen<T>(nachricht: object): Promise<T> {
  const p = await context.newPage();
  try {
    await p.goto(`chrome-extension://${id}/options.html`);
    return await p.evaluate((n) => (globalThis as any).chrome.runtime.sendMessage(n), nachricht);
  } finally {
    await p.close();
  }
}
const loesche = () => vonOptionen<{ ok: boolean }>({ ziel: 'hintergrund', typ: 'ledger-loeschen' });
const minute = (erwachsen: boolean) => vonOptionen<unknown>({ ziel: 'hintergrund', typ: 'steigerung-minute', erwachsen, zensiert: 0 });

async function oeffne(mitBild = false): Promise<Page> {
  const p = await context.newPage();
  await p.goto(mitBild ? seite : `${seite}?ohne`);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-veil-ledger'));
  return p;
}
const test_ = (p: Page, ledger: object) => p.evaluate((l) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ledger: l }) })), ledger);
const abbild = (p: Page): Promise<any> => p.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-veil-ledger') ?? 'null'));

test('Start: es gibt einen Stand mit seit, Tag und Nullen', async () => {
  await loesche();
  const l = await ledger();
  expect(l.seit).toBeGreaterThan(0);
  expect(l.tag).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Object.values(l.gesamt).every((v) => v === 0)).toBe(true);
  console.log(`chromium ledger: Stand da, seit ${new Date(l.seit).toISOString().slice(0, 10)}, ${Object.keys(l.gesamt).length} Zaehler`);
});

test('verdecktes Bild: zensiert >= 1 nach dem Senden, vorher nichts (kein Zeitgeber im Testbau)', async () => {
  test.setTimeout(90_000);
  if (!existsSync(path.join(wurzel, '..', '05 Testbilder', 'nsfw', 'IMG_0260.jpg'))) {
    if (process.env.VEIL_OHNE_TESTBILDER === '1') return;
    throw new Error('braucht ../05 Testbilder/nsfw/IMG_0260.jpg');
  }
  await loesche();
  const p = await oeffne(true);
  await p.waitForFunction(() => document.getElementById('bild')?.getAttribute('data-veil') === 'zensiert', null, { timeout: 60_000 });
  await abwarten(1500);
  expect((await ledger()).gesamt.zensiert).toBe(0);
  expect((await abbild(p)).nachrichten).toBe(0);
  await test_(p, { senden: true });
  await expect.poll(async () => (await ledger()).gesamt.zensiert, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  const l = await ledger();
  expect(l.heute.zensiert).toBe(l.gesamt.zensiert);
  console.log(`chromium ledger: zensiert heute ${l.heute.zensiert}, gesamt ${l.gesamt.zensiert} nach dem Senden`);
  await p.close();
});

test('Ereignisse: jede Art zaehlt in ihren Zaehler (sofort gesendet)', async () => {
  await loesche();
  const p = await oeffne();
  const arten: Array<[object, string, number]> = [
    [{ art: 'zensiert' }, 'zensiert', 1], [{ art: 'quiz-richtig' }, 'quizGeloest', 1], [{ art: 'quiz-falsch' }, 'quizFalsch', 1],
    [{ art: 'quiz-verweigert' }, 'quizVerweigert', 1], [{ art: 'werbung' }, 'werbung', 1], [{ art: 'blitz', woerter: 4 }, 'blitzwoerter', 4],
    [{ art: 'spirale' }, 'spiralen', 1], [{ art: 'besuch' }, 'besuche', 1],
  ];
  for (const [e, z, n] of arten) {
    const vorher = (await ledger()).gesamt[z]!;
    await test_(p, { ereignis: e });
    await expect.poll(async () => (await ledger()).gesamt[z], { timeout: 10_000 }).toBe(vorher + n);
  }
  await test_(p, { ereignis: { art: 'quiz-start' } });
  await abwarten(500);
  const l = await ledger();
  expect(Object.values(l.gesamt).reduce((a, b) => a + b, 0)).toBe(arten.reduce((a, x) => a + x[2], 0));
  console.log(`chromium ledger: ${arten.length} Arten gezaehlt, Summe ${Object.values(l.gesamt).reduce((a, b) => a + b, 0)}, quiz-start zaehlt nicht`);
  await p.close();
});

test('Zeitgeber: drei Ereignisse, eine Nachricht, erst nach dem Abstand', async () => {
  await loesche();
  const p = await oeffne();
  await test_(p, { takt: 1500, ereignis: { art: 'spirale' } });
  await test_(p, { takt: 1500, ereignis: { art: 'spirale' } });
  await test_(p, { takt: 1500, ereignis: { art: 'spirale' } });
  await abwarten(600);
  expect((await ledger()).gesamt.spiralen).toBe(0);
  await expect.poll(async () => (await ledger()).gesamt.spiralen, { timeout: 8000 }).toBe(3);
  const ab = await abbild(p);
  expect(ab.nachrichten).toBe(1);
  expect(ab.letzte.spiralen).toBe(3);
  expect(ab.gesendetMs - ab.ersteMs).toBeGreaterThanOrEqual(1450);
  console.log(`chromium ledger: 3 Ereignisse in 1 Nachricht, ${Math.round(ab.gesendetMs - ab.ersteMs)} ms nach dem ersten Ereignis (Zeitgeber 1500 ms)`);
  await p.close();
});

test('Tageswechsel: heute auf 0, gesamt bleibt', async () => {
  const alt = await ledger();
  await schreibe('ledger', { ...alt, tag: '2020-01-01', heute: { ...alt.heute, zensiert: 5 }, gesamt: { ...alt.gesamt, zensiert: 5 } });
  const p = await oeffne();
  await test_(p, { ereignis: { art: 'besuch' } });
  await expect.poll(async () => (await ledger()).tag, { timeout: 10_000 }).not.toBe('2020-01-01');
  const l = await ledger();
  expect(l.heute.zensiert).toBe(0);
  expect(l.gesamt.zensiert).toBe(5);
  expect(l.heute.besuche).toBe(1);
  console.log(`chromium ledger: neuer Tag ${l.tag}, heute zensiert ${l.heute.zensiert}, gesamt ${l.gesamt.zensiert}`);
  await p.close();
});

test('Absender und Werte: Content-Script darf nicht loeschen, Erweiterungsseite keine Summe, Unsinn abgelehnt', async () => {
  await loesche();
  const p = await oeffne();
  const roh = async (nachricht: object) => {
    await test_(p, { roh: nachricht });
    await p.waitForFunction(() => JSON.parse(document.documentElement.getAttribute('data-veil-ledger') ?? '{}').rohAntwort !== 'wartet' , null, { timeout: 5000 });
    await abwarten(100);
    return (await abbild(p)).rohAntwort;
  };
  await schreibe('ledger', { ...(await ledger()), gesamt: { ...(await ledger()).gesamt, besuche: 7 } });
  const a1 = await roh({ ziel: 'hintergrund', typ: 'ledger-loeschen' });
  expect(a1.ok).toBe(false);
  expect((await ledger()).gesamt.besuche).toBe(7);
  const a2 = await roh({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: 10_001 } });
  const a3 = await roh({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: -3 } });
  const a4 = await roh({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: 1.5 } });
  expect([a2.ok, a3.ok, a4.ok]).toEqual([false, false, false]);
  const a5 = await roh({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: 2, fremd: 9, erwachsenMinuten: 99 } });
  expect(a5.ok).toBe(true);
  let l = await ledger();
  expect(l.gesamt.zensiert).toBe(2);
  expect(l.gesamt.erwachsenMinuten).toBe(0);
  expect(JSON.stringify(l)).not.toContain('fremd');
  const von = await vonOptionen<{ ok: boolean }>({ ziel: 'hintergrund', typ: 'ledger', plus: { zensiert: 5 } });
  expect(von.ok).toBe(false);
  expect((await ledger()).gesamt.zensiert).toBe(2);
  console.log('chromium ledger: Loeschen aus Content abgelehnt, 3 Unsinn-Summen abgelehnt, Summe aus Erweiterungsseite abgelehnt, 2 gezaehlt');
  await p.close();
});

test('Minute auf Erwachsenenseiten: einmal je Uhr-Minute, nicht in der Pause; hoechste Stufe nur nach oben', async () => {
  await loesche();
  await schreibe('ledgerMinute', -1);
  // Beide Meldungen in derselben Uhr-Minute abwarten
  for (let i = 0; i < 3; i++) {
    const m0 = Math.floor(Date.now() / 60_000);
    await minute(true);
    await minute(true);
    if (Math.floor(Date.now() / 60_000) === m0) break;
    await loesche();
    await schreibe('ledgerMinute', -1);
  }
  expect((await ledger()).gesamt.erwachsenMinuten).toBe(1);
  expect((await ledger()).heute.erwachsenMinuten).toBe(1);
  await minute(false);
  expect((await ledger()).gesamt.erwachsenMinuten).toBe(1);
  await schreibe('ledgerMinute', -1);
  await setzeEinstellungen({ pause: true });
  await minute(true);
  expect((await ledger()).gesamt.erwachsenMinuten).toBe(1);
  await setzeEinstellungen({ pause: false });
  const stand = (stufe: number) => ({ version: 1, stufe, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null });
  await schreibe('steigerung', stand(3));
  await minute(false);
  expect((await ledger()).hoechsteStufe).toBe(3);
  await schreibe('steigerung', stand(1));
  await minute(false);
  expect((await ledger()).hoechsteStufe).toBe(3);
  console.log('chromium ledger: 2 Meldungen in einer Minute ergeben 1, Pause 0, hoechste Stufe 3 bleibt bei Stufe 1');
});

test('Verlassen der Seite sendet den Puffer (Zeitgeber steht auf 60 s)', async () => {
  await loesche();
  const p = await oeffne();
  await test_(p, { takt: 60_000, ereignis: { art: 'besuch' } });
  const a = await abbild(p);
  expect(a.gepuffert).toBe(true);
  expect(a.nachrichten).toBe(0);
  await abwarten(500);
  expect((await ledger()).gesamt.besuche).toBe(0);
  const t0 = Date.now();
  await p.goto('about:blank');
  await expect.poll(async () => (await ledger()).gesamt.besuche, { timeout: 10_000 }).toBe(1);
  console.log(`chromium ledger: Puffer beim Verlassen der Seite nach ${Date.now() - t0} ms gesendet (Zeitgeber 60000 ms)`);
  await p.close();
});

test('Zwei Seiten gleichzeitig: 2 x 20 Nachrichten ergeben genau 40', async () => {
  await loesche();
  const [p1, p2] = [await oeffne(), await oeffne()];
  const viele = (p: Page) =>
    p.evaluate(() => {
      for (let i = 0; i < 20; i++) document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ledger: { ereignis: { art: 'besuch' } } }) }));
    });
  await Promise.all([viele(p1), viele(p2)]);
  await expect.poll(async () => (await ledger()).gesamt.besuche, { timeout: 15_000 }).toBe(40);
  await abwarten(500);
  const l = await ledger();
  expect(l.gesamt.besuche).toBe(40);
  expect(l.heute.besuche).toBe(40);
  console.log(`chromium ledger: 2 Seiten x 20 Nachrichten, gesamt ${l.gesamt.besuche}, heute ${l.heute.besuche}`);
  await p1.close();
  await p2.close();
});

test('Neustart des Service Workers zwischen zwei Meldungen: trotzdem nur 1 Minute', async () => {
  test.setTimeout(60_000);
  for (let i = 0; i < 3; i++) {
    await loesche();
    await schreibe('ledgerMinute', -1);
    const m0 = Math.floor(Date.now() / 60_000);
    await minute(true);
    const seite = await context.newPage();
    const cdp = await context.newCDPSession(seite);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await abwarten(500);
    await seite.close();
    await minute(true); // weckt den Service Worker neu
    const neu = context.serviceWorkers();
    worker = neu[neu.length - 1] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    if (Math.floor(Date.now() / 60_000) === m0) break;
  }
  const l = await ledger();
  expect(l.gesamt.erwachsenMinuten).toBe(1);
  console.log(`chromium ledger: nach Neustart des Service Workers erwachsenMinuten ${l.gesamt.erwachsenMinuten} (2 Meldungen, 1 Uhr-Minute)`);
});

test('Popup: eine Zeile mit den heute zugedeckten Bildern, auch bei 0', async () => {
  await loesche();
  const p = await context.newPage();
  await p.goto(`chrome-extension://${id}/popup.html`);
  await expect(p.locator('#ledger-kurz')).toHaveText(popupZeile(0));
  const l = await ledger();
  await schreibe('ledger', { ...l, heute: { ...l.heute, zensiert: 34 }, gesamt: { ...l.gesamt, zensiert: 34 } });
  await expect(p.locator('#ledger-kurz')).toHaveText(popupZeile(34));
  console.log(`chromium ledger: Popup-Zeile "${await p.locator('#ledger-kurz').textContent()}"`);
  await p.close();
});

test('Einstellungsseite: Zahlen, Mias Saetze, Loeschen mit Rueckfrage', async () => {
  await loesche();
  const l = await ledger();
  await schreibe('ledger', { ...l, hoechsteStufe: 2, heute: { ...l.heute, zensiert: 12 }, gesamt: { ...l.gesamt, zensiert: 340, besuche: 3 } });
  const p = await context.newPage();
  await p.goto(`chrome-extension://${id}/options.html`);
  await expect(p.locator('#ledger-titel')).toHaveText(LEDGER_TITEL);
  await expect(p.locator('#ledger')).toHaveAttribute('aria-labelledby', 'ledger-titel');
  await expect(p.locator('#ledger-heute-zensiert')).toHaveText('12');
  await expect(p.locator('#ledger-gesamt-zensiert')).toHaveText('340');
  await expect(p.locator('#ledger-gesamt-besuche')).toHaveText('3');
  await expect(p.locator('#ledger-stufe')).toHaveText(stufeWert(2));
  await expect(p.locator('#ledger-zeile-zensiert .ledger-name')).toHaveText(ZAEHLER_NAMEN.zensiert);
  expect(((await p.locator('#ledger-satz-zensiert').textContent()) ?? '').length).toBeGreaterThan(5);
  expect(await p.locator('#ledger-seit').textContent()).toContain('With me since');
  // folgt dem Speicher
  await schreibe('ledger', { ...(await ledger()), gesamt: { ...(await ledger()).gesamt, zensiert: 341 } });
  await expect(p.locator('#ledger-gesamt-zensiert')).toHaveText('341');
  // Rueckfrage: Nein behaelt, Ja loescht
  await expect(p.locator('#ledger-frage')).toBeHidden();
  await p.locator('#ledger-loeschen').click();
  await expect(p.locator('#ledger-frage')).toBeVisible();
  await expect(p.locator('#ledger-frage-text')).toHaveText(LOESCHEN_FRAGE);
  await p.locator('#ledger-nein').click();
  await expect(p.locator('#ledger-frage')).toBeHidden();
  expect((await ledger()).gesamt.zensiert).toBe(341);
  const vorher = Date.now();
  await p.locator('#ledger-loeschen').click();
  await p.locator('#ledger-ja').click();
  await expect(p.locator('#ledger-meldung')).toHaveText(LOESCHEN_FERTIG);
  const nach = await ledger();
  expect(Object.values(nach.gesamt).every((v) => v === 0) && Object.values(nach.heute).every((v) => v === 0) && nach.hoechsteStufe === 0).toBe(true);
  expect(nach.seit).toBeGreaterThanOrEqual(vorher - 2000);
  await expect(p.locator('#ledger-gesamt-zensiert')).toHaveText('0');
  console.log('chromium ledger: Nein behielt 341, Ja setzte alle 9 Zaehler und die Stufe auf 0');
  await p.close();
});
