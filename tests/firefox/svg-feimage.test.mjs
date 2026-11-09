// Firefox: Bilder in Filtern (<filter><feImage href|xlink:href>) laufen durch den Schleier (Nacht 18, Paket N4), Gegenstueck zu
// tests/chromium/svg-feimage.spec.ts. Hide-first (Waechter der Testseite: ohne Urteil greift die Versteck-Regel), Pruefung wie bei einem
// SVG-Bild (Treffer zensiert, harmlose frei), Quellwechsel, Pause; Pixelvergleich der Bildschirmfotos gegen einen zweiten Firefox ohne
// Erweiterung. Einstellungen ueber das Ereignis veil-test (nur auf 127.0.0.1). Stumm gestartet (media.volume_scale 0.0) wie alle Firefox-Tests.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { starteFixtureServer } from '../fixtures-server.mjs';

setTimeout(() => {
  console.error('firefox svg-feimage: Zeitlimit von 180 s ueberschritten');
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
  console.error(`firefox svg-feimage: Paket fehlt: ${path.relative(wurzel, paket)} (zip:test:firefox)`);
  process.exit(1);
}
if (!testbilder) {
  const meldung = 'firefox svg-feimage: ohne ../05 Testbilder';
  if (process.env.VEIL_OHNE_TESTBILDER === '1') {
    console.log(`${meldung}, uebersprungen`);
    process.exit(0);
  }
  console.error(meldung);
  process.exit(1);
}

const TREFFER = ['fe-href', 'fe-xlink', 'fe-fremd', 'fe-data', 'fe-blob', 'fe-shadow', 'fe-ref'];
const HARMLOS = ['fe-sfw', 'fe-sfw-xlink'];
const ALLE = [...TREFFER, ...HARMLOS];
// Erzwungenes "verdeckt" (widerrufene blob:-Adresse, Filter mit feBlend ueber dem Quellbild).
const VERDECKT = 'fe-verdeckt';
// Firefox kann ein feImage nicht auf ein Element zeigen lassen (href="#id"): fe-ref zeigt dort nie ein Bild, Pixelvergleiche ohne ihn.
const PIXEL = ALLE.filter((id) => id !== 'fe-ref');

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox svg-feimage: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox svg-feimage: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

async function bis(beschreibung, fn, frist = 25_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 600)})`);
}

async function setze(einstellungen) {
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen }));
}

// Zustand aller feImage der Seite (auch in der offenen Shadow Root); fe-ref: das Urteil faellt am image in defs.
const lies = () =>
  driver.executeScript(`
    const XLINK = 'http://www.w3.org/1999/xlink';
    const wirt = document.getElementById('wirt')?.shadowRoot;
    return [...document.querySelectorAll('feImage'), ...(wirt?.querySelectorAll('feImage') ?? [])].map((el) => {
      const bild = el.id === 'fe-ref' ? document.getElementById('bild-ref') : null;
      return { id: el.id, urteil: bild ? (bild.getAttribute('data-veil') ?? '') : (el.getAttribute('data-veil') ?? ''),
        quelle: el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href') ?? '', neutral: (el.getAttribute('href') ?? '').startsWith('data:image/png') };
    });`);
const feWaechter = () => driver.executeScript('return { aufblitzen: window.__feAufblitzen, proben: window.__feProben, wer: window.__feWer }');

async function warteAufUrteile(ids, frist = 25_000) {
  const liste = await bis(
    `Urteile fuer ${ids.join(', ')}`,
    async () => {
      const l = await lies();
      return ids.every((id) => l.find((b) => b.id === id)?.urteil) ? l : null;
    },
    frist,
  );
  return new Map(liste.map((b) => [b.id, b]));
}

async function oeffne(d = driver) {
  await d.get(`${basis}/svg-feimage.html`);
  await bis('Testseite bereit', () => d.executeScript("return document.documentElement.dataset.feBereit === '1'"), 10_000);
}

// Bildschirmfoto jedes Filter-Rechtecks, 32 x 32 verkleinert, RGB.
const spannweite = (b) => Math.max(...b) - Math.min(...b);
async function fotos(d, ids) {
  const aus = new Map();
  for (const id of ids) {
    // fe-shadow: das svg in der offenen Shadow Root (ein Element der Wurzel laesst sich ueber das Skript holen und fotografieren)
    const el = id === 'fe-shadow' ? await d.executeScript("return document.getElementById('wirt').shadowRoot.querySelector('svg')") : await d.findElement(By.css(`#s-${id}`));
    const png = Buffer.from(await el.takeScreenshot(), 'base64');
    aus.set(id, await sharp(png).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer());
  }
  return aus;
}
function abstand(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return Math.round((s / a.length) * 100) / 100;
}

