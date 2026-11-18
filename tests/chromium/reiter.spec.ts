// Chromium: Phase 11 E4d1, die Huelle der Einstellungsseite (Entscheidungen 245 und 279): sieben Reiter, alte Anker, Tastatur, Pause und Fehlersatz
// in jedem Reiter, Reiterwechsel schreibt nichts, jede Einstellung genau einmal, ohne Pack drei zugeklappte Teile, 360 px ohne waagrechtes
// Scrollen, Platz der festen Vorschau folgt dem gespeicherten Stil (D1 bis D10).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMMLE_SKRIPT, vergleicheBedienelemente } from '../gemeinsam/einstellungen-soll.mjs';
import { REITER as REITERDATEN } from '../../entrypoints/options/reiter-daten';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';

const optionsUrl = (anker = '') => `chrome-extension://${id}/options.html${anker}`;
const lies = (seite: Page, k: string | null) =>
  seite.evaluate(async (k) => (await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>, k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const packMit = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const zuruecksetzen = (seite: Page) =>
  seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));

// Die Namen stehen nur in reiter-daten.ts (N11).
const REITER = REITERDATEN.map((r) => r.name);
const ID_REITER: Record<string, string> = Object.fromEntries(REITERDATEN.map((r) => [r.id, r.name]));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-reiter-'));
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

// Neue Seite mit gesetztem Speicher; `anker` ist der Anker der Adresse beim Laden.
async function frischeSeite(vorher: Record<string, unknown> = { einstieg: EINSTIEG_FERTIG }, breite = 1280, anker = ''): Promise<Page> {
  const seite = await context.newPage();
  await seite.setViewportSize({ width: breite, height: 800 });
  await seite.goto(optionsUrl());
  await zuruecksetzen(seite);
  if (Object.keys(vorher).length) await schreibe(seite, vorher);
  await seite.goto(optionsUrl(anker));
  await seite.reload();
  await expect(seite.locator('#pack-status')).not.toHaveText('');
  await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  return seite;
}

const gewaehlt = (seite: Page) => seite.evaluate(() => [...document.querySelectorAll('[role=tab][aria-selected=true]')].map((t) => t.textContent));

test('Aufbau: tablist mit sieben tab, jedes tab steuert ein tabpanel, genau eines ist offen, ohne Anker der Reiter Style', async () => {
  const seite = await frischeSeite();
  try {
    await expect(seite.locator('[role=tablist] [role=tab]')).toHaveText(REITER);
    expect(await gewaehlt(seite)).toEqual(['Style']);
    const bau = await seite.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role=tab]')].map((t) => {
        const p = document.getElementById(t.getAttribute('aria-controls')!)!;
        return { rolle: p.getAttribute('role'), benannt: p.getAttribute('aria-labelledby') === t.id, offen: !p.hidden, tabindex: t.tabIndex, ausgewaehlt: t.getAttribute('aria-selected') };
      }),
    );
    expect(bau.every((b) => b.rolle === 'tabpanel' && b.benannt)).toBe(true);
    expect(bau.filter((b) => b.offen).length).toBe(1);
    expect(bau.map((b) => b.tabindex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    // D4: alle Module laufen wie heute, auch in den verborgenen Reitern ist alles aufgebaut.
    const aufgebaut = await seite.evaluate(() => ({
      zonen: document.querySelectorAll('#panel-zonen #zonen li').length,
      karten: document.querySelectorAll('#panel-stil #preset-karten label.preset-karte').length,
      pack: !!document.querySelector('#panel-pack #stand h2'),
      ueber: !!document.querySelector('#panel-ueber #ueber h2'),
      verborgen: document.querySelectorAll('[role=tabpanel][hidden]').length,
    }));
    expect(aufgebaut).toEqual({ zonen: 10, karten: 12, pack: true, ueber: true, verborgen: 6 });
  } finally {
    await seite.close();
  }
});

