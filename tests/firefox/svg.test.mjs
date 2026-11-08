// Firefox: SVG-Logos bleiben nie dauerhaft verdeckt (Live-Lauf 17, MITTEL 1), Gegenstueck zu tests/chromium/svg.spec.ts. Die SVG kommen von einem
// eigenen Server eines fremden Ursprungs (Typ image/svg+xml, ohne CORS). Ein SVG mit eingebettetem Rasterbild wird geprueft, nie blind frei.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

setTimeout(() => {
  console.error('firefox svg: Zeitlimit von 120 s ueberschritten');
  process.exit(1);
}, 120_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const svgPort = port + 1;
const basis = `http://127.0.0.1:${port}`;
const nsfwBild = path.resolve(wurzel, '../05 Testbilder/nsfw/IMG_0260.jpg');

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox svg: Paket fehlt: ${path.relative(wurzel, paket)} (zip:test:firefox)`);
  process.exit(1);
}

const VEKTOR = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><rect width="150" height="40" fill="#e91e63"/></svg>';
const VIEWBOX = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 40"><rect width="150" height="40" fill="#e91e63"/></svg>';
const roh = existsSync(nsfwBild) ? readFileSync(nsfwBild).toString('base64') : '';
const RASTER = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="400"><image width="400" height="400" xlink:href="data:image/jpeg;base64,${roh}"/></svg>`;

// Fund 9: SVG mit Bewegung oder Skript darf nie frei werden.
const SMIL = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><rect width="150" height="40" fill="#e91e63"><set attributeName="fill" to="#000" begin="1s"/></rect></svg>';
const CSS_ANIMIERT = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><style>@keyframes a{from{opacity:0}to{opacity:1}}rect{animation:a 2s infinite}</style><rect width="150" height="40" fill="#e91e63"/></svg>';
const SKRIPT = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><script>document.documentElement.setAttribute("x","1")</script><rect width="150" height="40" fill="#e91e63"/></svg>';
const FREMDOBJEKT = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><foreignObject width="150" height="40"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

const urteil = (id) => driver.executeScript("return document.getElementById(arguments[0])?.getAttribute('data-veil') ?? ''", id);
async function zeitBisUrteil(id, frist = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < frist) {
    const u = await urteil(id);
    if (u) return { ms: Date.now() - t0, urteil: u };
    await warte(50);
  }
  return { ms: Date.now() - t0, urteil: '' };
}
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox svg: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox svg: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

try {
  server.push(await starteFixtureServer(port));
  const svgServer = createServer((req, res) => {
    const pfad = (req.url ?? '').split('?')[0];
    const k = pfad === '/logo.svg' ? VEKTOR : pfad === '/logo-viewbox.svg' ? VIEWBOX : pfad === '/raster.svg' ? RASTER : pfad === '/smil.svg' ? SMIL : pfad === '/css-animiert.svg' ? CSS_ANIMIERT : pfad === '/skript.svg' ? SKRIPT : pfad === '/fremdobjekt.svg' ? FREMDOBJEKT : null;
    if (k === null) {
      res.writeHead(404);
      return res.end('nicht gefunden');
    }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    res.end(k);
  });
  await new Promise((ok) => svgServer.listen(svgPort, '127.0.0.1', ok));
  server.push(svgServer);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  console.log(`firefox svg: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  await test('SVG-Logos (img, Data-URL, Hintergrund) bekommen binnen 5 s ein Urteil frei', async () => {
    await driver.get(`${basis}/svg-logo.html`);
    for (const id of ['logo', 'logo-viewbox', 'logo-data', 'hg']) {
      const r = await zeitBisUrteil(id);
      console.log(`firefox svg: ${id} ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
      if (r.urteil !== 'frei') throw new Error(`${id}: Urteil "${r.urteil}" nach ${r.ms} ms`);
      if (r.ms >= 5000) throw new Error(`${id}: zu langsam (${r.ms} ms)`);
    }
    const blitz = await driver.executeScript('return window.__aufblitzen');
    if (blitz !== 0) throw new Error(`${blitz} Mal aufgeblitzt`);
  });

  await test('SVG mit eingebettetem Rasterbild wird geprueft und nie frei', async () => {
    if (!roh) return console.log('firefox svg: uebersprungen (ohne Testbilder)');
    await driver.get(`${basis}/svg-logo.html?raster=1`);
    const r = await zeitBisUrteil('logo-raster', 15_000);
    console.log(`firefox svg: logo-raster ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
    if (!['zensiert', 'verdeckt'].includes(r.urteil)) throw new Error(`Urteil "${r.urteil}"`);
    await warte(500);
    if ((await urteil('logo-raster')) === 'frei') throw new Error('wurde frei');
  });

  await test('SVG mit Animation (SMIL, CSS), Skript oder foreignObject wird nie frei', async () => {
    await driver.get(`${basis}/svg-logo.html?animiert=1`);
    const ids = ['logo-smil', 'logo-css', 'logo-skript', 'logo-fo'];
    for (const id of ids) {
      const r = await zeitBisUrteil(id, 10_000);
      console.log(`firefox svg: ${id} ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
      if (!['zensiert', 'verdeckt'].includes(r.urteil)) throw new Error(`${id}: Urteil "${r.urteil}"`);
    }
    await warte(1500);
    for (const id of ids) if ((await urteil(id)) === 'frei') throw new Error(`${id} wurde frei`);
  });

  // Lesung 17 R2-1: lesbare SVG (Firefox liest data: und blob: ueber das Canvas) gingen an der Bewegungspruefung vorbei. Gleicher Ursprung
  // geht in Firefox den Url-Weg und muss ebenso verdeckt bleiben.
  await test('lesbares SVG mit Bewegung (data:, blob:, gleicher Ursprung, Hintergrund) wird nie frei, ruhiges wird frei', async () => {
    await driver.get(`${basis}/svg-logo.html?lesbar=1`);
    const bewegt = ['lesbar-smil-data', 'lesbar-smil-blob', 'lesbar-smil-gleich', 'lesbar-hg-smil'];
    const ruhig = ['lesbar-ruhig-blob', 'lesbar-ruhig-gleich', 'lesbar-raster-widerrufen'];
    for (const id of [...bewegt, ...ruhig]) {
      const r = await zeitBisUrteil(id, 10_000);
      console.log(`firefox svg: ${id} ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
      if (bewegt.includes(id) && !['zensiert', 'verdeckt'].includes(r.urteil)) throw new Error(`${id}: Urteil "${r.urteil}"`);
      if (ruhig.includes(id) && r.urteil !== 'frei') throw new Error(`${id}: Urteil "${r.urteil}"`);
    }
    await warte(1500);
    for (const id of bewegt) if ((await urteil(id)) === 'frei') throw new Error(`${id} wurde frei`);
  });

  await test('nicht ladbares SVG bleibt nicht ewig offen', async () => {
    await driver.get(`${basis}/svg-logo.html?kaputt=1`);
    const r = await zeitBisUrteil('logo-kaputt', 6000);
    console.log(`firefox svg: logo-kaputt ${r.urteil || 'kein Urteil'} nach ${r.ms} ms`);
    if (!r.urteil) throw new Error('ohne Urteil');
  });
} finally {
  await driver?.quit().catch(() => {});
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox svg: ${fehlerListe.length} Fehler`);
  process.exit(1);
}
console.log('firefox svg: alles gruen');
process.exit(0);
