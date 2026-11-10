import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Laufende Nachpruefung von Videos (PHASE-2-BAUPLAN 10.1, Punkt 9). Die Fixture video-lauf.html nimmt zur Laufzeit ein Video auf:
// neutral 0 bis 3 s, Testbild (Satz nsfw) 3 bis 6 s, neutral 6 bis 10 s, als blob: mit loop. Ohne Testbilder: laut uebersprungen.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
// Testbild, das der Erkenner mit den Standard-Zonen sicher trifft (belegt durch die Positivkontrolle unten).
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

interface Status {
  gesamt: number;
  offen: number;
  frei: number;
  zensiert: number;
  verdeckt: number;
  videoPruefungen: number;
  videoWechsel: number;
}

interface Wechsel {
  t: number;
  id: string;
  v: string | null;
  ct: number;
}

let profil: string;
let context: BrowserContext;
let worker: Worker;
let bilderDa = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const antwort = await fetch(`${basis}/api/testbilder?satz=nsfw`);
  const liste = ((await antwort.json()) as { bilder: string[] }).bilder;
  bilderDa = liste.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  profil = await mkdtemp(path.join(tmpdir(), 'veil-video-'));
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
    // Diese Faelle pruefen das Verhalten "ganzes Video" (Blur, Hysterese, Takt); die Zonen-Leinwand hat eigene Faelle (video-zonen.spec.ts).
    await (globalThis as any).chrome.storage.local.set({ einstellungen: { video: 'ganz' } });
  });
});

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

async function status(seite: Page): Promise<Status | null> {
  return seite.evaluate(() => {
    const roh = document.documentElement.dataset.veilStatus;
    return roh ? (JSON.parse(roh) as Status) : null;
  });
}

const pruefungen = async (seite: Page) => (await status(seite))?.videoPruefungen ?? 0;
const wechsel = (seite: Page, id: string): Promise<Wechsel[]> =>
  seite.evaluate((i) => ((window as any).__wechsel as Wechsel[]).filter((w) => w.id === i), id);
const urteil = (seite: Page, id: string) => seite.evaluate((i) => document.getElementById(i)?.getAttribute('data-veil') ?? '', id);
const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Seite mit der Fixture; wartet, bis das Video aufgenommen (beim ersten Mal 10 s) oder aus dem Speicher geholt ist.
async function oeffne(modus = ''): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(`${basis}/video-lauf.html?bild=${encodeURIComponent(BILD)}${modus ? `&modus=${modus}` : ''}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 40_000, intervals: [200] }).toBe('1');
  return seite;
}

const neuesVideo = (seite: Page, opt: Record<string, unknown>) => seite.evaluate((o) => void (window as any).neuesVideo(o), opt);

async function waechterOk(seite: Page) {
  const w = await seite.evaluate(() => ({ aufblitzen: (window as any).__aufblitzen as number, unsichtbar: (window as any).__unsichtbar as number, wer: (window as any).__wer as string[] }));
  expect(w.aufblitzen, JSON.stringify(w.wer)).toBe(0);
  expect(w.unsichtbar, JSON.stringify(w.wer)).toBe(0);
}

let verlaufA: Wechsel[] = [];
let rateA = 0;

test('Positivkontrolle: dasselbe Testbild als img wird zensiert', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/video-lauf.html?bild=${encodeURIComponent(BILD)}`);
  await seite.evaluate((b) => {
    const i = document.createElement('img');
    i.id = 'kontrolle';
    i.style.width = '240px';
    i.src = `/testbild/nsfw/${encodeURIComponent(b)}`;
    document.getElementById('platz')!.appendChild(i);
  }, BILD);
  await expect.poll(() => urteil(seite, 'kontrolle'), { timeout: 30_000 }).toBe('zensiert');
  await seite.close();
});