// Nacharbeit N7: jedes Panel ist nach dem Oeffnen gefuellt (mindestens ein Kind mit Breite und Hoehe groesser 0), nicht nur "nicht verborgen".
test('N7: jedes Panel hat nach dem Oeffnen ein sichtbares Kind mit Breite und Hoehe', async () => {
  const seite = await frischeSeite();
  try {
    for (const name of REITER) {
      await seite.locator('[role=tab]', { hasText: name }).click();
      const m = await seite.evaluate(() => {
        const p = document.querySelector<HTMLElement>('[role=tabpanel]:not([hidden])')!;
        const gross = [...p.children].filter((k) => k.getBoundingClientRect().width > 0 && k.getBoundingClientRect().height > 0);
        return { offen: document.querySelectorAll('[role=tabpanel]:not([hidden])').length, kinder: gross.length };
      });
      expect(m.offen, `${name}: ein Panel offen`).toBe(1);
      expect(m.kinder, `${name}: Kinder mit Mass`).toBeGreaterThan(0);
    }
  } finally {
    await seite.close();
  }
});

// D3: jeder alte Anker und der Reiter, den er oeffnet.
const ANKER: [string, string][] = [
  ['covering', 'zonen'],
  ['abschnitt-stil', 'stil'],
  ['abschnitt-zonen', 'zonen'],
  ['abschnitt-stimmung', 'zonen'],
  ['abschnitt-ausnahmen', 'zonen'],
  ['stand', 'pack'],
  ['neu', 'pack'],
  ['erwachsen', 'erwachsen'],
  ['kontrolle', 'extras'],
  ['ton', 'pack'],
  ['ledger', 'ledger'],
  ['ueber', 'ueber'],
  ['abschnitt-interview', 'ueber'],
];

test('D3: jeder alte Anker oeffnet beim Laden den richtigen Reiter und bringt das Ziel in den Blick', async () => {
  for (const [anker, reiter] of ANKER) {
    const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 1280, `#${anker}`);
    try {
      expect(await gewaehlt(seite), `Reiter fuer #${anker}`).toEqual([ID_REITER[reiter]]);
      await expect(seite.locator(`#${anker}`), `Ziel #${anker} im Blick`).toBeInViewport();
      await expect(seite.locator(`#${anker}`)).toBeVisible();
    } finally {
      await seite.close();
    }
  }
});

test('D3: auch bei einem Wechsel des Ankers auf der offenen Seite (Popup setzt nur die Adresse)', async () => {
  const seite = await frischeSeite();
  try {
    for (const [anker, reiter] of ANKER) {
      await seite.evaluate((a) => (location.hash = `#${a}`), anker);
      await expect.poll(() => gewaehlt(seite), { message: `Reiter fuer #${anker}` }).toEqual([ID_REITER[reiter]]);
      await expect(seite.locator(`#${anker}`), `Ziel #${anker} im Blick`).toBeInViewport();
    }
    // Ein unbekannter Anker laesst den Reiter stehen, ein leerer geht zu Style.
    await seite.evaluate(() => (location.hash = '#gibt-es-nicht'));
    expect(await gewaehlt(seite)).toEqual(['About']);
    await seite.evaluate(() => history.pushState(null, '', location.pathname));
    await seite.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
    await expect.poll(() => gewaehlt(seite)).toEqual(['Style']);
  } finally {
    await seite.close();
  }
});

