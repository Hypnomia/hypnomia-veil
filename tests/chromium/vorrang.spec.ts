import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PHASE-3-BAUPLAN Auftrag D+V: (D4) Deckkraft der Seite bleibt nach dem Urteil erhalten, Hide-first gilt nur ohne Urteil;
// (V4) die Warteschlange prueft in fuenf Vorrang-Stufen. Alle Bilder sind synthetisch (Fixtures deckkraft.html, vorrang.html), keine Testbilder noetig.
// Testhaken (nur Testbau, Ereignis veil-test): warteschlangeHalt haelt die Warteschlange an, pruefVerzoegerungMs macht den Erkenner langsam.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;

let profil: string;
let context: BrowserContext;
let worker: Worker;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-vorrang-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.remove('einstellungen');
  });
});

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

const setzeTest = (seite: Page, detail: Record<string, unknown>) =>
  seite.evaluate((d) => void document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), detail);
const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- D4: Deckkraft ----------

interface Stil {
  v: string | null;
  opacity: string;
  filter: string;
}

// Elemente der Seite (Id im Dokument) und der Shadow Root (Ids mit s-).
const stil = (seite: Page, id: string): Promise<Stil> =>
  seite.evaluate((i) => {
    const el = (document.getElementById(i) ?? (window as any).wurzel.getElementById(i)) as HTMLElement;
    const st = getComputedStyle(el);
    return { v: el.getAttribute('data-veil'), opacity: st.opacity, filter: st.filter };
  }, id);

const MIT_URTEIL = ['x-img', 'x-div', 'einblenden', 'offen', 'halb', 'wechsel', 'leer', 's-stumm', 's-halb', 's-offen', 's-leer', 's-wechsel', 'fremd-leer', 'fremd-x', 'fremd-frei'];

