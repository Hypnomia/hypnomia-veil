import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Videos bereichsweise zensieren (Bauplan Video-Zonen), Faelle z1 bis z15 und die Presets im Video (Auftrag 4). Die Fixture video-zonen.html nimmt ein 15-s-Video auf
// (0 bis 2 s neutral, 2 bis 5 s Testbild links und wanderndes Streifenmuster rechts, 5 bis 8 s harter Schnitt, 8 bis 12 s Bild wandert mit 200 Bildpunkten
// je s, 12 bis 15 s neutral). Im Testbild liegt ein Waechter: ein Schachbrett aus 8 mal 8 Feldern zu 4 Bildpunkten in reinem Magenta und Gruen. Eine Aufnahme
// der Seite per CDP-Screencast (jedes Bild, das der Browser zeigt) darf ab dem ersten Augenblick der Zensur nie ein scharfes Schachbrett enthalten.
// Ohne Testbilder: laut uebersprungen.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47175);
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

interface Eintrag {
  t: number;
  id: string;
  was: string;
  v: string | null;
  ct: number;
}
interface Bild {
  ts: number;
  // Uebergaenge zwischen reinem Magenta und reinem Gruen von einem Bildpunkt zum naechsten, waagerecht und senkrecht (scharfes Schachbrett: je rund 450)
  quer: number;
  hoch: number;
  rosa: number;
  kante: number;
}
interface Status {
  videoPruefungen: number;
  videoZonenBilder: number;
  videoZonenGanz: number;
  videoZonenPruefungen: number;
  videoZonenRueckfall: string[];
  videoZeiten: Array<{ t: number; art: string }>;
  videoZonenMs: number;
  videoZonenMsBilder: number;
  videoZonenRtt: number[];
}

let profil: string;
let ordner: string;
let context: BrowserContext;
let worker: Worker;
let bilderDa = false;
let erweiterungsId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const antwort = await fetch(`${basis}/api/testbilder?satz=nsfw`);
  const liste = ((await antwort.json()) as { bilder: string[] }).bilder;
  bilderDa = liste.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  profil = await mkdtemp(path.join(tmpdir(), 'veil-video-zonen-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-video-zonen-pack-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!bilderDa, 'VEIL_OHNE_TESTBILDER=1');
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.remove(['einstellungen', 'pack']);
  });
});

async function setze(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const c = (globalThis as any).chrome;
    const alt = (await c.storage.local.get('einstellungen')).einstellungen ?? {};
    await c.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}

const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (s: Page): Promise<Status | null> =>
  s.evaluate(() => {
    const roh = document.documentElement.dataset.veilStatus;
    return roh ? (JSON.parse(roh) as Status) : null;
  });
const ct = (s: Page, id = 'v1') => s.evaluate((i) => (document.getElementById(i) as HTMLVideoElement).currentTime, id);
const attr = (s: Page, id: string, name: string) => s.evaluate(([i, n]) => document.getElementById(i!)?.getAttribute(n!) ?? null, [id, name]);
const eintraege = (s: Page): Promise<Eintrag[]> => s.evaluate(() => (window as any).__modus as Eintrag[]);
const sichtVerstoesse = (s: Page) => s.evaluate(() => (window as any).__sicht as unknown[]);

