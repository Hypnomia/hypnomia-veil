// Chromium: Phase 11 E4f, Handy (Regeln H-a bis H-g): Einstellungsseite (sieben Reiter, ohne und mit Pack), Willkommensseite (Warnung, 18+,
// Einwilligung, alle Fragen des Interviews, Abschluss, ohne und mit Pack) und Popup (vier Zustaende, Maus und grober Zeiger ueber die CDP-Emulation)
// bei 360 x 640, 320 x 568 und 412 x 915. Messung und Grenzen stehen in tests/gemeinsam/handy-mess.mjs (dort auch die eine Liste der Ausnahmen).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUFLAGEN_H_C, AUSNAHMEN_H_B, BREITEN, FEHLER_SKRIPT, FINGERZIEL, FOKUS_SKRIPT, MESS_SKRIPT, wertungFehler, wertungFehlerHG, wertungFokus, wertungSprung, wertungStelle, wertungMessung } from '../gemeinsam/handy-mess.mjs';
import { REITER as REITERDATEN } from '../../entrypoints/options/reiter-daten';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);

let profil = '';
let context: BrowserContext;
let id = '';
const url = (s: string) => `chrome-extension://${id}/${s}`;
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const ALLE = ['stil:mia-patch', 'zensur:sticker', 'erwachsen:vorschau', 'erwachsen:quiz', 'erwachsen:titel', 'erwachsen:ersatz', 'quiz:freilegen', 'zensur:steigerung', 'chibi:pack'];
// Das Pack ist das Dummy-Pack der Tests (`npm run pack:dummy`), wirklich importiert: der Abgleich beim Oeffnen entfernt eine Kurzfassung ohne Pack in der
// Ablage. Die Freischaltungen werden danach auf alle gesetzt, damit das Interview sechs Seiten hat. `PACK` wird von `packBereit` gefuellt.
const PACK: Record<string, unknown> = {};
const PACK_DATEI = path.join(wurzel, '.output-pack', 'dummy.miapack');
const REITER = REITERDATEN.map((r) => r.name);

const lauf = (s: Page, fn: string, src: string, arg: unknown = {}) => s.evaluate(`(function(){ ${src}; return ${fn}(window, ${JSON.stringify(arg)}); })()`) as Promise<any>;
const schreibe = (s: Page, o: Record<string, unknown>) => s.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const leere = (s: Page) =>
  s.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'steigerung', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));

test.setTimeout(420_000);

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-handy-'));
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

// Ein Fenster der Groesse mit gewuenschtem Zeiger; grob schaltet pointer: coarse und hover: none per CDP ein. Die Emulation geht bei einer Navigation
// verloren, darum setzt `grobAn` sie nach dem Laden noch einmal (wie die Messung).
async function fenster(b: number, h: number, grob: boolean): Promise<Page> {
  const s = await context.newPage();
  await s.setViewportSize({ width: b, height: h });
  if (grob) (s as any).__cdp = await context.newCDPSession(s);
  return s;
}
async function grobAn(s: Page) {
  const cdp = (s as any).__cdp;
  if (!cdp) return;
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
  expect(await s.evaluate(() => matchMedia('(pointer: coarse)').matches), 'pointer: coarse gilt').toBe(true);
}
async function packBereit() {
  if (PACK.id) return;
  const s = await context.newPage();
  await s.goto(url('options.html'));
  await leere(s);
  await schreibe(s, { einstieg: EINSTIEG_FERTIG });
  await s.reload();
  await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  await s.locator('[role=tab]', { hasText: /^Pack and sound$/ }).click();
  await s.locator('#datei').setInputFiles(PACK_DATEI);
  await s.locator('#annehmen').click();
  await s.locator('#meldung').filter({ hasText: 'The pack is in' }).waitFor({ timeout: 60_000 });
  const meta = await s.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('pack')).pack);
  Object.assign(PACK, meta, { freischaltungen: [...new Set([...(meta.freischaltungen ?? []), ...ALLE])], sticker: meta.sticker ?? 1 });
  await s.close();
}
async function vorbereiten(vorher: Record<string, unknown>) {
  if (vorher.pack) await packBereit();
  if (vorher.pack) vorher = { ...vorher, pack: PACK };
  const s = await context.newPage();
  await s.goto(url('options.html'));
  await leere(s);
  if (Object.keys(vorher).length) await schreibe(s, vorher);
  await s.close();
}

