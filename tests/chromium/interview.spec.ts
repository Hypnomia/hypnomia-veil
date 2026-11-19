// Chromium: Interview der Willkommensseite aus den Bausteinen (Phase 11 E4e, Regeln I1 bis I11, I5a, I5b, I8a). Ueber die echte Seite und den echten Speicher.
// I8 (1): ein Durchlauf nur mit "Next" und "Finish" aendert keinen Wert (erster Start und vier gespeicherte Staende, ohne und mit Pack, auch als Wiederholung).
// I8 (2): "Skip the rest" und Schliessen aendern keinen Wert. Jede Frage: waehlen, Speicher lesen, neu laden, Anzeige stimmt. I7: was nicht gefragt wird, bleibt.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STIMMUNG_STUFEN_INTERVIEW, TEXT } from '../../src/einstieg/texte';
import { STIMMUNG_STUFEN } from '../../entrypoints/options/bedienung-texte';
import { STANDARD } from '../../src/einstellungen';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { mitReitern } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';
const url = (seite: string) => `chrome-extension://${id}/${seite}`;
const lies = (s: Page, k: string) => s.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (s: Page, o: Record<string, unknown>) => s.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const entferne = (s: Page, k: string[]) => s.evaluate((k) => (globalThis as any).chrome.storage.local.remove(k), k);

const FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 };
const PACK_OHNE = { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [], bilder: 1, groesse: 1, importiert: 1 };
const PACK_VOLL = { ...PACK_OHNE, freischaltungen: ['stil:mia-patch', 'zensur:sticker', 'erwachsen:vorschau'], sticker: 1 };
const PACK_OHNE_ERW = { ...PACK_OHNE, freischaltungen: ['stil:mia-patch', 'zensur:sticker'], sticker: 1 };

