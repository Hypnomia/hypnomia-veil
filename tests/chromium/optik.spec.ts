// Chromium: Messung Phase 8b (PHASE-8B-BAUPLAN Abschnitt 6) bei 360 px: kein waagrechtes Scrollen, Pause-Knopf sichtbar, Schriften des
// Gestaltungs-Systems geladen; auf Willkommensseite und Einstellungsseite (Regeln fuer schmale Schirme) alle sichtbaren Bedienelemente
// mindestens 44 px hoch. Gemessen: Chromium wendet `(pointer: coarse)` auf Erweiterungsseiten nicht an (weder isMobile noch CDP-Touch);
// die Finger-Regeln des Popups (Entscheidung 146) misst darum der Android-Durchlauf im Emulator.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oeffneZugeklapptes } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';
const url = (seite: string) => `chrome-extension://${id}/${seite}`;
// Nacht N2: Grenze gegen Rueckschritte bei 360 x 780 (vorher 5,36 Bildschirme).
// Zensur-Presets: elf kompakte Karten (zwei je Zeile, Figur und Name) statt drei Knoepfen: gemessen 5,35 Bildschirme, Grenze von 5 auf 5,45
// (Runde 3: 5,7).
// Echtzeit-Videozensur: Schalter "Video" (Zonen oder ganz) unter Cover style, gemessen 5,46 Bildschirme (4257 px), Grenze 5,5.
const GRENZE_360 = 5.5;
const FERTIG = { einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 } };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-optik-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 360, height: 780 },
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  id = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

// Misst die aktuelle Ansicht: waagrechtes Scrollen, kleinste Hoehe sichtbarer Bedienelemente (mit Namen), Schriften.
async function miss(s: Page): Promise<{ sw: number; iw: number; grob: boolean; zuKlein: string[]; schrift: boolean; anzahl: number }> {
  return s.evaluate(() => {
    const sichtbar = (e: Element) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    // Bedienelemente: Knoepfe, Links mit Knopf-Rolle oder in Leisten, Schalter- und Wahl-Zeilen, Auswahlfelder, Textfelder, Regler.
    const ziele = [...document.querySelectorAll('button, a.knopf, #sprung a, label.schalter, .wahl span:not(.text), .wahl label, select, input[type=text], input[type=range], label.auch')]
      .filter(sichtbar)
      .filter((e) => !(e instanceof HTMLButtonElement && e.disabled));
    const zuKlein = ziele
      .filter((e) => e.getBoundingClientRect().height < 43.5)
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')} ${Math.round(e.getBoundingClientRect().height)}px "${(e.textContent ?? '').trim().slice(0, 24)}"`);
    const familien = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
    return {
      sw: document.documentElement.scrollWidth,
      iw: innerWidth,
      grob: matchMedia('(pointer: coarse)').matches,
      zuKlein,
      schrift: familien.includes('VEIL Text') && familien.includes('VEIL Rounded'),
      anzahl: ziele.length,
    };
  });
}

function pruefe(name: string, m: Awaited<ReturnType<typeof miss>>, ziele = true): void {
  console.log(`optik ${name}: scrollWidth ${m.sw}/${m.iw}, grober Zeiger ${m.grob}, ${m.anzahl} Ziele, zu klein ${m.zuKlein.length}, Schrift ${m.schrift}`);
  if (m.zuKlein.length) console.log(`optik ${name}: zu klein: ${m.zuKlein.join(' | ')}`);
  expect(m.sw, `${name}: kein waagrechtes Scrollen`).toBeLessThanOrEqual(m.iw);
  if (ziele) expect(m.zuKlein, `${name}: Fingerziele mindestens 44 px`).toEqual([]);
  expect(m.schrift, `${name}: VEIL Text und VEIL Rounded geladen`).toBe(true);
}

test('Popup bei 360 px: kein waagrechtes Scrollen, Pause sichtbar, Schrift geladen', async () => {
  const s = await context.newPage();
  await s.goto(url('popup.html'));
  await s.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), FERTIG);
  await s.reload();
  await expect(s.locator('#status')).not.toBeEmpty();
  await expect(s.locator('#pause')).toBeVisible();
  await s.waitForTimeout(400);
  pruefe('popup', await miss(s), false);
  await s.close();
});