// Tab-Folge: die Tasten laufen echt (Tab oder Umschalt+Tab ab Seitenanfang), die Halte sammelt ein Horcher und werden danach nachgespielt (handy-mess.mjs).
async function tabGang(s: Page, rueckwaerts: boolean) {
  const n = (await lauf(s, 'fokusStart', FOKUS_SKRIPT)) as number;
  for (let i = 0; i < n; i++) {
    await s.keyboard.press(rueckwaerts ? 'Shift+Tab' : 'Tab');
    if ((await lauf(s, 'fokusNach', FOKUS_SKRIPT, 70)) === true) break;
  }
  return (await lauf(s, 'fokusFolge', FOKUS_SKRIPT)) as any[];
}

// Wertet eine Ansicht aus und sammelt die Verstoesse je Regel mit dem Namen der Ansicht.
const verstoesse: Record<string, string[]> & { [k: string]: string[] } = { 'H-a': [], 'H-b': [], 'H-c': [], 'H-d': [], 'H-f': [], 'H-g': [] };
const zaehler: Record<string, number> = {};
async function pruefeAnsicht(s: Page, name: string, o: { flaeche: string; zeiger: 'grob' | 'fein'; b: number; h: number; erste?: [string, string?]; fokus?: boolean; reiter?: string }) {
  await grobAn(s);
  await s.waitForTimeout(250);
  const m = await lauf(s, 'messeHandy', MESS_SKRIPT, { ...(o.erste ? { erste: o.erste[0], ausser: o.erste[1] } : {}), ...(o.reiter ? { panel: '[role=tabpanel]:not([hidden])' } : {}), auflagen: AUFLAGEN_H_C });
  const w = wertungMessung(m, { flaeche: o.flaeche, zeiger: o.zeiger, breite: o.b, hoehe: o.h, erste: !!o.erste, reiter: o.reiter ?? null });
  for (const r of Object.keys(w)) (verstoesse[r] as string[]).push(...(w as any)[r].map((t: string) => `${name}: ${t}`));
  if (o.fokus !== false) {
    for (const rueck of [false, true]) {
      const f = await tabGang(s, rueck);
      (verstoesse['H-f'] as string[]).push(...wertungFokus(f, !rueck).map((t) => `${name}${rueck ? ' (rueckwaerts)' : ''}: ${t}`));
    }
  }
  zaehler.ansichten = (zaehler.ansichten ?? 0) + 1;
}
const melde = (regeln: string[]) => {
  const alle: string[] = [];
  for (const r of regeln) {
    console.log(`handy ${r}: ${(verstoesse[r] as string[]).length} Verstoesse in ${zaehler.ansichten ?? 0} Ansichten`);
    alle.push(...(verstoesse[r] as string[]).slice(0, 30).map((t) => `${r} ${t}`));
  }
  expect(alle, alle.join('\n')).toEqual([]);
};
const leereZaehler = () => { for (const k of Object.keys(verstoesse)) verstoesse[k] = []; zaehler.ansichten = 0; };

for (const [stand, pack] of [['ohne Pack', null], ['mit Pack', PACK]] as const) {
  test(`Einstellungsseite ${stand}: H-a bis H-g in jedem Reiter bei 360, 320 und 412`, async () => {
    leereZaehler();
    await vorbereiten({ einstieg: EINSTIEG_FERTIG, ...(pack ? { pack } : {}) });
    for (const [b, h] of BREITEN) {
      const s = await fenster(b, h, false);
      await s.goto(url('options.html'));
      await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
      for (const reiter of REITER) {
        await s.locator('[role=tab]', { hasText: new RegExp(`^${reiter}$`) }).click();
        await pruefeAnsicht(s, `Optionen ${stand} ${b} ${reiter}`, { flaeche: 'optionen', zeiger: 'fein', b, h, erste: ['[role=tabpanel]:not([hidden])'], reiter });
      }
      await s.close();
    }
    melde(['H-a', 'H-b', 'H-c', 'H-d', 'H-f', 'H-g']);
  });

  test(`Interview ${stand}: H-a bis H-g auf jeder Frage und im Abschluss`, async () => {
    leereZaehler();
    await vorbereiten({ einstieg: EINSTIEG_FERTIG, ...(pack ? { pack } : {}) });
    for (const [b, h] of BREITEN) {
      const s = await fenster(b, h, false);
      await s.goto(url('willkommen.html#interview'));
      await s.waitForFunction(() => document.getElementById('schritt')?.getAttribute('data-schritt') === 'interview-1');
      for (let n = 1; n <= 8; n++) {
        await pruefeAnsicht(s, `Interview ${stand} ${b} Frage ${n}`, { flaeche: 'interview', zeiger: 'fein', b, h, erste: ['.iv-karte', '.knoepfe, .ueberspringen'] });
        const letzte = (await s.locator('#iv-weiter').innerText()) === 'Finish';
        await s.locator('#iv-weiter').click();
        if (letzte) break;
      }
      await s.locator('#ende-liste').waitFor();
      await pruefeAnsicht(s, `Interview ${stand} ${b} Abschluss`, { flaeche: 'willkommen', zeiger: 'fein', b, h });
      await s.close();
    }
    melde(['H-a', 'H-b', 'H-c', 'H-d', 'H-f', 'H-g']);
  });
}

