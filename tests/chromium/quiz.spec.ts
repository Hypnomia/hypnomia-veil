// Chromium: Quiz-Riegel (Auftrag Q, PHASE-4-BAUPLAN Abschnitt 8). Riegel oeffnet ueber den Testhaken `veil-test` (kein Video noetig), Abbild in
// data-veil-riegel (Shadow Root bleibt geschlossen). Dummy-Pack mit synthetischer Quiz-Bank, ueber die Einstellungsseite importiert.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);
const basis = `http://127.0.0.1:${port}`;

const bauModul = '../../scripts/pack/baue-pack.mjs';
const inhaltModul = '../../scripts/pack/dummy-inhalte.mjs';
const SEITE = `${basis}/quiz-tasten.html`;

test.describe.configure({ mode: 'serial' });

let profil: string | undefined;
let ordner: string;
let packPfad: string;
let context: BrowserContext;
let erweiterungsId = '';
let quiz: { fragen: any[] };
// Zusatzfragen fuer die Aufgaben, die die Dummy-Bank nicht enthaelt (nur im Test; das Dummy-Pack selbst bleibt unveraendert).
const EXTRA = [
  { id: 'ext-z', art: 'aufgabe', schwere: 'mittel', geraet: 'beide', frage: 'Count every POP.', aufgabe: { typ: 'zaehlen', param: { wort: 'POP', woerter: 'POP,DOWN,OBEY,pink', anzahlWoerter: 8 } } },
  { id: 'ext-b', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'One word flashes once. Type it.', aufgabe: { typ: 'wort-blitz', param: { wort: 'OBEY' } } },
  { id: 'ext-c', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'Count down for me.', aufgabe: { typ: 'countdown', param: { von: 5, wort: 'DOWN' } } },
  { id: 'ext-k', art: 'aufgabe', schwere: 'mittel', geraet: 'desktop', frage: 'Keep the cursor inside the circle.', aufgabe: { typ: 'im-kreis', param: { sekunden: 3 } } },
  { id: 'ext-t', art: 'aufgabe', schwere: 'mittel', geraet: 'desktop', frage: 'Type the word in my rhythm.', aufgabe: { typ: 'buchstaben-takt', param: { wort: 'OBEY' } } },
  { id: 'ext-p', art: 'aufgabe', schwere: 'mittel', geraet: 'desktop', frage: 'Click only when the word turns pink.', aufgabe: { typ: 'pink-klicken', param: { woerter: 'POP,DOWN,OBEY,SLEEP', anzahlWoerter: 5, wortMs: 1000 } } },
  { id: 'ext-l', art: 'aufgabe', schwere: 'mittel', geraet: 'desktop', frage: 'Hold the space bar until I say now.', aufgabe: { typ: 'leertaste-halten', param: { sekunden: 2 } } },
  { id: 'ext-w', art: 'aufgabe', schwere: 'fies', geraet: 'beide', frage: 'Do not click the button.', aufgabe: { typ: 'widerstehen', param: { sekunden: 3 } } },
  { id: 'ext-r', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'Unscramble my favorite word.', aufgabe: { typ: 'buchstaben-raetsel', param: { wort: 'OBEY', gemischt: 'B E O Y' } } },
];
const mitteVon = (r: any) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
let texte: { gruppen: Record<string, string[]> };

type Abbild = any;
const abbild = async (seite: Page): Promise<Abbild | null> =>
  seite.evaluate(() => {
    const a = document.documentElement.getAttribute('data-veil-riegel');
    return a ? JSON.parse(a) : null;
  });
const ergebnis = (seite: Page) => seite.evaluate(() => document.documentElement.getAttribute('data-veil-riegel-ergebnis'));
const oeffne = (seite: Page, o: Record<string, unknown>) =>
  seite.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { oeffne: o } });
const einstellung = (seite: Page, teil: Record<string, unknown>) =>
  seite.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { einstellungen: teil });
async function bis(seite: Page, prueft: (a: Abbild) => boolean, frist = 8000): Promise<Abbild> {
  let letzter: Abbild | null = null;
  await expect
    .poll(
      async () => {
        letzter = await abbild(seite);
        return !!letzter && prueft(letzter);
      },
      { timeout: frist, intervals: [50] },
    )
    .toBe(true);
  return letzter;
}
const mitte = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
async function klickeAuf(seite: Page, r: { x: number; y: number; w: number; h: number }) {
  const m = mitte(r);
  await seite.mouse.click(m.x, m.y);
}
const tasten = (seite: Page) =>
  seite.evaluate(() => {
    const t = (window as any).tasten as { f: number; m: number; leer: number };
    return { f: t.f, m: t.m, leer: t.leer };
  });
const extSeite = async () => {
  const s = await context.newPage();
  await s.goto(`chrome-extension://${erweiterungsId}/options.html`);
  return s;
};
const speicher = (s: Page, k: string) => s.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);

// Loest die jeweils aktuelle Frage richtig (fuer Fragen, die ein Test nicht erzwingen kann).
async function loeseAktuelle(seite: Page): Promise<void> {
  const a = await bis(seite, (x) => x.zustand === 'frage' && !!x.frage);
  const f = quiz.fragen.find((q) => q.id === a.frage.id);
  if (f.art === 'wissen' || f.art === 'allgemein') {
    const ziel = a.antworten.find((b: any) => b.text === f.antworten[f.richtig]);
    await klickeAuf(seite, ziel);
  } else if (f.art === 'tippen') {
    await seite.keyboard.type(f.satz);
    await seite.keyboard.press('Enter');
  } else if (f.aufgabe.typ === 'wort-tippen') {
    await seite.keyboard.type(Array(f.aufgabe.param.anzahl).fill(f.aufgabe.param.wort).join(' '));
    await seite.keyboard.press('Enter');
  } else if (f.aufgabe.typ === 'klicken-zaehlen') {
    for (let i = 0; i < f.aufgabe.param.anzahl; i++) {
      await klickeAuf(seite, (await bis(seite, (x) => !!x.spirale)).spirale);
      await seite.waitForTimeout(f.aufgabe.param.abstandMs + 100);
    }
  } else if (f.aufgabe.typ === 'spirale-ansehen') {
    await seite.waitForTimeout(f.aufgabe.param.sekunden * 1000 + 600);
  } else if (f.aufgabe.typ === 'countdown') {
    const n = f.aufgabe.param.von;
    await seite.keyboard.type([...Array.from({ length: n }, (_, i) => String(n - i)), f.aufgabe.param.wort].join(' '));
    await seite.keyboard.press('Enter');
  } else if (f.aufgabe.typ === 'buchstaben-raetsel') {
    await seite.keyboard.type(f.aufgabe.param.wort);
    await seite.keyboard.press('Enter');
  } else if (f.aufgabe.typ === 'wort-blitz') {
    await bis(seite, (x) => !!x.eingabe);
    await seite.keyboard.type(f.aufgabe.param.wort);
    await seite.keyboard.press('Enter');
  } else if (f.aufgabe.typ === 'im-kreis') {
    const k = (await bis(seite, (x) => !!x.kreis)).kreis;
    const m = mitte(k);
    await seite.mouse.move(m.x, m.y);
    await seite.waitForTimeout(f.aufgabe.param.sekunden * 1000 + 800);
  } else if (f.aufgabe.typ === 'zaehlen') {
    await loeseZaehlen(seite);
  } else throw new Error(`nicht loesbar: ${f.id}`);
}

