// Chromium: Phase 4, Auftrag S (Steigerung der Zensur, PHASE-4-BAUPLAN Abschnitt 9). Hintergrund zaehlt Minuten nur mit Freischaltung,
// Pause zaehlt nicht und haelt den Abbau an, Uhr vorstellen (Testhaken) senkt die Stufe, die Seite meldet ihre Minute, und eine hoehere
// Stufe schaltet beim Erkenner die Gesichtszonen an (YuNet-Laeufe steigen). Pack wird nur als Kurzfassung in storage.local gestellt.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABBAU_MS, wirksameStufe, vervollstaendigeStand } from '../../src/steigerung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);

let profil = '';
let context: BrowserContext;
let id = '';
let ext: Page;

const pack = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 0, vorschau: 0, chibis: 0, groesse: 1, importiert: 1 });
const lies = (k: string) => ext.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (o: Record<string, unknown>) => ext.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const sende = (n: Record<string, unknown>) => ext.evaluate((n) => (globalThis as any).chrome.runtime.sendMessage(n), { ziel: 'hintergrund', ...n });
const minute = (erwachsen: boolean, zensiert = 0) => sende({ typ: 'steigerung-minute', erwachsen, zensiert }) as Promise<{ gezaehlt?: boolean }>;
const uhrVor = (vorMs: number) => sende({ typ: 'steigerung-uhr', vorMs });
async function aendereEinstellungen(teil: Record<string, unknown>): Promise<void> {
  await ext.evaluate(async (teil) => {
    const c = (globalThis as any).chrome;
    const alt = ((await c.storage.local.get('einstellungen')) as Record<string, any>).einstellungen ?? {};
    await c.storage.local.set({ einstellungen: { ...alt, ...teil } });
  }, teil);
}

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-steigerung-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
  ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/options.html`);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test('a) ohne Freischaltung zaehlt keine Minute', async () => {
  await ext.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'steigerung']));
  expect((await minute(true)).gezaehlt).toBe(false);
  await schreibe({ pack: pack(['erwachsen:vorschau']) });
  expect((await minute(true)).gezaehlt).toBe(false);
  expect(await lies('steigerung')).toBeUndefined();
});

test('b) 15 gezaehlte Minuten heben auf Stufe 1, 12 Stunden ohne Zensur senken wieder', async () => {
  await schreibe({ pack: pack(['zensur:steigerung']) });
  await ext.evaluate(() => (globalThis as any).chrome.storage.local.remove('steigerung'));
  expect((await minute(false, 2)).gezaehlt).toBe(false); // unter 3 neuen Urteilen zensiert
  // Zwei Fenster melden gleichzeitig: genau eine Minute zaehlt (Kette im Hintergrund).
  const zwei = await Promise.all([minute(true), minute(true)]);
  expect(zwei.filter((a) => a.gezaehlt).length).toBe(1);
  await uhrVor(60_000);
  await ext.evaluate(() => (globalThis as any).chrome.storage.local.remove('steigerung'));
  for (let i = 0; i < 15; i++) {
    expect((await minute(i % 2 === 0, 3)).gezaehlt).toBe(true);
    expect((await minute(true)).gezaehlt).toBe(false); // dieselbe Uhr-Minute zaehlt nur einmal
    await uhrVor(60_000);
  }
  const s = vervollstaendigeStand(await lies('steigerung'));
  expect(s.stufe).toBe(1);
  expect(s.naechsterAnstiegNach).toBeGreaterThanOrEqual(10);
  expect(s.naechsterAnstiegNach).toBeLessThanOrEqual(20);
  expect(wirksameStufe(s, Date.now())).toBe(1);
  await uhrVor(ABBAU_MS);
  expect(wirksameStufe(vervollstaendigeStand(await lies('steigerung')), Date.now())).toBe(0);
  expect(await lies('steigerungUhrVor')).toBe(ABBAU_MS);
});

test('c) Pause zaehlt keine Minute und haelt den Abbau an', async () => {
  await schreibe({ pack: pack(['zensur:steigerung']), steigerung: { version: 1, stufe: 2, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null } });
  await aendereEinstellungen({ pause: true });
  await expect.poll(async () => (await lies('steigerung'))?.pauseSeit).not.toBeNull();
  expect((await minute(true)).gezaehlt).toBe(false);
  await uhrVor(3 * ABBAU_MS); // auch weit vorgestellt: in der Pause steht der Abbau
  expect(wirksameStufe(vervollstaendigeStand(await lies('steigerung')), Date.now())).toBe(2);
  await aendereEinstellungen({ pause: false });
  await expect.poll(async () => (await lies('steigerung'))?.pauseSeit).toBeNull();
  expect(wirksameStufe(vervollstaendigeStand(await lies('steigerung')), Date.now())).toBe(2);
});

test('d) die Seite meldet ihre Minute, eine hoehere Stufe schaltet Gesichtszonen an', async () => {
  const stand0 = { version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: 0, letzteMinute: -1, pauseSeit: null };
  await schreibe({ pack: pack(['zensur:steigerung']), steigerung: stand0 });
  await aendereEinstellungen({ pause: false, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } });
  const seite = await context.newPage();
  try {
    await seite.goto(`http://127.0.0.1:${port}/steigerung.html?veil-steigerung-takt=400`);
    // Meldung der Seite: 127.0.0.1 steht bei den eigenen Seiten, die Minute zaehlt.
    await expect.poll(async () => (await lies('steigerung'))?.minutenSeitAnstieg ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await expect(seite.locator('#bild')).toHaveAttribute('data-veil', /frei|zensiert|verdeckt/, { timeout: 20_000 });
    let nr = 0;
    const laeufe = async (): Promise<number> => {
      const n = ++nr;
      await seite.evaluate((n) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ erkennerStatus: n }) })), n);
      await expect.poll(async () => JSON.parse((await seite.locator('html').getAttribute('data-veil-erkenner')) ?? '{}').nr).toBe(n);
      return JSON.parse((await seite.locator('html').getAttribute('data-veil-erkenner')) ?? '{}').antwort?.gesichtLaeufe ?? -1;
    };
    const vorher = await laeufe();
    await seite.waitForTimeout(1500);
    expect(await laeufe()).toBe(vorher); // Stufe 0: Gesichtszonen aus, YuNet laeuft nicht
    // Negativfaelle: Stufe 2 im Stand, aber Pack ohne Freischaltung bzw. ohne Pack: YuNet laeuft nicht.
    const stufe2 = { version: 1, stufe: 2, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null };
    await schreibe({ pack: pack(['erwachsen:vorschau']), steigerung: stufe2 });
    await seite.waitForTimeout(1500);
    expect(await laeufe()).toBe(vorher);
    await ext.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    await seite.waitForTimeout(1500);
    expect(await laeufe()).toBe(vorher);
    await schreibe({ pack: pack(['zensur:steigerung']), steigerung: stand0 });
    await seite.waitForTimeout(1000);
    // Stufe 2: Gesicht, Augen, Mund an; die Seite prueft neu und YuNet laeuft.
    await schreibe({ steigerung: { version: 1, stufe: 2, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null } });
    await expect.poll(laeufe, { timeout: 20_000 }).toBeGreaterThan(vorher);
  } finally {
    await seite.close();
  }
});

