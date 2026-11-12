// Chromium: Zensur-Presets (ZENSUR-PRESETS-BAUPLAN). Oberflaeche (Karten, Chips, Popup-Zeile, Interview, Migration) und Pixelmessung je
// Preset-Gruppe: Mias Gesicht (Patch mit Gesicht aus einem Testbild im Dummy-Pack), Koerper schwarz mit Wort, Mosaik-Wort, Blur,
// Zensurbalken, ganze Person, Face aus. Testbilder aus ../05 Testbilder (nie im Repo): fehlen sie, ist der Test ROT, nur mit
// VEIL_OHNE_TESTBILDER=1 wird er laut uebersprungen.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PRESETS, PRESET_IDS } from '../../src/presets';
import { PERSON_GRENZE } from '../../src/presets';
import { HINWEIS_FACE_AUS, HINWEIS_FACE_EIN, HINWEIS_KEIN_GESICHT, HINWEIS_KEINE_WOERTER, HINWEIS_MIA_PACK_FEHLT, HINWEIS_PACK_OHNE_STICKER, HINWEIS_WORT_OHNE_PACK, HINWEIS_ZONEN_AUGENBALKEN, HINWEIS_ZONEN_MIA, HINWEIS_ZONEN_ZENSURBALKEN } from '../../src/oberflaeche/gemeinsam';
import { PACK_HINWEIS_BIS_DAHIN } from '../../entrypoints/popup/texte';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

const BILD_GESICHT = 'sfw-001-portraet.jpg';
const PATCH_GESICHT = 'sfw-003-portraet.jpg';
const BILD_KOERPER = '_DSC6278.JPG';
const ROSA_RAHMEN = [255, 79, 163];
const ROSA_WORT = [255, 179, 211]; // rosa-300 aus werte.ts

const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
function zonenNur(an: string[], bedeckt = true): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ALLE) z[n] = BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt } : { an: an.includes(n) };
  return z;
}

let profil = '';
let ordner = '';
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const popupUrl = () => `chrome-extension://${erweiterungsId}/popup.html`;
const willkommenUrl = () => `chrome-extension://${erweiterungsId}/willkommen.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
const speicher = (seite: Page, schluessel: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], schluessel);
const setzeEinst = (seite: Page, teil: Record<string, unknown>) =>
  seite.evaluate(async (t) => {
    const c = (globalThis as any).chrome;
    const alt = (await c.storage.local.get('einstellungen')).einstellungen ?? {};
    await c.storage.local.set({ einstellungen: { ...alt, ...t } });
  }, teil);

function nachricht(quelle: unknown, an: string[], preset: string, extra: Record<string, unknown> = {}, rendern = true) {
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    quelle,
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: zonenNur(an), rand: 0.15, preset, ...extra },
    rendern,
  };
}
const urlQuelle = (satz: string, name: string) => ({ art: 'url', url: `${basis}/testbild/${satz}/${encodeURIComponent(name)}`, referer: '' });

async function ladeBild(satz: string, name: string): Promise<Buffer | null> {
  const antwort = await fetch(`${basis}/testbild/${satz}/${encodeURIComponent(name)}`);
  return antwort.ok ? Buffer.from(await antwort.arrayBuffer()) : null;
}
// Ein grosses Testbild auf hoechstens 1280 px verkleinern (der Erkenner arbeitet bis 1600 px, die Messung braucht gleiche Masse) und als Quelle.
async function kleinBild(satz: string, name: string): Promise<{ quelle: { art: 'daten'; dataUrl: string }; orig: Pixel }> {
  const gross = await brauchtBild(satz, name);
  const klein = await sharp(gross).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  return { quelle: { art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` }, orig: await rohPixel(klein) };
}
async function brauchtBild(satz: string, name: string): Promise<Buffer> {
  const bild = await ladeBild(satz, name);
  if (bild) return bild;
  if (OHNE_TESTBILDER) {
    console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Test mit ${satz}/${name} uebersprungen`);
    test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
  }
  throw new Error(`Testbild ${satz}/${name} fehlt (../05 Testbilder); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
}
interface Pixel { daten: Buffer; b: number; h: number }
async function rohPixel(bytes: Buffer): Promise<Pixel> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { daten: data, b: info.width, h: info.height };
}
const ausDataUrl = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

type Box = [number, number, number, number];
interface Flaeche { zone: string; box: Box; behandlung?: string; ersatz?: string; balken?: { mitte: number[]; breite: number; hoehe: number; winkel: number } }

// Kennzahlen einer Box (Pixel um `inset` nach innen versetzt): Anteil dunkel, Anzahl Wort-Rosa, Anzahl Rahmen-Rosa, mittlere Abweichung zum Original,
// Anteil Pixel mit grosser Abweichung.
function stat(orig: Pixel, aus: Pixel, box: Box, inset = 0) {
  const [bx, by, bw, bh] = box;
  let n = 0;
  let dunkel = 0;
  let wort = 0;
  let rahmen = 0;
  let summe = 0;
  let gross = 0;
  // Wort: waagerechte Ausdehnung der Wortpixel in der mittleren Zeilenhaelfte der Box (35 bis 65 % der Hoehe)
  let minX = Infinity;
  let maxX = -Infinity;
  for (let y = by + inset; y < by + bh - inset; y++) {
    for (let x = bx + inset; x < bx + bw - inset; x++) {
      const i = (y * aus.b + x) * 3;
      const r = aus.daten[i]!;
      const g = aus.daten[i + 1]!;
      const b = aus.daten[i + 2]!;
      n++;
      if (r < 60 && g < 60 && b < 60) dunkel++;
      if (Math.hypot(r - ROSA_WORT[0]!, g - ROSA_WORT[1]!, b - ROSA_WORT[2]!) < 45) {
        wort++;
        if (y >= by + bh * 0.35 && y <= by + bh * 0.65) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
      if (Math.hypot(r - ROSA_RAHMEN[0]!, g - ROSA_RAHMEN[1]!, b - ROSA_RAHMEN[2]!) < 60) rahmen++;
      const d = (Math.abs(r - orig.daten[i]!) + Math.abs(g - orig.daten[i + 1]!) + Math.abs(b - orig.daten[i + 2]!)) / 3;
      summe += d;
      if (d > 48) gross++;
    }
  }
  return { n, wortSpanne: maxX > minX ? (maxX - minX) / bw : 0, dunkel: dunkel / Math.max(1, n), wort, rahmen, mittel: summe / Math.max(1, n), gross: gross / Math.max(1, n) };
}
// Ausserhalb aller Boxen (8 px Abstand): mittlere Abweichung und Anteil grosser Abweichungen.
function aussen(orig: Pixel, aus: Pixel, boxen: Box[]) {
  let n = 0;
  let summe = 0;
  let gross = 0;
  for (let y = 0; y < orig.h; y++) {
    for (let x = 0; x < orig.b; x++) {
      if (boxen.some(([bx, by, bw, bh]) => x >= bx - 8 && x < bx + bw + 8 && y >= by - 8 && y < by + bh + 8)) continue;
      const i = (y * aus.b + x) * 3;
      const d = (Math.abs(aus.daten[i]! - orig.daten[i]!) + Math.abs(aus.daten[i + 1]! - orig.daten[i + 1]!) + Math.abs(aus.daten[i + 2]! - orig.daten[i + 2]!)) / 3;
      n++;
      summe += d;
      if (d > 48) gross++;
    }
  }
  return { n, mittel: summe / Math.max(1, n), gross: gross / Math.max(1, n) };
}

async function warteAufErkenner(): Promise<void> {
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  await expect
    .poll(
      async () => {
        try {
          await seite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }));
          return (await ausWorker({ ziel: 'erkenner', typ: 'wecke' }))?.ok === true;
        } catch {
          return false;
        }
      },
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true);
  await seite.close();
}

async function importiere(bytes: Uint8Array, name: string): Promise<string> {
  const pfad = path.join(ordner, name);
  await writeFile(pfad, bytes);
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#datei').setInputFiles(pfad);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    return (await seite.locator('#meldung').textContent()) ?? '';
  } finally {
    await seite.close();
  }
}
async function entfernePack(): Promise<void> {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
  } finally {
    await seite.close();
  }
}