// Phase 9, Paket A (Fund 2): ohne Aufklappen hoechstens 600 px hoch (Chrome schneidet das Popup dort ab), aufgeklappt kein waagrechtes Scrollen.
test('Popup bei 360 px mit einer Webseite: ohne Aufklappen hoechstens 600 px, aufgeklappt ohne waagrechtes Scrollen', async () => {
  const web = await context.newPage();
  await web.goto(`http://localhost:${process.env.VEIL_FIXTURE_PORT ?? 47173}/hello.html`);
  const s = await context.newPage();
  await s.setViewportSize({ width: 360, height: 1400 });
  await s.goto(url('popup.html'));
  await s.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), FERTIG);
  await s.evaluate(() => { localStorage.removeItem('veil-popup-aendern'); return (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen']); });
  await web.bringToFront();
  await s.reload();
  await expect(s.locator('#diese-seite-name')).toHaveText('localhost');
  await s.waitForTimeout(400);
  const hoehe = await s.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  console.log(`optik popup: Hoehe ohne Aufklappen ${hoehe} px bei 360 px Breite`);
  expect(hoehe, 'Popup ohne Aufklappen').toBeLessThanOrEqual(600);
  await s.locator('#aendern').click();
  await expect(s.locator('#zonen')).toBeVisible();
  pruefe('popup aufgeklappt', await miss(s), false);
  await s.evaluate(() => localStorage.removeItem('veil-popup-aendern'));
  await s.close();
  await web.close();
});

test('Einstellungsseite bei 360 px: oben und ganz unten, Ziele 44 px', async () => {
  const s = await context.newPage();
  await s.goto(url('options.html'));
  await expect(s.locator('#pause')).toBeVisible();
  await s.waitForTimeout(600);
  pruefe('einstellungen oben', await miss(s));
  await s.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await s.waitForTimeout(300);
  await expect(s.locator('#pause-leiste')).toBeVisible();
  pruefe('einstellungen unten', await miss(s));
  // Phase 9 (Fund 4 und 14): auch alles aufgeklappt, mit den runden Hilfe-Knoepfen, haelt 44 px und kein waagrechtes Scrollen.
  await oeffneZugeklapptes(s);
  await s.evaluate(() => window.scrollTo(0, 0));
  await s.waitForTimeout(300);
  pruefe('einstellungen aufgeklappt', await miss(s));
  await s.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await s.waitForTimeout(300);
  pruefe('einstellungen aufgeklappt unten', await miss(s));
  await s.close();
});

// Nacht N2: Hoehe der Einstellungsseite ohne Pack bei 360 x 780 (mit der Pack-Karte und ihren Kern-Bildern). Das Messziel "hoechstens 3
// Bildschirme" gilt bei 1280 (einstellungen-ordnung.spec.ts); hier steht die Zahl im Log und eine Grenze gegen Rueckschritte.
test('Einstellungsseite ohne Pack bei 360 px: Hoehe in Bildschirmen', async () => {
  const s = await context.newPage();
  await s.goto(url('options.html'));
  await s.evaluate(() => (globalThis as any).chrome.storage.local.remove('pack'));
  await s.reload();
  await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  await expect(s.locator('#kern-streifen'), 'Kern-Bilder im Testbau noetig (../02 Assets Mia/kern)').toBeVisible({ timeout: 5000 });
  await s.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('#kern-bilder img')].every((i) => i.complete && i.naturalWidth > 0));
  const hoehe = await s.evaluate(() => document.documentElement.scrollHeight);
  const stand = await s.evaluate(() => Math.ceil(document.getElementById('stand')!.getBoundingClientRect().height));
  console.log(`optik einstellungen 360: ohne Pack ${hoehe} px = ${(hoehe / 780).toFixed(2)} Bildschirme zu 780 px, davon Pack-Karte ${stand} px`);
  expect(hoehe / 780, 'Einstellungsseite ohne Pack bei 360 px').toBeLessThanOrEqual(GRENZE_360);
  await s.close();
});

test('Willkommensseite bei 360 px: Interview-Seiten (ohne Pack drei), Abschluss mit Checkliste, Ziele 44 px', async () => {
  const s = await context.newPage();
  await s.goto(url('willkommen.html#interview'));
  await expect(s.locator('#schritt-titel')).toBeVisible();
  let i = 1;
  for (;;) {
    await s.waitForTimeout(300);
    pruefe(`willkommen interview ${i}`, await miss(s));
    const letzte = (await s.locator('#iv-weiter').innerText()) === 'Finish';
    await s.locator('#iv-weiter').click();
    if (letzte) break;
    i++;
  }
  expect(i).toBe(3); // Fund 7: ohne Pack drei Fragen
  await expect(s.locator('#ende-liste')).toBeVisible();
  await s.waitForTimeout(300);
  pruefe('willkommen abschluss', await miss(s));
  await s.close();
});