// Beobachtet die laufende Wortfolge (jedes Wort ist neu, nie zwei gleiche nebeneinander), zaehlt das Zielwort, tippt die Zahl.
async function beobachteFolge(seite: Page): Promise<{ woerter: string[]; abstaende: number[]; ziel: number }> {
  const woerter: string[] = [];
  const zeiten: number[] = [];
  let letzte = '';
  const ende = Date.now() + 20_000;
  while (Date.now() < ende) {
    const a = await abbild(seite);
    if (a?.eingabe) break;
    if (a?.wort && a.wort !== letzte) {
      woerter.push(a.wort);
      zeiten.push(Date.now());
    }
    letzte = a?.wort ?? letzte;
    await seite.waitForTimeout(25);
  }
  const abstaende = zeiten.slice(1).map((z, i) => z - zeiten[i]!);
  return { woerter, abstaende, ziel: woerter.filter((w) => w.toLowerCase() === 'pop').length };
}
async function loeseZaehlen(seite: Page): Promise<void> {
  const r = await beobachteFolge(seite);
  await seite.keyboard.type(String(r.ziel));
  await seite.keyboard.press('Enter');
}

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-quiz-'));
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-quiz-datei-'));
  packPfad = path.join(ordner, 'dummy.miapack');
  const bau = (await import(bauModul)) as { baueDummyPack(): Promise<{ bytes: Uint8Array }> };
  const inhalt0 = (await import(inhaltModul)) as { DUMMY_QUIZ: { fragen: any[] } };
  await writeFile(packPfad, (await (bau as any).baueDummyPack({ quiz: { version: 1, fragen: [...inhalt0.DUMMY_QUIZ.fragen, ...EXTRA] } })).bytes);
  const inhalt = (await import(inhaltModul)) as { DUMMY_QUIZ: { fragen: any[] }; DUMMY_TEXTE: { gruppen: Record<string, string[]> } };
  quiz = { fragen: [...inhalt.DUMMY_QUIZ.fragen, ...EXTRA] };
  texte = inhalt.DUMMY_TEXTE;
  context = await chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  erweiterungsId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (profil) await rm(profil, { recursive: true, force: true });
  if (ordner) await rm(ordner, { recursive: true, force: true });
});

async function frischeSeite(url = SEITE): Promise<Page> {
  const s = await context.newPage();
  await s.goto(url);
  // Das Content-Script haengt den Testhaken beim Start ein; kurz warten, bis die Seite reagiert.
  await expect.poll(() => s.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
  return s;
}

test('ohne Pack: kein Riegel, Ergebnis abgebrochen', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1' });
    await expect.poll(() => ergebnis(s), { timeout: 8000 }).toBe('abgebrochen');
    expect(await abbild(s)).toBeNull();
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
    console.log('chromium quiz: ohne Pack kein Riegel (abgebrochen)');
  } finally {
    await s.close();
  }
});

test('Pack importieren (Quiz-Bank und Saetze kommen aus IndexedDB)', async () => {
  const s = await extSeite();
  try {
    await s.locator('#datei').setInputFiles(packPfad);
    await s.locator('#annehmen').click();
    await expect(s.locator('#pack-titel')).toHaveText('Dummy pack (synthetic pictures)');
    // Warnung gilt fuer die meisten Tests als schon gesehen; der Warnungs-Test loescht den Merker.
    await s.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
    const antwort = await s.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'quiz' }));
    expect(antwort.ok).toBe(true);
    expect(antwort.daten.fragen.length).toBe(quiz.fragen.length);
    const t = await s.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' }));
    expect(t.daten.gruppen.start).toEqual(texte.gruppen.start);
    const unbekannt = await s.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'unsinn' }));
    expect(unbekannt.daten).toBeNull();
  } finally {
    await s.close();
  }
});

test('Erster Riegel je Installation erklaert sich (Zeile mit Link zur Hilfe), danach nur das "?" in der Fusszeile; beide fuehren zur Hilfe-Seite', async () => {
  const hilfe = `chrome-extension://${erweiterungsId}/hilfe.html#quiz`;
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1' });
    const a = await bis(s, (x) => x.offen && x.zustand === 'frage');
    expect(a.erklaerung).toBe('First time? On adult sites I quiz you before videos and reveals. Pause Mia, top right, always lets you out. How my quiz works');
    expect(a.hilfeHref).toBe(hilfe);
    expect(a.hilfe.w, '? mindestens 24 breit').toBeGreaterThanOrEqual(24);
    expect(a.hilfe.h, '? mindestens 24 hoch').toBeGreaterThanOrEqual(24);
    // Zeile liegt in der Karte und unter der Frage
    expect(a.erklaerungBox.y).toBeGreaterThan(a.antworten[0].y);
    expect(a.erklaerungBox.x + a.erklaerungBox.w).toBeLessThanOrEqual(a.karte.x + a.karte.w + 1);
    expect(a.pause.y, 'Pause bleibt oben').toBeLessThan(a.karte.y + 80);
    // Der Link in der Zeile oeffnet die Hilfe in einem neuen Tab
    const [neu] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), s.evaluate(() => 0).then(() => clickErklaerung(s, a))]);
    await neu.waitForLoadState('domcontentloaded').catch(() => undefined);
    console.log(`chromium quiz: Hilfe-Link der Zeile oeffnet ${neu.url()}`);
    expect(neu.url()).toBe(hilfe);
    await neu.close();
  } finally {
    await s.close();
  }
  // Zweiter Riegel: keine Zeile mehr, das "?" bleibt und fuehrt ebenfalls zur Hilfe
  const t = await frischeSeite();
  try {
    await oeffne(t, { frage: 'test-w1' });
    const b = await bis(t, (x) => x.offen && x.zustand === 'frage');
    expect(b.erklaerung).toBeNull();
    expect(b.hilfeHref).toBe(hilfe);
    const [neu] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), t.mouse.click(b.hilfe.x + b.hilfe.w / 2, b.hilfe.y + b.hilfe.h / 2)]);
    await neu.waitForLoadState('domcontentloaded').catch(() => undefined);
    expect(neu.url()).toBe(hilfe);
    await neu.close();
  } finally {
    await t.close();
  }
});

// Session 18 (Entscheidung 185): beim ersten Riegel auf einem kleinen Anker schob die Erklaerzeile die unterste Antwort unter die sichtbare
// Kante des Rollbereichs. Jetzt liegen alle Antworten ohne Rollen im Blick; die Zeile folgt darunter (notfalls erst nach dem Rollen).
test('Erster Riegel auf kleinem Anker (320 x 480): alle Antworten liegen ohne Rollen im Blick, die Erklaerzeile darunter', async () => {
  const e = await extSeite();
  await e.evaluate(() => (globalThis as any).chrome.storage.local.remove('riegelErklaert'));
  await e.close();
  const s = await frischeSeite();
  try {
    await s.evaluate(() => {
      const p = document.querySelector('#player') as HTMLElement;
      p.style.width = '320px';
      p.style.height = '480px';
    });
    await oeffne(s, { frage: 'test-w1', anker: '#player' });
    const a = await bis(s, (x) => x.offen && x.zustand === 'frage' && x.antworten.length === 3 && !!x.erklaerung);
    await s.waitForTimeout(300);
    const b = await bis(s, (x) => x.offen && x.zustand === 'frage');
    expect(b.host.h, 'Riegel auf dem Anker').toBeLessThan(500);
    for (const k of b.antworten) {
      expect(k.y, `${k.text} oben im Blick`).toBeGreaterThanOrEqual(b.scrollBox.y - 1);
      expect(k.y + k.h, `${k.text} unten im Blick`).toBeLessThanOrEqual(b.scrollBox.y + b.scrollBox.h + 1);
    }
    expect(b.erklaerungBox.y, 'Erklaerzeile unter den Antworten').toBeGreaterThan(b.antworten[b.antworten.length - 1]!.y);
    expect(a.erklaerung).toContain('First time?');
    // Der Link in der Zeile bleibt bedienbar: in den Blick rollen, klicken, die Hilfe oeffnet sich
    await s.mouse.move(b.scrollBox.x + b.scrollBox.w / 2, b.scrollBox.y + b.scrollBox.h / 2);
    await s.mouse.wheel(0, 600);
    await s.waitForTimeout(400);
    const c = await bis(s, (x) => x.offen && !!x.erklaerungLink && x.erklaerungLink.y + x.erklaerungLink.h <= x.scrollBox.y + x.scrollBox.h + 1);
    const [neu] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), clickErklaerung(s, c)]);
    await neu.waitForLoadState('domcontentloaded').catch(() => undefined);
    expect(neu.url()).toBe(`chrome-extension://${erweiterungsId}/hilfe.html#quiz`);
    await neu.close();
  } finally {
    await s.close();
  }
});

async function clickErklaerung(s: Page, a: any): Promise<void> {
  // Der Link "How my quiz works" steht am Ende der Zeile.
  await s.mouse.click(a.erklaerungLink.x + a.erklaerungLink.w / 2, a.erklaerungLink.y + a.erklaerungLink.h / 2);
}

