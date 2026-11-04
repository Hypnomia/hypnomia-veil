// Chromium: Freilegen (Auftrag F). Knopf nur mit Pack und Freischaltung quiz:freilegen an zensierten Bildern und Hintergruenden, Quiz loesen zeigt das
// Original fuer freilegenMs, danach wieder zensiert. Der Knopf steht in einer geschlossenen Shadow Root; der Testbau schreibt ein Abbild nach
// data-veil-freilegen (Rechtecke der Knoepfe) und die Meldung nach data-veil-freilegen-meldung. Braucht ../05 Testbilder (sonst VEIL_OHNE_TESTBILDER=1).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://127.0.0.1:${port}/freilegen.html`;
const FREILEGEN_MS = 3000;
const bauModul = '../../scripts/pack/baue-pack.mjs';
const inhaltModul = '../../scripts/pack/dummy-inhalte.mjs';

test.describe.configure({ mode: 'serial' });

let profil: string | undefined;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let erweiterungsId = '';
let fragen: any[] = [];
let texte: { gruppen: Record<string, string[]> };

type Knopf = { id: string; x: number; y: number; w: number; h: number };
const knoepfe = async (s: Page): Promise<Knopf[]> =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-freilegen');
    return a ? JSON.parse(a).knoepfe : [];
  });
const meldung = (s: Page) => s.evaluate(() => document.documentElement.getAttribute('data-veil-freilegen-meldung'));
const veil = (s: Page, id: string) => s.evaluate((id) => document.getElementById(id)?.getAttribute('data-veil') ?? null, id);
const riegel = (s: Page) =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-riegel');
    return a ? JSON.parse(a) : null;
  });
const extSeite = async () => {
  const s = await context.newPage();
  await s.goto(`chrome-extension://${erweiterungsId}/options.html`);
  return s;
};
// teil: oberste Felder; `quiz` wird mit dem alten Wert verschmolzen.
async function aendereEinstellungen(teil: Record<string, any>): Promise<void> {
  const e = await extSeite();
  try {
    await e.evaluate(async (teil) => {
      const c = (globalThis as any).chrome;
      const alt = ((await c.storage.local.get('einstellungen')) as Record<string, any>).einstellungen ?? {};
      const neu = { ...alt, ...teil };
      if (teil.quiz) neu.quiz = { ...(alt.quiz ?? {}), ...teil.quiz };
      await c.storage.local.set({ einstellungen: neu });
    }, teil);
  } finally {
    await e.close();
  }
}
const klickeMitte = async (s: Page, r: { x: number; y: number; w: number; h: number }) => s.mouse.click(r.x + r.w / 2, r.y + r.h / 2);

async function frischeSeite(): Promise<Page> {
  const s = await context.newPage();
  await s.goto(SEITE);
  await expect.poll(() => s.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
  // Verdeckt-Fall schnell erreichen (zweiter Versuch nach einem Fehler)
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ zweiterVersuchMs: 500 }) })));
  return s;
}
async function warteZensiert(s: Page, ids = ['a', 'hg']): Promise<void> {
  for (const id of ids) await expect.poll(() => veil(s, id), { timeout: 40_000, intervals: [100] }).toBe('zensiert');
}
async function loeseRiegel(s: Page): Promise<void> {
  // Der Riegel baut sich auf: die Rechtecke gelten erst, wenn sie zweimal hintereinander gleich waren; ein verfehlter Klick wird wiederholt.
  for (let versuch = 0; versuch < 6; versuch++) {
    await expect.poll(async () => (await riegel(s))?.zustand, { timeout: 15_000, intervals: [50] }).toBe('frage');
    let a = await riegel(s);
    for (let i = 0; i < 20; i++) {
      await s.waitForTimeout(150);
      const b = await riegel(s);
      if (!b || b.zustand !== 'frage') break;
      const gleich = JSON.stringify(b.antworten) === JSON.stringify(a.antworten);
      a = b;
      if (gleich) break;
    }
    if (a.zustand !== 'frage') return;
    const f = fragen.find((q) => q.id === a.frage.id);
    expect(f, `Frage ${a.frage.id}`).toBeTruthy();
    const zielK = a.antworten.find((b: any) => b.text === f.antworten[f.richtig]);
    await klickeMitte(s, zielK);
    await s.waitForTimeout(600);
    const danach = await riegel(s);
    if (!danach || danach.zustand !== 'frage' || danach.frage.id !== a.frage.id) return;
  }
  throw new Error('Riegel nicht zu loesen');
}