test('a) beginnt frei, wird im Treffer-Abschnitt verdeckt (spaetestens 1,5 s nach dessen Beginn) und danach wieder frei', async () => {
  test.setTimeout(150_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'v1', autoplay: true });
  const folge = async () => {
    const eintraege = (await wechsel(seite, 'v1')).filter((w) => w.v !== null);
    return eintraege.slice(0, 3).map((w) => w.v).join(',');
  };
  await expect.poll(folge, { timeout: 40_000, intervals: [200] }).toBe('frei,verdeckt,frei');
  // Weitere 10 s im Takt laufen lassen: Pruefungen je Sekunde (c) und weitere Wechsel (b).
  const p0 = await pruefungen(seite);
  const t0 = Date.now();
  await abwarten(10_000);
  const p1 = await pruefungen(seite);
  rateA = (p1 - p0) / ((Date.now() - t0) / 1000);
  verlaufA = await wechsel(seite, 'v1');
  const erstes = verlaufA.filter((w) => w.v !== null);
  const bisVerdeckt = erstes[1]!.ct - 3;
  console.log(`chromium: Zeit bis verdeckt ${bisVerdeckt.toFixed(2)} s nach Beginn des Treffer-Abschnitts (Abspielposition ${erstes[1]!.ct.toFixed(2)} s), wieder frei bei ${erstes[2]!.ct.toFixed(2)} s`);
  expect(erstes[1]!.ct).toBeGreaterThanOrEqual(2.9);
  expect(bisVerdeckt).toBeLessThanOrEqual(1.5);
  await waechterOk(seite);
  await seite.close();
});

// Auswertung der Urteilsfolge eines Videos: Abstand jeder Freigabe zum vorigen Wechsel (Verdecken ist nie gebremst) und zwischen zwei Freigaben.
function freigabeAbstaende(eintraege: Wechsel[]) {
  const liste = eintraege.filter((w) => w.v !== null);
  let nachWechsel = Number.POSITIVE_INFINITY;
  let zwischenFreigaben = Number.POSITIVE_INFINITY;
  let letzteFreigabe: number | null = null;
  for (let i = 0; i < liste.length; i++) {
    if (liste[i]!.v !== 'frei') continue;
    if (i > 0) nachWechsel = Math.min(nachWechsel, liste[i]!.t - liste[i - 1]!.t);
    if (letzteFreigabe !== null) zwischenFreigaben = Math.min(zwischenFreigaben, liste[i]!.t - letzteFreigabe);
    letzteFreigabe = liste[i]!.t;
  }
  return { nachWechsel, zwischenFreigaben };
}

test('b) Freigaben desselben Videos nie unter 1000 ms nach dem vorigen Wechsel', async () => {
  const eintraege = verlaufA.filter((w) => w.v !== null);
  expect(eintraege.length).toBeGreaterThanOrEqual(3);
  const { nachWechsel } = freigabeAbstaende(verlaufA);
  console.log(`chromium: ${eintraege.length - 1} Wechsel, kleinster Abstand einer Freigabe zum vorigen Wechsel ${nachWechsel.toFixed(0)} ms`);
  expect(nachWechsel).toBeGreaterThanOrEqual(999); // 1 ms Spielraum fuer Zeitstempel der Seite (Sperre im Code 1000 ms)
});

test('c) Pruefungen je Sekunde und Video im Mittel ueber 10 s hoechstens 1,1', async () => {
  console.log(`chromium: ${rateA.toFixed(2)} Pruefungen je Sekunde bei einem Video`);
  expect(rateA).toBeGreaterThan(0.5); // es wird wirklich laufend geprueft
  expect(rateA).toBeLessThanOrEqual(1.1);
});

