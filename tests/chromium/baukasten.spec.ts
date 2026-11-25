// Chromium: Oberflaeche des Custom-Baukastens und Schau gesperrter Stile (Phase 11 E6b, S1 bis S6), echte Erweiterung, echte Klicks und Tasten. Das Gegenstueck fuer Firefox
// ist tests/firefox/baukasten.test.mjs (gleiche Faelle). Das Pruefer-Pack ist das Dummy-Pack (Patch-Bilder und Sticker), ueber die Oberflaeche importiert.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD, vervollstaendige } from '../../src/einstellungen';
import { BEISPIELE } from '../../src/beispiel';
import { rechneVorschau } from '../../src/oberflaeche/vorschau/rechnung';
import { mitReitern, reiter } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const MIT_BILDERN = existsSync(path.join(erweiterung, 'beispiel', 'portraet.webp'));

let profil = '';
let ordner = '';
let context: BrowserContext;
let id = '';
const url = (seite: string) => `chrome-extension://${id}/${seite}`;
const lies = (s: Page, k: string | null) => s.evaluate((x) => (globalThis as any).chrome.storage.local.get(x), k);
const schreibe = (s: Page, o: Record<string, unknown>) => s.evaluate((x) => (globalThis as any).chrome.storage.local.set(x), o);
const entferne = (s: Page, k: string[]) => s.evaluate((x) => (globalThis as any).chrome.storage.local.remove(x), k);
const einst = async (s: Page) => (await lies(s, 'einstellungen')).einstellungen;

const FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 };
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
const zonen = (an: string[]) => Object.fromEntries(ALLE.map((n) => [n, BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) }]));
const GESICHT_AN = zonen(['face', 'breast', 'genitals', 'buttocks']);

interface Haken {
  angefordert: string;
  gezeigt: string;
  bild: string;
  offen: boolean;
  stil: string;
  schau: boolean;
}
const haken = (s: Page) =>
  s.evaluate(() => {
    const t = document.querySelector('[data-veil-vorschau]')?.getAttribute('data-veil-vorschau');
    return t ? (JSON.parse(t) as Haken) : null;
  });
const ruht = async (s: Page) => {
  await expect.poll(async () => { const h = await haken(s); return !!h && h.angefordert !== '' && h.gezeigt === h.angefordert; }, { timeout: 60_000 }).toBe(true);
  return (await haken(s))!;
};

