// Chromium: Auftrag W (PHASE-5-AUFTRAEGE-SESSION-9 Abschnitt 3). Werbe-Tausch: Werbeflaechen werden Mias Werbung (Dummy: Rot mit Dunkelgrau oder
// Weiss), gekennzeichnet, klickbar auf einen Link der Marke, normale Bilder in Werbegroesse bleiben. Pause, Schalter, Ausnahme und fehlendes
// Pack geben die Originale sofort zurueck. Test-Werbe-Host: *.veil-werbung.test, Erwachsenenseite: *.veil-erwachsen.test (beide nur im Testbau).
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import sharp from 'sharp';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47175);
const nachrichten = `http://127.0.0.1:${port}/werbung-nachrichten.html?fremd=${portFremd}`;
const lageSeite = `http://127.0.0.1:${port}/werbung-lage.html`;
const erwachsenSeite = `http://pornhub.veil-erwachsen.test:${port}/werbung-erwachsen.html`;
const MOTIVE = JSON.parse(readFileSync(path.join(wurzel, 'data/werbung-motive.json'), 'utf8')).plattformen as Record<string, { link: string; logo: string; knopf: string; zeilen: { titel: string; unter: string }[] }>;
const LINKS_JSON = JSON.parse(readFileSync(path.join(wurzel, 'data/links.json'), 'utf8')) as Record<string, string>;
const formateSeite = `http://127.0.0.1:${port}/werbung-formate.html`;
const LINKS = Object.values(JSON.parse(readFileSync(path.join(wurzel, 'data/links.json'), 'utf8'))).filter((v) => typeof v === 'string' && v.startsWith('https://')) as string[];

interface Flaeche {
  nr: number;
  format: string;
  tag: string;
  id: string;
  bildName: string;
  link: string;
  ziel: string;
  rel: string;
  kennzeichnung: string;
  fest: boolean;
  bildMs: number | null;
  sichtbar: boolean;
  box: { l: number; t: number; w: number; h: number } | null;
  voll: { l: number; t: number; w: number; h: number } | null;
  hinweis: string;
  plattform: string;
  layout: string;
  logo: string;
  knopf: string;
  titel: string;
  knopfBox: { l: number; t: number; w: number; h: number } | null;
  titelBox: { l: number; t: number; w: number; h: number } | null;
  knopfTransform: string;
  badge: { l: number; t: number; w: number; h: number; schrift: number; abgeschnitten: boolean; klickbar: boolean } | null;
}
interface Stand {
  aktiv: boolean;
  adHost: boolean;
  erwachsen: boolean;
  flaechen: Flaeche[];
}

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean; id?: string; texte?: unknown }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const geoeffnet: Array<{ url: string; referer: string | undefined }> = [];

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-werbung-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-werbung-pack-'));
  const bau = (await import(bauModul)) as PackBau;
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${erweiterung}`,
      `--load-extension=${erweiterung}`,
      '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1, MAP *.veil-werbung.test 127.0.0.1',
    ],
  });
  // Links der Marke: nie wirklich ins Netz, nur die Adresse zaehlt.
  await context.route(/^https:\/\/(www\.)?(patreon\.com|subscribestar\.adult|hypnomia\.itch\.io|youtube\.com|lnk\.bio|discord\.gg|x\.com)\//, (r) => {
    geoeffnet.push({ url: r.request().url(), referer: r.request().headers()['referer'] });
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<title>ok</title>' });
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 };
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
    await s.locator('#entfernen').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if (await s.locator('#entfernen').isVisible()) {
      await s.locator('#entfernen').click();
      await s.locator('#entfernen-ja').click();
      await expect(s.locator('#entfernen')).toBeHidden({ timeout: 15_000 });
    }
  } finally {
    await s.close();
  }
}

const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));
const standVon = (s: Page | Frame): Promise<Stand | null> =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-werbung');
    return a ? JSON.parse(a) : null;
  });
const flaechenIds = async (s: Page | Frame): Promise<string[]> => ((await standVon(s))?.flaechen ?? []).filter((f) => f.sichtbar).map((f) => f.id).sort();
const sichtbarOriginal = (s: Page | Frame, id: string): Promise<boolean> => s.evaluate((i) => getComputedStyle(document.getElementById(i)!).visibility === 'visible', id);

async function warteAuf(s: Page | Frame, ids: string[], frist = 20_000) {
  await expect.poll(async () => (await flaechenIds(s)).filter((i) => ids.includes(i)).length, { timeout: frist, intervals: [50] }).toBe(ids.length);
}
async function warteLeer(s: Page | Frame, frist = 10_000) {
  await expect.poll(async () => (await flaechenIds(s)).length, { timeout: frist, intervals: [30] }).toBe(0);
}

// Rote Pixel (Dummy-Werbung ist Rot mit Dunkelgrau oder Weiss; Phase 8b: unter dem dunklen Verlauf der Werbeflaeche nur noch Rot-dominant, nicht mehr grell) in den mittleren 60 % der Breite der Flaeche. Bis zu 3 s Wiederholung, falls das
// Bildschirmfoto vor dem Zeichnen der Flaeche entsteht.
async function rotAnteilMitte(s: Page, id: string): Promise<number> {
  await s.evaluate((i) => document.getElementById(i)!.scrollIntoView({ block: 'center' }), id);
  let rot = 0;
  for (let versuch = 0; versuch < 15; versuch++) {
    await abwarten(200);
    const r = await s.evaluate((i) => {
      const b = document.getElementById(i)!.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    }, id);
    const bw = Math.floor(r.w * 0.6);
    const bh = Math.floor(r.h);
    const clip = { x: Math.round(r.x + r.w / 2 - bw / 2), y: Math.round(r.y), width: bw, height: bh };
    const { data, info } = await sharp(await s.screenshot({ clip })).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i]! > 90 && data[i]! > data[i + 1]! * 2.2 && data[i]! > data[i + 2]! * 2) n++;
    rot = n / (info.width * info.height);
    if (rot > 0.1) break;
  }
  return rot;
}


async function rotAnteilBereich(s: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const { data, info } = await sharp(await s.screenshot({ clip })).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i]! > 90 && data[i]! > data[i + 1]! * 2.2 && data[i]! > data[i + 2]! * 2) n++;
  return n / (info.width * info.height);
}
const rechteck = (s: Page, id: string) =>
  s.evaluate((i) => {
    const b = document.getElementById(i)!.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  }, id);
async function maxVersatz(s: Page): Promise<number> {
  const stand = await standVon(s);
  let m = 0;
  for (const f of stand?.flaechen ?? []) {
    if (!f.voll || !f.id || !f.sichtbar) continue;
    const r = await s.evaluate((i) => { const e = document.getElementById(i); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; }, f.id);
    if (!r) continue;
    m = Math.max(m, Math.abs(f.voll.l - r.left), Math.abs(f.voll.t - r.top), Math.abs(f.voll.w - r.width), Math.abs(f.voll.h - r.height));
  }
  return m;
}
const layoutVon = (s: Page) =>
  s.evaluate(() => {
    const r = (i: string) => {
      const b = document.getElementById(i)!.getBoundingClientRect();
      return [b.left, b.top + scrollY, b.width, b.height].map((x) => Math.round(x * 10) / 10);
    };
    return { bild: r('n-bild'), header: r('n-header'), shadow: r('n-shadow'), schluss: r('schluss'), hoehe: document.documentElement.scrollHeight, breite: document.documentElement.scrollWidth };
  });
const rahmen = (s: Page, teil: string): Frame => s.frames().find((f) => f.url().includes(teil))!;
const innenRahmen = (s: Page): Frame => rahmen(s, `127.0.0.1:${port}/werbung-innen`);
const fremdRahmen = (s: Page): Frame => rahmen(s, `localhost:${portFremd}/werbung-innen`);

const ERWARTET = ['a-rahmen', 'a-ins', 'a-sponsored', 'a-anzeige', 'a-aussen'];
let layoutOhne: Awaited<ReturnType<typeof layoutVon>>;

test('ohne Pack aendert sich nichts: Originale sichtbar, Anzeige laeuft, kein Tausch', async () => {
  await loescheEinstellungen();
  const s = await context.newPage();
  await s.goto(nachrichten);
  await abwarten(3500); // die spaete Werbung erscheint nach 2 s
  expect(await standVon(s)).toBeNull();
  for (const id of [...ERWARTET, 'a-spaet', 'n-bild', 'n-header']) expect(await sichtbarOriginal(s, id), id).toBe(true);
  const fr = rahmen(s, 'werbung-rahmen');
  expect(await fr.evaluate(() => !(document.getElementById('v') as HTMLVideoElement).paused)).toBe(true);
  layoutOhne = await layoutVon(s);
  console.log(`werbung ohne Pack: keine Flaeche, Anzeige laeuft, Seitenhoehe ${layoutOhne.hoehe}`);
  await s.close();
});

test('mit Pack: Werbeflaechen getauscht, gekennzeichnet, normale Bilder bleiben, Layout unveraendert', async () => {
  await importierePack(packPfad);
  console.log('werbung: Pack importiert');
  // Seit 0.9.0 ist die Werbung ab Werk aus (Opt-in): die Tests schalten sie ein.
  await setzeEinstellungen({ kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.addInitScript(() => {
    (window as any).__spaetSicht = null;
    new MutationObserver(() => {
      const a = document.documentElement.getAttribute('data-veil-werbung');
      if (a && (window as any).__spaetSicht === null && JSON.parse(a).flaechen.some((f: any) => f.id === 'a-spaet' && f.sichtbar)) (window as any).__spaetSicht = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-veil-werbung'] });
  });
  const t0 = Date.now();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  console.log(`werbung: ${ERWARTET.length} Flaechen sichtbar ${Date.now() - t0} ms nach goto`);
  const stand = (await standVon(s))!;
  const ids = await flaechenIds(s);
  expect(ids).not.toContain('a-innen'); // nur der aeusserste Behaelter
  for (const nein of ['n-bild', 'n-header', 'n-shadow', 'n-rahmen']) expect(ids, nein).not.toContain(nein);
  for (const id of ERWARTET) {
    const f = stand.flaechen.find((x) => x.id === id)!;
    expect(f.kennzeichnung, id).toBe('Test ad by Mia');
    expect(f.hinweis, id).toBe('Advertisement by Mia, shown by the HYPNOMIA VEIL extension');
    expect(f.badge!.klickbar, `${id}: Kennzeichnung nicht im Link`).toBe(false);
    expect(f.badge!.schrift, id).toBeGreaterThanOrEqual(f.box!.h < 60 ? 8 : 11);
    expect(f.badge!.abgeschnitten, id + JSON.stringify(f.badge)).toBe(false);
    // Kennzeichnung liegt ganz in der Flaeche
    expect(f.badge!.l).toBeGreaterThanOrEqual(f.box!.l - 1);
    expect(f.badge!.t).toBeGreaterThanOrEqual(f.box!.t - 1);
    expect(f.badge!.l + f.badge!.w).toBeLessThanOrEqual(f.box!.l + f.box!.w + 1);
    expect(f.badge!.t + f.badge!.h).toBeLessThanOrEqual(f.box!.t + f.box!.h + 1);
    expect(await sichtbarOriginal(s, id), `${id} Original unsichtbar`).toBe(false);
    const rot = await rotAnteilMitte(s, id);
    expect(rot, `${id} rote Pixel in der Mitte`).toBeGreaterThan(0.1);
    console.log(`werbung: ${id} ${f.format} Bild ${f.bildName} Rotanteil ${rot.toFixed(2)} Kennzeichnung ${f.badge!.schrift}px, erkannt bis Bild ${f.bildMs} ms`);
  }
  expect(await sichtbarOriginal(s, 'n-bild')).toBe(true);
  expect(await sichtbarOriginal(s, 'n-header')).toBe(true);
  // Das DOM der Seite bleibt unberuehrt: keine Kinder oder Geschwister, Selektoren wie :last-child, :empty, :only-child treffen weiter
  const dom = await s.evaluate(() => ({
    zeile: document.getElementById('a-sponsored')!.parentElement!.children.length,
    kinder: document.getElementById('a-sponsored')!.children.length,
    letztes: document.querySelector('#a-sponsored > :last-child')?.id,
    leer: !!document.querySelector('#a-ins:empty'),
    einzig: !!document.querySelector('#a-rahmen:only-child'),
    ausstieg: document.documentElement.lastElementChild?.tagName,
    rahmenGeschwister: document.getElementById('a-rahmen')!.nextElementSibling === null,
    anzeigeKnoten: document.getElementById('a-anzeige')!.childNodes.length,
  }));
  console.log(`werbung: DOM der Seite nach dem Tausch ${JSON.stringify(dom)}`);
  expect(dom).toEqual({ zeile: 2, kinder: 1, letztes: 'a-video', leer: true, einzig: true, ausstieg: 'DIV', rahmenGeschwister: true, anzeigeKnoten: 1 });
  const frueh = await layoutVon(s);
  expect({ ...frueh, schluss: 0, hoehe: 0 }).toEqual({ ...layoutOhne, schluss: 0, hoehe: 0 }); // die spaete Werbung fehlt noch
  // spaete Werbung: Zeit von Einfuegen bis Mias Bild
  await abwarten(1500);
  await warteAuf(s, [...ERWARTET, 'a-spaet']);
  const ms = await s.evaluate(() => (window as any).__spaetSicht - (window as any).__spaetAm);
  console.log(`werbung: spaete Werbung, Mias Bild ${Math.round(ms)} ms nach dem Einfuegen`);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThan(300);
  expect(await layoutVon(s)).toEqual(layoutOhne); // mit allen Flaechen sieht das Layout aus wie ohne Pack
  await s.close();
});

test('Medien: Anzeige im Werbe-Rahmen und Video in der Flaeche angehalten und stumm', async () => {
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await abwarten(1200);
  const fr = rahmen(s, 'werbung-rahmen');
  const zustand = await fr.evaluate(() => {
    const v = document.getElementById('v') as HTMLVideoElement;
    return { pausiert: v.paused, stumm: v.muted };
  });
  const flaecheVideo = await s.evaluate(() => {
    const v = document.getElementById('a-video') as HTMLVideoElement;
    return { pausiert: v.paused, stumm: v.muted };
  });
  console.log(`werbung: Werbe-Rahmen ${JSON.stringify(zustand)}, Video in der Flaeche ${JSON.stringify(flaecheVideo)}`);
  expect(zustand).toEqual({ pausiert: true, stumm: true });
  expect(flaecheVideo).toEqual({ pausiert: true, stumm: true });
  // Rahmen mit Werbung darin (gleiche Herkunft): dort wird getauscht, und die Pause gibt auch dort frei.
  const innen = innenRahmen(s);
  await expect.poll(async () => (await flaechenIds(innen)).join(), { timeout: 15_000 }).toBe('i-ins');
  await s.close();
});

test('Medien in einem Rahmen ohne eigene Adresse innerhalb der Flaeche werden angehalten; ein Werbe-Host als oberste Seite bleibt unberuehrt', async () => {
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await abwarten(1200);
  const leer = await s.evaluate(() => {
    const v = (document.getElementById('a-innen') as HTMLIFrameElement).contentDocument!.getElementById('v-leer') as HTMLVideoElement;
    return { pausiert: v.paused, stumm: v.muted };
  });
  console.log(`werbung: Video im Rahmen ohne Adresse ${JSON.stringify(leer)}`);
  expect(leer).toEqual({ pausiert: true, stumm: true });
  await s.close();
  // Wer einen Werbe-Host direkt besucht, bekommt nichts angehalten
  const o = await context.newPage();
  await o.goto(`http://ad.veil-werbung.test:${portFremd}/werbung-rahmen.html`);
  await abwarten(2500);
  expect(await o.evaluate(() => (document.getElementById('v') as HTMLVideoElement).paused)).toBe(false);
  await o.close();
});

