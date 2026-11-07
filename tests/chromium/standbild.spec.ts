// Chromium: Standbild des Hauptvideos ganz durch Mia (Phase 8, Auftrag K2). Solange das Quiz nicht geloest ist, liegt ein Mia-Vorschau-Bild der
// gewaehlten Stufe ueber dem Hauptvideo (Host `data-veil-standbild`, nur im Testbau). Seite wie player.spec.ts (tests/fixtures/erwachsen-player.html).
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


const STANDBILD = '[data-veil-standbild]';
const standbild = (s: Page) =>
  s.evaluate((sel) => {
    const h = document.querySelector(sel) as HTMLElement | null;
    if (!h) return null;
    const v = document.querySelector('video') as HTMLVideoElement;
    const r = h.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return { name: h.getAttribute('data-veil-standbild'), geladen: h.getAttribute('data-veil-standbild-geladen'), r: { x: r.x, y: r.y, w: r.width, h: r.height }, vr: { x: vr.x, y: vr.y, w: vr.width, h: vr.height }, anzahl: document.querySelectorAll(sel).length };
  }, STANDBILD);
async function standbildBereit(s: Page) {
  await expect.poll(async () => (await standbild(s))?.geladen ?? null, { timeout: 15_000, intervals: [100] }).toBe('1');
  return (await standbild(s))!;
}

test('ohne Pack: kein Standbild, das Video laeuft wie heute', async () => {
  await setzeEinstellungen(EINST);
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(800);
    expect(await standbild(s)).toBeNull();
  } finally {
    await s.close();
  }
});

test('mit Pack: Standbild liegt auf dem Hauptvideo, Stufe Tease waehlt nur milde Bilder, nach geloestem Quiz weg und Video laeuft', async () => {
  await importierePack(packPfad);
  await setzeEinstellungen({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'tease' } });
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    const a = await standbildBereit(s);
    expect(a.anzahl).toBe(1);
    expect(['vorschau/dummy-1.webp', 'vorschau/dummy-3.webp']).toContain(a.name);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a.r[k] - a.vr[k])).toBeLessThanOrEqual(1);
    // Klick durch den Host aufs Video (pointer-events none): das Video bekommt ihn, der Riegel geht auf, das Standbild bleibt.
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await riegelOffen(s);
    expect((await standbild(s))?.geladen).toBe('1');
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await expect.poll(() => standbild(s), { timeout: 10_000 }).toBeNull();
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Stufe Hot: Standbild bleibt eines der erlaubten Bilder und wechselt bei Stufenwechsel ohne Neuladen', async () => {
  await setzeEinstellungen({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'hot' } });
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    const a = await standbildBereit(s);
    expect(a.name).toMatch(/^vorschau\/dummy-[1-4]\.webp$/);
    await setzeEinstellungen({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'tease' } });
    await expect.poll(async () => (await standbild(s))?.name, { timeout: 10_000 }).toMatch(/^vorschau\/dummy-[13]\.webp$/);
  } finally {
    await s.close();
  }
});

test('Pause gibt alles frei, Pause aus bringt das Standbild zurueck', async () => {
  await setzeEinstellungen(EINST);
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    await setzeEinstellungen({ pause: true });
    await expect.poll(() => standbild(s), { timeout: 10_000 }).toBeNull();
    await setzeEinstellungen({ pause: false });
    await standbildBereit(s);
  } finally {
    await s.close();
  }
});

test('Seite ohne Erwachsenen-Stand und Vorschau-Karte: kein Standbild', async () => {
  const s = await oeffneSeite(NEUTRAL);
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.waitForTimeout(1000);
    expect(await standbild(s)).toBeNull();
  } finally {
    await s.close();
  }
});

// Der Host hat pointer-events none; fuer die Stapelpruefung wird es kurz aufgehoben: liegt er oben, trifft elementFromPoint ihn.
const hostOben = (s: Page) =>
  s.evaluate(() => {
    const h = document.querySelector('[data-veil-standbild]') as HTMLElement;
    h.style.setProperty('pointer-events', 'auto', 'important');
    const r = h.getBoundingClientRect();
    const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    h.style.setProperty('pointer-events', 'none', 'important');
    return e === h;
  });
const nahe = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, tol = 2) =>
  (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(a[k] - b[k]) <= tol);

test('z-index: ein Video mit eigenem z-index malt nicht ueber dem Standbild', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.evaluate(() => {
      const v = (window as any).findeVideo('haupt');
      v.style.position = 'relative';
      v.style.zIndex = '50';
    });
    await standbildBereit(s);
    await expect.poll(() => hostOben(s), { timeout: 5000 }).toBe(true);
  } finally {
    await s.close();
  }
});

