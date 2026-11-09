// Chromium: Popup (Auftrag U, PHASE-6-AUFTRAEGE-SESSION-12.md Abschnitt 6): Pack-Knoepfe fuehren zum Pack-Abschnitt (Fund 7), "All settings" steht oben
// (Fund 8), Kontraste (Fund 9 und 10), Namen der "even when clothed"-Kaestchen (Fund 12), Satz vor und nach "Leave this site alone" (Fund 13),
// Breite und Schriftgroesse (Fund 27), Stimmungswort (Fund 6), Speicherfehler (Fund 26) und schnelle Folgeklicks (UEBERGABE-11 Punkt 3).
// Alles mit echten Klicks und Tasten auf der Popup-Seite, geoeffnet als Tab (chrome-extension://<id>/popup.html).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../../entrypoints/popup/texte';
import { FEHLER_SPEICHERN, STIMMUNG_WOERTER, stimmungsWort } from '../../src/oberflaeche/gemeinsam';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const SEITE = `http://localhost:${port}/hello.html`;
const ALLE = ['stil:mia-patch', 'erwachsen:vorschau', 'erwachsen:quiz', 'erwachsen:titel', 'erwachsen:ersatz', 'quiz:freilegen', 'zensur:steigerung', 'chibi:pack'];
const ZONEN_NAMEN = ['Eyes', 'Mouth', 'Face', 'Head', 'Breasts', 'Genitals', 'Buttocks', 'Belly', 'Feet', 'Armpits'];
const BEDECKBAR = ['Breasts', 'Genitals', 'Buttocks', 'Belly', 'Feet', 'Armpits'];

let profil = '';
let context: BrowserContext;
let id = '';
const popupUrl = () => `chrome-extension://${id}/popup.html`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const einst = (seite: Page) => lies(seite, 'einstellungen').then((e) => e ?? {});
const packMit = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 3, groesse: 1, importiert: 1 });
const zuruecksetzen = (seite: Page) => seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'steigerung', 'einstellungen']));
// Phase 9, Paket A (Fund 2): Mood, Zonen und Strict stehen hinter "Change". Idempotent (der Zustand bleibt in localStorage der Erweiterung).
const oeffneGruppe = async (seite: Page) => {
  if ((await seite.locator('#aendern').getAttribute('aria-expanded')) !== 'true') await seite.locator('#aendern').click();
  await expect(seite.locator('#abdeckung-gruppe')).toBeVisible();
};
const schliesseGruppe = async (seite: Page) => {
  if ((await seite.locator('#aendern').getAttribute('aria-expanded')) === 'true') await seite.locator('#aendern').click();
  await expect(seite.locator('#abdeckung-gruppe')).toBeHidden();
};
const hilfeAdresse = (kurz: string) => `hilfe.html#${kurz}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-popup-'));
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

// Kontrast nach WCAG (relative Leuchtdichte) aus zwei CSS-Farben "rgb(r, g, b)".
const KONTRAST = `(a, b) => {
  const l = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const x = l(a), y = l(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}`;

test('Fund 7: die Pack-Knoepfe oeffnen die Einstellungsseite gleich beim Pack-Abschnitt (#neu ohne Pack, #stand mit Pack)', async () => {
  // Das Popup schliesst sich nach dem Klick selbst, darum je Klick ein frisches Popup.
  const frisch = async () => {
    const p = await context.newPage();
    await p.goto(popupUrl());
    await expect(p.locator('#status')).not.toBeEmpty();
    return p;
  };
  const klicke = async (p: Page, knopf: string, anker: string) => {
    await expect(p.locator(knopf)).toBeVisible();
    const neu = context.waitForEvent('page');
    await p.locator(knopf).click();
    const optionen = await neu;
    await expect.poll(() => optionen.url()).toBe(`chrome-extension://${id}/options.html#${anker}`);
    // Der Pack-Abschnitt liegt im Blick (nicht nur die Adresse stimmt)
    await expect(optionen.locator(`#${anker}`)).toBeAttached();
    await expect.poll(async () => optionen.evaluate((a) => { const r = document.getElementById(a)!.getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight; }, anker)).toBe(true);
    await optionen.close();
    await expect.poll(() => p.isClosed()).toBe(true);
    return optionen;
  };
  const hilfe = await context.newPage();
  try {
    await hilfe.goto(popupUrl());
    await zuruecksetzen(hilfe);
    for (const knopf of ['#pack-link', '#erwachsen-pack-link']) await klicke(await frisch(), knopf, 'neu');
    await schreibe(hilfe, { pack: packMit(['stil:mia-patch']) });
    const p = await frisch();
    await expect(p.locator('#pack-link')).toHaveText(T.PACK_KNOPF_MIT);
    await klicke(p, '#pack-link', 'stand');
    console.log('popup: Pack-Knoepfe fuehren zu #neu und #stand (3 Klicks, 3 Adressen)');
  } finally {
    await zuruecksetzen(hilfe);
    await hilfe.close();
  }
});

