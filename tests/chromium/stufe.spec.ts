// Chromium: Phase 7, Auftrag I1 und I2. Regler "How hot do I get?" (nur mit Pack, speichert, 44 px bei 360 px Breite) und Wahl der Vorschau-Bilder
// nach Stufe und Seitenverhaeltnis (Nachricht an den Erkenner, Kacheln auf einer Nachbau-Seite, Stufenwechsel ohne Neuladen, Galerie).
// Dummy-Pack mit Stufen-Satz (scripts/pack/baue-pack.mjs, vorschauSatz 'stufen'), nur synthetische Bilder.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oeffneZugeklapptes } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://pornhub.veil-erwachsen.test:${port}/erwachsen-stufe.html`;
const GALERIE = `http://pornhub.veil-erwachsen.test:${port}/ersatz.html`;

interface Stufenbild {
  schluessel: string;
  stufe: string;
  breite: number;
  hoehe: number;
  farben: number[][];
}
interface PackBau {
  baueDummyPack(opts?: { vorschauSatz?: string }): Promise<{ bytes: Uint8Array }>;
  DUMMY_STUFEN_BILDER: Stufenbild[];
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let satz: Stufenbild[] = [];
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-stufe-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-stufe-pack-'));
  const bau = await ladeBau();
  satz = bau.DUMMY_STUFEN_BILDER;
  packPfad = path.join(ordner, 'stufen.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack({ vorschauSatz: 'stufen' })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`, '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1'],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

const ERWACHSEN = { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] as string[] };
async function setzeErwachsen(teil: Record<string, unknown>) {
  await worker.evaluate(
    async (n) => {
      const api = (globalThis as any).chrome;
      const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
      await api.storage.local.set({ einstellungen: { ...alt, erwachsen: { ...(alt.erwachsen ?? {}), ...n } } });
    },
    { ...ERWACHSEN, ...teil },
  );
}
const lies = (schluessel: string): Promise<any> => worker.evaluate(async (k) => (await (globalThis as any).chrome.storage.local.get(k))[k] ?? null, schluessel);
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);

async function warteAufErkenner() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await expect
      .poll(
        async () => {
          try {
            await s.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }));
            return (await ausWorker({ ziel: 'erkenner', typ: 'wecke' }))?.ok === true;
          } catch {
            return false;
          }
        },
        { timeout: 30_000, intervals: [200] },
      )
      .toBe(true);
  } finally {
    await s.close();
  }
}

const frageBild = (schluessel: string, breite: number | undefined, hoehe: number | undefined, stufe?: string) =>
  ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel, breite, hoehe, stufe });

// Raten, welches Bild des Stufen-Satzes auf einem getauschten Element liegt: Mittelfarben von neun Punkten gegen die zwei Farben jedes Bildes.
async function welches(s: Page, id: string): Promise<string> {
  return s.evaluate(
    async ({ id, satz }) => {
      const el = document.getElementById(id) as HTMLImageElement;
      const b = new Image();
      b.src = el.src;
      await b.decode();
      const c = document.createElement('canvas');
      c.width = b.naturalWidth;
      c.height = b.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(b, 0, 0);
      const punkte: number[][] = [];
      for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) punkte.push([...ctx.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data]);
      let beste = '';
      let besterWert = Infinity;
      for (const x of satz) {
        let summe = 0;
        for (const p of punkte) summe += Math.min(...x.farben.map((f: number[]) => Math.hypot(p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!)));
        if (summe < besterWert) {
          besterWert = summe;
          beste = x.schluessel;
        }
      }
      return beste;
    },
    { id, satz },
  );
}
const istGetauscht = (s: Page, id: string) =>
  s.evaluate((i) => {
    const e = document.getElementById(i) as HTMLImageElement | null;
    return !!e && e.getAttribute('data-veil') === 'zensiert' && e.src.startsWith('data:image/jpeg');
  }, id);
async function warteAufTausch(s: Page, ids: string[]) {
  await expect.poll(async () => (await Promise.all(ids.map((i) => istGetauscht(s, i)))).every(Boolean), { timeout: 30_000, intervals: [100] }).toBe(true);
}
const ergaenze = (s: Page, id: string, b: number, h: number, n: number, key?: string) =>
  s.evaluate(([i, w, hh, nn, k]) => (window as any).addTile(i, w, hh, nn, k), [id, b, h, n, key] as const);

