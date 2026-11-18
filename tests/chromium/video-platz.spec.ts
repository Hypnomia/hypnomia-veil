import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mitReitern } from './einstellungen-ordnung';

// Phase 11 Etappe 3, rote Tests (E3r): Platz fuer die Zonen-Leinwand zwischen mehreren Videos (E3a), "ganz" und vereinigte Flaeche, Huellen (E3b),
// Pause nach Regel S2 (E3c). Grundlage: 00 Planung/KARTE-VIDEO-E3.md und PHASE-11-AUFTRAEGE-SESSION-21.md (Abschnitt E3r). Fixture video-platz.html
// (Aufnahme wie video-zonen.html: 15 s, Person ab 2 s bis 12 s, davor und danach neutral, Waechter-Schachbrett im Bild des Testbilds). Echter Erkenner,
// echtes Testbild, kein Test-Erkenner.
//
// Kennzeichnung: was am Stand 9408eaa rot ist, steht als erwarteter Fehlschlag (`test.fail`, Kommentar E3a, E3b oder E3c), damit der Hook gruen bleibt; der Bauer
// der jeweiligen Etappe nimmt die Kennzeichnung heraus. Was gruen ist, ist ein normaler Test (Waechter). Alle Erwartungen eines roten Falls sind `expect.soft`:
// mit VEIL_E3_OHNE_KENNZEICHNUNG=1 laufen die Faelle ohne `test.fail` und melden jede verletzte Erwartung einzeln (so wurde geprueft, dass sie aus dem
// richtigen Grund rot sind). Eigene normale Tests ("Voraussetzung") pruefen vorab, was ein roter Fall voraussetzt, damit er nicht an einer fehlenden Voraussetzung
// scheitert. Sicherheit zuerst: kein Fall wertet ein unverdecktes Video als Erfolg, ausser S2a (Standbild sauber, drei saubere Pruefungen).
// Ohne Testbilder: ROT, nur mit VEIL_OHNE_TESTBILDER=1 laut uebersprungen.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const OHNE_KENNZEICHNUNG = process.env.VEIL_E3_OHNE_KENNZEICHNUNG === '1';

// Erwarteter Fehlschlag bis zur Etappe `etappe` (E3a, E3b, E3c). Mit VEIL_E3_OHNE_KENNZEICHNUNG=1 passiert nichts: der Fall laeuft dann als normaler Test.
function erwartetRot(etappe: string, grund: string): void {
  if (!OHNE_KENNZEICHNUNG) test.fail(true, `${etappe}: ${grund}`);
}

interface PlatzEintrag {
  t: number;
  id: string;
  was: string;
  v: string | null;
  ct: number;
  pausiert: boolean;
}
interface Verstoss {
  t: number;
  bis: number | null;
  id: string;
  art: 'zensiert-ohne-leinwand' | 'frei' | 'leinwand-sichtbar' | 'ohne-urteil-sichtbar' | 'kopie-sichtbar';
  quelle: string;
  ct: number;
  veil: string | null;
  leinwand: boolean;
  opacity: string;
}
interface Zustand {
  id: string;
  veil: string | null;
  leinwand: boolean;
  modus: string | null;
  etikett: string | null;
  opacity: string;
  ct: number;
  pausiert: boolean;
  readyState: number;
}
interface Bild {
  ts: number;
  // Uebergaenge zwischen reinem Magenta und reinem Gruen von einem Bildpunkt zum naechsten, waagerecht und senkrecht (scharfes Schachbrett: je rund 450)
  quer: number;
  hoch: number;
}
interface Status {
  videoPruefungen: number;
  videoZeiten: Array<{ t: number; art: string }>;
  videoZonenRueckfall: string[];
}

let profil: string;
let context: BrowserContext;
let worker: Worker;
let bilderDa = false;

// Im Rohlauf (VEIL_E3_OHNE_KENNZEICHNUNG=1) laufen die Faelle einzeln weiter, auch wenn einer rot ist; sonst seriell.
if (!OHNE_KENNZEICHNUNG) test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const antwort = await fetch(`${basis}/api/testbilder?satz=nsfw`);
  const liste = ((await antwort.json()) as { bilder: string[] }).bilder;
  bilderDa = liste.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  profil = await mkdtemp(path.join(tmpdir(), 'veil-video-platz-'));
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
  test.skip(!bilderDa, 'VEIL_OHNE_TESTBILDER=1');
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.remove(['einstellungen', 'pack', 'videoLangsamUm']);
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
const wartePoll = async (bed: () => Promise<boolean>, ms = 15_000) => expect.poll(bed, { timeout: ms, intervals: [100] }).toBe(true);
const status = (s: Page): Promise<Status | null> =>
  s.evaluate(() => {
    const roh = document.documentElement.dataset.veilStatus;
    return roh ? (JSON.parse(roh) as Status) : null;
  });
const ct = (s: Page, id = 'v1') => s.evaluate((i) => (document.getElementById(i) as HTMLVideoElement).currentTime, id);
const attr = (s: Page, id: string, name: string) => s.evaluate(([i, n]) => document.getElementById(i!)?.getAttribute(n!) ?? null, [id, name]);
const hatLeinwand = (s: Page, id: string) => s.evaluate((i) => document.getElementById(i)?.hasAttribute('data-veil-leinwand') ?? false, id);
const plog = (s: Page) => s.evaluate(() => (window as any).__platz as PlatzEintrag[]);
const verstoesse = (s: Page) => s.evaluate(() => (window as any).__verstoss as Verstoss[]);
const zustaende = (s: Page) => s.evaluate(() => (window as any).__zustand() as Zustand[]);
const jetzt = (s: Page) => s.evaluate(() => (window as any).epoche() as number);
const testEreignis = (s: Page, detail: Record<string, unknown>) =>
  s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), detail);
const neuesVideo = (s: Page, opt: Record<string, unknown>) => s.evaluate((o) => void (window as any).neuesVideo(o), opt);