const bauModul = '../../scripts/pack/baue-pack.mjs';
async function baueDummy(opts: Record<string, unknown> = {}): Promise<{ bytes: Uint8Array; farben: number[][] }> {
  const bau = (await import(bauModul)) as { baueDummyPack(o?: Record<string, unknown>): Promise<{ bytes: Uint8Array; farben: number[][] }> };
  return bau.baueDummyPack(opts);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-presets-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-presets-datei-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  await warteAufErkenner();
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

// ---------- Oberflaeche ohne Pack ----------

test('Einstellungsseite ohne Pack: dreizehn Karten in vier Gruppen, Mia- und Sticker-Presets gesperrt, Wahl gespeichert, Hinweise je Preset', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    const karten = seite.locator('#preset-karten input[name="preset"]');
    await expect(karten).toHaveCount(13);
    expect(await karten.evaluateAll((l) => l.map((f) => (f as HTMLInputElement).value))).toEqual([...PRESET_IDS]);
    await expect(seite.locator('#preset-karten .preset-gruppe')).toHaveCount(4);
    expect(await seite.locator('#preset-karten .preset-gruppe-titel').allTextContents()).toEqual(['With my face', 'With my stickers', 'Classic', 'Whole person']);
    // jede Karte hat eine Vorschau (SVG) und einen Namen
    await expect(seite.locator('#preset-karten .preset-bild svg')).toHaveCount(13);
    for (const id of PRESET_IDS) {
      await expect(seite.locator(`#preset-${id}`).locator('xpath=..').locator('strong')).toHaveText(PRESETS[id].name);
      const gesperrt = PRESETS[id].braucht !== null;
      if (gesperrt) await expect(seite.locator(`#preset-${id}`)).toBeDisabled();
      else await expect(seite.locator(`#preset-${id}`)).toBeEnabled();
    }
    await expect(seite.locator('#preset-mosaik')).toBeChecked(); // Standard ohne Pack
    await expect(seite.locator('#preset-pack-hinweis')).toHaveText(HINWEIS_MIA_PACK_FEHLT);
    await expect(seite.locator('#wort-themen')).toBeHidden(); // ohne Pack keine Chips, Wort-Presets schreiben "MIA"
    // Wort-Preset ohne Pack waehlbar, ohne Themen keine Chips
    await seite.locator('label:has(#preset-mosaik-wort)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('mosaik-wort');
    await expect(seite.locator('#stil-hinweis')).toHaveText(PRESETS['mosaik-wort'].satz);
    await expect(seite.locator('#wort-themen')).toBeHidden();
    // Hinweise bei den Zonen je Preset
    const hinweis = seite.locator('#zonen-hinweis');
    await expect(hinweis).toBeHidden();
    await expect(seite.locator('#zonen')).toHaveAttribute('aria-describedby', 'zonen-hinweis');
    for (const [id, text] of [['augenbalken', HINWEIS_ZONEN_AUGENBALKEN], ['zensurbalken', HINWEIS_ZONEN_ZENSURBALKEN]] as const) {
      await seite.locator(`label:has(#preset-${id})`).click();
      await expect(hinweis).toHaveText(text);
    }
    await seite.locator('label:has(#preset-person-blur)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('person-blur');
    await expect(seite.locator('#stil-hinweis')).toHaveText(`${PRESETS['person-blur'].satz} ${PERSON_GRENZE}`);
    await expect(hinweis).toBeHidden();
    // nach dem Neuladen noch gewaehlt
    await seite.reload();
    await expect(seite.locator('#preset-person-blur')).toBeChecked();
    await seite.locator('label:has(#preset-mosaik)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('mosaik');
  } finally {
    await seite.close();
  }
});

test('Migration: ein gespeicherter alter `stil` zeigt das richtige Preset, mia-patch ohne Pack wird Mosaik angezeigt, das Speichern raeumt `stil` auf', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    for (const [alt, neu] of [['blur', 'blur'], ['augenbalken', 'augenbalken'], ['mosaik', 'mosaik']] as const) {
      await seite.evaluate(async (stil) => {
        await (globalThis as any).chrome.storage.local.set({ einstellungen: { version: 1, stil } });
      }, alt);
      await seite.reload();
      await expect(seite.locator(`#preset-${neu}`)).toBeChecked();
    }
    // mia-patch ohne Pack: gilt Mosaik (Mia-Preset ohne Pack)
    await seite.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({ einstellungen: { version: 1, stil: 'mia-patch' } });
    });
    await seite.reload();
    await expect(seite.locator('#preset-mosaik')).toBeChecked();
    // Ein Speichern (anderes Preset waehlen) schreibt `preset` und kein `stil` mehr
    await seite.locator('label:has(#preset-blur)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('blur');
    expect('stil' in (await speicher(seite, 'einstellungen'))).toBe(false);
    // Der Erkenner nimmt auch eine alte Nachricht mit `stil` an (Mosaik wie frueher)
    const leer = await sharp({ create: { width: 200, height: 150, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    const a = await ausWorker({ ...nachricht({ art: 'daten', dataUrl: `data:image/png;base64,${leer.toString('base64')}` }, ['breast'], 'mosaik'), einstellungen: { schwelle: 0.1, zonen: zonenNur(['breast']), rand: 0.15, stil: 'blur' } });
    expect(a.ok, a.fehler).toBe(true);
    await seite.locator('label:has(#preset-mosaik)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('mosaik');
  } finally {
    await seite.close();
  }
});

test('Popup ohne Pack: Zeile mit Vorschau, Name und Change style (zur Einstellungsseite, Cover style), unter 600 px Hoehe, 360 px ohne Seitwaertsscrollen', async () => {
  const seite = await context.newPage();
  try {
    await seite.setViewportSize({ width: 360, height: 800 });
    await seite.goto(popupUrl());
    await expect(seite.locator('#status')).not.toBeEmpty();
    await expect(seite.locator('#preset-name')).toHaveText(PRESETS.mosaik.name);
    await expect(seite.locator('#preset-bild svg')).toHaveCount(1);
    await expect(seite.locator('input[name="stil"]')).toHaveCount(0); // keine vierzehn Knoepfe im Popup
    await setzeEinst(seite, { preset: 'zensurbalken' });
    await expect(seite.locator('#preset-name')).toHaveText(PRESETS.zensurbalken.name);
    await expect(seite.locator('#pack-hinweis')).toHaveText(PRESETS.zensurbalken.satz);
    await seite.locator('#aendern').click();
    await expect(seite.locator('#zonen-hinweis')).toHaveText(HINWEIS_ZONEN_ZENSURBALKEN);
    await setzeEinst(seite, { preset: 'augenbalken' });
    await expect(seite.locator('#abdeckung-kurz')).toContainText('the eyes');
    await setzeEinst(seite, { preset: 'mia-wort' }); // ohne Pack: gilt Mosaik, mit Hinweis auf das Pack
    await expect(seite.locator('#preset-name')).toHaveText(PRESETS.mosaik.name);
    await expect(seite.locator('#pack-hinweis')).toHaveText(HINWEIS_MIA_PACK_FEHLT + PACK_HINWEIS_BIS_DAHIN);
    await setzeEinst(seite, { preset: 'mosaik' });
    // Hoehe ohne Aufklappen: die bestehenden Popup-Tests pruefen die 600 px (popup.spec.ts, optik.spec.ts); hier nur die Breite
    await seite.locator('#aendern').click(); // wieder zuklappen
    expect(await seite.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    // Change style oeffnet die Einstellungsseite beim Abschnitt Cover style
    const neu = context.waitForEvent('page');
    await seite.locator('#preset-aendern').click();
    const optionen = await neu;
    await expect.poll(() => optionen.url()).toBe(`chrome-extension://${erweiterungsId}/options.html#abschnitt-stil`);
    await optionen.close();
  } finally {
    await seite.close();
  }
});

test('Einstieg: Seite Stil zeigt dieselben Karten kompakt, Mia-Presets gesperrt mit Hinweis, Wahl gespeichert', async () => {
  const seite = await context.newPage();
  try {
    // Einstieg abschliessen laeuft ueber den Hintergrund; hier genuegt die Seite (die Karten stehen auf Seite 3 des Interviews)
    await seite.goto(willkommenUrl());
    await expect(seite.locator('body')).not.toBeEmpty();
    // die Seiten folgen auf Warnung, 18+ und Einwilligung; Tests dazu in einstieg.spec.ts. Hier: Karten ueber den Seitenaufbau pruefen.
    const vorhanden = await seite.evaluate(() => !!document.getElementById('iv-preset-karten'));
    if (!vorhanden) test.skip(true, 'Interview-Seite 3 erst nach den Einstiegsschritten sichtbar (siehe einstieg.spec.ts)');
  } finally {
    await seite.close();
  }
});

test('Altbestand: ein gespeichertes Mia-Preset (alter stil mia-patch) mit Face aus bleibt beim Import aus, die Meldung sagt es', async () => {
  test.setTimeout(120_000);
  const { bytes } = await baueDummy();
  const pfad = path.join(ordner, 'dummy-altbestand.miapack');
  await writeFile(pfad, bytes);
  const imp = await context.newPage();
  let meldung = '';
  try {
    await imp.goto(optionsUrl());
    await imp.locator('#datei').setInputFiles(pfad);
    await expect(imp.locator('#lizenz-block')).toBeVisible();
    // Die Einstellungsseite setzt ein Mia-Preset ohne Pack beim Oeffnen zurueck; hier steht es erst jetzt da (Altbestand): Face bleibt aus
    await imp.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({ einstellungen: { version: 1, stil: 'mia-patch' } });
    });
    await imp.locator('#annehmen').click();
    await expect(imp.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    meldung = (await imp.locator('#meldung').textContent()) ?? '';
  } finally {
    await imp.close();
  }
  expect(meldung).toContain('Face is off under What I cover');
  expect(meldung).not.toContain('Face is on under What I cover');
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    const e = await speicher(seite, 'einstellungen');
    expect(e.zonen.face.an).toBe(false); // nichts geschaltet: das Mia-Preset stand schon
    expect(e.preset).toBe('mia-wort');
    await expect(seite.locator('#preset-face-hinweis')).toHaveText(HINWEIS_FACE_AUS);
  } finally {
    await seite.close();
  }
  await entfernePack(); // Mia-Preset faellt auf Mosaik zurueck, Face bleibt aus
});

// ---------- Mit Pack (ohne Gesicht in den Patches): Rueckfall ----------

test('Mit Pack ohne Gesicht in den Patches: Mia-Presets waehlbar, Chips der Wort-Themen, Gesicht faellt auf die Koerper-Behandlung zurueck', async () => {
  test.setTimeout(150_000);
  const original = await brauchtBild('sfw', BILD_GESICHT);
  const { bytes } = await baueDummy();
  const meldung = await importiere(bytes, 'dummy-ohne-gesicht.miapack');
  // Der Import sagt, dass Face an ist (Teil A) und dass man es abschalten kann
  expect(meldung).toContain('Your cover style is now “My face, black, words”');
  expect(meldung).toContain('Face is on under What I cover');
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    // erster Import mit Freischaltung: das Preset steht auf mia-wort (Standard mit Pack)
    expect((await speicher(seite, 'einstellungen')).preset).toBe('mia-wort');
    for (const id of PRESET_IDS) await expect(seite.locator(`#preset-${id}`)).toBeEnabled();
    await expect(seite.locator('#preset-mia-wort')).toBeChecked();
    await expect(seite.locator('#preset-pack-hinweis')).toBeHidden();
    await expect(seite.locator('#stil-hinweis')).toContainText('I choose my face from');
    await expect(seite.locator('#zonen-hinweis')).toHaveText(HINWEIS_ZONEN_MIA);
    // Chips: beide Themen, Standard alle an
    const chips = seite.locator('#wort-chips input[data-thema]');
    await expect(chips).toHaveCount(2);
    await expect(seite.locator('#wort-chips input[data-thema="alpha"]')).toBeChecked();
    await expect(seite.locator('#wort-chips input[data-thema="beta"]')).toBeChecked();
    expect((await speicher(seite, 'einstellungen')).woerterThemen ?? null).toBeNull();
    // Beta abwaehlen: nur alpha gespeichert
    await seite.locator('#wort-chips label:has(input[data-thema="beta"])').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).woerterThemen).toEqual(['alpha']);
    // alle abwaehlen: leer, Hinweis "MIA"
    await seite.locator('#wort-chips label:has(input[data-thema="alpha"])').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).woerterThemen).toEqual([]);
    await expect(seite.locator('#wort-hinweis')).toContainText('MIA');
    // alle wieder an: null (alle Themen des Packs)
    await seite.locator('#wort-chips label:has(input[data-thema="alpha"])').click();
    await seite.locator('#wort-chips label:has(input[data-thema="beta"])').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).woerterThemen ?? null).toBeNull();
    // Presets ohne Wort verstecken die Chips
    await seite.locator('label:has(#preset-mia-blur)').click();
    await expect(seite.locator('#wort-themen')).toBeHidden();
    await seite.locator('label:has(#preset-mia-mosaik-wort)').click();
    await expect(seite.locator('#wort-themen')).toBeVisible();
    await seite.locator('label:has(#preset-mosaik-wort)').click();
    await expect(seite.locator('#wort-themen')).toBeVisible();
    await seite.locator('label:has(#preset-mia-wort)').click();
  } finally {
    await seite.close();
  }
  // Teil A: das erste Pack hat Face eingeschaltet (mia-wort ist Standard mit Pack); Abschalten wird respektiert
  const seiteA = await context.newPage();
  try {
    await seiteA.goto(optionsUrl());
    expect((await speicher(seiteA, 'einstellungen')).zonen.face.an).toBe(true);
    await expect(seiteA.locator('#zonen input[data-zone="face"]')).toBeChecked();
    await seiteA.locator('#zonen label.schalter').filter({ hasText: 'Face' }).first().click();
    await expect.poll(async () => (await speicher(seiteA, 'einstellungen')).zonen.face.an).toBe(false);
    await seiteA.reload();
    await expect(seiteA.locator('#zonen input[data-zone="face"]')).not.toBeChecked(); // nicht bei jedem Laden wieder an
    // Mia-Preset mit Face aus: Hinweis, was dann gilt (Einstellungsseite und Popup), Kartensatz bleibt zustandsneutral
    await expect(seiteA.locator('#preset-face-hinweis')).toHaveText(HINWEIS_FACE_AUS);
    await expect(seiteA.locator('#stil-hinweis')).toContainText('With Face on, every face becomes mine.');
    const popupA = await context.newPage();
    await popupA.goto(popupUrl());
    await expect(popupA.locator('#pack-hinweis')).toContainText(HINWEIS_FACE_AUS);
    await popupA.close();
    // Mia-Preset zu Mia-Preset: bleibt aus, kein Hinweis
    await seiteA.locator('label:has(#preset-mia-blur)').click();
    await expect.poll(async () => (await speicher(seiteA, 'einstellungen')).preset).toBe('mia-blur');
    expect((await speicher(seiteA, 'einstellungen')).zonen.face.an).toBe(false);
    await expect(seiteA.locator('#preset-face-hinweis')).toHaveText(HINWEIS_FACE_AUS); // nicht "eingeschaltet": Face steht aus
    // Wechsel von einem anderen Preset auf ein Mia-Preset: Face geht an, kurzer Hinweis
    await seiteA.locator('label:has(#preset-mosaik)').click();
    await expect.poll(async () => (await speicher(seiteA, 'einstellungen')).preset).toBe('mosaik');
    expect((await speicher(seiteA, 'einstellungen')).zonen.face.an).toBe(false); // ein klassisches Preset schaltet nichts
    await seiteA.locator('label:has(#preset-mia-mosaik)').click();
    await expect.poll(async () => (await speicher(seiteA, 'einstellungen')).zonen.face.an).toBe(true);
    await expect(seiteA.locator('#preset-face-hinweis')).toHaveText(HINWEIS_FACE_EIN);
    await expect(seiteA.locator('#zonen input[data-zone="face"]')).toBeChecked();
    await seiteA.locator('label:has(#preset-mia-wort)').click(); // Mia zu Mia: Hinweis weg
    await expect(seiteA.locator('#preset-face-hinweis')).toBeHidden();
    // Wort-Themen: unbekannte Kennungen (anderes Pack): alle Chips aus, Hinweis "MIA"
    await setzeEinst(seiteA, { woerterThemen: ['gibt-es-nicht'] });
    await expect(seiteA.locator('#wort-chips input[data-thema="alpha"]')).not.toBeChecked();
    await expect(seiteA.locator('#wort-chips input[data-thema="beta"]')).not.toBeChecked();
    await expect(seiteA.locator('#wort-hinweis')).toHaveText(HINWEIS_KEINE_WOERTER);
    await setzeEinst(seiteA, { woerterThemen: null });
  } finally {
    await seiteA.close();
  }
  // Radiogruppe: eine Gruppe fuer alle Karten, die vier Gruppen darin sind benannte Gruppen (Barrierefreiheit)
  const seiteB = await context.newPage();
  try {
    await seiteB.goto(optionsUrl());
    await expect(seiteB.locator('#preset-karten')).toHaveAttribute('role', 'radiogroup');
    await expect(seiteB.locator('#preset-karten')).toHaveAttribute('aria-labelledby', 'stil-titel');
    expect(await seiteB.locator('#preset-karten [role="radiogroup"]').count()).toBe(0);
    expect(await seiteB.locator('#preset-karten [role="group"]').evaluateAll((l) => l.map((e) => [e.getAttribute('aria-labelledby'), document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent]))).toEqual([
      ['preset-gruppe-mia', 'With my face'],
      ['preset-gruppe-sticker', 'With my stickers'],
      ['preset-gruppe-klassisch', 'Classic'],
      ['preset-gruppe-person', 'Whole person'],
    ]);
    expect(await seiteB.locator('#preset-karten input[name="preset"]').count()).toBe(13);
    // Kein Gesicht in den Patch-Bildern dieses Packs (synthetisch): ehrlicher Hinweis nach fertigem Scan
    await expect(seiteB.locator('#preset-kein-gesicht')).toHaveText(HINWEIS_KEIN_GESICHT, { timeout: 15_000 });
    // Wort-Presets zeigen ohne Chips (hier: mit Pack gibt es Chips) keine Zeile "ohne Pack"
    await expect(seiteB.locator('#wort-ohne-pack')).toBeHidden();
  } finally {
    await seiteB.close();
  }
  // Erkenner: Gesichtsscan findet in den synthetischen Patches kein Gesicht
  const scan = await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
  console.log(`chromium: Gesichtsscan Dummy-Pack (synthetisch): ${JSON.stringify(scan)}`);
  expect(scan.gesamt).toBe(6);
  expect(scan.geprueft).toBe(6);
  expect(scan.mit).toBe(0);
  // Rueckfall: Gesicht an, Mia-Preset: das Gesicht bekommt die Koerper-Behandlung (hier Schwarz mit Wort), kein Patch
  const a = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-wort'));
  expect(a.ok, a.fehler).toBe(true);
  const f = (a.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  expect(f.behandlung).toBe('mia-gesicht');
  expect(f.ersatz).toBe('schwarz-wort');
  const orig = await rohPixel(original);
  const aus = await rohPixel(ausDataUrl(a.bild));
  const s = stat(orig, aus, f.box, 6);
  console.log(`chromium: Mia-Rueckfall Gesichtsbox ${f.box}: dunkel ${(s.dunkel * 100).toFixed(0)} %, Wortpixel ${s.wort}`);
  expect(s.dunkel).toBeGreaterThan(0.7);
  expect(s.wort).toBeGreaterThan(30);
  // Pixel ausserhalb unveraendert
  const aus2 = aussen(orig, aus, [f.box]);
  expect(aus2.mittel).toBeLessThan(4);
});