test('Riegel oeffnet: geschlossene Shadow Root, Pause-Knopf sichtbar, Fokus im Riegel, Chibi-Platz mit Pose', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1' });
    const a = await bis(s, (x) => x.offen && x.zustand === 'frage');
    expect(a.frage.id).toBe('test-w1');
    expect(a.satz).toBe(texte.gruppen.start![0]);
    expect(a.pause.w).toBeGreaterThan(40);
    expect(a.pause.h).toBeGreaterThanOrEqual(40);
    expect(a.antworten.map((b: any) => b.text).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(a.chibiPose).toBe('sprechblase');
    expect(a.fokusImRiegel).toBe(true);
    expect(a.host.w).toBeGreaterThan(300);
    expect(a.kartenFarbe).toContain('gradient');
    // Shadow Root ist fuer die Seite nicht erreichbar
    const hostInfo = await s.evaluate(() => {
      const h = document.querySelector('[data-veil-riegel-host]') as HTMLElement | null;
      return h ? { schatten: h.shadowRoot === null, popover: h.matches(':popover-open'), z: getComputedStyle(h).zIndex } : null;
    });
    expect(hostInfo).toEqual({ schatten: true, popover: true, z: '2147483647' });
    console.log(`chromium quiz: Riegel offen, Shadow Root geschlossen, Popover offen, Host ${a.host.w}x${a.host.h}`);
  } finally {
    await s.close();
  }
});

test('richtige Antwort loest (Mias Satz, Pose jubeln), Seite danach wieder frei', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0, richtigMs: 300 });
    const a = await bis(s, (x) => x.zustand === 'frage');
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'alpha'));
    const r = await bis(s, (x) => x.zustand === 'richtig');
    expect(r.satz).toBe(texte.gruppen.richtig![0]);
    expect(r.chibiPose).toBe('jubeln');
    expect(r.pause.w).toBeGreaterThan(0); // Pause bleibt auch jetzt sichtbar
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
  } finally {
    await s.close();
  }
});

test('falsche Antwort: sofort neue Frage ohne Wartezeit, Riegel bleibt offen', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0 });
    const a = await bis(s, (x) => x.zustand === 'frage');
    const t0 = Date.now();
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'beta'));
    const b = await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== 'test-w1' && x.satz === texte.gruppen.falsch![0], 3000);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1500);
    expect(b.chibiPose).toBe('schmollen'); // Pack 0.9: das Falsch-Bild bleibt bei der naechsten Frage stehen (Dummy-Pack ohne Quiz-Bilder: Grundpose)
    // Bildschirmleser: die neue Frage steht in einem hoeflichen Live-Bereich
    expect(b.ansageLive).toBe('polite');
    expect(b.ansage).toBe(b.frage.text);
    expect(await ergebnis(s)).toBeNull();
    console.log(`chromium quiz: falsch, neue Frage ${b.frage.id} nach ${ms} ms (Klick bis Abbild)`);
  } finally {
    await s.close();
  }
});

test('Verweigern: richtige Antwort wird verweigert (schmollen), danach neue Frage; die naechste richtige nie wieder verweigert', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 1, zufall: [0.1], verweigertMs: 400, richtigMs: 200 });
    const a = await bis(s, (x) => x.zustand === 'frage');
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'alpha'));
    const v = await bis(s, (x) => x.zustand === 'verweigert');
    expect(v.satz).toBe(texte.gruppen.verweigert![0]);
    expect(v.chibiPose).toBe('schmollen');
    const n = await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== undefined, 4000);
    await loeseAktuelle(s);
    // Zufall 0,1 waere unter dem Anteil 0,3: ohne die Sperre wuerde wieder verweigert
    const z = await bis(s, (x) => x.zustand === 'richtig' || x.zustand === 'verweigert' || x.zustand === 'zu', 8000);
    expect(z.zustand).not.toBe('verweigert');
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
    console.log(`chromium quiz: verweigert, danach ${n.frage.id} richtig geloest ohne zweite Verweigerung`);
  } finally {
    await s.close();
  }
});

test('Tippen tolerant: kleingeschrieben, ohne Satzzeichen am Ende', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-t1', verweigern: 0, richtigMs: 200 });
    const a = await bis(s, (x) => x.zustand === 'frage' && !!x.eingabe);
    expect(a.zitat).toBe('This is a test line.');
    // falsch getippt: neue Frage
    await s.keyboard.type('this is a test lines');
    await s.keyboard.press('Enter');
    await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== 'test-t1');
    expect(await ergebnis(s)).toBeNull();
    await s.close();
    const s2 = await frischeSeite();
    await oeffne(s2, { frage: 'test-t1', verweigern: 0, richtigMs: 200 });
    await bis(s2, (x) => x.zustand === 'frage' && !!x.eingabe);
    await s2.keyboard.type('  this is a TEST line  ');
    await s2.keyboard.press('Enter');
    await expect.poll(() => ergebnis(s2), { timeout: 5000 }).toBe('geloest');
    await s2.close();
  } finally {
    await s.close().catch(() => {});
  }
});

test('Tastatur-Schutz: f, m und Leertaste erreichen die Seite nicht, solange der Fokus im Riegel ist', async () => {
  const s = await frischeSeite();
  try {
    // Gegenprobe: ohne Riegel faengt die Seite die Tasten
    await s.locator('#draussen').focus();
    await s.keyboard.press('f');
    await s.keyboard.press('m');
    await s.keyboard.press('Space');
  } catch {
    // Gegenprobe unten zaehlt
  }
  const vor = await tasten(s);
  expect(vor.f).toBeGreaterThan(0);
  expect(vor.m).toBeGreaterThan(0);
  expect(vor.leer).toBeGreaterThan(0);
  try {
    await s.evaluate(() => ((window as any).tasten = { f: 0, m: 0, leer: 0 }));
    await s.locator('#draussen').blur();
    await oeffne(s, { frage: 'test-t1', verweigern: 0, richtigMs: 200 });
    await bis(s, (x) => x.zustand === 'frage' && !!x.eingabe && x.fokusImRiegel);
    await s.keyboard.type('f m F M f m ');
    const a = await bis(s, (x) => x.eingabe?.wert === 'f m F M f m ');
    expect(a.eingabe.wert).toBe('f m F M f m ');
    expect(await tasten(s)).toEqual({ f: 0, m: 0, leer: 0 });
    // Leertaste auf einem Knopf: loest den Knopf aus (Antwortwechsel), die Seite sieht sie nicht
    await s.close();
    const s2 = await frischeSeite();
    await oeffne(s2, { frage: 'test-w1', verweigern: 0, zufall: [0] });
    await bis(s2, (x) => x.zustand === 'frage' && x.fokusImRiegel);
    await s2.keyboard.press('Space');
    await bis(s2, (x) => x.zustand === 'richtig' || (x.zustand === 'frage' && x.frage.id !== 'test-w1') || x.zustand === 'verweigert');
    expect(await tasten(s2)).toEqual({ f: 0, m: 0, leer: 0 });
    // Ziffer waehlt eine Antwort
    await s2.keyboard.press('f');
    await s2.keyboard.press('m');
    expect(await tasten(s2)).toEqual({ f: 0, m: 0, leer: 0 });
    console.log('chromium quiz: f, m, Leertaste im Riegel: Seite zaehlt 0, Eingabefeld bekam alle Zeichen');
    await s2.close();
  } finally {
    await s.close().catch(() => {});
  }
});

test('Tastatur-Schutz endet mit dem Riegel: danach faengt die Seite die Tasten wieder', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const a = await bis(s, (x) => x.zustand === 'frage');
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'alpha'));
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
    await s.evaluate(() => ((window as any).tasten = { f: 0, m: 0, leer: 0 }));
    await s.locator('#draussen').focus();
    await s.keyboard.press('f');
    expect((await tasten(s)).f).toBeGreaterThan(0);
  } finally {
    await s.close();
  }
});