async function oeffne(abfrage = '', breite = 800, hoehe = 800): Promise<Page> {
  const seite = await context.newPage();
  await seite.setViewportSize({ width: breite, height: hoehe });
  await seite.goto(`${basis}/video-zonen.html?bild=${encodeURIComponent(BILD)}${abfrage ? `&${abfrage}` : ''}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 60_000, intervals: [200] }).toBe('1');
  return seite;
}

const neuesVideo = (s: Page, opt: Record<string, unknown> = { id: 'v1' }) => s.evaluate((o) => void (window as any).neuesVideo(o), opt);

// ---------- Aufnahme: jedes Bild, das der Browser zeigt ----------

async function starteAufnahme(s: Page) {
  const cdp = await context.newCDPSession(s);
  const roh: Array<{ ts: number; daten: string }> = [];
  cdp.on('Page.screencastFrame', async (f: any) => {
    roh.push({ ts: f.metadata.timestamp * 1000, daten: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return {
    async stoppe(): Promise<Bild[]> {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      const aus: Bild[] = [];
      for (const b of roh) aus.push({ ts: b.ts, ...(await messeBild(Buffer.from(b.daten, 'base64'))) });
      return aus;
    },
  };
}

// Magenta und Gruen des Waechters, auch nach der Videokomprimierung. Gezaehlt werden Uebergaenge zwischen den beiden Farben, bei denen der Lauf davor
// 2 bis 7 Bildpunkte lang war (Felder zu 4): ein scharfes Schachbrett hat je Richtung rund 220, ein Mosaik (Bloecke ab 12) und ein Blur keine.
// Dazwischenliegende andere Bildpunkte (Kantenverwaschung) bis 3 Stueck unterbrechen den Lauf nicht.
function klasse(r: number, g: number, b: number): number {
  if (r > 140 && b > 140 && g < 100) return 1;
  if (g > 160 && r < 110 && b < 110) return 2;
  return 0;
}
function zaehleUebergaenge(art: Uint8Array, breite: number, hoehe: number, quer: boolean): number {
  let n = 0;
  const aussen = quer ? hoehe : breite;
  const innen = quer ? breite : hoehe;
  for (let a = 0; a < aussen; a++) {
    let cur = 0;
    let len = 0;
    let luecke = 0;
    for (let i = 0; i < innen; i++) {
      const k = quer ? art[a * breite + i]! : art[i * breite + a]!;
      if (k === 0) {
        if (++luecke > 3) {
          cur = 0;
          len = 0;
        }
        continue;
      }
      luecke = 0;
      if (k === cur) len++;
      else {
        if (cur !== 0 && len >= 2 && len <= 7) n++;
        cur = k;
        len = 1;
      }
    }
  }
  return n;
}

// Uebergaenge des Waechters, Rosa der Rahmen (#ff4fa3) und die Kantenenergie der rechten Haelfte des Videos (x 330 bis 630, y 50 bis 310).
async function messeBild(png: Buffer): Promise<Omit<Bild, 'ts'>> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  let rosa = 0;
  const n = info.channels;
  const art = new Uint8Array(w * info.height);
  for (let i = 0, p = 0; i < data.length; i += n, p++) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    art[p] = klasse(r, g, b);
    if (r > 240 && Math.abs(g - 79) < 14 && Math.abs(b - 163) < 14) rosa++;
  }
  const quer = zaehleUebergaenge(art, w, info.height, true);
  const hoch = zaehleUebergaenge(art, w, info.height, false);
  let kante = 0;
  let zahl = 0;
  for (let y = 50; y < 310 && y < info.height; y++) {
    for (let x = 330; x < 630 && x + 1 < w; x++) {
      const i = (y * w + x) * n;
      const j = i + n;
      kante += Math.abs(data[i]! + data[i + 1]! + data[i + 2]! - data[j]! - data[j + 1]! - data[j + 2]!) / 3;
      zahl++;
    }
  }
  return { quer, hoch, rosa, kante: zahl ? kante / zahl : 0 };
}

// Toleranz am Beginn der Zensur: das Bild, das gerade im Compositor liegt, wenn das Attribut gesetzt wird, ist noch das alte (ein Bild Granularitaet).
const BEGINN_TOLERANZ_MS = 100;
const scharf = (b: Bild) => b.quer >= 100 && b.hoch >= 100;
const median = (l: number[]) => (l.length ? [...l].sort((a, b) => a - b)[l.length >> 1]! : 0);

// Beginn der Zensur (erste Bedeckung des Videos: Blur oder Leinwand, Epoche in ms): ab hier darf nie ein scharfes Schachbrett zu sehen sein.
function zensurBeginn(e: Eintrag[]): number | null {
  const x = e.find((s) => (s.was === 'data-veil-video-modus' && s.v !== null) || (s.was === 'data-veil' && (s.v === 'verdeckt' || s.v === 'zensiert')));
  return x ? x.t : null;
}
// Beginn der Zonen-Leinwand (erste Ansicht der Leinwand).
function zonenBeginn(e: Eintrag[]): number | null {
  const x = e.find((s) => s.was === 'data-veil-video-modus' && s.v !== null);
  return x ? x.t : null;
}
const wartePoll = async (bed: () => Promise<boolean>, ms = 15_000) => expect.poll(bed, { timeout: ms, intervals: [100] }).toBe(true);

// Wartet, bis das Video im Zonen-Modus ist (Leinwand da, Ansicht gesetzt).
async function warteZonen(s: Page, id = 'v1') {
  await wartePoll(async () => (await attr(s, id, 'data-veil-video-modus')) === 'zonen', 20_000);
}

// Eine Aufnahme des ersten Durchlaufs (bis 14,3 s), von mehreren Faellen ausgewertet.
interface Lauf {
  bilder: Bild[];
  log: Eintrag[];
  boxen: Array<{ t: number; ansicht: string; boxen: number[][]; arten: string[] }>;
  statusEnde: Status | null;
}
let lauf1: Lauf | null = null;
let referenzKante = 0;

async function nimmLauf(abfrage = '', bis = 14.3): Promise<Lauf> {
  const s = await oeffne(abfrage);
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  const boxen: Lauf['boxen'] = [];
  const t0 = Date.now();
  while ((await ct(s)) < bis && Date.now() - t0 < 40_000) {
    const roh = await attr(s, 'v1', 'data-veil-video-boxen');
    if (roh) boxen.push({ t: Date.now(), ...JSON.parse(roh) });
    await abwarten(150);
  }
  const bilder = await rec.stoppe();
  const lauf: Lauf = { bilder, log: await eintraege(s), boxen, statusEnde: await status(s) };
  expect(await sichtVerstoesse(s), 'Video war sichtbar, obwohl eine Leinwand lag oder kein Urteil da war').toEqual([]);
  await s.close();
  return lauf;
}

test('Aufnahme des ersten Durchlaufs im Zonen-Modus (Grundlage fuer z1, z2, z3, z15)', async () => {
  test.setTimeout(120_000);
  // Referenz: dieselbe Stelle ohne Erweiterung (Pause), Kantenenergie der rechten Haelfte
  await setze({ pause: true });
  const ref = await oeffne();
  const recRef = await starteAufnahme(ref);
  await neuesVideo(ref);
  await wartePoll(async () => (await ct(ref)) > 4.6, 30_000);
  const refBilder = await recRef.stoppe();
  await ref.close();
  // Gegenprobe der Messung selbst: ohne Erweiterung muss das Schachbrett als scharf erkannt werden (sonst waeren alle "nie scharf"-Aussagen leer erfuellt).
  expect(refBilder.filter(scharf).length, 'Referenz: das Schachbrett wird nie als scharf erkannt, die Messung ist wertlos').toBeGreaterThan(10);
  referenzKante = median(refBilder.filter((b) => b.kante > 0).map((b) => b.kante));
  expect(referenzKante, 'Referenz ohne Erweiterung hat keine Kanten').toBeGreaterThan(1);
  await setze({ pause: false });
  lauf1 = await nimmLauf();
  expect(lauf1.bilder.length).toBeGreaterThan(100);
  // Die Zeit des Screencast muss die Epoche sein (Vergleich mit den Zeitstempeln der Seite).
  const t = zensurBeginn(lauf1.log);
  expect(t, 'Zensur hat nie begonnen').not.toBeNull();
  const naechstes = lauf1.bilder.find((b) => b.ts >= t! - 2000);
  expect(naechstes, 'Zeitbasis des Screencast passt nicht zur Epoche der Seite').toBeTruthy();
});

test('z1 Zonen mit Rahmen links, rechte Haelfte scharf', async () => {
  const l = lauf1!;
  const tz = zonenBeginn(l.log)!;
  // Fenster nach dem Beginn der Leinwand (frei, dann Treffer: erst Blur, Leinwand nach der Bremse, ct ca. 3,2) und vor dem Schnitt bei 5 s.
  const fenster = l.bilder.filter((b) => b.ts > tz + 300 && b.ts < tz + 1400);
  expect(fenster.length).toBeGreaterThan(15);
  const rosa = fenster.filter((b) => b.rosa > 150).length;
  expect(rosa / fenster.length, 'pinker Rahmen in zu wenigen Bildern').toBeGreaterThan(0.8);
  const kante = median(fenster.map((b) => b.kante));
  expect(kante, `rechte Haelfte nicht scharf genug (${kante} gegen ${referenzKante})`).toBeGreaterThanOrEqual(0.8 * referenzKante);
  // Boxen liegen links (Mitte der Box in der linken Haelfte)
  const links = l.boxen.filter((b) => b.ansicht === 'zonen' && b.boxen.length);
  expect(links.length).toBeGreaterThan(5);
  for (const b of links.filter((x) => x.t > tz && x.t < tz + 1500)) for (const k of b.boxen) expect(k[0]! + k[2]! / 2, JSON.stringify(b)).toBeLessThan(330);
});

test('z2 Waechter nie scharf, auch bei Schnitt und Bewegung', async () => {
  const l = lauf1!;
  const tz = zensurBeginn(l.log)!;
  const fenster = l.bilder.filter((b) => b.ts >= tz + BEGINN_TOLERANZ_MS);
  expect(fenster.length).toBeGreaterThan(150);
  const schlecht = fenster.filter(scharf);
  expect(schlecht.length, `scharfe Bilder ab Beginn der Zensur: ${schlecht.map((b) => Math.round(b.ts - tz)).join(', ')}`).toBe(0);
  // Die Zensur hat gearbeitet: auch ganz gedeckte Bilder (Schnitt) und Pruefungen im Zonen-Modus
  expect(l.statusEnde!.videoZonenGanz).toBeGreaterThan(3);
  expect(l.statusEnde!.videoZonenPruefungen).toBeGreaterThan(40);
  expect(l.statusEnde!.videoZonenRueckfall).toEqual([]);
});

// Langsamer Erkenner (jede Antwort kuenstlich um 150 ms verzoegert, Testhaken): die Boxen sind beim Zeigen um die Verzoegerung gealtert, das Bild
// wandert mit 200 Bildpunkten je s. Nur die Verfolgung je Bild (Blockvergleich) haelt die Boxen auf dem Bild: ohne sie traegt das Schachbrett frei.
test('z2b Waechter nie scharf bei langsamem Erkenner (Verfolgung je Bild)', async () => {
  test.setTimeout(120_000);
  const s = await oeffne();
  await s.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ videoVerzoegerungMs: 150 }) })));
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  await wartePoll(async () => (await ct(s)) > 12.2, 40_000);
  const bilder = await rec.stoppe();
  const tz = zensurBeginn(await eintraege(s))!;
  const fenster = bilder.filter((b) => b.ts >= tz + BEGINN_TOLERANZ_MS);
  expect(fenster.length).toBeGreaterThan(150);
  const schlecht = fenster.filter(scharf);
  expect(schlecht.length, `scharfe Bilder bei langsamem Erkenner ab ${tz}: ${schlecht.map((b) => Math.round(b.ts - tz) + ' quer ' + b.quer + ' hoch ' + b.hoch).join(', ')}; Eintraege ${JSON.stringify((await eintraege(s)).map((e) => [Math.round(e.t - tz), e.was.slice(10), e.v, e.ct.toFixed(2)]).slice(0, 14))}`).toBe(0);
  const st = (await status(s))!;
  const rtt = [...st.videoZonenRtt].sort((a, b) => a - b);
  console.log(`z2b: Rundlauf Median ${rtt[rtt.length >> 1]} ms, ganz gedeckte Bilder ${st.videoZonenGanz} von ${st.videoZonenBilder}`);
  await s.close();
});

test('z3 harter Schnitt: Bild ganz Mosaik, null scharfe Bilder', async () => {
  const l = lauf1!;
  const schnitt = l.log.find((e) => e.was === 'data-veil-video-modus' && e.v === 'mosaik' && e.ct > 4.9 && e.ct < 5.5);
  expect(schnitt, 'kein Mosaik am Schnitt bei 5 s').toBeTruthy();
  expect(schnitt!.ct, 'Mosaik kam zu spaet nach dem Schnitt').toBeLessThan(5.15);
  const fenster = l.bilder.filter((b) => b.ts >= schnitt!.t - 300 && b.ts < schnitt!.t + 1500);
  expect(fenster.length).toBeGreaterThan(10);
  expect(fenster.filter(scharf).length).toBe(0);
  // danach wieder Zonen, aber fruehestens 1000 ms nach dem Wechsel
  const zurueck = l.log.find((e) => e.was === 'data-veil-video-modus' && e.v === 'zonen' && e.t > schnitt!.t);
  expect(zurueck, 'nach dem Schnitt nie wieder Zonen').toBeTruthy();
  expect(zurueck!.t - schnitt!.t).toBeGreaterThanOrEqual(950);
});

test('z15 Wechsel-Bremse: hoechstens 2 Wechsel je s, auch bei schnellen Schnitten', async () => {
  const wechselFolge = (log: Eintrag[]) => {
    const ts: number[] = [];
    let alt: string | null = 'x';
    for (const e of log) {
      if (e.was !== 'data-veil-video-modus') continue;
      if (e.v === alt) continue;
      alt = e.v;
      ts.push(e.t);
    }
    return ts;
  };
  const hoechstens = (ts: number[]) => Math.max(0, ...ts.map((t) => ts.filter((u) => u >= t && u < t + 1000).length));
  expect(hoechstens(wechselFolge(lauf1!.log))).toBeLessThanOrEqual(2);
  // Stress: alle 400 ms ein harter Schnitt
  const s = await nimmLauf('modus=schnell', 5.6);
  const folge = wechselFolge(s.log);
  expect(folge.length).toBeGreaterThan(2);
  expect(hoechstens(folge), JSON.stringify(folge.map((t) => Math.round(t % 100000)))).toBeLessThanOrEqual(2);
  const tz = zensurBeginn(s.log)!;
  expect(s.bilder.filter((b) => b.ts >= tz + BEGINN_TOLERANZ_MS).filter(scharf).length).toBe(0);
});

test('z4 Sprung der Abspielposition: null scharfe Bilder', async () => {
  const s = await oeffne();
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.2 && (await ct(s)) < 4.2, 10_000);
  const tSprung = await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    v.currentTime = 9.4;
    return (window as any).epoche() as number;
  });
  await wartePoll(async () => (await ct(s)) > 10.4, 15_000);
  const bilder = await rec.stoppe();
  const fenster = bilder.filter((b) => b.ts >= tSprung && b.ts < tSprung + 1800);
  expect(fenster.length).toBeGreaterThan(10);
  const schlecht = fenster.filter(scharf);
  expect(schlecht.length, `scharf nach dem Sprung: ${schlecht.map((b) => Math.round(b.ts - tSprung)).join(', ')}`).toBe(0);
  expect(await sichtVerstoesse(s)).toEqual([]);
  await s.close();
});

test('z5 Pause: Boxen bleiben, eine Sofortpruefung, nie scharf', async () => {
  const s = await oeffne();
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.4, 10_000);
  const vorher = (await status(s))!.videoZonenPruefungen;
  const tPause = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).pause();
    return (window as any).epoche() as number;
  });
  await abwarten(600);
  const nach1 = (await status(s))!.videoZonenPruefungen;
  await abwarten(1400);
  const nach2 = (await status(s))!.videoZonenPruefungen;
  const bilder = await rec.stoppe();
  expect(nach1 - vorher, 'keine Sofortpruefung nach der Pause').toBeGreaterThanOrEqual(1);
  expect(nach2 - nach1, 'in der Pause laufen keine weiteren Pruefungen').toBeLessThanOrEqual(1);
  const modus = await attr(s, 'v1', 'data-veil-video-modus');
  expect(['zonen', 'mosaik']).toContain(modus);
  const boxen = JSON.parse((await attr(s, 'v1', 'data-veil-video-boxen')) ?? '{}');
  expect(boxen.boxen?.length ?? 0, 'Boxen verschwanden in der Pause').toBeGreaterThan(0);
  expect(bilder.filter((b) => b.ts >= tPause - 200).filter(scharf).length).toBe(0);
  await s.close();
});

test('z6 Vollbild: Container behaelt die Leinwand, das Video selbst wird ganz verdeckt', async () => {
  const s = await oeffne();
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.0, 10_000);
  // a) Container
  await s.locator('#platz').click({ position: { x: 300, y: 200 } });
  const ok = await s.evaluate(async () => {
    try {
      await document.getElementById('platz')!.requestFullscreen();
      return document.fullscreenElement?.id === 'platz';
    } catch {
      return false;
    }
  });
  const tA = await s.evaluate(() => (window as any).epoche() as number);
  if (ok) {
    await abwarten(1500);
    expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
    expect(await attr(s, 'v1', 'data-veil')).toBe('zensiert');
    await s.evaluate(() => document.exitFullscreen());
    await abwarten(500);
  }
  // b) das Video selbst
  await s.locator('#platz').click({ position: { x: 300, y: 200 } });
  const okV = await s.evaluate(async () => {
    try {
      await (document.getElementById('v1') as HTMLVideoElement).requestFullscreen();
      return document.fullscreenElement?.id === 'v1';
    } catch {
      return false;
    }
  });
  const tB = await s.evaluate(() => (window as any).epoche() as number);
  if (okV) {
    await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 1500, intervals: [30] }).toBe('verdeckt');
    expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
    await abwarten(800);
    await s.evaluate(() => document.exitFullscreen());
    await expect.poll(() => attr(s, 'v1', 'data-veil-leinwand'), { timeout: 8000, intervals: [100] }).not.toBeNull();
  }
  const bilder = await rec.stoppe();
  expect(ok || okV, 'Vollbild ging in diesem Browser nicht (weder Container noch Video)').toBe(true);
  expect(bilder.filter((b) => b.ts >= Math.min(ok ? tA : Infinity, okV ? tB : Infinity) - 100).filter(scharf).length).toBe(0);
  await s.close();
});

test('z7 Bild-in-Bild gesperrt, solange die Leinwand liegt', async () => {
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  expect(await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).disablePictureInPicture)).toBe(true);
  const ergebnis = await s.evaluate(async () => {
    try {
      await (document.getElementById('v1') as any).requestPictureInPicture();
      return 'ging';
    } catch (e) {
      return 'abgelehnt';
    }
  });
  expect(ergebnis).toBe('abgelehnt');
  // Die Seite setzt das Attribut zurueck: die Erweiterung sperrt erneut
  await s.evaluate(() => ((document.getElementById('v1') as HTMLVideoElement).disablePictureInPicture = false));
  await expect.poll(() => s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).disablePictureInPicture), { timeout: 3000, intervals: [100] }).toBe(true);
  // Pause der Erweiterung: der alte Wert (false) kommt zurueck
  await setze({ pause: true });
  await expect.poll(() => s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).disablePictureInPicture), { timeout: 5000, intervals: [100] }).toBe(false);
  await s.close();
});

test('z8 Klick erreicht das Video, die Bedienleiste der Seite bleibt darueber', async () => {
  const s = await oeffne();
  await s.evaluate(() => {
    (window as any).__klicks = 0;
  });
  await neuesVideo(s);
  await s.evaluate(() => document.getElementById('v1')!.addEventListener('click', () => ((window as any).__klicks += 1)));
  await warteZonen(s);
  await s.mouse.click(300, 150);
  expect(await s.evaluate(() => (window as any).__klicks)).toBe(1);
  // Die Leiste der Seite (z-index 5, links unten im Video) liegt ueber der Leinwand: ihre Farbe (0, 170, 0) steht im Bild
  const png = await s.screenshot();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (337 * info.width + 14) * info.channels;
  expect(Math.abs(data[i]! - 0) + Math.abs(data[i + 1]! - 170) + Math.abs(data[i + 2]! - 0)).toBeLessThan(40);
  await s.close();
});

test('z9 fremdes Video ohne CORS nie Zonen, Etikett sagt warum', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await s.evaluate(async () => {
    const b = await (await fetch((window as any).neueQuelle())).blob();
    await fetch('/ablage/film.webm', { method: 'POST', body: b, headers: { 'content-type': b.type || 'video/webm' } });
  });
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'f1', quelle: `http://127.0.0.1:${portFremd}/ablage/film.webm` });
  await expect.poll(() => attr(s, 'f1', 'data-veil'), { timeout: 15_000, intervals: [100] }).toBe('verdeckt');
  await wartePoll(async () => (await ct(s, 'f1')) > 3.5, 20_000);
  expect(await attr(s, 'f1', 'data-veil-leinwand')).toBeNull();
  expect(await attr(s, 'f1', 'data-veil-video-modus')).toBeNull();
  expect(await attr(s, 'f1', 'data-veil')).toBe('verdeckt');
  expect(await attr(s, 'f1', 'data-veil-video-etikett')).toContain('can’t see inside');
  const bilder = await rec.stoppe();
  expect(bilder.filter((b) => b.ts > Date.now() - 4000).filter(scharf).length).toBe(0);
  expect((await status(s))!.videoZonenBilder).toBe(0);
  await s.close();
});