test('Klick oeffnet genau einen Link aus links.json in neuem Tab, Bild rotiert je Seitenaufruf', async () => {
  const s = await context.newPage();
  const hosts = new Set<string>();
  const mitschnitt = (r: { url(): string }) => {
    try {
      const u = new URL(r.url());
      if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.host);
    } catch {
      // keine Adresse
    }
  };
  context.on('request', mitschnitt);
  geoeffnet.length = 0;
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await abwarten(1500);
  context.off('request', mitschnitt);
  // Kein Netzverkehr ausser dem der Seite selbst und ihrer Test-Hosts; vor dem Klick kein Abruf eines Links der Marke.
  const erlaubt = new Set([`127.0.0.1:${port}`, `ad.veil-werbung.test:${portFremd}`, `localhost:${portFremd}`]);
  console.log(`werbung: Netz bis zum Klick: ${[...hosts].sort().join(', ')}`);
  expect([...hosts].filter((h) => !erlaubt.has(h))).toEqual([]);
  expect(geoeffnet.length).toBe(0);
  const stand = (await standVon(s))!;
  const f = stand.flaechen.find((x) => x.id === 'a-sponsored')!;
  expect(f.ziel).toBe('_blank');
  expect(f.rel).toBe('noopener noreferrer');
  expect(LINKS).toContain(f.link);
  const vorher = context.pages().length;
  await s.evaluate(() => document.getElementById('a-sponsored')!.scrollIntoView({ block: 'center' }));
  await abwarten(250);
  const r = await rechteck(s, 'a-sponsored');
  const neu = context.waitForEvent('page', { timeout: 10_000 });
  await s.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
  const tab = await neu;
  await tab.waitForLoadState('domcontentloaded').catch(() => {});
  console.log(`werbung: Klick oeffnete ${tab.url()}`);
  expect(tab.url().startsWith(f.link.replace(/\/$/, ''))).toBe(true);
  expect(geoeffnet.length).toBe(1);
  expect(LINKS.some((l) => geoeffnet[0]!.url.startsWith(l.replace(/\/$/, '')))).toBe(true);
  expect(geoeffnet[0]!.referer, 'kein Referer beim Klick').toBeUndefined();
  expect(context.pages().length).toBe(vorher + 1);
  await tab.close();
  await s.close();

  // Rotation: neuer Seitenaufruf, neues Bild (zwei Bilder fuer 300x250, 12 Aufrufe)
  const namen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const p = await context.newPage();
    await p.goto(nachrichten);
    await warteAuf(p, ['a-sponsored']);
    namen.add((await standVon(p))!.flaechen.find((x) => x.id === 'a-sponsored')!.bildName);
    await p.close();
  }
  console.log(`werbung: Rotation, ${namen.size} verschiedene Bilder in 12 Aufrufen: ${[...namen].join(', ')}`);
  expect(namen.size).toBeGreaterThanOrEqual(2);
});

