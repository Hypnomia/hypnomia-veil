// Chromium: Auftrag T (Phase 6, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 7). Ton zu Quiz und Blitzwoertern: Pack-Klaenge als Data-URL aus dem
// Hintergrund, Abspielversuch im Content-Script (Testabbild `data-veil-ton`: Name, Lautstaerke, Ergebnis), nichts ohne Pack, ohne Freischaltung,
// bei Schalter aus, Pause (gespeichert und lokal), eigener Ausnahme; Abstand 300 ms, hoechstens ein Klang zugleich, Pause beendet sofort;
// Schalter, Regler und "Play a sample" der Einstellungsseite mit echten Klicks, Wirkung im Speicher gemessen.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TON_TEXTE } from '../../src/ton/texte';
import { oeffneZugeklapptes } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://127.0.0.1:${port}/ton.html`;
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 };

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean; ohneTon?: boolean; id?: string }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

interface Versuch { nr: number; name: string; lautstaerke: number; ergebnis: string; quelle: string }
interface Abbild { nr: number; versuche: Versuch[]; laufend: string | null; volume: number | null }
const EREIGNIS_ZU_NAME: Record<string, string> = { 'quiz-start': 'quiz', 'quiz-richtig': 'richtig', 'quiz-falsch': 'falsch', 'quiz-verweigert': 'verweigert', blitz: 'trigger' };

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let ohneTonPfad: string;
let altPackPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-ton-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ton-pack-'));
  const bau = await ladeBau();
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  ohneTonPfad = path.join(ordner, 'ohne-ton.miapack');
  await writeFile(ohneTonPfad, (await bau.baueDummyPack({ ohneTon: true, id: 'ohne-ton' })).bytes);
  altPackPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPackPfad, (await bau.baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);
  // Die Autoplay-Regel des Browsers wird fuer den Test gelockert, damit "gespielt" messbar ist; das Verhalten bei abgelehntem Abspielen
  // (still bleiben) deckt der Fall ohne diese Regel ab, siehe unten.
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

async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const setzeSpeicher = (werte: Record<string, unknown>) => worker.evaluate((w) => (globalThis as any).chrome.storage.local.set(w), werte);
const liesSpeicher = (schluessel: string) => worker.evaluate(async (s) => (await (globalThis as any).chrome.storage.local.get(s))[s], schluessel);
const TON_AN = (lautstaerke: number) => ({ ton: { an: true, lautstaerke } });

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
    // Session 11: die Einstellungsseite zeichnet den Pack-Stand erst nach dem Laden (sonst Wettlauf).
    await expect(s.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
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
const abbildVon = async (s: Page): Promise<Abbild | null> => {
  const roh = await s.evaluate(() => document.documentElement.getAttribute('data-veil-ton'));
  return roh ? (JSON.parse(roh) as Abbild) : null;
};
const versucheVon = async (s: Page): Promise<Versuch[]> => (await abbildVon(s))?.versuche ?? [];
const sende = (s: Page, ton: Record<string, unknown>) =>
  s.evaluate((t) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ton: t }) })), ton);
// Sendet ein Ereignis und wartet auf den naechsten Versuch.
async function spieleUndWarte(s: Page, ereignis: string): Promise<Versuch> {
  const vorher = (await abbildVon(s))?.nr ?? 0;
  await sende(s, { ereignis });
  await expect.poll(async () => ((await abbildVon(s))?.nr ?? 0) > vorher, { timeout: 8000, intervals: [30] }).toBe(true);
  return (await versucheVon(s)).at(-1)!;
}
// Sendet ein Ereignis und prueft, dass auch nach 900 ms kein neuer Versuch da ist.
async function erwarteStille(s: Page, ereignis: string, text: string) {
  const vorher = (await abbildVon(s))?.nr ?? 0;
  await sende(s, { ereignis });
  await abwarten(900);
  expect((await abbildVon(s))?.nr ?? 0, text).toBe(vorher);
}
async function neueSeite(): Promise<Page> {
  const s = await context.newPage();
  await s.goto(SEITE);
  await s.bringToFront();
  await expect.poll(() => s.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
  // Das Modul laedt Einstellungen und Pack beim Start; ein erster Aufruf kommt sonst zu frueh.
  await abwarten(700);
  return s;
}
const extSeite = async (): Promise<Page> => {
  const s = await context.newPage();
  await s.goto(optionsUrl());
  await expect(s.locator('#ton-titel')).toBeVisible();
  await abwarten(400);
  return s;
};

test.beforeEach(async () => {
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove(['einstellungen', 'blitzZeitplan']));
  await setzeSpeicher({ quizWarnungGesehen: true });
});