// Nacharbeit N3: ein unbekannter Anker (zum Beispiel einer von hilfe.html) oeffnet beim Laden Style, laesst bei einem Wechsel den Reiter stehen,
// schreibt nichts und wirft keinen Fehler.
test('N3 und Q4: unbekannte Anker oeffnen beim Laden Style, lassen beim Wechsel den Reiter stehen, schreiben nichts (dieselben Zaehler wie D9), kein Fehler', async () => {
  const quelle = await frischeSeite();
  await quelle.close();
  const horcher = await context.newPage();
  await horcher.goto(`chrome-extension://${id}/hilfe.html`);
  await horcher.evaluate(() => {
    (globalThis as any).__schreib = 0;
    (globalThis as any).chrome.storage.onChanged.addListener(() => (globalThis as any).__schreib++);
  });
  const seite = await context.newPage();
  // Die Schreibaufrufe werden ueber alle Ladevorgaenge hinweg gesammelt (sessionStorage der Erweiterungsseite).
  await seite.addInitScript(() => {
    const sl = (globalThis as any).chrome?.storage?.local;
    if (!sl) return;
    for (const name of ['set', 'remove', 'clear']) {
      const echt = sl[name].bind(sl);
      sl[name] = (...a: unknown[]) => (sessionStorage.setItem('aufrufe', `${sessionStorage.getItem('aufrufe') ?? ''}${name};`), echt(...a));
    }
  });
  const fehler: string[] = [];
  seite.on('pageerror', (e) => fehler.push(String(e)));
  try {
    await seite.goto(optionsUrl());
    await seite.evaluate(() => sessionStorage.removeItem('aufrufe'));
    const vorher = JSON.stringify(await lies(seite, null));
    for (const anker of ['gibt-es-nicht', 'pin', 'how-i-work/pin-me', 'calm', 'status']) {
      await seite.goto(optionsUrl(`#${anker}`));
      await seite.reload();
      await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
      expect(await gewaehlt(seite), `beim Laden #${anker}`).toEqual(['Style']);
    }
    await seite.goto(optionsUrl('#ledger'));
    await seite.reload();
    await expect.poll(() => gewaehlt(seite)).toEqual(['Ledger']);
    for (const anker of ['gibt-es-nicht', 'pin', 'how-i-work/pin-me', 'calm']) {
      await seite.evaluate((a) => (location.hash = `#${a}`), anker);
      await seite.waitForTimeout(150);
      expect(await gewaehlt(seite), `beim Wechsel auf #${anker}`).toEqual(['Ledger']);
    }
    expect(fehler).toEqual([]);
    expect(await seite.evaluate(() => sessionStorage.getItem('aufrufe') ?? ''), 'Schreibaufrufe der Einstellungsseite').toBe('');
    expect(await horcher.evaluate(() => (globalThis as any).__schreib), 'Schreibereignisse im Speicher').toBe(0);
    expect(JSON.stringify(await lies(seite, null))).toBe(vorher);
  } finally {
    await seite.close();
    await horcher.close();
  }
});

test('D4: Klick setzt den Anker des Reiters in die Adresse, Zurueck im Browser wechselt den Reiter', async () => {
  const seite = await frischeSeite();
  try {
    await seite.locator('[role=tab]', { hasText: 'Adult sites' }).click();
    await seite.locator('[role=tab]', { hasText: 'Ledger' }).click();
    expect(await seite.evaluate(() => location.hash)).toBe('#ledger');
    await seite.goBack();
    await expect.poll(() => gewaehlt(seite)).toEqual(['Adult sites']);
    expect(await seite.evaluate(() => location.hash)).toBe('#erwachsen');
    await seite.goForward();
    await expect.poll(() => gewaehlt(seite)).toEqual(['Ledger']);
    await expect(seite.locator('#panel-ledger')).toBeVisible();
    await expect(seite.locator('#panel-erwachsen')).toBeHidden();
  } finally {
    await seite.close();
  }
});

