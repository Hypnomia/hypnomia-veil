import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Schleier-Tests (PHASE-2-BAUPLAN Abschnitt 5, Punkt 8). Ohne Erkenner bleibt alles "verdeckt, wartet":
// die Tests mit Urteil werden erst mit dem Erkenner aus Auftrag A gruen und sind nicht aufgeweicht.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;

interface Status {
  start: number;
  gesamt: number;
  offen: number;
  frei: number;
  zensiert: number;
  verdeckt: number;
  fehler: number;
  sichtbarFreiMs: number | null;
  seiteFreiMs: number | null;
}

let profil: string;
let context: BrowserContext;
let worker: Worker;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-schleier-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

// Setzt Einstellungen im Service Worker (Teilobjekt wird in die gespeicherten Einstellungen gemischt).
async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

async function zuruecksetzen() {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.remove('einstellungen');
  });
}

async function status(seite: Page): Promise<Status | null> {
  return seite.evaluate(() => {
    const roh = document.documentElement.dataset.veilStatus;
    return roh ? (JSON.parse(roh) as Status) : null;
  });
}


// Waechter (tests/fixtures/waechter.js): Aufblitzen = sichtbar ohne Urteil, unsichtbar = Urteil, aber nicht opacity 1.
async function waechter(seite: Page): Promise<{ aufblitzen: number; unsichtbar: number; wer: string[] }> {
  return seite.evaluate(() => ({
    aufblitzen: (window as any).__aufblitzen as number,
    unsichtbar: (window as any).__unsichtbar as number,
    wer: (window as any).__wer as string[],
  }));
}

// Wartet, bis genau n Elemente verfolgt und alle beurteilt sind (das Statusattribut meldet am Anfang 0 von 0).
async function warteBeurteilt(seite: Page, n: number) {
  await expect
    .poll(async () => {
      const s = await status(seite);
      return s ? `${s.gesamt}/${s.offen}` : '';
    }, { timeout: 40_000, intervals: [100] })
    .toBe(`${n}/0`);
}

test.beforeEach(async () => {
  await zuruecksetzen();
});

test('a) vor der Beurteilung opacity 0, danach jedes Bild frei oder zensiert', async () => {
  const seite = await context.newPage();
  const t0 = Date.now();
  await seite.goto(`${basis}/schleier.html`);
  // Vor dem Urteil: Bilder unsichtbar (der Waechter hat nichts gesehen).
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  // Die lazy-Bilder laden erst beim Scrollen.
  await seite.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await warteBeurteilt(seite, 16);
  const s = (await status(seite))!;
  expect(s.frei + s.zensiert).toBe(16);
  expect(s.verdeckt).toBe(0);
  const ohne = await seite.evaluate(() => [...document.querySelectorAll('img')].filter((i) => !['frei', 'zensiert'].includes(i.dataset.veil ?? '')).length);
  expect(ohne).toBe(0);
  const proben = await seite.evaluate(() => (window as any).__proben as number);
  const w = await waechter(seite);
  console.log(`chromium: ${proben} Proben, ${w.aufblitzen} Aufblitzen, ${w.unsichtbar} faelschlich unsichtbar`, w.wer);
  expect(w.aufblitzen).toBe(0);
  expect(w.unsichtbar).toBe(0);
  await expect.poll(async () => (await status(seite))?.sichtbarFreiMs, { timeout: 10_000 }).not.toBeNull();
  console.log(`chromium: sichtbarFreiMs ${(await status(seite))!.sichtbarFreiMs} (Test dauerte ${Date.now() - t0} ms), frei ${s.frei}, zensiert ${s.zensiert}`);
  await seite.close();
});

