// Chromium: strenge Zeiten (Auftrag Z1, Phase 5 Session 10, Entscheidung 116). In einem eingestellten Fenster ist die Steigerung eine Stufe hoeher
// (der gespeicherte Stand bleibt), das Popup zeigt die Stufe und "Strict time until HH:MM", und auf jeder Seite gilt der Quiz-Riegel vor Videos.
// Alles nur mit Freischaltung `kontrolle:zeitplan`; Pause gibt frei. Das Fenster setzen die Tests selbst (heutiger Wochentag, ganzer Tag), die
// Neubewertung kommt durch die Einstellungsaenderung. Einzig der Player-Zeitgeber auf den Fensterbeginn laeuft von selbst (ein Fall, bis 90 s).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textAusMinuten } from '../../src/kontrolle/streng';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
// Die Seite gilt NICHT als Erwachsenenseite (eigeneSeiten nennt nur 127.0.0.1); das Riegel-Abbild gibt es auch auf localhost.
const NEUTRAL = `http://localhost:${port}/erwachsen-player.html`;
const STEIGERUNG_SEITE = `http://127.0.0.1:${port}/steigerung.html?veil-steigerung-takt=400`;
const EINST = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } };
const bauModul = '../../scripts/pack/baue-pack.mjs';
const inhaltModul = '../../scripts/pack/dummy-inhalte.mjs';

const heute = new Date().getDay();
const morgen = (heute + 1) % 7;
const GANZ_HEUTE = [{ tage: [heute], von: 0, bis: 0 }];
const NUR_MORGEN = [{ tage: [morgen], von: 0, bis: 0 }];

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
let fragen: any[] = [];
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const kurz = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 0, vorschau: 0, chibis: 0, groesse: 1, importiert: 1 });
const stand = (s: Record<string, unknown>) => ({ version: 1, stufe: 0, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null, ...s });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-streng-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-streng-pack-'));
  const bau = (await import(bauModul)) as { baueDummyPack(o?: unknown): Promise<{ bytes: Uint8Array }> };
  const inhalt = (await import(inhaltModul)) as { DUMMY_QUIZ: { fragen: any[] } };
  fragen = inhalt.DUMMY_QUIZ.fragen.filter((f) => f.art === 'wissen' || f.art === 'allgemein');
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack({ quiz: { version: 1, fragen } })).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`, '--autoplay-policy=no-user-gesture-required'],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

const schreibe = (o: Record<string, unknown>) => worker.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const lies = (k: string) => worker.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
async function setzeZeiten(zeiten: unknown[]) {
  await worker.evaluate(async (z) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, kontrolle: { ...(alt.kontrolle ?? {}), zeiten: z } } });
  }, zeiten);
}
async function importierePack() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(packPfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
    await s.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
  } finally {
    await s.close();
  }
}

// ---------- Popup ----------
async function popupText(mitStufe = true): Promise<{ stufe: string; streng: string; strengSichtbar: boolean; zeit: string; kommentar: string }> {
  const p = await context.newPage();
  try {
    await p.goto(`chrome-extension://${erweiterungsId}/popup.html`);
    if (mitStufe) await expect(p.locator('#stufe-zeile')).toContainText('Level', { timeout: 15_000 });
    else await expect(p.locator('#streng-zeile')).toBeVisible({ timeout: 15_000 });
    return await p.evaluate(() => {
      const z = document.getElementById('streng-zeile')!;
      return { stufe: document.getElementById('stufe-zeile')!.textContent ?? '', streng: z.textContent ?? '', strengSichtbar: !z.hidden, zeit: document.getElementById('stufe-zeit')!.textContent ?? '', kommentar: document.getElementById('streng-text')!.textContent ?? '' };
    });
  } finally {
    await p.close();
  }
}