test('Fund 8, 27 und 9: "All settings" steht oben ohne Scrollen, Breite 100 % bis 360 px, Schrift mindestens 12,5 px, Knopftext mit Kontrast', async () => {
  const seite = await context.newPage();
  try {
    await seite.setViewportSize({ width: 360, height: 640 });
    await seite.goto(popupUrl());
    await expect(seite.locator('#status')).not.toBeEmpty();
    // Lage: der Knopf liegt im ersten Bildschirm und noch ueber der Pause-Taste
    const knopf = (await seite.locator('#alle-einstellungen').boundingBox())!;
    const pause = (await seite.locator('#pause').boundingBox())!;
    expect(knopf.y + knopf.height).toBeLessThanOrEqual(80);
    expect(knopf.y + knopf.height).toBeLessThan(pause.y);
    // Breite 100 % bis 360 px, kein waagrechtes Scrollen
    const breite = await seite.evaluate(() => ({ body: document.body.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(breite.body).toBe(360);
    expect(breite.scroll).toBeLessThanOrEqual(breite.client);
    await seite.setViewportSize({ width: 320, height: 640 });
    const schmal = await seite.evaluate(() => ({ body: document.body.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(schmal.body).toBe(320);
    expect(schmal.scroll).toBeLessThanOrEqual(schmal.client);
    await seite.setViewportSize({ width: 1280, height: 800 });
    expect(await seite.evaluate(() => document.body.getBoundingClientRect().width)).toBeLessThanOrEqual(360);
    // Schriftgroesse: Hinweise, Unterzeilen, "even when clothed", Fusszeile
    await seite.setViewportSize({ width: 360, height: 900 });
    const kleinste = await seite.evaluate(() => {
      const sel = ['.hinweis', '.enden', '.schalter small', '.auch', 'footer'];
      const w: number[] = [];
      for (const s of sel) for (const e of document.querySelectorAll(s)) w.push(parseFloat(getComputedStyle(e).fontSize));
      return Math.min(...w);
    });
    expect(kleinste).toBeGreaterThanOrEqual(12.5);
    // Fund 9: Text der kleinen Knoepfe auf ihrem Grund mindestens 4,5:1
    const kontrast = await seite.evaluate(`(${KONTRAST})(getComputedStyle(document.querySelector('button.klein')).color, getComputedStyle(document.querySelector('button.klein')).backgroundColor)`);
    expect(kontrast as number).toBeGreaterThanOrEqual(4.5);
    // Der Knopf wirkt: oeffnet die Einstellungsseite (das Popup schliesst sich danach selbst)
    const neu = context.waitForEvent('page');
    await seite.locator('#alle-einstellungen').click();
    const optionen = await neu;
    await expect.poll(() => optionen.url()).toContain('/options.html');
    await optionen.close();
    console.log(`popup: Knopf bis y ${Math.round(knopf.y + knopf.height)} px, Breite ${breite.body}/${schmal.body}, kleinste Schrift ${kleinste} px, Knopfkontrast ${(kontrast as number).toFixed(2)}`);
  } finally {
    await seite.close();
  }
});

test('Fund 10: Schalterbahn (aus) und Feldrand haben mindestens 3:1 gegen den weissen Grund', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await expect(seite.locator('#status')).not.toBeEmpty();
    const werte = await seite.evaluate(`(() => {
      const k = ${KONTRAST};
      const f = (e, p) => getComputedStyle(e)[p];
      const weiss = f(document.querySelector('section'), 'backgroundColor');
      const aus = document.querySelector('.schalter input:not(:checked) + .regler');
      const an = document.querySelector('.schalter input:checked + .regler') ?? document.querySelector('#strict + .regler');
      const feld = document.querySelector('.wahl input:not(:checked) + span');
      const gewaehlt = document.querySelector('.wahl input:checked + span');
      return { bahn: k(f(aus, 'backgroundColor'), weiss), rand: k(f(feld, 'borderTopColor'), weiss), randFeld: k(f(feld, 'borderTopColor'), f(feld, 'backgroundColor')),
        gewRand: k(f(gewaehlt, 'borderTopColor'), weiss), gewRandFuellung: k(f(gewaehlt, 'borderTopColor'), f(gewaehlt, 'backgroundColor')), anBahn: an ? k(f(an, 'backgroundColor'), weiss) : 99 };
    })()`);
    const w = werte as Record<string, number>;
    for (const [name, wert] of Object.entries(w)) expect(wert, name).toBeGreaterThanOrEqual(3);
    console.log(`popup: Kontraste ${Object.entries(w).map(([n, v]) => `${n} ${v.toFixed(2)}`).join(', ')}`);
  } finally {
    await seite.close();
  }
});

test('Fund 12: die sechs "even when clothed"-Kaestchen tragen den Zonennamen', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await expect(seite.locator('#status')).not.toBeEmpty();
    await oeffneGruppe(seite);
    await expect(seite.locator('#zonen input[data-bedeckt]')).toHaveCount(BEDECKBAR.length);
    for (const name of BEDECKBAR) await expect(seite.getByLabel(`${name}: even when clothed`)).toHaveCount(1);
    // Echter Klick ueber den Namen: Genitals an, dann "even when clothed" frei und gespeichert
    const anVorher = (await einst(seite)).zonen?.genitals?.an ?? (await seite.locator('input[data-zone="genitals"]').isChecked());
    await seite.locator('#zonen label.schalter').filter({ hasText: 'Genitals' }).click();
    await expect.poll(async () => (await einst(seite)).zonen?.genitals?.an).toBe(!anVorher);
    if (anVorher) await seite.locator('#zonen label.schalter').filter({ hasText: 'Genitals' }).click();
    await expect.poll(async () => (await einst(seite)).zonen?.genitals?.an).toBe(true);
    const bedeckt = seite.getByLabel('Genitals: even when clothed');
    const bVorher = await bedeckt.isChecked();
    await bedeckt.click();
    await expect.poll(async () => (await einst(seite)).zonen?.genitals?.bedeckt).toBe(!bVorher);
    const namen = await seite.locator('#zonen input[data-zone]').evaluateAll((l) => l.map((e) => e.closest('label')?.textContent?.trim()));
    expect(namen).toEqual(ZONEN_NAMEN);
    console.log(`popup: ${BEDECKBAR.length} Kaestchen mit Zonennamen, Genitals bedeckt gespeichert`);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Fund 13: vor dem Klick sagt der Satz, was passiert; danach, dass es gilt und wie man es zuruecknimmt', async () => {
  const web = await context.newPage();
  await web.goto(SEITE);
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await web.bringToFront();
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    await expect(seite.locator('#ausnahme')).toBeEnabled();
    const vorher = (await seite.locator('#ausnahme-hinweis').textContent()) ?? '';
    expect(vorher).toBe(T.AUSNAHME_VOR('localhost'));
    expect(vorher).not.toMatch(/skip|from now on|undo/i);
    await seite.locator('#ausnahme').click();
    await expect.poll(async () => (await einst(seite)).ausnahmen ?? []).toContain('localhost');
    await expect(seite.locator('#ausnahme')).toHaveText(T.AUSNAHME_KNOPF_ZURUECK);
    const nachher = (await seite.locator('#ausnahme-hinweis').textContent()) ?? '';
    expect(nachher).toBe(T.AUSNAHME_NACH('localhost'));
    await expect(seite.locator('#status')).toHaveText(T.STATUS_AUSNAHME);
    await expect(seite.locator('#status')).not.toContainText(/skip/i);
    await seite.locator('#ausnahme').click();
    await expect.poll(async () => (await einst(seite)).ausnahmen ?? []).not.toContain('localhost');
    await expect(seite.locator('#ausnahme-hinweis')).toHaveText(T.AUSNAHME_VOR('localhost'));
    console.log(`popup: Satz vorher ${vorher.length} Zeichen, nachher ${nachher.length} Zeichen`);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
    await web.close();
  }
});

test('Fund 6: "Mia’s mood" zeigt ein Wort statt der Zahl, Regler mit aria-valuetext', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    await oeffneGruppe(seite);
    const regler = seite.locator('#stimmung');
    await regler.focus();
    // 0.10 bis 0.25: Home setzt auf 0.10, dann in 0.01-Schritten nach rechts
    await seite.keyboard.press('End');
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.25, 5);
    await seite.keyboard.press('Home');
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.1, 5);
    const gesehen: string[] = [];
    for (let h = 10; h <= 25; h++) {
      // Phase 9, Fund 28: bei Mias Standard (0.10) steht "(my default)" dabei, wie auf der Einstellungsseite
      const erwartet = stimmungsWort(h / 100) + (h === 10 ? ' (my default)' : '');
      await expect(seite.locator('#stimmung-wert')).toHaveText(erwartet);
      await expect(regler).toHaveAttribute('aria-valuetext', erwartet);
      const t = ((await seite.locator('#stimmung-wert').textContent()) ?? '').replace(' (my default)', '');
      if (!gesehen.includes(t)) gesehen.push(t);
      if (h < 25) {
        await seite.keyboard.press('ArrowRight');
        await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo((h + 1) / 100, 5);
      }
    }
    expect(gesehen).toEqual([...STIMMUNG_WOERTER]);
    await expect(seite.locator('#stimmung-wert')).not.toHaveText(/\d/);
    console.log(`popup: ${gesehen.length} Stimmungswoerter von 16 Reglerstellungen gesehen (${gesehen.join(', ')})`);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Fund 26: scheitert das Speichern, kommt der Fehlersatz und der Schalter springt auf den gespeicherten Stand zurueck', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    await expect(seite.locator('#fehler')).toBeHidden();
    await oeffneGruppe(seite);
    const vorher = (await einst(seite)).strict ?? false;
    await seite.evaluate(() => {
      (globalThis as any).chrome.storage.local.set = () => Promise.reject(new Error('kaputt'));
    });
    await seite.locator('label.schalter:has(#strict)').click();
    await expect(seite.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
    await expect(seite.locator('#strict')).toBeChecked({ checked: vorher });
    expect((await einst(seite)).strict ?? false).toBe(vorher);
    // Auch Regler und Zone (das Preset waehlt man auf der Einstellungsseite, nicht im Popup): Fehlersatz, Anzeige beim gespeicherten Stand
    await seite.locator('#stimmung').focus();
    const schwelleVorher = (await einst(seite)).schwelle;
    await seite.keyboard.press('End');
    await expect(seite.locator('#fehler')).toBeVisible();
    const erwartet = Number(schwelleVorher ?? 0.1);
    await expect.poll(async () => Number(await seite.locator('#stimmung').inputValue())).toBeCloseTo(erwartet, 5);
    await seite.locator('#zonen label.schalter').filter({ hasText: 'Eyes' }).click();
    await expect(seite.locator('#zonen input[data-zone="eyes"]')).toBeChecked({ checked: (await einst(seite)).zonen?.eyes?.an ?? false });
    // Nach dem Neuladen speichert es wieder, der Fehlersatz ist weg
    await seite.reload();
    await expect(seite.locator('#fehler')).toBeHidden();
    await oeffneGruppe(seite);
    await seite.locator('label.schalter:has(#strict)').click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(!vorher);
    await expect(seite.locator('#fehler')).toBeHidden();
    console.log(`popup: vier Schreibfehler zeigten den Fehlersatz (${FEHLER_SPEICHERN.length} Zeichen), danach Speichern wieder gruen`);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Schnelle Folgeklicks: zwei Schalter und eine Zone ohne Warten, danach alle drei im Speicher', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await schreibe(seite, { pack: packMit(ALLE) });
    await seite.reload();
    await expect(seite.locator('#erwachsen-schalter')).toBeVisible();
    await oeffneGruppe(seite);
    // Ausgangslage aus der Anzeige (die Voreinstellung kommt aus dem Code, nicht aus dem Speicher)
    const vorAn = await seite.locator('#erw-an').isChecked();
    const vorErsatz = await seite.locator('#erw-ersatz').isChecked();
    const vorInhalt = await seite.locator('#erw-inhalt').isChecked();
    const vorMund = await seite.locator('input[data-zone="mouth"]').isChecked();
    // Drei Klicks im selben Augenblick (kein await dazwischen), dazu ein vierter auf den ersten Schalter zurueck
    await seite.evaluate(() => {
      (document.getElementById('erw-an') as HTMLInputElement).click();
      (document.getElementById('erw-ersatz') as HTMLInputElement).click();
      (document.querySelector('input[data-zone="mouth"]') as HTMLInputElement).click();
    });
    await expect.poll(async () => {
      const e = await einst(seite);
      return [e.erwachsen?.an, e.erwachsen?.komplettErsatz, e.zonen?.mouth?.an];
    }).toEqual([!vorAn, !vorErsatz, !vorMund]);
    // Die Anzeige hat keinen der drei Klicks zurueckgesetzt
    await expect(seite.locator('#erw-an')).toBeChecked({ checked: !vorAn });
    await expect(seite.locator('#erw-ersatz')).toBeChecked({ checked: !vorErsatz });
    await expect(seite.locator('#zonen input[data-zone="mouth"]')).toBeChecked({ checked: !vorMund });
    // Und noch einmal mit zwei Klicks auf denselben Schalter plus Stil und Zone (Zwischenstaende duerfen nichts verlieren)
    await seite.evaluate(() => {
      (document.getElementById('erw-inhalt') as HTMLInputElement).click();
      (document.getElementById('erw-inhalt') as HTMLInputElement).click();
      (document.getElementById('erw-an') as HTMLInputElement).click();
    });
    await expect.poll(async () => {
      const e = await einst(seite);
      return [e.erwachsen?.an, e.erwachsen?.erkennenAmInhalt];
    }).toEqual([vorAn, vorInhalt]);
    console.log('popup: sechs Klicks ohne Warten (zwei Schalter, Zone, Zwischenklick), Speicher und Anzeige stimmen');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Nr 7 und 9: Pack ohne Mia patch heisst "Mia Pack settings", Reglerenden stimmen mit den Stimmungswoertern', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#pack-link')).toHaveText(T.PACK_KNOPF_OHNE);
    await expect(seite.locator('#ende-links')).toHaveText(STIMMUNG_WOERTER[0]);
    await expect(seite.locator('#ende-rechts')).toHaveText(STIMMUNG_WOERTER[3]);
    // Mia-Preset gewaehlt: ohne Patch-Bilder im Pack gesperrt (Hinweis), mit Patch-Bildern waehlbar (Satz mit der Zahl der Bilder)
    await schreibe(seite, { pack: packMit(['erwachsen:vorschau']), einstellungen: { version: 1, preset: 'mia-wort' } });
    await expect(seite.locator('#pack-link')).toHaveText(T.PACK_KNOPF_MIT);
    await expect(seite.locator('#pack-hinweis')).toHaveText(T.PACK_HINWEIS_OHNE_PATCH);
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(seite.locator('#pack-hinweis')).toContainText('I choose my face from');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Nr 8: ist die Einstellungsseite schon offen, holt der Klick sie nach vorn (kein zweiter Tab) und setzt den Anker', async () => {
  const optionen = await context.newPage();
  await optionen.goto(`chrome-extension://${id}/options.html`);
  const popup = await context.newPage();
  try {
    await popup.goto(popupUrl());
    await expect(popup.locator('#status')).not.toBeEmpty();
    const vorher = context.pages().length;
    await popup.locator('#alle-einstellungen').click();
    await expect.poll(() => popup.isClosed()).toBe(true);
    const optionsTabs = context.pages().filter((p) => p.url().split('#')[0] === `chrome-extension://${id}/options.html`);
    expect(optionsTabs.length).toBe(1);
    expect(context.pages().length).toBe(vorher - 1);
    const popup2 = await context.newPage();
    await popup2.goto(popupUrl());
    await popup2.locator('#pack-link').click();
    await expect.poll(() => optionen.url()).toBe(`chrome-extension://${id}/options.html#neu`);
    console.log(`popup: zwei Klicks, ein Options-Tab (${optionsTabs.length}), Anker ${optionen.url().split('#')[1]}`);
  } finally {
    await optionen.close();
  }
});