test('ohne Pack: der Regler ist gesperrt, ein Satz steht da, die Knoepfe sind nicht zu sehen', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(optionsUrl());
  await expect(s.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
  // Ohne Pack steht Adult sites zugeklappt ("Set them now"): erst aufklappen, wie die Person.
  await oeffneZugeklapptes(s);
  await expect(s.locator('#stufe-gesperrt')).toBeVisible();
  await expect(s.locator('#stufe-gesperrt')).toContainText('Mia Pack');
  await expect(s.locator('#stufe-wahl')).toBeHidden();
  expect(await s.locator('input[name="stufe"]').evaluateAll((l) => l.every((i) => (i as HTMLInputElement).disabled))).toBe(true);
  // Ein gespeicherter Wert aendert sich ohne Pack nicht ueber die Oberflaeche
  expect((await lies('einstellungen'))?.erwachsen?.stufe ?? 'hot').toBe('hot');
  await s.close();
});

test('Pack mit Stufen importieren', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(packPfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
  } finally {
    await s.close();
  }
  await warteAufErkenner();
});

test('mit Pack: Regler sichtbar, Standard Hot, Wahl speichert, Zeile in Mias Stimme, Fingerziele 44 px bei 360 px', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.setViewportSize({ width: 360, height: 800 });
  await s.goto(optionsUrl());
  await expect(s.locator('#stufe-wahl')).toBeVisible();
  await expect(s.locator('#stufe-gesperrt')).toBeHidden();
  await expect(s.getByRole('radiogroup', { name: 'How hot do I get?' }).first()).toBeVisible(); // zweiter Regler steht in "Set me up"
  await expect(s.locator('input[name="stufe"][value="hot"]')).toBeChecked();
  // Jeder Knopf traegt seine eigene Zeile in Mias Stimme
  expect(await s.locator('input[name="stufe"] + span small').allTextContents()).toEqual(['I only hint.', 'I show more.', 'Nothing held back.']);
  const masse = await s.evaluate(() => ({
    hoehen: [...document.querySelectorAll('input[name="stufe"]')].map((i) => (i.nextElementSibling as HTMLElement).getBoundingClientRect().height),
    breiten: [...document.querySelectorAll('input[name="stufe"] + span strong')].map((e) => e.textContent),
    scrollB: document.documentElement.scrollWidth,
    innen: document.documentElement.clientWidth,
  }));
  console.log(`chromium I1: Fingerziele ${masse.hoehen.map((h) => Math.round(h)).join('/')} px, Knoepfe ${masse.breiten.join('/')}, scrollWidth ${masse.scrollB} von ${masse.innen}`);
  expect(masse.breiten).toEqual(['Tease', 'Hot', 'Explicit']);
  for (const h of masse.hoehen) expect(h).toBeGreaterThanOrEqual(44);
  expect(masse.scrollB).toBeLessThanOrEqual(masse.innen);
  await s.locator('input[name="stufe"][value="tease"] + span').click();
  await expect.poll(async () => (await lies('einstellungen'))?.erwachsen?.stufe).toBe('tease');
  // Tastatur: Pfeil nach rechts auf der Radiogruppe geht zu Hot, dann Explicit
  await s.locator('input[name="stufe"][value="tease"]').focus();
  await s.keyboard.press('ArrowRight');
  await expect.poll(async () => (await lies('einstellungen'))?.erwachsen?.stufe).toBe('hot');
  await s.keyboard.press('ArrowRight');
  await expect.poll(async () => (await lies('einstellungen'))?.erwachsen?.stufe).toBe('explicit');
  // Die anderen Werte des Abschnitts bleiben stehen
  const e = (await lies('einstellungen')).erwachsen;
  expect(e.an).toBe(true);
  expect(e.eigeneSeiten).toEqual([]);
  // Eine zweite offene Seite folgt dem Speicher
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen;
    await api.storage.local.set({ einstellungen: { ...alt, erwachsen: { ...alt.erwachsen, stufe: 'hot' } } });
  });
  await expect(s.locator('input[name="stufe"][value="hot"]')).toBeChecked();
  await s.close();
});

