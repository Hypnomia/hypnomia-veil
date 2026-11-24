// Chromium: Live-Vorschau mit Beispielbildern (Phase 11 E5, V1 bis V13). Die Vorschau der Einstellungsseite muss Pixel fuer Pixel das Bild zeigen, das `pruefe` mit
// `rendern: true` fuer dieselbe Quelle liefert (V2, Gleichheit heisst gleich, keine Toleranz). Die Vorschau rechnet mit den abgelegten Treffern (data/beispiel-treffer.json),
// `pruefe` mit dem echten Erkenner. Die Beispielbilder kommen aus dem Testbau (`beispiel/`); fehlen sie dort, wird der Test laut uebersprungen, nie still.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BEISPIELE } from '../../src/beispiel';
import { STANDARD, vervollstaendige } from '../../src/einstellungen';
import { hashe } from '../../src/pack/hash';
import { rahmenBreite } from '../../src/erkenner/stile';
import { stickerRechteck } from '../../src/sticker';
import { presetDef } from '../../src/preset-def';
import { PRESET_IDS } from '../../src/presets';
import { mitReitern } from './einstellungen-ordnung';
import { VORSCHAU_ALT_OFFEN, VORSCHAU_HINWEIS, VORSCHAU_KACHEL, VORSCHAU_NICHTS, VORSCHAU_PUNKTE_LABEL, VORSCHAU_PUNKT_NAMEN, vorschauAlt } from '../../src/oberflaeche/gemeinsam';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const BILDER = BEISPIELE.map((b) => b.kennung);
const MIT_BILDERN = BILDER.every((k) => existsSync(path.join(erweiterung, 'beispiel', `${k}.webp`)));

let profil = '';
let ordner = '';
let context: BrowserContext;
let worker: Worker;
let erweiterungsId = '';
const optionsUrl = () => `chrome-extension://${erweiterungsId}/options.html`;
const ausWorker = (n: unknown): Promise<any> => worker.evaluate((m) => (globalThis as any).chrome.runtime.sendMessage(m), n);
const schreibeSpeicher = (seite: Page, o: Record<string, unknown>) => seite.evaluate((x) => (globalThis as any).chrome.storage.local.set(x), o);
const leseSpeicher = (seite: Page, k: string | null) => seite.evaluate((x) => (globalThis as any).chrome.storage.local.get(x), k);
const entferneSpeicher = (seite: Page, k: string[]) => seite.evaluate((x) => (globalThis as any).chrome.storage.local.remove(x), k);

const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
const GESICHT = ['eyes', 'mouth', 'face', 'head'];
function zonenNur(an: string[], bedeckt = true): Record<string, { an: boolean; bedeckt?: boolean }> {
  const z: Record<string, { an: boolean; bedeckt?: boolean }> = {};
  for (const n of ALLE) z[n] = BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt } : { an: an.includes(n) };
  return z;
}
const ZONEN_ALLE = zonenNur(ALLE);
const ZONEN_OHNE_GESICHT = zonenNur(ALLE.filter((z) => !GESICHT.includes(z)));

// Beispielbilder aus dem Testbau als Quelle, so wie ein Seitenbild beim Erkenner ankommt (Data-Adresse, Kennung `daten:<laenge>:<hash>`).
const dataUrl = (k: string): string => `data:image/webp;base64,${readFileSync(path.join(erweiterung, 'beispiel', `${k}.webp`)).toString('base64')}`;
const kennungVon = (k: string): string => {
  const d = dataUrl(k);
  return `daten:${d.length}:${hashe(d)}`;
};

interface Haken {
  angefordert: string;
  gezeigt: string;
  anzahl: number;
  bild: string;
  offen: boolean;
  stil: string;
}
const haken = (seite: Page): Promise<Haken | null> =>
  seite.evaluate(() => {
    const t = document.querySelector('[data-veil-vorschau]')?.getAttribute('data-veil-vorschau');
    return t ? (JSON.parse(t) as Haken) : null;
  });
const kachelBild = (seite: Page) => seite.locator('.vorschau-spalte .v-vorschau-kachel img');
const punkt = (seite: Page, k: string) => seite.locator(`.vorschau-spalte .v-vorschau-punkte [data-bild="${k}"]`);

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

