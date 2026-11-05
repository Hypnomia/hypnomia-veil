// Chromium: Phase 6, Session 11, Auftrag S. Einstellungen auf einem Bildschirm: Aufbau und Sprungleiste, jeder Schalter, Regler und Knopf
// der neuen Abschnitte wird geklickt und der Speicher geprueft (Pause, Stimmung, Zonen, bedeckt, Stil, Strict, Ausnahmen), Popup und
// Einstellungsseite zeigen denselben Stand, Pack-Sperre vor dem Einstieg, 360 px ohne waagrechten Ueberlauf.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const erweiterung = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output', 'chrome-mv3');
const standardListe = JSON.parse(readFileSync(path.join(wurzel, 'data/ausnahmen-standard.json'), 'utf8'));
const ersteStandardSeite: string = standardListe.gruppen[0].muster[0].muster ?? standardListe.gruppen[0].muster[0];

// Verschiedene Hosts der Standardliste (Pfadmuster zaehlen zur selben Seite).
const standardHosts = new Set(
  standardListe.gruppen.flatMap((g: any) => g.muster.map((m: any) => String(m.muster ?? m).trim().toLowerCase().split('/')[0])),
).size;

let profil = '';
let context: BrowserContext;
let id = '';

const optionsUrl = () => `chrome-extension://${id}/options.html`;
const popupUrl = () => `chrome-extension://${id}/popup.html`;
const lies = (seite: Page, k: string) =>
  seite.evaluate(async (k) => ((await (globalThis as any).chrome.storage.local.get(k)) as Record<string, any>)[k], k);
const schreibe = (seite: Page, o: Record<string, unknown>) => seite.evaluate((o) => (globalThis as any).chrome.storage.local.set(o), o);
const einst = async (seite: Page) => (await lies(seite, 'einstellungen')) ?? {};
const packMit = (freischaltungen: string[]) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const zuruecksetzen = (seite: Page) =>
  seite.evaluate(() => (globalThis as any).chrome.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'quizWarnungGesehen', 'spiraleWarnungGesehen']));
// Regler per Tastatur (Pfeiltasten, Pos1, Ende), wie eine Person ihn bedient; jeder Tastendruck speichert.
const taste = async (seite: Page, css: string, taste: string, n = 1) => {
  await seite.locator(css).focus();
  for (let i = 0; i < n; i++) await seite.keyboard.press(taste);
};
// Echte Mausklicks auf die sichtbare Beschriftung (Label) des Schalters, nicht auf das versteckte Eingabefeld.
const zonenLabel = (seite: Page, name: string) => seite.locator('#zonen label.schalter').filter({ hasText: name });
const stilLabel = (seite: Page, name: string) => seite.locator('.wahl label').filter({ hasText: name });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profil = await mkdtemp(path.join(tmpdir(), 'veil-einstellungen-'));
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

async function frischeSeite(): Promise<Page> {
  const seite = await context.newPage();
  await seite.goto(optionsUrl());
  await zuruecksetzen(seite);
  await seite.reload();
  return seite;
}

test('Aufbau: Titel, Status, Sprungleiste und alle Abschnitte in der Reihenfolge des Auftrags', async () => {
  const seite = await frischeSeite();
  try {
    await expect(seite).toHaveTitle('HYPNOMIA VEIL: Settings');
    await expect(seite.locator('#status')).toContainText('On watch');
    await expect(seite.locator('#pause')).toHaveText('Pause Mia');
    // Reihenfolge der Abschnitte (Auftrag S Punkt 1) und die leeren Plaetze der anderen Bauer.
    const reihenfolge = await seite.evaluate(() =>
      [...document.querySelectorAll('main > section')].map((s) => s.id),
    );
    const soll = ['abschnitt-stimmung', 'abschnitt-zonen', 'abschnitt-stil', 'abschnitt-strict', 'abschnitt-ausnahmen', 'erwachsen', 'abschnitt-ruhig', 'kontrolle', 'ton', 'ledger', 'stand', 'neu', 'ueber', 'abschnitt-interview'];
    expect(reihenfolge).toEqual(soll);
    // Jeder Link der Sprungleiste zeigt auf einen vorhandenen Abschnitt.
    const links = await seite.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('#sprung a')].map((a) => ({ ziel: a.getAttribute('href')!.slice(1), da: !!document.getElementById(a.getAttribute('href')!.slice(1)) && document.getElementById(a.getAttribute('href')!.slice(1))!.getClientRects().length > 0 })));
    expect(links.length).toBeGreaterThanOrEqual(10);
    // Ziel vorhanden UND sichtbar (ein Abschnitt, den sein Modul nicht fuellt, waere ein toter Link).
    expect(links.filter((l) => !l.da).map((l) => l.ziel)).toEqual([]);
    // Bestehende Abschnitte behalten ihre ids.
    for (const sel of ['#kon-titel', '#erw-titel', '#seite-feld', '#verweigern', '#freilegen', '#ruhig', '#datei', '#pack-status']) await expect(seite.locator(sel)).toHaveCount(1);
    // Alle Zonen aufgebaut (10), sechs davon mit "even when clothed".
    await expect(seite.locator('#zonen input[data-zone]')).toHaveCount(10);
    await expect(seite.locator('#zonen input[data-bedeckt]')).toHaveCount(6);
  } finally {
    await seite.close();
  }
});

