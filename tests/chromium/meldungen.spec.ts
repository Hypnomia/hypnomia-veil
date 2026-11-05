// Chromium: Auftrag M (PHASE-5-AUFTRAEGE-SESSION-10 Abschnitt 5). Meldungen: der Testhaken `meldung-test` (Hintergrund) loest einen Anlass fuer
// den Tab des Absenders aus, dann kommt die echte Nachricht `inhalt/meldung` an die oberste Seite. Gemessen werden Zeit bis sichtbar, Sichtzeit,
// Lage, Abstand, die Zaehler (50 zensierte Bilder, Stufe, strenge Zeit) und alle Faelle ohne Meldung. Text-Asserts gegen die Dummy-Saetze.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47175);
const seite = (query = '') => `http://127.0.0.1:${port}/meldungen.html${query}`;
const bauModul = '../../scripts/pack/baue-pack.mjs';

interface Rect { x: number; y: number; w: number; h: number }
interface Abbild {
  phase: string; gezeigt: number; entscheidungen: number; ergebnis: string; endeGrund: string; endeZeit: number; anlass: string | null; zahl: number | null;
  pose: string | null; satz: string; chibi: boolean; deckkraft: number | null; host: Rect | null; schliessen: Rect | null; fokusImHost: boolean;
  sichtbarSeit: number; offeneHoerer: number; jetzt: number;
}
interface Antwort { ok: boolean; gezeigt?: boolean; anlass?: string; grund?: string }

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const abwarten = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nr = 100;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-meldungen-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-meldungen-pack-'));
  const bau = (await import(bauModul)) as { baueDummyPack(): Promise<{ bytes: Uint8Array }> };
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: false, leerlaufMinuten: 2, tabtitel: false, cursor: 'aus', meldungen: true, besuche: false, zeiten: [] };
async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const setzeKontrolle = (teil: Record<string, unknown>) => setzeEinstellungen({ kontrolle: { ...KONTROLLE, ...teil } });
const schreibe = (schluessel: string, wert: unknown) =>
  worker.evaluate(async ([k, w]) => (globalThis as any).chrome.storage.local.set({ [k as string]: w }), [schluessel, wert] as const);
const entferneSchluessel = (schluessel: string) => worker.evaluate(async (k) => (globalThis as any).chrome.storage.local.remove(k), schluessel);
const lies = <T>(schluessel: string) => worker.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as any)[k] as T, schluessel);

async function importierePack() {
  const s = await context.newPage();
  try {
    await s.goto(optionsUrl());
    await s.locator('#datei').setInputFiles(packPfad);
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
    await expect(s.locator('#pack-status')).not.toHaveText('', { timeout: 10_000 });
    await abwarten(300);
    if (await s.locator('#entfernen').isVisible()) {
      await s.locator('#entfernen').click();
      await s.locator('#entfernen-ja').click();
      await expect(s.locator('#entfernen')).toBeHidden({ timeout: 15_000 });
    }
  } finally {
    await s.close();
  }
}

const abbild = (p: Page): Promise<Abbild | null> =>
  p.evaluate(() => {
    const t = document.documentElement.getAttribute('data-veil-meldung');
    return t ? JSON.parse(t) : null;
  });
