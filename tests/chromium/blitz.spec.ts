// Chromium: Auftrag B (Phase 5, PHASE-5-AUFTRAEGE-SESSION-9.md Abschnitt 4). Blitzwoerter: Einzelwort und Schwarm erscheinen und enden, Grenzen
// (185 ms je Wort, hoechstens 12 Woerter in 2500 ms) aus dem Testabbild UND aus Pixeln (CDP-Bildfolge, Wortfarbe je Bild), nichts bei Eingabe,
// Ruhig-Modus, in Rahmen, ohne Pack oder Freischaltung, bei aus, auf Ausnahme, ohne bestaetigte Warnung; Pause und Taste brechen ab; Zeitplan.
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
const SEITE = `http://127.0.0.1:${port}/blitz.html`;
const DUMMY_WOERTER = ['TESTWORD', 'TESTFLASH', 'TESTDOWN'];

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean; id?: string }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

interface Wort { text: string; an: number; aus: number | null; schrift?: boolean }
interface Abbild { nr: number; laeuft: boolean; woerter: Wort[]; abbruch?: string | null; abgelehnt?: string; schriftWarten?: { ms: number; bereit: boolean } | null }

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let altPackPfad: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const KONTROLLE = { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 };

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-blitz-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-blitz-pack-'));
  const bau = await ladeBau();
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await bau.baueDummyPack()).bytes);
  altPackPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPackPfad, (await bau.baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);
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

async function setzeEinstellungen(neu: Record<string, unknown>) {
  await worker.evaluate(async (n) => {
    const api = (globalThis as any).chrome;
    const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
    await api.storage.local.set({ einstellungen: { ...alt, ...n } });
  }, neu);
}
const setzeSpeicher = (werte: Record<string, unknown>) => worker.evaluate((w) => (globalThis as any).chrome.storage.local.set(w), werte);
const loescheSpeicher = (...schluessel: string[]) => worker.evaluate((s) => (globalThis as any).chrome.storage.local.remove(s), schluessel);
const liesSpeicher = (schluessel: string) => worker.evaluate(async (s) => (await (globalThis as any).chrome.storage.local.get(s))[s], schluessel);

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
  const roh = await s.evaluate(() => document.documentElement.getAttribute('data-veil-blitz'));
  return roh ? (JSON.parse(roh) as Abbild) : null;
};
const sende = (s: Page, blitz: Record<string, unknown>) =>
  s.evaluate((b) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ blitz: b }) })), blitz);
// Loest aus und wartet auf die Antwort des Moduls (Abbild mit neuer Nummer: laeuft oder abgelehnt).
async function loeseAus(s: Page, blitz: Record<string, unknown>): Promise<Abbild> {
  const vorher = (await abbildVon(s))?.nr ?? 0;
  await sende(s, blitz);
  await expect.poll(async () => ((await abbildVon(s))?.nr ?? 0) > vorher, { timeout: 10_000, intervals: [30] }).toBe(true);
  return (await abbildVon(s))!;
}
async function warteEnde(s: Page): Promise<Abbild> {
  await expect.poll(async () => (await abbildVon(s))?.laeuft === false, { timeout: 10_000, intervals: [30] }).toBe(true);
  return (await abbildVon(s))!;
}
// Wartet, bis die Blitz-Aufgabe sicher nichts zeigt, und liefert das Abbild (abgelehnt) zurueck.
async function erwarteAbgelehnt(s: Page, grund: string, blitz: Record<string, unknown> = { ereignis: 'wort' }) {
  const a = await loeseAus(s, blitz);
  expect(a.abgelehnt, JSON.stringify(a)).toBe(grund);
  expect(a.woerter).toEqual([]);
}
async function neueSeite(abfrage = ''): Promise<Page> {
  const s = await context.newPage();
  await s.goto(SEITE + abfrage);
  await s.bringToFront();
  // Das Content-Script braucht einen Augenblick fuer Pack und Einstellungen; ein erster Aufruf wird sonst abgelehnt.
  await abwarten(1200);
  return s;
}

