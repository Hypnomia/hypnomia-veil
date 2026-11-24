// Firefox: Phase 11 E4f, Handy (Regeln H-a bis H-g): Einstellungsseite, Willkommensseite mit Interview und Popup bei 360 x 640, 320 x 568 und 412 x 915.
// Firefox-Fenster werden nicht schmaler als 500 px, darum liegt die Seite in einem Iframe der Breite und Hoehe der Ansicht (Medienabfragen und innerWidth
// gelten dort wie im Fenster). Zeiger: Maus (Firefox am Rechner kennt kein pointer: coarse). Messung und Grenzen: tests/gemeinsam/handy-mess.mjs.
// Die Tab-Folge (H-f) laeuft mit echten Tasten nur im Zustand "mit Pack" (die Obermenge der Bedienelemente), die Messung der Flaechen in beiden Staenden.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUFLAGEN_H_C, AUSNAHMEN_H_B, BREITEN, FEHLER_SKRIPT, FINGERZIEL, FOKUS_SKRIPT, MESS_SKRIPT, wertungFehler, wertungFehlerHG, wertungFokus, wertungSprung, wertungStelle, wertungMessung } from '../gemeinsam/handy-mess.mjs';
import { REITER as REITERDATEN } from '../../entrypoints/options/reiter-daten.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 900 s ueberschritten');
  process.exit(1);
}, 900_000).unref();

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


const ALLE = ['stil:mia-patch', 'zensur:sticker', 'erwachsen:vorschau', 'erwachsen:quiz', 'erwachsen:titel', 'erwachsen:ersatz', 'quiz:freilegen', 'zensur:steigerung', 'chibi:pack'];
// Das Pack ist das Dummy-Pack der Tests (`npm run pack:dummy`), wirklich importiert (der Abgleich beim Oeffnen entfernt eine Kurzfassung ohne Pack in der
// Ablage); danach werden die Freischaltungen auf alle gesetzt, damit das Interview sechs Seiten hat.
const PACK_DATEI = path.join(wurzel, '.output-pack', 'dummy.miapack');
let PACK = null;
async function packBereit() {
  if (PACK) return PACK;
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`);
  await setze({ einstieg: EINSTIEG_FERTIG });
  await driver.navigate().refresh();
  await warteBereit();
  await wdKlick(By.xpath(`//*[@role='tab'][normalize-space(.)='Pack and sound']`));
  await driver.findElement(By.css('#datei')).sendKeys(PACK_DATEI);
  await bis('Dateifeld bereit', async () => sichtbar('#annehmen'));
  await wdKlick(By.id('annehmen'));
  await bis('Pack importiert', async () => ((await text('#meldung')) || '').includes('The pack is in'), 60_000);
  const meta = await speicher('pack');
  PACK = { ...meta, freischaltungen: [...new Set([...(meta.freischaltungen ?? []), ...ALLE])], sticker: meta.sticker ?? 1 };
  return PACK;
}
const verstoesse = { 'H-a': [], 'H-b': [], 'H-c': [], 'H-d': [], 'H-f': [], 'H-g': [] };
let ansichten = 0;

// Legt einen Iframe der Ansicht auf die Wirtsseite und wartet, bis die Seite darin steht.
async function rahmen(seite, b, h) {
  await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     document.querySelectorAll('iframe.handy').forEach((x) => x.remove());
     const f = document.createElement('iframe');
     f.className = 'handy'; f.id = 'handy-rahmen';
     f.style.cssText = 'width:' + arguments[1] + 'px;height:' + arguments[2] + 'px;position:fixed;left:0;top:0;border:0;background:#fff;z-index:99999';
     f.onload = () => setTimeout(fertig, 900);
     f.src = arguments[0];
     document.body.append(f);`,
    `moz-extension://${uuid}/${seite}`, b, h,
  );
}
const imRahmen = (code, ...a) => driver.executeScript(`const win = document.getElementById('handy-rahmen').contentWindow; const doc = win.document; ${code}`, ...a);
const messe = (opt) => driver.executeScript(`${MESS_SKRIPT}; return messeHandy(document.getElementById('handy-rahmen').contentWindow, arguments[0]);`, opt);
const fokusLesen = () => driver.executeScript(`${FOKUS_SKRIPT}; return fokusSchritt(document.getElementById('handy-rahmen').contentWindow);`);

