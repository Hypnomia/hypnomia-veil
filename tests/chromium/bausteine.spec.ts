// Chromium: Phase 11 E4c0, gemeinsame Bausteine der Oberflaeche (Regeln B3, B4, B5, B6). Gewoehnliche Testseite ohne Erweiterung
// (tests/fixtures/bausteine.html); das Buendel baut tests/bausteine-server.mjs selbst in einen Ordner ausserhalb des Repos.
// Gemessen bei 360 und 1280 Pixel Breite, mit Maus und mit Finger (hasTouch).
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { starteBausteineServer } from '../bausteine-server.mjs';

let browser: Browser;
let server: Awaited<ReturnType<typeof starteBausteineServer>>;

test.beforeAll(async () => {
  server = await starteBausteineServer();
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});
test.afterAll(async () => {
  await browser?.close();
  await server?.schliesse();
});

async function oeffne(breite: number, finger: boolean): Promise<{ context: BrowserContext; seite: Page }> {
  const context = await browser.newContext({ viewport: { width: breite, height: 900 }, hasTouch: finger, isMobile: false });
  const seite = await context.newPage();
  await seite.goto(server.url);
  await seite.waitForSelector('html[data-bereit="1"]');
  await seite.evaluate(() => document.fonts.ready);
  return { context, seite };
}
const log = (s: Page) => s.evaluate(() => (window as any).__b.log as Array<{ von: string; wert: any }>);
const b = (s: Page, ausdruck: string) => s.evaluate((a) => new Function('b', `return ${a}`)((window as any).__b), ausdruck);

// Die fremden Knoepfe (id fremd-...) gehoeren nicht zu den Bausteinen und werden nicht gemessen (Nacharbeit R10)
const BEDIENBAR = 'button:not([id^="fremd-"]), select, input, a[href], [role="switch"], [role="radio"], [tabindex]:not([tabindex="-1"])';

// Alle Aufklapper und "?" auf, damit auch die inneren Elemente gemessen werden.
async function alleAuf(s: Page) {
  await s.evaluate(() => {
    for (const k of document.querySelectorAll<HTMLButtonElement>('[aria-expanded="false"]')) k.click();
  });
}

interface Kasten { art: string; text: string; b: number; h: number; x: number; y: number; r: number; u: number }
async function messeBedienbar(s: Page): Promise<Kasten[]> {
  return s.evaluate((sel) => {
    const out: Kasten[] = [];
    for (const e of document.querySelectorAll<HTMLElement>(sel)) {
      if (e.id === 'nackt' || e.getClientRects().length === 0) continue;
      const r = e.getBoundingClientRect();
      out.push({
        art: `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''}${e.className ? `.${String(e.className).split(' ')[0]}` : ''}`,
        text: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 24),
        b: r.width, h: r.height, x: r.left, y: r.top, r: r.right, u: r.bottom,
      });
    }
    return out;
  }, BEDIENBAR) as Promise<Kasten[]>;
}

for (const breite of [360, 1280]) {
  for (const finger of [false, true]) {
    const name = `${breite} px, ${finger ? 'Finger' : 'Maus'}`;

    test(`Fingerziel: jedes bedienbare Element mindestens 44 mal 44 Pixel (${name}), keine Ueberlappung, kein waagrechtes Scrollen`, async () => {
      const { context, seite } = await oeffne(breite, finger);
      try {
        const grob = await seite.evaluate(() => matchMedia('(pointer: coarse)').matches);
        expect(grob, 'Zeigerart der Messung').toBe(finger);
        await alleAuf(seite);
        const k = await messeBedienbar(seite);
        // Alle zehn Arten sind dabei (Schutz gegen eine leere Messung)
        const arten = new Set(k.map((x) => x.art.replace(/\[.*?\]/, '')));
        for (const soll of ['button.v-schalter-knopf', 'button.v-stufe', 'select.v-auswahl-feld', 'button.v-wahl-karte', 'button.v-auf-kopf', 'button.v-frage', 'button.v-chip', 'input.v-regler-eingabe']) {
          expect([...arten].some((a) => a.endsWith(soll.split('.')[1]!) || a === soll), `Art ${soll} gemessen`).toBe(true);
        }
        expect(k.length).toBeGreaterThan(40);
        const zuKlein = k.filter((x) => x.b < 43.99 || x.h < 43.99);
        expect(zuKlein.map((x) => `${x.art} "${x.text}" ${x.b.toFixed(1)}x${x.h.toFixed(1)}`)).toEqual([]);
        // Trefferflaechen ueberlappen nicht (die "?" ragen mit ihrem 44er Feld aus der Zeile, duerfen aber kein anderes Element decken)
        const ueber: string[] = [];
        for (let i = 0; i < k.length; i++)
          for (let j = i + 1; j < k.length; j++) {
            const a = k[i]!, c = k[j]!;
            const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
            const oy = Math.min(a.u, c.u) - Math.max(a.y, c.y);
            if (ox > 0.5 && oy > 0.5) ueber.push(`${a.art} "${a.text}" / ${c.art} "${c.text}"`);
          }
        expect(ueber).toEqual([]);
        const breiteDoc = await seite.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(breiteDoc[0]).toBeLessThanOrEqual(breiteDoc[1]! + 1);
        const kleinste = Math.min(...k.map((x) => Math.min(x.b, x.h)));
        console.log(`bausteine ${name}: ${k.length} Elemente, kleinste Kante ${kleinste.toFixed(2)} px`);
      } finally {
        await context.close();
      }
    });
  }
}