// ---------- Pixel: CDP-Bildfolge, Wortfarbe (Mias Pink) je Bild ----------
// `rand`: mittlere Helligkeit der untersten 8 % der Zeilen (dort steht nie ein Wort): ein vollflaechiger Wechsel wuerde sie veraendern.
interface Bild { ts: number; n: number; cx: number; rand: number }
async function starteBildfolge(s: Page) {
  const cdp = await context.newCDPSession(s);
  const roh: Array<{ ts: number; daten: string }> = [];
  cdp.on('Page.screencastFrame', async (f) => {
    roh.push({ ts: f.metadata.timestamp! * 1000, daten: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 640, maxHeight: 360, everyNthFrame: 1 });
  return {
    async stoppe(): Promise<Bild[]> {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      const aus: Bild[] = [];
      for (const b of roh) {
        const { data, info } = await sharp(Buffer.from(b.daten, 'base64')).raw().toBuffer({ resolveWithObject: true });
        let n = 0;
        let sx = 0;
        let randSumme = 0;
        let randZahl = 0;
        for (let i = 0; i < data.length; i += info.channels) {
          if (Math.floor(i / info.channels / info.width) >= info.height * 0.92) {
            randSumme += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
            randZahl++;
          }
          const r = data[i]!, g = data[i + 1]!, bl = data[i + 2]!;
          if (r > 200 && g < 140 && bl > 100 && bl < 230) {
            n++;
            sx += (i / info.channels) % info.width;
          }
        }
        aus.push({ ts: b.ts, n, cx: n ? sx / n : -1, rand: randZahl ? randSumme / randZahl : 0 });
      }
      return aus;
    },
  };
}
 // Groesster Helligkeitsunterschied (von 255) des Randstreifens zwischen allen Bildern: ohne vollflaechigen Wechsel nahe 0.
function randSchwankung(bilder: Bild[]): number {
  const r = bilder.map((b) => b.rand);
  return Math.max(...r) - Math.min(...r);
}
// Ein "Wort erscheint" ist der Sprung von keinem Pink zu Pink oder ein Sprung des Schwerpunkts um mehr als 40 Pixel.
function pixelWorte(bilder: Bild[]): number[] {
  const an: number[] = [];
  let vorher: Bild | null = null;
  for (const b of bilder) {
    const da = b.n >= 40;
    const war = !!vorher && vorher.n >= 40;
    if (da && (!war || Math.abs(b.cx - vorher!.cx) > 40)) an.push(b.ts);
    vorher = b;
  }
  return an;
}

test.beforeEach(async () => {
  await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove(['einstellungen', 'blitzZeitplan']));
  await setzeSpeicher({ quizWarnungGesehen: true });
});

test('ohne Pack zeigt sich nichts, auch nicht per Testereignis', async () => {
  test.setTimeout(60_000);
  await entfernePack();
  const s = await neueSeite();
  await erwarteAbgelehnt(s, 'kein-pack');
  await s.close();
});

test('Pack importieren', async () => {
  test.setTimeout(60_000);
  await importierePack(packPfad);
});

test('Einzelwort: erscheint in der Mitte, etwa 300 ms, dann weg; Pixel bestaetigen es, trotz grober Seitenregeln keine Flaeche', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite('?regel=1');
  const folge = await starteBildfolge(s);
  await abwarten(200);
  const start = await loeseAus(s, { ereignis: 'wort', zufall: [0.5] });
  expect(start.abgelehnt, JSON.stringify(start)).toBeUndefined();
  const ende = await warteEnde(s);
  await abwarten(200);
  const bilder = await folge.stoppe();
  expect(ende.abbruch).toBe('fertig');
  expect(ende.woerter).toHaveLength(1);
  const w = ende.woerter[0]!;
  expect(DUMMY_WOERTER).toContain(w.text);
  // Session 17 (Testluecke UEBERGABE-16 Punkt 4): das erste Wort einer frischen Seite erscheint erst mit geladener runder Schrift, oder nach
  // der Zeitgrenze von 300 ms (Rueckfall Systemschrift). Kam die Schrift rechtzeitig, ist sie beim ersten Wort auch wirklich geladen.
  console.log(`Einzelwort: Schrift ${w.schrift ? 'geladen' : 'nicht geladen'} beim ersten Wort, gewartet ${JSON.stringify(ende.schriftWarten)}`);
  expect(ende.schriftWarten).toBeTruthy();
  if (ende.schriftWarten!.bereit) expect(w.schrift).toBe(true);
  else expect(ende.schriftWarten!.ms).toBeGreaterThanOrEqual(290);
  const dauer = w.aus! - w.an;
  console.log(`Einzelwort: Sichtdauer ${dauer.toFixed(0)} ms (Abbild)`);
  expect(dauer).toBeGreaterThanOrEqual(280);
  expect(dauer).toBeLessThanOrEqual(360);
  const px = pixelWorte(bilder);
  const sichtbar = bilder.filter((b) => b.n >= 40);
  console.log(`Einzelwort: ${px.length} Wort in Pixeln, ${sichtbar.length} Bilder mit Pink, Schwerpunkt x ${sichtbar[0]?.cx.toFixed(0)} von 640`);
  expect(px).toHaveLength(1);
  expect(Math.abs(sichtbar[0]!.cx - 320)).toBeLessThan(40);
  const schwank = randSchwankung(bilder);
  console.log(`Einzelwort: Helligkeit des Randstreifens schwankt um ${schwank.toFixed(1)} von 255 (Seite mit groben div-Regeln)`);
  expect(schwank).toBeLessThan(6);
  // am Ende wieder kein Pink, nichts bleibt stehen
  expect(bilder[bilder.length - 1]!.n).toBeLessThan(40);
  // kein Host mehr im Dokument (Wurzel geschlossen: nur Kinder von html pruefen)
  expect(await s.evaluate(() => [...document.documentElement.children].filter((e) => e.getAttribute('aria-hidden') === 'true').length)).toBe(0);
  await s.close();
});