test('ohne Pack: kein Klang, auch nicht mit Ton an', async () => {
  test.setTimeout(60_000);
  await entfernePack();
  await setzeEinstellungen(TON_AN(0.5));
  const s = await neueSeite();
  for (const e of Object.keys(EREIGNIS_ZU_NAME)) await erwarteStille(s, e, `ohne Pack: ${e}`);
  expect((await abbildVon(s))?.nr ?? 0).toBe(0);
  console.log('chromium ton: ohne Pack 5 Ereignisse, 0 Versuche');
  await s.close();
});

test('Einstellungsseite ohne Pack: Abschnitt Sound, Hinweis, Probe ruht, Regler trotzdem stellbar', async () => {
  test.setTimeout(60_000);
  const s = await extSeite();
  try {
    await expect(s.locator('#ton-titel')).toHaveText(TON_TEXTE.titel);
    // Phase 9 (Fund 4): ohne Pack ist Sound zugeklappt; "Set them now" klappt auf.
    await expect(s.locator('#ton-zu-knopf')).toBeVisible();
    await oeffneZugeklapptes(s);
    await expect(s.locator('#ton')).toHaveAttribute('aria-labelledby', 'ton-titel');
    await expect(s.locator('#ton-an')).not.toBeChecked();
    await expect(s.locator('#ton-lautstaerke')).toHaveValue('60');
    await expect(s.locator('#ton-lautstaerke-wert')).toHaveText('60%');
    await expect(s.locator('#ton-pack-hinweis')).toHaveText(TON_TEXTE.hinweisOhnePack);
    await expect(s.locator('#ton-probe')).toHaveText(TON_TEXTE.probe);
    await expect(s.locator('#ton-probe')).toBeDisabled();
    await expect(s.locator('#ton-lautstaerke')).toBeEnabled();
    // echter Klick auf den Schalter (die Beschriftung), Wirkung im Speicher
    await s.locator('#ton-an-zeile').click();
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.an, { timeout: 5000 }).toBe(true);
    await s.locator('#ton-an-zeile').click();
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.an, { timeout: 5000 }).toBe(false);
    // Regler: Klick in die Mitte und Tasten Ende, Anfang
    await s.locator('#ton-lautstaerke').focus();
    await s.keyboard.press('End');
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.lautstaerke, { timeout: 5000 }).toBe(1);
    await expect(s.locator('#ton-lautstaerke-wert')).toHaveText('100%');
    await s.keyboard.press('Home');
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.lautstaerke, { timeout: 5000 }).toBe(0);
    await expect(s.locator('#ton-lautstaerke-wert')).toHaveText('0%');
    const kasten = (await s.locator('#ton-lautstaerke').boundingBox())!;
    await s.mouse.click(kasten.x + kasten.width * 0.25, kasten.y + kasten.height / 2);
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.lautstaerke, { timeout: 5000 }).toBeGreaterThan(0.15);
    const l = (await liesSpeicher('einstellungen')).ton.lautstaerke as number;
    console.log(`chromium ton: Schalter an/aus und Regler Ende 1, Anfang 0, Klick bei 25 Prozent der Breite ergibt ${l} (Speicher)`);
    expect(l).toBeLessThan(0.35);
    await expect(s.locator('#ton-lautstaerke-wert')).toHaveText(`${Math.round(l * 100)}%`);
  } finally {
    await s.close();
  }
});

test('Pack importieren, Hinweis wechselt, Probe frei', async () => {
  test.setTimeout(60_000);
  const s0 = await extSeite();
  const vorher = (await s0.locator('#ton-pack-hinweis').textContent()) ?? '';
  await s0.close();
  await importierePack(packPfad);
  const s = await extSeite();
  try {
    await expect(s.locator('#ton-pack-hinweis')).toHaveText(TON_TEXTE.hinweisMitTon);
    expect(vorher).toBe(TON_TEXTE.hinweisOhnePack);
    await expect(s.locator('#ton-probe')).toBeEnabled();
    expect((await liesSpeicher('pack')).freischaltungen).toContain('ton');
  } finally {
    await s.close();
  }
});