test('Popup: Stufe 0 wird 1 in einer strengen Zeit mit Zeile "Strict time until", unveraendert ohne Freischaltung, ohne Fenster und in der Pause', async () => {
  await setzeEinstellungen(EINST);
  await schreibe({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']), steigerung: stand({ stufe: 0 }) });
  // Fenster von vor 10 Minuten bis in 60 Minuten (ueber Mitternacht erlaubt): die Zeile nennt das Ende.
  const jetzt = new Date();
  const m = jetzt.getHours() * 60 + jetzt.getMinutes();
  const von = (m - 10 + 1440) % 1440;
  const bis = (m + 60) % 1440;
  const tage = [heute, (heute + 6) % 7];
  await setzeZeiten([{ tage, von, bis }]);
  let p = await popupText();
  expect(p.stufe).toContain('Level 1 of 4');
  expect(p.strengSichtbar).toBe(true);
  expect(p.streng).toMatch(new RegExp(`^Strict time until .*[:.]${String(bis % 60).padStart(2, '0')}`)); // Uhrzeit im Format des Gebietsschemas
  expect(p.zeit).toBe('One level up for these hours.');
  expect(p.kommentar.length).toBeGreaterThan(10);
  expect(p.streng).not.toMatch(/[–—]/);
  expect((await lies('steigerung')).stufe).toBe(0); // der gespeicherte Stand bleibt
  // Stufe 4 bleibt 4, Stufe 3 wird 4
  await schreibe({ steigerung: stand({ stufe: 3 }) });
  expect((await popupText()).stufe).toContain('Level 4 of 4');
  await schreibe({ steigerung: stand({ stufe: 4 }) });
  expect((await popupText()).stufe).toContain('Level 4 of 4');
  await schreibe({ steigerung: stand({ stufe: 0 }) });
  // Alle Tage ganztags: kein Wechsel, Rueckfalltext
  await setzeZeiten([{ tage: [0, 1, 2, 3, 4, 5, 6], von: 0, bis: 0 }]);
  p = await popupText();
  expect(p.stufe).toContain('Level 1 of 4');
  expect(p.strengSichtbar).toBe(true);
  expect(p.streng).toBe('Strict time, around the clock');
  // ohne Freischaltung kontrolle:zeitplan
  await schreibe({ pack: kurz(['zensur:steigerung']) });
  p = await popupText();
  expect(p.stufe).toContain('Level 0 of 4');
  expect(p.strengSichtbar).toBe(false);
  // Fenster nicht heute
  await schreibe({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']) });
  await setzeZeiten(NUR_MORGEN);
  p = await popupText();
  expect(p.stufe).toContain('Level 0 of 4');
  expect(p.strengSichtbar).toBe(false);
  // Pause
  await setzeZeiten(GANZ_HEUTE);
  await setzeEinstellungen({ pause: true });
  p = await popupText();
  expect(p.stufe).toContain('Level 0 of 4');
  expect(p.strengSichtbar).toBe(false);
  await setzeEinstellungen({ pause: false });
  // Streng-Zeile auch ohne Steigerung im Pack
  await schreibe({ pack: kurz(['kontrolle:zeitplan']) });
  p = await popupText(false);
  expect(p.strengSichtbar).toBe(true);
  console.log(`chromium: Popup Stufe 0 auf 1, Zeile "${p.streng}" (ganzer Tag), Fenster endet ${textAusMinuten(bis)}`);
});

// ---------- Steigerung im Content-Script ----------
test('Steigerung: eine Stufe hoeher im Fenster (Stufe 1 wird 2, YuNet laeuft), nicht ohne Freischaltung, nicht ausserhalb, Stand unveraendert', async () => {
  const stufe1 = stand({ stufe: 1 });
  await schreibe({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']), steigerung: stufe1 });
  await setzeEinstellungen({ ...EINST, pause: false });
  await setzeZeiten(NUR_MORGEN);
  const seite = await context.newPage();
  try {
    await seite.goto(STEIGERUNG_SEITE);
    await expect(seite.locator('#bild')).toHaveAttribute('data-veil', /frei|zensiert|verdeckt/, { timeout: 30_000 });
    let nr = 0;
    const laeufe = async (): Promise<number> => {
      const n = ++nr;
      await seite.evaluate((n) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ erkennerStatus: n }) })), n);
      await expect.poll(async () => JSON.parse((await seite.locator('html').getAttribute('data-veil-erkenner')) ?? '{}').nr).toBe(n);
      return JSON.parse((await seite.locator('html').getAttribute('data-veil-erkenner')) ?? '{}').antwort?.gesichtLaeufe ?? -1;
    };
    const vorher = await laeufe();
    // Fenster nicht heute: Stufe 1, keine Gesichtszonen
    await seite.waitForTimeout(1500);
    expect(await laeufe()).toBe(vorher);
    // Fenster heute, aber das Pack hat keine Freischaltung kontrolle:zeitplan: nichts aendert sich
    await schreibe({ pack: kurz(['zensur:steigerung']) });
    await setzeZeiten(GANZ_HEUTE);
    await seite.waitForTimeout(2000);
    expect(await laeufe()).toBe(vorher);
    // Fenster heute und Freischaltung: Stufe 2, Gesicht, Augen, Mund an, YuNet laeuft
    await schreibe({ pack: kurz(['zensur:steigerung', 'kontrolle:zeitplan']) });
    await expect.poll(laeufe, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(vorher);
    const nachher = await laeufe();
    // Der gespeicherte Stand blieb stehen
    const s = await lies('steigerung');
    expect(s.stufe).toBe(1);
    // Ohne Steigerungs-Freischaltung bleibt es bei 0, auch im Fenster (Zonen der Einstellungen unveraendert, kein weiterer Lauf)
    await schreibe({ pack: kurz(['kontrolle:zeitplan']), steigerung: stand({ stufe: 0 }) });
    await seite.waitForTimeout(2000);
    const ohneSteigerung = await laeufe();
    await seite.waitForTimeout(1500);
    expect(await laeufe()).toBe(ohneSteigerung);
    console.log(`chromium: Steigerung im Fenster, YuNet-Laeufe ${vorher} auf ${nachher}`);
  } finally {
    await seite.close();
  }
});

// ---------- Player ----------
type Abbild = any;
const abbild = (s: Page): Promise<Abbild | null> =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-riegel');
    return a ? JSON.parse(a) : null;
  });