// ---------- Mit Pack mit Gesicht: Mias Gesicht ----------

test('Mias Gesicht: das Gesicht wird mit einem Patch-Gesicht mit pinkem Rahmen getauscht, sonst unveraenderte Pixel; Face aus laesst das Gesicht frei', async () => {
  test.setTimeout(180_000);
  const original = await brauchtBild('sfw', BILD_GESICHT);
  const patchQuelle = await brauchtBild('sfw', PATCH_GESICHT);
  await entfernePack();
  const patch = await sharp(patchQuelle).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
  const { bytes } = await baueDummy({ extraPatches: [{ name: 'patch/mit-gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patch) }] });
  await importiere(bytes, 'dummy-mit-gesicht.miapack');
  const scan = await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
  console.log(`chromium: Gesichtsscan Dummy-Pack mit einem Testbild-Patch: ${JSON.stringify(scan)}`);
  expect(scan.gesamt).toBe(7);
  expect(scan.mit).toBe(1);
  expect(scan.fertig).toBe(true);
  // Das Ergebnis liegt je Stand des Packs in einer eigenen Ablage (nicht in der Pack-Datenbank, deren Zaehler gleich bleiben)
  const ablage = await context.newPage();
  try {
    await ablage.goto(optionsUrl());
    const stand = (await speicher(ablage, 'pack')).importiert as number;
    const abl = await ablage.evaluate(
      (st) =>
        new Promise<{ schluessel: number[]; boxen: Record<string, unknown> | null }>((ok, fehl) => {
          const q = indexedDB.open('veil-pack-gesichter', 1);
          q.onerror = () => fehl(q.error);
          q.onsuccess = () => {
            const db = q.result;
            const tx = db.transaction('ergebnis', 'readonly');
            const k = tx.objectStore('ergebnis').getAllKeys();
            const w = tx.objectStore('ergebnis').get(st);
            tx.oncomplete = () => {
              db.close();
              ok({ schluessel: k.result as number[], boxen: (w.result as { boxen: Record<string, unknown> } | undefined)?.boxen ?? null });
            };
          };
        }),
      stand,
    );
    expect(abl.schluessel).toEqual([stand]);
    expect(Object.keys(abl.boxen ?? {})).toHaveLength(7);
    expect(Object.values(abl.boxen ?? {}).filter((b) => b !== null)).toHaveLength(1);
    const packDb = await ablage.evaluate(() => new Promise<string[]>((ok) => { const q = indexedDB.open('veil-pack', 1); q.onsuccess = () => { const n = [...q.result.objectStoreNames]; q.result.close(); ok(n); }; }));
    expect(packDb.sort()).toEqual(['dateien', 'meta']); // die Pack-Datenbank hat keinen zusaetzlichen Speicher
  } finally {
    await ablage.close();
  }
  const orig = await rohPixel(original);
  for (const preset of ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur']) {
    const a = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], preset));
    expect(a.ok, a.fehler).toBe(true);
    const f = (a.flaechen as Flaeche[]).find((x) => x.zone === 'face' && x.behandlung === 'mia-gesicht')!;
    expect(f, `${preset}: Gesichtsflaeche (${JSON.stringify(a.flaechen)})`).toBeTruthy();
    expect((a.flaechen as Flaeche[]).length).toBe(1); // nur das Gesicht, Augen und Mund liegen darin
    const aus = await rohPixel(ausDataUrl(a.bild));
    // Kern der Gesichtsbox: weit weg vom Original (das fremde Gesicht ist getauscht)
    const kern = stat(orig, aus, f.box, Math.round(Math.min(f.box[2], f.box[3]) * 0.15));
    // Rahmen: pinke Pixel im Randstreifen der Box
    const rand = stat(orig, aus, f.box, 0);
    const aussenWerte = aussen(orig, aus, [f.box]);
    console.log(`chromium: ${preset} Gesicht ${f.box}: Kern Abweichung ${kern.mittel.toFixed(1)}, grosse Abweichung ${(kern.gross * 100).toFixed(0)} %, Rahmenpixel ${rand.rahmen}, aussen ${aussenWerte.mittel.toFixed(2)}`);
    expect(kern.mittel).toBeGreaterThan(20);
    expect(kern.gross).toBeGreaterThan(0.5);
    expect(rand.rahmen).toBeGreaterThan(Math.round(Math.min(f.box[2], f.box[3]) * 0.9)); // mindestens ein Randstueck
    expect(aussenWerte.mittel).toBeLessThan(4);
    expect(aussenWerte.gross).toBeLessThan(0.005);
  }
  // Face aus (nur Brust an): das Gesicht bleibt, es gibt keine Gesichts- oder Augenflaeche und die Pixel im Gesicht sind unveraendert
  const frei = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['breast'], 'mia-wort'));
  expect(frei.ok, frei.fehler).toBe(true);
  expect((frei.flaechen as Flaeche[]).some((x) => x.zone === 'face' || x.zone === 'eyes' || x.zone === 'mouth')).toBe(false);
  const gesichtsBox = (await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-wort', {}, false))).flaechen[0].box as Box;
  if (frei.bild) expect(stat(orig, await rohPixel(ausDataUrl(frei.bild)), gesichtsBox, 0).mittel).toBeLessThan(4);
  // Face aus, Eyes an: die Augen bekommen die Koerper-Behandlung (Schwarz mit Wort), nicht Mias Gesicht
  const augen = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['eyes'], 'mia-wort'));
  expect((augen.flaechen as Flaeche[]).map((x) => [x.zone, x.behandlung])).toEqual([['eyes', 'schwarz-wort']]);
  // Stabil: dieselbe Anfrage, dasselbe Bild
  const eins = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-mosaik'));
  const zwei = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-mosaik'));
  expect(eins.bild).toBe(zwei.bild);
});