// Phase 8b, Auftrag R: Logo und Knopftext passen zur Plattform des Links; Etikett in allen drei Layouts sichtbar, nie vom Knopf oder Text verdeckt.
test('Plattform-Werbung: Logo, Knopftext und Link passen zusammen; Etikett sichtbar in Banner, Rechteck und Hochformat', async () => {
  const fotos = process.env.VEIL_FOTO_ORDNER;
  const layouts = new Set<string>();
  const plattformen = new Set<string>();
  const ids = ['f-728', 'f-468', 'f-320', 'f-970', 'f-300', 'f-336', 'f-160', 'f-300h'];
  for (let durchlauf = 0; durchlauf < 6; durchlauf++) {
    const s = await context.newPage();
    await s.setViewportSize({ width: durchlauf === 5 ? 360 : 1280, height: 900 });
    await s.goto(formateSeite);
    await warteAuf(s, ids);
    await abwarten(600);
    const stand = (await standVon(s))!;
    for (const id of ids) {
      const f = stand.flaechen.find((x) => x.id === id)!;
      const m = MOTIVE[f.plattform]!;
      expect(m, `${id}: Plattform ${f.plattform}`).toBeTruthy();
      expect(f.logo, `${id}: Logo`).toBe(m.logo);
      expect(f.knopf, `${id}: Knopftext`).toBe(m.knopf);
      expect(f.link, `${id}: Link`).toBe(LINKS_JSON[m.link]);
      expect(m.zeilen.some((z) => z.titel === f.titel), `${id}: Ueberschrift aus derselben Plattform`).toBe(true);
      const layout = f.layout.split(' ')[1]!;
      layouts.add(layout);
      plattformen.add(f.plattform);
      // Session 16 (UX 8b Nr. 22): breiter als das Fenster, dann richtet sich das Layout nach dem sichtbaren Teil im Fenster.
      const fensterB = durchlauf === 5 ? 360 : 1280;
      const sichtW = f.box!.w > fensterB ? Math.min(f.box!.l + f.box!.w, fensterB) - Math.max(f.box!.l, 0) : f.box!.w;
      expect(layout, id).toBe(sichtW >= f.box!.h * 2.5 ? 'banner' : f.box!.h >= sichtW * 1.6 ? 'hoch' : 'rechteck');
      if (f.box!.w > fensterB) {
        expect(f.titelBox!.l + f.titelBox!.w, `${id}: Ueberschrift im Fenster`).toBeLessThanOrEqual(fensterB + 1);
        if (f.knopfBox) expect(f.knopfBox.l + f.knopfBox.w, `${id}: Knopf im Fenster`).toBeLessThanOrEqual(fensterB + 1);
      }
      // Etikett: sichtbar, mindestens 11 px, nicht abgeschnitten, nicht klickbar, ganz in der Flaeche
      const b = f.badge!;
      expect(b.schrift, `${id}: Etikett Schrift`).toBeGreaterThanOrEqual(11);
      expect(b.abgeschnitten, id).toBe(false);
      expect(b.klickbar, id).toBe(false);
      expect(f.kennzeichnung, id).toBe('Test ad by Mia');
      expect(b.l).toBeGreaterThanOrEqual(f.box!.l - 1);
      expect(b.t).toBeGreaterThanOrEqual(f.box!.t - 1);
      expect(b.l + b.w).toBeLessThanOrEqual(f.box!.l + f.box!.w + 1);
      expect(b.t + b.h).toBeLessThanOrEqual(f.box!.t + f.box!.h + 1);
      // nie vom Knopf oder der Ueberschrift verdeckt: Etikett schneidet beide nicht
      const schneidet = (a: { l: number; t: number; w: number; h: number } | null) => !!a && a.w > 0 && a.h > 0 && b.l < a.l + a.w - 0.5 && b.l + b.w > a.l + 0.5 && b.t < a.t + a.h - 0.5 && b.t + b.h > a.t + 0.5;
      expect(schneidet(f.knopfBox), `${id} (${layout}): Etikett ueber dem Knopf ${JSON.stringify([b, f.knopfBox])}`).toBe(false);
      expect(schneidet(f.titelBox), `${id} (${layout}): Etikett ueber der Ueberschrift ${JSON.stringify([b, f.titelBox])}`).toBe(false);
      // Knopf und Ueberschrift bleiben in der Flaeche
      if (f.knopfBox) {
        expect(f.knopfBox.l).toBeGreaterThanOrEqual(f.box!.l - 1);
        expect(f.knopfBox.l + f.knopfBox.w).toBeLessThanOrEqual(f.box!.l + f.box!.w + 1);
        expect(f.knopfBox.t + f.knopfBox.h).toBeLessThanOrEqual(f.box!.t + f.box!.h + 1);
        if (layout !== 'banner') expect(f.knopfBox.h, `${id}: Knopf mindestens 44 px`).toBeGreaterThanOrEqual(43.5);
      }
      expect(f.titelBox!.l + f.titelBox!.w, `${id}: Ueberschrift ueberlaeuft nicht`).toBeLessThanOrEqual(f.box!.l + f.box!.w + 1);
    }
    // Der Text steht als echter Text in der Shadow Root (nicht im Bild): Tabelle der sichtbaren Layouts
    if (fotos && (durchlauf === 0 || durchlauf === 5)) {
      const breite = durchlauf === 5 ? '360' : '1280';
      for (const id of ids) {
        await s.evaluate((i) => document.getElementById(i)!.scrollIntoView({ block: 'center' }), id);
        await abwarten(250);
        const r = await rechteck(s, id);
        await s.screenshot({ path: path.join(fotos, `r-${id}-${breite}.png`), clip: { x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 4), width: Math.min(r.width + 8, durchlauf === 5 ? 360 : 1280), height: r.height + 8 } });
      }
    }
    console.log(`werbung: Plattformen dieses Aufrufs ${[...new Set(stand.flaechen.map((f) => f.plattform))].join(', ')}`);
    await s.close();
  }
  expect([...layouts].sort()).toEqual(['banner', 'hoch', 'rechteck']);
  expect(plattformen.size, `Plattformen gesehen: ${[...plattformen].join(', ')}`).toBeGreaterThanOrEqual(4);
});

