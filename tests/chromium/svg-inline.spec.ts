// Chromium: Bilder in Inline-SVG (<svg><image href|xlink:href>) laufen durch den Schleier (Nacht 18, Paket N1; UEBERGABE-17 Punkt 6).
// Hide-first: ohne Urteil nie sichtbar (eigener Waechter in tests/fixtures/svg-inline.html), dann geprueft wie ein img: Treffer werden zensiert
// (eigene Fassung als href, im Augenblick des Urteils schon gezeigt), harmlose Bilder frei; Umgehungen (SMIL-Wechsel der Quelle, sofort
// widerrufene blob:-Adresse) werden nie frei; ein Quellwechsel verbirgt sofort; Pause gibt alles frei und stellt die Originale her.
// Faelle: href, xlink:href, fremder Ursprung ohne CORS, data:, blob:, offene Shadow Root, eigenstaendiges SVG-Dokument.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const testbilder = existsSync(path.resolve(wurzel, '../05 Testbilder/nsfw/IMG_0260.jpg'));

const TREFFER = ['i-href', 'i-xlink', 'i-fremd', 'i-data', 'i-blob', 'i-shadow'];
const HARMLOS = ['i-sfw', 'i-sfw-xlink'];
// Umgehungsversuche: duerfen zu keinem Zeitpunkt frei sein (SMIL wechselt die Quelle nach 1,5 s auf ein Testbild mit Treffer).
const GESPERRT = ['i-smil', 'i-smil-fern', 'i-blob-weg'];
const ALLE = [...TREFFER, ...HARMLOS, ...GESPERRT];

let profil: string;
let context: BrowserContext;
let worker: Worker;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-svg-inline-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
});