test('Erkenner: Wahl nach Stufe und Verhaeltnis (Nachricht packbild)', async () => {
  test.setTimeout(90_000);
  const name = (a: any) => String(a?.name ?? '');
  // tease: nur Tease, passende Klasse
  const t1 = await frageBild('q1', 16, 9, 'tease');
  expect(t1.ok, JSON.stringify(t1)).toBe(true);
  expect(name(t1)).toBe('vorschau/stufe-tease-quer.webp');
  expect(name(await frageBild('q2', 9, 16, 'tease'))).toBe('vorschau/stufe-tease-hoch.webp');
  // tease hat kein Quadrat: naechste Klasse nach Verhaeltnis (hoch 3:4)
  expect(name(await frageBild('q3', 1, 1, 'tease'))).toBe('vorschau/stufe-tease-hoch.webp');
  // hot: Quadrat vorhanden
  expect(name(await frageBild('q3', 1, 1, 'hot'))).toBe('vorschau/stufe-hot-quadratisch.webp');
  // hot nie explicit, ueber viele Schluessel; Stufe fehlt = hot
  const gesehenHot = new Set<string>();
  const gesehenOhne = new Set<string>();
  const gesehenExplicit = new Set<string>();
  for (let k = 0; k < 30; k++) {
    gesehenHot.add(name(await frageBild(`h${k}`, 16, 9, 'hot')));
    gesehenOhne.add(name(await frageBild(`h${k}`, 16, 9, undefined)));
    gesehenExplicit.add(name(await frageBild(`h${k}`, 16, 9, 'explicit')));
  }
  console.log(`chromium I2: hot ${[...gesehenHot].join(', ')} | ohne Stufe ${[...gesehenOhne].join(', ')} | explicit ${[...gesehenExplicit].join(', ')}`);
  expect([...gesehenHot].sort()).toEqual(['vorschau/stufe-hot-quer.webp', 'vorschau/stufe-tease-quer.webp']);
  expect(gesehenExplicit.has('vorschau/stufe-explicit-quer.webp')).toBe(true);
  expect([...gesehenExplicit].every((n) => n.includes('quer'))).toBe(true);
  // unbekannte oder fehlende Stufe in der Nachricht gilt als die mildeste
  expect(name(await frageBild('u1', 16, 9, 'extrem'))).toBe('vorschau/stufe-tease-quer.webp');
  expect([...gesehenOhne]).toEqual(['vorschau/stufe-tease-quer.webp']);
  // ohne Masse: wie vor Phase 7, nur nach Stufe
  const ohneMass = new Set<string>();
  for (let k = 0; k < 40; k++) ohneMass.add(name(await frageBild(`m${k}`, undefined, undefined, 'tease')));
  expect([...ohneMass].every((n) => n.includes('tease'))).toBe(true);
});