test('d) pausiertes Video: keine Pruefungen; seeked im Stand auf den Treffer-Abschnitt verdeckt', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'p1', abspielen: false });
  await expect.poll(() => urteil(seite, 'p1'), { timeout: 30_000 }).toBe('frei');
  await abwarten(500);
  const p0 = await pruefungen(seite);
  await abwarten(3500);
  expect(await pruefungen(seite)).toBe(p0);
  expect(await seite.evaluate(() => (document.getElementById('p1') as HTMLVideoElement).paused)).toBe(true);
  const t0 = Date.now();
  const position = await seite.evaluate(() => (window as any).treffersuche(document.getElementById('p1')));
  expect(position, 'Sprung auf ein Bild des Treffer-Abschnitts').not.toBeNull();
  await expect.poll(() => urteil(seite, 'p1'), { timeout: 10_000 }).toBe('verdeckt');
  console.log(`chromium: seeked auf den Treffer-Abschnitt, verdeckt nach ${Date.now() - t0} ms`);
  // Weiter keine laufenden Pruefungen im Stand.
  const p2 = await pruefungen(seite);
  await abwarten(2500);
  expect(await pruefungen(seite)).toBe(p2);
  await seite.close();
});

test('d2) pausiertes Video: jeder Sprung loest eine Pruefung aus, drei saubere geben nach der Hysterese frei', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'p2' });
  await expect.poll(() => urteil(seite, 'p2'), { timeout: 30_000 }).toBe('frei');
  await expect.poll(() => urteil(seite, 'p2'), { timeout: 20_000 }).toBe('verdeckt');
  await seite.evaluate(() => (document.getElementById('p2') as HTMLVideoElement).pause());
  await abwarten(500);
  let letzte = await pruefungen(seite);
  await abwarten(3500);
  expect(await pruefungen(seite)).toBe(letzte);
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) {
    await seite.evaluate((z) => { (document.getElementById('p2') as HTMLVideoElement).currentTime = z; }, 1 + i * 0.5);
    const vorher = letzte;
    await expect.poll(() => pruefungen(seite), { timeout: 5000, intervals: [100] }).toBeGreaterThan(vorher);
    letzte = await pruefungen(seite);
    await abwarten(2000); // das Ergebnis abwarten: ein weiterer Sprung vor der Antwort verwirft sie (Bild veraltet); unter Last reichen 800 ms nicht
    if (i < 2) expect(await urteil(seite, 'p2')).toBe('verdeckt');
  }
  await expect.poll(() => urteil(seite, 'p2'), { timeout: 5000 }).toBe('frei');
  console.log(`chromium: drei Spruenge im Stand, frei nach ${Date.now() - t0} ms`);
  await seite.close();
});

test('d3) Sprung im Stand auf ein Bild des Treffer-Abschnitts verdeckt ein freies Video', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne('zuerst'); // Treffer 0 bis 1,5 s, danach neutral: auch Firefox landet bei einem Sprung auf dem ersten Bild
  await neuesVideo(seite, { id: 'z1' });
  await expect.poll(() => urteil(seite, 'z1'), { timeout: 30_000 }).toBe('verdeckt');
  await expect.poll(() => urteil(seite, 'z1'), { timeout: 20_000 }).toBe('frei');
  await seite.evaluate(() => (document.getElementById('z1') as HTMLVideoElement).pause());
  await abwarten(600);
  const t0 = Date.now();
  const rot = await seite.evaluate(
    () =>
      new Promise<boolean>((fertig) => {
        const v = document.getElementById('z1') as HTMLVideoElement;
        v.addEventListener('seeked', () => fertig((window as any).kennfeldRot(v)), { once: true });
        v.currentTime = 0.5;
      }),
  );
  expect(rot, 'Landestelle zeigt das Kennfeld des Treffer-Abschnitts').toBe(true);
  await expect.poll(() => urteil(seite, 'z1'), { timeout: 10_000 }).toBe('verdeckt');
  console.log(`chromium: Sprung auf den Treffer, verdeckt nach ${Date.now() - t0} ms`);
  await seite.close();
});

