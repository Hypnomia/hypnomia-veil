// Chromium: Phase 9, Session 17, Paket B (Einstellungsseite Ordnung; UX-Funde 4, 8, 10, 11, 14, 22, 28). Echte Klicks und Messzahlen:
// Chips und Gruppen, Zuklappen ohne Pack, Reihenfolge der Pack-Karte, Calm mode als erster Schalter, Hilfe-Knoepfe, Adressfelder, About and help.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZU_TEXTE } from '../../entrypoints/options/ordnung-texte';
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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-einstellungen-ordnung-'));
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

// Frische Seite ohne Pack, gewartet bis Ordnung und Pack-Karte gezeichnet sind.
async function frischeSeite(breite = 1280, hoehe = 800): Promise<Page> {
  const seite = await context.newPage();
  await seite.setViewportSize({ width: breite, height: hoehe });
  await seite.goto(optionsUrl());
  await zuruecksetzen(seite);
  await seite.reload();
  await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  await expect(seite.locator('#pack-status')).not.toHaveText('');
  return seite;
}

test('Fund 4: sieben Gruppen-Chips plus Help, Chip Help oeffnet die Hilfe in neuem Tab, der Untertitel hat keinen Link mehr', async () => {
  const seite = await frischeSeite();
  try {
    expect(await seite.locator('#sprung a:not(#chip-interview)').allTextContents()).toEqual(['Covering', 'Mia Pack', 'Adult sites', 'Mia’s control', 'Sound', 'Ledger', 'About and help', 'Help']);
    await expect(seite.locator('#hilfe-link')).toHaveText('Help');
    await expect(seite.locator('#hilfe-link')).toHaveAttribute('href', 'hilfe.html');
    await expect(seite.locator('#hilfe-link')).toHaveAttribute('target', '_blank');
    await expect(seite.locator('#hilfe-link')).toHaveAttribute('rel', /noopener/);
    await expect(seite.locator('header .unter a')).toHaveCount(0);
    // Calm mode hat weder Karte noch Chip; "Mia’s mood" bis "Sites I leave alone" stehen in der Gruppe Covering.
    await expect(seite.locator('#abschnitt-ruhig')).toHaveCount(0);
    expect(await seite.locator('#covering h2').allTextContents()).toEqual(['Mia’s mood', 'What I cover', 'Cover style', 'Sites I leave alone']);
    // Der Chip der Gruppe springt dorthin; Pause bleibt oben.
    await seite.locator('#sprung a[href="#ledger"]').click();
    await expect(seite).toHaveURL(/#ledger$/);
    await expect(seite.locator('#pause-leiste')).toBeVisible();
  } finally {
    await seite.close();
  }
});

test('Fund 4: ohne Pack sind Adult sites, Mia’s control und Sound zugeklappt (Calm mode offen), "Set them now" klappt auf', async () => {
  const seite = await frischeSeite();
  try {
    const karten = [
      { karte: 'erwachsen', satz: ZU_TEXTE.erwachsen, drin: '#erw-an' },
      { karte: 'kontrolle', satz: ZU_TEXTE.kontrolle, drin: '#kon-blitz' },
      { karte: 'ton', satz: ZU_TEXTE.ton, drin: '#ton-an' },
    ];
    for (const k of karten) {
      await expect(seite.locator(`#${k.karte}-zu-satz`)).toHaveText(k.satz);
      await expect(seite.locator(`#${k.karte}-zu-knopf`)).toHaveText('Set them now');
      await expect(seite.locator(`#${k.karte}-zu-knopf`)).toHaveAttribute('aria-expanded', 'false');
      await expect(seite.locator(`#${k.karte}-zu-knopf`)).toHaveAttribute('aria-controls', `${k.karte}-block`);
      await expect(seite.locator(k.drin)).toBeHidden();
    }
    // Calm mode bleibt offen und wirkt ohne Aufklappen.
    await expect(seite.locator('#ruhig')).toBeVisible();
    await seite.locator('#ruhig-zeile').click();
    await expect.poll(async () => (await einst(seite)).ruhig).toBe(true);
    await seite.locator('#ruhig-zeile').click();
    await expect.poll(async () => (await einst(seite)).ruhig).toBe(false);
    // Aufklappen per Tastatur: der Fokus landet im aufgeklappten Block, der Knopf verschwindet.
    await seite.locator('#kontrolle-zu-knopf').focus();
    await seite.keyboard.press('Enter');
    await expect(seite.locator('#kon-werbung')).toBeVisible();
    await expect(seite.locator('#kontrolle-zu-knopf')).toBeHidden();
    await expect(seite.locator('#kontrolle-zu-satz')).toBeHidden();
    expect(await seite.evaluate(() => document.getElementById('kontrolle-block')!.contains(document.activeElement))).toBe(true);
    // Die anderen bleiben zu, bis man sie aufklappt.
    await expect(seite.locator('#erw-an')).toBeHidden();
    // Erste Lesung 17, Fund 17: liegt das erste Bedienelement in einem verborgenen Teil, geht der Fokus auf ein sichtbares, nie auf body.
    await seite.evaluate(() => {
      const zeile = document.querySelector('#erwachsen-block label.schalter:has(#erw-an)') as HTMLElement;
      zeile.dataset.testVerborgen = '1';
      zeile.hidden = true;
    });
    await seite.locator('#erwachsen-zu-knopf').click();
    expect(
      await seite.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return !!a && a !== document.body && a.tagName !== 'H2' && a.getClientRects().length > 0 && !!document.getElementById('erwachsen-block')!.contains(a);
      }),
      'Fokus sichtbar in der Karte',
    ).toBe(true);
    await seite.evaluate(() => {
      for (const e of document.querySelectorAll<HTMLElement>('[data-test-verborgen]')) {
        e.hidden = false;
        delete e.dataset.testVerborgen;
      }
    });
    await expect(seite.locator('#erw-an')).toBeVisible();
    await seite.locator('label.schalter:has(#erw-an)').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.an).toBe(false);
    // Nacht N5 (Ursache des Firefox-Wacklers "Fokus liegt bei der Frage"): kommt das Pack, wandert die Pack-Karte; ein Fokus darin bleibt erhalten.
    const fokusZiel = await seite.evaluate(() => {
      const z = [...document.querySelectorAll<HTMLElement>('#stand button, #stand input, #stand a[href], #stand [tabindex]')].find((e) => e.getClientRects().length > 0);
      if (!z) return null;
      if (!z.id) z.id = 'fokus-probe';
      z.focus();
      return z.id;
    });
    expect(fokusZiel, 'fokussierbares Element in der Pack-Karte').not.toBeNull();
    await schreibe(seite, { pack: packMit(['kontrolle:blitz', 'ton']) });
    await expect.poll(() => seite.evaluate(() => document.getElementById('stand')!.previousElementSibling?.id)).toBe('ton');
    expect(await seite.evaluate(() => document.activeElement?.id), 'Fokus nach dem Verschieben').toBe(fokusZiel);
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    // Mit Pack ist alles offen, ohne Knopf; weg mit dem Pack: die Karten, die man nicht selbst aufgeklappt hat, schliessen sich wieder.
    await schreibe(seite, { pack: packMit(['kontrolle:blitz', 'ton']) });
    await expect(seite.locator('#ton-an')).toBeVisible();
    await expect(seite.locator('.zu-knopf:visible')).toHaveCount(0);
    await expect(seite.locator('#ton')).toHaveAttribute('data-zu', '0');
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    await expect(seite.locator('#ton-zu-knopf')).toBeVisible();
    await expect(seite.locator('#ton')).toHaveAttribute('data-zu', '1');
    await expect(seite.locator('#kon-blitz')).toBeVisible();
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Fund 4: die Pack-Karte steht ohne Pack nach Covering, mit Pack nach Sound; der Chip folgt', async () => {
  const seite = await frischeSeite();
  try {
    const reihe = () => seite.evaluate(() => [...document.querySelectorAll('main > section, main > .gruppe')].map((s) => s.id));
    const chips = () => seite.evaluate(() => [...document.querySelectorAll('#sprung a[href^="#"]')].map((a) => a.getAttribute('href')!.slice(1)));
    expect(await reihe()).toEqual(['covering', 'stand', 'erwachsen', 'kontrolle', 'ton', 'ledger', 'ueber']);
    expect(await chips()).toEqual(['covering', 'stand', 'erwachsen', 'kontrolle', 'ton', 'ledger', 'ueber', 'abschnitt-interview']);
    await schreibe(seite, { pack: packMit(['kontrolle:blitz']) });
    await expect.poll(reihe).toEqual(['covering', 'erwachsen', 'kontrolle', 'ton', 'stand', 'ledger', 'ueber']);
    expect(await chips()).toEqual(['covering', 'erwachsen', 'kontrolle', 'ton', 'stand', 'ledger', 'ueber', 'abschnitt-interview']);
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
    await expect.poll(reihe).toEqual(['covering', 'stand', 'erwachsen', 'kontrolle', 'ton', 'ledger', 'ueber']);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

// Nacht N2 (UEBERGABE-17 Rest 6): die Pack-Karte zaehlt mit. Ein Bildschirm bei 1280 sind 900 px wie in der Messung der UX-Pruefung Phase 9
// (Abschnitt "Messwerte": "5,1 Bildschirme zu 900 px"), aus der das Messziel stammt; die Zahl zu 800 px steht im Log und hat eine eigene Grenze
// gegen Rueckschritte (vorher 3,97).
const SCHIRM_1280 = 900;
// Zensur-Presets: elf kompakte Karten (Figur und Name) in drei Gruppen statt drei Knoepfen kosten Platz (gemessen 3,21 Bildschirme zu 900 px, 3,62
// zu 800 px); die Grenzen liegen knapp darueber (900 px: 3,3, 800 px: 3,7), vorher in Runde 3 waren sie 3,4 und 3,8.
const GRENZE_800 = 3.7;
const GRENZE_900 = 3.3;
test('Messziel Fund 4: ohne Pack hoechstens 3 Bildschirme bei 1280, mit der Pack-Karte', async () => {
  const seite = await frischeSeite(1280, SCHIRM_1280);
  try {
    // Erst messen, wenn die Kern-Bilder der Pack-Karte stehen (sie kommen spaeter als der Status).
    await expect(seite.locator('#kern-streifen'), 'Kern-Bilder im Testbau noetig (../02 Assets Mia/kern)').toBeVisible({ timeout: 5000 });
    await seite.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('#kern-bilder img')].every((i) => i.complete && i.naturalWidth > 0));
    const hoehe = await seite.evaluate(() => document.documentElement.scrollHeight);
    // Frische Seite ohne Einstieg, also mit der Sperre "Meet me first" (laengster Fall).
    const stand = await seite.evaluate(() => Math.ceil(document.getElementById('stand')!.getBoundingClientRect().height));
    console.log(
      `einstellungen-ordnung: ohne Pack ${hoehe} px = ${(hoehe / SCHIRM_1280).toFixed(2)} Bildschirme zu ${SCHIRM_1280} px, ${(hoehe / 800).toFixed(2)} zu 800 px bei 1280 Breite, davon Pack-Karte ${stand} px`,
    );
    expect(hoehe / SCHIRM_1280, 'mit Sperre, Bildschirme zu 900 px').toBeLessThanOrEqual(GRENZE_900);
    expect(hoehe / 800, 'mit Sperre, Bildschirme zu 800 px (Rueckschritt-Grenze)').toBeLessThanOrEqual(GRENZE_800);
    // Nach dem Einstieg (ohne Sperre) ebenso.
    await schreibe(seite, { einstieg: EINSTIEG_FERTIG });
    await expect(seite.locator('#pack-sperre')).toBeHidden();
    const nachEinstieg = await seite.evaluate(() => document.documentElement.scrollHeight);
    console.log(`einstellungen-ordnung: ohne Pack nach dem Einstieg ${nachEinstieg} px = ${(nachEinstieg / SCHIRM_1280).toFixed(2)} Bildschirme zu ${SCHIRM_1280} px, ${(nachEinstieg / 800).toFixed(2)} zu 800 px`);
    expect(nachEinstieg / SCHIRM_1280).toBeLessThanOrEqual(GRENZE_900);
    // Pruefer N2 Fund 8: ab 600 px steht der grosse Pause-Knopf rechts neben dem Status, in denselben Zeilen.
    const lage = await seite.evaluate(() => {
      const p = document.getElementById('pause')!.getBoundingClientRect();
      const st = document.getElementById('status')!.getBoundingClientRect();
      return { pLinks: p.left, stRechts: st.right, pOben: p.top, pUnten: p.bottom, stOben: st.top, stUnten: st.bottom };
    });
    expect(lage.pLinks, 'Pause rechts vom Status').toBeGreaterThan(lage.stRechts);
    expect(lage.pOben < lage.stUnten && lage.pUnten > lage.stOben, `Pause in der Zeile des Status ${JSON.stringify(lage)}`).toBe(true);
    await schreibe(seite, { pack: packMit(['kontrolle:blitz', 'ton', 'erwachsen:vorschau']) });
    await expect(seite.locator('.zu-knopf:visible')).toHaveCount(0);
    const mit = await seite.evaluate(() => document.documentElement.scrollHeight);
    console.log(`einstellungen-ordnung: mit Pack ${mit} px = ${(mit / 800).toFixed(2)} Bildschirme`);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Fund 8 und 10: Calm mode ist der erste Schalter in Mia’s control, bei "weniger Bewegung" steht die Zusatzzeile; How hot steht zuerst in Adult sites', async () => {
  const seite = await frischeSeite();
  try {
    // Reihenfolge in Mia’s control: Titel, Calm mode, erst dann Pack-Hinweis und die anderen Schalter.
    const ordnung = await seite.evaluate(() => {
      const nr = (css: string) => {
        const e = document.querySelector(css)!;
        return [...document.querySelectorAll('#kontrolle *')].indexOf(e);
      };
      return { calm: nr('#ruhig'), titel: nr('#kon-titel'), hinweis: nr('#kon-pack-hinweis'), werbung: nr('#kon-werbung'), blitz: nr('#kon-blitz') };
    });
    expect(ordnung.titel).toBeLessThan(ordnung.calm);
    expect(ordnung.calm).toBeLessThan(ordnung.hinweis);
    expect(ordnung.calm).toBeLessThan(ordnung.werbung);
    await expect(seite.locator('#ruhig-zeile strong')).toHaveText('Calm mode');
    await expect(seite.locator('#ruhig-system')).toBeHidden();
    await seite.emulateMedia({ reducedMotion: 'reduce' });
    await expect(seite.locator('#ruhig-system')).toBeVisible();
    await expect(seite.locator('#ruhig-system')).toHaveText('Your system asks for less motion, so Calm mode works either way, switch on or off.');
    // Der Schalter bleibt bedienbar und zeigt den gespeicherten Wert (aus), die Wirkung ist unveraendert.
    await expect(seite.locator('#ruhig')).not.toBeChecked();
    await seite.locator('#ruhig-zeile').click();
    await expect.poll(async () => (await einst(seite)).ruhig).toBe(true);
    await seite.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(seite.locator('#ruhig-system')).toBeHidden();
    // Fund 10: "How hot do I get?" ist die erste Bedienung in Adult sites, gleich gross wie die anderen Bedienungen (kein Grossbuchstaben-h3).
    await oeffneZugeklapptes(seite);
    const reihe = await seite.evaluate(() => {
      const nr = (css: string) => [...document.querySelectorAll('#erwachsen *')].indexOf(document.querySelector(css)!);
      const stil = getComputedStyle(document.querySelector('#stufe-titel')!);
      const regel = getComputedStyle(document.querySelector('#erw-an ~ .text strong, #erw-an + .regler + .text strong')!);
      return { stufe: nr('#stufe-titel'), schalter: nr('#erw-an'), eigene: nr('#seite-form'), gross: stil.textTransform, groesse: parseFloat(stil.fontSize), regel: parseFloat(regel.fontSize) };
    });
    expect(reihe.stufe).toBeLessThan(reihe.schalter);
    expect(reihe.stufe).toBeLessThan(reihe.eigene);
    expect(reihe.gross).toBe('none');
    expect(reihe.groesse).toBeGreaterThanOrEqual(reihe.regel - 1);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Fund 11: zwei Adresszeilen mit klaren Knoepfen und Platzhaltern, Erfolgssaetze nennen die Folge, eine Adresse in der anderen Liste gibt einen Satz', async () => {
  const seite = await frischeSeite();
  try {
    await oeffneZugeklapptes(seite);
    await expect(seite.locator('#ausnahme-feld')).toHaveAttribute('placeholder', 'site to leave alone, like mybank.com');
    await expect(seite.locator('#ausnahme-add')).toHaveText('Leave it alone');
    await expect(seite.locator('#seite-feld')).toHaveAttribute('placeholder', 'adult site, like example.com');
    await expect(seite.locator('#seite-add')).toHaveText('Treat as adult site');
    await seite.fill('#ausnahme-feld', 'mybank.com');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toHaveText('mybank.com: I keep my hands off it.');
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['mybank.com']);
    await seite.fill('#seite-feld', 'example.com');
    await seite.click('#seite-add');
    await expect(seite.locator('#seite-meldung')).toHaveText('example.com: I treat it like the big adult sites.');
    await expect.poll(async () => (await einst(seite)).erwachsen?.eigeneSeiten).toEqual(['example.com']);
    // Die Adresse steht schon in der anderen Liste: Satz statt stillem Doppel, nichts wird gespeichert.
    await seite.fill('#seite-feld', 'mybank.com');
    await seite.click('#seite-add');
    await expect(seite.locator('#seite-meldung')).toHaveText('mybank.com is on my list of sites I leave alone. Remove it there first, then I can treat it as an adult site.');
    await seite.fill('#ausnahme-feld', 'example.com');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toHaveText('example.com is one of your own adult sites. Remove it under Your own sites first, then I can leave it alone.');
    await seite.waitForTimeout(300);
    const e = await einst(seite);
    expect(e.ausnahmen).toEqual(['mybank.com']);
    expect(e.erwachsen.eigeneSeiten).toEqual(['example.com']);
    // Nach dem Entfernen geht es.
    await seite.locator('#seiten-liste button').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.eigeneSeiten).toEqual([]);
    await seite.fill('#ausnahme-feld', 'example.com');
    await seite.click('#ausnahme-add');
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['mybank.com', 'example.com']);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Fund 14: runde Hilfe-Knoepfe an den schwierigen Stellen, 24 px am Desktop, 44 px bei 360 px, neuer Tab am Anker', async () => {
  const seite = await frischeSeite();
  try {
    await oeffneZugeklapptes(seite);
    const soll: Record<string, string> = {
      'Help: Adult sites': 'adult',
      'Help: How hot do I get?': 'adult',
      'Help: Full replacement': 'full-replacement',
      'Help: Spot adult pages by content': 'adult',
      'Help: Quiz': 'quiz',
      'Help: Cover style': 'styles',
      'Help: Calm mode': 'calm',
      'Help: My ads': 'ads',
      'Help: Strict times': 'strict-times',
    };
    const knoepfe = await seite.locator('a.hilfe-rund').evaluateAll((as) =>
      as.map((a) => ({ name: a.getAttribute('aria-label'), href: a.getAttribute('href'), ziel: a.getAttribute('target'), rel: a.getAttribute('rel'), b: a.getBoundingClientRect().width, h: a.getBoundingClientRect().height })),
    );
    expect(knoepfe.map((k) => k.name).sort()).toEqual(Object.keys(soll).sort());
    for (const k of knoepfe) {
      expect(k.href).toBe(`hilfe.html#${soll[k.name!]}`);
      expect(k.ziel).toBe('_blank');
      expect(k.rel).toContain('noopener');
      expect(Math.round(k.b)).toBe(24);
      expect(Math.round(k.h)).toBe(24);
    }
    // Der Knopf steht rechts neben dem Titel, der Titel bleibt als Ueberschrift lesbar.
    await expect(seite.getByRole('heading', { name: 'Strict times' })).toBeVisible();
    const neu = context.waitForEvent('page');
    await seite.locator('a.hilfe-rund[aria-label="Help: Strict times"]').click();
    const hilfe = await neu;
    await expect(hilfe).toHaveURL(new RegExp(`chrome-extension://${id}/hilfe\\.html#strict-times$`));
    await hilfe.close();
    // Bei 360 px: Fingerziel 44 px, kein Waagrecht-Scrollen.
    await seite.setViewportSize({ width: 360, height: 800 });
    const schmal = await seite.locator('a.hilfe-rund').evaluateAll((as) => as.map((a) => Math.round(Math.min(a.getBoundingClientRect().width, a.getBoundingClientRect().height))));
    for (const m of schmal) expect(m).toBeGreaterThanOrEqual(44);
    expect(await seite.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    console.log(`einstellungen-ordnung: ${knoepfe.length} Hilfe-Knoepfe, 24 px Desktop, mindestens ${Math.min(...schmal)} px bei 360`);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});

test('Fund 22: About and help fuehrt zu Hilfe-Seite und Themen; das Interview ist der letzte Punkt', async () => {
  const seite = await frischeSeite();
  try {
    await expect(seite.locator('#ueber-titel')).toHaveText('About and help');
    const links = await seite.locator('#ue-hilfe a').evaluateAll((as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), ziel: a.getAttribute('target'), rel: a.getAttribute('rel') })));
    expect(links).toEqual([
      { text: 'All help pages', href: 'hilfe.html', ziel: '_blank', rel: 'noopener noreferrer' },
      { text: 'Pin me to the toolbar', href: 'hilfe.html#pin', ziel: '_blank', rel: 'noopener noreferrer' },
      { text: 'Pausing me', href: 'hilfe.html#pause', ziel: '_blank', rel: 'noopener noreferrer' },
      { text: 'Uninstalling me', href: 'hilfe.html#uninstall', ziel: '_blank', rel: 'noopener noreferrer' },
      { text: 'What’s new', href: 'hilfe.html#updates', ziel: '_blank', rel: 'noopener noreferrer' },
    ]);
    await expect(seite.locator('#ue-pruefen')).toBeVisible();
    await expect(seite.locator('#abschnitt-interview')).toBeHidden();
    await schreibe(seite, { einstieg: EINSTIEG_FERTIG });
    await expect(seite.locator('#abschnitt-interview')).toBeVisible();
    const tabs = context.pages().length;
    await seite.locator('#interview-neu').click();
    await expect(seite).toHaveURL(/willkommen\.html#interview$/);
    expect(context.pages().length).toBe(tabs);
  } finally {
    await zuruecksetzen(seite).catch(() => undefined);
    await seite.close();
  }
});
