// Chromium: Komplett-Ersatz als Galerie in der Seite (Auftrag G, Entscheidung 107). Keine Umleitung, keine Erweiterungsseite fuer Webseiten.
// Die Testdomains loest `--host-resolver-rules` auf den Testserver auf. Ein Waechter in der Testseite (tests/fixtures/ersatz-waechter.js)
// beweist, dass der Seiteninhalt unter der Verdeckung nie sichtbar war. Nur synthetische Bilder.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const LISTE = `http://pornhub.veil-erwachsen.test:${port}/ersatz.html`;
const LISTE2 = `http://xhamster.veil-erwachsen.test:${port}/ersatz.html?a=1&b=2`;
const EIGEN = `http://eigen.test:${port}/ersatz.html`;
const NEUTRAL = `http://127.0.0.1:${port}/ersatz.html`;
const LINKSEITE = `http://127.0.0.1:${port}/ersatz-link.html`;
const INHALT = `http://127.0.0.1:${port}/erwachsen-inhalt.html`;
const DUMMY_VORSCHAU = 4;

interface PackBau {
  baueDummyPack(opts?: { ohnePhase4?: boolean }): Promise<{ bytes: Uint8Array }>;
}
const bauModul = '../../scripts/pack/baue-pack.mjs';
const ladeBau = async (): Promise<PackBau> => (await import(bauModul)) as PackBau;

test.describe.configure({ mode: 'serial' });

let profil: string;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let ext: Page;
let erweiterungsId = '';

async function setze(teil: { pause?: boolean; an?: boolean; komplettErsatz?: boolean; eigeneSeiten?: string[]; ausnahmen?: string[]; erkennenAmInhalt?: boolean }): Promise<void> {
  await ext.evaluate(async (t) => {
    const api = (globalThis as any).chrome;
    const alt = ((await api.storage.local.get('einstellungen')).einstellungen ?? {}) as any;
    const neu = { ...alt, erwachsen: { ...(alt.erwachsen ?? {}) } };
    if (t.pause !== undefined) neu.pause = t.pause;
    if (t.an !== undefined) neu.erwachsen.an = t.an;
    if (t.komplettErsatz !== undefined) neu.erwachsen.komplettErsatz = t.komplettErsatz;
    if (t.erkennenAmInhalt !== undefined) neu.erwachsen.erkennenAmInhalt = t.erkennenAmInhalt;
    if (t.eigeneSeiten) neu.erwachsen.eigeneSeiten = t.eigeneSeiten;
    if (t.ausnahmen) neu.ausnahmen = t.ausnahmen;
    await api.storage.local.set({ einstellungen: neu });
  }, teil);
}

interface Abbild {
  popoverOffen: boolean;
  titel: string;
  bilder: number;
  breiten: number[];
  chibi: boolean;
  links: { text: string; href: string | null; target: string; rel: string }[];
  zeile: string | null;
  pause: { x: number; y: number; w: number; h: number };
  ruhe: { x: number; y: number; w: number; h: number };
  host: { x: number; y: number; w: number; h: number };
}
const abbild = (p: Page): Promise<Abbild | null> =>
  p.evaluate(() => {
    const t = document.documentElement.getAttribute('data-veil-ersatz-abbild');
    return t ? (JSON.parse(t) as Abbild) : null;
  });
const hatAttr = (p: Page): Promise<boolean> => p.evaluate(() => document.documentElement.hasAttribute('data-veil-ersatz'));
const hostDa = (p: Page): Promise<boolean> => p.evaluate(() => !!document.querySelector('[data-veil-ersatz-host]'));
async function warteGalerie(p: Page): Promise<Abbild> {
  await expect.poll(async () => ((await abbild(p))?.breiten ?? []).filter((b) => b > 0).length, { timeout: 15_000, intervals: [50] }).toBe(DUMMY_VORSCHAU);
  return (await abbild(p))!;
}
async function warteOhneGalerie(p: Page): Promise<void> {
  await expect.poll(async () => !(await hatAttr(p)) && !(await hostDa(p)), { timeout: 10_000, intervals: [25] }).toBe(true);
}
const waechter = (p: Page) => p.evaluate(() => (window as any).__e as { proben: number; sichtbarMitAttr: number; hgFalsch: number; ohneAttr: number; wechsel: [string, number][]; ersteProbeMitAttr: boolean | null });