test('e) unsichtbar gescrolltes Video: keine Pruefungen; beim Zurueckscrollen geht es weiter', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 's1' });
  await expect.poll(() => urteil(seite, 's1'), { timeout: 30_000 }).toBe('frei');
  await seite.evaluate(() => window.scrollTo(0, 2800)); // das Video liegt oben, der Abstand darunter ist 3000 px hoch
  await abwarten(1500); // IntersectionObserver meldet, eine laufende Pruefung endet
  const p0 = await pruefungen(seite);
  await abwarten(3500);
  const p1 = await pruefungen(seite);
  console.log(`chromium: unsichtbar, Pruefungen in 3,5 s: ${p1 - p0} (sichtbar waeren etwa 3)`);
  expect(p1).toBe(p0);
  await seite.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await pruefungen(seite)) - p1, { timeout: 8000, intervals: [200] }).toBeGreaterThanOrEqual(1);
  await seite.close();
});

test('e2) Video weit ausserhalb des Sichtbereichs: nach dem ersten Urteil keine Pruefungen', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'weit', unten: true });
  await expect.poll(() => urteil(seite, 'weit'), { timeout: 30_000 }).toMatch(/^(frei|verdeckt)$/);
  await abwarten(500);
  const p0 = await pruefungen(seite);
  await abwarten(4000);
  expect(await pruefungen(seite)).toBe(p0);
  await seite.close();
});

test('f) Autoplay-Video, dessen Quelle 1,5 s nach load kommt: nie verdeckt vor dem ersten Urteil frei', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne('spaet');
  expect(await seite.evaluate(() => document.documentElement.dataset.filmQuelle)).toBe('speicher'); // Quelle kommt wirklich nach load
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.spaetQuelle ?? ''), { timeout: 10_000 }).not.toBe('');
  const abstand = await seite.evaluate(() => Number(document.documentElement.dataset.spaetQuelle) - (window as any).__load);
  expect(abstand).toBeGreaterThan(1400);
  await expect.poll(() => urteil(seite, 'spaet'), { timeout: 20_000 }).toBe('frei');
  const folge = (await wechsel(seite, 'spaet')).map((w) => w.v);
  console.log(`chromium: Quelle ${abstand.toFixed(0)} ms nach load, Urteilsfolge ${JSON.stringify(folge)}`);
  expect(folge[0]).toBe('frei');
  await waechterOk(seite);
  await seite.close();
});

test('g) Pause der Erweiterung stoppt den Takt, Pause aus nimmt ihn wieder auf', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'g1' });
  await expect.poll(() => urteil(seite, 'g1'), { timeout: 30_000 }).toBe('frei');
  await setze({ pause: true });
  await expect.poll(() => seite.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 5000 }).toBe('aus');
  await abwarten(500);
  const p0 = await pruefungen(seite);
  await abwarten(3500);
  expect(await pruefungen(seite)).toBe(p0);
  expect(await seite.evaluate(() => document.getElementById('g1')!.hasAttribute('data-veil'))).toBe(false);
  await setze({ pause: false });
  await expect.poll(() => urteil(seite, 'g1'), { timeout: 30_000 }).toMatch(/^(frei|verdeckt)$/);
  await expect.poll(async () => (await pruefungen(seite)) - p0, { timeout: 10_000, intervals: [200] }).toBeGreaterThanOrEqual(3);
  await seite.close();
});