test('b) Bilder in offener und geschlossener Shadow Root, Inline-Hintergrund und picture werden beurteilt', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier.html`);
  await expect
    .poll(async () => (await seite.evaluate(() => document.getElementById('shadow-offen')!.shadowRoot!.querySelector('img')!.dataset.veil)) ?? '', { timeout: 30_000 })
    .toMatch(/^(frei|zensiert)$/);
  await expect
    .poll(() => seite.evaluate(() => document.getElementById('hg')!.dataset.veil ?? ''), { timeout: 30_000 })
    .toMatch(/^(frei|zensiert)$/);
  await expect
    .poll(() => seite.evaluate(() => document.getElementById('pic')!.dataset.veil ?? ''), { timeout: 30_000 })
    .toMatch(/^(frei|zensiert)$/);
  // Die geschlossene Wurzel ist von der Seite aus nicht lesbar: der Status zaehlt ihr Bild mit.
  await expect
    .poll(async () => {
      const s = await status(seite);
      return s ? s.frei + s.zensiert : 0;
    }, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(8);
  const s = (await status(seite))!;
  expect(s.gesamt).toBe(16);
  // Geschlossene Wurzel: 4 Bilder, offene Wurzel, geschlossene Wurzel, Hintergrund, picture = 8 im Startausschnitt, die 8 lazy-Bilder noch offen.
  expect(s.offen).toBeLessThanOrEqual(8);
  await seite.close();
});

test('c) eigene Ausnahme: Seite aus, opacity 1 ohne Wartezeit', async () => {
  await setze({ ausnahmen: ['127.0.0.1'] });
  const seite = await context.newPage();
  const t0 = Date.now();
  await seite.goto(`${basis}/ausnahme.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 3000 }).toBe('aus');
  const frei = await seite.evaluate(() => [...document.querySelectorAll('img')].every((i) => getComputedStyle(i).opacity === '1'));
  expect(frei).toBe(true);
  const ohneAttribut = await seite.evaluate(() => document.querySelectorAll('[data-veil]').length);
  expect(ohneAttribut).toBe(0);
  console.log(`chromium: Ausnahme nach ${Date.now() - t0} ms (inklusive Laden der Seite)`);
  // Ausnahme wieder entfernen: die Seite wird beurteilt.
  await setze({ ausnahmen: [] });
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBeNull();
  await seite.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await warteBeurteilt(seite, 16);
  await seite.close();
});