test('Pause, Stimmung, Zonen, bedeckt, Stil und Strict: jeder Klick landet im Speicher', async () => {
  const seite = await frischeSeite();
  try {
    // Pause (Knopf, Nachricht an den Hintergrund) und zurueck
    await seite.locator('#pause').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(true);
    await expect(seite.locator('#status')).toContainText('Paused');
    await expect(seite.locator('#pause')).toHaveText('Let Mia back in');
    await seite.locator('#pause').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(false);
    await expect(seite.locator('#status')).toContainText('On watch');

    // Stimmung per Tastatur: 8 Pfeil-rechts-Schritte von 0.10 auf 0.18, Ende setzt den Hoechstwert 0.25, Pos1 den Tiefstwert 0.10
    await taste(seite, '#stimmung', 'ArrowRight', 8);
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.18, 5);
    await expect(seite.locator('#stimmung-wert')).toHaveText('0.18');
    await taste(seite, '#stimmung', 'End');
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.25, 5);
    await taste(seite, '#stimmung', 'ArrowRight');
    await expect(seite.locator('#stimmung-wert')).toHaveText('0.25');
    await taste(seite, '#stimmung', 'Home');
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.1, 5);
    await taste(seite, '#stimmung', 'ArrowRight', 8);
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.18, 5);

    // Zonen mit echten Klicks aufs Label: Augen an, Bauch an, dann "even when clothed" fuer den Bauch; Brueste aus
    await zonenLabel(seite, 'Eyes').click();
    await expect.poll(async () => (await einst(seite)).zonen?.eyes?.an).toBe(true);
    await expect(seite.locator('#zonen input[data-bedeckt="belly"]')).toBeDisabled();
    await zonenLabel(seite, 'Belly').click();
    await expect.poll(async () => (await einst(seite)).zonen?.belly?.an).toBe(true);
    await expect(seite.locator('#zonen input[data-bedeckt="belly"]')).toBeEnabled();
    await seite.getByLabel('Belly: even when clothed').click();
    await expect.poll(async () => (await einst(seite)).zonen?.belly?.bedeckt).toBe(true);
    await zonenLabel(seite, 'Breasts').click();
    await expect.poll(async () => (await einst(seite)).zonen?.breast?.an).toBe(false);
    // Jedes "even when clothed"-Kaestchen hat einen eigenen Namen
    const namen = await seite.locator('#zonen input[data-bedeckt]').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label')));
    expect(new Set(namen).size).toBe(6);

    // Stil: Blur gewaehlt; Mia patch ohne Pack gesperrt, mit Hinweis
    await stilLabel(seite, 'Blur').click();
    await expect.poll(async () => (await einst(seite)).stil).toBe('blur');
    await expect(seite.locator('input[name="stil"][value="mia-patch"]')).toBeDisabled();
    await expect(seite.locator('#stil-hinweis')).toContainText('Mia Pack');
    // Mit Pack waehlbar und gespeichert
    await schreibe(seite, { pack: packMit(['stil:mia-patch']) });
    await expect(seite.locator('input[name="stil"][value="mia-patch"]')).toBeEnabled();
    await expect(seite.locator('#stil-hinweis')).toContainText('7 of my pictures');
    await stilLabel(seite, 'Mia patch').click();
    await expect.poll(async () => (await einst(seite)).stil).toBe('mia-patch');
    await stilLabel(seite, 'Mosaic').click();
    await expect.poll(async () => (await einst(seite)).stil).toBe('mosaik');

    // Strict (Klick aufs Label)
    const strictLabel = seite.locator('#abschnitt-strict label.schalter');
    await strictLabel.click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(true);
    await strictLabel.click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(false);
    // Messzahl: die geaenderten Felder im Speicher
    const e = await einst(seite);
    console.log(`einstellungen: schwelle ${e.schwelle}, stil ${e.stil}, belly ${JSON.stringify(e.zonen.belly)}`);
  } finally {
    await seite.close();
  }
});

