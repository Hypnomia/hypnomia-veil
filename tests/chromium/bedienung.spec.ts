// Chromium: Phase 11 E4d2, die Bedienelemente der Einstellungsseite aus den Bausteinen (Regeln F1 bis F7). Der Weg ueber die echte Seite und den echten
// Speicher: waehlen, Speicher lesen, Seite neu laden, die Anzeige stimmt. Sicherheit (F5): Aufbau, Reiterwechsel, Aufklappen und Pfeiltasten schreiben
// nie; nach einem Speicherfehler zeigt jedes Element wieder den gespeicherten Stand. Fingerziel 44 px bei 360 und 1280 px in jedem Reiter, das "?"
// ueberdeckt nichts Bedienbares (F6), der Tab-Halt einer Gruppe liegt nach dem Verlassen wieder auf der gewaehlten Stufe (NN1).
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD } from '../../src/einstellungen';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { REITER as REITERDATEN } from '../../entrypoints/options/reiter-daten';
import { ZONEN_VERWORFEN } from '../../entrypoints/options/bedienung-texte';
import { kleidungHinweis } from '../../entrypoints/options/bedienung-texte';
import { markiert, mitReitern, oeffneZugeklapptes, reiter, stufenKnopf, zonenChip } from './einstellungen-ordnung';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');

let profil = '';
let context: BrowserContext;
let id = '';

const optionsUrl = (anker = '') => `chrome-extension://${id}/options.html${anker}`;
const lies = (seite: Page, k: string | null) => seite.evaluate(async (k) => (await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>, k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const einst = async (seite: Page) => ((await lies(seite, 'einstellungen')).einstellungen ?? {}) as Record<string, any>;
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const packMit = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const PACK_VOLL = packMit(['stil:mia-patch', 'erwachsen:vorschau', 'zensur:sticker', 'kontrolle:blitz', 'ton']);
const zuruecksetzen = (seite: Page) =>
  seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));
const REITER = REITERDATEN.map((r) => r.name);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-bedienung-'));
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

// Neue Seite mit gesetztem Speicher. `zaehlen`: ab dem ersten Laden zaehlt der Seitenkontext jeden Schreibaufruf (set, remove, clear).
// Ein Pack im gespeicherten Stand vor dem Laden raeumt die Seite weg (es gibt keine Pack-Datei dazu): `pack` wird darum nach dem Laden geschrieben, wie
// in reiter.spec.ts, und die Seite wartet, bis nichts mehr zugeklappt ist.
async function seiteMit(vorher: Record<string, unknown>, breite = 1280, zaehlen = false): Promise<Page> {
  const { pack, ...rest } = vorher;
  const seite = mitReitern(await context.newPage()); // jede Handlung an einem Element oeffnet vorher seinen Reiter, wie die Person
  await seite.setViewportSize({ width: breite, height: 800 });
  await seite.goto(optionsUrl());
  await zuruecksetzen(seite);
  await schreibe(seite, { einstieg: EINSTIEG_FERTIG, ...rest });
  if (zaehlen) {
    await seite.addInitScript(() => {
      const sl = (globalThis as any).chrome?.storage?.local;
      if (!sl) return;
      sl.__echtSet = sl.set.bind(sl); // der Weg fuer das Schreiben des Tests (das Pack), nicht gezaehlt
      for (const name of ['set', 'remove', 'clear']) {
        const echt = sl[name].bind(sl);
        sl[name] = (...a: unknown[]) => (sessionStorage.setItem('aufrufe', `${sessionStorage.getItem('aufrufe') ?? ''}${name};`), echt(...a));
      }
    });
  }
  await seite.goto(optionsUrl());
  await seite.reload();
  await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  await seite.waitForSelector('#stimmung-wahl, #zonen-wahl', { state: 'attached' });
  if (pack) await mitPack(seite, pack);
  return seite;
}
const mitPack = async (seite: Page, pack: unknown) => {
  await seite.evaluate((p) => {
    const sl = (globalThis as any).chrome.storage.local;
    return (sl.__echtSet ?? sl.set.bind(sl))({ pack: p });
  }, pack);
  await seite.waitForSelector('#erwachsen[data-zu="0"]', { state: 'attached' });
  await seite.waitForTimeout(200);
};
const neuLaden = async (seite: Page, pack?: unknown) => {
  await seite.reload();
  await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
  await seite.waitForSelector('#zonen-wahl', { state: 'attached' });
  if (pack) await mitPack(seite, pack);
};
// Jeder Klick macht einen Knopf der Liste unwirksam (er ist dann offen): immer den ersten noch zugeklappten nehmen.
const oeffneAlle = async (seite: Page, sel: string) => {
  for (let i = 0; i < 30 && (await seite.locator(sel).count()) > 0; i++) await seite.locator(sel).first().click();
};
const aufrufe = (seite: Page) => seite.evaluate(() => sessionStorage.getItem('aufrufe') ?? '');