test('Fingerziel: Elemente, die nur im Hover- oder Fokuszustand wechseln, behalten ihre Masse (Fokus auf jedem Element)', async () => {
  const { context, seite } = await oeffne(360, false);
  try {
    await alleAuf(seite);
    const vorher = await messeBedienbar(seite);
    for (const h of await seite.locator(BEDIENBAR).elementHandles()) await h.focus().catch(() => {});
    const nachher = await messeBedienbar(seite);
    expect(nachher.map((x) => [x.b, x.h])).toEqual(vorher.map((x) => [x.b, x.h]));
  } finally {
    await context.close();
  }
});

test('Sichtbarer Fokus: jedes bedienbare Element zeigt per Tastatur einen Fokusrahmen von mindestens 2 Pixel', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    await alleAuf(seite);
    const n = await seite.locator(BEDIENBAR).count();
    const schlecht: string[] = [];
    await seite.keyboard.press('Tab');
    for (let i = 0; i < n + 2; i++) {
      const m = await seite.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        if (!e || e === document.body) return null;
        const c = getComputedStyle(e);
        return { art: e.className || e.tagName, stil: c.outlineStyle, breite: parseFloat(c.outlineWidth), id: e.id };
      });
      if (m && m.id !== 'nackt' && !m.id.startsWith('fremd-') && (m.stil === 'none' || m.breite < 2)) schlecht.push(`${m.art} ${m.stil} ${m.breite}`);
      await seite.keyboard.press('Tab');
    }
    expect(schlecht).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Schalter: Tastatur (Leertaste, Enter), aria-checked folgt, Druck auf den Titel schaltet, Hinweis haengt per aria-describedby', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const k = seite.locator('[data-fall="schalter"] [role="switch"]');
    await expect(k).toHaveAttribute('aria-checked', 'false');
    await k.focus();
    await seite.keyboard.press('Space');
    await expect(k).toHaveAttribute('aria-checked', 'true');
    await seite.keyboard.press('Enter');
    await expect(k).toHaveAttribute('aria-checked', 'false');
    await seite.locator('[data-fall="schalter"] .v-titeltext').click();
    await expect(k).toHaveAttribute('aria-checked', 'true');
    expect((await log(seite)).filter((l) => l.von === 'schalter').map((l) => l.wert)).toEqual([true, false, true]);
    const beschr = await k.getAttribute('aria-describedby');
    expect(await seite.locator(`#${beschr}`).textContent()).toBe('Switch hint');
    expect(await k.getAttribute('aria-labelledby')).toBeTruthy();
    // Programmatisch setzen meldet nichts und folgt in aria
    await b(seite, 'b.schalter.setze(false)');
    await expect(k).toHaveAttribute('aria-checked', 'false');
    expect((await log(seite)).filter((l) => l.von === 'schalter')).toHaveLength(3);
    await b(seite, 'b.schalter.setzeGesperrt(true)');
    await expect(k).toHaveAttribute('aria-disabled', 'true');
    expect(await k.evaluate((e) => (e as HTMLButtonElement).disabled), 'nicht disabled').toBe(false);
  } finally {
    await context.close();
  }
});

test('Schalter mit Finger: Antippen schaltet', async () => {
  const { context, seite } = await oeffne(360, true);
  try {
    const k = seite.locator('[data-fall="schalterAn"] [role="switch"]');
    await expect(k).toHaveAttribute('aria-checked', 'true');
    await k.tap();
    await expect(k).toHaveAttribute('aria-checked', 'false');
    await seite.locator('[data-fall="schalterAn"] .v-titeltext').tap();
    await expect(k).toHaveAttribute('aria-checked', 'true');
  } finally {
    await context.close();
  }
});