test('Willkommensseite: Warnung, 18+ und Einwilligung bei 360, 320 und 412 (H-a bis H-f)', async () => {
  leereZaehler();
  for (const [b, h] of BREITEN) {
    await vorbereiten({});
    const s = await fenster(b, h, false);
    await s.goto(url('willkommen.html'));
    await s.locator('#warnung-ok').waitFor();
    await pruefeAnsicht(s, `Willkommen ${b} Warnung`, { flaeche: 'willkommen', zeiger: 'fein', b, h });
    await s.locator('#warnung-ok').click();
    await s.locator('#alter-ja').waitFor();
    await pruefeAnsicht(s, `Willkommen ${b} 18+`, { flaeche: 'willkommen', zeiger: 'fein', b, h });
    await s.locator('#alter-ja').click();
    await s.locator('#einwilligung-ok').waitFor();
    await pruefeAnsicht(s, `Willkommen ${b} Einwilligung`, { flaeche: 'willkommen', zeiger: 'fein', b, h });
    await s.close();
  }
  melde(['H-a', 'H-b', 'H-c', 'H-d', 'H-f']);
});

test('Popup: vier Zustaende, Maus (mindestens 24 px) und grober Zeiger (44 x 44), H-a bis H-f', async () => {
  leereZaehler();
  const web = await context.newPage();
  await web.goto(`http://127.0.0.1:${port}/hello.html`);
  for (const zustand of ['ohne-pack', 'mit-pack', 'pause', 'change-offen']) {
    await vorbereiten({ einstieg: EINSTIEG_FERTIG, ...(zustand !== 'ohne-pack' ? { pack: PACK } : {}), ...(zustand === 'pause' ? { einstellungen: { pause: true } } : {}) });
    for (const grob of [false, true]) {
      for (const [b, h] of BREITEN) {
        const s = await fenster(b, h, grob);
        await s.goto(url('popup.html'));
        await s.evaluate(() => localStorage.removeItem('veil-popup-aendern'));
        await web.bringToFront();
        await s.reload();
        await s.locator('#status').waitFor();
        await s.waitForTimeout(400);
        if (zustand === 'change-offen') { await s.locator('#aendern').click(); await s.locator('#abdeckung-gruppe').waitFor({ state: 'visible' }); }
        await pruefeAnsicht(s, `Popup ${zustand} ${grob ? 'grob' : 'Maus'} ${b}`, { flaeche: 'popup', zeiger: grob ? 'grob' : 'fein', b, h, fokus: zustand === 'change-offen' && !grob });
        await s.evaluate(() => localStorage.removeItem('veil-popup-aendern'));
        await s.close();
      }
    }
  }
  await web.close();
  melde(['H-a', 'H-b', 'H-c', 'H-d', 'H-f']);
});