test('Schwarm: 6 bis 12 Woerter, mindestens 185 ms Abstand, hoechstens 2500 ms, in Abbild und Pixeln', async () => {
  test.setTimeout(90_000);
  for (const zufall of [[0.0], [0.9, 0.3, 0.6], [0.99, 0.5, 0.1, 0.8]]) {
    const s = await neueSeite('?regel=1');
    const folge = await starteBildfolge(s);
    await abwarten(200);
    const start = await loeseAus(s, { ereignis: 'schwarm', zufall });
    expect(start.abgelehnt, JSON.stringify(start)).toBeUndefined();
    const ende = await warteEnde(s);
    await abwarten(250);
    const bilder = await folge.stoppe();
    expect(ende.abbruch).toBe('fertig');
    const ws = ende.woerter;
    expect(ws.length).toBeGreaterThanOrEqual(6);
    expect(ws.length).toBeLessThanOrEqual(12);
    const abst = ws.slice(1).map((w, i) => w.an - ws[i]!.an);
    const spanne = ws[ws.length - 1]!.aus! - ws[0]!.an;
    for (let i = 1; i < ws.length; i++) expect(ws[i]!.text).not.toBe(ws[i - 1]!.text);
    console.log(`Schwarm ${JSON.stringify(zufall)}: ${ws.length} Woerter, kleinster Abstand ${Math.min(...abst).toFixed(0)} ms, Spanne ${spanne.toFixed(0)} ms (Abbild)`);
    expect(Math.min(...abst)).toBeGreaterThanOrEqual(185);
    expect(spanne).toBeLessThanOrEqual(2500);
    // Pixel: Bildfolge hat Zeitstempel der Bildschirmbilder (Takt etwa 16 ms), daher 20 ms Toleranz
    const px = pixelWorte(bilder);
    const pa = px.slice(1).map((t, i) => t - px[i]!);
    const pspanne = bilder.filter((b) => b.n >= 40).at(-1)!.ts - px[0]!;
    console.log(`  Pixel: ${px.length} Woerter, kleinster Abstand ${Math.min(...pa).toFixed(0)} ms, Spanne ${pspanne.toFixed(0)} ms`);
    expect(px.length).toBeLessThanOrEqual(12);
    expect(px.length).toBeGreaterThanOrEqual(ws.length - 1);
    expect(Math.min(...pa)).toBeGreaterThanOrEqual(185 - 20);
    expect(pspanne).toBeLessThanOrEqual(2500 + 40);
    expect(randSchwankung(bilder)).toBeLessThan(6);
    await s.close();
  }
});