async function oeffne(adresse: string): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(adresse, { waitUntil: 'domcontentloaded' });
  return seite;
}

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-ersatz-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ersatz-datei-'));
  packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await (await ladeBau()).baueDummyPack()).bytes);
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${erweiterung}`,
      `--load-extension=${erweiterung}`,
      '--host-resolver-rules=MAP *.veil-erwachsen.test 127.0.0.1, MAP eigen.test 127.0.0.1',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
  ext = await context.newPage();
  await ext.goto(`chrome-extension://${erweiterungsId}/options.html`);
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

test('Manifest ohne web_accessible_resources, Referer-Recht bleibt', async () => {
  const m = JSON.parse(await readFile(path.join(erweiterung, 'manifest.json'), 'utf8'));
  expect(m.web_accessible_resources).toBeUndefined();
  expect(m.permissions).toContain('declarativeNetRequestWithHostAccess');
  // Keine Erweiterungsseite fuer die Galerie mehr.
  const r = await ext.evaluate(async (id) => {
    try {
      return (await fetch(`chrome-extension://${id}/galerie.html`)).status;
    } catch {
      return 0; // nicht abrufbar
    }
  }, erweiterungsId);
  expect([0, 404]).toContain(r);
});

test('ohne Pack: keine Galerie und keine bleibende Verdeckung; Dauer der Verdeckung', async () => {
  await setze({ komplettErsatz: true });
  const seite = await oeffne(LISTE);
  try {
    await warteOhneGalerie(seite);
    expect(await abbild(seite)).toBeNull();
    const w = await waechter(seite);
    const t = await seite.evaluate(() => ({ t0: (window as any).__t0 as number, hat0: (window as any).__hat0 as boolean }));
    const aus = w.wechsel.find((x) => x[0] === 'aus');
    // Das Attribut stand beim ersten Skript des Kopfes (hat0) und fiel nach Laden von Einstellungen und Pack; Zeit ab diesem Skript.
    // Schneller als das erste Kopf-Skript: dann war die Verdeckung schon vorbei (Obergrenze ist die Zeit des Skripts ab Navigationsbeginn).
    const ms = aus ? Math.round((aus[1] - t.t0) * 10) / 10 : Math.round(t.t0 * 10) / 10;
    console.log(`chromium: Listen-Seite ohne Pack: Verdeckung ${t.hat0 ? 'ab Kopf-Skript' : 'schon vor dem Kopf-Skript vorbei, Obergrenze ab Navigationsbeginn'} ${ms} ms`);
    expect(t.hat0 ? !!aus : true).toBe(true);
    expect(ms).toBeLessThan(100);
    expect(await seite.evaluate(() => getComputedStyle(document.getElementById('inhalt')!).visibility)).toBe('visible');
  } finally {
    await seite.close();
  }
  await setze({ komplettErsatz: false });
});