test('h) acht Videos gleichzeitig: in jedem Fenster von 1000 ms hoechstens vier Nachpruefungen, im Mittel nahe vier', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  for (const id of ids) await neuesVideo(seite, { id });
  await abwarten(14_000);
  // Beginn jeder Pruefung mit Art, vom Content-Script selbst gestempelt (die letzten 64). Erst-Pruefungen zaehlen im Budget mit, warten aber
  // nicht darauf: gemessen werden nur die Nachpruefungen (Art takt).
  const alle = ((await status(seite)) as any).videoZeiten as Array<{ t: number; art: 'erst' | 'takt' }>;
  expect(alle.filter((z) => z.art === 'erst').length).toBeGreaterThanOrEqual(8);
  const nach = alle.filter((z) => z.art === 'takt').map((z) => z.t);
  expect(nach.length).toBeGreaterThan(30);
  let spitze = 0;
  for (let i = 0; i < nach.length; i++) {
    let n = 0;
    for (let j = i; j < nach.length && nach[j]! - nach[i]! < 1000; j++) n++;
    spitze = Math.max(spitze, n);
  }
  const rate = (nach.length - 1) / ((nach[nach.length - 1]! - nach[0]!) / 1000);
  console.log(`chromium: acht Videos, ${nach.length} Nachpruefungen, ${rate.toFixed(2)} je Sekunde, groesste Zahl in einem Fenster von 1000 ms ${spitze}`);
  expect(spitze).toBeLessThanOrEqual(4);
  expect(rate).toBeGreaterThanOrEqual(3.2);
  await seite.close();
});

const setzeTest = (seite: Page, detail: Record<string, unknown>) =>
  seite.evaluate((d) => void document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), detail);
const wechselZahl = async (seite: Page) => (await status(seite))?.videoWechsel ?? 0;

test('i) Quellenwechsel: Urteil verworfen, wieder verdeckt (unsichtbar), neu geprueft, Freigabe fruehestens 1000 ms nach dem Verbergen', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'q1' });
  await expect.poll(() => urteil(seite, 'q1'), { timeout: 30_000 }).toBe('frei');
  await seite.evaluate(() => { (document.getElementById('q1') as HTMLVideoElement).src = (window as any).neueQuelle(); });
  await expect
    .poll(async () => (await wechsel(seite, 'q1')).map((w) => w.v).slice(0, 3).join(','), { timeout: 20_000, intervals: [100] })
    .toBe('frei,,frei');
  const e = await wechsel(seite, 'q1');
  const abstand = e[2]!.t - e[1]!.t;
  console.log(`chromium: Quellenwechsel, Freigabe ${abstand.toFixed(0)} ms nach dem Verbergen`);
  // 1 ms Spielraum: der Zeitstempel des Verbergens kommt aus dem Beobachter der Seite und liegt Bruchteile einer Millisekunde nach dem Start
  // des Zeitgebers (im Commit-Lauf Session 8 einmal 999,2 ms gemessen); die Sperre im Code bleibt 1000 ms.
  expect(abstand).toBeGreaterThanOrEqual(999);
  await waechterOk(seite);
  await seite.close();
});

