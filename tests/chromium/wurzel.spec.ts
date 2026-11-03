import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shadow Roots ohne Aufblitzen (PHASE-3-BAUPLAN Auftrag R, R5). Die Fixture schleier-spaet.html legt Hosts an, deren Wurzel erst nach dem Einfuegen
// entsteht (spaet definierte Komponenten, attachShadow im naechsten Takt, umgehaengtes attachShadow). Der Waechter (waechter.js) zaehlt jedes Bild
// und Video, das ohne Urteil sichtbar war. Geprueft werden Urteile ueber das Attribut data-veil und die berechnete Deckkraft ohne Urteil.

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const ZENSIERT = /^(zensiert|verdeckt)$/;

type Zustand = Record<string, { urteil: string; deckkraft: string }>;

// Erwartung je Medium: nsfw-Bilder (Hosts 0, 3, 4) zensiert oder verdeckt, die uebrigen Bilder und alle Videos frei.
const NSFW = new Set([0, 3, 4]);
const erwartet = (): Record<string, RegExp | string> => {
  const e: Record<string, RegExp | string> = {};
  for (let n = 0; n < 6; n++) {
    e[`w-img-${n}`] = NSFW.has(n) ? ZENSIERT : 'frei';
    e[`w-vid-${n}`] = 'frei';
  }
  return e;
};

let profil: string;
let context: BrowserContext;
let worker: Worker;
let bilderDa = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const antwort = await fetch(`${basis}/api/testbilder?satz=nsfw`);
  bilderDa = ((await antwort.json()) as { bilder: string[] }).bilder.includes(BILD);
  if (!bilderDa && !OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
  profil = await mkdtemp(path.join(tmpdir(), 'veil-wurzel-'));
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!bilderDa, 'VEIL_OHNE_TESTBILDER=1');
  await worker.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.remove('einstellungen');
  });
});

async function setze(einstellungen: Record<string, unknown>) {
  await worker.evaluate(async (neu) => {
    const chromeApi = (globalThis as any).chrome;
    const alt = (await chromeApi.storage.local.get('einstellungen')).einstellungen ?? {};
    await chromeApi.storage.local.set({ einstellungen: { ...alt, ...neu } });
  }, einstellungen);
}

const zustand = (seite: Page): Promise<Zustand> => seite.evaluate(() => (window as any).testZustand());
const seiteAttr = (seite: Page) => seite.evaluate(() => document.documentElement.getAttribute('data-veil-seite'));

async function oeffne(modus: string): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(`${basis}/schleier-spaet.html?modus=${modus}&bild=${encodeURIComponent(BILD)}`);
  await expect.poll(() => seite.evaluate(() => document.documentElement.dataset.filmBereit ?? null), { timeout: 20_000, intervals: [100] }).toBe('1');
  return seite;
}

async function warteUrteile(seite: Page) {
  const soll = erwartet();
  await expect
    .poll(
      async () => {
        const z = await zustand(seite);
        if (Object.keys(z).length < 12) return ['fehlt'];
        return Object.entries(soll)
          .filter(([id, s]) => !(typeof s === 'string' ? z[id]?.urteil === s : s.test(z[id]?.urteil ?? '')))
          .map(([id]) => id);
      },
      { timeout: 40_000, intervals: [200] },
    )
    .toEqual([]);
}

async function waechterOk(seite: Page) {
  const w = await seite.evaluate(() => ({ aufblitzen: (window as any).__aufblitzen as number, proben: (window as any).__proben as number, wer: (window as any).__wer as string[] }));
  expect(w.proben).toBeGreaterThan(0);
  expect(w.aufblitzen, JSON.stringify(w.wer)).toBe(0);
}