test('D4: Tastatur: Pfeile, Pos1 und Ende bewegen nur den Fokus, Eingabe und Leertaste waehlen, der Tab-Halt kehrt zurueck', async () => {
  const seite = await frischeSeite();
  try {
    const tabs = seite.locator('[role=tab]');
    await tabs.nth(0).focus();
    await seite.keyboard.press('ArrowDown');
    await expect(tabs.nth(1)).toBeFocused();
    expect(await gewaehlt(seite), 'ein Pfeil waehlt nicht').toEqual(['Style']);
    await seite.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toBeFocused();
    await seite.keyboard.press('ArrowUp');
    await expect(tabs.nth(1)).toBeFocused();
    await seite.keyboard.press('End');
    await expect(tabs.nth(6)).toBeFocused();
    await seite.keyboard.press('ArrowDown');
    await expect(tabs.nth(0), 'Umlauf vom Ende zum Anfang').toBeFocused();
    await seite.keyboard.press('ArrowLeft');
    await expect(tabs.nth(6)).toBeFocused();
    await seite.keyboard.press('Home');
    await expect(tabs.nth(0)).toBeFocused();
    expect(await gewaehlt(seite)).toEqual(['Style']);
    await seite.keyboard.press('ArrowDown');
    await seite.keyboard.press('Enter');
    expect(await gewaehlt(seite)).toEqual(['What I cover']);
    await seite.keyboard.press('ArrowDown');
    await seite.keyboard.press(' ');
    expect(await gewaehlt(seite)).toEqual(['Adult sites']);
    // Roving tabindex: nur der gewaehlte Reiter ist ein Tab-Halt; nach dem Verlassen der Leiste liegt er wieder dort.
    await seite.keyboard.press('End');
    await seite.locator('#pause').focus();
    expect(await seite.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role=tab]')].map((t) => t.tabIndex))).toEqual([-1, -1, 0, -1, -1, -1, -1]);
    // Sichtbarer Fokus.
    await tabs.nth(3).focus();
    const kontur = await tabs.nth(3).evaluate((e) => ({ w: parseFloat(getComputedStyle(e).outlineWidth), s: getComputedStyle(e).outlineStyle }));
    expect(kontur.s).not.toBe('none');
    expect(kontur.w).toBeGreaterThanOrEqual(2);
  } finally {
    await seite.close();
  }
});

test('D5 und D9: Pause ist in jedem Reiter bedienbar, der Fehlersatz bleibt beim Wechsel in der Leiste, auch aus einem verborgenen Reiter', async () => {
  const seite = await frischeSeite();
  try {
    for (const name of REITER) {
      await seite.locator('[role=tab]', { hasText: name }).click();
      await seite.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await seite.waitForTimeout(400); // die kleine Pause der Leiste folgt dem Scrollen asynchron (IntersectionObserver)
      // Entweder steht der grosse Knopf im Bild oder der kleine in der Leiste (er erscheint erst, wenn der grosse aus dem Bild ist): einer von beiden
      // ist sichtbar und bedienbar. Nach jeder Handlung wird neu gewaehlt, weil sich die Seite dabei bewegen kann.
      const knopf = async () => ((await seite.locator('#pause-leiste').isVisible()) ? seite.locator('#pause-leiste') : seite.locator('#pause'));
      await expect(await knopf(), `Pause in ${name}`).toBeVisible();
      // (der Wechsel des Status bewegt die Seite; wer gerade sichtbar ist, entscheidet jeder Versuch neu)
      await expect(async () => (await knopf()).click({ timeout: 1500 })).toPass({ timeout: 10_000 });
      await expect.poll(async () => (await lies(seite, 'einstellungen')).einstellungen?.pause, { message: `pausiert in ${name}` }).toBe(true);
      await expect(async () => (await knopf()).click({ timeout: 1500 })).toPass({ timeout: 10_000 });
      await expect.poll(async () => (await lies(seite, 'einstellungen')).einstellungen?.pause, { message: `zurueck in ${name}` }).toBe(false);
    }
    // Fehlersatz: Speichern scheitern lassen, im Reiter What I cover bedienen, in jeden anderen Reiter wechseln.
    await seite.evaluate(() => {
      const sl = (globalThis as any).chrome.storage.local;
      sl.__echtSet ??= sl.set.bind(sl);
      sl.set = (o: Record<string, unknown>) => ('einstellungen' in o ? Promise.reject(new Error('Test: Speichern scheitert')) : sl.__echtSet(o));
    });
    await seite.locator('[role=tab]', { hasText: 'What I cover' }).click();
    await seite.locator('#abschnitt-zonen label.schalter').filter({ hasText: 'Strict' }).click();
    await expect(seite.locator('#speicher-meldung')).toHaveText(FEHLER_SPEICHERN);
    for (const name of REITER) {
      await seite.locator('[role=tab]', { hasText: name }).click();
      await expect(seite.locator('#speicher-meldung'), `Fehlersatz in ${name}`).toBeVisible();
      await expect(seite.locator('#speicher-meldung')).toHaveText(FEHLER_SPEICHERN);
      const r = await seite.locator('#speicher-meldung').boundingBox();
      expect(r!.y).toBeGreaterThanOrEqual(0);
    }
    // Ein Element, das im verborgenen Reiter speichert (kein Mausklick moeglich, darum der Klick im Dokument): der Satz steht in der Leiste.
    await seite.evaluate(() => {
      const m = document.getElementById('speicher-meldung')!;
      m.textContent = '';
      m.hidden = true;
    });
    await seite.locator('[role=tab]', { hasText: 'Ledger' }).click();
    await seite.evaluate(() => document.getElementById('kon-leerlauf')!.click());
    await expect(seite.locator('#panel-extras')).toBeHidden();
    await expect(seite.locator('#speicher-meldung')).toBeVisible();
    await expect(seite.locator('#speicher-meldung')).toHaveText(FEHLER_SPEICHERN);
    await seite.evaluate(() => ((globalThis as any).chrome.storage.local.set = (globalThis as any).chrome.storage.local.__echtSet));
  } finally {
    await seite.close();
  }
});

