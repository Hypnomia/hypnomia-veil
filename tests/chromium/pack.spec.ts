// Chromium: Mia Pack (PHASE-2-BAUPLAN Abschnitt 9). Dummy-Pack bauen, ueber die Einstellungsseite importieren, Popup, Neustart der
// Erweiterung, Erkenner-Rendern mit Mia-Patch und pinkem Rahmen, Entfernen. Nur synthetische Bilder.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;

const ZONEN_BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ZONEN_ALLE = ['eyes', 'mouth', 'face', 'head', ...ZONEN_BEDECKBAR];
function alleZonen(): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const name of ZONEN_ALLE) z[name] = ZONEN_BEDECKBAR.includes(name) ? { an: true, bedeckt: true } : { an: true };
  return z;
}

function pruefeNachricht(dataUrl: string, preset: string) {
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    quelle: { art: 'daten', dataUrl },
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: alleZonen(), rand: 0.15, preset },
    rendern: true,
  };
}

// Pixelanalyse im Seitenkontext: Anteil der Innenpixel nahe an den Pack-Farben und Mittelfarbe des Rahmens.
async function analysiere(
  seite: Page,
  bild: string,
  box: number[],
  farben: number[][],
): Promise<{ breite: number; hoehe: number; dunkel: number; wort: number; anteilPack: number; rahmen: number[]; rahmenBreite: number }> {
  return seite.evaluate(
    async ({ bild, box, farben }) => {
      const b = await createImageBitmap(await (await fetch(bild)).blob());
      const c = new OffscreenCanvas(b.width, b.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(b, 0, 0);
      const [x, y, w, h] = box.map((v) => Math.round(v)) as [number, number, number, number];
      const rb = Math.min(10, Math.max(2, Math.round(0.03 * Math.min(w, h))));
      const nah = (p: Uint8ClampedArray, i: number, f: number[]) => Math.hypot(p[i]! - f[0]!, p[i + 1]! - f[1]!, p[i + 2]! - f[2]!) < 70;
      // Innenpixel (hinter Rahmen und Kantenpuffer)
      const rand = rb + 3;
      const innen = ctx.getImageData(x + rand, y + rand, Math.max(1, w - 2 * rand), Math.max(1, h - 2 * rand)).data;
      let treffer = 0;
      let gesamt = 0;
      for (let i = 0; i < innen.length; i += 4) {
        gesamt++;
        if (farben.some((f) => nah(innen, i, f))) treffer++;
      }
      // Rahmen: Mittelfarbe der linken Randspalten in der Mitte der Flaeche
      const streifen = ctx.getImageData(x, y + Math.round(h * 0.25), rb, Math.max(1, Math.round(h * 0.5))).data;
      const summe = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < streifen.length; i += 4) {
        summe[0]! += streifen[i]!;
        summe[1]! += streifen[i + 1]!;
        summe[2]! += streifen[i + 2]!;
        n++;
      }
      let dunkel = 0;
      let wort = 0;
      for (let i = 0; i < innen.length; i += 4) {
        if (innen[i]! < 60 && innen[i + 1]! < 60 && innen[i + 2]! < 60) dunkel++;
        if (Math.hypot(innen[i]! - 255, innen[i + 1]! - 179, innen[i + 2]! - 211) < 45) wort++;
      }
      return {
        breite: b.width,
        hoehe: b.height,
        dunkel: dunkel / gesamt,
        wort,
        anteilPack: treffer / gesamt,
        rahmen: summe.map((s) => Math.round(s / n)),
        rahmenBreite: rb,
      };
    },
    { bild, box, farben },
  );
}

const abstand = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const ROSA = [255, 79, 163];

// Pack-Bau-Skript (Node-Modul ohne Typen) zur Laufzeit laden; der Pfad steht in einer Variable, damit tsc ihn nicht aufloesen muss.
interface PackBau {
  baueDummyPack(opts?: { farben?: number[][][]; id?: string; extraPatches?: { name: string; typ: string; daten: Uint8Array }[] }): Promise<{ bytes: Uint8Array; farben: number[][]; bilder: number }>;
  DUMMY_FARBEN_WARM: number[][][];
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

test.describe.configure({ mode: 'serial' });

let profil: string | undefined;
let ordner: string;
let packPfad: string;
let kaputtPfad: string;
let packBytes = 0;
let farben: number[][] = [];
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';

const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const popupUrl = () => `chrome-extension://${erweiterungsId}/popup.html`;

async function neuerWorker(): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
}

