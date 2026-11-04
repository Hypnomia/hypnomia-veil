// Chromium: Auftrag L (PHASE-5-AUFTRAEGE-SESSION-9 Abschnitt 5). Leerlauf-Spirale: der Testhaken `veil-test` spielt den Wechsel idle, active
// vor (Hintergrund `leerlauf-test`, dann echte Nachricht `inhalt/leerlauf` an die oberste Seite). Gemessen werden Zeit bis sichtbar, Einblenden,
// echte Streifenfrequenz aus dem gezeichneten Winkel, Zeit bis zum Ende bei Maus, Taste, Klick, Pause, Warnkarte und alle Faelle ohne Spirale.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const seite = (query = '') => `http://127.0.0.1:${port}/spirale.html${query}`;
const bauModul = '../../scripts/pack/baue-pack.mjs';

interface Abbild {
  phase: string;
  gesperrt: boolean;
  entscheidungen: number;
  ergebnis: string;
  endeGrund: string;
  endeZeit: number;
  satz: string;
  arme: number | null;
  umdrehungen: number | null;
  hz: number | null;
  ruhig: boolean | null;
  deckkraft: number | null;
  winkel: number | null;
  winkelZeit: number | null;
  stehend: boolean | null;
  bilder: number | null;
  bilderGesamt: number;
  offeneHoerer: number;
  nachlaufAktiv: boolean;
  aufloesung: { breite: number; hoehe: number } | null;
  host: { x: number; y: number; w: number; h: number } | null;
  knoepfe: { ja: { x: number; y: number; w: number; h: number }; nein: { x: number; y: number; w: number; h: number } } | null;
  jetzt: number;
}

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
  profil = await mkdtemp(path.join(tmpdir(), 'veil-spirale-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-spirale-pack-'));
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

const KONTROLLE = { werbung: false, blitz: 'aus', leerlauf: true, leerlaufMinuten: 2 };

async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const setzeKontrolle = (teil: Record<string, unknown>) => setzeEinstellungen({ kontrolle: { ...KONTROLLE, ...teil } });
const setzeWarnung = (gesehen: boolean) =>
  worker.evaluate(async (g) => {
    const api = (globalThis as any).chrome;
    if (g) await api.storage.local.set({ spiraleWarnungGesehen: true });
    else await api.storage.local.remove(['spiraleWarnungGesehen', 'quizWarnungGesehen']);
  }, gesehen);
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
    const t = document.documentElement.getAttribute('data-veil-spirale');
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
// Schickt den Wechsel ueber den Testhaken und wartet auf die Antwort des Hintergrunds.
async function sende(p: Page, zustand: 'idle' | 'active' | 'locked'): Promise<{ ok: boolean; abstand?: number; gesendet?: boolean }> {
  const n = ++nr;
  await p.evaluate(([z, i]) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { zustand: z, nr: i } }) })), [zustand, n] as const);
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    const a = await p.evaluate(() => document.documentElement.getAttribute('data-veil-spirale-antwort'));
    if (a) {
      const j = JSON.parse(a);
      if (j.nr === n) return j.antwort ?? { ok: false };
    }
    await abwarten(10);
  }
  throw new Error('keine Antwort des Hintergrunds');
}
const hostAnzahl = (p: Page) => p.evaluate(() => document.querySelectorAll('[data-veil-spirale-host]').length);
const zaehler = (p: Page): Promise<Record<string, number>> => p.evaluate(() => (window as any).zaehler);
const capture = (p: Page): Promise<Record<string, number> & Record<'pointerdown' | 'pointerup' | 'mousedown' | 'mouseup' | 'click' | 'keydown' | 'keyup' | 'keypress' | 'wheel', number>> => p.evaluate(() => (window as any).zaehlerCapture);
const pfad = (p: Page) => p.evaluate(() => location.pathname);