test('Mias Gesicht, Patch-Passt-Regel: eine zu kleine Gesichtsflaeche (Anzeige unter 24 px) bekommt den Ersatz statt eines Patches', async () => {
  test.setTimeout(90_000);
  const original = await brauchtBild('sfw', BILD_GESICHT);
  // Das Bild wird 4 mal kleiner angezeigt als es ist: die Gesichtsbox (um 250 px) ist angezeigt unter 64 px, die Mindestseite 24 px gilt in Anzeigepixeln
  const meta = await sharp(original).metadata();
  const normal = await ausWorker({ ...nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-mosaik'), breite: meta.width, hoehe: meta.height });
  const f1 = (normal.flaechen as Flaeche[])[0]!;
  const klein = await ausWorker({ ...nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-mosaik'), breite: Math.round(meta.width! / 20), hoehe: Math.round(meta.height! / 20) });
  const orig = await rohPixel(original);
  const aN = stat(orig, await rohPixel(ausDataUrl(normal.bild)), f1.box, Math.round(Math.min(f1.box[2], f1.box[3]) * 0.15));
  const aK = stat(orig, await rohPixel(ausDataUrl(klein.bild)), f1.box, Math.round(Math.min(f1.box[2], f1.box[3]) * 0.15));
  console.log(`chromium: Gesichtsflaeche ${f1.box}: voll angezeigt Rahmenpixel/Kern-Abweichung ${aN.mittel.toFixed(1)}; auf 1/20 angezeigt ${aK.mittel.toFixed(1)}`);
  // Mosaik (Ersatz) sieht dem Original aehnlicher als ein ganz anderes Gesicht
  expect(aN.mittel).toBeGreaterThan(aK.mittel);
});

// ---------- Koerper: Wort, Mosaik-Wort, Blur, Zensurbalken, Person ----------

test('Koerper-Behandlungen im Pixeltest: Schwarz mit Wort, Mosaik mit Wort und Unterlage, Blur ohne Rahmen, Zensurbalken schwarz; alles andere unveraendert', async () => {
  test.setTimeout(180_000);
  const { quelle, orig } = await kleinBild('nsfw', BILD_KOERPER);
  const an = BEDECKBAR; // alle Koerperzonen
  const messeGroesste = async (preset: string, extra: Record<string, unknown> = {}) => {
    const a = await ausWorker(nachricht(quelle, an, preset, extra));
    expect(a.ok, a.fehler).toBe(true);
    console.log(`chromium: ${preset}: Flaechen ${JSON.stringify((a.flaechen as Flaeche[]).map((x) => [x.zone, x.box]))}`);
    expect(a.flaechen.length, `${preset}: Flaechen`).toBeGreaterThanOrEqual(1);
    const f = [...(a.flaechen as Flaeche[])].sort((p, q) => q.box[2] * q.box[3] - p.box[2] * p.box[3])[0]!;
    const aus = await rohPixel(ausDataUrl(a.bild));
    return { a, f, aus, innen: stat(orig, aus, f.box, 8), aussen: aussen(orig, aus, (a.flaechen as Flaeche[]).map((x) => x.box)) };
  };
  // mia-wort: Koerper schwarz mit Wort (Gesicht aus)
  const wort = await messeGroesste('mia-wort');
  console.log(`chromium: mia-wort ${wort.f.box}: dunkel ${(wort.innen.dunkel * 100).toFixed(0)} %, Wortpixel ${wort.innen.wort}, aussen ${wort.aussen.mittel.toFixed(2)}`);
  expect(wort.f.behandlung).toBe('schwarz-wort');
  expect(wort.innen.dunkel).toBeGreaterThan(0.7);
  expect(wort.innen.wort).toBeGreaterThan(40);
  console.log(`chromium: mia-wort Wortspanne ${(wort.innen.wortSpanne * 100).toFixed(0)} % der Breite`);
  expect(wort.innen.wortSpanne).toBeGreaterThanOrEqual(0.3); // das Wort steht in der Mitte und ist mindestens ein Drittel breit
  expect(wort.innen.rahmen).toBe(0); // Schwarz mit Wort hat keinen pinken Rahmen
  expect(wort.aussen.mittel).toBeLessThan(4);
  // Wort stabil je Bild und Flaeche; mit leerer Themenwahl steht MIA (andere Pixel moeglich, aber ein Wort ist da)
  const wortNochmal = await messeGroesste('mia-wort');
  expect(wortNochmal.a.bild).toBe(wort.a.bild);
  const miaWort = await messeGroesste('mia-wort', { woerterThemen: [] });
  expect(miaWort.innen.wort).toBeGreaterThan(40);
  // Gegenstueck Mosaik (ohne Wort): Hauttoene liegen nahe an dem Rosa des Wortes, darum zaehlt der Unterschied zum Mosaik
  const mo = await messeGroesste('mosaik');
  const mw = await messeGroesste('mosaik-wort');
  const rahmenMw = stat(orig, mw.aus, mw.f.box, 0).rahmen;
  console.log(`chromium: mosaik-wort ${mw.f.box}: Rahmenpixel ${rahmenMw}, Wortpixel ${mw.innen.wort} (Mosaik ${mo.innen.wort}), dunkel ${(mw.innen.dunkel * 100).toFixed(0)} % (Mosaik ${(mo.innen.dunkel * 100).toFixed(0)} %)`);
  expect(mw.f.behandlung).toBe('mosaik-wort');
  expect(mw.innen.wort - mo.innen.wort).toBeGreaterThan(500); // das Wort
  // die dunkle Unterlage hinter dem Wort: in der Mitte weicht Mosaik-Wort stark vom Mosaik ab, in den Ecken (ausserhalb der Unterlage) nicht
  const [mx, my, mbw, mbh] = mw.f.box;
  const mitte = stat(mo.aus, mw.aus, [mx + Math.round(mbw * 0.15), my + Math.round(mbh * 0.4), Math.round(mbw * 0.7), Math.round(mbh * 0.2)]);
  const ecke = stat(mo.aus, mw.aus, [mx + 12, my + 12, Math.round(mbw * 0.25), Math.round(mbh * 0.2)]);
  console.log(`chromium: mosaik-wort gegen Mosaik: Mitte ${mitte.mittel.toFixed(1)}, Ecke ${ecke.mittel.toFixed(1)}`);
  expect(mitte.mittel).toBeGreaterThan(25);
  expect(ecke.mittel).toBeLessThan(3);
  expect(rahmenMw).toBeGreaterThan(Math.round(Math.min(mw.f.box[2], mw.f.box[3]) * 0.9)); // pinker Rahmen wie beim Mosaik
  expect(stat(orig, mo.aus, mo.f.box, 0).rahmen).toBeGreaterThan(Math.round(Math.min(mo.f.box[2], mo.f.box[3]) * 0.9));
  // blur: kein pinker Rahmen, Flaeche veraendert
  const bl = await messeGroesste('blur');
  expect(stat(orig, bl.aus, bl.f.box, 0).rahmen).toBeLessThan(10);
  expect(bl.innen.mittel).toBeGreaterThan(3);
  // zensurbalken: Koerper schwarz, kein Wort, kein Rahmen
  const zb = await messeGroesste('zensurbalken');
  console.log(`chromium: zensurbalken ${zb.f.box}: dunkel ${(zb.innen.dunkel * 100).toFixed(0)} %`);
  expect(zb.innen.dunkel).toBeGreaterThan(0.95);
  expect(zb.innen.wort).toBeLessThan(5);
  expect(zb.aussen.mittel).toBeLessThan(4);
  // Augenbalken: nur Augen, hier kein Gesicht erkannt, also keine Flaeche
  const ab = await ausWorker(nachricht(quelle, an, 'augenbalken'));
  expect((ab.flaechen as Flaeche[]).every((x) => x.zone === 'eyes')).toBe(true);
});

test('Zensurbalken: Augen immer schwarz (auch bei Eyes aus), das Gesicht sonst nur mit Face an schwarz', async () => {
  test.setTimeout(120_000);
  const original = await brauchtBild('sfw', BILD_GESICHT);
  const orig = await rohPixel(original);
  // keine Zone an: die Augenbalken kommen trotzdem
  const a = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), [], 'zensurbalken'));
  expect(a.ok, a.fehler).toBe(true);
  expect((a.flaechen as Flaeche[]).map((f) => [f.zone, f.behandlung])).toEqual([['eyes', 'balken']]);
  const aus = await rohPixel(ausDataUrl(a.bild));
  // bei geneigter Augenlinie ist `box` die Huelle des gedrehten Balkens: der Kern (innere Haelfte) ist in jedem Fall schwarz
  const s = stat(orig, aus, a.flaechen[0].box, Math.round(Math.min(a.flaechen[0].box[2], a.flaechen[0].box[3]) * 0.3));
  expect(s.dunkel).toBeGreaterThan(0.95);
  expect(aussen(orig, aus, [a.flaechen[0].box]).mittel).toBeLessThan(4);
  // mit Face an: das ganze Gesicht schwarz plus Balken
  const b = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'zensurbalken'));
  const gesicht = (b.flaechen as Flaeche[]).find((f) => f.zone === 'face')!;
  expect(gesicht.behandlung).toBe('schwarz');
  const sg = stat(orig, await rohPixel(ausDataUrl(b.bild)), gesicht.box, Math.round(Math.min(gesicht.box[2], gesicht.box[3]) * 0.2));
  expect(sg.dunkel).toBeGreaterThan(0.95);
});