test('Kacheln: Wahl nach Format, Stufenwechsel wirkt beim naechsten Bild ohne Neuladen, auch fuer dieselbe Quelle', async () => {
  test.setTimeout(120_000);
  await setzeErwachsen({ stufe: 'explicit' });
  const s = await context.newPage();
  await s.goto(SEITE);
  await warteAufTausch(s, ['s1', 's2', 's3']);
  const [a1, a2, a3] = [await welches(s, 's1'), await welches(s, 's2'), await welches(s, 's3')];
  console.log(`chromium I2: explicit quer ${a1}, hoch ${a2}, quadratisch ${a3}`);
  expect(a1).toMatch(/-quer$/);
  expect(a2).toMatch(/-hoch$/);
  expect(a3).toBe('hot-quadratisch');
  // Umschalten auf Tease: alle Kacheln der Seite, auch die schon getauschten, zeigen danach Tease; neue Kacheln mit denselben Quellen ebenso
  await setzeErwachsen({ stufe: 'tease' });
  await ergaenze(s, 'n1', 320, 180, 61, 'ph5s1');
  await ergaenze(s, 'n2', 180, 320, 62, 'ph5s2');
  await ergaenze(s, 'n3', 200, 200, 64, 'ph5s3');
  await warteAufTausch(s, ['s1', 's2', 's3', 'n1', 'n2', 'n3']);
  expect(await welches(s, 'n1')).toBe('tease-quer');
  expect(await welches(s, 'n2')).toBe('tease-hoch');
  expect(await welches(s, 'n3')).toBe('tease-hoch');
  // Auf Hot: nie Explicit
  await setzeErwachsen({ stufe: 'hot' });
  await ergaenze(s, 'n4', 320, 180, 61, 'ph5s1');
  await ergaenze(s, 'n5', 180, 320, 62, 'ph5s2');
  await ergaenze(s, 'n6', 200, 200, 64, 'ph5s3');
  await warteAufTausch(s, ['s1', 's2', 's3', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  expect(['tease-quer', 'hot-quer']).toContain(await welches(s, 'n4'));
  expect(['tease-hoch', 'hot-hoch']).toContain(await welches(s, 'n5'));
  expect(await welches(s, 'n6')).toBe('hot-quadratisch');
  await s.close();
});

test('Wechsel auf mildere Stufe: schon getauschte Kacheln zeigen danach Tease (Hot, Kacheln getauscht, dann Tease)', async () => {
  test.setTimeout(120_000);
  await setzeErwachsen({ stufe: 'hot' });
  const s = await context.newPage();
  await s.goto(SEITE);
  const extra = Array.from({ length: 8 }, (_, i) => `x${i + 1}`);
  await warteAufTausch(s, ['s1', 's2', 's3']);
  for (const [i, id] of extra.entries()) await ergaenze(s, id, i % 2 ? 180 : 320, i % 2 ? 320 : 180, 80 + i, `ph5x${i + 1}`);
  const alle = ['s1', 's2', 's3', ...extra];
  await warteAufTausch(s, alle);
  const vorher = await Promise.all(alle.map((id) => welches(s, id)));
  console.log(`chromium I1b: bei Hot ${vorher.join(', ')}`);
  expect(vorher.every((k) => !k.startsWith('explicit'))).toBe(true);
  expect(vorher.some((k) => k.startsWith('hot'))).toBe(true); // sonst bewiese der Test nichts
  await setzeErwachsen({ stufe: 'tease' });
  await expect
    .poll(
      async () => {
        const getauscht = await Promise.all(alle.map((id) => istGetauscht(s, id)));
        if (!getauscht.every(Boolean)) return 'noch nicht';
        return (await Promise.all(alle.map((id) => welches(s, id)))).filter((k) => !k.startsWith('tease')).join(',');
      },
      { timeout: 30_000, intervals: [200] },
    )
    .toBe('');
  const danach = await Promise.all(alle.map((id) => welches(s, id)));
  console.log(`chromium I1b: nach Tease ${danach.join(', ')}`);
  await s.close();
});

test('Stabile Wahl je Quelle: gleiche Quelle gleiches Bild, verschiedene Quellen verteilen sich', async () => {
  test.setTimeout(120_000);
  await setzeErwachsen({ stufe: 'hot' });
  const s = await context.newPage();
  await s.goto(SEITE);
  await warteAufTausch(s, ['s1']);
  const ids = Array.from({ length: 12 }, (_, i) => `k${i + 1}`);
  for (const [i, id] of ids.entries()) await ergaenze(s, id, 320, 180, 100 + i, `ph5k${i + 1}`);
  // dieselbe Quelle (viewkey) noch einmal, anderes Bildelement und andere Bildadresse
  await ergaenze(s, 'd1', 320, 180, 120, 'ph5k1');
  await ergaenze(s, 'd2', 320, 180, 121, 'ph5k7');
  await warteAufTausch(s, [...ids, 'd1', 'd2']);
  const wahl = await Promise.all(ids.map((id) => welches(s, id)));
  console.log(`chromium I2: Verteilung ${wahl.join(', ')}`);
  expect(await welches(s, 'd1')).toBe(wahl[0]);
  expect(await welches(s, 'd2')).toBe(wahl[6]);
  expect(new Set(wahl).size).toBe(2);
  expect(wahl.every((k) => k === 'tease-quer' || k === 'hot-quer')).toBe(true);
  await s.close();
});

test('Galerie (16:9) folgt der Stufe und zeigt nur Bilder erlaubter Stufen', async () => {
  test.setTimeout(120_000);
  const zeige = async (stufe: string): Promise<string[]> => {
    await setzeErwachsen({ stufe, komplettErsatz: true });
    const s = await context.newPage();
    try {
      await s.goto(GALERIE, { waitUntil: 'domcontentloaded' });
      let letzte = '';
      let stabil = 0;
      await expect
        .poll(
          async () => {
            const t = await s.evaluate(() => document.documentElement.getAttribute('data-veil-ersatz-abbild'));
            const namen: string[] = t ? JSON.parse(t).namen : [];
            const jetzt = [...namen].sort().join(',');
            stabil = jetzt === letzte && namen.length > 0 ? stabil + 1 : 0;
            letzte = jetzt;
            return stabil >= 8;
          },
          { timeout: 30_000, intervals: [150] },
        )
        .toBe(true);
      return letzte.split(',');
    } finally {
      await s.close();
    }
  };
  const tease = await zeige('tease');
  const hot = await zeige('hot');
  const explizit = await zeige('explicit');
  console.log(`chromium I2: Galerie Tease ${tease.join(' ')} | Hot ${hot.join(' ')} | Explicit ${explizit.join(' ')}`);
  expect(tease).toEqual(['vorschau/stufe-tease-quer.webp']);
  expect(hot).toEqual(['vorschau/stufe-hot-quer.webp', 'vorschau/stufe-tease-quer.webp']);
  expect(explizit).toEqual(['vorschau/stufe-explicit-quer.webp', 'vorschau/stufe-hot-quer.webp', 'vorschau/stufe-tease-quer.webp']);
  await setzeErwachsen({ komplettErsatz: false });
});

test('Pack entfernen: der Regler ist wieder gesperrt', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await expect(s.locator('#stufe-wahl')).toBeVisible();
    await expect(s.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
    await s.locator('#entfernen').click();
    await s.locator('#entfernen-ja').click();
    await expect(s.locator('#stufe-wahl')).toBeHidden({ timeout: 15_000 });
    // Ohne Pack ist Adult sites zugeklappt: aufklappen, wie die Person.
    await oeffneZugeklapptes(s);
    await expect(s.locator('#stufe-gesperrt')).toBeVisible();
  } finally {
    await s.close();
  }
});
