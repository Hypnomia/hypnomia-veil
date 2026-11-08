// Chromium: Phase 6, Session 12, Auftrag O (UX-Funde der Einstellungsseite). Jeder Fund mit echten Klicks und einer Messzahl:
// klebende Leiste mit Pause (5, 29), Stimmungswort (6), Kontraste (9, 10), Fingerziele bei 360 px (11), Woerterbuch (14),
// Ueberschriften (15), Strict in "What I cover" (16), Chip Interview (17), Tonprobe in der Pause (24), Ledger ohne Pack (25),
// Speicherfehler (26), Datum (28).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEHLER_SPEICHERN, datumLang, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { LEDGER_MEHR, LEDGER_MEHR_NEUER, ZAEHLER_NAMEN, stufeWert } from '../../src/ledger/texte';
import { TON_TEXTE } from '../../src/ton/texte';
import { oeffneZugeklapptes } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';

const optionsUrl = () => `chrome-extension://${id}/options.html`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const einst = async (seite: Page) => (await lies(seite, 'einstellungen')) ?? {};
const packMit = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const zuruecksetzen = (seite: Page) =>
  seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'ledger', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));
const taste = async (seite: Page, css: string, taste: string, n = 1) => {
  await seite.locator(css).focus();
  for (let i = 0; i < n; i++) await seite.keyboard.press(taste);
};

// Kontrast nach WCAG aus zwei CSS-Farben (rgb/rgba), im Seitenkontext gerechnet.
const kontrastIn = (seite: Page, a: string, b: string) =>
  seite.evaluate(
    ([a, b]) => {
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: string) => {
        const [r, g, bl] = rgb(c).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
      };
      const [hell, dunkel] = [lum(a!), lum(b!)].sort((x, y) => y - x);
      return (hell! + 0.05) / (dunkel! + 0.05);
    },
    [a, b],
  );

// Ledger-Stand mit Nullen (der Hintergrund legt ihn erst beim ersten Ereignis an); Tag heute, damit nichts umgerollt wird.
const ZAEHLER = ['zensiert', 'quizGeloest', 'quizFalsch', 'quizVerweigert', 'erwachsenMinuten', 'werbung', 'blitzwoerter', 'spiralen', 'besuche'];
const nullen = () => Object.fromEntries(ZAEHLER.map((z) => [z, 0]));
const ledgerStand = (teil: Record<string, unknown> = {}) => {
  const d = new Date();
  const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { version: 1, seit: Date.now(), tag, heute: nullen(), gesamt: nullen(), hoechsteStufe: 0, ...teil };
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-einstellungen-s12-'));
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

async function frischeSeite(vorher: Record<string, unknown> = {}, breite = 0): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  await zuruecksetzen(seite);
  if (Object.keys(vorher).length) await schreibe(seite, vorher);
  if (breite) await seite.setViewportSize({ width: breite, height: 800 });
  await seite.reload();
  await expect(seite.locator('#pack-status')).not.toHaveText('');
  // Phase 9 (Fund 4): ohne Pack sind Adult sites, Mia’s control und Sound zugeklappt; diese Tests bedienen sie wie die Person nach "Set them now".
  await oeffneZugeklapptes(seite);
  return seite;
}

test('Fund 5 und 29: die Leiste klebt oben, nach dem Scrollen sichtbar, Pause darin schreibt pausiert', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    await seite.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => seite.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const lage = await seite.evaluate(() => {
      const r = document.getElementById('leiste')!.getBoundingClientRect();
      return { oben: r.top, hoehe: r.height, scroll: window.scrollY };
    });
    console.log(`einstellungen-s12: Leiste nach Scroll ${Math.round(lage.scroll)} px: oben ${lage.oben}, Hoehe ${Math.round(lage.hoehe)}`);
    expect(Math.abs(lage.oben)).toBeLessThanOrEqual(1);
    await expect(seite.locator('#pause-leiste')).toBeInViewport();
    await expect(seite.locator('#sprung a').first()).toBeInViewport();
    // Pause in der Leiste: gleicher Weg wie #pause, gleiche Woerter, aria-pressed
    await expect(seite.locator('#pause-leiste')).toHaveText('Pause Mia');
    // Nr. 10: der Klick nimmt den Hintergrundweg (runtime.sendMessage typ "pause" mit absolutem Zielwert), nicht den Ersatzweg ueber den Speicher
    await seite.evaluate(() => {
      const rt = (globalThis as any).chrome.runtime;
      (globalThis as any).__pause = [];
      const echt = rt.sendMessage.bind(rt);
      rt.sendMessage = (n: any, ...rest: any[]) => {
        if (n && n.typ === 'pause') (globalThis as any).__pause.push(n.an);
        return echt(n, ...rest);
      };
    });
    await seite.locator('#pause-leiste').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(true);
    expect(await seite.evaluate(() => (globalThis as any).__pause)).toEqual([true]);
    await expect(seite.locator('#pause-leiste')).toHaveText('Let Mia back in');
    await expect(seite.locator('#pause-leiste')).toHaveAttribute('aria-pressed', 'true');
    await expect(seite.locator('#pause')).toHaveText('Let Mia back in');
    await seite.locator('#pause-leiste').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(false);
    expect(await seite.evaluate(() => (globalThis as any).__pause)).toEqual([true, false]);
    // Sprungziel rutscht nicht unter die Leiste: Chip "About" anklicken, Ueberschrift liegt unter der Leiste
    await seite.locator('#sprung a', { hasText: 'About' }).click();
    await expect.poll(() => seite.evaluate(() => Math.round(document.getElementById('ueber-titel')!.getBoundingClientRect().top))).toBeGreaterThan(60);
    const leistenUnten = await seite.evaluate(() => document.getElementById('leiste')!.getBoundingClientRect().bottom);
    const titelOben = await seite.evaluate(() => document.getElementById('ueber-titel')!.getBoundingClientRect().top);
    console.log(`einstellungen-s12: About-Titel oben ${Math.round(titelOben)}, Leiste unten ${Math.round(leistenUnten)}`);
    expect(titelOben).toBeGreaterThanOrEqual(leistenUnten);
  } finally {
    await seite.close();
  }
});