test('Stufenwahl: Pfeiltasten, Pos1 und Ende bewegen NUR den Fokus, gewaehlt wird mit Leertaste, Eingabe oder Klick, nur ein Tab-Halt', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const g = seite.locator('[data-fall="stimmung"] [role="radiogroup"]');
    await expect(g).toHaveAttribute('aria-labelledby', /.+/);
    const r = g.locator('[role="radio"]');
    const marken = () => r.evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')));
    // Standard 0,10: erste Stufe markiert, genau ein Tab-Halt
    expect(await marken()).toEqual(['true', 'false', 'false']);
    expect(await g.locator('[tabindex="0"]').count()).toBe(1);
    await r.nth(0).focus();
    await seite.keyboard.press('ArrowRight');
    await expect(r.nth(1)).toBeFocused();
    await seite.keyboard.press('ArrowDown');
    await expect(r.nth(2)).toBeFocused();
    await seite.keyboard.press('ArrowRight');
    await expect(r.nth(0)).toBeFocused(); // umlaufend
    await seite.keyboard.press('ArrowLeft');
    await expect(r.nth(2)).toBeFocused();
    await seite.keyboard.press('Home');
    await expect(r.nth(0)).toBeFocused();
    await seite.keyboard.press('End');
    await expect(r.nth(2)).toBeFocused();
    // Nur der Fokus ist gewandert: nichts markiert, nichts gemeldet
    expect(await marken()).toEqual(['true', 'false', 'false']);
    expect((await log(seite)).filter((l) => l.von === 'stimmung')).toEqual([]);
    expect(await g.locator('[tabindex="0"]').count()).toBe(1);
    // Leertaste waehlt
    await seite.keyboard.press('Space');
    expect(await marken()).toEqual(['false', 'false', 'true']);
    await seite.keyboard.press('Home');
    await seite.keyboard.press('Enter');
    expect(await marken()).toEqual(['true', 'false', 'false']);
    await r.nth(1).click();
    expect(await marken()).toEqual(['false', 'true', 'false']);
    expect((await log(seite)).filter((l) => l.von === 'stimmung').map((l) => l.wert)).toEqual([0.22, 0.1, 0.15]);
    // Der Hinweis haengt per aria-describedby an der Gruppe
    const beschr = await g.getAttribute('aria-describedby');
    expect(beschr).toBeTruthy();
    expect(await seite.locator(`#${beschr}`).textContent()).toBe('Stage 1');
    // Freilegen: Millisekunden
    await seite.locator('[data-fall="freilegen"] [role="radio"]').nth(0).click();
    expect((await log(seite)).filter((l) => l.von === 'freilegen').map((l) => l.wert)).toEqual([5000]);
  } finally {
    await context.close();
  }
});

test('Stufenwahl: ein Zwischenwert zeigt KEINE markierte Stufe und den offenen Aufklapper mit dem Wert, eine Stufe schliesst ihn wieder', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const w = seite.locator('[data-fall="stimmung"]');
    const r = w.locator('[role="radio"]');
    const kopf = w.locator('.v-auf-kopf');
    const marken = () => r.evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')));
    // Standard: Stufe, Aufklapper zu
    expect(await marken()).toEqual(['true', 'false', 'false']);
    await expect(kopf).toHaveAttribute('aria-expanded', 'false');
    for (const zw of [0.13, 0.13000001, 0.11, 0.24]) {
      await b(seite, `b.stimmung.setze(${zw})`);
      expect(await marken(), `Zwischenwert ${zw}`).toEqual(['false', 'false', 'false']);
      await expect(kopf).toHaveAttribute('aria-expanded', 'true');
      await expect(w.locator('.v-regler .v-wert')).toHaveText(zw.toFixed(2));
      await expect(w.locator('input[type="range"]')).toBeVisible();
      expect(Number(await w.locator('input[type="range"]').inputValue())).toBeCloseTo(zw, 2); // der Regler rastet auf seinen Schritt
      expect(await w.locator('[tabindex="0"][role="radio"]').count(), 'Gruppe bleibt per Tab erreichbar').toBe(1);
      await expect(w.locator('.v-hinweis')).toHaveText('In between');
    }
    await b(seite, 'b.stimmung.setze(0.15)');
    expect(await marken()).toEqual(['false', 'true', 'false']);
    await expect(kopf).toHaveAttribute('aria-expanded', 'false');
    // Freilegen: 17 s ist keine Stufe
    const f = seite.locator('[data-fall="freilegen"]');
    await b(seite, 'b.freilegen.setze(17000)');
    expect(await f.locator('[role="radio"]').evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'false']);
    await expect(f.locator('.v-wert')).toHaveText('17 s');
    await expect(f.locator('.v-auf-kopf')).toHaveAttribute('aria-expanded', 'true');
  } finally {
    await context.close();
  }
});

