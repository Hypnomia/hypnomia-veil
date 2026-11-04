// Chromium: Auftrag E (PHASE-4-BAUPLAN Abschnitt 8). Vorschau-Tausch auf Erwachsenenseiten (Nachbauten, synthetische Bilder), Waechter 0 Aufblitzen,
// Pause stellt Originale zurueck, Lazy-Load, srcset und Quellwechsel, ohne Pack keine Aenderung, Erkennen am Inhalt (Testbilder ../05 Testbilder),
// Pack-Bilder ueber den Erkenner (packbild). Die Erwachsenenseiten laufen auf *.veil-erwachsen.test (nur im Testbau), aufgeloest auf den
// Testserver. Pack ueber die Einstellungsseite importiert, Einstellungen ueber storage.local.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const seite = (name: string, datei: string) => `http://${name}.veil-erwachsen.test:${port}/${datei}`;
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean; id?: string }): Promise<{ bytes: Uint8Array; vorschauFarben: number[][] }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let altPackPfad: string;
let vorschauFarben: number[][] = [];
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-erwachsen-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-erwachsen-pack-'));
  const bau = await ladeBau();
  const voll = await bau.baueDummyPack();
  vorschauFarben = voll.vorschauFarben;
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, voll.bytes);
  // Pack wie vor 0.4.0: nur Patches, keine Freischaltung fuer Vorschau und Quiz.
  altPackPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPackPfad, (await bau.baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${erweiterung}`,
      `--load-extension=${erweiterung}`,
      '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const loescheEinstellungen = () => worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstellungen'));

async function importierePack(pfad: string) {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(pfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
  } finally {
    await s.close();
  }
}

async function entfernePack() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    if (await s.locator('#entfernen').isVisible()) {
      await s.locator('#entfernen').click();
      await s.locator('#entfernen-ja').click();
      await expect(s.locator('#entfernen')).toBeHidden({ timeout: 15_000 });
    }
  } finally {
    await s.close();
  }
}

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

interface ElementStand {
  id: string;
  veil: string | null;
  src: string;
  hg: string;
  opacity: string;
}
const stand = (s: Page, ids: string[]): Promise<ElementStand[]> =>
  s.evaluate(
    (liste) =>
      liste.map((id) => {
        const el = document.getElementById(id) as HTMLElement | null;
        if (!el) return { id, veil: 'FEHLT', src: '', hg: '', opacity: '' };
        return {
          id,
          veil: el.getAttribute('data-veil'),
          src: el instanceof HTMLImageElement ? el.getAttribute('src') ?? '' : '',
          hg: el.style.getPropertyValue('background-image'),
          opacity: getComputedStyle(el).opacity,
        };
      }),
    ids,
  );
const erwachsenStand = (s: Page): Promise<any> =>
  s.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-veil-erwachsen') ?? 'null'));

const istPackBild = (e: ElementStand) => e.veil === 'zensiert' && (e.src.startsWith('data:image/jpeg') || e.hg.includes('data:image/jpeg'));

async function warteAufTausch(s: Page, ids: string[], timeout = 30_000) {
  try {
    await expect.poll(async () => (await stand(s, ids)).every(istPackBild), { timeout, intervals: [100] }).toBe(true);
  } catch (e) {
    console.log(`DIAG ${JSON.stringify((await stand(s, ids)).map((e) => `${e.id}:${e.veil}:${e.src.slice(0, 22)}`))} ${await s.evaluate(() => document.documentElement.getAttribute('data-veil-erwachsen'))}`);
    throw e;
  }
}
async function warteAufUrteile(s: Page, ids: string[], timeout = 30_000) {
  await expect.poll(async () => (await stand(s, ids)).every((e) => e.veil !== null), { timeout, intervals: [100] }).toBe(true);
}

// Mittelfarben von neun Punkten eines Bildes (data:-Bild, nicht verschmutzt) und Anteil nahe an den Vorschau-Farben des Packs.
async function anteilPackFarben(s: Page, id: string): Promise<number> {
  return s.evaluate(
    async ({ id, farben }) => {
      const el = document.getElementById(id) as HTMLImageElement;
      const b = new Image();
      b.src = el.src;
      await b.decode();
      const c = document.createElement('canvas');
      c.width = b.naturalWidth;
      c.height = b.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(b, 0, 0);
      let nah = 0;
      let n = 0;
      for (const fx of [0.2, 0.5, 0.8]) {
        for (const fy of [0.2, 0.5, 0.8]) {
          const p = ctx.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data;
          n++;
          if (farben.some((f) => Math.hypot(p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!) < 90)) nah++;
        }
      }
      return nah / n;
    },
    { id, farben: vorschauFarben },
  );
}

const waechter = (s: Page) => s.evaluate(() => ({ aufblitzen: (window as any).__aufblitzen as number, unsichtbar: (window as any).__unsichtbar as number, proben: (window as any).__proben as number, wer: (window as any).__wer as string[] }));

const SEITEN = [
  { name: 'pornhub', datei: 'erwachsen-pornhub.html', karten: 6, video: true },
  { name: 'xhamster', datei: 'erwachsen-xhamster.html', karten: 6, video: true },
  { name: 'xvideos', datei: 'erwachsen-xvideos.html', karten: 6, video: true },
  { name: 'xnxx', datei: 'erwachsen-xvideos.html', karten: 6, video: true },
  { name: 'onlyfans', datei: 'erwachsen-onlyfans.html', karten: 4, video: true },
  { name: 'fansly', datei: 'erwachsen-fansly.html', karten: 4, video: true },
];
const vorschauIds = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

test.beforeEach(async () => {
  await loescheEinstellungen();
});

test('Aufwaermen: der Erkenner antwortet; ohne Pack liefert packbild nichts', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await warteAufErkenner();
  const vorschau = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'x' });
  expect(vorschau.ok).toBe(false);
  const chibi = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'jubeln' });
  // Ohne Pack und ohne Demo-Chibi im Bau: kein Bild (mit Demo-Chibis ein Bild aus der Erweiterung).
  console.log(`chromium E: ohne Pack packbild vorschau ok=${vorschau.ok}, chibi ok=${chibi.ok}`);
  const unbekannt = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'gibt-es-nicht' });
  expect(unbekannt.ok).toBe(false);
});

test('ohne Pack aendert sich nichts: Vorschaubilder gehen den normalen Weg (frei), die Originale bleiben', async () => {
  test.setTimeout(60_000);
  const s = await context.newPage();
  await s.goto(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(s, [...vorschauIds(6), 'logo', 'avatar']);
  for (const e of await stand(s, vorschauIds(6))) {
    expect(e.veil, e.id).toBe('frei');
    expect(e.src, e.id).toMatch(/^\/synthetisch\/\d+\.png$/);
  }
  expect((await waechter(s)).aufblitzen).toBe(0);
  await s.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack(packPfad);
});

for (const ort of SEITEN) {
  test(`${ort.name}: jedes Vorschaubild wird ersetzt, Logo und Avatar nicht, Hover-Video versteckt, 0 Aufblitzen`, async () => {
    test.setTimeout(60_000);
    const s = await context.newPage();
    await s.goto(seite(ort.name, ort.datei));
    const ids = vorschauIds(ort.karten);
    await warteAufTausch(s, ids);
    const alle = await stand(s, ids);
    const ersetzt = alle.filter(istPackBild).length;
    console.log(`chromium E ${ort.name}: ${ersetzt} von ${ids.length} Vorschaubildern ersetzt`);
    expect(ersetzt).toBe(ids.length);
    // Pack-Farben auf dem Bild (nicht nur irgendein Data-URL)
    expect(await anteilPackFarben(s, 'v1')).toBeGreaterThanOrEqual(0.7);
    // Logo und Avatar (kleiner als 80 px bzw. Link auf die Startseite) gehen den normalen Weg
    const rest = await stand(s, ['avatar']);
    await expect.poll(async () => (await stand(s, ['avatar']))[0]!.veil, { timeout: 20_000 }).toBe('frei');
    expect(rest[0]!.src).toMatch(/^\/synthetisch\//);
    if (ort.name !== 'onlyfans' && ort.name !== 'fansly') {
      await expect.poll(async () => (await stand(s, ['logo']))[0]!.veil, { timeout: 20_000 }).toBe('frei');
    }
    if (ort.name === 'onlyfans' || ort.name === 'fansly') {
      // Avatar ab 80 px in einem Profil-Link ist kein Beitragsmedium; ein Beitragsvideo mit Bedienelementen wird nicht versteckt
      await expect.poll(async () => (await stand(s, ['avatar-gross']))[0]!.veil, { timeout: 20_000 }).toBe('frei');
      expect((await stand(s, ['avatar-gross']))[0]!.src).toMatch(/^\/synthetisch\//);
      await expect.poll(async () => (await stand(s, ['beitrag-video']))[0]!.veil, { timeout: 20_000 }).not.toBeNull();
    }
    // Eingesetzte Vorschauen tragen ein eigenes Kennzeichen und die tatsaechliche Quelle ist das Pack-Bild
    expect(await s.evaluate(() => Array.from(document.querySelectorAll('img.vorschau, .post-media img, .b-post__media img')).every((i) => i.hasAttribute('data-veil-ersetzt') && (i as HTMLImageElement).currentSrc.startsWith('data:image/jpeg')))).toBe(true);
    // Hover-Vorschauvideo: nie ein Urteil, bleibt durch Hide-first unsichtbar
    const h = (await stand(s, ['h1']))[0]!;
    expect(h.veil).toBeNull();
    expect(h.opacity).toBe('0');
    await abwarten(300);
    const w = await waechter(s);
    console.log(`chromium E ${ort.name}: Waechter ${w.proben} Proben, ${w.aufblitzen} Aufblitzen, ${w.unsichtbar} unsichtbar`);
    expect(w.aufblitzen, w.wer.join('; ')).toBe(0);
    expect(w.unsichtbar, w.wer.join('; ')).toBe(0);
    const st = await erwachsenStand(s);
    expect(st.liste).toBe(ort.name);
    expect(st.tausch).toBe(true);
    expect(st.amInhalt).toBe(false);
    await s.close();
  });
}

test('dynamisch: Lazy-Load, picture/srcset, Quellwechsel, Inline-Hintergrund, Seitenverhaeltnis, gleiche Quelle ein Abruf', async () => {
  test.setTimeout(90_000);
  const s = await context.newPage();
  await s.goto(seite('x', 'erwachsen-dynamisch.html'));
  const tausch = ['lazy', 'pimg', 'wechsel', 'hg', 'breit-img'];
  await warteAufTausch(s, tausch);
  // Lazy-Load: die Seite setzt nach 800 ms die echte Adresse; am Ende steht das Pack-Bild, nicht die Seitenquelle
  await expect.poll(async () => (await stand(s, ['lazy']))[0]!.src.startsWith('data:image/jpeg'), { timeout: 10_000 }).toBe(true);
  await abwarten(1200);
  expect((await stand(s, ['lazy']))[0]).toMatchObject({ veil: 'zensiert' });
  expect((await stand(s, ['lazy']))[0]!.src).toMatch(/^data:image\/jpeg/);
  // picture: die source darf nichts mehr liefern
  const pic = await s.evaluate(() => ({
    srcset: document.getElementById('pq')!.getAttribute('srcset'),
    aktuell: (document.getElementById('pimg') as HTMLImageElement).currentSrc.slice(0, 15),
    srcsetImg: document.getElementById('pimg')!.getAttribute('srcset'),
  }));
  expect(pic.srcset).toBeNull();
  expect(pic.srcsetImg).toBeNull();
  expect(pic.aktuell).toBe('data:image/jpeg');
  // Inline-Hintergrund
  const hg = (await stand(s, ['hg']))[0]!;
  expect(hg.veil).toBe('zensiert');
  expect(hg.hg).toContain('data:image/jpeg');
  const hgStil = await s.evaluate(() => getComputedStyle(document.getElementById('hg')!).backgroundSize);
  expect(hgStil).toBe('cover');
  // Seitenverhaeltnis der Flaeche: 300 x 225 (4:3) bleibt, das Pack-Bild (16:9) fuellt per object-fit
  const kasten = await s.evaluate(() => {
    const r = document.getElementById('breit-img')!.getBoundingClientRect();
    return { b: r.width, h: r.height, fit: getComputedStyle(document.getElementById('breit-img')!).objectFit };
  });
  console.log(`chromium E: Flaeche ${kasten.b} x ${kasten.h}, object-fit ${kasten.fit}`);
  expect(kasten.fit).toBe('cover');
  expect(Math.abs(kasten.b / kasten.h - 4 / 3)).toBeLessThan(0.02);
  // Sprite mit background-position: Hintergrund getauscht (berechneter Wert), Position mittig statt Sprite-Versatz
  await expect.poll(async () => istPackBild((await stand(s, ['spr']))[0]!), { timeout: 10_000 }).toBe(true);
  expect(await s.evaluate(() => { const c = getComputedStyle(document.getElementById('spr')!); return [c.backgroundImage.startsWith('url("data:image/jpeg'), c.backgroundPosition]; })).toEqual([true, '50% 50%']);
  // Shadow Root
  await expect.poll(async () => s.evaluate(() => { const i = document.getElementById('schatten')!.shadowRoot!.getElementById('s-img') as HTMLImageElement; return i.getAttribute('data-veil') === 'zensiert' && i.currentSrc.startsWith('data:image/jpeg'); }), { timeout: 15_000 }).toBe(true);
  // eingefuegte source: die Seite fuegt nach dem Tausch eine source ein, currentSrc bleibt das Pack-Bild
  await expect.poll(async () => istPackBild((await stand(s, ['qimg']))[0]!), { timeout: 10_000 }).toBe(true);
  await s.evaluate(() => (window as any).fuegeSourceEin());
  await expect.poll(async () => s.evaluate(() => { const i = document.getElementById('qimg') as HTMLImageElement; return i.getAttribute('data-veil') === 'zensiert' && i.currentSrc.startsWith('data:image/jpeg'); }), { timeout: 10_000 }).toBe(true);
  expect(await s.evaluate(() => document.querySelector('#qpic source')!.getAttribute('srcset'))).toBeNull();
  // Stummes Video in einem Link bleibt versteckt, bekommt es Ton, wird es normal geprueft
  expect((await stand(s, ['stumm-video']))[0]).toMatchObject({ veil: null, opacity: '0' });
  await s.evaluate(() => (window as any).tonAn());
  await expect.poll(async () => (await stand(s, ['stumm-video']))[0]!.veil, { timeout: 15_000 }).not.toBeNull();
  // Beitragsvideo mit Bedienelementen: wird nicht als Hover-Vorschau versteckt
  await expect.poll(async () => (await stand(s, ['player-video']))[0]!.veil, { timeout: 15_000 }).not.toBeNull();
  // Shadow Root am Host im Link (Light DOM)
  await expect.poll(async () => s.evaluate(() => { const i = document.getElementById('host2')!.shadowRoot!.getElementById('s2-img') as HTMLImageElement; return i.getAttribute('data-veil') === 'zensiert' && i.currentSrc.startsWith('data:image/jpeg'); }), { timeout: 15_000 }).toBe(true);
  // Vorschau-Rotation: die Seite setzt alle 120 ms eine neue src; die Karte bleibt durchgehend das Pack-Bild (nie leer, nie Original)
  await s.evaluate(() => (window as any).rotiere());
  await expect.poll(() => s.evaluate(() => (window as any).__rotFertig === true), { timeout: 10_000 }).toBe(true);
  const rot = await s.evaluate(() => (window as any).__rotLog as string[]);
  const schlecht = rot.filter((x) => !x.startsWith('zensiert|data:image/jpeg|1'));
  console.log(`chromium E: Rotation ${rot.length} Proben, ${schlecht.length} davon nicht Pack-Bild`);
  expect(schlecht, schlecht.slice(0, 3).join('; ')).toEqual([]);
  // Zu klein, Link auf die Startseite (auch absolut), fremde Werbung, kein Link: normaler Weg
  await warteAufUrteile(s, ['klein', 'logo', 'frei-stehend', 'logo-abs', 'werbung']);
  for (const e of await stand(s, ['klein', 'logo', 'frei-stehend', 'logo-abs', 'werbung'])) {
    expect(e.veil, e.id).toBe('frei');
    expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  }
  // Quellwechsel: die Seite setzt eine neue Adresse, das Pack-Bild kommt neu
  const vorher = (await erwachsenStand(s)).abrufe as number;
  await s.evaluate(() => (window as any).wechsle());
  await abwarten(150);
  await expect.poll(async () => istPackBild((await stand(s, ['wechsel']))[0]!), { timeout: 10_000 }).toBe(true);
  expect((await stand(s, ['wechsel']))[0]!.src).not.toContain('36.png');
  // Gleiche Quelle = ein Abruf: zwanzig neue Bilder mit derselben Adresse
  await s.evaluate(() => (window as any).fuegeGleicheEin(20));
  await expect
    .poll(async () => (await s.evaluate(() => Array.from(document.querySelectorAll('#gleiche img')).every((i) => (i.getAttribute('src') ?? '').startsWith('data:image/jpeg')))), { timeout: 20_000 })
    .toBe(true);
  const nachher = await erwachsenStand(s);
  console.log(`chromium E: Abrufe ${vorher} -> ${nachher.abrufe} nach Quellwechsel und 20 gleichen Bildern, ${nachher.bilder} Bilder, ${nachher.bytes} Zeichen im Zwischenspeicher`);
  expect(nachher.abrufe - vorher).toBeLessThanOrEqual(1); // gleiche Video-Kennung = ein Abruf, der Quellwechsel desselben Videos holt nichts neu
  expect(nachher.bilder).toBeLessThanOrEqual(4);
  const w = await waechter(s);
  expect(w.aufblitzen, w.wer.join('; ')).toBe(0);
  await s.close();
});

test('Pause stellt die Originale sofort zurueck, das Ende der Pause tauscht wieder', async () => {
  test.setTimeout(90_000);
  const s = await context.newPage();
  await s.goto(seite('x', 'erwachsen-dynamisch.html'));
  const tausch = ['lazy', 'pimg', 'wechsel', 'hg', 'breit-img'];
  await warteAufTausch(s, tausch);
  await abwarten(1200);
  await setzeEinstellungen({ pause: true });
  await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 5000 }).toBe('aus');
  const zurueck = await s.evaluate(() => ({
    lazy: document.getElementById('lazy')!.getAttribute('src'),
    pimg: document.getElementById('pimg')!.getAttribute('src'),
    pqSrcset: document.getElementById('pq')!.getAttribute('srcset'),
    wechsel: document.getElementById('wechsel')!.getAttribute('src'),
    hg: (document.getElementById('hg') as HTMLElement).style.getPropertyValue('background-image'),
    hgGroesse: (document.getElementById('hg') as HTMLElement).style.getPropertyValue('background-size'),
    fit: (document.getElementById('breit-img') as HTMLElement).style.getPropertyValue('object-fit'),
    ratio: (document.getElementById('breit-img') as HTMLElement).style.getPropertyValue('aspect-ratio'),
    breit: document.getElementById('breit-img')!.getAttribute('src'),
  }));
  console.log(`chromium E: nach Pause ${JSON.stringify(zurueck)}`);
  expect(zurueck.lazy).toBe('/synthetisch/31.png');
  expect(zurueck.pimg).toBe('/synthetisch/34.png');
  expect(zurueck.pqSrcset).toBe('/synthetisch/32.png 1x, /synthetisch/33.png 2x');
  expect(zurueck.wechsel).toMatch(/\/synthetisch\/3[56]\.png$/);
  expect(zurueck.hg).toContain('/synthetisch/37.png');
  expect(zurueck.hgGroesse).toBe('');
  expect(zurueck.fit).toBe('');
  expect(zurueck.ratio).toBe('');
  expect(zurueck.breit).toBe('/synthetisch/41.png');
  // Ende der Pause: wieder getauscht
  await setzeEinstellungen({ pause: false });
  await warteAufTausch(s, tausch, 30_000);
  const w = await waechter(s);
  expect(w.aufblitzen, w.wer.join('; ')).toBe(0);
  await s.close();
});

test('Schalter erwachsen.an aus: kein Tausch, normaler Schleier', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen({ erwachsen: { an: false, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  const s = await context.newPage();
  await s.goto(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(s, vorschauIds(6));
  for (const e of await stand(s, vorschauIds(6))) {
    expect(e.veil, e.id).toBe('frei');
    expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  }
  await s.close();
});

test('eigene Seite des Nutzers (allgemeiner Rueckfall) wird getauscht, andere Hosts nicht', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } });
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-xvideos.html`);
  await warteAufTausch(s, vorschauIds(6));
  expect((await erwachsenStand(s))?.liste).toBe('allgemein');
  await s.close();
  // dieselbe Seite ohne die Eintragung: kein Tausch
  await loescheEinstellungen();
  const t = await context.newPage();
  await t.goto(`${basis}/erwachsen-xvideos.html`);
  await warteAufUrteile(t, vorschauIds(6));
  for (const e of await stand(t, vorschauIds(6))) expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  await t.close();
});

