// Chromium: Bilder in Filtern (<filter><feImage href|xlink:href>) laufen durch den Schleier (Nacht 18, Paket N4, Folge aus Entscheidung 197).
// Hide-first (eigener Waechter in tests/fixtures/svg-feimage.html: ohne Urteil muss die Versteck-Regel greifen), Pruefung wie bei einem
// SVG-Bild (Treffer zensiert, harmlose frei), Quellwechsel verbirgt sofort, Pause gibt frei. Gemessen wird auch an den Pixeln: Bildschirmfoto
// jedes Filter-Rechtecks mit Schleier gegen das Foto derselben Stelle in der Pause (dort ist das Original zu sehen).
// Faelle: href, xlink:href, fremder Ursprung ohne CORS, data:, blob:, offene Shadow Root, feImage mit Verweis #id auf ein image.
import { chromium, expect, test, type Browser, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const testbilder = existsSync(path.resolve(wurzel, '../05 Testbilder/nsfw/IMG_0260.jpg'));

// Filter-Bilder mit Treffer; fe-ref zeigt auf ein image in defs (laeuft ueber den Weg der SVG-Bilder).
const TREFFER = ['fe-href', 'fe-xlink', 'fe-fremd', 'fe-data', 'fe-blob', 'fe-shadow', 'fe-ref'];
const HARMLOS = ['fe-sfw', 'fe-sfw-xlink'];
const ALLE = [...TREFFER, ...HARMLOS];
// Erzwungenes "verdeckt" (widerrufene blob:-Adresse, Filter mit feBlend ueber dem Quellbild).
const VERDECKT = 'fe-verdeckt';

let profil: string;
let plain: Browser;
let context: BrowserContext;
let worker: Worker;



test.beforeAll(async () => {
  // Browser ohne Erweiterung: so sieht die Seite ohne Schleier aus (Referenz fuer die Pixelvergleiche).
  plain = await chromium.launch({ channel: 'chromium', headless: true });
  profil = await mkdtemp(path.join(tmpdir(), 'veil-svg-feimage-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
});

test.afterAll(async () => {
  await plain?.close();
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

interface Fe {
  id: string;
  urteil: string;
  quelle: string;
  neutral: boolean;
}

// Zustand aller feImage der Seite (auch in der offenen Shadow Root) und des image in defs (fe-ref).
function lies(seite: Page): Promise<Fe[]> {
  return seite.evaluate(() => {
    const XLINK = 'http://www.w3.org/1999/xlink';
    const wirt = document.getElementById('wirt')?.shadowRoot;
    const liste = [...document.querySelectorAll('feImage'), ...(wirt?.querySelectorAll('feImage') ?? [])];
    return liste.map((el) => {
      const urteil = el.getAttribute('data-veil') ?? '';
      const bild = el.id === 'fe-ref' ? document.getElementById('bild-ref') : null;
      return {
        id: el.id,
        // fe-ref: das Urteil faellt am image, auf das der Filter zeigt
        urteil: bild ? (bild.getAttribute('data-veil') ?? '') : urteil,
        quelle: el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href') ?? '',
        // Platzhalter statt der Seitenquelle (der Schleier verbirgt jedes feImage bis zum Urteil damit)
        neutral: (el.getAttribute('href') ?? '').startsWith('data:image/png'),
      };
    });
  });
}

const feWaechter = (seite: Page) =>
  seite.evaluate(() => ({ aufblitzen: (window as any).__feAufblitzen as number, proben: (window as any).__feProben as number, wer: (window as any).__feWer as string[] }));

async function warteAufUrteile(seite: Page, ids: string[], frist = 25_000): Promise<Map<string, Fe>> {
  let letzte: Fe[] = [];
  await expect
    .poll(async () => {
      letzte = await lies(seite);
      return ids.filter((id) => !letzte.find((b) => b.id === id)?.urteil);
    }, { timeout: frist, intervals: [100] })
    .toEqual([]);
  return new Map(letzte.map((b) => [b.id, b]));
}

async function oeffne(): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(`${basis}/svg-feimage.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.feBereit ?? null), { timeout: 10_000 }).toBe('1');
  return seite;
}

// Bildschirmfoto jedes Filter-Rechtecks (svg mit der Kennung s-<id>), 32 x 32 verkleinert, RGB.
async function fotos(seite: Page, ids: string[]): Promise<Map<string, Buffer>> {
  const aus = new Map<string, Buffer>();
  for (const id of ids) {
    const loc = id === 'fe-shadow' ? seite.locator('#wirt svg') : seite.locator(`#s-${id}`);
    const png = await loc.screenshot();
    aus.set(id, await sharp(png).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer());
  }
  return aus;
}

// Spannweite der Werte eines Fotos: ein Foto ohne Bild ist flach.
const spannweite = (b: Buffer) => Math.max(...b) - Math.min(...b);

// Mittlere Abweichung je Kanal (0 bis 255) zweier Fotos.
function abstand(a: Buffer, b: Buffer): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return Math.round((s / a.length) * 100) / 100;
}

// Referenz: dieselbe Seite in einem Browser ohne Erweiterung (dort zeigen alle Filter ihr Original). Gewartet wird, bis jedes Foto ein Bild
// zeigt (Spannweite der Werte).
async function referenz(): Promise<Map<string, Buffer>> {
  const seite = await (await plain.newContext()).newPage();
  try {
    await seite.goto(`${basis}/svg-feimage.html`);
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.feBereit ?? null), { timeout: 10_000 }).toBe('1');
    let f = await fotos(seite, ALLE);
    for (let i = 0; i < 20 && ALLE.some((id) => spannweite(f.get(id)!) <= 60); i++) {
      await seite.waitForTimeout(500);
      f = await fotos(seite, ALLE);
    }
    for (const id of ALLE) expect(spannweite(f.get(id)!), `${id}: Referenz ohne Bild`).toBeGreaterThan(60);
    return f;
  } finally {
    await seite.context().close();
  }
}

test('Hide-first: kein Filter-Bild (feImage) traegt ohne Urteil noch die Seitenquelle', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  await seite.waitForTimeout(3000);
  const w = await feWaechter(seite);
  console.log(`svg-feimage chromium: Proben ${w.proben}, aufgeblitzt ${w.aufblitzen} ${w.wer.slice(0, 8).join(', ')}`);
  expect(w.proben).toBeGreaterThan(0);
  expect(w.aufblitzen, w.wer.join(', ')).toBe(0);
  await seite.close();
});

