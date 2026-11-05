// Firefox-Test des Gesichtsmodells YuNet ueber geckodriver/WebDriver (PHASE-2-BAUPLAN 10.4): Status (bereit, Kaltstart), mit Gesichtszone
// an liefert ein Testbild mit Gesicht (Satz sfw in ../05 Testbilder, nie im Repo) Augen und Mund mit quelle yunet und `ms.gesicht`,
// mit Gesichtszonen aus laeuft YuNet nicht.
// Erweiterungsseiten (moz-extension://) erreicht der Test wie scripts/messung/browser.mjs: feste interne UUID per Einstellung und
// ein Tab, den der Chrome-Kontext oeffnet (geckodriver verbietet Navigation zu moz-extension://).
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 90 s ueberschritten');
  process.exit(1);
}, 90_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
// Festes Testbild mit einem Gesicht, das YuNet findet (Satz sfw, nie im Repo). Ohne Bild ist der Test rot, ausser mit VEIL_OHNE_TESTBILDER=1.
const TESTBILD = 'sfw-001-portraet.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';

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
let server;
const uuid = randomUUID();

// Oeffnet eine Erweiterungsseite in einem neuen Tab und wechselt dorthin.
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

async function schliesse() {
  const alle = await driver.getAllWindowHandles();
  if (alle.length > 1) {
    await driver.close();
    await driver.switchTo().window((await driver.getAllWindowHandles())[0]);
  }
}

// Fuehrt Code mit `api` (browser-Objekt der Seite) aus; der Code ruft `fertig(wert)` mit einem JSON-tauglichen Wert.
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

// Fragt `fn` im Takt ab, bis es einen wahren Wert liefert.
async function bis(beschreibung, fn, frist = 20_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

// Prueft das feste Testbild im Seitenkontext der Einstellungsseite (dort laufen fetch, Canvas und runtime.sendMessage).
// `an`: Zonen, die eingeschaltet sind; alle anderen aus. Liefert die Antwort des Erkenners (ohne Bild).
function pruefeTestbild(an) {
  return imSeitenkontext(
    `
    const [basis, name, an] = args;
    const zonen = {};
    for (const n of ['eyes','mouth','face','head']) zonen[n] = { an: an.includes(n) };
    for (const n of ['breast','genitals','buttocks','belly','feet','armpits']) zonen[n] = { an: an.includes(n), bedeckt: false };
    const alsDataUrl = (blob) => new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(blob); });
    const antwort = await fetch(basis + '/testbild/sfw/' + encodeURIComponent(name));
    if (!antwort.ok) return { keinBild: true, grund: 'Testbild nicht ladbar: HTTP ' + antwort.status };
    const bitmap = await createImageBitmap(await antwort.blob());
    const f = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const c = new OffscreenCanvas(Math.round(bitmap.width * f), Math.round(bitmap.height * f));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    const dataUrl = await alsDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
    const roh = await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'pruefe', id: 'ff-' + name, quelle: { art: 'daten', dataUrl },
      breite: 0, hoehe: 0, einstellungen: { schwelle: 0.1, zonen, rand: 0.15, stil: 'mosaik' }, rendern: false });
    return JSON.parse(JSON.stringify(roh));`,
    basis,
    TESTBILD,
    an,
  );
}

const status = () => imSeitenkontext(`return JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'status' })));`);
const median = (liste) => [...liste].sort((a, b) => a - b)[Math.floor(liste.length / 2)];
const mitte = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];