async function importiere(bytes: Uint8Array, name: string): Promise<void> {
  const pfad = path.join(ordner, name);
  await writeFile(pfad, bytes);
  const seite = mitReitern(await context.newPage());
  try {
    await seite.goto(optionsUrl());
    await seite.locator('#datei').setInputFiles(pfad);
    await seite.locator('#annehmen').click();
    await expect(seite.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
  } finally {
    await seite.close();
  }
}
async function entfernePack(): Promise<void> {
  const seite = mitReitern(await context.newPage());
  try {
    await seite.goto(optionsUrl());
    // Ohne gespeichertes Pack gibt es nichts zu entfernen (kein Weg ueber die Oberflaeche noetig).
    if (!(await leseSpeicher(seite, 'pack')).pack) return;
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#pack-status')).toContainText('No pack yet');
  } finally {
    await seite.close();
  }
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
async function baueDummy(opts: Record<string, unknown> = {}): Promise<{ bytes: Uint8Array }> {
  const bau = (await import(bauModul)) as { baueDummyPack(o?: Record<string, unknown>): Promise<{ bytes: Uint8Array }> };
  return bau.baueDummyPack(opts);
}

// Schreibt die gespeicherten Einstellungen (ersetzt den alten Stand ganz; Standardwerte fuellt `vervollstaendige` beim Lesen).
async function speichere(einstRoh: Record<string, unknown>): Promise<void> {
  const h = await context.newPage();
  try {
    await h.goto(optionsUrl());
    await schreibeSpeicher(h, { einstellungen: { version: 1, ...einstRoh } });
  } finally {
    await h.close();
  }
}
const ALLES_ZU = { preset: 'mosaik', zonen: ZONEN_ALLE };

// Die Pruefung des Erkenners wie der Schleier sie schickt (pruefung.ts sendePruefe): aufgeloestes Preset, Zonen, Rand, Schwelle, Eye bar, Themen, Pack-Stand.
function echteNachricht(k: string, einstRoh: Record<string, unknown>, pack: { importiert: number } | null) {
  const e = vervollstaendige(einstRoh);
  const gilt = presetDef(e, pack as never).gilt;
  const nutztPack = gilt.braucht !== null || gilt.woerter;
  const b = BEISPIELE.find((x) => x.kennung === k)!;
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `vorschau-${k}-${Math.random().toString(36).slice(2, 7)}`,
    quelle: { art: 'daten', dataUrl: dataUrl(k) },
    breite: b.breite,
    hoehe: b.hoehe,
    einstellungen: {
      schwelle: e.schwelle,
      zonen: e.zonen,
      rand: e.rand,
      preset: gilt.id,
      ...(e.augenbalken ? { augenbalken: true } : {}),
      ...(e.woerterThemen === null ? {} : { woerterThemen: e.woerterThemen }),
      ...(nutztPack ? { packStand: pack?.importiert ?? 0 } : {}),
    },
    rendern: true,
    verschmelzen: true,
  };
}

type Rechteck = [number, number, number, number];
// Die Zielrechtecke, in die ein Pack-Bitmap gezeichnet wird, aus dem Plan der Flaechen (die Flaechen der echten Antwort sind die der Vorschau, V1): Mias Gesicht
// in der Box der Flaeche, ein Sticker (auch als Ersatz fuer Mias Gesicht) in seinem Rechteck nach `stickerRechteck` (hier als Quadrat mit der laengsten Seite, das jedes
// Seitenverhaeltnis enthaelt). Je 2 px Rand ausserdem; beim Gesicht dazu die Rahmenbreite (der Rahmen liegt innen).
// 2 px Rand (Leitung) und 1 px fuer die Rundung der Gleitkomma-Rechtecke (gemessen: einzelne Randpixel mit Differenz hoechstens 3 liegen sonst 1 px daneben).
const RAND = 3;
function bitmapRechtecke(flaechen: { box: Rechteck; wortBox?: Rechteck | null; behandlung?: string; ersatz?: string }[]): Rechteck[] {
  const aus: Rechteck[] = [];
  // Das Ergebnis ist ein JPEG: ein geaenderter Pixel veraendert durch die Quantisierung seinen ganzen Block (8 x 8, mit Farbunterabtastung 16 x 16). Die Rechtecke werden
  // darum auf das 16er Raster erweitert (gemessen: sonst liegen einzelne Pixel am Rand ausserhalb).
  const blaehe = (r: Rechteck, m: number): Rechteck => {
    const x0 = Math.floor((r[0] - m) / 16) * 16;
    const y0 = Math.floor((r[1] - m) / 16) * 16;
    const x1 = Math.ceil((r[0] + r[2] + m) / 16) * 16;
    const y1 = Math.ceil((r[1] + r[3] + m) / 16) * 16;
    // plus 1 px: das Dekodieren der Farbunterabtastung mischt die Nachbarblocke ein Pixel weit ein (gemessen: Randpixel mit Differenz hoechstens 3 im Abstand 1)
    return [x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2];
  };
  for (const f of flaechen) {
    if (f.behandlung === 'mia-gesicht') aus.push(blaehe(f.box, RAND + rahmenBreite(f.box[2], f.box[3])));
    if (f.behandlung === 'sticker' || (f.behandlung === 'mia-gesicht' && f.ersatz === 'sticker')) {
      const zb = (f.wortBox === undefined ? f.box : f.wortBox) ?? f.box;
      const r = stickerRechteck(zb, 1, 1, rahmenBreite(zb[2], zb[3]));
      if (r) aus.push(blaehe(r, RAND));
    }
  }
  return aus;
}
interface Messung {
  max: number; // groesste Kanalabweichung
  anders: number; // abweichende Pixel
  draussen: number; // davon ausserhalb aller Bitmap-Rechtecke
  anteil: number; // abweichende Pixel durch alle Pixel
  text: string;
}
const dekodiert = async (u: string) => sharp(Buffer.from(u.slice(u.indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
// Unterschied zweier Bilder mit Zahlen innerhalb und ausserhalb der Bitmap-Rechtecke.
async function messe(a: string, b: string, rechtecke: Rechteck[]): Promise<Messung> {
  const [x, y] = await Promise.all([dekodiert(a), dekodiert(b)]);
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) return { max: 255, anders: Infinity, draussen: Infinity, anteil: 1, text: `Masse ${x.info.width}x${x.info.height} gegen ${y.info.width}x${y.info.height}` };
  const B = x.info.width;
  let max = 0, anders = 0, draussen = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, ox0 = Infinity, oy0 = Infinity, ox1 = -1, oy1 = -1, maxAbstand = 0, maxAussen = 0;
  for (let i = 0; i < x.data.length; i += 3) {
    const d = Math.max(Math.abs(x.data[i]! - y.data[i]!), Math.abs(x.data[i + 1]! - y.data[i + 1]!), Math.abs(x.data[i + 2]! - y.data[i + 2]!));
    if (d === 0) continue;
    anders++;
    const px = (i / 3) % B;
    const py = Math.floor(i / 3 / B);
    if (!rechtecke.some(([rx, ry, rw, rh]) => px >= rx && px < rx + rw && py >= ry && py < ry + rh)) {
      draussen++;
      const abstand = Math.min(...rechtecke.map(([rx, ry, rw, rh]) => Math.max(rx - px, px - (rx + rw - 1), ry - py, py - (ry + rh - 1))));
      maxAbstand = Math.max(maxAbstand, abstand);
      maxAussen = Math.max(maxAussen, d);
      ox0 = Math.min(ox0, px); ox1 = Math.max(ox1, px); oy0 = Math.min(oy0, py); oy1 = Math.max(oy1, py);
    }
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    if (d > max) max = d;
  }
  const alle = x.data.length / 3;
  return { max, anders, draussen, anteil: anders / alle, text: `groesste Differenz ${max}, ${anders} Pixel abweichend (${((anders / alle) * 100).toFixed(4)} %), davon ${draussen} ausserhalb der Bitmap-Rechtecke${draussen ? ` (x ${ox0}-${ox1} y ${oy0}-${oy1}; groesster Abstand zum naechsten Rechteck ${maxAbstand} px, groesste Differenz dort ${maxAussen}; Rechtecke ${JSON.stringify(rechtecke.map((r) => r.map(Math.round)))})` : ''}, Bereich x ${x0}-${x1} y ${y0}-${y1}` };
}
const unterschied = async (a: string, b: string, r: Rechteck[] = []): Promise<string> => (await messe(a, b, r)).text;

// Die Antwort von `pruefe` als stabile Antwort (R3): zwei aufeinanderfolgende gleiche Antworten, hoechstens 3 Versuche. Weicht die erste von der stabilen ab, wird die
// Abweichung gezaehlt und ausgegeben (nie versteckt).
const ersteAbweichungen: string[] = [];
async function stabileAntwort(k: string, einstRoh: Record<string, unknown>, pack: { importiert: number } | null, etikett: string): Promise<any> {
  const a1 = await ausWorker(echteNachricht(k, einstRoh, pack));
  if (!a1?.ok) return a1;
  let vorige = a1;
  for (let versuch = 2; versuch <= 3; versuch++) {
    const n = await ausWorker(echteNachricht(k, einstRoh, pack));
    if (n?.bild === vorige.bild) {
      if (versuch > 2 || a1.bild !== n.bild) {
        if (a1.bild !== n.bild) ersteAbweichungen.push(`${etikett} ${k}: erste Antwort weicht von der stabilen ab: ${n.bild && a1.bild ? await unterschied(a1.bild, n.bild, bitmapRechtecke(n.flaechen ?? [])) : 'ohne Bild'}`);
      }
      return n;
    }
    vorige = n;
  }
  ersteAbweichungen.push(`${etikett} ${k}: keine zwei gleichen Antworten in 3 Versuchen`);
  return vorige;
}

// Wartet, bis die Vorschau das Bild `k` mit dieser Kennung gezeigt hat (angefordert gleich gezeigt, Schluessel beginnt mit dem Bild und endet mit der Kennung).
async function warteBis(seite: Page, k: string, kennung: string, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const h = await haken(seite);
        return !!h && h.gezeigt === h.angefordert && h.gezeigt.startsWith(`["${k}"`) && h.gezeigt.endsWith(`${JSON.stringify(kennung)}]`);
      },
      { timeout, intervals: [50] },
    )
    .toBe(true);
}

// Toleranz fuer Vergleiche mit Pack (R1, Leitung): gemessene Hoechstwerte stehen im Kopf von `V2 mit Dummy-Pack`.
const TOLERANZ_KANAL = 48;
const TOLERANZ_ANTEIL = 0.03;
const toleriert: Messung[] = [];
// Mittlere Kanalabweichung des gezeigten Bildes gegen das Beispielbild aus dem Bau (fuer das offene Bild: nur die JPEG-Kodierung darf abweichen).
async function mittlereAbweichung(url: string, k: string): Promise<number> {
  const a = await dekodiert(url);
  const b = await sharp(readFileSync(path.join(erweiterung, 'beispiel', `${k}.webp`))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return 255;
  let summe = 0;
  for (let i = 0; i < a.data.length; i++) summe += Math.abs(a.data[i]! - b.data[i]!);
  return summe / a.data.length;
}
let mitBildZaehler = 0; // Vergleiche, in denen beide ein Bild lieferten
let ohneBildZaehler = 0; // Vergleiche, in denen pruefe kein Bild liefert (keine Flaeche) und die Vorschau auch keins zeigt
// Oeffnet die Einstellungsseite mit diesen gespeicherten Einstellungen und vergleicht je Beispielbild die Vorschau mit der Antwort von `pruefe`.
// Liefert die Abweichungen (leer = Pixel fuer Pixel gleich) und, wo `pruefe` kein Bild liefert, den Befund der Vorschau.
async function vergleiche(etikett: string, einstRoh: Record<string, unknown>, pack: { importiert: number } | null, bilder: readonly string[] = BILDER): Promise<string[]> {
  if (process.env.VEIL_VORSCHAU_LAUT) console.log(`chromium: Vergleich ${etikett}`);
  const hilf = await context.newPage();
  const abweichungen: string[] = [];
  const seite = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, ...einstRoh } });
    await seite.goto(optionsUrl());
    for (const k of bilder) {
      const kennung = kennungVon(k);
      await seite.evaluate((x) => document.documentElement.setAttribute('data-veil-vorschau-kennung', x), kennung);
      await punkt(seite, k).click();
      await warteBis(seite, k, kennung);
      const echt = pack ? await stabileAntwort(k, { version: 1, ...einstRoh }, pack, etikett) : await ausWorker(echteNachricht(k, { version: 1, ...einstRoh }, pack));
      if (!echt?.ok) {
        abweichungen.push(`${etikett} ${k}: pruefe ohne Antwort: ${JSON.stringify(echt)}`);
        continue;
      }
      let zuletzt = '';
      let gleich = false;
      const bis = Date.now() + 9000; // Mias Gesicht: die Ablage der Gesichtssuche wird kurz nach der Meldung lesbar, die Vorschau liest nach
      while (Date.now() < bis) {
        zuletzt = (await kachelBild(seite).count()) > 0 ? ((await kachelBild(seite).getAttribute('src')) ?? '') : '';
        // Ohne Flaeche liefert `pruefe` kein Bild; die Vorschau zeigt dann das offene Bild (N1): gemeldet als `offen`, als Data-Adresse und dem Beispielbild gleich (JPEG).
        const keineFlaeche = echt.bild === undefined && zuletzt.startsWith('data:image/') && (await haken(seite))?.offen === true && (await mittlereAbweichung(zuletzt, k)) < 4;
        if (echt.bild === undefined ? keineFlaeche : zuletzt === echt.bild) {
          gleich = true;
          if (echt.bild === undefined) ohneBildZaehler++;
          else mitBildZaehler++;
          break;
        }
        // R1 (nur mit Pack): nur die Rasterung der Pack-Bitmaps darf abweichen, nie die Wahl: ausserhalb der Bitmap-Rechtecke byteweise gleich, innerhalb hoechstens
        // TOLERANZ_KANAL Kanalabweichung und hoechstens TOLERANZ_ANTEIL der Bildpixel abweichend. Mit VEIL_SONDE=1 gibt es keine Toleranz, nur Messwerte.
        if (pack && echt.bild !== undefined && zuletzt !== '' && !process.env.VEIL_SONDE) {
          const m = await messe(zuletzt, echt.bild, bitmapRechtecke(echt.flaechen ?? []));
          if (m.draussen === 0 && m.max <= TOLERANZ_KANAL && m.anteil <= TOLERANZ_ANTEIL) {
            gleich = true;
            toleriert.push(m);
            break;
          }
        }
        await seite.waitForTimeout(300);
      }
      if (process.env.VEIL_VORSCHAU_LAUT && zuletzt && echt.bild && k === 'vorn') await writeFile(path.join(process.env.VEIL_VORSCHAU_LAUT, `alle-${etikett.replace(/\W+/g, '_')}-${k}-echt.jpg`), Buffer.from(echt.bild.slice(echt.bild.indexOf(',') + 1), 'base64'));
      if (!gleich) {
        if (process.env.VEIL_VORSCHAU_LAUT && zuletzt && echt.bild) {
          await writeFile(path.join(process.env.VEIL_VORSCHAU_LAUT!, `abw-${etikett.replace(/\W+/g, '_')}-${k}-vorschau.jpg`), Buffer.from(zuletzt.slice(zuletzt.indexOf(',') + 1), 'base64'));
          await writeFile(path.join(process.env.VEIL_VORSCHAU_LAUT!, `abw-${etikett.replace(/\W+/g, '_')}-${k}-echt.jpg`), Buffer.from(echt.bild.slice(echt.bild.indexOf(',') + 1), 'base64'));
          console.log(`chromium: Flaechen ${etikett} ${k}: ${JSON.stringify(echt.flaechen)}`);
          const echt2 = await ausWorker(echteNachricht(k, { version: 1, ...einstRoh }, pack));
          console.log(`chromium: ${etikett} ${k}: pruefe zweimal gleich: ${echt2.bild === echt.bild}, Vorschau erneut gleich der ersten: ${((await kachelBild(seite).getAttribute('src')) ?? '') === zuletzt}`);
        }
        abweichungen.push(
          `${etikett} ${k}: ${echt.bild === undefined ? `pruefe liefert kein Bild (${echt.flaechen?.length ?? '?'} Flaechen), die Vorschau zeigt nicht das offene Bild mit Meldung offen` : zuletzt === '' ? 'die Vorschau zeigt kein Bild' : await unterschied(zuletzt, echt.bild, bitmapRechtecke(echt.flaechen ?? []))} (Treffer echt ${echt.treffer?.length})`,
        );
      }
    }
  } finally {
    await seite.close();
    await hilf.close();
  }
  return abweichungen;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-vorschau-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-vorschau-datei-'));
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