test('H-e: Spur, "?"-Hilfe, Auswahlfeld und Kachel haben auf den drei Oberflaechen dasselbe Mass (grober Zeiger, 360)', async () => {
  await vorbereiten({ einstieg: EINSTIEG_FERTIG, pack: PACK });
  const web = await context.newPage();
  await web.goto(`http://127.0.0.1:${port}/hello.html`);
  const alle: Record<string, Record<string, { w: number; h: number; sel: string }[]>> = {};
  const nimm = async (s: Page, flaeche: string) => {
    await grobAn(s);
    const m = await lauf(s, 'messeHandy', MESS_SKRIPT);
    for (const art of Object.keys(m.mass)) (alle[art] ??= {})[flaeche] = [...((alle[art] ??= {})[flaeche] ?? []), ...m.mass[art]];
  };
  const o = await fenster(360, 640, true);
  await o.goto(url('options.html'));
  await o.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  for (const reiter of REITER) { await o.locator('[role=tab]', { hasText: new RegExp(`^${reiter}$`) }).click(); await o.waitForTimeout(150); await nimm(o, 'optionen'); }
  await o.close();
  const w = await fenster(360, 640, true);
  await w.goto(url('willkommen.html#interview'));
  await w.waitForFunction(() => document.getElementById('schritt')?.getAttribute('data-schritt') === 'interview-1');
  for (let n = 1; n <= 6; n++) { await w.waitForTimeout(150); await nimm(w, 'interview'); if ((await w.locator('#iv-weiter').innerText()) === 'Finish') break; await w.locator('#iv-weiter').click(); }
  await w.close();
  const p = await fenster(360, 640, true);
  await p.goto(url('popup.html'));
  await web.bringToFront();
  await p.reload();
  await p.locator('#status').waitFor();
  await p.waitForTimeout(400);
  await nimm(p, 'popup');
  await p.locator('#aendern').click();
  await p.waitForTimeout(200);
  await nimm(p, 'popup');
  await p.close();
  await web.close();
  const fehler: string[] = [];
  for (const art of ['spur', 'hilfe', 'auswahl', 'kachel']) {
    const proFlaeche = alle[art] ?? {};
    const werte = new Set<string>();
    for (const [flaeche, liste] of Object.entries(proFlaeche)) for (const e of liste) werte.add(art === 'auswahl' ? `h${e.h}` : art === 'kachel' ? `h${e.h >= 64 ? 'ok' : e.h}` : `${e.w}x${e.h}`);
    console.log(`handy H-e ${art}: ${Object.keys(proFlaeche).join(', ') || 'nirgends'}: ${[...werte].join(' ')}`);
    if (art === 'spur' || art === 'hilfe') {
      const bs = new Set<string>();
      for (const liste of Object.values(proFlaeche)) for (const e of liste) bs.add(`${e.w}x${e.h}`);
      if (bs.size > 1) fehler.push(`${art}: verschiedene Masse ${[...bs].join(', ')}: ${JSON.stringify(proFlaeche)}`);
    }
    if (art === 'auswahl') {
      const hs = new Set<number>();
      for (const liste of Object.values(proFlaeche)) for (const e of liste) hs.add(e.h);
      if (hs.size > 1 || [...hs].some((x) => x < FINGERZIEL)) fehler.push(`Auswahlfeld: Hoehen ${[...hs].join(', ')}`);
    }
    if (art === 'kachel') for (const liste of Object.values(proFlaeche)) for (const e of liste) if (e.h < FINGERZIEL + 20 - 0.5) fehler.push(`Kachel ${e.sel} nur ${e.h} px hoch`);
  }
  expect(Object.keys(alle.spur ?? {}).sort(), 'Spur auf allen drei Oberflaechen gefunden').toEqual(['interview', 'optionen', 'popup']);
  expect(Object.keys(alle.hilfe ?? {}).sort(), 'Hilfe auf allen drei Oberflaechen gefunden').toEqual(['interview', 'optionen', 'popup']);
  expect(fehler, fehler.join('\n')).toEqual([]);
});

test('J1: ein stehender Fehlersatz verdeckt nichts (320, 360, 412, 1280, Seite oben und gescrollt): Help, Pause, kleine Pause, Tab-Halte', async () => {
  await vorbereiten({ einstieg: EINSTIEG_FERTIG });
  const fehler: string[] = [];
  for (const [b, h] of [...BREITEN.map((x) => [x[0], x[1]]), [1280, 800]] as [number, number][]) {
    const s = await fenster(b, h, false);
    await s.goto(url('options.html'));
    await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
    await s.locator('[role=tab]', { hasText: /^What I cover$/ }).click();
    await s.evaluate(() => { const m = document.getElementById('speicher-meldung')!; m.hidden = false; m.textContent = 'Could not save that. Try again.'; });
    await s.waitForTimeout(400);
    for (const [name, y] of [['oben', 0], ['gescrollt 500', 500]] as const) {
      await s.evaluate((y) => window.scrollTo(0, y), y);
      await s.waitForTimeout(400);
      const p = await lauf(s, 'probeFehler', FEHLER_SKRIPT);
      fehler.push(...wertungFehler(p, y === 0).map((t) => `${b} ${name}: ${t}`));
    }
    await s.evaluate(() => window.scrollTo(0, 0));
    await s.waitForTimeout(300);
    for (const rueck of [false, true]) fehler.push(...wertungFokus(await tabGang(s, rueck), !rueck).map((t) => `${b} Tab${rueck ? ' rueckwaerts' : ''}: ${t}`));
    await s.close();
  }
  expect(fehler, fehler.slice(0, 30).join('\n')).toEqual([]);
});