test('Fund 5 bei 360 px: Sprungleiste als waagrecht scrollbare Zeile, Seite ohne Ueberlauf', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 360);
  try {
    const m = await seite.evaluate(() => {
      const n = document.getElementById('sprung')!;
      return { sw: n.scrollWidth, cw: n.clientWidth, ox: getComputedStyle(n).overflowX, seite: document.documentElement.scrollWidth, fenster: document.documentElement.clientWidth, hoehe: document.getElementById('leiste')!.getBoundingClientRect().height };
    });
    console.log(`einstellungen-s12: 360 px Sprungleiste scrollWidth ${m.sw} > clientWidth ${m.cw}, Leiste ${Math.round(m.hoehe)} px hoch, Seite ${m.seite}/${m.fenster}`);
    expect(m.ox).toBe('auto');
    expect(m.sw).toBeGreaterThan(m.cw);
    expect(m.seite).toBeLessThanOrEqual(m.fenster);
    expect(m.hoehe).toBeLessThan(90);
    await seite.evaluate(() => window.scrollTo(0, 2000));
    await expect(seite.locator('#pause-leiste')).toBeInViewport();
  } finally {
    await seite.close();
  }
});

test('Fund 6: Stimmung als Wort, auch als aria-valuetext', async () => {
  const seite = await frischeSeite();
  try {
    await taste(seite, '#stimmung', 'Home');
    // Fund 28 (Phase 9): bei Mias Standard steht "(my default)" dabei.
    await expect(seite.locator('#stimmung-wert')).toHaveText(`${stimmungsWort(0.1)} (my default)`);
    await expect(seite.locator('#stimmung')).toHaveAttribute('aria-valuetext', `${stimmungsWort(0.1)} (my default)`);
    const gesehen: string[] = [(await seite.locator('#stimmung-wert').textContent()) ?? ''];
    let ziel = 10;
    for (const n of [3, 4, 4]) {
      ziel += n;
      await seite.locator('#stimmung').focus();
      for (let i = 0; i < n; i++) await seite.keyboard.press('ArrowRight');
      await expect.poll(async () => Math.round(((await einst(seite)).schwelle ?? 0) * 100)).toBe(ziel);
      const wort = (await seite.locator('#stimmung-wert').textContent()) ?? '';
      const soll = stimmungsWort(Number(await seite.locator('#stimmung').inputValue()));
      expect(wort).toBe(soll);
      expect(await seite.locator('#stimmung').getAttribute('aria-valuetext')).toBe(soll);
      gesehen.push(wort);
    }
    console.log(`einstellungen-s12: Stimmungswoerter ${gesehen.join(', ')}`);
    expect(new Set(gesehen).size).toBe(4);
    expect(await seite.locator('#stimmung-wert').textContent()).not.toMatch(/\d/);
  } finally {
    await seite.close();
  }
});