test('z10 zwei Videos: genau eins mit Leinwand, das andere ganz, Budget eingehalten', async () => {
  const s = await oeffne();
  await neuesVideo(s, { id: 'a' });
  await neuesVideo(s, { id: 'b' });
  await wartePoll(async () => (await s.evaluate(() => document.querySelectorAll('video[data-veil-leinwand]').length)) === 1, 20_000);
  const s0 = (await status(s))!;
  await abwarten(5000);
  const s1 = (await status(s))!;
  const mitLeinwand = await s.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.hasAttribute('data-veil-leinwand')).map((v) => v.id));
  expect(mitLeinwand.length, JSON.stringify(mitLeinwand)).toBe(1);
  const andere = mitLeinwand[0] === 'a' ? 'b' : 'a';
  // das andere Video gilt als verdeckt (ganz), sobald es einen Treffer hatte; im Abschnitt ohne Treffer darf es frei sein
  expect(['verdeckt', 'frei', null]).toContain(await attr(s, andere, 'data-veil'));
  const ohneZonen = s1.videoPruefungen - s1.videoZonenPruefungen - (s0.videoPruefungen - s0.videoZonenPruefungen);
  expect(ohneZonen, 'Pruefungen der anderen Videos ueber dem Budget').toBeLessThanOrEqual(6 * 5);
  const zeitenJeS = s1.videoZeiten.length;
  expect(zeitenJeS).toBeGreaterThan(0);
  await s.close();
});

test('z11 Pause der Erweiterung: alles weg, Video frei und scharf', async () => {
  const s = await oeffne();
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.2, 10_000);
  await setze({ pause: true });
  await expect.poll(() => attr(s, 'v1', 'data-veil-leinwand'), { timeout: 5000, intervals: [50] }).toBeNull();
  expect(await attr(s, 'v1', 'data-veil')).toBeNull();
  expect(await attr(s, 'v1', 'data-veil-video-modus')).toBeNull();
  expect(await s.evaluate(() => document.querySelectorAll('#platz > div').length), 'Host der Leinwand ist noch da').toBe(1);
  // das Video ist jetzt wirklich zu sehen: das Waechter-Schachbrett wird scharf, solange das Bild im Testbild-Abschnitt ist
  await wartePoll(async () => (await ct(s)) > 4.2 || (await ct(s)) < 3.0, 6000);
  await abwarten(400);
  const bilder = await rec.stoppe();
  const spaet = bilder.filter((b) => b.ts > Date.now() - 1200);
  expect(spaet.length).toBeGreaterThan(3);
  // Gegenprobe der Messung: ohne Erweiterung ist das Schachbrett wirklich scharf zu sehen
  expect(spaet.some(scharf), 'in der Pause der Erweiterung muss das Schachbrett scharf erkannt werden').toBe(true);
  // danach geht es weiter wie vorher
  await setze({ pause: false });
  await warteZonen(s);
  await s.close();
});

test('z12 video ganz: wie heute, ganzes Video verdeckt, nie Leinwand', async () => {
  await setze({ video: 'ganz' });
  const s = await oeffne();
  const rec = await starteAufnahme(s);
  await neuesVideo(s);
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 20_000, intervals: [100] }).toBe('verdeckt');
  const tV = await s.evaluate(() => (window as any).epoche() as number);
  await wartePoll(async () => (await ct(s)) > 4.8, 20_000);
  expect(await s.evaluate(() => document.querySelectorAll('video[data-veil-leinwand], [data-veil-video-modus]').length)).toBe(0);
  expect(await s.evaluate(() => document.querySelectorAll('#platz > div').length)).toBe(1);
  const bilder = await rec.stoppe();
  expect(bilder.filter((b) => b.ts >= tV + BEGINN_TOLERANZ_MS).filter(scharf).length).toBe(0);
  expect(await sichtVerstoesse(s)).toEqual([]);
  await s.close();
});

test('z13 Spiegel-Leinwand: das Video bekommt nie eine Zonen-Leinwand', async () => {
  const s = await oeffne();
  await neuesVideo(s);
  await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    const c = document.createElement('canvas');
    c.id = 'sp';
    c.width = 640;
    c.height = 360;
    c.style.cssText = 'position:absolute;left:0;top:0;width:640px;height:360px';
    document.getElementById('platz')!.appendChild(c);
    const g = c.getContext('2d')!;
    const z = () => {
      g.drawImage(v, 0, 0, 640, 360);
      requestAnimationFrame(z);
    };
    z();
  });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 20_000, intervals: [100] }).toBe('verdeckt');
  for (let i = 0; i < 25; i++) {
    expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
    await abwarten(200);
  }
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect(await attr(s, 'sp', 'data-veil')).toBe('verdeckt');
  await s.close();
});

test('z14 Video mit controls: nie Zonen', async () => {
  const s = await oeffne();
  await neuesVideo(s, { id: 'v1', controls: true });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 20_000, intervals: [100] }).toBe('verdeckt');
  for (let i = 0; i < 20; i++) {
    expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
    await abwarten(200);
  }
  expect(await attr(s, 'v1', 'data-veil-video-etikett')).toBeTruthy();
  await s.close();
});

// ---------- Runde 2 ----------

test('R1 Treffer, dann saubere Antworten: das Video bleibt ganz gedeckt, bis die Hysterese es frei gibt (nie ein klares Bild)', async () => {
  const l = lauf1!;
  const schnitt12 = l.log.find((e) => e.was === 'data-veil-video-modus' && e.v === 'mosaik' && e.ct > 11.9 && e.ct < 12.6);
  expect(schnitt12, 'kein Mosaik am Schnitt bei 12 s').toBeTruthy();
  // Nach dem Schnitt in den neutralen Abschnitt (keine Treffer mehr): nie wieder "zonen" ohne Boxen, solange das Video noch verdeckt ist.
  const danach = l.log.filter((e) => e.was === 'data-veil-video-modus' && e.t > schnitt12!.t);
  // Erlaubt ist ein leeres Zonen-Bild erst, wenn die Hysterese erfuellt ist (3 s Medienzeit nach der letzten Antwort mit Boxen, der Testbild-Abschnitt endet bei 12 s, die letzte Antwort liegt je nach Takt zwischen 11,4 und 12 s, also frei ab 14,4 bis 15 s), kurz vor dem Frei.
  expect(danach.filter((e) => e.v === 'zonen' && e.ct > 11.9 && e.ct < 14.4).length, JSON.stringify(danach.map((e) => [e.v, e.ct]))).toBe(0);
  const proben = l.boxen.filter((b) => b.t > schnitt12!.t + 400);
  expect(proben.length).toBeGreaterThan(5);
  for (const b of proben) expect(b.ansicht, JSON.stringify(b)).toBe('ganz');
  expect(proben.some((b) => (b as any).grund === 'leer')).toBe(true);
  expect(l.bilder.filter((b) => b.ts >= schnitt12!.t).filter(scharf).length).toBe(0);
});

test('R6 frei, dann Treffer: erst verdeckt (Blur), die Zonen-Leinwand fruehestens 1000 ms danach', async () => {
  const l = lauf1!;
  const folge = l.log.filter((e) => e.was === 'data-veil' && e.v !== null);
  const iF = folge.findIndex((e) => e.v === 'frei');
  expect(iF, JSON.stringify(folge.map((e) => [e.v, e.ct]))).toBe(0);
  expect(folge[1]!.v, 'nach frei zuerst verdeckt, nicht gleich zensiert').toBe('verdeckt');
  const zens = folge.find((e) => e.v === 'zensiert');
  expect(zens, 'danach zensiert (Leinwand)').toBeTruthy();
  expect(zens!.t - folge[1]!.t, 'Leinwand zu frueh nach dem Blur').toBeGreaterThanOrEqual(950);
});

test('R7 Seite haengt das Video in einen anderen Container um: der Host zieht mit', async () => {
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  await s.evaluate(() => {
    const neu = document.createElement('div');
    neu.id = 'platz2';
    neu.style.cssText = 'position:relative;width:640px;margin-top:20px';
    document.body.insertBefore(neu, document.getElementById('abstand'));
    neu.appendChild(document.getElementById('v1')!);
  });
  await expect.poll(() => s.evaluate(() => document.querySelectorAll('#platz2 > div').length), { timeout: 3000, intervals: [100] }).toBe(1);
  expect(await s.evaluate(() => document.querySelectorAll('#platz > div').length), 'alter Host blieb zurueck').toBe(1);
  expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
  expect(await sichtVerstoesse(s)).toEqual([]);
  await s.close();
});

// Lagewecker (src/schleier/lagewecker.ts): in der Pause kommt kein neues Bild; macht die Seite den Behaelter dann zum Bezug, liegt der Host der Leinwand
// spaetestens im zweiten Bild wieder genau auf dem Video, ohne auf den Lage-Takt (400 ms) zu warten. Gemessen im rAF des dritten Bildes nach der Aenderung.
test('F Leinwand in der Pause: Behaelter wird Bezug, der Host liegt spaetestens im zweiten Bild genau auf dem Video', async () => {
  const s = await oeffne();
  await s.evaluate(() => {
    (window as any).__fehler = [];
    addEventListener('error', (e) => (window as any).__fehler.push(String((e as ErrorEvent).message ?? e.type)));
    // Behaelter mit Abstand, zunaechst ohne Bezug: der Host richtet sich am Dokument aus.
    document.getElementById('platz')!.style.cssText = 'position:static;margin-left:40px;margin-top:24px';
  });
  await neuesVideo(s);
  await warteZonen(s);
  await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).pause());
  await abwarten(1500);
  const m = await s.evaluate(async () => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    const host = v.nextElementSibling as HTMLElement;
    const abw = () => {
      const h = host.getBoundingClientRect();
      const r = v.getBoundingClientRect();
      return Math.max(Math.abs(h.x - r.x), Math.abs(h.y - r.y), Math.abs(h.width - r.width), Math.abs(h.height - r.height));
    };
    const vorher = abw();
    document.getElementById('platz')!.style.position = 'relative';
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
    return { vorher, bilder, weg, pausiert: v.paused };
  });
  console.log(`chromium video-zonen F: vorher ${m.vorher}, Bild 1..3 ${m.bilder.join(' ')}`);
  expect(m.pausiert).toBe(true);
  expect(m.vorher).toBeLessThanOrEqual(0.5);
  expect(m.weg, 'die Aenderung legt Host und Video wirklich auseinander').toBeGreaterThan(2);
  expect(m.bilder[2], 'Host im zweiten Bild genau auf dem Video').toBeLessThanOrEqual(0.5);
  expect(await s.evaluate(() => (window as any).__fehler), 'kein error am Fenster').toEqual([]);
  expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
  await s.close();
});

