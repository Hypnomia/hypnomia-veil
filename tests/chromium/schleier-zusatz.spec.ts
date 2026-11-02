import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Schleier-Zusatztests (PHASE-2-BAUPLAN 9.6): Adresswechsel in Einzelseiten-Apps, Testhaken "Freigabe sperren",
// blob:- und about:blank-Rahmen (match_about_blank, match_origin_as_fallback).

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;

interface Status {
  gesamt: number;
  offen: number;
  frei: number;
  zensiert: number;
  verdeckt: number;
}

let profil: string;
let context: BrowserContext;
let worker: Worker;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-zusatz-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${erweiterung}`,
      `--load-extension=${erweiterung}`,
      // Testnamen auf 127.0.0.1 abbilden: fuer die Erweiterung sind es oeffentliche Namen (Netzgrenze-Tests mit Weiterleitungen).
      '--host-resolver-rules=MAP oeffentlich.test 127.0.0.1, MAP bilder.test 127.0.0.1',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

test.beforeEach(async () => {
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.remove('einstellungen');
  });
});

async function status(seite: Page): Promise<Status | null> {
  return seite.evaluate(() => {
    const roh = document.documentElement.dataset.veilStatus;
    return roh ? (JSON.parse(roh) as Status) : null;
  });
}

async function warteBeurteilt(seite: Page, n: number) {
  await expect
    .poll(async () => {
      const s = await status(seite);
      return s ? `${s.gesamt}/${s.offen}` : '';
    }, { timeout: 40_000, intervals: [100] })
    .toBe(`${n}/0`);
}

// ---------- Adresswechsel (Einzelseiten-Apps) ----------

// Die Seite laeuft ueber localhost, der Rahmen kommt von 127.0.0.1. Die Ausnahme "localhost/gp/buy" ist ein Pfadmuster: sie greift,
// sobald die Seite per pushState, replaceState oder zurueck (popstate) auf einen Pfad unter /gp/buy wechselt, und endet, wenn sie ihn verlaesst.
// Der Rahmen kennt die Tab-Adresse nur ueber den Hintergrund (hintergrund/tab) und fragt sie im Takt.
test('Adresswechsel: Ausnahme greift nach pushState, replaceState und popstate und endet wieder (Seite und Rahmen)', async () => {
  await setze({ ausnahmen: ['localhost/gp/buy'] });
  const seite = await context.newPage();
  await seite.goto(`http://localhost:${port}/spa.html`);
  const rahmen = () => seite.frames().find((f) => f.url().includes('127.0.0.1'));
  const rahmenSeite = async () => {
    const f = rahmen();
    return f ? f.evaluate(() => document.documentElement.dataset.veilSeite ?? null).catch(() => 'nicht bereit') : 'kein Rahmen';
  };
  const topSeite = () => seite.evaluate(() => document.documentElement.dataset.veilSeite ?? null);
  const gehe = (pfad: string, art: 'push' | 'replace' | 'hash' = 'push') => seite.evaluate(([p, a]) => (window as any).gehe(p, a), [pfad, art]);
  const zurueck = () => seite.evaluate(() => (window as any).zurueck());
  const mitAusnahme = async (erwartet: string | null, beschreibung: string) => {
    const t0 = Date.now();
    await expect.poll(topSeite, { timeout: 3000, message: `Seite: ${beschreibung}` }).toBe(erwartet);
    const tSeite = Date.now() - t0;
    await expect.poll(rahmenSeite, { timeout: 5000, message: `Rahmen: ${beschreibung}` }).toBe(erwartet);
    console.log(`chromium Adresswechsel ${beschreibung}: Seite nach ${tSeite} ms, Rahmen nach ${Date.now() - t0} ms`);
  };

  // Anfang: kein Pfad passt, Seite und Rahmen werden beurteilt (kein "aus").
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await mitAusnahme(null, 'Start');

  await gehe('/gp/buy');
  await mitAusnahme('aus', 'pushState nach /gp/buy');
  // Die Seite zeigt ihr Bild ohne Urteil und ohne Wartezeit.
  expect(await seite.evaluate(() => getComputedStyle(document.getElementById('b1')!).opacity)).toBe('1');
  expect(await seite.evaluate(() => document.querySelectorAll('[data-veil]').length)).toBe(0);

  await gehe('/weiter');
  await mitAusnahme(null, 'pushState nach /weiter (Ausnahme endet)');
  await expect.poll(() => seite.evaluate(() => document.getElementById('b1')!.dataset.veil ?? ''), { timeout: 30_000 }).toMatch(/^(frei|zensiert)$/);

  await zurueck();
  await mitAusnahme('aus', 'popstate zurueck nach /gp/buy');
  await zurueck();
  await mitAusnahme(null, 'popstate zurueck nach /spa.html');

  await gehe('/gp/buy/zahlen', 'replace');
  await mitAusnahme('aus', 'replaceState nach /gp/buy/zahlen');
  await gehe('/spa.html', 'replace');
  await mitAusnahme(null, 'replaceState nach /spa.html');

  // hashchange ohne Pfadwechsel aendert nichts.
  await gehe('#abschnitt', 'hash');
  await mitAusnahme(null, 'hashchange');

  expect((await seite.evaluate(() => (window as any).__aufblitzen ?? 0)) as number).toBe(0);
  await seite.close();
});