for (const modus of ['komponenten', 'takt', 'eigener']) {
  test(`${modus}: Wurzeln, die nach dem Einfuegen entstehen, zeigen nie ungeschuetzt Bild oder Video (offen und geschlossen)`, async () => {
    const seite = await oeffne(modus);
    await warteUrteile(seite);
    await waechterOk(seite);
    if (modus === 'eigener') expect(await seite.evaluate(() => (window as any).__eigeneAufrufe as number)).toBeGreaterThanOrEqual(6);
    // Der Stil verdraengt das erste Kind der Seite nie (Konstruktor und connectedCallback lesen firstElementChild).
    expect(await seite.evaluate(() => Object.values((window as any).__ersteKinder as Record<string, boolean>))).toEqual([true, true, true, true, true, true]);
    // Die Wurzeln tragen genau einen Stil des Schleiers (keine zwei Kopien).
    const stile = await seite.evaluate(() => Object.values((window as any).__wurzeln as Record<string, ShadowRoot>).map((w) => w.querySelectorAll('style').length));
    expect(stile).toEqual([1, 1, 1, 1, 1, 1]);
    await seite.close();
  });
}

test('innerHTML direkt nach attachShadow und Sekunden spaeter noch einmal: der Stil kommt zurueck, nichts blitzt auf (offen und geschlossen)', async () => {
  const seite = await oeffne('innerhtml');
  await warteUrteile(seite);
  await waechterOk(seite);
  // Sekunden spaeter leert die Seite jede Wurzel erneut: die frischen Medien sind sofort verdeckt und werden neu beurteilt.
  await seite.waitForTimeout(2500);
  await seite.evaluate(() => (window as any).nochmal());
  await warteUrteile(seite);
  await waechterOk(seite);
  const stile = await seite.evaluate(() => Object.values((window as any).__wurzeln as Record<string, ShadowRoot>).map((w) => w.querySelectorAll('style').length));
  expect(stile).toEqual([1, 1, 1, 1, 1, 1]);
  await seite.close();
});

// ---------- Haken: Belege ohne Schleier-Logik (G3 bis G6, R7) ----------

test('Haken: nach attachShadow und einem Mikrotask ist das Bild verdeckt, adoptedStyleSheets bleibt unveraendert (offen und geschlossen)', async () => {
  const seite = await oeffne('manuell');
  const r = await seite.evaluate(async () => {
    const aus: Record<string, unknown> = {};
    for (const modus of ['open', 'closed'] as const) {
      const h = document.createElement('div');
      document.body.appendChild(h);
      // Einen Takt warten: der Beobachter des Schleiers sieht den Host ohne Wurzel (so greift allein der Haken).
      await new Promise((f) => setTimeout(f, 0));
      const w = h.attachShadow({ mode: modus });
      const img = document.createElement('img');
      img.width = 50;
      img.height = 50;
      img.src = '/synthetisch/50.png';
      w.appendChild(img);
      await Promise.resolve();
      aus[modus] = { deckkraft: getComputedStyle(img).opacity, blaetter: w.adoptedStyleSheets.length };
    }
    return aus;
  });
  expect(r).toEqual({ open: { deckkraft: '0', blaetter: 0 }, closed: { deckkraft: '0', blaetter: 0 } });
  await seite.close();
});

test('Haken: Host nicht eingefuegt, attachShadow, Mikrotask, innerHTML, Mikrotask: genau ein gekennzeichneter Stil am Ende; die Vorlage behaelt ihr erstes Kind', async () => {
  const seite = await oeffne('manuell');
  const r = await seite.evaluate(async () => {
    const aus: Record<string, unknown> = {};
    for (const modus of ['open', 'closed'] as const) {
      const h = document.createElement('div');
      const w = h.attachShadow({ mode: modus });
      const sofort = w.querySelectorAll('style').length;
      await Promise.resolve();
      const nachAnlegen = w.querySelectorAll('style[data-veil-haken]').length;
      w.innerHTML = '<img id="r6" width="10" height="10">';
      const direkt = w.querySelectorAll('style').length;
      await Promise.resolve();
      const st = w.querySelectorAll('style[data-veil-haken]');
      aus[modus] = { sofort, nachAnlegen, direkt, genau: st.length, ende: w.lastElementChild === st[0] };
    }
    // Eine Komponente haengt nach attachShadow eine Vorlage ein und liest firstElementChild.
    const h2 = document.createElement('div');
    document.body.appendChild(h2);
    const w2 = h2.attachShadow({ mode: 'closed' });
    const eigenes = document.createElement('p');
    w2.appendChild(eigenes);
    const erstes = w2.firstElementChild === eigenes;
    await Promise.resolve();
    aus.vorlage = { erstes, nochErstes: w2.firstElementChild === eigenes, ende: w2.lastElementChild?.localName };
    return aus;
  });
  expect(r).toEqual({
    open: { sofort: 0, nachAnlegen: 1, direkt: 0, genau: 1, ende: true },
    closed: { sofort: 0, nachAnlegen: 1, direkt: 0, genau: 1, ende: true },
    vorlage: { erstes: true, nochErstes: true, ende: 'style' },
  });
  await seite.close();
});