test('Pack importiert, Schalter aus: keine Galerie', async () => {
  await ext.locator('#datei').setInputFiles(packPfad);
  await ext.locator('#annehmen').click();
  await expect(ext.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
  const seite = await oeffne(LISTE);
  try {
    await warteOhneGalerie(seite);
    expect(await abbild(seite)).toBeNull();
  } finally {
    await seite.close();
  }
});

test('Schalter an: Galerie ueber der Seite, Seiteninhalt nie sichtbar, Seite nicht scrollbar, Audio stumm', async () => {
  await setze({ komplettErsatz: true });
  const kontrolle = await oeffne(NEUTRAL);
  try {
    // Gegenprobe: auf einer unbekannten Seite spielt das Audio wirklich (sonst waere "stumm" wertlos).
    await expect.poll(() => kontrolle.evaluate(() => (window as any).__spielt()), { timeout: 8000 }).toBe(true);
    expect(await hatAttr(kontrolle)).toBe(false);
  } finally {
    await kontrolle.close();
  }
  const seite = await oeffne(LISTE2);
  try {
    const a = await warteGalerie(seite);
    expect(a.popoverOffen).toBe(true);
    expect(a.titel).toBe('Test greeting line.'); // Begruessung aus den Pack-Texten (Dummy-Pack)
    expect(a.links.map((l) => l.text)).toEqual(['Patreon', 'SubscribeStar']);
    expect(a.links[0]!.href).toMatch(/^https:\/\/www\.patreon\.com\//);
    expect(a.links[1]!.href).toMatch(/^https:\/\/subscribestar\./);
    for (const l of a.links) {
      expect(l.target).toBe('_blank');
      expect(l.rel).toBe('noopener noreferrer');
    }
    expect(a.zeile).toBe('xhamster.veil-erwachsen.test is right behind me.');
    // Session 16 (Live-Lauf: Mia-Patches auf Mias eigenen Galerie-Bildern): der Schleier laesst die Bilder der Galerie in Ruhe.
    await new Promise((r) => setTimeout(r, 2500));
    // Zaehler aus schleier.ts (Testbau): Versuche, ein Element in einer eigenen Wurzel zu entdecken. Ohne die Sperre im Beobachter > 0.
    expect(await seite.evaluate(() => Number(document.documentElement.getAttribute('data-veil-eigene-entdeckt') ?? 0)), 'Galerie-Bilder vom Schleier entdeckt').toBe(0);
    const gross = seite.viewportSize()!;
    expect(a.host.w).toBe(gross.width);
    expect(a.host.h).toBe(gross.height);
    // Der Waechter: die Seite war von der ersten Probe an verdeckt, nie sichtbar.
    const w = await waechter(seite);
    expect(w.proben).toBeGreaterThan(5);
    expect(w.ersteProbeMitAttr).toBe(true);
    expect({ sichtbar: w.sichtbarMitAttr, hg: w.hgFalsch, ohne: w.ohneAttr }).toEqual({ sichtbar: 0, hg: 0, ohne: 0 });
    // Oberste Ebene: an jedem Punkt liegt der Host oben, die Seite hat keinen Zugriff darauf.
    expect(await seite.evaluate(() => document.elementFromPoint(50, 50)?.hasAttribute('data-veil-ersatz-host'))).toBe(true);
    // Scrollen der Seite gesperrt.
    await seite.mouse.wheel(0, 800);
    await seite.keyboard.press('PageDown');
    await seite.keyboard.press('End');
    expect(await seite.evaluate(() => window.scrollY)).toBe(0);
    // Audio der Seite: wird jede Viertelsekunde neu angestossen und bleibt trotzdem angehalten und stumm.
    for (let i = 0; i < 6; i++) {
      expect(await seite.evaluate(() => (window as any).__spielt())).toBe(false);
      expect(await seite.evaluate(() => (document.getElementById('ton') as HTMLAudioElement).muted)).toBe(true);
      await seite.waitForTimeout(250);
    }
    // Pause: Klick auf den Knopf.
    const t0 = Date.now();
    await seite.mouse.click(a.pause.x + a.pause.w / 2, a.pause.y + a.pause.h / 2);
    await warteOhneGalerie(seite);
    console.log(`chromium: Pause in der Galerie bis Seite sichtbar ${Date.now() - t0} ms`);
    expect(await seite.evaluate(() => getComputedStyle(document.getElementById('inhalt')!).visibility)).toBe('visible');
    expect(await seite.evaluate(() => window.getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
    // Ton-Zustand zurueck.
    expect(await seite.evaluate(() => (document.getElementById('ton') as HTMLAudioElement).muted)).toBe(false);
    const pause = await ext.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen ?? {}).pause);
    expect(pause).toBe(true);
    // Die Seite wurde nie umgeleitet.
    expect(seite.url()).toBe(LISTE2);
  } finally {
    await seite.close();
  }
});

const zaehlerSeite = (p: Page) => p.evaluate(() => (window as any).__k as Record<string, number>);
const tabStumm = (adresse: string): Promise<boolean | null> =>
  ext.evaluate(async (u) => {
    const tabs = await (globalThis as any).chrome.tabs.query({});
    const t = tabs.find((x: any) => x.url === u);
    return t ? t.mutedInfo?.muted === true : null;
  }, adresse);
const tabIdVon = (adresse: string): Promise<number> =>
  ext.evaluate(async (u) => ((await (globalThis as any).chrome.tabs.query({})).find((x: any) => x.url === u)).id, adresse);

// Session 17 (Testluecke UEBERGABE-16 Punkt 4): die zweite Sperre in `entdecke` allein. Der Testbau laesst den Beobachter eigene Wurzeln
// betreten, wenn die Seitenadresse `veil-eigene-offen` enthaelt; dann muss jeder Versuch an der zweiten Sperre enden (Zaehler steigt).
// Gegenprobe zum Test davor (dort 0 Versuche, weil schon der Beobachter sperrt).
test('zweite Sperre: auch wenn der Beobachter eigene Wurzeln betritt, prueft der Schleier Mias Galerie-Bilder nie', async () => {
  await setze({ pause: false }); // der Test davor endet mit Pause aus der Galerie
  const seite = await context.newPage();
  await seite.goto(`${LISTE}?veil-eigene-offen=1`, { waitUntil: 'domcontentloaded' });
  try {
    // Ohne die erste Sperre legt der Beobachter seine Versteck-Regel auch in die Galerie-Wurzel (Breiten bleiben 0): nur auf die Galerie selbst
    // warten. Die zweite Sperre verhindert das Pruefen und Ersetzen der Bilder, nicht diese Regel; darum bleibt die erste Sperre die Hauptsache.
    await expect.poll(() => abbild(seite), { timeout: 15_000 }).not.toBeNull();
    await expect
      .poll(() => seite.evaluate(() => Number(document.documentElement.getAttribute('data-veil-eigene-entdeckt') ?? 0)), { timeout: 8000 })
      .toBeGreaterThan(0);
    const n = await seite.evaluate(() => Number(document.documentElement.getAttribute('data-veil-eigene-entdeckt') ?? 0));
    console.log(`ersatz: zweite Sperre hielt ${n} Versuche auf`);
  } finally {
    await seite.close();
  }
});

test('Klicks und Tasten in der Galerie erreichen die Seite nie, auch nicht der Klick auf Pause', async () => {
  await setze({ pause: false });
  const seite = await oeffne(LISTE);
  try {
    const a = await warteGalerie(seite);
    await seite.mouse.click(30, 30);
    await seite.mouse.dblclick(40, 40);
    await seite.mouse.click(30, 30, { button: 'right' });
    await seite.keyboard.press('f');
    await seite.keyboard.press('Space');
    await seite.keyboard.press('Enter');
    expect(await zaehlerSeite(seite)).toEqual({});
    // Eine von der Seite erzeugte Ereignisfolge am Host wird gestoppt und loest keine Pause aus.
    await seite.evaluate(() => document.querySelector('[data-veil-ersatz-host]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
    expect(await hostDa(seite)).toBe(true);
    await seite.mouse.click(a.pause.x + a.pause.w / 2, a.pause.y + a.pause.h / 2);
    await warteOhneGalerie(seite);
    // Der Klick auf Pause kam bei der Seite nicht an (die eine Zahl ist das von der Seite selbst erzeugte Ereignis).
    const k = await zaehlerSeite(seite);
    expect(Object.keys(k).filter((t) => t !== 'click' && t !== 'clickW')).toEqual([]);
    expect((k.click ?? 0)).toBeLessThanOrEqual(0);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
});

test('Leave this site alone: leiser Knopf neben Pause traegt den Host in die Ausnahmen ein und laedt neu; ohne Pause, ohne Galerie danach', async () => {
  await setze({ pause: false, ausnahmen: [] });
  const seite = await oeffne(LISTE);
  try {
    const a = await warteGalerie(seite);
    expect(a.ruhe.h, 'Knopf mindestens 44 px hoch').toBeGreaterThanOrEqual(44);
    expect(a.ruhe.w).toBeGreaterThan(80);
    // Pause bleibt oben und gleichwertig erreichbar
    expect(a.pause.y).toBeLessThan(120);
    const klicks = await zaehlerSeite(seite);
    expect(klicks).toEqual({});
    await seite.evaluate(() => ((window as any).__vorher = 1));
    await seite.mouse.click(a.ruhe.x + a.ruhe.w / 2, a.ruhe.y + a.ruhe.h / 2);
    await expect
      .poll(async () => ext.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen?.ausnahmen ?? []) as string[]), { timeout: 10_000 })
      .toContain(new URL(LISTE).hostname.replace(/^www\./, ''));
    // Neu geladen (die Marke von vorher ist weg) und ohne Galerie
    await expect
      .poll(async () => seite.evaluate(() => (window as any).__vorher === undefined && !document.documentElement.hasAttribute('data-veil-ersatz') && !document.querySelector('[data-veil-ersatz-host]')).catch(() => false), { timeout: 10_000, intervals: [50] })
      .toBe(true);
    // Der Knopf pausiert nicht
    expect(await ext.evaluate(async () => !!(await (globalThis as any).chrome.storage.local.get('einstellungen')).einstellungen?.pause)).toBe(false);
  } finally {
    await seite.close();
  }
  await setze({ pause: false, ausnahmen: [] });
});

test('Dialog, Popover und Vollbild der Seite legen sich nicht ueber die Galerie', async () => {
  const seite = await oeffne(LISTE);
  try {
    const a = await warteGalerie(seite);
    const oben = () => seite.evaluate(() => document.elementFromPoint(50, 50)?.hasAttribute('data-veil-ersatz-host') === true);
    // Modaler Dialog: wird geschlossen (sonst waere die Galerie inert)
    await seite.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).showModal());
    await expect.poll(() => seite.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).open), { timeout: 5000 }).toBe(false);
    expect(await oben()).toBe(true);
    // Popover der Seite: die Galerie kommt wieder nach oben
    await seite.evaluate(() => document.getElementById('pp')!.showPopover());
    await expect.poll(oben, { timeout: 5000, intervals: [50] }).toBe(true);
    expect(await seite.evaluate(() => document.querySelector('[data-veil-ersatz-host]')!.matches(':popover-open'))).toBe(true);
    await seite.evaluate(() => document.getElementById('pp')!.hidePopover());
    // Vollbild (nicht jeder Lauf darf es ohne Nutzergeste): wenn es klappt, muss es enden
    const vollbild = await seite.evaluate(() => document.documentElement.requestFullscreen().then(() => true, () => false));
    if (vollbild) await expect.poll(() => seite.evaluate(() => document.fullscreenElement === null), { timeout: 5000 }).toBe(true);
    console.log(`chromium: Vollbild der Seite ${vollbild ? 'ging auf und wurde beendet' : 'ohne Nutzergeste nicht moeglich'}`);
    // Die Galerie bleibt bedienbar: Pause per Klick
    await seite.mouse.click(a.pause.x + a.pause.w / 2, a.pause.y + a.pause.h / 2);
    await warteOhneGalerie(seite);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
});