test('D9: Oeffnen der Seite und Wechsel jedes Reiters schreiben nichts in den Speicher (Zaehler liegen schon vor dem Laden)', async () => {
  const vorbereitung = await context.newPage();
  await vorbereitung.goto(optionsUrl());
  await zuruecksetzen(vorbereitung);
  await schreibe(vorbereitung, { einstieg: EINSTIEG_FERTIG, einstellungen: { schwelle: 0.17, preset: 'blur', strict: true } });
  const vorher = JSON.stringify(await lies(vorbereitung, null));
  await vorbereitung.close();
  // Zaehler 1: eine zweite Erweiterungsseite (die Hilfe) hoert schon vor dem Oeffnen auf jede Aenderung des Speichers.
  const horcher = await context.newPage();
  await horcher.goto(`chrome-extension://${id}/hilfe.html`);
  await horcher.evaluate(() => {
    (globalThis as any).__schreib = 0;
    (globalThis as any).chrome.storage.onChanged.addListener(() => (globalThis as any).__schreib++);
  });
  // Zaehler 2: jeder Schreibaufruf (set, remove, clear) der Einstellungsseite, schon ab dem ersten Skript (auch ein Aufruf mit gleichem Wert zaehlt).
  const seite = await context.newPage();
  await seite.addInitScript(() => {
    const sl = (globalThis as any).chrome?.storage?.local;
    if (!sl) return;
    (globalThis as any).__aufrufe = [];
    for (const name of ['set', 'remove', 'clear']) {
      const echt = sl[name].bind(sl);
      sl[name] = (...a: unknown[]) => ((globalThis as any).__aufrufe.push(name), echt(...a));
    }
  });
  try {
    await seite.goto(optionsUrl());
    await expect(seite.locator('#pack-status')).not.toHaveText('');
    await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
    await seite.waitForTimeout(800);
    expect(await seite.evaluate(() => (globalThis as any).__aufrufe), 'Schreibaufrufe beim Oeffnen').toEqual([]);
    expect(await horcher.evaluate(() => (globalThis as any).__schreib), 'Schreibereignisse beim Oeffnen').toBe(0);
    expect(JSON.stringify(await lies(seite, null)), 'Speicher nach dem Oeffnen').toBe(vorher);
    for (const name of [...REITER, ...REITER.slice().reverse()]) await seite.locator('[role=tab]', { hasText: name }).click();
    for (const [anker] of ANKER) await seite.evaluate((a) => (location.hash = `#${a}`), anker);
    await seite.locator('[role=tab]').first().focus();
    for (const t of ['ArrowDown', 'ArrowDown', 'End', 'Home', 'Enter']) await seite.keyboard.press(t);
    await seite.waitForTimeout(500);
    expect(await seite.evaluate(() => (globalThis as any).__aufrufe), 'Schreibaufrufe beim Wechseln').toEqual([]);
    expect(await horcher.evaluate(() => (globalThis as any).__schreib), 'Schreibereignisse beim Wechseln').toBe(0);
    expect(JSON.stringify(await lies(seite, null)), 'Speicher nach den Wechseln').toBe(vorher);
  } finally {
    await seite.close();
    await horcher.close();
  }
});