test('nichts bei Fokus im Eingabefeld, im editierbaren Bereich und in einem Rahmen', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await s.locator('#feld').focus();
  await erwarteAbgelehnt(s, 'eingabe');
  await s.locator('#bearbeitbar').focus();
  await erwarteAbgelehnt(s, 'eingabe');
  await s.frameLocator('#rahmen').locator('#innen').focus();
  await erwarteAbgelehnt(s, 'eingabe');
  await s.close();
});

test('nichts bis 2 s nach einer Taste, danach wieder', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await s.keyboard.press('a');
  await abwarten(300);
  await erwarteAbgelehnt(s, 'eingabe');
  await abwarten(1000);
  await erwarteAbgelehnt(s, 'eingabe'); // etwa 1,5 s nach der Taste: noch gesperrt
  await abwarten(1000);
  const a = await loeseAus(s, { ereignis: 'wort' });
  console.log(`2 s nach der Taste: abgelehnt=${a.abgelehnt ?? 'nein'}`);
  expect(a.abgelehnt).toBeUndefined();
  await warteEnde(s);
  await s.close();
});

test('nichts im Ruhig-Modus und bei prefers-reduced-motion', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await setzeEinstellungen({ ruhig: true });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'ruhig');
  await setzeEinstellungen({ ruhig: false });
  await abwarten(300);
  await s.emulateMedia({ reducedMotion: 'reduce' });
  await erwarteAbgelehnt(s, 'ruhig');
  await s.emulateMedia({ reducedMotion: 'no-preference' });
  const a = await loeseAus(s, { ereignis: 'wort' });
  expect(a.abgelehnt).toBeUndefined();
  await warteEnde(s);
  await s.close();
});

test('nichts in Rahmen: das Modul laeuft nur in der obersten Seite', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  const rahmen = s.frames().find((f) => f !== s.mainFrame())!;
  await rahmen.evaluate(() => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ blitz: { ereignis: 'wort' } }) })));
  await abwarten(1200);
  // Gegenprobe: das Content-Script (Schleier) lief im Rahmen sehr wohl, nur das Blitz-Modul nicht.
  expect(await rahmen.evaluate(() => document.documentElement.hasAttribute('data-veil-status'))).toBe(true);
  expect(await rahmen.evaluate(() => document.documentElement.getAttribute('data-veil-blitz'))).toBeNull();
  expect(await abbildVon(s)).toBeNull();
  await s.close();
});

test('nichts bei aus, auf eigener Ausnahme, ohne bestaetigte Warnung und ohne Pause nur mit Pause', async () => {
  test.setTimeout(90_000);
  const s = await neueSeite();
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE, blitz: 'aus' } });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'aus');
  await setzeEinstellungen({ kontrolle: { ...KONTROLLE }, ausnahmen: ['127.0.0.1'] });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'nicht-erlaubt');
  await setzeEinstellungen({ ausnahmen: [], pause: true });
  await abwarten(300);
  await erwarteAbgelehnt(s, 'nicht-erlaubt');
  await setzeEinstellungen({ pause: false });
  await loescheSpeicher('quizWarnungGesehen', 'spiraleWarnungGesehen');
  await abwarten(300);
  await erwarteAbgelehnt(s, 'warnung');
  // Gegenprobe: mit der Warnung aus dem Spiral-Schluessel geht es wieder
  await setzeSpeicher({ spiraleWarnungGesehen: true });
  const a = await loeseAus(s, { ereignis: 'wort' });
  expect(a.abgelehnt).toBeUndefined();
  await warteEnde(s);
  await s.close();
});