test.beforeEach(() => {
  if (!MIT_BILDERN) {
    console.log('chromium: AUSNAHME: die Beispielbilder fehlen im Testbau (beispiel/), die Vorschau-Tests werden uebersprungen');
    test.skip(true, 'Beispielbilder fehlen im Testbau');
  }
});

// ---------- V2: Gleichheit ----------

test('V2 ohne Pack: alle zwoelf Presets mal Eye bar aus und an mal vier Bilder, Standard-Zonen: Vorschau gleich Antwort von pruefe', async () => {
  test.setTimeout(900_000);
  await entfernePack();
  const alle: string[] = [];
  let n = 0;
  for (const preset of PRESET_IDS) {
    for (const augenbalken of [false, true]) {
      const a = await vergleiche(`${preset} Eye bar ${augenbalken ? 'an' : 'aus'}`, { preset, augenbalken }, null);
      n += BILDER.length;
      alle.push(...a);
    }
  }
  console.log(`chromium: V2 ohne Pack: ${n} Vergleiche (mit Bild ${mitBildZaehler}, ohne Flaeche ${ohneBildZaehler} seit Start), ${alle.length} Abweichungen${alle.length ? `\n${alle.join('\n')}` : ''}`);
  expect(alle).toEqual([]);
});

test('V2 Zonen: alle Zonen an und alle ausser den Gesichtszonen, je Bild, bei Mosaik, Ganze Person und Zensurbalken; alle zwoelf Presets mit allen Zonen', async () => {
  test.setTimeout(600_000);
  await entfernePack();
  const alle: string[] = [];
  let n = 0;
  for (const preset of PRESET_IDS) {
    alle.push(...(await vergleiche(`${preset} alle Zonen`, { preset, zonen: ZONEN_ALLE }, null)));
    n += BILDER.length;
  }
  for (const preset of ['mosaik', 'person-mosaik', 'zensurbalken']) {
    for (const [name, zonen] of [
      ['alle Zonen', ZONEN_ALLE],
      ['ohne Gesichtszone', ZONEN_OHNE_GESICHT],
    ] as const) {
      alle.push(...(await vergleiche(`${preset} ${name}`, { preset, zonen }, null)));
      n += BILDER.length;
    }
  }
  console.log(`chromium: V2 Zonen: ${n} Vergleiche (mit Bild ${mitBildZaehler}, ohne Flaeche ${ohneBildZaehler} seit Start), ${alle.length} Abweichungen${alle.length ? `\n${alle.join('\n')}` : ''}`);
  expect(alle).toEqual([]);
});