// Wartet, bis der Erkenner (Offscreen-Dokument) antwortet; weckt den Hintergrund vorher von einer Erweiterungsseite aus.
async function warteAufErkenner(seite: Page) {
  await expect
    .poll(
      async () => {
        try {
          await seite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }));
          const a = await worker.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'erkenner', typ: 'wecke' }));
          return a?.ok === true;
        } catch {
          return false;
        }
      },
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true);
}

const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
const speicher = (seite: Page, schluessel: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], schluessel);

// Dateien im Dummy-Pack: Lizenz, 6 Patches, 4 Vorschau-Bilder, 3 Chibis, 10 Werbebilder, Quiz, Texte.
const DUMMY_DATEIEN = 32; // Phase 5: dazu 10 Werbebilder, Session 11: dazu 5 Klaenge (Auftrag T), Zensur-Presets: dazu die Wort-Themen

// Anzahl Dateien in der Pack-Datenbank, direkt aus IndexedDB (Seite am Erweiterungs-Ursprung).
function zaehleIdb(seite: Page): Promise<{ dateien: number; meta: number }> {
  return seite.evaluate(
    () =>
      new Promise((ok, fehl) => {
        const a = indexedDB.open('veil-pack', 1);
        a.onerror = () => fehl(a.error);
        // Gab es die Datenbank noch nicht, legt das Zaehlen sie genauso an wie die Erweiterung (harmlos, gleiche Form).
        a.onupgradeneeded = () => {
          a.result.createObjectStore('meta');
          a.result.createObjectStore('dateien', { keyPath: 'name' });
        };
        a.onsuccess = () => {
          const db = a.result;
          const tx = db.transaction(['dateien', 'meta'], 'readonly');
          const d = tx.objectStore('dateien').count();
          const m = tx.objectStore('meta').count();
          tx.oncomplete = () => {
            db.close();
            ok({ dateien: d.result, meta: m.result });
          };
        };
      }),
  );
}

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-pack-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-pack-datei-'));
  packPfad = path.join(ordner, 'dummy.miapack');
  kaputtPfad = path.join(ordner, 'kaputt.miapack');
  // Dummy-Pack zur Laufzeit bauen (nur synthetische Bilder), dazu eine Kopie mit einem veraenderten Byte am Ende.
  const bau = await ladeBau();
  const { bytes, farben: f } = await bau.baueDummyPack();
  farben = f;
  packBytes = bytes.byteLength;
  await writeFile(packPfad, bytes);
  const kaputt = Uint8Array.from(bytes);
  kaputt[kaputt.length - 1]! ^= 0xff;
  await writeFile(kaputtPfad, kaputt);

  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = await neuerWorker();
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('Einstellungsseite: ohne Pack leerer Stand, die Presets mit meinem Gesicht sind gesperrt, Popup zeigt Hinweis und Weg zur Seite', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    await expect(seite.locator('#pack-daten')).toBeHidden();
    await expect(seite.locator('#entfernen')).toBeHidden();
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    for (const id of ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur']) await expect(seite.locator(`#preset-${id}`)).toBeDisabled();
    await expect(seite.locator('#preset-mosaik')).toBeChecked();

    // Popup: Mia-Preset gespeichert, aber ohne Pack gilt Mosaik, mit Hinweis auf das Pack
    await seite.goto(popupUrl());
    await seite.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({ einstellungen: { version: 1, preset: 'mia-wort' } });
    });
    await expect(seite.locator('#pack-hinweis')).toContainText('Mia Pack');
    await expect(seite.locator('#pack-link')).toBeVisible();
    await expect(seite.locator('#preset-name')).toHaveText('Mosaic');
    await seite.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.set({ einstellungen: { version: 1, preset: 'mosaik' } });
    });
  } finally {
    await seite.close();
  }
});

test('Einstellungsseite: beschaedigtes Pack wird abgelehnt, nichts wird gespeichert', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#datei').setInputFiles(kaputtPfad);
    await expect(seite.locator('#meldung')).toContainText('Nothing was stored');
    await expect(seite.locator('#meldung')).toHaveClass(/fehler/);
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect(await speicher(seite, 'pack')).toBeUndefined();
    expect(await zaehleIdb(seite)).toEqual({ dateien: 0, meta: 0 });
    console.log('chromium: beschaedigtes Pack abgelehnt, nichts gespeichert');
  } finally {
    await seite.close();
  }
});