test('Hintergrund packton: Data-URL mit echtem WAV, unbekannter Name und ungueltige Namen null', async () => {
  test.setTimeout(60_000);
  const s = await extSeite();
  try {
    const ergebnisse = await s.evaluate(async () => {
      const api = (globalThis as any).chrome;
      const frage = (name: unknown) => api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packton', name });
      const aus: Record<string, unknown> = {};
      for (const n of ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger', 'unsinn', '../quiz', 42]) aus[String(n)] = await frage(n);
      return aus;
    });
    for (const n of ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger']) {
      const a = ergebnisse[n] as { ok: boolean; dataUrl: string | null };
      expect(a.ok).toBe(true);
      expect(a.dataUrl, n).toMatch(/^data:audio\/wav;base64,/);
      const bytes = Buffer.from(a.dataUrl!.split(',')[1]!, 'base64');
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1')).toBe('WAVE');
    }
    for (const n of ['unsinn', '../quiz', '42']) expect((ergebnisse[n] as { dataUrl: unknown }).dataUrl, n).toBeNull();
    const laenge = (n: string) => Buffer.from(((ergebnisse[n] as { dataUrl: string }).dataUrl).split(',')[1]!, 'base64').length;
    console.log(`chromium ton: packton liefert 5 WAV (quiz ${laenge('quiz')} Bytes, richtig ${laenge('richtig')} Bytes), 3 ungueltige Namen null`);
    expect(laenge('quiz')).toBeGreaterThan(laenge('richtig'));
  } finally {
    await s.close();
  }
});

test('Ton aus (Standard): kein Versuch trotz Pack', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await erwarteStille(s, 'quiz-start', 'Standard aus');
  await setzeEinstellungen({ ton: { an: false, lautstaerke: 0.5 } });
  await abwarten(300);
  await erwarteStille(s, 'blitz', 'Schalter aus');
  expect((await abbildVon(s))?.nr ?? 0).toBe(0);
  await s.close();
});

test('Ton an: alle fuenf Anlaesse spielen ihren Namen mit der eingestellten Lautstaerke, ohne ein Element im DOM', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen(TON_AN(0.4));
  const s = await neueSeite();
  const elementeVorher = await s.evaluate(() => document.getElementsByTagName('*').length);
  const gesehen: string[] = [];
  for (const [ereignis, name] of Object.entries(EREIGNIS_ZU_NAME)) {
    const v = await spieleUndWarte(s, ereignis);
    expect(v.name).toBe(name);
    expect(v.lautstaerke).toBe(0.4);
    gesehen.push(`${v.name}:${v.ergebnis}`);
    await abwarten(380); // Abstand von 300 ms zwischen zwei Starts
  }
  console.log(`chromium ton: 5 Anlaesse bei Lautstaerke 0,4 -> ${gesehen.join(', ')}`);
  expect((await versucheVon(s)).map((v) => v.name)).toEqual(['quiz', 'richtig', 'falsch', 'verweigert', 'trigger']);
  // mit gelockerter Autoplay-Regel muss der Browser jeden Klang wirklich gestartet haben
  expect((await versucheVon(s)).every((v) => v.ergebnis === 'gespielt')).toBe(true);
  // nichts ist im Dokument gelandet: weder ein Audio-Element noch irgendein anderes
  expect(await s.evaluate(() => document.querySelectorAll('audio, source, [data-veil-ton-host]').length)).toBe(0);
  expect(await s.evaluate(() => document.getElementsByTagName('*').length)).toBe(elementeVorher);
  await s.close();
});

test('Abstand: zwei Ereignisse im selben Augenblick ergeben einen Klang, nach 300 ms wieder einer', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen(TON_AN(0.6));
  const s = await neueSeite();
  await s.evaluate(() => {
    for (const e of ['richtig', 'falsch'] as const) void e;
    const sende = (ereignis: string) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ton: { ereignis } }) }));
    sende('quiz-richtig');
    sende('quiz-falsch');
    sende('quiz-falsch');
  });
  await abwarten(500);
  let v = await versucheVon(s);
  console.log(`chromium ton: 3 Ereignisse in einem Augenblick -> ${v.length} Klang (${v.map((x) => x.name).join(',')})`);
  expect(v.map((x) => x.name)).toEqual(['richtig']);
  await abwarten(100);
  await sende(s, { ereignis: 'quiz-falsch' });
  await expect.poll(async () => (await versucheVon(s)).length, { timeout: 5000 }).toBe(2);
  v = await versucheVon(s);
  expect(v[1]!.name).toBe('falsch');
  await s.close();
});