// Seite mit Mausposition ausserhalb der Mitte, bereit fuer idle.
async function oeffne(query = ''): Promise<Page> {
  const p = await context.newPage();
  await p.goto(seite(query));
  await p.bringToFront();
  await p.mouse.move(150, 130);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-veil-spirale'));
  await abwarten(150);
  return p;
}
// Idle schicken, auf die Entscheidung der Seite warten. Liefert Abbild und die Zeit bis zur Entscheidung.
async function idleUndEntscheidung(p: Page): Promise<{ a: Abbild; ms: number; antwort: { gesendet?: boolean } }> {
  const vorher = (await abbild(p))?.entscheidungen ?? 0;
  const t0 = Date.now();
  const antwort = await sende(p, 'idle');
  if (!antwort.gesendet) return { a: (await abbild(p))!, ms: Date.now() - t0, antwort };
  const a = await bisAbbild(p, (x) => x.entscheidungen > vorher);
  return { a, ms: Date.now() - t0, antwort };
}
// Spirale zeigen und warten, bis sie wirklich zeichnet.
async function zeigeSpirale(p: Page): Promise<number> {
  const { a, ms } = await idleUndEntscheidung(p);
  expect(a.ergebnis).toBe('spirale');
  await bisAbbild(p, (x) => (x.bilder ?? 0) > 1);
  return ms;
}
// Wartet bis die Spirale weg ist; liefert die Millisekunden ab `t0`.
async function bisWeg(p: Page, t0: number): Promise<number> {
  await bisAbbild(p, (x) => x.phase === 'ruhend', 15_000, 5);
  const ms = Date.now() - t0;
  expect(await hostAnzahl(p)).toBe(0);
  return ms;
}
// Zwischen den Tests: aktiv melden (loest die Sperre), kurz warten (334 ms Abstand der Wechsel).
async function ruheWieder(p: Page) {
  await sende(p, 'active');
  await abwarten(400);
}

test.beforeEach(async () => {
  await setzeKontrolle({});
  await setzeWarnung(true);
  await setzeEinstellungen({ pause: false, ruhig: false, ausnahmen: [] });
});

test('ohne Pack: idle bleibt ohne Folge (Hintergrund sendet nichts, keine Spirale)', async () => {
  test.setTimeout(60_000);
  await entfernePack();
  const p = await oeffne();
  const antwort = await sende(p, 'idle');
  expect(antwort.gesendet).toBe(false);
  await abwarten(500);
  expect(await hostAnzahl(p)).toBe(0);
  expect((await abbild(p))!.entscheidungen).toBe(0);
  console.log('chromium spirale: ohne Pack 0 Nachrichten, 0 Hosts');
  await p.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack();
});