test('Einstellungsseite: Lizenz zeigen, annehmen, importieren; Status, storage.local und Popup', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#datei').setInputFiles(packPfad);
    // Lizenztext aus dem Pack steht vor dem Import da; Import erst nach dem Annehmen.
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    await expect(seite.locator('#lizenz-text')).toContainText('Mia');
    expect(await speicher(seite, 'pack')).toBeUndefined();

    const t0 = Date.now();
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    const importMs = Date.now() - t0;
    console.log(`chromium: Import ${importMs} ms, Pack ${packBytes} Bytes, 6 Bilder`);
    await expect(seite.locator('#pack-bilder')).toHaveText('6');
    await expect(seite.locator('#pack-version')).toHaveText('0.0.1');
    await expect(seite.locator('#meldung')).toContainText('The pack is in');
    await expect(seite.locator('#entfernen')).toBeVisible();
    await expect(seite.locator('#lizenz-block')).toBeHidden();

    const pack = await speicher(seite, 'pack');
    // Dummy-Pack ab Phase 4: alle acht Freischaltungen, 4 Vorschau-Bilder, 3 Chibis (scripts/pack/baue-pack.mjs).
    expect(pack).toMatchObject({ id: 'dummy', version: '0.0.1', bilder: 6, vorschau: 4, chibis: 3, werbung: 10, groesse: packBytes });
    expect(pack.freischaltungen).toContain('stil:mia-patch');
    expect(pack.freischaltungen).toContain('zensur:woerter');
    expect(pack.freischaltungen).toHaveLength(18); // Session 11: dazu ton. Phase 5: dazu kontrolle:werbung, blitz, leerlauf (Session 9), tabtitel, cursor, meldungen, zeitplan, besuche (Session 10); Zensur-Presets: zensur:woerter
    expect(typeof pack.importiert).toBe('number');
    const einstellungen = await speicher(seite, 'einstellungen');
    expect(einstellungen.preset).toBe('mia-wort'); // erstes Pack mit Freischaltung: das Preset mit meinem Gesicht und Woertern
    expect(await zaehleIdb(seite)).toEqual({ dateien: DUMMY_DATEIEN, meta: 2 });

    await seite.goto(popupUrl());
    await expect(seite.locator('#preset-name')).toHaveText('My face, black, words');
    await expect(seite.locator('#pack-hinweis')).toContainText('I choose my face from');
    // Waehlbar auf der Einstellungsseite: auf Mosaik und zurueck.
    await seite.goto(optionsUrl());
    await expect(seite.locator('#preset-mia-wort')).toBeEnabled();
    await expect(seite.locator('#preset-mia-wort')).toBeChecked();
    await seite.locator('label:has(#preset-mosaik)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('mosaik');
    await seite.locator('label:has(#preset-mia-wort)').click();
    await expect.poll(async () => (await speicher(seite, 'einstellungen')).preset).toBe('mia-wort');
  } finally {
    await seite.close();
  }
});