test('J10 bis J12: Scrollstellen 0 bis 400 (Schritt 4): grosse oder kleine Pause bedienbar, nichts springt, H-g im Fehlerzustand', async () => {
  await vorbereiten({ einstieg: EINSTIEG_FERTIG });
  const fehler: string[] = [];
  for (const [b, h] of [...BREITEN.map((x) => [x[0], x[1]]), [1280, 800]] as [number, number][]) {
    for (const mitFehler of [false, true]) {
      const s = await fenster(b, h, false);
      await s.goto(url('options.html'));
      await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
      await s.locator('[role=tab]', { hasText: /^What I cover$/ }).click();
      if (mitFehler) await s.evaluate(() => { const m = document.getElementById('speicher-meldung')!; m.hidden = false; m.textContent = 'Could not save that. Try again.'; });
      await s.waitForTimeout(400);
      let ref: any = null;
      for (let y = 0; y <= 400; y += 4) {
        await s.evaluate((y) => window.scrollTo(0, y), y);
        await s.waitForTimeout(70);
        const p = await lauf(s, 'probeFehler', FEHLER_SKRIPT);
        ref ??= p;
        const t = wertungStelle(p);
        if (t) fehler.push(`${b} ${mitFehler ? 'mit' : 'ohne'} Fehlersatz: ${t}`);
        for (const x of wertungSprung(p, ref)) fehler.push(`${b} ${mitFehler ? 'mit' : 'ohne'} Fehlersatz: ${x}`);
        if (y === 0 && mitFehler && Math.abs(p.platz - p.kartenHoehe) > 1) fehler.push(`${b}: Platz oben ${p.platz} px, Karte ${p.kartenHoehe} px`);
      }
      if (mitFehler && (b === 360 || b === 320)) {
        for (const reiter of REITER) {
          await s.evaluate(() => window.scrollTo(0, 0));
          await s.locator('[role=tab]', { hasText: new RegExp(`^${reiter}$`) }).click();
          await s.waitForTimeout(300);
          fehler.push(...wertungFehlerHG(await lauf(s, 'probeFehler', FEHLER_SKRIPT), b).map((t) => `${b} ${reiter}: ${t}`));
        }
      }
      await s.close();
    }
  }
  expect(fehler, fehler.slice(0, 30).join('\n')).toEqual([]);
});

test('J2: die Zeile Back, Skip, Next des Interviews klebt am unteren Rand (320, 360, 412), hoechstens 72 px, Next im ersten Bildschirm', async () => {
  await vorbereiten({ einstieg: EINSTIEG_FERTIG, pack: PACK });
  const fehler: string[] = [];
  for (const [b, h] of BREITEN) {
    const s = await fenster(b, h, false);
    await s.goto(url('willkommen.html#interview'));
    await s.waitForFunction(() => document.getElementById('schritt')?.getAttribute('data-schritt') === 'interview-1');
    for (let n = 1; n <= 6; n++) {
      await s.waitForTimeout(300);
      for (const mitte of [false, true]) {
        const m = await s.evaluate((mitte) => {
          // lang: darunter endet die Seite vor der Unterkante und die Zeile liegt am natuerlichen Platz
          const z = document.querySelector('.iv-karte .knoepfe') as HTMLElement;
          const hoch = document.documentElement.scrollHeight;
          if (mitte) window.scrollTo(0, Math.max(0, (hoch - innerHeight) / 2)); else window.scrollTo(0, 0);
          return new Promise<any>((fertig) => setTimeout(() => {
            const r = z.getBoundingClientRect();
            const w = document.getElementById('iv-weiter')!.getBoundingClientRect();
            fertig({ position: getComputedStyle(z).position, hoehe: Math.round(r.height), unten: Math.round(r.bottom), fenster: innerHeight, lang: hoch > innerHeight + 300, nextOben: Math.round(w.top), nextUnten: Math.round(w.bottom) });
          }, 150));
        }, mitte);
        const name = `${b} Frage ${n}${mitte ? ' Mitte' : ' oben'}`;
        if (m.position !== 'sticky') fehler.push(`${name}: Zeile klebt nicht (${m.position})`);
        if (m.hoehe > 72) fehler.push(`${name}: Zeile ${m.hoehe} px hoch`);
        if (!(m.nextOben >= 0 && m.nextUnten <= m.fenster)) fehler.push(`${name}: Next nicht im Fenster (${m.nextOben} bis ${m.nextUnten} von ${m.fenster})`);
        if (m.lang && Math.abs(m.unten - m.fenster) > 1) fehler.push(`${name}: Unterkante der Zeile ${m.unten}, Fenster ${m.fenster}`);
      }
      if ((await s.locator('#iv-weiter').innerText()) === 'Finish') break;
      await s.locator('#iv-weiter').click();
    }
    await s.close();
  }
  expect(fehler, fehler.slice(0, 30).join('\n')).toEqual([]);
});