// Stufe 4: ein Bild mit einer Frau wird ganz verdeckt (eine Flaeche ueber das ganze Bild), ohne `ganzVerdecken` nur die Zonen.
// Braucht ein Testbild aus ../05 Testbilder (nicht im Repo); ohne Testbilder mit VEIL_OHNE_TESTBILDER=1 laut uebersprungen.
test('e) Stufe 4: Bild mit einer Frau wird ganz verdeckt', async () => {
  const datei = path.join(wurzel, '..', '05 Testbilder', 'nsfw', 'IMG_0260.jpg');
  if (!existsSync(datei)) {
    if (process.env.VEIL_OHNE_TESTBILDER === '1') {
      console.log('chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Stufe-4-Test uebersprungen');
      return;
    }
    throw new Error('Stufe-4-Test braucht ../05 Testbilder/nsfw/IMG_0260.jpg');
  }
  const dataUrl = `data:image/jpeg;base64,${(await readFile(datei)).toString('base64')}`;
  const zonen = { eyes: { an: false }, mouth: { an: false }, face: { an: false }, head: { an: false }, breast: { an: false, bedeckt: false },
    genitals: { an: false, bedeckt: false }, buttocks: { an: false, bedeckt: false }, belly: { an: false, bedeckt: false },
    feet: { an: true, bedeckt: false }, armpits: { an: false, bedeckt: false } };
  const gesicht = { ...zonen, face: { an: true }, eyes: { an: true }, mouth: { an: true } };
  const pruefe = (ganzVerdecken: boolean, mitGesicht = false) =>
    ext.evaluate(
      ({ dataUrl, zonen, ganzVerdecken }) =>
        (globalThis as any).chrome.runtime.sendMessage({
          ziel: 'erkenner', typ: 'pruefe', id: `s4-${ganzVerdecken}`, quelle: { art: 'daten', dataUrl }, breite: 0, hoehe: 0, rendern: false,
          einstellungen: { schwelle: 0.1, zonen, rand: 0, stil: 'mosaik', ...(ganzVerdecken ? { ganzVerdecken: true } : {}) },
        }),
      { dataUrl, zonen: mitGesicht ? gesicht : zonen, ganzVerdecken },
    ) as Promise<{ ok: boolean; breite: number; hoehe: number; treffer: { weiblich?: boolean }[]; flaechen: { box: number[] }[] }>;
  const ohne = await expect.poll(async () => (await pruefe(false)).ok, { timeout: 30_000 }).toBe(true).then(() => pruefe(false));
  expect(ohne.treffer.some((t) => t.weiblich)).toBe(true);
  expect(ohne.flaechen.every((f) => f.box[2]! * f.box[3]! < ohne.breite * ohne.hoehe)).toBe(true);
  const mit = await pruefe(true);
  expect(mit.flaechen).toHaveLength(1);
  expect(mit.flaechen[0]!.box).toEqual([0, 0, mit.breite, mit.hoehe]);
  // Mit den Gesichtszonen der Stufen 2 und 3 (YuNet ersetzt das 320n-Gesicht): weiterhin ganz verdeckt.
  const mitGesicht = await pruefe(true, true);
  expect(mitGesicht.flaechen).toHaveLength(1);
  expect(mitGesicht.flaechen[0]!.box).toEqual([0, 0, mitGesicht.breite, mitGesicht.hoehe]);
  console.log(`chromium: Stufe 4 ganz verdeckt (${mit.breite} x ${mit.hoehe}), ohne Stufe 4 ${ohne.flaechen.length} Flaechen`);
});