test('Nr 2, 3 und 4: Pause und Ausnahme nach dem Klick festgehalten, Fehlersatz bleibt, Anzeige springt nicht zurueck', async () => {
  const web = await context.newPage();
  await web.goto(SEITE);
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await web.bringToFront();
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    // Pause: ein anderes Fenster pausiert im selben Augenblick wie der Klick auf "Pause Mia", die Pause bleibt
    await seite.evaluate(async () => {
      const api = (globalThis as any).chrome;
      const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
      void api.storage.local.set({ einstellungen: { ...alt, pause: true } });
      (document.getElementById('pause') as HTMLButtonElement).click();
    });
    await expect.poll(async () => (await einst(seite)).pause).toBe(true);
    await expect(seite.locator('#pause')).toHaveText('Let Mia back in');
    await seite.waitForTimeout(600);
    expect((await einst(seite)).pause).toBe(true);
    await seite.locator('#pause').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(false);
    // Ausnahme: zwei Klicks ohne Warten setzen und entfernen, die Richtung folgt der Beschriftung
    await expect(seite.locator('#ausnahme')).toHaveText(T.AUSNAHME_KNOPF_AN);
    await seite.evaluate(() => (document.getElementById('ausnahme') as HTMLButtonElement).click());
    await expect.poll(async () => (await einst(seite)).ausnahmen ?? []).toContain('localhost');
    await expect(seite.locator('#ausnahme')).toHaveText(T.AUSNAHME_KNOPF_ZURUECK);
    // Fehler A, gelungener Klick B danach: der Fehlersatz bleibt, A ist zurueckgesetzt
    await seite.evaluate(() => {
      const api = (globalThis as any).chrome;
      const echt = api.storage.local.set.bind(api.storage.local);
      let n = 0;
      api.storage.local.set = (o: unknown) => (n++ === 0 ? Promise.reject(new Error('kaputt')) : echt(o));
      (document.getElementById('strict') as HTMLInputElement).click();
      (document.querySelector('input[data-zone="eyes"]') as HTMLInputElement).click();
    });
    await expect(seite.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
    await seite.waitForTimeout(600);
    await expect(seite.locator('#fehler')).toBeVisible();
    const e = await einst(seite);
    expect(e.strict ?? false).toBe(await seite.locator('#strict').isChecked());
    expect(await seite.locator('#zonen input[data-zone="eyes"]').isChecked()).toBe(e.zonen?.eyes?.an ?? false);
    console.log('popup: Pause, Ausnahme und Fehlerfolge in schneller Folge stimmen mit dem Speicher');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
    await web.close();
  }
});