test('Filter-Bilder werden geprueft: Treffer zensiert (nie das Original zu sehen), harmlose frei und unveraendert', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  const ref = await referenz();
  const urteile = await warteAufUrteile(seite, ALLE);
  await seite.waitForTimeout(1500);
  for (const [id, b] of urteile) console.log(`svg-feimage chromium: ${id} ${b.urteil} (${b.quelle.slice(0, 30)}, neutral ${b.neutral})`);
  for (const id of ['fe-href', 'fe-xlink', 'fe-fremd', 'fe-data', 'fe-blob', 'fe-shadow']) {
    const b = urteile.get(id)!;
    expect(b.urteil, id).toBe('zensiert');
    expect(b.quelle, id).toMatch(/^data:image\//);
  }
  expect(urteile.get('fe-ref')!.urteil).toMatch(/^(zensiert|verdeckt)$/);
  for (const id of HARMLOS) expect(urteile.get(id)!.urteil, id).toBe('frei');
  const jetzt = await fotos(seite, ALLE);
  const ab: Record<string, number> = {};
  for (const id of ALLE) ab[id] = abstand(jetzt.get(id)!, ref.get(id)!);
  console.log(`svg-feimage chromium: Abstand Foto mit Schleier gegen Foto ohne Erweiterung ${JSON.stringify(ab)}`);
  // Treffer: das Foto weicht vom Original ab (zensiert; ohne den Schutz war der Abstand 0,00, gemessen vor dem Bau); harmlos: gleich.
  for (const id of TREFFER) expect(ab[id]!, `${id}: Original sichtbar`).toBeGreaterThan(3);
  // Die zensierte Fassung erscheint wirklich (ein leeres Rechteck wiche auch von der Referenz ab).
  const sp = Object.fromEntries(TREFFER.map((id) => [id, spannweite(jetzt.get(id)!)]));
  console.log(`svg-feimage chromium: Spannweite der Fotos nach dem Urteil ${JSON.stringify(sp)}`);
  for (const id of TREFFER) expect(sp[id]!, `${id}: zensierte Fassung nicht zu sehen`).toBeGreaterThan(60);
  for (const id of HARMLOS) expect(ab[id]!, `${id}: harmloses Bild veraendert`).toBeLessThan(1);
  expect((await feWaechter(seite)).aufblitzen).toBe(0);
  await seite.close();
});