test('Aufgaben: wort-tippen und klicken-zaehlen (echte Klicks)', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-h1', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.zustand === 'frage' && x.frage.typ === 'wort-tippen' && x.fokusImRiegel);
    await s.keyboard.type('test TEST Test');
    await s.keyboard.press('Enter');
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
  const s2 = await frischeSeite();
  try {
    await oeffne(s2, { frage: 'test-h2', verweigern: 0, richtigMs: 100 });
    let a = await bis(s2, (x) => x.frage?.typ === 'klicken-zaehlen' && !!x.spirale);
    for (let i = 0; i < 3; i++) {
      await klickeAuf(s2, a.spirale);
      await s2.waitForTimeout(650);
    }
    const t0 = Date.now();
    await expect.poll(() => ergebnis(s2), { timeout: 6000 }).toBe('geloest');
    console.log(`chromium quiz: 3 Klicks im Abstand 650 ms, Ruhe-Pruefung nach ${Date.now() - t0} ms`);
  } finally {
    await s2.close();
  }
  // zu schnell geklickt (Abstand unter 500 ms): falsch, neue Frage
  const s3 = await frischeSeite();
  try {
    await oeffne(s3, { frage: 'test-h2', verweigern: 0 });
    const a = await bis(s3, (x) => x.frage?.typ === 'klicken-zaehlen' && !!x.spirale);
    await klickeAuf(s3, a.spirale);
    await klickeAuf(s3, a.spirale);
    await bis(s3, (x) => x.zustand === 'frage' && x.frage.id !== 'test-h2', 3000);
  } finally {
    await s3.close();
  }
});

test('Aufgabe spirale-ansehen: Mausbewegung setzt die Uhr zurueck, danach geloest', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-h3', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.frage?.typ === 'spirale-ansehen' && !!x.spirale);
    const t0 = Date.now();
    await s.mouse.move(100, 100);
    await s.waitForTimeout(2500);
    await s.mouse.move(130, 140); // Bewegung nach 2,5 s: Uhr beginnt neu
    const t1 = Date.now();
    await expect.poll(() => ergebnis(s), { timeout: 12_000 }).toBe('geloest');
    const gesamt = Date.now() - t0;
    const nachBewegung = Date.now() - t1;
    expect(nachBewegung).toBeGreaterThan(4500);
    console.log(`chromium quiz: spirale-ansehen 5 s, Bewegung bei 2,5 s, geloest nach ${gesamt} ms (${nachBewegung} ms nach der Bewegung)`);
  } finally {
    await s.close();
  }
});

test('Aufgabe finger-halten (Touch-Lage erzwungen): Finger loslassen setzt zurueck, 5 s halten loest', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-h4', geraet: 'touch', verweigern: 0, richtigMs: 100 });
    const a = await bis(s, (x) => x.frage?.typ === 'finger-halten' && !!x.spirale);
    const m = mitte(a.spirale);
    await s.mouse.move(m.x, m.y);
    await s.mouse.down();
    await s.waitForTimeout(2000);
    await s.mouse.up(); // zu frueh
    await s.waitForTimeout(300);
    expect(await ergebnis(s)).toBeNull();
    await s.mouse.down();
    const t0 = Date.now();
    await expect.poll(() => ergebnis(s), { timeout: 9000 }).toBe('geloest');
    await s.mouse.up();
    console.log(`chromium quiz: finger-halten geloest ${Date.now() - t0} ms nach neuem Aufsetzen (Soll 5000)`);
  } finally {
    await s.close();
  }
});

test('Geraet: Desktop zieht nie finger-halten, Touch nie spirale-ansehen (je 40 Riegel-Fragen)', async () => {
  for (const [geraet, verboten] of [['desktop', 'finger-halten'], ['touch', 'spirale-ansehen']] as const) {
    const s = await frischeSeite();
    try {
      await oeffne(s, { geraet, verweigern: 0, zufall: [0.37, 0.81, 0.12, 0.66] });
      const gesehen = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const a = await bis(s, (x) => x.zustand === 'frage' && !!x.frage && !gesehen.has(`${x.frage.id}#${i}`));
        gesehen.add(a.frage.id);
        expect(a.frage.typ).not.toBe(verboten);
        // falsch beantworten: eine Wahlfrage mit falscher Antwort; sonst Aufgabe ignorieren (Wahl per Taste 9 ist ungueltig): Riegel ueber Signal-Pause beenden
        const f = quiz.fragen.find((q) => q.id === a.frage.id);
        if (f.art === 'wissen' || f.art === 'allgemein') {
          const falsch = a.antworten.find((b: any) => b.text !== f.antworten[f.richtig]);
          await klickeAuf(s, falsch);
          await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== a.frage.id);
        } else if (f.art === 'tippen') {
          await s.keyboard.type('x');
          await s.keyboard.press('Enter');
          await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== a.frage.id);
        } else break; // eine Aufgabe ist gezogen und war erlaubt
      }
    } finally {
      await s.close();
    }
  }
});

test('Pause im Riegel: loest sofort lokal, auch wenn der Hintergrund nie antwortet', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', pauseHaengt: true });
    const a = await bis(s, (x) => x.zustand === 'frage');
    const t0 = Date.now();
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    const ms = Date.now() - t0;
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
    const e = await extSeite();
    expect((await speicher(e, 'einstellungen'))?.pause ?? false).toBe(false); // die Nachricht wurde nie geschickt
    await e.close();
    console.log(`chromium quiz: Pause loest den Riegel nach ${ms} ms, Hintergrund ohne Antwort`);
  } finally {
    await s.close();
  }
});

test('Pause im Riegel: danach geht die Nachricht an den Hintergrund (Pause steht in den Einstellungen)', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1' });
    const a = await bis(s, (x) => x.zustand === 'frage');
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    const e = await extSeite();
    await expect.poll(async () => (await speicher(e, 'einstellungen'))?.pause, { timeout: 5000 }).toBe(true);
    // Bei Pause oeffnet sich gar kein Riegel
    await s.evaluate(() => document.documentElement.removeAttribute('data-veil-riegel-ergebnis'));
    await oeffne(s, { frage: 'test-w1' });
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    // Pause von aussen (Popup, anderer Tab) loest einen offenen Riegel ebenfalls
    await e.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const alt = (await c.storage.local.get('einstellungen')).einstellungen;
      await c.storage.local.set({ einstellungen: { ...alt, pause: false } });
    });
    await expect.poll(async () => (await speicher(e, 'einstellungen'))?.pause, { timeout: 5000 }).toBe(false);
    await s.evaluate(() => document.documentElement.removeAttribute('data-veil-riegel-ergebnis'));
    await oeffne(s, { frage: 'test-w1' });
    await bis(s, (x) => x.zustand === 'frage');
    await e.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const alt = (await c.storage.local.get('einstellungen')).einstellungen;
      await c.storage.local.set({ einstellungen: { ...alt, pause: true } });
    });
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    await e.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const alt = (await c.storage.local.get('einstellungen')).einstellungen;
      await c.storage.local.set({ einstellungen: { ...alt, pause: false } });
    });
    await e.close();
  } finally {
    await s.close();
  }
});

test('Warnung vor Fotosensibilitaet: einmal vor der ersten Spiral-Aufgabe, danach gemerkt; Spirale dreht erst danach', async () => {
  const e = await extSeite();
  await e.evaluate(() => (globalThis as any).chrome.storage.local.remove('quizWarnungGesehen'));
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-h2', verweigern: 0, richtigMs: 100 });
    const w = await bis(s, (x) => x.zustand === 'warnung');
    expect(w.knoepfe.map((k: any) => k.text)).toContain('Got it, go on');
    expect(w.augenDrehen).toBe(false);
    await klickeAuf(s, w.knoepfe.find((k: any) => k.text === 'Got it, go on'));
    const a = await bis(s, (x) => x.zustand === 'frage' && !!x.spirale);
    expect(a.augenDrehen).toBe(true);
    await expect.poll(() => speicher(e, 'quizWarnungGesehen'), { timeout: 3000 }).toBe(true);
    await s.close();
    const s2 = await frischeSeite();
    await oeffne(s2, { frage: 'test-h2', verweigern: 0 });
    const b = await bis(s2, (x) => x.zustand === 'frage' || x.zustand === 'warnung');
    expect(b.zustand).toBe('frage');
    await s2.close();
  } finally {
    await s.close().catch(() => {});
    await e.close();
  }
});

