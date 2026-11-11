// Chromium: Lagewecker (src/schleier/lagewecker.ts). Verschiebt sich das Video ohne Groessenwechsel gegen den Bezug des Standbild-Hosts, liegt der
// Host spaetestens im zweiten Bild wieder genau darauf, ohne auf den Lage-Takt (400 ms) zu warten. Seite wie standbild.spec.ts.
// Gemessen wird in der Seite: Fall 1 und 2 im rAF des dritten Bildes nach der Aenderung (zeigt den Stand, der im zweiten Bild gemalt wurde),
// Fall 3 je Bild: ein ResizeObserver der Seite merkt das Rechteck des Videos nach dem Layout, im rAF des naechsten Bildes wird es mit dem Host
// verglichen, der dann noch so steht, wie er gemalt wurde (unabhaengig von der Reihenfolge der ResizeObserver-Rueckrufe).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://127.0.0.1:${port}/erwachsen-player.html`;
const EINST = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'], stufe: 'tease' } };

// Faelle unabhaengig (je eine eigene Seite): ein roter Fall ueberspringt die anderen nicht.

let profil: string;
let ordner: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';

const bauModul = '../../scripts/pack/baue-pack.mjs';

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-lagewecker-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-lagewecker-pack-'));
  const bau = (await import(bauModul)) as { baueDummyPack(o?: unknown): Promise<{ bytes: Uint8Array }> };
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`, '--autoplay-policy=no-user-gesture-required'],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  const s = await context.newPage();
  await s.goto(`chrome-extension://${erweiterungsId}/options.html`);
  await s.locator('#datei').setInputFiles(packPfad);
  await s.locator('#annehmen').click();
  await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
  await s.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
  await s.close();
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, EINST);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

type Wecker = { wach: boolean; anlaesse: number; bilder: number } | null;
const wecker = (s: Page): Promise<Wecker> =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-lagewecker');
    return a ? JSON.parse(a) : null;
  });

// Seite mit Standbild auf dem Hauptvideo, Fehler-Zaehler am Fenster, Wecker eingeschlafen.
async function seiteMitStandbild(): Promise<Page> {
  const s = await context.newPage();
  await s.goto(SEITE);
  await s.waitForFunction(() => document.documentElement.dataset.filmBereit === '1', null, { timeout: 30_000 });
  await s.evaluate(() => {
    (window as any).__fehler = [];
    addEventListener('error', (e) => (window as any).__fehler.push(String((e as ErrorEvent).message ?? e.type)));
    (window as any).neuesVideo({ id: 'haupt' });
  });
  await expect
    .poll(() => s.evaluate(() => document.querySelector('[data-veil-standbild]')?.getAttribute('data-veil-standbild-geladen') ?? null), { timeout: 15_000, intervals: [100] })
    .toBe('1');
  await expect.poll(async () => (await wecker(s))?.wach ?? false, { timeout: 5000, intervals: [100] }).toBe(false);
  return s;
}

// Fuehrt eine Aenderung aus und misst die Abweichung Host gegen Video (groesste von x, y, Breite, Hoehe) im rAF von Bild 1, 2 und 3 danach.
async function messeAenderung(s: Page, art: 'bezug' | 'block'): Promise<{ vorher: number; bilder: number[]; weg: number }> {
  return s.evaluate(async (a) => {
    const host = document.querySelector('[data-veil-standbild]') as HTMLElement;
    const v = document.querySelector('video') as HTMLVideoElement;
    const abw = () => {
      const h = host.getBoundingClientRect();
      const r = v.getBoundingClientRect();
      return Math.max(Math.abs(h.x - r.x), Math.abs(h.y - r.y), Math.abs(h.width - r.width), Math.abs(h.height - r.height));
    };
    const vorher = abw();
    if (a === 'bezug') document.getElementById('player')!.style.position = 'relative';
    else {
      const b = document.createElement('div');
      b.style.cssText = 'height:120px;background:#567';
      document.body.prepend(b);
    }
    // Abweichung sofort nach der Aenderung, im selben Task (erzwungenes Layout): kein Takt kann dazwischen legen, anders als bis zum ersten Bild.
    const weg = abw();
    const bilder: number[] = [];
    await new Promise<void>((fertig) => {
      const schritt = () => {
        bilder.push(abw());
        if (bilder.length < 3) requestAnimationFrame(schritt);
        else fertig();
      };
      requestAnimationFrame(schritt);
    });
    return { vorher, bilder, weg };
  }, art);
}

test('Belege: ResizeObserver meldet ein im rAF frisch beobachtetes Element im selben Bild (vor dem naechsten rAF)', async () => {
  const s = await context.newPage();
  await s.goto(SEITE);
  const ergebnis = await s.evaluate(async () => {
    const el = document.getElementById('player')!;
    let bild = 0;
    const gleich: boolean[] = [];
    let beobachtetIn = -1;
    const ro = new ResizeObserver(() => {
      if (beobachtetIn >= 0) gleich.push(bild === beobachtetIn);
      beobachtetIn = -1;
    });
    ro.observe(el);
    await new Promise<void>((fertig) => {
      const schritt = () => {
        bild++;
        if (bild > 1) {
          ro.unobserve(el);
          ro.observe(el);
          beobachtetIn = bild;
        }
        if (bild < 30) requestAnimationFrame(schritt);
        else fertig();
      };
      requestAnimationFrame(schritt);
    });
    return gleich;
  });
  await s.close();
  console.log(`chromium lagewecker: Rueckruf im selben Bild ${ergebnis.filter(Boolean).length} von ${ergebnis.length}`);
  expect(ergebnis.length).toBeGreaterThanOrEqual(25);
  expect(ergebnis.every(Boolean)).toBe(true);
});