test('Pack-Bilder: stabile Wahl je Schluessel, Vorschau als JPEG bis 480 px, Chibi mit Transparenz', async () => {
  test.setTimeout(60_000);
  const a1 = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'https://bilder.example/a.jpg' });
  const a2 = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'https://bilder.example/a.jpg' });
  expect(a1.ok).toBe(true);
  expect(a1.dataUrl.startsWith('data:image/jpeg')).toBe(true);
  expect(Math.max(a1.breite, a1.hoehe)).toBeLessThanOrEqual(480);
  expect(a1.dataUrl.length).toBeLessThanOrEqual(600_000);
  expect(a2.name).toBe(a1.name);
  const namen = new Set<string>();
  for (let i = 0; i < 40; i++) namen.add((await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: `quelle-${i}` })).name);
  console.log(`chromium E: 40 Quellen verteilen sich auf ${namen.size} von 4 Vorschau-Bildern`);
  expect(namen.size).toBeGreaterThanOrEqual(3);
  // kleiner maxSeite-Wunsch wird beachtet
  const klein = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'klein', maxSeite: 100 });
  expect(Math.max(klein.breite, klein.hoehe)).toBeLessThanOrEqual(100);
  // Chibi: Pack-Chibi (Pose jubeln), Ecken durchsichtig
  const chibi = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'jubeln' });
  expect(chibi.ok).toBe(true);
  expect(chibi.name).toContain('jubeln');
  expect(chibi.dataUrl).toMatch(/^data:image\/(webp|png)/);
  expect(Math.max(chibi.breite, chibi.hoehe)).toBeLessThanOrEqual(512);
  const s = await context.newPage();
  await s.goto(optionsUrl());
  const alpha = await s.evaluate(async (url) => {
    const b = new Image();
    b.src = url;
    await b.decode();
    const c = document.createElement('canvas');
    c.width = b.naturalWidth;
    c.height = b.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(b, 0, 0);
    return { ecke: ctx.getImageData(0, 0, 1, 1).data[3], mitte: ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] };
  }, chibi.dataUrl);
  expect(alpha).toEqual({ ecke: 0, mitte: 255 });
  await s.close();
  // Pose ohne Datei im Pack und ohne Demo-Chibi, unbekannte Pose, fehlender Schluessel: ok false
  expect((await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'gibt-es-nicht' })).ok).toBe(false);
  expect((await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: '' })).ok).toBe(false);
});