test('Adapter-Seite: Poster-Ebene des Players liegt unter dem Standbild, der Anker wird gedeckt', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.evaluate(() => (window as any).posterEbene());
    const a = await standbildBereit(s);
    const anker = await s.evaluate(() => {
      const r = document.getElementById('player')!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(nahe(a.r, anker)).toBe(true);
    expect(await s.evaluate(() => parseInt(getComputedStyle(document.querySelector('[data-veil-standbild]')!).zIndex, 10))).toBeGreaterThanOrEqual(7);
    expect(await hostOben(s)).toBe(true);
  } finally {
    await s.close();
  }
});

test('Video nur mit Poster und ohne Quelle (preload none) bekommt das Standbild, auf der Adapter-Seite und im Rueckfall', async () => {
  for (const url of [ADAPTER_SEITE, SEITE]) {
    const s = await oeffneSeite(url);
    try {
      await s.evaluate(() => {
        const v = document.createElement('video');
        v.id = 'haupt';
        v.preload = 'none';
        v.poster = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        document.getElementById('player')!.appendChild(v);
      });
      await standbildBereit(s);
    } finally {
      await s.close();
    }
  }
});

test('Video mit Groesse 0, das spaeter waechst, bekommt das Standbild dann', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.evaluate(() => ((window as any).findeVideo('haupt').style.cssText = 'width:0px;height:0px'));
    await s.waitForTimeout(800);
    expect(await standbild(s)).toBeNull();
    await s.evaluate(() => ((window as any).findeVideo('haupt').style.cssText = ''));
    await standbildBereit(s);
  } finally {
    await s.close();
  }
});

test('Lage: zentriertes, skaliertes und festes Video, das Standbild folgt der gemessenen Flaeche', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    await s.evaluate(() => {
      document.getElementById('player')!.style.position = 'relative';
      (window as any).findeVideo('haupt').style.cssText = 'position:absolute;left:50%;top:50%;width:320px;height:180px;transform:translate(-50%,-50%) scale(1.5)';
    });
    await expect.poll(async () => { const a = (await standbild(s))!; return nahe(a.r, a.vr); }, { timeout: 6000 }).toBe(true);
    await s.evaluate(() => ((window as any).findeVideo('haupt').style.cssText = 'position:fixed;left:100px;top:50px;width:300px;height:170px'));
    await expect.poll(async () => { const a = (await standbild(s))!; return nahe(a.r, a.vr); }, { timeout: 6000 }).toBe(true);
  } finally {
    await s.close();
  }
});

// K2, zweite Lesung (Orchestrator): nur die Videoflaeche wird gedeckt, Bedienleiste daneben bleibt sichtbar; ein fester Dialog der Seite liegt
// ueber dem Standbild (z-index gedeckelt); ein klebender Player wird beim Rollen ohne freie Streifen gedeckt.
test('Adapter-Seite: Leiste neben dem Video bleibt sichtbar, Cookie-Dialog liegt oben, klebender Player beim Rollen', async () => {
  const s = await oeffneSeite(ADAPTER_SEITE);
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.evaluate(() => {
      const p = document.getElementById('player')!;
      p.style.position = 'relative';
      const leiste = document.createElement('div');
      leiste.id = 'leiste';
      leiste.style.cssText = 'height:48px;background:rgb(0,0,255);position:relative;z-index:3';
      leiste.textContent = 'Like';
      p.appendChild(leiste);
    });
    const a = await standbildBereit(s);
    expect(nahe(a.r, a.vr), 'Host liegt genau auf dem Video').toBe(true);
    const leiste = await s.evaluate(() => {
      const r = document.getElementById('leiste')!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(a.r.y + a.r.h <= leiste.y + 1, 'Host deckt die Leiste nicht').toBe(true);
    expect(await hostOben(s)).toBe(true);
    // Fester Dialog der Seite ueber dem Player: er bleibt oben
    const dialogOben = await s.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'cookie';
      d.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;background:rgba(255,255,255,0.9)';
      document.body.appendChild(d);
      const h = document.querySelector('[data-veil-standbild]') as HTMLElement;
      const r = h.getBoundingClientRect();
      h.style.setProperty('pointer-events', 'auto', 'important');
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      h.style.setProperty('pointer-events', 'none', 'important');
      d.remove();
      return e?.id ?? '';
    });
    expect(dialogOben, 'Cookie-Dialog liegt ueber dem Standbild').toBe('cookie');
    // Klebender Player: lange Seite, Player klebt oben, waehrend des Rollens deckt der Host das Video
    await s.evaluate(() => {
      const p = document.getElementById('player')!;
      p.style.position = 'sticky';
      p.style.top = '0px';
      const lang = document.createElement('div');
      lang.style.height = '3000px';
      document.body.appendChild(lang);
    });
    let schlecht = 0;
    for (let y = 100; y <= 1500; y += 200) {
      await s.evaluate((yy) => scrollTo(0, yy), y);
      await s.waitForTimeout(60);
      const b = (await standbild(s))!;
      if (!nahe(b.r, b.vr, 3)) schlecht++;
    }
    expect(schlecht, 'Host folgt dem klebenden Player beim Rollen').toBe(0);
  } finally {
    await s.close();
  }
});