test('Haken: Pause und Ende der Pause schalten nicht uebernommene Stile (media), auch ohne den Schleier', async () => {
  const seite = await oeffne('manuell');
  const r = await seite.evaluate(async () => {
    const h = document.createElement('div'); // nicht eingefuegt: der Schleier uebernimmt den Stil nie
    const w = h.attachShadow({ mode: 'open' });
    await Promise.resolve();
    const st = w.querySelector('style[data-veil-haken]') as HTMLStyleElement;
    const aus: string[] = [st.media];
    document.documentElement.setAttribute('data-veil-seite', 'aus');
    await Promise.resolve();
    aus.push(st.media);
    document.documentElement.removeAttribute('data-veil-seite');
    await Promise.resolve();
    aus.push(st.media);
    // Eine Wurzel, die waehrend der Pause entsteht, startet abgeschaltet.
    document.documentElement.setAttribute('data-veil-seite', 'aus');
    const h2 = document.createElement('div');
    const w2 = h2.attachShadow({ mode: 'closed' });
    await Promise.resolve();
    aus.push((w2.querySelector('style[data-veil-haken]') as HTMLStyleElement).media);
    document.documentElement.removeAttribute('data-veil-seite');
    return aus;
  });
  expect(r).toEqual(['', 'not all', '', 'not all']);
  await seite.close();
});

test('Haken: gefaelschte Ereignisse der Seite aendern nichts', async () => {
  const seite = await oeffne('manuell');
  const r = await seite.evaluate(async () => {
    for (const n of ['veil-wurzeln-aus', 'veil-wurzeln-an', 'veil-wurzeln-ab', 'veil-wurzel']) {
      document.dispatchEvent(new Event(n));
      document.body.dispatchEvent(new Event(n, { bubbles: true, composed: true }));
    }
    const blind = document.createElement('div');
    document.body.appendChild(blind);
    blind.dispatchEvent(new Event('veil-wurzel', { bubbles: true, composed: true }));
    const h = document.createElement('div');
    document.body.appendChild(h);
    await new Promise((f) => setTimeout(f, 0));
    const w = h.attachShadow({ mode: 'closed' });
    const img = document.createElement('img');
    img.width = 50;
    img.height = 50;
    img.src = '/synthetisch/53.png';
    w.appendChild(img);
    await Promise.resolve();
    return { danach: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };
  });
  expect(r).toEqual({ danach: '0', stile: 1 });
  await seite.close();
});

test('Haken: Pause mit innerHTML, der Inhalt bleibt sichtbar; danach gilt die Wurzel wie im Dokument', async () => {
  await setze({ pause: true });
  const seite = await oeffne('manuell');
  await expect.poll(() => seiteAttr(seite), { timeout: 10_000 }).toBe('aus');
  const r = await seite.evaluate(async () => {
    const h = document.createElement('div');
    h.id = 'host-pi';
    document.body.appendChild(h);
    const w = h.attachShadow({ mode: 'closed' });
    (window as any).__wurzeln['host-pi'] = w;
    w.innerHTML = '<img id="w-img-pi" width="50" height="50" src="/synthetisch/54.png">';
    await Promise.resolve();
    const img = w.getElementById('w-img-pi') as HTMLElement;
    const sichtbar = getComputedStyle(img).opacity;
    w.innerHTML = '<img id="w-img-pi" width="50" height="50" src="/synthetisch/54.png">';
    await Promise.resolve();
    return { sichtbar, nochmal: getComputedStyle(w.getElementById('w-img-pi') as HTMLElement).opacity, urteil: (w.getElementById('w-img-pi') as HTMLElement).getAttribute('data-veil') };
  });
  expect(r).toEqual({ sichtbar: '1', nochmal: '1', urteil: null });
  await setze({ pause: false });
  await expect.poll(async () => (await zustand(seite))['w-img-pi']?.urteil, { timeout: 30_000 }).toBe('frei');
  await seite.close();
});

