// Einheitstests Fenster-Schnittstelle mit Rueckfall (Auftrag F, Session 14): ohne `browser.windows` (Android) gilt fokussiert und kein Vollbild,
// die Helfer werfen nie. Der `browser` wird nachgebaut.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registerHooks } from 'node:module';
import { fensterLage, fensterNachVorn, nebenTabEigenschaften } from '../../src/fenster.ts';

afterEach(() => {
  delete globalThis.browser;
  delete globalThis.chrome;
});

test('ohne browser.windows (Android): fokussiert, kein Vollbild, Nach-vorn tut nichts und wirft nie', async () => {
  globalThis.browser = { tabs: {} };
  assert.deepEqual(await fensterLage(7), { fokus: true, vollbild: false });
  assert.deepEqual(await fensterLage(undefined), { fokus: true, vollbild: false });
  assert.equal(await fensterNachVorn(7), undefined);
  delete globalThis.browser;
  assert.deepEqual(await fensterLage(7), { fokus: true, vollbild: false });
  assert.equal(await fensterNachVorn(7), undefined);
});

test('mit browser.windows: Lage aus dem Browser, Vollbild erkannt', async () => {
  const aufrufe = [];
  globalThis.browser = {
    windows: {
      get: async (id) => (id === 1 ? { focused: true, state: 'normal' } : id === 2 ? { focused: false, state: 'fullscreen' } : { focused: true, state: 'fullscreen' }),
      update: async (id, info) => void aufrufe.push([id, info]),
    },
  };
  assert.deepEqual(await fensterLage(1), { fokus: true, vollbild: false });
  assert.deepEqual(await fensterLage(2), { fokus: false, vollbild: true });
  assert.deepEqual(await fensterLage(3), { fokus: true, vollbild: true });
  await fensterNachVorn(1);
  assert.deepEqual(aufrufe, [[1, { focused: true }]]);
});

test('Fehler beim Fenster: Helfer werfen nie, Lage gilt als nicht fokussiert', async () => {
  globalThis.browser = {
    windows: {
      get: async () => { throw new Error('No window with id'); },
      update: async () => { throw new Error('No window with id'); },
    },
  };
  assert.deepEqual(await fensterLage(9), { fokus: false, vollbild: false });
  assert.deepEqual(await fensterLage(undefined), { fokus: false, vollbild: false });
  await assert.doesNotReject(fensterNachVorn(9));
  await assert.doesNotReject(fensterNachVorn(undefined));
  globalThis.browser = { windows: { get: () => { throw new Error('sync'); }, update: () => { throw new Error('sync'); } } };
  assert.deepEqual(await fensterLage(9), { fokus: false, vollbild: false });
  await assert.doesNotReject(fensterNachVorn(9));
});

test('chrome.windows als Rueckfall, wenn kein browser da ist', async () => {
  globalThis.chrome = { windows: { get: async () => ({ focused: false, state: 'normal' }) } };
  assert.deepEqual(await fensterLage(4), { fokus: false, vollbild: false });
});

test('Besuch auf Android: Tab bleibt bekannt, die Lage aus fensterLage lehnt den Besuch nicht mit kein-tab ab', async () => {
  const { besuchAblehnung } = await import('../../src/besuche/plan.ts');
  globalThis.browser = { tabs: {} };
  const lage = await fensterLage(5);
  const tab = { id: 1, active: true, windowId: 5 };
  const grund = besuchAblehnung({
    frameNull: true, tabBekannt: typeof tab.windowId === 'number', packFrei: true, schalterAn: true, pause: false, ausnahme: false,
    tabAktiv: tab.active === true, fensterFokus: lage.fokus, fensterVollbild: lage.vollbild, zuletzt: null, jetzt: 1_800_000_000_000,
  });
  assert.equal(grund, null);
});

// Nur im Test: Importe ohne Dateiendung (wie im WXT-Bau) bekommen `.ts`, der Produktcode bleibt unveraendert.
registerHooks({
  resolve(s, c, next) {
    try {
      return next(s, c);
    } catch (e) {
      if (/^\.{1,2}\//.test(s) && !/\.\w+$/.test(s)) return next(`${s}.ts`, c);
      throw e;
    }
  },
});

test('Einstieg ohne browser.windows: bekannter Willkommens-Tab wird aktiviert, tabs.create wird nie gerufen', async () => {
  const { zeigeWillkommen, WILLKOMMEN_KANAL } = await import('../../src/einstieg/speicher.ts');
  const erzeugt = [];
  globalThis.browser = {
    tabs: { update: async (id) => ({ id, windowId: 3 }), create: async (o) => (erzeugt.push(o), { id: 99 }) },
    runtime: { getURL: (p) => `moz-extension://x${p}` },
  };
  const tab = new BroadcastChannel(WILLKOMMEN_KANAL);
  tab.onmessage = () => tab.postMessage({ tabId: 42 });
  const id = await zeigeWillkommen();
  tab.close();
  assert.equal(id, 42);
  assert.equal(erzeugt.length, 0);
});

test('Neuer Tab neben dem Absender: ohne browser.windows weder openerTabId noch windowId noch index, mit Fenster wie bisher', async () => {
  // tabs.create wie Firefox Android: wirft bei openerTabId.
  const create = async (p) => {
    if ('openerTabId' in p) throw new Error('Property "openerTabId" is unsupported by Firefox');
    return { id: 5 };
  };
  const absender = { tabId: 1, windowId: 2, index: 3 };
  globalThis.browser = { tabs: { create } };
  const android = nebenTabEigenschaften('https://x.test/', absender);
  assert.deepEqual(android, { url: 'https://x.test/', active: true });
  assert.deepEqual(await globalThis.browser.tabs.create(android), { id: 5 });
  globalThis.browser = { tabs: { create }, windows: { get: async () => ({ focused: true }) } };
  assert.deepEqual(nebenTabEigenschaften('https://x.test/', absender), { url: 'https://x.test/', active: true, windowId: 2, index: 4, openerTabId: 1 });
  assert.deepEqual(nebenTabEigenschaften('u', { tabId: 1, windowId: 2 }), { url: 'u', active: true, windowId: 2, openerTabId: 1 });
});
