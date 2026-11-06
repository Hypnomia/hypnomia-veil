// Chromium-Abnahme des echten Mia Packs (Phase 7, Session 13). Laeuft nur mit VEIL_ECHTES_PACK=<pfad zur .miapack> (Pfad nie in Dateien
// schreiben; das Pack liegt ausserhalb des Repos), sonst uebersprungen. Prueft Import, Freischaltungen, Dateien, Vorschau-Wahl je Stufe und
// Format nur aus erlaubten Stufen, Werbung je Format, Pack-Chibi und Klaenge. Gegenstueck: tests/firefox/echtes-pack.test.mjs.
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const ECHT = process.env.VEIL_ECHTES_PACK ? path.resolve(process.env.VEIL_ECHTES_PACK) : '';

test.describe.configure({ mode: 'serial' });
test.skip(!ECHT, 'VEIL_ECHTES_PACK nicht gesetzt');

let profil: string;
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
const ERLAUBT: Record<string, string[]> = { tease: ['tease'], hot: ['tease', 'hot'], explicit: ['tease', 'hot', 'explicit'] };
const stufeAusName = (n: string) => /^vorschau\/(tease|hot|explicit)-/.exec(n)?.[1] ?? '?';

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-echt-'));
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
});

test('echtes Pack: Import, Freischaltungen, Dateien', async () => {
  test.setTimeout(120_000);
  const s = await context.newPage();
  await s.goto(optionsUrl());
  const t0 = Date.now();
  await s.locator('#datei').setInputFiles(ECHT);
  await s.locator('#annehmen').click();
  await expect(s.locator('#meldung')).toContainText('The pack is in', { timeout: 60_000 });
  console.log(`chromium echt: Import in ${Date.now() - t0} ms`);
  const m = await s.evaluate(
    () =>
      new Promise<any>((ok, fehl) => {
        const a = indexedDB.open('veil-pack', 1);
        a.onerror = () => fehl(a.error);
        a.onsuccess = () => {
          const db = a.result;
          const tx = db.transaction(['meta', 'dateien'], 'readonly');
          const mm = tx.objectStore('meta').get('aktiv');
          const z = tx.objectStore('dateien').count();
          tx.oncomplete = () => {
            const meta = mm.result;
            db.close();
            const rollen: Record<string, number> = {};
            for (const d of meta?.dateien ?? []) {
              const k = (d.rolle ?? '-') + (d.stufe ? ':' + d.stufe : '');
              rollen[k] = (rollen[k] ?? 0) + 1;
            }
            ok({ id: meta?.id, version: meta?.version, frei: meta?.freischaltungen ?? [], dateien: meta?.dateien?.length ?? 0, gespeichert: z.result, rollen });
          };
        };
      }),
  );
  console.log(`chromium echt: ${m.id} ${m.version}, ${m.frei.length} Freischaltungen, ${m.dateien} Eintraege, ${m.gespeichert} gespeichert, ${JSON.stringify(m.rollen)}`);
  expect(m.frei.length).toBe(17);
  expect(m.dateien).toBeGreaterThan(150);
  expect(m.gespeichert).toBe(m.dateien);
  expect(m.rollen.ton).toBe(5);
  await s.close();
});

test('echtes Pack: Vorschau nie schaerfer als die Stufe, 16:9 bekommt Querbilder; Werbung je Format; Pack-Chibi', async () => {
  test.setTimeout(180_000);
  await expect
    .poll(async () => ((await ausWorker({ ziel: 'erkenner', typ: 'wecke' }).catch(() => null)) as any)?.ok === true, { timeout: 30_000 })
    .toBe(true);
  for (const stufe of ['tease', 'hot', 'explicit']) {
    const gesehen = new Set<string>();
    let quer = 0;
    for (let i = 0; i < 30; i++) {
      const [b, h] = i % 3 === 0 ? [9, 16] : [16, 9];
      const a = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: `echt-${stufe}-${i}`, breite: b, hoehe: h, stufe });
      expect(a?.ok, `${stufe} ${i}: ${a?.fehler}`).toBe(true);
      const s = stufeAusName(a.name);
      gesehen.add(s);
      expect(ERLAUBT[stufe], `${stufe} zeigt ${a.name}`).toContain(s);
      if (b === 16 && a.breite / a.hoehe >= 1.2) quer++;
    }
    console.log(`chromium echt: Stufe ${stufe}: gesehen ${[...gesehen].join('/')}, Querbilder fuer 16:9 ${quer} von 20`);
    expect(quer).toBe(20);
    expect(gesehen.has(stufe)).toBe(true);
  }
  for (const format of ['300x250', '336x280', '728x90', '468x60', '160x600', '300x600', '320x50', '320x100', '970x250']) {
    const a = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'werbung', schluessel: `w-${format}`, format });
    expect(a?.ok && String(a.name).includes(`-${format}-`), `Werbung ${format}: ${a?.name}`).toBe(true);
  }
  // Die Pose thron gibt es nur im Pack (die Demo hat schild, sprechblase, arme, nein, jubeln, schmollen)
  const c = await ausWorker({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'thron' });
  expect(c?.ok && c.name === 'chibi/thron.webp').toBe(true);
});