// hintergrund/tab nur fragen, wenn es eigene Ausnahmen gibt, und nur beim Start des Frames: danach meldet die oberste Seite jeden
// Adresswechsel mit hintergrund/adresse, der Hintergrund reicht ihn als inhalt/tab an die Frames weiter (kein Takt in Frames).
test('hintergrund/tab: ohne Ausnahmen keine Anfrage, mit Ausnahmen nur beim Start, Adresswechsel kommen per Meldung', async () => {
  await worker.evaluate(() => {
    const g = globalThis as any;
    g.__tabAnfragen = 0;
    g.__adressMeldungen = 0;
    if (!g.__tabZaehler) {
      g.__tabZaehler = true;
      // Zaehlt nur; gibt undefined zurueck und beantwortet nichts.
      g.chrome.runtime.onMessage.addListener((m: any) => {
        if (m && m.ziel === 'hintergrund' && m.typ === 'tab') g.__tabAnfragen++;
        if (m && m.ziel === 'hintergrund' && m.typ === 'adresse') g.__adressMeldungen++;
        return undefined;
      });
    }
  });
  const zaehler = () => worker.evaluate(() => (globalThis as any).__tabAnfragen as number);
  const meldungen = () => worker.evaluate(() => (globalThis as any).__adressMeldungen as number);

  const seite = await context.newPage();
  await seite.goto(`http://localhost:${port}/spa.html`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await expect.poll(() => seite.frames().some((f) => f.url().includes('127.0.0.1')), { timeout: 5000 }).toBe(true);
  await seite.waitForTimeout(3500);
  const ohne = await zaehler();
  console.log(`chromium hintergrund/tab ohne Ausnahmen: ${ohne} Anfragen, ${await meldungen()} Adressmeldungen in 3,5 s`);
  expect(ohne).toBe(0);
  expect(await meldungen()).toBe(0);

  // Ausnahmen entstehen: der Rahmen fragt einmal, dann nie wieder (kein Takt).
  await setze({ ausnahmen: ['localhost/gp/buy'] });
  await expect.poll(zaehler, { timeout: 4000 }).toBeGreaterThan(0);
  const t0 = await zaehler();
  await seite.waitForTimeout(3500);
  const mit = (await zaehler()) - t0;
  console.log(`chromium hintergrund/tab mit Ausnahmen: ${t0} Anfrage(n) beim Start, danach ${mit} in 3,5 s`);
  expect(t0).toBeLessThanOrEqual(2);
  expect(mit).toBe(0);

  // Adresswechsel der obersten Seite: eine Adressmeldung je Wechsel, der Rahmen folgt ohne eigene Anfrage.
  const m0 = await meldungen();
  await seite.evaluate(() => (window as any).gehe('/gp/buy', 'push'));
  await expect.poll(meldungen, { timeout: 3000 }).toBeGreaterThan(m0);
  const rahmenSeite = () => seite.frames().find((f) => f.url().includes('127.0.0.1'))!.evaluate(() => document.documentElement.dataset.veilSeite ?? null);
  const t1 = Date.now();
  await expect.poll(rahmenSeite, { timeout: 3000 }).toBe('aus');
  console.log(`chromium Rahmen folgt dem Adresswechsel nach ${Date.now() - t1} ms (ereignisgesteuert)`);
  expect((await zaehler()) - t0).toBe(0);

  await setze({ ausnahmen: [] });
  await seite.waitForTimeout(500);
  const m1 = await meldungen();
  await seite.evaluate(() => (window as any).gehe('/weiter', 'push'));
  await seite.waitForTimeout(1000);
  // Ohne Ausnahmen beobachtet die Seite ihre Adresse nicht mehr und meldet nichts.
  expect(await meldungen()).toBe(m1);
  await seite.close();
});

// ---------- Testhaken "Freigabe sperren" ----------

test('Freigabe sperren: mit veil-freigabe=nie bleibt jedes Element bei opacity 0, ohne den Parameter wird freigegeben', async () => {
  const alleElemente = (seite: Page) =>
    seite.evaluate(() => {
      const liste: Element[] = [...document.querySelectorAll('img, [style*="background"]')];
      for (const id of ['shadow-offen']) {
        const w = document.getElementById(id)?.shadowRoot;
        if (w) liste.push(...w.querySelectorAll('img'));
      }
      return {
        anzahl: liste.length,
        sichtbar: liste.filter((e) => getComputedStyle(e).opacity !== '0').length,
        mitUrteil: liste.filter((e) => e.hasAttribute('data-veil')).length,
      };
    });

  // Gesperrt: alle Elemente bekommen ihr Urteil (der Status zaehlt sie), werden aber nie sichtbar.
  const gesperrt = await context.newPage();
  await gesperrt.goto(`${basis}/schleier.html?veil-freigabe=nie`);
  await expect.poll(() => status(gesperrt), { timeout: 10_000 }).not.toBeNull();
  await gesperrt.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await warteBeurteilt(gesperrt, 16);
  const s = (await status(gesperrt))!;
  expect(s.frei + s.zensiert + s.verdeckt).toBe(16);
  await gesperrt.waitForTimeout(3000);
  const g = await alleElemente(gesperrt);
  console.log(`chromium Freigabe gesperrt: ${g.anzahl} Elemente, ${g.sichtbar} sichtbar, ${g.mitUrteil} mit data-veil, nach 3 s`);
  expect(g.anzahl).toBeGreaterThanOrEqual(8);
  expect(g.sichtbar).toBe(0);
  expect(g.mitUrteil).toBe(0);
  await gesperrt.close();

  // Gegenprobe ohne den Parameter: freigegeben und sichtbar.
  const frei = await context.newPage();
  await frei.goto(`${basis}/schleier.html`);
  await expect.poll(() => status(frei), { timeout: 10_000 }).not.toBeNull();
  await frei.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await warteBeurteilt(frei, 16);
  await frei.waitForTimeout(500);
  const f = await alleElemente(frei);
  console.log(`chromium Freigabe offen: ${f.anzahl} Elemente, ${f.sichtbar} sichtbar, ${f.mitUrteil} mit data-veil`);
  expect(f.sichtbar).toBe(f.anzahl);
  expect(f.mitUrteil).toBe(f.anzahl);
  await frei.close();

  // Anderer Parameterwert sperrt nichts.
  const anders = await context.newPage();
  await anders.goto(`${basis}/schleier.html?veil-freigabe=ja`);
  await expect.poll(() => status(anders), { timeout: 10_000 }).not.toBeNull();
  await expect.poll(() => anders.evaluate(() => document.getElementById('b1')!.dataset.veil ?? ''), { timeout: 30_000 }).toMatch(/^(frei|zensiert)$/);
  await anders.close();
});

// ---------- blob:- und about:blank-Rahmen (match_about_blank, match_origin_as_fallback) ----------

test('blob:- und about:blank-Rahmen: Bild vor der Beurteilung unsichtbar, danach beurteilt', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-frames.html`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await seite.evaluate(() => (window as any).fuelleBeide());
  await expect
    .poll(() => seite.evaluate(() => JSON.stringify((window as any).__urteil)), { timeout: 40_000 })
    .toMatch(/^\{"blob":"(frei|zensiert)","leer":"(frei|zensiert)"\}$/);
  const w = await seite.evaluate(() => ({ blitz: (window as any).__blitz, proben: (window as any).__proben }));
  console.log(`chromium Rahmen: Proben blob ${w.proben.blob}, leer ${w.proben.leer}; Aufblitzen blob ${w.blitz.blob}, leer ${w.blitz.leer}`);
  expect(w.proben.blob).toBeGreaterThan(0);
  expect(w.proben.leer).toBeGreaterThan(0);
  expect(w.blitz).toEqual({ blob: 0, leer: 0 });
  // Nach dem Urteil sichtbar.
  const opacity = await seite.evaluate(() =>
    ['blob', 'leer'].map((id) => {
      const dok = (document.getElementById(id) as HTMLIFrameElement).contentDocument!;
      return getComputedStyle(dok.getElementById('bild')!).opacity;
    }),
  );
  expect(opacity).toEqual(['1', '1']);
  await seite.close();
});

// ---------- Private Adressbereiche beim Nachladen (PHASE-2-BAUPLAN 9.6) ----------

// Der Erkenner laedt ein privates Ziel (hier der Testserver auf 127.0.0.1) nur nach, wenn die anfragende Seite selbst privat ist.
test('Nachladen: oeffentliche Seite nach privatem Ziel abgelehnt, private Seite erlaubt', async () => {
  // Offscreen-Dokument wecken (aus einer Erweiterungsseite: der Service Worker kann sich nicht selbst benachrichtigen) und warten, bis es zuhoert.
  const erweiterungsSeite = await context.newPage();
  await erweiterungsSeite.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await erweiterungsSeite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }));
  await erweiterungsSeite.close();
  await expect
    .poll(() => worker.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'erkenner', typ: 'wecke' }).then((a: any) => a?.ok === true, () => false)), { timeout: 15_000 })
    .toBe(true);
  const frage = (referer: string) =>
    worker.evaluate(
      (n) => (globalThis as any).chrome.runtime.sendMessage(n),
      {
        ziel: 'erkenner',
        typ: 'pruefe',
        id: `privat-${Math.random().toString(36).slice(2, 8)}`,
        quelle: { art: 'url', url: `${basis}/synthetisch/9.png`, referer },
        breite: 0,
        hoehe: 0,
        einstellungen: { schwelle: 0.1, zonen: {}, rand: 0.15, stil: 'mosaik' },
        rendern: false,
      },
    ) as Promise<{ ok: boolean; fehler?: string }>;
  const oeffentlich = await frage('https://example.com/');
  expect(oeffentlich.ok).toBe(false);
  expect(oeffentlich.fehler).toBe('privat');
  const unbekannt = await frage('null');
  expect(unbekannt.fehler).toBe('privat');
  const privat = await frage('http://192.168.1.20/seite');
  expect(privat.ok).toBe(true);
  const lokal = await frage(`${basis}/`);
  expect(lokal.ok).toBe(true);

  // Absender mit Tab: der Erkenner traut dem behaupteten Referer nicht. Eine Erweiterungsseite im Tab (hier popup.html als Seite) hat
  // sender.tab und einen Ursprung chrome-extension://, also keine private http(s)-Herkunft: private Ziele bleiben gesperrt, auch wenn die
  // Nachricht einen privaten Referer behauptet oder keinen schickt.
  const imTab = await context.newPage();
  await imTab.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const ausTab = (referer: string) =>
    imTab.evaluate(
      (r) =>
        (globalThis as any).chrome.runtime.sendMessage({
          ziel: 'erkenner',
          typ: 'pruefe',
          id: `tab-${Math.random().toString(36).slice(2, 8)}`,
          quelle: { art: 'url', url: r.url, referer: r.referer },
          breite: 0,
          hoehe: 0,
          einstellungen: { schwelle: 0.1, zonen: {}, rand: 0.15, stil: 'mosaik' },
          rendern: false,
        }) as Promise<{ ok: boolean; fehler?: string }>,
      { url: `${basis}/synthetisch/9.png`, referer },
    );
  const behauptetPrivat = await ausTab(`${basis}/`);
  expect(behauptetPrivat.ok).toBe(false);
  expect(behauptetPrivat.fehler).toBe('privat');
  const ohneReferer = await ausTab('');
  expect(ohneReferer.ok).toBe(false);
  expect(ohneReferer.fehler).toBe('privat');
  await imTab.close();
});

// Umgehungsversuch der Netzgrenze: Rahmen mit undurchsichtigem Ursprung (sandbox, srcdoc) setzt <base href> auf ein privates Ziel.
// Die Herkunft kommt aus window.origin ("null", oeffentlich), nie aus der Basisadresse; der Erkenner sieht zusaetzlich den Absender.
// Erwartet: fehler "privat", sofort endgueltig verdeckt (kein zweiter Versuch nach 10 s). Gegenprobe: derselbe Rahmen ohne sandbox
// erbt den privaten Ursprung der Seite und wird normal beurteilt.
test('Netzgrenze: sandbox-srcdoc mit <base href> auf ein privates Ziel bleibt verdeckt, ohne sandbox wird beurteilt', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/netzgrenze.html`);
  const rahmen = (name: string) => seite.frames().find((f) => f.name() === name);
  const urteil = (name: string) => async () => {
    const f = rahmen(name);
    return f ? f.evaluate(() => document.getElementById('bild')?.getAttribute('data-veil') ?? '').catch(() => '') : '';
  };
  const t0 = Date.now();
  await expect.poll(urteil('sandbox'), { timeout: 15_000 }).toBe('verdeckt');
  const dauer = Date.now() - t0;
  console.log(`chromium Netzgrenze: sandbox-Rahmen nach ${dauer} ms endgueltig verdeckt (zweiter Versuch waere nach 10000 ms)`);
  expect(dauer).toBeLessThan(8000);
  const stil = await rahmen('sandbox')!.evaluate(() => {
    const st = getComputedStyle(document.getElementById('bild')!);
    return { opacity: st.opacity, filter: st.filter, urspruenglich: (document.getElementById('bild') as HTMLImageElement).src };
  });
  expect(stil.opacity).toBe('1');
  expect(stil.filter).toContain('blur');
  expect(stil.urspruenglich.startsWith('data:')).toBe(false);
  await expect.poll(urteil('offen'), { timeout: 15_000 }).toMatch(/^(frei|zensiert)$/);
  await seite.close();
});