async function oeffneDeckkraft(abfrage = ''): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(`${basis}/deckkraft.html${abfrage}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.deckkraftBereit ?? null), { timeout: 10_000 }).toBe('1');
  return seite;
}

async function warteAufUrteile(seite: Page) {
  await expect
    .poll(async () => (await Promise.all(MIT_URTEIL.map((i) => stil(seite, i)))).every((s) => s.v !== null), { timeout: 40_000, intervals: [100] })
    .toBe(true);
}

test('Aufwaermen: der Erkenner antwortet (erstes Laden des Modells)', async () => {
  test.setTimeout(90_000);
  const seite = await oeffneDeckkraft();
  await warteAufUrteile(seite);
  await seite.close();
});

test('D4 a) X-Muster: img mit Seiten-Deckkraft 0 bleibt nach der Freigabe bei 0, das Nachbar-div mit Inline-Hintergrund ist 1', async () => {
  const seite = await oeffneDeckkraft();
  await warteAufUrteile(seite);
  const img = await stil(seite, 'x-img');
  const div = await stil(seite, 'x-div');
  console.log(`chromium D4a: img ${JSON.stringify(img)}, div ${JSON.stringify(div)}`);
  expect(img.v).toBe('frei');
  expect(img.opacity).toBe('0');
  expect(div.v).toMatch(/^(frei|zensiert)$/);
  expect(div.opacity).toBe('1');
  // Seitenregel mit opacity 1 und 0,5 bleibt ebenfalls, wie die Seite sie festlegt.
  expect((await stil(seite, 'offen')).opacity).toBe('1');
  expect((await stil(seite, 'halb')).opacity).toBe('0.5');
  await seite.close();
});

test('D4 b) Einblenden: die Seite setzt spaeter eine Klasse von 0 auf 1, Ergebnis 1', async () => {
  const seite = await oeffneDeckkraft();
  await warteAufUrteile(seite);
  // Urteil da, aber die Seite blendet noch nicht ein: es bleibt 0 (nichts erzwingt 1).
  expect(await stil(seite, 'einblenden')).toMatchObject({ v: 'frei', opacity: '0' });
  await seite.evaluate(() => (window as any).einblenden());
  await expect.poll(async () => (await stil(seite, 'einblenden')).opacity, { timeout: 5000 }).toBe('1');
  await seite.close();
});

test('D4 c) vor dem Urteil ist jedes Element 0, auch mit Seitenregel opacity 1 (Freigabe gesperrt)', async () => {
  const seite = await oeffneDeckkraft('?veil-freigabe=nie');
  await abwarten(4000);
  for (const id of ['x-img', 'x-div', 'einblenden', 'offen', 'halb', 'wechsel', 's-stumm', 's-halb', 's-offen', 's-wechsel', 'fremd-leer', 'fremd-x', 'fremd-frei']) {
    const s = await stil(seite, id);
    expect(s, id).toMatchObject({ v: null, opacity: '0' });
  }
  await seite.close();
});

test('D4 d) verdeckt zeigt Blur und behaelt die Seiten-Deckkraft (Seite und Shadow Root)', async () => {
  const seite = await oeffneDeckkraft();
  await warteAufUrteile(seite);
  for (const id of ['leer', 's-leer']) {
    const s = await stil(seite, id);
    console.log(`chromium D4d: ${id} ${JSON.stringify(s)}`);
    expect(s.v, id).toBe('verdeckt');
    expect(s.filter, id).toContain('blur');
    expect(s.opacity, id).toBe('0.6');
  }
  await seite.close();
});

// Erwartete Deckkraft, sobald der Schleier aus ist (Pause oder Ausnahme): was die Seite festlegt, ohne Blur, ohne Urteil.
const SEITE_AUS: Record<string, string> = {
  'x-img': '0', 'x-div': '1', einblenden: '0', offen: '1', halb: '0.5', leer: '0.6',
  's-stumm': '0', 's-halb': '0.5', 's-offen': '1', 's-leer': '0.6', 's-wechsel': '1',
};

async function pruefeSeiteAus(seite: Page) {
  for (const [id, opacity] of Object.entries(SEITE_AUS)) {
    const s = await stil(seite, id);
    expect(s.opacity, id).toBe(opacity);
    expect(s.filter, id).toBe('none');
    expect(s.v, id).toBeNull();
  }
}

for (const [name, an, aus] of [
  ['Pause', { pause: true }, { pause: false }],
  ['eigene ausnahme fuer den Testhost', { ausnahmen: ['127.0.0.1'] }, { ausnahmen: [] }],
] as const) {
  test(`D4 e) ${name}: Seiten-Deckkraft, kein Blur; danach wieder beurteilt`, async () => {
    const seite = await oeffneDeckkraft();
    await warteAufUrteile(seite);
    await setze(an);
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
    await pruefeSeiteAus(seite);
    await setze(aus);
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBeNull();
    await warteAufUrteile(seite);
    await seite.close();
  });
}

test('D4 f) Shadow Root: Seiten-Deckkraft nach dem Urteil, 0 davor', async () => {
  const seite = await oeffneDeckkraft();
  await warteAufUrteile(seite);
  expect(await stil(seite, 's-stumm')).toMatchObject({ v: 'frei', opacity: '0' });
  expect(await stil(seite, 's-halb')).toMatchObject({ v: 'frei', opacity: '0.5' });
  expect(await stil(seite, 's-offen')).toMatchObject({ v: 'frei', opacity: '1' });
  await seite.close();
});

for (const [name, id, setzeSrc] of [
  ['Seite', 'wechsel', "document.getElementById('wechsel').src = '/synthetisch/20.png'"],
  ['Shadow Root', 's-wechsel', "window.wurzel.getElementById('s-wechsel').src = '/synthetisch/21.png'"],
] as const) {
  test(`D4 g) Quellenwechsel nach der Freigabe (${name}): wieder 0 bis zum neuen Urteil`, async () => {
    const seite = await oeffneDeckkraft();
    await warteAufUrteile(seite);
    expect(await stil(seite, id)).toMatchObject({ v: 'frei', opacity: '1' });
    await setzeTest(seite, { warteschlangeHalt: true });
    await seite.evaluate(setzeSrc);
    await expect.poll(async () => (await stil(seite, id)).v, { timeout: 5000 }).toBeNull();
    // Das Bild ist geladen, das Urteil steht aus (Warteschlange angehalten): unsichtbar.
    for (let i = 0; i < 6; i++) {
      expect(await stil(seite, id)).toMatchObject({ v: null, opacity: '0' });
      await abwarten(120);
    }
    await setzeTest(seite, { warteschlangeHalt: false });
    await expect.poll(async () => (await stil(seite, id)).v, { timeout: 20_000 }).toBe('frei');
    expect((await stil(seite, id)).opacity).toBe('1');
    await seite.close();
  });
}

test('D4 h) fremde Werte von data-veil (leer, fremd, frei) vor dem Laden: unsichtbar bis zum eigenen Urteil', async () => {
  const seite = await oeffneDeckkraft();
  await warteAufUrteile(seite);
  // Nach dem eigenen Urteil sind alle drei frei und sichtbar (die fremden Werte wurden ersetzt, nicht uebernommen).
  for (const id of ['fremd-leer', 'fremd-x', 'fremd-frei']) expect(await stil(seite, id), id).toMatchObject({ v: 'frei', opacity: '1' });
  await seite.close();
});

// ---------- V4: Vorrang ----------

const STUFE: Record<string, number> = { sg: 1, sk: 2, ng: 3, nk: 4, fern: 5 };
const gruppe = (id: string) => id.split('-')[1]!;
const VERZOEGERUNG = 600;

// Seite aufbauen: Warteschlange anhalten, Erkenner verlangsamen, die 43 Bilder gruppenweise in einer Folge anlegen, die NICHT der Stufenfolge
// entspricht (window.GRUPPEN: fern, nahe kleine, nahe grosse, sichtbare kleine, sichtbare grosse), und nach jeder Gruppe warten, bis ihre Bilder
// geladen und eingereiht sind. Die Einreihungsfolge ist damit fast die umgekehrte Stufenfolge: nur eine echte Stufenwahl ordnet sie um.
async function baueVorrang(): Promise<Page> {
  const seite = await context.newPage();
  await seite.setViewportSize({ width: 1000, height: 800 });
  await seite.goto(`${basis}/vorrang.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.vorrangBereit ?? null), { timeout: 10_000 }).toBe('1');
  await setzeTest(seite, { warteschlangeHalt: true, pruefVerzoegerungMs: VERZOEGERUNG });
  const gruppen = await seite.evaluate(() => (window as any).GRUPPEN as string[]);
  let erwartet = 0;
  for (const g of gruppen) {
    erwartet += await seite.evaluate((name) => {
      const vorher = document.images.length;
      (window as any).baueGruppe(name);
      return document.images.length - vorher;
    }, g);
    await expect
      .poll(() => seite.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length), { timeout: 30_000, intervals: [50] })
      .toBe(erwartet);
    await abwarten(300);
  }
  expect(erwartet).toBe(43);
  await abwarten(1000);
  expect(await seite.evaluate(() => (window as any).__urteile.length)).toBe(0);
  return seite;
}