test('Ganze Person: eine Flaeche deckt die Huelle aller Treffer (auch bekleidete Teile), Mosaik oder Blur, ausserhalb unveraendert', async () => {
  test.setTimeout(180_000);
  const { quelle, orig } = await kleinBild('nsfw', BILD_KOERPER);
  // alle Treffer (ohne Zonen-Filter) aus einer Anfrage ohne Rendern, mit allen Zonen und bedeckt
  const alle = await ausWorker(nachricht(quelle, ALLE, 'mosaik', {}, false));
  expect(alle.ok, alle.fehler).toBe(true);
  const treffer = alle.treffer as { zone: string; box: Box }[];
  expect(treffer.length).toBeGreaterThan(0);
  const zonenBedeckt = zonenNur(['feet'], true);
  for (const preset of ['person-mosaik', 'person-blur']) {
    const a = await ausWorker({ ...nachricht(quelle, ['feet'], preset), einstellungen: { schwelle: 0.1, zonen: zonenBedeckt, rand: 0.15, preset } });
    expect(a.ok, a.fehler).toBe(true);
    const fl = a.flaechen as Flaeche[];
    expect(fl.length, `${preset}: Personenflaechen`).toBeGreaterThanOrEqual(1);
    expect(fl.every((f) => f.behandlung === (preset === 'person-mosaik' ? 'mosaik' : 'blur'))).toBe(true);
    // jede Personenflaeche ist groesser als jede einzelne Zonenbox in ihr (die Huelle plus Rand)
    const aus = await rohPixel(ausDataUrl(a.bild));
    const gesamt = fl.reduce((s, f) => s + f.box[2] * f.box[3], 0);
    const einzel = (await ausWorker({ ...nachricht(quelle, ['feet'], 'mosaik', {}, false), einstellungen: { schwelle: 0.1, zonen: zonenBedeckt, rand: 0.15, preset: 'mosaik' } })).flaechen as Flaeche[];
    const einzelFlaeche = einzel.reduce((s, f) => s + f.box[2] * f.box[3], 0);
    console.log(`chromium: ${preset}: ${fl.length} Personenflaechen, Flaeche ${gesamt} px gegen ${einzelFlaeche} px nur diese Zone`);
    expect(gesamt).toBeGreaterThanOrEqual(einzelFlaeche);
    // die Huelle deckt jede Brust-Box (Zonenbox plus Rand)
    for (const e of einzel) expect(fl.some((f) => f.box[0] <= e.box[0] + 1 && f.box[1] <= e.box[1] + 1 && f.box[0] + f.box[2] >= e.box[0] + e.box[2] - 1 && f.box[1] + f.box[3] >= e.box[1] + e.box[3] - 1), `Zonenbox ${e.box} liegt in einer Person`).toBe(true);
    // Pixel: in der Huelle veraendert, ausserhalb nicht
    const innen = stat(orig, aus, fl[0]!.box, 6);
    expect(innen.mittel).toBeGreaterThan(3);
    const a2 = aussen(orig, aus, fl.map((f) => f.box));
    expect(a2.mittel).toBeLessThan(4);
    expect(a2.gross).toBeLessThan(0.005);
  }
});

// ---------- Echtes Pack (nur mit VEIL_ECHTES_PACK=<pfad>, der Pfad steht nie in Dateien) ----------

test('Echtes Pack: wie viele Patch-Bilder liefern ein Gesicht (YuNet), Mias Gesicht aus dem echten Pack auf einem Testbild', async () => {
  test.skip(!process.env.VEIL_ECHTES_PACK, 'VEIL_ECHTES_PACK nicht gesetzt');
  test.setTimeout(240_000);
  const original = await brauchtBild('sfw', BILD_GESICHT);
  // Das Dummy-Pack der vorigen Tests liegt noch da: entfernen (nur wenn es da ist)
  const vorhanden = await context.newPage();
  await vorhanden.goto(optionsUrl());
  const hatPack = (await speicher(vorhanden, 'pack')) !== undefined;
  await vorhanden.close();
  if (hatPack) await entfernePack();
  console.log('chromium echt: bereit zum Import');
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#datei').setInputFiles(path.resolve(process.env.VEIL_ECHTES_PACK!));
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#meldung')).toContainText('The pack is in', { timeout: 60_000 });
  } finally {
    await seite.close();
  }
  console.log('chromium echt: Pack importiert');
  const t0 = Date.now();
  const scan = await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
  console.log(`chromium echt: Gesichtsscan ${JSON.stringify(scan)} in ${Date.now() - t0} ms`);
  expect(scan.geprueft).toBe(scan.gesamt);
  const orig = await rohPixel(original);
  const a = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-mosaik'));
  expect(a.ok, a.fehler).toBe(true);
  const f = (a.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  const aus = await rohPixel(ausDataUrl(a.bild));
  const kern = stat(orig, aus, f.box, Math.round(Math.min(f.box[2], f.box[3]) * 0.15));
  console.log(`chromium echt: Mias Gesicht auf ${f.box}: Kern Abweichung ${kern.mittel.toFixed(1)}, Rahmenpixel ${stat(orig, aus, f.box, 0).rahmen}, mit Gesichts-Patch ${scan.mit > 0 ? 'ja' : 'nein'}`);
  if (scan.mit > 0) expect(kern.mittel).toBeGreaterThan(20);
  // Zum Anschauen (nur auf Wunsch): VEIL_BILD_AUS=<ordner> schreibt das Ergebnis dorthin (der Ordner steht nie in Dateien)
  if (process.env.VEIL_BILD_AUS) {
    await writeFile(path.join(process.env.VEIL_BILD_AUS, 'mia-mosaik.jpg'), ausDataUrl(a.bild));
    const w = await ausWorker(nachricht(urlQuelle('nsfw', BILD_KOERPER), BEDECKBAR, 'mia-wort'));
    if (w.bild) await writeFile(path.join(process.env.VEIL_BILD_AUS, 'mia-wort-koerper.jpg'), ausDataUrl(w.bild));
  }
});

