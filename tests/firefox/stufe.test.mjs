// Firefox-Test Phase 7, Auftrag I1 und I2: Regler "How hot do I get?" (nur mit Pack, speichert, 44 px bei 360 px) und Wahl der Vorschau-Bilder nach Stufe
// und Seitenverhaeltnis (Nachricht an den Erkenner, Kacheln einer Nachbau-Seite, Stufenwechsel ohne Neuladen, Galerie). Dummy-Pack mit Stufen-Satz
// (vorschauSatz 'stufen'), nur synthetische Bilder. Die Nachbau-Seiten laufen auf pornhub.veil-erwachsen.test (nur im Testbau).
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { DUMMY_STUFEN_BILDER, baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 240 s ueberschritten');
  process.exit(1);
}, 240_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const GECKO_ID = 'veil@hypnomia';
const HOST = 'pornhub.veil-erwachsen.test';
const SEITE = `http://${HOST}:${port}/erwachsen-stufe.html`;
const GALERIE = `http://${HOST}:${port}/ersatz.html`;

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

// Raten, welches Bild des Stufen-Satzes auf einem getauschten Element liegt (Mittelfarben von neun Punkten gegen die zwei Farben jedes Bildes).
const welches = (id) =>
  driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const [id, satz] = [arguments[0], JSON.parse(arguments[1])];
     (async () => {
       const el = document.getElementById(id);
       const b = new Image(); b.src = el.src; await b.decode();
       const c = document.createElement('canvas'); c.width = b.naturalWidth; c.height = b.naturalHeight;
       const ctx = c.getContext('2d'); ctx.drawImage(b, 0, 0);
       const punkte = [];
       for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) punkte.push([...ctx.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data]);
       let beste = ''; let wert = Infinity;
       for (const x of satz) {
         let summe = 0;
         for (const p of punkte) summe += Math.min(...x.farben.map((f) => Math.hypot(p[0] - f[0], p[1] - f[1], p[2] - f[2])));
         if (summe < wert) { wert = summe; beste = x.schluessel; }
       }
       return beste;
     })().then(fertig, (e) => fertig('FEHLER ' + e));`,
    id,
    JSON.stringify(DUMMY_STUFEN_BILDER),
  );
const istGetauscht = (id) =>
  driver.executeScript(`const e = document.getElementById(arguments[0]); return !!e && e.getAttribute('data-veil') === 'zensiert' && e.src.startsWith('data:image/jpeg');`, id);
const warteAufTausch = (ids) => bis(`Tausch ${ids.join(',')}`, async () => (await Promise.all(ids.map(istGetauscht))).every(Boolean), 40_000);
const ergaenze = (id, b, h, n, key) => driver.executeScript(`window.addTile(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4])`, id, b, h, n, key);

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-stufe-'));
  const packPfad = path.join(ordner, 'stufen.miapack');
  await writeFile(packPfad, (await baueDummyPack({ vorschauSatz: 'stufen' })).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', HOST);
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));
  await warte(1500);

  // ---------- Regler ohne Pack ----------
  await oeffneErweiterung('options.html');
  await bis('Optionen gezeichnet', async () => (await text('#pack-status')).length > 0);
  pruefe(await sichtbar('#stufe-gesperrt'), 'ohne Pack: Satz statt Regler');
  pruefe(!(await sichtbar('#stufe-wahl')), 'ohne Pack: Knoepfe nicht sichtbar');
  pruefe((await text('#stufe-gesperrt')).includes('Mia Pack'), 'ohne Pack: der Satz nennt das Pack');
  await zurueckZumHaupt();

  // ---------- Pack importieren ----------
  await importierePack(packPfad);
  console.log('firefox I: Pack mit Stufen importiert');

  // ---------- Regler mit Pack ----------
  await oeffneErweiterung('options.html');
  await bis('Regler sichtbar', () => sichtbar('#stufe-wahl'));
  pruefe(!(await sichtbar('#stufe-gesperrt')), 'mit Pack: kein Sperr-Satz');
  pruefe((await driver.executeScript(`return document.querySelector('input[name="stufe"]:checked')?.value`)) === 'hot', 'Standard Hot ist angewaehlt');
  pruefe(
    JSON.stringify(await driver.executeScript(`return [...document.querySelectorAll('input[name="stufe"] + span small')].map((s) => s.textContent)`)) === '["I only hint.","I show more.","Nothing held back."]',
    'jeder Knopf traegt seine Zeile in Mias Stimme',
  );
  pruefe(
    JSON.stringify(await driver.executeScript(`return [...document.querySelectorAll('input[name="stufe"] + span strong')].map((s) => s.textContent)`)) === '["Tease","Hot","Explicit"]',
    'drei Knoepfe Tease, Hot, Explicit',
  );
  pruefe((await driver.executeScript(`const g = document.querySelector('#stufe-wahl [role=radiogroup]'); return document.getElementById(g.getAttribute('aria-labelledby')).textContent`)) === 'How hot do I get?', 'Radiogruppe heisst "How hot do I get?"');
  await driver.executeScript(`document.querySelector('input[name="stufe"][value="tease"] + span').click()`);
  await bis('Tease gespeichert', async () => (await imSeitenkontext(`return (await api.storage.local.get('einstellungen')).einstellungen?.erwachsen?.stufe ?? null`)) === 'tease');
  await driver.executeScript(`document.querySelector('input[name="stufe"][value="explicit"] + span').click()`);
  await bis('Explicit gespeichert', async () => (await imSeitenkontext(`return (await api.storage.local.get('einstellungen')).einstellungen?.erwachsen?.stufe ?? null`)) === 'explicit');
  const rest = (await imSeitenkontext(`return (await api.storage.local.get('einstellungen')).einstellungen.erwachsen`));
  pruefe(rest.an === true && Array.isArray(rest.eigeneSeiten) && rest.eigeneSeiten.length === 0, 'die anderen Werte des Abschnitts bleiben stehen');
  // 360 px im Iframe
  const m = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const f = document.createElement('iframe');
     f.style.cssText = 'width:360px;height:800px;position:fixed;left:0;top:0;border:0';
     f.src = location.href;
     f.onload = () => setTimeout(() => { const d = f.contentDocument;
       fertig({ hoehen: [...d.querySelectorAll('input[name="stufe"] + span')].map((s) => Math.round(s.getBoundingClientRect().height)), breite: d.documentElement.scrollWidth, fenster: d.documentElement.clientWidth }); }, 900);
     document.body.append(f);`,
  );
  console.log(`firefox I1: 360 px Fingerziele ${m.hoehen.join('/')} px, Seite ${m.breite}/${m.fenster}`);
  pruefe(m.hoehen.length === 3 && m.hoehen.every((h) => h >= 44) && m.breite <= m.fenster, 'Fingerziele mindestens 44 px bei 360 px, kein Ueberlauf');
  await zurueckZumHaupt();

  // ---------- Erkenner ----------
  const name = (a) => String(a?.name ?? '');
  const t1 = await frageBild('q1', 16, 9, 'tease');
  pruefe(t1.ok === true && name(t1) === 'vorschau/stufe-tease-quer.webp', `tease 16:9 gibt tease-quer (${name(t1)})`);
  pruefe(name(await frageBild('q2', 9, 16, 'tease')) === 'vorschau/stufe-tease-hoch.webp', 'tease 9:16 gibt tease-hoch');
  pruefe(name(await frageBild('q3', 1, 1, 'tease')) === 'vorschau/stufe-tease-hoch.webp', 'tease 1:1: naechste Klasse nach Verhaeltnis, tease-hoch');
  pruefe(name(await frageBild('q3', 1, 1, 'hot')) === 'vorschau/stufe-hot-quadratisch.webp', 'hot 1:1 gibt das Quadrat');
  const hot = new Set();
  const ohne = new Set();
  const explizit = new Set();
  for (let k = 0; k < 24; k++) {
    hot.add(name(await frageBild(`h${k}`, 16, 9, 'hot')));
    ohne.add(name(await frageBild(`h${k}`, 16, 9, undefined)));
    explizit.add(name(await frageBild(`h${k}`, 16, 9, 'explicit')));
  }
  console.log(`firefox I2: hot ${[...hot].join(', ')} | ohne Stufe ${[...ohne].join(', ')} | explicit ${[...explizit].join(', ')}`);
  pruefe(JSON.stringify([...hot].sort()) === JSON.stringify(['vorschau/stufe-hot-quer.webp', 'vorschau/stufe-tease-quer.webp']), 'hot zeigt nie explicit');
  pruefe(JSON.stringify([...ohne]) === JSON.stringify(['vorschau/stufe-tease-quer.webp']), 'ohne Stufe gilt die mildeste');
  pruefe(explizit.has('vorschau/stufe-explicit-quer.webp') && [...explizit].every((n) => n.includes('quer')), 'explicit nimmt alle drei Querbilder');
  pruefe(name(await frageBild('u1', 16, 9, 'extrem')) === 'vorschau/stufe-tease-quer.webp', 'unbekannte Stufe in der Nachricht gilt als die mildeste');

  // ---------- Kacheln ----------
  await setzeErwachsen({ stufe: 'explicit' });
  await driver.get(SEITE);
  await warteAufTausch(['s1', 's2', 's3']);
  const [a1, a2, a3] = [await welches('s1'), await welches('s2'), await welches('s3')];
  console.log(`firefox I2: explicit quer ${a1}, hoch ${a2}, quadratisch ${a3}`);
  pruefe(/-quer$/.test(a1) && /-hoch$/.test(a2) && a3 === 'hot-quadratisch', 'Kacheln nach Format: quer, hoch, quadratisch');
  await setzeErwachsen({ stufe: 'tease' });
  await warte(500);
  await ergaenze('n1', 320, 180, 61, 'ph5s1');
  await ergaenze('n2', 180, 320, 62, 'ph5s2');
  await ergaenze('n3', 200, 200, 64, 'ph5s3');
  await warteAufTausch(['s1', 's2', 's3', 'n1', 'n2', 'n3']);
  const [b1, b2, b3] = [await welches('n1'), await welches('n2'), await welches('n3')];
  pruefe(b1 === 'tease-quer' && b2 === 'tease-hoch' && b3 === 'tease-hoch', `Tease ohne Neuladen, auch fuer dieselbe Quelle (${b1}, ${b2}, ${b3})`);
  await setzeErwachsen({ stufe: 'hot' });
  await warte(500);
  await ergaenze('n4', 320, 180, 61, 'ph5s1');
  await ergaenze('n5', 180, 320, 62, 'ph5s2');
  await ergaenze('n6', 200, 200, 64, 'ph5s3');
  await warteAufTausch(['s1', 's2', 's3', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  const [c4, c5, c6] = [await welches('n4'), await welches('n5'), await welches('n6')];
  pruefe(['tease-quer', 'hot-quer'].includes(c4) && ['tease-hoch', 'hot-hoch'].includes(c5) && c6 === 'hot-quadratisch', `Hot ohne Neuladen, nie explicit (${c4}, ${c5}, ${c6})`);

  // ---------- Wechsel auf mildere Stufe: schon getauschte Kacheln ----------
  await setzeErwachsen({ stufe: 'hot' });
  await driver.get(SEITE);
  const extra = Array.from({ length: 8 }, (_, i) => `x${i + 1}`);
  await warteAufTausch(['s1', 's2', 's3']);
  for (const [i, id] of extra.entries()) await ergaenze(id, i % 2 ? 180 : 320, i % 2 ? 320 : 180, 80 + i, `ph5x${i + 1}`);
  const alle = ['s1', 's2', 's3', ...extra];
  await warteAufTausch(alle);
  const vorher = await Promise.all(alle.map((id) => welches(id)));
  pruefe(vorher.every((k) => !k.startsWith('explicit')) && vorher.some((k) => k.startsWith('hot')), `Hot: Kacheln getauscht, nie explicit (${vorher.join(', ')})`);
  await setzeErwachsen({ stufe: 'tease' });
  const restHart = await bis('alle Kacheln zeigen Tease', async () => {
    if (!(await Promise.all(alle.map(istGetauscht))).every(Boolean)) return false;
    const k = await Promise.all(alle.map((id) => welches(id)));
    return k.every((x) => x.startsWith('tease')) ? k : false;
  }, 40_000);
  console.log(`firefox I1b: nach Tease ${restHart.join(', ')}`);
  pruefe(true, 'Wechsel von Hot auf Tease: alle sichtbaren Kacheln zeigen danach Tease');

  // ---------- Stabile Wahl je Quelle ----------
  await setzeErwachsen({ stufe: 'hot' });
  await driver.get(SEITE);
  await warteAufTausch(['s1']);
  const ks = Array.from({ length: 12 }, (_, i) => `k${i + 1}`);
  for (const [i, id] of ks.entries()) await ergaenze(id, 320, 180, 100 + i, `ph5k${i + 1}`);
  await ergaenze('d1', 320, 180, 120, 'ph5k1');
  await ergaenze('d2', 320, 180, 121, 'ph5k7');
  await warteAufTausch([...ks, 'd1', 'd2']);
  const wahl = await Promise.all(ks.map((id) => welches(id)));
  console.log(`firefox I2: Verteilung ${wahl.join(', ')}`);
  pruefe((await welches('d1')) === wahl[0] && (await welches('d2')) === wahl[6], 'gleiche Quelle gleiches Bild');
  pruefe(new Set(wahl).size === 2 && wahl.every((k) => k === 'tease-quer' || k === 'hot-quer'), 'verschiedene Quellen verteilen sich auf beide erlaubten Bilder');

  // ---------- Galerie ----------
  const zeige = async (stufe) => {
    await setzeErwachsen({ stufe, komplettErsatz: true });
    await driver.get(GALERIE);
    let letzte = '';
    let stabil = 0;
    await bis('Galerie steht', async () => {
      const t = await driver.executeScript(`return document.documentElement.getAttribute('data-veil-ersatz-abbild')`);
      const namen = t ? JSON.parse(t).namen : [];
      const jetzt = [...namen].sort().join(',');
      stabil = jetzt === letzte && namen.length > 0 ? stabil + 1 : 0;
      letzte = jetzt;
      return stabil >= 8;
    });
    return letzte;
  };
  const [g1, g2, g3] = [await zeige('tease'), await zeige('hot'), await zeige('explicit')];
  console.log(`firefox I2: Galerie Tease ${g1} | Hot ${g2} | Explicit ${g3}`);
  pruefe(g1 === 'vorschau/stufe-tease-quer.webp', 'Galerie bei Tease nur Tease');
  pruefe(g2 === 'vorschau/stufe-hot-quer.webp,vorschau/stufe-tease-quer.webp', 'Galerie bei Hot nie Explicit');
  pruefe(g3 === 'vorschau/stufe-explicit-quer.webp,vorschau/stufe-hot-quer.webp,vorschau/stufe-tease-quer.webp', 'Galerie bei Explicit alle drei Querbilder');
  await setzeErwachsen({ komplettErsatz: false });
  void (await einst());

  // ---------- Pack weg ----------
  await mitOptionen(async () => {
    await bis('Pack-Status', async () => (await text('#pack-status')).length > 0);
    await driver.findElement(By.css('#entfernen')).click();
    await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
    await driver.findElement(By.css('#entfernen-ja')).click();
    await bis('Regler wieder gesperrt', async () => !(await sichtbar('#stufe-wahl')) && (await sichtbar('#stufe-gesperrt')), 15_000);
    pruefe(true, 'Pack entfernt: Regler wieder gesperrt');
  });
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: stufe.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