test('Knopf vergroessert sich beim Hover, aber nicht im Ruhig-Modus und nicht bei prefers-reduced-motion', async () => {
  await setzeEinstellungen({ ausnahmen: [], pause: false, ruhig: false, kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.setViewportSize({ width: 1280, height: 900 });
  await s.goto(formateSeite);
  await warteAuf(s, ['f-300']);
  await abwarten(600);
  await s.evaluate(() => document.getElementById('f-300')!.scrollIntoView({ block: 'center' }));
  await abwarten(600);
  // Faktor des Knopfes unter der Maus: Maus auf die Mitte des Knopfes, Uebergang abwarten
  const faktor = async () => {
    const f = (await standVon(s))!.flaechen.find((x) => x.id === 'f-300')!;
    const k = f.knopfBox!;
    await s.mouse.move(2, 2);
    await abwarten(400);
    await s.mouse.move(k.l + k.w / 2, k.t + k.h / 2);
    await abwarten(500);
    const t = (await standVon(s))!.flaechen.find((x) => x.id === 'f-300')!.knopfTransform;
    return t === 'none' ? 1 : Number(t.match(/matrix\(([^,]+),/)?.[1] ?? 1);
  };
  expect(await faktor(), 'normal: Knopf wird groesser').toBeGreaterThan(1.02);
  await setzeEinstellungen({ ruhig: true });
  await abwarten(600);
  expect(await faktor(), 'Ruhig-Modus: keine Vergroesserung').toBe(1);
  await setzeEinstellungen({ ruhig: false });
  await abwarten(600);
  expect(await faktor(), 'Ruhig-Modus aus: wieder groesser').toBeGreaterThan(1.02);
  await s.emulateMedia({ reducedMotion: 'reduce' });
  await abwarten(600);
  expect(await faktor(), 'prefers-reduced-motion: keine Vergroesserung').toBe(1);
  await s.close();
  await setzeEinstellungen({ ruhig: false });
});

test('Scrollen, Groessenwechsel und Transformation: hoechstens 2 px Versatz', async () => {
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  const vorher = (await standVon(s))!.flaechen.find((x) => x.id === 'a-sponsored')!;
  const nameVorher = vorher.bildName;
  await s.evaluate(() => scrollTo(0, 500));
  await abwarten(500);
  const v1 = await maxVersatz(s);
  await s.evaluate(() => scrollTo(0, 120));
  await abwarten(500);
  const v2 = await maxVersatz(s);
  // Groessenwechsel auf ein anderes Format: Mias Flaeche folgt (neues Format, neues Bild)
  await s.evaluate(() => (window as any).setzeGroesse('a-sponsored', 336, 280));
  await expect.poll(async () => (await standVon(s))!.flaechen.find((x) => x.id === 'a-sponsored')?.format, { timeout: 10_000 }).toBe('336x280');
  await expect.poll(() => maxVersatz(s), { timeout: 5000 }).toBeLessThanOrEqual(2);
  const v3 = await maxVersatz(s);
  // Groesse ohne Format: Original zurueck
  await s.evaluate(() => (window as any).setzeGroesse('a-sponsored', 500, 400));
  await expect.poll(async () => (await flaechenIds(s)).includes('a-sponsored'), { timeout: 10_000 }).toBe(false);
  expect(await sichtbarOriginal(s, 'a-sponsored')).toBe(true);
  // zurueck auf ein Format: wieder getauscht
  await s.evaluate(() => (window as any).setzeGroesse('a-sponsored', 300, 250));
  await warteAuf(s, ['a-sponsored']);
  // gleiche Flaeche, gleiches Bild, gleicher Link, gleiche Kennzeichnung (Nummer bleibt am Element)
  const nachher = (await standVon(s))!.flaechen.find((x) => x.id === 'a-sponsored')!;
  expect({ n: nachher.bildName, l: nachher.link, k: nachher.kennzeichnung }).toEqual({ n: nameVorher, l: vorher.link, k: vorher.kennzeichnung });
  // Fenstergroesse: die Kennzeichnung bleibt im sichtbaren Teil (a-ins ist 728 breit, das Fenster nur 700)
  await s.setViewportSize({ width: 700, height: 600 });
  await abwarten(500);
  const v4 = await maxVersatz(s);
  const schmal = (await standVon(s))!.flaechen.find((x) => x.id === 'a-ins')!;
  expect(schmal.badge!.l + schmal.badge!.w, 'Kennzeichnung von a-ins im Fenster').toBeLessThanOrEqual(701);
  expect(schmal.badge!.l).toBeGreaterThanOrEqual(schmal.box!.l - 1);
  // Transformation des Vorfahren
  await s.evaluate(() => (document.getElementById('a-ins')!.parentElement!.style.transform = 'translate(40px, 15px)'));
  await abwarten(1200);
  const v5 = await maxVersatz(s);
  console.log(`werbung: Versatz nach Scrollen ${v1.toFixed(2)} und ${v2.toFixed(2)}, Groessenwechsel ${v3.toFixed(2)}, Fenster ${v4.toFixed(2)}, Transformation ${v5.toFixed(2)} px (Name stabil: ${nameVorher})`);
  for (const v of [v1, v2, v3, v4, v5]) expect(v).toBeLessThanOrEqual(2);
  await s.close();
});

test('Pause (auch im Rahmen), Schalter aus und eigene Ausnahme geben die Originale sofort zurueck; danach wieder getauscht', async () => {
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await expect.poll(async () => (await flaechenIds(innenRahmen(s))).length, { timeout: 15_000 }).toBe(1);
  const nach = async (beschreibung: string, auslöser: () => Promise<void>) => {
    const t0 = Date.now();
    await auslöser();
    await warteLeer(s);
    await expect.poll(async () => (await flaechenIds(innenRahmen(s))).length, { timeout: 10_000 }).toBe(0);
    for (const id of ERWARTET) expect(await sichtbarOriginal(s, id), `${beschreibung}: ${id}`).toBe(true);
    expect(await sichtbarOriginal(innenRahmen(s), 'i-ins')).toBe(true);
    console.log(`werbung: ${beschreibung}: alle Originale sichtbar nach ${Date.now() - t0} ms`);
    await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: KONTROLLE });
    await warteAuf(s, ERWARTET);
  };
  await nach('Pause', () => setzeEinstellungen({ pause: true }));
  await nach('Schalter aus', () => setzeEinstellungen({ kontrolle: { ...KONTROLLE, werbung: false } }));
  await nach('eigene Ausnahme', () => setzeEinstellungen({ ausnahmen: ['127.0.0.1'] }));
  await s.close();
});

test('Erwachsenenseite: nur nach Groesse getauscht, Videolinks, Videos und Vorschau-Tausch bleiben', async () => {
  const s = await context.newPage();
  await s.goto(erwachsenSeite);
  await warteAuf(s, ['e-flaeche', 'e-kopf']);
  const ids = await flaechenIds(s);
  console.log(`werbung: Erwachsenenseite getauscht: ${ids.join(', ')}`);
  for (const nein of ['e-link-gross', 'e-vorschau', 'e-karte', 'e-karte-link', 'e-video', 'e-klein']) expect(ids, nein).not.toContain(nein);
  expect((await standVon(s))!.erwachsen).toBe(true);
  // die Vorschau bleibt Sache des Vorschau-Tauschs
  await expect.poll(() => s.evaluate(() => document.getElementById('e-vorschau')!.hasAttribute('data-veil-ersetzt')), { timeout: 20_000 }).toBe(true);
  expect(await rotAnteilMitte(s, 'e-flaeche')).toBeGreaterThan(0.1);
  await s.close();
  // dieselbe Seite auf einem normalen Host: ohne zweites Merkmal nichts
  const n = await context.newPage();
  await n.goto(`http://127.0.0.1:${port}/werbung-erwachsen.html`);
  await abwarten(2500);
  expect(await flaechenIds(n)).toEqual([]);
  await n.close();
});

test('eigene Ausnahme des Tabs gilt auch in fremden Rahmen: Werbe-Rahmen laeuft weiter, nichts wird getauscht', async () => {
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'], pause: false, kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.goto(nachrichten);
  await abwarten(4000);
  expect(await standVon(s)).toBeNull();
  const ad = await rahmen(s, 'werbung-rahmen').evaluate(() => {
    const v = document.getElementById('v') as HTMLVideoElement;
    return { pausiert: v.paused, stumm: v.muted };
  });
  console.log(`werbung: Tab auf Ausnahme, Werbe-Rahmen ${JSON.stringify(ad)}`);
  expect(ad.pausiert).toBe(false);
  expect(await standVon(fremdRahmen(s))).toBeNull(); // Rahmen anderer Herkunft: Tab-Adresse zaehlt
  expect(await standVon(innenRahmen(s))).toBeNull();
  for (const id of [...ERWARTET, 'a-spaet']) expect(await sichtbarOriginal(s, id), id).toBe(true);
  // Ausnahme endet: Rahmen tauschen wieder
  await setzeEinstellungen({ ausnahmen: [] });
  await warteAuf(s, ERWARTET);
  await expect.poll(async () => (await flaechenIds(fremdRahmen(s))).join(), { timeout: 15_000 }).toBe('i-ins');
  await s.close();
});

test('lokale Pause im Riegel (Hintergrund stumm) gibt sofort frei; Medien bleiben angehalten; gleiche Flaeche, gleiches Bild nach der Pause', async () => {
  test.setTimeout(90_000);
  await setzeEinstellungen({ ausnahmen: [], pause: false, kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.goto(`${nachrichten}&retry=0`);
  await warteAuf(s, ERWARTET);
  const vorher = (await standVon(s))!.flaechen.find((x) => x.id === 'a-sponsored')!;
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ riegel: { oeffne: { frage: 'test-w1', pauseHaengt: true } } }) })));
  let pause: { x: number; y: number; w: number; h: number } | null = null;
  await expect
    .poll(
      async () => {
        const a = await s.evaluate(() => {
          const v = document.documentElement.getAttribute('data-veil-riegel');
          return v ? JSON.parse(v) : null;
        });
        if (a && a.zustand === 'frage' && a.offen) pause = a.pause;
        return pause !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const t0 = Date.now();
  await s.mouse.click(pause!.x + pause!.w / 2, pause!.y + pause!.h / 2);
  await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-riegel-ergebnis')), { timeout: 3000 }).toBe('pause');
  await expect.poll(async () => (await flaechenIds(s)).length, { timeout: 2000, intervals: [10] }).toBe(0);
  console.log(`werbung: lokale Pause: Flaechen weg nach ${Date.now() - t0} ms (gespeicherte Pause haengt)`);
  for (const id of ERWARTET) expect(await sichtbarOriginal(s, id), id).toBe(true);
  await abwarten(1500);
  const medien = await rahmen(s, 'werbung-rahmen').evaluate(() => (document.getElementById('v') as HTMLVideoElement).paused);
  expect(medien, 'Medien bleiben nach der Pause angehalten (Rahmen startet nichts von selbst)').toBe(true);
  await s.close();
  // gleiche Flaeche, gleiches Bild nach Pause und Neustart im selben Seitenaufruf
  const p = await context.newPage();
  await p.goto(nachrichten);
  await warteAuf(p, ERWARTET);
  const a0 = (await standVon(p))!.flaechen.find((x) => x.id === 'a-sponsored')!;
  await setzeEinstellungen({ pause: true });
  await warteLeer(p);
  await setzeEinstellungen({ pause: false });
  await warteAuf(p, ERWARTET);
  const a1 = (await standVon(p))!.flaechen.find((x) => x.id === 'a-sponsored')!;
  expect({ n: a1.bildName, l: a1.link, k: a1.kennzeichnung }).toEqual({ n: a0.bildName, l: a0.link, k: a0.kennzeichnung });
  void vorher;
  await p.close();
});