async function bisAbbild(p: Page, pruefe: (a: Abbild) => boolean, frist = 15_000, schritt = 15): Promise<Abbild> {
  const t0 = Date.now();
  let a: Abbild | null = null;
  while (Date.now() - t0 < frist) {
    a = await abbild(p);
    if (a && pruefe(a)) return a;
    await abwarten(schritt);
  }
  throw new Error(`Frist abgelaufen, letztes Abbild: ${JSON.stringify(a)?.slice(0, 500)}`);
}
// Schickt den Testhaken und wartet auf die Antwort des Hintergrunds (der erst antwortet, wenn die Seite geantwortet hat).
async function sende(p: Page, teil: { anlass?: string; zahl?: number; vergiss?: boolean }): Promise<Antwort> {
  const n = ++nr;
  await p.evaluate(([t, i]) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ meldung: { ...t, nr: i } }) })), [teil, n] as const);
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    const a = await p.evaluate(() => document.documentElement.getAttribute('data-veil-meldung-antwort'));
    if (a) {
      const j = JSON.parse(a);
      if (j.nr === n) return j.antwort ?? { ok: false };
    }
    await abwarten(10);
  }
  throw new Error('keine Antwort des Hintergrunds');
}
const hostAnzahl = (p: Page) => p.evaluate(() => document.querySelectorAll('[data-veil-meldung-host]').length);
const zaehler = (p: Page): Promise<any> => p.evaluate(() => (window as any).zaehler);
const capture = (p: Page): Promise<any> => p.evaluate(() => (window as any).zaehlerCapture);
async function oeffne(query = ''): Promise<Page> {
  const p = await context.newPage();
  await p.goto(seite(query));
  await p.bringToFront();
  await p.mouse.move(150, 130);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-veil-meldung'));
  await abwarten(150);
  return p;
}
// Meldung zeigen und warten, bis sie da ist. Liefert die Millisekunden bis zur Antwort `gezeigt`.
async function zeige(p: Page, anlass = 'zensiert', zahl: number | undefined = 50): Promise<{ ms: number; antwort: Antwort }> {
  const t0 = Date.now();
  const antwort = await sende(p, { anlass, zahl, vergiss: true });
  return { ms: Date.now() - t0, antwort };
}
async function bisWeg(p: Page): Promise<Abbild> {
  const a = await bisAbbild(p, (x) => x.phase === 'ruhend', 15_000, 5);
  expect(await hostAnzahl(p)).toBe(0);
  return a;
}
const mitte = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

test.beforeEach(async () => {
  await setzeKontrolle({});
  await setzeEinstellungen({ pause: false, ruhig: false, ausnahmen: [] });
  await entferneSchluessel('meldungStand');
});

test('ohne Pack: nichts, kein Host', async () => {
  test.setTimeout(60_000);
  await entfernePack();
  const p = await oeffne();
  const a = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(a.gezeigt).toBe(false);
  await abwarten(400);
  expect(await hostAnzahl(p)) .toBe(0);
  expect((await abbild(p))!.gezeigt).toBe(0);
  console.log('chromium meldungen: ohne Pack 0 Meldungen, 0 Hosts');
  await p.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack();
});

