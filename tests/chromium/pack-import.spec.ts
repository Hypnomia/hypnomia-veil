// Chromium: Pack-Import fertig (Session 12, Auftrag P, Entscheidungen 88, 141): Lizenz jederzeit lesen, Ersetzen in einem Schritt mit
// Hinweis je Fall, Einstellungen bleiben, Ziehen und Ablegen, veraenderte Datei, Datum amerikanisch. Nur synthetische Bilder.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOPF_ANNEHMEN,
  KNOPF_ANNEHMEN_AELTER,
  KNOPF_LIZENZ_ZEIGEN,
  TEXT_BESCHAEFTIGT,
  TEXT_EINSTIEG_ZUERST,
  TEXT_KEINE_DATEI,
  TEXT_LIZENZ_NICHT_LESBAR,
  TEXT_MEHRERE_DATEIEN,
  TEXT_PACK_GEAENDERT,
  ersetzenHinweis,
} from '../../entrypoints/options/pack-texte';
import { datumLang } from '../../src/oberflaeche/gemeinsam';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

interface PackBau {
  baueDummyPack(opts?: { farben?: number[][][]; id?: string; version?: string; ohneTon?: boolean }): Promise<{ bytes: Uint8Array }>;
  DUMMY_FARBEN_WARM: number[][][];
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

const DATEIEN = 31; // Dummy-Pack: Lizenz, 6 Patches, 4 Vorschau, 3 Chibis, 10 Werbebilder, 5 Klaenge, Quiz, Texte
const DATEIEN_OHNE_TON = 26; // ohne die 5 Klaenge: andere Zahl, damit "Zahl der Dateien" etwas aussagt
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let context: BrowserContext;
let erweiterungsId = '';
const pfad: Record<string, string> = {};
const bytes: Record<string, Uint8Array> = {};

const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const alles = (seite: Page) => seite.evaluate(async () => (await (globalThis as any).chrome.storage.local.get(null)) as Record<string, any>);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);