test('Lage: Karussell beschneidet, Kopfleiste und Dialog liegen darueber, Ausblenden folgt, Scrollbereich waechst nicht', async () => {
  test.setTimeout(120_000);
  // Vergleichswert ohne Tausch (Schalter aus)
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, werbung: false }, pause: false, ausnahmen: [] });
  const ohne = await context.newPage();
  await ohne.goto(lageSeite);
  await abwarten(2500);
  const ohneMass = await ohne.evaluate(() => ({ b: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await ohne.close();
  await setzeEinstellungen({ kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.goto(lageSeite);
  await warteAuf(s, ['a-kar', 'a-wichtig', 'a-aus', 'a-wachs', 'a-fest', 'sh-ins', 'a-link', 'a-skal']); // sh-ins steht in einem offenen Shadow Root
  // Ein Kind mit fester Groesse wuchs ohne Attributaenderung am Behaelter hinein (ResizeObserver)
  const wachsMs = await s.evaluate(() => performance.now() - (window as any).__wachsAm);
  console.log(`werbung: Behaelter wuchs ohne Attributaenderung, getauscht spaetestens ${Math.round(wachsMs)} ms danach`);
  // Karussell: nur der sichtbare Teil (150 von 300 px), die zweite Flaeche liegt ganz ausserhalb
  const stand = (await standVon(s))!;
  const kar = stand.flaechen.find((x) => x.id === 'a-kar')!;
  const klemm = await rechteck(s, 'kar');
  expect(kar.box!.w).toBeGreaterThan(145);
  expect(kar.box!.w).toBeLessThan(155);
  expect(kar.box!.l + kar.box!.w).toBeLessThanOrEqual(klemm.left + klemm.width + 1);
  expect(kar.voll!.w).toBeGreaterThan(295);
  expect(stand.flaechen.find((x) => x.id === 'a-kar-weit')?.sichtbar ?? false).toBe(false);
  expect(kar.badge!.l + kar.badge!.w).toBeLessThanOrEqual(klemm.left + klemm.width + 1);
  // Karussell wird gescrollt: die Flaeche folgt
  await s.evaluate(() => (document.getElementById('kar')!.scrollLeft = 120));
  await abwarten(600);
  const kar2 = (await standVon(s))!.flaechen.find((x) => x.id === 'a-kar')!;
  const r2 = await rechteck(s, 'a-kar');
  expect(Math.abs(kar2.voll!.l - r2.left)).toBeLessThanOrEqual(2);
  expect(kar2.box!.w).toBeGreaterThan(kar.box!.w + 100);
  await s.evaluate(() => (document.getElementById('kar')!.scrollLeft = 0));
  // Seiten-CSS mit !important: das Original bleibt unsichtbar
  expect(await sichtbarOriginal(s, 'a-wichtig')).toBe(false);
  // Scrollbereich unveraendert
  const mit = await s.evaluate(() => ({ b: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  console.log(`werbung: Scrollbereich ohne ${JSON.stringify(ohneMass)} mit ${JSON.stringify(mit)}`);
  expect(mit).toEqual(ohneMass);
  // Kopfleiste (sticky, z-index 50) liegt ueber der Flaeche
  await s.evaluate(() => {
    const b = document.getElementById('a-wichtig')!.getBoundingClientRect();
    scrollTo(0, scrollY + b.top - 20);
  });
  await abwarten(500);
  const punkt = await s.evaluate(() => {
    const b = document.getElementById('a-wichtig')!.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: 30, im: b.top < 40 };
  });
  expect(punkt.im).toBe(true);
  const oben = await s.evaluate((p) => document.elementsFromPoint(p.x, p.y)[0]!.id, punkt);
  expect(oben, 'Kopfleiste liegt ueber der Flaeche').toBe('kopf');
  // Kennzeichnung nicht unter der Kopfleiste: sie liegt an einer Ecke, an der Mias Flaeche zuoberst liegt, ganz in der Flaeche
  await abwarten(500);
  const wichtig = (await standVon(s))!.flaechen.find((x) => x.id === 'a-wichtig')!;
  const bc = { x: wichtig.badge!.l + wichtig.badge!.w / 2, y: wichtig.badge!.t + wichtig.badge!.h / 2 };
  const obenBadge = await s.evaluate((p) => document.elementsFromPoint(p.x, p.y)[0]!.id, bc);
  console.log(`werbung: Kennzeichnung bei y=${Math.round(wichtig.badge!.t)} (Kopfleiste bis 60), oberstes Element dort: "${obenBadge}"`);
  expect(obenBadge, 'Kennzeichnung liegt nicht unter der Kopfleiste').not.toBe('kopf');
  expect(wichtig.badge!.abgeschnitten).toBe(false);
  expect(wichtig.badge!.l).toBeGreaterThanOrEqual(wichtig.box!.l - 1);
  expect(wichtig.badge!.l + wichtig.badge!.w).toBeLessThanOrEqual(wichtig.box!.l + wichtig.box!.w + 1);
  expect(wichtig.badge!.t + wichtig.badge!.h).toBeLessThanOrEqual(wichtig.box!.t + wichtig.box!.h + 1);
  // skalierter Vorfahr (1,05): Groesse und Lage stimmen im Fenster
  const skal = (await standVon(s))!.flaechen.find((x) => x.id === 'a-skal')!;
  const rs = await rechteck(s, 'a-skal');
  console.log(`werbung: skalierter Vorfahr: Element ${rs.width.toFixed(1)}x${rs.height.toFixed(1)}, Mias Bild ${skal.voll!.w.toFixed(1)}x${skal.voll!.h.toFixed(1)}`);
  expect(Math.abs(skal.voll!.w - rs.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(skal.voll!.h - rs.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(skal.voll!.l - rs.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(skal.voll!.t - rs.top)).toBeLessThanOrEqual(2);
  // Seiten-Dialog (fixed, z-index 100)
  await s.evaluate(() => (window as any).zeigeModal(true));
  const mitte = await s.evaluate(() => {
    const b = document.getElementById('a-wichtig')!.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: Math.max(80, b.top + b.height / 2) };
  });
  expect(await s.evaluate((p) => document.elementsFromPoint(p.x, p.y)[0]!.id, mitte), 'Dialog liegt ueber der Flaeche').toBe('modal');
  await s.evaluate(() => (window as any).zeigeModal(false));
  // Vorfahr blendet aus (visibility): Mias Flaeche folgt, dann wieder
  await s.evaluate(() => (window as any).blendeAus(true));
  await expect.poll(async () => (await flaechenIds(s)).includes('a-aus'), { timeout: 4000 }).toBe(false);
  await s.evaluate(() => (window as any).blendeAus(false));
  await expect.poll(async () => (await flaechenIds(s)).includes('a-aus'), { timeout: 4000 }).toBe(true);
  // fixierte Flaeche: bleibt beim Scrollen am Platz
  expect((await standVon(s))!.flaechen.find((x) => x.id === 'a-fest')!.fest).toBe(true);
  await s.evaluate(() => scrollTo(0, 900));
  await abwarten(500);
  expect(await maxVersatz(s)).toBeLessThanOrEqual(2);
  // Die Seite versteckt das Original selbst: die Pause macht es nicht mit dem alten Wert sichtbar; ein style-Attribut, das es vorher nicht gab, verschwindet wieder
  expect(await s.evaluate(() => document.getElementById('a-wachs')!.hasAttribute('style') === true)).toBe(true); // von uns gesetzt
  await s.evaluate(() => document.getElementById('a-aus')!.style.setProperty('visibility', 'hidden'));
  await abwarten(600);
  await setzeEinstellungen({ pause: true });
  await warteLeer(s);
  expect(await s.evaluate(() => getComputedStyle(document.getElementById('a-aus')!).visibility), 'Original, das die Seite selbst versteckt hat, bleibt versteckt').toBe('hidden');
  expect(await s.evaluate(() => document.getElementById('a-wachs')!.hasAttribute('style')), 'kein leeres style-Attribut zurueck').toBe(false);
  await setzeEinstellungen({ pause: false });
  await s.close();
});

test('K3: Mias Werbung liegt nie ueber fremden Dialogen (body fest, Huelle, modales dialog), Skin und Rollsperre stoeren nicht', async () => {
  test.setTimeout(150_000);
  const s = await context.newPage();
  await s.setViewportSize({ width: 1280, height: 720 });
  await s.goto(`http://127.0.0.1:${port}/werbung-dialog.html`);
  const ALLE = ['a-oben', 'a-neben', 'a-eigen'];
  await warteAuf(s, ALLE);
  // Oberstes Element an einem Punkt
  const oben = (x: number, y: number, sel: string) =>
    s.evaluate(([px, py, q]) => {
      const e = document.elementsFromPoint(px as number, py as number)[0]!;
      return { id: e.id, imDialog: !!e.closest(q as string) };
    }, [x, y, sel] as const);
  // Jede sichtbare Mia-Flaeche: Kennzeichnung sichtbar und zuoberst (oberstes Element ist ein Host ohne Kennung, kein Seitenelement)
  const kennzeichnungOben = async (ids: string[]) => {
    const st = (await standVon(s))!;
    for (const id of ids) {
      const f = st.flaechen.find((x) => x.id === id)!;
      expect(f.sichtbar, `${id} sichtbar`).toBe(true);
      expect(f.kennzeichnung.length).toBeGreaterThan(0);
      const t = await s.evaluate(([x, y]) => {
        const e = document.elementsFromPoint(x as number, y as number)[0]!;
        return { id: e.id, tag: e.tagName, eltern: e.parentElement?.tagName ?? '' };
      }, [f.badge!.l + f.badge!.w / 2, f.badge!.t + f.badge!.h / 2] as const);
      expect(t.id, `Kennzeichnung von ${id} liegt zuoberst`).toBe('');
      expect(['BODY', 'HTML']).toContain(t.eltern);
    }
  };
  await abwarten(600);
  await kennzeichnungOben(ALLE);
  // (a) fester Dialog, z-index 2147483647, die Seite sperrt das Rollen mit body fixed (chip.de)
  await s.evaluate(() => (window as any).oeffneCookie(true));
  await abwarten(1500);
  const r = await rechteck(s, 'a-oben');
  const pkt = { x: r.left + r.width / 2, y: r.top + 100 };
  const t1 = await oben(pkt.x, pkt.y, '#cookie');
  console.log(`werbung K3: fester Dialog, oberstes Element ${JSON.stringify(t1)}`);
  expect(t1.imDialog, 'Cookie-Dialog liegt ueber Mias Werbung').toBe(true);
  expect(await rotAnteilBereich(s, { x: Math.round(pkt.x - 100), y: Math.round(pkt.y - 40), width: 200, height: 80 }), 'kein Rot im Dialogbereich').toBeLessThan(0.02);
  // Flaechen unter dem Dialog (auch unter seinem dimmenden Hintergrund) sind ganz weg; jede noch sichtbare hat ihre Kennzeichnung zuoberst
  // (zweite Lesung K3, Fund 1: nie ein gedimmtes Bild ohne sichtbare Kennzeichnung).
  const nochDa = await flaechenIds(s);
  expect(nochDa, 'Flaeche unter dem Dialog verborgen').not.toContain('a-oben');
  await kennzeichnungOben(nochDa);
  await s.evaluate(() => (window as any).oeffneCookie(false));
  await expect.poll(async () => (await flaechenIds(s)).sort(), { timeout: 4000 }).toEqual([...ALLE].sort());
  expect(await sichtbarOriginal(s, 'a-oben')).toBe(false);
  await kennzeichnungOben(ALLE);
  // (b) Dialog mit Hintergrund ueber das ganze Fenster in einer Huelle: Mias Flaechen ganz weg, nach dem Schliessen wieder da
  await s.evaluate(() => (window as any).oeffneDrin(true));
  await expect.poll(async () => (await flaechenIds(s)).length, { timeout: 4000 }).toBe(0);
  const r2 = await rechteck(s, 'a-oben');
  expect((await oben(400, Math.max(100, r2.top + 100), '#drin-dialog')).imDialog, 'Dialog in Huelle liegt ueber Mias Werbung').toBe(true);
  expect(await sichtbarOriginal(s, 'a-oben'), 'Original bleibt versteckt').toBe(false);
  await abwarten(1200); // lange genug fuer mehrere Pruefungen: kein Flackern
  expect((await flaechenIds(s)).length).toBe(0);
  await s.evaluate(() => (window as any).oeffneDrin(false));
  await expect.poll(async () => (await flaechenIds(s)).sort(), { timeout: 4000 }).toEqual([...ALLE].sort());
  await kennzeichnungOben(ALLE);
  // (c) modales dialog (oberste Ebene)
  await s.evaluate(() => (window as any).oeffneModal(true));
  await abwarten(1000);
  const dr = await rechteck(s, 'modal-dialog');
  expect((await oben(dr.left + dr.width / 2, dr.top + dr.height / 2, '#modal-dialog')).imDialog, 'modales dialog liegt ueber Mias Werbung').toBe(true);
  await s.evaluate(() => (window as any).oeffneModal(false));
  await abwarten(600);
  // (d) fester Hintergrund mit z-index -1 (Skin): Mia bleibt unveraendert
  await s.evaluate(() => (window as any).zeigeSkin(true));
  await abwarten(1200);
  expect((await flaechenIds(s)).sort()).toEqual([...ALLE].sort());
  await kennzeichnungOben(ALLE);
  await s.evaluate(() => (window as any).zeigeSkin(false));
  // (e) Rollsperre mit negativem top: gerollte Seite, Flaechen bleiben am Platz und sichtbar
  await s.evaluate(() => scrollTo(0, 400));
  await abwarten(800);
  const vorher = (await flaechenIds(s)).sort();
  expect(vorher.length).toBeGreaterThanOrEqual(2);
  await s.evaluate(() => (window as any).rollSperre(true));
  await abwarten(1500);
  expect(await s.evaluate(() => getComputedStyle(document.body).top)).toBe('-400px');
  expect((await flaechenIds(s)).sort(), 'Flaechen verschwinden waehrend der Rollsperre nicht').toEqual(vorher);
  expect(await maxVersatz(s)).toBeLessThanOrEqual(2);
  // ganz im Fenster liegende Flaechen sind nicht beschnitten (Dokument-Rechteck stimmt auch bei negativem top)
  for (const f of (await standVon(s))!.flaechen.filter((x) => x.sichtbar && x.voll && x.voll.t >= 0 && x.voll.t + x.voll.h <= 720)) {
    expect(Math.abs(f.box!.h - f.voll!.h), `${f.id} nicht beschnitten`).toBeLessThanOrEqual(1);
  }
  await s.evaluate(() => (window as any).rollSperre(false));
  await abwarten(1200);
  expect((await flaechenIds(s)).sort()).toEqual(vorher);
  expect(await maxVersatz(s)).toBeLessThanOrEqual(2);
  await s.close();
});

test('Klicks und Ereignisse auf Mias Flaeche erreichen die Seite nicht (fruehe Zaehler der Seite am Fenster)', async () => {
  const s = await context.newPage();
  await s.goto(lageSeite);
  await warteAuf(s, ['a-wichtig']);
  await s.evaluate(() => document.getElementById('a-wichtig')!.scrollIntoView({ block: 'center' }));
  await abwarten(500);
  const r = await rechteck(s, 'a-wichtig');
  await s.evaluate(() => ((window as any).__ev = { gesamt: 0, aufHost: 0, typen: {} }));
  const neu = context.waitForEvent('page', { timeout: 10_000 });
  await s.mouse.move(r.left + 50, r.top + 60);
  await s.mouse.move(r.left + r.width / 2, r.top + r.height / 2 + 20);
  await s.mouse.wheel(0, 30);
  await s.mouse.click(r.left + r.width / 2, r.top + r.height / 2 + 20);
  await s.mouse.click(r.left + r.width / 2, r.top + r.height / 2 + 20, { button: 'right' });
  const tab = await neu;
  await tab.close().catch(() => {});
  const ev = await s.evaluate(() => (window as any).__ev);
  console.log(`werbung: Ereignisse der Seite auf der Flaeche: ${JSON.stringify(ev)}`);
  expect(ev.gesamt, 'kein Ereignis der Seite, solange der Zeiger auf Mias Flaeche steht').toBe(0);
  // Gegenprobe: die Zaehler arbeiten (Klick auf die Kopfleiste der Seite)
  await s.evaluate(() => scrollTo(0, 0));
  await abwarten(300);
  await s.mouse.click(100, 30);
  const danach = await s.evaluate(() => (window as any).__ev.gesamt);
  expect(danach).toBeGreaterThan(0);
  await s.close();
});

test('Flaeche in einem Link der Seite: Klick auf die Kennzeichnung, Mittelklick und Kontextmenue loesen den Seitenlink nicht aus; Ziehen, Wischen und Rad gehen durch', async () => {
  const s = await context.newPage();
  const anfragen: string[] = [];
  context.on('request', (r) => anfragen.push(r.url()));
  await s.goto(lageSeite);
  await warteAuf(s, ['a-link']);
  await s.evaluate(() => document.getElementById('a-link')!.scrollIntoView({ block: 'center' }));
  await abwarten(700);
  const f = (await standVon(s))!.flaechen.find((x) => x.id === 'a-link')!;
  const urlVorher = s.url();
  const seiten = context.pages().length;
  const bx = f.badge!.l + f.badge!.w / 2;
  const by = f.badge!.t + f.badge!.h / 2;
  anfragen.length = 0;
  await s.mouse.click(bx, by);
  await s.mouse.click(bx, by, { button: 'middle' });
  await s.mouse.click(bx, by, { button: 'right' });
  await s.keyboard.press('Escape');
  await abwarten(1200);
  const treffer = anfragen.filter((u) => u.includes('werbung-ziel-seitenlink'));
  console.log(`werbung: Klick, Mittelklick und Kontextmenue auf der Kennzeichnung im Seitenlink: ${treffer.length} Anfragen an den Seitenlink, ${context.pages().length - seiten} neue Tabs`);
  expect(treffer).toEqual([]);
  expect(context.pages().length).toBe(seiten);
  expect(s.url()).toBe(urlVorher);
  context.removeAllListeners('request');
  // Ziehen, Wischen und Rad: Bewegung, Rad und Loslassen erreichen die Seite auch ueber Mias Flaeche
  const r = await rechteck(s, 'a-link');
  await s.evaluate(() => ((window as any).__bew = { gesamt: 0, typen: {} }));
  await s.mouse.move(r.left + r.width / 2, r.top + 100);
  await s.mouse.move(r.left + r.width / 2 + 20, r.top + 120);
  const y0 = await s.evaluate(() => scrollY);
  await s.mouse.wheel(0, 120);
  await abwarten(500);
  const y1 = await s.evaluate(() => scrollY);
  // Druck beginnt auf der Seite (Ueberschrift) und endet ueber Mias Flaeche
  await s.evaluate(() => scrollTo(0, 0));
  await abwarten(300);
  await s.evaluate(() => document.getElementById('a-link')!.scrollIntoView({ block: 'center' }));
  await abwarten(500);
  const r2 = await rechteck(s, 'a-link');
  await s.evaluate(() => ((window as any).__bew = { gesamt: 0, typen: {} }));
  await s.mouse.move(700, r2.top + 20);
  await s.mouse.down();
  await s.mouse.move(r2.left + 100, r2.top + 100, { steps: 5 });
  await s.mouse.up();
  const bew = await s.evaluate(() => (window as any).__bew);
  console.log(`werbung: Durchgang ueber Mias Flaeche: Rad scrollte ${y1 - y0} px, Ereignisse der Seite ${JSON.stringify(bew.typen)}`);
  expect(y1 - y0, 'Rad ueber Mias Flaeche scrollt die Seite').toBeGreaterThan(50);
  expect(bew.typen.pointermove ?? 0).toBeGreaterThan(0);
  expect(bew.typen.mouseup ?? 0, 'Loslassen ueber Mias Flaeche erreicht die Seite').toBeGreaterThan(0);
  expect(bew.typen.pointerup ?? 0).toBeGreaterThan(0);
  await s.close();
});

test('Erwachsenenseite: spaeter eintreffendes Video oder Vorschau-Zustand nimmt die Flaeche zurueck', async () => {
  const s = await context.newPage();
  await s.goto(erwachsenSeite);
  await warteAuf(s, ['e-flaeche']);
  await s.evaluate(() => (window as any).fuegeVideoEin());
  await expect.poll(async () => (await flaechenIds(s)).includes('e-flaeche'), { timeout: 5000 }).toBe(false);
  expect(await sichtbarOriginal(s, 'e-flaeche')).toBe(true);
  await s.close();
});

// Session 17 (UX-Pruefung Phase 9 Fund 13): Etikett als Knopf mit Menue.
interface MenueStand {
  offen: boolean;
  nr: number;
  punkte: Array<{ aktion: string; text: string; x: number; y: number; w: number; h: number }>;
}
// Nur Punkte, die wirklich zu sehen sind (Rechteck groesser 0): ein Punkt mit `hidden` und `display:block` aus der Wurzel zaehlt als sichtbar (Fund 1).
const menueVon = (s: Page | Frame): Promise<MenueStand | null> =>
  s
    .evaluate(() => {
      const a = document.documentElement.getAttribute('data-veil-werbung');
      return a ? (JSON.parse(a).menue ?? null) : null;
    })
    .then((m) => (m ? { ...m, punkte: m.punkte.filter((p: { w: number; h: number }) => p.w > 0 && p.h > 0) } : null));
const kontrolleSpeicher = () =>
  worker.evaluate(async () => {
    const e = (await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen ?? {};
    return { kontrolle: e.kontrolle ?? {}, pause: !!e.pause };
  });
async function klickEtikett(s: Page, id: string) {
  await s.evaluate((i) => document.getElementById(i)!.scrollIntoView({ block: 'center' }), id);
  await abwarten(700);
  const f = (await standVon(s))!.flaechen.find((x) => x.id === id)!;
  expect(f.sichtbar, `${id} sichtbar`).toBe(true);
  await s.mouse.click(f.badge!.l + f.badge!.w / 2, f.badge!.t + f.badge!.h / 2);
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 5000 }).toBe(true);
  return f;
}
async function klickPunkt(s: Page, aktion: string) {
  const m = (await menueVon(s))!;
  const p = m.punkte.find((x) => x.aktion === aktion)!;
  expect(p, `Menuepunkt ${aktion}`).toBeTruthy();
  await s.mouse.click(p.x + p.w / 2, p.y + p.h / 2);
}

test('Etikett ist ein Knopf (mindestens 24 x 24), Klick oeffnet das Menue mit drei Punkten; Escape schliesst; Klick daneben schliesst; die Seite merkt nichts', async () => {
  await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await s.evaluate(() => {
    (window as any).__ereignisse = 0;
    for (const t of ['click', 'pointerdown', 'mousedown', 'keydown'] as const) window.addEventListener(t, () => (window as any).__ereignisse++, true);
  });
  const f = await klickEtikett(s, 'a-rahmen');
  expect(f.badge!.w, 'Etikett mindestens 24 breit').toBeGreaterThanOrEqual(24);
  expect(f.badge!.h, 'Etikett mindestens 24 hoch').toBeGreaterThanOrEqual(24);
  const m = (await menueVon(s))!;
  expect(m.punkte.map((p) => p.text)).toEqual(['Hide my ads on this site', 'Turn my ads off', 'Pause Mia']);
  for (const p of m.punkte) {
    expect(p.h, p.text).toBeGreaterThanOrEqual(24);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.w).toBeLessThanOrEqual(1280);
  }
  console.log(`werbung: Etikett ${Math.round(f.badge!.w)} x ${Math.round(f.badge!.h)} px, Menue mit ${m.punkte.length} Punkten`);
  await s.keyboard.press('Escape');
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 3000 }).toBe(false);
  // wieder auf, dann ein Druck auf die Seite schliesst
  await s.mouse.click(f.badge!.l + f.badge!.w / 2, f.badge!.t + f.badge!.h / 2);
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 3000 }).toBe(true);
  await s.mouse.click(5, 5);
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 3000 }).toBe(false);
  await s.evaluate(() => ((window as any).__ereignisse = 0)); // der Druck daneben ist ein Ereignis der Seite, die folgenden Schritte nicht
  // Pfeiltasten wandern durch die Punkte, Escape gibt den Fokus an das Etikett zurueck (Menue offen: Fokus liegt auf dem ersten Punkt)
  await s.mouse.click(f.badge!.l + f.badge!.w / 2, f.badge!.t + f.badge!.h / 2);
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 3000 }).toBe(true);
  await s.keyboard.press('ArrowDown');
  await s.keyboard.press('ArrowDown');
  await s.keyboard.press('Escape');
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 3000 }).toBe(false);
  expect(await s.evaluate(() => (window as any).__ereignisse), 'die Seite sah keinen Klick und keine Taste auf Mias Flaeche').toBe(0);
  // Flaeche bleibt, keine Einstellung hat sich geaendert
  expect((await flaechenIds(s)).includes('a-rahmen')).toBe(true);
  expect((await kontrolleSpeicher()).kontrolle.werbung).toBe(true);
  await s.close();
});