// runtime.reload() laesst eine per --load-extension geladene Erweiterung in diesem Chromium deaktiviert zurueck (Seiten melden
// ERR_BLOCKED_BY_CLIENT, kein neuer Service Worker). Stattdessen: Browser schliessen und mit demselben Profil neu starten, und zwar
// mit einer Kopie des Baus, deren Version hochgesetzt ist. Das ist ein Update: gleiche ID (fester key), neue Version, gleiche Daten.
test('Update der Erweiterung (neue Version, gleiches Profil): Pack, Kurzfassung und Stil sind noch da', async () => {
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  const vorher = await speicher(seite, 'pack');
  const versionVorher = await seite.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version);
  await context.close();

  const kopie = path.join(ordner, 'chrome-mv3-neu');
  await cp(erweiterung, kopie, { recursive: true });
  const manifestPfad = path.join(kopie, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPfad, 'utf8'));
  manifest.version = '9.9.9';
  await writeFile(manifestPfad, JSON.stringify(manifest));

  context = await chromium.launchPersistentContext(profil!, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${kopie}`, `--load-extension=${kopie}`],
  });
  worker = await neuerWorker();
  expect(new URL(worker.url()).host).toBe(erweiterungsId);

  const nachher = await context.newPage();
  try {
    await nachher.goto(optionsUrl());
    expect(await nachher.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version)).toBe('9.9.9');
    await expect(nachher.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    expect(await speicher(nachher, 'pack')).toEqual(vorher);
    expect((await speicher(nachher, 'einstellungen')).preset).toBe('mia-wort');
    expect(await zaehleIdb(nachher)).toEqual({ dateien: DUMMY_DATEIEN, meta: 2 });
    console.log(`chromium: nach Neustart mit Version ${versionVorher} -> 9.9.9 Pack, Kurzfassung und ${DUMMY_DATEIEN} Dateien in IndexedDB vorhanden`);
  } finally {
    await nachher.close();
  }
});

// Festes Testbild mit bekannten Flaechen (nsfw-Satz in ../05 Testbilder, nie im Repo). Fehlt der Satz oder trifft das Bild nichts, ist der
// Test ROT. Nur mit VEIL_OHNE_TESTBILDER=1 wird der Render-Test uebersprungen, und das laut gemeldet.
const TESTBILD = '_DSC6278.JPG';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

async function festesTestbild(seite: Page): Promise<{ dataUrl: string; name: string }> {
  // Das Bild kommt als Data-URL aus dem Seitenkontext (wie vom Content-Script).
  const dataUrl = await seite.evaluate(async (adresse) => {
    const antwort = await fetch(adresse);
    if (!antwort.ok) throw new Error(`Testbild nicht ladbar: HTTP ${antwort.status}`);
    const bitmap = await createImageBitmap(await antwort.blob());
    const f = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const c = new OffscreenCanvas(Math.round(bitmap.width * f), Math.round(bitmap.height * f));
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return await new Promise<string>((ok) => {
      const l = new FileReader();
      l.onload = () => ok(String(l.result));
      l.readAsDataURL(out);
    });
  }, `${basis}/testbild/nsfw/${encodeURIComponent(TESTBILD)}`);
  const a = await ausWorker(pruefeNachricht(dataUrl, 'mosaik'));
  if (!a.ok || a.flaechen.length === 0) throw new Error(`Testbild ${TESTBILD} liefert keine Flaechen (${a.ok ? 'leer' : a.fehler})`);
  return { dataUrl, name: TESTBILD };
}

async function bildMitFlaechen(seite: Page): Promise<{ dataUrl: string; name: string }> {
  try {
    return await festesTestbild(seite);
  } catch (e) {
    if (OHNE_TESTBILDER) {
      console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Render-Test uebersprungen (${e instanceof Error ? e.message : e})`);
      test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
    }
    throw e;
  }
}

// Groesste Flaeche der Antwort (die mit der besten Messgenauigkeit).
const groessteBox = (flaechen: { box: number[] }[]): number[] => [...flaechen].sort((a, b) => b.box[2]! * b.box[3]! - a.box[2]! * a.box[3]!)[0]!.box;

test('Erkenner: Preset mit Wort zeichnet Schwarz mit pinkem Wort, Mosaik pinke Randpixel, stabile Auswahl, Blur ohne Rahmen', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(`${basis}/hello.html`);
    const hilfsSeite = await context.newPage();
    await hilfsSeite.goto(optionsUrl());
    await warteAufErkenner(hilfsSeite);
    await hilfsSeite.close();

    const bild = await bildMitFlaechen(seite);
    const dataUrl = bild.dataUrl;

    // Schwarz mit Wort (mia-wort: Koerper-Behandlung, die Dummy-Patches haben kein Gesicht)
    const t0 = Date.now();
    const wort = await ausWorker(pruefeNachricht(dataUrl, 'mia-wort'));
    const wortMs = Date.now() - t0;
    expect(wort.ok, wort.fehler).toBe(true);
    expect(String(wort.bild).startsWith('data:image/jpeg')).toBe(true);
    const box = groessteBox(wort.flaechen);
    const a = await analysiere(seite, wort.bild, box, farben);
    console.log(`chromium: mia-wort ${bild.name}: ${wort.flaechen.length} Flaechen, Rundlauf ${wortMs} ms, render ${wort.ms.render} ms, dunkel ${(a.dunkel * 100).toFixed(0)} %, Wortpixel ${a.wort}`);
    expect(a.breite).toBe(wort.breite);
    expect(a.dunkel).toBeGreaterThan(0.6);
    expect(a.wort).toBeGreaterThan(40);
    expect(a.anteilPack).toBeLessThan(0.05); // Mias Bilder kommen nicht mehr auf Koerperstellen

    // Stabil: dieselbe Anfrage liefert dieselbe Auswahl (gleiche Bytes im Bild).
    const nochmal = await ausWorker(pruefeNachricht(dataUrl, 'mia-wort'));
    expect(nochmal.bild).toBe(wort.bild);

    // Mosaik: pinker Rahmen, kaum Pack-Farben.
    const mosaik = await ausWorker(pruefeNachricht(dataUrl, 'mosaik'));
    expect(mosaik.ok, mosaik.fehler).toBe(true);
    const m = await analysiere(seite, mosaik.bild, groessteBox(mosaik.flaechen), farben);
    console.log(`chromium: Mosaik: Rahmen ${m.rahmen} (Breite ${m.rahmenBreite}), ${(m.anteilPack * 100).toFixed(0)} % Pack-Farben`);
    expect(abstand(m.rahmen, ROSA)).toBeLessThan(m.rahmenBreite >= 4 ? 90 : 120);
    expect(m.anteilPack).toBeLessThan(0.3);

    // Blur ohne Rahmen
    const blur = await ausWorker(pruefeNachricht(dataUrl, 'blur'));
    expect(blur.ok, blur.fehler).toBe(true);
    const bl = await analysiere(seite, blur.bild, groessteBox(blur.flaechen), farben);
    expect(abstand(bl.rahmen, ROSA)).toBeGreaterThan(60);
  } finally {
    await seite.close();
  }
});