// Frischer Stand: Einstieg fertig, Einstellungen, ohne Pack; die Seite zeigt den Reiter "Cover style".
async function oeffneSeite(e: Record<string, unknown> | null, breite = 1400): Promise<Page> {
  const v = await context.newPage();
  await v.goto(url('hilfe.html'));
  await schreibe(v, { einstieg: FERTIG });
  await entferne(v, ['einstellungen', 'pack']);
  if (e) await schreibe(v, { einstellungen: { version: 1, ...e } });
  await v.close();
  const s = mitReitern(await context.newPage());
  await s.setViewportSize({ width: breite, height: 1500 });
  await s.goto(url('options.html'));
  await reiter(s, 'Cover style');
  await expect(s.locator('#preset-karten input').first()).toBeAttached();
  return s;
}
const karte = (s: Page, k: string) => s.locator(`label.preset-karte:has(#preset-${k})`);
const schauKarte = (s: Page, k: string) => s.locator(`.preset-huelle:has(#preset-${k}) .preset-schau`);
const baustein = (s: Page, zeile: string, wert: string) => s.locator(`#baukasten-${zeile} .v-bk-knopf[data-id="${wert}"]`);
const bausteinSchau = (s: Page, zeile: string, wert: string) => s.locator(`#baukasten-${zeile} .v-bk-schau[data-schau="${wert}"]`);
const gewaehlt = (s: Page, zeile: string) => s.locator(`#baukasten-${zeile} .v-bk-knopf[aria-checked="true"]`);

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
// Schluessel, die der Hintergrund von selbst schreibt (N8): im Vergleich des ganzen Speichers ausgenommen; `einstellungen` und alle Pack-Schluessel bleiben darin.
const HINTERGRUND_SCHLUESSEL = ['ledger', 'ledgerMinute', 'steigerung', 'gesichterStand', 'besuchZeitplan', 'besuchZuletzt', 'meldungStand', 'blitzZeitplan'];
const speicherAlles = async (s: Page) => {
  const a = (await lies(s, null)) as Record<string, unknown>;
  for (const k of HINTERGRUND_SCHLUESSEL) delete a[k];
  return a;
};
const FLAECHE_RAND_PX = 4; // schmaler Rand an der Kante der Platzhalterflaeche, der ausgenommen sein darf (N7)
const GLEICH_MAX = 0.005;

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-baukasten-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-baukasten-datei-'));
  context = await chromium.launchPersistentContext(profil, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`] });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});
test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('S1: Karte, Zeilen, Speichern (je Tipp ein Schreiben), Vorschau, Face folgt Zonenwahl und Eye bar, Words nicht bedienbar', async () => {
  const s = await oeffneSeite(null);
  await expect(s.locator('input[name="preset"]')).toHaveCount(13);
  await expect(s.locator('#preset-gruppe-custom')).toHaveText('Your own mix');
  await expect(s.locator('#preset-custom-ort')).toBeHidden();
  await karte(s, 'custom').click();
  await expect.poll(async () => (await einst(s)).preset).toBe('custom');
  expect((await einst(s)).custom).toEqual({ gesicht: 'mosaik', flaeche: 'mosaik', woerter: false });
  await expect(s.locator('#preset-custom-ort')).toBeVisible();
  await expect(s.locator('#stil-hinweis')).toHaveText('You pick the face, the rest and the words. I do it your way.');
  await expect(s.locator('#baukasten-face .v-bk-knopf')).toHaveText(['Nothing', 'Bar', 'My face', 'Sticker', 'Mosaic', 'Blur', 'Black']);
  await expect(s.locator('#baukasten-flaeche .v-bk-knopf')).toHaveText(['Black', 'Mosaic', 'Blur', 'Stickers']);
  await expect(gewaehlt(s, 'face')).toHaveAttribute('data-id', 'nothing');
  await expect(s.locator('#baukasten-face .v-hinweis')).toHaveText('Faces stay open. Face is off in your zones.');
  // Bar und Nothing
  await baustein(s, 'face', 'bar').click();
  await expect.poll(async () => { const e = await einst(s); return e.zonen.face.an === false && e.augenbalken === true; }).toBe(true);
  await expect(s.locator('#augenbalken')).toBeChecked();
  await expect(s.locator('#baukasten-face .v-hinweis')).toHaveText('Just a black bar over the eyes. The rest of the face stays open.');
  await baustein(s, 'face', 'nothing').click();
  await expect.poll(async () => { const e = await einst(s); return e.zonen.face.an === false && e.augenbalken === false; }).toBe(true);
  await expect(s.locator('#augenbalken')).not.toBeChecked();
  // jeder deckende Baustein speichert und aendert die Vorschau
  let vorher = (await ruht(s)).stil;
  for (const [zeile, wert, feld] of [['face', 'schwarz', 'gesicht'], ['face', 'blur', 'gesicht'], ['face', 'mosaik', 'gesicht'], ['flaeche', 'schwarz', 'flaeche'], ['flaeche', 'blur', 'flaeche'], ['flaeche', 'mosaik', 'flaeche']] as const) {
    await baustein(s, zeile, wert).click();
    await expect.poll(async () => (await einst(s)).custom[feld]).toBe(wert);
    const h = await ruht(s);
    const c = (await einst(s)).custom;
    expect(h.stil).toBe(`custom:${c.gesicht}:${c.flaeche}:${c.woerter ? 'w' : '-'}`);
    expect(h.stil).not.toBe(vorher);
    vorher = h.stil;
  }
  expect((await einst(s)).zonen.face.an).toBe(true);
  // Face aus ueber die Zonenwahl: die Zeile zeigt Nothing; Face an: sie zeigt den Baustein
  await reiter(s, 'What I cover');
  await s.locator('#zonen-wahl [data-id="koerper"]').click();
  await expect.poll(async () => (await einst(s)).zonen.face.an).toBe(false);
  await reiter(s, 'Cover style');
  await expect(gewaehlt(s, 'face')).toHaveAttribute('data-id', 'nothing');
  await reiter(s, 'What I cover');
  await s.locator('#zonen-wahl [data-id="koerper-gesicht"]').click();
  await expect.poll(async () => (await einst(s)).zonen.face.an).toBe(true);
  await reiter(s, 'Cover style');
  await expect(gewaehlt(s, 'face')).toHaveAttribute('data-id', 'mosaik');
  // Eye bar bei Face aus: Bar
  await baustein(s, 'face', 'nothing').click();
  await expect.poll(async () => (await einst(s)).zonen.face.an).toBe(false);
  await s.locator('#augenbalken-zeile').click();
  await expect.poll(async () => (await einst(s)).augenbalken).toBe(true);
  await expect(gewaehlt(s, 'face')).toHaveAttribute('data-id', 'bar');
  // Words nicht bedienbar: Flaeche Blur, Gesicht Mosaic, Face aus
  await baustein(s, 'flaeche', 'blur').click();
  await expect.poll(async () => (await einst(s)).custom.flaeche).toBe('blur');
  await expect(s.locator('#baukasten-woerter .v-schalter-knopf')).toHaveAttribute('aria-disabled', 'true');
  await expect(s.locator('#baukasten-woerter .v-hinweis')).toHaveText('Words need Black or Mosaic to sit on.');
  const vorW = JSON.stringify(await einst(s));
  await s.locator('#baukasten-woerter .v-schalter-knopf').click({ force: true }); // aria-disabled: Playwright wartet sonst auf enabled
  await s.waitForTimeout(400);
  expect(JSON.stringify(await einst(s))).toBe(vorW);
  await s.close();
});

test('S2: ohne Pack starten gesperrte Karten und Bausteine die Schau, der Speicher bleibt gleich, jedes Ende beendet sie', async () => {
  test.skip(!MIT_BILDERN, 'Beispielbilder fehlen im Testbau');
  const s = await oeffneSeite({ preset: 'mosaik', zonen: GESICHT_AN });
  await ruht(s);
  for (const k of ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'sticker']) {
    await expect(s.locator(`#preset-${k}`)).toBeDisabled();
    await expect(schauKarte(s, k)).toBeVisible();
  }
  await expect(schauKarte(s, 'mia-wort')).toHaveAttribute('aria-label', 'My face, black, words, comes with my Pack, preview');
  const vor = await speicherAlles(s);
  await schauKarte(s, 'mia-wort').click();
  await expect.poll(async () => { const h = await haken(s); return !!h && h.schau && h.gezeigt === h.angefordert; }, { timeout: 60_000 }).toBe(true);
  expect(await speicherAlles(s)).toEqual(vor);
  await expect(s.locator('#preset-mia-wort')).not.toBeChecked();
  await expect(s.locator('#preset-mosaik')).toBeChecked();
  await expect(s.locator('.vorschau-spalte .v-vorschau-marke')).toHaveText('Pack');
  await expect(s.locator('.vorschau-spalte .v-vorschau-schau')).toHaveText('With my Pack it looks like this. Right now I use Mosaic for you.');
  // N7: in der ganzen Gesichtsflaeche (gedreht, runde Ecken) steht kein Pixel des Beispielbilds, bis auf einen schmalen Rand
  {
    const bb = BEISPIELE.find((x) => x.kennung === 'portraet')!;
    const rr = rechneVorschau({ einstellungen: vervollstaendige({ version: 1, preset: 'mia-wort', zonen: GESICHT_AN }), pack: null, gesichter: null, bild: 'portraet', breite: bb.breite, hoehe: bb.hoehe, schau: true });
    const gesichter = rr.flaechen.filter((f) => f.behandlung === 'mia-gesicht').map((f) => (f.balken ? { mitte: f.balken.mitte, breite: f.balken.breite, hoehe: f.balken.hoehe, winkel: f.balken.winkel } : { mitte: [f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] / 2], breite: f.box[2], hoehe: f.box[3], winkel: 0 }));
    expect(gesichter.length).toBeGreaterThan(0);
    const r = await s.evaluate(async ([flaechen, rand]) => {
      const holen = async (u: string) => createImageBitmap(await (await fetch(u)).blob());
      const kachel = (document.querySelector('.vorschau-spalte .v-vorschau-kachel img') as HTMLImageElement).src;
      const a = await holen(kachel);
      const o = await holen('beispiel/portraet.webp');
      const lies = (bm: ImageBitmap) => { const c = new OffscreenCanvas(a.width, a.height); const g = c.getContext('2d')!; g.drawImage(bm, 0, 0, a.width, a.height); return g.getImageData(0, 0, a.width, a.height).data; };
      const p = lies(a), q = lies(o);
      let n = 0, gleich = 0;
      for (const f of flaechen as { mitte: number[]; breite: number; hoehe: number; winkel: number }[]) {
        const rad = Math.min(f.breite, f.hoehe) * 0.14;
        const m = Math.ceil(Math.hypot(f.breite, f.hoehe) / 2);
        for (let y = Math.max(0, Math.floor(f.mitte[1]! - m)); y < Math.min(a.height, f.mitte[1]! + m); y++) for (let x = Math.max(0, Math.floor(f.mitte[0]! - m)); x < Math.min(a.width, f.mitte[0]! + m); x++) {
          const dx = x + 0.5 - f.mitte[0]!, dy = y + 0.5 - f.mitte[1]!;
          const lx = Math.abs(dx * Math.cos(-f.winkel) - dy * Math.sin(-f.winkel)), ly = Math.abs(dx * Math.sin(-f.winkel) + dy * Math.cos(-f.winkel));
          const hb = f.breite / 2 - (rand as number), hh = f.hoehe / 2 - (rand as number);
          if (lx > hb || ly > hh) continue;
          const qx = lx - (hb - rad), qy = ly - (hh - rad);
          if (qx > 0 && qy > 0 && Math.hypot(qx, qy) > rad) continue;
          const i = (y * a.width + x) * 4; n++;
          if (Math.abs(p[i]! - q[i]!) + Math.abs(p[i + 1]! - q[i + 1]!) + Math.abs(p[i + 2]! - q[i + 2]!) <= 9) gleich++;
        }
      }
      return { n, gleich };
    }, [gesichter, FLAECHE_RAND_PX] as const);
    expect(r.n).toBeGreaterThan(5000);
    expect(r.gleich / r.n, JSON.stringify(r)).toBeLessThanOrEqual(GLEICH_MAX);
  }
  // Marke im Streifen
  await s.setViewportSize({ width: 360, height: 1500 });
  await expect(s.locator('.vorschau-spalte .v-vorschau-marke')).toBeVisible();
  await s.setViewportSize({ width: 1400, height: 1500 });
  // Ende: Back to yours, Fokus zurueck
  await s.locator('.vorschau-spalte .v-vorschau-zurueck').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(false);
  await expect(s.locator('.vorschau-spalte .v-vorschau-marke')).toBeHidden();
  expect(await speicherAlles(s)).toEqual(vor);
  // Ende: freie Karte, Einstellung, freier Baustein
  await schauKarte(s, 'mia-blur').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(true);
  await karte(s, 'blur').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(false);
  // N6: ein Tipp auf die schon gewaehlte freie Karte beendet die Schau auch
  await schauKarte(s, 'mia-wort').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(true);
  await expect(s.locator('#preset-blur')).toBeChecked();
  await karte(s, 'blur').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(false);
  await schauKarte(s, 'sticker').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(true);
  await s.locator('#video-zonen').locator('xpath=ancestor::label').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(false);
  await karte(s, 'custom').click();
  await expect.poll(async () => (await einst(s)).preset).toBe('custom');
  await expect(baustein(s, 'face', 'mia')).toBeDisabled();
  await expect(bausteinSchau(s, 'face', 'mia')).toHaveAttribute('aria-label', 'My face, comes with my Pack, preview');
  const vorB = await speicherAlles(s);
  await bausteinSchau(s, 'face', 'mia').click();
  await expect.poll(async () => { const h = await haken(s); return !!h && h.schau && h.gezeigt === h.angefordert; }, { timeout: 60_000 }).toBe(true);
  expect(await speicherAlles(s)).toEqual(vorB);
  await expect(s.locator('.vorschau-spalte .v-vorschau-schau')).toHaveText('With my Pack it looks like this. Right now that part is Mosaic.');
  await baustein(s, 'flaeche', 'schwarz').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(false);
  // Neuladen
  await bausteinSchau(s, 'face', 'mia').click();
  await expect.poll(async () => (await haken(s))?.schau).toBe(true);
  await s.reload();
  await ruht(s);
  expect((await haken(s))!.schau).toBe(false);
  await s.close();
});