test.beforeAll(async () => {
  const datei = path.join(wurzel, '..', '05 Testbilder', 'nsfw', 'IMG_0260.jpg');
  if (!existsSync(datei) && process.env.VEIL_OHNE_TESTBILDER !== '1') throw new Error('Freilegen-Test braucht ../05 Testbilder/nsfw/IMG_0260.jpg');
  profil = await mkdtemp(path.join(tmpdir(), 'veil-freilegen-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-freilegen-datei-'));
  packPfad = path.join(ordner, 'dummy.miapack');
  const bau = (await import(bauModul)) as any;
  const inhalt = (await import(inhaltModul)) as any;
  fragen = inhalt.DUMMY_QUIZ.fragen.filter((q: any) => q.art === 'wissen' || q.art === 'allgemein');
  texte = inhalt.DUMMY_TEXTE;
  await writeFile(packPfad, (await bau.baueDummyPack({ quiz: { version: 1, fragen } })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('ohne Pack: nie ein Knopf', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await s.waitForTimeout(1500);
    expect(await knoepfe(s)).toEqual([]);
    expect(await s.evaluate(() => document.documentElement.hasAttribute('data-veil-freilegen'))).toBe(false);
    console.log('chromium freilegen: ohne Pack kein Knopf');
  } finally {
    await s.close();
  }
});

test('Pack importieren, Quiz ohne Verweigern, kurze Freilegen-Dauer', async () => {
  const e = await extSeite();
  try {
    await e.locator('#datei').setInputFiles(packPfad);
    await e.locator('#annehmen').click();
    await expect(e.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    await e.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
  } finally {
    await e.close();
  }
  await aendereEinstellungen({ pause: false, quiz: { verweigern: 0, freilegenMs: 3000 } });
});

test('Knoepfe nur an zensierten Flaechen ab 80 px, nicht an verdeckt, Video und kleinem Bild', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 8000 }).toBe(2);
    const k = await knoepfe(s);
    expect(k.map((x) => x.id).sort()).toEqual(['a', 'hg']);
    await expect.poll(() => veil(s, 'video'), { timeout: 30_000 }).toBe('verdeckt'); // Video ohne Daten bleibt verdeckt
    expect((await knoepfe(s)).map((x) => x.id).sort()).toEqual(['a', 'hg']); // klein (60 px), verdeckt und video: kein Knopf
    // Der Host ist fuer die Seite zu: keine Knoepfe im offenen DOM
    expect(await s.evaluate(() => document.querySelectorAll('button').length)).toBe(0);
    console.log(`chromium freilegen: Knoepfe an ${k.map((x) => x.id).join(', ')}`);
  } finally {
    await s.close();
  }
});

test('Quiz loesen zeigt das Original, nach freilegenMs wieder zensiert, Dauer gemessen', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await s.evaluate(() => {
      const el = document.getElementById('a')!;
      (window as any).__log = [];
      new MutationObserver(() => (window as any).__log.push([performance.now(), el.getAttribute('data-veil')])).observe(el, { attributes: true, attributeFilter: ['data-veil'] });
    });
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'a'), { timeout: 8000 }).toBe(true);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'a')!);
    await loeseRiegel(s);
    await expect.poll(() => veil(s, 'a'), { timeout: 8000, intervals: [30] }).toBe('frei');
    expect(await s.evaluate(() => (document.getElementById('a') as HTMLImageElement).getAttribute('src'))).toBe('/testbild/nsfw/IMG_0260.jpg');
    await expect.poll(() => meldung(s), { timeout: 4000 }).toBe('Test reveal line, 3 seconds.');
    await expect.poll(() => veil(s, 'a'), { timeout: 8000, intervals: [30] }).toBe('zensiert');
    const log: Array<[number, string | null]> = await s.evaluate(() => (window as any).__log);
    const tFrei = log.find((l) => l[1] === 'frei')![0];
    const tWeg = log.find((l) => l[0] > tFrei && l[1] === null)![0];
    const dauer = tWeg - tFrei;
    expect(Math.abs(dauer - FREILEGEN_MS)).toBeLessThanOrEqual(300);
    await expect.poll(() => meldung(s), { timeout: 4000 }).toBe('Test censored again line.');
    expect(await s.evaluate(() => (document.getElementById('a') as HTMLImageElement).getAttribute('src'))).toMatch(/^data:/);
    console.log(`chromium freilegen: Original ${Math.round(dauer)} ms sichtbar (Soll ${FREILEGEN_MS}), danach wieder zensiert`);
  } finally {
    await s.close();
  }
});

