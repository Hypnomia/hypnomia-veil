// Chromium: Phase 11 Etappe 4a (Regel O6). Jedes Auswahlfeld (`select`) der Erweiterungsseiten hat dieselbe berechnete Gestaltung: Willkommen
// (Interview Seite 5), Einstellungen (Mia's control) und Pack "Set me up". Gemessen bei 1280 und 360 Pixel Breite: Pfeil mit festem Abstand zum
// rechten Rand (mindestens 12 Pixel), Text nie unter dem Pfeil, Hoehe, Radius, Rand, Schrift, sichtbarer Fokusrahmen.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oeffneZugeklapptes } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'fertig', zeit: 1 };
const PACK_KURZ = { id: 't', version: '1.0.0', titel: 'T', freischaltungen: [] as string[], bilder: 1, groesse: 1, importiert: 1 };

let profil = '';
let context: BrowserContext;
let id = '';
const url = (seite: string) => `chrome-extension://${id}/${seite}`;
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const entferne = (seite: Page, k: string[]) => seite.evaluate((k) => (globalThis as any).chrome.storage.local.remove(k), k);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-optik-auswahl-'));
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

interface Mass {
  kennung: string;
  sichtbar: boolean;
  gestalt: Record<string, string>;
  hoehe: number;
  pfeilAbstand: number;
  pfeilBreite: number;
  textRechts: number;
  rechts: number;
}

// Misst alle sichtbaren select der Seite: berechnete Gestaltung (ohne Breite und Hoehe, die vom Inhalt abhaengen) und die Lage des Pfeils.
async function messeAuswahl(seite: Page): Promise<Mass[]> {
  return seite.evaluate(() =>
    [...document.querySelectorAll('select')]
      .filter((s) => s.getClientRects().length > 0)
      .map((s) => {
        const c = getComputedStyle(s);
        const r = s.getBoundingClientRect();
        const pos = c.backgroundPosition; // z. B. "calc(100% - 16px) 50%"
        const abstand = /calc\(100% - ([\d.]+)px\)/.exec(pos);
        const groesse = c.backgroundSize.split(' ')[0] ?? '';
        const gestalt: Record<string, string> = {};
        const schluessel = [
          'appearance', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderTopStyle', 'borderTopColor',
          'borderTopLeftRadius', 'borderBottomRightRadius', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'backgroundImage',
          'backgroundPosition', 'backgroundSize', 'backgroundRepeat', 'boxSizing', 'minHeight', 'cursor',
        ] as const;
        for (const k of schluessel) gestalt[k] = String((c as unknown as Record<string, string>)[k]);
        return {
          kennung: s.id,
          sichtbar: true,
          gestalt,
          hoehe: r.height,
          pfeilAbstand: abstand ? parseFloat(abstand[1] ?? 'NaN') : NaN,
          pfeilBreite: parseFloat(groesse),
          textRechts: parseFloat(c.paddingRight) + parseFloat(c.borderRightWidth),
          rechts: r.right,
        };
      }),
  );
}

// Gemeinsame Pruefung: alle Felder gleich, Pfeil mit Abstand, Text nie unter dem Pfeil, Hoehe, Fokusrahmen.
function pruefeGleich(alle: Mass[], breite: number, erwartet: string[]): void {
  expect(alle.map((m) => m.kennung).sort(), `gefundene Auswahlfelder bei ${breite}`).toEqual([...erwartet].sort());
  const erstes = alle[0];
  if (!erstes) throw new Error('keine Auswahlfelder gefunden');
  for (const m of alle) {
    expect(m.gestalt, `${m.kennung} gegen ${erstes.kennung} bei ${breite}`).toEqual(erstes.gestalt);
    expect(m.gestalt.appearance).toBe('none');
    expect(m.pfeilAbstand, `${m.kennung}: Pfeilabstand`).toBeGreaterThanOrEqual(12);
    // Text liegt nie unter dem Pfeil: Innenabstand rechts mindestens Pfeilabstand + Pfeilbreite + 8
    expect(m.textRechts, `${m.kennung}: Innenabstand rechts`).toBeGreaterThanOrEqual(m.pfeilAbstand + m.pfeilBreite + 8);
    expect(m.hoehe, `${m.kennung}: Hoehe`).toBeGreaterThanOrEqual(breite <= 480 ? 44 : 40);
    expect(m.hoehe, `${m.kennung}: Hoehe wie die anderen`).toBe(erstes.hoehe);
    expect(m.gestalt.borderTopLeftRadius).toBe('12px');
  }
}