// Lagewecker, Ruhe mit stehender Leinwand: Video in Pause, Zonen-Leinwand aktiv. 1,5 s nach dem letzten Anlass schlaeft der Wecker und sein Bildzaehler
// steht (Testhaken data-veil-lagewecker): eigene Takt-Schreiber auf dem Video (Bild-in-Bild-Sperre) duerfen ihn nicht wach halten.
test('H Ruhe mit stehender Leinwand: der Lagewecker schlaeft', async () => {
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).pause());
  await abwarten(1000);
  // Ein Anlass der Seite weckt ihn sicher einmal; danach muss er von selbst wieder einschlafen.
  await s.evaluate(() => document.body.setAttribute('data-anlass', '1'));
  await abwarten(1500);
  const lies = () => s.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-veil-lagewecker') ?? 'null'));
  const w1 = await lies();
  await abwarten(1500);
  const w2 = await lies();
  console.log(`chromium video-zonen H: ${JSON.stringify([w1, w2])}`);
  expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
  expect(w1?.bilder ?? 0, 'der Anlass hat den Wecker geweckt').toBeGreaterThan(0);
  expect(w1?.wach, 'Wecker schlaeft 1,5 s nach dem Anlass bei stehender Leinwand').toBe(false);
  expect(w2?.wach).toBe(false);
  expect(w2?.bilder, 'Bildzaehler steht').toBe(w1?.bilder);
  await s.close();
});

// Groessen-Uebergang des Videos (640 x 360 nach 480 x 270 in 300 ms), einmal in Pause, einmal laufend: je Bild ist die Leinwand nie leer gemalt
// (Testhaken data-veil-video-leer) und der Host liegt hoechstens 1 px neben dem Video. Laeuft das Video, legt schon der Bild-Rueckruf (rvfc, vor dem
// rAF) den Host fuer das naechste Bild; der Vergleich im naechsten rAF taugt dann nicht. Gemessen wird darum in der ResizeObserver-Phase: ein Beobachter
// der Seite misst Host gegen Video. Chromium ruft ihn nach unserem (spaeter angelegt); Firefox ruft die Beobachter der Seite vor denen des Content-Scripts.
// Darum misst zusaetzlich ein MutationObserver am Host neu, wenn unser Legen nach dem Rueckruf der Seite im selben Bild kam (Video-Rechteck unveraendert).
async function groessenUebergang(s: Page) {
  return s.evaluate(async () => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    const host = v.nextElementSibling as HTMLElement;
    const leer0 = Number(v.getAttribute('data-veil-video-leer') ?? 0);
    const werte: number[] = [];
    let wert: number | null = null;
    let gemalt: DOMRect | null = null;
    const abw = (r: DOMRect) => {
      const h = host.getBoundingClientRect();
      return Math.max(Math.abs(h.x - r.x), Math.abs(h.y - r.y), Math.abs(h.width - r.width), Math.abs(h.height - r.height));
    };
    const ro = new ResizeObserver(() => {
      gemalt = v.getBoundingClientRect();
      wert = abw(gemalt);
    });
    const mo = new MutationObserver(() => {
      if (!gemalt) return;
      const r = v.getBoundingClientRect();
      if (Math.abs(r.x - gemalt.x) + Math.abs(r.y - gemalt.y) + Math.abs(r.width - gemalt.width) + Math.abs(r.height - gemalt.height) < 0.01) wert = abw(r);
    });
    mo.observe(host, { attributes: true });
    let laeuft = true;
    v.addEventListener('transitionend', () => (laeuft = false));
    v.style.transition = 'width 300ms linear, height 300ms linear';
    void v.offsetWidth;
    v.style.width = '480px';
    v.style.height = '270px';
    let nach = 0;
    await new Promise<void>((fertig) => {
      const schritt = () => {
        if (wert !== null) werte.push(wert);
        wert = null;
        gemalt = null;
        ro.unobserve(v);
        ro.observe(v);
        if (!laeuft && ++nach > 3) {
          mo.disconnect();
          return fertig();
        }
        requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    });
    const leer = Number(v.getAttribute('data-veil-video-leer') ?? 0) - leer0;
    return { bilder: werte.length, max: Math.max(...werte), leer, breite: Math.round(v.getBoundingClientRect().width), pausiert: v.paused };
  });
}
for (const art of ['Pause', 'laufend'] as const) {
  test(`G Groessen-Uebergang ${art}: Leinwand nie leer gemalt, Host hoechstens 1 px neben dem Video`, async () => {
    const s = await oeffne();
    await s.evaluate(() => {
      (window as any).__fehler = [];
      addEventListener('error', (e) => (window as any).__fehler.push(String((e as ErrorEvent).message ?? e.type)));
    });
    await neuesVideo(s);
    await warteZonen(s);
    if (art === 'Pause') {
      await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).pause());
      await abwarten(600);
    }
    const m = await groessenUebergang(s);
    console.log(`chromium video-zonen G ${art}: ${JSON.stringify(m)}`);
    expect(m.pausiert).toBe(art === 'Pause');
    expect(m.breite).toBe(480);
    expect(m.bilder).toBeGreaterThan(8);
    expect(m.leer, 'leer gemalte Bilder').toBe(0);
    expect(m.max, 'groesste Abweichung Host gegen Video').toBeLessThanOrEqual(1);
    expect(await s.evaluate(() => (window as any).__fehler), 'kein error am Fenster').toEqual([]);
    expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
    await s.close();
  });
}

// Kleiner Ablauf fuer die Randfaelle: Aufnahme, Video starten, bis zur Zonen-Leinwand warten.
async function startePruefling(abfrage = '', opt: Record<string, unknown> = { id: 'v1' }, vorher?: (s: Page) => Promise<unknown>) {
  const s = await oeffne(abfrage);
  if (vorher) await vorher(s);
  const rec = await starteAufnahme(s);
  await neuesVideo(s, opt);
  return { s, rec };
}
const keineScharfenAbBeginn = async (s: Page, bilder: Bild[], text: string) => {
  const tz = zensurBeginn(await eintraege(s));
  expect(tz, `${text}: Zensur hat nie begonnen`).not.toBeNull();
  const fenster = bilder.filter((b) => b.ts >= tz! + BEGINN_TOLERANZ_MS);
  expect(fenster.length, text).toBeGreaterThan(30);
  expect(fenster.filter(scharf).length, `${text}: scharfe Bilder`).toBe(0);
};

test('R13a Rueckrufschleife ueber requestAnimationFrame (Pfad von Firefox 128), auch bei Bewegung', async () => {
  test.setTimeout(90_000);
  const { s, rec } = await startePruefling('', { id: 'v1' }, (p) =>
    p.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ohneRvfc: true }) }))),
  );
  await wartePoll(async () => (await ct(s)) > 11.5, 40_000);
  const bilder = await rec.stoppe();
  await keineScharfenAbBeginn(s, bilder, 'rAF');
  expect(await attr(s, 'v1', 'data-veil')).toBe('zensiert');
  await s.close();
});

test('R13b Bewegung mit 400 Bildpunkten je s: nie scharf', async () => {
  test.setTimeout(120_000);
  const { s, rec } = await startePruefling('speed=400');
  await wartePoll(async () => (await ct(s)) > 11.5, 60_000);
  const bilder = await rec.stoppe();
  await keineScharfenAbBeginn(s, bilder, '400 px/s');
  await s.close();
});

test('R13c Hintergrund-Tab und Rueckkehr: nach der Rueckkehr nie ein scharfes Bild', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  const s2 = await context.newPage();
  await s2.goto('about:blank');
  await s2.bringToFront();
  await abwarten(2500);
  await s.bringToFront();
  const rec = await starteAufnahme(s);
  const tR = await s.evaluate(() => (window as any).epoche() as number);
  await abwarten(2000);
  const bilder = await rec.stoppe();
  const fenster = bilder.filter((b) => b.ts >= tR);
  expect(fenster.length).toBeGreaterThan(10);
  expect(fenster.filter(scharf).length, 'scharfe Bilder nach der Rueckkehr').toBe(0);
  expect(await sichtVerstoesse(s)).toEqual([]);
  await s2.close();
  await s.close();
});

test('R13d Quellwechsel bei laufender Leinwand: Video nie sichtbar, danach wieder bewertet', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).src = (window as any).neueQuelle();
  });
  await expect.poll(() => attr(s, 'v1', 'data-veil-leinwand'), { timeout: 5000, intervals: [50] }).toBeNull();
  expect(await s.evaluate(() => document.querySelectorAll('#platz > div').length), 'Host nach dem Quellwechsel noch da').toBe(1);
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 15_000, intervals: [100] }).toBe('frei');
  expect(await sichtVerstoesse(s)).toEqual([]);
  await s.close();
});

test('R13e Groessenwechsel bei laufender Leinwand: nie scharf, Leinwand bleibt', async () => {
  const { s, rec } = await startePruefling();
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.6, 10_000);
  const t = await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    v.style.width = '480px';
    v.style.height = '270px';
    return (window as any).epoche() as number;
  });
  await abwarten(1100);
  const bilder = await rec.stoppe();
  expect(bilder.filter((b) => b.ts >= t).length).toBeGreaterThan(10);
  expect(bilder.filter((b) => b.ts >= t).filter(scharf).length).toBe(0);
  expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
  await s.close();
});

test('R13f Einstellung zonen zu ganz zur Laufzeit: Leinwand weg, ganzes Video verdeckt, nie scharf', async () => {
  const { s, rec } = await startePruefling();
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.6, 10_000);
  await setze({ video: 'ganz' });
  const t = await s.evaluate(() => (window as any).epoche() as number);
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 5000, intervals: [50] }).toBe('verdeckt');
  expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
  expect(await s.evaluate(() => document.querySelectorAll('#platz > div').length)).toBe(1);
  await abwarten(900);
  const bilder = await rec.stoppe();
  expect(bilder.filter((b) => b.ts >= t).filter(scharf).length).toBe(0);
  await s.close();
});

test('R13g Langsam-Rueckfall: ganz verdeckt mit Etikett, Hinweis im Speicher fuer das Popup, nie scharf', async () => {
  test.setTimeout(90_000);
  const { s, rec } = await startePruefling('', { id: 'v1' }, (p) =>
    p.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ videoVerzoegerungMs: 600 }) }))),
  );
  await expect.poll(async () => (await attr(s, 'v1', 'data-veil-video-etikett')) ?? '', { timeout: 40_000, intervals: [100] }).toContain('Too slow');
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
  const um = await worker.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('videoLangsamUm')).videoLangsamUm ?? 0) as number);
  expect(Date.now() - um).toBeLessThan(60_000);
  await abwarten(500);
  const bilder = await rec.stoppe();
  await keineScharfenAbBeginn(s, bilder, 'langsam');
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('videoLangsamUm'));
  await s.close();
});

test('R13h Untertitel showing: nie Zonen, ganz verdeckt mit Etikett', async () => {
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  await s.evaluate(() => {
    const t = (document.getElementById('v1') as HTMLVideoElement).addTextTrack('subtitles', 'Test', 'en');
    t.mode = 'showing';
  });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 5000, intervals: [100] }).toBe('verdeckt');
  expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
  expect(await attr(s, 'v1', 'data-veil-video-etikett')).toBeTruthy();
  await s.close();
});

test('R13i object-fit cover in einer 4:3-Box und scaleX(-1): die Boxen decken das Bild, nie scharf', async () => {
  test.setTimeout(90_000);
  for (const [name, opt] of [
    ['cover', { id: 'v1', breite: 400, hoehe: 300, fit: 'cover' }],
    ['gespiegelt', { id: 'v1', transform: 'scaleX(-1)' }],
  ] as const) {
    const { s, rec } = await startePruefling('', opt);
    await warteZonen(s);
    await wartePoll(async () => (await ct(s)) > 9.5, 40_000);
    const bilder = await rec.stoppe();
    await keineScharfenAbBeginn(s, bilder, name);
    await s.close();
  }
});