// Tab-Folge: die Tasten laufen echt (Selenium Actions im fokussierten Iframe), die Halte sammelt ein Horcher und werden danach nachgespielt.
async function tabGang(rueck) {
  await imRahmen(`win.focus();`);
  const n = await driver.executeScript(`${FOKUS_SKRIPT}; return fokusStart(document.getElementById('handy-rahmen').contentWindow);`);
  for (let i = 0; i < n; i++) {
    await (rueck ? driver.actions().keyDown(Key.SHIFT).sendKeys(Key.TAB).keyUp(Key.SHIFT) : driver.actions().sendKeys(Key.TAB)).perform();
    const rund = await driver.executeAsyncScript(`const fertig = arguments[arguments.length - 1]; ${FOKUS_SKRIPT}; fokusNach(document.getElementById('handy-rahmen').contentWindow, 70).then(fertig);`);
    if (rund === true) break;
  }
  return driver.executeScript(`${FOKUS_SKRIPT}; return fokusFolge(document.getElementById('handy-rahmen').contentWindow);`);
}

async function pruefeAnsicht(name, o) {
  await warte(250);
  const m = await messe({ ...(o.erste ? { erste: o.erste[0], ausser: o.erste[1] } : {}), ...(o.reiter ? { panel: '[role=tabpanel]:not([hidden])' } : {}), auflagen: AUFLAGEN_H_C });
  const w = wertungMessung(m, { flaeche: o.flaeche, zeiger: 'fein', breite: o.b, hoehe: o.h, erste: !!o.erste, reiter: o.reiter ?? null });
  for (const r of Object.keys(w)) verstoesse[r].push(...w[r].map((t) => `${name}: ${t}`));
  if (o.fokus) {
    for (const rueck of [false, true]) {
      const f = await tabGang(rueck);
      verstoesse['H-f'].push(...wertungFokus(f, !rueck).map((t) => `${name}${rueck ? ' (rueckwaerts)' : ''}: ${t}`));
    }
  }
  ansichten++;
}
const melde = (regel) => {
  pruefe(verstoesse[regel].length === 0, `${regel}: ${verstoesse[regel].length} Verstoesse in ${ansichten} Ansichten\n  ${verstoesse[regel].slice(0, 40).join('\n  ')}`);
  console.log(`firefox: handy ${regel}: ${verstoesse[regel].length} Verstoesse in ${ansichten} Ansichten`);
};
const leereSpeicher = () => imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg', 'steigerung']);`);
const REITER_NAMEN = REITER;

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').setPreference('general.smoothScroll', false).addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  await installiere(driver, paket);
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await oeffne('options.html');
  await packBereit();

  // ---- Einstellungsseite ----
  for (const [stand, pack] of [['ohne Pack', null], ['mit Pack', PACK]]) {
    ansichten = 0;
    for (const k of Object.keys(verstoesse)) verstoesse[k] = [];
    await leereSpeicher();
    await setze({ einstieg: EINSTIEG_FERTIG, ...(pack ? { pack } : {}) });
    for (const [b, h] of BREITEN) {
      await rahmen('options.html', b, h);
      await bis('Seite gezeichnet', async () => imRahmen(`return doc.body.getAttribute('data-veil-ordnung') === 'bereit'`));
      for (const reiter of REITER_NAMEN) {
        await imRahmen(`[...doc.querySelectorAll('[role=tab]')].find((t) => t.textContent === arguments[0]).click();`, reiter);
        await pruefeAnsicht(`Optionen ${stand} ${b} ${reiter}`, { flaeche: 'optionen', b, h, erste: ['[role=tabpanel]:not([hidden])'], reiter, fokus: !!pack });
      }
    }
    console.log(`firefox: Einstellungsseite ${stand}`);
    for (const r of Object.keys(verstoesse)) melde(r);
  }

  // ---- Interview ----
  for (const [stand, pack] of [['ohne Pack', null], ['mit Pack', PACK]]) {
    ansichten = 0;
    for (const k of Object.keys(verstoesse)) verstoesse[k] = [];
    await leereSpeicher();
    await setze({ einstieg: EINSTIEG_FERTIG, ...(pack ? { pack } : {}) });
    for (const [b, h] of BREITEN) {
      await rahmen('willkommen.html#interview', b, h);
      await bis('Interview gezeichnet', async () => imRahmen(`const s = doc.getElementById('schritt'); return !!s && s.getAttribute('data-schritt') === 'interview-1'`));
      for (let n = 1; n <= 8; n++) {
        await pruefeAnsicht(`Interview ${stand} ${b} Frage ${n}`, { flaeche: 'interview', b, h, erste: ['.iv-karte', '.knoepfe, .ueberspringen'], fokus: !!pack });
        const letzte = (await imRahmen(`return doc.getElementById('iv-weiter').textContent`)) === 'Finish';
        await imRahmen(`doc.getElementById('iv-weiter').click();`);
        await warte(300);
        if (letzte) break;
      }
      await bis('Abschluss', async () => imRahmen(`return !!doc.getElementById('ende-liste')`));
      await pruefeAnsicht(`Interview ${stand} ${b} Abschluss`, { flaeche: 'willkommen', b, h, fokus: !!pack });
    }
    console.log(`firefox: Interview ${stand}`);
    for (const r of Object.keys(verstoesse)) melde(r);
  }

  // ---- Warnung, 18+, Einwilligung ----
  ansichten = 0;
  for (const k of Object.keys(verstoesse)) verstoesse[k] = [];
  await leereSpeicher();
  for (const [b, h] of BREITEN) {
    await rahmen('willkommen.html', b, h);
    await bis('Warnung', async () => imRahmen(`return !!doc.getElementById('warnung-ok')`));
    await pruefeAnsicht(`Willkommen ${b} Warnung`, { flaeche: 'willkommen', b, h, fokus: true });
    await imRahmen(`doc.getElementById('warnung-ok').click();`);
    await bis('18+', async () => imRahmen(`return !!doc.getElementById('alter-ja')`));
    await pruefeAnsicht(`Willkommen ${b} 18+`, { flaeche: 'willkommen', b, h, fokus: true });
    await imRahmen(`doc.getElementById('alter-ja').click();`);
    await bis('Einwilligung', async () => imRahmen(`return !!doc.getElementById('einwilligung-ok')`));
    await pruefeAnsicht(`Willkommen ${b} Einwilligung`, { flaeche: 'willkommen', b, h, fokus: true });
    await leereSpeicher();
  }
  console.log('firefox: Willkommensseite');
  for (const r of ['H-a', 'H-b', 'H-c', 'H-d', 'H-f']) melde(r);

  // ---- J1: stehender Fehlersatz verdeckt nichts ----
  {
    await leereSpeicher();
    await setze({ einstieg: EINSTIEG_FERTIG });
    const fehler = [];
    for (const [b, h] of [...BREITEN, [1280, 800]]) {
      await rahmen('options.html', b, h);
      await bis('Seite gezeichnet', async () => imRahmen(`return doc.body.getAttribute('data-veil-ordnung') === 'bereit'`));
      await imRahmen(`[...doc.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'What I cover').click(); const m = doc.getElementById('speicher-meldung'); m.hidden = false; m.textContent = 'Could not save that. Try again.';`);
      await warte(500);
      for (const [name, y] of [['oben', 0], ['gescrollt 500', 500]]) {
        await imRahmen(`win.scrollTo(0, arguments[0]);`, y);
        await warte(500);
        const p = await driver.executeScript(`${FEHLER_SKRIPT}; return probeFehler(document.getElementById('handy-rahmen').contentWindow);`);
        fehler.push(...wertungFehler(p, y === 0).map((t) => `${b} ${name}: ${t}`));
      }
      await imRahmen(`win.scrollTo(0, 0);`);
      await warte(300);
      for (const rueck of [false, true]) fehler.push(...wertungFokus(await tabGang(rueck), !rueck).map((t) => `${b} Tab${rueck ? ' rueckwaerts' : ''}: ${t}`));
    }
    pruefe(fehler.length === 0, `J1: ${fehler.length} Verstoesse\n  ${fehler.slice(0, 30).join('\n  ')}`);
    console.log(`firefox: J1 Fehlersatz: ${fehler.length} Verstoesse`);
  }

  // ---- J10 bis J12: Scrollstellen, Sprung, H-g im Fehlerzustand ----
  {
    await leereSpeicher();
    await setze({ einstieg: EINSTIEG_FERTIG });
    const fehler = [];
    const sonde = () => driver.executeScript(`${FEHLER_SKRIPT}; return probeFehler(document.getElementById('handy-rahmen').contentWindow);`);
    for (const [b, h] of [...BREITEN, [1280, 800]]) {
      for (const mitFehler of [false, true]) {
        await rahmen('options.html', b, h);
        await bis('Seite gezeichnet', async () => imRahmen(`return doc.body.getAttribute('data-veil-ordnung') === 'bereit'`));
        await imRahmen(`[...doc.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'What I cover').click(); if (arguments[0]) { const m = doc.getElementById('speicher-meldung'); m.hidden = false; m.textContent = 'Could not save that. Try again.'; }`, mitFehler);
        await warte(500);
        let ref = null;
        for (let y = 0; y <= 400; y += 4) {
          await imRahmen(`win.scrollTo(0, arguments[0]);`, y);
          await warte(70);
          const p = await sonde();
          ref ??= p;
          const t = wertungStelle(p);
          if (t) fehler.push(`${b} ${mitFehler ? 'mit' : 'ohne'} Fehlersatz: ${t}`);
          for (const x of wertungSprung(p, ref)) fehler.push(`${b} ${mitFehler ? 'mit' : 'ohne'} Fehlersatz: ${x}`);
          if (y === 0 && mitFehler && Math.abs(p.platz - p.kartenHoehe) > 1) fehler.push(`${b}: Platz oben ${p.platz} px, Karte ${p.kartenHoehe} px`);
        }
        if (mitFehler && (b === 360 || b === 320)) {
          for (const reiter of REITERDATEN.map((r) => r.name ?? r)) {
            await imRahmen(`win.scrollTo(0, 0); [...doc.querySelectorAll('[role=tab]')].find((t) => t.textContent === arguments[0]).click();`, reiter);
            await warte(300);
            fehler.push(...wertungFehlerHG(await sonde(), b).map((t) => `${b} ${reiter}: ${t}`));
          }
        }
      }
    }
    pruefe(fehler.length === 0, `J10 bis J12: ${fehler.length} Verstoesse\n  ${fehler.slice(0, 30).join('\n  ')}`);
    console.log(`firefox: J10 bis J12: ${fehler.length} Verstoesse`);
  }

  // ---- J2: klebende Zeile des Interviews ----
  {
    await leereSpeicher();
    await setze({ einstieg: EINSTIEG_FERTIG, pack: PACK });
    const fehler = [];
    for (const [b, h] of BREITEN) {
      await rahmen('willkommen.html#interview', b, h);
      await bis('Interview gezeichnet', async () => imRahmen(`const s = doc.getElementById('schritt'); return !!s && s.getAttribute('data-schritt') === 'interview-1'`));
      for (let n = 1; n <= 6; n++) {
        await warte(300);
        for (const mitte of [false, true]) {
          await imRahmen(`const hoch = doc.documentElement.scrollHeight; win.scrollTo(0, arguments[0] ? Math.max(0, (hoch - win.innerHeight) / 2) : 0);`, mitte);
          await warte(200);
          const m = await imRahmen(`const z = doc.querySelector('.iv-karte .knoepfe'); const r = z.getBoundingClientRect(); const w = doc.getElementById('iv-weiter').getBoundingClientRect(); return { position: win.getComputedStyle(z).position, hoehe: Math.round(r.height), unten: Math.round(r.bottom), fenster: win.innerHeight, lang: doc.documentElement.scrollHeight > win.innerHeight + 300, nextOben: Math.round(w.top), nextUnten: Math.round(w.bottom) };`);
          const name = `${b} Frage ${n}${mitte ? ' Mitte' : ' oben'}`;
          if (m.position !== 'sticky') fehler.push(`${name}: Zeile klebt nicht (${m.position})`);
          if (m.hoehe > 72) fehler.push(`${name}: Zeile ${m.hoehe} px hoch`);
          if (!(m.nextOben >= 0 && m.nextUnten <= m.fenster)) fehler.push(`${name}: Next nicht im Fenster`);
          if (m.lang && Math.abs(m.unten - m.fenster) > 1) fehler.push(`${name}: Unterkante ${m.unten}, Fenster ${m.fenster}`);
        }
        const letzte = (await imRahmen(`return doc.getElementById('iv-weiter').textContent`)) === 'Finish';
        await imRahmen(`doc.getElementById('iv-weiter').click();`);
        await warte(300);
        if (letzte) break;
      }
    }
    pruefe(fehler.length === 0, `J2: ${fehler.length} Verstoesse\n  ${fehler.slice(0, 30).join('\n  ')}`);
    console.log(`firefox: J2 klebende Zeile: ${fehler.length} Verstoesse`);
  }

  // ---- Popup (Maus, mindestens 24 px) ----
  ansichten = 0;
  for (const k of Object.keys(verstoesse)) verstoesse[k] = [];
  for (const zustand of ['ohne-pack', 'mit-pack', 'pause', 'change-offen']) {
    await leereSpeicher();
    await setze({ einstieg: EINSTIEG_FERTIG, ...(zustand !== 'ohne-pack' ? { pack: PACK } : {}), ...(zustand === 'pause' ? { einstellungen: { pause: true } } : {}) });
    for (const [b, h] of BREITEN) {
      await rahmen('popup.html', b, h);
      await bis('Popup gezeichnet', async () => imRahmen(`return !!doc.getElementById('status') && doc.getElementById('status').textContent.length > 0`));
      if (zustand === 'change-offen') { await imRahmen(`doc.getElementById('aendern').click();`); await warte(300); }
      await pruefeAnsicht(`Popup ${zustand} ${b}`, { flaeche: 'popup', b, h, fokus: zustand === 'change-offen' });
      await imRahmen(`win.localStorage.removeItem('veil-popup-aendern');`);
    }
  }
  console.log('firefox: Popup');
  for (const r of ['H-a', 'H-b', 'H-c', 'H-d', 'H-f']) melde(r);
  pruefe(Array.isArray(AUSNAHMEN_H_B), `Ausnahmen zu H-b: ${AUSNAHMEN_H_B.length}`);
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await leereSpeicher().catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: handy.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