function zaehleIdb(seite: Page): Promise<{ dateien: number; meta: number }> {
  return seite.evaluate(
    () =>
      new Promise((ok, fehl) => {
        const a = indexedDB.open('veil-pack', 1);
        a.onerror = () => fehl(a.error);
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

// Meta-Eintrag "aktiv" aus IndexedDB (die Wahrheit): Kennung, Version und Zahl der Dateien im Meta.
function leseMetaIdb(seite: Page): Promise<{ id: string; version: string; dateienImMeta: number } | null> {
  return seite.evaluate(
    () =>
      new Promise((ok, fehl) => {
        const a = indexedDB.open('veil-pack', 1);
        a.onerror = () => fehl(a.error);
        a.onsuccess = () => {
          const db = a.result;
          const tx = db.transaction('meta', 'readonly');
          const g = tx.objectStore('meta').get('aktiv');
          tx.oncomplete = () => {
            db.close();
            ok(g.result ? { id: g.result.id, version: g.result.version, dateienImMeta: g.result.dateien.length } : null);
          };
        };
      }),
  );
}

// Oeffnet die Einstellungsseite und wartet auf den Pack-Status (Wettlauf aus Session 11).
async function oeffne(): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  await expect(seite.locator('#pack-status')).not.toHaveText('');
  // Das Dateifeld ist bis zum Lesen des Einstiegs gesperrt (grund-pack.ts)
  await expect(seite.locator('#datei')).toBeEnabled();
  return seite;
}

// Wirft Dateien (Name, Inhalt) per synthetischem DragEvent auf ein Element; liefert, ob dragover/drop abgefangen wurden.
async function wirf(seite: Page, css: string, dateien: { name: string; b64: string; typ?: string }[], art: 'drop' | 'ohne-dateien' | 'link' = 'drop') {
  return seite.evaluate(
    ({ css, dateien, art }) => {
      const dt = new DataTransfer();
      // Ein frisch gebautes DataTransfer meldet immer 'none': den gesetzten Wert selbst festhalten
      let gesetzt = 'none';
      Object.defineProperty(dt, 'dropEffect', { get: () => gesetzt, set: (v: string) => void (gesetzt = v), configurable: true });
      if (art === 'drop') {
        for (const d of dateien) {
          const roh = atob(d.b64);
          const b = new Uint8Array(roh.length);
          for (let i = 0; i < roh.length; i++) b[i] = roh.charCodeAt(i);
          dt.items.add(new File([b], d.name, { type: d.typ ?? '' }));
        }
      }
      if (art === 'link') dt.setData('text/uri-list', 'https://example.com/pack.miapack');
      const ziel = document.querySelector(css)!;
      const ereignis = (t: string) => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
      const ein = ereignis('dragenter');
      ziel.dispatchEvent(ein);
      const ueber = ereignis('dragover');
      ziel.dispatchEvent(ueber);
      const effekt = dt.dropEffect; // gleich nach dragover lesen (drop setzt ihn zurueck)
      const hervorgehoben = document.querySelector('#ablage')!.classList.contains('ueber');
      const ab = ereignis('drop');
      ziel.dispatchEvent(ab);
      return { ueberAbgefangen: ueber.defaultPrevented, dropAbgefangen: ab.defaultPrevented, hervorgehoben, effekt };
    },
    { css, dateien, art },
  );
}
const b64 = (name: string) => Buffer.from(bytes[name]!).toString('base64');

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-pack-imp-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-pack-imp-datei-'));
  const bau = await ladeBau();
  const bauen: [string, { id?: string; version?: string; ohneTon?: boolean }][] = [
    ['v100', { version: '1.0.0' }],
    ['v110', { version: '1.1.0', ohneTon: true }],
    ['v120', { version: '1.2.0', ohneTon: true }],
    ['andere', { id: 'anderes', version: '2.0.0' }],
  ];
  for (const [name, opts] of bauen) {
    bytes[name] = (await bau.baueDummyPack(opts)).bytes;
    pfad[name] = path.join(ordner, `${name}.miapack`);
    await writeFile(pfad[name]!, bytes[name]!);
  }
  // Entscheidung 88: ein Byte im Datenteil verfaelscht (mitten in der Datei, nicht am Ende)
  const kaputt = Uint8Array.from(bytes.v110!);
  kaputt[Math.floor(kaputt.length / 2)]! ^= 0xff;
  bytes.kaputt = kaputt;
  pfad.kaputt = path.join(ordner, 'kaputt.miapack');
  await writeFile(pfad.kaputt, kaputt);
  await writeFile(path.join(ordner, 'x.txt'), 'kein Pack');

  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  // Einstieg als erledigt festhalten (der Testbau tut es nach der Installation selbst, aber nicht vor dem ersten Oeffnen der Seite)
  await worker.evaluate((e) => (globalThis as any).chrome.storage.local.set({ einstieg: e }), EINSTIEG_FERTIG);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('Lizenz jederzeit: ohne Pack verborgen, nach dem Import auf- und zuklappen, Text gleich dem im Pack, nach Entfernen zu', async () => {
  const seite = await oeffne();
  try {
    await expect(seite.locator('#lizenz-zeile')).toBeHidden();
    await seite.locator('#datei').setInputFiles(pfad.v100!);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    // Runde 3, N3: nach der Pruefung steht der Fokus auf "Before it goes in".
    await expect(seite.locator('#lizenz-block h3')).toBeFocused();
    // Erstes Pack: kein Hinweis zum Ersetzen, Knopf wie immer
    await expect(seite.locator('#ersetzen-hinweis')).toBeHidden();
    await expect(seite.locator('#annehmen')).toHaveText(KNOPF_ANNEHMEN);
    const lizenzImPack = await seite.locator('#lizenz-text').textContent();
    expect((lizenzImPack ?? '').length).toBeGreaterThan(20);
    await seite.locator('#annehmen').click();
    // Runde 3, N3 / Session 17: nach dem Import liegt der Fokus nicht auf body, sondern bei der Frage "Show my ads?" ("Set me up"),
    // weil das Dummy-Pack den Werbe-Tausch freischaltet.
    await expect.poll(() => seite.evaluate(() => document.activeElement?.id ?? '')).toBe('werbung-frage-titel');
    await expect(seite.locator('#pack-version')).toHaveText('1.0.0');

    const knopf = seite.locator('#lizenz-zeigen');
    await expect(seite.locator('#lizenz-zeile')).toBeVisible();
    await expect(knopf).toHaveText(KNOPF_LIZENZ_ZEIGEN);
    await expect(knopf).toHaveAttribute('aria-expanded', 'false');
    await expect(seite.locator('#lizenz-ansicht')).toBeHidden();
    await knopf.click();
    await expect(knopf).toHaveAttribute('aria-expanded', 'true');
    await expect(seite.locator('#lizenz-ansicht')).toBeVisible();
    await expect(seite.locator('#lizenz-ansicht-text')).toHaveText(lizenzImPack!);
    console.log(`chromium: Lizenz in der Ansicht ${lizenzImPack!.length} Zeichen, gleich dem Text im Pack`);
    await knopf.click();
    await expect(knopf).toHaveAttribute('aria-expanded', 'false');
    await expect(seite.locator('#lizenz-ansicht')).toBeHidden();

    // Datum amerikanisch (Fund 28): so wie datumLang es liefert, kein "05/11/2026"
    const pack = await lies(seite, 'pack');
    await expect(seite.locator('#pack-datum')).toHaveText(datumLang(pack.importiert, true));
    expect(await seite.locator('#pack-datum').textContent()).not.toMatch(/\d\d\/\d\d\/\d{4}/);

    // Nach Entfernen klappt die Ansicht zu und die Zeile verschwindet
    await knopf.click();
    await expect(seite.locator('#lizenz-ansicht')).toBeVisible();
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
    await expect(seite.locator('#lizenz-ansicht')).toBeHidden();
    await expect(seite.locator('#lizenz-zeile')).toBeHidden();
    await expect(knopf).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await seite.close();
  }
});

test('Lizenz nicht lesbar: ein Satz statt eines leeren Kastens', async () => {
  const seite = await oeffne();
  try {
    await seite.locator('#datei').setInputFiles(pfad.v100!);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-version')).toHaveText('1.0.0');
    // Lizenztext im gespeicherten Meta loeschen
    await seite.evaluate(
      () =>
        new Promise<void>((ok, fehl) => {
          const a = indexedDB.open('veil-pack', 1);
          a.onerror = () => fehl(a.error);
          a.onsuccess = () => {
            const db = a.result;
            const tx = db.transaction('meta', 'readwrite');
            const s = tx.objectStore('meta');
            const g = s.get('aktiv');
            g.onsuccess = () => s.put({ ...g.result, lizenzText: '' }, 'aktiv');
            tx.oncomplete = () => {
              db.close();
              ok();
            };
          };
        }),
    );
    await seite.locator('#lizenz-zeigen').click();
    await expect(seite.locator('#lizenz-ansicht-text')).toHaveText(TEXT_LIZENZ_NICHT_LESBAR);
  } finally {
    await seite.close();
  }
});

test('Ersetzen: 1.0.0 mit geaenderten Einstellungen, dann 1.1.0 (Hinweis neuer), dann 1.0.0 (Warnung aelter, Knopf), dann anderes Pack; Speicher bleibt', async () => {
  const seite = await oeffne();
  try {
    expect((await lies(seite, 'pack')).version).toBe('1.0.0');
    expect(await leseMetaIdb(seite)).toMatchObject({ version: '1.0.0', dateienImMeta: DATEIEN });
    const e0 = await lies(seite, 'einstellungen');
    await schreibe(seite, {
      einstellungen: { ...e0, stil: 'blur', zonen: { ...e0.zonen, belly: { ...e0.zonen.belly, an: true } }, erwachsen: { ...e0.erwachsen, an: false } },
    });
    // `begruesstFuer` (Begruessungs-Merker, main.ts von Auftrag O) folgt jedem Import und bleibt hier aussen vor.
    const ohneMerker = async () => {
      const o = await alles(seite);
      delete o.pack;
      delete o.begruesstFuer;
      return o;
    };
    const vorher = await ohneMerker();
    expect(vorher.einstellungen.stil).toBe('blur');
    const titel = 'Dummy pack (synthetic pictures)';

    // 1.1.0 (ohne Klaenge): Hinweis "neuer", noch nichts ersetzt
    await seite.locator('#datei').setInputFiles(pfad.v110!);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    await expect(seite.locator('#ersetzen-hinweis')).toHaveText(ersetzenHinweis('neuer', { titel, version: '1.0.0' }, { titel, version: '1.1.0' })!);
    await expect(seite.locator('#ersetzen-hinweis')).toContainText('settings stay');
    await expect(seite.locator('#ersetzen-hinweis')).not.toHaveClass(/stark/);
    await expect(seite.locator('#annehmen')).toHaveText(KNOPF_ANNEHMEN);
    expect((await lies(seite, 'pack')).version).toBe('1.0.0');
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-version')).toHaveText('1.1.0');
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect(await ohneMerker()).toEqual(vorher);
    // Die Ablage selbst (nicht nur die Anzeige): Meta aus IndexedDB hat Kennung, Version und die Dateien des NEUEN Packs
    const idb = await zaehleIdb(seite);
    expect(idb).toEqual({ dateien: DATEIEN_OHNE_TON, meta: 2 });
    expect(await leseMetaIdb(seite)).toEqual({ id: 'dummy', version: '1.1.0', dateienImMeta: DATEIEN_OHNE_TON });
    console.log(`chromium: 1.0.0 -> 1.1.0 ersetzt, Meta in IndexedDB 1.1.0 mit ${idb.dateien} Dateien (vorher ${DATEIEN}), Speicher gleich`);

    // 1.0.0 ueber 1.1.0: Warnung (eigene Optik), Knopftext; erst nach Klick ersetzt; Abbrechen laesst alles
    await seite.locator('#datei').setInputFiles(pfad.v100!);
    await expect(seite.locator('#ersetzen-hinweis')).toHaveText(ersetzenHinweis('aelter', { titel, version: '1.1.0' }, { titel, version: '1.0.0' })!);
    await expect(seite.locator('#ersetzen-hinweis')).toHaveClass(/stark/);
    await expect(seite.locator('#annehmen')).toHaveText(KNOPF_ANNEHMEN_AELTER);
    expect((await lies(seite, 'pack')).version).toBe('1.1.0');
    await seite.locator('#abbrechen').click();
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect((await lies(seite, 'pack')).version).toBe('1.1.0');
    expect((await leseMetaIdb(seite))?.version).toBe('1.1.0');
    await seite.locator('#datei').setInputFiles(pfad.v100!);
    await expect(seite.locator('#annehmen')).toHaveText(KNOPF_ANNEHMEN_AELTER);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-version')).toHaveText('1.0.0');
    expect(await ohneMerker()).toEqual(vorher);
    expect(await leseMetaIdb(seite)).toEqual({ id: 'dummy', version: '1.0.0', dateienImMeta: DATEIEN });
    expect(await zaehleIdb(seite)).toEqual({ dateien: DATEIEN, meta: 2 });
    // gleich: Hinweis, Knopf wieder Standard, Klasse weg
    await seite.locator('#datei').setInputFiles(pfad.v100!);
    await expect(seite.locator('#ersetzen-hinweis')).toContainText('already in');
    await expect(seite.locator('#ersetzen-hinweis')).not.toHaveClass(/stark/);
    await expect(seite.locator('#annehmen')).toHaveText(KNOPF_ANNEHMEN);
    await seite.locator('#abbrechen').click();

    // Anderes Pack: nennt den Titel des vorhandenen
    await seite.locator('#datei').setInputFiles(pfad.andere!);
    await expect(seite.locator('#ersetzen-hinweis')).toHaveText(ersetzenHinweis('anderes', { titel, version: '1.0.0' }, { titel, version: '2.0.0' })!);
    await expect(seite.locator('#ersetzen-hinweis')).toContainText('different pack');
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-version')).toHaveText('2.0.0');
    expect(await ohneMerker()).toEqual(vorher);
    expect(await leseMetaIdb(seite)).toEqual({ id: 'anderes', version: '2.0.0', dateienImMeta: DATEIEN });
    expect((await lies(seite, 'pack')).id).toBe('anderes');
  } finally {
    await seite.close();
  }
});

test('Zwei Seiten: ersetzt eine andere Seite das Pack nach der Pruefung, bricht der Import ab (kein Import ohne Warnung)', async () => {
  const a = await oeffne();
  const b = await oeffne();
  try {
    // Ausgangslage: 'anderes' 2.0.0 liegt da. Seite A prueft 1.1.0 (Kennung dummy: "anderes"), Seite B ersetzt inzwischen durch dummy 1.0.0.
    await a.locator('#datei').setInputFiles(pfad.v110!);
    await expect(a.locator('#ersetzen-hinweis')).toContainText('different pack');
    await b.locator('#datei').setInputFiles(pfad.v100!);
    await b.locator('#annehmen').click();
    await expect(b.locator('#pack-version')).toHaveText('1.0.0');
    // Jetzt waere 1.1.0 ueber 1.0.0 "neuer", die Seite A hat aber "anderes" gezeigt: der Import darf nicht still durchgehen.
    await a.locator('#annehmen').click();
    await expect(a.locator('#meldung')).toHaveText(TEXT_PACK_GEAENDERT);
    await expect(a.locator('#lizenz-block')).toBeHidden();
    expect((await lies(a, 'pack')).version).toBe('1.0.0');
    expect(await leseMetaIdb(a)).toEqual({ id: 'dummy', version: '1.0.0', dateienImMeta: DATEIEN });
    expect(await zaehleIdb(a)).toEqual({ dateien: DATEIEN, meta: 2 });
    // Neu pruefen zeigt jetzt den richtigen Fall
    await a.locator('#datei').setInputFiles(pfad.v110!);
    await expect(a.locator('#ersetzen-hinweis')).toContainText('replaces the old one');
    await a.locator('#abbrechen').click();
    console.log('chromium: Pack zwischen Pruefung und Annehmen anderswo ersetzt: Import abgebrochen, Stand 1.0.0 unveraendert');
  } finally {
    await a.close();
    await b.close();
  }
});

test('Ziehen und Ablegen: eine Datei geht den Weg des Dateifelds, zwei Dateien und eine Nicht-Datei nicht, Seite bleibt', async () => {
  const seite = await oeffne();
  try {
    const url = seite.url();
    // Vorhanden ist dummy 1.0.0 (Test davor): Ablegen von 1.1.0 ist "neuer".
    const ein = await wirf(seite, '#ablage', [{ name: 'v110.miapack', b64: b64('v110') }]);
    expect(ein.ueberAbgefangen).toBe(true);
    expect(ein.dropAbgefangen).toBe(true);
    expect(ein.hervorgehoben).toBe(true);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    await expect(seite.locator('#ersetzen-hinweis')).toContainText('replaces the old one');
    await expect(seite.locator('#ablage')).not.toHaveClass(/ueber/);
    await expect(seite.locator('#lizenz-kopf')).toContainText('version 1.1.0');
    expect((await lies(seite, 'pack')).version).toBe('1.0.0');
    await seite.locator('#abbrechen').click();

    // zwei Dateien: Satz, nichts passiert
    const zwei = await wirf(seite, '#ablage', [
      { name: 'a.miapack', b64: b64('v100') },
      { name: 'b.miapack', b64: b64('v110') },
    ]);
    expect(zwei.dropAbgefangen).toBe(true);
    await expect(seite.locator('#meldung')).toHaveText(TEXT_MEHRERE_DATEIEN);
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect((await lies(seite, 'pack')).version).toBe('1.0.0');

    // kein File: ein Link (text/uri-list), mit dem echten Ablauf dragenter, dragover (muss abgefangen sein, sonst feuert drop nie), drop
    const link = await wirf(seite, '#ablage', [], 'link');
    expect(link.ueberAbgefangen).toBe(true);
    expect(link.effekt).toBe('copy');
    await expect(seite.locator('#meldung')).toHaveText(TEXT_KEINE_DATEI);
    await wirf(seite, '#ablage', [], 'ohne-dateien');
    await expect(seite.locator('#meldung')).toHaveText(TEXT_KEINE_DATEI);
    await expect(seite.locator('#lizenz-block')).toBeHidden();

    // keine Pack-Datei: normaler Fehlersatz, nichts gespeichert
    await wirf(seite, '#ablage', [{ name: 'x.txt', b64: Buffer.from('kein Pack, nur Text').toString('base64') }]);
    await expect(seite.locator('#meldung')).toContainText('Nothing was stored');
    await expect(seite.locator('#meldung')).toHaveClass(/fehler/);

    // Wurf daneben (auf die Seite, nicht auf die Ablage): Browser oeffnet die Datei nicht, Seite bleibt, nichts wird gelesen
    const daneben = await wirf(seite, 'body', [{ name: 'v110.miapack', b64: b64('v110') }]);
    expect(daneben.ueberAbgefangen).toBe(true);
    expect(daneben.dropAbgefangen).toBe(true);
    expect(daneben.effekt).toBe('none'); // neben der Ablage zeigt der Zeiger "nicht hier"
    const linkDaneben = await wirf(seite, 'body', [], 'link');
    expect(linkDaneben.ueberAbgefangen).toBe(true);
    expect(linkDaneben.effekt).toBe('none');
    await seite.waitForTimeout(300);
    expect(seite.url()).toBe(url);
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    console.log('chromium: Ablegen eine Datei angenommen, zwei, keine und fremde Datei abgewiesen, Wurf daneben abgefangen');
  } finally {
    await seite.close();
  }
});

test('Ablegen vor dem Einstieg: derselbe Satz wie beim Dateifeld, nichts wird gelesen', async () => {
  const seite = await oeffne();
  try {
    const alt = await lies(seite, 'einstieg');
    const antwort = await seite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'einstieg-test', zuruecksetzen: true }));
    expect(antwort.ok).toBe(true);
    await seite.reload();
    await expect(seite.locator('#pack-status')).not.toHaveText('');
    await expect(seite.locator('#pack-sperre')).toBeVisible();
    await expect(seite.locator('#datei')).toBeDisabled();
    const vor = await lies(seite, 'pack');
    // Lesezugriffe auf Dateien zaehlen: vor dem Einstieg darf keiner stattfinden
    await seite.evaluate(() => {
      const w = window as any;
      w.__lesen = 0;
      for (const n of ['slice', 'arrayBuffer', 'text', 'stream'] as const) {
        const o = (Blob.prototype as any)[n];
        (Blob.prototype as any)[n] = function (...a: unknown[]) {
          w.__lesen++;
          return o.apply(this, a);
        };
      }
    });
    await wirf(seite, '#ablage', [{ name: 'v110.miapack', b64: b64('v110') }]);
    await expect(seite.locator('#meldung')).toHaveText(TEXT_EINSTIEG_ZUERST);
    expect(await seite.evaluate(() => (window as any).__lesen)).toBe(0);
    console.log('chromium: vor dem Einstieg 0 Lesezugriffe auf die abgelegte Datei');
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    await expect(seite.locator('#fortschritt-zeile')).toBeHidden();
    expect(await lies(seite, 'pack')).toEqual(vor);
    await schreibe(seite, { einstieg: alt ?? EINSTIEG_FERTIG });
  } finally {
    await seite.close();
  }
});