test('R13j Popup: Hinweis "Too slow to follow closely here" nur kurz nach einem Langsam-Rueckfall', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${erweiterungsId}/popup.html`);
  await expect(popup.locator('#video-langsam')).toBeHidden();
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ videoLangsamUm: Date.now() }));
  await expect(popup.locator('#video-langsam')).toBeVisible({ timeout: 3000 });
  await expect(popup.locator('#video-langsam')).toContainText('Too slow to follow closely here');
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ videoLangsamUm: Date.now() - 120_000 }));
  await expect(popup.locator('#video-langsam')).toBeHidden({ timeout: 3000 });
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('videoLangsamUm'));
  await popup.close();
});

// ---------- Runde 3 ----------

const testEreignis = (s: Page, detail: Record<string, unknown>) =>
  s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), detail);
const modusFolge = async (s: Page, ms: number): Promise<string[]> => {
  const aus: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const roh = await attr(s, 'v1', 'data-veil-video-boxen');
    const b = roh ? JSON.parse(roh) : null;
    aus.push(`${(await attr(s, 'v1', 'data-veil-video-modus')) ?? 'null'}/${b?.grund ?? ''}`);
    await abwarten(100);
  }
  return aus;
};

test('N1a Sprung weit nach vorn, danach nur saubere Antworten: ganz gedeckt, bis 3 s saubere Zeit beobachtet sind', async () => {
  test.setTimeout(90_000);
  const { s, rec } = await startePruefling();
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.4 && (await ct(s)) < 4.3, 10_000);
  // Der Erkenner "verpasst" ab jetzt jedes Bild: jede Antwort ist sauber, auch im Testbild-Abschnitt bei 5,5 s (dort liegt der Waechter)
  await testEreignis(s, { erzwingeSauber: true });
  const t = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).currentTime = 5.5; // Szene mit Waechter, bis 8 s ohne Schnitt
    return (window as any).epoche() as number;
  });
  const roh = await modusFolge(s, 2300);
  const bilder = await rec.stoppe();
  // Die ersten Proben koennen noch vor dem Sprung liegen (Seek ist asynchron): ab der ersten Bedeckung durch die neue Szene zaehlen.
  const folge = roh.slice(Math.max(0, roh.findIndex((f) => f.startsWith('mosaik'))));
  expect(folge.filter((f) => f.startsWith('zonen')), JSON.stringify(roh)).toEqual([]);
  expect(folge.some((f) => f === 'mosaik/leer'), `nie "leer" gehalten: ${JSON.stringify(folge)}`).toBe(true);
  const nach = bilder.filter((b) => b.ts >= t);
  expect(nach.length).toBeGreaterThan(10);
  expect(nach.filter(scharf).length, 'scharfe Bilder nach dem Sprung').toBe(0);
  // Nach 3 s beobachteter sauberer Zeit gibt das Video frei
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 8000, intervals: [100] }).toBe('frei');
  await s.close();
});

test('N1b Wegscrollen (Video lief unbeobachtet weiter), danach nur saubere Antworten: ganz gedeckt', async () => {
  // Ein verborgener Tab laesst sich im Headless-Chromium nicht herstellen (visibilityState bleibt "visible"); Wegscrollen nimmt denselben Weg
  // (Video unsichtbar, nicht verarbeitet, danach neueSzene). Der Pfad ueber visibilitychange ist darum nur durch R13c (Chromium) abgedeckt.
  test.setTimeout(90_000);
  const s = await oeffne();
  await neuesVideo(s);
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 3.4 && (await ct(s)) < 4.0, 10_000);
  await testEreignis(s, { erzwingeSauber: true });
  await s.evaluate(() => window.scrollTo(0, 1500));
  await abwarten(1700);
  const rec = await starteAufnahme(s);
  await s.evaluate(() => window.scrollTo(0, 0));
  const t = await s.evaluate(() => (window as any).epoche() as number);
  const roh = await modusFolge(s, 1700);
  const bilder = await rec.stoppe();
  expect(await ct(s)).toBeGreaterThan(5);
  // die ersten Proben zeigen noch das alte, gedeckte Standbild der Leinwand: ab der ersten Bedeckung durch die neue Szene zaehlen
  const folge = roh.slice(Math.max(0, roh.findIndex((f) => f.startsWith('mosaik'))));
  expect(folge.filter((f) => f.startsWith('zonen')), JSON.stringify(roh)).toEqual([]);
  expect(bilder.filter((b) => b.ts >= t).filter(scharf).length, `scharfe Bilder nach dem Zurueckscrollen ${JSON.stringify(folge)}`).toBe(0);
  await s.close();
});

test('N2 Rundlauf ueber der Grenze: sauberer Rueckfall mit Etikett statt Flackern zwischen ganz und Zonen', async () => {
  test.setTimeout(90_000);
  const { s } = await startePruefling('', { id: 'v1' }, (p) => testEreignis(p, { videoVerzoegerungMs: 280 }));
  await expect.poll(async () => (await attr(s, 'v1', 'data-veil-video-etikett')) ?? '', { timeout: 40_000, intervals: [100] }).toContain('Too slow');
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect(await attr(s, 'v1', 'data-veil-leinwand')).toBeNull();
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('videoLangsamUm'));
  await s.close();
});

test('N2b Rundlauf unter der Grenze (Antwort 100 ms verzoegert): kein Rueckfall, hoechstens 2 Wechsel je s', async () => {
  test.setTimeout(90_000);
  const { s } = await startePruefling('', { id: 'v1' }, (p) => testEreignis(p, { videoVerzoegerungMs: 100 }));
  await warteZonen(s);
  await wartePoll(async () => (await ct(s)) > 4.6, 20_000);
  expect((await attr(s, 'v1', 'data-veil-video-etikett')) ?? '').not.toContain('Too slow');
  const wechsel = (await eintraege(s)).filter((e) => e.was === 'data-veil-video-modus').map((e) => e.t);
  const jeS = Math.max(0, ...wechsel.map((t) => wechsel.filter((u) => u >= t && u < t + 1000).length));
  expect(jeS, JSON.stringify(wechsel.map((t) => Math.round(t % 100000)))).toBeLessThanOrEqual(2);
  await s.close();
});

test('N3 Erste-Bild-Frist: ein unsichtbar gewordenes Video loest keine Stoerung aus, sichtbar wieder schon', async () => {
  test.setTimeout(90_000);
  const s = await oeffne();
  await testEreignis(s, { malenAus: true });
  await neuesVideo(s);
  await expect.poll(() => attr(s, 'v1', 'data-veil-leinwand'), { timeout: 20_000, intervals: [30] }).not.toBeNull();
  await s.evaluate(() => window.scrollTo(0, 1500));
  await abwarten(1800);
  expect(await attr(s, 'v1', 'data-veil'), 'Stoerung trotz unsichtbarem Video').toBe('zensiert');
  expect(await attr(s, 'v1', 'data-veil-leinwand')).not.toBeNull();
  await s.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 5000, intervals: [100] }).toBe('verdeckt');
  expect((await status(s))!.videoZonenRueckfall).toContain('keine Bilder');
  await s.close();
});

test('M2 Zeit je Bild fuer Malen und Verfolgung (Messung, kein Grenzwert)', async () => {
  const l = lauf1!;
  const st = l.statusEnde!;
  console.log(`M2 chromium: ${(st.videoZonenMs / Math.max(1, st.videoZonenMsBilder)).toFixed(2)} ms je Bild (${st.videoZonenMsBilder} Bilder, 640x360)`);
  const rtt = [...st.videoZonenRtt].sort((a, b) => a - b);
  console.log(`M1 chromium: Rundlauf je Zonen-Pruefung Median ${rtt[rtt.length >> 1]} ms, p90 ${rtt[Math.floor(rtt.length * 0.9)]} ms (${rtt.length} Werte), Pruefungen ${st.videoZonenPruefungen}`);
  expect(st.videoZonenMsBilder).toBeGreaterThan(50);
});


// ---------- Presets im Video (Auftrag 4) ----------
// Die Videozensur zeichnet je Zone die Behandlung des gewaehlten Presets (src/presets.ts) wie bei Bildern. Pixeltests je Preset-Gruppe auf der Fixture:
// Referenz (Pause an) und Zensur (Pause aus) im selben Abschnitt des Films (2 bis 5 s, das Bild steht still), verglichen in den Boxen der Spuren.
// Mias Gesicht: ein Patch-Bild mit Gesicht (ein Portraet der Testbilder, nie Mia) im Dummy-Pack; Woerter: die synthetischen Woerter des Dummy-Packs.

const KOERPER = '_DSC6278.JPG';
const GESICHT = 'sfw-001-portraet.jpg';
const PATCH_GESICHT = 'sfw-003-portraet.jpg';
const ROSA_RAHMEN = [255, 79, 163];
const ROSA_WORT = [255, 179, 211];
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE_ZONEN = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];

function zonenNur(an: string[]): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ALLE_ZONEN) z[n] = BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) };
  return z;
}

interface Pix {
  daten: Buffer;
  b: number;
  h: number;
}
async function pix(png: Buffer): Promise<Pix> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { daten: data, b: info.width, h: info.height };
}

// Kennzahlen einer Box [x, y, w, h]: Anteil dunkel und mittlere Abweichung zur Referenz im Inneren (um `inset` nach innen), kraeftiges Rosa im Ring von 6 Bildpunkten
// beiderseits des Randes (der Rahmen; die Boxen gehen je Antwort um bis zu 3 Bildpunkte auf und zu, je nach Lage der Leinwand ist er zu halben Pixeln
// verwaschen) und kraeftiges Rosa tiefer im Inneren (das Wort). Rosa: rot hoch, blau ueber gruen (Hauttoene haben blau unter gruen).
const istRosa = (r: number, g: number, b: number): boolean => r > 225 && b - g > 20 && g < 215;
function kenn(ref: Pix, aus: Pix, box: number[], inset = 0) {
  const [bx, by, bw, bh] = box as [number, number, number, number];
  let n = 0;
  let dunkel = 0;
  let summe = 0;
  let wort = 0;
  let rahmen = 0;
  const RING = 6;
  for (let y = Math.max(0, by - RING); y < Math.min(aus.h, by + bh + RING); y++) {
    for (let x = Math.max(0, bx - RING); x < Math.min(aus.b, bx + bw + RING); x++) {
      const i = (y * aus.b + x) * 3;
      const r = aus.daten[i]!;
      const g = aus.daten[i + 1]!;
      const b = aus.daten[i + 2]!;
      const innen = x >= bx && x < bx + bw && y >= by && y < by + bh;
      const abstand = Math.min(Math.abs(x - bx), Math.abs(x - (bx + bw - 1)), Math.abs(y - by), Math.abs(y - (by + bh - 1)));
      if (istRosa(r, g, b)) {
        if (!innen || abstand <= RING) rahmen++;
        else wort++;
      }
      if (innen && x >= bx + inset && x < bx + bw - inset && y >= by + inset && y < by + bh - inset) {
        n++;
        if (r < 60 && g < 60 && b < 60) dunkel++;
        summe += (Math.abs(r - ref.daten[i]!) + Math.abs(g - ref.daten[i + 1]!) + Math.abs(b - ref.daten[i + 2]!)) / 3;
      }
    }
  }
  return { n, dunkel: dunkel / Math.max(1, n), wort, rahmen, mittel: summe / Math.max(1, n) };
}

interface VideoBoxen {
  ansicht: string;
  arten: string[];
  // Kennung der Spur je gemalter Flaeche (Testhaken), gleiche Reihenfolge wie `arten`; -1 bei Personen-Huellen
  ids: number[];
  // Motiv je gemalter Flaeche (Schluessel fuer Wort und Mias Gesicht; gleich der Kennung oder von einer eben verlorenen Spur an derselben Stelle geerbt); -1 bei Personen-Huellen
  motive: number[];
  szene: number;
  // die wirklich gemalten Rechtecke (CSS-Pixel des Fensters), gleiche Reihenfolge wie `arten`
  flaechen: number[][];
  boxen: number[][];
  mt: number;
}
const lies = async (s: Page): Promise<VideoBoxen | null> => {
  const roh = await attr(s, 'v1', 'data-veil-video-boxen');
  return roh ? (JSON.parse(roh) as VideoBoxen) : null;
};

async function oeffneBild(satz: string, bild: string, abfrage = 'ohne=1&kurz=1', breite = 800, hoehe = 800): Promise<Page> {
  const seite = await context.newPage();
  await seite.setViewportSize({ width: breite, height: hoehe });
  await seite.goto(`${basis}/video-zonen.html?satz=${satz}&bild=${encodeURIComponent(bild)}${abfrage ? `&${abfrage}` : ''}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 90_000, intervals: [200] }).toBe('1');
  return seite;
}