test('Spirale: Zeit bis sichtbar, Deckung, Satz, Einblenden, Streifenfrequenz (Pixel), Aufloesung', async () => {
  test.setTimeout(90_000);
  const p = await oeffne();
  const t0 = Date.now();
  await zeigeSpirale(p);
  // Sichtbar heisst: Deckkraft ueber 50 Prozent (Entscheidung und erstes Bild kommen bei Deckkraft 0).
  const a1 = await bisAbbild(p, (x) => (x.deckkraft ?? 0) > 0.5, 5000, 5);
  const ms = Date.now() - t0;
  expect(a1.satz).toBe('Test idle line.');
  expect(a1.phase).toBe('spirale');
  // Deckt den ganzen Sichtbereich; auf dem Link liegt der Host.
  const gross = await p.evaluate(() => ({ b: innerWidth, h: innerHeight, oben: !!document.elementFromPoint(150, 130)?.hasAttribute('data-veil-spirale-host') }));
  expect(a1.host).toEqual({ x: 0, y: 0, w: gross.b, h: gross.h });
  expect(gross.oben).toBe(true);
  const voll = await bisAbbild(p, (x) => x.deckkraft === 1, 5000);
  // Streifenfrequenz aus Pixeln: Helligkeit (Gruenkanal) an einem festen Punkt der Seite, Bildschirmfotos im Takt, Hauptfrequenz aus den Wechseln.
  const punkt = { x: Math.round(gross.b / 2) + 350, y: Math.round(gross.h / 2) };
  const zeiten: number[] = [];
  const werte: number[] = [];
  const tEnde = Date.now() + 6000;
  while (Date.now() < tEnde) {
    const png = await p.screenshot({ clip: { x: punkt.x, y: punkt.y, width: 6, height: 6 } });
    zeiten.push(Date.now());
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let g = 0;
    for (let i = 1; i < data.length; i += 3) g += data[i]!;
    werte.push(g / (data.length / 3));
  }
  const lo = Math.min(...werte);
  const hi = Math.max(...werte);
  expect(hi - lo).toBeGreaterThan(40); // die Arme laufen wirklich am Punkt vorbei
  const mitte = (lo + hi) / 2;
  const wechsel: number[] = [];
  let oben = werte[0]! > mitte;
  for (let i = 1; i < werte.length; i++) {
    const jetzt = werte[i]! > mitte + (oben ? -(hi - lo) * 0.15 : (hi - lo) * 0.15);
    if (jetzt !== oben) {
      wechsel.push(zeiten[i]!);
      oben = jetzt;
    }
  }
  expect(wechsel.length).toBeGreaterThan(6);
  const pixelHz = (wechsel.length - 1) / 2 / ((wechsel[wechsel.length - 1]! - wechsel[0]!) / 1000);
  expect(pixelHz).toBeLessThanOrEqual(2.5);
  // Stimmt mit der Rechnung der Spirale ueberein (3 Arme mal 0,4 Umdrehungen = 1,2 Hz).
  const b1 = (await abbild(p))!;
  expect(Math.abs(pixelHz - b1.hz!)).toBeLessThan(0.35);
  expect(Math.max(b1.aufloesung!.breite, b1.aufloesung!.hoehe)).toBeLessThanOrEqual(1280);
  expect(voll.ruhig).toBe(false);
  console.log(`chromium spirale: sichtbar (Deckkraft ueber 0,5) nach ${ms} ms, Streifenfrequenz aus Pixeln ${pixelHz.toFixed(2)} Hz (Rechnung ${b1.hz!.toFixed(2)} Hz, Grenze 2,5, ${wechsel.length} Wechsel in 6 s), Aufloesung ${b1.aufloesung!.breite}x${b1.aufloesung!.hoehe}`);
  await p.close();
});

test('Einblenden dauert mindestens 1200 ms', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const a1 = await bisAbbild(p, (x) => (x.deckkraft ?? 0) > 0.05, 5000, 5);
  const a2 = await bisAbbild(p, (x) => (x.deckkraft ?? 0) > a1.deckkraft! + 0.2, 5000);
  const steigung = ((a2.deckkraft! - a1.deckkraft!) / (a2.jetzt - a1.jetzt)) * 1200;
  expect(steigung).toBeLessThanOrEqual(1.08);
  console.log(`chromium spirale: Einblenden Steigung mal 1200 ms = ${steigung.toFixed(2)} (hoechstens 1)`);
  await p.close();
});

test('Ruhig-Modus und prefers-reduced-motion drehen auf 30 Prozent', async () => {
  test.setTimeout(60_000);
  const messe = async (p: Page) => {
    await zeigeSpirale(p);
    const x1 = (await abbild(p))!;
    await abwarten(2500);
    const x2 = (await abbild(p))!;
    return { hz: (x2.arme! * (x2.winkel! - x1.winkel!)) / (2 * Math.PI) / ((x2.winkelZeit! - x1.winkelZeit!) / 1000), ruhig: x2.ruhig, soll: x2.hz };
  };
  const normal = await oeffne();
  const n = await messe(normal);
  await normal.close();
  await setzeEinstellungen({ ruhig: true });
  const r1 = await oeffne();
  const r = await messe(r1);
  await r1.close();
  await setzeEinstellungen({ ruhig: false });
  const r2 = await oeffne();
  await r2.emulateMedia({ reducedMotion: 'reduce' });
  const m = await messe(r2);
  await r2.close();
  expect(r.ruhig).toBe(true);
  expect(m.ruhig).toBe(true);
  expect(r.hz / n.hz).toBeGreaterThan(0.2);
  expect(r.hz / n.hz).toBeLessThan(0.4);
  expect(m.hz / n.hz).toBeGreaterThan(0.2);
  expect(m.hz / n.hz).toBeLessThan(0.4);
  console.log(`chromium spirale: normal ${n.hz.toFixed(2)} Hz, Ruhig-Modus ${r.hz.toFixed(2)} Hz, reduced-motion ${m.hz.toFixed(2)} Hz (Soll ${n.soll} und 30 Prozent)`);
});