test('hoechstens ein Klang zugleich: ein neuer ersetzt den laufenden, Lautstaerkeaenderung wirkt sofort', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen(TON_AN(0.8));
  const s = await neueSeite();
  await spieleUndWarte(s, 'quiz-start'); // 2 s langer Klang
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000 }).toBe('quiz');
  expect((await abbildVon(s))!.volume).toBeCloseTo(0.8, 5);
  await setzeEinstellungen(TON_AN(0.25));
  await expect.poll(async () => (await abbildVon(s))?.volume, { timeout: 3000 }).toBeCloseTo(0.25, 5);
  await abwarten(350);
  const v = await spieleUndWarte(s, 'quiz-richtig');
  const a = (await abbildVon(s))!;
  console.log(`chromium ton: neuer Klang ${v.name} ersetzt den laufenden, laeuft jetzt ${a.laufend} bei Lautstaerke ${a.volume}`);
  expect(a.laufend).toBe('richtig');
  await s.close();
});

test('Schalter aus und Lautstaerke 0 beenden einen laufenden Klang sofort', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen(TON_AN(0.6));
  const s = await neueSeite();
  await spieleUndWarte(s, 'quiz-start');
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000 }).toBe('quiz');
  const t0 = Date.now();
  await setzeEinstellungen({ ton: { an: false, lautstaerke: 0.6 } });
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000, intervals: [20] }).toBeNull();
  console.log(`chromium ton: Schalter aus beendet den Klang nach ${Date.now() - t0} ms (Speicher bis Abbild)`);
  await abwarten(400);
  await setzeEinstellungen(TON_AN(0.6));
  await abwarten(300);
  await spieleUndWarte(s, 'quiz-start');
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000 }).toBe('quiz');
  await setzeEinstellungen(TON_AN(0));
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000, intervals: [20] }).toBeNull();
  const vorher = (await abbildVon(s))!.nr;
  await abwarten(400);
  await sende(s, { ereignis: 'quiz-richtig' });
  await abwarten(700);
  expect((await abbildVon(s))!.nr, 'Lautstaerke 0: kein Versuch').toBe(vorher);
  await s.close();
});

test('gespeicherte Pause: beendet den Klang sofort, danach kein Versuch; ohne Pause wieder', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen(TON_AN(0.6));
  const s = await neueSeite();
  await spieleUndWarte(s, 'quiz-start');
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000 }).toBe('quiz');
  const t0 = Date.now();
  await setzeEinstellungen({ pause: true });
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000, intervals: [20] }).toBeNull();
  console.log(`chromium ton: gespeicherte Pause beendet den Klang nach ${Date.now() - t0} ms`);
  await abwarten(400);
  await erwarteStille(s, 'quiz-richtig', 'Pause');
  await setzeEinstellungen({ pause: false });
  await abwarten(400);
  const v = await spieleUndWarte(s, 'quiz-richtig');
  expect(v.name).toBe('richtig');
  await s.close();
});

test('eigene Ausnahme: kein Versuch auf dieser Adresse, nach dem Entfernen wieder', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen({ ...TON_AN(0.6), ausnahmen: ['127.0.0.1'] });
  const s = await neueSeite();
  await erwarteStille(s, 'quiz-start', 'Ausnahme');
  await erwarteStille(s, 'blitz', 'Ausnahme');
  await setzeEinstellungen({ ausnahmen: [] });
  await abwarten(400);
  const v = await spieleUndWarte(s, 'blitz');
  expect(v.name).toBe('trigger');
  console.log('chromium ton: Ausnahme 127.0.0.1 -> 0 Versuche in 2 Ereignissen, ohne Ausnahme 1 Versuch');
  await s.close();
});