async function oeffnePlatz(abfrage = '', breite = 800, hoehe = 800, bild = BILD): Promise<Page> {
  const seite = mitReitern(await context.newPage());
  await seite.setViewportSize({ width: breite, height: hoehe });
  await seite.goto(`${basis}/video-platz.html?bild=${encodeURIComponent(bild)}${abfrage ? `&${abfrage}` : ''}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 60_000, intervals: [200] }).toBe('1');
  return seite;
}

// ---------- Aufnahme: jedes Bild, das der Browser zeigt (wie in video-zonen.spec.ts) ----------

class KeineBilder extends Error {
  constructor() {
    super('Die Aufnahme enthielt kein einziges Bild');
  }
}
// Wie `test`, fuer Faelle mit Aufnahme: liefert die Aufnahme 0 Bilder, beginnt der Fall einmal von vorn; der zweite Versuch ohne Bilder ist rot.
let zweiterVersuch = false;
// Zeitgrenze des Falls; im zweiten Versuch kommt die Zeit zur schon verbrauchten dazu.
function zeit(ms: number): void {
  test.setTimeout(zweiterVersuch ? test.info().timeout + ms : ms);
}
function testA(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    zweiterVersuch = false;
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof KeineBilder)) throw e;
      console.log(`chromium: ${name.slice(0, 40)}: Aufnahme ohne Bilder, der Fall beginnt einmal von vorn`);
      zweiterVersuch = true;
      try {
        await fn();
      } finally {
        zweiterVersuch = false;
      }
    }
  });
}

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
      // Eine Aufnahme ohne ein einziges Bild beweist nichts ("nie scharf" waere leer erfuellt): der Fall beginnt einmal von vorn (testA), ein zweites Mal ohne Bilder ist rot.
      if (roh.length === 0) throw new KeineBilder();
      const aus: Bild[] = [];
      for (const b of roh) aus.push({ ts: b.ts, ...(await messeBild(Buffer.from(b.daten, 'base64'))) });
      return aus;
    },
  };
}

// Magenta und Gruen des Waechters, auch nach der Videokomprimierung (Aufbau wie in video-zonen.spec.ts): gezaehlt werden Uebergaenge zwischen den beiden Farben,
// bei denen der Lauf davor 2 bis 7 Bildpunkte lang war (Felder zu 4). Ein scharfes Schachbrett hat je Richtung rund 220, ein Mosaik und ein Blur keine.
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
async function messeBild(png: Buffer): Promise<Omit<Bild, 'ts'>> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const n = info.channels;
  const art = new Uint8Array(w * info.height);
  for (let i = 0, p = 0; i < data.length; i += n, p++) art[p] = klasse(data[i]!, data[i + 1]!, data[i + 2]!);
  return { quer: zaehleUebergaenge(art, w, info.height, true), hoch: zaehleUebergaenge(art, w, info.height, false) };
}
const scharf = (b: Bild) => b.quer >= 100 && b.hoch >= 100;
// Toleranz am Beginn der Zensur: das Bild, das gerade im Compositor liegt, wenn das Attribut gesetzt wird, ist noch das alte (ein Bild Granularitaet).
const BEGINN_TOLERANZ_MS = 100;

// Beginn der ersten Bedeckung irgendeines Videos der Seite (Blur oder Leinwand, Epoche in ms).
function zensurBeginn(l: PlatzEintrag[]): number | null {
  const x = l.find((e) => (e.was === 'data-veil-video-modus' && e.v !== null) || (e.was === 'data-veil' && (e.v === 'verdeckt' || e.v === 'zensiert')));
  return x ? x.t : null;
}

// Gegenprobe der Messung selbst: ohne Erweiterung (Pause) muss das Schachbrett als scharf erkannt werden, sonst waeren alle "nie scharf"-Aussagen leer erfuellt.
// Einmal je Datei (Zustand: seit der Gegenprobe gilt die Messung als belegt).
let messungBelegt = false;
testA('Gegenprobe der Messung: ohne Erweiterung (Pause) ist das Schachbrett scharf zu erkennen', async () => {
  zeit(90_000);
  await setze({ pause: true });
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1' });
  await wartePoll(async () => (await ct(s)) > 4.0, 30_000);
  const bilder = await rec.stoppe();
  await s.close();
  expect(bilder.filter(scharf).length, 'Referenz: das Schachbrett wird nie als scharf erkannt, die Messung ist wertlos').toBeGreaterThan(10);
  messungBelegt = true;
});

// Wartet, bis irgendein Video eine Leinwand hat; liefert dessen Kennung.
async function warteIrgendeine(s: Page, ms = 30_000): Promise<string> {
  let id = '';
  await wartePoll(async () => {
    const z = (await zustaende(s)).find((x) => x.leinwand);
    id = z?.id ?? '';
    return !!z;
  }, ms);
  return id;
}
const leinwandErster = (l: PlatzEintrag[], id: string, nach: number) => l.find((e) => e.id === id && e.was === 'data-veil-leinwand' && e.v !== null && e.t >= nach) ?? null;
const unerlaubt = (v: Verstoss[], ids: string[], arten: Verstoss['art'][]) => v.filter((x) => ids.includes(x.id) && arten.includes(x.art));
const zeigeVerstoesse = (v: Verstoss[]) => JSON.stringify(v.map((x) => ({ id: x.id, art: x.art, t: Math.round(x.t % 100000), dauer: x.bis === null ? null : Math.round(x.bis - x.t), ct: Math.round(x.ct * 10) / 10 })));

// Keine Aufnahme ab dem Beginn der ersten Zensur darf ein scharfes Schachbrett zeigen.
function keineScharfen(bilder: Bild[], tz: number | null, text: string): void {
  expect.soft(tz, `${text}: Zensur hat nie begonnen`).not.toBeNull();
  if (tz === null) return;
  const fenster = bilder.filter((b) => b.ts >= tz + BEGINN_TOLERANZ_MS);
  expect.soft(fenster.length, `${text}: zu wenige Bilder in der Aufnahme`).toBeGreaterThan(30);
  const schlecht = fenster.filter(scharf);
  expect.soft(schlecht.length, `${text}: scharfe Bilder ab Beginn der Zensur: ${schlecht.map((b) => Math.round(b.ts - tz)).join(', ')}`).toBe(0);
}

// ====================================================================================================================================================
// E3a: Platzregel (Platzwechsel, Etikett). Ausgangslage heute: wer zuerst Flaechen meldet, behaelt den Platz bis zur Freigabe, zum Quellenwechsel oder zum Rueckfall.
// ====================================================================================================================================================

// Voraussetzung fuer V1, V3, V4, V7a: ein nie gespieltes Video (preload auto, Sprung auf das Bild mit der Person) bekommt von sich aus die Leinwand und
// behaelt sie, ohne dass jemand spielt.
test('V1 Voraussetzung: ein nie gespieltes Vorschau-Video mit Person im ersten Bild nimmt die Leinwand und behaelt sie', async () => {
  zeit(90_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 3.0 });
  await wartePoll(() => hatLeinwand(s, 'v1'), 30_000);
  await abwarten(1500);
  const z = (await zustaende(s))[0]!;
  expect(z.pausiert, 'das Vorschau-Video wurde gespielt').toBe(true);
  expect(z.ct, 'das Vorschau-Video steht nicht auf dem Bild mit der Person').toBeGreaterThan(2.5);
  expect(z.veil).toBe('zensiert');
  expect(z.leinwand).toBe(true);
  await s.close();
});

testA('V1 und V3 Platzwechsel beim Spielen: Video 2 bekommt die Leinwand in 3 s, Video 1 ist verdeckt; dabei nie ein Video unbedeckt, nie zensiert ohne Leinwand, nie ein scharfes Schachbrett', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 3.0 });
  await wartePoll(() => hatLeinwand(s, 'v1'), 30_000); // Voraussetzung, siehe V1 Voraussetzung
  await abwarten(1000);
  const tPlay = await s.evaluate(() => {
    (window as any).neuesVideo({ id: 'v2', ct0: 2.5 }); // spielt sofort, ab dem Bild mit der Person (2 bis 12 s sind Person)
    return (window as any).epoche() as number;
  });
  await expect.soft.poll(() => hatLeinwand(s, 'v2'), { timeout: 10_000, intervals: [100], message: 'V1: Video 2 hat nach 10 s keine Leinwand (Video 1 hat sie noch: Grund andere)' }).toBe(true);
  await abwarten(1500);
  const l = await plog(s);
  const z2 = leinwandErster(l, 'v2', tPlay);
  expect.soft(z2, 'V1: Video 2 hat nie eine Leinwand bekommen').not.toBeNull();
  if (z2) expect.soft(z2.t - tPlay, 'V1: Video 2 bekam die Leinwand zu spaet (O5: hoechstens 3 s nach Play)').toBeLessThanOrEqual(3000);
  const zs = await zustaende(s);
  const z1 = zs.find((x) => x.id === 'v1')!;
  const z2s = zs.find((x) => x.id === 'v2')!;
  expect.soft(z2s.veil, 'V1: Video 2 ist nicht zensiert').toBe('zensiert');
  expect.soft(z2s.leinwand, 'V1: Video 2 hat keine Leinwand').toBe(true);
  expect.soft(z1.veil, 'V1: Video 1 ist nicht verdeckt').toBe('verdeckt');
  expect.soft(z1.leinwand, 'V1: Video 1 hat noch die Leinwand').toBe(false);
  // V3 (I2, I3): Video 1 ist verdeckt, bevor seine Leinwand geht (Reihenfolge der Attributwechsel), Video 2 zeigt nie zensiert ohne eigene Leinwand.
  const nach1 = l.filter((e) => e.id === 'v1' && e.t >= tPlay);
  const weg1 = nach1.findIndex((e) => e.was === 'data-veil-leinwand' && e.v === null);
  expect.soft(weg1, 'V3: Video 1 hat seine Leinwand nie abgegeben').toBeGreaterThanOrEqual(0);
  if (weg1 >= 0) {
    const verdeckt1 = nach1.findIndex((e) => e.was === 'data-veil' && e.v === 'verdeckt');
    expect.soft(verdeckt1 >= 0 && verdeckt1 < weg1, `V3/I2: Video 1 war nicht vor dem Abgeben der Leinwand verdeckt (verdeckt bei ${verdeckt1}, Leinwand weg bei ${weg1})`).toBe(true);
  }
  const v = await verstoesse(s);
  expect.soft(unerlaubt(v, ['v1', 'v2'], ['zensiert-ohne-leinwand', 'frei', 'leinwand-sichtbar', 'ohne-urteil-sichtbar']), `V3/I1: ein Video war unbedeckt oder zensiert ohne Leinwand: ${zeigeVerstoesse(v)}`).toEqual([]);
  keineScharfen(await rec.stoppe(), zensurBeginn(l), 'V3');
  await s.close();
});

test('V2 Halter pausiert und aus dem Bild gescrollt, dann startet Video 2: die Leinwand wechselt zu Video 2', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1' });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen', 30_000); // Voraussetzung: Video 1 hat die Leinwand und zeigt Zonen
  await s.evaluate(() => {
    (window as any).pausiere('v1');
    window.scrollTo(0, 1400); // Video 1 (0 bis 360) liegt ganz ausserhalb, #platz2 (ab 1560) im Bild
  });
  await abwarten(1500);
  expect(await s.evaluate(() => document.getElementById('v1')!.getBoundingClientRect().bottom), 'Video 1 ist noch im Bild').toBeLessThan(0);
  const tPlay = await s.evaluate(() => {
    (window as any).neuesVideo({ id: 'v2', anker: '#platz2', ct0: 2.5 });
    return (window as any).epoche() as number;
  });
  await expect.soft.poll(() => hatLeinwand(s, 'v2'), { timeout: 12_000, intervals: [100], message: 'V2: Video 2 hat nach 12 s keine Leinwand (der Halter pausiert ausserhalb des Bildes)' }).toBe(true);
  const l = await plog(s);
  const z2 = leinwandErster(l, 'v2', tPlay);
  if (z2) expect.soft(z2.t - tPlay, 'V2: Video 2 bekam die Leinwand zu spaet').toBeLessThanOrEqual(5000);
  const zs = await zustaende(s);
  expect.soft(zs.find((x) => x.id === 'v2')!.veil, 'V2: Video 2 ist nicht zensiert').toBe('zensiert');
  expect.soft(zs.find((x) => x.id === 'v1')!.leinwand, 'V2: Video 1 hat noch die Leinwand').toBe(false);
  const v = await verstoesse(s);
  // Video 1 spielt im neutralen Anfang (bis 2 s) und ist dort zu Recht frei: "frei" zaehlt hier nicht.
  expect.soft(unerlaubt(v, ['v1', 'v2'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), `V2: Verstoss: ${zeigeVerstoesse(v)}`).toEqual([]);
  await s.close();
});

test('V4 fuenf Videos untereinander, eines pausiert als Vorschau mit erster Antwort, eines im Bild wird gespielt: das spielende bekommt die Leinwand in 3 s', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 3.0 });
  await wartePoll(() => hatLeinwand(s, 'v1'), 30_000); // Voraussetzung: das Vorschau-Video hat zuerst geantwortet und die Leinwand
  for (const i of [3, 4, 5]) await neuesVideo(s, { id: `v${i}`, preload: 'none', abspielen: false });
  await abwarten(1000);
  const tPlay = await s.evaluate(() => {
    (window as any).neuesVideo({ id: 'v2', ct0: 2.5 });
    const el = document.getElementById('v2')!;
    el.parentNode!.insertBefore(el, document.getElementById('v3')); // zweiter von fuenf, im Bild (360 bis 720)
    return (window as any).epoche() as number;
  });
  expect(await s.evaluate(() => [...document.querySelectorAll('#platz video')].map((v) => v.id)), 'fuenf Videos untereinander').toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
  await expect.soft.poll(() => hatLeinwand(s, 'v2'), { timeout: 10_000, intervals: [100], message: 'V4: das spielende Video 2 hat nach 10 s keine Leinwand' }).toBe(true);
  const l = await plog(s);
  const z2 = leinwandErster(l, 'v2', tPlay);
  if (z2) expect.soft(z2.t - tPlay, 'V4: Video 2 bekam die Leinwand zu spaet (hoechstens 3 s nach Play)').toBeLessThanOrEqual(3000);
  const zs = await zustaende(s);
  expect.soft(zs.find((x) => x.id === 'v2')!.veil, 'V4: Video 2 ist nicht zensiert').toBe('zensiert');
  expect.soft(zs.find((x) => x.id === 'v1')!.veil, 'V4: das Vorschau-Video ist nicht verdeckt').toBe('verdeckt');
  expect.soft(zs.find((x) => x.id === 'v1')!.leinwand, 'V4: das Vorschau-Video hat noch die Leinwand').toBe(false);
  await s.close();
});

test('V5 zwei Videos spielen zugleich: genau eine Leinwand, 5 s beim selben Video, das andere verdeckt und mit Etikett', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  await neuesVideo(s, { id: 'v2', ct0: 2.5 });
  const halter = await warteIrgendeine(s);
  const tHalter = await jetzt(s);
  await abwarten(5000);
  const l = await plog(s);
  const mit = (await zustaende(s)).filter((x) => x.leinwand).map((x) => x.id);
  expect.soft(mit, 'V5: genau eine Leinwand').toEqual([halter]);
  const spaeter = l.filter((e) => e.t >= tHalter && e.was === 'data-veil-leinwand');
  expect.soft(spaeter.map((e) => `${e.id}:${e.v === null ? 'weg' : 'da'}`), 'V5: die Leinwand wechselte das Video oder ging weg (Hin und Her)').toEqual([]);
  const anderes = halter === 'v1' ? 'v2' : 'v1';
  const z = (await zustaende(s)).find((x) => x.id === anderes)!;
  expect.soft(z.veil, 'V5: das andere Video ist nicht verdeckt').toBe('verdeckt');
  expect.soft(z.etikett ?? '', 'V5: das andere Video traegt kein Etikett').not.toBe('');
  expect.soft((await zustaende(s)).find((x) => x.id === halter)!.etikett ?? '', 'V5: der Halter traegt ein Etikett').toBe('');
  const v = await verstoesse(s);
  expect.soft(unerlaubt(v, ['v1', 'v2'], ['zensiert-ohne-leinwand', 'frei', 'leinwand-sichtbar']), `V5: Verstoss: ${zeigeVerstoesse(v)}`).toEqual([]);
  await s.close();
});

test('V6 der Halter wird aus dem DOM entfernt, Video 2 spielt: Leinwand bei Video 2 in 3 s', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1' });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen', 30_000); // Voraussetzung: Video 1 hat die Leinwand
  await neuesVideo(s, { id: 'v2', ct0: 2.5 });
  await wartePoll(async () => (await attr(s, 'v2', 'data-veil')) === 'verdeckt', 20_000); // Voraussetzung: Video 2 wurde beurteilt und wartet verdeckt
  expect(await hatLeinwand(s, 'v2'), 'Video 2 hat schon eine Leinwand').toBe(false);
  const tRaus = await s.evaluate(() => (window as any).entferne('v1') as number);
  await expect.soft.poll(() => hatLeinwand(s, 'v2'), { timeout: 10_000, intervals: [100], message: 'V6: Video 2 hat nach 10 s keine Leinwand (das entfernte Video haelt den Platz)' }).toBe(true);
  const z2 = leinwandErster(await plog(s), 'v2', tRaus);
  if (z2) expect.soft(z2.t - tRaus, 'V6: Video 2 bekam die Leinwand zu spaet (hoechstens 3 s)').toBeLessThanOrEqual(3000);
  const v = await verstoesse(s);
  expect.soft(unerlaubt(v, ['v2'], ['zensiert-ohne-leinwand', 'frei', 'leinwand-sichtbar']), `V6: Verstoss: ${zeigeVerstoesse(v)}`).toEqual([]);
  await s.close();
});

// Pruefungen (Status videoZeiten, Uhr performance.now der Seite) in einem Fenster der Epoche.
async function pruefungenZwischen(s: Page, von: number, bis: number): Promise<number> {
  const ursprung = await s.evaluate(() => performance.timeOrigin);
  const st = (await status(s))!;
  return st.videoZeiten.filter((z) => ursprung + z.t > von && ursprung + z.t <= bis).length;
}

// Verlauf des Zaehlers sauberer Pruefungen eines Videos (Testhaken data-veil-video-sauber) und des Modus, Epoche in ms: zaehlt allein die Pruefungen dieses Videos.
// Ein MutationObserver (kein Abfragen im Takt) haelt jede Aenderung fest, auch eine, die kuerzer als ein Abfragetakt steht (nach dem Ende einer Leinwand steht der Zaehler
// auf 0, bis die naechste saubere Pruefung ihn auf 1 setzt, bei erzwingeSauber binnen weniger Millisekunden). Der Wert NACH einer Aenderung ist der alte Wert der
// naechsten Aenderung desselben Attributs (attributeOldValue), sonst der aktuelle: auch mehrere Aenderungen in einem Stapel bleiben einzeln sichtbar.
async function starteSauberVerlauf(s: Page, id: string) {
  await s.evaluate((i) => {
    const w = window as any;
    w.__sauber = w.__sauber ?? {};
    w.__sauber[i] = [];
    const ziel = () => document.getElementById(i);
    const lies = (n: string) => ziel()?.getAttribute(n) ?? null;
    w.__sauber[i].push({ t: w.epoche(), s: lies('data-veil-video-sauber'), m: lies('data-veil-video-modus'), b: 0 });
    let stapel = 0;
    const nach = (recs: MutationRecord[], k: number, name: string): string | null => {
      for (let j = k + 1; j < recs.length; j++) if (recs[j]!.attributeName === name && recs[j]!.target === recs[k]!.target) return recs[j]!.oldValue;
      return lies(name);
    };
    const beob = new MutationObserver((recs) => {
      const t = w.epoche();
      stapel++;
      recs.forEach((r, k) => {
        if ((r.target as Element).id !== i) return;
        w.__sauber[i].push({ t, s: nach(recs, k, 'data-veil-video-sauber'), m: nach(recs, k, 'data-veil-video-modus'), b: stapel });
      });
    });
    beob.observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-veil-video-sauber', 'data-veil-video-modus'] });
  }, id);
}
const sauberVerlauf = (s: Page, id: string) => s.evaluate((i) => (window as any).__sauber[i] as Array<{ t: number; s: string | null; m: string | null; b: number }>, id);

test('V7a Verlierer des Platzes: nach dem Verlust zaehlt die Freigabe von vorn (drei saubere Pruefungen im Takt, nicht eine)', async () => {
  zeit(150_000);
  // Video 1 oben (0 bis 360), Video 2 ab 700: beide im Bild bei Scrollstand 0 und 200, bei 400 nur Video 2.
  const s = await oeffnePlatz('luecke=340');
  await starteSauberVerlauf(s, 'v1');
  await neuesVideo(s, { id: 'v1' });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen', 30_000);
  await neuesVideo(s, { id: 'v2', anker: '#platz2', ct0: 2.5 });
  await abwarten(600);
  await s.evaluate(() => window.scrollTo(0, 400)); // Video 1 raus, Video 2 im Bild
  await wartePoll(() => hatLeinwand(s, 'v2'), 15_000); // Voraussetzung: der Platz ist zu Video 2 gewechselt
  expect(await hatLeinwand(s, 'v1'), 'Video 1 hat noch die Leinwand').toBe(false);
  // Ehrlich, was das belegt (R4): der Zaehler des Verlierers steht nach dem Platzverlust auf 0. Weil Video 1 bis kurz davor eine Person zeigte (jeder Treffer setzt
  // den Zaehler auf 0), beweist das allein NICHT, dass `verwirfFreigabe` ihn zurueckgesetzt hat: den Stand 2 vor dem Platzverlust gibt der Test nicht her (die
  // Erkenner-Ueberschreibung erzwingeSauber gilt fuer alle Videos, dann hat Video 2 keine Flaechen und bekommt den Platz nicht). Den Beweis 2 auf 0 liefert der Fall
  // "P7 Dauerfall" am Rueckfall ueber die Eignung. Hier belegt der Fall: danach braucht Video 1 drei eigene saubere Pruefungen (Verlauf des Zaehlers 1, 2, dann frei).
  expect(await attr(s, 'v1', 'data-veil-video-sauber'), 'P7: der Zaehler des Verlierers steht nicht auf 0').toBe('0');
  // Von jetzt an meldet der Erkenner jedes Bild als sauber. Video 1 kommt zurueck ins Bild (44 Prozent), Video 2 bleibt im Bild und behaelt den Platz.
  await testEreignis(s, { erzwingeSauber: true });
  const tZurueck = await s.evaluate(() => {
    window.scrollTo(0, 200);
    return (window as any).epoche() as number;
  });
  // Beobachtungszeit: hoechstens bis Video 1 frei wird, sonst 5 s (keine Freigabe als Erfolg: es geht nur um "nicht zu frueh").
  let tFrei: number | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000 && tFrei === null) {
    const e = (await plog(s)).find((x) => x.id === 'v1' && x.was === 'data-veil' && x.v === 'frei' && x.t >= tZurueck);
    tFrei = e ? e.t : null;
    await abwarten(100);
  }
  const bis = tFrei ?? (await jetzt(s));
  const verlauf = (await sauberVerlauf(s, 'v1')).filter((x) => x.t >= tZurueck && x.t <= bis + 50);
  const werte = verlauf.map((x) => x.s);
  // Hauptaussage nicht leer erfuellt: der Verlierer wird in der Beobachtungszeit (15 s) wirklich frei, und zwar nicht vor drei sauberen Pruefungen.
  expect(tFrei, 'V7a: Video 1 wurde in 15 s nie frei (die Aussage "fruehestens nach drei Pruefungen" wuerde leer erfuellt)').not.toBeNull();
  // Nur Pruefungen von Video 1 zaehlen (Verlauf von data-veil-video-sauber): der Zaehler lief ueber 1 und 2, bevor das Video frei wurde.
  const i1 = werte.indexOf('1');
  const i2 = werte.indexOf('2');
  expect.soft(i1 >= 0 && i2 > i1, `V7a/I4: Verlauf des Zaehlers von Video 1 bis zur Freigabe ${JSON.stringify(werte)}, erwartet 1 und 2 vor der Freigabe`).toBe(true);
  expect.soft(tFrei === null || tFrei - tZurueck >= 1800, `V7a/I4: Video 1 wurde ${tFrei === null ? 0 : Math.round(tFrei - tZurueck)} ms nach der Rueckkehr frei, erwartet nicht vor 1800 ms (drei Takte)`).toBe(true);
  await s.close();
});

test('V7b nach dem Rueckfall "langsam" gibt eine einzige saubere Pruefung nicht frei (Zaehler steht auf 0)', async () => {
  // Heute gruen (Waechter): nach dem Rueckfall "langsam" werden drei saubere Pruefungen gebraucht (gemessen: frei nach 3 Pruefungen, rund 2,5 s). Die Karte vermutete
  // freiNach minus 1 (Risiko B); an diesem Rueckfallweg stimmt das nicht. Der Fall bewacht, dass es bei E3a so bleibt (P7).
  zeit(150_000);
  const s = await oeffnePlatz();
  await testEreignis(s, { videoVerzoegerungMs: 600 });
  await neuesVideo(s, { id: 'v1' });
  await expect.poll(async () => (await attr(s, 'v1', 'data-veil-video-etikett')) ?? '', { timeout: 45_000, intervals: [100], message: 'Voraussetzung: der Rueckfall "langsam" kam nicht' }).toContain('Too slow');
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect(await hatLeinwand(s, 'v1')).toBe(false);
  // Das Video steht jetzt im Abschnitt mit Person (2 bis 12 s) oder davor. Ab hier ist der Erkenner schnell und meldet jedes Bild sauber.
  await testEreignis(s, { videoVerzoegerungMs: 0 });
  await testEreignis(s, { erzwingeSauber: true });
  const tEreignis = await jetzt(s);
  let tFrei: number | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && tFrei === null) {
    const e = (await plog(s)).find((x) => x.id === 'v1' && x.was === 'data-veil' && x.v === 'frei' && x.t >= tEreignis);
    tFrei = e ? e.t : null;
    await abwarten(100);
  }
  const bis = tFrei ?? (await jetzt(s));
  const geprueft = await pruefungenZwischen(s, tEreignis, bis);
  console.log(`V7b: frei nach ${tFrei === null ? 'nie (6 s)' : Math.round(tFrei - tEreignis) + ' ms'}, Pruefungen ${geprueft}, ct ${await ct(s)}, Zeiten ${JSON.stringify((await plog(s)).filter((e) => e.t >= tEreignis - 500).map((e) => [e.was.slice(5), e.v, Math.round(e.t - tEreignis), Math.round(e.ct * 10) / 10]))}`);
  expect(geprueft, 'Voraussetzung: nach dem Rueckfall wird im Takt weiter geprueft').toBeGreaterThanOrEqual(1);
  // R9: die Hauptaussage ist nie leer erfuellt: das Video wird in der Frist frei, und zwar nicht nach weniger als drei sauberen Pruefungen.
  expect(tFrei, 'V7b: das Video wurde in 6 s nach dem Rueckfall nie frei (die Aussage "nicht nach einer Pruefung" wuerde leer erfuellt)').not.toBeNull();
  expect.soft(geprueft, `V7b/I4: nach dem Rueckfall gab ${geprueft} saubere Pruefung(en) das Video frei, erwartet frueestens drei`).toBeGreaterThanOrEqual(3);
  await s.close();
});

testA('P8 Start der Leinwand: das Video bleibt weichgezeichnet, bis die Leinwand ihr erstes Bild gemalt hat (keine leere und keine scharfe Flaeche)', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  await wartePoll(() => hatLeinwand(s, 'v1'), 30_000);
  await abwarten(3000);
  const l = (await plog(s)).filter((e) => e.id === 'v1');
  // Reihenfolge der Attributwechsel: erst data-veil (verdeckt, Weichzeichner), dann data-veil-leinwand (erstes Bild gemalt), dann data-veil erneut (zensiert).
  // Der MutationObserver liest den Wert erst am Ende der Aufgabe: die Reihenfolge der Namen zaehlt, der Endwert gilt fuer den letzten Eintrag.
  const iVeil1 = l.findIndex((e) => e.was === 'data-veil');
  const iLeinwand = l.findIndex((e) => e.was === 'data-veil-leinwand' && e.v !== null);
  const iVeil2 = l.findIndex((e, i) => i > iLeinwand && e.was === 'data-veil');
  expect(iVeil1, 'P8: das Video bekam vor der Leinwand kein Urteil (kein Weichzeichner)').toBeGreaterThanOrEqual(0);
  expect(iLeinwand, 'P8: das Leinwand-Attribut kam nie').toBeGreaterThanOrEqual(0);
  expect(iVeil1, `P8: das erste Urteil (${iVeil1}) steht nicht vor dem Leinwand-Attribut (${iLeinwand})`).toBeLessThan(iLeinwand);
  expect(iVeil2, `P8: "zensiert" (${iVeil2}) kam nicht nach dem Leinwand-Attribut (${iLeinwand})`).toBeGreaterThan(iLeinwand);
  expect(l[iVeil2]!.v, 'P8: das Urteil nach der Leinwand ist nicht zensiert').toBe('zensiert');
  // Das Leinwand-Attribut kommt erst nach dem ersten gemalten Bild: das Testhaken-Attribut des Modus (gesetzt im Konstruktor) steht davor.
  const iModus = l.findIndex((e) => e.was === 'data-veil-video-modus' && e.v !== null);
  expect(iModus >= 0 && iModus < iLeinwand, `P8: der Modus (${iModus}) steht nicht vor dem Leinwand-Attribut (${iLeinwand})`).toBe(true);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar', 'ohne-urteil-sichtbar']), `P8: Verstoss ${zeigeVerstoesse(v)}`).toEqual([]);
  // Bildfolge: ab Beginn der Zensur nie ein scharfes Schachbrett (der Weichzeichner und die Leinwand decken lueckenlos)
  const bilder = await rec.stoppe();
  const tz = zensurBeginn(l as PlatzEintrag[]);
  expect(tz).not.toBeNull();
  const fenster = bilder.filter((b) => b.ts >= tz! + BEGINN_TOLERANZ_MS);
  expect(fenster.length, 'zu wenige Bilder').toBeGreaterThan(30);
  expect(fenster.filter(scharf).length, 'P8: scharfe Bilder beim Start der Leinwand').toBe(0);
  await s.close();
});

test('P6 Rueckfall: erst verdeckt, dann die Leinwand weg (nie zensiert ohne Leinwand, nie die Leinwand weg vor dem Weichzeichner)', async () => {
  zeit(150_000);
  const s = await oeffnePlatz();
  await testEreignis(s, { videoVerzoegerungMs: 600 });
  await neuesVideo(s, { id: 'v1' });
  await expect.poll(async () => (await attr(s, 'v1', 'data-veil-video-etikett')) ?? '', { timeout: 45_000, intervals: [100], message: 'Voraussetzung: der Rueckfall "langsam" kam nicht' }).toContain('Too slow');
  const l = (await plog(s)).filter((e) => e.id === 'v1');
  const weg = l.map((e) => e.was === 'data-veil-leinwand' && e.v === null).lastIndexOf(true);
  expect(weg, 'Voraussetzung: die Leinwand ging weg').toBeGreaterThanOrEqual(0);
  expect(l.some((e, i) => i < weg && e.was === 'data-veil-leinwand' && e.v !== null), 'Voraussetzung: die Leinwand war vorher da').toBe(true);
  const letztesZensiert = l.map((e) => e.was === 'data-veil' && e.v === 'zensiert').lastIndexOf(true);
  const verdeckt = l.findIndex((e, i) => i > letztesZensiert && e.was === 'data-veil' && e.v === 'verdeckt');
  expect.soft(verdeckt >= 0 && verdeckt < weg, `P6: Leinwand weg bei ${weg} vor dem Weichzeichner bei ${verdeckt} (zensiert zuletzt bei ${letztesZensiert})`).toBe(true);
  await s.close();
});

test('P7 Dauerfall: Rueckfall ueber die Eignung (controls) bei Zaehlerstand 2 setzt den Zaehler auf 0 (die Leinwand endet ohne Freigabe)', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await starteSauberVerlauf(s, 'v1');
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen', 30_000);
  await testEreignis(s, { erzwingeSauber: true });
  // Die Leinwand haelt das Video wegen der 3 s Medienzeit: der Zaehler steht bei 2.
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-sauber')) === '2' && (await attr(s, 'v1', 'data-veil-video-modus')) !== null, 20_000);
  await s.evaluate(() => ((document.getElementById('v1') as HTMLVideoElement).controls = true));
  await wartePoll(async () => ((await status(s)) as any)?.videoZonenRueckfall?.includes('controls'), 10_000);
  await abwarten(300);
  const v = await sauberVerlauf(s, 'v1');
  const iWeg = v.findIndex((x, i) => i > 0 && x.m === null && v[i - 1]!.m !== null);
  expect(iWeg, `die Leinwand endete nicht (Verlauf ${JSON.stringify(v)})`).toBeGreaterThan(0);
  expect(v[iWeg - 1]!.s, 'vor dem Ende der Leinwand stand der Zaehler nicht auf 2').toBe('2');
  // T1 (Pruefung M1): die '0' steht im SELBEN Stapel des Beobachters wie das Verschwinden von data-veil-video-modus (beende und verwirfFreigabe laufen synchron in einer
  // Aufgabe), und die letzte Zahl vor diesem Stapel ist die '2'. Ohne verwirfFreigabe (P7) kaeme die 0 erst mit der naechsten sauberen Pruefung, die dann auf 3 zaehlt,
  // in einem spaeteren Stapel. Nach dem Ende der Leinwand zaehlt der Zaehler weiter 1, 2: das ist egal, nur frei darf das Video nicht werden (unten, 1500 ms).
  const stapel = v[iWeg]!.b;
  const imStapel = v.filter((x) => x.b === stapel);
  expect(imStapel.some((x) => x.s === '0'), `P7: im Stapel, in dem der Modus verschwindet, steht keine 0 (Stapel ${JSON.stringify(imStapel)})`).toBe(true);
  const davor = v.filter((x) => x.b < stapel && x.s !== null);
  expect(davor[davor.length - 1]?.s, `P7: die letzte Zahl vor dem Stapel ist nicht die 2 (Verlauf ${JSON.stringify(v)})`).toBe('2');
  await abwarten(1500); // die Video-Bremse von 1000 ms ist abgelaufen: ohne P7 stuende das Video nach spaetestens drei sauberen Pruefungen frei, hier nach 1500 ms ohne Freigabe
  expect(await attr(s, 'v1', 'data-veil'), 'P7: das Video wurde nach dem Rueckfall zu frueh frei').toBe('verdeckt');
  await s.close();
});

test('R1 ein ungeeignetes Video (controls) hat zuerst geantwortet, ein geeignetes pausiertes dahinter: das geeignete bekommt den Platz', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', controls: true, preload: 'auto', abspielen: false, ct0: 3.0 });
  await wartePoll(async () => ((await attr(s, 'v1', 'data-veil-video-etikett')) ?? '') !== '', 30_000); // v1 hat geantwortet und ist ganz verdeckt, mit Etikett
  expect(await hatLeinwand(s, 'v1'), 'ein Video mit controls darf nie die Leinwand haben').toBe(false);
  await neuesVideo(s, { id: 'v2', preload: 'auto', abspielen: false, ct0: 3.0 });
  await wartePoll(() => hatLeinwand(s, 'v2'), 20_000);
  expect(await hatLeinwand(s, 'v1')).toBe(false);
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  const verstoss = unerlaubt(await verstoesse(s), ['v1', 'v2'], ['zensiert-ohne-leinwand', 'frei', 'leinwand-sichtbar']);
  expect(verstoss, zeigeVerstoesse(verstoss)).toEqual([]);
  await s.close();
});

test('R2 ein einzelnes Video mit Leinwand wird aus dem DOM entfernt: der Host der Leinwand ist binnen 200 ms weg', async () => {
  zeit(90_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1' });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen', 30_000);
  const hosts = () => s.evaluate(() => [...document.getElementById('platz')!.children].filter((c) => c.localName === 'div' && c.id !== 'bedienung').length);
  expect(await hosts(), 'Voraussetzung: der Host der Leinwand steht neben dem Video').toBe(1);
  await s.evaluate(() => (window as any).entferne('v1'));
  await abwarten(200);
  expect(await hosts(), 'der Host der Leinwand steht 200 ms nach dem Entfernen noch im DOM').toBe(0);
  await s.close();
});

test('R2b ein nur umgehaengtes Video (in derselben Aufgabe wieder im Dokument) behaelt seine Leinwand', async () => {
  zeit(90_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1' });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen', 30_000);
  await s.evaluate(() => {
    const v = document.getElementById('v1')!;
    const eltern = v.parentNode!;
    v.remove();
    eltern.insertBefore(v, eltern.firstChild); // zurueck im Dokument, noch in derselben Aufgabe
    eltern.insertBefore(v, null);
  });
  await abwarten(1500);
  expect(await hatLeinwand(s, 'v1'), 'die Leinwand ging beim Umhaengen verloren').toBe(true);
  expect(await attr(s, 'v1', 'data-veil')).toBe('zensiert');
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  await s.close();
});

test('R11 (Waechter) der Halter wird entfernt: Host binnen 200 ms weg, der Kandidat (womoeglich noch gebremst) bleibt verdeckt, danach bekommt er die Leinwand', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  await neuesVideo(s, { id: 'v2', ct0: 2.5 });
  const erster = await warteIrgendeine(s);
  const zweiter = erster === 'v1' ? 'v2' : 'v1';
  // Der Halter wird pausiert, das andere Video uebernimmt; das alte Halter-Video spielt gleich wieder (es ist dann Kandidat, aber 1000 ms lang durch die Video-Bremse gebremst).
  await s.evaluate((ids) => (window as any).pausiere(ids[0]), [erster]);
  await wartePoll(() => hatLeinwand(s, zweiter), 15_000);
  await s.evaluate((ids) => (window as any).spiele(ids[0]), [erster]);
  // T4 (Pruefung N1): Waechter. Dieser Fall stellt den durch die Video-Bremse gebremsten Kandidaten NICHT sicher her: es gibt keinen Haken fuer "frische Antwort dieses
  // Videos" (`videoPruefungen` zaehlt auch die Pruefungen des Halters, die Wartebedingung darauf wurde deshalb entfernt). Er bewacht nur, dass der Host des entfernten
  // Halters binnen 200 ms weg ist, der Kandidat nie ohne Deckung steht und danach die Leinwand bekommt.
  await abwarten(300);
  const hosts = () => s.evaluate(() => [...document.getElementById('platz')!.children].filter((c) => c.localName === 'div' && c.id !== 'bedienung').length);
  expect(await hosts(), 'Voraussetzung: der Host des Halters steht').toBe(1);
  const tRaus = await s.evaluate((i) => (window as any).entferne(i) as number, zweiter);
  await abwarten(200);
  expect(await hosts(), 'R11: der Host des entfernten Halters steht 200 ms nach dem Entfernen noch im DOM').toBe(0);
  const z = (await zustaende(s)).find((x) => x.id === erster)!;
  const l = await plog(s);
  const zwischen = leinwandErster(l, erster, tRaus);
  if (!zwischen || zwischen.t - tRaus > 200) {
    expect.soft(z.veil, 'R11: der gebremste Kandidat steht nicht auf verdeckt').toBe('verdeckt');
    expect.soft(z.leinwand, 'R11: der gebremste Kandidat hat schon eine Leinwand').toBe(false);
  }
  await wartePoll(() => hatLeinwand(s, erster), 15_000);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1', 'v2'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  await s.close();
});

test('R12 Antworten laenger als 400 ms: das erste spielende geeignete Video bekommt trotzdem die Leinwand (Start direkt beim Eintreffen der eigenen Antwort)', async () => {
  zeit(120_000);
  const s = await oeffnePlatz();
  // v0: ungeeignet (controls), bleibt bekannt, damit mehr als ein Video bekannt ist (die Frische gilt nur dann). Es nimmt nie die Leinwand.
  await neuesVideo(s, { id: 'v0', controls: true, preload: 'auto', abspielen: false, ct0: 3.0 });
  await wartePoll(async () => ((await attr(s, 'v0', 'data-veil-video-etikett')) ?? '') !== '', 30_000);
  expect(await hatLeinwand(s, 'v0')).toBe(false);
  await testEreignis(s, { videoVerzoegerungMs: 500 }); // jede Antwort ist beim Eintreffen schon aelter als 400 ms
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  // Kommentar: dass eine gespeicherte Antwort ueber 400 ms in einer Runde ohne neue Antwort keine Leinwand startet, laesst sich hier nicht trennen
  // (jede Antwort dieses Videos laeuft ueber den Aufrufer-Weg); das deckt der Einheitsfall antwortFrisch ab.
  await wartePoll(() => hatLeinwand(s, 'v1'), 20_000);
  expect(await hatLeinwand(s, 'v0')).toBe(false);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v0', 'v1'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  await s.close();
});

testA('V8 zehn schnelle Wechsel der Berechtigung in 2 s: hoechstens vier Platzwechsel, jedes Video zu jedem Zeitpunkt verdeckt oder mit Leinwand', async () => {
  zeit(150_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  // Heute gruen (es gibt keine Platzwechsel); der Fall bewacht die Grenze (P10) und den Schutz (I1) fuer E3a.
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  await neuesVideo(s, { id: 'v2', ct0: 2.5 });
  await warteIrgendeine(s);
  await abwarten(500);
  const { start, ende } = await s.evaluate(() => (window as any).wechselFolge('v1', 'v2', 10, 200) as Promise<{ start: number; ende: number }>);
  await abwarten(1500);
  const l = await plog(s);
  // R9: ein Platzwechsel ist das Erscheinen von data-veil-video-modus (steht ab dem Konstruktor der Leinwand, auch bevor das erste Bild gemalt ist): ein Wechsel ohne
  // gemaltes Bild faellt so nicht aus der Zaehlung. Gezaehlt wird, wenn der Wert erscheint (vorher kein Eintrag oder Wert weg), nicht beim Wechsel zonen/mosaik.
  const letzterModus = new Map<string, string | null>();
  const wechsel = l.filter((e) => {
    if (e.was !== 'data-veil-video-modus') return false;
    const vorher = letzterModus.get(e.id) ?? null;
    letzterModus.set(e.id, e.v);
    return e.v !== null && vorher === null && e.t >= start && e.t <= start + 2000;
  });
  expect(ende - start, 'die zehn Schritte dauerten laenger als 2,5 s (Last)').toBeLessThan(2500);
  // Nicht leer erfuellt: mindestens ein Platzwechsel (die Leinwand erscheint bei einem Video), hoechstens vier (P10).
  expect(wechsel.length, `Platzwechsel in 2 s: ${JSON.stringify(wechsel.map((e) => [e.id, Math.round(e.t - start)]))}`).toBeGreaterThanOrEqual(1);
  expect(wechsel.length, `Platzwechsel in 2 s: ${JSON.stringify(wechsel.map((e) => [e.id, Math.round(e.t - start)]))}`).toBeLessThanOrEqual(4);
  console.log(`V8: Platzwechsel in 2 s: ${wechsel.length} ${JSON.stringify(wechsel.map((e) => [e.id, Math.round(e.t - start)]))}`);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1', 'v2'], ['zensiert-ohne-leinwand', 'frei', 'leinwand-sichtbar']), `V8/I1: ein Video war unbedeckt oder zensiert ohne Leinwand: ${zeigeVerstoesse(v)}`).toEqual([]);
  const bilder = await rec.stoppe();
  const tz = zensurBeginn(l);
  expect(tz, 'Zensur hat nie begonnen').not.toBeNull();
  const fenster = bilder.filter((b) => b.ts >= tz! + BEGINN_TOLERANZ_MS);
  expect(fenster.length).toBeGreaterThan(30);
  expect(fenster.filter(scharf).length, 'V8: scharfe Bilder').toBe(0);
  await s.close();
});

// ====================================================================================================================================================
// E3c: Pause nach Regel S2, Regel K (Nacharbeit Runde 1): das Video wird in der Pause NIE frei. Nach drei sauberen Pruefungen desselben Standbilds zeigt eine KOPIE des
// geprueften Bilds (eigener Host, Testhaken data-veil-video-standbild="kopie"), das Video darunter bleibt `verdeckt` und ist unsichtbar. Alle Faelle laufen mit `video: 'ganz'`.
// Toleranz null: jedes Bild der Aufnahme ab dem Augenblick der Aenderung zaehlt; das Waechter-Schachbrett steht nur in den Bildern mit Person (2 bis 12 s, Film kurz 2 bis 6 s),
// die Kopie eines sauberen Standbilds enthaelt es nie (ausser dem einen Fall mit `wn=1`).
// ====================================================================================================================================================

// Die Bilder nach dem Zeitpunkt `t` bis zur naechsten Freigabe des Videos auf dem normalen Weg (laufender Takt, drei saubere Pruefungen des laufenden Videos) oder bis zum Ende der Aufnahme.
function bilderBisWiederFrei(bilder: Bild[], l: PlatzEintrag[], t: number): { fenster: Bild[]; wiederFreiNach: number | null } {
  const f = l.find((e) => e.id === 'v1' && e.was === 'data-veil' && e.v === 'frei' && e.t > t + 20);
  return { fenster: bilder.filter((b) => b.ts >= t && (!f || b.ts <= f.t)), wiederFreiNach: f ? Math.round(f.t - t) : null };
}

interface PauseStand {
  s: Page;
  tPause: number;
  ctPause: number;
  pruefPause: number;
}
interface PauseOpt {
  // Film mit 6 s: pausiert zwischen `von` und `bis` nach der Schleife (Anfang, neutral), Start bei 4,5 s (Person). Sonst der lange Film, pausiert bei `bei` (Standard 12,5 s).
  kurz?: boolean;
  von?: number;
  bis?: number;
  bei?: number;
  // Fixture ?puls=1: ein Punkt wechselt in jedem Bild, damit die Aufnahme auch im Stand Bilder liefert.
  puls?: boolean;
  // Fixture ?wn=1: das Schachbrett auch im sauberen Standbild.
  wn?: boolean;
  // Weitere Optionen des Videos (controls ...).
  video?: Record<string, unknown>;
}
// Ein Video ohne Leinwand wird verdeckt (Person), laeuft in den neutralen Abschnitt und wird pausiert: sauberes Standbild, Hysterese noch nicht frei.
async function pausiereAufSauberemStandbild(o: PauseOpt = {}): Promise<PauseStand> {
  await setze({ video: 'ganz' });
  const abfrage = [o.kurz ? 'kurz=1' : '', o.puls ? 'puls=1' : '', o.wn ? 'wn=1' : ''].filter(Boolean).join('&');
  const s = await oeffnePlatz(abfrage);
  await starteSauberVerlauf(s, 'v1');
  await neuesVideo(s, { id: 'v1', ct0: o.kurz ? 4.5 : 10.5, ...(o.video ?? {}) });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50], message: 'Voraussetzung: das Video wird beim Anlaufen verdeckt (Person)' }).toBe('verdeckt');
  const p = await s.evaluate(
    (a) => (a.kurz ? (window as any).pausiereIm('v1', a.von, a.bis) : (window as any).pausiereBei('v1', a.bei)) as Promise<{ t: number; ct: number; pruef: number | null } | null>,
    { kurz: !!o.kurz, von: o.von ?? 0.05, bis: o.bis ?? 0.45, bei: o.bei ?? 12.5 },
  );
  expect(p, 'Voraussetzung: das Video erreichte den Haltepunkt nicht').not.toBeNull();
  expect(await attr(s, 'v1', 'data-veil'), 'Voraussetzung: beim Pausieren ist das Video noch verdeckt').toBe('verdeckt');
  expect(await hatLeinwand(s, 'v1'), 'Voraussetzung: bei video "ganz" gibt es keine Leinwand').toBe(false);
  return { s, tPause: p!.t, ctPause: p!.ct, pruefPause: p!.pruef ?? 0 };
}

const kopieDa = async (s: Page, id = 'v1') => (await attr(s, id, 'data-veil-video-standbild')) === 'kopie';
// Hosts im Behaelter: die eigenen Hosts (Kopie, Leinwand) sind Geschwister der Videos (div, nicht die Bedienflaeche).
const hostAnzahl = (s: Page) => s.evaluate(() => [...document.getElementById('platz')!.children].filter((c) => c.localName === 'div' && c.id !== 'bedienung').length);
const nieFrei = (l: PlatzEintrag[], von = 0) => l.filter((e) => e.was === 'data-veil' && e.v === 'frei' && e.t >= von).length;

// Wie die Pause, danach (als Voraussetzung, nicht als Erfolg) steht die Kopie; zurueck gibt es Stand, Seite und Aufnahme.
async function kopieAufStandbild(o: PauseOpt = {}): Promise<PauseStand & { rec: Awaited<ReturnType<typeof starteAufnahme>> }> {
  const st = await pausiereAufSauberemStandbild(o);
  const rec = await starteAufnahme(st.s);
  await expect.poll(() => kopieDa(st.s), { timeout: 20_000, intervals: [50], message: 'Voraussetzung (S2a): das Standbild bekommt in der Pause seine Kopie' }).toBe(true);
  return { ...st, rec };
}

test('S2a Voraussetzung: ein verdecktes Video ohne Leinwand haelt auf einem sauberen Standbild, ohne Leinwand, ohne in der Pause weiterzulaufen', async () => {
  zeit(90_000);
  const { s, ctPause } = await pausiereAufSauberemStandbild();
  await abwarten(500);
  expect(await ct(s)).toBe(ctPause);
  expect(await s.evaluate(() => document.getElementById('v1')!.hasAttribute('data-veil-leinwand'))).toBe(false);
  await s.close();
});

test('S2a Pause auf sauberem Standbild: in der Pause wird geprueft, nach drei sauberen Pruefungen desselben Bilds steht die Kopie, das Video bleibt verdeckt (nie frei)', async () => {
  zeit(90_000);
  const { s, tPause, ctPause, pruefPause } = await pausiereAufSauberemStandbild();
  await expect.soft.poll(() => kopieDa(s), { timeout: 15_000, intervals: [50], message: 'S2a: das Standbild bekam in 15 s keine Kopie' }).toBe(true);
  const tKopie = (await plog(s)).find((e) => e.id === 'v1' && e.was === 'data-veil-video-standbild' && e.v === 'kopie' && e.t >= tPause)?.t;
  expect.soft(await ct(s), 'S2a: das Standbild hat sich bewegt').toBe(ctPause);
  expect.soft(await attr(s, 'v1', 'data-veil'), 'S2a: das Urteil des Videos ist nicht verdeckt').toBe('verdeckt');
  expect.soft(await hostAnzahl(s), 'S2a: es gibt nicht genau einen Host (die Kopie)').toBe(1);
  expect.soft(await s.evaluate(() => getComputedStyle(document.getElementById('v1')!).opacity), 'S2a: das Video unter der Kopie ist nicht unsichtbar').toBe('0');
  expect.soft(nieFrei(await plog(s), tPause), 'S2a: das Video war in der Pause frei (K1: das Video wird auf diesem Weg nie frei)').toBe(0);
  if (tKopie) expect.soft(await pruefungenZwischen(s, tPause, tKopie), 'S2a: Kopie nach weniger als drei Pruefungen des Standbilds').toBeGreaterThanOrEqual(3);
  expect.soft((await status(s))!.videoPruefungen - pruefPause, 'S2a: keine Pruefungen in der Pause').toBeGreaterThanOrEqual(3);
  const v = await verstoesse(s);
  expect.soft(unerlaubt(v, ['v1'], ['frei', 'zensiert-ohne-leinwand', 'leinwand-sichtbar', 'kopie-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  await s.close();
});

// Die Aufnahme zeigt die Kopie des Standbilds scharf (das Schachbrett ist im sauberen Standbild: Film mit ?wn=1) und davor, solange das Video noch weichgezeichnet steht, nicht.
testA('S2a Kopie: die Aufnahme zeigt das saubere Standbild scharf, vor der Kopie nicht', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const st = await pausiereAufSauberemStandbild({ wn: true, puls: true });
  const rec = await starteAufnahme(st.s);
  const diag = () =>
    st.s.evaluate(() => {
      const punkt = [...document.body.children].find((c) => (c as HTMLElement).style?.position === 'fixed' && (c as HTMLElement).style.width === '120px') as HTMLElement | undefined;
      const r = punkt?.getBoundingClientRect();
      return { t: (window as any).epoche() as number, sicht: document.visibilityState, fokus: document.hasFocus(), puls: (window as any).pulsSchritte as number, b: innerWidth, h: innerHeight, punkt: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null };
    });
  const d0 = await diag();
  await expect.poll(() => kopieDa(st.s), { timeout: 20_000, intervals: [50] }).toBe(true);
  const tKopie = (await plog(st.s)).find((e) => e.id === 'v1' && e.was === 'data-veil-video-standbild' && e.v === 'kopie' && e.t >= st.tPause)!.t;
  await abwarten(1200);
  const d1 = await diag();
  const seiten = context.pages().map((p) => p.url().replace(/\?.*/, '').slice(-40));
  const bilder = await rec.stoppe();
  const vorher = bilder.filter((b) => b.ts >= st.tPause + BEGINN_TOLERANZ_MS && b.ts < tKopie - 40);
  const nachher = bilder.filter((b) => b.ts >= tKopie + 120);
  console.log(`chromium: S2a Kopie: ${vorher.length} Bilder vor der Kopie (scharf: ${vorher.filter(scharf).length}), ${nachher.length} danach (scharf: ${nachher.filter(scharf).length})`);
  // Ein Fenster ohne ein einziges Bild beweist nichts (die Aufnahme lieferte nach dem Start keine Bilder): der Fall beginnt einmal von vorn (testA), danach ist er rot.
  if (vorher.length === 0 || nachher.length === 0) {
    console.log(`chromium: S2a Kopie Diagnose: Start ${JSON.stringify({ ...d0, t: Math.round(d0.t - st.tPause) })}, Ende ${JSON.stringify({ ...d1, t: Math.round(d1.t - st.tPause) })}, Pulsschritte im Fenster ${d1.puls - d0.puls}, Seiten ${context.pages().length} ${JSON.stringify(seiten)}`);
    console.log(`chromium: S2a Kopie Aufnahme: ${bilder.length} Bilder insgesamt, erstes ${bilder.length ? Math.round(bilder[0]!.ts - st.tPause) : '-'} ms, letztes ${bilder.length ? Math.round(bilder[bilder.length - 1]!.ts - st.tPause) : '-'} ms gegen die Pause, Kopie bei ${Math.round(tKopie - st.tPause)} ms`);
    throw new KeineBilder();
  }
  expect.soft(vorher.length, 'S2a Kopie: zu wenige Bilder vor der Kopie').toBeGreaterThan(10);
  expect.soft(vorher.filter(scharf).length, 'S2a Kopie: vor der Kopie ist das Standbild scharf zu sehen').toBe(0);
  expect.soft(nachher.length, 'S2a Kopie: zu wenige Bilder nach der Kopie').toBeGreaterThan(10);
  expect.soft(nachher.filter(scharf).length, 'S2a Kopie: die Kopie zeigt das Standbild nicht scharf').toBe(nachher.length);
  expect.soft(await attr(st.s, 'v1', 'data-veil')).toBe('verdeckt');
  await st.s.close();
});

testA('S2b aus der Kopie Play: die Kopie ist sofort weg, das Video steht verdeckt da, kein einziges scharfes Bild des neuen Inhalts', async () => {
  zeit(120_000);
  const { s, rec } = await kopieAufStandbild({ kurz: true });
  const tPlay = await s.evaluate(() => (window as any).spiele('v1') as number);
  await expect.soft.poll(() => kopieDa(s), { timeout: 2000, intervals: [20], message: 'S2b: die Kopie steht nach Play noch' }).toBe(false);
  expect.soft(await attr(s, 'v1', 'data-veil'), 'S2b: nach Play nicht verdeckt').toBe('verdeckt');
  expect.soft(await hostAnzahl(s), 'S2b: nach Play steht der Host der Kopie noch').toBe(0);
  // bis zum Bild mit Person (ab 2 s, Film kurz): das Waechter-Schachbrett darf nie scharf sein
  await wartePoll(async () => (await ct(s)) > 2.6 && (await ct(s)) < 5.5, 40_000);
  const bilder = await rec.stoppe();
  const l = await plog(s);
  expect.soft(nieFrei(l, tPlay), 'S2b: das Video war nach Play frei').toBe(0);
  const { fenster: nach, wiederFreiNach } = bilderBisWiederFrei(bilder, l, tPlay);
  console.log(`chromium: S2b Toleranz 0, wieder frei auf dem normalen Weg nach ${wiederFreiNach} ms, ${nach.length} Bilder im Fenster`);
  expect.soft(nach.length, 'S2b: zu wenige Bilder im Fenster nach Play').toBeGreaterThan(5);
  expect.soft(nach.filter(scharf).length, 'S2b: scharfe Bilder nach Play').toBe(0);
  await s.close();
});

// Der Zaehler sauberer Pruefungen des laufenden Videos (Testhaken data-veil-video-sauber): die drei Pruefungen des Standbilds zaehlen nicht fuer ihn. Der Wert wird im Augenblick
// der Pause gelesen, in einer Szene, in der er dort 1 oder 2 ist (Film lang, Pause bei 13,3 s: die Person endet bei 12 s, die ersten sauberen Pruefungen im Takt liegen davor), und mit dem Wert
// in den ersten 300 ms nach Play verglichen. Ein Fehler, der nach Play auf 0 oder auf 3 setzt, wird so sichtbar (die Messung in der kurzen Szene stand fast immer auf 0).
test('S2b Zaehler: nach Play steht der Zaehler sauberer Pruefungen wie im Augenblick der Pause (1 oder 2, nicht null, nicht drei)', async () => {
  zeit(120_000);
  const st = await pausiereAufSauberemStandbild({ bei: 13.3 });
  const { s } = st;
  const vorPause = await attr(s, 'v1', 'data-veil-video-sauber');
  expect(['1', '2'], `Voraussetzung: im Augenblick der Pause steht der Zaehler auf ${vorPause}, erwartet 1 oder 2`).toContain(vorPause);
  await expect.poll(() => kopieDa(s), { timeout: 20_000, intervals: [50] }).toBe(true);
  expect(await attr(s, 'v1', 'data-veil-video-sauber'), 'in der Pause mit Kopie hat sich der Zaehler des laufenden Videos geaendert (die Pruefungen des Standbilds duerfen ihn nicht zaehlen)').toBe(vorPause);
  const tPlay = await s.evaluate(() => (window as any).spiele('v1') as number);
  await expect.poll(() => kopieDa(s), { timeout: 2000, intervals: [20] }).toBe(false);
  await abwarten(150);
  const verlauf = await sauberVerlauf(s, 'v1');
  const imFenster = verlauf.filter((x) => x.t >= tPlay && x.t <= tPlay + 300 && x.s !== null).map((x) => x.s);
  expect.soft(imFenster.every((w) => w === vorPause), `S2b Zaehler: Zaehlerwerte in den ersten 300 ms nach Play ${JSON.stringify(imFenster)}, erwartet nur ${vorPause}`).toBe(true);
  expect.soft(await attr(s, 'v1', 'data-veil-video-sauber'), 'S2b Zaehler: der Zaehler nach Play weicht vom Stand im Augenblick der Pause ab').toBe(vorPause);
  await s.close();
});

testA('S2c aus der Kopie springen: die Kopie ist sofort weg, das Video verdeckt, dann neue Pruefung des neuen Standbilds, kein einziges scharfes Bild', async () => {
  zeit(120_000);
  const { s, rec } = await kopieAufStandbild({ puls: true });
  const vorher = (await status(s))!.videoPruefungen;
  const tSprung = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).currentTime = 3.5; // Standbild mit Person und Waechter
    return (window as any).epoche() as number;
  });
  await expect.soft.poll(() => kopieDa(s), { timeout: 2000, intervals: [20], message: 'S2c: die Kopie steht nach dem Sprung noch' }).toBe(false);
  expect.soft(await attr(s, 'v1', 'data-veil'), 'S2c: nach dem Sprung nicht verdeckt').toBe('verdeckt');
  await abwarten(3500);
  expect.soft((await status(s))!.videoPruefungen - vorher, 'S2c: keine neue Pruefung des neuen Standbilds').toBeGreaterThanOrEqual(1);
  expect.soft(await attr(s, 'v1', 'data-veil'), 'S2c: das Standbild mit Person ist nicht verdeckt').toBe('verdeckt');
  expect.soft(await kopieDa(s), 'S2c: das Standbild mit Person hat eine Kopie').toBe(false);
  const l = await plog(s);
  expect.soft(nieFrei(l, tSprung), 'S2c: das Video war nach dem Sprung frei').toBe(0);
  const bilder = await rec.stoppe();
  const nach = bilder.filter((b) => b.ts >= tSprung);
  console.log(`chromium: S2c Toleranz 0: ${nach.length} Bilder ab dem Sprung, scharf: ${nach.filter(scharf).length}`);
  expect.soft(nach.length, 'S2c: zu wenige Bilder nach dem Sprung').toBeGreaterThanOrEqual(3);
  expect.soft(nach.filter(scharf).length, 'S2c: scharfe Bilder nach dem Sprung').toBe(0);
  await s.close();
});

testA('S2d (Waechter) Standbild mit Person bleibt in der Pause verdeckt, nie frei, nie scharf', async () => {
  zeit(90_000);
  expect(messungBelegt || OHNE_KENNZEICHNUNG, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 3.0 });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50] }).toBe('verdeckt');
  const p = await s.evaluate(() => (window as any).pausiereBei('v1', 3.4) as Promise<{ t: number; ct: number } | null>);
  expect(p, 'das Video erreichte 3,4 s nicht').not.toBeNull();
  await abwarten(5000); // in der Pause: auch eine kuenftige Pruefung des Standbilds findet die Person und haelt das Video verdeckt
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect(await ct(s)).toBe(p!.ct);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1'], ['frei', 'zensiert-ohne-leinwand', 'leinwand-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  const l = await plog(s);
  expect(l.filter((e) => e.was === 'data-veil' && e.v === 'frei').length, 'das Standbild mit Person war frei').toBe(0);
  const bilder = await rec.stoppe();
  const tz = zensurBeginn(l);
  expect(tz).not.toBeNull();
  const fenster = bilder.filter((b) => b.ts >= tz! + BEGINN_TOLERANZ_MS);
  expect(fenster.length, 'zu wenige Bilder (ein Standbild erzeugt nur wenige neue Bilder)').toBeGreaterThanOrEqual(3);
  expect(fenster.filter(scharf).length, 'scharfe Bilder in der Pause').toBe(0);
  await s.close();
});

testA('S2e (Waechter) Video mit Leinwand behaelt in der Pause die Zonen fuer das Standbild, nie scharf', async () => {
  zeit(90_000);
  expect(messungBelegt || OHNE_KENNZEICHNUNG, 'Gegenprobe der Messung fehlt').toBe(true);
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 2.5 });
  await wartePoll(async () => (await attr(s, 'v1', 'data-veil-video-modus')) === 'zonen' && (await ct(s)) < 4.2, 40_000);
  const p = await s.evaluate(() => (window as any).pausiereBei('v1', 3.0) as Promise<{ t: number; ct: number } | null>);
  expect(p, 'das Video erreichte 3 s nicht').not.toBeNull();
  await abwarten(3000);
  expect(await attr(s, 'v1', 'data-veil'), 'in der Pause ist das Video nicht zensiert').toBe('zensiert');
  expect(await hatLeinwand(s, 'v1'), 'in der Pause fehlt die Leinwand').toBe(true);
  const boxen = JSON.parse((await attr(s, 'v1', 'data-veil-video-boxen')) ?? 'null');
  expect(boxen?.flaechen?.length ?? 0, `in der Pause fehlen die Flaechen der Zonen: ${JSON.stringify(boxen)}`).toBeGreaterThan(0);
  expect(await ct(s)).toBe(p!.ct);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  const bilder = await rec.stoppe();
  const tz = zensurBeginn(await plog(s));
  expect(tz).not.toBeNull();
  const fenster = bilder.filter((b) => b.ts >= tz! + BEGINN_TOLERANZ_MS);
  expect(fenster.length, 'zu wenige Bilder (ein Standbild erzeugt nur wenige neue Bilder)').toBeGreaterThanOrEqual(3);
  expect(fenster.filter(scharf).length, 'scharfe Bilder in der Pause').toBe(0);
  await s.close();
});

// ---------- E3c, weitere Faelle (a) bis (l) ----------

const POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// Hoechstens so viele Pruefungen in der Pause (je Standbild: 3 saubere, dazu eine laufende des Takts vor der Pause): kein Dauerpruefen eines unveraenderten Bilds.
const PAUSE_PRUEF_MAX = 6;

// (a) Ein nie gespieltes Video mit poster-Attribut: es zeigt das Poster, nicht ein Bild des Films. Es wird bei 3 s (Person) verdeckt, springt zurueck an den Anfang (0 s, nie gespielt,
// erstes Bild sauber): ohne Poster waere das ein Standbild zum Pruefen (Kontrolle a2), mit Poster bleibt es verdeckt und bekommt keine Kopie.
async function nieGespieltAufNull(poster: boolean) {
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 3.0, ...(poster ? { poster: POSTER } : {}) });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50], message: 'Voraussetzung: das nie gespielte Video mit Person im ersten Bild wird verdeckt' }).toBe('verdeckt');
  expect(await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).played.length), 'Voraussetzung: das Video wurde nie gespielt').toBe(0);
  const vorher = (await status(s))!.videoPruefungen;
  const tSprung = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).currentTime = 0;
    return (window as any).epoche() as number;
  });
  return { s, rec, tSprung, vorher };
}

test('(a) nie gespieltes Video mit Poster, erstes Bild sauber: bleibt verdeckt, keine Kopie, auch nach vielen Sekunden, nie frei, nie scharf', async () => {
  zeit(90_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const { s, rec, tSprung, vorher } = await nieGespieltAufNull(true);
  await expect.poll(() => ct(s), { timeout: 5000, intervals: [50], message: 'Voraussetzung: das Video steht auf 0 s' }).toBeLessThan(0.05);
  await abwarten(9000);
  expect(await attr(s, 'v1', 'data-veil'), '(a): das nie gespielte Video mit Poster wurde frei').toBe('verdeckt');
  expect(await kopieDa(s), '(a): das Poster-Video bekam eine Kopie').toBe(false);
  expect(await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).paused)).toBe(true);
  const l = await plog(s);
  expect(nieFrei(l, tSprung), '(a): das Video war nach dem Sprung auf das erste Bild frei').toBe(0);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1'], ['frei', 'zensiert-ohne-leinwand', 'leinwand-sichtbar', 'kopie-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  console.log(`chromium: (a) Pruefungen in 9 s auf dem Poster-Standbild: ${(await status(s))!.videoPruefungen - vorher}`);
  const bilder = await rec.stoppe();
  const fenster = bilder.filter((b) => b.ts >= (zensurBeginn(l) ?? tSprung) + BEGINN_TOLERANZ_MS);
  expect(fenster.filter(scharf).length, '(a): scharfe Bilder').toBe(0);
  await s.close();
});

// Kontrolle zu (a): dasselbe ohne poster-Attribut ist ein Standbild des Films und bekommt nach drei sauberen Pruefungen seine Kopie (das Video bleibt verdeckt).
test('(a2) Kontrolle: dasselbe ohne poster-Attribut, erstes Bild des Films sauber: nach drei sauberen Pruefungen steht die Kopie', async () => {
  zeit(90_000);
  const { s, rec, tSprung } = await nieGespieltAufNull(false);
  await expect.soft.poll(() => kopieDa(s), { timeout: 15_000, intervals: [100], message: '(a2): ohne Poster blieb das Standbild 15 s ohne Kopie' }).toBe(true);
  expect.soft(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect.soft(nieFrei(await plog(s), tSprung)).toBe(0);
  await rec.stoppe();
  await s.close();
});

// (b) Ein Standbild mit Person bleibt verdeckt, auch nach vielen Sekunden; der Treffer beendet die Pruefung dieses Standbilds (kein Dauerpruefen).
testA('(b) Standbild mit Person: nach 15 s Pause nie frei, keine Kopie, nie scharf, und keine Dauerpruefung des unveraenderten Bilds', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 3.0 });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50] }).toBe('verdeckt');
  const p = await s.evaluate(() => (window as any).pausiereBei('v1', 3.4) as Promise<{ t: number; ct: number; pruef: number | null } | null>);
  expect(p, 'das Video erreichte 3,4 s nicht').not.toBeNull();
  await abwarten(15_000);
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect(await kopieDa(s), '(b): das Standbild mit Person hat eine Kopie').toBe(false);
  const l = await plog(s);
  expect(nieFrei(l), '(b): das Standbild mit Person war frei').toBe(0);
  const pruefInPause = (await status(s))!.videoPruefungen - (p!.pruef ?? 0);
  console.log(`chromium: (b) Pruefungen in 15 s Pause auf dem Standbild mit Person: ${pruefInPause}`);
  expect(pruefInPause, `(b): ${pruefInPause} Pruefungen in 15 s auf einem unveraenderten Standbild (Treffer beendet die Pruefung)`).toBeLessThanOrEqual(PAUSE_PRUEF_MAX);
  const bilder = await rec.stoppe();
  const tz = zensurBeginn(l);
  expect(tz).not.toBeNull();
  expect(bilder.filter((b) => b.ts >= tz! + BEGINN_TOLERANZ_MS).filter(scharf).length, '(b): scharfe Bilder in der Pause').toBe(0);
  const v = await verstoesse(s);
  expect(unerlaubt(v, ['v1'], ['frei', 'zensiert-ohne-leinwand', 'leinwand-sichtbar', 'kopie-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
  await s.close();
});

// (c) Bild fuer Bild in der Pause: mehrere Spruenge kurz hintereinander, abwechselnd auf saubere Bilder (12,6 bis 12,8 s) und auf Bilder mit Person und Waechter (3,5 bis 3,7 s).
// Nach dem ersten Sprung ist die Kopie weg und kommt waehrend der Spruenge nie wieder (jedes Standbild braucht drei Pruefungen, die Spruenge folgen im Abstand von 200 ms);
// kein Bild ab dem ersten Sprung zeigt das Schachbrett scharf.
testA('(c) Bild fuer Bild in der Pause (sechs Spruenge in 1,2 s): die Kopie sofort weg und nie wieder, nie frei, kein scharfes Bild', async () => {
  zeit(150_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const { s, rec } = await kopieAufStandbild({ puls: true });
  const zeiten = [12.6, 3.5, 12.7, 3.6, 12.8, 3.7];
  const t = await s.evaluate(async (liste) => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    const start = (window as any).epoche() as number;
    let kopieWiederDa = false;
    for (const z of liste) {
      v.currentTime = z;
      await new Promise((r) => setTimeout(r, 200));
      if (v.getAttribute('data-veil-video-standbild') === 'kopie') kopieWiederDa = true;
    }
    return { start, ende: (window as any).epoche() as number, kopieWiederDa };
  }, zeiten);
  expect.soft(t.kopieWiederDa, '(c): waehrend der Spruenge stand wieder eine Kopie da').toBe(false);
  expect.soft(await attr(s, 'v1', 'data-veil'), '(c): nach dem letzten Sprung (Bild mit Person) nicht verdeckt').toBe('verdeckt');
  expect.soft(nieFrei(await plog(s), t.start - 50), '(c): das Video war waehrend der Spruenge frei').toBe(0);
  await abwarten(3000);
  expect.soft(await attr(s, 'v1', 'data-veil'), '(c): das Standbild mit Person (letzter Sprung) ist nicht verdeckt').toBe('verdeckt');
  expect.soft(await kopieDa(s), '(c): das Standbild mit Person hat eine Kopie').toBe(false);
  const bilder = await rec.stoppe();
  const nach = bilder.filter((b) => b.ts >= t.start);
  expect.soft(nach.length, '(c): zu wenige Bilder nach dem ersten Sprung').toBeGreaterThanOrEqual(5);
  expect.soft(nach.filter(scharf).length, '(c): scharfe Bilder nach dem ersten Sprung').toBe(0);
  await s.close();
});

// (d) Play unmittelbar nach dem Erscheinen der Kopie: ein Beobachter in der Seite ruft play(), sobald das Attribut der Kopie steht (im selben Mikroschritt). Danach ist die Kopie weg und
// kein Bild der Folge (Film kurz: die Person kommt bei 2 s, etwa 1,4 s nach Play) zeigt das Schachbrett scharf, solange das Video nicht auf dem normalen Weg wieder frei wird.
testA('(d) Play unmittelbar nach dem Erscheinen der Kopie (im selben Mikroschritt): die Kopie weg, verdeckt, kein scharfes Bild eines spaeteren Bilds', async () => {
  zeit(150_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const st = await pausiereAufSauberemStandbild({ kurz: true });
  const { s } = st;
  await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    (window as any).__playBeiKopie = 0;
    new MutationObserver(() => {
      if (v.getAttribute('data-veil-video-standbild') === 'kopie' && v.paused && !(window as any).__playBeiKopie) {
        (window as any).__playBeiKopie = (window as any).epoche();
        v.play().catch(() => {});
      }
    }).observe(v, { attributes: true, attributeFilter: ['data-veil-video-standbild'] });
  });
  const rec = await starteAufnahme(s);
  await expect.poll(() => s.evaluate(() => (window as any).__playBeiKopie as number), { timeout: 20_000, intervals: [50], message: '(d): das Standbild bekam in der Pause nie eine Kopie' }).toBeGreaterThan(0);
  const tPlay = await s.evaluate(() => (window as any).__playBeiKopie as number);
  await expect.soft.poll(() => kopieDa(s), { timeout: 2000, intervals: [20], message: '(d): nach Play steht die Kopie noch' }).toBe(false);
  expect.soft(await attr(s, 'v1', 'data-veil'), '(d): nach Play nicht verdeckt').toBe('verdeckt');
  await wartePoll(async () => (await ct(s)) > 2.6 && (await ct(s)) < 5.5, 40_000);
  const bilder = await rec.stoppe();
  const l = await plog(s);
  expect.soft(nieFrei(l, tPlay), '(d): das Video war nach Play frei').toBe(0);
  const { fenster: nach, wiederFreiNach } = bilderBisWiederFrei(bilder, l, tPlay);
  console.log(`chromium: (d) Toleranz 0, wieder frei auf dem normalen Weg nach ${wiederFreiNach} ms, ${nach.length} Bilder im Fenster`);
  expect.soft(nach.length, '(d): zu wenige Bilder im Fenster nach Play').toBeGreaterThan(5);
  expect.soft(nach.filter(scharf).length, '(d): scharfe Bilder nach Play, solange das Video verdeckt ist').toBe(0);
  await s.close();
});

// (e) Die Quelle wechselt in der Pause: die neue Quelle (derselbe Film als frisches Blob, Start bei 3,5 s per Fragment) zeigt im ersten Bild die Person mit Waechter. Sofort keine Kopie,
// nie frei, kein scharfes Bild.
testA('(e) Quelle wechselt in der Pause (neue Quelle zeigt im ersten Bild die Person mit Waechter): sofort keine Kopie, nie frei, kein scharfes Bild', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const { s, rec } = await kopieAufStandbild({ puls: true });
  const tWechsel = await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    v.src = (window as any).neueQuelle() + '#t=3.5';
    return (window as any).epoche() as number;
  });
  await expect.soft.poll(() => kopieDa(s), { timeout: 2000, intervals: [20], message: '(e): die Kopie steht nach dem Quellenwechsel noch' }).toBe(false);
  await abwarten(3500);
  const v = await verstoesse(s);
  expect.soft(unerlaubt(v.filter((x) => x.t >= tWechsel), ['v1'], ['frei', 'ohne-urteil-sichtbar', 'zensiert-ohne-leinwand', 'leinwand-sichtbar', 'kopie-sichtbar']), `(e): ${zeigeVerstoesse(v)}`).toEqual([]);
  expect.soft(await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).currentTime), '(e): die neue Quelle steht nicht auf der Person (Voraussetzung)').toBeGreaterThan(3.0);
  const bilder = await rec.stoppe();
  const nach = bilder.filter((b) => b.ts >= tWechsel);
  console.log(`chromium: (e) Toleranz 0: ${nach.length} Bilder ab dem Quellenwechsel, scharf: ${nach.filter(scharf).length}`);
  expect.soft(nach.filter(scharf).length, '(e): scharfe Bilder nach dem Quellenwechsel').toBe(0);
  await s.close();
});

// (f) Ohne Bildwaechter (Testschalter ohneRvfc: auch fuer die Kopie wird dann kein requestVideoFrameCallback gestellt, Pfad von Firefox 128): die Kopie kommt und geht allein ueber
// die Ereignisse am Fenster und die Nachschau. Das ist etwas anderes als S2a (dort stellt der Bildwaechter mit): hier steht nach Play und nach einem Sprung die Kopie nie laenger als
// die Ereignisse brauchen, und kein Bild des neuen Inhalts ist scharf.
testA('(f) ohne Bildwaechter (Testschalter): die Kopie kommt und geht allein ueber Ereignisse und Nachschau, nie frei, kein scharfes Bild', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz('puls=1');
  await testEreignis(s, { ohneRvfc: true });
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 10.5 });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50] }).toBe('verdeckt');
  const p = await s.evaluate(() => (window as any).pausiereBei('v1', 12.5) as Promise<{ t: number; ct: number; pruef: number | null } | null>);
  expect(p, 'das Video erreichte 12,5 s nicht').not.toBeNull();
  await expect.poll(() => kopieDa(s), { timeout: 20_000, intervals: [100], message: '(f): ohne Bildwaechter keine Kopie' }).toBe(true);
  expect(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  const tSprung = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).currentTime = 3.5;
    return (window as any).epoche() as number;
  });
  await expect.soft.poll(() => kopieDa(s), { timeout: 1000, intervals: [10], message: '(f): die Kopie steht nach dem Sprung noch' }).toBe(false);
  await abwarten(1500);
  const l = await plog(s);
  expect(nieFrei(l, p!.t), '(f): frei').toBe(0);
  const bilder = await rec.stoppe();
  expect(bilder.filter((b) => b.ts >= tSprung).filter(scharf).length, '(f): scharfe Bilder des neuen Inhalts').toBe(0);
  await s.close();
});

// V1 (R5): eine Pruefung, die beim Laufen beginnt und deren Antwort nach der Pause kommt (verzoegerte Antwort ueber den Testhaken videoVerzoegerungMs), zaehlt nicht im
// Zaehler `sauber` des laufenden Videos. Ein Treffer wirkt weiter sofort; hier ist die Antwort sauber (Bild nach 12 s).
test('V1 (R5) eine Pruefung beginnt beim Laufen, die Antwort kommt nach der Pause: der Zaehler sauberer Pruefungen steigt nicht', async () => {
  zeit(120_000);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  await starteSauberVerlauf(s, 'v1');
  await testEreignis(s, { videoVerzoegerungMs: 1700 }); // knapp unter der Frist von 2000 ms: es ist praktisch immer eine Pruefung unterwegs
  await neuesVideo(s, { id: 'v1', ct0: 10.5 });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 40_000, intervals: [50] }).toBe('verdeckt');
  const p = await s.evaluate(() => (window as any).pausiereBei('v1', 13.0) as Promise<{ t: number; ct: number } | null>);
  expect(p, 'das Video erreichte 13 s nicht').not.toBeNull();
  const vorPause = await attr(s, 'v1', 'data-veil-video-sauber');
  await abwarten(300); // der Status wird gedrosselt geschrieben
  const ursprung = await s.evaluate(() => performance.timeOrigin);
  const imFlug = (await status(s))!.videoZeiten.filter((z) => ursprung + z.t > p!.t - 1700 && ursprung + z.t < p!.t);
  expect(imFlug.length, 'Voraussetzung: beim Pausieren war eine Pruefung unterwegs (begonnen beim Laufen, Antwort noch offen)').toBeGreaterThanOrEqual(1);
  await abwarten(2300); // die Antwort kommt nach der Pause (1700 ms), danach laufen noch die Pruefungen des Standbilds (zaehlen nie im laufenden Zaehler)
  const verlauf = await sauberVerlauf(s, 'v1');
  const danach = verlauf.filter((x) => x.t > p!.t && x.s !== null).map((x) => Number(x.s));
  expect(Math.max(Number(vorPause), ...danach), `V1: der Zaehler stieg nach der Pause von ${vorPause} auf ${JSON.stringify(danach)}`).toBeLessThanOrEqual(Number(vorPause));
  expect(await attr(s, 'v1', 'data-veil-video-sauber'), 'V1: der Zaehler nach der Pause weicht ab').toBe(vorPause);
  await s.close();
});

// ---------- E3d: Poster eines nie gespielten Videos (Regel P) ----------
// p1 bis p4 und die beiden Waechter-Faelle (P-Poster). Das Poster zeigt in den Faellen mit Waechter die Person mit Schachbrett (erzeugePoster), sonst ein kleines neutrales Bild.

test('p1 Poster neutral, Film neutral: bleibt bis zum Abspielen verdeckt, danach frei nach drei sauberen Pruefungen ab null', async () => {
  zeit(120_000);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  await starteSauberVerlauf(s, 'v1');
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 13.0, poster: POSTER });
  await expect.poll(() => s.evaluate(() => { const v = document.getElementById('v1') as HTMLVideoElement; return v.readyState >= 2 && v.getAttribute('data-veil') !== null; }), { timeout: 30_000, intervals: [100] }).toBe(true);
  await abwarten(6000);
  expect(await attr(s, 'v1', 'data-veil'), 'p1: das nie gespielte Video mit Poster ist nicht verdeckt').toBe('verdeckt');
  expect(nieFrei(await plog(s)), 'p1: das Video war vor dem Abspielen frei').toBe(0);
  const tPlay = await s.evaluate(() => (window as any).spiele('v1') as number);
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 20_000, intervals: [50], message: 'p1: das Video wurde nach dem Abspielen nicht frei' }).toBe('frei');
  const tFrei = (await plog(s)).find((e) => e.was === 'data-veil' && e.v === 'frei' && e.t >= tPlay)!.t;
  console.log(`chromium: p1 frei ${Math.round(tFrei - tPlay)} ms nach Play, Zaehlerfolge ${JSON.stringify((await sauberVerlauf(s, 'v1')).filter((x) => x.t >= tPlay).map((x) => x.s))}`);
  expect(tFrei - tPlay, 'p1: frei nach weniger als zwei Taktzeiten (der Zaehler steht beim Abspielen auf null, drei saubere Pruefungen)').toBeGreaterThanOrEqual(1800);
  await s.close();
});

testA('p2 Poster nachtraeglich auf ein freies, nie gespieltes Video gesetzt: sofort verdeckt, in der Aufnahme kein scharfes Poster', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz('puls=1');
  const poster = await s.evaluate(() => (window as any).erzeugePoster() as Promise<string>);
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 13.0 });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50], message: 'Voraussetzung: das nie gespielte Video ohne Poster wird frei' }).toBe('frei');
  await abwarten(500);
  const t = await s.evaluate((pst) => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    const t0 = (window as any).epoche() as number;
    v.setAttribute('poster', pst);
    return t0;
  }, poster);
  await expect.soft.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 1000, intervals: [5], message: 'p2: nach dem Setzen des Posters nicht verdeckt' }).toBe('verdeckt');
  const verdeckt = (await plog(s)).find((e) => e.was === 'data-veil' && e.v === 'verdeckt' && e.t >= t);
  console.log(`chromium: p2 verdeckt ${verdeckt ? Math.round(verdeckt.t - t) : 'nie'} ms nach dem Setzen des Posters`);
  expect.soft(verdeckt && verdeckt.t - t <= 50, 'p2: das Video blieb nach dem Setzen des Posters laenger als 50 ms frei').toBe(true);
  await abwarten(4000);
  expect.soft(await attr(s, 'v1', 'data-veil'), 'p2: das Video ist spaeter nicht verdeckt').toBe('verdeckt');
  const bilder = await rec.stoppe();
  const nach = bilder.filter((b) => b.ts >= t);
  console.log(`chromium: p2 Toleranz 0: ${nach.length} Bilder ab dem Setzen, scharf: ${nach.filter(scharf).length}`);
  expect.soft(nach.filter(scharf).length, 'p2: scharfe Bilder des Posters').toBe(0);
  await s.close();
});

test('p3 Poster entfernt: das Erst-Urteil gilt wie ohne Poster (frei bei sauberem ersten Bild)', async () => {
  zeit(120_000);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 13.0, poster: POSTER });
  await expect.poll(() => s.evaluate(() => { const v = document.getElementById('v1') as HTMLVideoElement; return v.readyState >= 2 && v.getAttribute('data-veil') !== null; }), { timeout: 30_000, intervals: [100] }).toBe(true);
  await abwarten(2000);
  expect(await attr(s, 'v1', 'data-veil'), 'Voraussetzung: mit Poster verdeckt').toBe('verdeckt');
  const t = await s.evaluate(() => {
    document.getElementById('v1')!.removeAttribute('poster');
    return (window as any).epoche() as number;
  });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 15_000, intervals: [50], message: 'p3: nach dem Entfernen des Posters wurde das Video nie frei' }).toBe('frei');
  console.log(`chromium: p3 frei ${Math.round((await plog(s)).find((e) => e.was === 'data-veil' && e.v === 'frei' && e.t >= t)!.t - t)} ms nach dem Entfernen des Posters`);
  await s.close();
});

test('p4 leeres poster-Attribut: das Video bleibt verdeckt, nie frei', async () => {
  zeit(120_000);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, ct0: 13.0, posterLeer: true });
  await expect.poll(() => s.evaluate(() => { const v = document.getElementById('v1') as HTMLVideoElement; return v.readyState >= 2 && v.getAttribute('data-veil') !== null; }), { timeout: 30_000, intervals: [100] }).toBe(true);
  await abwarten(6000);
  expect(await attr(s, 'v1', 'poster'), 'Voraussetzung: das poster-Attribut ist leer und gesetzt').toBe('');
  expect(await attr(s, 'v1', 'data-veil'), 'p4: das Video mit leerem poster ist nicht verdeckt').toBe('verdeckt');
  expect(nieFrei(await plog(s)), 'p4: das Video war frei').toBe(0);
  await s.close();
});

// (g) Die Seite blockiert den Hauptfaden direkt nach dem Sprung oder nach play(): der Browser reicht neue Videobilder weiter, Ereignisse laufen erst danach. Das Video unter der Kopie ist
// unsichtbar (Attribut), die Kopie zeigt das alte, gepruefte Bild: in keinem Bild der Aufnahme (Toleranz null) steht das Schachbrett des neuen Inhalts scharf.
for (const art of ['Sprung', 'Play'] as const) {
  testA(`(g) ${art} aus der Kopie, waehrend die Seite den Hauptfaden blockiert: kein einziges scharfes Bild des neuen Inhalts`, async () => {
    zeit(150_000);
    if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
    // Play: Pause kurz vor der Person (1,4 bis 1,5 s, Person ab 2 s): die Person kommt waehrend der Blockade von 800 ms.
    const { s, rec } = await kopieAufStandbild(art === 'Play' ? { kurz: true, von: 1.3, bis: 1.5, puls: true } : { puls: true });
    const t = await s.evaluate((a) => {
      const v = document.getElementById('v1') as HTMLVideoElement;
      const t0 = (window as any).epoche() as number;
      if (a === 'Sprung') v.currentTime = 3.5;
      else v.play().catch(() => {});
      const b = performance.now();
      while (performance.now() - b < 800) {
        // Hauptfaden blockiert: Ereignisse und Rueckrufe laufen erst danach
      }
      return t0;
    }, art);
    await abwarten(1500);
    expect.soft(await kopieDa(s), `(g) ${art}: die Kopie steht nach der Blockade noch`).toBe(false);
    expect.soft(await attr(s, 'v1', 'data-veil'), `(g) ${art}: das Video ist nicht verdeckt`).toBe('verdeckt');
    const l = await plog(s);
    expect.soft(nieFrei(l, t), `(g) ${art}: das Video war frei`).toBe(0);
    const bilder = await rec.stoppe();
    const nach = bilder.filter((b) => b.ts >= t);
    console.log(`chromium: (g) ${art} Toleranz 0: ${nach.length} Bilder ab dem Ausloeser (Blockade 800 ms), scharf: ${nach.filter(scharf).length}`);
    expect.soft(nach.filter(scharf).length, `(g) ${art}: scharfe Bilder des neuen Inhalts`).toBe(0);
    const v = await verstoesse(s);
    expect.soft(unerlaubt(v, ['v1'], ['frei', 'kopie-sichtbar', 'ohne-urteil-sichtbar']), zeigeVerstoesse(v)).toEqual([]);
    await s.close();
  });
}

// (h) Die Seite stoppt seeking, seeked, play, playing und timeupdate in der Capture-Phase am window (spaeter angemeldet als die Horcher der Erweiterung, die ab dem Start des
// Content-Scripts am Fenster haengen): die Kopie ist trotzdem sofort weg, spaetestens nach der Nachschau, und nichts Scharfes erscheint.
testA('(h) die Seite stoppt die Ereignisse am window in der Capture-Phase: die Kopie ist trotzdem weg, kein scharfes Bild', async () => {
  zeit(150_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const { s, rec } = await kopieAufStandbild({ puls: true });
  await s.evaluate(() => {
    for (const n of ['seeking', 'seeked', 'play', 'playing', 'timeupdate']) window.addEventListener(n, (e) => e.stopImmediatePropagation(), true);
  });
  const t = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).currentTime = 3.5;
    return (window as any).epoche() as number;
  });
  await expect.soft.poll(() => kopieDa(s), { timeout: 1000, intervals: [10], message: '(h): die Kopie steht nach der Nachschau noch' }).toBe(false);
  const tWeg = (await plog(s)).find((e) => e.id === 'v1' && e.was === 'data-veil-video-standbild' && e.v === null && e.t >= t)?.t;
  console.log(`chromium: (h) Kopie weg nach ${tWeg ? Math.round(tWeg - t) : 'nie'} ms`);
  await abwarten(2500);
  expect.soft(await attr(s, 'v1', 'data-veil')).toBe('verdeckt');
  expect.soft(nieFrei(await plog(s), t)).toBe(0);
  const bilder = await rec.stoppe();
  const nach = bilder.filter((b) => b.ts >= t);
  expect.soft(nach.filter(scharf).length, '(h): scharfe Bilder des neuen Inhalts').toBe(0);
  await s.close();
});

// (i) Die Seite entfernt den Host der Kopie oder das Attribut am Video und springt dann: nichts Scharfes. Ohne Host ist das Video noch unsichtbar (Attribut), bis die Nachschau das
// Attribut nimmt, danach weichgezeichnet; ohne Attribut ist das Video weichgezeichnet (sein Urteil blieb verdeckt).
for (const art of ['Host', 'Attribut'] as const) {
  testA(`(i) die Seite entfernt ${art === 'Host' ? 'den Host der Kopie' : 'das Attribut am Video'} und springt: nichts Scharfes`, async () => {
    zeit(150_000);
    if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
    const { s, rec } = await kopieAufStandbild({ puls: true });
    const t = await s.evaluate((a) => {
      const v = document.getElementById('v1') as HTMLVideoElement;
      const t0 = (window as any).epoche() as number;
      if (a === 'Host') [...document.getElementById('platz')!.children].find((c) => c.localName === 'div' && c.id !== 'bedienung')!.remove();
      else v.removeAttribute('data-veil-kopie');
      v.currentTime = 3.5;
      return t0;
    }, art);
    await abwarten(2500);
    expect.soft(await attr(s, 'v1', 'data-veil'), `(i) ${art}: das Video ist nicht verdeckt`).toBe('verdeckt');
    expect.soft(await kopieDa(s), `(i) ${art}: die Kopie gilt noch`).toBe(false);
    expect.soft(await hostAnzahl(s), `(i) ${art}: ein Host ist uebrig`).toBe(0);
    expect.soft(await attr(s, 'v1', 'data-veil-kopie'), `(i) ${art}: das Attribut data-veil-kopie steht noch`).toBeNull();
    expect.soft(nieFrei(await plog(s), t)).toBe(0);
    const bilder = await rec.stoppe();
    const nach = bilder.filter((b) => b.ts >= t);
    console.log(`chromium: (i) ${art} Toleranz 0: ${nach.length} Bilder, scharf: ${nach.filter(scharf).length}`);
    expect.soft(nach.filter(scharf).length, `(i) ${art}: scharfe Bilder`).toBe(0);
    await s.close();
  });
}

// (j) Ein Video mit nativen controls bekommt in der Pause keine Kopie (sie deckte die Bedienleiste): es bleibt verdeckt, nie frei.
test('(j) Video mit nativen controls: in der Pause verdeckt, keine Kopie, nie frei', async () => {
  zeit(90_000);
  const st = await pausiereAufSauberemStandbild({ video: { controls: true } });
  await abwarten(8000);
  expect(await attr(st.s, 'v1', 'data-veil'), '(j): das Video mit controls ist nicht verdeckt').toBe('verdeckt');
  expect(await kopieDa(st.s), '(j): das Video mit controls bekam eine Kopie').toBe(false);
  expect(await hostAnzahl(st.s), '(j): ein Host steht').toBe(0);
  expect(nieFrei(await plog(st.s), st.tPause), '(j): frei in der Pause').toBe(0);
  await st.s.close();
});

// (k) Fuenf pausierte, saubere Videos: hoechstens vier Kopien je Dokument, das fuenfte bleibt verdeckt.
test('(k) fuenf pausierte saubere Videos: hoechstens vier Kopien, nie ein Video frei', async () => {
  zeit(150_000);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz('', 800, 2100);
  const ids = ['v1', 'v2', 'v3', 'v4', 'v5'];
  for (const id of ids) await neuesVideo(s, { id, ct0: 10.5 });
  for (const id of ids) await expect.poll(() => attr(s, id, 'data-veil'), { timeout: 40_000, intervals: [100], message: `Voraussetzung: ${id} wird verdeckt` }).toBe('verdeckt');
  for (const id of ids) {
    const p = await s.evaluate((i) => (window as any).pausiereBei(i, 12.5) as Promise<{ ct: number } | null>, id);
    expect(p, `${id} erreichte 12,5 s nicht`).not.toBeNull();
  }
  await abwarten(14_000);
  const kopien = [];
  for (const id of ids) if (await kopieDa(s, id)) kopien.push(id);
  console.log(`chromium: (k) Kopien nach 14 s: ${kopien.join(',')}`);
  expect(kopien.length, `(k): ${kopien.length} Kopien, erlaubt sind hoechstens vier`).toBeLessThanOrEqual(4);
  expect(kopien.length, '(k): weniger als vier Kopien von fuenf sauberen Videos').toBe(4);
  expect(await hostAnzahl(s), '(k): Zahl der Hosts weicht von der Zahl der Kopien ab').toBe(kopien.length);
  for (const id of ids) expect(await attr(s, id, 'data-veil'), `(k): ${id} nicht verdeckt`).toBe('verdeckt');
  const l = await plog(s);
  expect(nieFrei(l, 0), '(k): ein Video war frei').toBe(0);
  await s.close();
});

// (l) Aushaengen und Wiedereinhaengen mit Kopie: der Host der Kopie geht mit dem Video (binnen 400 ms), nach dem Wiedereinhaengen ist das Video verdeckt, keine verwaiste Kopie.
testA('(l) Aushaengen und Wiedereinhaengen mit Kopie: verdeckt, keine verwaiste Kopie, nie frei', async () => {
  zeit(120_000);
  const { s, tPause } = await kopieAufStandbild({ puls: true });
  await s.evaluate(() => {
    (window as any).__el = document.getElementById('v1');
    (window as any).__el.remove();
  });
  await abwarten(500);
  expect(await hostAnzahl(s), '(l): der Host der Kopie steht 500 ms nach dem Aushaengen noch').toBe(0);
  await s.evaluate(() => document.getElementById('platz')!.appendChild((window as any).__el));
  await abwarten(1500);
  expect(await attr(s, 'v1', 'data-veil'), '(l): das wieder eingehaengte Video ist nicht verdeckt').toBe('verdeckt');
  const kopie = await kopieDa(s);
  expect(await hostAnzahl(s), `(l): Hosts ${await hostAnzahl(s)} bei Kopie=${kopie}: eine verwaiste Kopie`).toBe(kopie ? 1 : 0);
  expect(await attr(s, 'v1', 'data-veil-kopie') !== null, '(l): Attribut und Kopie stimmen nicht ueberein').toBe(kopie);
  expect(nieFrei(await plog(s), tPause), '(l): frei nach dem Wiedereinhaengen').toBe(0);
  await s.close();
});

// P8 (Runde 3): ein Video nur mit Ton (videoWidth 0) zeigt sein Poster auch beim Abspielen. Reine Tonquelle: WAV-Blob als video-Element (Fixture neuesTonVideo), Poster mit Person und
// Waechter. Vor und waehrend des Abspielens nie frei, kein scharfes Bild (Toleranz null); Poster entfernt: frei wie ein Ton-Video ohne Poster.
testA('P8 Tonquelle mit Poster (Person mit Waechter): vor und waehrend des Abspielens nie frei, kein scharfes Poster; Poster entfernt: frei wie ohne Poster', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz('puls=1');
  const poster = await s.evaluate(() => (window as any).erzeugePoster() as Promise<string>);
  const rec = await starteAufnahme(s);
  await s.evaluate((p) => void (window as any).neuesTonVideo({ id: 'v1', poster: p }), poster);
  await expect.poll(() => s.evaluate(() => { const v = document.getElementById('v1') as HTMLVideoElement; return v.readyState >= 2 && v.getAttribute('data-veil') !== null; }), { timeout: 20_000, intervals: [50] }).toBe(true);
  expect(await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).videoWidth), 'Voraussetzung: reine Tonquelle (videoWidth 0)').toBe(0);
  await abwarten(2500);
  expect(await attr(s, 'v1', 'data-veil'), 'P8: das Ton-Video mit Poster ist vor dem Abspielen nicht verdeckt').toBe('verdeckt');
  const tPlay = await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    v.play().catch(() => {});
    return (window as any).epoche() as number;
  });
  await abwarten(3500);
  expect(await s.evaluate(() => !(document.getElementById('v1') as HTMLVideoElement).paused), 'Voraussetzung: das Ton-Video spielt').toBe(true);
  expect(await attr(s, 'v1', 'data-veil'), 'P8: das spielende Ton-Video mit Poster ist nicht verdeckt').toBe('verdeckt');
  const l = await plog(s);
  expect(nieFrei(l), 'P8: das Ton-Video mit Poster war frei').toBe(0);
  const bilder = await rec.stoppe();
  console.log(`chromium: P8 ${bilder.length} Bilder (vor und nach Play ${Math.round(tPlay % 100000)}), scharf: ${bilder.filter(scharf).length}`);
  expect(bilder.filter(scharf).length, 'P8: scharfe Bilder des Posters').toBe(0);
  const t = await s.evaluate(() => {
    document.getElementById('v1')!.removeAttribute('poster');
    return (window as any).epoche() as number;
  });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 10_000, intervals: [50], message: 'P8: nach dem Entfernen des Posters wurde das Ton-Video nie frei' }).toBe('frei');
  console.log(`chromium: P8 frei ${Math.round((await plog(s)).find((e) => e.was === 'data-veil' && e.v === 'frei' && e.t >= t)!.t - t)} ms nach dem Entfernen des Posters`);
  await s.close();
});

// h2 (P9): ein verdecktes, spielendes Video (Film kurz, Person ab 2 s, Anfang neutral): die Seite wechselt waehrend des Abspielens zweimal das poster. Ein Video, das schon gespielt hat und
// Bildmasse hat, wird davon nicht beruehrt: kein neues Erst-Urteil (data-veil verschwindet nie), kein frei vor drei sauberen Pruefungen in Folge (nicht in den ersten 800 ms), die Person
// (ab 2 s) steht nie scharf in der Aufnahme (Toleranz null, bis zur naechsten Freigabe auf dem normalen Weg). Vor P9 gab vergiss und ein neues Erst-Urteil sofort frei.
testA('h2 (P9) poster waehrend des Abspielens zweimal gewechselt: kein neues Erst-Urteil, kein frei vor der Hysterese, kein scharfes Bild der Person', async () => {
  zeit(150_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz('kurz=1&puls=1');
  const poster = await s.evaluate(() => (window as any).erzeugePoster() as Promise<string>);
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', ct0: 4.5 });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 30_000, intervals: [50], message: 'Voraussetzung: das Video wird beim Anlaufen verdeckt (Person)' }).toBe('verdeckt');
  const t = await s.evaluate(
    (pst) =>
      new Promise<number>((fertig) => {
        const v = document.getElementById('v1') as HTMLVideoElement;
        let hoch = false;
        let t0 = 0;
        let a = false;
        const schritt = () => {
          if (v.currentTime > 3) hoch = true;
          if (hoch && !a && v.currentTime >= 0.5 && v.currentTime < 1.2) {
            a = true;
            t0 = (window as any).epoche();
            v.setAttribute('poster', pst);
          }
          if (a && v.currentTime >= 0.8 && v.currentTime < 1.6) {
            v.setAttribute('poster', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            return fertig(t0);
          }
          requestAnimationFrame(schritt);
        };
        schritt();
      }),
    poster,
  );
  await wartePoll(async () => (await ct(s)) > 2.6 && (await ct(s)) < 5.5, 40_000);
  const l = await plog(s);
  expect(l.filter((e) => e.was === 'data-veil' && e.v === null && e.t >= t).length, 'h2: das Video bekam ein neues Erst-Urteil (data-veil verschwand)').toBe(0);
  expect(l.filter((e) => e.was === 'data-veil' && e.v === 'frei' && e.t >= t && e.t <= t + 800).length, 'h2: das Video war binnen 800 ms nach dem Postertausch frei (Hysterese umgangen)').toBe(0);
  const bilder = await rec.stoppe();
  const { fenster, wiederFreiNach } = bilderBisWiederFrei(bilder, l, t);
  console.log(`chromium: h2 Toleranz 0, wieder frei auf dem normalen Weg nach ${wiederFreiNach} ms, ${fenster.length} Bilder im Fenster`);
  expect(fenster.length, 'h2: zu wenige Bilder im Fenster').toBeGreaterThan(5);
  expect(fenster.filter(scharf).length, 'h2: scharfe Bilder').toBe(0);
  await s.close();
});

// h3 (P10): ein freies, gespieltes Video (Film ganz neutral, kurz, ohne Schleife) mit Poster (Person mit Waechter): ended, dann load(). Nach emptied ist das Urteil verfallen: das Video
// steht sofort nicht mehr frei, in der Aufnahme ist das Poster nie scharf (Toleranz null), es bleibt verdeckt (P1) und played ist wieder leer. Ohne Poster: nach load() erst ein neues
// Erst-Urteil (data-veil verschwindet), dann frei.
async function neutralesFreiesEnde(mitPoster: boolean) {
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz('kurz=1&neutral=1&puls=1');
  const poster = mitPoster ? await s.evaluate(() => (window as any).erzeugePoster() as Promise<string>) : null;
  await neuesVideo(s, { id: 'v1', preload: 'auto', loop: false, abspielen: false, ...(poster ? { poster } : {}) });
  await expect.poll(() => s.evaluate(() => { const v = document.getElementById('v1') as HTMLVideoElement; return v.readyState >= 2 && v.getAttribute('data-veil') !== null; }), { timeout: 30_000, intervals: [100] }).toBe(true);
  await s.evaluate(() => void (window as any).spiele('v1'));
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 20_000, intervals: [50], message: 'Voraussetzung: das gespielte Video wird frei' }).toBe('frei');
  await expect.poll(() => s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).ended), { timeout: 20_000, intervals: [100], message: 'Voraussetzung: das Video erreicht ended' }).toBe(true);
  expect(await attr(s, 'v1', 'data-veil'), 'Voraussetzung: das Video ist am Ende noch frei').toBe('frei');
  return s;
}

testA('h3 (P10) freies gespieltes Video mit Poster: ended, dann load(): sofort nicht mehr frei, kein scharfes Poster, verdeckt', async () => {
  zeit(150_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const s = await neutralesFreiesEnde(true);
  const rec = await starteAufnahme(s);
  const t = await s.evaluate(() => {
    const v = document.getElementById('v1') as HTMLVideoElement;
    v.load();
    return (window as any).epoche() as number;
  });
  await abwarten(3000);
  const l = await plog(s);
  expect(l.filter((e) => e.was === 'data-veil' && e.v === 'frei' && e.t >= t).length, 'h3: das Video war nach load() frei').toBe(0);
  expect(await attr(s, 'v1', 'data-veil'), 'h3: das Video mit Poster ist nach load() nicht verdeckt').toBe('verdeckt');
  expect(await s.evaluate(() => (document.getElementById('v1') as HTMLVideoElement).played.length), 'h3: played ist nach load() nicht leer').toBe(0);
  const bilder = await rec.stoppe();
  const nach = bilder.filter((b) => b.ts >= t);
  console.log(`chromium: h3 Toleranz 0: ${nach.length} Bilder ab load(), scharf: ${nach.filter(scharf).length}`);
  expect(nach.filter(scharf).length, 'h3: scharfe Bilder des Posters').toBe(0);
  await s.close();
});

test('h3 (P10) ohne Poster: nach load() erst ein neues Erst-Urteil (data-veil verschwindet), dann frei', async () => {
  zeit(150_000);
  const s = await neutralesFreiesEnde(false);
  const t = await s.evaluate(() => {
    (document.getElementById('v1') as HTMLVideoElement).load();
    return (window as any).epoche() as number;
  });
  await expect.poll(() => attr(s, 'v1', 'data-veil'), { timeout: 15_000, intervals: [50], message: 'h3: das Video wurde nach load() nie wieder frei' }).toBe('frei');
  const l = (await plog(s)).filter((e) => e.was === 'data-veil' && e.t >= t);
  const iNull = l.findIndex((e) => e.v === null);
  const iFrei = l.findIndex((e) => e.v === 'frei');
  console.log(`chromium: h3 ohne Poster: Folge nach load() ${JSON.stringify(l.map((e) => [Math.round(e.t - t), e.v]))}`);
  expect(iNull, 'h3: nach load() verschwand data-veil nicht (das alte Urteil blieb)').toBeGreaterThanOrEqual(0);
  expect(iFrei, 'h3: frei kam vor dem Verschwinden von data-veil').toBeGreaterThan(iNull);
  await s.close();
});

// ---------- Messauftrag zum Poster (Bestandspunkt des Pruefers, kein Produktcode von E3c) ----------
// Ein nie gespieltes Video mit poster-Attribut, dessen Poster die Person mit Waechter zeigt und dessen erstes Filmbild neutral ist. Das Erst-Urteil prueft das erste Filmbild (sauber:
// frei), gezeigt wurde aber das Poster, das nirgends geprueft wird. Seit E3d (Regel P) bleibt ein Video, das sein Poster zeigt, verdeckt: nie ein scharfes Poster, nie frei, Toleranz null.
testA('P-Poster (Waechter) nie gespieltes Video mit Poster (Person mit Waechter), erstes Filmbild neutral: das Poster ist nie scharf zu sehen', async () => {
  zeit(90_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  await setze({ video: 'ganz' });
  const s = await oeffnePlatz();
  const poster = await s.evaluate(() => (window as any).erzeugePoster() as Promise<string>);
  const rec = await starteAufnahme(s);
  await neuesVideo(s, { id: 'v1', preload: 'auto', abspielen: false, poster });
  await abwarten(7000);
  const urteil = await attr(s, 'v1', 'data-veil');
  const l = await plog(s);
  const bilder = await rec.stoppe();
  const scharfe = bilder.filter(scharf);
  console.log(`chromium: P-Poster Urteil ${urteil}, Wechsel ${JSON.stringify(l.filter((e) => e.was === 'data-veil').map((e) => [Math.round(e.t % 100000), e.v]))}, ${bilder.length} Bilder, scharf: ${scharfe.length}`);
  expect.soft(scharfe.length, `P-Poster: ${scharfe.length} von ${bilder.length} Bildern zeigen das Poster scharf (Urteil ${urteil})`).toBe(0);
  expect.soft(urteil, 'P-Poster: das Urteil ist nicht verdeckt').toBe('verdeckt');
  expect.soft(nieFrei(l), 'P-Poster: das Video war frei').toBe(0);
  await s.close();
});

// ====================================================================================================================================================
// E3b: vereinigte Flaeche (Entscheidung 255), Huellen in der Leinwand, "ganz" im Stil des Presets. Szenen aus echten Testbildern (Erkenner echt), gelesen ueber den
// Testhaken data-veil-video-boxen (boxen = gezeigte Kanten je Spur, flaechen = wirklich gemalte Rechtecke, in CSS-Pixeln des Fensters; das Video liegt bei 0, 0 mit 640 mal 360).
// ====================================================================================================================================================

const ALLE_ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
function zonenNur(an: string[]): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ALLE_ZONEN) z[n] = BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) };
  return z;
}
const SCHWELLE = 0.6;
const VB = 640;
const VH = 360;

interface Probe {
  t: number;
  ct: number;
  veil: string | null;
  modus: string | null;
  ansicht: string;
  grund: string | null;
  boxen: number[][];
  flaechen: number[][];
  arten: string[];
}
// Rechtecke [x, y, w, h] auf das Video (0, 0, 640, 360) zugeschnitten.
const zuschnitt = (b: number[]): number[] => {
  const x0 = Math.max(0, b[0]!);
  const y0 = Math.max(0, b[1]!);
  const x1 = Math.min(VB, b[0]! + b[2]!);
  const y1 = Math.min(VH, b[1]! + b[3]!);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
};
function flaecheSumme(boxen: number[][]): number {
  return boxen.reduce((a, b) => a + zuschnitt(b)[2]! * zuschnitt(b)[3]!, 0) / (VB * VH);
}
function flaecheVereint(boxen: number[][]): number {
  const g = new Uint8Array(VB * VH);
  for (const b of boxen) {
    const [x, y, w, h] = zuschnitt(b) as [number, number, number, number];
    for (let j = Math.floor(y); j < Math.ceil(y + h); j++) for (let i = Math.floor(x); i < Math.ceil(x + w); i++) g[j * VB + i] = 1;
  }
  let n = 0;
  for (const v of g) n += v;
  return n / (VB * VH);
}
const schneidet = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
// Zahl der Gruppen sich (auch ueber Ketten) schneidender Rechtecke.
function gruppenZahl(boxen: number[][]): number {
  const el = boxen.map((_, i) => i);
  const w = (i: number): number => (el[i] === i ? i : (el[i] = w(el[i]!)));
  for (let i = 0; i < boxen.length; i++) for (let j = i + 1; j < boxen.length; j++) if (schneidet(boxen[i]!, boxen[j]!)) el[w(i)] = w(j);
  return new Set(boxen.map((_, i) => w(i))).size;
}
// Der Waechter (32 mal 32) im Film mit dem Testbild: linke Kante des Bilds bei 2 bis 5 s (und 2 bis 6 s im kurzen Film) ist B/4 - Bildbreite/2, Waechter bei 0,5 und 0,55 des Bilds.
const waechterRechteck = (bildBreite: number): number[] => [Math.round(VB / 4 - bildBreite / 2) + 0.5 * bildBreite - 16, Math.round(0.55 * VH) - 16, 32, 32];
const liegtIn = (r: number[], boxen: number[][]) => boxen.some((b) => r[0]! >= b[0]! && r[1]! >= b[1]! && r[0]! + r[2]! <= b[0]! + b[2]! && r[1]! + r[3]! <= b[1]! + b[3]!);

interface SzeneErgebnis {
  proben: Probe[];
  bilder: Bild[];
  log: PlatzEintrag[];
  verstoss: Verstoss[];
}
const szenen = new Map<string, Promise<SzeneErgebnis>>();
// Spielt das Testbild `bild` (kurzer Film: 2 bis 6 s Person) mit dem Preset ab 2,2 s, liest den Haken alle 80 ms bis 5,6 s und nimmt jedes Bild auf.
type SzenenDef = readonly [string, string, string, readonly string[], number];
function holeSzene(satz: string, bild: string, preset: string, an: readonly string[], rand: number): Promise<SzeneErgebnis> {
  const schluessel = JSON.stringify([satz, bild, preset, an, rand]);
  let p = szenen.get(schluessel);
  if (!p) {
    p = (async () => {
      await setze({ preset, zonen: zonenNur([...an]), rand, schwelle: 0.1, pause: false, video: 'zonen' });
      const s = await oeffnePlatz(`satz=${satz}&kurz=1`, 800, 800, bild);
      const rec = await starteAufnahme(s);
      await neuesVideo(s, { id: 'v1', ct0: 2.2 });
      const proben: Probe[] = [];
      const t0 = Date.now();
      for (;;) {
        const r = await s.evaluate(() => {
          const e = document.getElementById('v1') as HTMLVideoElement;
          return { t: (window as any).epoche() as number, ct: e.currentTime, veil: e.getAttribute('data-veil'), modus: e.getAttribute('data-veil-video-modus'), roh: e.getAttribute('data-veil-video-boxen') };
        });
        if (r.roh) {
          const b = JSON.parse(r.roh) as { ansicht: string; grund: string | null; boxen: number[][]; flaechen: number[][]; arten: string[] };
          proben.push({ t: r.t, ct: r.ct, veil: r.veil, modus: r.modus, ansicht: b.ansicht, grund: b.grund, boxen: b.boxen, flaechen: b.flaechen, arten: b.arten });
        }
        if (r.ct >= 5.6 || Date.now() - t0 > 25_000) break;
        await abwarten(80);
      }
      const bilder = await rec.stoppe();
      const log = await plog(s);
      const verstoss = await verstoesse(s);
      await s.close();
      return { proben, bilder, log, verstoss };
    })();
    szenen.set(schluessel, p);
  }
  return p;
}
const zaehle = (proben: Probe[]) => {
  const m = new Map<string, number>();
  for (const p of proben) {
    const k = `${p.ansicht}/${p.grund ?? '-'}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return JSON.stringify([...m.entries()]);
};

const F2_SCENE = ['sfw', 'sfw-001-portraet.jpg', 'mosaik', ALLE_ZONEN, 0.5] as const; // Summe 0,78 bis 0,81, vereinigt 0,53 bis 0,54 (gemessen am Stand 9408eaa)
const F3_SZENEN: SzenenDef[] = [
  ['sfw', 'sfw-005-portraet.jpg', 'mosaik', ALLE_ZONEN, 0.5], // eine Spur, Anteil 0,73
  ['nsfw', 'IMG_8501.JPG', 'mosaik', ALLE_ZONEN, 1.0], // sechs Spuren, Summe 0,8, vereinigt 0,62 bis 0,65
] ;

testA('F2 Voraussetzung: zwei bis drei stark ueberlappende Zonen, Summe ueber 60 Prozent, vereinigte Flaeche darunter, der Waechter liegt in einer erkannten Zone', async () => {
  zeit(120_000);
  const e = await holeSzene(...F2_SCENE);
  const mitBoxen = e.proben.filter((p) => p.boxen.length >= 2);
  expect(mitBoxen.length, `zu wenige Proben mit mehreren Spuren (${zaehle(e.proben)})`).toBeGreaterThanOrEqual(8);
  const passend = mitBoxen.filter((p) => flaecheSumme(p.boxen) > SCHWELLE + 0.05 && flaecheVereint(p.boxen) < SCHWELLE - 0.03);
  expect(passend.length, `zu wenige Proben mit Summe ueber und Vereinigung unter 60 Prozent: ${JSON.stringify(mitBoxen.slice(0, 6).map((p) => [Math.round(flaecheSumme(p.boxen) * 100), Math.round(flaecheVereint(p.boxen) * 100)]))}`).toBeGreaterThanOrEqual(8);
  const w = waechterRechteck(Math.round((1280 * VH) / 800));
  expect(passend.filter((p) => liegtIn(w, p.boxen)).length, `der Waechter ${JSON.stringify(w)} liegt nicht in den erkannten Zonen: ${JSON.stringify(passend[0]!.boxen)}`).toBeGreaterThanOrEqual(5);
});

testA('F2 Summe ueber 60 Prozent, vereinigte Flaeche darunter: die Leinwand zeigt Zonen statt "ganz"; jede erkannte Stelle ist verdeckt', async () => {
  zeit(120_000);
  const e = await holeSzene(...F2_SCENE);
  const passend = e.proben.filter((p) => p.boxen.length >= 2 && flaecheSumme(p.boxen) > SCHWELLE + 0.05 && flaecheVereint(p.boxen) < SCHWELLE - 0.03);
  const zonen = passend.filter((p) => p.ansicht === 'zonen' && p.modus === 'zonen');
  expect.soft(zonen.length, `F2: in ${passend.length} Proben mit Summe ueber und Vereinigung unter 60 Prozent nie die Ansicht Zonen (Ansichten und Gruende aller Proben: ${zaehle(e.proben)})`).toBeGreaterThanOrEqual(3);
  // jede erkannte Stelle ist verdeckt: im Zonen-Zustand liegt die Mitte jeder Spur in einer gemalten Flaeche
  for (const p of zonen) {
    for (const b of p.boxen) {
      const mx = b[0]! + b[2]! / 2;
      const my = b[1]! + b[3]! / 2;
      const gedeckt = p.flaechen.some((f) => mx >= f[0]! && mx <= f[0]! + f[2]! && my >= f[1]! && my <= f[1]! + f[3]!);
      expect.soft(gedeckt, `F2/I5: Spur ${JSON.stringify(b)} nicht von einer Flaeche gedeckt (${JSON.stringify(p.flaechen)})`).toBe(true);
    }
  }
  const tz = zensurBeginn(e.log);
  keineScharfen(e.bilder, tz, 'F2');
  expect.soft(unerlaubt(e.verstoss, ['v1'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), `F2: Verstoss ${zeigeVerstoesse(e.verstoss)}`).toEqual([]);
});

testA('F3 (Waechter) vereinigte Flaeche ueber 60 Prozent bleibt "ganz" (Mosaik), nie ein Bild mit Zonen bei grosser Flaeche, nie scharf', async () => {
  zeit(180_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  for (const sz of F3_SZENEN) {
    const e = await holeSzene(...sz);
    const gross = e.proben.filter((p) => p.boxen.length >= 1 && flaecheVereint(p.boxen) >= SCHWELLE + 0.01);
    expect(gross.length, `${sz[1]}: zu wenige Proben mit vereinigter Flaeche ueber 60 Prozent (${zaehle(e.proben)})`).toBeGreaterThanOrEqual(8);
    const verkehrt = gross.filter((p) => p.ansicht === 'zonen' || p.modus === 'zonen');
    expect(verkehrt.length, `${sz[1]}: ${verkehrt.length} Proben mit Zonen trotz vereinigter Flaeche ueber 60 Prozent`).toBe(0);
    keineScharfen(e.bilder, zensurBeginn(e.log), `F3 ${sz[1]}`);
    expect.soft(unerlaubt(e.verstoss, ['v1'], ['zensiert-ohne-leinwand', 'leinwand-sichtbar']), `F3: Verstoss ${zeigeVerstoesse(e.verstoss)}`).toEqual([]);
  }
});

const F4_SCENE = ['sfw', 'sfw-001-portraet.jpg', 'mosaik', ALLE_ZONEN, 0.15] as const; // drei Spuren, davon zwei sich schneidend (Summe 0,46, vereinigt 0,41)

testA('F4 Voraussetzung: die Szene liefert im Zonen-Zustand mehrere Spuren, von denen sich mindestens zwei schneiden, heute je Spur eine gemalte Flaeche', async () => {
  zeit(120_000);
  const e = await holeSzene(...F4_SCENE);
  const zonen = e.proben.filter((p) => p.ansicht === 'zonen' && p.boxen.length >= 2);
  expect(zonen.length, `zu wenige Proben im Zonen-Zustand (${zaehle(e.proben)})`).toBeGreaterThanOrEqual(8);
  const schnitt = zonen.filter((p) => gruppenZahl(p.boxen) < p.boxen.length);
  expect(schnitt.length, `zu wenige Proben mit sich schneidenden Spuren: ${JSON.stringify(zonen.slice(0, 4).map((p) => p.boxen))}`).toBeGreaterThanOrEqual(6);
});

testA('F4 (O1 im Video) zwei sich schneidende gleichrangige Spuren werden als eine Huelle gemalt: weniger Flaechen als Spuren, jede Spur gedeckt', async () => {
  zeit(120_000);
  const e = await holeSzene(...F4_SCENE);
  const schnitt = e.proben.filter((p) => p.ansicht === 'zonen' && p.boxen.length >= 2 && gruppenZahl(p.boxen) < p.boxen.length && p.flaechen.length > 0);
  const huellen = schnitt.filter((p) => p.flaechen.length <= gruppenZahl(p.boxen));
  expect.soft(huellen.length, `F4: in ${schnitt.length} Proben mit sich schneidenden Spuren nie eine Flaeche je Gruppe (Spuren ${schnitt[0]?.boxen.length}, Gruppen ${schnitt[0] ? gruppenZahl(schnitt[0].boxen) : '-'}, gemalte Flaechen ${schnitt[0]?.flaechen.length})`).toBe(schnitt.length);
  for (const p of schnitt) {
    for (const b of p.boxen) {
      const mx = b[0]! + b[2]! / 2;
      const my = b[1]! + b[3]! / 2;
      expect.soft(p.flaechen.some((f) => mx >= f[0]! && mx <= f[0]! + f[2]! && my >= f[1]! && my <= f[1]! + f[3]!), `F4: Spur ${JSON.stringify(b)} nicht gedeckt`).toBe(true);
    }
  }
  keineScharfen(e.bilder, zensurBeginn(e.log), 'F4');
});

testA('F5 (Waechter) die Zahl der gemalten Flaechen wechselt hoechstens zweimal je Sekunde (kein Flackern der Huellen bei Spuren, die sich um einen Bildpunkt schneiden und trennen)', async () => {
  zeit(120_000);
  const e = await holeSzene(...F4_SCENE);
  // Nur Proben im Zonen-Zustand; Wechsel der Zahl gemalter Flaechen zwischen aufeinanderfolgenden Proben.
  const folge = e.proben.filter((p) => p.ansicht === 'zonen' && p.flaechen.length > 0);
  expect(folge.length, `zu wenige Proben im Zonen-Zustand (${zaehle(e.proben)})`).toBeGreaterThanOrEqual(8);
  const wechsel: number[] = [];
  for (let i = 1; i < folge.length; i++) if (folge[i]!.flaechen.length !== folge[i - 1]!.flaechen.length) wechsel.push(folge[i]!.t);
  const jeS = Math.max(0, ...wechsel.map((t) => wechsel.filter((u) => u >= t && u < t + 1000).length));
  expect(jeS, `Wechsel der Zahl gemalter Flaechen in einer Sekunde: ${jeS} (Zeitpunkte ${JSON.stringify(wechsel.map((t) => Math.round(t % 100000)))})`).toBeLessThanOrEqual(2);
});

// F7 (Vorschlag des Pruefers, E3b), T3: belegt ehrlich nur: (1) jede Spurmitte liegt in einer gemalten Flaeche, (2) gemalte Flaechen schneiden sich nie (hoechstens 2 Pixel Rundung),
// (3) hoechstens 2 Wechsel der Flaechenzahl je Sekunde. Ob in einem Lauf eine Huelle entsteht, haengt von den grenzwertigen Spuren ab; der Lauf meldet es im Protokoll ("mit Huelle"),
// die PFLICHT zur Huelle liegt bei F4. die Szene von P4 (Koerper aus _DSC6278.JPG, alle bedeckbaren Zonen) bei der Standard-Schwelle 0,1. Dort kommen und gehen grenzwertige
// Spuren zwischen den beiden echten (Sonde P4, MESSUNG-PHASE-11-E3.md). Erwartet: nie zwei gemalte Flaechen, die sich schneiden (gleichrangig: jede Gruppe eine Huelle),
// nie ein Bild, in dem eine Spur nicht von einer gemalten Flaeche gedeckt ist, und hoechstens 2 Wechsel der Zahl gemalter Flaechen je Sekunde.
const F7_SZENE = ['nsfw', '_DSC6278.JPG', 'mosaik-wort', BEDECKBAR, 0.15] as const;
testA('F7 Schwelle 0,1 an der Szene von P4: jede Spurmitte liegt in einer gemalten Flaeche; entsteht eine Huelle, dann ohne Ueberschneidung und mit hoechstens 2 Wechseln der Flaechenzahl je Sekunde', async () => {
  zeit(150_000);
  const e = await holeSzene(...F7_SZENE);
  const folge = e.proben.filter((p) => p.ansicht === 'zonen' && p.flaechen.length > 0);
  expect(folge.length, `zu wenige Proben im Zonen-Zustand (${zaehle(e.proben)})`).toBeGreaterThanOrEqual(8);
  const mitHuelle = folge.filter((p) => p.boxen.length > p.flaechen.length).length;
  console.log(`chromium: F7 Huelle in diesem Lauf: ${mitHuelle > 0 ? 'ja' : 'nein'}; ${folge.length} Proben im Zonen-Zustand, davon ${mitHuelle} mit mehr Spuren als gemalten Flaechen (Huelle), Flaechenzahlen ${JSON.stringify([...new Set(folge.map((p) => p.flaechen.length))])}`);
  const tief = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! - 2 && b[0]! < a[0]! + a[2]! - 2 && a[1]! < b[1]! + b[3]! - 2 && b[1]! < a[1]! + a[3]! - 2;
  for (const p of folge) {
    for (let i = 0; i < p.flaechen.length; i++) for (let j = i + 1; j < p.flaechen.length; j++) expect.soft(tief(p.flaechen[i]!, p.flaechen[j]!), `F7: zwei gemalte Flaechen schneiden sich: ${JSON.stringify([p.flaechen[i], p.flaechen[j]])}`).toBe(false);
    for (const b of p.boxen) {
      const mx = b[0]! + b[2]! / 2;
      const my = b[1]! + b[3]! / 2;
      expect.soft(p.flaechen.some((f) => mx >= f[0]! && mx <= f[0]! + f[2]! && my >= f[1]! && my <= f[1]! + f[3]!), `F7: Spur ${JSON.stringify(b)} nicht gedeckt`).toBe(true);
    }
  }
  const wechsel: number[] = [];
  for (let i = 1; i < folge.length; i++) if (folge[i]!.flaechen.length !== folge[i - 1]!.flaechen.length) wechsel.push(folge[i]!.t);
  const jeS = Math.max(0, ...wechsel.map((t) => wechsel.filter((u) => u >= t && u < t + 1000).length));
  expect(jeS, `F7: Wechsel der Flaechenzahl in einer Sekunde: ${jeS} (Zeitpunkte ${JSON.stringify(wechsel.map((t) => Math.round(t % 100000)))})`).toBeLessThanOrEqual(2);
  // Der Waechter (Schachbrett) liegt in dieser Szene nur in manchen Proben in einer gemalten Flaeche (die Szene ist nach P4 gewaehlt, nicht nach dem Waechter): scharf darf er
  // nur sein, wo keine gemalte Flaeche ihn deckt. Gezaehlt wird die Deckung je Probe; ist er in allen Proben gedeckt, gilt wie bei F2 und F4: kein scharfes Bild.
  const w = waechterRechteck(Math.round((VH * 4672) / 7008));
  const gedeckt = folge.filter((p) => liegtIn(w, p.flaechen)).length;
  console.log(`chromium: F7 Waechter ${JSON.stringify(w)} in einer gemalten Flaeche in ${gedeckt} von ${folge.length} Proben`);
  if (gedeckt === folge.length) keineScharfen(e.bilder, zensurBeginn(e.log), 'F7');
});

// ---------- F6: "ganz" im Stil des Presets ----------

const nahSchwarz = (r: number, g: number, b: number) => r < 40 && g < 40 && b < 40;
// Anteil fast schwarzer Bildpunkte im Video (ohne die untere Leiste mit dem Knopf Play) in einer Aufnahme, in der die Leinwand "ganz" zeigt.
async function messeGanzSchwarz(preset: string): Promise<{ schwarz: number; ansicht: string }> {
  await setze({ preset, zonen: zonenNur(['face', 'head']), rand: 0.15, schwelle: 0.1, pause: false, video: 'zonen' });
  const s = await oeffnePlatz('satz=sfw&kurz=1', 800, 800, 'sfw-002-portraet.jpg'); // eine Spur mit Anteil 0,68: dauerhaft "ganz" (Grund anteil)
  await neuesVideo(s, { id: 'v1', ct0: 2.2 });
  let ergebnis: { schwarz: number; ansicht: string } | null = null;
  const t0 = Date.now();
  while (!ergebnis && Date.now() - t0 < 30_000) {
    const lies = () =>
      s.evaluate(() => {
        const e = document.getElementById('v1') as HTMLVideoElement;
        const roh = e.getAttribute('data-veil-video-boxen');
        return { ct: e.currentTime, veil: e.getAttribute('data-veil'), b: roh ? (JSON.parse(roh) as { ansicht: string; grund: string | null }) : null };
      });
    const vor = await lies();
    if (vor.veil === 'zensiert' && vor.b?.ansicht === 'ganz' && vor.b.grund === 'anteil' && vor.ct > 2.8 && vor.ct < 5.4) {
      const png = await s.screenshot({ type: 'png' });
      const nach = await lies();
      if (nach.b?.ansicht === 'ganz' && nach.b.grund === 'anteil' && nach.ct < 5.6) {
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let n = 0;
        let k = 0;
        for (let y = 0; y < 315; y++) {
          for (let x = 0; x < VB; x++) {
            const i = (y * info.width + x) * info.channels;
            n++;
            if (nahSchwarz(data[i]!, data[i + 1]!, data[i + 2]!)) k++;
          }
        }
        ergebnis = { schwarz: k / n, ansicht: 'ganz' };
      }
    }
    await abwarten(60);
  }
  await s.close();
  expect(ergebnis, 'die Leinwand zeigte nie "ganz" mit Grund anteil in einer Aufnahme (Szene sfw-002 mit Gesicht und Kopf)').not.toBeNull();
  return ergebnis!;
}

testA('F6 Voraussetzung: mit dem Preset Mosaik ist "ganz" bunt (kaum schwarze Bildpunkte)', async () => {
  zeit(120_000);
  const m = await messeGanzSchwarz('mosaik');
  expect(m.schwarz, `Mosaik: Anteil schwarz ${m.schwarz}`).toBeLessThan(0.3);
});

testA('F6 "ganz" in der Leinwand folgt dem Stil des Presets: mit Zensurbalken ist das ganze Bild schwarz, nicht Mosaik', async () => {
  zeit(120_000);
  const m = await messeGanzSchwarz('zensurbalken');
  expect.soft(m.schwarz, `F6: Anteil schwarzer Bildpunkte in "ganz" bei Zensurbalken: ${m.schwarz.toFixed(2)} (Mosaik: bunt)`).toBeGreaterThanOrEqual(0.85);
});

testA('F6 "ganz" mit dem Preset Weichzeichner ist weichgezeichnet (keine Kante, kein scharfer Waechter), nicht Mosaik und nicht scharf', async () => {
  zeit(120_000);
  if (!OHNE_KENNZEICHNUNG) expect(messungBelegt, 'Gegenprobe der Messung fehlt').toBe(true);
  const m = await messeGanzGlatt('blur');
  expect.soft(m.waechterScharf, 'F6: das Waechter-Schachbrett ist im weichgezeichneten "ganz" noch scharf zu erkennen').toBe(false);
  expect.soft(m.kante, `F6: mittlerer Helligkeitsunterschied benachbarter Bildpunkte in "ganz" bei Blur: ${m.kante.toFixed(2)} (Mosaik hat harte Blockkanten, ein scharfes Bild hohe Werte)`).toBeLessThan(1.5);
});

async function messeGanzGlatt(preset: string): Promise<{ kante: number; waechterScharf: boolean }> {
  await setze({ preset, zonen: zonenNur(['face', 'head']), rand: 0.15, schwelle: 0.1, pause: false, video: 'zonen' });
  const s = await oeffnePlatz('satz=sfw&kurz=1', 800, 800, 'sfw-002-portraet.jpg');
  await neuesVideo(s, { id: 'v1', ct0: 2.2 });
  let ergebnis: { kante: number; waechterScharf: boolean } | null = null;
  const t0 = Date.now();
  while (!ergebnis && Date.now() - t0 < 30_000) {
    const lies = () =>
      s.evaluate(() => {
        const e = document.getElementById('v1') as HTMLVideoElement;
        const roh = e.getAttribute('data-veil-video-boxen');
        return { ct: e.currentTime, veil: e.getAttribute('data-veil'), b: roh ? (JSON.parse(roh) as { ansicht: string; grund: string | null }) : null };
      });
    const vor = await lies();
    if (vor.veil === 'zensiert' && vor.b?.ansicht === 'ganz' && vor.b.grund === 'anteil' && vor.ct > 2.8 && vor.ct < 5.4) {
      const png = await s.screenshot({ type: 'png' });
      const nach = await lies();
      if (nach.b?.ansicht === 'ganz' && nach.b.grund === 'anteil' && nach.ct < 5.6) {
        const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
        let summe = 0;
        let n = 0;
        for (let y = 0; y < 315; y++) for (let x = 0; x < VB - 1; x++) { summe += Math.abs(data[y * info.width + x]! - data[y * info.width + x + 1]!); n++; }
        // T2 (Pruefung M2): das Waechter-Schachbrett (4 Pixel Felder, Magenta und Gruen) ist im weichgezeichneten Bild nicht mehr zu erkennen (Gegenprobe der Messung: erster Fall der Datei)
        ergebnis = { kante: summe / n, waechterScharf: scharf((await messeBild(png)) as Bild) };
      }
    }
    await abwarten(60);
  }
  await s.close();
  expect(ergebnis, 'die Leinwand zeigte nie "ganz" mit Grund anteil in einer Aufnahme').not.toBeNull();
  return ergebnis!;
}