const alleZonen = (an: boolean, bedeckt: boolean) =>
  Object.fromEntries(
    Object.keys(STANDARD.zonen).map((z) => [z, ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'].includes(z) ? { an, bedeckt } : { an }]),
  );
// Die Ausgangsstaende der Rechnung F5: Standard (gemischt), alle bedeckt, keine bedeckt, alle Zonen aus, Zwischenwerte der Stufen.
const ZWISCHEN = { version: 1, schwelle: 0.1049, quiz: { verweigern: 0.123, freilegenMs: 7500 }, ton: { an: false, lautstaerke: 0.45 } };
const STAENDE: Record<string, Record<string, unknown>> = {
  Standard: {},
  'alle bedeckt': { einstellungen: { version: 1, zonen: alleZonen(true, true) } },
  'keine bedeckt': { einstellungen: { version: 1, zonen: alleZonen(true, false) } },
  'alle Zonen aus': { einstellungen: { version: 1, zonen: alleZonen(false, true) } },
  Zwischenwerte: { einstellungen: ZWISCHEN },
};

// ---------- F5: Anzeigen, Reiterwechsel, Aufklappen und Pfeiltasten schreiben nie ----------
for (const [name, vorher] of Object.entries(STAENDE)) {
  test(`F5: Aufbau, Reiterwechsel, Aufklappen und Pfeiltasten schreiben nichts (Ausgangsstand ${name}, ohne und mit Pack)`, async () => {
    const horcher = await context.newPage();
    await horcher.goto(`chrome-extension://${id}/hilfe.html`);
    const quelle = await seiteMit(vorher);
    await quelle.close();
    await horcher.evaluate(() => {
      (globalThis as any).__schreib = 0;
      (globalThis as any).chrome.storage.onChanged.addListener(() => (globalThis as any).__schreib++);
    });
    const seite = await context.newPage();
    // Der Zaehler wirkt ab dem ersten Laden; `__echtSet` ist der unbehinderte Weg fuer das Schreiben des Tests (das Pack), das nicht zaehlt.
    await seite.addInitScript(() => {
      const sl = (globalThis as any).chrome?.storage?.local;
      if (!sl) return;
      sl.__echtSet = sl.set.bind(sl);
      for (const n of ['set', 'remove', 'clear']) {
        const echt = sl[n].bind(sl);
        sl[n] = (...a: unknown[]) => (sessionStorage.setItem('aufrufe', `${sessionStorage.getItem('aufrufe') ?? ''}${n};`), echt(...a));
      }
    });
    try {
      await seite.goto(optionsUrl());
      await seite.waitForFunction(() => document.body.getAttribute('data-veil-ordnung') === 'bereit');
      await seite.waitForSelector('#zonen-wahl', { state: 'attached' });
      await seite.waitForTimeout(500);
      // Erster Messpunkt: das Oeffnen der Seite (ohne Pack)
      expect(await aufrufe(seite), `Schreibaufrufe beim Oeffnen (${name})`).toBe('');
      expect(await horcher.evaluate(() => (globalThis as any).__schreib), `Schreibereignisse beim Oeffnen (${name})`).toBe(0);
      // Das Pack kommt (Schreiben des Tests, nicht gezaehlt); die Seite zeichnet neu, auch das darf nichts schreiben
      await seite.evaluate((p) => (globalThis as any).chrome.storage.local.__echtSet({ pack: p }), PACK_VOLL);
      await seite.waitForSelector('#erwachsen[data-zu="0"]', { state: 'attached' });
      await seite.waitForTimeout(300);
      await horcher.evaluate(() => ((globalThis as any).__schreib = 0));
      const gespeichert = JSON.stringify(await lies(seite, null));
      for (const r of REITER) {
        await reiter(seite, r as never);
        // Aufklapper in diesem Reiter oeffnen (wie die Person), dann Pfeile, Pos1 und Ende in jeder Gruppe
        await oeffneAlle(seite, '[role=tabpanel]:not([hidden]) .v-auf-kopf[aria-expanded=false]');
        for (const gruppe of await seite.locator('[role=tabpanel]:not([hidden]) .v-baustein [role=radiogroup]').all()) {
          const erster = gruppe.locator('[role=radio]:not(:disabled)').first();
          await erster.focus();
          for (const t of ['ArrowRight', 'ArrowRight', 'End', 'ArrowLeft', 'Home', 'ArrowDown', 'ArrowUp']) await seite.keyboard.press(t);
        }
      }
      await seite.waitForTimeout(700);
      expect(await aufrufe(seite), `Schreibaufrufe der Einstellungsseite (${name})`).toBe('');
      expect(await horcher.evaluate(() => (globalThis as any).__schreib), `Schreibereignisse im Speicher (${name})`).toBe(0);
      expect(JSON.stringify(await lies(seite, null)), `Speicher vorher und nachher gleich (${name})`).toBe(gespeichert);
    } finally {
      await seite.close();
      await horcher.close();
    }
  });
}

// ---------- F1: Zonenwahl, F2: Kleidungsfrage ----------
test('F1 und F2: Karten, Chips und Kleidungsfrage ueber die echte Seite, Speicher lesen, neu laden, die Anzeige stimmt', async () => {
  const seite = await seiteMit({});
  try {
    // Standard: Body markiert, 3 von 10 an, Kleidung gemischt (keine Antwort)
    expect(await markiert(seite, 'zonen-wahl')).toBe('BodyBreasts, genitals and buttocks.');
    await expect(seite.locator('#zonen-wahl .v-auf-stand')).toHaveText('3 of 10 on');
    expect(await markiert(seite, 'kleidung-frage')).toBeNull();
    // Everything: alle zehn an; bereits gespeichertes bedeckt bleibt, nichts nimmt Deckung
    await stufenKnopf(seite, 'zonen-wahl', 'Everything').click();
    await expect.poll(async () => Object.values((await einst(seite)).zonen ?? {}).every((z: any) => z.an === true)).toBe(true);
    let e = await einst(seite);
    expect(e.zonen.genitals).toEqual({ an: true, bedeckt: true });
    expect(e.zonen.breast.bedeckt).toBe(false);
    await neuLaden(seite);
    expect(await markiert(seite, 'zonen-wahl')).toContain('Everything');
    await expect(seite.locator('#zonen-wahl .v-auf-stand')).toHaveText('10 of 10 on');
    for (const z of Object.keys(STANDARD.zonen)) await expect(await zonenChip(seite, z)).toHaveAttribute('aria-pressed', 'true');
    // Chip: Genitals aus (nur diese Zone), bedeckt bleibt gespeichert; keine Karte markiert
    await (await zonenChip(seite, 'genitals')).click();
    await expect.poll(async () => (await einst(seite)).zonen.genitals.an).toBe(false);
    e = await einst(seite);
    expect(e.zonen.genitals.bedeckt).toBe(true);
    expect(e.zonen.breast.an).toBe(true);
    await neuLaden(seite);
    expect(await markiert(seite, 'zonen-wahl')).toBeNull();
    await expect(await zonenChip(seite, 'genitals')).toHaveAttribute('aria-pressed', 'false');
    // Kleidungsfrage: "Under clothes too" setzt alle sechs, "Bare skin only" nimmt alle weg; `an` bleibt
    const anVorher = JSON.stringify(Object.values((await einst(seite)).zonen).map((z: any) => z.an));
    await stufenKnopf(seite, 'kleidung-frage', 'Under clothes too').click();
    await expect.poll(async () => (await einst(seite)).zonen.breast.bedeckt).toBe(true);
    e = await einst(seite);
    for (const z of ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits']) expect(e.zonen[z].bedeckt, z).toBe(true);
    expect(JSON.stringify(Object.values(e.zonen).map((z: any) => z.an))).toBe(anVorher);
    await neuLaden(seite);
    expect(await markiert(seite, 'kleidung-frage')).toContain('Under clothes too');
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toHaveCount(0);
    await stufenKnopf(seite, 'kleidung-frage', 'Bare skin only').click();
    await expect.poll(async () => (await einst(seite)).zonen.breast.bedeckt).toBe(false);
    e = await einst(seite);
    for (const z of ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits']) expect(e.zonen[z].bedeckt, z).toBe(false);
    await neuLaden(seite);
    expect(await markiert(seite, 'kleidung-frage')).toContain('Bare skin only');
  } finally {
    await seite.close();
  }
});

test('F2: der gemischte Standard zeigt keine Antwort und den einen Hinweis mit genau den Zonen, die heute unter Kleidung gedeckt werden; er folgt dem Speicher', async () => {
  const seite = await seiteMit({});
  try {
    expect(await seite.locator('#kleidung-frage [role=radio][aria-checked=true]').count()).toBe(0);
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toHaveCount(1);
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toHaveText(kleidungHinweis(STANDARD.zonen));
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toContainText('Genitals');
    await expect(seite.locator('#kleidung-frage .v-hinweis')).not.toContainText('Breasts');
    // Aenderung von aussen: Brueste auch bedeckt, der Hinweis zeichnet neu und nennt beide
    await schreibe(seite, { einstellungen: { version: 1, zonen: { ...STANDARD.zonen, breast: { an: true, bedeckt: true } } } });
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toContainText('Breasts, Genitals');
    // Alle sechs bedeckt: eine Antwort ist markiert, kein Hinweis mehr
    await schreibe(seite, { einstellungen: { version: 1, zonen: alleZonen(true, true) } });
    await expect.poll(() => markiert(seite, 'kleidung-frage')).toContain('Under clothes too');
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toHaveCount(0);
  } finally {
    await seite.close();
  }
});

// ---------- F3: Stufen mit Namen ----------
const STUFEN = [
  { wahl: 'stimmung-wahl', pfad: (e: any) => e.schwelle, zwischen: 0.1049, zahl: '0.1049', stufen: [['Very suspicious', 0.1], ['Suspicious', 0.15], ['Relaxed', 0.22]] as const },
  { wahl: 'verweigern-wahl', pfad: (e: any) => e.quiz.verweigern, zwischen: 0.123, zahl: '12.3%', stufen: [['Never', 0], ['Sometimes', 0.1], ['Often', 0.25]] as const },
  { wahl: 'freilegen-wahl', pfad: (e: any) => e.quiz.freilegenMs, zwischen: 7500, zahl: '7.5 s', stufen: [['Short', 5000], ['Medium', 10000], ['Long', 20000]] as const },
  { wahl: 'lautstaerke-wahl', pfad: (e: any) => e.ton.lautstaerke, zwischen: 0.45, zahl: '45%', stufen: [['Soft', 0.3], ['Medium', 0.6], ['Loud', 0.9]] as const },
];

test('F3: ein gespeicherter Zwischenwert zeigt keine Stufe, "Exact value" ist offen und zeigt die Zahl genau, nichts wird geschrieben; eine Stufe schreibt ihren Wert', async () => {
  const seite = await seiteMit({ einstellungen: ZWISCHEN, pack: PACK_VOLL }, 1280, true);
  try {
    await expect(seite.locator('#stimmung-wert')).toHaveText(stimmungsWort(0.1049));
    for (const s of STUFEN) {
      expect(await markiert(seite, s.wahl), `${s.wahl}: keine Stufe markiert`).toBeNull();
      await expect(seite.locator(`#${s.wahl} .v-aufklapper .v-auf-kopf`), `${s.wahl}: Exact value offen`).toHaveAttribute('aria-expanded', 'true');
      await expect(seite.locator(`#${s.wahl} .v-wert`), `${s.wahl}: Zahl genau`).toHaveText(s.zahl);
    }
    await seite.waitForTimeout(500);
    expect(await aufrufe(seite), 'Anzeigen schreibt nichts').toBe('');
    const e0 = await einst(seite);
    for (const s of STUFEN) expect(s.pfad(e0), s.wahl).toBeCloseTo(s.zwischen, 9);
    // Eine Stufe waehlen schreibt genau ihren Wert und schliesst "Exact value"
    for (const s of STUFEN) {
      const [name, wert] = s.stufen[2];
      await stufenKnopf(seite, s.wahl, name).click();
      await expect.poll(async () => s.pfad(await einst(seite)), s.wahl).toBeCloseTo(wert, 9);
      expect(await markiert(seite, s.wahl)).toBe(name);
      await expect(seite.locator(`#${s.wahl} .v-aufklapper .v-auf-kopf`)).toHaveAttribute('aria-expanded', 'false');
    }
    // Neu laden: alle drei Stufen markiert
    await neuLaden(seite, PACK_VOLL);
    for (const s of STUFEN) expect(await markiert(seite, s.wahl), s.wahl).toBe(s.stufen[2][0]);
  } finally {
    await seite.close();
  }
});

test('F3: Aenderung von aussen (Speicher direkt schreiben) zeichnet alle neu: Stufen, Karten, Gruppe der Erwachsenenseiten, Wort im Kopf', async () => {
  const seite = await seiteMit({ pack: PACK_VOLL });
  try {
    await schreibe(seite, {
      einstellungen: {
        version: 1,
        schwelle: 0.22,
        quiz: { verweigern: 0, freilegenMs: 20000 },
        ton: { an: false, lautstaerke: 0.3 },
        zonen: { ...alleZonen(true, true) },
        erwachsen: { ...STANDARD.erwachsen, an: false, stufe: 'explicit' },
      },
    });
    await expect.poll(() => markiert(seite, 'stimmung-wahl')).toBe('Relaxed');
    await expect(seite.locator('#stimmung-wert')).toHaveText(stimmungsWort(0.22));
    expect(await markiert(seite, 'verweigern-wahl')).toBe('Never');
    expect(await markiert(seite, 'freilegen-wahl')).toBe('Long');
    expect(await markiert(seite, 'lautstaerke-wahl')).toBe('Soft');
    expect(await markiert(seite, 'zonen-wahl')).toContain('Everything');
    expect(await markiert(seite, 'kleidung-frage')).toContain('Under clothes too');
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Off');
    await schreibe(seite, { einstellungen: { version: 1, erwachsen: { ...STANDARD.erwachsen, an: true, stufe: 'explicit' } } });
    await expect.poll(() => markiert(seite, 'erw-stufe-wahl')).toContain('Explicit');
  } finally {
    await seite.close();
  }
});

// ---------- F4: Gruppe der Erwachsenenseiten ----------
test('F4: Off schreibt nur an: false und laesst die Stufe stehen, eine Stufe schreibt an: true und die Stufe; neu laden zeigt den Stand', async () => {
  const seite = await seiteMit({ pack: PACK_VOLL, einstellungen: { version: 1, erwachsen: { ...STANDARD.erwachsen, stufe: 'explicit', komplettErsatz: true, eigeneSeiten: ['a.example'] } } });
  try {
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Explicit');
    await stufenKnopf(seite, 'erw-stufe-wahl', 'Off').click();
    await expect.poll(async () => (await einst(seite)).erwachsen.an).toBe(false);
    let e = (await einst(seite)).erwachsen;
    expect(e.stufe).toBe('explicit');
    expect(e.komplettErsatz).toBe(true);
    expect(e.eigeneSeiten).toEqual(['a.example']);
    await neuLaden(seite, PACK_VOLL);
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Off');
    await stufenKnopf(seite, 'erw-stufe-wahl', 'Tease').click();
    await expect.poll(async () => (await einst(seite)).erwachsen.an).toBe(true);
    e = (await einst(seite)).erwachsen;
    expect(e.stufe).toBe('tease');
    expect(e.komplettErsatz).toBe(true);
    await neuLaden(seite, PACK_VOLL);
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Tease');
  } finally {
    await seite.close();
  }
});

// ---------- G1: ohne Freischaltung bleibt `an` an UND aus schaltbar ----------
const EXPLICIT = { version: 1, erwachsen: { ...STANDARD.erwachsen, stufe: 'explicit' } };
const OHNE_FREISCHALTUNG: [string, unknown][] = [['ohne Pack', undefined], ['Pack ohne erwachsen:vorschau', packMit(['erwachsen:quiz'])]];
for (const [name, pack] of OHNE_FREISCHALTUNG) {
  test(`G1: ${name}: Off und On waehlbar (schreiben nur an), die Stufe bleibt, Tease, Hot, Explicit gesperrt und nie markiert, Klick, Enter und Leertaste darauf schreiben nichts`, async () => {
    const seite = await seiteMit({ einstellungen: EXPLICIT, ...(pack ? { pack } : {}) }, 1280, true);
    try {
      await oeffneZugeklapptes(seite); // ohne Pack steht Adult sites zugeklappt ("Set them now"), wie die Person aufklappen
      await reiter(seite, 'Adult sites');
      // Form ohne Freischaltung: fuenf Karten, gespeichertes an: true zeigt On markiert, KEINE Stufe markiert
      await expect(seite.locator('#erw-stufe-wahl [role=radio]')).toHaveCount(5);
      expect(await markiert(seite, 'erw-stufe-wahl')).toContain('On');
      for (const n of ['Tease', 'Hot', 'Explicit']) await expect(stufenKnopf(seite, 'erw-stufe-wahl', n)).toBeDisabled();
      for (const n of ['Off', 'On']) await expect(stufenKnopf(seite, 'erw-stufe-wahl', n)).toBeEnabled();
      await expect(seite.locator('#erw-stufe-wahl .v-hinweis')).toContainText('Mia Pack');
      // eine gesperrte Stufe: Klick (erzwungen), Enter und Leertaste schreiben nichts, der Fokus kommt nie auf sie
      await stufenKnopf(seite, 'erw-stufe-wahl', 'Explicit').click({ force: true }).catch(() => undefined);
      await seite.evaluate(() => (document.querySelector('#erw-stufe-wahl [role=radio][data-id=off]') as HTMLElement).focus());
      for (const t of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'End', 'Home', 'ArrowLeft']) {
        await seite.keyboard.press(t);
        expect(await seite.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.id ?? ''), `Fokus nach ${t}`).toMatch(/^(off|on)$/);
      }
      await seite.waitForTimeout(300);
      expect(await aufrufe(seite), 'gesperrte Stufe: nichts geschrieben').toBe('');
      expect((await einst(seite)).erwachsen.stufe).toBe('explicit');
      // Off schreibt nur an: false, die Stufe bleibt; On schreibt nur an: true
      await stufenKnopf(seite, 'erw-stufe-wahl', 'Off').click();
      await expect.poll(async () => (await einst(seite)).erwachsen.an).toBe(false);
      let e = (await einst(seite)).erwachsen;
      expect(e.stufe).toBe('explicit');
      expect(e.komplettErsatz).toBe(false);
      expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Off');
      await expect(seite.locator('#erw-ersatz')).toBeDisabled();
      await stufenKnopf(seite, 'erw-stufe-wahl', 'On').click();
      await expect.poll(async () => (await einst(seite)).erwachsen.an).toBe(true);
      e = (await einst(seite)).erwachsen;
      expect(e.stufe).toBe('explicit');
      expect(await markiert(seite, 'erw-stufe-wahl')).toContain('On');
      await expect(seite.locator('#erw-ersatz')).toBeEnabled();
      // neu laden: On bleibt markiert, keine Stufe
      await neuLaden(seite, pack);
      await reiter(seite, 'Adult sites');
      expect(await markiert(seite, 'erw-stufe-wahl')).toContain('On');
    } finally {
      await seite.close();
    }
  });
}

test('G1: kommt oder geht die Freischaltung bei offener Seite, wird nur neu gezeichnet, nie geschrieben (zwei Formen der Gruppe)', async () => {
  const seite = await seiteMit({ einstellungen: EXPLICIT }, 1280, true);
  try {
    await reiter(seite, 'Adult sites');
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('On');
    const gespeichert = JSON.stringify(await einst(seite));
    await mitPack(seite, PACK_VOLL); // Schreiben des Tests, nicht gezaehlt
    await expect(seite.locator('#erw-stufe-wahl [role=radio]')).toHaveCount(4);
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Explicit'); // mit Freischaltung zeigt die Gruppe die gespeicherte Stufe
    for (const n of ['Tease', 'Hot', 'Explicit']) await expect(stufenKnopf(seite, 'erw-stufe-wahl', n)).toBeEnabled();
    await expect(seite.locator('#erw-stufe-wahl [data-id=on]')).toHaveCount(0);
    // die Freischaltung geht wieder
    await seite.evaluate(() => {
      const sl = (globalThis as any).chrome.storage.local;
      return sl.__echtSet({ pack: null });
    });
    await expect(seite.locator('#erw-stufe-wahl [role=radio]')).toHaveCount(5);
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('On');
    await seite.waitForTimeout(400);
    expect(await aufrufe(seite), 'Wechsel der Form schreibt nichts').toBe('');
    expect(JSON.stringify(await einst(seite))).toBe(gespeichert);
  } finally {
    await seite.close();
  }
});

// ---------- G2: ein Regler, der den Fokus verliert, zeichnet den gespeicherten Stand ----------
test('G2: verliert ein Regler "Exact value" den Fokus, steht der gespeicherte Stand da (Regler und Stufen, alle vier Stufenwahlen), nichts wird geschrieben', async () => {
  const seite = await seiteMit({ einstellungen: ZWISCHEN, pack: PACK_VOLL }, 1280, true);
  try {
    for (const s of STUFEN) {
      const [name, wert] = s.stufen[0];
      const regler = `#${s.wahl} input[type=range]`;
      await seite.locator(regler).focus();
      // der gespeicherte Stand aendert sich von aussen, solange der Regler den Fokus hat (nicht gezaehltes Schreiben des Tests)
      await seite.evaluate(async ([k, w, pfad]) => {
        const sl = (globalThis as any).chrome.storage.local;
        const e = (await sl.get('einstellungen')).einstellungen;
        const neu = JSON.parse(JSON.stringify(e));
        const ziel = pfad === 'schwelle' ? neu : pfad === 'ton' ? neu.ton : neu.quiz;
        ziel[k] = w;
        await sl.__echtSet({ einstellungen: neu });
      }, [s.wahl === 'stimmung-wahl' ? 'schwelle' : s.wahl === 'verweigern-wahl' ? 'verweigern' : s.wahl === 'freilegen-wahl' ? 'freilegenMs' : 'lautstaerke', wert, s.wahl === 'stimmung-wahl' ? 'schwelle' : s.wahl === 'lautstaerke-wahl' ? 'ton' : 'quiz'] as const);
      await seite.waitForTimeout(300);
      await seite.evaluate((css) => (document.querySelector(css) as HTMLElement).blur(), regler);
      await expect.poll(() => markiert(seite, s.wahl), `${s.wahl}: nach dem Verlassen steht der gespeicherte Stand da`).toBe(name);
      expect(Number(await seite.locator(regler).inputValue()), `${s.wahl}: Reglerwert`).toBeCloseTo(wert, 9);
    }
    await seite.waitForTimeout(300);
    expect(await aufrufe(seite), 'das Verlassen schreibt nichts').toBe('');
  } finally {
    await seite.close();
  }
});

// ---------- G3: eine verworfene Zonen-Handlung zeigt einen Hinweis, kein zweiter Versuch ----------
test('G3: aendert sich der gespeicherte Stand zwischen Anzeige und Klick, wird nichts geschrieben, der Hinweis steht da und der gespeicherte Stand wird angezeigt; die naechste Handlung nimmt ihn weg', async () => {
  const seite = await seiteMit({}, 1280, true);
  try {
    await zonenChip(seite, 'eyes'); // Aufklapper offen
    await expect(seite.locator('#zonen-verworfen')).toBeHidden();
    // Der Stand aendert sich von aussen und im selben Augenblick klickt die Person auf den Chip (vor dem Ereignis des Speichers)
    await seite.evaluate((neu) => {
      const sl = (globalThis as any).chrome.storage.local;
      void sl.__echtSet({ einstellungen: neu });
      (document.querySelector('#zonen-wahl .v-chip[data-zone=eyes]') as HTMLElement).click();
    }, { version: 1, zonen: alleZonen(true, true) });
    await expect(seite.locator('#zonen-verworfen')).toBeVisible();
    await expect(seite.locator('#zonen-verworfen')).toHaveText(ZONEN_VERWORFEN);
    // nichts geschrieben: der gespeicherte Stand ist der von aussen, kein zweiter Versuch auf dem neuen Stand
    expect(await aufrufe(seite), 'die verworfene Handlung schreibt nichts').toBe('');
    const z = (await einst(seite)).zonen;
    for (const [k, v] of Object.entries(alleZonen(true, true) as Record<string, any>)) expect(z[k], k).toEqual(v); // der Stand von aussen, nicht der des Klicks
    expect(await markiert(seite, 'zonen-wahl')).toContain('Everything'); // der gespeicherte Stand wird angezeigt
    await expect(seite.locator('#zonen-wahl .v-auf-stand')).toHaveText('10 of 10 on');
    await expect(await zonenChip(seite, 'eyes')).toHaveAttribute('aria-pressed', 'true');
    // die naechste Handlung nimmt den Hinweis weg
    await (await zonenChip(seite, 'mouth')).click();
    await expect(seite.locator('#zonen-verworfen')).toBeHidden();
    await expect.poll(async () => (await einst(seite)).zonen.mouth.an).toBe(false);
  } finally {
    await seite.close();
  }
});

// ---------- F5: Speicherfehler ----------
const speichernKaputt = (seite: Page, kaputt: boolean) =>
  seite.evaluate((kaputt) => {
    const sl = (globalThis as any).chrome.storage.local;
    sl.__echtSet ??= sl.set.bind(sl);
    sl.set = (o: Record<string, unknown>) => (kaputt && 'einstellungen' in o ? Promise.reject(new Error('Test: Speichern scheitert')) : sl.__echtSet(o));
  }, kaputt);

test('F5: scheitert das Speichern, zeigen Karte, Chips, Kleidungsfrage und Stufen wieder den gespeicherten Stand und die Leiste den Fehlersatz', async () => {
  const seite = await seiteMit({ einstellungen: ZWISCHEN, pack: PACK_VOLL });
  try {
    const gespeichert = JSON.stringify(await einst(seite));
    await speichernKaputt(seite, true);
    const meldung = seite.locator('#speicher-meldung');
    const pruefeZurueck = async (name: string) => {
      await expect(meldung, name).toHaveText(FEHLER_SPEICHERN);
      expect(JSON.stringify(await einst(seite)), `${name}: nichts gespeichert`).toBe(gespeichert);
    };
    const vorherKarte = await markiert(seite, 'zonen-wahl');
    await stufenKnopf(seite, 'zonen-wahl', 'Everything').click();
    await pruefeZurueck('Karte');
    await expect.poll(() => markiert(seite, 'zonen-wahl'), 'Karte zurueck').toBe(vorherKarte);
    await expect(seite.locator('#zonen-wahl .v-auf-stand')).toHaveText('3 of 10 on');
    await (await zonenChip(seite, 'eyes')).click();
    await expect(await zonenChip(seite, 'eyes')).toHaveAttribute('aria-pressed', 'false');
    await stufenKnopf(seite, 'kleidung-frage', 'Under clothes too').click();
    await expect.poll(() => markiert(seite, 'kleidung-frage'), 'Frage zurueck').toBeNull();
    await expect(seite.locator('#kleidung-frage .v-hinweis')).toContainText('Genitals');
    for (const s of STUFEN) {
      await stufenKnopf(seite, s.wahl, s.stufen[0][0]).click();
      await expect.poll(() => markiert(seite, s.wahl), `${s.wahl} zurueck`).toBeNull();
      await expect(seite.locator(`#${s.wahl} .v-wert`)).toHaveText(s.zahl);
    }
    await pruefeZurueck('Stufen');
    await speichernKaputt(seite, false);
  } finally {
    await seite.close();
  }
});

// ---------- F6: Tab-Halt (NN1) und das "?" ----------
test('NN1: der Tab-Halt einer Gruppe liegt nach dem Verlassen wieder auf der gewaehlten Stufe, ist keine gewaehlt, auf der ersten', async () => {
  const seite = await seiteMit({ pack: PACK_VOLL });
  try {
    const halt = (wahl: string) => seite.evaluate((w) => [...document.querySelectorAll<HTMLElement>(`#${w} [role=radio]`)].map((k) => k.tabIndex), wahl);
    await reiter(seite, 'Adult sites');
    // gewaehlt: Hot (Index 2 von Off, Tease, Hot, Explicit)
    expect(await halt('erw-stufe-wahl')).toEqual([-1, -1, 0, -1]);
    await stufenKnopf(seite, 'erw-stufe-wahl', 'Hot').focus();
    await seite.keyboard.press('ArrowRight'); // Fokus auf Explicit, Halt wandert mit dem Fokus
    expect(await halt('erw-stufe-wahl')).toEqual([-1, -1, -1, 0]);
    expect(await markiert(seite, 'erw-stufe-wahl')).toContain('Hot'); // gewaehlt ist noch nichts
    await seite.keyboard.press('Tab'); // verlaesst die Gruppe
    expect(await halt('erw-stufe-wahl')).toEqual([-1, -1, 0, -1]);
    // keine gewaehlt: die Kleidungsfrage (Standard gemischt), der Halt liegt nach dem Verlassen auf der ersten Antwort
    await reiter(seite, 'What I cover');
    expect(await halt('kleidung-frage')).toEqual([0, -1]);
    await seite.locator('#kleidung-frage [role=radio]').first().focus();
    await seite.keyboard.press('ArrowRight');
    expect(await halt('kleidung-frage')).toEqual([-1, 0]);
    await seite.keyboard.press('Tab');
    await seite.keyboard.press('Tab');
    expect(await halt('kleidung-frage')).toEqual([0, -1]);
    expect(await markiert(seite, 'kleidung-frage')).toBeNull();
  } finally {
    await seite.close();
  }
});

test('F6: die Trefferflaeche jedes "?" ueberdeckt nichts Bedienbares und wird selbst von nichts ueberdeckt (elementFromPoint, alle Reiter, 360 und 1280 px)', async () => {
  for (const breite of [360, 1280]) {
    const seite = await seiteMit({ pack: PACK_VOLL }, breite);
    try {
      let gesehen = 0;
      for (const r of REITER) {
        await reiter(seite, r as never);
        await oeffneAlle(seite, '[role=tabpanel]:not([hidden]) .v-auf-kopf[aria-expanded=false]');
        // Auch mit offener Erklaerung (der Text darunter darf nichts verdecken)
        await oeffneAlle(seite, '[role=tabpanel]:not([hidden]) .v-frage[aria-expanded=false]');
        const m = await seite.evaluate(() => {
          const BEDIENBAR = 'button, input, select, textarea, a[href], [role=radio], [role=switch], [role=tab], [tabindex]:not([tabindex="-1"])';
          const fehler: string[] = [];
          let n = 0;
          for (const f of document.querySelectorAll<HTMLElement>('[role=tabpanel]:not([hidden]) .v-frage')) {
            n += 1;
            f.scrollIntoView({ block: 'center' });
            const r = f.getBoundingClientRect();
            if (r.width < 43.5 || r.height < 43.5) fehler.push(`"?" ${Math.round(r.width)}x${Math.round(r.height)}`);
            for (const fx of [0.1, 0.5, 0.9]) {
              for (const fy of [0.1, 0.5, 0.9]) {
                const x = r.left + r.width * fx;
                const y = r.top + r.height * fy;
                const stapel = document.elementsFromPoint(x, y) as HTMLElement[];
                const ich = stapel.findIndex((e) => e === f || f.contains(e));
                if (ich !== 0) fehler.push(`"?" bei (${fx}, ${fy}) liegt nicht oben, oben: ${stapel[0]?.className || stapel[0]?.tagName}`);
                for (const e of stapel.slice(ich + 1)) {
                  if (!e.matches(BEDIENBAR) || e.contains(f)) continue;
                  fehler.push(`"?" ueberdeckt ${e.tagName.toLowerCase()}.${e.className} bei (${fx}, ${fy})`);
                }
              }
            }
          }
          return { n, fehler };
        });
        gesehen += m.n;
        expect(m.fehler, `${breite} px, ${r}`).toEqual([]);
      }
      expect(gesehen, `${breite} px: es gibt "?" auf der Seite`).toBeGreaterThanOrEqual(2);
    } finally {
      await seite.close();
    }
  }
});

// ---------- Fingerziel ----------
test('Fingerziel 44 px bei 360 und 1280 px in jedem Reiter: Stufen, Karten, Chips, "?", Aufklapper und Regler, alle Aufklapper offen', async () => {
  for (const breite of [360, 1280]) {
    const seite = await seiteMit({ pack: PACK_VOLL, einstellungen: ZWISCHEN }, breite);
    try {
      const gesamt: Record<string, number> = {};
      for (const r of REITER) {
        await reiter(seite, r as never);
        await oeffneAlle(seite, '[role=tabpanel]:not([hidden]) .v-auf-kopf[aria-expanded=false]');
        const je = await seite.evaluate(() => {
          const out: { art: string; b: number; h: number; text: string }[] = [];
          for (const e of document.querySelectorAll<HTMLElement>('[role=tabpanel]:not([hidden]) :is(.v-stufe, .v-wahl-karte, .v-chip, .v-frage, .v-auf-kopf, .v-regler-eingabe)')) {
            if (e.getClientRects().length === 0) continue;
            const b = e.getBoundingClientRect();
            out.push({ art: String(e.className).split(' ')[0] as string, b: b.width, h: b.height, text: (e.textContent ?? '').slice(0, 20) });
          }
          return out;
        });
        for (const k of je) {
          gesamt[k.art] = (gesamt[k.art] ?? 0) + 1;
          expect(k.h, `${breite} px, ${r}: ${k.art} "${k.text}" Hoehe`).toBeGreaterThanOrEqual(43.5);
          expect(k.b, `${breite} px, ${r}: ${k.art} "${k.text}" Breite`).toBeGreaterThanOrEqual(43.5);
        }
      }
      console.log(`bedienung: Fingerziel bei ${breite} px, gemessene Elemente ${JSON.stringify(gesamt)}`);
      for (const art of ['v-stufe', 'v-wahl-karte', 'v-chip', 'v-frage', 'v-auf-kopf', 'v-regler-eingabe']) expect(gesamt[art] ?? 0, `${breite} px: ${art} gemessen`).toBeGreaterThan(0);
    } finally {
      await seite.close();
    }
  }
});

// ---------- F7: kein alter Schalter bleibt im Dokument ----------
test('F7: kein alter Schalter und kein altes Kaestchen im Dokument, auch nicht verborgen (alle Panels, ohne und mit Pack)', async () => {
  const seite = await seiteMit({});
  try {
    for (const zustand of ['ohne Pack', 'mit Pack']) {
      if (zustand === 'mit Pack') await schreibe(seite, { pack: PACK_VOLL });
      const alt = await seite.evaluate(() =>
        ['#zonen', '[data-bedeckt]', 'input[data-zone]', '#stimmung', '#verweigern', '#freilegen', '#erw-an', '#ton-lautstaerke', 'input[name=stufe]', '#stufe-wahl', '#stufe-gesperrt', '.auch']
          .filter((s) => document.querySelector(s))
          .map((s) => `${s}: ${document.querySelectorAll(s).length}`),
      );
      expect(alt, `alte Elemente ${zustand}`).toEqual([]);
    }
  } finally {
    await seite.close();
  }
});