test('Stufenwahl: der Regler "Exact value" meldet den genauen Wert und markiert beim Landen auf einer Stufe diese', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const w = seite.locator('[data-fall="stimmung"]');
    await w.locator('.v-auf-kopf').click();
    const regler = w.locator('input[type="range"]');
    await regler.focus();
    await seite.keyboard.press('ArrowRight'); // 0,11
    await expect(w.locator('.v-wert')).toHaveText('0.11');
    expect(await w.locator('[role="radio"]').evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'false']);
    await expect(w.locator('.v-auf-kopf')).toHaveAttribute('aria-expanded', 'true'); // bleibt offen unter der Hand
    const l = (await log(seite)).filter((x) => x.von === 'stimmung');
    expect(l.at(-1)?.wert).toBeCloseTo(0.11, 5);
    for (let i = 0; i < 4; i++) await seite.keyboard.press('ArrowRight'); // 0,15
    expect(await w.locator('[role="radio"]').evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'true', 'false']);
    await expect(w.locator('.v-auf-kopf')).toHaveAttribute('aria-expanded', 'true');
  } finally {
    await context.close();
  }
});

test('Auswahlfeld: nach Regel O6 (Pfeil mit Abstand zum Rand, Polster, Gestalt gleich dem nackten select), 44 Pixel hoch bei jeder Breite', async () => {
  for (const breite of [360, 1280]) {
    const { context, seite } = await oeffne(breite, false);
    try {
      const messe = (sel: string) =>
        seite.evaluate((s) => {
          const e = document.querySelector<HTMLSelectElement>(s)!;
          const c = getComputedStyle(e);
          const abstand = /calc\(100% - ([\d.]+)px\)/.exec(c.backgroundPosition);
          const gestalt: Record<string, string> = {};
          for (const k of ['appearance', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize', 'backgroundRepeat'])
            gestalt[k] = String((c as any)[k]);
          return { gestalt, hoehe: e.getBoundingClientRect().height, abstand: abstand ? parseFloat(abstand[1]!) : NaN, pfeil: parseFloat(c.backgroundSize), polster: parseFloat(c.paddingRight) + parseFloat(c.borderRightWidth) };
        }, sel);
      const m = await messe('[data-fall="auswahl"] select');
      const nackt = await messe('#nackt');
      expect(m.hoehe).toBeGreaterThanOrEqual(43.99);
      expect(m.abstand).toBeGreaterThanOrEqual(12);
      expect(m.polster).toBeGreaterThanOrEqual(m.abstand + m.pfeil);
      expect(m.gestalt).toEqual(nackt.gestalt);
      expect(m.gestalt.appearance).toBe('none');
      console.log(`bausteine Auswahl ${breite}: Hoehe ${m.hoehe}, Pfeil ${m.abstand} px vom Rand, Polster ${m.polster}`);
    } finally {
      await context.close();
    }
  }
});

test('Auswahlfeld: Wert, Name per aria-labelledby, Wechsel meldet den Wert, setze meldet nichts', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const s = seite.locator('[data-fall="auswahl"] select');
    expect(await s.getAttribute('aria-labelledby')).toBeTruthy();
    await s.focus();
    await expect(s).toBeFocused();
    await s.selectOption('c');
    expect((await log(seite)).filter((l) => l.von === 'auswahl').map((l) => l.wert)).toEqual(['c']);
    await b(seite, "b.auswahl.setze('b')");
    expect(await s.inputValue()).toBe('b');
    expect((await log(seite)).filter((l) => l.von === 'auswahl')).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('Wahlkarte: Pfeiltasten bewegen nur den Fokus, Leertaste waehlt, Haken als zweites Zeichen, ohne Wert ist nichts markiert, Karten mit Bild bleiben zu zweit bei 360', async () => {
  const { context, seite } = await oeffne(360, false);
  try {
    const g = seite.locator('[data-fall="wahlkarten"] [role="radiogroup"]');
    const r = g.locator('[role="radio"]');
    await expect(r.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(r.nth(1).locator('.v-haken')).toBeVisible();
    await expect(r.nth(0).locator('.v-haken')).toBeHidden();
    await r.nth(1).focus();
    await seite.keyboard.press('ArrowRight');
    await expect(r.nth(2)).toBeFocused();
    await expect(r.nth(1)).toHaveAttribute('aria-checked', 'true'); // der Pfeil bewegt nur den Fokus
    expect((await log(seite)).filter((l) => l.von === 'wahlkarten')).toEqual([]);
    await seite.keyboard.press('Space');
    await expect(r.nth(2)).toHaveAttribute('aria-checked', 'true');
    expect((await log(seite)).filter((l) => l.von === 'wahlkarten').map((l) => l.wert)).toEqual(['drei']);
    await b(seite, 'b.wahlkarten.setze(null)');
    expect(await r.evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'false']);
    expect(await g.locator('[tabindex="0"]').count()).toBe(1);
    const spalten = await g.evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    expect(spalten).toBe(2);
  } finally {
    await context.close();
  }
});

test('Aufklapper und "?": Enter und Leertaste, aria-expanded und aria-controls folgen, Escape schliesst das "?"', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const kopf = seite.locator('[data-fall="aufklapper"] .v-auf-kopf');
    const inhalt = seite.locator('#' + (await kopf.getAttribute('aria-controls')));
    await expect(kopf).toHaveAttribute('aria-expanded', 'false');
    await expect(inhalt).toBeHidden();
    await kopf.focus();
    await seite.keyboard.press('Enter');
    await expect(kopf).toHaveAttribute('aria-expanded', 'true');
    await expect(inhalt).toBeVisible();
    await seite.keyboard.press('Space');
    await expect(kopf).toHaveAttribute('aria-expanded', 'false');
    await expect(inhalt).toBeHidden();
    const fragen = seite.locator('[data-fall="aufklapper"] .v-frage');
    const feld = seite.locator('#' + (await fragen.getAttribute('aria-controls')));
    await expect(feld).toBeHidden();
    await fragen.focus();
    await seite.keyboard.press('Enter');
    await expect(fragen).toHaveAttribute('aria-expanded', 'true');
    await expect(feld).toBeVisible();
    await expect(feld).toHaveText('Explanation of the fold.');
    await seite.keyboard.press('Escape');
    await expect(fragen).toHaveAttribute('aria-expanded', 'false');
    await expect(feld).toBeHidden();
    // Name des "?" fuer Screenreader kommt als Eingabe
    expect(await fragen.getAttribute('aria-label')).toBe('What does the fold do?');
    // "?" an jedem Titel mit Erklaerung: Knopf 44 mal 44, Kreis klein
    const kreis = await fragen.locator('.v-frage-kreis').boundingBox();
    expect(kreis!.width).toBeLessThan(30);
    const box = await fragen.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(43.99);
    expect(box!.height).toBeGreaterThanOrEqual(43.99);
  } finally {
    await context.close();
  }
});

test('Zonenwahl: drei Karten (Pfeil bewegt den Fokus, Leertaste waehlt), Standard ist "Body", Aufklapper mit zehn Zonen (aria-pressed), Stand im Kopf', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const w = seite.locator('[data-fall="zonen"]');
    const r = w.locator('[role="radiogroup"] [role="radio"]');
    await expect(r.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(w.locator('.v-auf-kopf .v-auf-stand')).toHaveText('3 of 10 on');
    await r.nth(0).focus();
    await seite.keyboard.press('ArrowRight');
    await expect(r.nth(1)).toBeFocused();
    await expect(r.nth(0)).toHaveAttribute('aria-checked', 'true'); // der Pfeil bewegt nur den Fokus
    expect((await log(seite)).filter((x) => x.von === 'zonen')).toEqual([]);
    await seite.keyboard.press('Space');
    await expect(r.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(w.locator('.v-auf-kopf .v-auf-stand')).toHaveText('4 of 10 on');
    const l = (await log(seite)).filter((x) => x.von === 'zonen');
    expect(l.at(-1)!.wert.face.an).toBe(true);
    await w.locator('.v-auf-kopf').click();
    expect(await w.locator('.v-chip').count()).toBe(10);
    const face = w.locator('.v-chip[data-zone="face"]');
    await expect(face).toHaveAttribute('aria-pressed', 'true');
    await face.focus();
    await seite.keyboard.press('Space');
    await expect(face).toHaveAttribute('aria-pressed', 'false');
    await expect(r.nth(0)).toHaveAttribute('aria-checked', 'true'); // wieder genau "Body"
    // eine einzelne Zone ausserhalb jeder Wahl: keine Karte markiert
    await w.locator('.v-chip[data-zone="eyes"]').click();
    expect(await r.evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'false']);
  } finally {
    await context.close();
  }
});