test('modaler Dialog in einer Shadow Root der Seite wird geschlossen', async () => {
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    const oben = () => seite.evaluate(() => document.elementFromPoint(50, 50)?.hasAttribute('data-veil-ersatz-host') === true);
    await seite.evaluate(() => {
      const h = document.createElement('div');
      h.id = 'wurzel-host';
      const w = h.attachShadow({ mode: 'open' });
      w.innerHTML = '<dialog id="sd">Dialog in der Wurzel</dialog>';
      document.body.appendChild(h);
    });
    await seite.waitForTimeout(100);
    await seite.evaluate(() => (document.getElementById('wurzel-host')!.shadowRoot!.getElementById('sd') as HTMLDialogElement).showModal());
    await expect
      .poll(() => seite.evaluate(() => (document.getElementById('wurzel-host')!.shadowRoot!.getElementById('sd') as HTMLDialogElement).open), { timeout: 5000 })
      .toBe(false);
    expect(await oben()).toBe(true);
  } finally {
    await seite.close();
  }
});

test('Wurzelelement ausgetauscht (document.open) und Aenderungen am Host: die Galerie kommt zurueck', async () => {
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    // Host von der Seite angefasst: Popover schliessen, Stil ueberschreiben, Popover-Attribut entfernen
    await seite.evaluate(() => (document.querySelector('[data-veil-ersatz-host]') as HTMLElement).hidePopover());
    await expect.poll(() => seite.evaluate(() => document.querySelector('[data-veil-ersatz-host]')!.matches(':popover-open')), { timeout: 5000 }).toBe(true);
    await seite.evaluate(() => ((document.querySelector('[data-veil-ersatz-host]') as HTMLElement).style.cssText = 'display: none'));
    await expect.poll(() => seite.evaluate(() => getComputedStyle(document.querySelector('[data-veil-ersatz-host]')!).display), { timeout: 5000 }).toBe('block');
    await seite.evaluate(() => document.querySelector('[data-veil-ersatz-host]')!.removeAttribute('popover'));
    await expect.poll(() => seite.evaluate(() => document.querySelector('[data-veil-ersatz-host]')?.getAttribute('popover') ?? null), { timeout: 5000 }).toBe('manual');
    // Host entfernt
    await seite.evaluate(() => document.querySelector('[data-veil-ersatz-host]')!.remove());
    await expect.poll(() => hostDa(seite), { timeout: 5000 }).toBe(true);
    // Wurzelelement ausgetauscht
    await seite.evaluate(() => {
      document.open();
      document.write('<!doctype html><html><head><title>neu</title></head><body><h1 id="inhalt">Neu gerendert</h1></body></html>');
      document.close();
    });
    await expect.poll(async () => (await hatAttr(seite)) && (await hostDa(seite)), { timeout: 5000, intervals: [50] }).toBe(true);
    expect(await seite.evaluate(() => document.documentElement.getAttribute('data-veil-ersatz'))).toBe('galerie');
    expect(await seite.evaluate(() => getComputedStyle(document.getElementById('inhalt')!).visibility)).toBe('hidden');
    // Und die Galerie ist danach bedienbar (Schutz neu installiert, Pause per Klick)
    await expect.poll(async () => (await abbild(seite))?.pause.w ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
    const a = (await abbild(seite))!;
    await seite.mouse.click(a.pause.x + a.pause.w / 2, a.pause.y + a.pause.h / 2);
    await warteOhneGalerie(seite);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
});

test('Tab ist stumm, solange die Galerie steht; der Stand davor kommt zurueck', async () => {
  await setze({ pause: true });
  const seite = await oeffne(LISTE);
  try {
    await warteOhneGalerie(seite);
    expect(await tabStumm(LISTE)).toBe(false);
    await setze({ pause: false });
    await warteGalerie(seite);
    await expect.poll(() => tabStumm(LISTE), { timeout: 5000 }).toBe(true);
    await setze({ pause: true });
    await warteOhneGalerie(seite);
    await expect.poll(() => tabStumm(LISTE), { timeout: 5000 }).toBe(false);
    // Tab war schon stumm: bleibt es
    const id = await tabIdVon(LISTE);
    await ext.evaluate((i) => (globalThis as any).chrome.tabs.update(i, { muted: true }), id);
    await setze({ pause: false });
    await warteGalerie(seite);
    await setze({ pause: true });
    await warteOhneGalerie(seite);
    await new Promise((r) => setTimeout(r, 500));
    expect(await tabStumm(LISTE)).toBe(true);
    await ext.evaluate((i) => (globalThis as any).chrome.tabs.update(i, { muted: false }), id);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
});

test('Seite mit Galerie ohne Pause verlassen (Adresse): der Tab ist danach nicht mehr stumm', async () => {
  await setze({ pause: false });
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    await expect.poll(() => tabStumm(LISTE), { timeout: 5000 }).toBe(true);
    await seite.goto(NEUTRAL, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => tabStumm(NEUTRAL), { timeout: 5000 }).toBe(false);
    // und von einer Galerie-Seite zur naechsten bleibt der Ton-Stand heil: Pause, dann pruefen
    await seite.goto(LISTE2, { waitUntil: 'domcontentloaded' });
    await warteGalerie(seite);
    await expect.poll(() => tabStumm(LISTE2), { timeout: 5000 }).toBe(true);
    await setze({ pause: true });
    await expect.poll(() => tabStumm(LISTE2), { timeout: 5000 }).toBe(false);
  } finally {
    await seite.close();
  }
  await setze({ pause: false });
});

test('Pause von aussen: Galerie sofort weg; Ende der Pause: sie kommt wieder', async () => {
  await setze({ pause: false });
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    const t0 = Date.now();
    await setze({ pause: true });
    await warteOhneGalerie(seite);
    console.log(`chromium: Pause von aussen bis Galerie weg ${Date.now() - t0} ms`);
    await setze({ pause: false });
    await warteGalerie(seite);
  } finally {
    await seite.close();
  }
});