test('Declarative Shadow DOM (Parser und setHTMLUnsafe): kein Aufblitzen, die Bilder werden beurteilt', async () => {
  const seite = await oeffne('dsd');
  await expect
    .poll(async () => {
      const z = await zustand(seite);
      return [z['w-img-dsd']?.urteil, ZENSIERT.test(z['w-img-dsd-n']?.urteil ?? ''), z['w-vid-dsd']?.urteil].join(',');
    }, { timeout: 40_000, intervals: [200] })
    .toBe('frei,true,frei');
  await waechterOk(seite);
  const geht = await seite.evaluate(() => {
    const b = document.body as HTMLElement & { setHTMLUnsafe?: (t: string) => void };
    if (typeof b.setHTMLUnsafe !== 'function') return false;
    const d = document.createElement('div');
    document.body.appendChild(d);
    (d as HTMLElement & { setHTMLUnsafe: (t: string) => void }).setHTMLUnsafe(
      '<div id="host-dsd2"><template shadowrootmode="open"><img id="w-img-dsd2" width="100" height="100" src="/synthetisch/55.png"></template></div>',
    );
    (window as any).__wurzeln['host-dsd2'] = document.getElementById('host-dsd2')!.shadowRoot;
    return true;
  });
  if (geht) {
    await expect.poll(async () => (await zustand(seite))['w-img-dsd2']?.urteil, { timeout: 30_000 }).toBe('frei');
    await waechterOk(seite);
  } else {
    console.log('chromium: setHTMLUnsafe UEBERSPRUNGEN, der Browser kennt es nicht');
  }
  await seite.close();
});

// Grenze: eine Seite, die fremde Kinder ihrer Wurzel sofort entfernt. Bei nicht eingefuegtem Host ist allein der Haken zustaendig, bei eingefuegtem
// uebernimmt der Schleier den Stil sofort und sichert ihn selbst. Beide drosseln auf hoechstens 20 Wiedereinlegungen je Sekunde plus eines am
// Ende des Fensters und zaehlen die gedrosselte Wurzel im Testbau (Attribut am Wurzelelement).
for (const eingefuegt of [false, true]) {
  test(`Grenze (${eingefuegt ? 'Schleier' : 'Haken'}): eine Seite, die fremde Kinder ihrer Wurzel sofort entfernt, wird gedrosselt, der Tab bleibt bedienbar`, async () => {
    const seite = await oeffne('manuell');
    await seite.evaluate((ein) => {
      const h = document.createElement('div');
      if (ein) document.body.appendChild(h);
      const w = h.attachShadow({ mode: 'open' });
      (window as any).__entfernt = 0;
      const eigenes = document.createElement('p');
      eigenes.setAttribute('data-meins', '');
      w.appendChild(eigenes);
      // Die Seite entfernt jedes Kind, das nicht von ihr kommt, im selben Mikrotask (wie ein Rahmenwerk, das seinen Baum allein verwaltet).
      new MutationObserver((liste) => {
        for (const m of liste) for (const k of m.addedNodes) if (k instanceof Element && !k.hasAttribute('data-meins')) { k.remove(); (window as any).__entfernt++; }
      }).observe(w, { childList: true });
    }, eingefuegt);
    await seite.waitForTimeout(1500);
    const n1 = await seite.evaluate(() => (window as any).__entfernt as number);
    await seite.waitForTimeout(3000);
    const n2 = await seite.evaluate(() => (window as any).__entfernt as number);
    const attribut = eingefuegt ? 'data-veil-grenze' : 'data-veil-grenze-haken';
    const gezaehlt = await seite.evaluate((a) => document.documentElement.getAttribute(a), attribut);
    console.log(`chromium: Grenze ${eingefuegt ? 'Schleier' : 'Haken'}, ${n1} Entfernungen nach 1,5 s, ${n2} nach 4,5 s, gezaehlt ${gezaehlt}`);
    // Die Grenze wurde erreicht (mindestens 21 Entfernungen), die Schleife laeuft aber nur gedrosselt weiter: hoechstens 21 je Sekunde.
    expect(n1).toBeGreaterThanOrEqual(21);
    expect(n2 - n1).toBeLessThanOrEqual(3 * 21 + 5);
    expect(n2).toBeGreaterThan(n1);
    expect(Number(gezaehlt)).toBeGreaterThanOrEqual(1);
    await seite.close();
  });
}