test('Kleidungsfrage: der heutige Standard ist gemischt, keine Antwort markiert, Fokus allein schreibt nichts, erst die Wahl schreibt', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const w = seite.locator('[data-fall="kleidung"]');
    const r = w.locator('[role="radio"]');
    expect(await b(seite, 'b.kleidung.stand()')).toBe('gemischt');
    expect(await r.evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false']);
    expect(await w.locator('[tabindex="0"]').count()).toBe(1);
    await r.nth(0).focus();
    await seite.keyboard.press('Tab');
    await seite.keyboard.press('Shift+Tab');
    expect((await log(seite)).filter((l) => l.von === 'kleidung')).toHaveLength(0);
    await r.nth(1).click(); // Under clothes too
    await expect(r.nth(1)).toHaveAttribute('aria-checked', 'true');
    const z1 = (await log(seite)).filter((l) => l.von === 'kleidung').at(-1)!.wert;
    const zs = (await b(seite, 'b.zonenStart')) as Record<string, { an: boolean; bedeckt?: boolean }>;
    for (const k of Object.keys(zs)) {
      expect(z1[k].an, `an von ${k}`).toBe(zs[k]!.an);
      if (['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'].includes(k)) expect(z1[k].bedeckt).toBe(true);
    }
    await r.nth(1).focus();
    await seite.keyboard.press('ArrowLeft'); // Fokus auf Bare skin only: ein Pfeil nimmt nie die Deckung
    await expect(r.nth(0)).toBeFocused();
    await expect(r.nth(1)).toHaveAttribute('aria-checked', 'true');
    expect((await log(seite)).filter((l) => l.von === 'kleidung')).toHaveLength(1);
    await seite.keyboard.press('Space');
    await expect(r.nth(0)).toHaveAttribute('aria-checked', 'true');
    const z2 = (await log(seite)).filter((l) => l.von === 'kleidung').at(-1)!.wert;
    for (const k of ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits']) expect(z2[k].bedeckt).toBe(false);
    expect(await b(seite, 'b.kleidung.stand()')).toBe('haut');
  } finally {
    await context.close();
  }
});