// Wartet, bis die Zeit des Videos im Fenster [von, bis] liegt (das Bild steht in 2 bis 5 s still).
const warteFenster = (s: Page, von = 2.9, bis = 4.0) => wartePoll(async () => {
  const t = await ct(s);
  return t >= von && t <= bis;
}, 30_000);

interface Messung {
  s: Page;
  ref: Pix;
  aus: Pix;
  v: VideoBoxen;
}
// Ein stimmiger Augenblick der Zonen-Leinwand im stillen Abschnitt des Films (2 bis 5 s): Flaechen mit den gewuenschten Zeichenarten, Aufnahme der Seite.
// Die Boxen zittern um einen Bildpunkt (jede Antwort setzt sie neu): die Flaechen vor und nach der Aufnahme muessen auf 3 Bildpunkte genau gleich sein.
async function augenblick(s: Page, art?: (arten: string[]) => boolean, nach_s = 60_000): Promise<{ v: VideoBoxen; aus: Pix }> {
  let v: VideoBoxen | null = null;
  let png: Buffer | null = null;
  await wartePoll(async () => {
    // "zensiert": die Leinwand liegt wirklich vor dem Video (davor ist es noch Blur, auch wenn die Leinwand schon malt)
    if ((await attr(s, 'v1', 'data-veil-video-modus')) !== 'zonen' || (await attr(s, 'v1', 'data-veil')) !== 'zensiert') return false;
    const vor = await lies(s);
    if (!vor || vor.ansicht !== 'zonen' || vor.arten.length === 0 || (art && !art(vor.arten)) || vor.mt < 2.9 || vor.mt > 4.3) return false;
    const bild = await s.screenshot({ type: 'png' });
    const nach = await lies(s);
    if ((await attr(s, 'v1', 'data-veil')) !== 'zensiert') return false;
    const gleich = !!nach && nach.flaechen.length === vor.flaechen.length && nach.flaechen.every((f, i) => f.every((x, j) => Math.abs(x - vor.flaechen[i]![j]!) <= 3));
    if (!nach || nach.mt > 4.7 || !gleich || JSON.stringify(nach.arten) !== JSON.stringify(vor.arten)) return false;
    v = vor;
    png = bild;
    return true;
  }, nach_s);
  return { v: v!, aus: await pix(png!) };
}
// Referenz (Pause an), dann Zensur mit dem Preset: wartet, bis die Zonen-Leinwand im stillen Abschnitt Flaechen mit den gewuenschten Zeichenarten zeigt.
async function messePreset(o: { satz: string; bild: string; preset: string; an: string[]; extra?: Record<string, unknown>; art?: (arten: string[]) => boolean; abfrage?: string }): Promise<Messung> {
  await setze({ preset: o.preset, zonen: zonenNur(o.an), rand: 0.15, schwelle: 0.1, pause: true, ...o.extra });
  const s = await oeffneBild(o.satz, o.bild, o.abfrage);
  await neuesVideo(s, { id: 'v1' });
  await warteFenster(s);
  const ref = await pix(await s.screenshot({ type: 'png' }));
  await setze({ pause: false });
  const { v, aus } = await augenblick(s, o.art);
  if (process.env.VEIL_DEBUG_DIR) await sharp(aus.daten, { raw: { width: aus.b, height: aus.h, channels: 3 } }).png().toFile(path.join(process.env.VEIL_DEBUG_DIR, `${o.preset}.png`));
  console.log(`chromium: ${o.preset} (${o.bild}): Zeichenarten ${JSON.stringify(v.arten)}, Flaechen ${JSON.stringify(v.flaechen)}`);
  return { s, ref, aus, v };
}

// Synthetische Wort-Themen fuer die Tests (keine echten Woerter): Thema alpha schmal (ein einzelnes Zeichen), Thema beta breit. Die Breite des Wortes auf der
// Flaeche zeigt dann sicher, aus welchem Thema es kommt.
const PACK_WOERTER = {
  themen: [
    { id: 'alpha', titel: 'Alpha', woerter: ['I', '!', '1', 'L', 'J'] },
    { id: 'beta', titel: 'Beta', woerter: ['WWWWW', 'WWWWWW', 'WWWWWWW', 'WWWWWWWW', 'WWWWWWWWW'] },
  ],
};
const BAUMODUL = '../../scripts/pack/baue-pack.mjs';
async function packMitGesicht(): Promise<void> {
  const patchQuelle = await fetch(`${basis}/testbild/sfw/${encodeURIComponent(PATCH_GESICHT)}`);
  expect(patchQuelle.ok, `Testbild ${PATCH_GESICHT} fehlt`).toBe(true);
  const patch = await sharp(Buffer.from(await patchQuelle.arrayBuffer())).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
  const bau = (await import(BAUMODUL)) as { baueDummyPack(o?: Record<string, unknown>): Promise<{ bytes: Uint8Array }> };
  const { bytes } = await bau.baueDummyPack({ extraPatches: [{ name: 'patch/mit-gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patch) }], woerter: PACK_WOERTER });
  const pfad = path.join(ordner, 'dummy-mit-gesicht.miapack');
  await writeFile(pfad, bytes);
  const o = await context.newPage();
  await o.goto(`chrome-extension://${erweiterungsId}/options.html`);
  await o.locator('#datei').setInputFiles(pfad);
  await o.locator('#annehmen').click();
  await expect(o.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)', { timeout: 30_000 });
  await o.close();
  // Gesichtssuche (YuNet im Erkenner) fuer den neuen Stand, bevor die Seiten sie brauchen
  const scan = await worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), { ziel: 'erkenner', typ: 'gesichtsscan' });
  console.log(`chromium: Gesichtsscan Dummy-Pack mit einem Portraet-Patch: ${JSON.stringify(scan)}`);
  expect(scan.mit).toBe(1);
}
async function entfernePack(): Promise<void> {
  const o = await context.newPage();
  try {
    await o.goto(`chrome-extension://${erweiterungsId}/options.html`);
    // ohne Pack gibt es nichts zu entfernen (erst abwarten, bis die Seite den Stand zeigt)
    await expect(o.locator('#pack-status')).toContainText(/Pack in place|No pack yet/);
    if (await o.locator('#entfernen').isVisible()) {
      await o.locator('#entfernen').click();
      await o.locator('#entfernen-ja').click();
    }
    await expect(o.locator('#pack-status')).toContainText('No pack yet');
  } finally {
    await o.close();
  }
}

// Mittlere Abweichung zur Referenz ausserhalb aller Flaechen (8 px Abstand) in der linken Haelfte des Videobilds (320 mal 360 oben links, dort steht das Bild still;
// rechts wandern die Streifen).
function ausserhalb(ref: Pix, aus: Pix, flaechen: number[][]): number {
  let n = 0;
  let summe = 0;
  for (let y = 0; y < 360; y++) {
    for (let x = 0; x < 320; x++) {
      if (flaechen.some(([bx, by, bw, bh]) => x >= bx! - 8 && x < bx! + bw! + 8 && y >= by! - 8 && y < by! + bh! + 8)) continue;
      // der Knopf "Play" links unten liegt nicht im Film
      if (x < 100 && y > 315) continue;
      const i = (y * aus.b + x) * 3;
      summe += (Math.abs(aus.daten[i]! - ref.daten[i]!) + Math.abs(aus.daten[i + 1]! - ref.daten[i + 1]!) + Math.abs(aus.daten[i + 2]! - ref.daten[i + 2]!)) / 3;
      n++;
    }
  }
  return summe / Math.max(1, n);
}
// Mittlere Kantenstaerke (waagerechte Nachbardifferenz) im Inneren einer Flaeche: Mosaik hat nur die Blockkanten, ein Foto viele kleine.
function kante(aus: Pix, box: number[], inset: number): number {
  const [bx, by, bw, bh] = box as [number, number, number, number];
  let n = 0;
  let summe = 0;
  for (let y = by + inset; y < by + bh - inset; y++) {
    for (let x = bx + inset; x < bx + bw - inset - 1; x++) {
      const i = (y * aus.b + x) * 3;
      summe += (Math.abs(aus.daten[i]! - aus.daten[i + 3]!) + Math.abs(aus.daten[i + 1]! - aus.daten[i + 4]!) + Math.abs(aus.daten[i + 2]! - aus.daten[i + 5]!)) / 3;
      n++;
    }
  }
  return summe / Math.max(1, n);
}
// Die Flaeche der Art, deren Mitte der Mitte von `bezug` am naechsten liegt (dieselbe Flaeche in einem spaeteren Augenblick).
const naechste = (v: VideoBoxen, art: string, bezug: number[]): number[] | null => {
  let best: number[] | null = null;
  let dist = Infinity;
  v.flaechen.forEach((f, i) => {
    if (v.arten[i] !== art) return;
    const d = Math.hypot(f[0]! + f[2]! / 2 - (bezug[0]! + bezug[2]! / 2), f[1]! + f[3]! / 2 - (bezug[1]! + bezug[3]! / 2));
    if (d < dist) {
      dist = d;
      best = f;
    }
  });
  return best;
};
// Welcher Anteil der Flaeche `t` liegt in der Huelle, die ihr am meisten gibt.
const anteilInHuelle = (t: number[], huellen: number[][]): number =>
  Math.max(
    ...huellen.map((h) => {
      const b = Math.max(0, Math.min(t[0]! + t[2]!, h[0]! + h[2]!) - Math.max(t[0]!, h[0]!));
      const hh = Math.max(0, Math.min(t[1]! + t[3]!, h[1]! + h[3]!) - Math.max(t[1]!, h[1]!));
      return (b * hh) / Math.max(1, t[2]! * t[3]!);
    }),
  );
const groesste = (v: VideoBoxen, art: string): number[] | null => {
  let best: number[] | null = null;
  v.flaechen.forEach((f, i) => {
    if (v.arten[i] === art && (!best || f[2]! * f[3]! > best[2]! * best[3]!)) best = f;
  });
  return best;
};

test('P1 mosaik im Video: Mosaik mit pinkem Rahmen, ausserhalb unveraendert (Grundlage der Presets); blur ohne Rahmen', async () => {
  test.setTimeout(180_000);
  const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: BEDECKBAR });
  expect(m.v.arten.every((a) => a === 'mosaik')).toBe(true);
  const k = kenn(m.ref, m.aus, m.v.flaechen[0]!, 0);
  console.log(`chromium: P1 mosaik ${JSON.stringify(k)}`);
  expect(k.rahmen).toBeGreaterThan(Math.min(m.v.flaechen[0]![2]!, m.v.flaechen[0]![3]!) * 2);
  expect(k.mittel).toBeGreaterThan(8);
  expect(ausserhalb(m.ref, m.aus, m.v.flaechen)).toBeLessThan(6);
  await m.s.close();
  const b = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'blur', an: BEDECKBAR });
  expect(b.v.arten.every((a) => a === 'blur')).toBe(true);
  const kb = kenn(b.ref, b.aus, b.v.flaechen[0]!, 3);
  console.log(`chromium: P1 blur ${JSON.stringify(kb)}`);
  expect(kb.rahmen, 'Blur hat keinen pinken Rahmen').toBeLessThan(10);
  expect(kb.mittel).toBeGreaterThan(5);
  await b.s.close();
});

test('P2 mosaik-wort im Video: Wort "MIA" ohne Pack auf Mosaik mit Unterlage und Rahmen', async () => {
  test.setTimeout(180_000);
  const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik-wort', an: BEDECKBAR, art: (a) => a.includes('mosaik-wort'), extra: { woerterThemen: null } });
  const f = groesste(m.v, 'mosaik-wort')!;
  const k = kenn(m.ref, m.aus, f, 0);
  const mo = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: BEDECKBAR });
  const fm = groesste(mo.v, 'mosaik')!;
  const km = kenn(mo.ref, mo.aus, fm, 0);
  console.log(`chromium: P2 mosaik-wort ${JSON.stringify(k)} gegen mosaik ${JSON.stringify(km)}`);
  expect(k.rahmen).toBeGreaterThan(Math.min(f[2]!, f[3]!) * 2);
  expect(k.wort - km.wort, 'das Wort fehlt').toBeGreaterThan(80);
  await m.s.close();
  await mo.s.close();
});