let code = 0;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);
  await oeffne('options.html');

  // 1. Beide Modelle werden vorgeladen: 320n zuerst, YuNet danach im Hintergrund
  const bereit = await bis('Status mit YuNet bereit', async () => {
    const s = await status();
    return s && s.ok && s.gesichtBereit ? s : null;
  });
  console.log(`firefox: status ${JSON.stringify(bereit)}`);
  pruefe(bereit.bereit === true && bereit.modell === '320n', 'Status: 320n bereit');
  pruefe(typeof bereit.kaltstartMs === 'number' && typeof bereit.gesichtKaltstartMs === 'number', 'Status: beide Kaltstarts gemeldet');
  pruefe(bereit.gesichtKaltstartMs < 1500, `Status: YuNet-Kaltstart unter 1,5 s (${bereit.gesichtKaltstartMs})`);

  // 2. Gesichtszonen aus: kein YuNet-Lauf
  pruefe(typeof bereit.gesichtLaeufe === 'number', 'Status: gesichtLaeufe gemeldet');
  const laeufeVor = (await status()).gesichtLaeufe;
  const aus = await pruefeTestbild(['breast', 'genitals', 'feet']);
  const laeufeNachAus = (await status()).gesichtLaeufe;
  if (aus.keinBild) {
    if (OHNE_TESTBILDER) console.log(`firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Gesichtstest uebersprungen (${aus.grund})`);
    else pruefe(false, `Gesichtstest braucht das Testbild: ${aus.grund}`);
  } else {
    pruefe(aus.ok === true, `Gesichtszonen aus: Antwort ok (${aus.fehler})`);
    pruefe(aus.ms && aus.ms.gesicht === undefined, 'Gesichtszonen aus: kein ms.gesicht');
    pruefe(!aus.treffer.some((t) => t.quelle === 'yunet'), 'Gesichtszonen aus: kein Treffer mit quelle yunet');
    pruefe(laeufeNachAus === laeufeVor, `Gesichtszonen aus: gesichtLaeufe unveraendert (${laeufeVor} und ${laeufeNachAus})`);

    // 3. Gesichtszonen an: Augen und Mund aus YuNet
    const zeiten = [];
    let an;
    for (let i = 0; i < 5; i++) {
      an = await pruefeTestbild(['eyes', 'mouth']);
      pruefe(an.ok === true, `Gesichtszonen an: Antwort ok (${an.fehler})`);
      if (an.ok && typeof an.ms.gesicht === 'number') zeiten.push(an.ms.gesicht);
    }
    const laeufeNachAn = (await status()).gesichtLaeufe;
    pruefe(laeufeNachAn === laeufeNachAus + 5, `Gesichtszonen an: gesichtLaeufe wuchs um 5 (${laeufeNachAus} auf ${laeufeNachAn})`);
    pruefe(zeiten.length === 5, `Gesichtszonen an: ms.gesicht in allen Antworten (${zeiten.length} von 5)`);
    console.log(`firefox: ms.gesicht ${JSON.stringify(zeiten)} Median ${median(zeiten)} ms, ms ${JSON.stringify(an.ms)}`);
    const yunet = an.treffer.filter((t) => t.quelle === 'yunet');
    pruefe(yunet.map((t) => t.zone).join() === 'face,head,eyes,mouth', `Gesichtszonen an: Treffer face, head, eyes, mouth mit quelle yunet (${yunet.map((t) => t.zone)})`);
    pruefe(an.flaechen.map((f) => f.zone).sort().join() === 'eyes,mouth', `Gesichtszonen an: Flaechen eyes und mouth (${an.flaechen.map((f) => f.zone)})`);
    pruefe(!an.treffer.some((t) => t.zone === 'face' && !t.quelle), 'Gesichtszonen an: das 320n-Gesicht desselben Gesichts entfaellt');
    const box = (zone) => yunet.find((t) => t.zone === zone)?.box;
    if (box('eyes') && box('mouth') && box('face')) {
      const [ex, ey] = mitte(box('eyes'));
      const [mx, my] = mitte(box('mouth'));
      const g = box('face');
      pruefe(ey < my, 'Augen ueber dem Mund');
      pruefe([[ex, ey], [mx, my]].every(([x, y]) => x > g[0] && x < g[0] + g[2] && y > g[1] && y < g[1] + g[3]), 'Augen und Mund liegen im Gesicht');
    }
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
}
console.log(`firefox: gesicht.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