test('Klick auf das Bild selbst folgt dem Link, kein Riegel', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    const r = await s.evaluate(() => {
      const b = document.getElementById('a')!.getBoundingClientRect();
      return { x: b.left, y: b.top + b.height / 2, w: b.width, h: 0 };
    });
    await klickeMitte(s, { ...r, x: r.x + 10, w: 20 });
    await expect.poll(() => s.evaluate(() => location.hash), { timeout: 3000 }).toBe('#geklickt');
    expect(await riegel(s)).toBeNull();
    console.log('chromium freilegen: Klick auf das Bild folgt dem Link');
  } finally {
    await s.close();
  }
});

test('Pause im Riegel legt nichts frei', async () => {
  await aendereEinstellungen({ pause: false });
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'hg'), { timeout: 8000 }).toBe(true);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'hg')!);
    await expect.poll(async () => (await riegel(s))?.zustand, { timeout: 15_000 }).toBe('frage');
    await klickeMitte(s, (await riegel(s)).pause);
    await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 8000 }).toBe('aus');
    expect(await veil(s, 'hg')).not.toBe('frei');
    expect(await s.evaluate(() => document.documentElement.hasAttribute('data-veil-freilegen-meldung'))).toBe(false);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 5000 }).toBe(0);
    await aendereEinstellungen({ pause: false });
    await expect.poll(() => veil(s, 'hg'), { timeout: 40_000, intervals: [100] }).toBe('zensiert');
    // Nach dem Ende der Pause kommen die Knoepfe zurueck (lokale Pause setzt sich selbst zurueck)
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'hg'), { timeout: 8000 }).toBe(true);
    console.log('chromium freilegen: Pause im Riegel legt nichts frei, danach normal zensiert');
  } finally {
    await s.close();
  }
});

test('Pause waehrend des Freilegens gibt frei, danach wird normal geprueft', async () => {
  await aendereEinstellungen({ pause: false, quiz: { freilegenMs: 30000 } });
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'a'), { timeout: 8000 }).toBe(true);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'a')!);
    await loeseRiegel(s);
    await expect.poll(() => veil(s, 'a'), { timeout: 8000 }).toBe('frei');
    await aendereEinstellungen({ pause: true });
    await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 8000 }).toBe('aus');
    expect(await s.evaluate(() => (document.getElementById('a') as HTMLImageElement).getAttribute('src'))).toBe('/testbild/nsfw/IMG_0260.jpg');
    await aendereEinstellungen({ pause: false });
    // Kein Rest-Freilegen: das Bild wird normal geprueft und ist wieder zensiert, lange vor den 30 s
    const t0 = Date.now();
    await expect.poll(() => veil(s, 'a'), { timeout: 20_000, intervals: [50] }).toBe('zensiert');
    expect(Date.now() - t0).toBeLessThan(20_000);
    await s.waitForTimeout(500);
    expect(await veil(s, 'a')).toBe('zensiert');
    console.log(`chromium freilegen: Pause waehrend Freilegen gibt frei, ${Date.now() - t0} ms nach Pause-Ende wieder zensiert`);
  } finally {
    await aendereEinstellungen({ quiz: { freilegenMs: 3000 } });
    await s.close();
  }
});

test('Pack entfernt: Knoepfe sofort weg', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 8000 }).toBe(2);
    const e = await extSeite();
    await e.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    await e.close();
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 5000 }).toBe(0);
    console.log('chromium freilegen: ohne Pack verschwinden die Knoepfe');
  } finally {
    await s.close();
  }
});