test('Mausbewegung beendet sofort', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const t0 = Date.now();
  await p.mouse.move(300, 300, { steps: 2 });
  const ms = await bisWeg(p, t0);
  console.log(`chromium spirale: Maus beendet nach ${ms} ms (inklusive Abfrage)`);
  // Sperre: ein zweites idle ohne active bringt keine Spirale, nach active schon.
  const nochmal = await idleUndEntscheidung(p);
  expect(nochmal.a.ergebnis).toBe('gesperrt');
  expect(await hostAnzahl(p)).toBe(0);
  await ruheWieder(p);
  await zeigeSpirale(p);
  await p.close();
});

test('Taste beendet sofort, die Seite sieht kein keydown', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const t0 = Date.now();
  await p.keyboard.press('a');
  const ms = await bisWeg(p, t0);
  const z = await zaehler(p);
  expect(z.keydown).toBe(0);
  expect(z.keyup).toBe(0);
  const c = await capture(p);
  expect(c.keydown + c.keyup + c.keypress).toBe(0);
  console.log(`chromium spirale: Taste beendet nach ${ms} ms, Seite zaehlt keydown ${z.keydown}, keyup ${z.keyup}, frueher Fenster-Horcher keydown ${c.keydown}, keyup ${c.keyup}, keypress ${c.keypress}`);
  // Auch Leertaste und Pfeil (Kuerzel der Seite) erreichen sie nicht, solange die Spirale steht.
  await ruheWieder(p);
  await zeigeSpirale(p);
  await p.keyboard.press('ArrowDown');
  await bisWeg(p, Date.now());
  expect((await zaehler(p)).keydown).toBe(0);
  await p.close();
});

test('Klick beendet sofort, der Link darunter wird nicht ausgeloest', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const t0 = Date.now();
  await p.mouse.down();
  const ms = await bisWeg(p, t0);
  await p.mouse.up();
  await abwarten(500);
  const z = await zaehler(p);
  expect(await pfad(p)).toBe('/spirale.html');
  expect(z.linkClick).toBe(0);
  expect(z.click).toBe(0);
  expect(z.mousedown).toBe(0);
  expect(z.mouseup).toBe(0);
  const c = await capture(p);
  expect(c.pointerdown + c.pointerup + c.mousedown + c.mouseup + c.click).toBe(0);
  console.log(`chromium spirale: Klick beendet nach ${ms} ms, Link ausgeloest ${z.linkClick}, click ${z.click}, mousedown ${z.mousedown}, mouseup ${z.mouseup}, frueher Fenster-Horcher pointerdown ${c.pointerdown}, mousedown ${c.mousedown}, mouseup ${c.mouseup}, click ${c.click}`);
  // Danach (neue Geste) wirkt die Seite wieder: ein Klick erreicht den Link.
  await ruheWieder(p);
  await p.mouse.click(150, 130);
  await p.waitForURL('**/hello.html');
  await p.close();
});

test('Nachlauf endet bei blur des Fensters (Loslassen kommt nie an)', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  await p.keyboard.down('a');
  await bisWeg(p, Date.now());
  expect((await abbild(p))!.nachlaufAktiv).toBe(true);
  await p.evaluate(() => window.dispatchEvent(new Event('blur')));
  await bisAbbild(p, (x) => !x.nachlaufAktiv, 2000, 10);
  await p.keyboard.up('a');
  await abwarten(100);
  expect((await capture(p)).keyup).toBe(1); // das Loslassen nach dem blur gehoert der Seite
  console.log('chromium spirale: Nachlauf nach blur sofort aus, naechster Tastendruck erreicht die Seite');
  await p.close();
});

test('Rad beendet sofort', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const t0 = Date.now();
  await p.mouse.wheel(0, 100);
  const ms = await bisWeg(p, t0);
  expect((await zaehler(p)).wheel).toBe(0);
  // Bewusste Grenze: ein Horcher der Seite fuer wheel, der VOR uns am Fenster haengt, sieht dieses eine Rad noch (ein frueher nicht passiver
  // wheel-Horcher wuerde das Scrollen jeder Seite bremsen).
  console.log(`chromium spirale: Rad beendet nach ${ms} ms`);
  await p.close();
});