const alleZonen = (an: boolean, bedeckt: boolean) =>
  Object.fromEntries(
    Object.keys(STANDARD.zonen).map((z) => [z, ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'].includes(z) ? { an, bedeckt } : { an }]),
  );
// Die Ausgangsstaende der Rechnung I8 (1): erster Start (nichts gespeichert) und vier gespeicherte Staende.
const STAENDE: Record<string, unknown> = {
  'erster Start': undefined,
  'alle Zonen an und alles unter Kleidung': { version: 1, zonen: alleZonen(true, true) },
  'Zwischenwert der Schwelle mit Strict': { version: 1, schwelle: 0.1049, strict: true },
  'Eye bar mit Pack-Stil': { version: 1, augenbalken: true, preset: 'mia-wort' },
  'ungewohnte Werte, auch nicht gefragte': {
    version: 1,
    ruhig: true,
    preset: 'blur',
    erwachsen: { an: false, stufe: 'explicit', komplettErsatz: true, erkennenAmInhalt: false, eigeneSeiten: ['a.example'] },
    quiz: { verweigern: 0.3, freilegenMs: 7000 },
    kontrolle: { blitz: 'oft', leerlauf: false, cursor: 'aus' },
    ton: { an: true, lautstaerke: 0.45 },
  },
};

async function verwaltung(): Promise<Page> {
  const s = mitReitern(await context.newPage());
  await s.goto(url('hilfe.html'));
  return s;
}

// Zaehlt Schreibaufrufe der Seite (vor dem ersten Laden) und bietet `__echtSet` fuer das Schreiben des Tests.
async function zaehler(s: Page): Promise<void> {
  await s.addInitScript(() => {
    const sl = (globalThis as any).chrome?.storage?.local;
    if (!sl) return;
    sl.__echtSet = sl.set.bind(sl);
    for (const n of ['set', 'remove', 'clear']) {
      const echt = sl[n].bind(sl);
      sl[n] = (...a: unknown[]) => (sessionStorage.setItem('aufrufe', `${sessionStorage.getItem('aufrufe') ?? ''}${n};`), echt(...a));
    }
  });
}
const aufrufe = (s: Page) => s.evaluate(() => sessionStorage.getItem('aufrufe') ?? '');

// Das Interview mit gesetztem Stand: Einstieg fertig, Einstellungen und Pack nach Wunsch, dann `#interview` (Wiederholung).
async function oeffne(v: Page, stand: unknown, pack: unknown | null, breite = 1280, mitZaehler = true): Promise<Page> {
  await schreibe(v, { einstieg: FERTIG });
  await entferne(v, ['einstellungen', 'pack']);
  if (stand !== undefined) await schreibe(v, { einstellungen: stand });
  if (pack) await schreibe(v, { pack });
  const w = mitReitern(await context.newPage());
  if (mitZaehler) await zaehler(w);
  await w.setViewportSize({ width: breite, height: 800 });
  await w.goto(url('willkommen.html#interview'));
  await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
  return w;
}
const karte = (s: Page, gruppe: string, kartenId: string) => s.locator(`#${gruppe} [data-id="${kartenId}"]`);
const stufe = (s: Page, name: string) => s.locator('#iv-stimmung-wahl .v-stufe', { hasText: new RegExp(`^${name}$`) });
const weiter = (s: Page) => s.locator('#iv-weiter').click();
const bisSeite = async (s: Page, n: number) => {
  for (let i = 1; i < n; i++) await weiter(s);
  await expect(s.locator('#schritt')).toHaveAttribute('data-schritt', `interview-${n}`);
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-interview-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});
test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

// ---------- I8 (1) und (2): Durchlauf nur mit Next und Finish, Skip und Schliessen aendern nichts ----------
for (const [name, stand] of Object.entries(STAENDE)) {
  for (const [mit, pack] of [['ohne Pack', null], ['mit Pack', PACK_VOLL]] as const) {
    test(`I8 (1) und (2): Next und Finish, Skip the rest und Schliessen aendern keinen Wert (${name}, ${mit}), Seitenzahl ${mit === 'mit Pack' ? 6 : 4}`, async () => {
      const v = await verwaltung();
      try {
        const erwartet = mit === 'mit Pack' ? 6 : 4;
        // Horcher: jedes Schreibereignis des Speichers (auch ein gleichbleibender Wert waere ein Aufruf in `aufrufe`)
        const w = await oeffne(v, stand, pack);
        const vorher = JSON.stringify((await lies(v, 'einstellungen')) ?? null);
        await expect(w.locator('.iv-schritte li')).toHaveCount(erwartet);
        await expect(w.locator('#fortschritt-text')).toHaveText(TEXT.frageVon(1, erwartet));
        // a) nur Next, dann Finish
        for (let i = 1; i < erwartet; i++) {
          await expect(w.locator('#iv-weiter')).toHaveText(TEXT.weiter);
          await weiter(w);
        }
        await expect(w.locator('#iv-weiter')).toHaveText(TEXT.fertig);
        await weiter(w);
        await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
        expect(JSON.stringify((await lies(v, 'einstellungen')) ?? null), 'Next und Finish').toBe(vorher);
        expect(await aufrufe(w), 'kein Schreibaufruf auf die Einstellungen ausser dem Einstieg').toBe('set;'); // genau ein Aufruf: `einstieg` (Finish)
        // b) Skip the rest auf Seite 2
        const w2 = await oeffne(v, stand, pack, 1280, true);
        await weiter(w2);
        await w2.locator('#iv-ueberspringen').click();
        await expect(w2.locator('#schritt')).toHaveAttribute('data-schritt', 'ende');
        // H3: genau ein Schreibaufruf (`einstieg`), kein `set` der Einstellungen, auch nicht mit unveraendertem Wert
        expect(await aufrufe(w2), 'Skip the rest: nur der Aufruf fuer den Einstieg').toBe('set;');
        expect(JSON.stringify((await lies(v, 'einstellungen')) ?? null), 'Skip the rest').toBe(vorher);
        // c) Schliessen mitten im Interview
        const w3 = await oeffne(v, stand, pack, 1280, true);
        await weiter(w3);
        await weiter(w3);
        expect(await aufrufe(w3), 'vor dem Schliessen: kein Schreibaufruf').toBe('');
        await w3.close();
        await w2.close();
        await w.close();
        expect(JSON.stringify((await lies(v, 'einstellungen')) ?? null), 'Schliessen').toBe(vorher);
      } finally {
        await v.close();
      }
    });
  }
}

// ---------- Jede Frage: waehlen, Speicher lesen, Seite neu laden, Anzeige stimmt; I7 ----------
test('Jede Frage: waehlen, Speicher lesen, neu laden, Anzeige stimmt; nicht gefragte Werte bleiben unveraendert (I7)', async () => {
  const v = await verwaltung();
  try {
    const stand = STAENDE['ungewohnte Werte, auch nicht gefragte'];
    const w = await oeffne(v, stand, PACK_VOLL);
    const einst = async () => (await lies(v, 'einstellungen')) ?? {};
    const nichtGefragt = (e: any) => ({
      ersatz: e.erwachsen.komplettErsatz,
      inhalt: e.erwachsen.erkennenAmInhalt,
      seiten: e.erwachsen.eigeneSeiten,
      quiz: e.quiz,
      leerlauf: e.kontrolle.leerlauf,
      cursor: e.kontrolle.cursor,
      ton: e.ton,
    });
    const rest0 = nichtGefragt(await einst());
    // 1 Zones: "Everything"
    await karte(w, 'iv-zonen-wahl', 'alles').click();
    await expect.poll(async () => Object.values((await einst()).zonen).every((z: any) => z.an)).toBe(true);
    await w.reload();
    await expect(karte(w, 'iv-zonen-wahl', 'alles')).toHaveAttribute('aria-checked', 'true');
    await weiter(w);
    // 2 Clothes: "Under clothes too"
    await karte(w, 'iv-kleidung-frage', 'auch-bedeckt').click();
    await expect.poll(async () => (await einst()).zonen.feet.bedeckt).toBe(true);
    await w.reload();
    await expect(karte(w, 'iv-kleidung-frage', 'auch-bedeckt')).toHaveAttribute('aria-checked', 'true');
    await weiter(w);
    // 3 Style: Blur und Eye bar
    await w.locator('label', { has: w.locator('#iv-preset-mosaik') }).click();
    await expect.poll(async () => (await einst()).preset).toBe('mosaik');
    await w.locator('#iv-augenbalken').click();
    await expect.poll(async () => (await einst()).augenbalken).toBe(true);
    await w.reload();
    await expect(w.locator('#iv-preset-mosaik')).toBeChecked();
    await expect(w.locator('#iv-augenbalken')).toBeChecked();
    await weiter(w);
    // 4 Mood: Stufe, genauer Wert, Strict
    await stufe(w, stimmungsWort(0.15)).click();
    await expect.poll(async () => (await einst()).schwelle).toBe(0.15);
    await w.locator('#iv-strict').click();
    await expect.poll(async () => (await einst()).strict).toBe(true);
    await w.reload();
    await expect(stufe(w, stimmungsWort(0.15))).toHaveAttribute('aria-checked', 'true');
    await expect(w.locator('#iv-strict')).toBeChecked();
    await weiter(w);
    // 5 Adult sites: mit Freischaltung Off, Tease, Hot, Explicit
    await expect(w.locator('#iv-erw-wahl [role=radio]')).toHaveCount(4);
    await karte(w, 'iv-erw-wahl', 'tease').click();
    await expect.poll(async () => (await einst()).erwachsen.stufe).toBe('tease');
    expect((await einst()).erwachsen.an).toBe(true);
    await w.reload();
    await expect(karte(w, 'iv-erw-wahl', 'tease')).toHaveAttribute('aria-checked', 'true');
    await weiter(w);
    // 6 Extras: Calm mode und Flash words
    await w.locator('#iv-ruhig').click();
    await expect.poll(async () => (await einst()).ruhig).toBe(false);
    await w.locator('#iv-blitz').selectOption('selten');
    await expect.poll(async () => (await einst()).kontrolle.blitz).toBe('selten');
    await w.reload();
    await expect(w.locator('#iv-ruhig')).not.toBeChecked();
    await expect(w.locator('#iv-blitz')).toHaveValue('selten');
    // I7: nach Durchlauf, Abbruch (Neuladen) und Wiederholung stehen die nicht gefragten Werte wie vorher
    expect(nichtGefragt(await einst())).toEqual(rest0);
    expect(rest0.ersatz).toBe(true);
    expect(rest0.cursor).toBe('aus');
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- I5a: beide Formen der Gruppe der Erwachsenenseiten ----------
test('I5a: mit Freischaltung Off, Tease, Hot, Explicit (Off laesst die Stufe stehen); ohne Freischaltung Off und On waehlbar, Stufen gesperrt und nie markiert, On schreibt nur `an`', async () => {
  const v = await verwaltung();
  try {
    const einst = async () => (await lies(v, 'einstellungen')) ?? {};
    // Mit Freischaltung
    let w = await oeffne(v, { version: 1, erwachsen: { an: true, stufe: 'explicit' } }, PACK_VOLL);
    await bisSeite(w, 5);
    expect(await w.locator('#iv-erw-wahl [role=radio]').evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.id))).toEqual(['off', 'tease', 'hot', 'explicit']);
    await expect(karte(w, 'iv-erw-wahl', 'on')).toHaveCount(0);
    await expect(karte(w, 'iv-erw-wahl', 'explicit')).toHaveAttribute('aria-checked', 'true');
    await karte(w, 'iv-erw-wahl', 'off').click();
    await expect.poll(async () => (await einst()).erwachsen.an).toBe(false);
    expect((await einst()).erwachsen.stufe).toBe('explicit'); // Off laesst die Stufe stehen
    await karte(w, 'iv-erw-wahl', 'hot').click();
    await expect.poll(async () => (await einst()).erwachsen.stufe).toBe('hot');
    expect((await einst()).erwachsen.an).toBe(true);
    await w.close();
    // Pack ohne die Freischaltung `erwachsen:vorschau`
    for (const [pack, name] of [[PACK_OHNE_ERW, 'Pack ohne Freischaltung'], [null, 'kein Pack mehr (nach Seite 1 entfernt)']] as const) {
      w = await oeffne(v, { version: 1, erwachsen: { an: false, stufe: 'explicit' } }, pack ?? PACK_VOLL);
      if (!pack) await entferne(v, ['pack']);
      await bisSeite(w, 5);
      expect(await w.locator('#iv-erw-wahl [role=radio]').evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.id)), name).toEqual(['off', 'on', 'tease', 'hot', 'explicit']);
      for (const g of ['tease', 'hot', 'explicit']) {
        await expect(karte(w, 'iv-erw-wahl', g), `${name}: ${g} gesperrt`).toBeDisabled();
        await expect(karte(w, 'iv-erw-wahl', g), `${name}: ${g} nie markiert`).toHaveAttribute('aria-checked', 'false');
      }
      await expect(karte(w, 'iv-erw-wahl', 'off')).toHaveAttribute('aria-checked', 'true');
      await expect(w.locator('#iv-erw-wahl .v-hinweis')).toHaveText(TEXT.erwachsenGesperrt);
      // Klick, Eingabe und Leertaste auf einer gesperrten Stufe schreiben nichts
      const vorher = JSON.stringify(await einst());
      const n0 = await aufrufe(w);
      await karte(w, 'iv-erw-wahl', 'hot').click({ force: true });
      await karte(w, 'iv-erw-wahl', 'hot').dispatchEvent('keydown', { key: 'Enter' });
      await w.waitForTimeout(300);
      expect(JSON.stringify(await einst()), name).toBe(vorher);
      expect(await aufrufe(w), name).toBe(n0);
      // On schreibt nur `an: true`, die Stufe bleibt; Off nur `an: false`
      await karte(w, 'iv-erw-wahl', 'on').click();
      await expect.poll(async () => (await einst()).erwachsen.an, name).toBe(true);
      expect((await einst()).erwachsen.stufe, `${name}: On laesst die Stufe`).toBe('explicit');
      await expect(karte(w, 'iv-erw-wahl', 'explicit')).toHaveAttribute('aria-checked', 'false');
      await karte(w, 'iv-erw-wahl', 'off').click();
      await expect.poll(async () => (await einst()).erwachsen.an, name).toBe(false);
      expect((await einst()).erwachsen.stufe).toBe('explicit');
      await w.close();
    }
    // Komplett-Ersatz wird nicht gefragt, sein Warnsatz bleibt aber sichtbar, solange er gespeichert an ist (I8 (5))
    w = await oeffne(v, { version: 1, erwachsen: { an: true, stufe: 'hot', komplettErsatz: true } }, PACK_VOLL);
    await bisSeite(w, 5);
    await expect(w.locator('#iv-ersatz-an')).toHaveText(TEXT.ersatzAn);
    expect((await einst()).erwachsen.komplettErsatz).toBe(true);
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- Tastatur: ein Pfeil waehlt nicht ----------
test('Tastatur: Pfeile, Pos1 und Ende bewegen nur den Fokus, Leertaste und Eingabe waehlen', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, undefined, null);
    const vorher = await aufrufe(w);
    await karte(w, 'iv-zonen-wahl', 'koerper').focus();
    for (const t of ['ArrowRight', 'ArrowRight', 'End', 'ArrowLeft', 'Home', 'ArrowDown', 'ArrowUp']) await w.keyboard.press(t);
    await w.keyboard.press('ArrowRight');
    await expect(karte(w, 'iv-zonen-wahl', 'koerper-gesicht')).toBeFocused();
    await w.waitForTimeout(300);
    expect(await aufrufe(w), 'Pfeile schreiben nichts').toBe(vorher);
    expect(await lies(v, 'einstellungen')).toBeUndefined();
    await expect(karte(w, 'iv-zonen-wahl', 'koerper')).toHaveAttribute('aria-checked', 'true'); // gewaehlt ist weiter "Body"
    await w.keyboard.press('Space');
    await expect.poll(async () => (await lies(v, 'einstellungen'))?.zonen?.face?.an).toBe(true);
    await w.keyboard.press('ArrowRight');
    await w.keyboard.press('Enter');
    await expect.poll(async () => Object.values((await lies(v, 'einstellungen')).zonen).every((z: any) => z.an)).toBe(true);
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- G3 und I8a: eine verworfene Handlung schreibt nichts, ein stehender Fehlersatz bleibt ----------
test('I8a: eine verworfene Zonen-Handlung schreibt nichts (auch nicht den unveraenderten Stand), zeigt den gespeicherten Stand und den Hinweis, und ein stehender Fehlersatz verschwindet nicht', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, undefined, null);
    // Erst ein echter Speicherfehler: der Fehlersatz steht
    await w.evaluate(() => {
      const sl = (globalThis as any).chrome.storage.local;
      sl.set = () => {
        sessionStorage.setItem('aufrufe', `${sessionStorage.getItem('aufrufe') ?? ''}set;`);
        return Promise.reject(new Error('voll'));
      };
    });
    await stufeFehler(w);
    await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
    // Nun aendert sich der Stand von aussen und im selben Augenblick klickt die Person auf eine Karte (vor dem Ereignis des Speichers)
    await w.evaluate((neu) => {
      const sl = (globalThis as any).chrome.storage.local;
      void sl.__echtSet({ einstellungen: neu });
      (document.querySelector('#iv-zonen-wahl [data-id="koerper-gesicht"]') as HTMLElement).click();
    }, { version: 1, zonen: alleZonen(true, true) });
    await expect(w.locator('#iv-zonen-verworfen')).toBeVisible();
    await expect(w.locator('#iv-zonen-verworfen')).toHaveText(TEXT.zonenVerworfen);
    // nichts geschrieben: `set` wurde fuer die verworfene Handlung nicht gerufen (der Wert des Tests lief ueber __echtSet)
    expect(((await aufrufe(w)).match(/set;/g) ?? []).length, 'Schreibaufrufe: nur der gescheiterte der ersten Handlung').toBe(1);
    const z = (await lies(v, 'einstellungen')).zonen;
    expect(Object.values(z).every((x: any) => x.an), 'der Stand von aussen, kein zweiter Versuch').toBe(true);
    await expect(karte(w, 'iv-zonen-wahl', 'alles')).toHaveAttribute('aria-checked', 'true'); // der gespeicherte Stand wird angezeigt
    await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN); // RN4: der Fehlersatz bleibt stehen
    await expect(w.locator('#fehler')).toBeVisible();
    await w.close();
  } finally {
    await v.close();
  }
});
async function stufeFehler(w: Page): Promise<void> {
  // Eine Handlung, die scheitert: "Everything" bei gesperrtem Schreiben
  await karte(w, 'iv-zonen-wahl', 'alles').click();
}