test('Meldung: Lage, Satz mit Zahl, Chibi, Rolle, kein Fokus, Host am Ende von html', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  const { ms, antwort } = await zeige(p);
  expect(antwort.gezeigt).toBe(true);
  const a = await bisAbbild(p, (x) => x.phase === 'steht' && (x.deckkraft ?? 0) > 0.95 && x.chibi, 5000, 10);
  expect(a.satz).toBe('Test censored 50 line.');
  expect(a.anlass).toBe('zensiert');
  expect(a.pose).toBe('jubeln');
  expect(a.fokusImHost).toBe(false);
  const g = await p.evaluate(() => ({
    b: innerWidth,
    h: innerHeight,
    letzter: document.documentElement.lastElementChild?.hasAttribute('data-veil-meldung-host') ?? false,
    imBody: document.body.querySelectorAll('[data-veil-meldung-host]').length,
    hostMarke: document.querySelector('[data-veil-meldung-host]')?.getAttribute('data-veil-meldung-host'),
    aktiv: document.activeElement?.tagName,
  }));
  expect(g.letzter).toBe(true);
  expect(g.imBody).toBe(0);
  expect(g.hostMarke).toBe('zensiert');
  expect(g.aktiv).toBe('BODY');
  expect(a.host!.w).toBeLessThanOrEqual(360);
  expect(a.host!.x + a.host!.w).toBeGreaterThan(g.b - 40);
  expect(a.host!.y + a.host!.h).toBeGreaterThan(g.h - 40);
  const oben = await p.evaluate(([x, y]) => !!document.elementFromPoint(x as number, y as number)?.hasAttribute('data-veil-meldung-host'), [g.b - 30, g.h - 30] as const);
  expect(oben).toBe(true);
  // Fokus: ein Textfeld der Seite behaelt ihn bei Klick auf die Meldung und auf Schliessen (kein blur, keine Textauswahl)
  await p.evaluate(() => {
    const f = document.getElementById('feld') as HTMLInputElement;
    (window as any).blurs = 0;
    f.addEventListener('blur', () => { (window as any).blurs++; });
    f.value = 'abc';
    f.focus();
  });
  await p.mouse.click(a.host!.x + 90, a.host!.y + a.host!.h - 6);
  await p.mouse.move(a.host!.x + 40, a.host!.y + 40);
  await p.mouse.down();
  await p.mouse.move(a.host!.x + 200, a.host!.y + 50);
  await p.mouse.up();
  const fokus1 = await p.evaluate(() => ({ id: document.activeElement?.id, blurs: (window as any).blurs, auswahl: String(getSelection()) }));
  expect(fokus1.id).toBe('feld');
  expect(fokus1.blurs).toBe(0);
  expect(fokus1.auswahl).toBe('');
  const sc = mitte(a.schliessen!);
  await p.mouse.click(sc.x, sc.y);
  await bisWeg(p);
  const fokus2 = await p.evaluate(() => ({ id: document.activeElement?.id, blurs: (window as any).blurs }));
  expect(fokus2.id).toBe('feld');
  expect(fokus2.blurs).toBe(0);
  console.log(`chromium meldungen: Fokus im Textfeld nach Klick, Ziehen und Schliessen: ${fokus2.id}, blur ${fokus2.blurs}, Auswahl "${fokus1.auswahl}"`);
  console.log(`chromium meldungen: Antwort gezeigt nach ${ms} ms, Breite ${a.host!.w} px (Grenze 360), Chibi ${a.chibi}, Pose ${a.pose}`);
  await p.close();
});

test('Sichtzeit 8 s, dann weg; Schliessen-Knopf und Klick auf die Meldung erreichen die Seite nicht', async () => {
  test.setTimeout(90_000);
  const p = await oeffne();
  await zeige(p);
  const a = await bisAbbild(p, (x) => x.phase === 'steht');
  const t0 = a.jetzt;
  const weg = await bisWeg(p);
  const sicht = weg.endeZeit - a.sichtbarSeit;
  expect(weg.endeGrund).toBe('zeit');
  expect(sicht).toBeGreaterThan(7500);
  expect(sicht).toBeLessThan(9500);
  void t0;
  // Klick auf den Text der Meldung: bleibt stehen, Seite sieht nichts
  await zeige(p);
  const b = await bisAbbild(p, (x) => x.phase === 'steht' && (x.deckkraft ?? 0) > 0.95);
  await p.mouse.click(b.host!.x + 90, b.host!.y + b.host!.h - 6);
  await abwarten(200);
  let z = await zaehler(p);
  let c = await capture(p);
  expect((await abbild(p))!.phase).toBe('steht');
  expect(z.click + z.mousedown + z.mouseup + z.untenClick).toBe(0);
  expect(c.click + c.mousedown + c.mouseup + c.pointerdown + c.pointerup).toBe(0);
  // Schliessen
  const s = mitte(b.schliessen!);
  const tz = Date.now();
  await p.mouse.click(s.x, s.y);
  const zu = await bisWeg(p);
  const msZu = Date.now() - tz;
  expect(zu.endeGrund).toBe('schliessen');
  z = await zaehler(p);
  c = await capture(p);
  expect(z.click + z.mousedown + z.mouseup + z.untenClick).toBe(0);
  expect(c.click + c.mousedown + c.mouseup).toBe(0);
  // Klick daneben (links der Meldung, im festen Bereich unten) geht an die Seite
  await zeige(p);
  const d = await bisAbbild(p, (x) => x.phase === 'steht');
  await p.mouse.click(d.host!.x - 30, d.host!.y + 20);
  await abwarten(200);
  z = await zaehler(p);
  expect(z.untenClick).toBe(1);
  expect((await abbild(p))!.phase).toBe('steht');
  console.log(`chromium meldungen: Sichtzeit ${Math.round(sicht)} ms (Soll 8000), Schliessen nach ${msZu} ms, Klick auf Meldung: Seite zaehlt 0, daneben untenClick ${z.untenClick}`);
  await p.close();
});