test('Quellwechsel nach "frei" (href und xlink:href) verbirgt sofort und prueft neu', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  await warteAufUrteile(seite, HARMLOS);
  const direkt = await seite.evaluate(
    () =>
      new Promise<string[]>((fertig) => {
        const XLINK = 'http://www.w3.org/1999/xlink';
        document.getElementById('fe-sfw')!.setAttribute('href', '/testbild/nsfw/IMG_0260.jpg?neu=1');
        document.getElementById('fe-sfw-xlink')!.setAttributeNS(XLINK, 'xlink:href', '/testbild/nsfw/IMG_0260.jpg?neu=2');
        requestAnimationFrame(() =>
          fertig(
            ['fe-sfw', 'fe-sfw-xlink'].map((id) => `${document.getElementById(id)!.getAttribute('data-veil') ?? ''}|${(document.getElementById(id)!.getAttribute('href') ?? '').startsWith('data:image/png') ? 'neutral' : 'offen'}`),
          ),
        );
      }),
  );
  console.log(`svg-feimage chromium: nach Wechsel im naechsten Frame ${direkt.join(', ')}`);
  for (const d of direkt) expect(d).toBe('|neutral');
  await expect
    .poll(async () => (await lies(seite)).filter((b) => HARMLOS.includes(b.id)).map((b) => b.urteil).join(','), { timeout: 20_000 })
    .toBe('zensiert,zensiert');
  expect((await feWaechter(seite)).aufblitzen).toBe(0);
  await seite.close();
});

test('Pause gibt alle Filter-Bilder frei und stellt die Originale her, danach wieder beurteilt', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  const vorher = await warteAufUrteile(seite, ALLE);
  try {
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
    const quellen = await seite.evaluate(() => (window as any).__feQuellen as Record<string, string>);
    const inPause = await lies(seite);
    expect(inPause.length).toBe(ALLE.length + 1);
    for (const b of inPause) {
      expect(b.neutral, `${b.id}: in der Pause noch neutral`).toBe(false);
      if (b.id !== 'fe-ref') expect(b.quelle === quellen[b.id], `${b.id}: Original nicht zurueck`).toBe(true);
    }
    const x = inPause.find((b) => b.id === 'fe-xlink')!;
    expect(x.quelle).toBe('/testbild/nsfw/IMG_0260.jpg');
    // In der Pause zeigt jedes Filter-Bild sein Original: Fotos gleich denen ohne Erweiterung (auch die, die vorher neutral waren).
    const ref = await referenz();
    let jetzt = await fotos(seite, ALLE);
    for (let i = 0; i < 12 && ALLE.some((id) => abstand(jetzt.get(id)!, ref.get(id)!) >= 1); i++) {
      await seite.waitForTimeout(500);
      jetzt = await fotos(seite, ALLE);
    }
    const ab = Object.fromEntries(ALLE.map((id) => [id, abstand(jetzt.get(id)!, ref.get(id)!)]));
    console.log(`svg-feimage chromium: in der Pause, Abstand Foto gegen Foto ohne Erweiterung ${JSON.stringify(ab)}`);
    for (const id of ALLE) expect(ab[id]!, `${id}: in der Pause nicht das Original`).toBeLessThan(1);
  } finally {
    await setze({ pause: false });
  }
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBeNull();
  const danach = await warteAufUrteile(seite, ALLE);
  for (const id of ALLE) expect(danach.get(id)!.urteil, id).toBe(vorher.get(id)!.urteil);
  await seite.close();
});

test('Hide-first an den Pixeln: bei gesperrter Freigabe bleibt jedes Filterrechteck ohne Bild (nie ein Urteil, nie das Original)', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await context.newPage();
  await seite.goto(`${basis}/svg-feimage.html?veil-freigabe=nie`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.feBereit ?? null), { timeout: 10_000 }).toBe('1');
  await seite.waitForTimeout(4000);
  const liste = await lies(seite);
  expect(liste.filter((b) => b.urteil !== '').map((b) => b.id), 'Freigabe war nicht gesperrt').toEqual([]);
  const f = await fotos(seite, ALLE);
  const sp = Object.fromEntries(ALLE.map((id) => [id, spannweite(f.get(id)!)]));
  console.log(`svg-feimage chromium: gesperrt, Spannweite der Fotos ${JSON.stringify(sp)}`);
  for (const id of ALLE) expect(sp[id]!, `${id}: Bild ohne Urteil zu sehen`).toBeLessThan(30);
  await seite.close();
});