test('echter Quiz-Riegel: Start, falsche, richtige und verweigerte Antwort geben ihren Klang; lokale Pause beendet ihn sofort', async () => {
  test.setTimeout(90_000);
  await setzeEinstellungen(TON_AN(0.5));
  const s = await neueSeite();
  const abb = () => s.evaluate(() => { const a = document.documentElement.getAttribute('data-veil-riegel'); return a ? JSON.parse(a) : null; });
  const oeffne = (o: Record<string, unknown>) => s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: o } });
  const bisFrage = async () => {
    await expect.poll(async () => (await abb())?.zustand, { timeout: 8000, intervals: [50] }).toBe('frage');
    return abb();
  };
  const klick = async (r: { x: number; y: number; w: number; h: number }) => s.mouse.click(r.x + r.w / 2, r.y + r.h / 2);

  // 0. lokale Pause WAEHREND des langen Klangs `quiz` (2 s): der Klang laeuft nachweislich und endet sofort mit dem Klick
  await oeffne({ frage: 'test-w1', verweigern: 0, richtigMs: 400, pauseHaengt: true });
  let a = await bisFrage();
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 5000, intervals: [20] }).toBe('quiz');
  const tPause = Date.now();
  await klick(a.pause);
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000, intervals: [10] }).toBeNull();
  const bisStill = Date.now() - tPause;
  expect(bisStill, 'der Klang (2 s) wurde durch die Pause beendet, nicht durch sein Ende').toBeLessThan(1500);
  expect((await liesSpeicher('einstellungen'))?.pause ?? false).toBe(false); // pauseHaengt: die gespeicherte Pause kam nie an
  const nachPause = (await abbildVon(s))!.nr;
  await sende(s, { ereignis: 'quiz-richtig' });
  await abwarten(900);
  console.log(`chromium ton: lokale Pause mitten im Klang quiz beendete ihn nach ${bisStill} ms, danach kein Klang (nr ${nachPause} -> ${(await abbildVon(s))!.nr})`);
  expect((await abbildVon(s))!.nr).toBe(nachPause);
  await s.close();

  // 1. falsch: Start (quiz), dann falsche Antwort (falsch)
  const s1 = await neueSeite();
  const abb1 = () => s1.evaluate(() => { const x = document.documentElement.getAttribute('data-veil-riegel'); return x ? JSON.parse(x) : null; });
  await s1.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: { frage: 'test-w1', verweigern: 0, richtigMs: 400 } } });
  await expect.poll(async () => (await abb1())?.zustand, { timeout: 8000 }).toBe('frage');
  a = await abb1();
  await expect.poll(async () => (await versucheVon(s1)).map((v) => v.name), { timeout: 5000 }).toEqual(['quiz']);
  await abwarten(400);
  await s1.mouse.click(a.antworten.find((b: any) => b.text === 'beta').x + 5, a.antworten.find((b: any) => b.text === 'beta').y + 5);
  await expect.poll(async () => (await versucheVon(s1)).map((v) => v.name), { timeout: 5000 }).toEqual(['quiz', 'falsch']);
  await s1.close();

  // 3. frische Seite: richtig und verweigert
  const s2 = await neueSeite();
  const abb2 = () => s2.evaluate(() => { const x = document.documentElement.getAttribute('data-veil-riegel'); return x ? JSON.parse(x) : null; });
  const oeffne2 = (o: Record<string, unknown>) => s2.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: o } });
  await oeffne2({ frage: 'test-w1', verweigern: 0, richtigMs: 400 });
  await expect.poll(async () => (await abb2())?.zustand, { timeout: 8000 }).toBe('frage');
  await abwarten(400);
  let b: any = await abb2();
  await s2.mouse.click(b.antworten.find((x: any) => x.text === 'alpha').x + 5, b.antworten.find((x: any) => x.text === 'alpha').y + 5);
  await expect.poll(async () => (await versucheVon(s2)).map((v) => v.name), { timeout: 5000 }).toEqual(['quiz', 'richtig']);
  await expect.poll(() => s2.evaluate(() => document.documentElement.getAttribute('data-veil-riegel-ergebnis')), { timeout: 5000 }).toBe('geloest');
  await s2.close();

  const s3 = await neueSeite();
  const abb3 = () => s3.evaluate(() => { const x = document.documentElement.getAttribute('data-veil-riegel'); return x ? JSON.parse(x) : null; });
  await s3.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: { frage: 'test-w1', verweigern: 1, zufall: [0.1], verweigertMs: 400, richtigMs: 200 } } });
  await expect.poll(async () => (await abb3())?.zustand, { timeout: 8000 }).toBe('frage');
  await abwarten(400);
  b = await abb3();
  const ziel = b.antworten.find((x: any) => x.text === 'alpha');
  await s3.mouse.click(ziel.x + 5, ziel.y + 5);
  await expect.poll(async () => (await versucheVon(s3)).map((v) => v.name), { timeout: 5000 }).toEqual(['quiz', 'verweigert']);
  const alle = [...(await versucheVon(s3))];
  console.log(`chromium ton: Riegel richtig -> quiz,richtig; verweigert -> ${alle.map((v) => `${v.name}:${v.lautstaerke}:${v.ergebnis}`).join(', ')}`);
  await s3.close();
});

