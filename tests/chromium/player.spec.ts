// Chromium: Player-Riegel (Auftrag P, PHASE-4-BAUPLAN Abschnitt 8). Das Hauptvideo einer Erwachsenenseite bleibt angehalten und stumm, bis das Quiz
// geloest ist. Seite: tests/fixtures/erwachsen-player.html auf pornhub.veil-erwachsen.test (nur im Testbau, aufgeloest auf den Testserver),
// Video zur Laufzeit aufgenommen (keine Mediendatei). Riegel-Abbild in data-veil-riegel. Pack mit synthetischer Quiz-Bank (nur Auswahlfragen).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
// Das Riegel-Abbild (data-veil-riegel) gibt es nur auf 127.0.0.1 und localhost: dort gilt die Seite ueber `erwachsen.eigeneSeiten` als Erwachsenenseite
// (Adapter allgemein, Hauptvideo = groesstes Video). Die Testdomain (Adapter pornhub, Selektor #player) prueft ein eigener Fall ohne Abbild.
const SEITE = `http://127.0.0.1:${port}/erwachsen-player.html`;
const ADAPTER_SEITE = `http://pornhub.veil-erwachsen.test:${port}/erwachsen-player.html`;
const NEUTRAL = `http://localhost:${port}/erwachsen-player.html`;
const EINST = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } };
const bauModul = '../../scripts/pack/baue-pack.mjs';
const inhaltModul = '../../scripts/pack/dummy-inhalte.mjs';

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let kleinPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
let fragen: any[] = [];
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-player-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-player-pack-'));
  const bau = (await import(bauModul)) as { baueDummyPack(o?: unknown): Promise<{ bytes: Uint8Array }> };
  const inhalt = (await import(inhaltModul)) as { DUMMY_QUIZ: { fragen: any[] } };
  fragen = inhalt.DUMMY_QUIZ.fragen.filter((f) => f.art === 'wissen' || f.art === 'allgemein');
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack({ quiz: { version: 1, fragen } })).bytes);
  // Kleine Bank: eine Auswahlfrage und zwei Aufgaben, die im Ruhig-Modus nicht zulaessig sind (weniger als zwei zulaessige Fragen).
  const klein = [
    fragen[0],
    { id: 'k-z', art: 'aufgabe', schwere: 'mittel', geraet: 'beide', frage: 'Count every POP.', aufgabe: { typ: 'zaehlen', param: { wort: 'POP', woerter: 'POP,DOWN,OBEY,pink', anzahlWoerter: 8 } } },
    { id: 'k-b', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'One word flashes once. Type it.', aufgabe: { typ: 'wort-blitz', param: { wort: 'OBEY' } } },
  ];
  kleinPfad = path.join(ordner, 'klein.miapack');
  await writeFile(kleinPfad, (await bau.baueDummyPack({ id: 'klein', quiz: { version: 1, fragen: klein } })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`, '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1', '--autoplay-policy=no-user-gesture-required'],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
async function importierePack(pfad: string = packPfad) {
  // Das Mia Pack wartet auf den Einstieg (Entscheidung 133): erledigt setzen.
  await worker.evaluate((e) => (globalThis as any).chrome.storage.local.set({ einstieg: e }), { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 });
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(pfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
    await s.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
  } finally {
    await s.close();
  }
}
async function entfernePack() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#entfernen').click();
    await s.locator('#entfernen-ja').click();
    await expect(s.locator('#entfernen')).toBeHidden({ timeout: 15_000 });
  } finally {
    await s.close();
  }
}

type Abbild = any;
const abbild = (s: Page): Promise<Abbild | null> =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-riegel');
    return a ? JSON.parse(a) : null;
  });
const hostDa = (s: Page) => s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null);
async function bis(s: Page, prueft: (a: Abbild) => boolean, frist = 10_000): Promise<Abbild> {
  let letzter: Abbild | null = null;
  await expect
    .poll(async () => ((letzter = await abbild(s)), !!letzter && prueft(letzter)), { timeout: frist, intervals: [50] })
    .toBe(true);
  return letzter;
}
const riegelOffen = (s: Page) => bis(s, (a) => a.offen && a.zustand === 'frage');
const mitte = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
async function loese(s: Page) {
  const a = await riegelOffen(s);
  const f = fragen.find((q) => q.id === a.frage.id);
  const ziel = a.antworten.find((b: any) => b.text === f.antworten[f.richtig]);
  const m = mitte(ziel);
  await s.mouse.click(m.x, m.y);
  await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
}
const video = (s: Page, id: string) =>
  s.evaluate((i) => {
    const v = (window as any).findeVideo(i) as HTMLVideoElement;
    return { paused: v.paused, t: v.currentTime, muted: v.muted, ended: v.ended };
  }, id);
async function oeffneSeite(url = SEITE): Promise<Page> {
  const s = await context.newPage();
  await s.goto(url);
  await s.waitForFunction(() => document.documentElement.dataset.filmBereit === '1', null, { timeout: 30_000 });
  return s;
}
const neuesVideo = (s: Page, o: Record<string, unknown>) => s.evaluate((x) => (window as any).neuesVideo(x) && true, o);
// Das Video bleibt angehalten: zwei Messungen im Abstand, currentTime waechst nicht.
async function bleibtStehen(s: Page, id: string) {
  const a = await video(s, id);
  await s.waitForTimeout(700);
  const b = await video(s, id);
  expect(a.paused && b.paused).toBe(true);
  expect(b.t - a.t).toBeLessThan(0.02);
}
async function laeuft(s: Page, id: string) {
  const a = await video(s, id);
  await expect.poll(async () => (await video(s, id)).t - a.t, { timeout: 5000 }).toBeGreaterThan(0.2);
  expect((await video(s, id)).paused).toBe(false);
}

test('ohne Pack: kein Riegel, das Video laeuft', async () => {
  await setzeEinstellungen(EINST);
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    expect(await hostDa(s)).toBe(false);
  } finally {
    await s.close();
  }
});

test('Kleine Bank, Ruhig-Modus: weniger als zwei zulaessige Fragen, das Video bleibt frei und es gibt keine Endlosschleife', async () => {
  await importierePack(kleinPfad);
  await setzeEinstellungen({ ...EINST, ruhig: true });
  const s = await oeffneSeite();
  try {
    await s.evaluate(() => {
      (window as any).plays = 0;
      document.addEventListener('play', () => (window as any).plays++, true);
    });
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(2500);
    expect(await hostDa(s)).toBe(false);
    expect((await video(s, 'haupt')).muted).toBe(true); // war stumm angelegt und bleibt es
    expect(await s.evaluate(() => (window as any).plays)).toBeLessThanOrEqual(4);
    await laeuft(s, 'haupt');
    // Ruhig-Modus aus: genug Fragen, das laufende Video bekommt jetzt den Riegel
    await setzeEinstellungen({ ruhig: false });
    await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(true);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
  await entfernePack();
  await importierePack(packPfad);
  await setzeEinstellungen(EINST);
});

test('Seite ohne Erwachsenen-Stand: kein Riegel, das Video laeuft', async () => {
  const s = await oeffneSeite(NEUTRAL);
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(500);
    expect(await hostDa(s)).toBe(false);
  } finally {
    await s.close();
  }
});

test('Autoplay-Video wird gesperrt, Riegel vor dem Abspielen, richtig geloest laeuft es, zweites Abspielen ohne Quiz, neue Quelle neues Quiz', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    expect((await video(s, 'haupt')).muted).toBe(true);
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
    // zweites Abspielen: pausieren, springen, wieder abspielen, ohne Quiz
    await s.evaluate(() => {
      const v = (window as any).findeVideo('haupt') as HTMLVideoElement;
      v.pause();
      v.currentTime = 0;
      return v.play();
    });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(400);
    expect(await hostDa(s)).toBe(false);
    // blob: auf blob: (MSE, Qualitaetswechsel) bleibt dieselbe Quelle: kein neues Quiz
    await s.evaluate(() => {
      const v = (window as any).findeVideo('haupt') as HTMLVideoElement;
      v.src = (window as any).neueQuelle();
      v.play().catch(() => {});
    });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(400);
    expect(await hostDa(s)).toBe(false);
    // andere Nicht-blob-Adresse im selben Element: neues Quiz
    await s.evaluate(() => {
      const v = (window as any).findeVideo('haupt') as HTMLVideoElement;
      v.src = (window as any).datenQuelle(1);
      v.play().catch(() => {});
    });
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Klick auf Abspielen: Ton wird gemerkt und kommt zurueck; Vollbild endet, solange gesperrt', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', muted: false });
    await s.evaluate(() => {
      (window as any).vb = 0;
      document.addEventListener('fullscreenchange', () => (window as any).vb++);
    });
    await s.click('#spielen');
    await riegelOffen(s);
    expect((await video(s, 'haupt')).muted).toBe(true);
    await bleibtStehen(s, 'haupt');
    // Vollbild anfordern, waehrend gesperrt: es endet wieder
    await s.evaluate(() => document.getElementById('vollbild')!.click());
    await s.evaluate(() => (document.querySelector('#player video') as HTMLVideoElement).requestFullscreen().catch(() => {}));
    await expect.poll(() => s.evaluate(() => (window as any).vb), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    await s.waitForTimeout(400);
    expect(await s.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await loese(s);
    const v = await video(s, 'haupt');
    expect(v.muted).toBe(false);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Video im Vollbild will spielen: Vollbild endet, Riegel erscheint', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.evaluate(() => {
      (window as any).vb = 0;
      document.addEventListener('fullscreenchange', () => (window as any).vb++);
    });
    await s.click('#vollbild');
    await expect.poll(() => s.evaluate(() => (window as any).vb), { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    await s.evaluate(() => ((window as any).findeVideo('haupt') as HTMLVideoElement).play().catch(() => {}));
    await expect.poll(() => s.evaluate(() => (window as any).vb), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    expect(await s.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Pause im Riegel gibt das Video frei; nach Pause-Ende bekommt es wieder den Riegel', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    const a = await riegelOffen(s);
    const m = mitte(a.pause);
    await s.mouse.click(m.x, m.y);
    await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
    await laeuft(s, 'haupt');
    await expect.poll(() => worker.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen ?? {}).pause), { timeout: 10_000 }).toBe(true);
    await s.waitForTimeout(500);
    expect(await hostDa(s)).toBe(false);
    expect((await video(s, 'haupt')).paused).toBe(false);
    await setzeEinstellungen({ pause: false });
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Pause von aussen gibt ein gesperrtes Video frei', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    await setzeEinstellungen({ pause: true });
    await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
    await laeuft(s, 'haupt');
    await setzeEinstellungen({ pause: false });
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Hover-Vorschauvideo in einem Vorschau-Link bekommt keinen Riegel, das Hauptvideo schon', async () => {
  const s = await oeffneSeite();
  try {
    // 400 x 225: gross genug fuer den Rueckfall, nur der Vorschau-Link schliesst es aus
    await neuesVideo(s, { id: 'vorschau', ziel: 'karte', autoplay: true, abspielen: true, klasse: 'thumbVideo' });
    await s.waitForTimeout(1500);
    expect(await hostDa(s)).toBe(false); // (der Schleier selbst haelt stumme Vorschauschleifen an, hier zaehlt nur: kein Riegel)
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    const anker = await s.evaluate(() => {
      const r = (document.getElementById('player') as HTMLElement).getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const a = await abbild(s);
    expect(a.host.y).toBeLessThan(anker.y + anker.h);
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Adapter-Selektor (pornhub, #player): Video gesperrt (ohne Abbild auf der Testdomain), Pause gibt es frei', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await expect.poll(async () => (await video(s, 'haupt')).paused, { timeout: 10_000 }).toBe(true);
    await s.waitForTimeout(1200);
    await bleibtStehen(s, 'haupt');
    await setzeEinstellungen({ pause: true });
    await laeuft(s, 'haupt');
    await setzeEinstellungen({ pause: false });
  } finally {
    await s.close();
  }
});

test('Hover-Vorschauvideo der Adapter-Seite ausserhalb eines Links (video.thumbVideo, mit Ton) bleibt unberuehrt', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'vorschau', ziel: 'fremd', autoplay: true, abspielen: true, muted: false, klasse: 'thumbVideo' });
    await s.waitForTimeout(1800);
    const v = await video(s, 'vorschau');
    expect(v.paused).toBe(false);
    expect(v.muted).toBe(false);
  } finally {
    await s.close();
  }
});

test('Adapter-Selektor: nur das Video in #player wird gesperrt, ein groesseres daneben laeuft frei', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await neuesVideo(s, { id: 'gross', ziel: 'fremd', autoplay: true, abspielen: true });
    await expect.poll(async () => (await video(s, 'haupt')).paused, { timeout: 10_000 }).toBe(true);
    await s.waitForTimeout(1200);
    await bleibtStehen(s, 'haupt');
    await laeuft(s, 'gross');
    await setzeEinstellungen({ pause: true });
    await laeuft(s, 'haupt');
    await setzeEinstellungen({ pause: false });
  } finally {
    await s.close();
  }
});

test('Video in offener Shadow Root bekommt den Riegel', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', ziel: 'schatten', autoplay: true });
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Rueckfall-Video gesperrt, danach erscheint ein Adapter-Treffer: nur dieser bleibt gesperrt, das andere bekommt den Ton zurueck und startet nicht', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'rueckfall', ziel: 'fremd', autoplay: true, abspielen: true, muted: false });
    await expect.poll(async () => (await video(s, 'rueckfall')).paused, { timeout: 10_000 }).toBe(true);
    expect((await video(s, 'rueckfall')).muted).toBe(true); // gesperrt: stumm
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await expect.poll(async () => (await video(s, 'haupt')).paused, { timeout: 10_000 }).toBe(true);
    // Das Rueckfall-Video ist kein Ziel mehr: Ton zurueck (es war nicht stumm), kein Selbststart
    await expect.poll(async () => (await video(s, 'rueckfall')).muted, { timeout: 5000, intervals: [50] }).toBe(false);
    await s.waitForTimeout(800);
    expect((await video(s, 'rueckfall')).paused).toBe(true);
    await bleibtStehen(s, 'haupt');
    expect((await video(s, 'haupt')).muted).toBe(true);
  } finally {
    await s.close();
  }
});

test('Leeres Platzhalter-Video in #player verdraengt das gesperrte Rueckfall-Video nicht; erst der echte Treffer tut es', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'rueckfall', ziel: 'fremd', autoplay: true, abspielen: true, muted: false });
    await expect.poll(async () => (await video(s, 'rueckfall')).paused, { timeout: 10_000 }).toBe(true);
    await s.evaluate(() => {
      const leer = document.createElement('video'); // ohne Quelle
      leer.id = 'platzhalter';
      document.getElementById('player')!.appendChild(leer);
    });
    await s.waitForTimeout(1200);
    const r = await video(s, 'rueckfall');
    expect(r.paused).toBe(true);
    expect(r.muted).toBe(true); // weiter gesperrt
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await expect.poll(async () => (await video(s, 'haupt')).paused, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await video(s, 'rueckfall')).muted, { timeout: 5000, intervals: [50] }).toBe(false);
  } finally {
    await s.close();
  }
});

test('Video in einer deklarativen Shadow Root (template shadowrootmode) bekommt den Riegel', async () => {
  const s = await oeffneSeite();
  try {
    await s.evaluate(() => {
      const h = document.createElement('div');
      document.body.appendChild(h);
      (h as any).setHTMLUnsafe(
        '<div id="dsd"><template shadowrootmode="open"><style>video{width:640px;height:360px;display:block}</style><video id="dsdv" autoplay muted playsinline></video></template></div>',
      );
    });
    await s.evaluate(() => {
      const v = document.getElementById('dsd')!.shadowRoot!.getElementById('dsdv') as HTMLVideoElement;
      v.src = (window as any).neueQuelle();
      v.play().catch(() => {});
    });
    await riegelOffen(s);
    const stand = () => s.evaluate(() => {
      const v = document.getElementById('dsd')!.shadowRoot!.getElementById('dsdv') as HTMLVideoElement;
      return { paused: v.paused, t: v.currentTime };
    });
    const a = await stand();
    await s.waitForTimeout(700);
    const b = await stand();
    expect(a.paused && b.paused).toBe(true);
    expect(b.t - a.t).toBeLessThan(0.02);
  } finally {
    await s.close();
  }
});

test('Galerie des Komplett-Ersatzes (html[data-veil-ersatz]): kein Riegel, das Video laeuft; danach wieder Riegel', async () => {
  const s = await oeffneSeite();
  try {
    await s.evaluate(() => document.documentElement.setAttribute('data-veil-ersatz', ''));
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(500);
    expect(await hostDa(s)).toBe(false);
    await s.evaluate(() => document.documentElement.removeAttribute('data-veil-ersatz'));
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Anderer Riegel offen (Freilegen): das Video bleibt gesperrt, der naechste Abspielversuch fragt erneut', async () => {
  const s = await oeffneSeite();
  try {
    await s.evaluate(() =>
      document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ riegel: { oeffne: { grund: 'freilegen', frage: 'test-w1', verweigern: 0 } } }) })),
    );
    const a = await riegelOffen(s);
    expect(a.frage.id).toBe('test-w1');
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await s.waitForTimeout(1500);
    await bleibtStehen(s, 'haupt');
    await loese(s); // Freilegen-Riegel loesen und schliessen
    await s.waitForTimeout(1200);
    expect((await video(s, 'haupt')).paused).toBe(true);
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Ende ohne loop und erneutes Abspielen: kein neues Quiz', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, loop: false });
    await riegelOffen(s);
    await loese(s);
    await expect.poll(async () => (await video(s, 'haupt')).ended, { timeout: 15_000 }).toBe(true);
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await s.waitForTimeout(800);
    expect(await hostDa(s)).toBe(false);
    const v = await video(s, 'haupt');
    expect(v.ended).toBe(false);
    expect(v.paused).toBe(false);
  } finally {
    await s.close();
  }
});

test('Seitenwechsel ohne Neuladen: von einem Ausnahmepfad auf eine Videoseite bekommt das laufende Video den Riegel', async () => {
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1/erwachsen-player'] });
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(500);
    expect(await hostDa(s)).toBe(false);
    await s.evaluate(() => history.pushState({}, '', '/watch?v=2'));
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    await s.evaluate(() => history.back());
    await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
    await setzeEinstellungen({ ausnahmen: [] });
  }
});

test('Pack entfernt: Sperre weg, Video laeuft', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    await entfernePack();
    await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

// Listenseite (Live-Lauf 17, MITTEL 2): ein Autoplay ohne Geste loest keinen Riegel aus, ein Klick auf das Video schon.
const aufListe = (s: Page, pfad: string) => s.evaluate((p) => history.pushState({}, '', p), pfad);
test('Listenseiten-Faelle: Pack wieder einsetzen', async () => {
  await importierePack(packPfad);
  await setzeEinstellungen(EINST);
});
async function klickeAufVideo(s: Page, id: string) {
  const r = await s.evaluate((i) => {
    const b = (window as any).findeVideo(i).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, id);
  await s.mouse.click(r.x, r.y);
}

test('Listenseite (Suche): Autoplay ohne Geste bleibt angehalten und ohne Riegel; Klick auf das Video oeffnet den Riegel', async () => {
  const s = await oeffneSeite();
  try {
    await aufListe(s, '/search/mia');
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await s.evaluate(() => (window as any).klickSpielt('haupt'));
    await s.waitForTimeout(1800);
    expect(await hostDa(s)).toBe(false);
    expect((await video(s, 'haupt')).muted).toBe(true);
    await bleibtStehen(s, 'haupt');
    await klickeAufVideo(s, 'haupt');
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Listenseite (Startseite): Klick ausserhalb des Videos ist keine Geste fuer das Video, Taste und Klick darauf schon', async () => {
  const s = await oeffneSeite();
  try {
    await aufListe(s, '/');
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await s.waitForTimeout(600);
    expect(await hostDa(s)).toBe(false);
    // Klick weit ausserhalb (Ecke oben links, ausserhalb von Video und Player), danach ein Abspielversuch der Seite
    await s.mouse.click(1, 1);
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await s.waitForTimeout(1200);
    expect(await hostDa(s)).toBe(false);
    await bleibtStehen(s, 'haupt');
    // Taste, dann Abspielversuch: Geste
    await s.keyboard.press('Enter');
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await riegelOffen(s);
  } finally {
    await s.close();
  }
});

test('Listenseite verlassen (Adresswechsel ohne Neuladen auf eine Videoseite): das wartende Autoplay-Video bekommt den Riegel', async () => {
  const s = await oeffneSeite();
  try {
    await aufListe(s, '/');
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await s.waitForTimeout(1500);
    expect(await hostDa(s)).toBe(false);
    await aufListe(s, '/video/12345');
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

// Fund 6: ein Capture-Horcher der Seite auf window, der Zeiger und Tasten stoppt, nimmt dem Riegel die Geste nicht.
test('Listenseite: ein Capture-Horcher der Seite auf window, der Zeiger und Klicks stoppt, verhindert die Geste nicht', async () => {
  const s = await oeffneSeite();
  try {
    await aufListe(s, '/search/mia');
    await s.evaluate(() => {
      for (const t of ['pointerdown', 'mousedown', 'click', 'keydown', 'touchstart']) window.addEventListener(t, (e) => e.stopImmediatePropagation(), true);
    });
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await s.waitForTimeout(800);
    expect(await hostDa(s)).toBe(false);
    await klickeAufVideo(s, 'haupt');
    // Der Klick erreicht den Player der Seite nicht (ihr Horcher stoppt ihn): ihr Abspielversuch folgt wie bei einem Player, der die Geste selbst auswertet.
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

// Fund 7: Videoseiten unter /model, /channels, /pornstar sind keine Listen: Riegel wie bisher, auch ohne Geste.
test('Videoseite unter /model/<name>/video/<nr> (kein Listenpfad): Autoplay bekommt den Riegel ohne Geste', async () => {
  const s = await oeffneSeite();
  try {
    await aufListe(s, '/model/mia/video/123');
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

// Fund 8: ein wartendes Video auf einer Listenseite hat keinen Riegel; ohne Vorschau-Bild (hier: Freischaltung `erwachsen:vorschau` fehlt) deckt ein
// schlichter dunkler Deckel statt des offenen Einzelbilds, wie vor Paket H der Riegel.
test('Listenseite, wartendes Video ohne Vorschau-Bild: dunkler Deckel liegt auf dem Video und weicht dem Riegel nach der Geste', async () => {
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const p = (await api.storage.local.get('pack')).pack;
    await api.storage.local.set({ pack: { ...p, freischaltungen: p.freischaltungen.filter((f: string) => f !== 'erwachsen:vorschau') } });
  });
  const s = await oeffneSeite();
  try {
    await aufListe(s, '/search/mia');
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    const deckel = () =>
      s.evaluate(() => {
        const h = document.querySelector('[data-veil-standbild]') as HTMLElement | null;
        if (!h) return null;
        const v = (window as any).findeVideo('haupt').getBoundingClientRect();
        const r = h.getBoundingClientRect();
        return { art: h.getAttribute('data-veil-standbild'), deckt: r.left <= v.left + 1 && r.top <= v.top + 1 && r.right >= v.right - 1 && r.bottom >= v.bottom - 1 };
      });
    await expect.poll(deckel, { timeout: 8000 }).toEqual({ art: 'deckel', deckt: true });
    expect(await hostDa(s)).toBe(false);
    await bleibtStehen(s, 'haupt');
    await s.evaluate(() => (window as any).klickSpielt('haupt'));
    await klickeAufVideo(s, 'haupt');
    await riegelOffen(s);
  } finally {
    await s.close();
  }
});