test('Hinweis: hoechstens einer je Baustein, auch nach mehrfachem Setzen, und er verschwindet bei null', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    await alleAuf(seite);
    const zaehle = () =>
      seite.evaluate(() => {
        const aus: Record<string, number> = {};
        for (const w of document.querySelectorAll<HTMLElement>('[data-v-baustein]')) {
          const n = [...w.querySelectorAll('.v-hinweis')].filter((h) => h.closest('[data-v-baustein]') === w).length;
          aus[`${w.dataset.vBaustein}#${[...document.querySelectorAll('[data-v-baustein]')].indexOf(w)}`] = n;
        }
        return aus;
      });
    for (const f of ['schalter.setzeHinweis', 'auswahl.setzeHinweis', 'wahlkarten.setzeHinweis', 'zonen.setzeHinweis', 'kleidung.setzeHinweis']) {
      await b(seite, `(b.${f}('eins'), b.${f}('zwei'), b.${f}('drei'))`);
    }
    const n = await zaehle();
    expect(Object.keys(n).length).toBeGreaterThan(10);
    expect(Object.entries(n).filter(([, v]) => v > 1)).toEqual([]);
    expect(await seite.locator('[data-fall="auswahl"] .v-hinweis').textContent()).toBe('drei');
    expect(await seite.locator('[data-fall="kleidung"] .v-hinweis').count()).toBe(1);
    await b(seite, 'b.kleidung.setzeHinweis(null)');
    expect(await seite.locator('[data-fall="kleidung"] .v-hinweis').count()).toBe(0);
    // Stufenwahl: der eine Hinweis folgt dem Stand
    await b(seite, 'b.stimmung.setze(0.13)');
    await b(seite, 'b.stimmung.setze(0.15)');
    expect(await seite.locator('[data-fall="stimmung"] .v-hinweis').count()).toBe(1);
  } finally {
    await context.close();
  }
});

test('Vorschau-Platz: nur Rahmen und Etikett, Verhaeltnis 3 zu 4, nicht fokussierbar, Etikett setzbar', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const v = seite.locator('[data-fall="vorschau"] [data-v-baustein="vorschau-platz"]');
    await expect(v).toHaveAttribute('aria-label', 'Preview');
    await expect(v.locator('.v-vorschau-etikett')).toHaveText('Showing');
    const r = await v.locator('.v-vorschau-rahmen').boundingBox();
    expect(r!.width / r!.height).toBeCloseTo(0.75, 2);
    expect(await v.locator(BEDIENBAR).count()).toBe(0);
    await b(seite, "b.vorschau.setzeEtikett('Mood')");
    await expect(v.locator('.v-vorschau-etikett')).toHaveText('Mood');
    await b(seite, "b.vorschau.setzeEtikett('')");
    await expect(v.locator('.v-vorschau-etikett')).toBeHidden();
  } finally {
    await context.close();
  }
});