// ---------- Layout: Raster und Vorschau ----------
test('Aufbau: Schritte links, Frage in der Mitte, Platz der Vorschau rechts bei 1280 px, schmal untereinander mit der Vorschau ueber der Frage; kein waagrechtes Scrollen, kleinste Trefferhoehe aller Bedienelemente mindestens 44 px auf allen Seiten bei 1280 und 360 px', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, undefined, PACK_VOLL, 1280);
    const lage = () =>
      w.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return { nav: r('.iv-schritte'), karte: r('.iv-karte'), vor: r('.iv-vorschau') };
      });
    let l = await lage();
    expect(l.nav.right).toBeLessThanOrEqual(l.karte.left + 1);
    expect(l.karte.right).toBeLessThanOrEqual(l.vor.left + 1);
    // H4 (N3): kleinste Trefferhoehe auf jeder Seite bei 1280 px (Fenster ist schon so breit), dann bei 360 px
    const kleinste = () =>
      w.evaluate(() =>
        Math.min(
          ...[...document.querySelectorAll<HTMLElement>('#schritt button, #schritt select, #schritt input[type=range]')]
            .filter((e) => e.offsetParent !== null)
            .map((e) => e.getBoundingClientRect().height),
        ),
      );
    const proSeite: Record<string, number[]> = { '1280': [], '360': [] };
    for (let i = 1; i <= 6; i++) {
      proSeite['1280']!.push(await kleinste());
      if (i < 6) await weiter(w);
    }
    for (const h of proSeite['1280']!) expect(h).toBeGreaterThanOrEqual(43.99);
    await w.setViewportSize({ width: 360, height: 800 });
    await w.locator('#iv-zurueck').click();
    for (let i = 5; i > 1; i--) await w.locator('#iv-zurueck').click();
    await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
    l = await lage();
    expect(l.nav.bottom).toBeLessThanOrEqual(l.vor.top + 1);
    expect(l.vor.bottom).toBeLessThanOrEqual(l.karte.top + 1); // der Streifen steht ueber der Frage
    for (let i = 1; i <= 6; i++) {
      await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', `interview-${i}`);
      const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      expect(m.s, `Seite ${i}`).toBeLessThanOrEqual(m.c);
      proSeite['360']!.push(await kleinste());
      if (i < 6) await weiter(w);
    }
    for (const h of proSeite['360']!) expect(h).toBeGreaterThanOrEqual(43.99);
    console.log(`interview Aufbau: kleinste Trefferhoehe je Seite 1280 px ${proSeite['1280']!.map((h) => h.toFixed(1)).join(' ')}, 360 px ${proSeite['360']!.map((h) => h.toFixed(1)).join(' ')}`);
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- Namen der Stimmung wie auf der Einstellungsseite ----------
test('I4: die Stufen der Stimmung im Interview heissen wie auf der Einstellungsseite', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, undefined, null);
    await bisSeite(w, 4);
    const imInterview = await w.locator('#iv-stimmung-wahl .v-stufe').allTextContents();
    const o = mitReitern(await context.newPage());
    await o.goto(url('options.html'));
    await o.waitForSelector('#stimmung-wahl', { state: 'attached' });
    const aufEinstellungen = await o.locator('#stimmung-wahl .v-stufe').allTextContents();
    expect(imInterview).toEqual(aufEinstellungen);
    // H4 (N5): auch die Werte: beide Seiten bauen ihre Stufen aus derselben Liste (Namen UND Werte)
    expect(STIMMUNG_STUFEN_INTERVIEW.stufen).toEqual(STIMMUNG_STUFEN.stufen);
    expect(imInterview).toHaveLength(3);
    await o.close();
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- H1: nach einem Speicherfehler zeigt auch ein Regler mit Fokus den gespeicherten Stand ----------
for (const [richtung, gespeichert, taste] of [['zu weniger Deckung', 0.1, 'ArrowRight'], ['zu mehr Deckung', 0.22, 'ArrowLeft']] as const) {
  test(`H1: Regler "Exact value" mit Fokus, Speichern scheitert (Versuch ${richtung}): Regler, Zahl und Stufe zeigen den gespeicherten Stand, der Fehlersatz steht`, async () => {
    const v = await verwaltung();
    try {
      const w = await oeffne(v, { version: 1, schwelle: gespeichert }, null);
      await bisSeite(w, 4);
      await w.locator('#iv-stimmung-wahl .v-auf-kopf').click();
      await w.evaluate(() => {
        (globalThis as any).chrome.storage.local.set = () => Promise.reject(new Error('voll'));
      });
      const regler = w.locator('#iv-stimmung-wahl input[type=range]');
      await regler.focus();
      for (let i = 0; i < 5; i++) await w.keyboard.press(taste);
      await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
      // ohne Blur: der Regler hat weiter den Fokus und zeigt trotzdem den gespeicherten Stand
      await expect(regler).toBeFocused();
      await expect(regler).toHaveValue(String(gespeichert));
      await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText(String(gespeichert));
      await expect(stufe(w, stimmungsWort(gespeichert))).toHaveAttribute('aria-checked', 'true');
      expect(((await lies(v, 'einstellungen')) ?? {}).schwelle).toBe(gespeichert);
      await w.close();
    } finally {
      await v.close();
    }
  });
}

