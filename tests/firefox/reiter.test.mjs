// Firefox: Phase 11 E4d1, die Huelle der Einstellungsseite (Entscheidungen 245 und 279): sieben Reiter, alte Anker, Tastatur, Pause und Fehlersatz in
// jedem Reiter, Reiterwechsel schreibt nichts, jede Einstellung genau einmal, ohne Pack drei zugeklappte Teile, Platz der festen Vorschau folgt dem
// gespeicherten Stil, 360 px ohne waagrechtes Scrollen in jedem Reiter (D1 bis D10). Hilfsfunktionen wie einstellungen.test.mjs, stumm gestartet.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMMLE_SKRIPT, vergleicheBedienelemente } from '../gemeinsam/einstellungen-soll.mjs';
import { REITER as REITERDATEN } from '../../entrypoints/options/reiter-daten.ts';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 150 s ueberschritten');
  process.exit(1);
}, 150_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const GECKO_ID = 'veil@hypnomia';

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}

// Erweiterung als temporaeres Add-on installieren, ueber den Pfad (nicht Base64 wie driver.installAddon): geckodriver 0.37 mit Firefox 128
// lehnt die Base64-Form ab (InvalidArgumentError), der Pfad geht in 128 und in neueren Versionen.
async function installiere(treiber, paketPfad) {
  await treiber.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let rot = 0;
function pruefe(bedingung, text) {
  if (bedingung) ok++;
  else {
    rot++;
    console.error(`firefox: ROT  ${text}`);
  }
}

let driver;
const uuid = randomUUID();

async function oeffne(seite) {
  const vorher = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow('navigator:browser');
       w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/${seite}`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error(`Erweiterungsseite ${seite} nicht geoeffnet`);
  await driver.switchTo().window(neu);
  return neu;
}

async function imSeitenkontext(code, ...args) {
  const text = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
     const args = JSON.parse(arguments[0]);
     const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
     Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
    JSON.stringify(args),
  );
  return JSON.parse(text);
}

const speicher = (schluessel) => imSeitenkontext(`const a = await api.storage.local.get(args[0]); return a[args[0]] ?? null;`, schluessel);

async function bis(beschreibung, fn, frist = 15_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}


const text = async (css) => (await driver.executeScript(`return document.querySelector(arguments[0]).textContent.trim()`, css));
const EINSTIEG_FERTIG = { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 };
const setze = (o) => imSeitenkontext(`await api.storage.local.set(args[0]);`, o);
const packMit = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen, bilder: 7, groesse: 1, importiert: 1 });
const einst = async () => (await speicher('einstellungen')) ?? {};
const wdKlick = async (by) => (await driver.findElement(by)).click();
const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const imBlick = (css) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); if (!e || e.getClientRects().length === 0) return false; const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;`, css);
const gewaehlt = () => driver.executeScript(`return [...document.querySelectorAll('[role=tab][aria-selected=true]')].map((t) => t.textContent)`);
const tabKlick = (name) => wdKlick(By.xpath(`//*[@role='tab'][normalize-space(.)='${name}']`));

// Die Namen stehen nur in reiter-daten.ts (N11).
const REITER = REITERDATEN.map((r) => r.name);
const ID_REITER = Object.fromEntries(REITERDATEN.map((r) => [r.id, r.name]));
const ANKER = [
  ['covering', 'zonen'], ['abschnitt-stil', 'stil'], ['abschnitt-zonen', 'zonen'], ['abschnitt-stimmung', 'zonen'], ['abschnitt-ausnahmen', 'zonen'],
  ['stand', 'pack'], ['neu', 'pack'], ['erwachsen', 'erwachsen'], ['kontrolle', 'extras'], ['ton', 'pack'], ['ledger', 'ledger'], ['ueber', 'ueber'], ['abschnitt-interview', 'ueber'],
];

async function warteBereit() {
  await bis('Seite gezeichnet', async () => driver.executeScript(`return document.body.getAttribute('data-veil-ordnung') === 'bereit'`).catch(() => false));
}

// Horcher auf alle Aenderungen des Speichers in einer zweiten Erweiterungsseite (RM1): jedes Ereignis nennt Bereich, Schluessel, ob alt und neu gleich
// sind, die Zeit seit Beginn des Zaehlens und die offenen Tabs; ein roter Lauf gibt sie aus.
const HORCHER_START = `const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
  window.__t0 = Date.now(); window.__ereignisse = [];
  api.storage.onChanged.addListener((a, bereich) => {
    const e = { bereich, t: Date.now() - window.__t0, schluessel: Object.keys(a).map((k) => ({ k, gleich: JSON.stringify(a[k].oldValue) === JSON.stringify(a[k].newValue) })), tabs: null };
    window.__ereignisse.push(e);
    try { api.tabs.query({}).then((l) => { e.tabs = l.map((t) => String(t.url || '').replace(/^moz-extension:\\/\\/[^/]+\\//, '')); }, () => {}); } catch { /* ohne Tabs-API */ }
  });`;
const liesHorcher = () => driver.executeScript(`return window.__ereignisse`);
const zaehle = async (beschreibung, text) => {
  const e = await liesHorcher();
  pruefe(e.length === 0, `${beschreibung}${e.length ? ' ' + JSON.stringify(e) : ''}`);
};

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  await oeffne('options.html');
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`);
  await setze({ einstieg: EINSTIEG_FERTIG });
  await driver.navigate().refresh();
  await warteBereit();

  // ---- Aufbau (D1, D4) ----
  const tabs = await driver.executeScript(`return [...document.querySelectorAll('[role=tablist] [role=tab]')].map((t) => t.textContent)`);
  pruefe(JSON.stringify(tabs) === JSON.stringify(REITER), `sieben Reiter ${JSON.stringify(tabs)}`);
  pruefe(JSON.stringify(await gewaehlt()) === '["Style"]', 'ohne Anker ist Style gewaehlt');
  const bau = await driver.executeScript(`return [...document.querySelectorAll('[role=tab]')].map((t) => { const p = document.getElementById(t.getAttribute('aria-controls')); return { rolle: p.getAttribute('role'), benannt: p.getAttribute('aria-labelledby') === t.id, offen: !p.hidden, tabindex: t.tabIndex }; })`);
  pruefe(bau.every((b) => b.rolle === 'tabpanel' && b.benannt) && bau.filter((b) => b.offen).length === 1, 'tabpanel je Reiter, genau eines offen');
  pruefe(JSON.stringify(bau.map((b) => b.tabindex)) === '[0,-1,-1,-1,-1,-1,-1]', 'Tab-Halt nur am gewaehlten Reiter');
  const aufgebaut = await driver.executeScript(`return { zonen: document.querySelectorAll('#panel-zonen #zonen-wahl .v-chip').length, karten: document.querySelectorAll('#panel-stil #preset-karten label.preset-karte').length, verborgen: document.querySelectorAll('[role=tabpanel][hidden]').length }`);
  pruefe(aufgebaut.zonen === 10 && aufgebaut.karten === 12 && aufgebaut.verborgen === 6, `alle Module in verborgenen Reitern aufgebaut ${JSON.stringify(aufgebaut)}`);

  // ---- Anker beim Laden (D3) und beim Wechsel ----
  for (const [anker, reiter] of ANKER) {
    await driver.get(`moz-extension://${uuid}/options.html#${anker}`);
    await driver.navigate().refresh();
    await warteBereit();
    await bis(`Reiter fuer #${anker}`, async () => (await gewaehlt())[0] === ID_REITER[reiter]);
    await bis(`Ziel #${anker} im Blick`, () => imBlick(`#${anker}`));
    pruefe(true, `Anker #${anker} oeffnet ${ID_REITER[reiter]}`);
  }
  await driver.get(`moz-extension://${uuid}/options.html`);
  await warteBereit();
  for (const [anker, reiter] of ANKER) {
    await driver.executeScript(`location.hash = '#' + arguments[0]`, anker);
    await bis(`Wechsel auf #${anker}`, async () => (await gewaehlt())[0] === ID_REITER[reiter]);
    await bis(`Ziel #${anker} nach Wechsel im Blick`, () => imBlick(`#${anker}`));
    pruefe(true, `Wechsel auf #${anker} oeffnet ${ID_REITER[reiter]}`);
  }

  // ---- Klick, Anker der Adresse, Zurueck (D4) ----
  await driver.get(`moz-extension://${uuid}/options.html`);
  await warteBereit();
  await tabKlick('Adult sites');
  await tabKlick('Ledger');
  pruefe((await driver.executeScript(`return location.hash`)) === '#ledger', 'Klick setzt den Anker des Reiters in die Adresse');
  await driver.navigate().back();
  await bis('Zurueck wechselt den Reiter', async () => (await gewaehlt())[0] === 'Adult sites');
  pruefe(true, 'Zurueck im Browser wechselt den Reiter');

  // ---- Tastatur ----
  await driver.get(`moz-extension://${uuid}/options.html`);
  await warteBereit();
  const tab0 = await driver.findElement(By.id('reiter-stil'));
  await tab0.click();
  await tab0.sendKeys(Key.ARROW_DOWN);
  pruefe((await driver.executeScript(`return document.activeElement.id`)) === 'reiter-zonen', 'Pfeil runter bewegt den Fokus');
  pruefe(JSON.stringify(await gewaehlt()) === '["Style"]', 'ein Pfeil waehlt nicht');
  await driver.actions().sendKeys(Key.END).perform();
  pruefe((await driver.executeScript(`return document.activeElement.id`)) === 'reiter-ueber', 'Ende geht zum letzten Reiter');
  await driver.actions().sendKeys(Key.HOME).perform();
  pruefe((await driver.executeScript(`return document.activeElement.id`)) === 'reiter-stil', 'Pos1 geht zum ersten Reiter');
  await driver.actions().sendKeys(Key.ARROW_DOWN, Key.ENTER).perform();
  await bis('Eingabe waehlt', async () => (await gewaehlt())[0] === 'What I cover');
  await driver.actions().sendKeys(Key.ARROW_DOWN, ' ').perform();
  await bis('Leertaste waehlt', async () => (await gewaehlt())[0] === 'Adult sites');
  pruefe(true, 'Eingabe und Leertaste waehlen');

  // ---- Pause in jedem Reiter, Fehlersatz bleibt (D5, D9) ----
  // Je Versuch wird der gerade sichtbare Knopf neu gewaehlt (die kleine Pause der Leiste folgt dem Scrollen asynchron, der Status bewegt die Seite):
  // sein Rechteck muss im Fenster liegen, gedrueckt wird mit einem echten WebDriver-Klick, die Wirkung steht im Speicher.
  const sichtbarerKnopf = () =>
    driver.executeScript(`for (const id of ['pause-leiste', 'pause']) { const e = document.getElementById(id); if (!e || e.hidden) continue; const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth) return id; } return null;`);
  // Q3: nach einem angekommenen WebDriver-Klick wird nicht erneut geklickt; geklickt wird nur neu, wenn der Klick nachweislich nicht ankam (WebDriver
  // wirft: Knopf verdeckt, ersetzt oder nicht im Fenster). Auf die Wirkung wartet der Test bis zu 6 s.
  const druecke = async (name, ziel) => {
    for (let versuch = 0; versuch < 8; versuch++) {
      const knopf = await sichtbarerKnopf();
      if (!knopf) {
        await warte(200);
        continue;
      }
      try {
        await wdKlick(By.id(knopf));
      } catch {
        continue; // der Klick kam nicht an: neu waehlen
      }
      for (let i = 0; i < 120; i++) {
        if ((await einst()).pause === ziel) return knopf;
        await warte(50);
      }
      throw new Error(`Pause in ${name}: der Klick kam an, aber pause=${ziel} stand nach 6 s nicht im Speicher`);
    }
    throw new Error(`Pause in ${name}: kein Klick kam an`);
  };
  // Zaehler der Pause-Wechsel im Speicher (Ereignisse des Schluessels einstellungen, bei denen sich pause aendert).
  await driver.executeScript(`const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome; window.__pauseWechsel = 0; api.storage.onChanged.addListener((a) => { const c = a.einstellungen; if (c && !!(c.oldValue && c.oldValue.pause) !== !!(c.newValue && c.newValue.pause)) window.__pauseWechsel++; });`);
  for (const name of REITER) {
    await tabKlick(name);
    await driver.executeScript(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await warte(400);
    pruefe(!!(await sichtbarerKnopf()), `Pause im Fenster in ${name}`);
    const vorWechsel = await driver.executeScript(`return window.__pauseWechsel`);
    const k1 = await druecke(name, true);
    const k2 = await druecke(name, false);
    await warte(300);
    const wechsel = (await driver.executeScript(`return window.__pauseWechsel`)) - vorWechsel;
    pruefe(wechsel === 2, `Pause in ${name}: genau einmal ein und einmal aus (${wechsel} Wechsel, ${k1}, ${k2})`);
  }
  // Speichern scheitern lassen im Seitenkontext (wie einstellungen-s12.test.mjs)
  await driver.executeScript(`const sl = (window.wrappedJSObject && window.wrappedJSObject.browser ? window.wrappedJSObject.browser : (window.browser || window.chrome)).storage.local; window.__echt = sl.set.bind(sl); sl.set = (o) => ('einstellungen' in o ? Promise.reject(new Error('Test')) : window.__echt(o));`).catch(() => {});
  await tabKlick('What I cover');
  await wdKlick(By.xpath(`//label[.//input[@id='strict']]`));
  await bis('Fehlersatz', async () => (await sichtbar('#speicher-meldung')) && (await text('#speicher-meldung')) === FEHLER_SPEICHERN);
  for (const name of REITER) {
    await tabKlick(name);
    pruefe((await sichtbar('#speicher-meldung')) && (await text('#speicher-meldung')) === FEHLER_SPEICHERN, `Fehlersatz in der Leiste in ${name}`);
  }
  // aus einem verborgenen Reiter: Klick im Dokument (kein Mausklick moeglich)
  await driver.executeScript(`const m = document.getElementById('speicher-meldung'); m.textContent = ''; m.hidden = true;`);
  await tabKlick('Ledger');
  await driver.executeScript(`document.getElementById('kon-leerlauf').click()`);
  await bis('Fehlersatz aus verborgenem Reiter', async () => (await sichtbar('#speicher-meldung')) && (await text('#speicher-meldung')) === FEHLER_SPEICHERN);
  pruefe(!(await sichtbar('#panel-extras')), 'das Element liegt in einem verborgenen Reiter');
  pruefe(true, 'Fehlersatz aus verborgenem Reiter steht in der Leiste');

  // ---- Oeffnen und Reiterwechsel schreiben nichts (D9, N5): der Zaehler liegt schon vor dem Laden der Seite an (zweite Erweiterungsseite) ----
  await setze({ einstellungen: { schwelle: 0.17, preset: 'blur', strict: true } });
  const horcher = await oeffne('hilfe.html');
  // Der neue Tab kann noch about:blank sein: erst wenn die Hilfeseite geladen ist, wird der Horcher gesetzt (sonst ueberschreibt das Laden ihn, `liesHorcher` gibt null).
  await bis('Hilfeseite geladen', async () => (await driver.executeScript(`return location.protocol === 'moz-extension:' && document.readyState === 'complete'`).catch(() => false)) === true);
  await driver.executeScript(HORCHER_START);
  // Abhilfe RM1 (a): vor dem Zaehlen alle anderen Erweiterungs-Tabs schliessen (auch die Einstellungsseite aus den frueheren Teilen) und auf Ruhe
  // warten (1 s ohne Ereignis, nachlaufende Schreibvorgaenge des Hintergrunds nach den Schaltungen davor); erst dann wird der Zaehler genullt.
  for (const h of await driver.getAllWindowHandles()) {
    if (h === horcher) continue;
    await driver.switchTo().window(h);
    await driver.close();
  }
  await driver.switchTo().window(horcher);
  // Obergrenze (Fund RN5): schreibt der Hintergrund dauernd, wird der Test nach 30 s rot, statt zu haengen.
  for (let still = Date.now(), beginn = Date.now(), n = 0; Date.now() - still < 1000; ) {
    if (Date.now() - beginn > 30000) throw new Error(`keine Ruhe im Speicher nach 30 s: ${JSON.stringify(await liesHorcher())}`);
    const jetzt = (await liesHorcher()).length;
    if (jetzt !== n) {
      n = jetzt;
      still = Date.now();
    }
    await warte(100);
  }
  await driver.executeScript(`window.__t0 = Date.now(); window.__ereignisse = [];`);
  const vorher = JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`));
  await oeffne('options.html');
  await warteBereit();
  await warte(800);
  const nachOeffnen = JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`));
  pruefe(nachOeffnen === vorher, 'Speicher nach dem Oeffnen gleich');
  const optionenTab = await driver.getWindowHandle();
  await driver.switchTo().window(horcher);
  await zaehle('keine Schreibereignisse beim Oeffnen (Zaehler schon vor dem Laden)');
  await driver.switchTo().window(optionenTab);
  for (const name of [...REITER, ...REITER.slice().reverse()]) await tabKlick(name);
  for (const [anker] of ANKER) await driver.executeScript(`location.hash = '#' + arguments[0]`, anker);
  await warte(500);
  pruefe(JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`)) === vorher, 'Speicher nach den Wechseln gleich');
  await driver.switchTo().window(horcher);
  await zaehle('keine Schreibereignisse beim Wechseln');
  await driver.switchTo().window(optionenTab); // der Horcher bleibt fuer die unbekannten Anker offen (Q4)

  // ---- unbekannte Anker (N3): beim Laden Style, beim Wechsel bleibt der Reiter, kein Fehler ----
  for (const anker of ['gibt-es-nicht', 'pin', 'how-i-work/pin-me', 'calm', 'status']) {
    await driver.get(`moz-extension://${uuid}/options.html#${anker}`);
    await driver.navigate().refresh();
    await warteBereit();
    pruefe(JSON.stringify(await gewaehlt()) === '["Style"]', `#${anker} beim Laden: Style`);
  }
  await driver.get(`moz-extension://${uuid}/options.html#ledger`);
  await driver.navigate().refresh();
  await warteBereit();
  await bis('Ledger beim Laden', async () => (await gewaehlt())[0] === 'Ledger');
  for (const anker of ['gibt-es-nicht', 'pin', 'how-i-work/pin-me', 'calm']) {
    await driver.executeScript(`location.hash = '#' + arguments[0]`, anker);
    await warte(150);
    pruefe((await gewaehlt())[0] === 'Ledger', `#${anker} beim Wechsel: Reiter bleibt`);
  }
  pruefe(JSON.stringify(await imSeitenkontext(`return await api.storage.local.get(null);`)) === vorher, 'unbekannte Anker schreiben nichts');
  await driver.switchTo().window(horcher);
  await zaehle('unbekannte Anker: keine Schreibereignisse (dieselben Zaehler wie beim Oeffnen und Wechseln)');
  await driver.close();
  await driver.switchTo().window(optionenTab);

  // ---- jedes Panel gefuellt (N7) ----
  for (const name of REITER) {
    await tabKlick(name);
    const m = await driver.executeScript(`const p = document.querySelector('[role=tabpanel]:not([hidden])'); const g = [...p.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); return { offen: document.querySelectorAll('[role=tabpanel]:not([hidden])').length, kinder: g.length };`);
    pruefe(m.offen === 1 && m.kinder > 0, `${name}: Panel gefuellt (${JSON.stringify(m)})`);
  }

  // ---- jede Einstellung genau einmal (D2, N2): alle Bedienelemente der Panels gegen die Soll-Liste aus HEAD (tests/gemeinsam/einstellungen-soll.mjs) ----
  const pruefeSoll = async (zustand, eintraege = {}, erwachsenFrei = false) => {
    const ist = await driver.executeScript(SAMMLE_SKRIPT);
    const fehler = vergleicheBedienelemente(ist, eintraege, { erwachsenFrei });
    pruefe(fehler.length === 0, `Bedienelemente ${zustand} gegen die Soll-Liste ${JSON.stringify(fehler)}`);
    const doppelt = await driver.executeScript(`const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return [...new Set(ids.filter((i, n) => ids.indexOf(i) !== n))];`);
    pruefe(doppelt.length === 0, `keine doppelte id ${zustand} ${JSON.stringify(doppelt)}`);
    const ausserhalb = await driver.executeScript(`return [...document.querySelectorAll('main :is(input, select, textarea, button, summary, a[role=button], [role=switch], [role=radio], [role=slider], [role=checkbox], [contenteditable])')].filter((e) => !e.closest('[role=tabpanel]') && !e.closest('header') && !e.closest('#leiste') && !e.closest('#sprung')).map((e) => e.id || e.tagName)`);
    pruefe(ausserhalb.length === 0, `Bedienelemente ausserhalb der Panels ${zustand} ${JSON.stringify(ausserhalb)}`);
  };
  await driver.navigate().refresh();
  await warteBereit();
  await pruefeSoll('ohne Pack');
  await setze({ pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'zensur:sticker', 'kontrolle:blitz', 'ton']) });
  await bis('Pack gelesen', async () => (await driver.executeScript(`return document.getElementById('erwachsen').dataset.zu`)) === '0');
  // G1: ein Pack ohne `erwachsen:vorschau` zeigt die Gruppe in der Form ohne Freischaltung (mit der Karte On)
  await setze({ pack: packMit(['stil:mia-patch', 'erwachsen:quiz']) });
  await bis('Pack gelesen (ohne Vorschau)', async () => (await driver.executeScript(`return document.getElementById('erwachsen').dataset.zu`)) === '0');
  await pruefeSoll('mit Pack ohne erwachsen:vorschau', {}, false);
  await setze({ pack: packMit(['stil:mia-patch', 'erwachsen:vorschau', 'zensur:sticker', 'kontrolle:blitz', 'ton']) });
  await bis('Gruppe mit Freischaltung', async () => (await driver.executeScript(`return document.querySelectorAll('#erw-stufe-wahl [role=radio]').length`)) === 4);
  await pruefeSoll('mit Pack', {}, true);
  // Nachtrag RN3 (E4d2): mit je einem gespeicherten Eintrag in den Listen (Ausnahmen, eigene Seiten, strenge Zeiten) steht ein Bedienelement je Zeile da
  const einstellungenDavor = await speicher('einstellungen');
  await setze({ einstellungen: { ausnahmen: ['kurz.de'], erwachsen: { eigeneSeiten: ['adult.example'] }, kontrolle: { zeiten: [{ tage: [1, 2, 3], von: 60, bis: 120 }] } } });
  await bis('Listen gezeichnet', async () => (await driver.executeScript(`return document.querySelectorAll('#ausnahmen-liste button, #seiten-liste button, #kon-zeiten .zeit-weg').length`)) === 3);
  await pruefeSoll('mit Pack und je einem Eintrag in den Listen', { '#ausnahmen-liste': 1, '#seiten-liste': 1, '#kon-zeiten': 1 }, true);
  // zurueck auf den Stand davor (kein gespeicherter Stand: entfernen)
  if (einstellungenDavor === null) await imSeitenkontext(`await api.storage.local.remove('einstellungen');`);
  else await setze({ einstellungen: einstellungenDavor });

  // ---- ohne Pack die drei zugeklappten Teile (D6) ----
  await imSeitenkontext(`await api.storage.local.remove('pack');`);
  await driver.get(`moz-extension://${uuid}/options.html`);
  await warteBereit();
  for (const [name, karte] of [['Adult sites', 'erwachsen'], ['Mia’s extras', 'kontrolle'], ['Pack and sound', 'ton']]) {
    await tabKlick(name);
    pruefe(await sichtbar(`#${karte}-zu-knopf`), `${name}: Set them now steht da`);
    pruefe(!(await sichtbar(`#${karte}-block`)), `${name}: Inhalt zugeklappt`);
    pruefe((await text(`#${karte}-zu-knopf`)) === 'Set them now', `${name}: Knopftext`);
  }
  await tabKlick('Mia’s extras');
  pruefe(await sichtbar('#ruhig'), 'Calm mode bleibt offen');
  const stand = await driver.executeScript(`return [...document.querySelectorAll('#panel-pack > section')].map((s) => s.id)`);
  pruefe(JSON.stringify(stand) === '["stand","ton"]', `ohne Pack steht die Pack-Karte vor Sound ${JSON.stringify(stand)}`);

  // ---- Vorschau folgt dem Stil (D7) ----
  await tabKlick('Style');
  pruefe((await text('#vorschau-spalte .v-vorschau-etikett')) === 'Mosaic', 'Platz der Vorschau zeigt Mosaic');
  const mosaik = await driver.executeScript(`return document.querySelector('#vorschau-spalte .v-vorschau-flaeche').innerHTML`);
  await wdKlick(By.xpath(`//div[@id='preset-karten']//label[.//strong[normalize-space(.)='Blur']]`));
  await bis('Vorschau Blur', async () => (await text('#vorschau-spalte .v-vorschau-etikett')) === 'Blur');
  pruefe((await driver.executeScript(`return document.querySelector('#vorschau-spalte .v-vorschau-flaeche').innerHTML`)) !== mosaik, 'Bild der Vorschau wechselt');
  await tabKlick('Ledger');
  pruefe((await text('#vorschau-spalte .v-vorschau-etikett')) === 'Blur' && (await sichtbar('#vorschau-spalte .v-vorschau-platz')), 'Vorschau in jedem Reiter dieselbe');
  await setze({ einstellungen: { ...(await einst()), preset: 'person-blur' } });
  await bis('Vorschau folgt dem Speicher', async () => (await text('#vorschau-spalte .v-vorschau-etikett')) === 'Whole person, blur');
  pruefe(true, 'Vorschau folgt einer Aenderung von aussen');

  // ---- 360 px: Iframe der Seite selbst, kein waagrechtes Scrollen in jedem Reiter, Reiter mindestens 44 px ----
  const schmal = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const f = document.createElement('iframe');
     f.style.cssText = 'width:360px;height:800px;position:fixed;left:0;top:0;border:0';
     f.src = location.href.split('#')[0];
     f.onload = () => setTimeout(() => {
       const d = f.contentDocument;
       const aus = [];
       for (const t of d.querySelectorAll('[role=tab]')) {
         t.click();
         const r = t.getBoundingClientRect();
         aus.push({ n: t.textContent, sw: d.documentElement.scrollWidth, iw: d.documentElement.clientWidth, h: r.height, b: r.width });
       }
       fertig(aus);
     }, 800);
     document.body.append(f);`,
  );
  pruefe(schmal.length === 7 && schmal.every((s) => s.sw <= s.iw), `360 px ohne waagrechtes Scrollen in jedem Reiter ${JSON.stringify(schmal.map((s) => s.sw))}`);
  pruefe(schmal.every((s) => s.h >= 43.5 && s.b >= 43.5), 'Reiter mindestens 44 px bei 360 px');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: reiter.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