test('echtes Blitzwort: Folge beginnt, Klang trigger; ohne Blitz-Erlaubnis kein Wort und kein Klang', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen({ ...TON_AN(0.7), kontrolle: { ...KONTROLLE } });
  const s = await neueSeite();
  await s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { blitz: { ereignis: 'wort', zufall: [0.5] } });
  await expect.poll(async () => (await versucheVon(s)).map((v) => v.name), { timeout: 10_000 }).toEqual(['trigger']);
  const v = (await versucheVon(s))[0]!;
  console.log(`chromium ton: Blitzwort -> Klang ${v.name}, Lautstaerke ${v.lautstaerke}, ${v.ergebnis}, Quelle ${v.quelle}`);
  expect(v.lautstaerke).toBe(0.7);
  expect(v.quelle).toBe('blitz');
  // Blitz aus: das Testereignis wird abgelehnt, dann gibt es auch keinen Klang
  await abwarten(1200);
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, blitz: 'aus' } });
  await abwarten(400);
  const nr = (await abbildVon(s))!.nr;
  await s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { blitz: { ereignis: 'wort' } });
  await abwarten(1200);
  expect((await abbildVon(s))!.nr).toBe(nr);
  await s.close();
});

test('abgelehntes Abspielen bleibt still: der Browser lehnt play() ab (Klang nicht abspielbar), Ergebnis genau abgelehnt, nichts laeuft, kein Fehler', async () => {
  test.setTimeout(60_000);
  // Die Autoplay-Regel der kopflosen Fassung laesst sich nicht erzwingen. Darum ein Pack, dessen Klang zwar die WAV-Signatur hat, aber keine
  // abspielbaren Daten: play() wird abgelehnt und das Modul muss still bleiben. Eigener Browser, damit das Pack der anderen Faelle bleibt.
  const kaputt = Uint8Array.from([...Buffer.from('RIFF'), 36, 0, 0, 0, ...Buffer.from('WAVE'), ...Array.from({ length: 64 }, (_, i) => (i * 7) & 255)]);
  const format = (await import('../../src/pack/format')) as typeof import('../../src/pack/format');
  const kaputtPfad = path.join(ordner, 'kaputt.miapack');
  await writeFile(
    kaputtPfad,
    await format.schreibePack(
      { id: 'kaputt', version: '1.0.0', titel: 'Kaputt', erstellt: '2026-11-05T10:00:00Z', mindestVeil: '0.0.1', freischaltungen: ['ton'] },
      [
        { name: 'lizenz.txt', typ: 'text/plain', daten: new TextEncoder().encode('Test license.'), rolle: 'lizenz' },
        { name: 'ton/richtig.wav', typ: 'audio/wav', daten: kaputt, rolle: 'ton' },
      ],
    ),
  );
  const profil2 = await mkdtemp(path.join(tmpdir(), 'veil-ton2-'));
  const ctx2 = await chromium.launchPersistentContext(profil2, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  try {
    const w2 = ctx2.serviceWorkers()[0] ?? (await ctx2.waitForEvent('serviceworker', { timeout: 15_000 }));
    const id2 = new URL(w2.url()).host;
    const opt = await ctx2.newPage();
    await opt.goto(`chrome-extension://${id2}/options.html`);
    await opt.locator('#datei').setInputFiles(kaputtPfad);
    await opt.locator('#annehmen').click();
    await expect(opt.locator('#meldung')).toContainText('The pack is in', { timeout: 30_000 });
    await opt.evaluate(() => (globalThis as any).chrome.storage.local.set({ einstellungen: { ton: { an: true, lautstaerke: 0.5 } } }));
    await opt.close();
    const s = await ctx2.newPage();
    const fehler: string[] = [];
    s.on('pageerror', (e) => fehler.push(String(e)));
    s.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text() + (m.location().url ?? ''))) fehler.push(m.text()); });
    await s.goto(SEITE);
    await s.bringToFront();
    await expect.poll(() => s.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
    await abwarten(700);
    const v = await spieleUndWarte(s, 'quiz-richtig');
    console.log(`chromium ton: Browser lehnt play() ab -> Ergebnis ${v.ergebnis}, laufend ${(await abbildVon(s))!.laufend}, Seitenfehler ${fehler.length}`);
    expect(v.ergebnis).toBe('abgelehnt');
    expect(v.name).toBe('richtig');
    expect((await abbildVon(s))!.laufend).toBeNull();
    expect(fehler).toEqual([]);
  } finally {
    await ctx2.close();
    await rm(profil2, { recursive: true, force: true });
  }
});