test('beendendes Ereignis hat keine Standardaktion: scrollbare Seite scrollt nicht, Fokus bleibt', async () => {
  test.setTimeout(90_000);
  const p = await oeffne('?lang=1');
  const stand = () => p.evaluate(() => ({ y: scrollY, fokus: document.activeElement?.tagName }));
  for (const taste of [' ', 'PageDown', 'ArrowDown', 'End', 'Tab']) {
    await zeigeSpirale(p);
    await p.keyboard.press(taste);
    await bisWeg(p, Date.now());
    await abwarten(150);
    const st = await stand();
    expect(st.y, `scrollY nach ${JSON.stringify(taste)}`).toBe(0);
    expect(st.fokus, `Fokus nach ${JSON.stringify(taste)}`).toBe('BODY');
    await ruheWieder(p);
  }
  await zeigeSpirale(p);
  await p.mouse.wheel(0, 600);
  await bisWeg(p, Date.now());
  await abwarten(300);
  expect((await stand()).y).toBe(0);
  console.log('chromium spirale: Leertaste, Bild ab, Pfeil, Ende, Tab und Rad ohne Standardaktion (scrollY 0, Fokus bleibt)');
  // Gegenprobe: ohne Spirale scrollt dieselbe Seite.
  await ruheWieder(p);
  await p.mouse.wheel(0, 600);
  await expect.poll(async () => (await stand()).y).toBeGreaterThan(0);
  await p.close();
});

test('stehendes Bild nach 15 Minuten, nach dem Ende kein Zeichnen und keine Horcher; Unterrahmen bleiben leer', async () => {
  test.setTimeout(90_000);
  const p = await oeffne('?rahmen=1');
  const basis = (await abbild(p))!.offeneHoerer;
  await zeigeSpirale(p);
  const laeuft = (await abbild(p))!;
  expect(laeuft.offeneHoerer).toBeGreaterThan(basis);
  // Unterrahmen: weder Host noch Testspur.
  const rahmen = p.frames().find((f) => f !== p.mainFrame())!;
  expect(await rahmen.evaluate(() => document.querySelectorAll('[data-veil-spirale-host]').length)).toBe(0);
  expect(await rahmen.evaluate(() => document.documentElement.hasAttribute('data-veil-spirale'))).toBe(false);
  // Uhr um 15 Minuten vorstellen: das Bild steht.
  await p.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { uhrVor: 15 * 60_000 } }) })));
  const steht = await bisAbbild(p, (x) => x.stehend === true, 5000);
  await abwarten(600);
  const spaeter = (await abbild(p))!;
  expect(spaeter.bilderGesamt).toBe(steht.bilderGesamt);
  expect(spaeter.stehend).toBe(true);
  // Taste beendet: Nachlauf laeuft nach dem Loslassen aus, danach ist alles abgemeldet und nichts wird mehr gezeichnet.
  await p.keyboard.press('x');
  await bisWeg(p, Date.now());
  await bisAbbild(p, (x) => !x.nachlaufAktiv && x.offeneHoerer === basis, 3000, 20);
  const nach1 = (await abbild(p))!;
  await abwarten(700);
  const nach2 = (await abbild(p))!;
  expect(nach2.bilderGesamt).toBe(nach1.bilderGesamt);
  console.log(`chromium spirale: Bild steht nach vorgestellter Uhr (Bilder ${steht.bilderGesamt} gleichbleibend), nach dem Ende 0 neue Bilder, Horcher ${laeuft.offeneHoerer} auf ${nach2.offeneHoerer} (Grundstand ${basis}), Unterrahmen leer`);
  await p.close();
});