test('A Fall 1: Player wird nach dem Legen zum Bezug, der Host liegt spaetestens im zweiten Bild genau auf dem Video', async () => {
  const s = await seiteMitStandbild();
  try {
    const m = await messeAenderung(s, 'bezug');
    console.log(`chromium lagewecker A: vorher ${m.vorher}, Bild 1..3 ${m.bilder.join(' ')}`);
    expect(m.vorher).toBeLessThanOrEqual(0.5);
    expect(m.weg, 'die Aenderung legt Host und Video wirklich auseinander').toBeGreaterThan(2);
    expect(m.bilder[2], 'Host im zweiten Bild genau auf dem Video').toBeLessThanOrEqual(0.5);
    // D: Ruhe. 1 s nach dem letzten Anlass schlaeft der Wecker, obwohl das Standbild steht und eben nachgelegt wurde.
    await s.waitForTimeout(1000);
    const w1 = await wecker(s);
    expect(w1?.wach, 'Wecker schlaeft 1 s nach dem letzten Anlass').toBe(false);
    await s.waitForTimeout(600);
    const w2 = await wecker(s);
    expect(w2?.wach).toBe(false);
    expect(w2?.bilder, 'kein rAF mehr in der Ruhe').toBe(w1?.bilder);
    console.log(`chromium lagewecker D: ${JSON.stringify(w2)}`);
    expect(await s.evaluate(() => (window as any).__fehler), 'E: kein error am Fenster').toEqual([]);
  } finally {
    await s.close();
  }
});

test('B Fall 2: Block ueber dem Video, Bezug weit oben, der Host liegt spaetestens im zweiten Bild genau auf dem Video', async () => {
  const s = await seiteMitStandbild();
  try {
    const m = await messeAenderung(s, 'block');
    console.log(`chromium lagewecker B: vorher ${m.vorher}, Bild 1..3 ${m.bilder.join(' ')}`);
    expect(m.vorher).toBeLessThanOrEqual(0.5);
    expect(m.weg, 'die Aenderung legt Host und Video wirklich auseinander').toBeGreaterThan(2);
    expect(m.bilder[2], 'Host im zweiten Bild genau auf dem Video').toBeLessThanOrEqual(0.5);
    expect(await s.evaluate(() => (window as any).__fehler), 'E: kein error am Fenster').toEqual([]);
  } finally {
    await s.close();
  }
});

test('C Fall 3: CSS-Uebergang von 300 ms, je Bild gemessen hoechstens 1 Pixel Abweichung', async () => {
  const s = await seiteMitStandbild();
  try {
    const m = await s.evaluate(async () => {
      const host = document.querySelector('[data-veil-standbild]') as HTMLElement;
      const v = document.querySelector('video') as HTMLVideoElement;
      const p = document.getElementById('player')!;
      const werte: number[] = [];
      const lagen: number[] = [];
      // Rechteck des Videos nach dem Layout (so wird es gemalt); verglichen wird im rAF des naechsten Bildes mit dem Host, der dann noch so steht, wie
      // er gemalt wurde. Unabhaengig von der Reihenfolge der ResizeObserver-Rueckrufe.
      let gemalt: DOMRect | null = null;
      const ro = new ResizeObserver(() => {
        gemalt = v.getBoundingClientRect();
        lagen.push(Math.round(gemalt.x));
      });
      let laeuft = true;
      p.addEventListener('transitionend', () => (laeuft = false), { once: true });
      p.style.transition = 'margin-left 300ms linear';
      void p.offsetWidth;
      p.style.marginLeft = '200px';
      let nach = 0;
      await new Promise<void>((fertig) => {
        const schritt = () => {
          if (gemalt) {
            const h = host.getBoundingClientRect();
            const r: DOMRect = gemalt;
            werte.push(Math.max(Math.abs(h.x - r.x), Math.abs(h.y - r.y), Math.abs(h.width - r.width), Math.abs(h.height - r.height)));
            gemalt = null;
          }
          ro.unobserve(v);
          ro.observe(v);
          if (!laeuft && ++nach > 3) return fertig();
          requestAnimationFrame(schritt);
        };
        requestAnimationFrame(schritt);
      });
      return { werte, weg: lagen.length ? lagen[lagen.length - 1]! - lagen[0]! : 0, bilder: werte.length };
    });
    const max = Math.max(...m.werte);
    console.log(`chromium lagewecker C: ${m.bilder} Bilder, Weg ${m.weg} px, groesste Abweichung ${max}`);
    expect(m.bilder).toBeGreaterThan(8);
    expect(m.weg, 'der Uebergang bewegt das Video').toBeGreaterThan(150);
    expect(max, 'groesste Abweichung je Bild').toBeLessThanOrEqual(1);
    expect(await s.evaluate(() => (window as any).__fehler), 'E: kein error am Fenster').toEqual([]);
  } finally {
    await s.close();
  }
});