test('Rahmen: Ausnahme der Tab-Adresse schweigt auch im Rahmen, Rahmen allein ohne Ausnahme spielt', async () => {
  test.setTimeout(60_000);
  // Seite auf 127.0.0.1, Rahmen auf localhost: die Ausnahme steht nur fuer die Tab-Adresse.
  await setzeEinstellungen({ ...TON_AN(0.6), ausnahmen: ['127.0.0.1'] });
  const s = await context.newPage();
  await s.goto(`http://127.0.0.1:${port}/ton-rahmen.html`);
  await s.bringToFront();
  await expect.poll(() => s.frames().length, { timeout: 10_000 }).toBe(2);
  const rahmen = s.frames().find((f) => f !== s.mainFrame())!;
  await expect.poll(() => rahmen.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
  await abwarten(800);
  expect(new URL(rahmen.url()).hostname).toBe('localhost');
  const nr = () => rahmen.evaluate(() => { const a = document.documentElement.getAttribute('data-veil-ton'); return a ? JSON.parse(a).nr : 0; });
  const sendeR = (e: string) => rahmen.evaluate((ereignis) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ ton: { ereignis } }) })), e);
  await sendeR('quiz-start');
  await abwarten(1000);
  const still = await nr();
  await setzeEinstellungen({ ausnahmen: [] });
  await abwarten(400);
  await sendeR('quiz-start');
  await expect.poll(nr, { timeout: 8000 }).toBe(1);
  console.log(`chromium ton: Rahmen (localhost) in Tab 127.0.0.1: mit Tab-Ausnahme ${still} Versuche, ohne Ausnahme 1 Versuch`);
  expect(still).toBe(0);
  // Gegenprobe: Ausnahme nur fuer den Rahmen-Host schweigt ebenfalls
  await setzeEinstellungen({ ausnahmen: ['localhost'] });
  await abwarten(400);
  await abwarten(400);
  await sendeR('quiz-richtig');
  await abwarten(900);
  expect(await nr()).toBe(1);
  await s.close();
});