test('Fund 9 und 10: Kontraste aus getComputedStyle (Knopftext 4,5:1, Schalterbahn und Feldrand 3:1)', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    // Knopftext "Add" auf seinem Grund
    const knopf = await seite.locator('#ausnahme-add').evaluate((e) => ({ f: getComputedStyle(e).color, g: getComputedStyle(e).backgroundColor }));
    const k1 = await kontrastIn(seite, knopf.f, knopf.g);
    // Bahn im Zustand aus gegen den weissen Kartengrund, Feldrand gegen den Kartengrund
    // Nr. 9: gemessen wird gegen Kartengrund UND Seitengrund (#fff5fa), Knopftext ueber alle sichtbaren button.klein
    const seitenGrund = await seite.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const knoepfeKr = await seite.locator('button.klein').evaluateAll((l) => l.filter((e) => e.getClientRects().length > 0).map((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]));
    const kmin = Math.min(...(await Promise.all(knoepfeKr.map(([f, g]) => kontrastIn(seite, f!, g!)))));
    console.log(`einstellungen-s12: ${knoepfeKr.length} sichtbare button.klein, kleinster Textkontrast ${kmin.toFixed(2)}`);
    expect(knoepfeKr.length).toBeGreaterThan(2);
    expect(kmin).toBeGreaterThanOrEqual(4.5);
    expect(await kontrastIn(seite, (await seite.locator('#strict + .regler').evaluate((e) => getComputedStyle(e).backgroundColor)), seitenGrund)).toBeGreaterThanOrEqual(3);
    expect(await kontrastIn(seite, (await seite.locator('#ausnahme-feld').evaluate((e) => getComputedStyle(e).borderTopColor)), seitenGrund)).toBeGreaterThanOrEqual(3);
    const bahn = await seite.locator('#strict + .regler').evaluate((e) => ({ b: getComputedStyle(e).backgroundColor, k: getComputedStyle(e.closest('section')!).backgroundColor }));
    const k2 = await kontrastIn(seite, bahn.b, bahn.k);
    const feld = await seite.locator('#ausnahme-feld').evaluate((e) => ({ r: getComputedStyle(e).borderTopColor, k: getComputedStyle(e.closest('section')!).backgroundColor }));
    const k3 = await kontrastIn(seite, feld.r, feld.k);
    await seite.locator('#kon-blitz').scrollIntoViewIfNeeded();
    const auswahl = await seite.locator('#kon-blitz').evaluate((e) => ({ r: getComputedStyle(e).borderTopColor, k: getComputedStyle(e.closest('section')!).backgroundColor }));
    const k4 = await kontrastIn(seite, auswahl.r, auswahl.k);
    console.log(`einstellungen-s12: Kontraste Knopftext ${k1.toFixed(2)}, Bahn aus ${k2.toFixed(2)}, Textfeldrand ${k3.toFixed(2)}, Auswahlrand ${k4.toFixed(2)}`);
    expect(k1).toBeGreaterThanOrEqual(4.5);
    expect(k2).toBeGreaterThanOrEqual(3);
    expect(k3).toBeGreaterThanOrEqual(3);
    expect(k4).toBeGreaterThanOrEqual(3);
    // Sprung-Chips tragen ebenfalls Text auf Weiss
    const chip = await seite.locator('#sprung a').first().evaluate((e) => ({ f: getComputedStyle(e).color, g: getComputedStyle(e).backgroundColor }));
    expect(await kontrastIn(seite, chip.f, chip.g)).toBeGreaterThanOrEqual(4.5);
  } finally {
    await seite.close();
  }
});

test('Fund 11: bei 360 px sind Chips, Listenknoepfe und Kaestchen mindestens 44 px hoch', async () => {
  const seite = await frischeSeite(
    {
      einstieg: EINSTIEG_FERTIG,
      pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'kontrolle:zeitplan']),
      einstellungen: { ausnahmen: ['kurz.de'], erwachsen: { eigeneSeiten: ['adult.example'] } },
    },
    360,
  );
  try {
    await seite.locator('#kon-zeit-neu').click();
    // Runde 3, N6: der Pause-Knopf der Leiste erscheint erst nach dem Scrollen.
    await seite.evaluate(() => window.scrollTo(0, 1500));
    await expect(seite.locator('#pause-leiste')).toBeVisible();
    const hoehen = await seite.evaluate(() => {
      const h = (sel: string) => {
        const l = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getClientRects().length > 0);
        return { n: l.length, min: Math.round(Math.min(...l.map((e) => e.getBoundingClientRect().height))) };
      };
      return {
        chips: h('#sprung a'),
        ausnahmeRemove: h('#ausnahmen-liste button'),
        seitenRemove: h('#seiten-liste button'),
        zeitRemove: h('#kon-zeiten .zeit-weg'),
        bedeckt: h('.auch'),
        wochentage: h('.zeit-tage label'),
        schalter: h('label.schalter'),
        knoepfe: h('button.klein'),
        pause: h('#pause-leiste'),
      };
    });
    console.log(`einstellungen-s12: Mindesthoehen bei 360 px ${JSON.stringify(hoehen)}`);
    for (const [name, v] of Object.entries(hoehen)) {
      expect(v.n, name).toBeGreaterThan(0);
      expect(v.min, name).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await seite.close();
  }
});

test('Fund 14: ein Wort je Ding, keine "skip" oder "exception" im sichtbaren Text, Stufe als "Level n of 4"', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG, pack: packMit(['stil:mia-patch', 'kontrolle:werbung']) });
  try {
    await schreibe(seite, { ledger: ledgerStand({ hoechsteStufe: 3 }) });
    await seite.reload();
    await expect(seite.locator('#pack-status')).not.toHaveText('');
    const sichtbar = (await seite.evaluate(() => document.body.innerText)).toLowerCase();
    expect(sichtbar).not.toMatch(/\bskip/);
    expect(sichtbar).not.toMatch(/\bexception/);
    const h2 = await seite.locator('h2').allTextContents();
    const chips = await seite.locator('#sprung a:not([hidden])').allTextContents();
    console.log(`einstellungen-s12: Ueberschriften ${JSON.stringify(h2)}, Chips ${JSON.stringify(chips)}`);
    expect(h2).toContain('Sites I leave alone');
    // Phase 9 (Fund 5): eine Pack-Karte "Mia Pack" statt zwei Karten.
    expect(h2).toContain('Mia Pack');
    expect(chips).toContain('Mia Pack');
    expect(chips).toContain('Covering');
    expect(chips).toContain('About and help');
    expect(chips).not.toContain('Pack');
    expect(chips).not.toContain('Left alone');
    expect(sichtbar).not.toContain('your pack');
    expect(sichtbar).not.toContain('add a pack');
    await expect(seite.locator('#ledger-stufe')).toHaveText(stufeWert(3));
    expect(stufeWert(3)).toBe('Level 3 of 4');
  } finally {
    await seite.close();
  }
});