test('Entfernen mit Rueckfrage: Pack weg, Preset Mosaik, Erkenner zeichnet ohne Pack Schwarz mit MIA statt Mias Gesicht und Woertern aus dem Pack', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await expect(seite.locator('#entfernen')).toBeVisible();
    // Rueckfrage: erst "Keep it" laesst alles stehen.
    await seite.locator('#entfernen').click();
    await expect(seite.locator('#entfernen-frage')).toBeVisible();
    await seite.locator('#entfernen-nein').click();
    await expect(seite.locator('#entfernen-frage')).toBeHidden();
    expect((await speicher(seite, 'pack')).id).toBe('dummy');

    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    await expect(seite.locator('#meldung')).toContainText('Mia Pack removed');
    expect(await speicher(seite, 'pack')).toBeUndefined();
    expect((await speicher(seite, 'einstellungen')).preset).toBe('mosaik');
    expect(await zaehleIdb(seite)).toEqual({ dateien: 0, meta: 0 });
    console.log('chromium: Pack entfernt, Preset mosaik, IndexedDB leer');

    // Erkenner: ein Mia-Preset ohne Pack (die Seite ersetzt es durch Mosaik, hier die Anfrage von Hand): Koerper schwarz mit dem festen Wort MIA,
    // keine Pack-Farben.
    const probe = await context.newPage();
    try {
      await probe.goto(`${basis}/hello.html`);
      const bild = await bildMitFlaechen(probe);
      const a = await ausWorker(pruefeNachricht(bild.dataUrl, 'mia-wort'));
      expect(a.ok, a.fehler).toBe(true);
      const r = await analysiere(probe, a.bild, groessteBox(a.flaechen), farben);
      expect(r.anteilPack).toBeLessThan(0.05);
      expect(r.dunkel).toBeGreaterThan(0.6);
    } finally {
      await probe.close();
    }

    // Einstellungsseite: Mia-Presets wieder gesperrt, Mosaik gewaehlt.
    await seite.goto(optionsUrl());
    await expect(seite.locator('#preset-mia-wort')).toBeDisabled();
    await expect(seite.locator('#preset-mosaik')).toBeChecked();
  } finally {
    await seite.close();
  }
});