test('ohne Freischaltung (altes Pack) zeigt sich nichts; mit dem Dummy-Pack wieder', async () => {
  test.setTimeout(90_000);
  await importierePack(altPackPfad);
  const s = await neueSeite();
  const a = await loeseAus(s, { ereignis: 'wort' });
  console.log(`altes Pack: abgelehnt=${a.abgelehnt}`);
  expect(a.abgelehnt).toBe('nicht-erlaubt');
  expect(a.woerter).toEqual([]);
  await s.close();
  await importierePack(packPfad);
});

test('Pause bricht einen laufenden Schwarm sofort ab', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  const start = await loeseAus(s, { ereignis: 'schwarm', zufall: [0.5] });
  expect(start.abgelehnt).toBeUndefined();
  await expect.poll(async () => ((await abbildVon(s))?.woerter.length ?? 0) >= 2, { timeout: 5000, intervals: [30] }).toBe(true);
  const t0 = Date.now();
  await setzeEinstellungen({ pause: true });
  const ende = await warteEnde(s);
  console.log(`Pause: Abbruch nach ${Date.now() - t0} ms, ${ende.woerter.length} Woerter gezeigt, Grund ${ende.abbruch}`);
  expect(ende.woerter.length).toBeLessThan(6);
  expect(['einstellung', 'pause']).toContain(ende.abbruch);
  expect(ende.woerter.every((w) => w.aus !== null)).toBe(true);
  await s.close();
});

test('eine Taste bricht einen laufenden Schwarm ab', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await loeseAus(s, { ereignis: 'schwarm', zufall: [0.5] });
  await expect.poll(async () => ((await abbildVon(s))?.woerter.length ?? 0) >= 2, { timeout: 5000, intervals: [30] }).toBe(true);
  await s.keyboard.press('b');
  const ende = await warteEnde(s);
  console.log(`Taste: Abbruch nach ${ende.woerter.length} Woertern, Grund ${ende.abbruch}`);
  expect(ende.abbruch).toBe('taste');
  expect(ende.woerter.length).toBeLessThan(12);
  await s.close();
});

test('Fokus ins Eingabefeld bricht einen Schwarm ab', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await loeseAus(s, { ereignis: 'schwarm', zufall: [0.5] });
  await expect.poll(async () => ((await abbildVon(s))?.woerter.length ?? 0) >= 2, { timeout: 5000, intervals: [30] }).toBe(true);
  await s.locator('#feld').focus();
  const ende = await warteEnde(s);
  expect(['eingabe', 'taste']).toContain(ende.abbruch);
  await s.close();
});

test('Zeitplan: fehlender Plan wird ab jetzt angelegt, faelliger Plan zeigt ein Wort und schreibt den naechsten', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  const jetzt = Date.now();
  const a = await loeseAus(s, { takt: true, jetzt });
  expect(a.abgelehnt).toBe('nicht-faellig');
  const plan = (await liesSpeicher('blitzZeitplan')) as { zuletzt: number; abstandMs: number };
  console.log(`Zeitplan neu: zuletzt=jetzt (${plan.zuletzt === jetzt}), Abstand ${(plan.abstandMs / 60000).toFixed(1)} min`);
  expect(plan.zuletzt).toBe(jetzt);
  expect(plan.abstandMs).toBeGreaterThanOrEqual(8 * 60_000);
  expect(plan.abstandMs).toBeLessThanOrEqual(12 * 60_000);
  // 5 Minuten spaeter: noch nicht faellig
  expect((await loeseAus(s, { takt: true, jetzt: jetzt + 5 * 60_000 })).abgelehnt).toBe('nicht-faellig');
  // 13 Minuten spaeter: faellig, ein Wort oder Schwarm, neuer Plan ab dann
  const spaet = jetzt + 13 * 60_000;
  const b = await loeseAus(s, { takt: true, jetzt: spaet, ereignis: 'wort' });
  expect(b.abgelehnt).toBeUndefined();
  await warteEnde(s);
  const neu = (await liesSpeicher('blitzZeitplan')) as { zuletzt: number; abstandMs: number };
  expect(neu.zuletzt).toBe(spaet);
  // faellig, aber der Mensch tippt: nichts, und der Plan bleibt faellig
  const imp = ((await liesSpeicher('pack')) as { importiert: number }).importiert;
  await s.locator('#feld').focus();
  await setzeSpeicher({ blitzZeitplan: { zuletzt: imp + 1, abstandMs: 10 * 60_000 } });
  expect((await loeseAus(s, { takt: true, jetzt: imp + 20 * 60_000, ereignis: 'wort' })).abgelehnt).toBe('eingabe');
  expect(((await liesSpeicher('blitzZeitplan')) as { zuletzt: number }).zuletzt).toBe(imp + 1);
  await s.close();
});