test('Schalter aus und an bei offener Seite; Pornoseiten-Modus aus', async () => {
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    await setze({ komplettErsatz: false });
    await warteOhneGalerie(seite);
    await setze({ komplettErsatz: true });
    await warteGalerie(seite);
    await setze({ an: false });
    await warteOhneGalerie(seite);
    await setze({ an: true });
    await warteGalerie(seite);
  } finally {
    await seite.close();
  }
});

test('Blitz-Grenze: schnelles Umschalten ergibt hoechstens 3 vollflaechige Wechsel je Sekunde', async () => {
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    await seite.evaluate(() => {
      const z: [string, number][] = ((window as any).__host = []);
      new MutationObserver((l) => {
        for (const m of l) {
          for (const n of [...m.addedNodes]) if ((n as Element).hasAttribute?.('data-veil-ersatz-host')) z.push(['an', performance.now()]);
          for (const n of [...m.removedNodes]) if ((n as Element).hasAttribute?.('data-veil-ersatz-host')) z.push(['aus', performance.now()]);
        }
      }).observe(document.documentElement, { childList: true });
    });
    for (let i = 0; i < 10; i++) {
      await setze({ komplettErsatz: i % 2 === 1 });
      await seite.waitForTimeout(190); // 10 Umschaltungen in etwa 2 s
    }
    await setze({ komplettErsatz: true });
    await warteGalerie(seite);
    await seite.waitForTimeout(1500);
    const z = await seite.evaluate(() => (window as any).__host as [string, number][]);
    expect(z.length).toBeGreaterThan(1);
    const zeiten = z.map((x) => x[1]);
    let hoechst = 0;
    for (const t of zeiten) hoechst = Math.max(hoechst, zeiten.filter((u) => u >= t && u < t + 1000).length);
    // Mit Abstand: auch in 1,25-s-Fenstern (Zeichenverzug des Browsers) kommen hoechstens 3 Wechsel vor.
    let hoechst125 = 0;
    for (const t of zeiten) hoechst125 = Math.max(hoechst125, zeiten.filter((u) => u >= t && u < t + 1250).length);
    console.log(`chromium: Wechsel der Galerie ${z.length}, hoechstens ${hoechst} je 1-s-Fenster, hoechstens ${hoechst125} je 1,25-s-Fenster`);
    expect(hoechst).toBeLessThanOrEqual(3);
    expect(hoechst125).toBeLessThanOrEqual(3);
    // Das Ende steht: Galerie da.
    expect(await hostDa(seite)).toBe(true);
  } finally {
    await seite.close();
  }
});