test.afterAll(async () => {
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

interface Bild {
  id: string;
  urteil: string;
  quelle: string;
  hatHref: boolean;
  xlink: string | null;
  opacity: string;
  filter: string;
}

// Zustand aller SVG-Bilder der Seite (auch in der offenen Shadow Root): Urteil, aktuelle Quelle (href oder xlink:href), Deckkraft, Filter.
function lies(seite: Page): Promise<Bild[]> {
  return seite.evaluate(() => {
    const XLINK = 'http://www.w3.org/1999/xlink';
    const bilder = [...document.querySelectorAll('image'), ...(document.getElementById('wirt')?.shadowRoot?.querySelectorAll('image') ?? [])].filter(
      (el) => el.namespaceURI === 'http://www.w3.org/2000/svg',
    );
    return bilder.map((el) => {
      const stil = getComputedStyle(el);
      return {
        id: el.id,
        urteil: el.getAttribute('data-veil') ?? '',
        quelle: el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href') ?? '',
        hatHref: el.hasAttribute('href'),
        xlink: el.getAttributeNS(XLINK, 'href'),
        opacity: stil.opacity,
        filter: stil.filter,
      };
    });
  });
}

const svgWaechter = (seite: Page) =>
  seite.evaluate(() => ({ aufblitzen: (window as any).__svgAufblitzen as number, proben: (window as any).__svgProben as number, wer: (window as any).__svgWer as string[] }));

async function warteAufUrteile(seite: Page, ids: string[], frist = 25_000): Promise<Map<string, Bild>> {
  let letzte: Bild[] = [];
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
  await seite.goto(`${basis}/svg-inline.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.svgBereit ?? null), { timeout: 10_000 }).toBe('1');
  return seite;
}

// Vergleicht je zensiertem Bild die Pixelprobe aus dem Augenblick des Urteils (Waechter der Testseite) mit der eingesetzten Fassung:
// mittlere Abweichung je Kanal (0 bis 255). 'verschmutzt' = das Element zeigte da noch ein fremdes Original.
function zensurAbweichung(seite: Page, ids: string[]): Promise<Record<string, number | string>> {
  return seite.evaluate(async (liste) => {
    const aus: Record<string, number | string> = {};
    const wirt = document.getElementById('wirt')?.shadowRoot;
    for (const id of liste) {
      const el = document.getElementById(id) ?? wirt?.getElementById(id);
      const probe = (window as any).__svgZensurProbe[id];
      if (!el || probe === undefined) {
        aus[id] = 'keine Probe';
        continue;
      }
      if (probe === 'verschmutzt') {
        aus[id] = 'verschmutzt';
        continue;
      }
      const bild = new Image();
      bild.src = el.getAttribute('href') ?? '';
      await bild.decode();
      const k = document.createElement('canvas');
      k.width = 64;
      k.height = 64;
      const x = k.getContext('2d')!;
      x.drawImage(bild, 0, 0, 64, 64);
      const d = x.getImageData(0, 0, 64, 64).data;
      let summe = 0;
      for (let i = 0; i < d.length; i++) if (i % 4 !== 3) summe += Math.abs(d[i]! - probe[i]);
      aus[id] = Math.round((summe / ((d.length / 4) * 3)) * 100) / 100;
      // Zum Vergleich (Trennschaerfe der Probe): Abstand des Originals zur Fassung, nur fuer lesbare Originale.
      try {
        const original = new Image();
        original.src = (window as any).__svgQuellen[id];
        await original.decode();
        x.clearRect(0, 0, 64, 64);
        x.drawImage(original, 0, 0, 64, 64);
        const o = x.getImageData(0, 0, 64, 64).data;
        let s2 = 0;
        for (let i = 0; i < o.length; i++) if (i % 4 !== 3) s2 += Math.abs(o[i]! - d[i]!);
        aus[`${id}:original`] = Math.round((s2 / ((o.length / 4) * 3)) * 100) / 100;
      } catch {
        aus[`${id}:original`] = 'nicht lesbar';
      }
    }
    return aus;
  }, ids);
}

test('Hide-first: kein Bild in Inline-SVG ist ohne Urteil sichtbar, ein HTML-Element namens image bleibt sichtbar', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  // Zeit fuer Laden und Zeichnen aller Bilder (auch ohne Schleier waeren sie dann laengst zu sehen).
  await seite.waitForTimeout(3000);
  const w = await svgWaechter(seite);
  console.log(`svg-inline chromium: Proben ${w.proben}, aufgeblitzt ${w.aufblitzen} ${w.wer.slice(0, 8).join(', ')}`);
  expect(w.proben).toBeGreaterThan(0);
  expect(w.aufblitzen, w.wer.join(', ')).toBe(0);
  expect(await seite.evaluate(() => getComputedStyle(document.getElementById('html-image')!).opacity)).toBe('1');
  await seite.close();
});

test('Bilder in Inline-SVG werden geprueft: Treffer zensiert (Fassung schon beim Urteil gezeigt), harmlose frei', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  const urteile = await warteAufUrteile(seite, [...TREFFER, ...HARMLOS]);
  const quellen = await seite.evaluate(() => (window as any).__svgQuellen as Record<string, string>);
  for (const [id, b] of urteile) console.log(`svg-inline chromium: ${id} ${b.urteil} (${b.quelle.slice(0, 30)}, opacity ${b.opacity}, filter ${b.filter})`);
  for (const id of TREFFER) {
    const b = urteile.get(id)!;
    expect(b.urteil, id).toBe('zensiert');
    expect(b.quelle, id).toMatch(/^data:image\//);
    expect(b.quelle === quellen[id], `${id}: zensiert, aber Quelle ist das Original`).toBe(false);
  }
  for (const id of HARMLOS) expect(urteile.get(id)!.urteil, id).toBe('frei');
  for (const id of [...TREFFER, ...HARMLOS]) expect(urteile.get(id)!.opacity, id).toBe('1');
  const abweichung = await zensurAbweichung(seite, TREFFER);
  console.log(`svg-inline chromium: Abweichung Probe beim Urteil gegen Fassung ${JSON.stringify(abweichung)}`);
  for (const id of TREFFER) expect(typeof abweichung[id] === 'number' && (abweichung[id] as number) < 3, `${id}: ${abweichung[id]}`).toBe(true);
  expect((await svgWaechter(seite)).aufblitzen).toBe(0);
  await seite.close();
});

test('Umgehungen (SMIL-Wechsel der Quelle, sofort widerrufene blob:-Adresse) sind zu keinem Zeitpunkt frei', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  const gesehen = new Map<string, Set<string>>();
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    for (const b of await lies(seite)) {
      if (!GESPERRT.includes(b.id)) continue;
      if (!gesehen.has(b.id)) gesehen.set(b.id, new Set());
      gesehen.get(b.id)!.add(b.urteil || '-');
    }
    await seite.waitForTimeout(100);
  }
  console.log(`svg-inline chromium: Umgehungen ${JSON.stringify([...gesehen].map(([id, s]) => [id, [...s]]))}`);
  for (const id of GESPERRT) {
    const s = gesehen.get(id) ?? new Set();
    expect(s.has('frei'), `${id} war frei`).toBe(false);
    expect(s.has('zensiert') || s.has('verdeckt'), `${id} ohne Urteil`).toBe(true);
  }
  expect((await svgWaechter(seite)).aufblitzen).toBe(0);
  await seite.close();
});

test('Quellwechsel nach "frei" (href und xlink:href) verbirgt sofort und prueft neu', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  await warteAufUrteile(seite, HARMLOS);
  // Wechsel und Probe im selben Task: der Beobachter (Mikrotask) muss das Urteil vor dem naechsten Zeichnen weggenommen haben.
  const direkt = await seite.evaluate(
    () =>
      new Promise<string[]>((fertig) => {
        const XLINK = 'http://www.w3.org/1999/xlink';
        document.getElementById('i-sfw')!.setAttribute('href', '/testbild/nsfw/IMG_0260.jpg?neu=1');
        document.getElementById('i-sfw-xlink')!.setAttributeNS(XLINK, 'xlink:href', '/testbild/nsfw/IMG_0260.jpg?neu=2');
        requestAnimationFrame(() =>
          fertig(['i-sfw', 'i-sfw-xlink'].map((id) => `${document.getElementById(id)!.getAttribute('data-veil') ?? ''}|${getComputedStyle(document.getElementById(id)!).opacity}`)),
        );
      }),
  );
  console.log(`svg-inline chromium: nach Wechsel im naechsten Frame ${direkt.join(', ')}`);
  for (const d of direkt) expect(d).toBe('|0');
  await expect
    .poll(async () => (await lies(seite)).filter((b) => HARMLOS.includes(b.id)).map((b) => b.urteil).join(','), { timeout: 20_000 })
    .toBe('zensiert,zensiert');
  expect((await svgWaechter(seite)).aufblitzen).toBe(0);
  await seite.close();
});

test('Quellwechsel nur an xlink:href waehrend "zensiert": eigene Fassung geht sofort weg, neue Quelle wird geprueft', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  await warteAufUrteile(seite, ['i-xlink']);
  expect((await lies(seite)).find((b) => b.id === 'i-xlink')!.urteil).toBe('zensiert');
  const direkt = await seite.evaluate(
    () =>
      new Promise<string>((fertig) => {
        const el = document.getElementById('i-xlink')!;
        el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '/synthetisch/7.png');
        requestAnimationFrame(() => fertig(`${el.getAttribute('data-veil') ?? ''}|${getComputedStyle(el).opacity}|${el.hasAttribute('href')}`));
      }),
  );
  console.log(`svg-inline chromium: xlink-Wechsel im Zustand zensiert, naechster Frame ${direkt}`);
  expect(direkt).toBe('|0|false');
  await expect.poll(async () => (await lies(seite)).find((b) => b.id === 'i-xlink')!.urteil, { timeout: 15_000 }).toBe('frei');
  const b = (await lies(seite)).find((x) => x.id === 'i-xlink')!;
  expect(b.hatHref).toBe(false);
  expect(b.xlink).toBe('/synthetisch/7.png');
  await seite.close();
});

test('Pause gibt alle SVG-Bilder frei und stellt die Originale her, danach wieder beurteilt', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await oeffne();
  const vorher = await warteAufUrteile(seite, ALLE);
  try {
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
    const quellen = await seite.evaluate(() => (window as any).__svgQuellen as Record<string, string>);
    const inPause = await lies(seite);
    expect(inPause.length).toBe(ALLE.length);
    for (const b of inPause) {
      expect(b.urteil, b.id).toBe('');
      expect(b.opacity, b.id).toBe('1');
      expect(b.filter, b.id).toBe('none');
      expect(b.quelle === quellen[b.id], `${b.id}: Original nicht zurueck`).toBe(true);
    }
    // Bilder mit xlink:href: die eigene href ist ganz weg, xlink:href unberuehrt.
    const xlink = inPause.find((b) => b.id === 'i-xlink')!;
    expect(xlink.hatHref).toBe(false);
    expect(xlink.xlink).toBe('/testbild/nsfw/IMG_0260.jpg');
  } finally {
    await setze({ pause: false });
  }
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBeNull();
  const danach = await warteAufUrteile(seite, ALLE);
  for (const id of TREFFER) expect(danach.get(id)!.urteil, id).toBe(vorher.get(id)!.urteil);
  for (const id of GESPERRT) expect(danach.get(id)!.urteil, id).not.toBe('frei');
  await seite.close();
});

// Eigenstaendiges SVG-Dokument (oben im Tab): Versteck-Regel und Schleier wirken auch dort, und die Pause gibt frei, obwohl das
// Wurzelelement svg ist (Ausnahme in style.css als :root[data-veil-seite="aus"]).
test('Eigenstaendiges SVG-Dokument: geprueft, Pause gibt frei und stellt her', async () => {
  test.skip(!testbilder, 'ohne Testbilder');
  const seite = await context.newPage();
  await seite.goto(`${basis}/svg-dokument.svg`);
  const liesDok = () =>
    seite.evaluate(() =>
      [...document.querySelectorAll('image')].map((el) => ({
        id: el.id,
        urteil: el.getAttribute('data-veil') ?? '',
        quelle: el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '',
        opacity: getComputedStyle(el).opacity,
      })),
    );
  await expect.poll(async () => (await liesDok()).map((b) => b.urteil).join(','), { timeout: 20_000 }).toBe('zensiert,frei');
  // Hide-first auch hier: vor dem Urteil verborgen (mindestens eine Probe), nie ohne Urteil sichtbar (Waechter in svg-dokument.svg).
  const w = await seite.evaluate(() => ({ aufblitzen: (window as any).__svgAufblitzen as number, verborgen: (window as any).__svgVerborgen as number }));
  console.log(`svg-inline chromium: SVG-Dokument Waechter ${JSON.stringify(w)}`);
  expect(w.aufblitzen).toBe(0);
  expect(w.verborgen).toBeGreaterThan(0);
  try {
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.getAttribute('data-veil-seite')), { timeout: 5000 }).toBe('aus');
    const inPause = await liesDok();
    console.log(`svg-inline chromium: SVG-Dokument in der Pause ${JSON.stringify(inPause.map((b) => [b.id, b.urteil, b.opacity, b.quelle.slice(0, 25)]))}`);
    expect(inPause.map((b) => `${b.id}|${b.urteil}|${b.opacity}|${b.quelle}`)).toEqual(['d-href||1|/testbild/nsfw/IMG_0260.jpg', 'd-sfw||1|/synthetisch/3.png']);
  } finally {
    await setze({ pause: false });
  }
  await expect.poll(async () => (await liesDok()).map((b) => b.urteil).join(','), { timeout: 20_000 }).toBe('zensiert,frei');
  await seite.close();
});

// SMIL-Umgehungen nach dem Urteil (Pruefer Runde 2): eine vorhandene Animation umlenken und starten, eine Animation einfuegen, dem Bild spaeter die
// id geben, auf die eine Animation zielt. Danach ist das Bild schon im naechsten Frame nicht mehr frei und wird verdeckt, nie wieder frei.
for (const [art, id] of [['umlenken', 'i-umlenken'], ['spaet', 'i-spaet'], ['id', 'i-id']] as const) {
  test(`SMIL-Umgehung nach "frei" (${art}): sofort nicht mehr frei, dann verdeckt`, async () => {
    test.skip(!testbilder, 'ohne Testbilder');
    const seite = await context.newPage();
    await seite.goto(`${basis}/svg-inline-smil.html`);
    await expect
      .poll(() => seite.evaluate(() => [...document.querySelectorAll('image')].map((e) => e.getAttribute('data-veil') ?? '').join(',')), { timeout: 20_000 })
      .toBe('frei,frei,frei');
    const direkt = await seite.evaluate(
      ([a, i]) =>
        new Promise<string>((fertig) => {
          (window as any).umgehe(a);
          requestAnimationFrame(() => {
            const el = document.getElementById(i) ?? document.querySelector('.ohne-id');
            fertig(`${el?.getAttribute('data-veil') ?? ''}|${el ? getComputedStyle(el).opacity : ''}`);
          });
        }),
      [art, id] as const,
    );
    console.log(`svg-inline chromium: SMIL ${art}, naechster Frame ${direkt}`);
    expect(direkt.startsWith('frei|')).toBe(false);
    const gesehen = new Set<string>();
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      gesehen.add(await seite.evaluate((i) => document.getElementById(i)?.getAttribute('data-veil') ?? '', id));
      await seite.waitForTimeout(100);
    }
    console.log(`svg-inline chromium: SMIL ${art}, danach ${[...gesehen].join(',')}`);
    expect(gesehen.has('frei'), `${id} wieder frei`).toBe(false);
    expect(await seite.evaluate((i) => document.getElementById(i)?.getAttribute('data-veil') ?? '', id)).toBe('verdeckt');
    await seite.close();
  });
}