// Jede Einstellung genau einmal (F7 und D2, Nacharbeit N2): der Test liest ALLE Bedienelemente der sieben Panels und vergleicht ids und Zahl mit der
// Soll-Liste aus dem Stand HEAD (tests/gemeinsam/einstellungen-soll.mjs, dort mit Herkunft und den ausgenommenen Behaeltern).
test('Jede Einstellung genau einmal: alle Bedienelemente der Panels gegen die Soll-Liste aus HEAD, ohne und mit Pack', async () => {
  const seite = await frischeSeite();
  try {
    const pruefe = async (zustand: string) => {
      const ist = await seite.evaluate(`(() => { ${SAMMLE_SKRIPT} })()`);
      expect(vergleicheBedienelemente(ist as never), `Bedienelemente ${zustand}`).toEqual([]);
      const doppelt = await seite.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
        return [...new Set(ids.filter((i, n) => ids.indexOf(i) !== n))];
      });
      expect(doppelt, `doppelte ids ${zustand}`).toEqual([]);
      // Kein Bedienelement liegt ausserhalb der Panels (ausser #pause im Kopf und #pause-leiste in der Leiste).
      const ausserhalb = await seite.evaluate(() =>
        [...document.querySelectorAll('main :is(input, select, textarea, button, [role=switch], [role=radio], [role=slider], [contenteditable])')]
          .filter((e) => !e.closest('[role=tabpanel]') && !e.closest('header') && !e.closest('#leiste') && !e.closest('#sprung'))
          .map((e) => e.id || e.tagName),
      );
      expect(ausserhalb, `ausserhalb der Panels ${zustand}`).toEqual([]);
    };
    await pruefe('ohne Pack');
    await schreibe(seite, { pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'zensur:sticker', 'kontrolle:blitz', 'ton']) });
    await expect(seite.locator('#erwachsen')).toHaveAttribute('data-zu', '0'); // das Pack ist gelesen, nichts mehr zugeklappt
    await pruefe('mit Pack');
  } finally {
    await seite.close();
  }
});

test('D6: ohne Pack sind Adult sites, Mia’s extras (Calm mode bleibt offen) und Sound zugeklappt, die Reiter selbst waehlbar', async () => {
  const seite = await frischeSeite();
  try {
    await seite.locator('[role=tab]', { hasText: 'Adult sites' }).click();
    await expect(seite.locator('#erwachsen-zu-knopf')).toBeVisible();
    await expect(seite.locator('#erwachsen-zu-knopf')).toHaveText('Set them now');
    await expect(seite.locator('#erwachsen-block')).toBeHidden();
    await seite.locator('[role=tab]', { hasText: 'Mia’s extras' }).click();
    await expect(seite.locator('#kontrolle-zu-knopf')).toBeVisible();
    await expect(seite.locator('#kontrolle-block')).toBeHidden();
    await expect(seite.locator('#ruhig')).toBeVisible();
    await expect(seite.locator('#ruhig-zeile')).toBeVisible();
    // Calm mode steht ganz oben im Reiter.
    expect(
      await seite.evaluate(() => {
        const nr = (css: string) => [...document.querySelectorAll('#kontrolle *')].indexOf(document.querySelector(css)!);
        return nr('#kon-titel') < nr('#ruhig') && nr('#ruhig') < nr('#kon-werbung') && nr('#ruhig') < nr('#kon-blitz');
      }),
    ).toBe(true);
    await seite.locator('[role=tab]', { hasText: 'Pack and sound' }).click();
    await expect(seite.locator('#ton-zu-knopf')).toBeVisible();
    await expect(seite.locator('#ton-block')).toBeHidden();
    // Ohne Pack steht die Pack-Karte vor Sound, mit Pack danach.
    expect(await seite.evaluate(() => [...document.querySelectorAll('#panel-pack > section')].map((s) => s.id))).toEqual(['stand', 'ton']);
    await seite.locator('#kontrolle-zu-knopf').count();
    // Der Knopf klappt auf (nichts wird geschrieben).
    await seite.locator('[role=tab]', { hasText: 'Mia’s extras' }).click();
    await seite.locator('#kontrolle-zu-knopf').click();
    await expect(seite.locator('#kontrolle-block')).toBeVisible();
  } finally {
    await seite.close();
  }
});