test('Fund 15: Abschnittstitel groesser als Unterueberschriften, in Textfarbe, nicht in Grossbuchstaben', async () => {
  const seite = await frischeSeite();
  try {
    const m = await seite.evaluate(() => {
      const h2 = document.getElementById('erw-titel')!;
      const h3 = document.querySelector('#erwachsen h3')!;
      const cs2 = getComputedStyle(h2);
      const cs3 = getComputedStyle(h3);
      return { g2: parseFloat(cs2.fontSize), g3: parseFloat(cs3.fontSize), farbe: cs2.color, text: getComputedStyle(document.body).color, gross: cs2.textTransform };
    });
    console.log(`einstellungen-s12: h2 ${m.g2} px, h3 ${m.g3} px, Farbe ${m.farbe}`);
    expect(m.g2).toBeGreaterThan(m.g3);
    expect(m.g2).toBeGreaterThanOrEqual(17);
    expect(m.farbe).toBe(m.text);
    expect(m.gross).toBe('none');
  } finally {
    await seite.close();
  }
});

test('Fund 16: Strict ist ein Schalter in "What I cover", kein eigener Abschnitt und kein eigener Chip', async () => {
  const seite = await frischeSeite();
  try {
    await expect(seite.locator('#abschnitt-strict')).toHaveCount(0);
    await expect(seite.locator('#abschnitt-zonen label.schalter:has(#strict)')).toHaveCount(1);
    expect(await seite.locator('#sprung a').allTextContents()).not.toContain('Strict');
    expect(await seite.locator('h2').allTextContents()).not.toContain('Strict');
    await seite.locator('#abschnitt-zonen label.schalter:has(#strict)').click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(true);
    await seite.locator('#abschnitt-zonen label.schalter:has(#strict)').click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(false);
    console.log('einstellungen-s12: Strict im Abschnitt "What I cover" geklickt, Speicher true dann false');
  } finally {
    await seite.close();
  }
});

test('Fund 22 (Phase 9): das Interview wohnt ganz unten in "About and help", vor dem Einstieg verborgen, kein eigener Chip mehr', async () => {
  const seite = await frischeSeite();
  try {
    await expect(seite.locator('#abschnitt-interview')).toBeHidden();
    await schreibe(seite, { einstieg: EINSTIEG_FERTIG });
    await expect(seite.locator('#abschnitt-interview')).toBeVisible();
    await expect(seite.locator('#interview-neu')).toHaveText('Run the interview again');
    // Der alte Chip bleibt nur als verborgener Anker (grund-pack.ts); die Leiste zeigt ihn nie.
    await expect(seite.locator('#chip-interview')).toBeHidden();
    // Letztes Kind von "About and help", unter Version, Links und Hilfe.
    expect(await seite.evaluate(() => document.getElementById('ueber')!.lastElementChild?.id)).toBe('abschnitt-interview');
    // Einstieg wieder offen: der Knopf verschwindet
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstieg'));
    await expect(seite.locator('#abschnitt-interview')).toBeHidden();
    console.log('einstellungen-s12: Interview-Knopf in About and help erscheint und verschwindet mit dem Einstieg');
  } finally {
    await seite.close();
  }
});

test('Fund 24: Tonprobe bleibt in der Pause frei, der Klick zeigt den Satz', async () => {
  // Pack erst nach dem Laden schreiben: der Abgleich des Pack-Teils raeumt beim Start ein Pack ohne Bilder in der Datenbank weg.
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    await schreibe(seite, { pack: packMit(['ton']), einstellungen: { pause: true } });
    await expect(seite.locator('#ton-probe')).toBeEnabled();
    await seite.locator('#ton-probe').click();
    await expect(seite.locator('#ton-probe-meldung')).toHaveText(TON_TEXTE.probePause);
    console.log(`einstellungen-s12: Probe in der Pause angeklickt, Satz ${TON_TEXTE.probePause.length} Zeichen`);
    // Mia zurueck: der Satz geht weg
    await seite.locator('#pause').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(false);
    await expect(seite.locator('#ton-probe-meldung')).not.toHaveText(TON_TEXTE.probePause);
  } finally {
    await seite.close();
  }
});