// Mias Gesicht braucht in den Patch-Bildern ein Gesicht: die Tests nehmen dafuer Testbilder (Satz sfw, nie im Repo) als zusaetzliche Patches
// des Dummy-Packs. Fehlt das Testbild, ist der Test ROT (ausser mit VEIL_OHNE_TESTBILDER=1: dann laut uebersprungen).
async function gesichtsPatch(name: string): Promise<Buffer> {
  const antwort = await fetch(`${basis}/testbild/sfw/${encodeURIComponent(name)}`);
  if (!antwort.ok) {
    if (OHNE_TESTBILDER) {
      console.log(`chromium: AUSNAHME VEIL_OHNE_TESTBILDER=1: Test mit sfw/${name} uebersprungen`);
      test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
    }
    throw new Error(`Testbild sfw/${name} fehlt (../05 Testbilder)`);
  }
  return sharp(Buffer.from(await antwort.arrayBuffer())).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
}
// Zielbild mit einem Gesicht als Data-URL (hoechstens 1280 px, wie vom Content-Script) und seine Rohpixel.
async function zielMitGesicht(): Promise<{ dataUrl: string; daten: Buffer; b: number; h: number }> {
  const antwort = await fetch(`${basis}/testbild/sfw/${encodeURIComponent('sfw-001-portraet.jpg')}`);
  if (!antwort.ok) {
    if (OHNE_TESTBILDER) test.skip(true, 'VEIL_OHNE_TESTBILDER=1');
    throw new Error('Testbild sfw/sfw-001-portraet.jpg fehlt (../05 Testbilder)');
  }
  const jpg = await sharp(Buffer.from(await antwort.arrayBuffer())).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const roh = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`, daten: roh.data, b: roh.info.width, h: roh.info.height };
}
async function pixelAusDataUrl(url: string): Promise<{ daten: Buffer; b: number; h: number }> {
  const roh = await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { daten: roh.data, b: roh.info.width, h: roh.info.height };
}
// Mittlere Abweichung zweier gleich grosser Bilder in einer Box.
function abweichung(x: { daten: Buffer; b: number }, y: { daten: Buffer; b: number }, box: number[]): number {
  let summe = 0;
  let n = 0;
  for (let yy = box[1]! + 6; yy < box[1]! + box[3]! - 6; yy++) {
    for (let xx = box[0]! + 6; xx < box[0]! + box[2]! - 6; xx++) {
      const i = (yy * x.b + xx) * 3;
      summe += (Math.abs(x.daten[i]! - y.daten[i]!) + Math.abs(x.daten[i + 1]! - y.daten[i + 1]!) + Math.abs(x.daten[i + 2]! - y.daten[i + 2]!)) / 3;
      n++;
    }
  }
  return summe / Math.max(1, n);
}
const gesichtsBox = (flaechen: { zone: string; box: number[]; behandlung?: string }[]): number[] => flaechen.find((f) => f.zone === 'face' && f.behandlung === 'mia-gesicht')!.box;

test('Pack ersetzen: zweiter Import ersetzt das erste Pack, der Erkenner liest die neuen Bilder (Mias Gesicht kommt aus dem neuen Pack)', async () => {
  test.setTimeout(120_000);
  const bau = await ladeBau();
  const patchA = await gesichtsPatch('sfw-003-portraet.jpg');
  const warm = await bau.baueDummyPack({ farben: bau.DUMMY_FARBEN_WARM, id: 'warm', extraPatches: [{ name: 'patch/gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patchA) }] });
  const warmPfad = path.join(ordner, 'warm.miapack');
  await writeFile(warmPfad, warm.bytes);
  const ziel = await zielMitGesicht();

  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await warteAufErkenner(seite);

    const importiere = async (pfad: string, titelTeil: string) => {
      await seite.locator('#datei').setInputFiles(pfad);
      await seite.locator('#annehmen').click();
      await expect(seite.locator('#lizenz-block')).toBeHidden();
      await expect(seite.locator('#pack-status')).toContainText('Pack in place');
      await expect(seite.locator('#pack-titel')).toContainText(titelTeil);
    };

    await importiere(packPfad, 'Dummy');
    // Erstes Pack: keine Gesichter in den Patches, das Gesicht bekommt den Ersatz (Mosaik mit Rahmen)
    const erste = await ausWorker(pruefeNachricht(ziel.dataUrl, 'mia-mosaik'));
    expect(erste.ok, erste.fehler).toBe(true);
    const boxA = gesichtsBox(erste.flaechen);
    const orig = { daten: ziel.daten, b: ziel.b };
    const pixelErste = await pixelAusDataUrl(erste.bild);
    const abwErste = abweichung(orig, pixelErste, boxA);

    // Zweites Pack mit einem Patch mit Gesicht ersetzt das erste (gleiche Titelzeile, andere Pack-ID).
    await importiere(warmPfad, 'Dummy');
    expect((await speicher(seite, 'pack')).id).toBe('warm');
    // Warmes Dummy-Pack: Lizenz, 3 Patches plus einer mit Gesicht, 4 Vorschau-Bilder, 3 Chibis, 10 Werbebilder, Quiz, Texte, 5 Klaenge, Woerter.
    expect(await zaehleIdb(seite)).toEqual({ dateien: 30, meta: 2 });
    // Die Gesichtssuche in den Patch-Bildern laeuft im Hintergrund (nie in der Pruefung); der Test wartet auf sie
    const scan = await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
    expect(scan.fertig && scan.mit === 1).toBe(true);
    const zweite = await ausWorker(pruefeNachricht(ziel.dataUrl, 'mia-mosaik'));
    expect(zweite.ok, zweite.fehler).toBe(true);
    const pixelZweite = await pixelAusDataUrl(zweite.bild);
    const abwZweite = abweichung(orig, pixelZweite, gesichtsBox(zweite.flaechen));
    const zwischen = abweichung(pixelErste, pixelZweite, boxA);
    console.log(`chromium: nach Ersetzen Gesichtsflaeche: Abweichung zum Original ${abwErste.toFixed(1)} (Ersatz Mosaik) gegen ${abwZweite.toFixed(1)} (Mias Gesicht), zwischen beiden ${zwischen.toFixed(1)}`);
    expect(zwischen).toBeGreaterThan(15); // das Gesicht aus dem neuen Pack ist ein anderes Bild als der Ersatz
    expect(abwZweite).toBeGreaterThan(abwErste);
  } finally {
    await seite.close();
  }
});

test('packStand: weicht der Stand der Anfrage ab, liest der Erkenner sofort neu (ohne Meldung, ohne 1 s Wartezeit)', async () => {
  test.setTimeout(120_000);
  const patchB = await gesichtsPatch('sfw-004-portraet.jpg');
  const ziel = await zielMitGesicht();
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await warteAufErkenner(seite);
    const alt = (await speicher(seite, 'pack')).importiert as number;
    const nachricht = (stand: number) => ({ ...pruefeNachricht(ziel.dataUrl, 'mia-mosaik'), einstellungen: { ...pruefeNachricht('', 'mia-mosaik').einstellungen, packStand: stand } });
    const erste = await ausWorker(nachricht(alt));
    expect(erste.ok, erste.fehler).toBe(true);
    const box = gesichtsBox(erste.flaechen);
    const tErste = Date.now();

    // Das Pack wird an der Meldung vorbei ersetzt: direkt in IndexedDB, ohne BroadcastChannel. Ein einziges Patch-Bild, ein anderes Gesicht.
    const neuerStand = alt + 12345;
    await seite.evaluate(
      ({ stand, b64 }) =>
        new Promise<void>((ok, fehl) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          const a = indexedDB.open('veil-pack', 1);
          a.onerror = () => fehl(a.error);
          a.onsuccess = () => {
            const db = a.result;
            const tx = db.transaction(['dateien', 'meta'], 'readwrite');
            tx.objectStore('dateien').clear();
            tx.objectStore('dateien').put({ name: 'patch/gesicht-b.jpg', typ: 'image/jpeg', rolle: 'patch', blob });
            tx.objectStore('meta').put({ importiert: stand, patches: ['patch/gesicht-b.jpg'] }, 'stand');
            tx.oncomplete = () => {
              db.close();
              ok();
            };
            tx.onerror = () => fehl(tx.error);
          };
        }),
      { stand: neuerStand, b64: patchB.toString('base64') },
    );
    // Kontrolle, solange der gelesene Stand noch keine Sekunde alt ist: mit dem alten packStand bleibt es (zu Recht) beim alten Pack, dasselbe Bild.
    if (Date.now() - tErste < 800) {
      const kontrolle = await ausWorker(nachricht(alt));
      console.log(`chromium: packStand Kontrolle (alter Stand, ${Date.now() - tErste} ms nach dem Lesen): ${kontrolle.bild === erste.bild ? 'dasselbe Bild' : 'anderes Bild'}`);
      expect(kontrolle.bild).toBe(erste.bild);
    } else {
      console.log(`chromium: packStand Kontrolle ausgelassen (${Date.now() - tErste} ms seit dem Lesen, Stand schon abgelaufen)`);
    }
    // Gesichtssuche im neuen Pack abwarten (laeuft im Hintergrund), dann zaehlt die Zeit der Pruefung
    expect((await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan', packStand: neuerStand })).mit).toBe(1);
    const t0 = Date.now();
    const neu = await ausWorker(nachricht(neuerStand));
    const ms = Date.now() - t0;
    expect(neu.ok, neu.fehler).toBe(true);
    const abw = abweichung(await pixelAusDataUrl(erste.bild), await pixelAusDataUrl(neu.bild), box);
    console.log(`chromium: packStand: Gesicht aus dem neuen Pack weicht um ${abw.toFixed(1)} vom alten ab, Rundlauf ${ms} ms`);
    expect(abw).toBeGreaterThan(15);
  } finally {
    await seite.close();
  }
});

// Leert beide Speicher der Pack-Datenbank direkt (Seite am Erweiterungs-Ursprung), ohne storage.local anzufassen.
function leereIdb(seite: Page, mitWaise = false): Promise<void> {
  return seite.evaluate(
    (waise) =>
      new Promise<void>((ok, fehl) => {
        const a = indexedDB.open('veil-pack', 1);
        a.onerror = () => fehl(a.error);
        a.onsuccess = () => {
          const db = a.result;
          const tx = db.transaction(['dateien', 'meta'], 'readwrite');
          tx.objectStore('dateien').clear();
          tx.objectStore('meta').clear();
          if (waise) tx.objectStore('dateien').put({ name: 'waise.png', typ: 'image/png', blob: new Blob([new Uint8Array([1, 2, 3])]) });
          tx.oncomplete = () => {
            db.close();
            ok();
          };
          tx.onerror = () => fehl(tx.error);
        };
      }),
    mitWaise,
  );
}

test('Abgleich beim Oeffnen: fehlende Kurzfassung wird nachgeschrieben, verwaiste entfernt, Reste entfernbar', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await expect(seite.locator('#pack-status')).toContainText('Pack in place');
    const soll = await speicher(seite, 'pack');

    // 1. Kurzfassung fehlt, IndexedDB hat das Pack: wird aus dem Meta nachgeschrieben.
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    await seite.reload();
    await expect(seite.locator('#pack-status')).toContainText('Pack in place');
    await expect(seite.locator('#meldung')).toContainText('set the pack up again');
    expect(await speicher(seite, 'pack')).toEqual(soll);

    // 2. Kurzfassung ohne Pack in IndexedDB: wird entfernt, der Stil geht zurueck auf Mosaik.
    await leereIdb(seite);
    await seite.reload();
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    await expect(seite.locator('#meldung')).toContainText('cleaned it up');
    expect(await speicher(seite, 'pack')).toBeUndefined();
    expect((await speicher(seite, 'einstellungen')).preset).toBe('mosaik');

    // 3. Dateien ohne Meta (verwaist): sichtbar und entfernbar.
    await leereIdb(seite, true);
    await seite.reload();
    await expect(seite.locator('#pack-status')).toContainText('leftover');
    await expect(seite.locator('#entfernen')).toBeVisible();
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    expect(await zaehleIdb(seite)).toEqual({ dateien: 0, meta: 0 });
    console.log('chromium: Abgleich: nachgeschrieben, verwaiste Kurzfassung entfernt, Reste entfernt');
  } finally {
    await seite.close();
  }
});

test('Einstellungsseite: Pack mit zu grossem Bild (5000 px) wird abgelehnt, nichts gespeichert', async () => {
  const { schreibePack } = await import('../../src/pack/format');
  const u24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  const kopf = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, ...u24(4999), ...u24(99), 1, 2, 3, 4];
  const bytes = await schreibePack(
    { id: 'gross', version: '1.0.0', titel: 'Gross', erstellt: '2026-01-01', mindestVeil: '0.0.1', freischaltungen: ['stil:mia-patch'] },
    [
      { name: 'lizenz.txt', typ: 'text/plain', daten: new TextEncoder().encode('Lizenz'), rolle: 'lizenz' },
      { name: 'patch/riesig.webp', typ: 'image/webp', daten: Uint8Array.from(kopf), rolle: 'patch' },
    ],
  );
  const pfad = path.join(ordner, 'gross.miapack');
  await writeFile(pfad, bytes);
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#datei').setInputFiles(pfad);
    await expect(seite.locator('#meldung')).toContainText('too large (over 4096 pixels');
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect(await speicher(seite, 'pack')).toBeUndefined();
    expect(await zaehleIdb(seite)).toEqual({ dateien: 0, meta: 0 });
  } finally {
    await seite.close();
  }
});

test('Import: aendert sich die Datei zwischen Pruefen und Import, wird nichts gespeichert', async () => {
  const bau = await ladeBau();
  const { bytes } = await bau.baueDummyPack();
  const pfad = path.join(ordner, 'wechselt.miapack');
  await writeFile(pfad, bytes);
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    // Sicherer Ausgangszustand: kein Pack.
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    await seite.locator('#datei').setInputFiles(pfad);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    // Nach der Pruefung wird ein Byte im letzten Bild veraendert (gleiche Groesse).
    const geaendert = Uint8Array.from(bytes);
    geaendert[geaendert.length - 5]! ^= 0xff;
    await new Promise((r) => setTimeout(r, 1100)); // andere Aenderungszeit, wie bei einer echten Aenderung
    await writeFile(pfad, geaendert);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#meldung')).toContainText('Nothing was stored');
    await expect(seite.locator('#meldung')).toHaveClass(/fehler/);
    expect(await speicher(seite, 'pack')).toBeUndefined();
    expect(await zaehleIdb(seite)).toEqual({ dateien: 0, meta: 0 });
    console.log('chromium: Datei zwischen Pruefen und Import veraendert: abgelehnt, nichts gespeichert');
  } finally {
    await seite.close();
  }
});