test('V2 Rand, Schwelle und Wort-Themen: andere Werte als der Standard, Vorschau gleich Antwort von pruefe', async () => {
  test.setTimeout(300_000);
  await entfernePack();
  const alle: string[] = [];
  let n = 0;
  for (const [name, teil] of [
    ['Rand 0,3', { preset: 'mosaik', rand: 0.3, zonen: ZONEN_ALLE }],
    ['Schwelle 0,2', { preset: 'blur', schwelle: 0.2, zonen: ZONEN_ALLE }],
    ['Schwelle 0,25 Wort', { preset: 'mosaik-wort', schwelle: 0.25, zonen: ZONEN_ALLE }],
  ] as const) {
    alle.push(...(await vergleiche(name, teil, null)));
    n += BILDER.length;
  }
  // Grenzfaelle der auf drei Stellen gerundeten Scores: sitz feet 0,24 und vorn armpits 0,101 (je nur diese Zone, bedeckt an und aus), an der Schwelle und knapp darueber.
  for (const [k, zone, schwellen] of [['sitz', 'feet', [0.24, 0.25]], ['vorn', 'armpits', [0.1, 0.11]]] as const) {
    for (const schwelle of schwellen) {
      for (const bedeckt of [true, false]) {
        alle.push(...(await vergleiche(`Grenzfall ${k} ${zone} Schwelle ${schwelle} bedeckt ${bedeckt}`, { preset: 'mosaik', schwelle, zonen: zonenNur([zone], bedeckt) }, null, [k])));
        n += 1;
      }
    }
  }
  console.log(`chromium: V2 Rand und Schwelle: ${n} Vergleiche (mit Bild ${mitBildZaehler}, ohne Flaeche ${ohneBildZaehler} seit Start), ${alle.length} Abweichungen${alle.length ? `\n${alle.join('\n')}` : ''}`);
  expect(alle).toEqual([]);
});