test('Menue: "Turn my ads off" schreibt kontrolle.werbung false und gibt die Originale sofort zurueck', async () => {
  await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: { ...KONTROLLE, werbungGefragt: false } });
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await klickEtikett(s, 'a-rahmen');
  await klickPunkt(s, 'ausschalten');
  await warteLeer(s);
  for (const id of ERWARTET) expect(await sichtbarOriginal(s, id), id).toBe(true);
  expect((await kontrolleSpeicher()).kontrolle.werbung).toBe(false);
  // Fund 2: wer abschaltet, hat geantwortet (sonst fragte das Popup sofort wieder "Show my ads?")
  expect((await kontrolleSpeicher()).kontrolle.werbungGefragt).toBe(true);
  await s.close();
});

test('Menue: "Hide my ads on this site" setzt den Host auf werbungAus; die Seite bleibt danach (auch nach Neuladen) ohne Werbung, andere Einstellungen bleiben', async () => {
  await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await klickEtikett(s, 'a-ins');
  await klickPunkt(s, 'verbergen');
  await warteLeer(s);
  for (const id of ERWARTET) expect(await sichtbarOriginal(s, id), id).toBe(true);
  const k = (await kontrolleSpeicher()).kontrolle;
  expect(k.werbungAus).toEqual(['127.0.0.1']);
  expect(k.werbung, 'der globale Schalter bleibt an').toBe(true);
  await s.reload();
  await abwarten(2500);
  expect(await flaechenIds(s), 'nach dem Neuladen keine Werbung').toEqual([]);
  // Eine andere Seite (anderer Host) zeigt weiter Werbung
  const t = await context.newPage();
  await t.goto(`http://localhost:${port}/werbung-nachrichten.html?fremd=${portFremd}`);
  await warteAuf(t, ERWARTET);
  await t.close();
  // Liste leeren: die Werbung kommt zurueck
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, werbungAus: [] } });
  await warteAuf(s, ERWARTET);
  await s.close();
});

