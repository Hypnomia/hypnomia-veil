// Firefox-Abnahme des echten Mia Packs (Phase 7, Session 13). Laeuft nur mit VEIL_ECHTES_PACK=<pfad zur .miapack> (Pfad nie in Dateien
// schreiben; das Pack liegt ausserhalb des Repos), sonst wird der Test laut uebersprungen. Prueft: Import, alle Freischaltungen und Dateien im
// Speicher, Vorschau-Wahl je Stufe und Format nur aus erlaubten Stufen, Werbung je Format, Pack-Chibi statt Demo-Chibi, Klang-Dateien.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ECHT = process.env.VEIL_ECHTES_PACK ? path.resolve(process.env.VEIL_ECHTES_PACK) : undefined;
if (!ECHT) {
  console.log('firefox: echtes-pack.test UEBERSPRUNGEN (VEIL_ECHTES_PACK nicht gesetzt)');
  process.exit(0);
}
setTimeout(() => {
  console.error('firefox: Zeitlimit von 240 s ueberschritten');
  process.exit(1);
}, 240_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const GECKO_ID = 'veil@hypnomia';

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (zip -b firefox)`);
  process.exit(1);
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
async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 600)})`);
}

let driver;
let server;
let ordner;
let hauptFenster;
const uuid = randomUUID();