// Wortpixel (kraeftiges Rosa im Inneren der Flaeche, ohne das Randband) als Menge; Vergleich mit Toleranz von 2 Bildpunkten (die Boxen zittern).
function wortMaske(aus: Pix, box: number[]): Set<number> {
  const [bx, by, bw, bh] = box as [number, number, number, number];
  const m = new Set<number>();
  for (let y = by + 8; y < by + bh - 8; y++) {
    for (let x = bx + 8; x < bx + bw - 8; x++) {
      const i = (y * aus.b + x) * 3;
      if (istRosa(aus.daten[i]!, aus.daten[i + 1]!, aus.daten[i + 2]!)) m.add(y * aus.b + x);
    }
  }
  return m;
}
// Wortpixel relativ zur Mitte der Flaeche (Schluessel mit Breite 1000): die Flaeche darf um einen Bildpunkt wandern, ohne dass das Wort "verschoben" aussieht.
function relMaske(aus: Pix, box: number[]): Set<number> {
  const [bx, by, bw, bh] = box as [number, number, number, number];
  const cx = Math.round(bx + bw / 2);
  const cy = Math.round(by + bh / 2);
  const m = new Set<number>();
  for (const k of wortMaske(aus, box)) m.add((Math.floor(k / aus.b) - cy + 500) * 1000 + ((k % aus.b) - cx + 500));
  return m;
}
function deckung(a: Set<number>, b: Set<number>, breite: number, tol = 2): number {
  let treffer = 0;
  for (const p of a) {
    let da = false;
    for (let dy = -tol; dy <= tol && !da; dy++) for (let dx = -tol; dx <= tol && !da; dx++) if (b.has(p + dy * breite + dx)) da = true;
    if (da) treffer++;
  }
  return treffer / Math.max(1, a.size);
}
// Waagerechte Ausdehnung der Wortpixel (Breite des Wortes) innerhalb einer Flaeche.
function wortBreite(aus: Pix, box: number[]): number {
  const [bx, by, bw, bh] = box as [number, number, number, number];
  let min = Infinity;
  let max = -Infinity;
  for (let y = by + 6; y < by + bh - 6; y++) {
    for (let x = bx + 6; x < bx + bw - 6; x++) {
      const i = (y * aus.b + x) * 3;
      if (istRosa(aus.daten[i]!, aus.daten[i + 1]!, aus.daten[i + 2]!)) {
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
    }
  }
  return max >= min ? max - min + 1 : 0;
}
let packJson: unknown = null;
const setzePack = () => worker.evaluate((p) => (globalThis as any).chrome.storage.local.set({ pack: p }), packJson);

test('P3 Mias Gesicht im Video: Gesicht aus dem Pack mit pinkem Rahmen an der Face-Flaeche, sonst unveraenderte Pixel', async () => {
  test.setTimeout(240_000);
  await packMitGesicht();
  packJson = await worker.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('pack')) as any).pack);
  expect(packJson).toBeTruthy();
  await setzePack();
  const m = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mia-mosaik', an: ['face'], art: (a) => a.includes('mia-gesicht') });
  const f = groesste(m.v, 'mia-gesicht')!;
  const k = kenn(m.ref, m.aus, f, 0);
  const kP = kante(m.aus, f, 8);
  console.log(`chromium: P3 mia-gesicht ${JSON.stringify(k)} Kantenstaerke ${kP.toFixed(2)}`);
  expect(k.rahmen, 'pinker Rahmen').toBeGreaterThan(Math.min(f[2]!, f[3]!) * 2);
  expect(k.mittel, 'das Gesicht wurde nicht getauscht').toBeGreaterThan(20);
  expect(ausserhalb(m.ref, m.aus, m.v.flaechen), 'ausserhalb der Flaechen veraendert').toBeLessThan(6);
  await m.s.close();
  // Gegenstueck Mosaik am selben Gesicht: ein Foto hat viele feine Kanten, ein Mosaik nur seine Blockkanten
  const mo = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mosaik', an: ['face'], art: (a) => a.includes('mosaik') });
  const fm = groesste(mo.v, 'mosaik')!;
  const kM = kante(mo.aus, fm, 8);
  console.log(`chromium: P3 Kantenstaerke Mosaik ${kM.toFixed(2)} gegen Mias Gesicht ${kP.toFixed(2)}`);
  expect(kM).toBeLessThan(kP * 0.75);
  await mo.s.close();
});

test('P4 schwarz-wort im Video (mia-wort, Face aus): Koerper schwarz mit Wort aus dem Pack, kein Rahmen, stabil je Spur; Themenwechsel und Packwechsel zeichnen neu', async () => {
  test.setTimeout(300_000);
  await setzePack();
  const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mia-wort', an: BEDECKBAR, art: (a) => a.includes('schwarz-wort'), extra: { woerterThemen: ['alpha'] } });
  const f = groesste(m.v, 'schwarz-wort')!;
  const k = kenn(m.ref, m.aus, f, 0);
  console.log(`chromium: P4 schwarz-wort ${JSON.stringify(k)}`);
  expect(k.dunkel, 'ueberwiegend schwarz').toBeGreaterThan(0.6);
  expect(k.wort, 'pinkes Wort').toBeGreaterThan(80);
  expect(k.rahmen, 'Schwarz mit Wort hat keinen Rahmen').toBeLessThan(10);
  expect(ausserhalb(m.ref, m.aus, m.v.flaechen)).toBeLessThan(6);
  // stabil je Spur: verglichen werden nur Aufnahmen, in denen dieselbe Spur (gleiche Kennung, Testhaken `ids`) gezeigt wird, die Wortmaske relativ zur Mitte der Flaeche.
  // Unter Last verliert die Leinwand eine Spur und legt sie neu an (neue Kennung, anderes Wort): dann zaehlt das Paar nicht, es wird (hoechstens 5 Versuche) neu aufgenommen.
  let vergleich: { w1: Set<number>; w2: Set<number>; b1: number; b2: number } | null = null;
  let alt = { v: m.v, aus: m.aus };
  for (let versuch = 0; versuch < 5 && !vergleich; versuch++) {
    const neu = await augenblick(m.s, (a) => a.includes('schwarz-wort'));
    const gemeinsam = neu.v.ids.findIndex((id, i) => neu.v.arten[i] === 'schwarz-wort' && id >= 0 && alt.v.ids.some((x, j) => x === id && alt.v.arten[j] === 'schwarz-wort'));
    if (gemeinsam >= 0) {
      const id = neu.v.ids[gemeinsam]!;
      const fa = alt.v.flaechen[alt.v.ids.findIndex((x, j) => x === id && alt.v.arten[j] === 'schwarz-wort')]!;
      const fn = neu.v.flaechen[gemeinsam]!;
      vergleich = { w1: relMaske(alt.aus, fa), w2: relMaske(neu.aus, fn), b1: wortBreite(alt.aus, fa), b2: wortBreite(neu.aus, fn) };
    }
    alt = neu;
  }
  expect(vergleich, 'in 5 Aufnahmepaaren nie dieselbe Spur zweimal gezeigt').not.toBeNull();
  const { w1, w2 } = vergleich!;
  console.log(`chromium: P4 Wort stabil je Spur: ${w1.size} und ${w2.size} Pixel, Deckung ${(deckung(w1, w2, 1000, 1) * 100).toFixed(0)} %, Breite ${vergleich!.b1} und ${vergleich!.b2} px`);
  expect(deckung(w1, w2, 1000, 1)).toBeGreaterThan(0.85);
  expect(Math.abs(vergleich!.b1 - vergleich!.b2)).toBeLessThanOrEqual(3);
  // Themenwechsel (alpha schmal zu beta breit): die Leinwand zeichnet neu (das Urteil des Videos wird neu gefasst), ein anderes Wort steht da. Erst abwarten, bis die Seite
  // den Wechsel aufgenommen hat, sonst saehe die Aufnahme noch das alte Bild. Die Spuren beginnen neu: verglichen wird, wie breit die Woerter aller Flaechen sind.
  const breitenAlt = m.v.flaechen.filter((_, i) => m.v.arten[i] === 'schwarz-wort').map((fl) => wortBreite(m.aus, fl));
  const vorher = (await eintraege(m.s)).length;
  await setze({ woerterThemen: ['beta'] });
  await wartePoll(async () => (await eintraege(m.s)).slice(vorher).some((e) => e.was === 'data-veil'), 20_000);
  const beta = await augenblick(m.s, (a) => a.includes('schwarz-wort'));
  const breitenNeu = beta.v.flaechen.filter((_, i) => beta.v.arten[i] === 'schwarz-wort').map((fl) => wortBreite(beta.aus, fl));
  console.log(`chromium: P4 Themenwechsel: Breiten der Woerter alpha ${JSON.stringify(breitenAlt)} px gegen beta ${JSON.stringify(breitenNeu)} px`);
  expect(Math.min(...breitenNeu), 'noch ein Wort des alten Themas').toBeGreaterThan(Math.max(...breitenAlt) * 1.2);
  // Pack weg: Mia-Presets gelten ohne Pack nicht, die Videozensur zeichnet Mosaik
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
  const ohne = await augenblick(m.s, (a) => a.every((x) => x === 'mosaik'));
  console.log(`chromium: P4 ohne Pack: ${JSON.stringify(ohne.v.arten)}`);
  await m.s.close();
});

test('P5 Preset-Wechsel im laufenden Video: die Leinwand zeichnet neu, ohne Mischzustand alter und neuer Behandlung (mosaik, blur, schwarz)', async () => {
  test.setTimeout(240_000);
  const m = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: BEDECKBAR, art: (a) => a.includes('mosaik') });
  expect(m.v.arten.every((a) => a === 'mosaik')).toBe(true);
  // Nach dem Wechsel zeigt die Leinwand nie zugleich alte und neue Zeichenarten: der Schleier fasst das Urteil neu (neuer Pruefstand), die Leinwand beginnt von vorn.
  // Ohne das liefen alte Spuren noch bis zu einer Sekunde neben neuen weiter.
  const wechsle = async (preset: string, art: string[]) => {
    await setze({ preset });
    const gesehen: string[][] = [];
    await wartePoll(async () => {
      const v = await lies(m.s);
      if (v && v.arten.length) gesehen.push(v.arten);
      return !!v && v.ansicht === 'zonen' && v.arten.length > 0 && v.arten.every((x) => art.includes(x)) && (await attr(m.s, 'v1', 'data-veil')) === 'zensiert';
    }, 60_000);
    const gemischt = gesehen.filter((a) => a.some((x) => !art.includes(x)) && a.some((x) => art.includes(x)));
    expect(gemischt, `alte und neue Zeichenarten zugleich: ${JSON.stringify(gemischt)}`).toEqual([]);
  };
  await wechsle('blur', ['blur']);
  const b = await augenblick(m.s, (a) => a.length > 0 && a.every((x) => x === 'blur'));
  expect(kenn(m.ref, b.aus, b.v.flaechen[0]!, 3).rahmen, 'Blur ohne Rahmen').toBeLessThan(10);
  await wechsle('zensurbalken', ['schwarz', 'balken']);
  const z = await augenblick(m.s, (a) => a.length > 0 && a.every((x) => x === 'schwarz' || x === 'balken'));
  const fz = groesste(z.v, 'schwarz')!;
  expect(kenn(m.ref, z.aus, fz, 3).dunkel, 'Schwarz deckt').toBeGreaterThan(0.95);
  await m.s.close();
});