test('Keine feste Schrift oder Farbe zur Laufzeit: die Bausteine tragen die Schrift und die Farben aus tokens.css', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const m = await seite.evaluate(() => {
      const t = getComputedStyle(document.querySelector('.v-titeltext')!);
      const root = getComputedStyle(document.documentElement);
      const k = getComputedStyle(document.querySelector('.v-stufe[aria-checked="true"]')!);
      return { schrift: t.fontFamily, text: root.getPropertyValue('--v-schrift-text').trim(), farbe: t.color, tokenFarbe: root.getPropertyValue('--v-text').trim(), akzent: k.backgroundImage };
    });
    expect(m.schrift).toContain('VEIL Text');
    expect(m.farbe).toBe('rgb(67, 40, 60)'); // --v-text #43283c
    expect(m.akzent).toContain('linear-gradient');
  } finally {
    await context.close();
  }
});

test('Rueckrufe (R4): nach dem Aufbau ist das Protokoll fuer jeden Baustein leer, und setze mit einem anderen Stand laesst es leer', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    expect(await log(seite)).toEqual([]);
    await b(seite, 'b.schalter.setze(true)');
    await b(seite, 'b.schalterAn.setze(false)');
    await b(seite, 'b.stimmung.setze(0.22)');
    await b(seite, 'b.freilegen.setze(20000)');
    await b(seite, "b.auswahl.setze('c')");
    await b(seite, "b.wahlkarten.setze('eins')");
    const zonen = JSON.parse(JSON.stringify(await b(seite, 'b.zonenStart')));
    for (const k of Object.keys(zonen)) zonen[k].an = true;
    for (const k of ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits']) zonen[k].bedeckt = true;
    await seite.evaluate((z) => (window as any).__b.setzeStand(z), zonen);
    await b(seite, 'b.zonen.setze()');
    await b(seite, 'b.kleidung.setze()');
    expect(await b(seite, 'b.kleidung.stand()')).toBe('auch-bedeckt');
    await expect(seite.locator('[data-fall="kleidung"] [role="radio"]').nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(seite.locator('[data-fall="zonen"] [role="radio"]').nth(2)).toHaveAttribute('aria-checked', 'true');
    expect(await log(seite)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Zonenwahl und Kleidungsfrage ohne eigene Kopie (R5): "Under clothes too" waehlen, danach einen Chip druecken, bedeckt bleibt bei allen Zonen an', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const BED = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
    await seite.locator('[data-fall="kleidung"] [role="radio"]').nth(1).click(); // Under clothes too
    let st = (await b(seite, 'b.gespeichert()')) as Record<string, { an: boolean; bedeckt?: boolean }>;
    for (const k of BED) expect(st[k]!.bedeckt, k).toBe(true);
    // Chip einer ausgeschalteten bedeckbaren Zone und einer nicht bedeckbaren, ohne dass der andere Baustein neu gezeichnet wurde
    await seite.locator('[data-fall="zonen"] .v-auf-kopf').click();
    await seite.locator('[data-fall="zonen"] .v-chip[data-zone="belly"]').click();
    await seite.locator('[data-fall="zonen"] .v-chip[data-zone="eyes"]').click();
    st = (await b(seite, 'b.gespeichert()')) as typeof st;
    expect(st.belly!.an).toBe(true);
    for (const k of BED) expect(st[k]!.bedeckt, `${k} nach dem Chip`).toBe(true);
    // Auch der Rueckweg: Karte waehlen, bedeckt bleibt
    await seite.locator('[data-fall="zonen"] [role="radio"]').nth(2).click();
    st = (await b(seite, 'b.gespeichert()')) as typeof st;
    for (const k of BED) expect(st[k]!.bedeckt, `${k} nach der Karte`).toBe(true);
    // Beide zeichnen nach setze() denselben Stand
    await b(seite, 'b.zonen.setze()');
    await b(seite, 'b.kleidung.setze()');
    await expect(seite.locator('[data-fall="kleidung"] [role="radio"]').nth(1)).toHaveAttribute('aria-checked', 'true');
  } finally {
    await context.close();
  }
});

test('Chip-Rundweg (H1): Genitals aus und wieder an behaelt bedeckt, ein Chip nimmt nie die Deckung', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    await seite.locator('[data-fall="zonen"] .v-auf-kopf').click();
    const chip = seite.locator('[data-fall="zonen"] .v-chip[data-zone="genitals"]');
    await chip.click();
    await chip.click();
    const st = (await b(seite, 'b.gespeichert()')) as Record<string, { an: boolean; bedeckt?: boolean }>;
    expect(st.genitals).toEqual({ an: true, bedeckt: true });
  } finally {
    await context.close();
  }
});