// ---------- K1 (E4k): je Tastendruck und je Ziehen genau ein Schreibversuch, auch nach einem gescheiterten Speichern ----------
test('K1: Mood-Regler im Interview: je Tastendruck und je Ziehen genau ein Schreibversuch; nach einem gescheiterten Speichern meldet dieselbe Taste wieder genau einen; gelungen: Anzeige gleich Speicher', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, { version: 1, schwelle: 0.15 }, null);
    await bisSeite(w, 4);
    await w.locator('#iv-stimmung-wahl .v-auf-kopf').click();
    await w.evaluate(() => {
      const sl = (globalThis as any).chrome.storage.local;
      const k = ((globalThis as any).__k = { n: 0, kaputt: true });
      sl.set = (o: Record<string, unknown>) => {
        if ('einstellungen' in o) k.n += 1;
        return k.kaputt && 'einstellungen' in o ? Promise.reject(new Error('voll')) : sl.__echtSet(o);
      };
    });
    const n = () => w.evaluate(() => (globalThis as any).__k.n as number);
    const regler = w.locator('#iv-stimmung-wahl input[type=range]');
    await regler.focus();
    for (const taste of ['ArrowLeft', 'ArrowRight']) {
      for (let i = 1; i <= 2; i++) {
        await w.evaluate(() => { const f = document.getElementById('fehler')!; f.textContent = ''; f.hidden = true; });
        const n0 = await n();
        await w.keyboard.press(taste);
        await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
        expect(await n(), `${taste} ${i}: genau ein Schreibversuch`).toBe(n0 + 1);
        await expect(regler).toHaveValue('0.15');
        await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText('0.15');
        await expect(stufe(w, stimmungsWort(0.15))).toHaveAttribute('aria-checked', 'true');
      }
    }
    expect(((await lies(v, 'einstellungen')) ?? {}).schwelle).toBe(0.15);
    await w.evaluate(() => ((globalThis as any).__k.kaputt = false));
    const n1 = await n();
    await w.keyboard.press('ArrowLeft');
    await expect.poll(async () => ((await lies(v, 'einstellungen')) ?? {}).schwelle).toBeCloseTo(0.14, 9);
    await expect(regler).toHaveValue('0.14');
    await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText('0.14');
    expect(await n(), 'gelungen: ein Schreibversuch').toBe(n1 + 1);
    const kasten = (await regler.boundingBox())!;
    for (let i = 1; i <= 2; i++) {
      const vor = await n();
      await w.mouse.move(kasten.x + 10 * i, kasten.y + kasten.height / 2);
      await w.mouse.down();
      await w.mouse.move(kasten.x + 70 * i, kasten.y + kasten.height / 2, { steps: 6 });
      await w.mouse.up();
      await w.waitForTimeout(250);
      expect(await n(), `Ziehen ${i}: genau ein Schreibversuch`).toBe(vor + 1);
    }
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- K2 (E4k): wechselt die Form der Gruppe zwischen Klick und Speichern, wird nichts geschrieben, ein Hinweis erscheint ----------
test('K2: Adult sites im Interview: wechselt die Form der Gruppe zwischen Klick und Speichern, wird nichts geschrieben, der gespeicherte Stand steht da und ein Hinweis erscheint, der bei der naechsten Handlung verschwindet', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, undefined, PACK_OHNE_ERW);
    await bisSeite(w, 5);
    await expect(w.locator('#iv-erw-verworfen')).toBeHidden();
    const alt = await w.evaluateHandle(() => document.querySelector('#iv-erw-wahl [data-id="on"]'));
    await schreibe(v, { pack: PACK_VOLL }); // die Form wechselt: Off, Tease, Hot, Explicit
    await expect(w.locator('#iv-erw-wahl [role=radio]')).toHaveCount(4);
    const vorher = JSON.stringify(await lies(v, 'einstellungen'));
    const n0 = await aufrufe(w);
    await alt.evaluate((e) => (e as HTMLElement).click()); // der Klick auf "On" kommt erst beim Speichern an: dort gilt er nicht mehr
    await expect(w.locator('#iv-erw-verworfen')).toBeVisible();
    await expect(w.locator('#iv-erw-verworfen')).toHaveText(TEXT.erwachsenVerworfen);
    await w.waitForTimeout(300);
    expect(await aufrufe(w), 'die verworfene Wahl schreibt nichts, auch nicht den unveraenderten Stand').toBe(n0);
    expect(JSON.stringify(await lies(v, 'einstellungen'))).toBe(vorher);
    await karte(w, 'iv-erw-wahl', 'tease').click(); // die naechste Handlung nimmt den Hinweis weg
    await expect(w.locator('#iv-erw-verworfen')).toBeHidden();
    await expect.poll(async () => ((await lies(v, 'einstellungen')) ?? {}).erwachsen?.stufe).toBe('tease');
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- K3i (E4k Nachtrag): Loslassen und sofort Tab, waehrend des Speicherns zeichnet der Fokusverlust nicht den alten Stand ----------
test('K3i: Mood-Regler losgelassen und sofort Tab: waehrend des Speicherns nicht der alte Stand; danach Erfolg: neuer Stand, Fehler: gespeicherter Stand und Fehlersatz', async () => {
  for (const art of ['gelingt', 'scheitert'] as const) {
    const v = await verwaltung();
    try {
      const w = await oeffne(v, { version: 1, schwelle: 0.15 }, null);
      await bisSeite(w, 4);
      await w.locator('#iv-stimmung-wahl .v-auf-kopf').click();
      const regler = w.locator('#iv-stimmung-wahl input[type=range]');
      await regler.focus();
      await w.evaluate((art) => {
        const sl = (globalThis as any).chrome.storage.local;
        sl.set = (o: Record<string, unknown>) =>
          'einstellungen' in o
            ? new Promise((r) => setTimeout(r, 900)).then(() => (art === 'scheitert' ? Promise.reject(new Error('voll')) : sl.__echtSet(o)))
            : sl.__echtSet(o);
        const r = document.querySelector('#iv-stimmung-wahl input[type=range]') as HTMLInputElement;
        const g = ((globalThis as any).__gesehen = [r.value]);
        (globalThis as any).__takt = setInterval(() => { if (g.at(-1) !== r.value) g.push(r.value); }, 10);
      }, art);
      await w.keyboard.press('ArrowRight');
      await w.keyboard.press('Tab');
      await w.waitForTimeout(400);
      expect(await regler.inputValue(), `${art}: mitten im Speichern nicht der alte Stand`).toBe('0.16');
      if (art === 'gelingt') {
        await expect.poll(async () => ((await lies(v, 'einstellungen')) ?? {}).schwelle, { timeout: 5000 }).toBeCloseTo(0.16, 9);
        await expect(regler).toHaveValue('0.16');
        await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText('0.16');
        expect(await w.evaluate(() => (globalThis as any).__gesehen), 'nie der alte Stand nach dem Tastendruck').toEqual(['0.15', '0.16']);
      } else {
        await expect(w.locator('#fehler')).toHaveText(FEHLER_SPEICHERN, { timeout: 5000 });
        await expect(regler).toHaveValue('0.15');
        await expect(w.locator('#iv-stimmung-wahl .v-wert')).toHaveText('0.15');
      }
      await w.evaluate(() => clearInterval((globalThis as any).__takt));
      await w.close();
    } finally {
      await v.close();
    }
  }
});