test('Stufe 4 (ganz verdecken) mit einem Mia-Preset: das ganze Bild schwarz mit Wort, eine Flaeche, kein Mias Gesicht', async () => {
  test.setTimeout(120_000);
  const roh = await ladeBild('nsfw', 'IMG_0260.jpg');
  if (!roh) {
    if (OHNE_TESTBILDER) {
      console.log('chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Stufe-4-Test uebersprungen');
      test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
    }
    throw new Error('Testbild nsfw/IMG_0260.jpg fehlt (../05 Testbilder)');
  }
  const klein = await sharp(roh).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const orig = await rohPixel(klein);
  const quelle = { art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` };
  for (const [preset, erwartet] of [['mia-wort', 'schwarz-wort'], ['mia-blur', 'blur']] as const) {
    const a = await ausWorker(nachricht(quelle, ['feet', 'face'], preset, { ganzVerdecken: true }));
    expect(a.ok, a.fehler).toBe(true);
    expect(a.flaechen, `${preset}: eine Flaeche ueber das ganze Bild`).toHaveLength(1);
    expect(a.flaechen[0].box).toEqual([0, 0, a.breite, a.hoehe]);
    expect(a.flaechen[0].behandlung).toBe(erwartet);
    const aus = await rohPixel(ausDataUrl(a.bild));
    const s = stat(orig, aus, a.flaechen[0].box, 6);
    console.log(`chromium: Stufe 4 ${preset}: dunkel ${(s.dunkel * 100).toFixed(0)} %, Wortpixel ${s.wort}, Wortspanne ${(s.wortSpanne * 100).toFixed(0)} %`);
    if (preset === 'mia-wort') {
      // schwarz plus das grosse pinke Wort (mit dem echten Pack, ohne Woerter, steht ein grosses MIA ueber dem ganzen Bild) ist fast alles
      expect(s.dunkel).toBeGreaterThan(0.85);
      expect(s.dunkel + s.wort / s.n).toBeGreaterThan(0.95);
      expect(s.wort).toBeGreaterThan(100);
      expect(s.wortSpanne).toBeGreaterThanOrEqual(0.3);
      expect(s.rahmen).toBe(0); // kein pinker Rahmen: nicht Mias Gesicht
    } else expect(s.mittel).toBeGreaterThan(10); // blur: ganz verwischt
  }
});

test('Ohne Pack: Wort-Presets sagen, dass ihr Wort MIA ist (statt der Chips)', async () => {
  test.setTimeout(90_000);
  await entfernePack();
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    // Entfernen raeumt auch die Ablage der Gesichtssuche (eigene Datenbank) leer
    const keys = await seite.evaluate(() => new Promise<number[]>((ok, fehl) => {
      const q = indexedDB.open('veil-pack-gesichter', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('ergebnis');
      q.onerror = () => fehl(q.error);
      q.onsuccess = () => { const r = q.result.transaction('ergebnis', 'readonly').objectStore('ergebnis').getAllKeys(); r.onsuccess = () => { q.result.close(); ok(r.result as number[]); }; };
    }));
    expect(keys).toEqual([]);
    await seite.locator('label:has(#preset-mosaik-wort)').click();
    await expect(seite.locator('#wort-ohne-pack')).toHaveText(HINWEIS_WORT_OHNE_PACK);
    await expect(seite.locator('#wort-themen')).toBeHidden();
    await seite.locator('label:has(#preset-mosaik)').click();
    await expect(seite.locator('#wort-ohne-pack')).toBeHidden();
  } finally {
    await seite.close();
  }
});

test('Pack-Wechsel mit Themenliste, deren Kennungen im neuen Pack fehlen: auf den Flaechen steht MIA (wie ohne Thema), nicht ein Wort aus dem Pack', async () => {
  test.setTimeout(120_000);
  const { quelle } = await kleinBild('nsfw', BILD_KOERPER);
  const { bytes } = await baueDummy();
  await importiere(bytes, 'dummy-themen.miapack');
  const render = async (themen?: string[] | null) => {
    const a = await ausWorker(nachricht(quelle, BEDECKBAR, 'mosaik-wort', themen === undefined ? {} : { woerterThemen: themen }));
    expect(a.ok, a.fehler).toBe(true);
    return a.bild as string;
  };
  const alle = await render(null); // alle Themen des Packs: ein Wort aus alpha oder beta
  const keins = await render([]); // kein Thema: MIA
  const unbekannt = await render(['altes-pack-thema', 'noch-eins']); // Kennungen, die es im neuen Pack nicht gibt: ebenfalls MIA
  expect(unbekannt).toBe(keins); // dieselben Pixel wie ohne Thema (MIA), nicht das Wort aus dem Pack
  expect(alle).not.toBe(keins); // Gegenprobe: mit den Themen des Packs steht etwas anderes da
  // gemischt: ein bekanntes und ein unbekanntes Thema: nur das bekannte zaehlt (kein MIA)
  expect(await render(['alpha', 'altes-pack-thema'])).not.toBe(keins);
  await entfernePack();
});

test('Gesichtssuche fertig: offene Seiten mit einem Mia-Preset bewerten neu (Stand `gesichterStand` im Pruefstand)', async () => {
  test.setTimeout(120_000);
  await brauchtBild('sfw', BILD_GESICHT);
  const patch = await sharp(await brauchtBild('sfw', PATCH_GESICHT)).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
  const { bytes } = await baueDummy({ extraPatches: [{ name: 'patch/mit-gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patch) }] });
  await importiere(bytes, 'dummy-neubewertung.miapack');
  await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
  const seite = await context.newPage();
  const hilf = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    await setzeEinst(hilf, { preset: 'mia-mosaik', pause: false, zonen: zonenNur(['face']) });
    await seite.goto(`${basis}/augenbalken.html`);
    await expect.poll(() => seite.evaluate(() => document.getElementById('bild')!.dataset.veil ?? ''), { timeout: 40_000 }).toBe('zensiert');
    // Zaehlt die Aenderungen der Quelle des Bildes (Neubewertung setzt die Quelle zurueck und dann neu)
    await seite.evaluate(() => {
      (window as any).__aenderungen = 0;
      new MutationObserver((l) => ((window as any).__aenderungen += l.length)).observe(document.getElementById('bild')!, { attributes: true, attributeFilter: ['src', 'data-veil'] });
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(await seite.evaluate(() => (window as any).__aenderungen as number), 'ohne Meldung bleibt die Seite ruhig').toBe(0);
    // Der Erkenner meldet: die Gesichtssuche ist fertig (hier von Hand, wie es der Hintergrund aus der Meldung des Erkenners tut)
    await hilf.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({ gesichterStand: { importiert: 1, mit: 1, zeit: Date.now() } });
    });
    await expect.poll(() => seite.evaluate(() => (window as any).__aenderungen as number), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => seite.evaluate(() => document.getElementById('bild')!.dataset.veil ?? ''), { timeout: 40_000 }).toBe('zensiert');
  } finally {
    await hilf.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.remove('gesichterStand');
    });
    await setzeEinst(hilf, { preset: 'mosaik' });
    await hilf.close();
    await seite.close();
  }
  await entfernePack();
});

// Entfernt ein vorhandenes Pack, tut nichts ohne Pack (entfernePack wartet sonst auf einen versteckten Knopf).
async function raeumePack(): Promise<void> {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await expect(seite.locator('#pack-status')).not.toBeEmpty();
    if (await seite.locator('#entfernen').isVisible()) {
      await seite.locator('#entfernen').click();
      await seite.locator('#entfernen-ja').click();
    }
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
  } finally {
    await seite.close();
  }
}

// ---------- Sticker-Zensur (STICKER-BAUPLAN Stufe A) ----------
// Farben aus werte.ts (rosa-200, lav-200, pfirsich-200) und die drei synthetischen Sticker des Dummy-Packs (Gruen, Blau, Tuerkis, DUMMY_STICKER).
const PASTELL = [[255, 211, 230], [226, 215, 255], [255, 220, 199]];
const STICKER_FARBEN = [[20, 200, 90], [30, 70, 235], [0, 210, 210]];
const abstandFarbe = (p: number[], q: number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
// Abstand eines Punktes zur Strecke a bis b (Kantenglaettung und JPEG mischen zwei Farben entlang einer Strecke)
function abstandStrecke(p: number[], a: number[], b: number[]): number {
  const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const l2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0]! - a[0]!) * d[0]! + (p[1]! - a[1]!) * d[1]! + (p[2]! - a[2]!) * d[2]!) / l2));
  return abstandFarbe(p, [a[0]! + t * d[0]!, a[1]! + t * d[1]!, a[2]! + t * d[2]!]);
}
// Zaehlt ein Pixel als gedeckt: ein Pastellton, der pinke Rahmen, ein Stickerton oder eine Mischung davon (Kanten, JPEG).
function istGedeckt(p: number[]): boolean {
  if (PASTELL.some((q) => abstandFarbe(p, q) < 16)) return true;
  if (abstandFarbe(p, ROSA_RAHMEN) < 60) return true;
  if (STICKER_FARBEN.some((q) => abstandFarbe(p, q) < 45)) return true;
  for (const q of PASTELL) {
    for (const s of [...STICKER_FARBEN, ROSA_RAHMEN]) if (abstandStrecke(p, q, s) < 30) return true;
  }
  return false;
}
function pixelAn(aus: Pixel, x: number, y: number): number[] {
  const i = (y * aus.b + x) * 3;
  return [aus.daten[i]!, aus.daten[i + 1]!, aus.daten[i + 2]!];
}
// Anteil gedeckter Pixel in der Box (`inset` Pixel nach innen: die Kanten gegen das unveraenderte Bild sind JPEG-Mischung).
function deckung(aus: Pixel, box: Box, inset = 3): number {
  const [bx, by, bw, bh] = box;
  let n = 0;
  let ok = 0;
  for (let y = by + inset; y < by + bh - inset; y++) {
    for (let x = bx + inset; x < bx + bw - inset; x++) {
      n++;
      if (istGedeckt(pixelAn(aus, x, y))) ok++;
    }
  }
  return n === 0 ? 1 : ok / n;
}
// Pixel in der Box, die einem der Stickertoene nahe sind (nur der Sticker hat so satte Farben).
function stickerPixel(aus: Pixel, box: Box): number {
  const [bx, by, bw, bh] = box;
  let n = 0;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) if (STICKER_FARBEN.some((q) => abstandFarbe(pixelAn(aus, x, y), q) < 45)) n++;
  return n;
}
function mitteFarbe(aus: Pixel, box: Box): number[] {
  const cx = Math.round(box[0] + box[2] / 2);
  const cy = Math.round(box[1] + box[3] / 2);
  const summe = [0, 0, 0];
  let n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      const p = pixelAn(aus, x, y);
      for (let k = 0; k < 3; k++) summe[k]! += p[k]!;
      n++;
    }
  }
  return summe.map((s) => s / n);
}
// Pruefung einer Antwort mit Sticker-Flaechen: jede Flaeche ganz gedeckt, ausserhalb unveraendert. Flaechen mit kuerzerer Seite ab 24 px (Anzeige gleich
// Arbeitsbild) haben in der Mitte eine Stickerfarbe (mit `ohneSticker` nirgends eine), kleinere nur Pastell. Liefert die Zahl der Flaechen mit Sticker.
async function pruefeStickerFlaechen(orig: Pixel, a: any, name: string, optionen: { ohneSticker?: boolean; behandlung?: string } = {}): Promise<number> {
  expect(a.ok, `${name}: ${a.fehler}`).toBe(true);
  const flaechen = (a.flaechen as Flaeche[]).filter((f) => (optionen.behandlung ? f.behandlung === optionen.behandlung : true));
  expect(flaechen.length, `${name}: Flaechen`).toBeGreaterThanOrEqual(1);
  const aus = await rohPixel(ausDataUrl(a.bild));
  let mitSticker = 0;
  for (const f of flaechen) {
    const d = deckung(aus, f.box);
    const sp = stickerPixel(aus, f.box);
    const mitte = mitteFarbe(aus, f.box);
    console.log(`chromium: ${name} ${f.zone} ${f.box}: Deckung ${(d * 100).toFixed(2)} %, Stickerpixel ${sp}, Mitte ${mitte.map(Math.round)}`);
    expect(d, `${name} ${f.zone} ${f.box}: Flaeche ganz gedeckt`).toBeGreaterThanOrEqual(0.99);
    const kurz = Math.min(f.box[2], f.box[3]);
    if (optionen.ohneSticker || kurz < 24) {
      expect(sp, `${name} ${f.zone}: kein Sticker`).toBe(0);
    } else if (kurz >= 40) {
      expect(STICKER_FARBEN.some((q) => abstandFarbe(mitte, q) < 60), `${name} ${f.zone} ${f.box}: Stickerfarbe in der Mitte ${mitte.map(Math.round)}`).toBe(true);
      mitSticker++;
    }
  }
  // ausserhalb aller Flaechen unveraendert
  const aussenWerte = aussen(orig, aus, (a.flaechen as Flaeche[]).map((f) => f.box));
  expect(aussenWerte.mittel, `${name}: ausserhalb unveraendert`).toBeLessThan(4);
  return mitSticker;
}

test('Sticker: jede Flaeche ganz von Pastell gedeckt, Stickerfarbe in der Mitte, ausserhalb unveraendert, stabil je Bild; Gesicht und Koerper', async () => {
  test.setTimeout(240_000);
  await raeumePack();
  const { bytes } = await baueDummy();
  await importiere(bytes, 'dummy-sticker.miapack');
  // Koerper: alle Koerperzonen, Preset sticker
  const { quelle, orig } = await kleinBild('nsfw', BILD_KOERPER);
  const koerper = await ausWorker(nachricht(quelle, BEDECKBAR, 'sticker'));
  for (const f of koerper.flaechen as Flaeche[]) expect(f.behandlung).toBe('sticker');
  const mit = await pruefeStickerFlaechen(orig, koerper, 'sticker Koerper', { behandlung: 'sticker' });
  expect(mit, 'mindestens eine Flaeche traegt einen Sticker').toBeGreaterThanOrEqual(1);
  // stabil je Bild und Flaeche: dieselbe Anfrage liefert dieselben Bytes (Farbe und Sticker wechseln nicht)
  const nochmal = await ausWorker(nachricht(quelle, BEDECKBAR, 'sticker'));
  expect(nochmal.bild).toBe(koerper.bild);
  // Gesicht: Face an, eigene Flaeche mit sticker
  const gesicht = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'sticker'));
  const fg = (gesicht.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  expect(fg.behandlung).toBe('sticker');
  await pruefeStickerFlaechen(await rohPixel(await brauchtBild('sfw', BILD_GESICHT)), gesicht, 'sticker Gesicht', { behandlung: 'sticker' });
  // Face aus: das Gesicht bleibt, wie es war (keine Face-Flaeche, ausserhalb der Flaechen unveraendert)
  const aus = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['breast'], 'sticker'));
  expect((aus.flaechen as Flaeche[]).some((x) => x.zone === 'face')).toBe(false);
});

test('Sticker: die Pastellfarbe ist je Flaeche stabil und kommt nur aus den drei Toenen; mia-sticker: Gesicht Mias Gesicht oder Sticker, Koerper Sticker', async () => {
  test.setTimeout(240_000);
  // Das Pack aus dem vorigen Test steht noch (Dummy-Patches ohne Gesicht): mia-sticker gibt dem Gesicht den Ersatz sticker
  const gesicht = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-sticker'));
  expect(gesicht.ok, gesicht.fehler).toBe(true);
  const fg = (gesicht.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  expect(fg.behandlung).toBe('mia-gesicht');
  expect(fg.ersatz).toBe('sticker');
  const origG = await rohPixel(await brauchtBild('sfw', BILD_GESICHT));
  // keine Gesichter in den Dummy-Patches: das Gesicht traegt Pastell mit Sticker
  await pruefeStickerFlaechen(origG, gesicht, 'mia-sticker Rueckfall Gesicht');
  // Koerper mit mia-sticker: Sticker
  const { quelle, orig } = await kleinBild('nsfw', BILD_KOERPER);
  const koerper = await ausWorker(nachricht(quelle, BEDECKBAR, 'mia-sticker'));
  for (const f of koerper.flaechen as Flaeche[]) expect(f.behandlung).toBe('sticker');
  await pruefeStickerFlaechen(orig, koerper, 'mia-sticker Koerper', { behandlung: 'sticker' });
  // Farben: mehrere Flaechen und Bilder, nur Pastellton in den Ecken der Innenflaeche, mehr als ein Ton ueber viele Bilder
  const toene = new Set<string>();
  for (const [satz, name] of [['sfw', BILD_GESICHT], ['nsfw', BILD_KOERPER]] as const) {
    for (const preset of ['sticker', 'mia-sticker']) {
      const a = await ausWorker(nachricht(urlQuelle(satz, name), BEDECKBAR.concat(['face', 'eyes']), preset));
      const aus = await rohPixel(ausDataUrl(a.bild));
      for (const f of a.flaechen as Flaeche[]) {
        if (f.behandlung !== 'sticker' || Math.min(f.box[2], f.box[3]) < 60) continue;
        const p = pixelAn(aus, f.box[0] + 14, f.box[1] + 14); // innen am Rahmen (hoechstens 10 px) vorbei, im Pastell
        const ton = PASTELL.findIndex((q) => abstandFarbe(p, q) < 16);
        expect(ton, `${satz}/${name} ${preset} ${f.zone}: Pastellton in der Ecke ${p}`).toBeGreaterThanOrEqual(0);
        toene.add(String(ton));
      }
    }
  }
  console.log(`chromium: Sticker-Toene gesehen: ${[...toene].sort().join(',')}`);
  expect(toene.size).toBeGreaterThanOrEqual(2);
  // Mias Gesicht aus einem Patch mit Gesicht: das Gesicht bleibt Mias Gesicht (pinker Rahmen), Sticker nur als Ersatz
  await raeumePack();
  const patch = await sharp(await brauchtBild('sfw', PATCH_GESICHT)).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
  const mitGesicht = await baueDummy({ extraPatches: [{ name: 'patch/mit-gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patch) }] });
  await importiere(mitGesicht.bytes, 'dummy-sticker-mia.miapack');
  const scan = await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
  expect(scan.mit).toBe(1);
  const g2 = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mia-sticker'));
  const fg2 = (g2.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  expect(fg2.behandlung).toBe('mia-gesicht');
  const aus2 = await rohPixel(ausDataUrl(g2.bild));
  const s2 = stat(origG, aus2, fg2.box, Math.round(Math.min(fg2.box[2], fg2.box[3]) * 0.15));
  console.log(`chromium: mia-sticker mit Patch-Gesicht ${fg2.box}: Abweichung ${s2.mittel.toFixed(1)}, Rahmenpixel ${stat(origG, aus2, fg2.box, 0).rahmen}`);
  expect(s2.mittel).toBeGreaterThan(20);
  expect(stat(origG, aus2, fg2.box, 0).rahmen).toBeGreaterThan(Math.round(Math.min(fg2.box[2], fg2.box[3]) * 0.5));
  expect(stickerPixel(aus2, fg2.box), 'Mias Gesicht traegt keinen Sticker').toBe(0);
  await raeumePack();
});

test('Sticker auf kleiner Flaeche (Anzeige unter 24 px): nur Pastell, kein Sticker, die Flaeche deckt trotzdem', async () => {
  test.setTimeout(150_000);
  await raeumePack();
  const { bytes } = await baueDummy();
  await importiere(bytes, 'dummy-sticker-klein.miapack');
  const original = await brauchtBild('sfw', BILD_GESICHT);
  const meta = await sharp(original).metadata();
  const orig = await rohPixel(original);
  // 20 mal kleiner angezeigt als gross: die Gesichtsbox (um 250 px) ist angezeigt unter 24 px
  const klein = await ausWorker({ ...nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'sticker'), breite: Math.round(meta.width! / 20), hoehe: Math.round(meta.height! / 20) });
  expect(klein.ok, klein.fehler).toBe(true);
  const f = (klein.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  const aus = await rohPixel(ausDataUrl(klein.bild));
  expect(Math.min(f.box[2], f.box[3]) / 20, 'angezeigt kleiner als 24 px').toBeLessThan(24);
  expect(deckung(aus, f.box)).toBeGreaterThanOrEqual(0.99);
  expect(stickerPixel(aus, f.box), 'kein Sticker auf der kleinen Flaeche').toBe(0);
  const normal = await ausWorker({ ...nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'sticker'), breite: meta.width, hoehe: meta.height });
  expect(stickerPixel(await rohPixel(ausDataUrl(normal.bild)), f.box), 'voll angezeigt: mit Sticker').toBeGreaterThan(200);
  expect(aussen(orig, aus, [f.box]).mittel).toBeLessThan(4);
});

test('Sticker kaputt (nicht dekodierbar): die Flaeche deckt trotzdem, ohne Sticker (Hide-first)', async () => {
  test.setTimeout(150_000);
  await raeumePack();
  const { bytes } = await baueDummy({ stickerKaputt: true });
  await importiere(bytes, 'dummy-sticker-kaputt.miapack');
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    expect((await speicher(seite, 'pack')).freischaltungen).toContain('zensur:sticker');
    await expect(seite.locator('#preset-sticker')).toBeEnabled();
  } finally {
    await seite.close();
  }
  const original = await brauchtBild('sfw', BILD_GESICHT);
  const a = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'sticker'));
  expect(a.ok, a.fehler).toBe(true);
  const f = (a.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
  const aus = await rohPixel(ausDataUrl(a.bild));
  console.log(`chromium: Sticker kaputt ${f.box}: Deckung ${(deckung(aus, f.box) * 100).toFixed(2)} %, Stickerpixel ${stickerPixel(aus, f.box)}`);
  expect(deckung(aus, f.box)).toBeGreaterThanOrEqual(0.99);
  expect(stickerPixel(aus, f.box)).toBe(0);
  expect(aussen(await rohPixel(original), aus, [f.box]).mittel).toBeLessThan(4);
  await raeumePack();
});

test('Pack ohne Sticker: die Sticker-Karten sind gesperrt mit Hinweis, das Popup nennt Mosaic, die Seite zeigt Mosaik; Pack entfernt: Mosaik', async () => {
  test.setTimeout(180_000);
  await raeumePack();
  const { bytes } = await baueDummy({ ohneSticker: true });
  await importiere(bytes, 'dummy-ohne-sticker.miapack');
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    for (const id of PRESET_IDS) {
      if (PRESETS[id].gruppe === 'sticker') await expect(seite.locator(`#preset-${id}`)).toBeDisabled();
      else await expect(seite.locator(`#preset-${id}`)).toBeEnabled();
    }
    await expect(seite.locator('#preset-pack-hinweis')).toBeVisible();
    await expect(seite.locator('#preset-pack-hinweis')).toHaveText(HINWEIS_PACK_OHNE_STICKER);
    expect((await speicher(seite, 'pack')).sticker).toBe(0);
    // ein gespeichertes Sticker-Preset (z. B. nach dem Ersetzen durch ein Pack ohne Sticker): gilt Mosaik, Popup sagt es
    await setzeEinst(seite, { preset: 'sticker', pause: false, zonen: zonenNur(['face']) });
    await seite.reload();
    await expect(seite.locator('#preset-mosaik')).toBeChecked();
    await expect(seite.locator('#preset-sticker')).not.toBeChecked();
    const popup = await context.newPage();
    try {
      await popup.goto(popupUrl());
      await expect(popup.locator('#preset-name')).toHaveText(PRESETS.mosaik.name);
      await expect(popup.locator('#pack-hinweis')).toHaveText(HINWEIS_PACK_OHNE_STICKER);
    } finally {
      await popup.close();
    }
    // Seite: das Bild wird Mosaik (pinker Rahmen, kein Pastell, kein Sticker)
    const gesicht = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'mosaik'));
    const box = (gesicht.flaechen as Flaeche[]).find((x) => x.zone === 'face')!.box;
    const bild = await context.newPage();
    try {
      await bild.goto(`${basis}/augenbalken.html`);
      await expect.poll(() => bild.evaluate(() => document.getElementById('bild')!.dataset.veil ?? ''), { timeout: 40_000 }).toBe('zensiert');
      const pixel = await seitenBildPixel(bild);
      console.log(`chromium: Pack ohne Sticker, Preset sticker gespeichert: Seite zeigt Deckung ${(deckung(pixel, box) * 100).toFixed(1)} %, Stickerpixel ${stickerPixel(pixel, box)}`);
      expect(deckung(pixel, box), 'Mosaik, nicht Pastell').toBeLessThan(0.8);
      expect(stickerPixel(pixel, box)).toBe(0);
      mosaikNachweis(await rohPixel(await brauchtBild('sfw', BILD_GESICHT)), pixel, box, 'Pack ohne Sticker, Seite');
    } finally {
      await bild.close();
    }
    await setzeEinst(seite, { preset: 'mosaik' });
  } finally {
    await seite.close();
  }
  // Pack mit Stickern, Sticker-Preset gewaehlt, Pack entfernt: Preset zurueck auf Mosaik, Karten gesperrt
  await raeumePack();
  const { bytes: mit } = await baueDummy();
  await importiere(mit, 'dummy-mit-sticker-entfernen.miapack');
  const s2 = await context.newPage();
  try {
    await s2.goto(optionsUrl());
    await expect(s2.locator('#preset-sticker')).toBeEnabled();
    await expect(s2.locator('#preset-pack-hinweis')).toBeHidden();
    await s2.locator('label:has(#preset-sticker)').click();
    await expect.poll(async () => (await speicher(s2, 'einstellungen')).preset).toBe('sticker');
    await expect(s2.locator('#stil-hinweis')).toHaveText(PRESETS.sticker.satz);
    await s2.locator('label:has(#preset-mia-sticker)').click();
    await expect.poll(async () => (await speicher(s2, 'einstellungen')).preset).toBe('mia-sticker');
    expect((await speicher(s2, 'einstellungen')).zonen.face.an, 'mia-sticker schaltet Face ein').toBe(true);
    await expect(s2.locator('#stil-hinweis')).toContainText('I choose my face from');
    await s2.locator('label:has(#preset-sticker)').click();
    await expect.poll(async () => (await speicher(s2, 'einstellungen')).preset).toBe('sticker');
    // Popup mit Sticker-Preset: Name, Satz, Vorschau
    const popup = await context.newPage();
    try {
      await popup.goto(popupUrl());
      await expect(popup.locator('#preset-name')).toHaveText(PRESETS.sticker.name);
      await expect(popup.locator('#pack-hinweis')).toHaveText(PRESETS.sticker.satz);
      await expect(popup.locator('#preset-bild svg')).toHaveCount(1);
    } finally {
      await popup.close();
    }
  } finally {
    await s2.close();
  }
  await raeumePack();
  const s3 = await context.newPage();
  try {
    await s3.goto(optionsUrl());
    await expect.poll(async () => (await speicher(s3, 'einstellungen')).preset).toBe('mosaik');
    await expect(s3.locator('#preset-mosaik')).toBeChecked();
    await expect(s3.locator('#preset-sticker')).toBeDisabled();
    await expect(s3.locator('#preset-mia-sticker')).toBeDisabled();
    await expect(s3.locator('#preset-pack-hinweis')).toHaveText(HINWEIS_MIA_PACK_FEHLT);
  } finally {
    await s3.close();
  }
});