test('S2: ein gespeicherter, gesperrter Baustein steht gewaehlt und gesperrt da, mit dem einen Satz; es gilt Mosaik', async () => {
  const s = await oeffneSeite({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } });
  await expect(gewaehlt(s, 'face')).toHaveAttribute('data-id', 'mia');
  await expect(gewaehlt(s, 'flaeche')).toHaveAttribute('data-id', 'sticker');
  await expect(baustein(s, 'face', 'mia')).toBeDisabled();
  await expect(s.locator('#baukasten-face .v-hinweis')).toHaveText('Part of your mix needs my Pack. That part is Mosaic for now.');
  expect((await einst(s)).custom.gesicht).toBe('mia');
  if (MIT_BILDERN) expect((await ruht(s)).stil.startsWith('custom:mosaik:mosaik')).toBe(true);
  await s.close();
});

test('S3: mit dem Pruefer-Pack gibt es keine Sperre und keine Schau, My face und Stickers sind speicherbar', async () => {
  const bauModul = '../../scripts/pack/baue-pack.mjs';
  const bau = (await import(bauModul)) as { baueDummyPack(o?: Record<string, unknown>): Promise<{ bytes: Uint8Array }> };
  const datei = path.join(ordner, 'dummy.miapack');
  await writeFile(datei, (await bau.baueDummyPack()).bytes);
  const i = mitReitern(await context.newPage());
  await i.goto(url('options.html'));
  await i.locator('#datei').setInputFiles(datei);
  await i.locator('#annehmen').click();
  await expect(i.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
  await i.close();
  const v = await context.newPage();
  await v.goto(url('hilfe.html'));
  await entferne(v, ['einstellungen']);
  await schreibe(v, { einstellungen: { version: 1, preset: 'mosaik', zonen: GESICHT_AN } });
  await v.close();
  const s = mitReitern(await context.newPage());
  await s.setViewportSize({ width: 1400, height: 1500 });
  await s.goto(url('options.html'));
  await reiter(s, 'Cover style');
  await expect(s.locator('.preset-schau:visible')).toHaveCount(0);
  await karte(s, 'custom').click();
  await expect.poll(async () => (await einst(s)).preset).toBe('custom');
  await expect(s.locator('#preset-custom-ort button:disabled')).toHaveCount(0);
  await baustein(s, 'face', 'mia').click();
  await baustein(s, 'flaeche', 'sticker').click();
  await expect.poll(async () => { const c = (await einst(s)).custom; return c.gesicht === 'mia' && c.flaeche === 'sticker'; }).toBe(true);
  expect((await einst(s)).zonen.face.an).toBe(true);
  if (MIT_BILDERN) {
    const h = await ruht(s);
    expect(h.schau).toBe(false);
    expect(h.stil).toBe('custom:mia:sticker:-');
  }
  await expect(s.locator('.vorschau-spalte .v-vorschau-marke')).toBeHidden();
  // das Pack wieder entfernen (der Rest laeuft ohne Pack)
  await s.goto(url('options.html'));
  await s.locator('#entfernen').click();
  await s.locator('#entfernen-ja').click();
  await expect(s.locator('#pack-status')).toContainText('No pack yet');
  await s.close();
});

for (const breite of [320, 360, 412]) {
  test(`S4: Handy ${breite} px mit aufgeklapptem Baukasten (und laufender Schau): kein waagerechtes Scrollen, Trefferflaechen 44 px`, async () => {
    for (const mitSchau of [false, true]) {
      if (mitSchau && !MIT_BILDERN) continue;
      const s = await oeffneSeite({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mia', flaeche: 'sticker', woerter: true } }, breite);
      await expect(s.locator('#baukasten-face .v-bk-knopf').first()).toBeVisible();
      if (mitSchau) {
        await bausteinSchau(s, 'face', 'mia').click();
        await expect.poll(async () => { const h = await haken(s); return !!h && h.schau && h.gezeigt === h.angefordert; }, { timeout: 60_000 }).toBe(true);
      }
      const m = await s.evaluate(() => {
        const klein: string[] = [];
        for (const e of document.querySelectorAll('#preset-custom-ort button:not([hidden]), #preset-custom-ort [role=switch], .v-vorschau-zurueck')) {
          const r = e.getBoundingClientRect();
          if (r.width && r.height && (r.width < 43.5 || r.height < 43.5)) klein.push(`${e.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return { innen: innerWidth, dokument: document.documentElement.scrollWidth, klein };
      });
      expect(m.dokument, `Dokument ${m.dokument} gegen Fenster ${m.innen}`).toBeLessThanOrEqual(m.innen);
      expect(m.klein, m.klein.join('; ')).toEqual([]);
      await s.close();
    }
  });
}

test('S5: Interview ohne Karte Custom, mit der Zeile, Schau gesperrter Karten laeuft auch dort', async () => {
  test.skip(!MIT_BILDERN, 'Beispielbilder fehlen im Testbau');
  const v = await context.newPage();
  await v.goto(url('hilfe.html'));
  await schreibe(v, { einstieg: FERTIG });
  await entferne(v, ['einstellungen', 'pack']);
  await schreibe(v, { einstellungen: { version: 1, preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } } });
  const w = mitReitern(await context.newPage());
  await w.setViewportSize({ width: 1280, height: 900 });
  await w.goto(url('willkommen.html#interview'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  await w.locator('#iv-weiter').click();
  await w.locator('#iv-weiter').click();
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-3');
  await expect(w.locator('input[name="iv-preset"]')).toHaveCount(12);
  await expect(w.locator('#iv-preset-custom')).toHaveCount(0);
  await expect(w.locator('input[name="iv-preset"]:checked')).toHaveCount(0);
  await expect(w.locator('#iv-stil-custom')).toHaveText('Your own mix is on. You change it in the settings.');
  const vor = await speicherAlles(v);
  await w.locator('.preset-huelle:has(#iv-preset-mia-wort) .preset-schau').click();
  await expect.poll(async () => { const h = await haken(w); return !!h && h.schau && h.gezeigt === h.angefordert; }, { timeout: 60_000 }).toBe(true);
  expect(await speicherAlles(v)).toEqual(vor);
  await expect(w.locator('.iv-vorschau .v-vorschau-marke')).toHaveText('Pack');
  await w.locator('label:has(#iv-preset-blur)').click();
  await expect.poll(async () => (await einst(v)).preset).toBe('blur');
  await expect.poll(async () => (await haken(w))?.schau).toBe(false);
  await expect(w.locator('#iv-stil-custom')).toBeHidden();
  await w.close();
  await v.close();
});

test('S6: Tastatur und Namen: Radiogruppen mit Namen, Pfeile bewegen nur den Fokus, das Bedienelement der Schau ist erreichbar, der Fokus kehrt zurueck', async () => {
  const s = await oeffneSeite({ preset: 'custom', zonen: GESICHT_AN, custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } });
  for (const zeile of ['face', 'flaeche']) {
    const g = s.locator(`#baukasten-${zeile} [role=radiogroup]`);
    await expect(g).toHaveAttribute('aria-labelledby', /.+/);
    const n = await g.getAttribute('aria-labelledby');
    expect((await s.locator(`#${n}`).textContent())!.length).toBeGreaterThan(0);
  }
  await baustein(s, 'face', 'mosaik').focus();
  await s.keyboard.press('ArrowRight');
  expect(await s.evaluate(() => (document.activeElement as HTMLElement).dataset.id)).toBe('blur');
  expect((await einst(s)).custom.gesicht).toBe('mosaik');
  await s.keyboard.press('Space');
  await expect.poll(async () => (await einst(s)).custom.gesicht).toBe('blur');
  if (MIT_BILDERN) {
    await bausteinSchau(s, 'face', 'mia').focus();
    await s.keyboard.press('Enter');
    await expect.poll(async () => (await haken(s))?.schau).toBe(true);
    await s.locator('.vorschau-spalte .v-vorschau-zurueck').focus();
    await s.keyboard.press('Enter');
    await expect.poll(async () => (await haken(s))?.schau).toBe(false);
    expect(await s.evaluate(() => (document.activeElement as HTMLElement).dataset.schau)).toBe('mia');
  }
  await s.close();
  expect(STANDARD.preset).toBe('mosaik');
});