test('Ausnahmen: hinzufuegen (Adresse bereinigt), doppelt, ungueltig, Standardliste, entfernen', async () => {
  const seite = await frischeSeite();
  try {
    await expect(seite.locator('#ausnahmen-standard')).toContainText(String(standardHosts));
    await expect(seite.locator('#status-ausnahmen')).toContainText('single site alone');
    await expect(seite.locator('#ausnahmen-liste .leer')).toBeVisible();
    await seite.fill('#ausnahme-feld', 'https://WWW.Example.com/');
    await seite.click('#ausnahme-add');
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['example.com']);
    await expect(seite.locator('#ausnahmen-liste')).toContainText('example.com');
    await expect(seite.locator('#status-ausnahmen')).toContainText('1 site you asked me to leave alone');
    await expect(seite.locator('#ausnahme-feld')).toHaveValue('');
    await seite.fill('#ausnahme-feld', 'example.com');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('already');
    await seite.fill('#ausnahme-feld', 'kein host');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('doesn’t look like');
    await seite.fill('#ausnahme-feld', ersteStandardSeite);
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('never-touch');
    // Schon abgedeckt: Unterseite und Pfad von example.com; Umlaut-Domain als xn--Form; oeffentliche Endung abgelehnt
    await seite.fill('#ausnahme-feld', 'sub.example.com');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('already covered by example.com');
    await seite.fill('#ausnahme-feld', 'example.com/x');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('already covered by example.com');
    await seite.fill('#ausnahme-feld', 'co.uk');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('whole crowd');
    await seite.fill('#ausnahme-feld', 'github.io');
    await seite.click('#ausnahme-add');
    await expect(seite.locator('#ausnahme-meldung')).toContainText('whole crowd');
    await seite.fill('#ausnahme-feld', 'bücher.de');
    await seite.click('#ausnahme-add');
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['example.com', 'xn--bcher-kva.de']);
    await seite.locator('#ausnahmen-liste button[data-muster="xn--bcher-kva.de"]').click();
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['example.com']);
    await seite.fill('#ausnahme-feld', 'zweite-seite.org/pfad');
    await seite.press('#ausnahme-feld', 'Enter');
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['example.com', 'zweite-seite.org/pfad']);
    await expect(seite.locator('#ausnahmen-liste li')).toHaveCount(2);
    await seite.locator('#ausnahmen-liste button[data-muster="example.com"]').click();
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual(['zweite-seite.org/pfad']);
    await seite.locator('#ausnahmen-liste button').click();
    await expect.poll(async () => (await einst(seite)).ausnahmen).toEqual([]);
    await expect(seite.locator('#ausnahmen-liste .leer')).toBeVisible();
  } finally {
    await seite.close();
  }
});

test('Popup und Einstellungsseite zeigen nach einer Aenderung denselben Stand', async () => {
  const seite = await frischeSeite();
  const popup = await context.newPage();
  try {
    await popup.goto(popupUrl());
    await expect(popup.locator('#pause')).toHaveText('Pause Mia');
    // Aenderung auf der Einstellungsseite (echte Klicks und Tasten), Popup folgt; jede Aenderung einzeln im Speicher abwarten
    await seite.locator('#pause').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(true);
    await taste(seite, '#stimmung', 'ArrowRight', 12);
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.22, 5);
    await seite.locator('#abschnitt-strict label.schalter').click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(true);
    await zonenLabel(seite, 'Mouth').click();
    await expect.poll(async () => (await einst(seite)).zonen?.mouth?.an).toBe(true);
    await stilLabel(seite, 'Blur').click();
    await expect.poll(async () => (await einst(seite)).stil).toBe('blur');
    await expect(popup.locator('#pause')).toHaveText('Let Mia back in');
    await expect(popup.locator('#stimmung-wert')).toHaveText('0.22');
    await expect(popup.locator('#strict')).toBeChecked();
    await expect(popup.locator('#zonen input[data-zone="mouth"]')).toBeChecked();
    await expect(popup.locator('input[name="stil"][value="blur"]')).toBeChecked();
    // Aenderung im Popup, Einstellungsseite folgt
    await popup.locator('#pause').click();
    await expect.poll(async () => (await einst(seite)).pause).toBe(false);
    await taste(popup, '#stimmung', 'ArrowLeft', 10);
    await expect.poll(async () => (await einst(seite)).schwelle).toBeCloseTo(0.12, 5);
    await popup.locator('#zonen label.schalter').filter({ hasText: 'Mouth' }).click();
    await expect.poll(async () => (await einst(seite)).zonen?.mouth?.an).toBe(false);
    await popup.locator('label.schalter:has(#strict)').click();
    await expect.poll(async () => (await einst(seite)).strict).toBe(false);
    await expect(seite.locator('#pause')).toHaveText('Pause Mia');
    await expect(seite.locator('#stimmung-wert')).toHaveText('0.12');
    await expect(seite.locator('#strict')).not.toBeChecked();
    await expect(seite.locator('#zonen input[data-zone="mouth"]')).not.toBeChecked();
    const e = await einst(seite);
    expect(e.schwelle).toBeCloseTo(0.12, 5);
    console.log(`einstellungen: Popup und Seite gleich, schwelle ${e.schwelle}`);
  } finally {
    await popup.close();
    await seite.close();
  }
});