test('N1, N2 und N8 (zweite UX-Lesung): Fehlersatz klebt oben, Fingerziele 44 px auf Touch, gesperrtes "even when clothed" blass', async () => {
  const seite = await context.newPage();
  try {
    await seite.setViewportSize({ width: 360, height: 640 });
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    await oeffneGruppe(seite);
    // N8: Zone Augen ist ab Werk aus, ihr Kaestchen gesperrt und sichtbar blass; eine eingeschaltete Zone (Brust) bleibt voll.
    const deckkraft = (sel: string) => seite.locator(sel).evaluate((e) => Number(getComputedStyle(e.closest('label')!).opacity));
    const gesperrt = await seite.locator('#zonen input[data-bedeckt]:disabled').count();
    expect(gesperrt).toBeGreaterThan(0);
    expect(await deckkraft('#zonen input[data-bedeckt]:disabled >> nth=0')).toBeLessThan(0.7);
    expect(await deckkraft('#zonen input[data-bedeckt]:enabled >> nth=0')).toBe(1);
    // N1: Speichern scheitert unten nach dem Scrollen, der Satz steht trotzdem im Bild.
    await seite.evaluate(() => {
      (globalThis as any).chrome.storage.local.set = () => Promise.reject(new Error('kaputt'));
    });
    const zeile = seite.locator('#zonen label.schalter').last();
    await zeile.scrollIntoViewIfNeeded();
    const gescrollt: number = await seite.evaluate(() => window.scrollY);
    expect(gescrollt).toBeGreaterThan(100);
    await zeile.click();
    await expect(seite.locator('#fehler')).toHaveText(FEHLER_SPEICHERN);
    const lage = await seite.locator('#fehler').evaluate((e) => Math.round(e.getBoundingClientRect().top));
    expect(lage).toBeGreaterThanOrEqual(0);
    expect(lage).toBeLessThan(40);
    // N2: Touch-Geraet (Emulation per CDP): Ziele mindestens 44 px hoch.
    await seite.reload();
    await oeffneGruppe(seite);
    const cdp = await context.newCDPSession(seite);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    expect(await seite.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    // Lesung Runde 3, Nr. 8: alle sichtbaren Ziele messen, fehlende Gruppen machen den Test rot.
    const messe = () =>
      seite.evaluate(() =>
        ['#alle-einstellungen', '#pause', '#pack-link', '#aendern', '#hilfe', '#version', '#preset-aendern', '#zonen li', '#zonen .auch', '.schalter', 'button.klein'].map((s) => {
          const l = [...document.querySelectorAll<HTMLElement>(s)].filter((e) => e.getClientRects().length > 0);
          return l.length ? Math.round(Math.min(...l.map((e) => e.getBoundingClientRect().height))) : -1;
        }),
      );
    const hoehen = await messe();
    for (const h of hoehen) expect(h).toBeGreaterThanOrEqual(44);
    // Gegenprobe mit Maus: das Desktop-Popup bleibt kompakt.
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }] });
    const kompakt = await seite.locator('#alle-einstellungen').evaluate((e) => Math.round(e.getBoundingClientRect().height));
    expect(kompakt).toBeLessThan(40);
    console.log(`popup: Fehlersatz nach Scrollen (scrollY ${gescrollt}) bei ${lage} px; Touch-Hoehen ${hoehen.join(', ')} px; ${gesperrt} gesperrte Kaestchen blass`);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