test('Zeiger auf der Meldung verlaengert die Sichtzeit', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeige(p);
  const a = await bisAbbild(p, (x) => x.phase === 'steht' && (x.deckkraft ?? 0) > 0.95);
  const m = mitte(a.host!);
  await p.mouse.move(m.x, m.y);
  await abwarten(9500);
  expect((await abbild(p))!.phase).toBe('steht');
  await p.mouse.move(150, 130);
  const weg = await bisWeg(p);
  expect(weg.endeGrund).toBe('zeit');
  console.log(`chromium meldungen: mit Zeiger darauf nach 9,5 s noch da, nach Verlassen weg (${Math.round(weg.endeZeit - a.sichtbarSeit)} ms ab Anzeige)`);
  await p.close();
});

test('Abstand: zweite Meldung innerhalb 10 Minuten kommt nicht; nach vergiss ja', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  const erste = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(erste.gezeigt).toBe(true);
  await p.mouse.click(0, 0); // bringt nichts, nur Ruhe
  const a = await bisAbbild(p, (x) => x.phase === 'steht');
  const s = mitte(a.schliessen!);
  await p.mouse.click(s.x, s.y);
  await bisWeg(p);
  const zweite = await sende(p, { anlass: 'stufe' });
  expect(zweite.gezeigt).toBe(false);
  expect(zweite.grund).toBe('abstand');
  expect(await hostAnzahl(p)).toBe(0);
  const stand = await lies<{ zuletzt: number; wartend: Record<string, unknown> }>('meldungStand');
  expect(Object.keys(stand.wartend)).toContain('stufe');
  const dritte = await sende(p, { anlass: 'stufe', vergiss: true });
  expect(dritte.gezeigt).toBe(true);
  console.log(`chromium meldungen: zweite Meldung nach der ersten: gezeigt ${zweite.gezeigt} (${zweite.grund}), nach vergiss: ${dritte.gezeigt}`);
  await p.close();
});

test('Zaehler: 49 zensierte plus 1 ergibt Meldung mit 50; Stufe steigt; strenge Zeit beginnt', async () => {
  test.setTimeout(90_000);
  const p = await oeffne();
  // Zensiert: Stand auf 49 setzen, dann eine Minute mit 1 Bild
  const heute = await p.evaluate(() => {
    const d = new Date();
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  });
  await schreibe('meldungStand', { version: 1, tag: heute, zensiert: 49, zensiertSchritte: 0, erwachsenMs: 0, erwachsenSchritte: 0, erwachsenMinute: -1, stufe: 0, strengKennung: null, zuletzt: 0, wartend: {} });
  const r1 = await sende(p, { zahl: 1 });
  expect(r1.gezeigt).toBe(true);
  expect(r1.anlass).toBe('zensiert');
  const a = await bisAbbild(p, (x) => x.phase === 'steht');
  expect(a.satz).toBe('Test censored 50 line.');
  expect(a.zahl).toBe(50);
  const s = mitte(a.schliessen!);
  await p.mouse.click(s.x, s.y);
  await bisWeg(p);
  // Stufe: Stand der Steigerung steigt auf 2
  await schreibe('steigerung', { version: 1, stufe: 2, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null });
  await sende(p, { vergiss: true, zahl: 0 }); // vergiss gilt nur am Anfang der Auswertung; diese Auswertung erkennt die Stufe und zeigt sie
  const a2 = await bisAbbild(p, (x) => x.phase === 'steht', 8000);
  expect(a2.anlass).toBe('stufe');
  expect(a2.satz).toBe('Test level up line.');
  await p.mouse.click(mitte(a2.schliessen!).x, mitte(a2.schliessen!).y);
  await bisWeg(p);
  // Streng: Fenster von vor 29 bis in 30 Minuten (rechnet ueber Mitternacht, daher von > bis moeglich), alle Wochentage
  const jetztMin = await p.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  await setzeKontrolle({ zeiten: [{ tage: [0, 1, 2, 3, 4, 5, 6], von: (jetztMin - 29 + 1440) % 1440, bis: (jetztMin + 30) % 1440 }] });
  await sende(p, { vergiss: true, zahl: 0 });
  const a3 = await bisAbbild(p, (x) => x.phase === 'steht', 8000);
  expect(a3.anlass).toBe('streng');
  expect(a3.satz).toBe('Test strict time line.');
  await p.mouse.click(mitte(a3.schliessen!).x, mitte(a3.schliessen!).y);
  await bisWeg(p);
  // Einmal je Fenster: die naechste Auswertung zeigt nichts
  const r4 = await sende(p, { vergiss: true, zahl: 0 });
  expect(r4.gezeigt).toBe(false);
  console.log(`chromium meldungen: Zaehler 49+1 -> Meldung mit ${a.zahl}, Stufe 0->2 gezeigt, strenge Zeit einmal gezeigt (zweite Auswertung ${r4.gezeigt})`);
  await p.close();
});