test('eigene Ausnahme: keine Galerie, keine bleibende Verdeckung', async () => {
  await setze({ ausnahmen: ['pornhub.veil-erwachsen.test'] });
  const seite = await oeffne(LISTE);
  try {
    await warteOhneGalerie(seite);
    expect(await abbild(seite)).toBeNull();
    expect((await waechter(seite)).sichtbarMitAttr).toBe(0);
  } finally {
    await seite.close();
  }
  const andere = await oeffne(LISTE2);
  try {
    await warteGalerie(andere);
  } finally {
    await andere.close();
  }
  await setze({ ausnahmen: [] });
});

test('eigene Seite bekommt die Galerie (auch in Chrome); ohne Eintrag nicht', async () => {
  const ohne = await oeffne(EIGEN);
  try {
    await warteOhneGalerie(ohne);
    const w = await waechter(ohne);
    expect(w.ersteProbeMitAttr).toBe(false); // eigene Seiten sind erst nach dem Laden bekannt, vorher keine Verdeckung
  } finally {
    await ohne.close();
  }
  await setze({ eigeneSeiten: ['eigen.test'] });
  const mit = await oeffne(EIGEN);
  try {
    await warteGalerie(mit);
    expect((await waechter(mit)).sichtbarMitAttr).toBe(0);
    // Ab dort verdeckt: Seite gibt es erst wieder bei Pause.
    await setze({ pause: true });
    await warteOhneGalerie(mit);
    await setze({ pause: false });
  } finally {
    await mit.close();
  }
  // Eintrag entfernt: wieder keine Galerie.
  await setze({ eigeneSeiten: [] });
  const weg = await oeffne(EIGEN);
  try {
    await warteOhneGalerie(weg);
  } finally {
    await weg.close();
  }
});