// V2 mit Pack (Entscheidung der Leitung R1): Die sichtbare Seite und das Offscreen-Dokument des Erkenners rastern Pack-Bitmaps (Mias Gesicht, Sticker) in Einzelfaellen
// verschieden (Bild "vorn": mia-wort, mia-sticker und sticker mit Face an, mia-sticker mit allen Zonen). Sonde (Pack mit einem und mit zwoelf Patches mit Gesicht, drei
// Stickern in Gruen, Blau, Tuerkis): immer dieselben vier Faelle, null Pixel ausserhalb der Zielrechtecke der Bitmaps (plus 3 px Rand, auf das 16er JPEG-Raster
// erweitert, plus 1 px), also dieselbe Wahl und dieselbe Geometrie. Gemessene Hoechstwerte: Kanalabweichung 29, 1,6829 % der Bildpixel. Grenzen hier: ausserhalb der Rechtecke
// byteweise gleich, innerhalb hoechstens 48 Kanalabweichung und 3 % der Bildpixel. Mutationsbeleg (Kennung fuer Gesicht und Sticker in der Vorschau verfaelscht):
// 27 von 36 Vergleichen rot, Kanalabweichung bis 255, bis 91,18 % der Pixel. Ohne Pack gilt keine Toleranz. Die erste Antwort von `pruefe` nach dem Scan war in allen
// Laeufen gleich der wiederholten (0 Abweichungen); der Vergleich nimmt trotzdem die stabile Antwort (zwei gleiche in Folge, hoechstens drei) und gibt jede Abweichung der ersten aus.
test('V2 mit Dummy-Pack (drei Patches mit Gesicht, drei Sticker): die Presets mit Pack, vier Bilder, Gesichtszonen an und aus, Eye bar an', async () => {
  test.setTimeout(900_000);
  const laut = (t: string) => process.env.VEIL_VORSCHAU_LAUT && console.log(`chromium: ${t}`);
  laut('Pack entfernen');
  await entfernePack();
  laut('Pack bauen');
  // Die Patch-Bilder mit Gesicht sind das Portrait der Beispielbilder selbst (kein Testbild von ausserhalb noetig), in zwoelf klar verschiedenen Farbtoenen (Farbton gedreht),
  // damit eine falsche Wahl des Patches gross auffaellt. Die drei Sticker des Dummy-Packs sind Gruen, Blau und Tuerkis. VEIL_SONDE_ALTPACK=1: nur ein Patch wie zuvor.
  const portrait = readFileSync(path.join(erweiterung, 'beispiel', 'portraet.webp'));
  const toene = process.env.VEIL_SONDE_ALTPACK ? [0] : [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]; // zwoelf Patches: die Wahl streut (neun Dummy-Patches davor wuerden sonst fast immer denselben treffen)
  const extraPatches = [];
  for (const hue of toene) {
    const bild = await sharp(portrait).resize({ width: 800 }).modulate({ hue }).jpeg({ quality: 90 }).toBuffer();
    extraPatches.push({ name: `patch/mit-gesicht-${hue}.jpg`, typ: 'image/jpeg', daten: new Uint8Array(bild) });
  }
  const { bytes } = await baueDummy({ extraPatches });
  laut('Pack importieren');
  await importiere(bytes, 'dummy-vorschau.miapack');
  laut('Pack importiert');
  const hilf = await context.newPage();
  await hilf.goto(optionsUrl());
  await expect
    .poll(async () => (await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' }))?.fertig, { timeout: 60_000, intervals: [500] })
    .toBe(true);
  const scan = await ausWorker({ ziel: 'erkenner', typ: 'gesichtsscan' });
  const pack = (await leseSpeicher(hilf, 'pack')).pack as { importiert: number };
  await hilf.close();
  console.log(`chromium: Gesichtsscan Dummy-Pack: ${JSON.stringify(scan)}`);
  expect(scan.mit).toBeGreaterThanOrEqual(toene.length);
  const alle: string[] = [];
  let n = 0;
  const gesichtZonen = zonenNur(['face', ...BEDECKBAR.slice(0, 3)]);
  for (const preset of ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'sticker']) {
    alle.push(...(await vergleiche(`${preset} Face an`, { preset, zonen: gesichtZonen }, pack)));
    n += BILDER.length;
  }
  alle.push(...(await vergleiche('mia-wort Face aus', { preset: 'mia-wort' }, pack)));
  alle.push(...(await vergleiche('mia-mosaik Eye bar an alle Zonen', { preset: 'mia-mosaik', augenbalken: true, zonen: ZONEN_ALLE }, pack)));
  alle.push(...(await vergleiche('mia-sticker alle Zonen', { preset: 'mia-sticker', zonen: ZONEN_ALLE }, pack)));
  n += 3 * BILDER.length;
  console.log(`chromium: V2 mit Pack: ${n} Vergleiche (mit Bild ${mitBildZaehler}, ohne Flaeche ${ohneBildZaehler} seit Start), ${alle.length} Abweichungen${alle.length ? `\n${alle.join('\n')}` : ''}`);
  const hoechst = toleriert.reduce((h, m) => ({ max: Math.max(h.max, m.max), anteil: Math.max(h.anteil, m.anteil), draussen: h.draussen + m.draussen }), { max: 0, anteil: 0, draussen: 0 });
  console.log(`chromium: V2 mit Pack: ${toleriert.length} Vergleiche nur innerhalb der Toleranz gleich (groesste Kanalabweichung ${hoechst.max}, groesster Anteil ${(hoechst.anteil * 100).toFixed(4)} %, Pixel ausserhalb der Rechtecke ${hoechst.draussen})`);
  console.log(`chromium: V2 mit Pack: erste Antwort von pruefe weicht von der stabilen ab: ${ersteAbweichungen.length} Mal${ersteAbweichungen.length ? `\n${ersteAbweichungen.join('\n')}` : ''}`);
  expect(alle).toEqual([]);
});

// ---------- V3, V4, V7 ----------

test('V3: Einstellungsseite und Interview laden weder den Erkenner noch onnxruntime (Dateien des Baus) und es gibt keinen Netzverkehr ausser den eigenen Dateien', async () => {
  await speichere(ALLES_ZU);
  const dateien = (html: string): Set<string> => {
    const gesehen = new Set<string>();
    const rein = (pfad: string): void => {
      const voll = path.join(erweiterung, pfad.replace(/^\.?\//, ''));
      if (gesehen.has(voll) || !existsSync(voll)) return;
      gesehen.add(voll);
      const text = readFileSync(voll, 'utf8');
      for (const m of text.matchAll(/["'](\.\/[^"']+\.js|\/chunks\/[^"']+\.js)["']/g)) rein(m[1]!.startsWith('./') ? path.posix.join(path.dirname(pfad.replace(/^\//, '')), m[1]!) : m[1]!);
    };
    const roh = readFileSync(path.join(erweiterung, html), 'utf8');
    for (const m of roh.matchAll(/<script[^>]*src="([^"]+)"/g)) rein(m[1]!);
    return gesehen;
  };
  for (const html of ['options.html', 'willkommen.html']) {
    const geladen = dateien(html);
    expect(geladen.size, `${html}: Dateien`).toBeGreaterThan(1);
    for (const d of geladen) {
      const text = readFileSync(d, 'utf8');
      for (const verboten of ['InferenceSession', 'ort-wasm', 'modelle/320n', 'modelle/yunet']) expect(text.includes(verboten), `${html}: ${path.basename(d)} enthaelt ${verboten}`).toBe(false);
    }
    console.log(`chromium: V3 ${html}: ${geladen.size} Dateien geprueft, kein Erkenner, kein onnxruntime`);
  }
  // Netzverkehr: nur Adressen der Erweiterung und data:
  const seite = await context.newPage();
  const fremd: string[] = [];
  seite.on('request', (r) => {
    if (!/^(chrome-extension|data|blob):/.test(r.url())) fremd.push(r.url());
  });
  try {
    await seite.goto(optionsUrl());
    await warteBis(seite, 'vorn', ''); // Kennung ohne Test: das Ende ist `""`
    await punkt(seite, 'sitz').click();
    await expect.poll(async () => (await haken(seite))?.bild).toBe('sitz');
    expect(fremd).toEqual([]);
  } finally {
    await seite.close();
  }
});

test('V4: kein web_accessible_resources, das Rohbild steht nie als Bild im Dokument, die Vorschau zeigt nur eine Data-Adresse (kein sichtbares canvas), eine Webseite erreicht die Bilder nicht', async () => {
  await speichere(ALLES_ZU);
  const manifest = JSON.parse(readFileSync(path.join(erweiterung, 'manifest.json'), 'utf8'));
  expect(manifest.web_accessible_resources).toBeUndefined();
  const seite = await context.newPage();
  try {
    // Jedes Bild-Element, das je auf eine Adresse im Ordner beispiel/ zeigt, wird gemerkt
    await seite.addInitScript(() => {
      (window as any).__roh = [];
      const pruefe = (n: Node) => {
        if (n instanceof HTMLImageElement && /\/beispiel\//.test(n.currentSrc || n.src || n.getAttribute('src') || '')) (window as any).__roh.push(n.src);
        if (n instanceof Element) n.querySelectorAll('img').forEach(pruefe);
      };
      new MutationObserver((ms) => {
        for (const m of ms) {
          m.addedNodes.forEach(pruefe);
          if (m.type === 'attributes') pruefe(m.target);
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    });
    await seite.goto(optionsUrl());
    await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
    for (const k of BILDER) {
      await punkt(seite, k).click();
      await expect.poll(async () => (await haken(seite))?.bild).toBe(k);
    }
    expect(await seite.evaluate(() => (window as any).__roh)).toEqual([]);
    expect(await kachelBild(seite).getAttribute('src')).toMatch(/^data:image\/(jpeg|png);base64,/);
    expect(await seite.locator('.vorschau-spalte canvas').count()).toBe(0);
    expect(await seite.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.vorschau-spalte img')].filter((i) => !i.src.startsWith('data:')).map((i) => i.src))).toEqual([]);
  } finally {
    await seite.close();
  }
  // Eine Seite im Netz kommt an die Dateien der Erweiterung nicht heran
  const web = await context.newPage();
  try {
    await web.goto('http://127.0.0.1:47173/hello.html');
    const ok = await web.evaluate(async (u) => {
      try {
        const r = await fetch(u);
        return r.ok;
      } catch {
        return false;
      }
    }, `chrome-extension://${erweiterungsId}/beispiel/vorn.webp`);
    expect(ok).toBe(false);
  } finally {
    await web.close();
  }
});

test('V7: die Vorschau schreibt nie in den Speicher (storage.local vor und nach Blaettern, Dialog und Neuladen gleich), das Motiv gilt nur, solange die Seite offen ist', async () => {
  await speichere(ALLES_ZU);
  await entfernePack();
  const seite = await context.newPage();
  try {
    await seite.goto(optionsUrl());
    await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
    const vorher = JSON.stringify(await leseSpeicher(seite, null));
    await punkt(seite, 'sitz').click();
    await expect.poll(async () => (await haken(seite))?.bild).toBe('sitz');
    await seite.locator('.vorschau-spalte .v-vorschau-kachel').click();
    await seite.keyboard.press('Escape');
    await seite.waitForTimeout(300);
    expect(JSON.stringify(await leseSpeicher(seite, null))).toBe(vorher);
    await seite.reload();
    await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
    expect((await haken(seite))?.bild).toBe('vorn'); // Start wie V10, die Wahl lebte nur in der alten Seite
    expect(JSON.stringify(await leseSpeicher(seite, null))).toBe(vorher);
  } finally {
    await seite.close();
  }
});

// ---------- V8, V10 ----------

test('V8: das zuletzt angeforderte Bild gewinnt, ein langsames aelteres Ergebnis wird nie mehr gezeigt', async () => {
  await entfernePack();
  const hilf = await context.newPage();
  const seite = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'blur', zonen: ZONEN_ALLE } });
    await seite.goto(optionsUrl());
    await expect.poll(async () => (await haken(seite))?.stil).toBe('blur');
    await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
    // Mosaik wird kuenstlich 2 s gebremst; Mosaik zuerst anfordern, dann sofort Blur
    await seite.evaluate(() => document.documentElement.setAttribute('data-veil-vorschau-bremse', 'mosaik:2000'));
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mosaik', zonen: ZONEN_ALLE } });
    await expect.poll(async () => (await haken(seite))?.stil).toBe('mosaik'); // angefordert, noch nicht gezeigt
    const gezeigtVorher = (await haken(seite))!;
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'blur', zonen: { ...ZONEN_ALLE, belly: { an: false, bedeckt: false } } } });
    await expect.poll(async () => { const h = await haken(seite); return !!h && h.angefordert === h.gezeigt && h.stil === 'blur' && h.anzahl > gezeigtVorher.anzahl; }, { timeout: 10_000 }).toBe(true);
    const src = await kachelBild(seite).getAttribute('src');
    const anzahl = (await haken(seite))!.anzahl;
    await seite.waitForTimeout(3000); // das gebremste Mosaik-Ergebnis waere jetzt laengst da
    expect(await kachelBild(seite).getAttribute('src')).toBe(src);
    expect((await haken(seite))!.anzahl).toBe(anzahl);
    expect(await seite.locator('.vorschau-spalte .v-vorschau-etikett').textContent()).toBe(presetDef(vervollstaendige({ preset: 'blur' })).gilt.name);
  } finally {
    await seite.close();
    await hilf.close();
  }
});

test('V8: jede Aenderung von Eye bar, Zone, Kleidung, Rand und Schwelle zeichnet neu; eine unveraenderte Eingabe nicht', async () => {
  await entfernePack();
  const hilf = await context.newPage();
  const seite = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    const basis = { version: 1, preset: 'mosaik', zonen: ZONEN_ALLE };
    await schreibeSpeicher(hilf, { einstellungen: basis });
    await seite.goto(optionsUrl());
    await expect.poll(async () => { const h = await haken(seite); return !!h && h.anzahl >= 1 && h.angefordert === h.gezeigt; }).toBe(true);
    let src = (await kachelBild(seite).getAttribute('src')) ?? '';
    for (const [name, teil] of [
      ['Eye bar', { augenbalken: true }],
      ['Zone', { zonen: { ...ZONEN_ALLE, buttocks: { an: false, bedeckt: true } } }],
      ['Kleidung', { zonen: { ...ZONEN_ALLE, breast: { an: true, bedeckt: false }, genitals: { an: true, bedeckt: false } } }],
      ['Rand', { rand: 0.3 }],
      ['Schwelle', { schwelle: 0.25 }],
    ] as const) {
      const vorher = (await haken(seite))!.anzahl;
      await schreibeSpeicher(hilf, { einstellungen: { ...basis, ...teil } });
      await expect.poll(async () => { const h = await haken(seite); return !!h && h.anzahl > vorher && h.angefordert === h.gezeigt; }, { timeout: 10_000 }, ).toBe(true);
      const neu = (await kachelBild(seite).getAttribute('src')) ?? '';
      console.log(`chromium: V8 ${name}: neu gezeichnet, Bild ${neu === src ? 'gleich' : 'anders'}`);
      src = neu;
      await schreibeSpeicher(hilf, { einstellungen: { ...basis, ...teil } }); // gleicher Wert noch einmal: kein neues Zeichnen
      await seite.waitForTimeout(500);
      expect((await haken(seite))!.anzahl).toBe(vorher + 1);
      await schreibeSpeicher(hilf, { einstellungen: basis });
      await expect.poll(async () => (await haken(seite))!.anzahl).toBeGreaterThan(vorher + 1);
    }
  } finally {
    await seite.close();
    await hilf.close();
  }
});

test('V10: Start mit dem Portrait, wenn das geltende Preset Mias Gesicht legt, sonst mit dem Bild von vorn; wer geblaettert hat, behaelt seine Wahl', async () => {
  await entfernePack();
  const hilf = await context.newPage();
  const seite = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    // Ohne Pack gilt kein Mia-Preset: vorn, auch wenn mia-mosaik gewaehlt ist
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mia-mosaik' } });
    await seite.goto(optionsUrl());
    await expect.poll(async () => (await haken(seite))?.bild).toBe('vorn');
    // Mit Pack und Mia-Preset: Portrait
    // (Die Einstellungsseite stellt ein gesperrtes Preset ohne Pack auf Mosaik zurueck, darum das Preset zusammen mit dem Pack schreiben.)
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mia-mosaik' }, pack: { id: 'v10', version: '1.0.0', titel: 'T', freischaltungen: ['stil:mia-patch'], bilder: 1, groesse: 1, importiert: 5 } });
    await expect.poll(async () => (await haken(seite))?.bild, { timeout: 10_000 }).toBe('portraet');
    // Geblaettert: die Wahl bleibt, auch wenn das Preset wechselt
    await punkt(seite, 'rueck').click();
    await expect.poll(async () => (await haken(seite))?.bild).toBe('rueck');
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mosaik' } });
    await expect.poll(async () => (await haken(seite))?.stil).toBe('mosaik');
    await seite.waitForTimeout(400);
    expect((await haken(seite))?.bild).toBe('rueck');
    await expect(punkt(seite, 'rueck')).toHaveAttribute('aria-current', 'true');
  } finally {
    await seite.close();
    await entferneSpeicher(hilf, ['pack']);
    await hilf.close();
  }
});

// ---------- V11, V12, V13 ----------

test('V11 und V13: vier Punkte als Knoepfe (44 px Trefferflaeche, Pfeiltasten, aria-current), Kachel als Knopf, Dialog (Escape und Close, Fokus kehrt zurueck), Texte', async () => {
  await entfernePack();
  const hilf = await context.newPage();
  const seite = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mosaik', zonen: ZONEN_ALLE } });
    await seite.setViewportSize({ width: 1280, height: 800 });
    await seite.goto(optionsUrl());
    await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
    const gruppe = seite.locator('.vorschau-spalte .v-vorschau-punkte');
    await expect(gruppe).toHaveAttribute('role', 'group');
    await expect(gruppe).toHaveAttribute('aria-label', VORSCHAU_PUNKTE_LABEL);
    const knoepfe = gruppe.locator('button');
    expect(await knoepfe.count()).toBe(4);
    for (let i = 0; i < 4; i++) {
      await expect(knoepfe.nth(i)).toHaveAttribute('aria-label', VORSCHAU_PUNKT_NAMEN[i]!);
      const r = (await knoepfe.nth(i).boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    expect(await knoepfe.evaluateAll((l) => l.filter((k) => k.getAttribute('aria-current') === 'true').length)).toBe(1);
    await expect(knoepfe.nth(0)).toHaveAttribute('aria-current', 'true');
    // Pfeiltasten: weiter, weiter, zurueck; der Fokus wandert mit
    await knoepfe.nth(0).focus();
    await seite.keyboard.press('ArrowRight');
    await expect.poll(async () => (await haken(seite))?.bild).toBe('rueck');
    await expect(knoepfe.nth(1)).toBeFocused();
    await expect(knoepfe.nth(1)).toHaveAttribute('aria-current', 'true');
    await seite.keyboard.press('ArrowLeft');
    await seite.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await haken(seite))?.bild).toBe('portraet'); // von vorn zurueck: das letzte
    await expect(knoepfe.nth(3)).toBeFocused();
    // Texte
    await expect(seite.locator('.vorschau-spalte > .v-vorschau-platz > .v-vorschau-hinweis:not(.v-vorschau-offen)')).toHaveText(VORSCHAU_HINWEIS);
    const kachel = seite.locator('.vorschau-spalte .v-vorschau-kachel');
    expect(await kachel.evaluate((e) => e.tagName)).toBe('BUTTON');
    await expect(kachel).toHaveAttribute('aria-label', VORSCHAU_KACHEL);
    const name = presetDef(vervollstaendige({ preset: 'mosaik' })).gilt.name;
    await expect(kachelBild(seite)).toHaveAttribute('alt', vorschauAlt(name));
    // Dialog: Kachel oeffnet, Escape schliesst, der Fokus kehrt zur Kachel zurueck
    const dialog = seite.locator('.vorschau-spalte dialog');
    await expect(dialog).not.toBeVisible();
    await kachel.click();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
    expect(await dialog.locator('img.v-vorschau-gross').getAttribute('src')).toBe(await kachelBild(seite).getAttribute('src'));
    // Punkte im Dialog blaettern ebenfalls
    await dialog.locator('[data-bild="sitz"]').click();
    await expect.poll(async () => (await haken(seite))?.bild).toBe('sitz');
    await expect.poll(async () => dialog.locator('img.v-vorschau-gross').getAttribute('src')).toBe(await kachelBild(seite).getAttribute('src'));
    await seite.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(kachel).toBeFocused();
    await kachel.click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(kachel).toBeFocused();
    // Tastatur: Enter auf der fokussierten Kachel oeffnet
    await seite.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await seite.keyboard.press('Escape');
  } finally {
    await seite.close();
    await hilf.close();
  }
});