test('Ruhig-Modus und reduzierte Bewegung: Spirale langsamer bzw. steht; nie ueber 2,5 Hz', async () => {
  const e = await extSeite();
  try {
    const s = await frischeSeite();
    await oeffne(s, { frage: 'test-w1' });
    const normal = await bis(s, (x) => x.zustand === 'frage');
    const pn = parseFloat(normal.augenPeriodeS);
    expect(normal.augenDrehen).toBe(true);
    expect(2 / pn).toBeLessThanOrEqual(2.5);
    await s.close();

    const r = await frischeSeite();
    await einstellung(r, { ruhig: true });
    await expect.poll(async () => (await speicher(e, 'einstellungen'))?.ruhig, { timeout: 5000 }).toBe(true);
    await oeffne(r, { frage: 'test-w1' });
    const ruhig = await bis(r, (x) => x.zustand === 'frage');
    const pr = parseFloat(ruhig.augenPeriodeS);
    expect(pr / pn).toBeGreaterThan(3); // 30 % der Drehzahl: mehr als dreifache Periode
    console.log(`chromium quiz: Periode normal ${pn} s (${(2 / pn).toFixed(3)} Hz), Ruhig ${pr} s (${(2 / pr).toFixed(3)} Hz)`);
    await r.close();
    await e.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const alt = (await c.storage.local.get('einstellungen')).einstellungen;
      await c.storage.local.set({ einstellungen: { ...alt, ruhig: false } });
    });

    const m = await context.newPage();
    await m.emulateMedia({ reducedMotion: 'reduce' });
    await m.goto(SEITE);
    await expect.poll(() => m.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
    await oeffne(m, { frage: 'test-w1' });
    const still = await bis(m, (x) => x.zustand === 'frage');
    expect(still.augenDrehen).toBe(false);
    await m.close();
  } finally {
    await e.close();
  }
});

test('Sakura Glas: Schrift VEIL Text steht nach dem Oeffnen bereit, Marke, nummerierte Antworten, Fuss und Fingerziele', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const a = await bis(s, (x) => x.zustand === 'frage');
    // Lesung S1 Nr. 1: document.fonts.check() ist auch ohne passende Schrift wahr; geprueft wird, dass die Familie geladen im Schriften-Satz steht.
    // Familien tragen je Seite einen Zufallsteil (familie.ts, Lesung S2/R Nr. 1): "VEIL Text <zufall>".
    const geladen = (name: string) => s.evaluate((n) => [...document.fonts].some((f) => f.family.replace(/["']/g, '').startsWith(`${n} `) && f.status === 'loaded'), name);
    await expect.poll(() => geladen('VEIL Text'), { timeout: 8000 }).toBe(true);
    await expect.poll(() => geladen('VEIL Rounded'), { timeout: 8000 }).toBe(true);
    expect(a.marke).toBe('Mia’s quiz');
    expect(a.fussNummer).toMatch(/^Question \d+$/);
    expect(a.pause.h).toBeGreaterThanOrEqual(40);
    expect(a.antworten.length).toBeGreaterThanOrEqual(2);
    for (const b of a.antworten) expect(b.h).toBeGreaterThanOrEqual(44);
    await s.setViewportSize({ width: 360, height: 700 });
    const b = await bis(s, (x) => x.pause && x.pause.h >= 44 && x.karte.w <= 360);
    expect(b.pause.h).toBeGreaterThanOrEqual(44);
    expect(b.karte.x).toBeGreaterThanOrEqual(0);
    expect(b.karte.x + b.karte.w).toBeLessThanOrEqual(360);
  } finally {
    await s.close();
  }
});

test('Strenge Seiten-CSP: Riegel ist trotzdem gestaltet und bedienbar', async () => {
  const s = await frischeSeite(`${basis}/schleier-csp.html?satz=sfw`);
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const a = await bis(s, (x) => x.zustand === 'frage');
    expect(a.kartenFarbe).toContain('gradient');
    expect(a.pause.h).toBeGreaterThanOrEqual(40);
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'alpha'));
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
});

test('Anker und schmaler Bildschirm: Riegel folgt dem Player, fuellt auf 375 px den Sichtbereich', async () => {
  const s = await frischeSeite();
  try {
    // Ab 420 px Hoehe bleibt der Riegel auf der Flaeche des Ankers (darunter fuellt er den Sichtbereich, siehe Test "Kleiner Anker").
    await s.evaluate(() => ((document.querySelector('#player') as HTMLElement).style.height = '480px'));
    await oeffne(s, { frage: 'test-w1', anker: '#player' });
    const a = await bis(s, (x) => x.zustand === 'frage');
    const p = await s.evaluate(() => {
      const r = document.querySelector('#player')!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    expect(Math.abs(a.host.w - p.w)).toBeLessThan(3);
    expect(Math.abs(a.host.h - p.h)).toBeLessThan(3);
    expect(Math.abs(a.host.x - p.x)).toBeLessThan(3);
    await s.evaluate(() => (document.querySelector('#player') as HTMLElement).style.marginLeft = '200px');
    await expect.poll(async () => (await abbild(s)).host.x, { timeout: 3000 }).toBeGreaterThan(190);
    await s.setViewportSize({ width: 375, height: 700 });
    const k = await bis(s, (x) => x.host.w <= 375 && x.host.w >= 370);
    expect(k.pause.x + k.pause.w).toBeLessThanOrEqual(376);
    expect(k.pause.h).toBeGreaterThanOrEqual(40);
    for (const b of k.antworten) expect(b.h).toBeGreaterThanOrEqual(44);
    await s.waitForTimeout(250); // Layout setzt sich (Neuaufbau nach Groessenwechsel), dann frische Koordinaten
    const k2 = await bis(s, (x) => x.zustand === 'frage' && x.antworten.length === 3);
    await klickeAuf(s, k2.antworten.find((b: any) => b.text === 'alpha'));
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
});

test('Waechter: entfernt die Seite den Host, kommt er zurueck; Seite kann die Shadow Root nicht lesen', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1' });
    await bis(s, (x) => x.zustand === 'frage');
    await s.evaluate(() => document.querySelector('[data-veil-riegel-host]')!.remove());
    await expect.poll(() => s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null), { timeout: 3000 }).toBe(true);
    const a = await bis(s, (x) => x.offen && x.zustand === 'frage');
    expect(a.host.w).toBeGreaterThan(300);
  } finally {
    await s.close();
  }
});

// ---------- Runde 2 ----------
test('Aufgabe zaehlen: Woerter laufen hoechstens 2 je Sekunde, nie zwei gleiche nebeneinander, Zahl wird geprueft', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-z', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.frage?.typ === 'zaehlen');
    const r = await beobachteFolge(s);
    expect(r.woerter.length).toBe(8);
    for (let i = 1; i < r.woerter.length; i++) expect(r.woerter[i]).not.toBe(r.woerter[i - 1]);
    expect(Math.min(...r.abstaende)).toBeGreaterThanOrEqual(480); // Messfehler der Abfrage ein paar ms
    expect(r.ziel).toBeGreaterThanOrEqual(2);
    await s.keyboard.type(String(r.ziel));
    await s.keyboard.press('Enter');
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
    console.log(`chromium quiz: zaehlen ${r.woerter.length} Woerter, kleinster Abstand ${Math.min(...r.abstaende)} ms, ${r.ziel} Treffer richtig gezaehlt`);
  } finally {
    await s.close();
  }
  // falsche Zahl: neue Frage
  const f = await frischeSeite();
  try {
    await oeffne(f, { frage: 'ext-z', verweigern: 0 });
    await bis(f, (x) => x.frage?.typ === 'zaehlen');
    const r = await beobachteFolge(f);
    await f.keyboard.type('99');
    await f.keyboard.press('Enter');
    await bis(f, (x) => x.zustand === 'frage' && x.frage.id !== 'ext-z', 3000);
  } finally {
    await f.close();
  }
});

