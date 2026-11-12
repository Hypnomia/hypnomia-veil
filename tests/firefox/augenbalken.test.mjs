// Firefox: Preset Augenbalken (Eye bar) ueber geckodriver/WebDriver. Das Preset ist auf der Einstellungsseite waehlbar und gespeichert; ein Bild mit
// Gesicht bekommt einen schwarzen Balken ueber den Augen (auch bei ausgeschalteten Augen), alle anderen Pixel bleiben (Pixelmessung im
// Seitenkontext); ein Bild ohne Gesicht bleibt frei; mehrere Gesichter, bewegtes SVG, PNG mit Alpha, Seite mit Bild, Leinwand, Video und Pause.
// Die uebrigen Presets (Mias Gesicht, Woerter, Person, Zensurbalken) misst presets.test.mjs.
// Testbild aus ../05 Testbilder (nie im Repo): fehlt es, ist der Test rot, ausser mit VEIL_OHNE_TESTBILDER=1.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 150 s ueberschritten');
  process.exit(1);
}, 150_000).unref();

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
const ROSA = [255, 79, 163];
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


const speicher = (k) => imSeitenkontext(`const r = await api.storage.local.get(args[0]); return JSON.parse(JSON.stringify(r[args[0]] ?? null));`, k);
const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();
const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Erkenner mit Testbild im Seitenkontext; `stil`, `an` (eingeschaltete Zonen). Misst bei `messen` den Balken gegen das Original, bei
// `farben` den Anteil Pack-Farben und den Rahmen in der ersten Flaeche. Ohne Bild: { keinBild }.
function lauf(preset, an, opt) {
  return imSeitenkontext(
    `
    const [basis, name, preset, an, opt] = args;
    const zonen = {};
    for (const n of ['eyes','mouth','face','head']) zonen[n] = { an: an.includes(n) };
    for (const n of ['breast','genitals','buttocks','belly','feet','armpits']) zonen[n] = { an: an.includes(n), bedeckt: false };
    const alsDataUrl = (blob) => new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(blob); });
    let dataUrl;
    let bitmapOrig;
    if (opt.leer) {
      const c = new OffscreenCanvas(480, 360); const x = c.getContext('2d'); x.fillStyle = 'rgb(120,160,200)'; x.fillRect(0, 0, 480, 360);
      dataUrl = await alsDataUrl(await c.convertToBlob({ type: 'image/png' }));
    } else {
      const antwort = await fetch(basis + '/testbild/sfw/' + encodeURIComponent(name));
      if (!antwort.ok) return { keinBild: true, grund: 'Testbild nicht ladbar: HTTP ' + antwort.status };
      bitmapOrig = await createImageBitmap(await antwort.blob());
      const f = Math.min(1, 1280 / Math.max(bitmapOrig.width, bitmapOrig.height));
      const c = new OffscreenCanvas(Math.round(bitmapOrig.width * f), Math.round(bitmapOrig.height * f));
      c.getContext('2d').drawImage(bitmapOrig, 0, 0, c.width, c.height);
      dataUrl = await alsDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
      bitmapOrig = await createImageBitmap(await (await fetch(dataUrl)).blob());
    }
    const roh = await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'pruefe', id: 'ff-' + Math.random(), quelle: { art: 'daten', dataUrl },
      breite: 0, hoehe: 0, einstellungen: { schwelle: 0.1, zonen, rand: 0.15, preset }, rendern: true });
    const a = JSON.parse(JSON.stringify(roh));
    if (!a.ok) return { fehler: a.fehler };
    const aus = { ok: true, zonen: a.flaechen.map((f) => f.zone), flaechen: a.flaechen, hatBild: typeof a.bild === 'string', yunetAugen: a.treffer.some((t) => t.zone === 'eyes' && t.quelle === 'yunet') };
    if (!a.bild) return aus;
    const b = await createImageBitmap(await (await fetch(a.bild)).blob());
    const k = new OffscreenCanvas(b.width, b.height); const ctx = k.getContext('2d'); ctx.drawImage(b, 0, 0);
    const px = ctx.getImageData(0, 0, b.width, b.height).data;
    if (opt.messen && bitmapOrig) {
      const k2 = new OffscreenCanvas(b.width, b.height); const c2 = k2.getContext('2d'); c2.drawImage(bitmapOrig, 0, 0, b.width, b.height);
      const o = c2.getImageData(0, 0, b.width, b.height).data;
      const im = (f, x, y, r) => {
        if (f.balken) {
          const bk = f.balken, dx = x + 0.5 - bk.mitte[0], dy = y + 0.5 - bk.mitte[1], c = Math.cos(-bk.winkel), sn = Math.sin(-bk.winkel);
          return Math.abs(dx * c - dy * sn) <= bk.breite / 2 - r && Math.abs(dx * sn + dy * c) <= bk.hoehe / 2 - r;
        }
        return x >= f.box[0] + r && x < f.box[0] + f.box[2] - r && y >= f.box[1] + r && y < f.box[1] + f.box[3] - r;
      };
      let innen = 0, schwarz = 0, ausN = 0, summe = 0, gross = 0, rosa = 0;
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
        const i = (y * b.width + x) * 4;
        if (a.flaechen.some((f) => im(f, x, y, 3))) { innen++; if (px[i] < 50 && px[i+1] < 50 && px[i+2] < 50) schwarz++; continue; }
        if (a.flaechen.some((f) => im(f, x, y, -8))) { if (a.flaechen.some((f) => im(f, x, y, -6)) && Math.hypot(px[i]-255, px[i+1]-79, px[i+2]-163) < 60) rosa++; continue; }
        ausN++; const d = (Math.abs(px[i]-o[i]) + Math.abs(px[i+1]-o[i+1]) + Math.abs(px[i+2]-o[i+2])) / 3; summe += d; if (d > 48) gross++;
      }
      Object.assign(aus, { gedreht: a.flaechen.some((f) => !!f.balken), innen, innenSchwarz: innen ? schwarz / innen : 0, ausN, mittel: ausN ? summe / ausN : 0, gross: ausN ? gross / ausN : 0, rosa });
    }
    if (opt.farben) {
      const [x, y, w, h] = a.flaechen[0].box;
      const rb = Math.min(10, Math.max(2, Math.round(0.03 * Math.min(w, h))));
      const ix = x + Math.max(rb + 3, Math.round(w * 0.1)), iy = y + Math.max(rb + 3, Math.round(h * 0.1));
      let t = 0, g = 0;
      for (let yy = iy; yy < y + h - (iy - y); yy++) for (let xx = ix; xx < x + w - (ix - x); xx++) {
        g++; const i = (yy * b.width + xx) * 4;
        if (opt.farben.some((f) => Math.hypot(px[i]-f[0], px[i+1]-f[1], px[i+2]-f[2]) < 70)) t++;
      }
      const s = [0, 0, 0]; let n = 0;
      for (let yy = y + Math.round(h * 0.25); yy < y + Math.round(h * 0.75); yy++) for (let xx = x; xx < x + rb; xx++) { const i = (yy * b.width + xx) * 4; s[0] += px[i]; s[1] += px[i+1]; s[2] += px[i+2]; n++; }
      Object.assign(aus, { anteilPack: g ? t / g : 0, rahmen: s.map((v) => Math.round(v / n)), rb, box: [x, y, w, h] });
    }
    return aus;`,
    basis,
    TESTBILD,
    preset,
    an,
    opt ?? {},
  );
}