// ---------- Phase 9, Paket A: Popup neu geordnet ----------

const hoehe = (seite: Page) => seite.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
// Das Popup als Seite mit einer Webseite im Vordergrund (dann ist sie der aktive Tab und "This site" hat einen Namen).
const popupMitWeb = async (): Promise<{ web: Page; seite: Page }> => {
  const web = await context.newPage();
  await web.goto(SEITE);
  const seite = await context.newPage();
  await seite.goto(popupUrl());
  await zuruecksetzen(seite);
  await seite.evaluate(() => localStorage.removeItem('veil-popup-aendern'));
  await web.bringToFront();
  await seite.reload();
  await expect(seite.locator('#status')).not.toBeEmpty();
  return { web, seite };
};

test('Fund 2: Reihenfolge, "This site" mit Name direkt unter der Pause, Zonen hinter "Change", Hoehe ohne Aufklappen hoechstens 600 px', async () => {
  const { web, seite } = await popupMitWeb();
  try {
    await seite.setViewportSize({ width: 360, height: 1400 });
    // Reihenfolge von oben nach unten: Pause, This site, Cover style, Adult sites, Fuss
    const y = (sel: string) => seite.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const [pause, diese, stil, erw, fuss] = [await y('#pause'), await y('#diese-seite'), await y('#stil-karte'), await y('#erwachsen'), await y('footer')];
    expect([pause, diese, stil, erw, fuss]).toEqual([...[pause, diese, stil, erw, fuss]].sort((a, b) => a - b));
    await expect(seite.locator('#diese-seite-name')).toHaveText('localhost');
    await expect(seite.locator('#ausnahme')).toBeVisible();
    // Standard: zu. Kurzfassung statt zehn Kacheln.
    await expect(seite.locator('#aendern')).toHaveAttribute('aria-expanded', 'false');
    await expect(seite.locator('#aendern')).toHaveText(T.AENDERN_ZU);
    await expect(seite.locator('#abdeckung-gruppe')).toBeHidden();
    await expect(seite.locator('#zonen')).toBeHidden();
    const namen = (await einst(seite)).zonen ?? null;
    const sollNamen = await seite.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[data-zone]')].filter((i) => i.checked).map((i) => i.closest('label')!.textContent!.trim().toLowerCase()));
    void namen;
    await expect(seite.locator('#abdeckung-kurz')).toHaveText(T.ABDECKUNG_KURZ(sollNamen));
    // Ziel: ohne Aufklappen hoechstens 600 px, ohne Pack und mit Pack, ruhig und pausiert
    const ohnePack = await hoehe(seite);
    expect(ohnePack, 'ohne Pack').toBeLessThanOrEqual(600);
    await schreibe(seite, { pack: packMit(ALLE) });
    await expect(seite.locator('#erwachsen-schalter')).toBeVisible();
    const mitPack = await hoehe(seite);
    // Mit Pack kommen How hot, My grip und Mias Satz dazu (Fund 10): die 600 px gelten fuer den Start ohne Pack, mit Pack muss es deutlich
    // unter den 1696 px von vorher bleiben (Messung in UX-PRUEFUNG-PHASE-9.md).
    expect(mitPack, 'mit Pack (alle Freischaltungen)').toBeLessThanOrEqual(1000);
    // Aufklappen: Mood, Zonen, Strict sind da, Zustand bleibt nach dem Neuladen, Zuklappen ebenso
    await seite.locator('#aendern').click();
    await expect(seite.locator('#aendern')).toHaveAttribute('aria-expanded', 'true');
    await expect(seite.locator('#aendern')).toHaveText(T.AENDERN_AUF);
    for (const sel of ['#stimmung', '#zonen', '#strict + .regler']) await expect(seite.locator(sel)).toBeVisible();
    await seite.reload();
    await expect(seite.locator('#zonen')).toBeVisible();
    await expect(seite.locator('#aendern')).toHaveAttribute('aria-expanded', 'true');
    await seite.locator('#aendern').click();
    await seite.reload();
    await expect(seite.locator('#abdeckung-gruppe')).toBeHidden();
    // Die Kurzfassung folgt einer geaenderten Zone
    await oeffneGruppe(seite);
    const brust = seite.locator('#zonen label.schalter').filter({ hasText: 'Belly' });
    const bauchVorher = await seite.locator('input[data-zone="belly"]').isChecked();
    await brust.click();
    await expect.poll(async () => (await einst(seite)).zonen?.belly?.an).toBe(!bauchVorher);
    await expect(seite.locator('#abdeckung-kurz')).toContainText('belly', { ignoreCase: false }).catch(async () => {
      if (bauchVorher) await expect(seite.locator('#abdeckung-kurz')).not.toContainText('belly');
      else throw new Error('Kurzfassung nennt belly nicht');
    });
    console.log(`popup: Hoehe ohne Aufklappen ${ohnePack} px (ohne Pack), ${mitPack} px (Pack mit allen Freischaltungen), Reihenfolge Pause ${pause}, This site ${diese}, Cover ${stil}, Adult ${erw}, Fuss ${fuss}`);
  } finally {
    await seite.evaluate(() => localStorage.removeItem('veil-popup-aendern')).catch(() => {});
    await zuruecksetzen(seite);
    await seite.close();
    await web.close();
  }
});