test('Fund 25: Ledger ohne Pack nur mit gezaehlten Zeilen und Sammelzeile, mit Pack alles', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    const sichtbareZeilen = () => seite.locator('#ledger .ledger-liste > li:not([hidden])').count();
    await expect(seite.locator('#ledger-mehr')).toBeVisible();
    await expect(seite.locator('#ledger-mehr')).toHaveText(LEDGER_MEHR);
    const ohne = await sichtbareZeilen();
    console.log(`einstellungen-s12: Ledger ohne Pack ${ohne} von 9 Zeilen sichtbar`);
    expect(ohne).toBe(1);
    await expect(seite.locator('#ledger-stufe-zeile')).toBeHidden(); // ohne Steigerung und ohne Stufe keine Zeile "Level 0 of 4"
    await expect(seite.locator('#ledger-zeile-zensiert')).toBeVisible();
    await expect(seite.locator('#ledger-zeile-quizGeloest')).toBeHidden();
    // Ein Zaehler ueber 0 bleibt sichtbar, auch ohne Pack
    await schreibe(seite, { ledger: ledgerStand({ gesamt: { ...nullen(), besuche: 3 } }) });
    await expect(seite.locator('#ledger-zeile-besuche')).toBeVisible();
    await expect(seite.locator('#ledger-gesamt-besuche')).toHaveText('3');
    expect(await sichtbareZeilen()).toBe(2);
    await expect(seite.locator('#ledger-mehr')).toBeVisible();
    // Nr. 1 und 13: Pack ohne zensur:steigerung: Minuten und Stufe bleiben weg, die Sammelzeile spricht von einem neueren Pack
    const ohneSteigerung = ['erwachsen:vorschau', 'erwachsen:quiz', 'kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf', 'kontrolle:besuche'];
    await schreibe(seite, { pack: packMit(ohneSteigerung) });
    await expect(seite.locator('#ledger-zeile-quizGeloest')).toBeVisible();
    expect(await sichtbareZeilen()).toBe(8);
    await expect(seite.locator('#ledger-zeile-erwachsenMinuten')).toBeHidden();
    await expect(seite.locator('#ledger-stufe-zeile')).toBeHidden();
    await expect(seite.locator('#ledger-mehr')).toHaveText(LEDGER_MEHR_NEUER);
    // Mit vollem Pack (auch zensur:steigerung): alle neun und die Stufenzeile, keine Sammelzeile
    await schreibe(seite, { pack: packMit([...ohneSteigerung, 'zensur:steigerung']) });
    await expect(seite.locator('#ledger-zeile-erwachsenMinuten')).toBeVisible();
    await expect(seite.locator('#ledger-stufe-zeile')).toBeVisible();
    expect(await sichtbareZeilen()).toBe(9);
    await expect(seite.locator('#ledger-mehr')).toBeHidden();
    await expect(seite.locator('#ledger-zeile-spiralen .ledger-name')).toHaveText(ZAEHLER_NAMEN.spiralen);
  } finally {
    await seite.close();
  }
});

// Speichern scheitern lassen: storage.local.set im Seitenkontext schlaegt fehl (nur fuer den Schluessel `einstellungen`).
const speichernKaputt = (seite: Page, kaputt: boolean) =>
  seite.evaluate((kaputt) => {
    const sl = (globalThis as any).chrome.storage.local;
    sl.__echtSet ??= sl.set.bind(sl);
    sl.set = (o: Record<string, unknown>) => (kaputt && 'einstellungen' in o ? Promise.reject(new Error('Test: Speichern scheitert')) : sl.__echtSet(o));
  }, kaputt);