test('j) schnelle Quellenwechsel: nie zwei Freigaben desselben Videos unter 1000 ms, nie zwei Freigaben im Dokument unter 334 ms', async () => {
  test.setTimeout(120_000);
  const seite = await oeffne();
  const ids = ['r1', 'r2', 'r3'];
  for (const id of ids) await neuesVideo(seite, { id });
  for (const id of ids) await expect.poll(() => urteil(seite, id), { timeout: 30_000 }).toBe('frei');
  const wechsleAlle = () =>
    seite.evaluate((liste) => {
      for (const id of liste) (document.getElementById(id) as HTMLVideoElement).src = (window as any).neueQuelle();
    }, ids);
  // Erst mehrmals je Sekunde (die Freigabe verhungert, das Verbergen bleibt sofort), dann etwa im Sekundentakt (Freigaben kommen durch).
  for (let i = 0; i < 12; i++) {
    await wechsleAlle();
    await abwarten(300);
  }
  for (let i = 0; i < 6; i++) {
    await wechsleAlle();
    await abwarten(1150);
  }
  for (const id of ids) await expect.poll(() => urteil(seite, id), { timeout: 30_000 }).toBe('frei');
  let kleinsterJeVideo = Number.POSITIVE_INFINITY;
  let freigaben: number[] = [];
  for (const id of ids) {
    const frei = (await wechsel(seite, id)).filter((w) => w.v === 'frei').map((w) => w.t);
    freigaben = freigaben.concat(frei);
    for (let i = 1; i < frei.length; i++) kleinsterJeVideo = Math.min(kleinsterJeVideo, frei[i]! - frei[i - 1]!);
    const { nachWechsel } = freigabeAbstaende(await wechsel(seite, id));
    expect(nachWechsel, `${id}: Freigabe nach dem vorigen Wechsel`).toBeGreaterThanOrEqual(999);
  }
  freigaben.sort((a, b) => a - b);
  let kleinsterImDokument = Number.POSITIVE_INFINITY;
  for (let i = 1; i < freigaben.length; i++) kleinsterImDokument = Math.min(kleinsterImDokument, freigaben[i]! - freigaben[i - 1]!);
  console.log(`chromium: ${freigaben.length} Freigaben bei schnellen Quellenwechseln, kleinster Abstand je Video ${kleinsterJeVideo.toFixed(0)} ms, im Dokument ${kleinsterImDokument.toFixed(0)} ms`);
  expect(freigaben.length).toBeGreaterThanOrEqual(6);
  // 1 ms Spielraum fuer Zeitstempel der Seite; die Sperren im Code bleiben 1000 und 334 ms (hoechstens 3 Wechsel je Sekunde = 333,3 ms).
  expect(kleinsterJeVideo).toBeGreaterThanOrEqual(999);
  expect(kleinsterImDokument).toBeGreaterThanOrEqual(333);
  await waechterOk(seite);
  await seite.close();
});

test('k) Sprung waehrend der ersten Pruefung: ein "sauber" von vor dem Sprung wird verworfen, das Video bleibt verborgen und wird neu geprueft', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  // Die Seite haelt das Video direkt nach loadeddata an und springt in den Treffer-Abschnitt; die erste Pruefung hat da schon das alte Bild gelesen.
  await neuesVideo(seite, { id: 'k1', abspielen: false, springe: 4 });
  await expect.poll(() => urteil(seite, 'k1'), { timeout: 30_000 }).toMatch(/^(frei|verdeckt)$/);
  await abwarten(1500);
  const folge = (await wechsel(seite, 'k1')).map((w) => w.v);
  const erst = (((await status(seite)) as any).videoZeiten as Array<{ art: string }>).filter((z) => z.art === 'erst').length;
  console.log(`chromium: Sprung waehrend der ersten Pruefung, Urteilsfolge ${JSON.stringify(folge)}, ${erst} Erst-Pruefungen`);
  expect(erst).toBeGreaterThanOrEqual(2);
  expect(folge).not.toContain('frei');
  expect(await urteil(seite, 'k1')).toBe('verdeckt');
  await seite.close();
});

test('l) Entfernen waehrend einer wartenden Erst-Freigabe: beim Wiedereinhaengen wird das Video neu bewertet', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'e1' });
  await expect.poll(() => urteil(seite, 'e1'), { timeout: 30_000 }).toBe('frei');
  // Neue Quelle: verborgen, die Freigabe des neuen Urteils wartet auf die Bremse (1000 ms nach dem Verbergen). Dabei aus dem Dokument nehmen.
  await seite.evaluate(() => { (document.getElementById('e1') as HTMLVideoElement).src = (window as any).neueQuelle(); });
  await abwarten(450);
  await seite.evaluate(() => { (window as any).__knoten = document.getElementById('e1'); (window as any).__knoten.remove(); });
  await abwarten(1500);
  await seite.evaluate(() => document.getElementById('platz')!.appendChild((window as any).__knoten));
  await expect.poll(() => urteil(seite, 'e1'), { timeout: 15_000 }).toBe('frei');
  await seite.close();
});