test('am Inhalt erkannte Seite bekommt nie die Galerie', async () => {
  await setze({ erkennenAmInhalt: true });
  const seite = await oeffne(INHALT);
  try {
    await seite.waitForTimeout(1500);
    expect(await hatAttr(seite)).toBe(false);
    expect(await hostDa(seite)).toBe(false);
  } finally {
    await seite.close();
  }
  await setze({ erkennenAmInhalt: false });
});

test('Link von einer fremden Seite auf eine Listen-Domain zeigt die Galerie statt einer Fehlerseite', async () => {
  const fremd = await oeffne(LINKSEITE);
  try {
    await fremd.evaluate((u) => ((document.getElementById('l') as HTMLAnchorElement).href = u), LISTE);
    await fremd.click('#l');
    await expect.poll(() => fremd.url(), { timeout: 10_000 }).toBe(LISTE);
    await warteGalerie(fremd);
    expect(fremd.url()).toBe(LISTE);
  } finally {
    await fremd.close();
  }
});

test('Rahmen (iframe) auf einer Listen-Domain bekommt nie eine Galerie', async () => {
  const seite = await oeffne(NEUTRAL);
  try {
    await seite.evaluate((u) => {
      const f = document.createElement('iframe');
      f.id = 'rahmen';
      f.src = u;
      document.body.append(f);
    }, LISTE);
    await seite.waitForTimeout(1500);
    const rahmen = seite.frames().find((f) => f.url() === LISTE);
    expect(rahmen).toBeTruthy();
    expect(await rahmen!.evaluate(() => document.documentElement.hasAttribute('data-veil-ersatz') || !!document.querySelector('[data-veil-ersatz-host]'))).toBe(false);
    expect(await hatAttr(seite)).toBe(false);
  } finally {
    await seite.close();
  }
});