test('d) Pause: alles sichtbar, Pause aus: wieder beurteilt', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier.html`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await seite.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await warteBeurteilt(seite, 16);
  await setze({ pause: true });
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 3000 }).toBe('aus');
  const sichtbar = await seite.evaluate(() => [...document.querySelectorAll('img')].every((i) => getComputedStyle(i).opacity === '1'));
  expect(sichtbar).toBe(true);
  expect(await seite.evaluate(() => document.querySelectorAll('[data-veil]').length)).toBe(0);
  // Auch das Bild in der offenen Shadow Root ist in der Pause sichtbar (die Stile in den Wurzeln sind abgeschaltet).
  expect(await seite.evaluate(() => getComputedStyle(document.getElementById('shadow-offen')!.shadowRoot!.querySelector('img')!).opacity)).toBe('1');
  // Originale stehen wieder: keine Data-URL in einer src.
  expect(await seite.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:')).length)).toBe(0);
  await setze({ pause: false });
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 3000 }).toBeNull();
  await warteBeurteilt(seite, 16);
  const s = (await status(seite))!;
  expect(s.frei + s.zensiert).toBe(s.gesamt);
  // Nach der Pause hat die Wurzel ihren Schleier zurueck: das Bild dort traegt wieder ein Urteil und ist sichtbar.
  expect(await seite.evaluate(() => document.getElementById('shadow-offen')!.shadowRoot!.querySelector('img')!.dataset.veil)).toMatch(/^(frei|zensiert)$/);
  await seite.close();
});

test('e) Testhaken veil-test schreibt Einstellungen, Strict gibt die Seite frei', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier.html`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await seite.evaluate(() => {
    document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ einstellungen: { strict: true } }) }));
  });
  await expect.poll(() => worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen?.strict ?? null), { timeout: 5000 }).toBe(true);
  await expect.poll(() => seite.evaluate(() => document.documentElement.hasAttribute('data-veil-strict')), { timeout: 3000 }).toBe(true);
  // Neu laden: Strict ab dem Start, die Seite wird nach der Beurteilung des Startausschnitts (hoechstens 4 s) freigegeben.
  await seite.goto(`${basis}/schleier.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 8000 }).toBe('frei');
  await expect.poll(async () => (await status(seite))?.seiteFreiMs, { timeout: 3000 }).not.toBeNull();
  const s = (await status(seite))!;
  console.log(`chromium: Strict, seiteFreiMs ${s.seiteFreiMs}`);
  expect(s.seiteFreiMs).not.toBeNull();
  // Deutlich unter der Obergrenze von 4 s: die Seite wartet auf die Beurteilung des Startausschnitts, nicht auf den Ablauf der Frist.
  expect(s.seiteFreiMs!).toBeLessThan(2500);
  // Vorher war die Seite unsichtbar (html opacity 0 bei data-veil-strict ohne data-veil-seite) und nie faelschlich sichtbar; jetzt ist sie frei.
  const strict = await seite.evaluate(() => ({ gesehen: (window as any).__strictGesehen as number, offen: (window as any).__strictOffen as number }));
  expect(strict.gesehen).toBeGreaterThan(0);
  expect(strict.offen).toBe(0);
  expect(await seite.evaluate(() => getComputedStyle(document.documentElement).opacity)).toBe('1');
  await seite.close();
});

// Fotos vom Testserver (nie im Repo): same-origin, fremder Ursprung mit und ohne CORS, Klassen-Hintergrund, Karussell, spaet eingefuegtes Bild.
for (const satz of ['sfw', 'nsfw'] as const) {
  test(`f) Fotos (${satz}): alles beurteilt, nichts blitzt auf, Zensur tauscht die Quelle, Pause stellt wieder her`, async () => {
    const seite = await context.newPage();
      await seite.goto(`${basis}/schleier-fotos.html?satz=${satz}`);
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.fotosBereit ?? null), { timeout: 10_000 }).toBe('1');
    // 8 Fotos, 2 fremde, Karussell, spaetes Bild, Klassen-Hintergrund (nach load) = 13
    await expect
      .poll(async () => {
        const s = await status(seite);
        return s ? `${s.gesamt}/${s.offen}` : '';
      }, { timeout: 40_000, intervals: [100] })
      .toBe('13/0');
    await expect.poll(async () => (await status(seite))?.sichtbarFreiMs, { timeout: 10_000 }).not.toBeNull();
    const s = (await status(seite))!;
    console.log(`chromium ${satz}: frei ${s.frei}, zensiert ${s.zensiert}, verdeckt ${s.verdeckt}, fehler ${s.fehler}, sichtbarFreiMs ${s.sichtbarFreiMs}`);
    expect((await waechter(seite)).aufblitzen).toBe(0);
    const zensiertesBild = await seite.evaluate(() => {
      const z = [...document.querySelectorAll('img[data-veil="zensiert"]')] as HTMLImageElement[];
      return { anzahl: z.length, alleData: z.every((i) => i.src.startsWith('data:image/jpeg')), ohneSrcset: z.every((i) => !i.hasAttribute('srcset')) };
    });
    expect(zensiertesBild.alleData).toBe(true);
    // Der Klassen-Hintergrund bleibt nach dem Urteil sichtbar (auch wenn er zensiert wurde und ein Inline-Hintergrund dazukam).
    expect(await seite.evaluate(() => getComputedStyle(document.getElementById('klasse')!).opacity)).toBe('1');
    const w = await waechter(seite);
    expect(w.unsichtbar).toBe(0);
    if (satz === 'nsfw') {
      expect(s.zensiert).toBeGreaterThan(0);
      expect(zensiertesBild.anzahl).toBeGreaterThan(0);
    } else {
      expect(s.verdeckt).toBe(0);
    }
    // Karussell: das Bild nach dem Wechsel ist beurteilt, das urspruengliche (Adresse 11) wurde nie als Urteil festgehalten.
    expect(await seite.evaluate(() => document.getElementById('karussell')!.dataset.veil)).toMatch(/^(frei|zensiert)$/);
    // Pause: Originale zurueck.
    await setze({ pause: true });
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 3000 }).toBe('aus');
    expect(await seite.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:')).length)).toBe(0);
    expect(await seite.evaluate(() => document.querySelectorAll('[data-veil]').length)).toBe(0);
    expect(await seite.evaluate(() => document.getElementById('klasse')!.style.backgroundImage)).toBe('');
    // Pause aus: dieselben Urteile kommen (aus dem Zwischenspeicher) zurueck.
    await setze({ pause: false });
    await warteBeurteilt(seite, 13);
    const danach = (await status(seite))!;
    expect(danach.zensiert).toBe(s.zensiert);
    await seite.close();
  });
}

test('g) Popup: Pause, Regler, Stil, Strict und Zonen schreiben in storage.local', async () => {
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 700 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('#status')).toContainText('Nothing to veil');
  const lese = () =>
    worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen ?? {});
  // Pause
  await popup.click('#pause');
  await expect(popup.locator('#pause')).toHaveText('Let Mia back in');
  await expect(popup.locator('#status')).toContainText('Paused');
  expect((await lese()).pause).toBe(true);
  await popup.click('#pause');
  await expect(popup.locator('#pause')).toHaveText('Pause Mia');
  expect((await lese()).pause).toBe(false);
  // Mia's mood: Grenzen 0,10 bis 0,25
  await popup.locator('#stimmung').fill('0.25');
  await expect.poll(async () => (await lese()).schwelle).toBe(0.25);
  await expect(popup.locator('#stimmung-wert')).toHaveText('0.25');
  // Stil
  await popup.locator('input[name="stil"][value="blur"]').check({ force: true });
  await expect.poll(async () => (await lese()).stil).toBe('blur');
  // Strict
  await popup.locator('#strict').check({ force: true });
  await expect.poll(async () => (await lese()).strict).toBe(true);
  // Zone Augen an, Brust "also covered" an
  await popup.locator('input[data-zone="eyes"]').check({ force: true });
  await expect.poll(async () => (await lese()).zonen?.eyes?.an).toBe(true);
  await popup.locator('input[data-bedeckt="breast"]').check({ force: true });
  await expect.poll(async () => (await lese()).zonen?.breast?.bedeckt).toBe(true);
  // Zehn Zonen, "also covered" nur bei den sechs bedeckbaren
  expect(await popup.locator('input[data-zone]').count()).toBe(10);
  expect(await popup.locator('input[data-bedeckt]').count()).toBe(6);
  expect(await popup.evaluate(() => document.body.getBoundingClientRect().width)).toBe(320);
  await popup.close();
});

// Seite mit strenger Content-Security-Policy (kein data:, keine Inline-Stile): nichts darf aufblitzen, auch nicht in der Shadow Root.
// Das zensierte Bild (Data-URL) kann dort nicht geladen werden: der Schleier faellt auf "verdeckt" (Blur) zurueck.
for (const satz of ['sfw', 'nsfw'] as const) {
  test(`h) strenge CSP (${satz}): nichts blitzt auf, alles bekommt ein Urteil`, async () => {
    const seite = await context.newPage();
    await seite.goto(`${basis}/schleier-csp.html?satz=${satz}`);
    await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.fotosBereit ?? null), { timeout: 10_000 }).toBe('1');
    await warteBeurteilt(seite, 5);
    const s = (await status(seite))!;
    console.log(`chromium CSP ${satz}: frei ${s.frei}, zensiert ${s.zensiert}, verdeckt ${s.verdeckt}`);
    const w = await waechter(seite);
    expect(w.aufblitzen).toBe(0);
    expect(w.unsichtbar).toBe(0);
    await seite.close();
  });
}

test('i) Canvas und Video: lesbar und ohne Treffer werden freigegeben, kleine Canvas sofort, Video ohne Daten unscharf statt unsichtbar', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-medien.html`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 15_000 }).toBe('1');
  // Canvas, kleines Canvas, Video, Video mit preload none = 4. Das letzte hat nach load keine Daten und wird nach der Nachfrist unscharf gezeigt.
  await warteBeurteilt(seite, 4);
  const s = (await status(seite))!;
  console.log(`chromium Medien: frei ${s.frei}, zensiert ${s.zensiert}, verdeckt ${s.verdeckt}`);
  expect(s.frei).toBe(3);
  expect(s.verdeckt).toBe(1);
  expect(await seite.evaluate(() => ['zeichnung', 'klein', 'film', 'film-leer'].map((id) => document.getElementById(id)!.dataset.veil))).toEqual(['frei', 'frei', 'frei', 'verdeckt']);
  // Sichtbar (opacity 1), aber unscharf.
  const leer = await seite.evaluate(() => {
    const st = getComputedStyle(document.getElementById('film-leer')!);
    return { opacity: st.opacity, filter: st.filter };
  });
  expect(leer.opacity).toBe('1');
  expect(leer.filter).toContain('blur');
  // Beim Abspielen kommen Daten (loadeddata): richtig geprueft, dann frei.
  await seite.evaluate(() => (window as any).filmLeerStarten());
  await expect.poll(() => seite.evaluate(() => document.getElementById('film-leer')!.dataset.veil ?? ''), { timeout: 20_000 }).toBe('frei');
  const w = await waechter(seite);
  expect(w.aufblitzen).toBe(0);
  expect(w.unsichtbar).toBe(0);
  await seite.close();
});