test('Fund 26: je Element erscheint der Satz in der Leiste, der Wert springt zurueck, fremde Felder bleiben', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    await expect(seite.locator('#speicher-meldung')).toBeHidden();
    // unbeteiligte Felder mit getipptem Text: duerfen den Fehler ueberleben
    await seite.locator('#seite-feld').fill('getippt.example');
    await seite.locator('#ausnahme-feld').fill('auch-getippt.example');
    await speichernKaputt(seite, true);
    const meldung = seite.locator('#speicher-meldung');
    // Je Element: Meldung zuruecksetzen, Aktion, dann muss der Satz wieder da sein (nicht der vom Schritt davor)
    const fehlerBei = async (name: string, aktion: () => Promise<void>, zurueck: () => Promise<void>) => {
      await seite.evaluate(() => {
        const m = document.getElementById('speicher-meldung')!;
        m.textContent = '';
        m.hidden = true;
      });
      await expect(meldung).toBeHidden();
      await aktion();
      await expect(meldung, name).toHaveText(FEHLER_SPEICHERN);
      await expect(meldung, name).toBeInViewport();
      await zurueck();
    };
    const wert = (css: string) => seite.locator(css).inputValue();
    const gewaehlt = (css: string) => seite.locator(css).isChecked();
    const schalterFehler = async (name: string, css: string, label: string) => {
      const vorher = await gewaehlt(css);
      await fehlerBei(name, () => seite.locator(label).click(), async () => {
        await expect(seite.locator(css), name).toBeChecked({ checked: vorher });
      });
    };
    await schalterFehler('Strict', '#strict', 'label.schalter:has(#strict)');
    await schalterFehler('Adult-site mode', '#erw-an', 'label.schalter:has(#erw-an)');
    await schalterFehler('Calm mode', '#ruhig', 'label.schalter:has(#ruhig)');
    await schalterFehler('My ads', '#kon-werbung', 'label.schalter:has(#kon-werbung)');
    await schalterFehler('Tab-Titel', '#kon-tabtitel', '#kon-tabtitel-zeile');
    await schalterFehler('Ton', '#ton-an', 'label.schalter:has(#ton-an)');
    await seite.locator('#kon-blitz').scrollIntoViewIfNeeded();
    const blitzVorher = await wert('#kon-blitz');
    await fehlerBei('Blitz-Auswahl', async () => void (await seite.locator('#kon-blitz').selectOption('oft')), async () => {
      await expect(seite.locator('#kon-blitz')).toHaveValue(blitzVorher);
    });
    const regler = async (name: string, css: string, taste: string, n: number) => {
      const vorher = await wert(css);
      await fehlerBei(name, async () => {
        await seite.locator(css).focus();
        for (let i = 0; i < n; i++) await seite.keyboard.press(taste);
      }, async () => {
        await expect(seite.locator(css), name).toHaveValue(vorher);
      });
    };
    await regler('Lautstaerke', '#ton-lautstaerke', 'ArrowRight', 1);
    await regler('Stimmung', '#stimmung', 'ArrowRight', 2);
    await regler('Verweigern', '#verweigern', 'End', 1);
    await regler('Freilegen', '#freilegen', 'End', 1);
    await expect(seite.locator('#stimmung-wert')).toHaveText(stimmungsWort(Number(await wert('#stimmung'))) + (Math.round(Number(await wert('#stimmung')) * 100) === 10 ? ' (my default)' : ''));
    // Zonen-Schalter
    const zoneVorher = await seite.locator('#zonen input[data-zone="eyes"]').isChecked();
    await fehlerBei('Zone', () => seite.locator('#zonen label.schalter').filter({ hasText: 'Eyes' }).click(), async () => {
      await expect(seite.locator('#zonen input[data-zone="eyes"]')).toBeChecked({ checked: zoneVorher });
    });
    // Nichts gespeichert, unbeteiligte Felder unveraendert
    const e = await einst(seite);
    expect(e.strict ?? false).toBe(false);
    expect(e.ruhig ?? false).toBe(false);
    await expect(seite.locator('#seite-feld')).toHaveValue('getippt.example');
    await expect(seite.locator('#ausnahme-feld')).toHaveValue('auch-getippt.example');
    console.log(`einstellungen-s12: 12 Elemente mit Speicherfehler, je Satz gesehen, gespeichert strict ${e.strict}, ruhig ${e.ruhig}, Felder bleiben`);
    // Nr. 7: ein zweiter Fehler wird neu angesagt (Text wechselt kurz, sonst meldet role=alert nichts)
    await seite.evaluate(() => {
      (globalThis as any).__aend = 0;
      new MutationObserver((l) => ((globalThis as any).__aend += l.length)).observe(document.getElementById('speicher-meldung')!, { childList: true, characterData: true, subtree: true });
    });
    await seite.locator('label.schalter:has(#strict)').click();
    await expect(meldung).toHaveText(FEHLER_SPEICHERN);
    await seite.locator('label.schalter:has(#strict)').click();
    await expect.poll(() => seite.evaluate(() => (globalThis as any).__aend)).toBeGreaterThanOrEqual(4);
    await expect(meldung).toHaveText(FEHLER_SPEICHERN);
    // Speichern geht wieder: Meldung verschwindet, Schalter haelt
    await speichernKaputt(seite, false);
    await seite.locator('label.schalter:has(#strict)').click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(true);
    await expect(meldung).toBeHidden();
    await expect(seite.locator('#strict')).toBeChecked();
  } finally {
    await seite.close();
  }
});

test('Fund 12: "I understand" der Warnung scheitert nicht still', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    await seite.evaluate(() => {
      const sl = (globalThis as any).chrome.storage.local;
      sl.__echtSet ??= sl.set.bind(sl);
      sl.set = () => Promise.reject(new Error('Test'));
    });
    await seite.locator('#kon-warnung-ok').scrollIntoViewIfNeeded();
    await expect(seite.locator('#kon-warnung')).toBeVisible();
    await seite.locator('#kon-warnung-ok').click();
    await expect(seite.locator('#speicher-meldung')).toHaveText(FEHLER_SPEICHERN);
    await expect(seite.locator('#kon-warnung')).toBeVisible();
    console.log('einstellungen-s12: Warnung bei Speicherfehler weiter sichtbar, Satz in der Leiste');
  } finally {
    await seite.close();
  }
});