test('Entscheidung 88: veraenderte Pack-Datei (Byte im Datenteil) zeigt den Fehlersatz, nichts gespeichert, altes Pack unveraendert', async () => {
  const seite = await oeffne();
  try {
    await schreibe(seite, { einstieg: EINSTIEG_FERTIG });
    await seite.reload();
    await expect(seite.locator('#pack-status')).toContainText('Pack in place');
    await expect(seite.locator('#datei')).toBeEnabled();
    const packVor = await lies(seite, 'pack');
    const idbVor = await zaehleIdb(seite);
    const einstVor = await lies(seite, 'einstellungen');
    // sowohl ueber das Dateifeld als auch ueber die Ablage
    await seite.locator('#datei').setInputFiles(pfad.kaputt!);
    await expect(seite.locator('#meldung')).toContainText('Nothing was stored');
    await expect(seite.locator('#meldung')).toHaveClass(/fehler/);
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    await expect(seite.locator('#ersetzen-hinweis')).toBeHidden();
    await seite.locator('#meldung').evaluate((e) => (e.textContent = ''));
    await wirf(seite, '#ablage', [{ name: 'kaputt.miapack', b64: b64('kaputt') }]);
    await expect(seite.locator('#meldung')).toContainText('Nothing was stored');
    expect(await lies(seite, 'pack')).toEqual(packVor);
    expect(await zaehleIdb(seite)).toEqual(idbVor);
    expect(await lies(seite, 'einstellungen')).toEqual(einstVor);
    await expect(seite.locator('#pack-version')).toHaveText(packVor.version);
    console.log(`chromium: veraenderte Datei abgelehnt, Pack ${packVor.version} und ${idbVor.dateien} Dateien unveraendert`);
  } finally {
    await seite.close();
  }
});

