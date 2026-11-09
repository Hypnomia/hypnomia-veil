// Firefox: eigenstaendige SVG-Dokumente (oben im Tab, im iframe, im object) mit <image>-Bildern (Nacht 18, Paket N4), Gegenstueck zu
// tests/chromium/svg-dokument.spec.ts. Bilder werden dort geprueft wie auf einer Seite, auch mit data: und blob: (Pixelpruefung braucht ein
// Canvas im HTML-Namensraum), Treffer zensiert, harmlose frei, Hide-first, Pause gibt frei. iframe und object liest die Oberseite ueber
// contentDocument (gleicher Ursprung). Einstellungen ueber das Ereignis veil-test. Stumm gestartet (media.volume_scale 0.0) wie alle Firefox-Tests.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

setTimeout(() => {
  console.error('firefox svg-dokument: Zeitlimit von 180 s ueberschritten');
  process.exit(1);
}, 180_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const portFremd = port + 2; // die Testseite rechnet ebenso: Port plus 2
const basis = `http://127.0.0.1:${port}`;
const testbilder = existsSync(path.resolve(wurzel, '../05 Testbilder/nsfw/IMG_0260.jpg'));

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox svg-dokument: Paket fehlt: ${path.relative(wurzel, paket)} (zip:test:firefox)`);
  process.exit(1);
}
if (!testbilder) {
  const meldung = 'firefox svg-dokument: ohne ../05 Testbilder';
  if (process.env.VEIL_OHNE_TESTBILDER === '1') {
    console.log(`${meldung}, uebersprungen`);
    process.exit(0);
  }
  console.error(meldung);
  process.exit(1);
}

const HTTP = 'd-href:zensiert,d-sfw:frei';
const DATEN = 'dd-blob:zensiert,dd-data:zensiert,dd-sfw:frei';
// kennung: Rahmen auf der Oberseite svg-dokument-rahmen.html (iframe oder object), null = das Dokument selbst im Tab.
const FAELLE = [
  { name: 'Tab, Bilder per http', seite: '/svg-dokument.svg', kennung: null, erwartet: HTTP },
  { name: 'Tab, Bilder aus data: und blob:', seite: '/svg-dokument-daten.svg', kennung: null, erwartet: DATEN },
  { name: 'iframe, Bilder per http', seite: '/svg-dokument-rahmen.html', kennung: 'f-http', erwartet: HTTP },
  { name: 'iframe, Bilder aus data: und blob:', seite: '/svg-dokument-rahmen.html', kennung: 'f-daten', erwartet: DATEN },
  { name: 'object, Bilder per http', seite: '/svg-dokument-rahmen.html', kennung: 'o-http', erwartet: HTTP },
  { name: 'object, Bilder aus data: und blob:', seite: '/svg-dokument-rahmen.html', kennung: 'o-daten', erwartet: DATEN },
];

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox svg-dokument: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox svg-dokument: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

async function bis(beschreibung, fn, frist = 25_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn().catch(() => null);
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 600)})`);
}

async function setze(einstellungen) {
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen }));
}

const DOK = "const d = arguments[0] ? document.getElementById(arguments[0]).contentDocument : document; const w = d.defaultView;";
const liesDok = (kennung) =>
  driver.executeScript(
    `${DOK} return [...d.querySelectorAll('image')].map((el) => ({ id: el.id, urteil: el.getAttribute('data-veil') ?? '', quelle: el.getAttribute('href') ?? '', opacity: w.getComputedStyle(el).opacity }));`,
    kennung,
  );
const zeige = async (kennung) => (await liesDok(kennung)).map((b) => `${b.id}:${b.urteil}`).join(',');
const waechter = (kennung) => driver.executeScript(`${DOK} return { aufblitzen: w.__svgAufblitzen, verborgen: w.__svgVerborgen };`, kennung);
const seitenAttr = (kennung) => driver.executeScript(`${DOK} return d.documentElement.getAttribute('data-veil-seite');`, kennung);

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  console.log(`firefox svg-dokument: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  for (const fall of FAELLE) {
    await test(`SVG-Dokument (${fall.name}): Bilder werden geprueft, Hide-first, Pause gibt frei`, async () => {
      await driver.get(`${basis}${fall.seite}`);
      await bis(`Urteile (${fall.erwartet})`, async () => (await zeige(fall.kennung)) === fall.erwartet, 25_000).catch(async (e) => {
        throw new Error(`${e.message}; jetzt: ${await zeige(fall.kennung).catch(() => '?')}`);
      });
      const w = await waechter(fall.kennung);
      console.log(`firefox svg-dokument: ${fall.name}: Waechter ${JSON.stringify(w)}`);
      if (w.aufblitzen !== 0 || !(w.verborgen > 0)) throw new Error(`Hide-first: ${JSON.stringify(w)}`);
      for (const b of await liesDok(fall.kennung)) {
        if (b.urteil === 'zensiert' && !/^data:image\//.test(b.quelle)) throw new Error(`${b.id}: zensiert ohne eigene Fassung`);
        if (b.opacity !== '1') throw new Error(`${b.id}: opacity ${b.opacity} trotz Urteil`);
      }
      try {
        await setze({ pause: true });
        await bis('Pause gilt', async () => (await seitenAttr(fall.kennung)) === 'aus', 5000);
        for (const b of await liesDok(fall.kennung)) {
          if (b.urteil !== '' || b.opacity !== '1') throw new Error(`${b.id} in der Pause: Urteil "${b.urteil}", opacity ${b.opacity}`);
          if (b.id !== 'dd-data' && b.quelle.startsWith('data:image/jpeg')) throw new Error(`${b.id}: Fassung statt Original in der Pause`);
        }
      } finally {
        await setze({ pause: false });
      }
      await bis('Urteile nach der Pause', async () => (await zeige(fall.kennung)) === fall.erwartet, 25_000);
    });
  }
} finally {
  await driver?.quit().catch(() => {});
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox svg-dokument: ${fehlerListe.length} Fehler`);
  process.exit(1);
}
console.log('firefox svg-dokument: alles gruen');
process.exit(0);