test('nach erneutem Import kommt kein Wort sofort: ein Plan aus der Zeit davor gilt als fehlend', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  const imp = ((await liesSpeicher('pack')) as { importiert: number }).importiert;
  await setzeSpeicher({ blitzZeitplan: { zuletzt: imp - 3_600_000, abstandMs: 10 * 60_000 } });
  const jetzt = imp + 1000;
  const a = await loeseAus(s, { takt: true, jetzt, ereignis: 'wort' });
  console.log(`alter Plan vor dem Import: ${a.abgelehnt}`);
  expect(a.abgelehnt).toBe('nicht-faellig');
  expect(((await liesSpeicher('blitzZeitplan')) as { zuletzt: number }).zuletzt).toBe(jetzt);
  await s.close();
});

test('der Zeitgeber laeuft im Testbau nicht von selbst, nach dem Testereignis taktMs zeigt er ein faelliges Wort', async () => {
  test.setTimeout(60_000);
  // Pack-Import auf lange her stellen, damit ein Plan von vor 13 Minuten gilt.
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const p = (await api.storage.local.get('pack')).pack;
    await api.storage.local.set({ pack: { ...p, importiert: 1 } });
  });
  await setzeSpeicher({ blitzZeitplan: { zuletzt: Date.now() - 13 * 60_000, abstandMs: 10 * 60_000 } });
  const s = await neueSeite();
  await abwarten(1500);
  expect(await abbildVon(s)).toBeNull(); // faellig, aber der Zeitgeber ist aus
  await sende(s, { taktMs: 200 });
  await expect.poll(async () => (await abbildVon(s))?.woerter.length ?? 0, { timeout: 8000, intervals: [50] }).toBeGreaterThan(0);
  const plan = (await liesSpeicher('blitzZeitplan')) as { zuletzt: number };
  console.log(`Zeitgeber (200 ms): Wort gezeigt, neuer Plan ${(Date.now() - plan.zuletzt) < 10_000 ? 'ab jetzt' : 'alt'}`);
  expect(Date.now() - plan.zuletzt).toBeLessThan(15_000);
  await warteEnde(s);
  await s.close();
});

test('Vollbild: nichts davor, und ein Schwarm bricht ab, wenn die Seite in den Vollbildmodus geht', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await loeseAus(s, { ereignis: 'schwarm', zufall: [0.5] });
  await expect.poll(async () => ((await abbildVon(s))?.woerter.length ?? 0) >= 2, { timeout: 5000, intervals: [30] }).toBe(true);
  await s.click('#vollbild');
  const ende = await warteEnde(s);
  console.log(`Vollbild: Abbruch nach ${ende.woerter.length} Woertern, Grund ${ende.abbruch}`);
  expect(ende.abbruch).toBe('vollbild');
  await erwarteAbgelehnt(s, 'vollbild');
  await s.close();
});

