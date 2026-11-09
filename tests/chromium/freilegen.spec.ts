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

async function frischeSeite(url = SEITE): Promise<Page> {
  const s = await context.newPage();
  await s.goto(url);
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
  // Session 17: unter Last (Gesamtlauf) mehr Versuche und laengeres Warten nach dem Klick.
  for (let versuch = 0; versuch < 10; versuch++) {
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
    let zielK = a.antworten.find((b: any) => b.text === f.antworten[f.richtig]);
    expect(zielK, `Antwort "${f.antworten[f.richtig]}" im Riegel`).toBeTruthy();
    // Session 18: auf einem kleinen Riegel liegt die unterste Antwort beim ersten Riegel (Erklaerzeile) unter dem sichtbaren Rollbereich:
    // erst hineinrollen wie eine Person, dann neu messen (Ursache des Wacklers, Entscheidung 185).
    const box = a.scrollBox;
    if (box && zielK.y + zielK.h > box.y + box.h - 2) {
      await s.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      await s.mouse.wheel(0, zielK.y + zielK.h - (box.y + box.h) + 24);
      await s.waitForTimeout(400);
      const neu = await riegel(s);
      if (neu?.zustand === 'frage') zielK = neu.antworten.find((b: any) => b.text === f.antworten[f.richtig]) ?? zielK;
    }
    await klickeMitte(s, zielK);
    await s.waitForTimeout(1200);
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

async function importierePack(): Promise<void> {
  const e = await extSeite();
  try {
    await e.locator('#datei').setInputFiles(packPfad);
    await e.locator('#annehmen').click();
    await expect(e.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    await e.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
  } finally {
    await e.close();
  }
}
const entfernePack = async () => {
  const e = await extSeite();
  await e.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
  await e.close();
};
const oeffneTestRiegel = (s: Page, o: Record<string, unknown>) =>
  s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: o } });

test('Pack importieren, Quiz ohne Verweigern, kurze Freilegen-Dauer', async () => {
  await importierePack();  await aendereEinstellungen({ pause: false, quiz: { verweigern: 0, freilegenMs: 3000 } });
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
    const zensierteQuelle = await s.evaluate(() => document.getElementById('a')!.getAttribute('src'));
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
    // dieselbe zensierte Fassung, ohne neue Pruefung
    expect(await s.evaluate(() => document.getElementById('a')!.getAttribute('src'))).toBe(zensierteQuelle);
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

test('nur lokale Pause (Hintergrund antwortet nie): Freilegen endet, neue Quelle wird wieder geprueft', async () => {
  await aendereEinstellungen({ pause: false, quiz: { freilegenMs: 30000 } });
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'a'), { timeout: 8000 }).toBe(true);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'a')!);
    await loeseRiegel(s);
    await expect.poll(() => veil(s, 'a'), { timeout: 8000 }).toBe('frei');
    // Riegel eines anderen Grundes, dessen Pause-Nachricht nie ankommt
    await oeffneTestRiegel(s, { frage: 'test-w1', pauseHaengt: true });
    await expect.poll(async () => (await riegel(s))?.zustand, { timeout: 15_000 }).toBe('frage');
    await s.waitForTimeout(600);
    await klickeMitte(s, (await riegel(s)).pause);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 5000 }).toBe(0);
    expect(await s.evaluate(() => document.documentElement.getAttribute('data-veil-seite'))).not.toBe('aus'); // gespeicherte Pause kam nie an
    // Die Seite wechselt die Quelle des freigelegten Bildes: das Freilegen steht nicht mehr im Weg, es wird wieder geprueft
    await s.evaluate(() => document.getElementById('a')!.setAttribute('src', '/testbild/nsfw/IMG_0260.jpg?neu=1'));
    await expect.poll(() => s.evaluate(() => document.getElementById('a')!.getAttribute('src')?.startsWith('data:')), { timeout: 40_000, intervals: [100] }).toBe(true);
    await expect.poll(() => veil(s, 'a'), { timeout: 20_000 }).toBe('zensiert');
    console.log('chromium freilegen: nur lokale Pause beendet das Freilegen, neue Quelle wird geprueft');
  } finally {
    await aendereEinstellungen({ quiz: { freilegenMs: 3000 } });
    await s.close();
  }
});