// Lebenszeichen (G1, R7): eine Seite kann das Zeichen mit !important ueberschreiben, Chromium behaelt die CSS der abgeschalteten Erweiterung in offenen
// Seiten (nicht messbar), Firefox entfernt sie (eigener Test in wurzel.test.mjs). Der Haken schlaeft dann und laeuft bei Rueckkehr des Zeichens wieder an.
test('Lebenszeichen in der Pause: ohne --veil-lebt verschwinden nicht uebernommene Stile, neue Wurzeln bleiben unverdeckt', async () => {
  await setze({ pause: true });
  const seite = await oeffne('manuell');
  await expect.poll(() => seiteAttr(seite), { timeout: 10_000 }).toBe('aus');
  // In der Pause uebernimmt der Schleier keine Wurzeln: die Stile des Hakens bleiben nicht uebernommen (abgeschaltet).
  await seite.evaluate(() => {
    for (const modus of ['open', 'closed'] as const) {
      const h = document.createElement('div');
      document.body.appendChild(h);
      (window as any).__wurzeln['host-' + modus] = h.attachShadow({ mode: modus });
    }
  });
  await seite.waitForTimeout(200);
  const vorher = await seite.evaluate(() => Object.values((window as any).__wurzeln as Record<string, ShadowRoot>).map((w) => w.querySelectorAll('style[data-veil-haken]').length));
  expect(vorher).toEqual([1, 1]);
  await seite.addStyleTag({ content: 'html { --veil-lebt: initial !important; }' });
  await expect
    .poll(
      () => seite.evaluate(() => Object.values((window as any).__wurzeln as Record<string, ShadowRoot>).map((w) => w.querySelectorAll('style').length)),
      { timeout: 6000, intervals: [200] },
    )
    .toEqual([0, 0]);
  const neu = await seite.evaluate(async () => {
    const h = document.createElement('div');
    document.body.appendChild(h);
    const w = h.attachShadow({ mode: 'closed' });
    const img = document.createElement('img');
    img.width = 50;
    img.height = 50;
    img.src = '/synthetisch/56.png';
    w.appendChild(img);
    await Promise.resolve();
    return { danach: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };
  });
  expect(neu).toEqual({ danach: '1', stile: 0 });
  await seite.close();
});

test('Lebenszeichen im aktiven Zustand: uebernommene Stile werden abgeschaltet, neue Wurzeln bleiben unverdeckt; kehrt das Zeichen zurueck, laeuft der Haken wieder an', async () => {
  const seite = await oeffne('takt');
  await warteUrteile(seite);
  const eigene = () =>
    seite.evaluate(() =>
      [0, 1, 2, 3, 4, 5].map((n) => (((window as any).__wurzeln as Record<string, ShadowRoot>)['host-' + n]!.querySelector('style[data-veil-eigen]') as HTMLStyleElement | null)?.media ?? 'fehlt'),
    );
  expect(await eigene()).toEqual(['', '', '', '', '', '']);
  const neueWurzel = (id: string) =>
    seite.evaluate(async (i) => {
      const h = document.createElement('div');
      document.body.appendChild(h);
      await new Promise((f) => setTimeout(f, 0));
      const w = h.attachShadow({ mode: 'closed' });
      (window as any).__wurzeln[i] = w;
      const img = document.createElement('img');
      img.width = 50;
      img.height = 50;
      img.src = '/synthetisch/58.png';
      w.appendChild(img);
      await Promise.resolve();
      return { danach: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };
    }, id);
  await seite.addStyleTag({ content: 'html { --veil-lebt: initial !important; }' });
  await expect.poll(eigene, { timeout: 6000, intervals: [200] }).toEqual(['not all', 'not all', 'not all', 'not all', 'not all', 'not all']);
  // Ein Bild ohne Urteil in einer bestehenden Wurzel ist sichtbar (der Stil ist abgeschaltet), und eine neue Wurzel bekommt keinen Stil.
  const imBestand = await seite.evaluate(async () => {
    const w = (window as any).__wurzeln['host-1'] as ShadowRoot;
    const img = document.createElement('img');
    img.width = 50;
    img.height = 50;
    img.src = '/synthetisch/59.png';
    w.appendChild(img);
    await Promise.resolve();
    return getComputedStyle(img).opacity;
  });
  expect(imBestand).toBe('1');
  expect(await neueWurzel('host-schlaf')).toEqual({ danach: '1', stile: 0 });
  // Das Zeichen kehrt zurueck: die Stile laufen wieder, neue Wurzeln sind geschuetzt.
  await seite.evaluate(() => document.querySelectorAll('style').forEach((st) => st.textContent?.includes('--veil-lebt') && st.remove()));
  await expect.poll(eigene, { timeout: 6000, intervals: [200] }).toEqual(['', '', '', '', '', '']);
  expect(await neueWurzel('host-wach')).toEqual({ danach: '0', stile: 1 });
  await seite.close();
});