test('Stufenwechsel Hot zu Tease: nie ein Name der schaerferen Stufe, dazwischen dunkle Decke', async () => {
  await setzeEinstellungen({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'hot' } });
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    await s.evaluate(() => {
      (window as any).namen = [];
      new MutationObserver(() => (window as any).namen.push(document.querySelector('[data-veil-standbild]')?.getAttribute('data-veil-standbild'))).observe(document.body.parentElement!, { attributes: true, subtree: true, attributeFilter: ['data-veil-standbild'] });
    });
    await setzeEinstellungen({ ...EINST, erwachsen: { ...EINST.erwachsen, stufe: 'tease' } });
    await expect.poll(async () => (await standbild(s))?.name, { timeout: 10_000 }).toMatch(/^vorschau\/dummy-[13]\.webp$/);
    const namen = (await s.evaluate(() => (window as any).namen)) as string[];
    expect(namen).toContain('wartet');
    expect(namen.filter((n) => /dummy-[24]/.test(n))).toEqual([]);
  } finally {
    await s.close();
  }
});

test('Klick, Tastatur und Seitenwechsel: echter Mausklick aufs Video, Enter auf einem Knopf, pushState mit neuer Quelle', async () => {
  await setzeEinstellungen(EINST);
  // Mausklick durch den Host (pointer-events none) aufs Video: die Seite spielt, der Riegel geht auf
  let s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await s.evaluate(() => (window as any).klickSpielt('haupt'));
    const a = await standbildBereit(s);
    await s.mouse.click(a.vr.x + a.vr.w / 2, a.vr.y + a.vr.h / 2);
    await riegelOffen(s);
    expect((await standbild(s))?.geladen).toBe('1');
    await bleibtStehen(s, 'haupt');
    await loese(s);
    await expect.poll(() => standbild(s), { timeout: 10_000 }).toBeNull();
    // pushState mit Quellwechsel: neues Video, neues Quiz, das Standbild ist wieder da
    await s.evaluate(() => {
      history.pushState({}, '', '?viewkey=zz1');
      (window as any).findeVideo('haupt').src = (window as any).datenQuelle(1);
    });
    await standbildBereit(s);
  } finally {
    await s.close();
  }
  // Tastatur: Enter auf dem Abspielknopf der Seite
  s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    await s.focus('#spielen');
    await s.keyboard.press('Enter');
    await riegelOffen(s);
    expect((await standbild(s))?.geladen).toBe('1');
    await bleibtStehen(s, 'haupt');
  } finally {
    await s.close();
  }
});

test('Bild-in-Bild ist gesperrt, solange das Standbild liegt, und danach zurueckgenommen', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    expect(await s.evaluate(() => (window as any).findeVideo('haupt').disablePictureInPicture)).toBe(true);
    await s.evaluate(() => (window as any).findeVideo('haupt').play().catch(() => {}));
    await riegelOffen(s);
    await loese(s);
    await expect.poll(() => s.evaluate(() => (window as any).findeVideo('haupt').disablePictureInPicture), { timeout: 5000 }).toBe(false);
  } finally {
    await s.close();
  }
});

test('Vollbild unter dem Standbild wird sofort verlassen', async () => {
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    await s.evaluate(() => {
      (window as any).vb = 0;
      document.addEventListener('fullscreenchange', () => (window as any).vb++);
    });
    await s.click('#vollbild');
    const ging = await s.waitForFunction(() => (window as any).vb >= 1, null, { timeout: 4000 }).then(() => true, () => false);
    test.skip(!ging, 'Vollbild ist in dieser Umgebung nicht moeglich');
    await s.waitForFunction(() => (window as any).vb >= 2, null, { timeout: 6000 });
    expect(await s.evaluate(() => document.fullscreenElement === null)).toBe(true);
  } finally {
    await s.close();
  }
});


test('Strenge Seiten-CSP (style-src ohne unsafe-inline): das Standbild kommt trotzdem, ueber CSSOM und adoptedStyleSheets', async () => {
  const s = await context.newPage();
  try {
    await s.route(SEITE, async (r) => {
      const a = await r.fetch();
      await r.fulfill({ response: a, headers: { ...a.headers(), 'content-security-policy': "style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:" } });
    });
    await s.goto(SEITE);
    await s.waitForFunction(() => document.documentElement.dataset.filmBereit === '1', null, { timeout: 30_000 });
    await neuesVideo(s, { id: 'haupt' });
    const a = await standbildBereit(s);
    expect(nahe(a.r, a.vr)).toBe(true);
    expect(await hostOben(s)).toBe(true);
  } finally {
    await s.close();
  }
});

test('Pack entfernt: Standbild weg', async () => {
  await setzeEinstellungen(EINST);
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt' });
    await standbildBereit(s);
    await entfernePack();
    await expect.poll(() => standbild(s), { timeout: 10_000 }).toBeNull();
  } finally {
    await s.close();
  }
});