test('D6: mit Pack ist alles offen und die Pack-Karte steht nach Sound', async () => {
  const seite = await frischeSeite();
  try {
    // Das Pack erst nach dem Laden schreiben: der Abgleich des Pack-Teils raeumt beim Start ein Pack ohne Bilder in der Datenbank weg.
    await schreibe(seite, { pack: packMit(['stil:mia-patch', 'erwachsen:vorschau']) });
    await seite.locator('[role=tab]', { hasText: 'Adult sites' }).click();
    await expect(seite.locator('#erwachsen-zu-knopf')).toBeHidden();
    await expect(seite.locator('#erwachsen-block')).toBeVisible();
    await seite.locator('[role=tab]', { hasText: 'Pack and sound' }).click();
    expect(await seite.evaluate(() => [...document.querySelectorAll('#panel-pack > section')].map((s) => s.id))).toEqual(['ton', 'stand']);
  } finally {
    await seite.close();
  }
});

test('D10: 360 px ohne waagrechtes Scrollen in jedem Reiter, Reiter mindestens 44 px bei 360, 800 und 1280', async () => {
  for (const breite of [360, 800, 1280]) {
    const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, breite);
    try {
      for (const name of REITER) {
        await seite.locator('[role=tab]', { hasText: name }).click();
        const m = await seite.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        expect(m.sw, `${name} bei ${breite} px: scrollWidth ${m.sw}`).toBeLessThanOrEqual(m.iw);
      }
      const kasten = await seite.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => {
        const r = t.getBoundingClientRect();
        return { n: t.textContent, h: r.height, b: r.width };
      }));
      for (const k of kasten) {
        expect(k.h, `${k.n} bei ${breite} px Hoehe`).toBeGreaterThanOrEqual(43.5);
        expect(k.b, `${k.n} bei ${breite} px Breite`).toBeGreaterThanOrEqual(43.5);
      }
      if (breite === 360) {
        // Die Zeile der Reiter laesst sich schieben (sieben Reiter sind breiter als der Schirm); der gewaehlte Reiter liegt im Bild.
        const z = await seite.evaluate(() => {
          const l = document.getElementById('reiter-liste')!;
          const t = document.querySelector('[role=tab][aria-selected=true]')!.getBoundingClientRect();
          return { scroll: l.scrollWidth > l.clientWidth, imBild: t.left >= 0 && t.right <= innerWidth };
        });
        expect(z).toEqual({ scroll: true, imBild: true });
      }
    } finally {
      await seite.close();
    }
  }
});

test('D10: 360 px, der gewaehlte Reiter liegt nach einem Anker im Bild der schiebbaren Zeile', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 360, '#ueber');
  try {
    await expect(seite.locator('[role=tab][aria-selected=true]')).toBeInViewport({ ratio: 0.99 });
    expect(await seite.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await seite.close();
  }
});

// Nacharbeit N9: der Verlauf am rechten Rand der Reiterzeile zeigt nur, solange dort noch Reiter ausserhalb liegen; am Ende ist der letzte lesbar.
test('N9: bei 360 px verschwindet der Verlauf am Ende der Reiterzeile und der letzte Reiter ist voll lesbar', async () => {
  const seite = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 360);
  try {
    const maske = () => seite.evaluate(() => {
      const l = document.getElementById('reiter-liste')!;
      const cs = getComputedStyle(l);
      return { weiter: l.dataset.weiter, maske: cs.maskImage !== 'none' || (cs as any).webkitMaskImage !== 'none' };
    });
    await seite.evaluate(() => (document.getElementById('reiter-liste')!.scrollLeft = 0));
    await expect.poll(maske).toEqual({ weiter: '1', maske: true });
    await seite.evaluate(() => (document.getElementById('reiter-liste')!.scrollLeft = 10_000));
    await expect.poll(maske).toEqual({ weiter: '0', maske: false });
    const lage = await seite.evaluate(() => {
      const l = document.getElementById('reiter-liste')!.getBoundingClientRect();
      const t = document.getElementById('reiter-ueber')!.getBoundingClientRect();
      return { innen: t.left >= l.left && t.right <= l.right + 0.5, rechts: Math.round(t.right), liste: Math.round(l.right) };
    });
    expect(lage.innen, JSON.stringify(lage)).toBe(true);
  } finally {
    await seite.close();
  }
});