const hostDa = (s: Page) => s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null);
async function riegelOffen(s: Page, frist = 15_000): Promise<Abbild> {
  let letzter: Abbild | null = null;
  await expect
    .poll(async () => ((letzter = await abbild(s)), !!letzter && letzter.offen && letzter.zustand === 'frage'), { timeout: frist, intervals: [100] })
    .toBe(true);
  return letzter;
}
async function loese(s: Page) {
  const a = await riegelOffen(s);
  const f = fragen.find((q) => q.id === a.frage.id);
  const ziel = a.antworten.find((b: any) => b.text === f.antworten[f.richtig]);
  await s.mouse.click(ziel.x + ziel.w / 2, ziel.y + ziel.h / 2);
  await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
}
const video = (s: Page, id: string) =>
  s.evaluate((i) => {
    const v = (window as any).findeVideo(i) as HTMLVideoElement;
    return { paused: v.paused, t: v.currentTime, muted: v.muted };
  }, id);
async function oeffneSeite(): Promise<Page> {
  const s = await context.newPage();
  await s.goto(NEUTRAL);
  await s.waitForFunction(() => document.documentElement.dataset.filmBereit === '1', null, { timeout: 40_000 });
  return s;
}
const neuesVideo = (s: Page, o: Record<string, unknown>) => s.evaluate((x) => (window as any).neuesVideo(x) && true, o);
async function laeuft(s: Page, id: string) {
  const a = await video(s, id);
  await expect.poll(async () => (await video(s, id)).t - a.t, { timeout: 8000 }).toBeGreaterThan(0.2);
}
async function steht(s: Page, id: string) {
  const a = await video(s, id);
  await s.waitForTimeout(700);
  const b = await video(s, id);
  expect(a.paused && b.paused).toBe(true);
  expect(b.t - a.t).toBeLessThan(0.02);
}