// Testhaken "Freigabe sperren" auch in about:blank- und blob:-Rahmen (Testhost aus dem Ursprung, nicht aus location.hostname):
// beide Bilder werden beurteilt (Status des Rahmens zaehlt sie), bleiben aber bei opacity 0 ohne Urteil-Attribut.
test('Freigabe sperren: Bild im about:blank- und im blob:-Rahmen bleibt unsichtbar', async () => {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-frames.html?veil-freigabe=nie`);
  await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
  await seite.evaluate(() => (window as any).fuelleBeide());
  const zustand = () =>
    seite.evaluate(() =>
      ['blob', 'leer'].map((id) => {
        const dok = (document.getElementById(id) as HTMLIFrameElement).contentDocument;
        const bild = dok?.getElementById('bild');
        if (!dok || !bild) return null;
        const roh = dok.documentElement.dataset.veilStatus;
        return {
          opacity: dok.defaultView!.getComputedStyle(bild).opacity,
          urteil: bild.getAttribute('data-veil'),
          beurteilt: roh ? (JSON.parse(roh).offen === 0 && JSON.parse(roh).gesamt === 1) : false,
        };
      }),
    );
  // Beide Rahmen haben das Bild beurteilt (Status am Rahmen-Dokument), und es ist trotzdem unsichtbar.
  await expect.poll(async () => (await zustand()).every((z) => z && z.beurteilt), { timeout: 30_000 }).toBe(true);
  await seite.waitForTimeout(3000);
  const z = await zustand();
  console.log(`chromium Freigabe gesperrt in Rahmen: ${JSON.stringify(z)}`);
  expect(z).toEqual([
    { opacity: '0', urteil: null, beurteilt: true },
    { opacity: '0', urteil: null, beurteilt: true },
  ]);
  await seite.close();
});

// Ersetzen des Packs bei unveraendertem Stil: pack.importiert gehoert zum Pruefstand, offene Tabs rechnen neu.
test('Pack ersetzt (importiert aendert sich, Stil bleibt Mia-Patch): offene Seite beurteilt neu', async () => {
  const pack = (importiert: number) => ({
    id: 'testpack',
    version: '1.0.0',
    titel: 'Testpack',
    freischaltungen: ['stil:mia-patch'],
    bilder: 1,
    groesse: 1,
    importiert,
  });
  const setzePack = (p: unknown) =>
    worker.evaluate(async (wert) => {
      await (globalThis as any).chrome.storage.local.set({ pack: wert });
    }, p);
  await setze({ stil: 'mia-patch' });
  await setzePack(pack(1000));
  try {
    const seite = await context.newPage();
    await seite.goto(`${basis}/schleier.html`);
    await expect.poll(() => status(seite), { timeout: 10_000 }).not.toBeNull();
    const ms = () => seite.evaluate(() => document.getElementById('b1')!.getAttribute('data-veil-ms'));
    await expect.poll(ms, { timeout: 30_000 }).not.toBeNull();
    const vorher = await ms();
    // Stil und Einstellungen bleiben gleich, nur das Pack wird ersetzt.
    await setzePack(pack(2000));
    await expect.poll(async () => (await ms()) !== vorher, { timeout: 20_000, message: 'neues Urteil nach dem Ersetzen des Packs' }).toBe(true);
    await expect.poll(() => seite.evaluate(() => document.getElementById('b1')!.dataset.veil ?? ''), { timeout: 30_000 }).toMatch(/^(frei|zensiert)$/);
    console.log(`chromium Pack ersetzt: Urteil von b1 neu (data-veil-ms ${vorher} -> ${await ms()})`);
    // Gegenprobe: dasselbe Pack noch einmal geschrieben aendert nichts.
    const bleibt = await ms();
    await setzePack(pack(2000));
    await seite.waitForTimeout(1500);
    expect(await ms()).toBe(bleibt);
    await seite.close();
  } finally {
    await worker.evaluate(async () => {
      await (globalThis as any).chrome.storage.local.remove('pack');
    });
  }
});

// Netzgrenze bei Weiterleitungen: eine oeffentliche Seite (Testname oeffentlich.test, auf 127.0.0.1 abgebildet) darf ueber die Erweiterung kein
// Bild bekommen, das ins Heimnetz umgeleitet wird, weder vom eigenen Ursprung noch von einem anderen Namen noch als Inline-Hintergrund.
// Der Erkenner prueft die Endadresse (fehler "privat"), das Element wird endgueltig verdeckt, nie entsteht ein data:-Bild in der Seite.
test('Netzgrenze: Weiterleitung einer oeffentlichen Seite ins Heimnetz bleibt verdeckt, private Seite darf', async () => {
  const lese = (seite: Page) =>
    seite.evaluate(() =>
      ['a', 'b', 'e', 'c', 'd'].map((id) => {
        const el = document.getElementById(id) as HTMLElement;
        const st = getComputedStyle(el);
        return {
          id,
          urteil: el.getAttribute('data-veil') ?? '',
          opacity: st.opacity,
          blur: st.filter.includes('blur'),
          datenBild: (el instanceof HTMLImageElement && el.src.startsWith('data:')) || st.backgroundImage.includes('data:'),
        };
      }),
    );
  const oeffentlich = await context.newPage();
  await oeffentlich.goto(`http://oeffentlich.test:${port}/umleitung.html`);
  const t0 = Date.now();
  await expect
    .poll(async () => (await lese(oeffentlich)).map((e) => e.urteil).join(','), { timeout: 30_000, intervals: [100] })
    .toMatch(/^verdeckt,verdeckt,verdeckt,(frei|zensiert),(frei|zensiert)$/);
  console.log(`chromium Umleitung (oeffentliche Seite): a, b, e verdeckt nach ${Date.now() - t0} ms, c und d beurteilt`);
  for (const e of await lese(oeffentlich)) {
    expect(e.datenBild, `${e.id}: kein data:-Bild in der Seite`).toBe(false);
    if (['a', 'b', 'e'].includes(e.id)) expect(e.blur, `${e.id}: unscharf`).toBe(true);
    expect(e.opacity, e.id).toBe('1');
  }
  await oeffentlich.close();

  // Gegenprobe: dieselbe Seite unter 127.0.0.1 (privat): privat nach privat ist erlaubt, alles wird beurteilt, nichts verdeckt.
  const privat = await context.newPage();
  await privat.goto(`${basis}/umleitung.html`);
  await expect
    .poll(async () => (await lese(privat)).map((e) => e.urteil).join(','), { timeout: 30_000, intervals: [100] })
    .toMatch(/^(frei|zensiert),(frei|zensiert),(frei|zensiert),(frei|zensiert),(frei|zensiert)$/);
  await privat.close();
});