test('Fund 2: ohne Zugriff steht "I can’t reach this page." statt eines gesperrten Knopfs, auf der Standardliste der Hinweis', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl()); // der aktive Tab ist die Erweiterungsseite selbst: kein Zugriff
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    await expect(seite.locator('#ausnahme-hinweis')).toHaveText(T.DIESE_SEITE_KEIN_ZUGRIFF);
    await expect(seite.locator('#ausnahme')).toBeHidden();
    await expect(seite.locator('#diese-seite-name')).toBeHidden();
    expect(T.DIESE_SEITE_KEIN_ZUGRIFF).not.toMatch(/[–—]/);
  } finally {
    await seite.close();
  }
});

test('Fund 1 (Popup): ohne Pack heissen beide Knoepfe "Get the Mia Pack", mit Pack "Mia Pack settings" im Fuss', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#pack-link')).toHaveText('Get the Mia Pack');
    await expect(seite.locator('#erwachsen-pack-link')).toHaveText('Get the Mia Pack');
    expect(await seite.locator('#pack-link').evaluate((e) => !!e.closest('footer'))).toBe(true);
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(seite.locator('#pack-link')).toHaveText('Mia Pack settings');
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Fund 10 (Popup): "How hot do I get?" als Dreier-Wahl oben in Adult sites, "My grip" mit "?" zur Hilfe und einem Satz', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#heiss')).toBeHidden();
    await schreibe(seite, { pack: packMit(ALLE) });
    await expect(seite.locator('#heiss')).toBeVisible();
    // oben: vor dem Adult-site-Schalter
    const lage = await seite.evaluate(() => [document.getElementById('heiss')!.getBoundingClientRect().top, document.getElementById('erw-an')!.closest('label')!.getBoundingClientRect().top]);
    expect(lage[0]!).toBeLessThan(lage[1]!);
    await expect(seite.locator('#heiss-titel')).toHaveText('How hot do I get?');
    for (const wert of ['tease', 'explicit', 'hot']) {
      await seite.locator(`#heiss label:has(input[value="${wert}"])`).click();
      await expect.poll(async () => (await einst(seite)).erwachsen?.stufe).toBe(wert);
      await expect(seite.locator(`#heiss input[value="${wert}"]`)).toBeChecked();
    }
    // My grip: Stufe, Satz, "?" auf den festen Anker, neuer Tab ohne opener
    await expect(seite.locator('#steigerung')).toBeVisible();
    await expect(seite.locator('#stufe-zeile')).toHaveText(/^Level \d of 4$/);
    await expect(seite.locator('#grip-satz')).toHaveText(T.GRIP_SATZ);
    const grip = seite.locator('#grip-hilfe');
    await expect(grip).toHaveAttribute('href', hilfeAdresse('grip'));
    await expect(grip).toHaveAttribute('target', '_blank');
    expect(await grip.getAttribute('rel')).toContain('noopener');
    const neu = context.waitForEvent('page');
    await grip.click();
    const ziel = await neu;
    await expect.poll(() => ziel.url()).toContain(`/hilfe.html#grip`);
    await ziel.close();
    // ohne die Freischaltung der Vorschau keine Wahl
    await schreibe(seite, { pack: packMit(['zensur:steigerung', 'chibi:pack']) });
    await expect(seite.locator('#heiss')).toBeHidden();
    expect(T.GRIP_SATZ).not.toMatch(/[–—]/);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Fund 12 (Popup): Werbe-Frage als Karte unter der Pause, nur mit Freischaltung und unbeantwortet, Ja und Nein speichern beide Felder', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    const karte = seite.locator('#popup-werbung-frage');
    await expect(karte).toBeHidden(); // ohne Pack
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(karte).toBeHidden(); // Pack ohne Werbe-Tausch
    await schreibe(seite, { pack: packMit(['kontrolle:werbung']) });
    await expect(karte).toBeVisible();
    await expect(seite.locator('#popup-werbung-frage-titel')).toHaveText(T.WERBUNG_FRAGE_TITEL);
    await expect(seite.locator('#popup-werbung-frage-titel')).toHaveText('Show my ads?');
    await expect(seite.locator('#popup-werbung-frage-ja')).toHaveText('Yes, show them');
    await expect(seite.locator('#popup-werbung-frage-nein')).toHaveText('No ads');
    // Lage: unter der Pause, ueber "This site"
    const lage = await seite.evaluate(() => ['pause', 'popup-werbung-frage', 'diese-seite'].map((i) => Math.round(document.getElementById(i)!.getBoundingClientRect().top)));
    expect(lage).toEqual([...lage].sort((a, b) => a - b));
    expect((await einst(seite)).kontrolle?.werbungGefragt ?? false).toBe(false);
    await seite.locator('#popup-werbung-frage-ja').click();
    await expect.poll(async () => [(await einst(seite)).kontrolle?.werbung, (await einst(seite)).kontrolle?.werbungGefragt]).toEqual([true, true]);
    await expect(karte).toBeHidden();
    await expect(seite.locator('#pause')).toBeFocused();
    // keine zweite Frage nach dem Neuladen
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    await expect(karte).toBeHidden();
    // Nein: neu beginnen
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstellungen'));
    await schreibe(seite, { pack: packMit(['kontrolle:werbung']) });
    await seite.reload();
    await expect(karte).toBeVisible();
    await seite.locator('#popup-werbung-frage-nein').click();
    await expect.poll(async () => [(await einst(seite)).kontrolle?.werbung, (await einst(seite)).kontrolle?.werbungGefragt]).toEqual([false, true]);
    await expect(karte).toBeHidden();
    // Scheitert das Speichern, bleibt die Karte und der Fehlersatz steht
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstellungen'));
    await seite.reload();
    await expect(karte).toBeVisible();
    await seite.evaluate(() => {
      (globalThis as any).chrome.storage.local.set = () => Promise.reject(new Error('kaputt'));
    });
    await seite.locator('#popup-werbung-frage-ja').click();
    await expect(seite.locator('#popup-werbung-frage-fehler')).toHaveText(FEHLER_SPEICHERN);
    await expect(karte).toBeVisible();
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Fund 15, 16 und 17: Kuerzel unter der Pause, Fuss-Links auf feste Anker, Pausenzeile und blassere Karten', async () => {
  const seite = await context.newPage();
  try {
    await seite.goto(popupUrl());
    await zuruecksetzen(seite);
    await seite.reload();
    await expect(seite.locator('#status')).not.toBeEmpty();
    // Fund 15: das Kuerzel steht so, wie der Browser es meldet; unter dem Knopf
    const kuerzel = await seite.evaluate(async () => ((await (globalThis as any).chrome.commands.getAll()) as { name: string; shortcut?: string }[]).find((b) => b.name === 'pause-umschalten')?.shortcut ?? '');
    expect(kuerzel).not.toBe('');
    await expect(seite.locator('#pause-kuerzel')).toHaveText(T.PAUSE_KUERZEL(kuerzel));
    const unter = await seite.evaluate(() => document.getElementById('pause-kuerzel')!.getBoundingClientRect().top >= document.getElementById('pause')!.getBoundingClientRect().bottom - 1);
    expect(unter).toBe(true);
    // Fund 16: "uninstalling" und die Version sind Links auf die Hilfe
    const un = seite.locator('#deinstallieren');
    await expect(un).toHaveText('uninstalling');
    await expect(un).toHaveAttribute('href', hilfeAdresse('uninstall'));
    await expect(un).toHaveAttribute('target', '_blank');
    expect(await un.getAttribute('rel')).toContain('noopener');
    await expect(seite.locator('footer')).toContainText('Pausing and uninstalling are always allowed.');
    const ver = seite.locator('#version');
    await expect(ver).toHaveText(/^v\d/);
    await expect(ver).toHaveAttribute('href', hilfeAdresse('updates'));
    expect(await ver.getAttribute('rel')).toContain('noopener');
    const neu = context.waitForEvent('page');
    await un.click();
    const ziel = await neu;
    await expect.poll(() => ziel.url()).toContain('/hilfe.html#uninstall');
    await ziel.close();
    // Fund 17: Pausenzeile nur im Pausenzustand; die Karten darunter blasser, aber bedienbar
    await expect(seite.locator('#pause-zeile')).toBeHidden();
    const deckkraft = (sel: string) => seite.locator(sel).evaluate((e) => Number(getComputedStyle(e).opacity));
    expect(await deckkraft('#stil-karte')).toBe(1);
    await seite.locator('#pause').click();
    await expect(seite.locator('#pause-zeile')).toHaveText(T.PAUSE_ZEILE);
    await expect.poll(() => deckkraft('#stil-karte')).toBeCloseTo(0.7, 2);
    expect(await deckkraft('#pause')).toBe(1);
    // bedienbar: "Change" klappt auch in der Pause auf und zu
    await seite.locator('#aendern').click();
    await expect(seite.locator('#abdeckung-gruppe')).toBeVisible();
    await seite.locator('#aendern').click();
    await expect(seite.locator('#abdeckung-gruppe')).toBeHidden();
    await seite.locator('#pause').click();
    await expect(seite.locator('#pause-zeile')).toBeHidden();
    await expect.poll(() => deckkraft('#stil-karte')).toBe(1);
    expect(T.PAUSE_ZEILE).not.toMatch(/[–—]/);
  } finally {
    await zuruecksetzen(seite);
    await seite.close();
  }
});