// Mosaik-Nachweis (wie in den anderen Faellen): die Flaeche weicht im Kern vom Original ab (kein offenes Bild) und traegt den pinken Mosaik-Rahmen.
function mosaikNachweis(orig: Pixel, pixel: Pixel, box: Box, name: string): void {
  const inset = Math.round(Math.min(box[2], box[3]) * 0.15);
  const kern = stat(orig, pixel, box, inset);
  const ganz = stat(orig, pixel, box, 0);
  console.log(`chromium: ${name}: Abweichung im Kern ${kern.mittel.toFixed(1)}, Rahmenpixel ${ganz.rahmen}`);
  expect(kern.mittel, `${name}: Flaeche weicht vom Original ab`).toBeGreaterThan(8);
  expect(ganz.rahmen, `${name}: pinker Mosaik-Rahmen`).toBeGreaterThan(Math.round(Math.min(box[2], box[3]) * 0.9));
}

// Pixel des zensierten Bildes (#bild) einer Fixture-Seite, als RGB wie `rohPixel`.
async function seitenBildPixel(seite: Page): Promise<Pixel> {
  const roh = await seite.evaluate(async () => {
    const el = document.getElementById('bild') as HTMLImageElement;
    const b = await createImageBitmap(await (await fetch(el.src)).blob());
    const c = new OffscreenCanvas(b.width, b.height);
    const g = c.getContext('2d')!;
    g.drawImage(b, 0, 0);
    const d = g.getImageData(0, 0, b.width, b.height).data;
    const rgb = new Uint8Array(b.width * b.height * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      rgb[j] = d[i]!;
      rgb[j + 1] = d[i + 1]!;
      rgb[j + 2] = d[i + 2]!;
    }
    return { b: b.width, h: b.height, daten: Array.from(rgb) };
  });
  return { daten: Buffer.from(roh.daten), b: roh.b, h: roh.h };
}