test('Aufgabe wort-blitz: das Wort erscheint genau einmal kurz, danach Eingabe', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-b', verweigern: 0, richtigMs: 100 });
    let erscheinungen = 0;
    let da = false;
    let t0 = 0;
    let dauer = 0;
    const ende = Date.now() + 10_000;
    while (Date.now() < ende) {
      const a = await abbild(s);
      if (a?.eingabe) {
        if (da && dauer === 0) dauer = Date.now() - t0;
        break;
      }
      const jetzt = !!a?.wort;
      if (jetzt && !da) {
        erscheinungen++;
        t0 = Date.now();
        expect(a.wort).toBe('OBEY');
      }
      if (!jetzt && da) dauer = Date.now() - t0;
      da = jetzt;
      await s.waitForTimeout(20);
    }
    expect(erscheinungen).toBe(1);
    expect(dauer).toBeGreaterThan(250);
    expect(dauer).toBeLessThan(1100);
    await s.keyboard.type('obey');
    await s.keyboard.press('Enter');
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
    console.log(`chromium quiz: wort-blitz ${erscheinungen} mal sichtbar, ${dauer} ms`);
  } finally {
    await s.close();
  }
});

test('Aufgaben countdown und buchstaben-raetsel', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-c', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.frage?.typ === 'countdown' && !!x.eingabe);
    await s.keyboard.type('5, 4, 3, 2, 1, down.');
    await s.keyboard.press('Enter');
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
  const f = await frischeSeite();
  try {
    await oeffne(f, { frage: 'ext-c', verweigern: 0 });
    await bis(f, (x) => x.frage?.typ === 'countdown' && !!x.eingabe);
    await f.keyboard.type('5 4 3 DOWN');
    await f.keyboard.press('Enter');
    await bis(f, (x) => x.zustand === 'frage' && x.frage.id !== 'ext-c', 3000);
  } finally {
    await f.close();
  }
  const r = await frischeSeite();
  try {
    await oeffne(r, { frage: 'ext-r', verweigern: 0, richtigMs: 100 });
    const a = await bis(r, (x) => x.frage?.typ === 'buchstaben-raetsel' && !!x.eingabe);
    expect(a.zitat).toBe('B E O Y');
    await r.keyboard.type('o b e y');
    await r.keyboard.press('Enter');
    await expect.poll(() => ergebnis(r), { timeout: 5000 }).toBe('geloest');
  } finally {
    await r.close();
  }
});

test('Aufgabe im-kreis: Zeiger im Kreis halten, Verlassen setzt die Uhr zurueck', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-k', verweigern: 0, richtigMs: 100 });
    const a = await bis(s, (x) => x.frage?.typ === 'im-kreis' && !!x.kreis);
    const m = mitte(a.kreis);
    await s.mouse.move(m.x, m.y);
    await s.waitForTimeout(1500);
    await s.mouse.move(5, 5); // raus
    await s.waitForTimeout(400);
    expect(await ergebnis(s)).toBeNull();
    await s.mouse.move(m.x, m.y);
    const t0 = Date.now();
    await expect.poll(() => ergebnis(s), { timeout: 8000 }).toBe('geloest');
    expect(Date.now() - t0).toBeGreaterThan(2500);
    console.log(`chromium quiz: im-kreis 3 s, nach dem Verlassen neu, geloest nach ${Date.now() - t0} ms`);
  } finally {
    await s.close();
  }
});

test('im-kreis: synthetische Zeigerereignisse der Seite zaehlen nicht', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-k', verweigern: 0, richtigMs: 100 });
    const a = await bis(s, (x) => x.frage?.typ === 'im-kreis' && !!x.kreis);
    const m = mitte(a.kreis);
    await s.evaluate(({ x, y }) => {
      const tick = () => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
      tick();
      (window as any).__kreis = setInterval(tick, 100);
    }, m);
    await s.waitForTimeout(4500); // laenger als die 3 s
    expect(await ergebnis(s)).toBeNull();
    await s.evaluate(() => clearInterval((window as any).__kreis));
    await s.mouse.move(m.x, m.y); // echte Bewegung zaehlt
    await expect.poll(() => ergebnis(s), { timeout: 8000 }).toBe('geloest');
  } finally {
    await s.close();
  }
});

test('Blitz-Grenze: zehnmal oeffnen und ueber Pause schliessen, in jeder Sekunde hoechstens 3 vollflaechige Wechsel', async () => {
  const s = await frischeSeite();
  try {
    // Unabhaengige Messung: jedes Erscheinen und Verschwinden des Hosts im Dokument mit Zeitstempel
    await s.evaluate(() => {
      (window as any).wechsel = [];
      new MutationObserver((ms) => {
        for (const m of ms) {
          for (const n of [...m.addedNodes, ...m.removedNodes]) {
            if ((n as Element).hasAttribute?.('data-veil-riegel-host')) (window as any).wechsel.push(performance.now());
          }
        }
      }).observe(document.documentElement, { childList: true });
    });
    for (let i = 0; i < 10; i++) {
      await s.evaluate(() => document.documentElement.removeAttribute('data-veil-riegel-ergebnis'));
      await oeffne(s, { frage: 'test-w1', pauseHaengt: true });
      const a = await bis(s, (x) => x.offen && x.zustand === 'frage', 8000);
      await klickeAuf(s, a.pause);
      await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause'); // Schliessen bleibt sofort
      await bis(s, (x) => x.offen === false, 3000);
    }
    const z: number[] = await s.evaluate(() => (window as any).wechsel);
    expect(z.length).toBe(20);
    let hoechstens = 0;
    for (let i = 0; i < z.length; i++) hoechstens = Math.max(hoechstens, z.filter((t) => t >= z[i]! && t < z[i]! + 1000).length);
    expect(hoechstens).toBeLessThanOrEqual(3);
    console.log(`chromium quiz: 10 Oeffnen/Pause-Paare, 20 Wechsel in ${Math.round(z[z.length - 1]! - z[0]!)} ms, hoechstens ${hoechstens} je Sekunde`);
  } finally {
    await s.close();
  }
});

test('Blitz-Grenze: Pause und Signal beenden das Warten vor dem Oeffnen sofort', async () => {
  const s = await frischeSeite();
  const e = await extSeite();
  try {
    await oeffne(s, { frage: 'test-w1', pauseHaengt: true });
    const a = await bis(s, (x) => x.zustand === 'frage');
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    await s.evaluate(() => document.documentElement.removeAttribute('data-veil-riegel-ergebnis'));
    await oeffne(s, { frage: 'test-w1' }); // wartet unsichtbar (letzter Wechsel eben)
    await s.waitForTimeout(150);
    expect(await abbild(s).then((x) => !!x && x.offen)).toBe(false);
    await einstellung(s, { pause: true });
    const t0 = Date.now();
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    expect(Date.now() - t0).toBeLessThan(800);
    await einstellungPauseAus(e);
  } finally {
    await s.close();
    await e.close();
  }
});

test('Pause in jedem Zustand: Warnung, laufende Woerter, verweigert, Laden', async () => {
  const e = await extSeite();
  try {
    // Warnung
    await e.evaluate(() => (globalThis as any).chrome.storage.local.remove('quizWarnungGesehen'));
    let s = await frischeSeite();
    await oeffne(s, { frage: 'test-h2' });
    let a = await bis(s, (x) => x.zustand === 'warnung');
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
    await s.close();
    await e.evaluate(() => (globalThis as any).chrome.storage.local.set({ quizWarnungGesehen: true }));
    await einstellungPauseAus(e);

    // laufende Woerter
    s = await frischeSeite();
    await oeffne(s, { frage: 'ext-z' });
    a = await bis(s, (x) => x.frage?.typ === 'zaehlen' && !!x.wort);
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
    await s.close();
    await einstellungPauseAus(e);

    // verweigert
    s = await frischeSeite();
    await oeffne(s, { frage: 'test-w1', verweigern: 1, zufall: [0.1], verweigertMs: 5000 });
    a = await bis(s, (x) => x.zustand === 'frage');
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'alpha'));
    a = await bis(s, (x) => x.zustand === 'verweigert');
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    await s.close();
    await einstellungPauseAus(e);

    // Laden: Pause kommt waehrend die Daten noch geladen werden
    s = await frischeSeite();
    await oeffne(s, { frage: 'test-w1', ladeVerzoegerungMs: 1500 });
    await s.waitForTimeout(300);
    await einstellung(s, { pause: true });
    await expect.poll(() => ergebnis(s), { timeout: 6000 }).toBe('pause');
    expect(await abbild(s)).toBeNull();
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
    await s.close();
    await einstellungPauseAus(e);
    console.log('chromium quiz: Pause loest in Warnung, laufenden Woertern, verweigert und beim Laden');
  } finally {
    await e.close();
  }
});
async function einstellungPauseAus(e: Page) {
  // Die Pause-Nachricht des Riegels kommt nach dem lokalen Loesen an: erst abwarten, dann zuruecksetzen.
  await e.waitForTimeout(400);
  await e.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const alt = (await c.storage.local.get('einstellungen')).einstellungen ?? {};
    await c.storage.local.set({ einstellungen: { ...alt, pause: false } });
  });
}