// Runde 2, Fund 2: "verdeckt" nimmt das gefilterte Element nicht aus der Darstellung. Das feImage zeigt einen neutralen Platzhalter, der Filter
// laeuft weiter (hier legt feBlend das Quellbild darueber): das magenta Rechteck bleibt sichtbar, an den Ecken liegt der graue Platzhalter.
test('Erzwungenes "verdeckt": gefiltertes Element bleibt sichtbar, kein Originalbild, Pause stellt die Quelle her', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  await expect.poll(async () => (await lies(seite)).find((b) => b.id === VERDECKT)?.urteil, { timeout: 25_000 }).toBe('verdeckt');
  await seite.waitForTimeout(800);
  const png = await seite.locator(`#s-${VERDECKT}`).screenshot();
  const roh = await sharp(png).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer();
  const px = (x: number, y: number) => [roh[(y * 32 + x) * 3]!, roh[(y * 32 + x) * 3 + 1]!, roh[(y * 32 + x) * 3 + 2]!];
  const mitte = px(16, 16);
  const ecke = px(2, 2);
  console.log(`svg-feimage chromium: verdeckt, Mitte ${mitte}, Ecke ${ecke}`);
  expect(mitte[0]! > 150 && mitte[1]! < 80 && mitte[2]! > 150, `Rechteck nicht sichtbar: ${mitte}`).toBe(true);
  expect(Math.abs(ecke[0]! - 128) < 40 && Math.abs(ecke[1]! - 128) < 40 && Math.abs(ecke[2]! - 128) < 40, `Ecke nicht neutral grau: ${ecke}`).toBe(true);
  const b = (await lies(seite)).find((x) => x.id === VERDECKT)!;
  expect(b.quelle).toMatch(/^data:image\//);
  try {
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
    const quelle = await seite.evaluate((id) => document.getElementById(id)!.getAttribute('href'), VERDECKT);
    const original = await seite.evaluate((id) => (window as any).__feQuellen[id] as string, VERDECKT);
    expect(quelle === original, 'Original in der Pause nicht zurueck').toBe(true);
  } finally {
    await setze({ pause: false });
  }
  await seite.close();
});

// Runde 2, Fund 3: ein feImage hat keinen Kasten; es darf auf einer vollen Seite nicht hinter allen Bildern anstehen, weil das gefilterte
// Element bis zum Urteil unsichtbar ist. 60 grosse Bilder, das feImage liegt oben im Sichtbereich und steht im DOM zuletzt.
test('feImage im Sichtbereich wird auf einer vollen Seite nicht zuletzt beurteilt', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await context.newPage();
  await seite.goto(`${basis}/svg-feimage-voll.html`);
  await expect
    .poll(() => seite.evaluate(() => ((window as any).__ordnung as string[]).filter((e) => e.startsWith('fe-voll:')).length), { timeout: 90_000, intervals: [200] })
    .toBeGreaterThan(0);
  const ordnung = await seite.evaluate(() => (window as any).__ordnung as string[]);
  const rang = ordnung.findIndex((e) => e.startsWith('fe-voll:')) + 1;
  console.log(`svg-feimage chromium: Rang des feImage unter den Urteilen ${rang} von ${ordnung.length} bisher`);
  // Mit Einstufung: nach den sichtbaren Bildern (rund 25). Ohne: hinter allen 60 (Rang 61).
  expect(rang, `feImage erst als ${rang}. beurteilt`).toBeLessThanOrEqual(35);
  await seite.close();
});