test('Import-Fehler: Datei nach der Pruefung veraendert, mit vorhandenem Pack: altes Pack samt Meta unveraendert', async () => {
  const seite = await oeffne();
  try {
    const wechselt = path.join(ordner, 'wechselt.miapack');
    await writeFile(wechselt, bytes.v110!);
    const packVor = await lies(seite, 'pack');
    const metaVor = await leseMetaIdb(seite);
    const idbVor = await zaehleIdb(seite);
    const einstVor = await lies(seite, 'einstellungen');
    await seite.locator('#datei').setInputFiles(wechselt);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    await expect(seite.locator('#ersetzen-hinweis')).toContainText('replaces the old one');
    const geaendert = Uint8Array.from(bytes.v110!);
    geaendert[geaendert.length - 5]! ^= 0xff;
    await new Promise((r) => setTimeout(r, 1100));
    await writeFile(wechselt, geaendert);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#meldung')).toContainText('Nothing was stored');
    await expect(seite.locator('#meldung')).toHaveClass(/fehler/);
    expect(await lies(seite, 'pack')).toEqual(packVor);
    expect(await leseMetaIdb(seite)).toEqual(metaVor);
    expect(await zaehleIdb(seite)).toEqual(idbVor);
    expect(await lies(seite, 'einstellungen')).toEqual(einstVor);
    console.log(`chromium: Datei nach der Pruefung veraendert: Pack ${packVor.version}, Meta und ${idbVor.dateien} Dateien unveraendert`);
  } finally {
    await seite.close();
  }
});