test('Player: auf einer normalen Seite in strenger Zeit der Riegel, ausserhalb, ohne Freischaltung und in der Pause nicht', async () => {
  await importierePack();
  await setzeEinstellungen(EINST);
  await setzeZeiten(NUR_MORGEN);
  // Kein Fenster jetzt: das Video laeuft frei
  let s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    expect(await hostDa(s)).toBe(false);
    // Das Fenster beginnt (Einstellungsaenderung): das laufende Video bekommt den Riegel
    await setzeZeiten(GANZ_HEUTE);
    await riegelOffen(s);
    await steht(s, 'haupt');
    // Pause gibt frei, auch ohne Antwort des Hintergrunds
    await setzeEinstellungen({ pause: true });
    await expect.poll(() => hostDa(s), { timeout: 10_000 }).toBe(false);
    await laeuft(s, 'haupt');
    await setzeEinstellungen({ pause: false });
  } finally {
    await s.close();
  }
  // Frische Seite im Fenster: Autoplay-Video gesperrt, richtig geloest laeuft es
  s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    expect((await video(s, 'haupt')).muted).toBe(true);
    await steht(s, 'haupt');
    await loese(s);
    await laeuft(s, 'haupt');
  } finally {
    await s.close();
  }
  // Ohne Freischaltung kontrolle:zeitplan: kein Riegel trotz Fenster
  const roh = await lies('pack');
  await schreibe({ pack: { ...roh, freischaltungen: roh.freischaltungen.filter((f: string) => f !== 'kontrolle:zeitplan') } });
  s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(1500);
    expect(await hostDa(s)).toBe(false);
  } finally {
    await s.close();
  }
  await schreibe({ pack: roh });
});

test('Player: endet das Fenster, bleibt das offene Quiz stehen, ein neues Video ist frei', async () => {
  await setzeZeiten(GANZ_HEUTE);
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true });
    await riegelOffen(s);
    await setzeZeiten(NUR_MORGEN);
    await s.waitForTimeout(1500);
    expect(await hostDa(s)).toBe(true); // das laufende Quiz bleibt
    expect((await abbild(s))?.offen).toBe(true);
    await loese(s);
    await laeuft(s, 'haupt');
    // Neue Quelle nach dem Ende des Fensters: kein neuer Riegel
    await s.evaluate(() => {
      const v = (window as any).findeVideo('haupt') as HTMLVideoElement;
      v.src = (window as any).datenQuelle(1);
      v.play().catch(() => {});
    });
    await laeuft(s, 'haupt');
    await s.waitForTimeout(800);
    expect(await hostDa(s)).toBe(false);
  } finally {
    await s.close();
  }
});

test('Player: beginnt ein Fenster waehrend ein Video laeuft, greift der Zeitgeber beim Fensterbeginn (ohne Einstellungsaenderung)', async () => {
  test.setTimeout(240_000);
  await setzeZeiten(NUR_MORGEN);
  const s = await oeffneSeite();
  try {
    await neuesVideo(s, { id: 'haupt', autoplay: true, abspielen: true });
    await laeuft(s, 'haupt');
    // Fenster ab der naechsten vollen Minute (Tag und Minute aus der Ortszeit), danach nur Wartezeit
    const n = new Date(Date.now() + 60_000);
    const von = n.getHours() * 60 + n.getMinutes();
    const bis = (von + 30) % 1440;
    await setzeZeiten([{ tage: [n.getDay(), (n.getDay() + 6) % 7], von, bis }]);
    const t0 = Date.now();
    await s.waitForTimeout(500);
    expect(await hostDa(s)).toBe(false); // noch nicht
    await riegelOffen(s, 150_000);
    await steht(s, 'haupt');
    console.log(`chromium: Zeitgeber griff nach ${Math.round((Date.now() - t0) / 1000)} s (Fenster ab naechster Minute)`);
  } finally {
    await s.close();
  }
  await setzeZeiten([]);
});
