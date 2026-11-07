// Chromium: Messung Phase 8b (PHASE-8B-BAUPLAN Abschnitt 6) bei 360 px: kein waagrechtes Scrollen, Pause-Knopf sichtbar, Schriften des
// Gestaltungs-Systems geladen; auf Willkommensseite und Einstellungsseite (Regeln fuer schmale Schirme) alle sichtbaren Bedienelemente
// mindestens 44 px hoch. Gemessen: Chromium wendet `(pointer: coarse)` auf Erweiterungsseiten nicht an (weder isMobile noch CDP-Touch);
// die Finger-Regeln des Popups (Entscheidung 146) misst darum der Android-Durchlauf im Emulator.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';
const url = (seite: string) => `chrome-extension://${id}/${seite}`;
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
  await s.close();
});

test('Willkommensseite bei 360 px: fuenf Interview-Seiten, Ziele 44 px', async () => {
  const s = await context.newPage();
  await s.goto(url('willkommen.html#interview'));
  await expect(s.locator('#schritt-titel')).toBeVisible();
  for (let i = 1; i <= 5; i++) {
    await s.waitForTimeout(300);
    pruefe(`willkommen interview ${i}`, await miss(s));
    if (i < 5) await s.locator('#iv-weiter').click();
  }
  await s.close();
});