test('Gesperrter Schalter (N6): aria-disabled, per Tab erreichbar, ein Druck aendert nichts und ruft nichts, der Hinweis bleibt lesbar', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    const k = seite.locator('[data-fall="gesperrt"] [role="switch"]');
    await expect(k).toHaveAttribute('aria-disabled', 'true');
    expect(await k.evaluate((e) => (e as HTMLButtonElement).disabled), 'nicht disabled').toBe(false);
    await k.focus();
    await expect(k).toBeFocused();
    await seite.keyboard.press('Space');
    await seite.keyboard.press('Enter');
    await k.click({ force: true }); // Playwright haelt aria-disabled fuer nicht bedienbar: erzwungen
    await seite.locator('[data-fall="gesperrt"] .v-titeltext').click();
    await expect(k).toHaveAttribute('aria-checked', 'true');
    expect((await log(seite)).filter((l) => l.von === 'gesperrt')).toEqual([]);
    const beschr = await k.getAttribute('aria-describedby');
    expect(await seite.locator(`#${beschr}`).textContent()).toBe('Locked because of a reason');
    await b(seite, 'b.gesperrt.setzeGesperrt(false)');
    await k.click();
    await expect(k).toHaveAttribute('aria-checked', 'false');
  } finally {
    await context.close();
  }
});

test('Sammelregeln (R10): ein fremder Knopf im Aufklapper behaelt seine Gestalt, gleich einem Knopf ausserhalb der Bausteine', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    await alleAuf(seite);
    const messe = (id: string) =>
      seite.evaluate((i) => {
        const e = document.getElementById(i) as HTMLElement;
        e.focus();
        const c = getComputedStyle(e);
        const o: Record<string, string> = {};
        for (const k of ['fontFamily', 'color', 'touchAction', 'opacity', 'cursor', 'minHeight', 'minWidth', 'paddingTop', 'paddingLeft', 'backgroundColor', 'borderTopWidth', 'borderTopLeftRadius', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset']) o[k] = String((c as any)[k]);
        const r = e.getBoundingClientRect();
        o.hoehe = String(r.height);
        return o;
      }, id);
    const innen = await messe('fremd-innen');
    const aussen = await messe('fremd-aussen');
    // Beim Fokus per Skript ohne Tastatur kann :focus-visible fehlen: beide Knoepfe stehen gleich da.
    expect(innen).toEqual(aussen);
    expect(Number(innen.hoehe)).toBeLessThan(44);
    // Mit der Tastatur fokussiert zeigt der fremde Knopf nicht den Rahmen der Bausteine
    await seite.locator('#fremd-innen').focus();
    await seite.keyboard.press('Shift+Tab');
    await seite.keyboard.press('Tab');
    const rahmen = await seite.evaluate(() => getComputedStyle(document.getElementById('fremd-innen')!).outlineOffset);
    expect(rahmen).not.toBe('3px');
  } finally {
    await context.close();
  }
});

test('Zwischenwert 0,1049 (R14): die Zahl zeigt den gespeicherten Wert, keine Stufe markiert, nichts geschrieben, Messung des Reglers', async () => {
  const { context, seite } = await oeffne(1280, false);
  try {
    await b(seite, 'b.stimmung.setze(0.1049)');
    const w = seite.locator('[data-fall="stimmung"]');
    expect(await w.locator('[role="radio"]').evaluateAll((a) => a.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'false']);
    await expect(w.locator('.v-wert')).toHaveText('0.1049');
    await expect(w.locator('.v-auf-kopf .v-auf-stand')).toHaveText('0.1049');
    await expect(w.locator('.v-auf-kopf')).toHaveAttribute('aria-expanded', 'true');
    expect(await b(seite, 'b.stimmung.wert()')).toBe(0.1049);
    expect(await log(seite)).toEqual([]);
    const regler = await w.locator('input[type="range"]').inputValue();
    console.log(`bausteine R14: gespeichert 0.1049, Zahl "0.1049", Regler zeigt ${regler} (rastet auf den Schritt 0.01)`);
    expect(Number(regler)).toBeCloseTo(0.1, 2);
  } finally {
    await context.close();
  }
});