test('V11 schmal: bei 320, 360 und 412 px ist die Kachel 64 px hoch, die Punkte stehen nur im Dialog, der Dialog passt in den Bildschirm', async () => {
  await speichere(ALLES_ZU);
  await entfernePack();
  const seite = await context.newPage();
  try {
    for (const breite of [320, 360, 412]) {
      await seite.setViewportSize({ width: breite, height: 700 });
      await seite.goto(optionsUrl());
      await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
      const kachel = seite.locator('.vorschau-spalte .v-vorschau-kachel');
      const k = (await kachel.boundingBox())!;
      expect(Math.round((await seite.locator('.vorschau-spalte .v-vorschau-rahmen').boundingBox())!.height), `${breite} px: Hoehe des Rahmens (wie heute)`).toBe(64);
      expect(k.height, 'Trefferflaeche der Kachel').toBeGreaterThanOrEqual(44);
      expect(await seite.locator('.vorschau-spalte .v-vorschau-punkte').isVisible()).toBe(false);
      expect(await seite.locator('.vorschau-spalte > .v-vorschau-platz > .v-vorschau-hinweis:not(.v-vorschau-offen)').isVisible()).toBe(false);
      expect(await seite.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await kachel.click();
      const dialog = seite.locator('.vorschau-spalte dialog');
      await expect(dialog).toBeVisible();
      const d = (await dialog.boundingBox())!;
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(breite);
      expect(d.y + d.height).toBeLessThanOrEqual(700);
      await expect(dialog.locator('.v-vorschau-dialog-punkte button').first()).toBeVisible();
      for (const b of await dialog.locator('.v-vorschau-dialog-punkte button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await seite.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  } finally {
    await seite.close();
  }
});

test('V12: keine Bewegung (keine CSS-Animation und keine Uebergaenge an Vorschau, Punkten und Dialog), das alte Bild bleibt, bis das neue fertig ist', async () => {
  await speichere(ALLES_ZU);
  await entfernePack();
  const seite = await context.newPage();
  try {
    await seite.emulateMedia({ reducedMotion: 'reduce' });
    await seite.goto(optionsUrl());
    await expect.poll(async () => (await haken(seite))?.anzahl).toBeGreaterThanOrEqual(1);
    const stile = await seite.evaluate(() =>
      [...document.querySelectorAll('.vorschau-spalte, .vorschau-spalte *')].map((e) => {
        const s = getComputedStyle(e);
        return { n: e.className?.toString?.() ?? '', anim: s.animationName, dauer: s.transitionDuration };
      }),
    );
    for (const s of stile) {
      expect(s.anim, s.n).toBe('none');
      expect(parseFloat(s.dauer) || 0, s.n).toBeLessThan(0.001); // die Seite setzt bei reduzierter Bewegung 0,00001 s
    }
    // Zwischen zwei Bildern ist das Kachelbild nie leer: das Element bleibt, die Adresse wechselt von Daten zu Daten
    const gesehen: string[] = [];
    await seite.exposeFunction('meldeSrc', (s: string) => gesehen.push(s));
    await seite.evaluate(() => {
      const img = document.querySelector('.vorschau-spalte .v-vorschau-kachel img')!;
      new MutationObserver(() => (window as any).meldeSrc(img.getAttribute('src') ?? '')).observe(img, { attributes: true, attributeFilter: ['src'] });
    });
    await punkt(seite, 'rueck').click();
    await expect.poll(async () => (await haken(seite))?.bild).toBe('rueck');
    expect(gesehen.length).toBeGreaterThanOrEqual(1);
    expect(gesehen.every((s) => s.startsWith('data:image/'))).toBe(true);
  } finally {
    await seite.close();
  }
});

// ---------- Rueckfall ohne Bilder und Interview ----------

test('Interview: der Platz zeigt ein Beispielbild mit Etikett, Punkten (breit) und dem Hinweis; die Stilwahl wirkt', async () => {
  await entfernePack();
  const hilf = await context.newPage();
  const seite = await context.newPage();
  try {
    await hilf.goto(optionsUrl());
    await entferneSpeicher(hilf, ['einstellungen']);
    await schreibeSpeicher(hilf, { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } });
    await seite.setViewportSize({ width: 1280, height: 900 });
    await seite.goto(`chrome-extension://${erweiterungsId}/willkommen.html#interview`);
    await expect(seite.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
    const bild = seite.locator('.iv-vorschau .v-vorschau-kachel img');
    await expect(bild).toHaveAttribute('src', /^data:image\//, { timeout: 15_000 });
    await expect(seite.locator('.iv-vorschau .v-vorschau-punkte button')).toHaveCount(4);
    await expect(seite.locator('.iv-vorschau .v-vorschau-punkte').first()).toBeVisible();
    await expect(seite.locator('.iv-vorschau .v-vorschau-hinweis').first()).toHaveText(VORSCHAU_HINWEIS);
    await seite.setViewportSize({ width: 360, height: 800 });
    await expect(seite.locator('.iv-vorschau .v-vorschau-punkte').first()).toBeHidden();
    expect(Math.round((await seite.locator('.iv-vorschau .v-vorschau-rahmen').boundingBox())!.height)).toBe(64);
  } finally {
    await seite.close();
    await hilf.close();
  }
});

// ---------- N1 bis N4: null Flaechen zeigt das offene Bild mit Hinweis ----------

test('N1 bis N4: bei null Flaechen steht das Beispielbild unverdeckt als data-Bild mit Hinweis (Spalte und Dialog), mit Flaeche nie; der Wechsel zurueck und hin stimmt', async () => {
  await entfernePack();
  await speichere({ preset: 'mosaik' }); // Standard-Zonen
  const hilf = await context.newPage();
  const seite = await context.newPage();
  try {
    await seite.setViewportSize({ width: 1280, height: 800 });
    await seite.goto(optionsUrl());
    await expect.poll(async () => { const h = await haken(seite); return !!h && h.gezeigt === h.angefordert && h.anzahl >= 1; }).toBe(true);
    const hinweisSpalte = seite.locator('.vorschau-spalte > .v-vorschau-platz > .v-vorschau-offen');
    const hinweisDialog = seite.locator('.vorschau-spalte dialog .v-vorschau-dialog-hinweis', { hasText: VORSCHAU_NICHTS });
    const offene: string[] = [];
    // Je Bild: offen genau dann, wenn der Hinweis steht (Spalte), das Alt "nothing covered" lautet und die Adresse ein data-Bild ist
    for (const k of BILDER) {
      await punkt(seite, k).click();
      await expect.poll(async () => { const h = await haken(seite); return !!h && h.bild === k && h.gezeigt === h.angefordert; }).toBe(true);
      const h = (await haken(seite))!;
      const alt = await kachelBild(seite).getAttribute('alt');
      expect(await hinweisSpalte.isVisible(), `${k}: Hinweis in der Spalte`).toBe(h.offen);
      expect(alt, `${k}: Alt`).toBe(h.offen ? VORSCHAU_ALT_OFFEN : vorschauAlt(presetDef(vervollstaendige({ preset: 'mosaik' })).gilt.name));
      expect(await kachelBild(seite).getAttribute('src'), `${k}: Adresse`).toMatch(/^data:image\//);
      expect(await seite.locator('.vorschau-spalte .v-vorschau-skizze').count(), `${k}: keine Strichzeichnung`).toBe(0);
      expect(await seite.locator('.vorschau-spalte > .v-vorschau-platz > .v-vorschau-hinweis:not(.v-vorschau-offen)').isVisible(), `${k}: Motiv-Hinweis steht immer`).toBe(true);
      if (h.offen) {
        offene.push(k);
        expect(await hinweisSpalte.textContent()).toBe(VORSCHAU_NICHTS);
        expect(await seite.locator('.vorschau-spalte .v-vorschau-kachel').getAttribute('aria-describedby'), `${k}: angebunden`).toBe(await hinweisSpalte.getAttribute('id'));
        await seite.locator('.vorschau-spalte .v-vorschau-kachel').click();
        await expect(hinweisDialog).toBeVisible();
        expect(await seite.locator('.vorschau-spalte dialog img.v-vorschau-gross').getAttribute('alt')).toBe(VORSCHAU_ALT_OFFEN);
        await seite.keyboard.press('Escape');
      } else {
        await seite.locator('.vorschau-spalte .v-vorschau-kachel').click();
        await expect(hinweisDialog).toBeHidden();
        await seite.keyboard.press('Escape');
      }
    }
    console.log(`chromium: N1 bis N4: bei Standard-Einstellungen offen auf: ${offene.join(', ') || 'keinem Bild'}; verdeckt auf: ${BILDER.filter((k) => !offene.includes(k)).join(', ') || 'keinem Bild'}`);
    expect(offene.length, 'mindestens ein Bild ohne Flaeche bei Standard-Einstellungen').toBeGreaterThan(0);
    expect(offene, 'das Portrait hat bei Standard-Einstellungen nichts zu verdecken').toContain('portraet');
    // Wechsel: Portrait offen -> alle Zonen (verdeckt, kein Hinweis) -> Standard (wieder offen)
    await punkt(seite, 'portraet').click();
    await expect.poll(async () => (await haken(seite))?.offen).toBe(true);
    await hilf.goto(optionsUrl());
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mosaik', zonen: ZONEN_ALLE } });
    await expect.poll(async () => { const h = await haken(seite); return !!h && h.gezeigt === h.angefordert && h.offen === false && h.bild === 'portraet'; }).toBe(true);
    expect(await hinweisSpalte.isVisible()).toBe(false);
    expect(await kachelBild(seite).getAttribute('alt')).not.toBe(VORSCHAU_ALT_OFFEN);
    expect(await seite.locator('.vorschau-spalte .v-vorschau-kachel').getAttribute('aria-describedby')).toBeNull();
    await schreibeSpeicher(hilf, { einstellungen: { version: 1, preset: 'mosaik' } });
    await expect.poll(async () => { const h = await haken(seite); return !!h && h.gezeigt === h.angefordert && h.offen === true; }).toBe(true);
    expect(await hinweisSpalte.isVisible()).toBe(true);
    expect(await kachelBild(seite).getAttribute('alt')).toBe(VORSCHAU_ALT_OFFEN);
    // Das offene Bild ist das Beispielbild (nur JPEG-Kodierung weicht ab) und kommt als data-Adresse, nie als Pfad der Erweiterung
    expect(await mittlereAbweichung((await kachelBild(seite).getAttribute('src'))!, 'portraet')).toBeLessThan(4);
    // Schmal: Hinweis in Spalte ausgeblendet, im Dialog da
    await seite.setViewportSize({ width: 360, height: 700 });
    expect(await hinweisSpalte.isVisible()).toBe(false);
    await seite.locator('.vorschau-spalte .v-vorschau-kachel').click();
    await expect(hinweisDialog).toBeVisible();
    await seite.keyboard.press('Escape');
  } finally {
    await seite.close();
    await hilf.close();
  }
});

// ---------- Rueckfall ohne Beispielbilder (Bau ohne Kern und ohne Beispielbilder, scripts/test-all.mjs) ----------

test('Rueckfall: ohne Beispielbilder im Bau zeigt der Platz wie bisher die Strichzeichnung mit Etikett, ohne Kachel, Punkte, Hinweis und Dialog', async () => {
  const ohne = path.join(wurzel, process.env.VEIL_AUSGABE_OHNE_KERN ?? '.output-test-ohnekern', 'chrome-mv3');
  test.skip(!MIT_BILDERN, 'Beispielbilder fehlen im Testbau');
  expect(existsSync(ohne), 'Bau ohne Beispielbilder fehlt (npm test oder VEIL_BEISPIEL=<leerer Ordner> VEIL_KERN=<nichts> VEIL_AUSGABE=.output-test-ohnekern wxt build)').toBe(true);
  expect(existsSync(path.join(ohne, 'beispiel'))).toBe(false);
  const profil2 = await mkdtemp(path.join(tmpdir(), 'veil-vorschau-ohne-'));
  const ctx = await chromium.launchPersistentContext(profil2, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ohne}`, `--load-extension=${ohne}`],
  });
  try {
    const w = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15_000 }));
    const id = new URL(w.url()).host;
    const seite = await ctx.newPage();
    await seite.goto(`chrome-extension://${id}/options.html`);
    await expect(seite.locator('.vorschau-spalte .v-vorschau-etikett')).toHaveText('Mosaic');
    await expect.poll(async () => (await haken(seite))?.angefordert).toBeTruthy();
    await expect.poll(async () => { const h = await haken(seite); return !!h && h.gezeigt === h.angefordert; }).toBe(true);
    expect(await seite.locator('.vorschau-spalte .v-vorschau-flaeche svg').count()).toBe(1);
    expect(await seite.locator('.vorschau-spalte .v-vorschau-kachel').count()).toBe(0);
    expect(await seite.locator('.vorschau-spalte .v-vorschau-punkte').isVisible()).toBe(false);
    // beide Hinweise einzeln: der Motiv-Hinweis und der Hinweis "nichts zu verdecken" (ohne Bilddateien gibt es keinen von beiden)
    expect(await seite.locator('.vorschau-spalte .v-vorschau-platz > .v-vorschau-hinweis:not(.v-vorschau-offen)').isVisible()).toBe(false);
    expect(await seite.locator('.vorschau-spalte .v-vorschau-platz > .v-vorschau-offen').isVisible()).toBe(false);
    expect(await seite.locator('.vorschau-spalte dialog[open]').count()).toBe(0);
    // Der Stil wechselt: die Zeichnung folgt
    const vorher = await seite.locator('.vorschau-spalte .v-vorschau-flaeche').innerHTML();
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.set({ einstellungen: { version: 1, preset: 'blur' } }));
    await expect(seite.locator('.vorschau-spalte .v-vorschau-etikett')).toHaveText('Blur');
    expect(await seite.locator('.vorschau-spalte .v-vorschau-flaeche').innerHTML()).not.toBe(vorher);
    await seite.close();
  } finally {
    await ctx.close();
    await rm(profil2, { recursive: true, force: true });
  }
});