test('Pause, lokale Pause, Schalter aus, Ausnahme: keine Meldung; Pause waehrend sie steht: sofort weg', async () => {
  test.setTimeout(120_000);
  const p = await oeffne();
  await setzeEinstellungen({ pause: true });
  await abwarten(200);
  let a = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(a.gezeigt).toBe(false);
  await setzeEinstellungen({ pause: false });
  await setzeKontrolle({ meldungen: false });
  a = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(a.gezeigt).toBe(false);
  await setzeKontrolle({});
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  await abwarten(200);
  a = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(a.gezeigt).toBe(false);
  await setzeEinstellungen({ ausnahmen: [] });
  expect(await hostAnzahl(p)).toBe(0);
  // gespeicherte Pause waehrend sie steht
  await abwarten(200);
  await zeige(p);
  await bisAbbild(p, (x) => x.phase === 'steht');
  const t0 = Date.now();
  await setzeEinstellungen({ pause: true });
  const w1 = await bisWeg(p);
  const msPause = Date.now() - t0;
  expect(w1.endeGrund).toBe('einstellung');
  expect(msPause).toBeLessThan(150);
  await setzeEinstellungen({ pause: false });
  // Schalter aus waehrend sie steht
  await abwarten(300);
  await zeige(p);
  await bisAbbild(p, (x) => x.phase === 'steht');
  await setzeKontrolle({ meldungen: false });
  expect((await bisWeg(p)).endeGrund).toBe('einstellung');
  await setzeKontrolle({});
  await abwarten(300);
  // lokale Pause waehrend sie steht
  await zeige(p);
  await bisAbbild(p, (x) => x.phase === 'steht');
  const t1 = Date.now();
  await p.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ meldung: { lokalePause: true } }) })));
  const w2 = await bisWeg(p);
  const msLokal = Date.now() - t1;
  expect(w2.endeGrund).toBe('pause');
  expect(msLokal).toBeLessThan(150);
  // danach (lokale Pause bleibt) keine neue Meldung auf dieser Seite
  const nach = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(nach.gezeigt).toBe(false);
  console.log(`chromium meldungen: Pause weg nach ${msPause} ms, lokale Pause weg nach ${msLokal} ms, Pause/Schalter/Ausnahme: 0 Meldungen`);
  await p.close();
});