test('D7: der Platz der Vorschau zeigt in jedem Reiter den gespeicherten Stil und folgt einem Wechsel', async () => {
  const seite = await frischeSeite();
  try {
    const etikett = seite.locator('#vorschau-spalte .v-vorschau-etikett');
    const bild = () => seite.evaluate(() => document.querySelector('#vorschau-spalte .v-vorschau-flaeche')!.innerHTML);
    await expect(etikett).toHaveText('Mosaic');
    const mosaik = await bild();
    expect(mosaik).toContain('<svg');
    // Der Platz sitzt ausserhalb der Panels und ist in jedem Reiter sichtbar.
    expect(await seite.evaluate(() => !!document.querySelector('#vorschau-spalte')!.closest('[role=tabpanel]'))).toBe(false);
    for (const name of REITER) {
      await seite.locator('[role=tab]', { hasText: name }).click();
      await expect(seite.locator('#vorschau-spalte .v-vorschau-platz'), name).toBeVisible();
      await expect(etikett, name).toHaveText('Mosaic');
    }
    // Wechsel des Stils ueber die Karte.
    await seite.locator('[role=tab]', { hasText: 'Style' }).click();
    await seite.locator('#preset-karten label.preset-karte').filter({ has: seite.locator('strong', { hasText: /^Blur$/ }) }).click();
    await expect(etikett).toHaveText('Blur');
    expect(await bild()).not.toBe(mosaik);
    expect((await lies(seite, 'einstellungen')).einstellungen.preset).toBe('blur');
    await seite.locator('[role=tab]', { hasText: 'Ledger' }).click();
    await expect(etikett).toHaveText('Blur');
    // Wechsel von aussen (Popup, anderer Tab): der Platz folgt.
    await schreibe(seite, { einstellungen: { ...(await lies(seite, 'einstellungen')).einstellungen, preset: 'person-blur' } });
    await expect(etikett).toHaveText('Whole person, blur');
    // Mia-Presets gelten ohne Pack nicht: der Platz zeigt, was wirklich gilt.
    await schreibe(seite, { einstellungen: { ...(await lies(seite, 'einstellungen')).einstellungen, preset: 'mia-mosaik' } });
    await expect(etikett).toHaveText('Mosaic');
    // Keine doppelte id durch das Bild des Platzes.
    const doppelt = await seite.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return ids.filter((i, n) => ids.indexOf(i) !== n);
    });
    expect(doppelt).toEqual([]);
  } finally {
    await seite.close();
  }
});

test('D7: der Platz der Vorschau liegt breit rechts neben dem Inhalt, schmal als Streifen darueber', async () => {
  const breit = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 1280);
  try {
    const l = await breit.evaluate(() => {
      const v = document.getElementById('vorschau-spalte')!.getBoundingClientRect();
      const m = document.querySelector('.reiter-mitte')!.getBoundingClientRect();
      const n = document.getElementById('sprung')!.getBoundingClientRect();
      return { vorschauRechts: v.left >= m.right - 1, reiterLinks: n.right <= m.left + 1 };
    });
    expect(l).toEqual({ vorschauRechts: true, reiterLinks: true });
  } finally {
    await breit.close();
  }
  const schmal = await frischeSeite({ einstieg: EINSTIEG_FERTIG }, 360);
  try {
    const l = await schmal.evaluate(() => {
      const v = document.getElementById('vorschau-spalte')!.getBoundingClientRect();
      const m = document.querySelector('.reiter-mitte')!.getBoundingClientRect();
      return { darueber: v.bottom <= m.top + 1, breit: v.width };
    });
    expect(l.darueber).toBe(true);
  } finally {
    await schmal.close();
  }
});