test('Fund 3, 4, 5, 6: Chips umbrechen am Desktop, bei 360 px mit Fehlersatz verdeckt die Leiste weder Sprungziele noch Fokus', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    // Nr. 3: am Desktop liegt keine Chip-Zeile ausserhalb der Sicht (kein verstecktes Scrollen), alle Chips voll im Bereich der Leiste
    const d = await seite.evaluate(() => {
      const n = document.getElementById('sprung')!;
      const l = n.getBoundingClientRect();
      return { sw: n.scrollWidth, cw: n.clientWidth, ausserhalb: [...n.querySelectorAll('a')].filter((a) => a.getClientRects().length && a.getBoundingClientRect().right > l.right + 1).length, ox: getComputedStyle(n).overflowX };
    });
    console.log(`einstellungen-s12: Desktop Sprungleiste scrollWidth ${d.sw}, clientWidth ${d.cw}, Chips rechts ausserhalb ${d.ausserhalb}`);
    expect(d.ausserhalb).toBe(0);
    expect(d.sw).toBeLessThanOrEqual(d.cw);
    // Nr. 5: Fokusrahmen eines Chips wird nicht abgeschnitten (Polster der Leiste mindestens 5 px oben und unten)
    await seite.locator('#sprung a').first().focus();
    const polster = await seite.evaluate(() => {
      const n = document.getElementById('sprung')!.getBoundingClientRect();
      const a = document.querySelector<HTMLElement>('#sprung a:focus')!.getBoundingClientRect();
      const o = parseFloat(getComputedStyle(document.querySelector('#sprung a:focus')!).outlineWidth) + parseFloat(getComputedStyle(document.querySelector('#sprung a:focus')!).outlineOffset);
      return { oben: a.top - n.top, unten: n.bottom - a.bottom, noetig: o };
    });
    console.log(`einstellungen-s12: Chip-Fokus Platz oben ${polster.oben}, unten ${polster.unten}, noetig ${polster.noetig}`);
    expect(polster.oben).toBeGreaterThanOrEqual(polster.noetig);
    expect(polster.unten).toBeGreaterThanOrEqual(polster.noetig);
    // Nr. 4 und 6 bei 360 px mit zweizeiligem Fehlersatz
    await seite.setViewportSize({ width: 360, height: 800 });
    await speichernKaputt(seite, true);
    await seite.locator('label.schalter:has(#strict)').click();
    await expect(seite.locator('#speicher-meldung')).toBeVisible();
    const leiste = () => seite.evaluate(() => document.getElementById('leiste')!.getBoundingClientRect().bottom);
    const hoehe = await seite.evaluate(() => Math.round(document.getElementById('leiste')!.getBoundingClientRect().height));
    console.log(`einstellungen-s12: 360 px Leiste mit Fehlersatz ${hoehe} px, scroll-padding-top ${await seite.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop)}`);
    await seite.locator('#sprung a', { hasText: 'About' }).first().click();
    await expect.poll(async () => (await seite.evaluate(() => document.getElementById('ueber-titel')!.getBoundingClientRect().top)) >= (await leiste())).toBe(true);
    // Fokus per Tastatur nach oben (Shift+Tab): fokussiertes Element liegt unter der Leiste, nicht dahinter
    await seite.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await seite.locator('#ausnahme-feld').focus();
    await seite.keyboard.press('Shift+Tab');
    await seite.waitForTimeout(150);
    const lage = await seite.evaluate(() => ({ el: document.activeElement!.getBoundingClientRect().top, leiste: document.getElementById('leiste')!.getBoundingClientRect().bottom }));
    console.log(`einstellungen-s12: Fokus oben ${Math.round(lage.el)}, Leiste unten ${Math.round(lage.leiste)}`);
    expect(lage.el).toBeGreaterThanOrEqual(lage.leiste);
  } finally {
    await seite.close();
  }
});

test('Fund 28: Ledger-Datum amerikanisch mit ausgeschriebenem Monat', async () => {
  const seit = new Date(2026, 10, 5, 14, 3).getTime();
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG });
  try {
    await schreibe(seite, { ledger: ledgerStand({ seit }) });
    await expect(seite.locator('#ledger-seit')).toContainText(datumLang(seit));
    const text = (await seite.locator('#ledger-seit').textContent()) ?? '';
    console.log(`einstellungen-s12: Ledger-Datum "${text.slice(0, 32)}"`);
    expect(text).toContain('Nov 5, 2026');
    expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  } finally {
    await seite.close();
  }
});

test('360 px mit klebender Leiste und Fehlersatz: kein waagrechter Ueberlauf', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 360);
  try {
    await speichernKaputt(seite, true);
    await seite.locator('label.schalter:has(#strict)').click();
    await expect(seite.locator('#speicher-meldung')).toBeVisible();
    const m = await seite.evaluate(() => ({ w: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, leiste: document.getElementById('leiste')!.scrollWidth, leisteC: document.getElementById('leiste')!.clientWidth }));
    console.log(`einstellungen-s12: 360 px mit Fehlersatz scrollWidth ${m.w}, clientWidth ${m.c}, Leiste ${m.leiste}/${m.leisteC}`);
    expect(m.w).toBeLessThanOrEqual(m.c);
    expect(m.leiste).toBeLessThanOrEqual(m.leisteC);
  } finally {
    await seite.close();
  }
});