test('Rahmen bekommen keinen Host', async () => {
  test.setTimeout(60_000);
  const p = await oeffne('?rahmen=1');
  // Ein verborgener Tab laesst sich in Chromium (headless, alle Seiten gelten als sichtbar) nicht herstellen: das prueft der Firefox-Test.
  const sichtbar = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(sichtbar.gezeigt).toBe(true);
  const imRahmen = await p.frames().filter((f) => f !== p.mainFrame()).reduce(async (summe, f) => (await summe) + (await f.evaluate(() => document.querySelectorAll('[data-veil-meldung-host]').length)), Promise.resolve(0));
  expect(imRahmen).toBe(0);
  console.log(`chromium meldungen: sichtbarer Tab ${sichtbar.gezeigt}, Hosts in Rahmen ${imRahmen}`);
  await p.close();
});

test('Spirale erscheint waehrend einer Meldung: Meldung sofort weg, Spirale da', async () => {
  test.setTimeout(60_000);
  await setzeKontrolle({ leerlauf: true });
  await schreibe('spiraleWarnungGesehen', true);
  const p = await oeffne();
  await zeige(p);
  await bisAbbild(p, (x) => x.phase === 'steht');
  const n = ++nr;
  const t0 = Date.now();
  await p.evaluate(([i]) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { zustand: 'idle', nr: i } }) })), [n] as const);
  const w = await bisWeg(p);
  const ms = Date.now() - t0;
  expect(w.endeGrund).toBe('andere');
  expect(ms).toBeLessThan(150);
  await p.waitForFunction(() => document.querySelectorAll('[data-veil-spirale-host]').length === 1, undefined, { timeout: 10_000 });
  // Waehrend die Spirale steht, zeigt die Meldung nichts (die Seite sagt ab)
  const a = await sende(p, { anlass: 'stufe', vergiss: true });
  expect(a.gezeigt).toBe(false);
  await p.evaluate(([i]) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { zustand: 'active', nr: i } }) })), [n + 1000] as const);
  console.log(`chromium meldungen: Spirale waehrend Meldung: Meldung weg (${w.endeGrund}) nach ${ms} ms, Spirale steht, neue Meldung abgesagt`);
  await p.close();
  await setzeKontrolle({});
});

test('Stufe geht an den aktiven Tab des zuletzt fokussierten Fensters (nicht an den Absender)', async () => {
  test.setTimeout(60_000);
  const a = await oeffne();
  const b = await oeffne();
  await b.bringToFront();
  await abwarten(300);
  const heute = await a.evaluate(() => {
    const d = new Date();
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  });
  await schreibe('meldungStand', { version: 1, tag: heute, zensiert: 0, zensiertSchritte: 0, erwachsenMs: 0, erwachsenSchritte: 0, erwachsenMinute: -1, stufe: 0, strengKennung: null, strengZuletzt: 0, zuletzt: 0, wartend: {} });
  await schreibe('steigerung', { version: 1, stufe: 3, minutenSeitAnstieg: 0, naechsterAnstiegNach: 15, abbauAb: Date.now(), letzteMinute: -1, pauseSeit: null });
  const antwort = await sende(a, { vergiss: true, zahl: 0 });
  await abwarten(500);
  const inA = await hostAnzahl(a);
  const inB = await hostAnzahl(b);
  expect(antwort.anlass).toBe('stufe');
  expect(inB).toBe(1);
  expect(inA).toBe(0);
  console.log(`chromium meldungen: Stufe 0->3 vom Absender-Tab A ausgeloest: Meldung in A ${inA}, im vorderen Tab B ${inB}`);
  await a.close();
  await b.close();
});

test('Ohne Pack am Ende: nichts (Pack entfernt, Meldung weg)', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeige(p);
  await bisAbbild(p, (x) => x.phase === 'steht');
  await entfernePack();
  const w = await bisWeg(p);
  expect(w.endeGrund).toBe('einstellung');
  const a = await sende(p, { anlass: 'zensiert', zahl: 50, vergiss: true });
  expect(a.gezeigt).toBe(false);
  console.log('chromium meldungen: Pack entfernt: Meldung sofort weg, danach 0 Meldungen');
  await p.close();
});