async function oeffneErweiterung(seiteName) {
  const vorher = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow('navigator:browser');
       w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/${seiteName}`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error(`Erweiterungsseite ${seiteName} nicht geoeffnet`);
  await driver.switchTo().window(neu);
  await bis('Erweiterungsseite geladen', async () => {
    try {
      return await driver.executeScript(`return document.readyState === 'complete' && !!(window.browser || window.chrome) && location.protocol === 'moz-extension:'`);
    } catch {
      return false;
    }
  });
}
async function zurueckZumHaupt() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1) await driver.close();
  await driver.switchTo().window(hauptFenster);
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
async function mitOptionen(fn) {
  await oeffneErweiterung('options.html');
  try {
    return await fn();
  } finally {
    await zurueckZumHaupt();
  }
}
const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const setzeErwachsen = (teil) =>
  mitOptionen(() =>
    imSeitenkontext(
      `const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
       await api.storage.local.set({ einstellungen: { ...alt, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [], ...(alt.erwachsen ?? {}), ...args[0] } } });
       return true;`,
      teil,
    ),
  );
const einst = () => mitOptionen(() => imSeitenkontext(`return (await api.storage.local.get('einstellungen')).einstellungen ?? {};`));
const importierePack = (pfad) =>
  mitOptionen(async () => {
    await driver.findElement(By.css('#datei')).sendKeys(pfad);
    await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Erfolgsmeldung', async () => (await text('#meldung')).includes('The pack is in'));
  });
const sendeAnErkenner = (nachricht) =>
  mitOptionen(() => imSeitenkontext(`const a = await api.runtime.sendMessage(args[0]); return JSON.parse(JSON.stringify(a));`, nachricht));
const frageBild = (schluessel, breite, hoehe, stufe) => sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel, breite, hoehe, stufe });

const metaUndZahl = () =>
  mitOptionen(() =>
    imSeitenkontext(`return await new Promise((ok, fehl) => {
      const a = indexedDB.open('veil-pack', 1);
      a.onerror = () => fehl(String(a.error));
      a.onsuccess = () => { const db = a.result; const tx = db.transaction(['meta', 'dateien'], 'readonly');
        const m = tx.objectStore('meta').get('aktiv'); const z = tx.objectStore('dateien').count();
        tx.oncomplete = () => { const meta = m.result; db.close();
          ok({ id: meta?.id, version: meta?.version, frei: meta?.freischaltungen ?? [], dateien: meta?.dateien?.length ?? 0, gespeichert: z.result,
               rollen: (meta?.dateien ?? []).reduce((o, d) => { const k = (d.rolle ?? '-') + (d.stufe ? ':' + d.stufe : ''); o[k] = (o[k] ?? 0) + 1; return o; }, {}),
               masse: (meta?.dateien ?? []).filter((d) => d.rolle === 'vorschau' && d.breite > 0 && d.hoehe > 0).length }); }; };
    });`),
  );
const ERLAUBT = { tease: ['tease'], hot: ['tease', 'hot'], explicit: ['tease', 'hot', 'explicit'] };
const stufeAusName = (n) => (/^vorschau\/(tease|hot|explicit)-/.exec(n) ?? [])[1] ?? '?';

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await warte(1500);

  const t0 = Date.now();
  await importierePack(ECHT);
  console.log(`firefox echt: Import in ${Date.now() - t0} ms (mit Lizenz und Klick)`);
  const m = await metaUndZahl();
  console.log(`firefox echt: ${m.id} ${m.version}, ${m.frei.length} Freischaltungen, ${m.dateien} Eintraege, ${m.gespeichert} gespeichert, Rollen ${JSON.stringify(m.rollen)}, Vorschau mit Massen ${m.masse}`);
  // seit Pack 0.8.0 mit zensur:woerter 18, seit Pack 1.0.0 mit zensur:sticker 19
  const sollFrei = m.frei.includes('zensur:sticker') ? 19 : 18;
  pruefe(m.frei.length === sollFrei, `alle ${sollFrei} Freischaltungen aktiv (${m.frei.length})`);
  pruefe(m.dateien > 150 && m.gespeichert === m.dateien, 'alle Dateien gespeichert');
  pruefe(m.masse === (m.rollen['vorschau:tease'] ?? 0) + (m.rollen['vorschau:hot'] ?? 0) + (m.rollen['vorschau:explicit'] ?? 0), 'jede Vorschau hat Masse');

  // Vorschau: 30 Schluessel je Stufe und Format, nie eine schaerfere Stufe; 16:9 liefert Querbilder
  for (const stufe of ['tease', 'hot', 'explicit']) {
    const gesehen = new Set();
    let quer = 0;
    let zuScharf = 0;
    for (let i = 0; i < 30; i++) {
      const [b, h] = i % 3 === 0 ? [9, 16] : [16, 9];
      const a = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: `echt-${stufe}-${i}`, breite: b, hoehe: h, stufe });
      if (!a?.ok) { pruefe(false, `${stufe} ${i}: keine Antwort (${a?.fehler})`); continue; }
      const s = stufeAusName(a.name);
      gesehen.add(s);
      if (!ERLAUBT[stufe].includes(s)) zuScharf++;
      if (b === 16 && a.breite / a.hoehe >= 1.2) quer++;
    }
    console.log(`firefox echt: Stufe ${stufe}: gesehen ${[...gesehen].join('/')}, Querbilder fuer 16:9 ${quer} von 20`);
    pruefe(zuScharf === 0, `Stufe ${stufe}: nie ein schaerferes Bild`);
    pruefe(quer === 20, `Stufe ${stufe}: 16:9 bekommt immer ein Querbild`);
    pruefe(gesehen.has(stufe), `Stufe ${stufe}: Bilder der eigenen Stufe kommen vor`);
  }
  // Werbung je Format
  for (const format of ['300x250', '336x280', '728x90', '468x60', '160x600', '300x600', '320x50', '320x100', '970x250']) {
    const a = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'werbung', schluessel: `w-${format}`, format });
    pruefe(a?.ok && String(a.name).includes(`-${format}-`), `Werbung ${format} aus dem Pack (${a?.name})`);
  }
  // Pack-Chibi: die Pose thron gibt es nur im Pack (die Demo hat schild, sprechblase, arme, nein, jubeln, schmollen)
  const c = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'thron' });
  console.log(`firefox echt: Chibi thron ${c?.name} ${c?.breite}x${c?.hoehe}`);
  pruefe(c?.ok === true && c.name === 'chibi/thron.webp', 'Chibi thron kommt aus dem Pack');
  // Pack 0.9: Quiz-Reaktionen `chibi/quiz-<zustand>-NN.webp`, die Nummer im Schluessel wechselt das Bild
  for (const zustand of ['frage', 'richtig', 'falsch']) {
    const namen = new Set();
    for (let i = 1; i <= 8; i++) {
      const q = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: `quiz-${zustand}#${i}` });
      pruefe(q?.ok === true && String(q.name).startsWith(`chibi/quiz-${zustand}-`), `quiz-${zustand}#${i} aus dem Pack (${q?.name ?? q?.fehler})`);
      namen.add(q?.name);
    }
    console.log(`firefox echt: quiz-${zustand}: ${namen.size} verschiedene Bilder bei 8 Nummern`);
    pruefe(namen.size > 1, `quiz-${zustand}: die Nummer wechselt das Bild`);
  }
  pruefe((m.rollen['ton'] ?? 0) === 5, 'fuenf Klaenge im Pack');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: echtes-pack.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