test('Seite mit CSP media-src self: Ergebnis wird gemessen, nie ein Fehler, nichts laeuft ohne Ergebnis gespielt', async () => {
  test.setTimeout(60_000);
  await setzeEinstellungen(TON_AN(0.6));
  const s = await context.newPage();
  const fehler: string[] = [];
  s.on('pageerror', (e) => fehler.push(String(e)));
  await s.goto(`http://127.0.0.1:${port}/ton-csp.html`);
  await s.bringToFront();
  await expect.poll(() => s.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
  await abwarten(700);
  const v = await spieleUndWarte(s, 'quiz-richtig');
  console.log(`chromium ton: Seite mit CSP media-src 'self' -> Ergebnis ${v.ergebnis}, Seitenfehler ${fehler.length}`);
  expect(['gespielt', 'abgelehnt']).toContain(v.ergebnis);
  expect(fehler).toEqual([]);
  await s.close();
});

test('Probe auf der Einstellungsseite: Klick spielt einen Klang aus dem Pack mit der Reglerstaerke', async () => {
  test.setTimeout(60_000);
  const s = await extSeite();
  try {
    await s.locator('#ton-lautstaerke').focus();
    await s.keyboard.press('Home');
    for (let i = 0; i < 30; i++) await s.keyboard.press('ArrowRight'); // 30
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.lautstaerke, { timeout: 5000 }).toBeCloseTo(0.3, 5);
    await s.locator('#ton-probe').click();
    await expect.poll(() => s.locator('#ton-probe').getAttribute('data-veil-ton'), { timeout: 8000 }).not.toBeNull();
    const p = JSON.parse((await s.locator('#ton-probe').getAttribute('data-veil-ton'))!) as { name: string; lautstaerke: number; ergebnis: string };
    console.log(`chromium ton: Probe spielte ${p.name} bei ${p.lautstaerke} (${p.ergebnis}), Meldung "${(await s.locator('#ton-probe-meldung').textContent())?.length} Zeichen"`);
    expect(p.name).toBe('richtig');
    expect(p.lautstaerke).toBeCloseTo(0.3, 5);
    expect(p.ergebnis).toBe('gespielt');
    await expect(s.locator('#ton-probe-meldung')).toHaveText(TON_TEXTE.probeGespielt);
    // die Probe ist unabhaengig vom Schalter: auch bei "aus" spielt sie
    expect((await liesSpeicher('einstellungen')).ton.an).toBe(false);
    // Lautstaerke 0: die Probe laeuft, die Meldung sagt es
    await s.locator('#ton-lautstaerke').focus();
    await s.keyboard.press('Home');
    await expect.poll(async () => (await liesSpeicher('einstellungen'))?.ton?.lautstaerke, { timeout: 5000 }).toBe(0);
    await s.locator('#ton-probe').click();
    await expect.poll(async () => JSON.parse((await s.locator('#ton-probe').getAttribute('data-veil-ton'))!).lautstaerke, { timeout: 8000 }).toBe(0);
    await expect(s.locator('#ton-probe-meldung')).toHaveText(TON_TEXTE.probeStumm);
    // Seiten-DOM unberuehrt: kein Audio-Element auf der Einstellungsseite
    expect(await s.evaluate(() => document.querySelectorAll('audio').length)).toBe(0);
  } finally {
    await s.close();
  }
});

test('Pack ohne Ton und altes Pack: kein Klang, Probe ruht, Hinweis nennt das Pack', async () => {
  test.setTimeout(90_000);
  for (const pfad of [ohneTonPfad, altPackPfad]) {
    await importierePack(pfad);
    await setzeEinstellungen(TON_AN(0.6));
    const s = await neueSeite();
    await erwarteStille(s, 'quiz-start', 'Pack ohne Ton');
    await erwarteStille(s, 'blitz', 'Pack ohne Ton');
    expect((await abbildVon(s))?.nr ?? 0).toBe(0);
    await s.close();
    const e = await extSeite();
    await expect(e.locator('#ton-probe')).toBeDisabled();
    await expect(e.locator('#ton-pack-hinweis')).toHaveText(TON_TEXTE.hinweisAltesPack);
    const a = await e.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packton', name: 'richtig' }));
    expect(a.dataUrl).toBeNull();
    await e.close();
  }
  console.log('chromium ton: Pack ohne Ton und Pack aus Phase 3: 0 Versuche, packton null, Probe gesperrt');
});

test('Pack entfernen: neuer Klang erst nach neuem Import, laufender Klang endet', async () => {
  test.setTimeout(90_000);
  await importierePack(packPfad);
  await setzeEinstellungen(TON_AN(0.6));
  const s = await neueSeite();
  await spieleUndWarte(s, 'quiz-start');
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 3000 }).toBe('quiz');
  await entfernePack();
  await expect.poll(async () => (await abbildVon(s))?.laufend, { timeout: 5000, intervals: [30] }).toBeNull();
  await abwarten(400);
  await erwarteStille(s, 'quiz-richtig', 'nach dem Entfernen');
  await importierePack(packPfad);
  await abwarten(500);
  const v = await spieleUndWarte(s, 'quiz-richtig');
  expect(v.name).toBe('richtig');
  console.log('chromium ton: Pack entfernt -> Klang endet und still, nach neuem Import wieder ein Klang');
  await s.close();
});