test('gespeicherte Pause, Schalter aus und active beenden sofort', async () => {
  test.setTimeout(90_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  let t0 = Date.now();
  await setzeEinstellungen({ pause: true });
  const msPause = await bisWeg(p, t0);
  await setzeEinstellungen({ pause: false });
  await ruheWieder(p);
  await zeigeSpirale(p);
  t0 = Date.now();
  await setzeKontrolle({ leerlauf: false });
  const msAus = await bisWeg(p, t0);
  await setzeKontrolle({});
  await ruheWieder(p);
  await zeigeSpirale(p);
  t0 = Date.now();
  await sende(p, 'active');
  const msAktiv = await bisWeg(p, t0);
  expect((await abbild(p))!.endeGrund).toBe('aktiv');
  await abwarten(400);
  await zeigeSpirale(p);
  t0 = Date.now();
  await sende(p, 'locked');
  const msLocked = await bisWeg(p, t0);
  console.log(`chromium spirale: Pause ${msPause} ms, Schalter aus ${msAus} ms, active ${msAktiv} ms, locked ${msLocked} ms`);
  await p.close();
});

test('Pack entfernt beendet sofort; Pack wieder importieren', async () => {
  test.setTimeout(90_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const t0 = Date.now();
  await entfernePack();
  const ms = await bisWeg(p, t0);
  console.log(`chromium spirale: Pack weg, Spirale nach ${ms} ms (inklusive Entfernen) beendet`);
  await p.close();
  await importierePack();
});

test('lokale Pause beendet sofort (ohne Antwort des Hintergrunds)', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  await zeigeSpirale(p);
  const t0 = Date.now();
  await p.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ spirale: { lokalePause: true } }) })));
  const ms = await bisWeg(p, t0);
  expect((await abbild(p))!.endeGrund).toBe('pause');
  // Danach gibt es auf dieser Seite keine Spirale mehr.
  await ruheWieder(p);
  const nochmal = await idleUndEntscheidung(p);
  expect(nochmal.a.ergebnis).toBe('absage:nicht-erlaubt');
  console.log(`chromium spirale: lokale Pause beendet nach ${ms} ms`);
  await p.close();
});

test('Warnkarte beim ersten Mal: Got it, No spiral for me, Escape, Klick daneben', async () => {
  test.setTimeout(120_000);
  await setzeWarnung(false);
  // Got it: Karte weg, Warnung gemerkt, beim naechsten Leerlauf die Spirale.
  let p = await oeffne();
  let r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('warnung');
  expect(r.a.phase).toBe('warnung');
  expect(r.a.knoepfe).not.toBeNull();
  expect(r.a.hz).toBeNull();
  const ja = r.a.knoepfe!.ja;
  await p.mouse.click(ja.x + ja.w / 2, ja.y + ja.h / 2);
  await bisAbbild(p, (x) => x.phase === 'ruhend');
  expect(await hostAnzahl(p)).toBe(0);
  expect(await lies<boolean>('spiraleWarnungGesehen')).toBe(true);
  const cj = await capture(p);
  expect(cj.pointerdown + cj.mousedown + cj.mouseup + cj.click).toBe(0);
  await ruheWieder(p);
  await zeigeSpirale(p);
  await p.close();
  // No spiral for me: Schalter aus.
  await setzeWarnung(false);
  p = await oeffne();
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('warnung');
  const nein = r.a.knoepfe!.nein;
  await p.mouse.click(nein.x + nein.w / 2, nein.y + nein.h / 2);
  await bisAbbild(p, (x) => x.phase === 'ruhend');
  await expect.poll(async () => (await lies<{ kontrolle: { leerlauf: boolean } }>('einstellungen')).kontrolle.leerlauf).toBe(false);
  expect(await lies<boolean>('spiraleWarnungGesehen')).toBeUndefined();
  await p.close();
  // Escape: zu, nichts gemerkt.
  await setzeKontrolle({});
  p = await oeffne();
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('warnung');
  await p.keyboard.press('Escape');
  await bisAbbild(p, (x) => x.phase === 'ruhend');
  expect(await hostAnzahl(p)).toBe(0);
  expect((await zaehler(p)).keydown).toBe(0);
  const ce = await capture(p);
  expect(ce.keydown + ce.keyup + ce.keypress).toBe(0);
  expect(await lies<boolean>('spiraleWarnungGesehen')).toBeUndefined();
  await abwarten(400);
  // Klick neben die Karte: zu, nichts gemerkt. Die Karte bleibt auch bei active stehen.
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('warnung');
  await sende(p, 'active');
  await abwarten(300);
  expect((await abbild(p))!.phase).toBe('warnung');
  await p.mouse.click(700, 500);
  await bisAbbild(p, (x) => x.phase === 'ruhend');
  expect(await hostAnzahl(p)).toBe(0);
  expect((await zaehler(p)).click).toBe(0);
  expect(await lies<boolean>('spiraleWarnungGesehen')).toBeUndefined();
  await p.close();
  // Tastatur: Tab bleibt auf der Karte (Fokus wandert nicht in die Seite), Enter auf dem Knopf bestaetigt.
  p = await oeffne('?lang=1');
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('warnung');
  // Karte, Ja, Nein, Karte, Ja: der Fokus bleibt in der Karte (am Host), nie in der Seite.
  for (let i = 0; i < 3; i++) {
    await p.keyboard.press('Tab');
    expect(await p.evaluate(() => document.activeElement?.hasAttribute('data-veil-spirale-host'))).toBe(true);
  }
  await p.keyboard.press('Tab');
  await p.keyboard.press('Enter');
  await bisAbbild(p, (x) => x.phase === 'ruhend');
  expect(await lies<boolean>('spiraleWarnungGesehen')).toBe(true);
  const ct = await capture(p);
  const sy = await p.evaluate(() => ({ y: scrollY, fokus: document.activeElement?.tagName }));
  expect(ct.keydown + ct.keyup + ct.keypress).toBe(0);
  expect(sy).toEqual({ y: 0, fokus: 'BODY' });
  console.log('chromium spirale: Warnkarte beide Knoepfe, Escape und Klick daneben, Tastatur (Tab bleibt auf der Karte, Enter bestaetigt), Karte bleibt bei active');
  await p.close();
});