test('Menue in einem eingebetteten Rahmen: "Hide my ads on this site" speichert die Seite des Tabs, nicht den Host des Rahmens', async () => {
  // Beide Listen leer: die Tab-Adresse ist im Rahmen nicht von vornherein bekannt (Fund 4).
  await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: { ...KONTROLLE, werbungAus: [] } });
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  const rahmen = s.frames().find((f) => f.url().startsWith(`http://localhost:${portFremd}/`));
  expect(rahmen, 'Rahmen auf localhost').toBeTruthy();
  await warteAuf(rahmen!, ['i-ins']);
  await s.evaluate(() => document.getElementById('n-rahmen2')!.scrollIntoView({ block: 'center' }));
  await abwarten(700);
  const versatz = (await (await rahmen!.frameElement()).boundingBox())!;
  const f = (await standVon(rahmen!))!.flaechen.find((x) => x.id === 'i-ins')!;
  expect(f.sichtbar && f.badge).toBeTruthy();
  const b = f.badge!;
  await s.mouse.click(versatz.x + b.l + b.w / 2, versatz.y + b.t + b.h / 2);
  await expect.poll(async () => (await menueVon(rahmen!))?.offen, { timeout: 5000 }).toBe(true);
  const p = (await menueVon(rahmen!))!.punkte.find((x) => x.aktion === 'verbergen');
  expect(p, 'Punkt Hide my ads on this site').toBeTruthy();
  await s.mouse.click(versatz.x + p!.x + p!.w / 2, versatz.y + p!.y + p!.h / 2);
  await expect.poll(async () => (await kontrolleSpeicher()).kontrolle.werbungAus, { timeout: 8000 }).toEqual(['127.0.0.1']);
  await s.close();
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, werbungAus: [] } });
});