test('m) Pause der Erweiterung, waehrend die Erst-Pruefung auf eine offene Pruefung wartet: danach keine weitere Pruefung', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'w1' });
  await expect.poll(() => urteil(seite, 'w1'), { timeout: 30_000 }).toBe('frei');
  await setzeTest(seite, { videoVerzoegerungMs: 6000 }); // die naechste Nachpruefung haengt
  const p0 = await pruefungen(seite);
  await expect.poll(() => pruefungen(seite), { timeout: 5000, intervals: [50] }).toBeGreaterThan(p0);
  await seite.evaluate(() => { (document.getElementById('w1') as HTMLVideoElement).src = (window as any).neueQuelle(); }); // Erst-Pruefung wartet nun
  await abwarten(300);
  await setze({ pause: true });
  await expect.poll(() => seite.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 5000 }).toBe('aus');
  const p1 = await pruefungen(seite);
  await abwarten(4000);
  expect(await pruefungen(seite)).toBe(p1);
  await seite.close();
});

test('n) haengender Erkenner: eine Nachpruefung ueber 2 Taktzeiten verdeckt das Video, ohne zweite Anfrage', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'h1' });
  await expect.poll(() => urteil(seite, 'h1'), { timeout: 30_000 }).toBe('frei');
  await setzeTest(seite, { videoVerzoegerungMs: 6000 });
  const p0 = await pruefungen(seite);
  await expect.poll(() => pruefungen(seite), { timeout: 5000, intervals: [50] }).toBeGreaterThan(p0);
  const start = ((((await status(seite)) as any).videoZeiten as Array<{ t: number; art: string }>).filter((z) => z.art === 'takt').pop())!.t;
  await expect.poll(() => urteil(seite, 'h1'), { timeout: 5000, intervals: [50] }).toBe('verdeckt');
  const verdeckt = (await wechsel(seite, 'h1')).filter((w) => w.v === 'verdeckt')[0]!.t;
  console.log(`chromium: haengende Antwort, verdeckt ${(verdeckt - start).toFixed(0)} ms nach Beginn der Pruefung`);
  expect(verdeckt - start).toBeGreaterThanOrEqual(1900);
  expect(verdeckt - start).toBeLessThanOrEqual(3000);
  const p1 = await pruefungen(seite);
  await abwarten(2500);
  expect(await pruefungen(seite)).toBe(p1); // keine zweite Anfrage, solange die erste offen ist
  await seite.close();
});

test('o) Wiedereinhaengen mit anderer Quelle: Urteil verworfen, Video neu bewertet', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  await neuesVideo(seite, { id: 'a1' });
  await expect.poll(() => urteil(seite, 'a1'), { timeout: 30_000 }).toBe('frei');
  await seite.evaluate(() => {
    const v = document.getElementById('a1') as HTMLVideoElement;
    (window as any).__knoten = v;
    v.remove();
    v.src = (window as any).neueQuelle(); // ausserhalb des Dokuments: der Schleier sieht kein loadstart
  });
  await abwarten(1500);
  await seite.evaluate(() => document.getElementById('platz')!.appendChild((window as any).__knoten));
  await expect.poll(async () => (await wechsel(seite, 'a1')).map((w) => w.v).slice(0, 3).join(','), { timeout: 20_000, intervals: [100] }).toBe('frei,,frei');
  await seite.close();
});

test('p) vorlaeufig verdecktes Video: das echte Urteil "verdeckt" ist kein Wechsel', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne('zuerst'); // Treffer am Anfang
  await neuesVideo(seite, { id: 'vl', abspielen: false, preload: 'none' });
  await expect.poll(() => urteil(seite, 'vl'), { timeout: 15_000 }).toBe('verdeckt'); // vorlaeufig, keine Daten
  await expect.poll(() => wechselZahl(seite), { timeout: 3000 }).toBe(1);
  await seite.evaluate(() => void (document.getElementById('vl') as HTMLVideoElement).play().catch(() => {}));
  await expect.poll(async () => ((await status(seite)) as any).videoPruefungen, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await abwarten(2500);
  expect(await urteil(seite, 'vl')).toBe('verdeckt');
  expect(await wechselZahl(seite)).toBe(1);
  await seite.close();
});

