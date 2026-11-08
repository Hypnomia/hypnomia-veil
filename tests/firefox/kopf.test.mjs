// Firefox-Test Session 17 (Sicherheitspruefung Phase 9, Fund A1): eigene Bildabrufe der Erweiterung tragen keinen Origin-Kopf mit der
// moz-extension-Kennung. Eigener Server zeichnet die Koepfe auf; Gegenprobe: cors-Abruf aus einer Seite traegt Origin.
// Paket N3 Session 18 (Restpunkte derselben Pruefung): A4 Referer-Regel nie fuer die Hosts des Versions-Checks und nur bis zum Ablauf der
// Haltezeit; A3 Wurzel-Haken nicht per Symbol.for abfragbar, zweites Einspritzen richtet nichts doppelt ein; N1 CSP der Erweiterungsseiten
// mit default-src, Seiten laden Bilder und Schriften, ein fremdes Bild wird blockiert.
import { createServer } from 'node:http';
import sharp from 'sharp';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const eigenschaft = (css, name) => driver.executeScript(`return document.querySelector(arguments[0])[arguments[1]]`, css, name);
// Leer, solange die Seite noch laedt (Element fehlt): sonst wackelt das Warten auf das Popup (Firefox 128, Session 11).
const text = async (css) => (await driver.executeScript(`const e = document.querySelector(arguments[0]); return e ? e.textContent.trim() : ''`, css)) ?? '';

const sichtbar = (css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);
const klick = (css) => driver.executeScript(`document.querySelector(arguments[0]).click()`, css);
const setzeRange = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));
const einst = async () => (await speicher('einstellungen')) ?? {};
const waehle = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, wert);
const zahl = (css, wert) =>
  driver.executeScript(`const e = document.querySelector(arguments[0]); e.value = arguments[1]; e.dispatchEvent(new Event('change', { bubbles: true }));`, css, String(wert));