test('Runde 3 (zweite UX-Lesung N3 bis N12): Fokus, Escape, Leiste, Ablage-Satz, gesperrte Kaestchen, Regler, Interview im selben Tab', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 1280);
  try {
    // Lesung Runde 3, Nr. 3: direkt nach dem Laden ist genau ein Chip markiert.
    await expect.poll(() => seite.locator('#sprung a[aria-current="true"]').count()).toBe(1);
    // N6: oben ist nur der grosse Pause-Knopf zu sehen, nach dem Scrollen der kleine in der Leiste.
    await expect(seite.locator('#pause-leiste')).toBeHidden();
    // Lesung Runde 3, Nr. 2: steht der grosse Knopf nur noch zur Haelfte im Bild, ist der kleine schon da.
    await seite.evaluate(() => {
      const r = document.getElementById('pause')!.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top + r.height / 2);
    });
    await expect(seite.locator('#pause-leiste')).toBeVisible();
    await seite.evaluate(() => window.scrollTo(0, 1500));
    await expect(seite.locator('#pause-leiste')).toBeVisible();
    // N5: bei 1280 px ist die Leiste niedriger als vorher (128 px), der Chip des aktuellen Abschnitts ist markiert.
    const hoehe = await seite.evaluate(() => Math.round(document.getElementById('leiste')!.getBoundingClientRect().height));
    // Lesung Runde 3, Nr. 4: hoechstens zwei Chip-Zeilen (gemessen gegen die Hoehe eines Chips).
    const zeilen = await seite.evaluate(() => {
      const chip = document.querySelector('#sprung a')!.getBoundingClientRect().height;
      const tops = new Set([...document.querySelectorAll('#sprung a:not(#chip-interview)')].map((a) => Math.round(a.getBoundingClientRect().top)));
      return { chip: Math.round(chip), zeilen: tops.size };
    });
    expect(zeilen.zeilen).toBeLessThanOrEqual(2);
    expect(hoehe).toBeLessThan(128);
    await seite.locator('#sprung a[href="#ledger"]').click();
    await expect(seite.locator('#sprung a[href="#ledger"]')).toHaveAttribute('aria-current', 'true');
    expect(await seite.locator('#sprung a[aria-current="true"]').count()).toBe(1);
    // N4: Escape schliesst die Frage des Ledgers, der Fokus kehrt zum Knopf zurueck.
    await seite.locator('#ledger-loeschen').click();
    await expect(seite.locator('#ledger-frage')).toBeVisible();
    await seite.keyboard.press('Escape');
    await expect(seite.locator('#ledger-frage')).toBeHidden();
    await expect(seite.locator('#ledger-loeschen')).toBeFocused();
    // N3 und N4: Pack-Rueckfrage, "Keep it" und Escape geben den Fokus an "Remove Mia Pack" zurueck.
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(seite.locator('#entfernen')).toBeVisible();
    await seite.locator('#entfernen').click();
    await expect(seite.locator('#entfernen-nein')).toBeFocused();
    await seite.keyboard.press('Escape');
    await expect(seite.locator('#entfernen-frage')).toBeHidden();
    await expect(seite.locator('#entfernen')).toBeFocused();
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-nein').click();
    await expect(seite.locator('#entfernen')).toBeFocused();
    // Lesung Runde 3, Nr. 1: nach "Remove" steht der Fokus auf der Meldung, nicht auf dem verborgenen Knopf.
    await seite.locator('#entfernen').click();
    await seite.locator('#entfernen-ja').click();
    await expect(seite.locator('#entfernen-zeile')).toBeHidden();
    await expect(seite.locator('#meldung')).toBeFocused();
    // N7: mit Maus (pointer: fine) steht der Ablage-Satz da.
    await expect(seite.locator('#ablage-text')).toBeVisible();
    // N8: gesperrtes "even when clothed" ist blass.
    const blass = await seite.locator('#zonen input[data-bedeckt]:disabled').first().evaluate((e) => Number(getComputedStyle(e.closest('label')!).opacity));
    expect(blass).toBeLessThan(0.7);
    // N3: "I understand" der Warnkarte gibt den Fokus an die Blitzwort-Auswahl.
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['quizWarnungGesehen', 'spiraleWarnungGesehen']));
    await expect(seite.locator('#kon-warnung')).toBeVisible();
    await seite.locator('#kon-warnung-ok').click();
    await expect(seite.locator('#kon-warnung')).toBeHidden();
    await expect(seite.locator('#kon-blitz')).toBeFocused();
    // N10: bei 360 px sind die Regler mindestens 44 px hoch.
    await seite.setViewportSize({ width: 360, height: 800 });
    const regler = await seite.evaluate(() => [...document.querySelectorAll('input[type="range"]')].filter((e) => (e as HTMLElement).offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
    for (const h of regler) expect(h).toBeGreaterThanOrEqual(44);
    // N12: "Redo the interview" laeuft im selben Tab.
    const tabsVorher = context.pages().length;
    await seite.locator('#interview-neu').click();
    await expect(seite).toHaveURL(/willkommen\.html#interview$/);
    expect(context.pages().length).toBe(tabsVorher);
    console.log(`einstellungen-s12: Runde 3 Leiste 1280 px ${hoehe} px hoch, ${zeilen.zeilen} Chip-Zeilen, ${regler.length} Regler bei 360 px >= 44 px, Kaestchen-Deckkraft ${blass}`);
  } finally {
    await seite.close();
  }
});