test('Adult sites: drei Schalter auch ohne Pack, Full replacement nur mit Adult-site mode, Popup zeigt denselben Stand', async () => {
  const seite = await frischeSeite();
  const popup = await context.newPage();
  try {
    const sw = (feld: string) => seite.locator(`label.schalter:has(#${feld})`);
    // Ohne Pack: alle drei sichtbar, Hinweis "ready", Standardwerte an, aus, an
    await expect(seite.locator('#erw-pack-hinweis')).toContainText('they’ll be ready');
    for (const f of ['erw-an', 'erw-ersatz', 'erw-inhalt']) await expect(sw(f)).toBeVisible();
    await expect(seite.locator('#erw-an')).toBeChecked();
    await expect(seite.locator('#erw-ersatz')).not.toBeChecked();
    await expect(seite.locator('#erw-inhalt')).toBeChecked();
    await expect(seite.locator('#erw-ersatz')).toBeEnabled();
    // Full replacement an, dann Adult-site mode aus: Full replacement gesperrt
    await sw('erw-ersatz').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.komplettErsatz).toBe(true);
    await sw('erw-inhalt').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.erkennenAmInhalt).toBe(false);
    // Popup mit Pack zeigt denselben Stand
    await schreibe(seite, { pack: packMit(['erwachsen:vorschau', 'erwachsen:ersatz']) });
    await popup.goto(popupUrl());
    await expect(popup.locator('#erw-ersatz')).toBeChecked();
    await expect(popup.locator('#erw-inhalt')).not.toBeChecked();
    await sw('erw-an').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.an).toBe(false);
    await expect(seite.locator('#erw-ersatz')).toBeDisabled();
    await expect(popup.locator('#erw-an')).not.toBeChecked();
    await sw('erw-an').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.an).toBe(true);
    await expect(seite.locator('#erw-ersatz')).toBeEnabled();
    // Aenderung im Popup, Seite folgt
    await popup.locator('label.schalter:has(#erw-inhalt)').click();
    await expect.poll(async () => (await einst(seite)).erwachsen?.erkennenAmInhalt).toBe(true);
    await expect(seite.locator('#erw-inhalt')).toBeChecked();
    const e = (await einst(seite)).erwachsen;
    console.log(`einstellungen: erwachsen an ${e.an}, ersatz ${e.komplettErsatz}, inhalt ${e.erkennenAmInhalt}`);
  } finally {
    await popup.close();
    await seite.close();
  }
});

const packDatei = { name: 'x.miapack', mimeType: 'application/octet-stream', buffer: Buffer.from('kein echtes Pack') };
const idbDateien = (seite: Page) =>
  seite.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === 'veil-pack')) return 0;
    const db = await new Promise<IDBDatabase>((ok, nein) => {
      const r = indexedDB.open('veil-pack');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => nein(r.error);
    });
    if (!db.objectStoreNames.contains('dateien')) return 0;
    const n = await new Promise<number>((ok) => {
      const r = db.transaction('dateien').objectStore('dateien').count();
      r.onsuccess = () => ok(r.result);
    });
    db.close();
    return n;
  });