// V1 (Video-Zonen): geschuetzte Wiedergabe (EME) gilt als nicht lesbar. drawImage liefert dort schwarze Bilder, die Pruefung sah nichts und gaebe das
// Video frei. Der Test haengt dem Element echte MediaKeys (ClearKey) an, bevor es Daten bekommt: das Video muss ganz verdeckt werden, obwohl sein Bild
// harmlos ist. (Ein selbst gesetzter Wert auf dem Element waere in der Welt des Content-Scripts nicht sichtbar.)
test('q) DRM (mediaKeys gesetzt): nie frei, ganz verdeckt', async () => {
  test.setTimeout(90_000);
  const seite = await oeffne();
  const ok = await seite.evaluate(async () => {
    try {
      const v = document.createElement('video');
      v.id = 'drm';
      v.muted = true;
      v.loop = true;
      const zugang = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [
        { initDataTypes: ['webm', 'keyids'], videoCapabilities: [{ contentType: 'video/webm; codecs="vp8"' }] },
      ]);
      await v.setMediaKeys(await zugang.createMediaKeys());
      document.getElementById('platz')!.appendChild(v);
      v.src = (window as any).neueQuelle();
      void v.play().catch(() => {});
      return (v as any).mediaKeys != null;
    } catch {
      return false;
    }
  });
  expect(ok, 'ClearKey in diesem Browser nicht verfuegbar').toBe(true);
  await expect.poll(() => urteil(seite, 'drm'), { timeout: 20_000 }).toBe('verdeckt');
  await abwarten(2500);
  expect(await urteil(seite, 'drm')).toBe('verdeckt');
  const folge = await wechsel(seite, 'drm');
  expect(folge.filter((w) => w.v === 'frei').length, JSON.stringify(folge.map((w) => [w.v, w.ct]))).toBe(0);
  await seite.close();
});

// V2 (Video-Zonen): Schnitt-Sofortpruefung auch bei freien Videos. ?modus=schnitt: harmlose harte Schnitte alle 600 ms, der Treffer beginnt mit einem
// Schnitt bei 3 s. Ohne V2 haette das freie Video bis zur naechsten Takt-Pruefung (bis 1 s) offen gelegen.
test('r) Schnitt-Sofortpruefung: Schnitt bis verdeckt im Median unter 400 ms, harmlose Schnitte hoechstens 2,1 Pruefungen je s', async () => {
  test.setTimeout(150_000);
  const seite = await oeffne('schnitt');
  await neuesVideo(seite, { id: 'sn', autoplay: true });
  const p0 = await pruefungen(seite);
  const t0 = Date.now();
  const verdeckt = async () => (await wechsel(seite, 'sn')).filter((w) => w.v === 'verdeckt' && w.ct >= 2.9 && w.ct < 4.5).length;
  await expect.poll(verdeckt, { timeout: 100_000, intervals: [500] }).toBeGreaterThanOrEqual(3);
  const rate = ((await pruefungen(seite)) - p0) / ((Date.now() - t0) / 1000);
  const delta = (await wechsel(seite, 'sn')).filter((w) => w.v === 'verdeckt' && w.ct >= 2.9 && w.ct < 4.5).map((w) => w.ct - 3).sort((a, b) => a - b);
  const med = delta[delta.length >> 1]!;
  console.log(`chromium: Schnitt bis verdeckt ${delta.map((d) => d.toFixed(2)).join(', ')} s (Median ${med.toFixed(2)} s), ${rate.toFixed(2)} Pruefungen je s mit harmlosen Schnitten`);
  expect(med).toBeLessThan(0.4);
  expect(rate).toBeLessThanOrEqual(2.1);
  expect(rate).toBeGreaterThan(0.5);
  await seite.close();
});