test('Fund 27: der Update-Hinweis hat den Link "What’s new" auf den Hilfe-Anker updates', async () => {
  const seite = await context.newPage();
  try {
    await seite.addInitScript(() => {
      const c = (globalThis as any).chrome;
      const echt = c.runtime.sendMessage.bind(c.runtime);
      c.runtime.sendMessage = (m: any, ...r: unknown[]) =>
        m?.typ === 'version' ? Promise.resolve({ ok: true, browser: 'chrome', aktuell: '0.8.2', datum: '', neueste: '9.9.9', neuer: true, geprueft: Date.now(), fehler: false }) : echt(m, ...r);
    });
    await seite.goto(popupUrl());
    await expect(seite.locator('#version-hinweis')).toBeVisible();
    const neues = seite.locator('#version-neues');
    await expect(neues).toHaveText('What’s new');
    await expect(neues).toHaveAttribute('href', hilfeAdresse('updates'));
    await expect(neues).toHaveAttribute('target', '_blank');
    expect(await neues.getAttribute('rel')).toContain('noopener');
    // der Hinweis liegt unter der Pause, der Knopf "How to update" bleibt
    await expect(seite.locator('#version-anleitung')).toHaveText('How to update');
    const lage = await seite.evaluate(() => [document.getElementById('pause')!.getBoundingClientRect().bottom, document.getElementById('version-hinweis')!.getBoundingClientRect().top]);
    expect(lage[1]!).toBeGreaterThan(lage[0]! - 1);
    const neu = context.waitForEvent('page');
    await neues.click();
    const ziel = await neu;
    await expect.poll(() => ziel.url()).toContain('/hilfe.html#updates');
    await ziel.close();
  } finally {
    await seite.close();
  }
});