test('P6 augenbalken im Video (Eye bar): nur schwarze Balken auf den Augen, sonst nichts veraendert; zensurbalken: Augen Balken, Gesicht schwarz', async () => {
  test.setTimeout(240_000);
  const a = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'augenbalken', an: [], art: (x) => x.includes('balken') });
  expect(a.v.arten.every((x) => x === 'balken')).toBe(true);
  for (const f of a.v.flaechen) {
    const k = kenn(a.ref, a.aus, f, Math.round(Math.min(f[2]!, f[3]!) * 0.25));
    console.log(`chromium: P6 augenbalken ${JSON.stringify(f)} dunkel ${k.dunkel.toFixed(2)} rahmen ${k.rahmen}`);
    expect(k.dunkel, 'Balken nicht schwarz').toBeGreaterThan(0.95);
    expect(kenn(a.ref, a.aus, f, 0).rahmen, 'Balken ohne Rahmen').toBeLessThan(10);
    // ein Augenbalken ist breiter als hoch und liegt in der oberen Haelfte des Bildes
    expect(f[2]!).toBeGreaterThan(f[3]!);
  }
  expect(ausserhalb(a.ref, a.aus, a.v.flaechen), 'ausserhalb der Balken veraendert').toBeLessThan(6);
  await a.s.close();
  const z = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'zensurbalken', an: ['face'], art: (x) => x.includes('balken') && x.includes('schwarz') });
  const balken = groesste(z.v, 'balken')!;
  const gesicht = groesste(z.v, 'schwarz')!;
  console.log(`chromium: P6 zensurbalken Balken ${JSON.stringify(balken)} Gesicht ${JSON.stringify(gesicht)}`);
  expect(kenn(z.ref, z.aus, balken, Math.round(Math.min(balken[2]!, balken[3]!) * 0.25)).dunkel).toBeGreaterThan(0.95);
  expect(kenn(z.ref, z.aus, gesicht, Math.round(Math.min(gesicht[2]!, gesicht[3]!) * 0.25)).dunkel).toBeGreaterThan(0.95);
  await z.s.close();
});

test('P7 person-mosaik und person-blur im Video: die Huelle deckt die Zonen-Flaechen, eine Flaeche je Person, sonst nichts veraendert', async () => {
  test.setTimeout(240_000);
  const einzeln = await messePreset({ satz: 'nsfw', bild: KOERPER, preset: 'mosaik', an: ['feet'], art: (x) => x.includes('mosaik') });
  const teile = einzeln.v.flaechen;
  await einzeln.s.close();
  for (const [preset, art] of [['person-mosaik', 'mosaik'], ['person-blur', 'blur']] as const) {
    const p = await messePreset({ satz: 'nsfw', bild: KOERPER, preset, an: ['feet'], art: (x) => x.length > 0 && x.every((y) => y === art) });
    const huellen = p.v.flaechen;
    const flaecheH = huellen.reduce((s, f) => s + f[2]! * f[3]!, 0);
    const flaecheT = teile.reduce((s, f) => s + f[2]! * f[3]!, 0);
    console.log(`chromium: P7 ${preset}: ${huellen.length} Huellen (${flaecheH} px) gegen ${teile.length} Zonen-Flaechen (${flaecheT} px)`);
    expect(flaecheH, 'die Huelle ist nicht groesser als die Zone allein').toBeGreaterThan(flaecheT);
    // Die Zonen-Flaechen stammen aus einem eigenen Lauf (andere Aufnahme des Films, die Erkennung schwankt von Lauf zu Lauf um einzelne Flaechen): die groesste
    // Zone liegt ganz in einer Huelle, die Huelle ist die Vereinigung, nicht eine Zone allein.
    const grosse = [...teile].sort((a, b) => b[2]! * b[3]! - a[2]! * a[3]!)[0]!;
    expect(anteilInHuelle(grosse, huellen), `die groesste Zone ${grosse} liegt nicht in einer Huelle ${JSON.stringify(huellen)}`).toBeGreaterThan(0.95);
    const k = kenn(p.ref, p.aus, huellen[0]!, 3);
    expect(k.mittel, 'Huelle nicht veraendert').toBeGreaterThan(5);
    if (art === 'blur') expect(k.rahmen).toBeLessThan(10);
    else expect(kenn(p.ref, p.aus, huellen[0]!, 0).rahmen).toBeGreaterThan(Math.min(huellen[0]![2]!, huellen[0]![3]!) * 2);
    expect(ausserhalb(p.ref, p.aus, huellen)).toBeLessThan(6);
    await p.s.close();
  }
});

test('P8 Mias Gesicht ohne Gesicht im Pack: die Koerper-Behandlung deckt das Gesicht, nie offen, nie Mias Gesicht', async () => {
  test.setTimeout(240_000);
  await entfernePack();
  const bau = (await import(BAUMODUL)) as { baueDummyPack(o?: Record<string, unknown>): Promise<{ bytes: Uint8Array }> };
  const pfad = path.join(ordner, 'dummy-ohne-gesicht.miapack');
  await writeFile(pfad, (await bau.baueDummyPack()).bytes);
  const o = await context.newPage();
  await o.goto(`chrome-extension://${erweiterungsId}/options.html`);
  await o.locator('#datei').setInputFiles(pfad);
  await o.locator('#annehmen').click();
  await expect(o.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)', { timeout: 30_000 });
  await o.close();
  const scan = await worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), { ziel: 'erkenner', typ: 'gesichtsscan' });
  expect(scan.mit).toBe(0);
  packJson = await worker.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('pack')) as any).pack);
  await setzePack();
  const m = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mia-mosaik', an: ['face'], art: (a) => a.length > 0 });
  expect(m.v.arten, 'Mias Gesicht ohne Bild mit Gesicht').not.toContain('mia-gesicht');
  expect(m.v.arten.every((a) => a === 'mosaik')).toBe(true);
  const f = groesste(m.v, 'mosaik')!;
  expect(kenn(m.ref, m.aus, f, 0).rahmen).toBeGreaterThan(Math.min(f[2]!, f[3]!) * 2);
  await m.s.close();
  const w = await messePreset({ satz: 'sfw', bild: GESICHT, preset: 'mia-wort', an: ['face'], art: (a) => a.includes('schwarz-wort') });
  expect(w.v.arten).not.toContain('mia-gesicht');
  expect(w.v.arten.every((a) => a === 'schwarz-wort')).toBe(true);
  const fw = groesste(w.v, 'schwarz-wort')!;
  expect(kenn(w.ref, w.aus, fw, 8).dunkel).toBeGreaterThan(0.6);
  expect(kenn(w.ref, w.aus, fw, 0).wort, 'das Wort der Koerper-Behandlung steht auch auf dem Gesicht').toBeGreaterThan(80);
  await w.s.close();
  await entfernePack();
});

test('P9 Rueckfall "ganzes Bild kurz Mosaik": bleibt Mosaik ohne Rahmen, auch mit dem Preset Zensurbalken (nie schwarz, nie Rahmen)', async () => {
  test.setTimeout(240_000);
  await setze({ preset: 'zensurbalken', zonen: zonenNur(['face']), rand: 0.15, schwelle: 0.1 });
  const s = await oeffneBild('sfw', GESICHT, 'ohne=1&kurz=1');
  await neuesVideo(s, { id: 'v1' });
  let gesehen: { dunkel: number; rosa: number; arten: string[] } | null = null;
  await wartePoll(async () => {
    const v = await lies(s);
    if (!v || v.ansicht !== 'ganz') return false;
    const png = await pix(await s.screenshot({ type: 'png' }));
    const nach = await lies(s);
    if (!nach || nach.ansicht !== 'ganz') return false;
    let dunkel = 0;
    let rosa = 0;
    let n = 0;
    for (let y = 0; y < 360; y++) {
      for (let x = 0; x < 640; x++) {
        if (x < 100 && y > 315) continue;
        const i = (y * png.b + x) * 3;
        n++;
        // reines Schwarz (der Balken): der dunkle Grund des Films (29, 29, 38) zaehlt nicht
        if (png.daten[i]! < 12 && png.daten[i + 1]! < 12 && png.daten[i + 2]! < 12) dunkel++;
        if (png.daten[i]! > 240 && Math.abs(png.daten[i + 1]! - 79) < 14 && Math.abs(png.daten[i + 2]! - 163) < 14) rosa++;
      }
    }
    gesehen = { dunkel: dunkel / n, rosa, arten: nach.arten };
    return true;
  }, 60_000);
  console.log(`chromium: P9 ganzes Bild: ${JSON.stringify(gesehen)}`);
  expect(gesehen!.dunkel, 'das ganze Bild ist schwarz, es soll Mosaik sein').toBeLessThan(0.15);
  expect(gesehen!.rosa, 'Rahmen im ganzen Bild').toBeLessThan(20);
  await s.close();
});

test('P10 Spur verloren und neu angelegt (neue Szene durch einen kleinen Sprung im stillen Bild): neue Kennung, dasselbe Motiv, also dasselbe Wort und Gesicht', async () => {
  test.setTimeout(180_000);
  await setze({ preset: 'mosaik', zonen: zonenNur(['face']), rand: 0.15, schwelle: 0.1 });
  const s = await oeffneBild('sfw', GESICHT, 'ohne=1&kurz=1');
  await neuesVideo(s, { id: 'v1' });
  // Sobald die Leinwand im stillen Abschnitt Zonen zeigt: in der Seite anhalten (im selben Augenblick, in dem die Zeit im Fenster liegt).
  await wartePoll(async () => {
    if ((await attr(s, 'v1', 'data-veil')) !== 'zensiert') return false;
    const v = await lies(s);
    if (!v || v.ansicht !== 'zonen' || v.arten.length === 0) return false;
    return s.evaluate(() => {
      const el = document.getElementById('v1') as HTMLVideoElement;
      if (el.currentTime < 2.5 || el.currentTime > 5.0) return false;
      el.pause();
      return true;
    });
  }, 60_000);
  // Ein ruhiger Stand: Zonen mit denselben Kennungen in zwei Lesungen nacheinander.
  let vor: VideoBoxen | null = null;
  await wartePoll(async () => {
    const a = await lies(s);
    await abwarten(300);
    const b = await lies(s);
    if (!a || !b || b.ansicht !== 'zonen' || b.arten.length === 0 || JSON.stringify(a.ids) !== JSON.stringify(b.ids)) return false;
    vor = b;
    return true;
  }, 30_000);
  const v0 = vor!;
  expect(v0.motive, 'Testhaken ohne motive').toBeTruthy();
  expect(v0.motive.length).toBe(v0.ids.length);
  // Kleiner Sprung im stillen Bild: neue Szene, alle Spuren fallen weg, die naechste Antwort legt neue Spuren an derselben Stelle an.
  await s.evaluate(() => {
    const el = document.getElementById('v1') as HTMLVideoElement;
    el.currentTime = Math.min(5.4, el.currentTime + 0.3);
  });
  let nach: VideoBoxen | null = null;
  await wartePoll(async () => {
    const v = await lies(s);
    if (!v || v.szene <= v0.szene || v.ansicht !== 'zonen' || v.arten.length === 0 || v.ids.some((id) => v0.ids.includes(id))) return false;
    nach = v;
    return true;
  }, 60_000);
  const v1 = nach!;
  // Paare: jede neue Flaeche mit der alten Flaeche derselben Art, deren Mitte am naechsten liegt (das Bild steht still: hoechstens ein paar Bildpunkte).
  const paare: Array<{ alt: number; neu: number; abstand: number; motivAlt: number; motivNeu: number; idAlt: number; idNeu: number }> = [];
  v1.flaechen.forEach((f, i) => {
    let best = -1;
    let dist = Infinity;
    v0.flaechen.forEach((g, j) => {
      if (v0.arten[j] !== v1.arten[i]) return;
      const d = Math.hypot(f[0]! + f[2]! / 2 - (g[0]! + g[2]! / 2), f[1]! + f[3]! / 2 - (g[1]! + g[3]! / 2));
      if (d < dist) {
        dist = d;
        best = j;
      }
    });
    if (best >= 0 && dist <= 20) paare.push({ alt: best, neu: i, abstand: Math.round(dist), motivAlt: v0.motive[best]!, motivNeu: v1.motive[i]!, idAlt: v0.ids[best]!, idNeu: v1.ids[i]! });
  });
  console.log(`chromium: P10 Szene ${v0.szene} zu ${v1.szene}, Paare ${JSON.stringify(paare)}`);
  expect(paare.length, `keine Flaeche an derselben Stelle (${JSON.stringify(v0.flaechen)} gegen ${JSON.stringify(v1.flaechen)})`).toBeGreaterThan(0);
  for (const p of paare) {
    expect(p.idNeu, 'die Spur ist neu angelegt').not.toBe(p.idAlt);
    expect(p.motivNeu, 'Motiv (Wort, Gesicht) gewechselt').toBe(p.motivAlt);
  }
  expect(await sichtVerstoesse(s)).toEqual([]);
  await s.close();
});