async function fokusRahmen(seite: Page, sel: string): Promise<string> {
  await seite.locator(sel).focus();
  await seite.keyboard.press('Shift+Tab');
  await seite.keyboard.press('Tab'); // Tastaturfokus, damit :focus-visible gilt
  return seite.locator(sel).evaluate((e) => {
    const c = getComputedStyle(e);
    return `${c.outlineStyle} ${c.outlineWidth}`;
  });
}

for (const breite of [1280, 360]) {
  test(`Auswahlfelder: Willkommen (Interview Seite 5), Einstellungen (Mia's control) und Pack "Set me up" gleich gestaltet bei ${breite} px`, async () => {
    const hoehe = breite === 360 ? 780 : 800;
    test.setTimeout(150_000);
    const v = await context.newPage();
    try {
      // 1. Willkommen, Interview Seite 5 (Pack im Speicher: fuenf Seiten). Der Speicher wird von der Willkommensseite selbst geschrieben,
      // die Einstellungsseite wuerde einen Pack-Eintrag ohne Datenbank sofort wegraeumen.
      const w = await context.newPage();
      await w.setViewportSize({ width: breite, height: hoehe });
      await w.goto(url('willkommen.html'));
      await schreibe(w, { einstieg: FERTIG, pack: PACK_KURZ });
      await w.goto(url('willkommen.html#interview'));
      await w.reload();
      await expect(w.locator('#schritt')).toHaveAttribute('data-schritt', 'interview-1');
      await expect(w.locator('#fortschritt-text')).toHaveText('Question 1 of 5');
      for (let i = 0; i < 4 && !(await w.locator('#iv-blitz').isVisible()); i++) {
        await w.locator('#iv-weiter').click();
        await w.waitForTimeout(300);
      }
      await expect(w.locator('#iv-blitz')).toBeVisible();
      const willkommen = await messeAuswahl(w);
      pruefeGleich(willkommen, breite, ['iv-blitz', 'iv-cursor']);
      expect(await fokusRahmen(w, '#iv-blitz')).toMatch(/solid 3px/);
      await entferne(w, ['pack']);
      await w.close();
      // 2. Einstellungen, Mia's control
      const o = await context.newPage();
      await o.setViewportSize({ width: breite, height: hoehe });
      await o.goto(url('options.html'));
      await expect(o.locator('#pack-status')).not.toHaveText('');
      await oeffneZugeklapptes(o);
      await expect(o.locator('#kon-blitz')).toBeVisible();
      const einstellungen = await messeAuswahl(o);
      pruefeGleich(einstellungen, breite, ['kon-blitz', 'kon-cursor']);
      expect(await fokusRahmen(o, '#kon-blitz')).toMatch(/solid 3px/);
      // 3. Pack "Set me up" (Pack mit Blitz-Freischaltung)
      await schreibe(o, { pack: { ...PACK_KURZ, freischaltungen: ['kontrolle:blitz'] } });
      await expect(o.locator('#einrichten-blitz')).toBeVisible();
      const pack = (await messeAuswahl(o)).find((m) => m.kennung === 'einrichten-blitz');
      expect(pack, 'Auswahlfeld im Pack-Block gefunden').toBeTruthy();
      pruefeGleich([pack!, willkommen[0]!, einstellungen[0]!], breite, ['einrichten-blitz', 'iv-blitz', 'kon-blitz']);
      expect(await fokusRahmen(o, '#einrichten-blitz')).toMatch(/solid 3px/);
      await entferne(o, ['pack']);
      await o.close();
      console.log(`optik-auswahl ${breite}: ${willkommen.length + einstellungen.length + 1} Auswahlfelder an drei Orten, Pfeilabstand ${pack!.pfeilAbstand} px, Hoehe ${pack!.hoehe} px`);
    } finally {
      await v.close();
    }
  });
}