test('keine Spirale: Fokus im Eingabefeld, Fokus im Rahmen, Vollbild, Schalter aus, eigene Ausnahme', async () => {
  test.setTimeout(120_000);
  // Eingabefeld
  let p = await oeffne('?feld=1');
  let r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('absage:eingabe');
  expect(await hostAnzahl(p)).toBe(0);
  await p.close();
  // Rahmen mit Fokus
  p = await oeffne('?rahmen=1');
  await p.evaluate(() => (document.getElementById('rahmen') as HTMLIFrameElement).focus());
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('absage:eingabe');
  expect(await hostAnzahl(p)).toBe(0);
  await p.close();
  // Vollbild
  p = await oeffne();
  await p.mouse.click(460, 220);
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('absage:vollbild');
  expect(await hostAnzahl(p)).toBe(0);
  await p.close();
  // Schalter aus
  await setzeKontrolle({ leerlauf: false });
  p = await oeffne();
  r = await idleUndEntscheidung(p);
  expect(r.antwort.gesendet).toBe(false);
  expect(await hostAnzahl(p)).toBe(0);
  await p.close();
  // Eigene Ausnahme
  await setzeKontrolle({});
  await setzeEinstellungen({ ausnahmen: ['127.0.0.1'] });
  p = await oeffne();
  r = await idleUndEntscheidung(p);
  expect(r.a.ergebnis).toBe('absage:nicht-erlaubt');
  expect(await hostAnzahl(p)).toBe(0);
  await p.close();
  console.log('chromium spirale: 5 Faelle ohne Spirale (Feld, Rahmen, Vollbild, Schalter aus, Ausnahme), 0 Hosts');
});

test('Minuten-Einstellung setzt den Erkennungsabstand (ueber den Horcher auf die Einstellungen)', async () => {
  test.setTimeout(60_000);
  const p = await oeffne();
  const w: number[] = [];
  for (const min of [5, 1, 60, 2]) {
    await setzeKontrolle({ leerlaufMinuten: min });
    // Der Haken meldet nur den zuletzt gesetzten Wert; der Horcher braucht einen Moment.
    await expect.poll(async () => (await sende(p, 'active')).abstand, { timeout: 5000, intervals: [50] }).toBe(min * 60);
    w.push(min * 60);
  }
  console.log(`chromium spirale: Erkennungsabstand ${w.join(', ')} s fuer 5, 1, 60, 2 Minuten`);
  await p.close();
});

// Hinweis: "Tab verborgen" (visibilitychange) laesst sich im kopflosen Chromium nicht herstellen (Hintergrund-Tabs bleiben sichtbar); der Firefox-Test deckt ihn ab.