test('Quellwechsel waehrend des Freilegens: sofort verdeckt, nie ungeprueft sichtbar', async () => {
  await aendereEinstellungen({ pause: false, quiz: { freilegenMs: 30000 } });
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'a'), { timeout: 8000 }).toBe(true);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'a')!);
    await loeseRiegel(s);
    await expect.poll(() => veil(s, 'a'), { timeout: 8000 }).toBe('frei');
    await s.evaluate(() => {
      const el = document.getElementById('a')!;
      (window as any).__log = [];
      new MutationObserver(() => (window as any).__log.push(el.getAttribute('data-veil'))).observe(el, { attributes: true, attributeFilter: ['data-veil'] });
      el.setAttribute('src', '/testbild/nsfw/IMG_0260.jpg?rotation=2');
    });
    await expect.poll(() => veil(s, 'a'), { timeout: 40_000, intervals: [50] }).toBe('zensiert');
    const log: Array<string | null> = await s.evaluate(() => (window as any).__log);
    expect(log[0]).toBeNull(); // sofort wieder verdeckt (Hide-first)
    expect(log).not.toContain('frei');
    // Hintergrund: Inline-Wert wechseln, solange freigelegt
    await expect.poll(async () => (await knoepfe(s)).some((x) => x.id === 'hg'), { timeout: 8000 }).toBe(true);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'hg')!);
    await loeseRiegel(s);
    await expect.poll(() => veil(s, 'hg'), { timeout: 8000 }).toBe('frei');
    await s.evaluate(() => {
      const el = document.getElementById('hg')!;
      (window as any).__log2 = [];
      new MutationObserver(() => (window as any).__log2.push(el.getAttribute('data-veil'))).observe(el, { attributes: true, attributeFilter: ['data-veil'] });
      el.style.backgroundImage = "url('/testbild/nsfw/IMG_0260.jpg?rotation=3')";
    });
    await expect.poll(() => veil(s, 'hg'), { timeout: 40_000, intervals: [50] }).toBe('zensiert');
    const log2: Array<string | null> = await s.evaluate(() => (window as any).__log2);
    expect(log2[0]).toBeNull();
    expect(log2).not.toContain('frei');
    console.log('chromium freilegen: Quellwechsel beendet das Freilegen sofort (Bild und Hintergrund)');
  } finally {
    await aendereEinstellungen({ quiz: { freilegenMs: 3000 } });
    await s.close();
  }
});

test('eigene Ausnahme waehrend des Freilegens: alles frei, Knoepfe weg, danach wieder da', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 8000 }).toBe(2);
    await aendereEinstellungen({ ausnahmen: ['127.0.0.1'] });
    await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 8000 }).toBe('aus');
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 5000 }).toBe(0);
    await aendereEinstellungen({ ausnahmen: [] });
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 40_000 }).toBe(2);
    console.log('chromium freilegen: eigene Ausnahme nimmt die Knoepfe weg, danach kommen sie zurueck');
  } finally {
    await aendereEinstellungen({ ausnahmen: [] });
    await s.close();
  }
});

test('hoechstens 24 Knoepfe, nur im Sichtbereich', async () => {
  const s = await frischeSeite(`http://127.0.0.1:${port}/freilegen-viele.html`);
  try {
    for (const id of ['v0', 'v39', 'u0']) await expect.poll(() => veil(s, id), { timeout: 90_000, intervals: [200] }).toBe('zensiert');
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 10_000 }).toBe(24);
    const k = await knoepfe(s);
    expect(k.every((x) => x.id.startsWith('v'))).toBe(true);
    expect(k.every((x) => x.y >= 0 && x.y + x.h <= 720)).toBe(true);
    await s.evaluate(() => window.scrollTo(0, document.getElementById('u0')!.getBoundingClientRect().top + scrollY - 50));
    await expect.poll(async () => (await knoepfe(s)).map((x) => x.id).sort().join(','), { timeout: 8000 }).toBe('u0,u1,u2');
    console.log('chromium freilegen: 24 Knoepfe im Sichtbereich, nach dem Scrollen nur die sichtbaren drei');
  } finally {
    await s.close();
  }
});