test('Pause vor dem Anlegen: der Inhalt der neuen Wurzeln ist sichtbar; zurueck aus der Pause gelten die Urteile', async () => {
  await setze({ pause: true });
  const seite = await oeffne('manuell');
  await expect.poll(() => seiteAttr(seite), { timeout: 10_000 }).toBe('aus');
  await seite.evaluate(() => (window as any).legeAn());
  await expect.poll(async () => Object.keys(await zustand(seite)).length, { timeout: 10_000 }).toBe(12);
  await seite.waitForTimeout(500);
  let z = await zustand(seite);
  for (const [id, s] of Object.entries(z)) {
    expect(s.urteil, id).toBe('');
    expect(s.deckkraft, id).toBe('1');
  }
  // Pause aus: dieselben Urteile wie im Dokument.
  await setze({ pause: false });
  await warteUrteile(seite);
  // Pause wieder an: Urteile weg, alles sichtbar; danach wieder aus: Urteile kommen zurueck.
  await setze({ pause: true });
  await expect.poll(() => seiteAttr(seite), { timeout: 10_000 }).toBe('aus');
  await expect
    .poll(async () => Object.values(await zustand(seite)).filter((s) => s.urteil !== '' || s.deckkraft !== '1').length, { timeout: 10_000 })
    .toBe(0);
  await setze({ pause: false });
  await warteUrteile(seite);
  await seite.close();
});

test('Pause nach dem Anlegen und zurueck: Wurzeln verhalten sich wie das Dokument', async () => {
  const seite = await oeffne('takt');
  await warteUrteile(seite);
  await setze({ pause: true });
  await expect.poll(() => seiteAttr(seite), { timeout: 10_000 }).toBe('aus');
  await expect
    .poll(async () => Object.values(await zustand(seite)).filter((s) => s.urteil !== '' || s.deckkraft !== '1').length, { timeout: 10_000 })
    .toBe(0);
  // Eine Wurzel, die waehrend der Pause entsteht, bleibt sichtbar.
  await seite.evaluate(() => {
    const h = document.createElement('div');
    h.id = 'host-pause';
    document.getElementById('buehne')!.appendChild(h);
    const w = h.attachShadow({ mode: 'closed' });
    (window as any).__wurzeln['host-pause'] = w;
    const b = document.createElement('img');
    b.id = 'w-img-pause';
    b.width = 240;
    b.height = 150;
    b.src = '/synthetisch/41.png';
    w.appendChild(b);
  });
  await seite.waitForTimeout(500);
  const waehrend = (await zustand(seite))['w-img-pause'];
  expect(waehrend).toEqual({ urteil: '', deckkraft: '1' });
  await setze({ pause: false });
  await expect.poll(async () => (await zustand(seite))['w-img-pause']?.urteil, { timeout: 30_000 }).toBe('frei');
  await warteUrteile(seite);
  await seite.close();
});