// Lesung 17 R2-6: laeuft die Tab-Abfrage des Rahmens noch (hier vom Testhaken auf 9 s verzoegert), wartet "Hide my ads on this site" auf ihre
// Antwort, statt still nichts zu tun. Belegt wird das Warten: der Eintrag erscheint erst, nachdem die Antwort da sein kann (Pruefung Runde 3, N5).
test('Menue im Rahmen waehrend einer laufenden Tab-Abfrage: "Hide my ads on this site" wartet auf die Antwort und speichert die Seite des Tabs', async () => {
  // Eine eigene Ausnahme (fremder Host) laesst den Rahmen schon beim Laden nach dem Tab fragen.
  await setzeEinstellungen({ pause: false, ausnahmen: ['beispiel.invalid'], kontrolle: { ...KONTROLLE, werbungAus: [] } });
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ testTabVerzoegerung: 9000 }));
  const s = await context.newPage();
  try {
    // Die erste Abfrage des Rahmens startet erst nach dem Laden: ihre Antwort kommt fruehestens 9 s nach tLaden (Pruefung Runde 4 zu N5).
    const tLaden = Date.now();
    await s.goto(nachrichten);
    await warteAuf(s, ERWARTET);
    const rahmen = s.frames().find((f) => f.url().startsWith(`http://localhost:${portFremd}/`));
    expect(rahmen, 'Rahmen auf localhost').toBeTruthy();
    await warteAuf(rahmen!, ['i-ins']);
    await s.evaluate(() => document.getElementById('n-rahmen2')!.scrollIntoView({ block: 'center' }));
    await abwarten(300);
    // Neue Abfrage anstossen (Sichtbarkeit), damit sie sicher noch laeuft, wenn geklickt wird. Ab hier antwortet der Hintergrund fruehestens
    // nach 9 s (laeuft schon eine Abfrage, kommt deren Antwort spaeter als dieser Zeitpunkt minus 9 s).
    await rahmen!.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const tAnstoss = Date.now();
    const versatz = (await (await rahmen!.frameElement()).boundingBox())!;
    const f = (await standVon(rahmen!))!.flaechen.find((x) => x.id === 'i-ins')!;
    expect(f.sichtbar && f.badge).toBeTruthy();
    const b = f.badge!;
    await s.mouse.click(versatz.x + b.l + b.w / 2, versatz.y + b.t + b.h / 2);
    await expect.poll(async () => (await menueVon(rahmen!))?.offen, { timeout: 5000 }).toBe(true);
    const p = (await menueVon(rahmen!))!.punkte.find((x) => x.aktion === 'verbergen' && x.w > 0);
    expect(p, 'Punkt Hide my ads on this site').toBeTruthy();
    await s.mouse.click(versatz.x + p!.x + p!.w / 2, versatz.y + p!.y + p!.h / 2);
    const tKlick = Date.now();
    // Der Klick liegt sicher vor jeder Antwort (auch der Abfrage vom Laden): ohne Warten waere danach nie etwas gespeichert worden.
    expect(tKlick - tLaden, 'Klick vor der Antwort').toBeLessThan(8500);
    expect(tKlick - tAnstoss).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => (await kontrolleSpeicher()).kontrolle.werbungAus, { timeout: 15_000 }).toEqual(['127.0.0.1']);
    console.log(`werbung: Rahmen-Klick ${tKlick - tLaden} ms nach dem Laden, Eintrag nach ${Date.now() - tLaden} ms`);
  } finally {
    await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('testTabVerzoegerung'));
    await s.close();
    await setzeEinstellungen({ ausnahmen: [], kontrolle: { ...KONTROLLE, werbungAus: [] } });
  }
});

test('Menue: "Pause Mia" pausiert alles; auf einer Flaeche unter 80 px gibt es nur "Turn my ads off"', async () => {
  await setzeEinstellungen({ pause: false, ausnahmen: [], kontrolle: KONTROLLE });
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  const klein = await klickEtikett(s, 'a-anzeige');
  expect(klein.box!.h, 'a-anzeige ist niedrig').toBeLessThan(80);
  expect((await menueVon(s))!.punkte.map((p) => p.text)).toEqual(['Turn my ads off']);
  expect(klein.badge!.h).toBeGreaterThanOrEqual(24);
  await s.keyboard.press('Escape');
  await expect.poll(async () => (await menueVon(s))?.offen, { timeout: 3000 }).toBe(false);
  await klickEtikett(s, 'a-rahmen');
  await klickPunkt(s, 'pause');
  await warteLeer(s);
  for (const id of ERWARTET) expect(await sichtbarOriginal(s, id), id).toBe(true);
  await expect.poll(async () => (await kontrolleSpeicher()).pause, { timeout: 5000 }).toBe(true);
  await setzeEinstellungen({ pause: false });
  await s.close();
});

test('ohne Pack nach dem Entfernen: nichts mehr getauscht', async () => {
  const s = await context.newPage();
  await s.goto(nachrichten);
  await warteAuf(s, ERWARTET);
  await entfernePack();
  await warteLeer(s);
  for (const id of ERWARTET) expect(await sichtbarOriginal(s, id), id).toBe(true);
  await s.close();
});