test('J5: Einstellungsseite und Interview bei 360 auch mit grobem Zeiger (H-a bis H-d, H-g)', async () => {
  leereZaehler();
  await vorbereiten({ einstieg: EINSTIEG_FERTIG, pack: PACK });
  const s = await fenster(360, 640, true);
  await s.goto(url('options.html'));
  await grobAn(s);
  await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  for (const reiter of REITER) {
    await s.locator('[role=tab]', { hasText: new RegExp(`^${reiter}$`) }).click();
    await pruefeAnsicht(s, `Optionen grob 360 ${reiter}`, { flaeche: 'optionen', zeiger: 'grob', b: 360, h: 640, erste: ['[role=tabpanel]:not([hidden])'], reiter, fokus: false });
  }
  await s.goto(url('willkommen.html#interview'));
  await grobAn(s);
  await s.waitForFunction(() => document.getElementById('schritt')?.getAttribute('data-schritt') === 'interview-1');
  for (let n = 1; n <= 8; n++) {
    await pruefeAnsicht(s, `Interview grob 360 Frage ${n}`, { flaeche: 'interview', zeiger: 'grob', b: 360, h: 640, erste: ['.iv-karte', '.knoepfe, .ueberspringen'], fokus: false });
    const letzte = (await s.locator('#iv-weiter').innerText()) === 'Finish';
    await s.locator('#iv-weiter').click();
    if (letzte) break;
  }
  await s.close();
  melde(['H-a', 'H-b', 'H-c', 'H-d', 'H-g']);
});

test('G3: bei 360 steht "HYPNOMIA VEIL" in einer Zeile neben "Help", der Name des Stils senkrecht mittig neben der Kachel (Einstellungsseite und Interview)', async () => {
  await vorbereiten({ einstieg: EINSTIEG_FERTIG });
  const s = await fenster(360, 640, false);
  await s.goto(url('options.html'));
  await s.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  await s.waitForTimeout(300);
  const m = await s.evaluate(() => {
    const h1 = document.querySelector('header h1')!;
    const r = document.createRange();
    r.selectNodeContents(h1);
    const zeilen = new Set([...r.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5).map((q) => Math.round(q.top / 3))).size;
    const k = document.querySelector('#vorschau-spalte .v-vorschau-rahmen')!.getBoundingClientRect();
    const e = document.querySelector('#vorschau-spalte .v-vorschau-etikett')!.getBoundingClientRect();
    return { zeilen, hoehe: h1.getBoundingClientRect().height, versatz: Math.abs(k.top + k.height / 2 - (e.top + e.height / 2)) };
  });
  expect(m.zeilen, 'Marke einzeilig').toBe(1);
  expect(m.versatz, 'Etikett mittig neben der Kachel').toBeLessThanOrEqual(2);
  await s.goto(url('willkommen.html#interview'));
  await s.waitForFunction(() => document.getElementById('schritt')?.getAttribute('data-schritt') === 'interview-1');
  await s.waitForTimeout(300);
  const v = await s.evaluate(() => {
    const k = document.querySelector('.iv-vorschau .v-vorschau-rahmen')!.getBoundingClientRect();
    const e = document.querySelector('.iv-vorschau .v-vorschau-etikett')!.getBoundingClientRect();
    return Math.abs(k.top + k.height / 2 - (e.top + e.height / 2));
  });
  expect(v, 'Etikett mittig neben der Kachel im Interview').toBeLessThanOrEqual(2);
  await s.close();
});

test('Ausnahmen zu H-b stehen nur in der Liste von handy-mess.mjs', async () => {
  console.log(`handy: ${AUSNAHMEN_H_B.length} Ausnahmen zu H-b`);
  expect(Array.isArray(AUSNAHMEN_H_B)).toBe(true);
});