const firefoxOptionen = () => new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);

// Referenz: dieselbe Seite in einem zweiten Firefox ohne Erweiterung (dort zeigen alle Filter ihr Original).
async function referenz() {
  const d = await new Builder().forBrowser('firefox').setFirefoxOptions(firefoxOptionen()).build();
  try {
    await d.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
    await oeffne(d);
    let f = await fotos(d, PIXEL);
    for (let i = 0; i < 20 && PIXEL.some((id) => spannweite(f.get(id)) <= 60); i++) {
      await warte(500);
      f = await fotos(d, PIXEL);
    }
    for (const id of PIXEL) if (spannweite(f.get(id)) <= 60) throw new Error(`${id}: Referenz ohne Bild`);
    return f;
  } finally {
    await d.quit().catch(() => {});
  }
}

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(firefoxOptionen()).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  console.log(`firefox svg-feimage: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  await test('Hide-first: kein Filter-Bild (feImage) traegt ohne Urteil noch die Seitenquelle', async () => {
    await oeffne();
    await warte(3000);
    const w = await feWaechter();
    console.log(`firefox svg-feimage: Proben ${w.proben}, aufgeblitzt ${w.aufblitzen} ${w.wer.slice(0, 8).join(', ')}`);
    if (!(w.proben > 0)) throw new Error('keine Proben');
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal ohne Urteil sichtbar: ${w.wer.join(', ')}`);
  });

  await test('Filter-Bilder werden geprueft: Treffer zensiert (nie das Original zu sehen), harmlose frei und unveraendert', async () => {
    const ref = await referenz();
    await oeffne();
    const urteile = await warteAufUrteile(ALLE);
    await warte(1500);
    for (const [id, b] of urteile) console.log(`firefox svg-feimage: ${id} ${b.urteil} (${b.quelle.slice(0, 30)}, neutral ${b.neutral})`);
    for (const id of ['fe-href', 'fe-xlink', 'fe-fremd', 'fe-data', 'fe-blob', 'fe-shadow']) {
      const b = urteile.get(id);
      if (b.urteil !== 'zensiert' || !/^data:image\//.test(b.quelle)) throw new Error(`${id}: Urteil "${b.urteil}", Quelle ${b.quelle.slice(0, 30)}`);
    }
    if (!/^(zensiert|verdeckt)$/.test(urteile.get('fe-ref').urteil)) throw new Error(`fe-ref: Urteil "${urteile.get('fe-ref').urteil}"`);
    for (const id of HARMLOS) if (urteile.get(id).urteil !== 'frei') throw new Error(`${id}: Urteil "${urteile.get(id).urteil}"`);
    const jetzt = await fotos(driver, PIXEL);
    const ab = Object.fromEntries(PIXEL.map((id) => [id, abstand(jetzt.get(id), ref.get(id))]));
    console.log(`firefox svg-feimage: Abstand Foto mit Schleier gegen Foto ohne Erweiterung ${JSON.stringify(ab)}`);
    for (const id of TREFFER.filter((x) => PIXEL.includes(x))) if (!(ab[id] > 3)) throw new Error(`${id}: Original sichtbar (Abstand ${ab[id]})`);
    // Die zensierte Fassung erscheint wirklich (ein leeres Rechteck wiche auch von der Referenz ab).
    const sp = Object.fromEntries(TREFFER.filter((x) => PIXEL.includes(x)).map((id) => [id, spannweite(jetzt.get(id))]));
    console.log(`firefox svg-feimage: Spannweite der Fotos nach dem Urteil ${JSON.stringify(sp)}`);
    for (const [id, w] of Object.entries(sp)) if (!(w > 60)) throw new Error(`${id}: zensierte Fassung nicht zu sehen (Spannweite ${w})`);
    for (const id of HARMLOS) if (!(ab[id] < 1)) throw new Error(`${id}: harmloses Bild veraendert (Abstand ${ab[id]})`);
    const w = await feWaechter();
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal aufgeblitzt: ${w.wer.join(', ')}`);
  });

  await test('Quellwechsel nach "frei" (href und xlink:href) verbirgt sofort und prueft neu', async () => {
    await oeffne();
    await warteAufUrteile(HARMLOS);
    const direkt = await driver.executeAsyncScript(`
      const fertig = arguments[arguments.length - 1];
      const XLINK = 'http://www.w3.org/1999/xlink';
      document.getElementById('fe-sfw').setAttribute('href', '/testbild/nsfw/IMG_0260.jpg?neu=1');
      document.getElementById('fe-sfw-xlink').setAttributeNS(XLINK, 'xlink:href', '/testbild/nsfw/IMG_0260.jpg?neu=2');
      requestAnimationFrame(() => fertig(['fe-sfw', 'fe-sfw-xlink'].map((id) => (document.getElementById(id).getAttribute('data-veil') ?? '') + '|' + ((document.getElementById(id).getAttribute('href') ?? '').startsWith('data:image/png') ? 'neutral' : 'offen'))));`);
    console.log(`firefox svg-feimage: nach Wechsel im naechsten Frame ${direkt.join(', ')}`);
    for (const d of direkt) if (d !== '|neutral') throw new Error(`nach dem Wechsel noch sichtbar: ${direkt.join(', ')}`);
    await bis(
      'neue Urteile nach dem Wechsel',
      async () => {
        const l = (await lies()).filter((b) => HARMLOS.includes(b.id));
        return l.every((b) => b.urteil === 'zensiert') ? l : null;
      },
      20_000,
    );
    const w = await feWaechter();
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal aufgeblitzt: ${w.wer.join(', ')}`);
  });

  await test('Pause gibt alle Filter-Bilder frei und stellt die Originale her, danach wieder beurteilt', async () => {
    const ref = await referenz();
    await oeffne();
    const vorher = await warteAufUrteile(ALLE);
    try {
      await setze({ pause: true });
      await bis('Pause gilt', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === 'aus'"), 5000);
      const quellen = await driver.executeScript('return window.__feQuellen');
      const inPause = await lies();
      if (inPause.length !== ALLE.length + 1) throw new Error(`${inPause.length} Filter-Bilder`);
      for (const b of inPause) {
        if (b.neutral) throw new Error(`${b.id}: in der Pause noch neutral`);
        if (b.id !== 'fe-ref' && b.quelle !== quellen[b.id]) throw new Error(`${b.id}: Original nicht zurueck`);
      }
      let jetzt = await fotos(driver, PIXEL);
      for (let i = 0; i < 12 && PIXEL.some((id) => abstand(jetzt.get(id), ref.get(id)) >= 1); i++) {
        await warte(500);
        jetzt = await fotos(driver, PIXEL);
      }
      const ab = Object.fromEntries(PIXEL.map((id) => [id, abstand(jetzt.get(id), ref.get(id))]));
      console.log(`firefox svg-feimage: in der Pause, Abstand Foto gegen Foto ohne Erweiterung ${JSON.stringify(ab)}`);
      for (const id of PIXEL) if (!(ab[id] < 1)) throw new Error(`${id}: in der Pause nicht das Original (Abstand ${ab[id]})`);
    } finally {
      await setze({ pause: false });
    }
    await bis('Pause aus', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === null"), 5000);
    const danach = await warteAufUrteile(ALLE);
    for (const id of ALLE) if (danach.get(id).urteil !== vorher.get(id).urteil) throw new Error(`${id}: nach der Pause ${danach.get(id).urteil}, vorher ${vorher.get(id).urteil}`);
  });

  await test('Hide-first an den Pixeln: bei gesperrter Freigabe bleibt jedes Filterrechteck ohne Bild (nie ein Urteil, nie das Original)', async () => {
    await driver.get(`${basis}/svg-feimage.html?veil-freigabe=nie`);
    await bis('Testseite bereit', () => driver.executeScript("return document.documentElement.dataset.feBereit === '1'"), 10_000);
    await warte(4000);
    const liste = await lies();
    if (liste.some((b) => b.urteil !== '')) throw new Error('Freigabe war nicht gesperrt');
    const f = await fotos(driver, PIXEL);
    const sp = Object.fromEntries(PIXEL.map((id) => [id, spannweite(f.get(id))]));
    console.log(`firefox svg-feimage: gesperrt, Spannweite der Fotos ${JSON.stringify(sp)}`);
    for (const id of PIXEL) if (!(sp[id] < 30)) throw new Error(`${id}: Bild ohne Urteil zu sehen (Spannweite ${sp[id]})`);
  });

  // Runde 2, Fund 2: "verdeckt" nimmt das gefilterte Element nicht aus der Darstellung (Rechteck sichtbar, an den Ecken der graue Platzhalter).
  await test('Erzwungenes "verdeckt": gefiltertes Element bleibt sichtbar, kein Originalbild, Pause stellt die Quelle her', async () => {
    await oeffne();
    await bis('Urteil verdeckt', async () => (await lies()).find((b) => b.id === VERDECKT)?.urteil === 'verdeckt', 25_000);
    await warte(800);
    const el = await driver.findElement(By.css(`#s-${VERDECKT}`));
    const roh = await sharp(Buffer.from(await el.takeScreenshot(), 'base64')).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer();
    const px = (x, y) => [roh[(y * 32 + x) * 3], roh[(y * 32 + x) * 3 + 1], roh[(y * 32 + x) * 3 + 2]];
    const mitte = px(16, 16);
    const ecke = px(2, 2);
    console.log(`firefox svg-feimage: verdeckt, Mitte ${mitte}, Ecke ${ecke}`);
    if (!(mitte[0] > 150 && mitte[1] < 80 && mitte[2] > 150)) throw new Error(`Rechteck nicht sichtbar: ${mitte}`);
    if (!ecke.every((k) => Math.abs(k - 128) < 40)) throw new Error(`Ecke nicht neutral grau: ${ecke}`);
    const b = (await lies()).find((x) => x.id === VERDECKT);
    if (!/^data:image\//.test(b.quelle)) throw new Error(`Quelle ${b.quelle.slice(0, 30)}`);
    try {
      await setze({ pause: true });
      await bis('Pause gilt', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === 'aus'"), 5000);
      const [quelle, original] = await driver.executeScript("return [document.getElementById('fe-verdeckt').getAttribute('href'), window.__feQuellen['fe-verdeckt']]");
      if (quelle !== original) throw new Error('Original in der Pause nicht zurueck');
    } finally {
      await setze({ pause: false });
    }
  });

  // Runde 2, Fund 3: ein feImage hat keinen Kasten; es darf auf einer vollen Seite nicht hinter allen Bildern anstehen.
  await test('feImage im Sichtbereich wird auf einer vollen Seite nicht zuletzt beurteilt', async () => {
    await driver.get(`${basis}/svg-feimage-voll.html`);
    await bis('Urteil des feImage', () => driver.executeScript("return window.__ordnung.some((e) => e.startsWith('fe-voll:'))"), 90_000);
    const ordnung = await driver.executeScript('return window.__ordnung');
    const rang = ordnung.findIndex((e) => e.startsWith('fe-voll:')) + 1;
    console.log(`firefox svg-feimage: Rang des feImage unter den Urteilen ${rang} von ${ordnung.length} bisher`);
    if (rang > 35) throw new Error(`feImage erst als ${rang}. beurteilt`);
  });

  // Runde 3, Fund 1: SMIL (set) wechselt die Quelle eines feImage, ohne ein Attribut zu aendern; gezeichnet wird animVal.
  await test('SMIL auf href eines feImage (Kind-Element und href="#id"): nie das Bild, Pause gibt Original samt Animation zurueck', async () => {
    const SMIL = ['fe-smil', 'fe-smil-fern'];
    const foto = async (d, id) => sharp(Buffer.from(await (await d.findElement(By.css(`#s-${id}`))).takeScreenshot(), 'base64')).removeAlpha().resize(32, 32, { fit: 'fill' }).raw().toBuffer();
    // Referenz: Firefox ohne Erweiterung
    const rd = await new Builder().forBrowser('firefox').setFirefoxOptions(firefoxOptionen()).build();
    const ref = new Map();
    try {
      await rd.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
      await rd.get(`${basis}/svg-feimage-smil.html`);
      await warte(3500);
      for (const id of SMIL) ref.set(id, await foto(rd, id));
    } finally {
      await rd.quit().catch(() => {});
    }
    for (const id of SMIL) if (!(spannweite(ref.get(id)) > 60)) throw new Error(`${id}: Referenz ohne Bild`);
    await driver.get(`${basis}/svg-feimage-smil.html`);
    const t0 = Date.now();
    const gesehen = { 'fe-smil': 0, 'fe-smil-fern': 0 };
    while (Date.now() - t0 < 6000) {
      for (const id of SMIL) gesehen[id] = Math.max(gesehen[id], spannweite(await foto(driver, id)));
      await warte(300);
    }
    const urteile = await driver.executeScript("return ['fe-smil', 'fe-smil-fern'].map((id) => document.getElementById(id).getAttribute('data-veil') ?? '')");
    console.log(`firefox svg-feimage: SMIL, hoechste Spannweite ${JSON.stringify(gesehen)}, Urteile ${urteile}`);
    for (const id of SMIL) if (!(gesehen[id] < 60)) throw new Error(`${id}: Bild per SMIL zu sehen (Spannweite ${gesehen[id]})`);
    if (urteile.includes('frei')) throw new Error(`Urteil frei: ${urteile}`);
    try {
      await setze({ pause: true });
      await bis('Pause gilt', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === 'aus'"), 5000);
      let ab = {};
      for (let i = 0; i < 12; i++) {
        await warte(500);
        ab = {};
        for (const id of SMIL) ab[id] = abstand(await foto(driver, id), ref.get(id));
        if (SMIL.every((id) => ab[id] < 1)) break;
      }
      console.log(`firefox svg-feimage: SMIL in der Pause, Abstand zum Foto ohne Erweiterung ${JSON.stringify(ab)}`);
      for (const id of SMIL) if (!(ab[id] < 1)) throw new Error(`${id}: in der Pause nicht das Original (Abstand ${ab[id]})`);
    } finally {
      await setze({ pause: false });
    }
  });

  // Runde 3, Fund 2: die Seite setzt href, nachdem ein Urteil steht ("verdeckt" und "zensiert"): neue Quelle wird geprueft, Pause gibt sie zurueck.
  for (const [name, id] of [['verdeckt', 'fe-verdeckt'], ['zensiert', 'fe-href']]) {
    await test(`Quellwechsel der Seite nach "${name}": die neue Quelle wird geprueft, die Pause gibt sie zurueck`, async () => {
      await oeffne();
      await bis(`Urteil ${name}`, async () => (await lies()).find((b) => b.id === id)?.urteil === name, 25_000);
      const neu = `/testbild/nsfw/IMG_0260.jpg?neu=${name}`;
      await driver.executeScript('document.getElementById(arguments[0]).setAttribute("href", arguments[1])', id, neu);
      await bis('neues Urteil zensiert', async () => (await lies()).find((b) => b.id === id)?.urteil === 'zensiert', 25_000);
      const b = (await lies()).find((x) => x.id === id);
      if (!/^data:image\//.test(b.quelle)) throw new Error(`Quelle ${b.quelle.slice(0, 30)}`);
      try {
        await setze({ pause: true });
        await bis('Pause gilt', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === 'aus'"), 5000);
        const quelle = await driver.executeScript('return document.getElementById(arguments[0]).getAttribute("href")', id);
        if (quelle !== neu) throw new Error(`Pause gibt nicht die neue Quelle zurueck: ${quelle}`);
      } finally {
        await setze({ pause: false });
      }
    });
  }
} finally {
  await driver?.quit().catch(() => {});
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox svg-feimage: ${fehlerListe.length} Fehler`);
  process.exit(1);
}
console.log('firefox svg-feimage: alles gruen');
process.exit(0);
