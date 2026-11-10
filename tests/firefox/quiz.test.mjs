// Firefox-Test Phase 4, Auftrag Q (PHASE-4-BAUPLAN Abschnitt 8): Quiz-Riegel ueber geckodriver/WebDriver. Riegel oeffnet ueber den Testhaken
// `veil-test` (kein Video noetig), Abbild in data-veil-riegel (Shadow Root bleibt geschlossen). Dummy-Pack mit synthetischer Quiz-Bank, ueber die
// Einstellungsseite importiert. Erweiterungsseiten erreicht der Test wie tests/firefox/pack.test.mjs (feste interne UUID, Tab ueber den Chrome-Kontext).
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';
import { DUMMY_QUIZ, DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';

setTimeout(() => {
  console.error('firefox quiz: Zeitlimit von 420 s ueberschritten');
  process.exit(1);
}, 420_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const SEITE = `${basis}/quiz-tasten.html`;
const GECKO_ID = 'veil@hypnomia';
const uuid = randomUUID();
const texte = DUMMY_TEXTE.gruppen;
// Zusatzfragen fuer Aufgaben, die die Dummy-Bank nicht enthaelt (nur im Test).
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
const ALLE_FRAGEN = [...DUMMY_QUIZ.fragen, ...EXTRA];

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox quiz: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
}
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
    console.error(`firefox quiz: ROT  ${text}`);
  }
}
async function bis(beschreibung, fn, frist = 8000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(40);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 300)})`);
}

let driver;
let server;
let ordner;
let inhaltFenster;

// ---------- Erweiterungsseiten ----------
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
  // Die Seite muss wirklich geladen sein (sonst ist `browser` noch nicht da)
  await bis('Erweiterungsseite geladen', async () => (await driver.executeScript('return location.protocol + String(document.readyState)')) === 'moz-extension:complete', 10_000);
}
async function schliesse() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1) {
    await driver.close();
    await driver.switchTo().window(inhaltFenster);
  }
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
// Fuehrt Code in einer Erweiterungsseite aus und kehrt zum Inhalts-Tab zurueck.
async function ausErweiterung(code, ...args) {
  await oeffne('options.html');
  try {
    const r = await imSeitenkontext(code, ...args);
    if (r && typeof r === 'object' && r.fehlerText) throw new Error(`Erweiterungsseite: ${r.fehlerText}`);
    return r;
  } finally {
    await schliesse();
  }
}
const speicherLesen = (k) => ausErweiterung(`const a = await api.storage.local.get(args[0]); return a[args[0]] ?? null;`, k);
const einstellungenAendern = (teil) =>
  ausErweiterung(`const alt = (await api.storage.local.get('einstellungen')).einstellungen || {}; await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } }); return true;`, teil);

// ---------- Inhaltsseite ----------
const abbild = async () => JSON.parse((await driver.executeScript("return document.documentElement.getAttribute('data-veil-riegel')")) ?? 'null');
const ergebnis = () => driver.executeScript("return document.documentElement.getAttribute('data-veil-riegel-ergebnis')");
const testBefehl = (d) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify(d));
const oeffneRiegel = (o) => testBefehl({ riegel: { oeffne: o } });
const hostDa = () => driver.executeScript("return document.querySelector('[data-veil-riegel-host]') !== null");
const tastenZaehler = () => driver.executeScript('const t = window.tasten; return { f: t.f, m: t.m, leer: t.leer };');
const abbildBis = (beschr, pred, frist) =>
  bis(beschr, async () => {
    const a = await abbild();
    return a && pred(a) ? a : null;
  }, frist);
const ergebnisBis = (soll, frist = 6000) => bis(`Ergebnis ${soll}`, async () => (await ergebnis()) === soll, frist);

async function frischeSeite(url = SEITE) {
  await driver.get(url);
  await bis('Content-Script', () => driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')"), 15_000);
}
async function klickeAuf(r) {
  const x = Math.round(r.x + r.w / 2);
  const y = Math.round(r.y + r.h / 2);
  await driver.actions({ async: true }).move({ x, y, origin: 'viewport' }).click().perform();
}
const tippe = (text) => driver.actions({ async: true }).sendKeys(text).perform();
const taste = (k) => driver.actions({ async: true }).sendKeys(k).perform();

// Loest die aktuelle Frage richtig (fuer Fragen, die der Test nicht erzwingen kann).
async function loeseAktuelle() {
  const a = await abbildBis('Frage', (x) => x.zustand === 'frage' && !!x.frage);
  const f = ALLE_FRAGEN.find((q) => q.id === a.frage.id);
  if (f.art === 'wissen' || f.art === 'allgemein') await klickeAuf(a.antworten.find((b) => b.text === f.antworten[f.richtig]));
  else if (f.art === 'tippen') {
    await tippe(f.satz);
    await taste(Key.ENTER);
  } else if (f.aufgabe.typ === 'wort-tippen') {
    await tippe(Array(f.aufgabe.param.anzahl).fill(f.aufgabe.param.wort).join(' '));
    await taste(Key.ENTER);
  } else if (f.aufgabe.typ === 'klicken-zaehlen') {
    for (let i = 0; i < f.aufgabe.param.anzahl; i++) {
      await klickeAuf((await abbildBis('Spirale', (x) => !!x.spirale)).spirale);
      await warte(f.aufgabe.param.abstandMs + 150);
    }
  } else if (f.aufgabe.typ === 'spirale-ansehen') await warte(f.aufgabe.param.sekunden * 1000 + 600);
  else if (f.aufgabe.typ === 'countdown') {
    const n = f.aufgabe.param.von;
    await tippe([...Array.from({ length: n }, (_, i) => String(n - i)), f.aufgabe.param.wort].join(' '));
    await taste(Key.ENTER);
  } else if (f.aufgabe.typ === 'buchstaben-raetsel') {
    await tippe(f.aufgabe.param.wort);
    await taste(Key.ENTER);
  } else if (f.aufgabe.typ === 'wort-blitz') {
    await abbildBis('Eingabe', (x) => !!x.eingabe);
    await tippe(f.aufgabe.param.wort);
    await taste(Key.ENTER);
  } else if (f.aufgabe.typ === 'im-kreis') {
    const k = (await abbildBis('Kreis', (x) => !!x.kreis)).kreis;
    await driver.actions({ async: true }).move({ x: Math.round(k.x + k.w / 2), y: Math.round(k.y + k.h / 2), origin: 'viewport' }).perform();
    await warte(f.aufgabe.param.sekunden * 1000 + 800);
  } else if (f.aufgabe.typ === 'zaehlen') {
    const r = await beobachteFolge();
    await tippe(String(r.ziel));
    await taste(Key.ENTER);
  } else throw new Error(`nicht loesbar: ${f.id}`);
}

// Beobachtet die laufende Wortfolge, zaehlt das Zielwort (POP).
async function beobachteFolge() {
  const woerter = [];
  const zeiten = [];
  let letzte = '';
  const ende = Date.now() + 25_000;
  while (Date.now() < ende) {
    const a = await abbild();
    if (a && a.eingabe) break;
    if (a && a.wort && a.wort !== letzte) {
      woerter.push(a.wort);
      zeiten.push(Date.now());
    }
    if (a && a.wort) letzte = a.wort;
    await warte(25);
  }
  return { woerter, abstaende: zeiten.slice(1).map((z, i) => z - zeiten[i]), ziel: woerter.filter((w) => w.toLowerCase() === 'pop').length };
}
const hostWeg = async () => !(await hostDa());
const pauseAus = async () => {
  await warte(400);
  await einstellungenAendern({ pause: false });
};

let code = 0;
// VEIL_FALL=<Teil des Namens>: nur diese Faelle (der Pack-Import laeuft immer)
async function fall(name, fn) {
  if (process.env.VEIL_FALL && !process.env.VEIL_FALL.split('|').some((n) => name.includes(n)) && !name.startsWith('Pack importieren')) return;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox quiz: ok   ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    rot++;
    console.error(`firefox quiz: ROT  ${name}: ${fehler?.message ?? fehler}`);
  }
}

try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-quiz-'));
  const bau = await baueDummyPack({ quiz: { version: 1, fragen: ALLE_FRAGEN } });
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, bau.bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  await installiere(driver, paket);
  inhaltFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox quiz: Version ${(await driver.getCapabilities()).get('browserVersion')}`);

  await fall('ohne Pack: kein Riegel, Ergebnis abgebrochen', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    await ergebnisBis('abgebrochen');
    pruefe((await abbild()) === null && !(await hostDa()), 'ohne Pack kein Riegel');
  });

  await fall('Pack importieren, packdaten liefern Bank und Saetze', async () => {
    await oeffne('options.html');
    await driver.findElement(By.css('#datei')).sendKeys(packPfad);
    await bis('Lizenz', () => driver.findElement(By.css('#lizenz-block')).isDisplayed());
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Pack-Titel', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'));
    await imSeitenkontext(`await api.storage.local.set({ quizWarnungGesehen: true }); return true;`);
    const q = await imSeitenkontext(`const a = await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'quiz' }); return { ok: a.ok, n: a.daten && a.daten.fragen.length };`);
    pruefe(q.ok === true && q.n === ALLE_FRAGEN.length, `packdaten quiz ${JSON.stringify(q)}`);
    const t = await imSeitenkontext(`const a = await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' }); return a.daten && a.daten.gruppen.start;`);
    pruefe(JSON.stringify(t) === JSON.stringify(texte.start), 'packdaten texte start');
    const u = await imSeitenkontext(`const a = await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'unsinn' }); return a.daten;`);
    pruefe(u === null, 'unbekannte Rolle: null');
    await schliesse();
  });

  await fall('Riegel oeffnet: geschlossene Shadow Root, Popover, Pause sichtbar, Fokus im Riegel', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    const a = await abbildBis('Riegel offen', (x) => x.offen && x.zustand === 'frage');
    pruefe(a.frage.id === 'test-w1' && a.satz === texte.start[0], 'erste Frage und Startsatz');
    pruefe(a.pause.w > 40 && a.pause.h >= 40, 'Pause-Knopf sichtbar');
    pruefe(JSON.stringify(a.antworten.map((b) => b.text).sort()) === JSON.stringify(['alpha', 'beta', 'gamma']), 'Antworten');
    pruefe(a.chibiPose === 'sprechblase', 'Chibi-Pose sprechblase');
    pruefe(a.fokusImRiegel === true, 'Fokus im Riegel');
    pruefe(String(a.kartenFarbe).includes('gradient'), 'Stil angewendet');
    const info = await driver.executeScript(
      "const h = document.querySelector('[data-veil-riegel-host]'); return { schatten: h.shadowRoot === null, popover: h.matches(':popover-open') };",
    );
    pruefe(info.schatten === true && info.popover === true, `Shadow Root geschlossen und Popover offen ${JSON.stringify(info)}`);
    console.log(`firefox quiz: Riegel offen, Shadow Root geschlossen, Popover offen, Host ${a.host.w}x${a.host.h}`);
  });

  await fall('Sakura Glas: Schrift VEIL Text steht nach dem Oeffnen bereit, Marke, Fuss, Fingerziele', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    const a = await abbildBis('Riegel offen', (x) => x.offen && x.zustand === 'frage');
    // Lesung S1 Nr. 1: document.fonts.check() ist auch ohne passende Schrift wahr; geprueft wird die geladene Familie im Schriften-Satz.
    const geladen = (n) => driver.executeScript("const n = arguments[0]; return [...document.fonts].some((f) => f.family.replace(/[\"']/g, '').startsWith(n + ' ') && f.status === 'loaded');", n);
    await bis('VEIL Text geladen', async () => geladen('VEIL Text'));
    await bis('VEIL Rounded geladen', async () => geladen('VEIL Rounded'));
    pruefe(a.marke === 'Mia’s quiz', `Marke ${a.marke}`);
    pruefe(/^Question \d+$/.test(a.fussNummer), `Fuss ${a.fussNummer}`);
    pruefe(a.antworten.every((b) => b.h >= 44), `Antworten mindestens 44 px hoch ${JSON.stringify(a.antworten.map((b) => b.h))}`);
    pruefe(a.pause.h >= 40, 'Pause-Knopf mindestens 40 px');
    console.log('firefox quiz: VEIL Text und VEIL Rounded geladen im Schriften-Satz der Seite');
  });

  await fall('richtige Antwort loest (Satz, Pose jubeln)', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 300 });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    const r = await abbildBis('richtig', (x) => x.zustand === 'richtig');
    pruefe(r.satz === texte.richtig[0] && r.chibiPose === 'jubeln' && r.pause.w > 0, 'richtig: Satz, Pose, Pause sichtbar');
    await ergebnisBis('geloest');
    pruefe(!(await hostDa()), 'Host nach dem Loesen weg');
  });

  await fall('falsch: sofort neue Frage ohne Wartezeit', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0 });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    const t0 = Date.now();
    await klickeAuf(a.antworten.find((b) => b.text === 'beta'));
    const b = await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'test-w1' && x.satz === texte.falsch[0], 3000);
    pruefe((await ergebnis()) === null && b.chibiPose === 'schmollen', 'Riegel bleibt offen, Falsch-Bild bleibt stehen (Dummy-Pack: Grundpose)');
    pruefe(b.ansageLive === 'polite' && b.ansage === b.frage.text, `neue Frage im Live-Bereich ${JSON.stringify([b.ansageLive, b.ansage])}`);
    console.log(`firefox quiz: falsch, neue Frage ${b.frage.id} nach ${Date.now() - t0} ms (Klick bis Abbild, mit WebDriver-Aufruf)`);
  });

  await fall('Verweigern: schmollen, neue Frage, danach nie wieder verweigert', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 1, zufall: [0.1], verweigertMs: 400, richtigMs: 200 });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    const v = await abbildBis('verweigert', (x) => x.zustand === 'verweigert');
    pruefe(v.satz === texte.verweigert[0] && v.chibiPose === 'schmollen', 'verweigert: Satz und Pose');
    await abbildBis('neue Frage', (x) => x.zustand === 'frage', 4000);
    await loeseAktuelle();
    const z = await abbildBis('Folge', (x) => ['richtig', 'verweigert', 'zu'].includes(x.zustand), 8000);
    pruefe(z.zustand !== 'verweigert', 'zweite richtige Antwort wird nicht verweigert');
    await ergebnisBis('geloest');
  });

  await fall('Tippen tolerant; falsch getippt gibt neue Frage', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-t1', verweigern: 0, richtigMs: 200 });
    const a = await abbildBis('Tippen', (x) => x.zustand === 'frage' && !!x.eingabe);
    pruefe(a.zitat === 'This is a test line.', 'Satz wird gezeigt');
    await tippe('this is a test lines');
    await taste(Key.ENTER);
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'test-t1');
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-t1', verweigern: 0, richtigMs: 200 });
    await abbildBis('Tippen', (x) => x.zustand === 'frage' && !!x.eingabe);
    await tippe('  this is a TEST line  ');
    await taste(Key.ENTER);
    await ergebnisBis('geloest');
  });

  await fall('Tastatur-Schutz: f, m, Leertaste erreichen die Seite nicht', async () => {
    await frischeSeite();
    await driver.findElement(By.css('#draussen')).click();
    await tippe('fm ');
    const vor = await tastenZaehler();
    pruefe(vor.f > 0 && vor.m > 0 && vor.leer > 0, `Gegenprobe: ohne Riegel faengt die Seite die Tasten ${JSON.stringify(vor)}`);
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-t1', verweigern: 0, richtigMs: 200 });
    await abbildBis('Tippen', (x) => x.zustand === 'frage' && !!x.eingabe && x.fokusImRiegel);
    await tippe('f m F M f m ');
    const a = await abbildBis('Eingabe', (x) => x.eingabe && x.eingabe.wert === 'f m F M f m ');
    pruefe(a.eingabe.wert === 'f m F M f m ', 'Eingabefeld bekam alle Zeichen');
    const z = await tastenZaehler();
    pruefe(z.f === 0 && z.m === 0 && z.leer === 0, `Seite zaehlt 0 ${JSON.stringify(z)}`);
    // Leertaste auf einem Knopf
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, zufall: [0] });
    await abbildBis('Wahl', (x) => x.zustand === 'frage' && x.fokusImRiegel);
    await taste(Key.SPACE);
    await abbildBis('Knopf reagiert', (x) => x.zustand === 'richtig' || x.zustand === 'verweigert' || (x.zustand === 'frage' && x.frage.id !== 'test-w1'));
    const z2 = await tastenZaehler();
    pruefe(z2.f === 0 && z2.m === 0 && z2.leer === 0, `Leertaste auf Knopf: Seite zaehlt 0 ${JSON.stringify(z2)}`);
    console.log('firefox quiz: f, m, Leertaste im Riegel: Seite zaehlt 0, Eingabefeld bekam alle Zeichen');
  });

  await fall('Tastatur-Schutz endet mit dem Riegel', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    await ergebnisBis('geloest');
    await driver.findElement(By.css('#draussen')).click();
    await tippe('f');
    pruefe((await tastenZaehler()).f > 0, 'Seite faengt f wieder');
  });

  await fall('Aufgaben: wort-tippen, klicken-zaehlen, zu schnell geklickt', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h1', verweigern: 0, richtigMs: 100 });
    await abbildBis('wort-tippen', (x) => x.zustand === 'frage' && x.frage.typ === 'wort-tippen' && x.fokusImRiegel);
    await tippe('test TEST Test');
    await taste(Key.ENTER);
    await ergebnisBis('geloest');
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h2', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('klicken', (x) => x.frage && x.frage.typ === 'klicken-zaehlen' && !!x.spirale);
    for (let i = 0; i < 3; i++) {
      await klickeAuf(a.spirale);
      await warte(650);
    }
    const t0 = Date.now();
    await ergebnisBis('geloest', 7000);
    console.log(`firefox quiz: 3 Klicks im Abstand 650 ms, Ruhe-Pruefung nach ${Date.now() - t0} ms`);
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h2', verweigern: 0 });
    const b = await abbildBis('klicken', (x) => x.frage && x.frage.typ === 'klicken-zaehlen' && !!x.spirale);
    await klickeAuf(b.spirale);
    await klickeAuf(b.spirale);
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'test-h2', 4000);
  });

  await fall('spirale-ansehen: Mausbewegung setzt die Uhr zurueck', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h3', verweigern: 0, richtigMs: 100 });
    await abbildBis('spirale', (x) => x.frage && x.frage.typ === 'spirale-ansehen' && !!x.spirale);
    await driver.actions({ async: true }).move({ x: 100, y: 100, origin: 'viewport' }).perform();
    await warte(2500);
    await driver.actions({ async: true }).move({ x: 140, y: 150, origin: 'viewport' }).perform();
    const t1 = Date.now();
    await ergebnisBis('geloest', 12_000);
    const nach = Date.now() - t1;
    pruefe(nach > 4500, `nach der Bewegung mehr als 4,5 s (${nach} ms)`);
    console.log(`firefox quiz: spirale-ansehen 5 s, Bewegung bei 2,5 s, geloest ${nach} ms nach der Bewegung`);
  });

  await fall('finger-halten (Touch-Lage erzwungen): loslassen setzt zurueck, 5 s halten loest', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h4', geraet: 'touch', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('finger', (x) => x.frage && x.frage.typ === 'finger-halten' && !!x.spirale);
    const x = Math.round(a.spirale.x + a.spirale.w / 2);
    const y = Math.round(a.spirale.y + a.spirale.h / 2);
    await driver.actions({ async: true }).move({ x, y, origin: 'viewport' }).press().pause(2000).release().perform();
    await warte(300);
    pruefe((await ergebnis()) === null, 'zu frueh losgelassen: nicht geloest');
    const t0 = Date.now();
    await driver.actions({ async: true }).move({ x, y, origin: 'viewport' }).press().perform();
    await ergebnisBis('geloest', 9000);
    const gehalten = Date.now() - t0;
    await driver.actions().clear();
    pruefe(gehalten >= 4900, `5 s gehalten (${gehalten} ms)`);
    console.log(`firefox quiz: finger-halten geloest, Aufsetzen bis Ergebnis ${gehalten} ms (Soll ab 5000)`);
  });

  await fall('Geraet: Desktop zieht nie finger-halten, Touch nie spirale-ansehen', async () => {
    for (const [geraet, verboten] of [['desktop', 'finger-halten'], ['touch', 'spirale-ansehen']]) {
      await frischeSeite();
      await oeffneRiegel({ geraet, verweigern: 0, zufall: [0.37, 0.81, 0.12, 0.66] });
      for (let i = 0; i < 12; i++) {
        const a = await abbildBis('Frage', (x) => x.zustand === 'frage' && !!x.frage);
        pruefe(a.frage.typ !== verboten, `${geraet}: ${a.frage.typ}`);
        const f = ALLE_FRAGEN.find((q) => q.id === a.frage.id);
        if (f.art === 'wissen' || f.art === 'allgemein') {
          await klickeAuf(a.antworten.find((b) => b.text !== f.antworten[f.richtig]));
          await abbildBis('weiter', (x) => x.zustand === 'frage' && x.frage.id !== a.frage.id);
        } else if (f.art === 'tippen') {
          await tippe('x');
          await taste(Key.ENTER);
          await abbildBis('weiter', (x) => x.zustand === 'frage' && x.frage.id !== a.frage.id);
        } else break;
      }
    }
  });

  await fall('Pause im Riegel: sofort lokal, auch ohne Antwort des Hintergrunds', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', pauseHaengt: true });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    const t0 = Date.now();
    await klickeAuf(a.pause);
    await ergebnisBis('pause', 3000);
    const ms = Date.now() - t0;
    pruefe(!(await hostDa()), 'Host nach Pause weg');
    const e = await speicherLesen('einstellungen');
    pruefe(!(e && e.pause), 'Nachricht wurde nie geschickt, Pause nicht gesetzt');
    console.log(`firefox quiz: Pause loest den Riegel nach ${ms} ms (mit WebDriver-Aufruf), Hintergrund ohne Antwort`);
  });

  await fall('Pause im Riegel: danach geht die Nachricht an den Hintergrund; bei Pause oeffnet nichts; Pause von aussen loest', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await klickeAuf(a.pause);
    await ergebnisBis('pause', 3000);
    await bis('Pause in storage', async () => (await speicherLesen('einstellungen'))?.pause === true, 6000);
    await driver.executeScript("document.documentElement.removeAttribute('data-veil-riegel-ergebnis')");
    await oeffneRiegel({ frage: 'test-w1' });
    await ergebnisBis('pause', 3000);
    await einstellungenAendern({ pause: false });
    await driver.executeScript("document.documentElement.removeAttribute('data-veil-riegel-ergebnis')");
    await oeffneRiegel({ frage: 'test-w1' });
    await abbildBis('Frage', (x) => x.zustand === 'frage');
    await einstellungenAendern({ pause: true });
    await ergebnisBis('pause', 4000);
    await einstellungenAendern({ pause: false });
  });

  await fall('Warnung vor Fotosensibilitaet: einmal, gemerkt, Spirale dreht erst danach', async () => {
    await ausErweiterung(`await api.storage.local.remove('quizWarnungGesehen'); return true;`);
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h2', verweigern: 0, richtigMs: 100 });
    const w = await abbildBis('Warnung', (x) => x.zustand === 'warnung');
    pruefe(w.knoepfe.some((k) => k.text === 'Got it, go on') && w.augenDrehen === false, 'Warnung zeigt Knopf, Augen stehen');
    await klickeAuf(w.knoepfe.find((k) => k.text === 'Got it, go on'));
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage' && !!x.spirale);
    pruefe(a.augenDrehen === true, 'Spirale dreht nach der Warnung');
    await bis('Merker', async () => (await speicherLesen('quizWarnungGesehen')) === true, 4000);
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h2', verweigern: 0 });
    const b = await abbildBis('Frage', (x) => x.zustand === 'frage' || x.zustand === 'warnung');
    pruefe(b.zustand === 'frage', 'zweites Mal keine Warnung');
  });

  await fall('Ruhig-Modus: Spirale mehr als dreimal so langsam, nie ueber 2,5 Hz', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    const n = await abbildBis('normal', (x) => x.zustand === 'frage');
    const pn = parseFloat(n.augenPeriodeS);
    pruefe(2 / pn <= 2.5 && n.augenDrehen === true, `normal ${pn} s`);
    await testBefehl({ einstellungen: { ruhig: true } });
    await bis('ruhig gespeichert', async () => (await speicherLesen('einstellungen'))?.ruhig === true, 5000);
    pruefe((await speicherLesen('einstellungen'))?.ruhig === true, 'ruhig steht in storage');
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    const r = await abbildBis('ruhig', (x) => x.zustand === 'frage');
    const pr = parseFloat(r.augenPeriodeS);
    pruefe(pr / pn > 3, `ruhig ${pr} s gegen ${pn} s`);
    console.log(`firefox quiz: Periode normal ${pn} s (${(2 / pn).toFixed(3)} Hz), Ruhig ${pr} s (${(2 / pr).toFixed(3)} Hz)`);
    await testBefehl({ einstellungen: { ruhig: false } });
    await bis('ruhig aus', async () => (await speicherLesen('einstellungen'))?.ruhig === false, 5000);
  });

  await fall('Strenge Seiten-CSP: Riegel gestaltet und bedienbar', async () => {
    await frischeSeite(`${basis}/schleier-csp.html?satz=sfw`);
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    pruefe(String(a.kartenFarbe).includes('gradient') && a.pause.h >= 40, 'Stil trotz CSP');
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    await ergebnisBis('geloest');
  });

  await fall('Anker: Riegel liegt ueber dem Player und folgt ihm', async () => {
    await frischeSeite();
    // Ab 420 px Hoehe bleibt der Riegel auf der Flaeche des Ankers (darunter fuellt er den Sichtbereich, siehe Fall "Kleiner Anker").
    await driver.executeScript("document.querySelector('#player').style.height = '480px'");
    await oeffneRiegel({ frage: 'test-w1', anker: '#player' });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    const p = await driver.executeScript("const r = document.querySelector('#player').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };");
    pruefe(Math.abs(a.host.w - p.w) < 3 && Math.abs(a.host.h - p.h) < 3 && Math.abs(a.host.x - p.x) < 3, `Host ${JSON.stringify(a.host)} gegen Player ${JSON.stringify(p)}`);
    await driver.executeScript("document.querySelector('#player').style.marginLeft = '200px'");
    await abbildBis('folgt', (x) => x.host.x > 190, 3000);
  });

  await fall('Waechter: entfernt die Seite den Host, kommt er zurueck', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    await abbildBis('Frage', (x) => x.zustand === 'frage');
    await driver.executeScript("document.querySelector('[data-veil-riegel-host]').remove()");
    await bis('Host zurueck', hostDa, 3000);
    const a = await abbildBis('wieder offen', (x) => x.offen && x.zustand === 'frage');
    pruefe(a.host.w > 300, 'Host wieder gross');
  });

  await fall('zaehlen: hoechstens 2 Woerter je Sekunde, nie gleiche Nachbarn, Zahl wird geprueft', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-z', verweigern: 0, richtigMs: 100 });
    await abbildBis('zaehlen', (x) => x.frage && x.frage.typ === 'zaehlen');
    const r = await beobachteFolge();
    pruefe(r.woerter.length === 8, `8 Woerter (${r.woerter.length})`);
    pruefe(r.woerter.every((w, i) => i === 0 || w !== r.woerter[i - 1]), 'keine gleichen Nachbarn');
    pruefe(Math.min(...r.abstaende) >= 480, `kleinster Abstand ${Math.min(...r.abstaende)} ms`);
    await tippe(String(r.ziel));
    await taste(Key.ENTER);
    await ergebnisBis('geloest');
    console.log(`firefox quiz: zaehlen ${r.woerter.length} Woerter, kleinster Abstand ${Math.min(...r.abstaende)} ms, ${r.ziel} Treffer richtig gezaehlt`);
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-z', verweigern: 0 });
    await abbildBis('zaehlen', (x) => x.frage && x.frage.typ === 'zaehlen');
    await beobachteFolge();
    await tippe('99');
    await taste(Key.ENTER);
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'ext-z', 3000);
  });

  await fall('wort-blitz: genau einmal sichtbar, kurz', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-b', verweigern: 0, richtigMs: 100 });
    let erscheinungen = 0;
    let da = false;
    let t0 = 0;
    let dauer = 0;
    const ende = Date.now() + 10_000;
    while (Date.now() < ende) {
      const a = await abbild();
      if (a && a.eingabe) {
        if (da && dauer === 0) dauer = Date.now() - t0;
        break;
      }
      const jetzt = !!(a && a.wort);
      if (jetzt && !da) {
        erscheinungen++;
        t0 = Date.now();
        pruefe(a.wort === 'OBEY', 'Wort ist OBEY');
      }
      if (!jetzt && da) dauer = Date.now() - t0;
      da = jetzt;
      await warte(20);
    }
    pruefe(erscheinungen === 1 && dauer > 250 && dauer < 1300, `einmal sichtbar (${erscheinungen}x, ${dauer} ms)`);
    await tippe('obey');
    await taste(Key.ENTER);
    await ergebnisBis('geloest');
    console.log(`firefox quiz: wort-blitz ${erscheinungen} mal sichtbar, ${dauer} ms`);
  });

  await fall('countdown und buchstaben-raetsel', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-c', verweigern: 0, richtigMs: 100 });
    await abbildBis('countdown', (x) => x.frage && x.frage.typ === 'countdown' && !!x.eingabe);
    await tippe('5, 4, 3, 2, 1, down.');
    await taste(Key.ENTER);
    await ergebnisBis('geloest');
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-c', verweigern: 0 });
    await abbildBis('countdown', (x) => x.frage && x.frage.typ === 'countdown' && !!x.eingabe);
    await tippe('5 4 3 DOWN');
    await taste(Key.ENTER);
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'ext-c', 3000);
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-r', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('raetsel', (x) => x.frage && x.frage.typ === 'buchstaben-raetsel' && !!x.eingabe);
    pruefe(a.zitat === 'B E O Y', 'gemischte Buchstaben');
    await tippe('o b e y');
    await taste(Key.ENTER);
    await ergebnisBis('geloest');
  });

  await fall('im-kreis: Zeiger im Kreis, Verlassen setzt zurueck', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-k', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('kreis', (x) => x.frage && x.frage.typ === 'im-kreis' && !!x.kreis);
    const m = { x: Math.round(a.kreis.x + a.kreis.w / 2), y: Math.round(a.kreis.y + a.kreis.h / 2) };
    await driver.actions({ async: true }).move({ ...m, origin: 'viewport' }).perform();
    await warte(1500);
    await driver.actions({ async: true }).move({ x: 5, y: 5, origin: 'viewport' }).perform();
    await warte(400);
    pruefe((await ergebnis()) === null, 'nach dem Verlassen nicht geloest');
    await driver.actions({ async: true }).move({ ...m, origin: 'viewport' }).perform();
    const t0 = Date.now();
    await ergebnisBis('geloest', 8000);
    pruefe(Date.now() - t0 > 2500, `neu gezaehlt (${Date.now() - t0} ms)`);
    console.log(`firefox quiz: im-kreis 3 s, geloest ${Date.now() - t0} ms nach Wiedereintritt`);
  });

  await fall('im-kreis: synthetische Zeigerereignisse der Seite zaehlen nicht', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-k', verweigern: 0, richtigMs: 100 });
    const a = await abbildBis('kreis', (x) => x.frage && x.frage.typ === 'im-kreis' && !!x.kreis);
    const m = { x: Math.round(a.kreis.x + a.kreis.w / 2), y: Math.round(a.kreis.y + a.kreis.h / 2) };
    await driver.executeScript(
      `const x = arguments[0], y = arguments[1];
       const tick = () => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
       tick(); window.__kreis = setInterval(tick, 100);`,
      m.x,
      m.y,
    );
    await warte(4500);
    pruefe((await ergebnis()) === null, 'synthetische Zeigerereignisse loesen nichts');
    await driver.executeScript('clearInterval(window.__kreis)');
    // der echte Zeiger steht evtl. schon dort (Vorgaengertest): erst weg, dann hinein, damit ein pointermove entsteht
    await driver.actions({ async: true }).move({ x: 5, y: 5, origin: 'viewport' }).move({ ...m, origin: 'viewport' }).perform();
    await ergebnisBis('geloest', 8000);
  });

  await fall('Blitz-Grenze: 10 Oeffnen/Pause-Paare, hoechstens 3 Wechsel je Sekunde; Pause beendet das Warten', async () => {
    await frischeSeite();
    await driver.executeScript(`
      window.wechsel = [];
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of [...m.addedNodes, ...m.removedNodes])
          if (n.hasAttribute && n.hasAttribute('data-veil-riegel-host')) window.wechsel.push(performance.now());
      }).observe(document.documentElement, { childList: true });`);
    for (let i = 0; i < 10; i++) {
      await driver.executeScript("document.documentElement.removeAttribute('data-veil-riegel-ergebnis')");
      await oeffneRiegel({ frage: 'test-w1', pauseHaengt: true });
      const a = await abbildBis('Frage', (x) => x.offen && x.zustand === 'frage', 8000);
      await klickeAuf(a.pause);
      await ergebnisBis('pause', 3000);
      await abbildBis('zu', (x) => x.offen === false, 3000);
    }
    const z = await driver.executeScript('return window.wechsel');
    let hoechstens = 0;
    for (const t0 of z) hoechstens = Math.max(hoechstens, z.filter((t) => t >= t0 && t < t0 + 1000).length);
    pruefe(z.length === 20 && hoechstens <= 3, `20 Wechsel (${z.length}), hoechstens ${hoechstens} je Sekunde`);
    console.log(`firefox quiz: 10 Oeffnen/Pause-Paare, ${z.length} Wechsel in ${Math.round(z[z.length - 1] - z[0])} ms, hoechstens ${hoechstens} je Sekunde`);
    // Warten vor dem Oeffnen: Pause beendet es sofort
    await driver.executeScript("document.documentElement.removeAttribute('data-veil-riegel-ergebnis')");
    await oeffneRiegel({ frage: 'test-w1' });
    await warte(150);
    pruefe(!((await abbild())?.offen), 'wartet unsichtbar');
    await testBefehl({ einstellungen: { pause: true } });
    const t1 = Date.now();
    await ergebnisBis('pause', 3000);
    pruefe(Date.now() - t1 < 1500, `Pause beendet das Warten (${Date.now() - t1} ms)`);
    await pauseAus();
  });

  await fall('Pause in jedem Zustand: Warnung, laufende Woerter, verweigert, Laden', async () => {
    await ausErweiterung(`await api.storage.local.remove('quizWarnungGesehen'); return true;`);
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-h2' });
    let a = await abbildBis('Warnung', (x) => x.zustand === 'warnung').catch(async (f) => {
      throw new Error(`${f.message} attrs=${await driver.executeScript('return [...document.documentElement.attributes].map((a) => a.name).join()')} host=${await hostDa()} abbild=${JSON.stringify(await abbild())?.slice(0, 300)} flag=${JSON.stringify(await speicherLesen('quizWarnungGesehen'))} ergebnis=${await ergebnis()} pause=${JSON.stringify((await speicherLesen('einstellungen'))?.pause)}`);
    });
    await klickeAuf(a.pause);
    await ergebnisBis('pause', 3000);
    pruefe(await hostWeg(), 'Warnung: Host weg');
    await ausErweiterung(`await api.storage.local.set({ quizWarnungGesehen: true }); return true;`);
    await pauseAus();

    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-z' });
    a = await abbildBis('Woerter', (x) => x.frage && x.frage.typ === 'zaehlen' && !!x.wort);
    await klickeAuf(a.pause);
    await ergebnisBis('pause', 3000);
    pruefe(await hostWeg(), 'laufende Woerter: Host weg');
    await pauseAus();

    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 1, zufall: [0.1], verweigertMs: 5000 });
    a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    a = await abbildBis('verweigert', (x) => x.zustand === 'verweigert');
    await klickeAuf(a.pause);
    await ergebnisBis('pause', 3000);
    pruefe(await hostWeg(), 'verweigert: Host weg');
    await pauseAus();

    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', ladeVerzoegerungMs: 1500 });
    await warte(300);
    await testBefehl({ einstellungen: { pause: true } });
    await ergebnisBis('pause', 6000);
    pruefe((await abbild()) === null && (await hostWeg()), 'Laden: kein Riegel');
    await pauseAus();
    console.log('firefox quiz: Pause loest in Warnung, laufenden Woertern, verweigert und beim Laden');
  });

  await fall('Ereignisse der Seite (nicht vertrauenswuerdig) loesen nichts aus', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0 });
    const vorher = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await driver.executeScript(`
      const h = document.querySelector('[data-veil-riegel-host]');
      for (const key of ['1', '2', '3', 'Enter', ' ']) for (const typ of ['keydown', 'keyup', 'keypress'])
        h.dispatchEvent(new KeyboardEvent(typ, { key, bubbles: true, composed: true, cancelable: true }));
      h.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));`);
    await warte(500);
    const nachher = await abbild();
    pruefe(nachher.zustand === 'frage' && nachher.frage.id === vorher.frage.id && (await ergebnis()) === null, 'synthetische Ereignisse ohne Wirkung');
    await taste('1');
    await abbildBis('echte Taste wirkt', (x) => x.zustand !== 'frage' || x.frage.id !== vorher.frage.id, 3000);
    console.log('firefox quiz: 15 synthetische Tastenereignisse und 1 Klick ohne Wirkung, echte Taste 1 wirkt');
  });

  await fall('Ein Riegel je Tab; freilegen oeffnet', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', grund: 'video' });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await oeffneRiegel({ grund: 'freilegen' });
    await ergebnisBis('abgebrochen', 2000);
    pruefe((await abbild()).offen === true, 'erster Riegel bleibt offen');
    await oeffneRiegel({ grund: 'video' });
    pruefe((await ergebnis()) === null, 'gleicher Grund teilt das Ergebnis');
    await klickeAuf(a.pause);
    await ergebnisBis('pause', 3000);
    await pauseAus();
    await frischeSeite();
    await oeffneRiegel({ grund: 'freilegen', frage: 'test-w1', verweigern: 0, richtigMs: 100 });
    const b = await abbildBis('Frage', (x) => x.zustand === 'frage');
    await klickeAuf(b.antworten.find((k) => k.text === 'alpha'));
    await ergebnisBis('geloest');
  });

  await fall('Waechter: nach zu vielen Entfernungen abgebrochen', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', maxRettungen: 2 });
    await abbildBis('Frage', (x) => x.zustand === 'frage');
    for (let i = 0; i < 3; i++) {
      await bis('Host da', hostDa, 3000);
      await driver.executeScript("document.querySelector('[data-veil-riegel-host]').remove()");
      await warte(100);
    }
    await ergebnisBis('abgebrochen', 4000);
    pruefe(await hostWeg(), 'Host bleibt weg');
  });

  await fall('Kopf mit Pause-Knopf bleibt auf niedrigem Fenster sichtbar', async () => {
    const alt = await driver.manage().window().getRect();
    await driver.manage().window().setRect({ width: 700, height: 460 });
    try {
      await frischeSeite();
      const vh = await driver.executeScript('return window.innerHeight');
      await oeffneRiegel({ frage: 'test-t1', verweigern: 0 });
      const a = await abbildBis('Tippen', (x) => x.zustand === 'frage' && !!x.eingabe);
      pruefe(a.pause.y >= 0 && a.pause.y + a.pause.h <= vh && a.karte.h <= vh, `Pause y ${a.pause.y}+${a.pause.h} im Fenster ${vh}`);
      await klickeAuf(a.pause);
      await ergebnisBis('pause', 3000);
      await pauseAus();
    } finally {
      await driver.manage().window().setRect({ width: alt.width, height: alt.height });
    }
  });

  await fall('Ruhig-Modus schliesst Wort-Aufgaben aus (40 Fragen)', async () => {
    await frischeSeite();
    await testBefehl({ einstellungen: { ruhig: true } });
    await bis('ruhig gespeichert', async () => (await speicherLesen('einstellungen'))?.ruhig === true, 5000);
    await frischeSeite();
    await oeffneRiegel({ geraet: 'desktop', verweigern: 0, zufall: [0.13, 0.57, 0.91, 0.34, 0.76, 0.02] });
    const typen = new Set();
    let n = 0;
    for (let i = 0; i < 40; i++) {
      await abbildBis('Frage', (x) => x.zustand === 'frage' && !!x.frage);
      await warte(150);
      const a = await abbildBis('Frage', (x) => x.zustand === 'frage' && !!x.frage);
      n++;
      if (a.frage.typ) typen.add(a.frage.typ);
      pruefe(!['zaehlen', 'wort-blitz', 'pink-klicken'].includes(a.frage.typ), `Ruhig: ${a.frage.typ}`);
      const f = ALLE_FRAGEN.find((q) => q.id === a.frage.id);
      if (f.art === 'wissen' || f.art === 'allgemein') await klickeAuf(a.antworten.find((b) => b.text !== f.antworten[f.richtig]));
      else if (f.art === 'tippen' || ['wort-tippen', 'countdown', 'buchstaben-raetsel'].includes(f.aufgabe.typ)) {
        await tippe('x');
        await taste(Key.ENTER);
      } else if (f.aufgabe.typ === 'klicken-zaehlen') {
        const sp = (await abbildBis('Spirale', (x) => !!x.spirale)).spirale;
        await klickeAuf(sp);
        await klickeAuf(sp);
      } else {
        await klickeAuf(a.pause);
        await ergebnisBis('pause', 3000);
        await pauseAus();
        await driver.executeScript("document.documentElement.removeAttribute('data-veil-riegel-ergebnis')");
        await oeffneRiegel({ geraet: 'desktop', verweigern: 0, zufall: [0.13 + i * 0.01, 0.57, 0.91, 0.34] });
        continue;
      }
      await abbildBis('Wechsel', (x) => x.zustand === 'frage' && x.frage.id !== a.frage.id, 4000);
    }
    console.log(`firefox quiz: Ruhig-Modus, ${n} Fragen gezogen, Aufgabentypen ${[...typen].join(',')}, keine Wort-Aufgabe`);
    await testBefehl({ einstellungen: { ruhig: false } });
    await bis('ruhig aus', async () => (await speicherLesen('einstellungen'))?.ruhig === false, 5000);
  });

  await fall('Eingabeereignisse erreichen die Seite nicht; Riegel mit Anker laesst der Seite den Fokus', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-t1', verweigern: 0 });
    await abbildBis('Tippen', (x) => x.zustand === 'frage' && !!x.eingabe && x.fokusImRiegel);
    await tippe('geheim');
    await abbildBis('Eingabe', (x) => x.eingabe && x.eingabe.wert === 'geheim');
    const gesehen = await driver.executeScript('return window.eingaben.length');
    pruefe(gesehen === 0, `Seite sah ${gesehen} Eingabeereignisse`);
    await frischeSeite();
    await driver.findElement(By.css('#draussen')).click();
    await tippe('ab');
    pruefe((await driver.executeScript('return window.eingaben.length')) > 0, 'Gegenprobe: ohne Riegel sieht die Seite Eingaben');
    await frischeSeite();
    await driver.executeScript("document.querySelector('#player').style.height = '480px'"); // ab 420 px bleibt der Riegel auf dem Anker
    await oeffneRiegel({ frage: 'test-w1', anker: '#player' });
    await abbildBis('Frage', (x) => x.zustand === 'frage');
    await driver.findElement(By.css('#draussen')).click();
    await warte(1600);
    pruefe((await driver.executeScript('return document.activeElement && document.activeElement.id')) === 'draussen', 'Fokus der Seite bleibt (Anker)');
    console.log('firefox quiz: 0 Eingabeereignisse bei der Seite, Fokus der Seite bleibt mit Anker');
  });

  await fall('Kleiner Anker (320 x 300): Riegel fuellt den Sichtbereich, alle Antworten in der Karte und klickbar', async () => {
    await frischeSeite();
    await driver.executeScript(
      "const d = document.createElement('div'); d.id = 'klein'; d.style.cssText = 'position:absolute;left:300px;top:80px;width:320px;height:300px;background:#223'; document.body.append(d);",
    );
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0, richtigMs: 100, anker: '#klein' });
    const a = await abbildBis('Frage', (x) => x.zustand === 'frage' && x.antworten.length === 3, 10_000);
    const vh = await driver.executeScript('return document.documentElement.clientHeight');
    pruefe(a.host.h >= vh - 2, `Host ${JSON.stringify(a.host)} fuellt den Sichtbereich (${vh})`);
    pruefe(a.antworten.every((b) => b.y >= a.karte.y && b.y + b.h <= a.karte.y + a.karte.h + 1), 'alle Antworten in der Karte');
    await klickeAuf(a.antworten.find((b) => b.text === 'alpha'));
    await ergebnisBis('geloest');
  });

  await fall('Invalidierung des Kontexts: offener Riegel baut sich ab (abgebrochen, Host weg)', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1', verweigern: 0 });
    await abbildBis('Frage', (x) => x.zustand === 'frage');
    pruefe(await hostDa(), 'Host da');
    await testBefehl({ riegel: { invalidiere: true } });
    await ergebnisBis('abgebrochen');
    pruefe(await hostWeg(), 'Host nach der Invalidierung weg');
  });

  await fall('buchstaben-takt: im Takt geloest, zu schnell getippt gibt neue Frage', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-t', verweigern: 0, richtigMs: 100 });
    await abbildBis('Takt', (x) => x.frage && x.frage.typ === 'buchstaben-takt');
    for (const c of 'obey') {
      await taste(c);
      await warte(1100);
    }
    await ergebnisBis('geloest');
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-t', verweigern: 0 });
    await abbildBis('Takt', (x) => x.frage && x.frage.typ === 'buchstaben-takt');
    await taste('o');
    await warte(1100);
    await taste('b');
    await taste('e');
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'ext-t', 3000);
    pruefe((await ergebnis()) === null, 'zu schnell: kein Ergebnis, Riegel bleibt offen');
  });

  await fall('pink-klicken: Enter auf dem pinken Wort loest, auf einem anderen gibt neue Frage', async () => {
    for (const aufPink of [true, false]) {
      await frischeSeite();
      await oeffneRiegel({ frage: 'ext-p', verweigern: 0, richtigMs: 100 });
      await abbildBis('pink-klicken', (x) => x.frage && x.frage.typ === 'pink-klicken');
      const f = await abbildBis('Wort', (x) => x.aufgabe === (aufPink ? 'pink:ja' : 'pink:nein') && x.wort !== null, 10_000);
      pruefe(f.wortPink === aufPink, `Wort pink ${f.wortPink}, erwartet ${aufPink}`);
      await taste(Key.ENTER);
      if (aufPink) await ergebnisBis('geloest');
      else {
        await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'ext-p', 3000);
        pruefe((await ergebnis()) === null, 'falsches Wort: kein Ergebnis');
      }
    }
  });

  await fall('leertaste-halten: bei "Now." loslassen loest, zu frueh loslassen gibt neue Frage', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-l', verweigern: 0, richtigMs: 100 });
    await abbildBis('Leertaste', (x) => x.frage && x.frage.typ === 'leertaste-halten');
    await driver.actions({ async: true }).keyDown(' ').perform();
    await abbildBis('Now', (x) => x.aufgabe === 'jetzt', 5000);
    await driver.actions({ async: true }).keyUp(' ').perform();
    await ergebnisBis('geloest');
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-l', verweigern: 0 });
    await abbildBis('Leertaste', (x) => x.frage && x.frage.typ === 'leertaste-halten');
    await driver.actions({ async: true }).keyDown(' ').perform();
    await warte(600);
    await driver.actions({ async: true }).keyUp(' ').perform();
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'ext-l', 3000);
  });

  await fall('widerstehen: nicht klicken loest nach der Zeit, Klick auf den Knopf gibt neue Frage', async () => {
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-w', verweigern: 0, richtigMs: 100 });
    await abbildBis('widerstehen', (x) => x.frage && x.frage.typ === 'widerstehen');
    await ergebnisBis('geloest', 8000);
    await frischeSeite();
    await oeffneRiegel({ frage: 'ext-w', verweigern: 0 });
    const a = await abbildBis('Knopf', (x) => x.frage && x.frage.typ === 'widerstehen' && x.knoepfe.some((k) => k.text === 'Click me'));
    await klickeAuf(a.knoepfe.find((k) => k.text === 'Click me'));
    await abbildBis('neue Frage', (x) => x.zustand === 'frage' && x.frage.id !== 'ext-w', 3000);
    pruefe((await ergebnis()) === null, 'Klick: kein Ergebnis');
  });

  await fall('Pack mit kaputter Quiz-Bank: Freischaltung faellt weg, abgebrochen', async () => {
    const kaputt = await baueDummyPack({ quiz: { version: 1, fragen: [{ id: 'x', art: 'wissen' }] } });
    const kaputtPfad = path.join(ordner, 'kaputt-quiz.miapack');
    await writeFile(kaputtPfad, kaputt.bytes);
    await oeffne('options.html');
    const knopf = await driver.findElement(By.css('#entfernen'));
    await driver.executeScript('arguments[0].scrollIntoView({ block: "center" })', knopf);
    await knopf.click();
    await bis('Rueckfrage', () => driver.findElement(By.css('#entfernen-frage')).isDisplayed());
    await driver.findElement(By.css('#entfernen-ja')).click();
    await bis('Pack weg', async () => (await driver.findElement(By.css('#pack-status')).getText()).includes('No pack yet'));
    await driver.findElement(By.css('#datei')).sendKeys(kaputtPfad);
    try {
      await bis('Lizenz', () => driver.findElement(By.css('#lizenz-block')).isDisplayed(), 5000);
      await driver.findElement(By.css('#annehmen')).click();
    } catch {
      // Import kann abgelehnt werden: auch dann gibt es kein Quiz
    }
    await warte(1500);
    const q = await imSeitenkontext(`const a = await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'quiz' }); return a.daten;`);
    pruefe(q === null, 'packdaten quiz null');
    await schliesse();
    await frischeSeite();
    await oeffneRiegel({ frage: 'test-w1' });
    await ergebnisBis('abgebrochen', 8000);
    pruefe((await abbild()) === null, 'kein Riegel');
  });

  console.log(`firefox quiz: ${ok} Pruefungen gruen, ${rot} rot`);
  if (rot > 0) code = 1;
} catch (fehler) {
  console.error('firefox quiz: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
process.exit(code);