test('Lagen: durchsichtige Ebene (Instagram-Muster) erlaubt den Knopf, Karussell beschneidet, deckende Ebene verhindert ihn', async () => {
  const s = await frischeSeite(`http://127.0.0.1:${port}/freilegen-lagen.html`);
  try {
    for (const id of ['insta', 'k1', 'k2', 'bedeckt']) await expect.poll(() => veil(s, id), { timeout: 60_000, intervals: [100] }).toBe('zensiert');
    await expect.poll(async () => (await knoepfe(s)).map((x) => x.id).sort().join(','), { timeout: 8000 }).toBe('insta,k1,k2');
    const rect = await s.evaluate(() => {
      const b = document.getElementById('karussell')!.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    });
    for (const k of (await knoepfe(s)).filter((x) => x.id !== 'insta')) {
      expect(k.x).toBeGreaterThanOrEqual(rect.l);
      expect(k.x + k.w).toBeLessThanOrEqual(rect.r);
      expect(k.y).toBeGreaterThanOrEqual(rect.t);
      expect(k.y + k.h).toBeLessThanOrEqual(rect.b);
    }
    console.log('chromium freilegen: Lagen ok (insta mit Knopf, Karussell beschnitten, bedeckt ohne Knopf)');
  } finally {
    await s.close();
  }
});

test('Ruhe: ohne Ereignis keine Dauermessung (Knopf bleibt, Frames ruhen)', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 8000 }).toBe(2);
    // Aufrufe von getBoundingClientRect zaehlen: nach dem Nachlauf duerfen es kaum noch welche sein
    await s.waitForTimeout(800);
    const zahl = await s.evaluate(async () => {
      let n = 0;
      const alt = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        n++;
        return alt.call(this);
      };
      await new Promise((ok) => setTimeout(ok, 1000));
      Element.prototype.getBoundingClientRect = alt;
      return n;
    });
    expect(zahl).toBeLessThan(10);
    console.log(`chromium freilegen: in 1 s Ruhe ${zahl} Messungen`);
  } finally {
    await s.close();
  }
});

test('Pack entfernt: offener Riegel schliesst, Freigelegtes ist sofort wieder zensiert', async () => {
  const s = await frischeSeite();
  try {
    await warteZensiert(s);
    await expect.poll(async () => (await knoepfe(s)).length, { timeout: 8000 }).toBe(2);
    await klickeMitte(s, (await knoepfe(s)).find((x) => x.id === 'a')!);
    await expect.poll(async () => (await riegel(s))?.zustand, { timeout: 15_000 }).toBe('frage');
    await entfernePack();
    await expect.poll(() => s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null), { timeout: 5000 }).toBe(false);
  } finally {
    await s.close();
  }
  await importierePack();
  // Preset ohne Pack-Bezug: mit einem Mia-Preset gilt nach dem Entfernen Mosaik, das Bild wird dann zu Recht neu zensiert (andere Fassung)
  await aendereEinstellungen({ preset: 'mosaik', quiz: { verweigern: 0, freilegenMs: 30000 } });
  const t = await frischeSeite();
  try {
    await warteZensiert(t);
    await expect.poll(async () => (await knoepfe(t)).some((x) => x.id === 'a'), { timeout: 8000 }).toBe(true);
    const quelle = await t.evaluate(() => document.getElementById('a')!.getAttribute('src'));
    await klickeMitte(t, (await knoepfe(t)).find((x) => x.id === 'a')!);
    await loeseRiegel(t);
    await expect.poll(() => veil(t, 'a'), { timeout: 8000 }).toBe('frei');
    await entfernePack();
    await expect.poll(() => veil(t, 'a'), { timeout: 3000 }).toBe('zensiert');
    expect(await t.evaluate(() => document.getElementById('a')!.getAttribute('src'))).toBe(quelle);
    console.log('chromium freilegen: Pack weg waehrend Freilegen, Bild sofort wieder zensiert (gleiche Fassung)');
  } finally {
    await aendereEinstellungen({ quiz: { freilegenMs: 3000 } });
    await t.close();
  }
});

test('Pack entfernt: Knoepfe sofort weg', async () => {
  // Session 18: der Fall davor endet ohne Pack; ohne eigenen Import hing dieser Fall daran, ob der Pack-Eintrag zufaellig zurueckkam.
  await importierePack();
  await aendereEinstellungen({ quiz: { verweigern: 0, freilegenMs: 3000 } });
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