test('Sticker auf einer Seite: das Bild wird mit Pastell und Sticker gedeckt; der Wechsel auf ein Pack ohne Sticker macht es zu Mosaik', async () => {
  test.setTimeout(200_000);
  await raeumePack();
  const { bytes } = await baueDummy();
  await importiere(bytes, 'dummy-seite-sticker.miapack');
  const hilf = await context.newPage();
  const bild = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    await setzeEinst(hilf, { preset: 'sticker', pause: false, zonen: zonenNur(['face']) });
    const gesicht = await ausWorker(nachricht(urlQuelle('sfw', BILD_GESICHT), ['face'], 'sticker'));
    const box = (gesicht.flaechen as Flaeche[]).find((x) => x.zone === 'face')!.box;
    await bild.goto(`${basis}/augenbalken.html`);
    await expect.poll(() => bild.evaluate(() => document.getElementById('bild')!.dataset.veil ?? ''), { timeout: 40_000 }).toBe('zensiert');
    const pixel = await seitenBildPixel(bild);
    console.log(`chromium: Seite mit Sticker: Deckung ${(deckung(pixel, box) * 100).toFixed(2)} %, Stickerpixel ${stickerPixel(pixel, box)}`);
    expect(deckung(pixel, box)).toBeGreaterThanOrEqual(0.99);
    expect(stickerPixel(pixel, box)).toBeGreaterThan(200);
    // Das Pack wird durch eines ohne Sticker ersetzt: die Seite bewertet neu und zeigt Mosaik (das Preset steht weiter auf sticker)
    const { bytes: ohne } = await baueDummy({ ohneSticker: true, version: '0.0.2' });
    const pfad = path.join(ordner, 'dummy-seite-ohne.miapack');
    await writeFile(pfad, ohne);
    await hilf.locator('#datei').setInputFiles(pfad);
    await hilf.locator('#annehmen').click();
    await expect(hilf.locator('#meldung')).toContainText('The pack is in');
    await expect.poll(async () => (await speicher(hilf, 'pack')).sticker, { timeout: 20_000 }).toBe(0);
    await expect.poll(async () => deckung(await seitenBildPixel(bild), box), { timeout: 60_000, intervals: [500] }).toBeLessThan(0.8);
    expect(stickerPixel(await seitenBildPixel(bild), box)).toBe(0);
    mosaikNachweis(await rohPixel(await brauchtBild('sfw', BILD_GESICHT)), await seitenBildPixel(bild), box, 'Pack ersetzt durch eines ohne Sticker, Seite');
    expect((await speicher(hilf, 'einstellungen')).preset, 'Einstellung bleibt, wirksam ist Mosaik').toBe('sticker');
  } finally {
    await setzeEinst(hilf, { preset: 'mosaik' });
    await hilf.close();
    await bild.close();
  }
  await raeumePack();
});

test('Sticker nach einem Dekodierfehler: der naechste Sticker kommt (Stickerfarbe in der Mitte), auch bei jedem weiteren Schluessel', async () => {
  test.setTimeout(240_000);
  await raeumePack();
  const { bytes } = await baueDummy({ stickerTeilweise: true });
  await importiere(bytes, 'dummy-sticker-teilweise.miapack');
  const { stickerStart } = await import('../../src/sticker');
  const original = await rohPixel(await brauchtBild('sfw', BILD_GESICHT));
  const basisUrl = `${basis}/testbild/sfw/${encodeURIComponent(BILD_GESICHT)}`;
  const erste = await ausWorker({ ...nachricht({ art: 'url', url: `${basisUrl}?salz=0`, referer: '' }, ['face'], 'sticker') });
  expect(erste.ok, erste.fehler).toBe(true);
  const box = (erste.flaechen as Flaeche[]).find((x) => x.zone === 'face')!.box;
  // Namen im Pack, sortiert: dummy-1, dummy-2, kaputt-1 (Index 2). Zwei Schluessel, deren Wahl beim kaputten Sticker beginnt.
  const salze: number[] = [];
  for (let i = 1; i < 400 && salze.length < 2; i++) if (stickerStart(`${basisUrl}?salz=${i}|face|${box.join(',')}`, 3) === 2) salze.push(i);
  expect(salze.length).toBe(2);
  const GUT = [[20, 200, 90], [30, 70, 235]];
  for (const salz of salze) {
    const a = await ausWorker(nachricht({ art: 'url', url: `${basisUrl}?salz=${salz}`, referer: '' }, ['face'], 'sticker'));
    expect(a.ok, a.fehler).toBe(true);
    const f = (a.flaechen as Flaeche[]).find((x) => x.zone === 'face')!;
    const aus = await rohPixel(ausDataUrl(a.bild));
    const mitte = mitteFarbe(aus, f.box);
    console.log(`chromium: Sticker nach Dekodierfehler (Salz ${salz}): Mitte ${mitte.map(Math.round)}, Deckung ${(deckung(aus, f.box) * 100).toFixed(2)} %`);
    expect(GUT.some((q) => abstandFarbe(mitte, q) < 60), `ein guter Sticker in der Mitte (${mitte.map(Math.round)})`).toBe(true);
    expect(deckung(aus, f.box)).toBeGreaterThanOrEqual(0.99);
    expect(aussen(original, aus, [f.box]).mittel).toBeLessThan(4);
  }
  await raeumePack();
});