let code = 0;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);
  await oeffne('options.html');
  await bis('Status mit YuNet bereit', async () => {
    const s = await imSeitenkontext(`return JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'status' })));`);
    return s && s.ok && s.gesichtBereit;
  });

  // 1. Einstellungsseite: Preset Eye bar waehlbar, gespeichert, Hinweise
  const felder = await driver.findElements(By.css('#preset-karten input[name="preset"]'));
  pruefe(felder.length === 13, `Einstellungsseite: dreizehn Preset-Karten (${felder.length})`);
  pruefe(!(await sichtbar('#zonen-hinweis')), 'Zonen-Hinweis ruht ohne Balken-Preset');
  await driver.findElement(By.css('label:has(#preset-augenbalken)')).click();
  await bis('Preset gespeichert', async () => (await speicher('einstellungen'))?.preset === 'augenbalken');
  pruefe((await text('#stil-hinweis')) === 'Just a black bar over the eyes. Everything else stays in view.', 'Satz zum Preset unter den Karten');
  await bis('Zonen-Hinweis', () => sichtbar('#zonen-hinweis'));
  pruefe((await text('#zonen-hinweis')).includes('only the eyes'), 'Hinweis bei What I cover');
  await driver.navigate().refresh();
  await bis('nach Neuladen gewaehlt', async () => (await driver.findElement(By.css('#preset-augenbalken')).isSelected()));
  pruefe(true, 'Eye bar nach dem Neuladen noch gewaehlt');

  // 2. Ohne Gesicht bleibt das Bild frei
  const leer = await lauf('augenbalken', ['breast', 'eyes', 'mouth', 'face', 'head'], { leer: true });
  pruefe(leer.ok === true && leer.zonen.length === 0 && leer.hatBild === false, `Bild ohne Gesicht bleibt frei (${JSON.stringify(leer).slice(0, 120)})`);

  // 3. Balken: schwarz, sonst unveraendert, auch bei ausgeschalteten Augen
  const a = await lauf('augenbalken', ['breast'], { messen: true });
  if (a.keinBild) {
    if (OHNE_TESTBILDER) console.log(`firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Eye-bar-Test uebersprungen (${a.grund})`);
    else pruefe(false, `Eye-bar-Test braucht das Testbild: ${a.grund}`);
  } else {
    pruefe(a.ok === true, `Eye bar: Antwort ok (${a.fehler})`);
    pruefe(a.zonen.length >= 1 && a.zonen.every((z) => z === 'eyes'), `Eye bar: nur Augenflaechen (${a.zonen})`);
    pruefe(a.yunetAugen === true, 'Eye bar: YuNet laeuft bei ausgeschalteten Augen');
    console.log(`firefox: Eye bar: gedreht ${a.gedreht}, innen ${a.innen} px, schwarz ${(a.innenSchwarz * 100).toFixed(1)} %, aussen ${a.ausN} px, Abweichung ${a.mittel.toFixed(2)}, ueber 48: ${(a.gross * 100).toFixed(2)} %, rosa ${a.rosa}`);
    pruefe(a.innen > 500 && a.innenSchwarz > 0.99, `Eye bar: deckendes Schwarz (${a.innenSchwarz})`);
    pruefe(a.mittel < 4 && a.gross < 0.005, `Eye bar: Rest unveraendert (${a.mittel}, ${a.gross})`);
    pruefe(a.rosa < 5, `Eye bar: kein pinker Rahmen (${a.rosa})`);
    const alle = await lauf('augenbalken', ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'], {});
    pruefe(JSON.stringify(alle.flaechen) === JSON.stringify(a.flaechen), 'Eye bar: alle Zonen an ergibt dieselben Flaechen');
  }

  // 3b. Mehrere Gesichter, bewegtes SVG, PNG mit Alpha (Quellen werden im Seitenkontext gebaut)
  const sonder = await imSeitenkontext(
    `
    const [basis, name] = args;
    const zonen = {};
    for (const n of ['eyes','mouth','face','head']) zonen[n] = { an: false };
    for (const n of ['breast','genitals','buttocks','belly','feet','armpits']) zonen[n] = { an: n === 'breast', bedeckt: false };
    const alsDataUrl = (blob) => new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(blob); });
    const sende = async (dataUrl, stil) => JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'pruefe', id: 'ff-s-' + Math.random(), quelle: { art: 'daten', dataUrl },
      breite: 0, hoehe: 0, einstellungen: { schwelle: 0.1, zonen, rand: 0.15, stil }, rendern: true })));
    const antwort = await fetch(basis + '/testbild/sfw/' + encodeURIComponent(name));
    if (!antwort.ok) return { keinBild: true };
    const bmp = await createImageBitmap(await antwort.blob());
    const pixel = async (bild, x, y) => { const b = await createImageBitmap(await (await fetch(bild)).blob()); const c = new OffscreenCanvas(b.width, b.height); const g = c.getContext('2d'); g.drawImage(b, 0, 0); return Array.from(g.getImageData(x, y, 1, 1).data); };
    // zwei Gesichter
    const w = 700, h = Math.round(bmp.height * 700 / bmp.width);
    const zwei = new OffscreenCanvas(w * 2, h); const gz = zwei.getContext('2d');
    gz.fillStyle = 'rgb(128,128,128)'; gz.fillRect(0, 0, w * 2, h);
    gz.drawImage(bmp, 0, 0, w, h); gz.drawImage(bmp, w + 60, h - Math.round(h * 0.7), Math.round(w * 0.7), Math.round(h * 0.7));
    const a2 = await sende(await alsDataUrl(await zwei.convertToBlob({ type: 'image/jpeg', quality: 0.92 })), 'augenbalken');
    // bewegtes SVG
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="rgb(40,160,60)"><animate attributeName="x" from="0" to="20" dur="1s" repeatCount="indefinite"/></rect></svg>';
    const a3 = await sende('data:image/svg+xml;base64,' + btoa(svg), 'augenbalken');
    // PNG mit Alpha und deckendes PNG
    const pc = new OffscreenCanvas(bmp.width, bmp.height); const gp = pc.getContext('2d'); gp.drawImage(bmp, 0, 0); 
    const deckend = await alsDataUrl(await pc.convertToBlob({ type: 'image/png' }));
    gp.clearRect(0, 0, 60, 60);
    const mitAlpha = await alsDataUrl(await pc.convertToBlob({ type: 'image/png' }));
    const a4 = await sende(mitAlpha, 'augenbalken');
    const a5 = await sende(deckend, 'augenbalken');
    const a6 = await sende(mitAlpha, 'mosaik');
    return {
      zwei: { ok: a2.ok, zonen: a2.flaechen.map((f) => f.zone), mitten: a2.flaechen.map((f) => f.box[0] + f.box[2] / 2), w },
      svg: { ok: a3.ok, flaechen: a3.flaechen.length, voll: a3.flaechen[0] && a3.flaechen[0].box[0] === 0 && a3.flaechen[0].box[2] === a3.breite, rand: a3.bild ? await pixel(a3.bild, 1, Math.floor(a3.hoehe / 2)) : null, mitte: a3.bild ? await pixel(a3.bild, Math.floor(a3.breite / 2), Math.floor(a3.hoehe / 2)) : null },
      png: { ok: a4.ok, flaechen: a4.flaechen.length, typ: String(a4.bild).slice(0, 14), ecke: a4.bild ? (await pixel(a4.bild, 1, 1))[3] : null, innen: a4.bild ? (await pixel(a4.bild, 100, 100))[3] : null, deckendTyp: String(a5.bild).slice(0, 15), mosaikTyp: String(a6.bild).slice(0, 15) },
    };`,
    basis,
    TESTBILD,
  );
  if (!sonder.keinBild) {
    pruefe(sonder.zwei.ok && sonder.zwei.zonen.length >= 2 && sonder.zwei.zonen.every((z) => z === 'eyes'), `Zwei Gesichter: mindestens zwei Augenbalken (${sonder.zwei.zonen})`);
    pruefe(sonder.zwei.mitten.some((m) => m < sonder.zwei.w) && sonder.zwei.mitten.some((m) => m > sonder.zwei.w), 'Zwei Gesichter: je einer im linken und rechten Teil');
    console.log(`firefox: bewegtes SVG in Eye bar: Rand ${sonder.svg.rand}, Mitte ${sonder.svg.mitte}`);
    pruefe(sonder.svg.ok && sonder.svg.flaechen === 1 && sonder.svg.voll, 'bewegtes SVG: ein ganzes Bild als Flaeche');
    pruefe(abstand(sonder.svg.rand, ROSA) < 90 && Math.max(...sonder.svg.mitte.slice(0, 3)) > 80, 'bewegtes SVG: Mosaik mit pinkem Rahmen, kein schwarzer Balken');
    console.log(`firefox: PNG mit Alpha in Eye bar: ${JSON.stringify(sonder.png)}`);
    pruefe(sonder.png.ok && sonder.png.flaechen >= 1 && sonder.png.typ === 'data:image/png' && sonder.png.ecke === 0 && sonder.png.innen === 255, 'PNG mit Alpha bleibt PNG mit Alpha');
    pruefe(sonder.png.deckendTyp === 'data:image/jpeg' && sonder.png.mosaikTyp === 'data:image/jpeg', 'deckendes PNG und Mosaik bleiben JPEG');
  } else if (!OHNE_TESTBILDER) pruefe(false, 'Sonderfaelle brauchen das Testbild');

  // 3c. Auf einer Seite: Bild mit Balken, Canvas ganz verdeckt, Video mit Balken auf den Augen (Zonen-Leinwand), Pause gibt alles frei
  const optionenTab = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(`${basis}/augenbalken.html`);
  const hook = (einst) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen: einst }));
  await hook({ preset: 'augenbalken', pause: false });
  await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 20_000);
  const urteil = (id) => driver.executeScript('return document.getElementById(arguments[0]).dataset.veil ?? ""', id);
  try {
    await bis('Bild zensiert', async () => (await urteil('bild')) === 'zensiert', 40_000);
    await bis('Leinwand beurteilt', async () => (await urteil('leinwand')) !== '', 40_000);
    await bis('Video beurteilt', async () => (await urteil('film')) !== '', 40_000);
    const seite = await driver.executeScript(`
      const i = document.getElementById('bild'); return [i.src.slice(0, 23), getComputedStyle(document.getElementById('leinwand')).filter, getComputedStyle(document.getElementById('film')).filter];`);
    console.log(`firefox: Eye bar auf der Seite: Bild ${await urteil('bild')} (${seite[0]}), Leinwand ${await urteil('leinwand')}, Video ${await urteil('film')}`);
    pruefe(seite[0] === 'data:image/jpeg;base64,', 'Seite: Bild traegt das Ergebnis mit Balken');
    pruefe((await urteil('leinwand')) === 'verdeckt', 'Seite: Canvas mit Gesicht ganz verdeckt');
    pruefe(seite[1].includes('blur'), 'Seite: verdeckt heisst unscharf');
    await bis('Video zensiert', async () => (await urteil('film')) === 'zensiert', 40_000);
    const arten = await bis('Balken im Video', async () => {
      const roh = await driver.executeScript("return document.getElementById('film').getAttribute('data-veil-video-boxen')");
      const a = roh ? JSON.parse(roh).arten : [];
      return a.includes('balken') ? a : null;
    }, 40_000);
    pruefe(arten.every((a) => a === 'balken'), `Seite: im Video nur Balken (${arten})`);
    await hook({ pause: true });
    await bis('Pause gilt', async () => (await driver.executeScript('return document.documentElement.dataset.veilSeite ?? null')) === 'aus', 8000);
    const frei = await driver.executeScript(`return [document.getElementById('bild').src.startsWith('data:'), document.querySelectorAll('[data-veil]').length, ['bild','leinwand','film'].every((id) => getComputedStyle(document.getElementById(id)).filter === 'none')];`);
    pruefe(frei[0] === false && frei[1] === 0 && frei[2] === true, `Pause im Stil Eye bar: alles frei (${JSON.stringify(frei)})`);
  } finally {
    await hook({ pause: false, preset: 'mosaik' });
    await driver.close();
    await driver.switchTo().window(optionenTab);
  }

} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
}
console.log(`firefox: augenbalken.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