// Klassen-Hintergrund mit Zensur: das Element bekommt data-veil="zensiert" und bleibt samt Text sichtbar (opacity 1).
test('j) Klassen-Hintergrund wird zensiert und bleibt sichtbar (nsfw)', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-fotos.html?satz=nsfw`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.fotosBereit ?? null), { timeout: 10_000 }).toBe('1');
  await warteBeurteilt(seite, 13);
  // Ein Foto, das der Erkenner zensiert hat: sein Pfad dient als Hintergrund eines neuen Klassen-Elements.
  const pfad = await seite.evaluate(() => (document.querySelector('img[data-veil="zensiert"][data-pfad]') as HTMLElement | null)?.dataset.pfad ?? null);
  expect(pfad).not.toBeNull();
  await seite.evaluate((p) => (window as any).fuegeKlasseEin(p), pfad);
  await expect.poll(() => seite.evaluate(() => document.getElementById('klasse2')?.dataset.veil ?? ''), { timeout: 30_000 }).toBe('zensiert');
  const k = await seite.evaluate(() => {
    const e = document.getElementById('klasse2')!;
    return { opacity: getComputedStyle(e).opacity, bg: e.style.backgroundImage.startsWith('url("data:image/jpeg'), text: e.textContent };
  });
  expect(k.opacity).toBe('1');
  expect(k.bg).toBe(true);
  expect(k.text).toBe('Text im Klassen-Hintergrund');
  const w = await waechter(seite);
  expect(w.unsichtbar).toBe(0);
  // Pause: Original zurueck, Attribut weg.
  await setze({ pause: true });
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 3000 }).toBe('aus');
  expect(await seite.evaluate(() => [document.getElementById('klasse2')!.style.backgroundImage, document.getElementById('klasse2')!.dataset.veil ?? ''])).toEqual(['', '']);
  await seite.close();
});

// Fehlerpfade des Nachladens (Entscheidung 21): fremder Klassen-Hintergrund auf dem zweiten Ursprung.
// nurReferer: der Erkenner bekommt erst 403, setzt die Referer-Regel und wird beurteilt. immer403: jeder Abruf scheitert, das Element
// bleibt nach dem zweiten Versuch verdeckt (unscharf). Die Wartezeit des zweiten Versuchs verkuerzt das Ereignis veil-test (nur Testbau).
for (const modus of ['nurReferer', 'immer403'] as const) {
  test(`k) Fehlerpfad ${modus}: fremder Klassen-Hintergrund`, async () => {
    const seite = await context.newPage();
    await seite.goto(`${basis}/schleier-fehler.html?modus=${modus}`);
    await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
    await seite.evaluate(() => {
      document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ zweiterVersuchMs: 1500 }) }));
    });
    await seite.evaluate(() => (window as any).fuegeEin());
    const feld = () =>
      seite.evaluate(() => {
        const e = document.getElementById('fremd')!;
        const st = getComputedStyle(e);
        return { veil: e.dataset.veil ?? '', opacity: st.opacity, filter: st.filter, nurHg: e.hasAttribute('data-veil-hg'), bild: st.backgroundImage, text: e.textContent };
      });
    const zeile = async () => {
      const s = await status(seite);
      return s ? `${s.gesamt}/${s.offen}/${s.fehler}/${s.verdeckt}` : '';
    };
    if (modus === 'nurReferer') {
      // Beurteilt, ohne Fehler und ohne Verdeckung.
      await expect.poll(zeile, { timeout: 30_000, intervals: [100] }).toBe('1/0/0/0');
      expect((await status(seite))!.frei + (await status(seite))!.zensiert).toBe(1);
      expect((await feld()).filter).toBe('none');
    } else {
      // Erster Fehler: das Element ist noch nicht verdeckt, ein zweiter Versuch ist geplant.
      await expect.poll(async () => (await zeile()).startsWith('1/1/1/0'), { timeout: 30_000, intervals: [50] }).toBe(true);
      expect((await feld()).veil).toBe('');
      // Nach dem zweiten Versuch endgueltig verdeckt: ein Klassen-Hintergrund verliert nur den Hintergrund, Element und Text bleiben
      // sichtbar und scharf (kein Blur ueber den ganzen Inhalt).
      await expect.poll(zeile, { timeout: 30_000, intervals: [100] }).toBe('1/0/2/1');
      const f = await feld();
      expect(f.veil).toBe('verdeckt');
      expect(f.nurHg).toBe(true);
      expect(f.opacity).toBe('1');
      expect(f.filter).toBe('none');
      expect(f.bild).toBe('none');
      expect(f.text).toBe('Fremder Hintergrund');
    }
    expect((await waechter(seite)).unsichtbar).toBe(0);
    await seite.close();
  });
}

// Eigene Ausnahmen gelten je Tab: Seite auf localhost, Rahmen auf 127.0.0.1. Die Ausnahme "localhost" trifft die Adresse des Tabs,
// der Hintergrund liefert sie ueber `tab` an den Rahmen.
test('l) Ausnahme gilt je Tab, auch im eingebetteten Rahmen', async () => {
  await setze({ ausnahmen: ['localhost'] });
  const seite = await context.newPage();
  await seite.goto(`http://localhost:${port}/rahmen.html`);
  const rahmen = () => seite.frames().find((f) => f.url().includes('127.0.0.1'));
  const rahmenSeite = async () => {
    const f = rahmen();
    return f ? f.evaluate(() => document.documentElement.dataset.veilSeite ?? null) : 'kein Rahmen';
  };
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 5000 }).toBe('aus');
  await expect.poll(rahmenSeite, { timeout: 8000 }).toBe('aus');
  expect(await rahmen()!.evaluate(() => [...document.querySelectorAll('img')].every((i) => getComputedStyle(i).opacity === '1'))).toBe(true);
  // Gegenprobe: ohne Ausnahme beurteilt der Rahmen seine Bilder.
  await setze({ ausnahmen: [] });
  await expect.poll(rahmenSeite, { timeout: 5000 }).toBeNull();
  await seite.close();
});