test('Ereignisse der Seite (nicht vertrauenswuerdig) loesen im Riegel nichts aus', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0 });
    const vorher = await bis(s, (x) => x.zustand === 'frage');
    await s.evaluate(() => {
      const h = document.querySelector('[data-veil-riegel-host]')!;
      for (const key of ['1', '2', '3', 'Enter', ' ']) {
        for (const typ of ['keydown', 'keyup', 'keypress']) h.dispatchEvent(new KeyboardEvent(typ, { key, bubbles: true, composed: true, cancelable: true }));
      }
      h.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await s.waitForTimeout(500);
    const nachher = await abbild(s);
    expect(nachher.zustand).toBe('frage');
    expect(nachher.frage.id).toBe(vorher.frage.id);
    expect(await ergebnis(s)).toBeNull();
    // Gegenprobe: eine echte Ziffer waehlt eine Antwort
    await s.keyboard.press('1');
    await bis(s, (x) => x.zustand !== 'frage' || x.frage.id !== vorher.frage.id, 3000);
    console.log('chromium quiz: 15 synthetische Tastenereignisse und 1 Klick ohne Wirkung, echte Taste 1 wirkt');
  } finally {
    await s.close();
  }
});

test('Ein Riegel je Tab: gleicher Grund teilt das Ergebnis, anderer Grund bekommt sofort abgebrochen; freilegen oeffnet', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', grund: 'video' });
    const a = await bis(s, (x) => x.zustand === 'frage');
    await oeffne(s, { grund: 'freilegen' });
    await expect.poll(() => ergebnis(s), { timeout: 2000 }).toBe('abgebrochen');
    expect((await abbild(s)).offen).toBe(true);
    await oeffne(s, { grund: 'video' }); // gleicher Grund, gleicher Anker: teilt das Ergebnis
    expect(await ergebnis(s)).toBeNull();
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    await einstellungPauseAus(await extSeite());
  } finally {
    await s.close();
  }
  const f = await frischeSeite();
  try {
    await oeffne(f, { grund: 'freilegen', frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const a = await bis(f, (x) => x.zustand === 'frage');
    await klickeAuf(f, a.antworten.find((b: any) => b.text === 'alpha'));
    await expect.poll(() => ergebnis(f), { timeout: 5000 }).toBe('geloest');
  } finally {
    await f.close();
  }
});

test('Waechter: nach zu vielen Entfernungen endet der Riegel mit abgebrochen (kein Lock)', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', maxRettungen: 2 });
    await bis(s, (x) => x.zustand === 'frage');
    for (let i = 0; i < 3; i++) {
      await expect.poll(() => s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null), { timeout: 3000 }).toBe(true);
      await s.evaluate(() => document.querySelector('[data-veil-riegel-host]')!.remove());
      await s.waitForTimeout(100);
    }
    await expect.poll(() => ergebnis(s), { timeout: 4000 }).toBe('abgebrochen');
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
  } finally {
    await s.close();
  }
});

test('Kopf mit Pause-Knopf bleibt sichtbar, auch auf niedrigem Bildschirm mit viel Inhalt', async () => {
  const s = await frischeSeite();
  try {
    await s.setViewportSize({ width: 600, height: 240 });
    await oeffne(s, { frage: 'test-t1', verweigern: 0 });
    const a = await bis(s, (x) => x.zustand === 'frage' && !!x.eingabe);
    expect(a.pause.y).toBeGreaterThanOrEqual(0);
    expect(a.pause.y + a.pause.h).toBeLessThanOrEqual(240);
    expect(a.karte.h).toBeLessThanOrEqual(240);
    await klickeAuf(s, a.pause);
    await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
    await einstellungPauseAus(await extSeite());
  } finally {
    await s.close();
  }
});

test('Ruhig-Modus schliesst Wort-Aufgaben aus (60 Fragen, nie zaehlen, wort-blitz, pink-klicken)', async () => {
  const e = await extSeite();
  const s = await frischeSeite();
  try {
    await einstellung(s, { ruhig: true });
    await expect.poll(async () => (await speicher(e, 'einstellungen'))?.ruhig, { timeout: 5000 }).toBe(true);
    await s.reload();
    await expect.poll(() => s.evaluate(() => document.documentElement.hasAttribute('data-veil-status')), { timeout: 10_000 }).toBe(true);
    await oeffne(s, { geraet: 'desktop', verweigern: 0, zufall: [0.13, 0.57, 0.91, 0.34, 0.76, 0.02] });
    const typen = new Set<string>();
    let n = 0;
    for (let i = 0; i < 60; i++) {
      await bis(s, (x) => x.zustand === 'frage' && !!x.frage);
      await s.waitForTimeout(150); // Layout (Chibi, Satz) setzt sich, dann frische Koordinaten
      const a = await bis(s, (x) => x.zustand === 'frage' && !!x.frage);
      n++;
      if (a.frage.typ) typen.add(a.frage.typ);
      expect(['zaehlen', 'wort-blitz', 'pink-klicken']).not.toContain(a.frage.typ);
      const f = quiz.fragen.find((q) => q.id === a.frage.id);
      if (f.art === 'wissen' || f.art === 'allgemein') await klickeAuf(s, a.antworten.find((b: any) => b.text !== f.antworten[f.richtig]));
      else if (f.art === 'tippen' || f.aufgabe.typ === 'wort-tippen' || f.aufgabe.typ === 'countdown' || f.aufgabe.typ === 'buchstaben-raetsel') {
        await s.keyboard.type('x');
        await s.keyboard.press('Enter');
      } else if (f.aufgabe.typ === 'klicken-zaehlen') {
        const sp = (await bis(s, (x) => !!x.spirale)).spirale;
        await klickeAuf(s, sp);
        await klickeAuf(s, sp);
      } else {
        await klickeAuf(s, a.pause); // Aufgabe mit Wartezeit: Riegel per Pause beenden und neu oeffnen
        await expect.poll(() => ergebnis(s), { timeout: 3000 }).toBe('pause');
        await einstellungPauseAus(e);
        await s.evaluate(() => document.documentElement.removeAttribute('data-veil-riegel-ergebnis'));
        await oeffne(s, { geraet: 'desktop', verweigern: 0, zufall: [0.13 + i * 0.01, 0.57, 0.91, 0.34] });
        continue;
      }
      await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== a.frage.id, 4000).catch(async (fehler) => {
        throw new Error(`nach ${a.frage.id} (${a.frage.typ}) kein Wechsel: ${JSON.stringify(await abbild(s))?.slice(0, 400)} ${fehler}`);
      });
    }
    console.log(`chromium quiz: Ruhig-Modus, ${n} Fragen gezogen, Aufgabentypen ${[...typen].join(',')}, keine Wort-Aufgabe`);
  } finally {
    await einstellung(s, { ruhig: false });
    await expect.poll(async () => (await speicher(e, 'einstellungen'))?.ruhig, { timeout: 5000 }).toBe(false);
    await s.close();
    await e.close();
  }
});