test('Pack entfernen: Galerie sofort weg', async () => {
  const seite = await oeffne(LISTE);
  try {
    await warteGalerie(seite);
    await ext.goto(`chrome-extension://${erweiterungsId}/options.html`);
    await ext.locator('#entfernen').click();
    await ext.locator('#entfernen-ja').click();
    await expect(ext.locator('#pack-status')).toContainText('No pack yet');
    await warteOhneGalerie(seite);
  } finally {
    await seite.close();
  }
});

test('eine alte Umleitungsregel aus 0.4.0 wird beim Aufwachen des Hintergrunds entfernt', async () => {
  await ext.goto(`chrome-extension://${erweiterungsId}/options.html`);
  await ext.evaluate(async (ziel) => {
    const api = (globalThis as any).chrome;
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{ id: 1, priority: 1, action: { type: 'redirect', redirect: { url: ziel } }, condition: { requestDomains: ['nirgendwo.test'], resourceTypes: ['main_frame'] } }],
    });
  }, NEUTRAL);
  const anzahl = () => ext.evaluate(async () => (await (globalThis as any).chrome.declarativeNetRequest.getDynamicRules()).length);
  expect(await anzahl()).toBe(1);
  // Hintergrund schlafen legen und per Nachricht wecken: jeder Start raeumt auf.
  const cdp = await context.newCDPSession(ext);
  const stati = new Map<string, string>();
  cdp.on('ServiceWorker.workerVersionUpdated', (e: any) => {
    for (const v of e.versions) stati.set(v.versionId, v.runningStatus);
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => stati.size, { timeout: 5_000 }).toBeGreaterThan(0);
  await cdp.send('ServiceWorker.stopAllWorkers').catch(() => undefined);
  await expect.poll(() => [...stati.values()].every((s) => s === 'stopped'), { timeout: 10_000 }).toBe(true);
  await ext.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }).catch(() => undefined));
  await expect.poll(anzahl, { timeout: 10_000, intervals: [100] }).toBe(0);
  await cdp.detach().catch(() => undefined);
});