// Runde 3, Fund 1: SMIL (set) wechselt die Quelle eines feImage, ohne ein Attribut zu aendern; gezeichnet wird animVal. Das Bild darf nie zu sehen
// sein (Spannweite des Fotos klein), in der Pause schon (gleich dem Foto ohne Erweiterung).
const SMIL = ['fe-smil', 'fe-smil-fern'];
test('SMIL auf href eines feImage (Kind-Element und href="#id"): nie das Bild, Pause gibt Original samt Animation zurueck', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const ref = await (async () => {
    const seite = await (await plain.newContext()).newPage();
    try {
      await seite.goto(`${basis}/svg-feimage-smil.html`);
      let f = new Map<string, Buffer>();
      for (let i = 0; i < 20; i++) {
        await seite.waitForTimeout(500);
        f = new Map();
        for (const id of SMIL) f.set(id, await sharp(await seite.locator(`#s-${id}`).screenshot()).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer());
        if (SMIL.every((id) => spannweite(f.get(id)!) > 60) && i > 4) break;
      }
      for (const id of SMIL) expect(spannweite(f.get(id)!), `${id}: Referenz ohne Bild`).toBeGreaterThan(60);
      return f;
    } finally {
      await seite.context().close();
    }
  })();
  const seite = await context.newPage();
  await seite.goto(`${basis}/svg-feimage-smil.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.feBereit ?? null), { timeout: 10_000 }).toBe('1');
  // Die Animation beginnt nach 1 s; danach ist sie lange genug gelaufen.
  const t0 = Date.now();
  const gesehen: Record<string, number> = { 'fe-smil': 0, 'fe-smil-fern': 0 };
  while (Date.now() - t0 < 6000) {
    for (const id of SMIL) gesehen[id] = Math.max(gesehen[id]!, spannweite(await sharp(await seite.locator(`#s-${id}`).screenshot()).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer()));
    await seite.waitForTimeout(300);
  }
  const urteile = await seite.evaluate(() => ['fe-smil', 'fe-smil-fern'].map((id) => document.getElementById(id)!.getAttribute('data-veil') ?? ''));
  console.log(`svg-feimage chromium: SMIL, hoechste Spannweite ${JSON.stringify(gesehen)}, Urteile ${urteile}`);
  for (const id of SMIL) expect(gesehen[id]!, `${id}: Bild per SMIL zu sehen`).toBeLessThan(60);
  for (const u of urteile) expect(u).not.toBe('frei');
  try {
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
    let ab: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      await seite.waitForTimeout(500);
      ab = {};
      for (const id of SMIL) ab[id] = abstand(await sharp(await seite.locator(`#s-${id}`).screenshot()).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer(), ref.get(id)!);
      if (SMIL.every((id) => ab[id]! < 1)) break;
    }
    console.log(`svg-feimage chromium: SMIL in der Pause, Abstand zum Foto ohne Erweiterung ${JSON.stringify(ab)}`);
    for (const id of SMIL) expect(ab[id]!, `${id}: in der Pause nicht das Original`).toBeLessThan(1);
  } finally {
    await setze({ pause: false });
  }
  await seite.close();
});

// Runde 3, Fund 2: die Seite setzt href, nachdem ein Urteil steht ("verdeckt" und "zensiert"). Die neue Quelle muss geprueft werden (neues Urteil
// "zensiert" fuer das Testbild), und die Pause gibt die neue Quelle zurueck, nicht die alte.
for (const [name, id] of [['verdeckt', 'fe-verdeckt'], ['zensiert', 'fe-href']] as const) {
  test(`Quellwechsel der Seite nach "${name}": die neue Quelle wird geprueft, die Pause gibt sie zurueck`, async () => {
    test.skip(!testbilder, 'ohne Testbilder');
    const seite = await oeffne();
    await expect.poll(async () => (await lies(seite)).find((b) => b.id === id)?.urteil, { timeout: 25_000 }).toBe(name);
    const neu = `/testbild/nsfw/IMG_0260.jpg?neu=${name}`;
    await seite.evaluate(([i, h]) => document.getElementById(i!)!.setAttribute('href', h!), [id, neu]);
    // Danach ohne Urteil (neu geprueft), schliesslich zensiert; nie das Original.
    await expect.poll(async () => (await lies(seite)).find((b) => b.id === id)?.urteil, { timeout: 25_000 }).toBe('zensiert');
    expect((await lies(seite)).find((b) => b.id === id)!.quelle).toMatch(/^data:image\//);
    try {
      await setze({ pause: true });
      await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
      const quelle = await seite.evaluate((i) => document.getElementById(i!)!.getAttribute('href'), id);
      expect(quelle, 'Pause gibt nicht die neue Quelle zurueck').toBe(neu);
    } finally {
      await setze({ pause: false });
    }
    await seite.close();
  });
}