// Hintergrund ueber CSS-Variablen (Kurzform und Langform): die Langform des Style-Objekts liest leer, das Element muss trotzdem
// beurteilt werden. Ein zensiertes Foto (nsfw) beweist, dass wirklich geprueft wurde: ohne Beurteilung bliebe der Hintergrund unveraendert.
test('m) Hintergrund per var(): wird beurteilt und zensiert, Pause stellt wieder her (nsfw)', async () => {
  const quelle = await context.newPage();
  await quelle.goto(`${basis}/schleier-fotos.html?satz=nsfw`);
  await expect.poll(() => quelle.evaluate(() => document.documentElement.dataset.fotosBereit ?? null), { timeout: 10_000 }).toBe('1');
  await warteBeurteilt(quelle, 13);
  const pfad = await quelle.evaluate(() => (document.querySelector('img[data-veil="zensiert"][data-pfad]') as HTMLElement | null)?.dataset.pfad ?? null);
  expect(pfad).not.toBeNull();
  await quelle.close();

  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-var.html`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await seite.evaluate((p) => (window as any).fuegeVarEin(p), pfad);
  const lese = () =>
    seite.evaluate(() =>
      ['var-kurz', 'var-lang'].map((id) => {
        const e = document.getElementById(id)!;
        return { veil: e.dataset.veil ?? '', bild: getComputedStyle(e).backgroundImage.startsWith('url("data:image/jpeg'), opacity: getComputedStyle(e).opacity, text: e.textContent };
      }),
    );
  await expect
    .poll(async () => (await lese()).map((e) => e.veil).join(','), { timeout: 30_000, intervals: [100] })
    .toBe('zensiert,zensiert');
  for (const e of await lese()) {
    expect(e.bild).toBe(true);
    expect(e.opacity).toBe('1');
  }
  // Der Status wird mit kleiner Verzoegerung geschrieben: darauf warten, nicht einmal lesen.
  await warteBeurteilt(seite, 2);
  expect((await waechter(seite)).aufblitzen).toBe(0);
  // Pause: der Ursprung steht wieder (Stil-Attribut unveraendert, Hintergrund wieder die Foto-Adresse), das Urteil ist weg.
  await setze({ pause: true });
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null), { timeout: 3000 }).toBe('aus');
  const nach = await seite.evaluate(() =>
    ['var-kurz', 'var-lang'].map((id) => {
      const e = document.getElementById(id)!;
      return { veil: e.dataset.veil ?? '', stil: e.getAttribute('style'), bild: getComputedStyle(e).backgroundImage };
    }),
  );
  for (const e of nach) {
    expect(e.veil).toBe('');
    expect(e.stil).toContain('var(--b)');
    expect(e.bild).toContain('/testbild/nsfw/');
  }
  await seite.close();
});

// Inline-Hintergrund auf einem fensterfuellenden Container, dessen Abruf immer scheitert: nach dem zweiten Versuch faellt nur der
// Hintergrund weg, Element und Text bleiben sichtbar und scharf (vorher: Blur ueber die ganze Seite).
test('n) grosser Inline-Hintergrund-Container: bei Verdeckung nur der Hintergrund weg, kein Blur', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-var.html`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await seite.evaluate(() => {
    document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ zweiterVersuchMs: 1500 }) }));
  });
  await seite.evaluate(() => (window as any).fuegeGrossEin());
  await expect
    .poll(async () => {
      const s = await status(seite);
      return s ? `${s.gesamt}/${s.offen}/${s.fehler}/${s.verdeckt}` : '';
    }, { timeout: 30_000, intervals: [100] })
    .toBe('1/0/2/1');
  const g = await seite.evaluate(() => {
    const e = document.getElementById('gross')!;
    const st = getComputedStyle(e);
    return { veil: e.dataset.veil ?? '', nurHg: e.hasAttribute('data-veil-hg'), opacity: st.opacity, filter: st.filter, bild: st.backgroundImage, text: e.textContent };
  });
  expect(g).toEqual({ veil: 'verdeckt', nurHg: true, opacity: '1', filter: 'none', bild: 'none', text: 'Text im grossen Container' });
  expect((await waechter(seite)).unsichtbar).toBe(0);
  await seite.close();
});