test('Pack-Wechsel waehrend eines Schwarms bricht ihn ab', async () => {
  test.setTimeout(60_000);
  const s = await neueSeite();
  await loeseAus(s, { ereignis: 'schwarm', zufall: [0.5] });
  await expect.poll(async () => ((await abbildVon(s))?.woerter.length ?? 0) >= 2, { timeout: 5000, intervals: [30] }).toBe(true);
  await worker.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const p = (await api.storage.local.get('pack')).pack;
    await api.storage.local.set({ pack: { ...p, importiert: p.importiert + 1 } });
  });
  const ende = await warteEnde(s);
  console.log(`Pack-Wechsel: Abbruch nach ${ende.woerter.length} Woertern, Grund ${ende.abbruch}`);
  expect(ende.abbruch).toBe('pack');
  await s.close();
});

test('Pause oder Einstellung genau waehrend der Vorpruefung geht nicht verloren', async () => {
  test.setTimeout(60_000);
  const gruende: Array<string | undefined> = [];
  for (let i = 0; i < 4; i++) {
    const s = await neueSeite();
    await s.evaluate(() => {
      document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ blitz: { ereignis: 'schwarm', zufall: [0.5] } }) }));
      document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ einstellungen: { pause: true } }) }));
    });
    await abwarten(3500);
    const a = await abbildVon(s);
    console.log(`Pause in der Vorpruefung (${i}): laeuft=${a?.laeuft}, Woerter ${a?.woerter.length}, abgelehnt=${a?.abgelehnt}, Grund ${a?.abbruch}`);
    expect(a?.laeuft).toBe(false);
    expect(a!.woerter.length).toBe(0);
    gruende.push(a?.abgelehnt);
    expect(await s.evaluate(() => [...document.documentElement.children].filter((e) => e.getAttribute('aria-hidden') === 'true').length)).toBe(0);
    await s.close();
    await setzeEinstellungen({ pause: false });
    await abwarten(300);
  }
  // Mindestens ein Lauf traf wirklich das Fenster der Vorpruefung (sonst hat der Test das Fenster verfehlt).
  expect(gruende).toContain('geaendert');
});

// ---------- Riegel und lokale Pause ----------
const oeffneRiegel = (s: Page, o: Record<string, unknown>) =>
  s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: o } });
const riegelAbbild = (s: Page): Promise<any | null> =>
  s.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-riegel');
    return a ? JSON.parse(a) : null;
  });

test('Riegel: erscheint er mitten im Schwarm, bricht der ab; solange er steht, nichts; Pause im Riegel (ohne Hintergrund) haelt Blitzwoerter auf', async () => {
  test.setTimeout(90_000);
  const s = await neueSeite();
  await loeseAus(s, { ereignis: 'schwarm', zufall: [0.5] });
  await expect.poll(async () => ((await abbildVon(s))?.woerter.length ?? 0) >= 2, { timeout: 5000, intervals: [30] }).toBe(true);
  await oeffneRiegel(s, { frage: 'test-w1', pauseHaengt: true });
  const ende = await warteEnde(s);
  console.log(`Riegel: Schwarm brach nach ${ende.woerter.length} Woertern ab, Grund ${ende.abbruch}`);
  expect(ende.abbruch).toBe('belegt');
  let r: any = null;
  await expect.poll(async () => ((r = await riegelAbbild(s)) && r.zustand === 'frage'), { timeout: 8000, intervals: [50] }).toBe(true);
  await erwarteAbgelehnt(s, 'belegt');
  await s.mouse.click(r.pause.x + r.pause.w / 2, r.pause.y + r.pause.h / 2);
  await expect.poll(() => s.evaluate(() => document.documentElement.getAttribute('data-veil-riegel-ergebnis')), { timeout: 4000 }).toBe('pause');
  // Der Hintergrund hat nie geantwortet: gespeichert ist keine Pause, lokal gilt sie trotzdem.
  const gespeichert = (await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen)) as { pause?: boolean } | undefined;
  expect(gespeichert?.pause ?? false).toBe(false);
  await erwarteAbgelehnt(s, 'nicht-erlaubt');
  await s.close();
});