let code = 0;
const koepfe = [];
const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 180, b: 220 } } }).png().toBuffer();
const server = createServer((req, res) => {
  koepfe.push({ pfad: req.url ?? '', kopf: req.headers });
  if ((req.url ?? '').startsWith('/bild')) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    return res.end(png);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  const mit = /^\/mitbild-([a-z0-9]+)/.exec(req.url ?? '');
  if (mit) return res.end(`<!doctype html><title>Bild</title><img id="b" width="400" height="400" src="http://localhost:${server.address().port}/bild-${mit[1]}.png">`);
  if ((req.url ?? '').startsWith('/mitbild')) return res.end(`<!doctype html><title>Bild</title><img id="b" width="400" height="400" src="http://localhost:${server.address().port}/bild-erkenner.png">`);
  res.end('<!doctype html><title>leer</title>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  // Gegenprobe aus einer normalen Seite
  await driver.get(`http://localhost:${port}/seite`);
  await driver.executeAsyncScript(`const f = arguments[arguments.length - 1]; fetch(arguments[0], { mode: 'cors', credentials: 'omit' }).then(() => f(), () => f());`, `http://127.0.0.1:${port}/bild-gegenprobe.png`);
  const gegen = koepfe.find((k) => k.pfad.startsWith('/bild-gegenprobe'));
  pruefe(gegen?.kopf.origin === `http://localhost:${port}`, `Gegenprobe: Seiten-Abruf traegt Origin (${gegen?.kopf.origin})`);

  // Seite auf 127.0.0.1 mit Bild von localhost (fremder Ursprung ohne CORS): der Schleier laesst den Erkenner das Bild nachladen.
  await driver.get(`http://127.0.0.1:${port}/mitbild`);
  await bis('Bild vom Erkenner geholt', async () => koepfe.filter((k) => k.pfad.startsWith('/bild-erkenner')).length >= 2, 20_000).catch(() => {});
  const alle = koepfe.filter((k) => k.pfad.startsWith('/bild-erkenner'));
  console.log(`firefox: ${alle.length} Abrufe des Bildes: ${alle.map((k) => `origin=${k.kopf.origin ?? '-'} sec-fetch-dest=${k.kopf['sec-fetch-dest'] ?? '-'}`).join('; ')}`);
  // Der Seitenabruf des img (sec-fetch-dest image, ohne Origin) ist der erste; der Abruf des Erkenners ist ein fetch (sec-fetch-dest empty).
  const abruf = koepfe.find((k) => k.pfad.startsWith('/bild-erkenner') && k.kopf['sec-fetch-dest'] !== 'image');
  pruefe(!!abruf, 'der Erkenner hat das Bild vom Server geholt');
  console.log(`firefox: Abruf des Erkenners origin=${abruf?.kopf.origin ?? '(keiner)'} referer=${abruf?.kopf.referer ?? '(keiner)'} sec-fetch-site=${abruf?.kopf['sec-fetch-site'] ?? '-'}`);
  pruefe(!/extension:\/\//.test(abruf?.kopf.origin ?? ''), 'kein Origin mit moz-extension-Kennung');
  pruefe(abruf?.kopf.origin === undefined, 'gar kein Origin-Kopf');

  // ---------- A3: Wurzel-Haken ohne Symbol.for-Kennzeichen ----------
  await driver.get(`http://127.0.0.1:${port}/seite-haken`);
  const hakenBefund = async () =>
    JSON.parse(
      await driver.executeScript(`
        const s = document.createElement('script');
        s.textContent = "document.documentElement.setAttribute('data-n3', JSON.stringify({ perFor: Symbol.for('hypnomia-veil.wurzel-haken') in Element.prototype, namen: Object.getOwnPropertySymbols(Element.prototype).map((x) => String(x.description)), haken: !/native code/.test(Function.prototype.toString.call(Element.prototype.attachShadow)) }))";
        document.documentElement.append(s);
        s.remove();
        return document.documentElement.getAttribute('data-n3');`),
    );
  const haken = await hakenBefund();
  console.log(`firefox: n3 Haken ${JSON.stringify(haken)}`);
  pruefe(haken.haken === true, 'A3: Haken laeuft in der Seitenwelt');
  pruefe(haken.perFor === false, 'A3: Seite findet den Haken nicht ueber Symbol.for');
  pruefe(!haken.namen.some((n) => /veil|hypnomia|haken/i.test(n)), 'A3: kein Symbol mit Namen der Erweiterung am Element.prototype');
  const hakenDatei = readFileSync(path.join(ausgabe, 'firefox-mv3', 'content-scripts', 'wurzel-haken.js'), 'utf8');
  const stile = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const s = document.createElement('script');
     s.textContent = arguments[0] + ";\\n const h = document.createElement('div'); document.body.append(h); window.__n3w = h.attachShadow({ mode: 'open' });";
     document.documentElement.append(s);
     setTimeout(() => fertig(document.querySelector('body > div:last-child').shadowRoot.querySelectorAll('style[data-veil-haken], style[data-veil-eigen]').length), 300);`,
    hakenDatei,
  );
  pruefe(stile === 1, `A3: zweites Einspritzen, genau ein Stil in der neuen Wurzel (${stile})`);

  // ---------- A4: Referer-Regeln ----------
  await oeffne('hilfe.html');
  const sende = (n) => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, n);
  for (const host of ['raw.githubusercontent.com', 'githubusercontent.com', 'github.com']) {
    const a = await sende({ ziel: 'hintergrund', typ: 'referer', host, referer: 'https://seite-b.example/' });
    pruefe(a?.ok === false, `A4: keine Referer-Regel fuer ${host} (${JSON.stringify(a)})`);
  }
  await imSeitenkontext(`await api.storage.local.set({ testRefererDauer: 8000 }); return true;`);
  const gesetzt = await sende({ ziel: 'hintergrund', typ: 'referer', host: `localhost:${port}`, referer: 'http://seite-c.example/' });
  const t0 = Date.now();
  pruefe(gesetzt?.ok === true, `A4: Referer-Regel fuer localhost gesetzt (${JSON.stringify(gesetzt)})`);
  const erkennerAbruf = (name) => koepfe.find((k) => k.pfad.startsWith(`/bild-${name}`) && k.kopf['sec-fetch-dest'] !== 'image');
  await driver.get(`http://127.0.0.1:${port}/mitbild-cfrisch`);
  await bis('Erkenner holt cfrisch', async () => !!erkennerAbruf('cfrisch'), 20_000).catch(() => {});
  console.log(`firefox: n3 innerhalb der Haltezeit (${Date.now() - t0} ms) referer=${erkennerAbruf('cfrisch')?.kopf.referer ?? '(keiner)'}`);
  pruefe(erkennerAbruf('cfrisch')?.kopf.referer === 'http://seite-c.example/', 'A4: innerhalb der Haltezeit traegt der Abruf den Referer');
  await warte(Math.max(0, 8600 - (Date.now() - t0)));
  await driver.get(`http://127.0.0.1:${port}/mitbild-cspaet`);
  await bis('Erkenner holt cspaet', async () => !!erkennerAbruf('cspaet'), 20_000).catch(() => {});
  console.log(`firefox: n3 nach Ablauf referer=${erkennerAbruf('cspaet')?.kopf.referer ?? '(keiner)'}`);
  pruefe(!!erkennerAbruf('cspaet'), 'A4: Erkenner hat das spaete Bild geholt');
  pruefe(erkennerAbruf('cspaet')?.kopf.referer !== 'http://seite-c.example/', 'A4: nach der Haltezeit kein Referer aus der alten Regel');
  // Der Schleier hat das Bild beurteilt (Erkenner im Hintergrund unter der CSP: Abruf, Dekodieren, Modell).
  const urteil = await bis('Urteil am Bild', async () => driver.executeScript(`const b = document.getElementById('b'); const u = b && b.getAttribute('data-veil'); return u === 'frei' || u === 'zensiert' ? u : null;`), 20_000).catch(() => null);
  pruefe(!!urteil, `N1: Bild beurteilt (${urteil})`);
  await oeffne('hilfe.html');
  await imSeitenkontext(`await api.storage.local.remove('testRefererDauer'); return true;`);

  // ---------- N1: CSP der Erweiterungsseiten ----------
  const csp = await imSeitenkontext(`return api.runtime.getManifest().content_security_policy.extension_pages;`);
  console.log(`firefox: n3 CSP ${csp}`);
  pruefe(/(^|;)\s*default-src 'self'\s*(;|$)/.test(csp ?? ''), "N1: default-src 'self'");
  pruefe(/(^|;)\s*script-src 'self' 'wasm-unsafe-eval'\s*(;|$)/.test(csp ?? ''), 'N1: script-src unveraendert');
  pruefe(/(^|;)\s*img-src 'self' data: blob:\s*(;|$)/.test(csp ?? ''), 'N1: img-src nur Erweiterung, data:, blob:');
  for (const name of ['popup.html', 'options.html', 'willkommen.html', 'hilfe.html']) {
    await oeffne(name);
    await warte(1500);
    const stand = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       document.fonts.ready.then(() => fertig({
         bilder: [...document.images].filter((b) => b.currentSrc && b.complete && b.naturalWidth === 0).map((b) => b.currentSrc.slice(0, 80)),
         schriften: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
         text: (document.body ? document.body.innerText : '').trim().length,
       }));`,
    );
    console.log(`firefox: n3 ${name} ${JSON.stringify(stand)}`);
    pruefe(stand.bilder.length === 0 && stand.schriften.length === 0 && stand.text > 0, `N1: ${name} laedt Bilder, Schriften, Text`);
  }
  // Gegenprobe des Detektors: ein fremdes Bild in einer Erweiterungsseite wird blockiert (Verletzungs-Ereignis, Server sieht nichts).
  await oeffne('popup.html');
  const probe = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     let n = 0;
     document.addEventListener('securitypolicyviolation', () => n++);
     const b = document.createElement('img');
     b.src = arguments[0];
     document.body.append(b);
     setTimeout(() => fertig({ n, breite: b.naturalWidth }), 1500);`,
    `http://127.0.0.1:${port}/bild-csp-probe.png`,
  );
  console.log(`firefox: n3 CSP-Probe ${JSON.stringify(probe)}`);
  pruefe(probe.breite === 0 && !koepfe.some((k) => k.pfad.startsWith('/bild-csp-probe')), 'N1: fremdes Bild in einer Erweiterungsseite blockiert');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  server.close();
}
console.log(`firefox: kopf.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