test('Eingabeereignisse (input, beforeinput, composition) erreichen die Seite nicht; Riegel mit Anker laesst der Seite den Fokus', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-t1', verweigern: 0 });
    await bis(s, (x) => x.zustand === 'frage' && !!x.eingabe && x.fokusImRiegel);
    await s.keyboard.type('geheim');
    await s.keyboard.insertText('xyz');
    await bis(s, (x) => x.eingabe?.wert === 'geheimxyz');
    const seen = await s.evaluate(() => (window as any).eingaben as string[]);
    expect(seen).toEqual([]);
    // Gegenprobe: ausserhalb des Riegels sieht die Seite ihre Eingaben
    await s.close();
    const g = await frischeSeite();
    await g.locator('#draussen').focus();
    await g.keyboard.type('ab');
    expect((await g.evaluate(() => (window as any).eingaben as string[])).length).toBeGreaterThan(0);
    await g.close();
    console.log('chromium quiz: 0 Eingabeereignisse bei der Seite, solange der Fokus im Riegel ist');
  } finally {
    await s.close().catch(() => {});
  }
  const a = await frischeSeite();
  try {
    await a.evaluate(() => ((document.querySelector('#player') as HTMLElement).style.height = '480px')); // ab 420 px bleibt der Riegel auf dem Anker
    await oeffne(a, { frage: 'test-w1', anker: '#player' });
    await bis(a, (x) => x.zustand === 'frage');
    await a.locator('#draussen').focus();
    await a.waitForTimeout(1600); // laenger als der Fokus-Waechter (600 ms)
    expect(await a.evaluate(() => document.activeElement?.id)).toBe('draussen');
  } finally {
    await a.close();
  }
});

test('Kleiner Anker (320 x 300): Riegel fuellt den Sichtbereich, alle Antworten liegen in der Karte und sind klickbar', async () => {
  const s = await frischeSeite();
  try {
    await s.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'klein';
      d.style.cssText = 'position:absolute;left:300px;top:80px;width:320px;height:300px;background:#223';
      document.body.append(d);
    });
    await oeffne(s, { frage: 'test-w1', verweigern: 0, richtigMs: 100, anker: '#klein' });
    const a = await bis(s, (x) => x.zustand === 'frage' && x.antworten.length === 3, 10_000);
    const vh = await s.evaluate(() => document.documentElement.clientHeight);
    expect(a.host.h).toBeGreaterThanOrEqual(vh - 2); // Sichtbereich statt 320 x 300
    for (const b of a.antworten) {
      expect(b.y).toBeGreaterThanOrEqual(a.karte.y);
      expect(b.y + b.h).toBeLessThanOrEqual(a.karte.y + a.karte.h + 1);
    }
    expect(a.pause.y).toBeGreaterThanOrEqual(a.karte.y);
    await klickeAuf(s, a.antworten.find((b: any) => b.text === 'alpha'));
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
});

test('Ein offener Riegel baut sich bei Invalidierung des Kontexts selbst ab (abgebrochen, Host weg)', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'test-w1', verweigern: 0 });
    await bis(s, (x) => x.zustand === 'frage');
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(true);
    await s.evaluate((d) => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify(d) })), { riegel: { invalidiere: true } });
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('abgebrochen');
    expect(await s.evaluate(() => document.querySelector('[data-veil-riegel-host]') !== null)).toBe(false);
  } finally {
    await s.close();
  }
});

test('Aufgabe buchstaben-takt: im Takt geloest, zu schnell getippt gibt neue Frage', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-t', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.frage?.typ === 'buchstaben-takt');
    for (const c of 'obey') {
      await s.keyboard.press(c);
      await s.waitForTimeout(1100); // zwischen 800 und 2000 ms
    }
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
  const f = await frischeSeite();
  try {
    await oeffne(f, { frage: 'ext-t', verweigern: 0 });
    await bis(f, (x) => x.frage?.typ === 'buchstaben-takt');
    await f.keyboard.press('o');
    await f.waitForTimeout(1100);
    await f.keyboard.press('b');
    await f.keyboard.press('e'); // unter 800 ms nach dem vorigen Buchstaben
    await bis(f, (x) => x.zustand === 'frage' && x.frage.id !== 'ext-t', 3000);
    expect(await ergebnis(f)).toBeNull();
  } finally {
    await f.close();
  }
});

test('Aufgabe pink-klicken: Klick auf das pinke Wort loest, Klick auf ein anderes Wort gibt neue Frage', async () => {
  const lauf = async (aufPink: boolean) => {
    const s = await frischeSeite();
    try {
      await oeffne(s, { frage: 'ext-p', verweigern: 0, richtigMs: 100 });
      await bis(s, (x) => x.frage?.typ === 'pink-klicken');
      const feld = await bis(s, (x) => x.aufgabe === (aufPink ? 'pink:ja' : 'pink:nein') && x.wort !== null, 10_000);
      await s.keyboard.press('Enter'); // das Feld hat den Fokus: Enter klickt
      if (aufPink) await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
      else {
        await bis(s, (x) => x.zustand === 'frage' && x.frage.id !== 'ext-p', 3000);
        expect(await ergebnis(s)).toBeNull();
      }
      return feld.wortPink;
    } finally {
      await s.close();
    }
  };
  expect(await lauf(true)).toBe(true);
  expect(await lauf(false)).toBe(false);
});

test('Aufgabe leertaste-halten: 2 s halten, bei "Now." loslassen loest; zu frueh loslassen gibt neue Frage', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-l', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.frage?.typ === 'leertaste-halten');
    await s.keyboard.down('Space');
    await bis(s, (x) => x.aufgabe === 'jetzt', 5000);
    await s.keyboard.up('Space');
    await expect.poll(() => ergebnis(s), { timeout: 5000 }).toBe('geloest');
  } finally {
    await s.close();
  }
  const f = await frischeSeite();
  try {
    await oeffne(f, { frage: 'ext-l', verweigern: 0 });
    await bis(f, (x) => x.frage?.typ === 'leertaste-halten');
    await f.keyboard.down('Space');
    await f.waitForTimeout(600);
    await f.keyboard.up('Space'); // vor "Now."
    await bis(f, (x) => x.zustand === 'frage' && x.frage.id !== 'ext-l', 3000);
  } finally {
    await f.close();
  }
});

test('Aufgabe widerstehen: nicht klicken loest nach der Zeit, Klick auf den Knopf gibt neue Frage', async () => {
  const s = await frischeSeite();
  try {
    await oeffne(s, { frage: 'ext-w', verweigern: 0, richtigMs: 100 });
    await bis(s, (x) => x.frage?.typ === 'widerstehen');
    await expect.poll(() => ergebnis(s), { timeout: 8000 }).toBe('geloest');
  } finally {
    await s.close();
  }
  const f = await frischeSeite();
  try {
    await oeffne(f, { frage: 'ext-w', verweigern: 0 });
    const a = await bis(f, (x) => x.frage?.typ === 'widerstehen' && x.knoepfe.some((k: any) => k.text === 'Click me'));
    await klickeAuf(f, a.knoepfe.find((k: any) => k.text === 'Click me'));
    await bis(f, (x) => x.zustand === 'frage' && x.frage.id !== 'ext-w', 3000);
    expect(await ergebnis(f)).toBeNull();
  } finally {
    await f.close();
  }
});

test('Pack mit kaputter Quiz-Bank: Freischaltung faellt weg, Riegel endet mit abgebrochen', async () => {
  const e = await extSeite();
  try {
    await e.locator('#entfernen').click();
    await e.locator('#entfernen-ja').click();
    await expect(e.locator('#pack-status')).toContainText('No pack yet');
    const bau = (await import(bauModul)) as { baueDummyPack(o: unknown): Promise<{ bytes: Uint8Array }> };
    const kaputt = path.join(ordner, 'kaputt-quiz.miapack');
    await writeFile(kaputt, (await bau.baueDummyPack({ quiz: { version: 1, fragen: [{ id: 'x', art: 'wissen' }] } })).bytes);
    await e.locator('#datei').setInputFiles(kaputt);
    await e.locator('#annehmen').click().catch(() => {});
    await e.waitForTimeout(1500);
    const quizAntwort = await e.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'quiz' }));
    expect(quizAntwort.daten).toBeNull();
    const s = await frischeSeite();
    await oeffne(s, { frage: 'test-w1' });
    await expect.poll(() => ergebnis(s), { timeout: 8000 }).toBe('abgebrochen');
    expect(await abbild(s)).toBeNull();
    await s.close();
    console.log('chromium quiz: kaputte Quiz-Bank gibt daten null und abgebrochen');
  } finally {
    await e.close();
  }
});