// ---------- L1 (E4k Nachr.): im Interview (Mood) kein Schreibversuch ohne Handlung ----------
test('L1: Interview Mood mit gespeichertem Zwischenwert: Fokus, Tab, Shift, Strg, Taste ohne Wirkung, Daumenklick ohne Bewegung schreiben nichts, der Speicher bleibt Bit fuer Bit', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, { version: 1, schwelle: 0.1051 }, null);
    await bisSeite(w, 4);
    const roh = JSON.stringify(await lies(v, 'einstellungen'));
    const n0 = await aufrufe(w);
    const regler = w.locator('#iv-stimmung-wahl input[type=range]');
    await expect(regler).toBeVisible(); // Zwischenwert: der Aufklapper ist offen
    await w.locator('#iv-stimmung-wahl .v-auf-kopf').focus();
    await w.keyboard.press('Tab');
    await expect(regler).toBeFocused();
    for (const t of ['Shift', 'Control', 'a', 'Escape']) await w.keyboard.press(t);
    const k = (await regler.boundingBox())!;
    const [min, max, wert] = await regler.evaluate((r: HTMLInputElement) => [Number(r.min), Number(r.max), Number(r.value)]);
    await w.mouse.click(k.x + 8 + (k.width - 16) * ((wert - min) / (max - min)), k.y + k.height / 2);
    await w.keyboard.press('Tab');
    await w.keyboard.press('Shift+Tab');
    await w.keyboard.press('Tab');
    await w.waitForTimeout(200);
    expect(await aufrufe(w), 'null Schreibaufrufe ohne Handlung').toBe(n0);
    expect(JSON.stringify(await lies(v, 'einstellungen'))).toBe(roh);
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- L2: zwei Tasten und sofort Tab ----------
test('L2: Interview Mood: zwei Tasten und sofort Tab (Speichern verzoegert): die Anzeige zeigt nie den ueberholten ersten Stand', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, { version: 1, schwelle: 0.15 }, null);
    await bisSeite(w, 4);
    await w.locator('#iv-stimmung-wahl .v-auf-kopf').click();
    const regler = w.locator('#iv-stimmung-wahl input[type=range]');
    await regler.focus();
    await w.evaluate(() => {
      const sl = (globalThis as any).chrome.storage.local;
      sl.set = (o: Record<string, unknown>) => ('einstellungen' in o ? new Promise((r) => setTimeout(r, 700)).then(() => sl.__echtSet(o)) : sl.__echtSet(o));
      const r = document.querySelector('#iv-stimmung-wahl input[type=range]') as HTMLInputElement;
      const g = ((globalThis as any).__gesehen = [r.value]);
      (globalThis as any).__takt = setInterval(() => { if (g.at(-1) !== r.value) g.push(r.value); }, 5);
    });
    await w.keyboard.press('ArrowRight');
    await w.keyboard.press('ArrowRight');
    await w.keyboard.press('Tab');
    await expect.poll(async () => ((await lies(v, 'einstellungen')) ?? {}).schwelle, { timeout: 8000 }).toBeCloseTo(0.17, 9);
    await w.waitForTimeout(500);
    await expect(regler).toHaveValue('0.17');
    expect(await w.evaluate(() => (globalThis as any).__gesehen), 'kein ueberholter Zwischenstand').toEqual(['0.15', '0.17']);
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- K4i: Fokus beim Formwechsel der Gruppe der Erwachsenenseiten ----------
test('K4i: Fokus in der Gruppe beim Formwechsel liegt danach auf der markierten Karte der neuen Form (beide Richtungen), nie auf body; ausserhalb bleibt er dort', async () => {
  const v = await verwaltung();
  try {
    const w = await oeffne(v, { version: 1, erwachsen: { ...STANDARD.erwachsen, an: true, stufe: 'hot' } }, PACK_VOLL);
    await bisSeite(w, 5);
    const fokus = () => w.evaluate(() => { const a = document.activeElement as HTMLElement; return { id: a?.dataset?.id ?? null, in: !!a?.closest('#iv-erw-wahl') }; });
    const vorher = JSON.stringify(await lies(v, 'einstellungen'));
    await w.locator('#iv-erw-wahl [data-id="explicit"]').focus();
    await schreibe(v, { pack: PACK_OHNE_ERW });
    await expect(w.locator('#iv-erw-wahl [role=radio]')).toHaveCount(5);
    expect(await fokus(), 'ohne Freischaltung: markierte Karte On').toEqual({ id: 'on', in: true });
    await schreibe(v, { pack: PACK_VOLL });
    await expect(w.locator('#iv-erw-wahl [role=radio]')).toHaveCount(4);
    expect(await fokus(), 'mit Freischaltung: markierte Karte Hot').toEqual({ id: 'hot', in: true });
    await w.locator('#iv-weiter').focus();
    await schreibe(v, { pack: PACK_OHNE_ERW });
    await expect(w.locator('#iv-erw-wahl [role=radio]')).toHaveCount(5);
    expect((await fokus()).in, 'ausserhalb bleibt der Fokus draussen').toBe(false);
    await expect(w.locator('#iv-weiter')).toBeFocused();
    expect(JSON.stringify(await lies(v, 'einstellungen')), 'der Wechsel schreibt nichts').toBe(vorher);
    await w.close();
  } finally {
    await v.close();
  }
});