test('Wurf und Doppelklick waehrend eines laufenden Imports: Satz "busy", Abbrechen gesperrt, nur ein Import', async () => {
  const seite = await oeffne();
  try {
    await seite.locator('#datei').setInputFiles(pfad.v110!);
    await expect(seite.locator('#lizenz-block')).toBeVisible();
    // Lesezugriffe des Imports verlangsamen und zaehlen (26 Dateien, je 150 ms)
    await seite.evaluate(() => {
      const w = window as any;
      w.__ab = 0;
      const o = Blob.prototype.arrayBuffer;
      // Gezaehlt wird nur der Import selbst: beim ersten Wechsel des Schluessels `pack` (Import fertig) hoert das Zaehlen auf. Danach liest die
      // Seite selbst (Begruessungs-Chibi ueber leseDatei, das die Bytes bei offener Verbindung kopiert) und wuerde sonst mitgezaehlt.
      let zaehlt = true;
      (window as any).chrome.storage.onChanged.addListener((a: Record<string, unknown>) => {
        if ('pack' in a) zaehlt = false;
      });
      Blob.prototype.arrayBuffer = async function () {
        if (!zaehlt) return o.call(this);
        w.__ab++;
        await new Promise((r) => setTimeout(r, 150));
        return o.call(this);
      };
    });
    await seite.locator('#annehmen').dblclick();
    await expect(seite.locator('#abbrechen')).toBeDisabled();
    await expect(seite.locator('#annehmen')).toBeDisabled();
    await expect(seite.locator('#datei')).toBeDisabled();
    await wirf(seite, '#ablage', [{ name: 'v100.miapack', b64: b64('v100') }]);
    await expect(seite.locator('#meldung')).toHaveText(TEXT_BESCHAEFTIGT);
    await expect(seite.locator('#pack-version')).toHaveText('1.1.0', { timeout: 20_000 });
    const zahl = await seite.evaluate(() => (window as any).__ab);
    expect(zahl).toBe(DATEIEN_OHNE_TON);
    expect(await leseMetaIdb(seite)).toEqual({ id: 'dummy', version: '1.1.0', dateienImMeta: DATEIEN_OHNE_TON });
    console.log(`chromium: waehrend des Imports Wurf abgewiesen, Doppelklick: ${zahl} Dateien gelesen (einmal ${DATEIEN_OHNE_TON})`);
  } finally {
    await seite.close();
  }
});

test('360 px Breite: kein waagrechtes Scrollen mit Hinweis und Lizenz-Ansicht', async () => {
  const seite = await oeffne();
  try {
    await seite.setViewportSize({ width: 360, height: 800 });
    await seite.locator('#datei').setInputFiles(pfad.v100!);
    await expect(seite.locator('#ersetzen-hinweis')).toBeVisible();
    await seite.locator('#lizenz-zeigen').click();
    await expect(seite.locator('#lizenz-ansicht')).toBeVisible();
    const m = await seite.evaluate(() => ({ breit: document.documentElement.scrollWidth, innen: document.documentElement.clientWidth }));
    console.log(`chromium: 360 px, scrollWidth ${m.breit}, clientWidth ${m.innen}`);
    expect(m.breit).toBeLessThanOrEqual(m.innen);
  } finally {
    await seite.close();
  }
});
