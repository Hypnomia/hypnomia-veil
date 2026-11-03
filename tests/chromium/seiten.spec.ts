import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Nachbauten von TikTok, X, Instagram und Reddit (PHASE-3-BAUPLAN Auftrag S, S5 und S6). Die Fixtures bilden nur die Struktur nach (keine kopierten
// Seiten, keine fremden Bilder); Videos nimmt die Seite zur Laufzeit auf. Geprueft werden Urteile ueber das Attribut data-veil, nicht ueber erzwungene
// Deckkraft. Ohne Testbilder: VEIL_OHNE_TESTBILDER=1 ueberspringt laut.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
// Testbild, das der Erkenner mit den Standard-Zonen sicher trifft (belegt durch die Positivkontrolle in video.spec.ts).
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

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
  profil = await mkdtemp(path.join(tmpdir(), 'veil-seiten-'));
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
    await (globalThis as any).chrome.storage.local.remove('einstellungen');
  });
});

const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));
const urteile = (seite: Page): Promise<Record<string, string>> => seite.evaluate(() => (window as any).testUrteile());

async function oeffne(datei: string, zusatz = ''): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(`${basis}/${datei}?bild=${encodeURIComponent(BILD)}${zusatz}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 40_000, intervals: [200] }).toBe('1');
  return seite;
}

// Wartet, bis alle erwarteten Urteile da sind (ein Video ohne Daten ist erst vorlaeufig verdeckt, dann folgt das echte Urteil).
async function warteUrteile(seite: Page, erwartet: Record<string, RegExp | string>): Promise<Record<string, string>> {
  const passt = (u: Record<string, string>) =>
    Object.entries(erwartet)
      .filter(([id, soll]) => !(typeof soll === 'string' ? u[id] === soll : soll.test(u[id] ?? '')))
      .map(([id]) => id);
  await expect.poll(async () => passt(await urteile(seite)), { timeout: 40_000, intervals: [200] }).toEqual([]);
  return urteile(seite);
}

async function waechterOk(seite: Page) {
  const w = await seite.evaluate(() => ({ aufblitzen: (window as any).__aufblitzen as number, proben: (window as any).__proben as number, wer: (window as any).__wer as string[] }));
  expect(w.proben).toBeGreaterThan(0);
  expect(w.aufblitzen, JSON.stringify(w.wer)).toBe(0);
}

const ZENSIERT = /^(zensiert|verdeckt)$/;

test('X: das unsichtbare img und sein Hintergrund-Zwilling werden beurteilt, sfw frei, nsfw zensiert oder verdeckt', async () => {
  const seite = await oeffne('seite-x.html');
  const u = await warteUrteile(seite, {
    'x-nsfw-img': ZENSIERT,
    'x-nsfw-hg': ZENSIERT,
    'x-sfw-img': 'frei',
    'x-sfw-hg': 'frei',
    'x-video': 'frei',
    'x-avatar': 'frei',
    'x-avatar2': 'frei',
    'x-avatar3': 'frei',
  });
  await waechterOk(seite);
  console.log(`chromium: X ${JSON.stringify(u)}`);
  await seite.close();
});

test('Instagram: Bilder mit crossorigin, Story-Ringe, blob:-Video; das Karussell wird nach dem Quellenwechsel neu beurteilt', async () => {
  const seite = await oeffne('seite-instagram.html');
  const u = await warteUrteile(seite, {
    'ig-nsfw': ZENSIERT,
    'ig-fremd-nsfw': ZENSIERT,
    'ig-sfw': 'frei',
    karussell: 'frei',
    'ig-video': 'frei',
    'ig-ring0': 'frei',
    'ig-ring1': 'frei',
    'ig-ring2': 'frei',
    'ig-ring3': 'frei',
    'ig-ring4': 'frei',
  });
  await seite.evaluate(() => (window as any).weiter());
  await expect.poll(async () => (await urteile(seite)).karussell, { timeout: 30_000, intervals: [100] }).toMatch(ZENSIERT);
  expect(await seite.evaluate(() => (window as any).__karussellFalsch as number)).toBe(0);
  await waechterOk(seite);
  console.log(`chromium: Instagram ${JSON.stringify(await urteile(seite))}`);
  await seite.close();
});

test('Reddit: Bilder mit loading=lazy und ein Player mit Video in offenen und geschlossenen Shadow Roots', async () => {
  const seite = await oeffne('seite-reddit.html');
  const u = await warteUrteile(seite, {
    'rd-nsfw-offen': ZENSIERT,
    'rd-nsfw-zu': ZENSIERT,
    'rd-sfw-zu': 'frei',
    'rd-video': 'frei',
  });
  await waechterOk(seite);
  console.log(`chromium: Reddit ${JSON.stringify(u)}`);
  await seite.close();
});

// ---------- TikTok ----------

interface TiktokFolge {
  verdecktNach: number[];
  abstandMs: number;
}

// Urteilsfolge (ohne Wiederholungen von null) eines Elements ab dem Eintrag `ab`.
const folge = (liste: Wechsel[], id: string, ab = 0) => liste.slice(ab).filter((w) => w.id === id);

async function tiktokLauf(seite: Page, name: string): Promise<TiktokFolge> {
  await warteUrteile(seite, { avatar: 'frei', 'bild-sfw': 'frei', 'bild-nsfw': ZENSIERT });
  const alle = async () => seite.evaluate(() => (window as any).__wechsel as Wechsel[]);
  const ids = ['v1', 'c1', 'c1-leer', 'v2', 'c2', 'c2-leer'];
  const ohneNull = (liste: Wechsel[], id: string) => folge(liste, id).filter((w) => w.v !== null);
  // Erste Runde: frei, verdeckt (Treffer-Abschnitt), wieder frei. Video und Leinwaende gleich.
  await expect
    .poll(async () => {
      const l = await alle();
      return ids.map((id) => ohneNull(l, id).slice(0, 3).map((w) => w.v).join(',')).join(' | ');
    }, { timeout: 60_000, intervals: [200] })
    .toBe(ids.map(() => 'frei,verdeckt,frei').join(' | '));
  const l1 = await alle();
  const verdecktNach: number[] = [];
  let abstand = 0;
  for (const [video, leinwaende] of [['v1', ['c1', 'c1-leer']], ['v2', ['c2', 'c2-leer']]] as const) {
    const v = ohneNull(l1, video).slice(0, 3);
    verdecktNach.push(v[1]!.ct - 3);
    // Der Spiegel verdeckt innerhalb von 1,5 s nach Beginn des Treffer-Abschnitts (gemessen an seiner eigenen Zeitmarke).
    for (const c of leinwaende) {
      const m = ohneNull(l1, c).slice(0, 3);
      expect(m[1]!.ct, `${name} ${c} verdeckt bei`).toBeGreaterThanOrEqual(2.9);
      expect(m[1]!.ct - 3, `${name} ${c}: Zeit bis verdeckt nach Beginn des Treffer-Abschnitts`).toBeLessThanOrEqual(1.5);
      // Im selben Augenblick wie das Video: Verdecken sofort, Freigeben zusammen (die Bremse gilt einmal).
      for (let i = 0; i < 3; i++) abstand = Math.max(abstand, Math.abs(m[i]!.t - v[i]!.t));
    }
  }
  expect(abstand, `${name}: groesster Zeitabstand zwischen Video und Spiegel`).toBeLessThan(150);
  // Wischen: beide Videos bekommen neue Quellen. Video und Leinwaende werden zurueckgesetzt (kein Urteil), danach frei, dann wieder verdeckt.
  const ab = l1.length;
  await seite.evaluate(() => (window as any).wische());
  await expect
    .poll(async () => {
      const l = await alle();
      return ids.map((id) => folge(l, id, ab).slice(0, 3).map((w) => w.v ?? 'weg').join(',')).join(' | ');
    }, { timeout: 60_000, intervals: [200] })
    .toBe(ids.map(() => 'weg,frei,verdeckt').join(' | '));
  const l2 = await alle();
  for (const [video, leinwaende] of [['v1', ['c1', 'c1-leer']], ['v2', ['c2', 'c2-leer']]] as const) {
    const v = folge(l2, video, ab).slice(0, 3);
    verdecktNach.push(v[2]!.ct - 3);
    expect(v[2]!.ct - 3, `${name} ${video} nach dem Wischen`).toBeLessThanOrEqual(1.5);
    for (const c of leinwaende) {
      const m = folge(l2, c, ab).slice(0, 3);
      expect(m[2]!.ct - 3, `${name} ${c} nach dem Wischen`).toBeLessThanOrEqual(1.5);
      for (let i = 0; i < 3; i++) abstand = Math.max(abstand, Math.abs(m[i]!.t - v[i]!.t));
    }
  }
  expect(abstand, `${name}: groesster Zeitabstand nach dem Wischen`).toBeLessThan(150);
  // Keine Leinwand zeigte je ein anderes Urteil als ihr Video (insbesondere nie frei ohne Urteil des Videos).
  const rest = await seite.evaluate(() => ({ abweichung: (window as any).__abweichung as number, wer: (window as any).__abweichungWer as string[] }));
  expect(rest.abweichung, JSON.stringify(rest.wer)).toBe(0);
  await waechterOk(seite);
  return { verdecktNach, abstandMs: abstand };
}

test('TikTok: die Leinwand folgt dem Video (verdeckt im Treffer-Abschnitt, frei im sauberen), auch nach dem Wischen', async () => {
  test.setTimeout(180_000);
  const seite = await oeffne('seite-tiktok.html');
  const r = await tiktokLauf(seite, '2d');
  console.log(
    `chromium: TikTok 2d, Zeit bis verdeckt nach Beginn des Treffer-Abschnitts ${r.verdecktNach.map((x) => x.toFixed(2)).join(', ')} s, groesster Abstand Video zu Spiegel ${r.abstandMs.toFixed(0)} ms`,
  );
  await seite.close();
});

test('TikTok mit WebGL-Leinwand (nur wenn der Browser WebGL kann)', async () => {
  test.setTimeout(180_000);
  const seite = await oeffne('seite-tiktok.html', '&leinwand=webgl');
  const webgl = await seite.evaluate(() => document.documentElement.dataset.webgl ?? '');
  if (webgl !== 'ja') {
    console.log('chromium: TikTok WebGL UEBERSPRUNGEN, der Browser hat kein WebGL');
    test.skip(true, 'kein WebGL');
  }
  const r = await tiktokLauf(seite, 'webgl');
  console.log(
    `chromium: TikTok webgl, Zeit bis verdeckt nach Beginn des Treffer-Abschnitts ${r.verdecktNach.map((x) => x.toFixed(2)).join(', ')} s, groesster Abstand Video zu Spiegel ${r.abstandMs.toFixed(0)} ms`,
  );
  await seite.close();
});


// ---------- Spiegel: Nachtrag S7 ----------

const setzeTest = (seite: Page, detail: Record<string, unknown>) =>
  seite.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), detail);

const keineAbweichung = async (seite: Page, was: string) => {
  const rest = await seite.evaluate(() => ({ abweichung: (window as any).__abweichung as number, wer: (window as any).__abweichungWer as string[] }));
  expect(rest.abweichung, `${was}: ${JSON.stringify(rest.wer)}`).toBe(0);
};

// Alle Karten gleich: jede Leinwand zeigt dasselbe Urteil wie ihr Video (und das Video hat eins).
const kartenGleich = (seite: Page, urteil?: string) =>
  seite.evaluate((u) => {
    const karten = (window as any).__karten as Array<{ v: HTMLElement; cs: HTMLElement[] }>;
    return karten.every((k) => {
      const s = k.v.getAttribute('data-veil');
      return !!s && (!u || s === u) && k.cs.every((c) => c.getAttribute('data-veil') === s);
    });
  }, urteil);

const warteKartenGleich = async (seite: Page, urteil?: string) => {
  await expect.poll(() => kartenGleich(seite, urteil), { timeout: 60_000, intervals: [100] }).toBe(true);
};

async function oeffneWebgl(): Promise<Page | null> {
  const seite = await oeffne('seite-tiktok.html', '&leinwand=webgl');
  const webgl = await seite.evaluate(() => document.documentElement.dataset.webgl ?? '');
  if (webgl !== 'ja') {
    console.log('chromium: WebGL UEBERSPRUNGEN, der Browser hat kein WebGL');
    await seite.close();
    return null;
  }
  return seite;
}

test('S7 WebGL: das Video wird im Treffer-Abschnitt 300 ms aus- und wieder eingehaengt, die Leinwand wird nie frei', async () => {
  test.setTimeout(180_000);
  const seite = await oeffneWebgl();
  test.skip(!seite, 'kein WebGL');
  await expect
    .poll(async () => { const u = await urteile(seite!); return `${u.v1} ${u.v2}`; }, { timeout: 60_000, intervals: [50] })
    .toBe('verdeckt verdeckt');
  // Karte 1: 300 ms ausgehaengt, Karte 2: 800 ms (laenger als die Wartezeit der eigenen Pruefung einer Leinwand).
  await Promise.all([
    seite!.evaluate(() => (window as any).haengeAus(1, 'video', 300)),
    seite!.evaluate(() => (window as any).haengeAus(2, 'video', 800)),
  ]);
  // Gleich danach und eine Weile spaeter: die Leinwaende zeigen weiter verdeckt oder nichts, nie frei (die Bindung blieb, ein Lesezugriff auf WebGL waere leer).
  for (let i = 0; i < 12; i++) {
    const u = await urteile(seite!);
    expect(u.c1, `Leinwand 1 nach dem Wiedereinhaengen (Video ${u.v1})`).not.toBe('frei');
    expect(u.c2, `Leinwand 2 nach dem Wiedereinhaengen (Video ${u.v2})`).not.toBe('frei');
    await abwarten(100);
  }
  await warteKartenGleich(seite!, 'frei');
  await keineAbweichung(seite!, 'WebGL aus und ein');
  await waechterOk(seite!);
  await seite!.close();
});

test('S7 WebGL: Video und Leinwaende gemeinsam aus- und einhaengen, dann wischen: die neue Quelle erscheint nie ungeprueft', async () => {
  test.setTimeout(180_000);
  const seite = await oeffneWebgl();
  test.skip(!seite, 'kein WebGL');
  await warteKartenGleich(seite!, 'frei');
  await seite!.evaluate(async () => {
    await (window as any).haengeAus(1, 'beide', 300);
    await (window as any).haengeAus(2, 'beide', 300);
    (window as any).wische();
  });
  await warteKartenGleich(seite!, 'frei');
  await warteKartenGleich(seite!, 'verdeckt');
  await keineAbweichung(seite!, 'gemeinsam aus und ein, wischen');
  await waechterOk(seite!);
  await seite!.close();
});

test('S7: Wischen bei verzoegertem Erkenner: die Leinwand ist versteckt, nicht unscharf', async () => {
  test.setTimeout(180_000);
  const seite = await oeffne('seite-tiktok.html');
  await warteKartenGleich(seite);
  await setzeTest(seite, { videoVerzoegerungMs: 4000 });
  await seite.evaluate(() => (window as any).wische());
  await abwarten(400); // loadstart und das Zuruecksetzen laufen asynchron
  const t0 = Date.now();
  while (Date.now() - t0 < 2800) {
    const u = await urteile(seite);
    expect(u.v1, 'das Video wartet auf den verzoegerten Erkenner').toBe('');
    expect(u.c1, 'Leinwand ohne Urteil des Videos').toBe('');
    expect(u['c1-leer']).toBe('');
    expect(u.c2).toBe('');
    await abwarten(100);
  }
  await setzeTest(seite, { videoVerzoegerungMs: 0 });
  await warteKartenGleich(seite);
  await keineAbweichung(seite, 'verzoegerter Erkenner');
  await waechterOk(seite);
  await seite.close();
});

test('S7: die Leinwand wird vor dem Video eingehaengt: sie wird gebunden, sobald das Video da ist, und ist nie unscharf ohne Urteil', async () => {
  test.setTimeout(180_000);
  const seite = await oeffne('seite-tiktok.html', '&spaet=150');
  await warteKartenGleich(seite);
  await keineAbweichung(seite, 'Leinwand vor dem Video');
  await waechterOk(seite);
  await seite.close();
});

test('S7: Pause des Videos und Pause der Erweiterung mit Rueckkehr: die Leinwand folgt, nie frei bei verdecktem Video', async () => {
  test.setTimeout(180_000);
  const seite = await oeffne('seite-tiktok.html');
  await warteKartenGleich(seite);
  // Pause des Videos mitten im Lauf und Weiterspielen.
  await seite.evaluate(() => (window as any).__karten[0].v.pause());
  await abwarten(1500);
  await seite.evaluate(() => (window as any).__karten[0].v.play());
  await warteKartenGleich(seite);
  await keineAbweichung(seite, 'Video pausiert');
  // Pause der Erweiterung: alles frei und ohne Attribute, danach wird wieder verdeckt und geprueft.
  await setzeTest(seite, { einstellungen: { pause: true } });
  await expect
    .poll(async () => await seite.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 20_000, intervals: [100] })
    .toBe('aus');
  await abwarten(500);
  await setzeTest(seite, { einstellungen: { pause: false } });
  await expect
    .poll(async () => await seite.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 20_000, intervals: [100] })
    .toBe(null);
  await warteKartenGleich(seite);
  await keineAbweichung(seite, 'Pause der Erweiterung');
  await seite.close();
});

test('S7: Spiegel in Shadow Roots (offen und geschlossen) folgen dem Video wie im Dokument', async () => {
  test.setTimeout(180_000);
  const seite = await oeffne('seite-tiktok.html', '&schatten=1');
  const r = await tiktokLauf(seite, 'schatten');
  console.log(`chromium: TikTok Shadow Roots, Zeit bis verdeckt ${r.verdecktNach.map((x) => x.toFixed(2)).join(', ')} s`);
  await seite.close();
});

test('S7 Gegenfaelle: Leinwand mit unter 50 % Ueberdeckung und Leinwand unter einem Video nur mit Ton werden selbst geprueft', async () => {
  const seite = await oeffne('spiegel-gegenfall.html');
  const u = await warteUrteile(seite, {
    'g-nsfw-klein': ZENSIERT,
    'g-sfw-klein': 'frei',
    'g-nsfw-ton': ZENSIERT,
    'g-sfw-ton': 'frei',
    'g-ton': 'frei',
  });
  await waechterOk(seite);
  console.log(`chromium: Spiegel-Gegenfaelle ${JSON.stringify(u)}`);
  await seite.close();
});

void abwarten;