test('Erkennen am Inhalt: Testbilder aus dem Satz nsfw machen die Seite zur Erwachsenenseite, aber ohne Tausch; Seitenwechsel beginnt neu', async () => {
  test.skip(OHNE_TESTBILDER, 'VEIL_OHNE_TESTBILDER=1');
  test.setTimeout(180_000);
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-inhalt.html?satz=nsfw&n=16`);
  await expect.poll(async () => (await erwachsenStand(s))?.amInhalt, { timeout: 120_000, intervals: [250] }).toBe(true);
  const st = await erwachsenStand(s);
  console.log(`chromium E: am Inhalt erkannt nach ${JSON.stringify(st.zaehlung)} (Liste ${st.liste})`);
  expect(st.liste).toBeNull();
  expect(st.tausch).toBe(false);
  expect(st.zaehlung.gesamt).toBeGreaterThanOrEqual(12);
  expect(st.zaehlung.treffer / st.zaehlung.gesamt).toBeGreaterThanOrEqual(0.5);
  // Kein Vorschau-Tausch: kein Bild ist mit den Pack-Farben gefuellt
  const lila = await s.evaluate(
    async (farben) => {
      let n = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLImageElement>('#bilder img'))) {
        if (!el.src.startsWith('data:')) continue;
        const b = new Image();
        b.src = el.src;
        await b.decode();
        const c = document.createElement('canvas');
        c.width = b.naturalWidth;
        c.height = b.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(b, 0, 0);
        const p = ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        if (farben.some((f) => Math.hypot(p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!) < 40)) n++;
      }
      return n;
    },
    vorschauFarben,
  );
  expect(lila).toBe(0);
  // Seitenwechsel ohne Neuladen: die Erkennung beginnt neu
  await s.locator('#wechsel').click();
  await expect.poll(async () => (await erwachsenStand(s))?.amInhalt, { timeout: 5000, intervals: [100] }).toBe(false);
  // Neue Ansicht (Seitenwechsel mit neuen Bildern): wird neu erkannt
  await s.locator('#neu').click();
  await expect.poll(async () => (await erwachsenStand(s))?.amInhalt, { timeout: 120_000, intervals: [250] }).toBe(true);
  await s.close();
});

test('Erkennen am Inhalt: Satz sfw bleibt unauffaellig; mit erkennenAmInhalt aus nie erkannt', async () => {
  test.skip(OHNE_TESTBILDER, 'VEIL_OHNE_TESTBILDER=1');
  test.setTimeout(180_000);
  const s = await context.newPage();
  await s.goto(`${basis}/erwachsen-inhalt.html?satz=sfw&n=16`);
  await expect.poll(async () => ((await erwachsenStand(s))?.zaehlung?.gesamt ?? 0) >= 12, { timeout: 120_000, intervals: [250] }).toBe(true);
  expect((await erwachsenStand(s)).amInhalt).toBe(false);
  await s.close();
  await setzeEinstellungen({ erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: false, eigeneSeiten: [] } });
  const t = await context.newPage();
  await t.goto(`${basis}/erwachsen-inhalt.html?satz=nsfw&n=16`);
  await expect.poll(async () => (await t.evaluate(() => document.documentElement.getAttribute('data-bilder-da'))) !== null, { timeout: 20_000 }).toBe(true);
  await abwarten(15_000);
  const st = await erwachsenStand(t);
  expect(st?.amInhalt ?? false).toBe(false);
  expect(st?.zaehlung?.gesamt ?? 0).toBe(0);
  await t.close();
});

// Pack, dessen einziges Vorschaubild einen gueltigen Kopf, aber abgeschnittene Bilddaten hat: der Erkenner kann es nicht dekodieren.
async function baueKaputtesPack(): Promise<string> {
  const { default: sharp } = await import('sharp');
  const quelle = path.join(ordner, 'kaputt');
  await mkdir(path.join(quelle, 'vorschau'), { recursive: true });
  const voll = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 120, g: 30, b: 200 } } }).webp({ quality: 90 }).toBuffer();
  await writeFile(path.join(quelle, 'vorschau', 'kaputt.webp'), voll.subarray(0, Math.min(voll.length - 1, 40)));
  await writeFile(path.join(quelle, 'lizenz.txt'), 'Test pack, synthetic pictures only.\n');
  await writeFile(
    path.join(quelle, 'pack.json'),
    JSON.stringify({ id: 'kaputt', version: '0.0.1', titel: 'Broken test pack', lizenz: 'lizenz.txt', freischaltungen: ['erwachsen:vorschau'], dateien: [{ name: 'lizenz.txt' }, { name: 'vorschau/kaputt.webp', rolle: 'vorschau', stufe: 'explicit' }] }),
  );
  const bau = (await import('../../scripts/pack/baue-pack.mjs' as string)) as { bauePackAusOrdner(q: string): Promise<Uint8Array> };
  const pfad = path.join(ordner, 'kaputt.miapack');
  await writeFile(pfad, await bau.bauePackAusOrdner(quelle));
  return pfad;
}

test('kein Bild lesbar (Pack mit defektem Vorschaubild): normaler Schleier, Urteil da, 0 Aufblitzen, kein Tausch', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await importierePack(await baueKaputtesPack());
  const s = await context.newPage();
  await s.goto(seite('pornhub', 'erwachsen-kaputt.html'));
  await warteAufUrteile(s, ['v1', 'v2'], 40_000);
  for (const e of await stand(s, ['v1', 'v2'])) {
    expect(e.veil, e.id).toBe('frei');
    expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  }
  const st = await erwachsenStand(s);
  console.log(`chromium E: defektes Pack ${JSON.stringify({ fehlgeschlagen: st.fehlgeschlagen, gruende: st.gruende, abrufe: st.abrufe })}`);
  expect(st.fehlgeschlagen).toBeGreaterThanOrEqual(1);
  expect(st.gruende).toContain('kein Bild');
  expect(st.abrufe).toBeLessThanOrEqual(2); // ohneVorschau: kein erneutes Anfragen in einer Schleife
  await abwarten(500);
  const w = await waechter(s);
  expect(w.aufblitzen, w.wer.join('; ')).toBe(0);
  await s.close();
});

test('Chibi: ohne Pack kommt das Demo-Chibi aus der Erweiterung (wenn mitgebaut), mit anderem Pack andere Vorschau-Bilder', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  const demoDa = existsSync(path.join(erweiterung, 'chibi', 'jubeln.webp'));
  const demo = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'jubeln' });
  console.log(`chromium E: Demo-Chibi im Bau ${demoDa}, Antwort ok=${demo.ok}`);
  expect(demo.ok).toBe(demoDa);
  if (demoDa) expect(demo.dataUrl).toMatch(/^data:image\/(webp|png)/);
  // Anderes Pack (einfarbig gruen): die Seite zeigt danach gruene statt der lila-orangen Bilder
  const { default: sharp } = await import('sharp');
  const quelle = path.join(ordner, 'gruen');
  await mkdir(path.join(quelle, 'vorschau'), { recursive: true });
  const gruen = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 0, g: 200, b: 0 } } }).webp({ lossless: true }).toBuffer();
  await writeFile(path.join(quelle, 'vorschau', 'gruen.webp'), gruen);
  await writeFile(path.join(quelle, 'lizenz.txt'), 'Test pack, synthetic pictures only.\n');
  await writeFile(
    path.join(quelle, 'pack.json'),
    JSON.stringify({
      id: 'gruen', version: '0.0.1', titel: 'Green test pack', lizenz: 'lizenz.txt', freischaltungen: ['erwachsen:vorschau'],
      dateien: [{ name: 'lizenz.txt' }, { name: 'vorschau/gruen.webp', rolle: 'vorschau', stufe: 'explicit' }],
    }),
  );
  const bau = (await import('../../scripts/pack/baue-pack.mjs' as string)) as { bauePackAusOrdner(q: string): Promise<Uint8Array> };
  const gruenPfad = path.join(ordner, 'gruen.miapack');
  await writeFile(gruenPfad, await bau.bauePackAusOrdner(quelle));
  await importierePack(gruenPfad);
  const s = await context.newPage();
  await s.goto(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufTausch(s, vorschauIds(6));
  const farbe = await s.evaluate(async () => {
    const el = document.getElementById('v1') as HTMLImageElement;
    const b = new Image();
    b.src = el.src;
    await b.decode();
    const c = document.createElement('canvas');
    c.width = b.naturalWidth;
    c.height = b.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(b, 0, 0);
    return Array.from(ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data);
  });
  console.log(`chromium E: neues Pack, Mittelpunkt ${farbe.slice(0, 3)}`);
  expect(farbe[1]).toBeGreaterThan(150);
  expect(farbe[0]).toBeLessThan(60);
  await s.close();
});

test('Pack ohne Vorschau-Freischaltung (wie vor 0.4.0): kein Tausch, kein Erkennen', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  await importierePack(altPackPfad);
  const s = await context.newPage();
  await s.goto(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(s, vorschauIds(6));
  for (const e of await stand(s, vorschauIds(6))) {
    expect(e.veil, e.id).toBe('frei');
    expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  }
  const st = await erwachsenStand(s);
  expect(st.liste).toBe('pornhub'); // die Seite steht auf der Liste ...
  expect(st.tausch).toBe(false); // ... getauscht wird ohne Freischaltung nichts
  await s.close();
});

test('Pack entfernt: die Seite geht wieder den normalen Weg', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  const s = await context.newPage();
  await s.goto(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(s, vorschauIds(6));
  for (const e of await stand(s, vorschauIds(6))) expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  await s.close();
});

test('Pack kommt waehrend die Seite offen ist: die Seite tauscht sofort, Entfernen stellt zurueck', async () => {
  test.setTimeout(120_000);
  const s = await context.newPage();
  await s.goto(seite('xhamster', 'erwachsen-xhamster.html'));
  await warteAufUrteile(s, vorschauIds(6));
  for (const e of await stand(s, vorschauIds(6))) expect(e.src, e.id).toMatch(/^\/synthetisch\//);
  await importierePack(packPfad);
  await warteAufTausch(s, vorschauIds(6), 40_000);
  await entfernePack();
  await expect
    .poll(async () => (await stand(s, vorschauIds(6))).every((e) => /^\/synthetisch\//.test(e.src) && e.veil !== null), { timeout: 30_000, intervals: [200] })
    .toBe(true);
  await s.close();
});