const urteile = (seite: Page) => seite.evaluate(() => (window as any).__urteile as Array<{ id: string; v: string; t: number }>);
const anzahl = (seite: Page) => seite.evaluate(() => (window as any).__urteile.length as number);

test('V4 a) Reihenfolge der Urteile folgt den fuenf Stufen', async () => {
  test.setTimeout(120_000);
  const seite = await baueVorrang();
  await setzeTest(seite, { warteschlangeHalt: false });
  await expect.poll(() => anzahl(seite), { timeout: 90_000, intervals: [200] }).toBe(43);
  const liste = await urteile(seite);
  const stufen = liste.map((u) => STUFE[gruppe(u.id)]!);
  console.log(`chromium V4a: Stufen in Urteilsfolge ${stufen.join('')}`);
  // Je drei Urteile (Parallelitaet 3) sind eine Welle: Wellen folgen einander in Stufenfolge, innerhalb einer Welle ist die Reihenfolge Zufall.
  for (let k = 0; k + 3 < stufen.length; k += 3) {
    const hier = Math.max(...stufen.slice(k, k + 3));
    const danach = Math.min(...stufen.slice(k + 3, k + 6));
    expect(hier, `Welle ${k / 3 + 1} gegen die folgende`).toBeLessThanOrEqual(danach);
  }
  expect(liste.slice(0, 3).map((u) => gruppe(u.id))).toEqual(['sg', 'sg', 'sg']);
  expect(stufen.filter((s) => s === 5)).toHaveLength(30);
  expect(liste.every((u) => u.v === 'frei')).toBe(true);
  await seite.close();
});

test('V4 b) Scrollen waehrend der Pruefung zieht Neu-Sichtbares vor', async () => {
  test.setTimeout(120_000);
  const seite = await baueVorrang();
  await setzeTest(seite, { warteschlangeHalt: false });
  // Erste Welle (die drei grossen sichtbaren) ist durch, die zweite laeuft schon: jetzt zu den fernen Bildern scrollen.
  await expect.poll(() => anzahl(seite), { timeout: 30_000, intervals: [20] }).toBeGreaterThanOrEqual(3);
  await seite.evaluate(() => window.scrollTo(0, (window as any).ziel));
  await expect.poll(() => anzahl(seite), { timeout: 90_000, intervals: [200] }).toBeGreaterThanOrEqual(15);
  const ids = (await urteile(seite)).map((u) => u.id);
  console.log(`chromium V4b: Urteilsfolge ${ids.map((i) => i.replace('g-', '')).join(' ')}`);
  const ziel = new Set(Array.from({ length: 8 }, (_, i) => `g-fern-${i}`));
  // Welle 1 und 2 waren vor dem Scrollen gewaehlt (sichtbare grosse, dann kleine); danach kommen zuerst die neu sichtbaren fernen Bilder.
  expect(ids.slice(0, 3).map((i) => gruppe(i))).toEqual(['sg', 'sg', 'sg']);
  expect(ids.slice(3, 6).every((i) => gruppe(i) === 'sk')).toBe(true);
  expect(ids.slice(6, 12).every((i) => ziel.has(i))).toBe(true);
  expect(ids.slice(6, 15).filter((i) => ziel.has(i))).toHaveLength(8);
  // Das Scrollen hat die Bilder fern-8 bis fern-11 nah gemacht (nicht sichtbar): sie kommen vor den uebrigen fernen (fern-12 bis fern-29),
  // obwohl sie spaeter eingereiht wurden. Verglichen werden Wellen zu je drei (innerhalb einer Welle ist die Reihenfolge Zufall).
  await expect.poll(() => anzahl(seite), { timeout: 90_000, intervals: [200] }).toBe(43);
  const alle = (await urteile(seite)).map((u) => u.id);
  const welle = (i: string) => Math.floor(alle.indexOf(i) / 3);
  const nahWellen = [8, 9, 10, 11].map((n) => welle(`g-fern-${n}`));
  const fernWellen = Array.from({ length: 18 }, (_, k) => welle(`g-fern-${k + 12}`));
  console.log(`chromium V4b: Wellen nach dem Scrollen nah ${nahWellen.join(',')}, fern ab ${Math.min(...fernWellen)}`);
  expect(Math.max(...nahWellen)).toBeLessThanOrEqual(Math.min(...fernWellen));
  await seite.close();
});