// ---------- H4 (N9): ein Pfeil waehlt nicht, auch nicht in der Kleidungsfrage und der Gruppe der Erwachsenenseiten ----------
for (const [seite, gruppe, name] of [[2, 'iv-kleidung-frage', 'Kleidungsfrage'], [5, 'iv-erw-wahl', 'Gruppe der Erwachsenenseiten']] as const) {
  test(`Tastatur (${name}): Pfeile, Pos1 und Ende bewegen nur den Fokus und schreiben nichts, Leertaste waehlt`, async () => {
    const v = await verwaltung();
    try {
      const w = await oeffne(v, { version: 1, erwachsen: { an: true, stufe: 'hot' } }, PACK_VOLL);
      await bisSeite(w, seite);
      const vorher = JSON.stringify(await lies(v, 'einstellungen'));
      const n0 = await aufrufe(w);
      const radios = w.locator(`#${gruppe} [role=radio]`);
      const markiert = await radios.evaluateAll((e) => e.findIndex((x) => x.getAttribute('aria-checked') === 'true'));
      await radios.first().focus();
      for (const t of ['ArrowRight', 'ArrowDown', 'End', 'ArrowLeft', 'Home', 'ArrowDown', 'ArrowUp', 'ArrowRight']) await w.keyboard.press(t);
      await w.waitForTimeout(300);
      expect(await aufrufe(w), `${name}: Pfeile schreiben nichts`).toBe(n0);
      expect(JSON.stringify(await lies(v, 'einstellungen'))).toBe(vorher);
      expect(await radios.evaluateAll((e) => e.findIndex((x) => x.getAttribute('aria-checked') === 'true')), 'die Markierung bleibt').toBe(markiert);
      await expect(radios.nth(1)).toBeFocused();
      await w.keyboard.press('Space');
      await expect.poll(async () => await aufrufe(w)).not.toBe(n0); // erst die Leertaste waehlt (und schreibt)
      await w.close();
    } finally {
      await v.close();
    }
  });
}