test('Pack-Sperre vor dem Einstieg: Dateiwurf wird abgewiesen (nichts gespeichert), Meet Mia first, folgt dem Speicher, Interview-Knopf', async () => {
  const seite = await frischeSeite();
  try {
    // Einstieg ueber den Testhaken zuruecksetzen (E)
    const antwort = await seite.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'einstieg-test', zuruecksetzen: true }));
    expect(antwort.ok).toBe(true);
    await seite.reload();
    await expect(seite.locator('#datei')).toBeDisabled();
    await expect(seite.locator('#datei')).toHaveAttribute('aria-describedby', 'pack-sperre-text');
    await expect(seite.locator('#pack-sperre')).toBeVisible();
    await expect(seite.locator('#abschnitt-interview')).toBeHidden();
    // Dateiwurf auf das gesperrte Feld: nichts passiert (keine Meldung, keine Lizenz)
    await seite.locator('#datei').setInputFiles(packDatei, { timeout: 1500 }).catch(() => undefined);
    await seite.waitForTimeout(300);
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect(await lies(seite, 'pack')).toBeUndefined();
    // Sperre im Feld umgangen (wie ein Wurf aus dem Dateimanager): die Pruefung im Speicher weist die Datei ab
    await seite.locator('#datei').evaluate((e: HTMLInputElement) => (e.disabled = false));
    await seite.locator('#datei').setInputFiles(packDatei);
    await expect(seite.locator('#meldung')).toContainText('Meet me first');
    await expect(seite.locator('#lizenz-block')).toBeHidden();
    expect(await lies(seite, 'pack')).toBeUndefined();
    expect(await idbDateien(seite)).toBe(0);
    console.log('einstellungen: Dateiwurf vor dem Einstieg abgewiesen, pack leer, IndexedDB 0 Dateien');
    // Nur die Warnung bestaetigt: noch gesperrt
    await schreibe(seite, { einstieg: { ...EINSTIEG_FERTIG, alter: false, einwilligung: false, interview: 'offen' } });
    await seite.locator('#datei').evaluate((e: HTMLInputElement) => (e.disabled = true));
    await expect(seite.locator('#pack-sperre')).toBeVisible();
    // "Meet Mia first" oeffnet die Willkommensseite
    const neu = context.waitForEvent('page');
    await seite.locator('#pack-sperre-knopf').click();
    const willkommen = await neu;
    expect(willkommen.url()).toBe(`chrome-extension://${id}/willkommen.html`);
    await willkommen.close();
    // Einstieg fertig: Sperre faellt, Interview-Knopf erscheint
    await schreibe(seite, { einstieg: EINSTIEG_FERTIG });
    await expect(seite.locator('#datei')).toBeEnabled();
    await expect(seite.locator('#pack-sperre')).toBeHidden();
    await expect(seite.locator('#abschnitt-interview')).toBeVisible();
    const neu2 = context.waitForEvent('page');
    await seite.locator('#interview-neu').click();
    const interview = await neu2;
    expect(interview.url()).toBe(`chrome-extension://${id}/willkommen.html#interview`);
    await interview.close();
    // Mit fertigem Einstieg wird die Datei angenommen und geprueft (hier als kein Pack erkannt, aber nicht abgewiesen)
    await seite.locator('#datei').setInputFiles(packDatei);
    await expect(seite.locator('#meldung')).toContainText('doesn');
    // Wieder zurueck (Einstieg geloescht): gesperrt
    await seite.evaluate(() => (globalThis as any).chrome.storage.local.remove('einstieg'));
    await expect(seite.locator('#datei')).toBeDisabled();
  } finally {
    await seite.close();
  }
});

test('360 px Breite: kein waagrechter Ueberlauf, auch mit Pack, Ausnahmen und strengen Zeiten', async () => {
  const seite = await frischeSeite();
  try {
    await seite.setViewportSize({ width: 360, height: 800 });
    await schreibe(seite, {
      einstieg: EINSTIEG_FERTIG,
      pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'kontrolle:zeitplan']),
      einstellungen: { ausnahmen: ['eine-ziemlich-lange-adresse-fuer-den-test.example.com/mit/langem/pfad', 'kurz.de'] },
    });
    await seite.reload();
    await seite.locator('#kon-zeit-neu').click();
    await expect(seite.locator('#ausnahmen-liste li')).toHaveCount(2);
    const mass = await seite.evaluate(() => ({ breite: document.documentElement.scrollWidth, fenster: document.documentElement.clientWidth }));
    console.log(`einstellungen: 360 px, scrollWidth ${mass.breite}, clientWidth ${mass.fenster}`);
    expect(mass.breite).toBeLessThanOrEqual(mass.fenster);
    // Auch der Koerper
    const koerper = await seite.evaluate(() => document.body.scrollWidth <= document.body.clientWidth);
    expect(koerper).toBe(true);
  } finally {
    await seite.close();
  }
});