// Tastenkuerzel-Weg: commands.onCommand ruft dieselbe Funktion (schaltePause ohne `an`) wie die Nachricht hintergrund/pause. Die Nachricht
// kommt von einer Erweiterungsseite; zweimal gesendet muss pause hin- und zurueckwechseln, auch bei zwei schnell aufeinanderfolgenden Aufrufen.
test('o) Pause umschalten ohne `an` (Weg des Tastenkuerzels) wechselt hin und zurueck', async () => {
  const id = new URL(worker.url()).host;
  const seite = await context.newPage();
  await seite.goto(`chrome-extension://${id}/popup.html`);
  const pause = () =>
    worker.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen?.pause ?? false) as boolean);
  const umschalten = () =>
    seite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'pause' }) as Promise<{ ok: boolean; pause: boolean }>);
  expect(await pause()).toBe(false);
  expect(await umschalten()).toEqual({ ok: true, pause: true });
  expect(await pause()).toBe(true);
  expect(await umschalten()).toEqual({ ok: true, pause: false });
  expect(await pause()).toBe(false);
  // Zwei Aufrufe gleichzeitig: jeder kehrt den frisch gelesenen Stand um, am Ende steht wieder der Ausgangswert.
  await seite.evaluate(() =>
    Promise.all([1, 2].map(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'pause' }))),
  );
  expect(await pause()).toBe(false);
  await seite.close();
});
