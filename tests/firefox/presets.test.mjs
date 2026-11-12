// Firefox: Zensur-Presets (ZENSUR-PRESETS-BAUPLAN) ueber geckodriver/WebDriver. Oberflaeche (Karten, Chips, Popup-Zeile, Migration aus dem alten `stil`)
// und Pixelmessung je Preset-Gruppe: Mias Gesicht (Patch mit Gesicht aus einem Testbild im Dummy-Pack), Koerper schwarz mit Wort, Mosaik mit Wort,
// Blur, Zensurbalken, ganze Person, Face aus. Testbilder aus ../05 Testbilder (nie im Repo): fehlen sie, ist der Test rot, ausser mit
// VEIL_OHNE_TESTBILDER=1. Gegenstueck: tests/chromium/presets.spec.ts.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 330 s ueberschritten');
  process.exit(1);
}, 330_000).unref();

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
const PATCH_BILD = 'sfw-003-portraet.jpg';
const KOERPER_BILD = '_DSC6278.JPG';
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


let ordner;

// Fuehrt im Seitenkontext einen Erkenner-Lauf mit Messung aus. `o`: { satz, name, preset, an, klein, vergleich, themen }. `klein`: Bild auf hoechstens 1280 px.
// Liefert die Flaechen und je Flaeche Kennzahlen (Anteil dunkel, Wortpixel, Rahmenpixel, mittlere Abweichung zum Original im Kern) sowie die mittlere
// Abweichung ausserhalb aller Flaechen. `vergleich`: zweites Preset auf demselben Bild; dann die Abweichung beider Ergebnisse in Mitte und Ecke der groessten Flaeche.
function messung(o) {
  return imSeitenkontext(
    `
    const o = args[0];
    const BED = ['breast','genitals','buttocks','belly','feet','armpits'];
    const zonen = {};
    for (const n of ['eyes','mouth','face','head']) zonen[n] = { an: o.an.includes(n) };
    for (const n of BED) zonen[n] = { an: o.an.includes(n), bedeckt: true };
    const alsDataUrl = (blob) => new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(blob); });
    const antwort = await fetch(o.basis + '/testbild/' + o.satz + '/' + encodeURIComponent(o.name));
    if (!antwort.ok) return { keinBild: true, grund: 'HTTP ' + antwort.status };
    const gross = await createImageBitmap(await antwort.blob());
    const f = o.klein ? Math.min(1, 1280 / Math.max(gross.width, gross.height)) : 1;
    const c = new OffscreenCanvas(Math.round(gross.width * f), Math.round(gross.height * f));
    c.getContext('2d').drawImage(gross, 0, 0, c.width, c.height);
    const dataUrl = await alsDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
    const orig = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const sende = async (preset) => JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'pruefe', id: 'ff-m-' + Math.random(), quelle: { art: 'daten', dataUrl },
      breite: o.anzeige ? Math.round(c.width * o.anzeige) : 0, hoehe: o.anzeige ? Math.round(c.height * o.anzeige) : 0, einstellungen: { schwelle: 0.1, zonen, rand: 0.15, preset, ...(o.themen !== undefined ? { woerterThemen: o.themen } : {}), ...(o.ganz ? { ganzVerdecken: true } : {}) }, rendern: true })));
    const lade = async (a) => {
      const b = await createImageBitmap(await (await fetch(a.bild)).blob());
      const k = new OffscreenCanvas(b.width, b.height); const x = k.getContext('2d'); x.drawImage(b, 0, 0);
      return { b: b.width, h: b.height, d: x.getImageData(0, 0, b.width, b.height).data };
    };
    const stat = (aus, ref, box, inset) => {
      let n = 0, dunkel = 0, wort = 0, rahmen = 0, summe = 0, minX = Infinity, maxX = -Infinity;
      for (let y = box[1] + inset; y < box[1] + box[3] - inset; y++) for (let x = box[0] + inset; x < box[0] + box[2] - inset; x++) {
        const i = (y * aus.b + x) * 4; n++;
        if (aus.d[i] < 60 && aus.d[i+1] < 60 && aus.d[i+2] < 60) dunkel++;
        if (Math.hypot(aus.d[i]-255, aus.d[i+1]-179, aus.d[i+2]-211) < 45) { wort++; if (y >= box[1] + box[3] * 0.35 && y <= box[1] + box[3] * 0.65) { if (x < minX) minX = x; if (x > maxX) maxX = x; } }
        if (Math.hypot(aus.d[i]-255, aus.d[i+1]-79, aus.d[i+2]-163) < 60) rahmen++;
        summe += (Math.abs(aus.d[i]-ref[i]) + Math.abs(aus.d[i+1]-ref[i+1]) + Math.abs(aus.d[i+2]-ref[i+2])) / 3;
      }
      return { dunkel: dunkel / Math.max(1, n), wort, wortSpanne: maxX > minX ? (maxX - minX) / box[2] : 0, rahmen, mittel: summe / Math.max(1, n) };
    };
    // Sticker-Zensur: Flaeche ganz gedeckt (Pastell, Rahmen, Stickerton oder Mischung davon), Stickerpixel, Farbe der Mitte
    const PASTELL = [[255,211,230],[226,215,255],[255,220,199]], STICKER = [[20,200,90],[30,70,235],[0,210,210]], RAHMEN = [255,79,163];
    const dist = (p, q) => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
    const strecke = (p, a, b) => { const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]]; const l2 = d[0]*d[0]+d[1]*d[1]+d[2]*d[2]; const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1]+(p[2]-a[2])*d[2]) / l2)); return dist(p, [a[0]+t*d[0], a[1]+t*d[1], a[2]+t*d[2]]); };
    const gedeckt = (p) => { if (PASTELL.some((q) => dist(p, q) < 16)) return true; if (dist(p, RAHMEN) < 60) return true; if (STICKER.some((q) => dist(p, q) < 45)) return true; for (const q of PASTELL) for (const s2 of STICKER.concat([RAHMEN])) if (strecke(p, q, s2) < 30) return true; return false; };
    const px = (bild, x, y) => { const i = (y * bild.b + x) * 4; return [bild.d[i], bild.d[i+1], bild.d[i+2]]; };
    const deckStat = (bild, box) => {
      let n = 0, ok = 0, sp = 0;
      for (let y = box[1] + 3; y < box[1] + box[3] - 3; y++) for (let x = box[0] + 3; x < box[0] + box[2] - 3; x++) { n++; if (gedeckt(px(bild, x, y))) ok++; }
      for (let y = box[1]; y < box[1] + box[3]; y++) for (let x = box[0]; x < box[0] + box[2]; x++) if (STICKER.some((q) => dist(px(bild, x, y), q) < 45)) sp++;
      const cx = Math.round(box[0] + box[2] / 2), cy = Math.round(box[1] + box[3] / 2); const m = [0, 0, 0];
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { const p = px(bild, x, y); m[0] += p[0] / 25; m[1] += p[1] / 25; m[2] += p[2] / 25; }
      return { deck: n ? ok / n : 1, sp, mitteSticker: STICKER.some((q) => dist(m, q) < 60) };
    };
    const a = await sende(o.preset);
    if (!a.ok) return { fehler: a.fehler };
    const aus = { ok: true, flaechen: a.flaechen, hatBild: typeof a.bild === 'string', breite: a.breite, hoehe: a.hoehe };
    if (!a.bild) return aus;
    if (o.hash) { let h = 0; for (let i = 0; i < a.bild.length; i++) h = (Math.imul(h, 31) + a.bild.charCodeAt(i)) >>> 0; aus.bildHash = h + ':' + a.bild.length; return aus; }
    const bild = await lade(a);
    const boxen = a.flaechen.map((x) => x.box);
    aus.stats = a.flaechen.map((x) => ({ kern: stat(bild, orig, x.box, Math.round(Math.min(x.box[2], x.box[3]) * 0.15)), ganz: stat(bild, orig, x.box, 0), ...(o.sticker ? { sticker: deckStat(bild, x.box) } : {}) }));
    let n = 0, summe = 0;
    for (let y = 0; y < bild.h; y++) for (let x = 0; x < bild.b; x++) {
      if (boxen.some((b) => x >= b[0] - 8 && x < b[0] + b[2] + 8 && y >= b[1] - 8 && y < b[1] + b[3] + 8)) continue;
      const i = (y * bild.b + x) * 4; n++;
      summe += (Math.abs(bild.d[i]-orig[i]) + Math.abs(bild.d[i+1]-orig[i+1]) + Math.abs(bild.d[i+2]-orig[i+2])) / 3;
    }
    aus.aussen = n ? summe / n : 0;
    if (o.vergleich) {
      const b2 = await sende(o.vergleich);
      const bild2 = await lade(b2);
      const gr = [...a.flaechen].sort((p, q) => q.box[2] * q.box[3] - p.box[2] * p.box[3])[0].box;
      const diff = (box) => stat(bild, bild2.d, box, 0).mittel;
      aus.vergleich = { mitte: diff([gr[0] + Math.round(gr[2] * 0.15), gr[1] + Math.round(gr[3] * 0.4), Math.round(gr[2] * 0.7), Math.round(gr[3] * 0.2)]), ecke: diff([gr[0] + 12, gr[1] + 12, Math.round(gr[2] * 0.25), Math.round(gr[3] * 0.2)]), rahmenRef: stat(bild2, orig, gr, 0).rahmen };
    }
    return aus;`,
    o,
  );
}
const gross = (stats) => stats;

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-presets-'));
  server = await starteFixtureServer(port);
  // Dummy-Pack: sechs synthetische Patches plus ein Testbild mit Gesicht (Mias Gesicht braucht ein Gesicht im Patch)
  const patchRoh = await fetch(`${basis}/testbild/sfw/${encodeURIComponent(PATCH_BILD)}`);
  let packPfad = null;
  if (patchRoh.ok) {
    const patch = await sharp(Buffer.from(await patchRoh.arrayBuffer())).resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer();
    const bau = await baueDummyPack({ extraPatches: [{ name: 'patch/mit-gesicht.jpg', typ: 'image/jpeg', daten: new Uint8Array(patch) }] });
    packPfad = path.join(ordner, 'dummy-gesicht.miapack');
    await writeFile(packPfad, bau.bytes);
  } else if (OHNE_TESTBILDER) console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Pack mit Gesichts-Patch uebersprungen');
  else pruefe(false, `Testbild ${PATCH_BILD} fehlt (HTTP ${patchRoh.status})`);
  // Packs fuer die Sticker-Faelle: Sticker nicht dekodierbar (Hide-first) und ohne Sticker (wie ein Pack vor 1.0)
  const kaputtPfad = path.join(ordner, 'dummy-sticker-kaputt.miapack');
  await writeFile(kaputtPfad, (await baueDummyPack({ stickerKaputt: true })).bytes);
  const teilweisePfad = path.join(ordner, 'dummy-sticker-teilweise.miapack');
  await writeFile(teilweisePfad, (await baueDummyPack({ stickerTeilweise: true })).bytes);
  const ohneStickerPfad = path.join(ordner, 'dummy-ohne-sticker.miapack');
  await writeFile(ohneStickerPfad, (await baueDummyPack({ ohneSticker: true })).bytes);
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

  // 1. Oberflaeche ohne Pack
  const karten = await driver.findElements(By.css('#preset-karten input[name="preset"]'));
  pruefe(karten.length === 13, `dreizehn Preset-Karten (${karten.length})`);
  pruefe((await driver.findElements(By.css('#preset-karten .preset-gruppe'))).length === 4, 'vier Gruppen');
  const gruppenTitel = [];
  for (const t of await driver.findElements(By.css('#preset-karten .preset-gruppe-titel'))) gruppenTitel.push(await t.getText());
  pruefe(JSON.stringify(gruppenTitel.map((t) => t.toLowerCase())) === JSON.stringify(['with my face', 'with my stickers', 'classic', 'whole person']), `Gruppen in der Reihenfolge mia, sticker, klassisch, person (${gruppenTitel})`); // die Ueberschriften stehen in Grossbuchstaben (CSS)
  pruefe((await driver.findElements(By.css('#preset-karten .preset-bild svg'))).length === 13, 'dreizehn Vorschau-Figuren');
  const gesperrt = [];
  for (const id of ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'sticker']) gesperrt.push(await driver.findElement(By.css(`#preset-${id}`)).getAttribute('disabled'));
  pruefe(gesperrt.every((g) => g === 'true'), 'ohne Pack sind die sechs Presets mit meinem Gesicht oder meinen Stickern gesperrt');
  pruefe((await driver.findElement(By.css('#preset-mosaik')).isSelected()), 'Standard ohne Pack: Mosaik');
  pruefe((await text('#preset-pack-hinweis')).includes('Mia Pack'), 'Hinweis nennt das Mia Pack');
  pruefe(!(await sichtbar('#wort-themen')), 'ohne Pack keine Chips');
  await driver.findElement(By.css('label:has(#preset-zensurbalken)')).click();
  await bis('zensurbalken gespeichert', async () => (await speicher('einstellungen'))?.preset === 'zensurbalken');
  await bis('Zonen-Hinweis', () => sichtbar('#zonen-hinweis'));
  pruefe((await text('#zonen-hinweis')).includes('Censor bars'), 'Hinweis bei What I cover (Zensurbalken)');
  // Migration: alter `stil`
  for (const [alt, neu] of [['blur', 'blur'], ['augenbalken', 'augenbalken'], ['mia-patch', 'mosaik']]) {
    await imSeitenkontext(`await api.storage.local.set({ einstellungen: { version: 1, stil: args[0] } });`, alt);
    await driver.navigate().refresh();
    await bis(`Migration ${alt}`, async () => (await driver.findElement(By.css(`#preset-${neu}`)).isSelected()));
  }
  pruefe(true, 'Migration: blur, augenbalken, mia-patch (ohne Pack Mosaik) angezeigt');
  await driver.findElement(By.css('label:has(#preset-blur)')).click();
  await bis('preset geschrieben', async () => (await speicher('einstellungen'))?.preset === 'blur');
  pruefe(!('stil' in (await speicher('einstellungen'))), 'Speichern raeumt `stil` auf');
  await driver.findElement(By.css('label:has(#preset-mosaik)')).click();
  await bis('zurueck auf mosaik', async () => (await speicher('einstellungen'))?.preset === 'mosaik');

  // 2. Pack mit Gesichts-Patch importieren
  if (!packPfad) throw new Error('kein Pack gebaut');
  // 2a. Altbestand: ein gespeichertes Mia-Preset (alter stil mia-patch) mit Face aus bleibt beim Import aus, die Meldung sagt es
  await driver.findElement(By.css('#datei')).sendKeys(packPfad);
  await bis('Lizenz', () => sichtbar('#lizenz-block'));
  await imSeitenkontext(`await api.storage.local.set({ einstellungen: { version: 1, stil: 'mia-patch' } });`);
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack da (Altbestand)', async () => (await text('#pack-titel')).includes('Dummy pack'));
  pruefe((await text('#meldung')).includes('Face is off under What I cover') && !(await text('#meldung')).includes('Face is on under'), 'Altbestand: Meldung sagt, dass Face aus ist');
  pruefe((await speicher('einstellungen'))?.zonen?.face?.an === false && (await speicher('einstellungen'))?.preset === 'mia-wort', 'Altbestand: Face bleibt aus, Preset mia-wort');
  await bis('Hinweis Face aus', async () => (await text('#preset-face-hinweis')).includes('Switch Face on'));
  await driver.findElement(By.css('#entfernen')).click();
  await bis('Rueckfrage a', () => sichtbar('#entfernen-frage'));
  await driver.findElement(By.css('#entfernen-ja')).click();
  await bis('Pack entfernt (Altbestand)', async () => (await text('#pack-status')).includes('No pack yet'));
  await imSeitenkontext(`await api.storage.local.set({ einstellungen: { version: 1, preset: 'mosaik' } });`);
  await driver.navigate().refresh();
  await bis('Seite bereit', () => sichtbar('#preset-karten'));
  await driver.findElement(By.css('#datei')).sendKeys(packPfad);
  await bis('Lizenz', () => sichtbar('#lizenz-block'));
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack da', async () => (await text('#pack-titel')).includes('Dummy pack'));
  pruefe((await speicher('einstellungen'))?.preset === 'mia-wort', 'erstes Pack: Preset mia-wort');
  // Teil A: das erste Pack hat Face eingeschaltet; Abschalten wird respektiert, Wechsel auf ein Mia-Preset schaltet wieder ein
  pruefe((await speicher('einstellungen'))?.zonen?.face?.an === true, 'erstes Pack: Face ist an');
  pruefe((await text('#meldung')).includes('Face is on under What I cover'), 'Import-Meldung nennt Face');
  await driver.findElement(By.css('#zonen label.schalter:has(input[data-zone="face"])')).click();
  await bis('Face aus', async () => (await speicher('einstellungen'))?.zonen?.face?.an === false);
  await driver.navigate().refresh();
  await bis('Face bleibt aus', async () => !(await driver.findElement(By.css('#zonen input[data-zone="face"]')).isSelected()));
  await driver.findElement(By.css('label:has(#preset-mia-blur)')).click();
  await bis('mia-blur', async () => (await speicher('einstellungen'))?.preset === 'mia-blur');
  pruefe((await speicher('einstellungen'))?.zonen?.face?.an === false && (await sichtbar('#preset-face-hinweis')) && !(await text('#preset-face-hinweis')).includes('I switched'), 'Mia zu Mia: Face bleibt aus, der Hinweis sagt, was dann gilt (nicht "eingeschaltet")');
  await driver.findElement(By.css('label:has(#preset-mosaik)')).click();
  await bis('mosaik', async () => (await speicher('einstellungen'))?.preset === 'mosaik');
  pruefe((await speicher('einstellungen'))?.zonen?.face?.an === false, 'Klassisches Preset schaltet nichts');
  await driver.findElement(By.css('label:has(#preset-mia-mosaik)')).click();
  await bis('Face an', async () => (await speicher('einstellungen'))?.zonen?.face?.an === true);
  await bis('Hinweis', () => sichtbar('#preset-face-hinweis'));
  pruefe((await text('#preset-face-hinweis')).includes('I switched Face on'), 'Wechsel auf Mia-Preset schaltet Face ein, mit Hinweis');
  // Radiogruppe: eine fuer alle Karten, vier benannte Gruppen darin
  pruefe((await driver.findElement(By.css('#preset-karten')).getAttribute('role')) === 'radiogroup' && (await driver.findElement(By.css('#preset-karten')).getAttribute('aria-labelledby')) === 'stil-titel', 'Karten: eine Radiogruppe mit Ueberschrift');
  pruefe((await driver.findElements(By.css('#preset-karten [role="group"]'))).length === 4 && (await driver.findElements(By.css('#preset-karten [role="radiogroup"]'))).length === 0, 'Karten: vier benannte Gruppen');
  // unbekannte Wort-Themen (anderes Pack): alle Chips aus, Hinweis MIA
  await imSeitenkontext(`const a = (await api.storage.local.get('einstellungen')).einstellungen; await api.storage.local.set({ einstellungen: { ...a, woerterThemen: ['gibt-es-nicht'] } });`);
  await driver.findElement(By.css('label:has(#preset-mia-wort)')).click();
  await bis('Hinweis MIA', async () => (await text('#wort-hinweis')).includes('MIA'));
  await imSeitenkontext(`const a = (await api.storage.local.get('einstellungen')).einstellungen; await api.storage.local.set({ einstellungen: { ...a, woerterThemen: null } });`);
  await bis('Chips', async () => (await driver.findElements(By.css('#wort-chips input[data-thema]'))).length === 2);
  pruefe((await driver.findElement(By.css('#wort-chips input[data-thema="alpha"]')).isSelected()) && (await driver.findElement(By.css('#wort-chips input[data-thema="beta"]')).isSelected()), 'Chips: alle Themen an');
  await driver.findElement(By.css('#wort-chips label:has(input[data-thema="beta"])')).click();
  await bis('nur alpha', async () => JSON.stringify((await speicher('einstellungen'))?.woerterThemen) === '["alpha"]');
  await driver.findElement(By.css('#wort-chips label:has(input[data-thema="alpha"])')).click();
  await bis('keins', async () => JSON.stringify((await speicher('einstellungen'))?.woerterThemen) === '[]');
  pruefe((await text('#wort-hinweis')).includes('MIA'), 'ohne Thema steht MIA');
  await driver.findElement(By.css('#wort-chips label:has(input[data-thema="alpha"])')).click();
  await driver.findElement(By.css('#wort-chips label:has(input[data-thema="beta"])')).click();
  await bis('alle', async () => (await speicher('einstellungen'))?.woerterThemen === null);
  await driver.findElement(By.css('label:has(#preset-mia-blur)')).click();
  await bis('Chips weg', async () => !(await sichtbar('#wort-themen')));
  pruefe(true, 'Presets ohne Wort verstecken die Chips');
  await driver.findElement(By.css('label:has(#preset-mia-wort)')).click();
  const scan = await imSeitenkontext(`return JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'gesichtsscan' })));`);
  console.log(`firefox: Gesichtsscan Dummy-Pack mit einem Testbild-Patch: ${JSON.stringify(scan)}`);
  pruefe(scan.gesamt === 7 && scan.mit === 1 && scan.fertig === true, `Gesichtsscan: 7 Patches, einer mit Gesicht, fertig (${JSON.stringify(scan)})`);

  // 3. Mias Gesicht
  const mg = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'mia-mosaik', an: ['face'] });
  if (mg.keinBild) {
    if (OHNE_TESTBILDER) console.log(`firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Pixeltests uebersprungen (${mg.grund})`);
    else pruefe(false, `Pixeltests brauchen das Testbild: ${mg.grund}`);
  } else {
    const fl = mg.flaechen.find((x) => x.zone === 'face' && x.behandlung === 'mia-gesicht');
    pruefe(!!fl && mg.flaechen.length === 1, `Mias Gesicht: genau eine Gesichtsflaeche (${JSON.stringify(mg.flaechen)})`);
    const st = mg.stats[mg.flaechen.indexOf(fl)];
    console.log(`firefox: Mias Gesicht ${fl.box}: Kern Abweichung ${st.kern.mittel.toFixed(1)}, Rahmenpixel ${st.ganz.rahmen}, aussen ${mg.aussen.toFixed(2)}`);
    pruefe(st.kern.mittel > 20, `Mias Gesicht: das Gesicht ist getauscht (${st.kern.mittel})`);
    pruefe(st.ganz.rahmen > Math.round(Math.min(fl.box[2], fl.box[3]) * 0.9), `Mias Gesicht: pinker Rahmen (${st.ganz.rahmen})`);
    pruefe(mg.aussen < 4, `Mias Gesicht: ausserhalb unveraendert (${mg.aussen})`);
    const aus = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'mia-wort', an: ['feet'] });
    pruefe(!aus.flaechen.some((x) => x.zone === 'face' || x.zone === 'eyes' || x.zone === 'mouth'), 'Face aus: keine Gesichtsflaeche, das Gesicht bleibt');
    const augen = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'mia-wort', an: ['eyes'] });
    pruefe(augen.flaechen.length === 1 && augen.flaechen[0].zone === 'eyes' && augen.flaechen[0].behandlung === 'schwarz-wort', 'Face aus, Eyes an: Augen bekommen die Koerper-Behandlung');
    // Zensurbalken: Augen immer
    const zb = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'zensurbalken', an: [] });
    pruefe(zb.flaechen.length === 1 && zb.flaechen[0].zone === 'eyes' && zb.flaechen[0].behandlung === 'balken', 'Zensurbalken: Augenbalken auch ohne Schalter');
    const kz = zb.stats[0].kern;
    pruefe(kz.dunkel > 0.95, `Zensurbalken: Kern schwarz (${kz.dunkel})`);
    const zg = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'zensurbalken', an: ['face'] });
    const zgf = zg.flaechen.find((x) => x.zone === 'face');
    pruefe(!!zgf && zgf.behandlung === 'schwarz' && zg.stats[zg.flaechen.indexOf(zgf)].kern.dunkel > 0.95, 'Zensurbalken mit Face an: Gesicht schwarz');
  }

  // 4. Koerper-Behandlungen
  const bw = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mia-wort', an: ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'] });
  if (!bw.keinBild) {
    const gi = bw.flaechen.map((x, i) => [x.box[2] * x.box[3], i]).sort((p, q) => q[0] - p[0])[0][1];
    const k = bw.stats[gi].kern;
    console.log(`firefox: mia-wort Koerper ${bw.flaechen[gi].box}: dunkel ${(k.dunkel * 100).toFixed(0)} %, Wortpixel ${k.wort}`);
    pruefe(bw.flaechen[gi].behandlung === 'schwarz-wort' && k.dunkel > 0.7 && k.wort > 40, 'Koerper: Schwarz mit pinkem Wort');
    pruefe(k.wortSpanne >= 0.3, `Wort steht in der Mitte und ist mindestens 30 % breit (${k.wortSpanne})`);
    pruefe(bw.stats[gi].ganz.rahmen === 0, 'Schwarz mit Wort: kein pinker Rahmen');
    pruefe(bw.aussen < 4, `Koerper: ausserhalb unveraendert (${bw.aussen})`);
    const keins = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mia-wort', an: ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'], themen: [] });
    pruefe(keins.stats[gi].kern.wort > 40, 'Ohne Thema: das Wort MIA steht da');
    const mw = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mosaik-wort', vergleich: 'mosaik', an: ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'] });
    console.log(`firefox: mosaik-wort gegen Mosaik: Mitte ${mw.vergleich.mitte.toFixed(1)}, Ecke ${mw.vergleich.ecke.toFixed(1)}, Rahmenpixel des Mosaiks ${mw.vergleich.rahmenRef}`);
    pruefe(mw.vergleich.mitte > 25 && mw.vergleich.ecke < 3, 'Mosaik mit Wort: Wort auf dunkler Unterlage, Ecken wie Mosaik');
    pruefe(mw.vergleich.rahmenRef > 100, 'Mosaik: pinker Rahmen');
    // Pack-Wechsel mit Themenliste, deren Kennungen im neuen Pack fehlen: dieselben Pixel wie ohne Thema (MIA), nicht ein Wort aus dem Pack
    const ganz = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
    const hAlle = (await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mosaik-wort', an: ganz, hash: true })).bildHash;
    const hKeins = (await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mosaik-wort', an: ganz, themen: [], hash: true })).bildHash;
    const hUnbekannt = (await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mosaik-wort', an: ganz, themen: ['altes-thema', 'noch-eins'], hash: true })).bildHash;
    pruefe(hUnbekannt === hKeins && hAlle !== hKeins, `Unbekannte Wort-Themen: MIA wie ohne Thema (${hUnbekannt === hKeins}), mit Themen des Packs anders (${hAlle !== hKeins})`);
    const bl = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'blur', an: ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'] });
    pruefe(bl.stats.every((s) => s.ganz.rahmen < 10) && bl.stats[0].kern.mittel > 3, 'Blur: kein Rahmen, Flaeche veraendert');
    const zb = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'zensurbalken', an: ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'] });
    pruefe(zb.stats[gi].kern.dunkel > 0.95 && zb.aussen < 4, 'Zensurbalken: Koerper schwarz');
    // Ganze Person: Huelle deckt jede einzelne Zonenbox
    const einzel = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mosaik', an: ['feet'] });
    const pm = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'person-mosaik', an: ['feet'] });
    const deckt = einzel.flaechen.every((e) => pm.flaechen.some((f) => f.box[0] <= e.box[0] + 1 && f.box[1] <= e.box[1] + 1 && f.box[0] + f.box[2] >= e.box[0] + e.box[2] - 1 && f.box[1] + f.box[3] >= e.box[1] + e.box[3] - 1));
    pruefe(pm.flaechen.length >= 1 && pm.flaechen.every((f) => f.behandlung === 'mosaik') && deckt, 'Ganze Person (Mosaik): die Huelle deckt jede Zonenbox');
    pruefe(pm.stats[0].kern.mittel > 3 && pm.aussen < 4, `Ganze Person: Huelle veraendert, ausserhalb unveraendert (${pm.aussen})`);
    const pb = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'person-blur', an: ['feet'] });
    pruefe(pb.flaechen.length >= 1 && pb.flaechen.every((f) => f.behandlung === 'blur'), 'Ganze Person (Blur)');
    // Stufe 4 (ganz verdecken) mit einem Mia-Preset: das ganze Bild schwarz mit Wort
    const s4 = await messung({ basis, satz: 'nsfw', name: 'IMG_0260.jpg', klein: true, preset: 'mia-wort', an: ['feet', 'face'], ganz: true });
    if (!s4.keinBild) {
      pruefe(s4.flaechen.length === 1 && s4.flaechen[0].box[0] === 0 && s4.flaechen[0].box[2] === s4.breite && s4.flaechen[0].behandlung === 'schwarz-wort', 'Stufe 4 mit Mia-Preset: eine Flaeche ueber das ganze Bild, Schwarz mit Wort');
      pruefe(s4.stats[0].kern.dunkel > 0.95 && s4.stats[0].kern.wort > 100 && s4.stats[0].ganz.rahmen === 0, `Stufe 4: ganz schwarz mit Wort, ohne Rahmen (${s4.stats[0].kern.dunkel})`);
    } else if (!OHNE_TESTBILDER) pruefe(false, `Stufe-4-Test braucht das Testbild: ${s4.grund}`);
  } else if (!OHNE_TESTBILDER) pruefe(false, `Koerper-Tests brauchen das Testbild: ${bw.grund}`);


  // 4b. Sticker-Zensur (STICKER-BAUPLAN Stufe A): Pastell-Flaeche ganz gedeckt, Sticker in der Mitte, kleine Flaeche nur Pastell, Hide-first, Pack ohne Sticker
  const BED = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
  const stickerPruefung = (m, name, { ohneSticker = false } = {}) => {
    if (!m.ok) return pruefe(false, `${name}: ${m.fehler}`);
    pruefe(m.flaechen.length >= 1, `${name}: mindestens eine Flaeche`);
    m.flaechen.forEach((fl, i) => {
      if (fl.behandlung !== 'sticker') return;
      const st = m.stats[i].sticker;
      const kurz = Math.min(fl.box[2], fl.box[3]);
      console.log(`firefox: ${name} ${fl.zone} ${fl.box}: Deckung ${(st.deck * 100).toFixed(2)} %, Stickerpixel ${st.sp}`);
      pruefe(st.deck >= 0.99, `${name} ${fl.zone}: Flaeche ganz gedeckt (${st.deck})`);
      if (ohneSticker || kurz < 24) pruefe(st.sp === 0, `${name} ${fl.zone}: kein Sticker (${st.sp})`);
      else if (kurz >= 40) pruefe(st.mitteSticker, `${name} ${fl.zone}: Stickerfarbe in der Mitte`);
    });
    pruefe(m.aussen < 4, `${name}: ausserhalb unveraendert (${m.aussen})`);
  };
  const sk = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'sticker', an: BED, sticker: true });
  if (!sk.keinBild) {
    stickerPruefung(sk, 'sticker Koerper');
    pruefe(sk.flaechen.every((x) => x.behandlung === 'sticker') && sk.stats.some((x) => x.sticker.sp > 200), 'sticker: alle Flaechen sticker, mindestens eine mit Sticker');
    const sk2 = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'sticker', an: BED, hash: true });
    const sk3 = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'sticker', an: BED, hash: true });
    pruefe(sk2.bildHash === sk3.bildHash, 'sticker: stabil je Bild (gleiche Bytes bei gleicher Anfrage)');
    const sg = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'sticker', an: ['face'], sticker: true });
    pruefe(sg.flaechen.some((x) => x.zone === 'face' && x.behandlung === 'sticker'), 'sticker mit Face an: das Gesicht ist eine Flaeche mit sticker');
    stickerPruefung(sg, 'sticker Gesicht');
    const sf = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'sticker', an: ['feet'], sticker: true });
    pruefe(!sf.flaechen.some((x) => x.zone === 'face'), 'sticker mit Face aus: keine Gesichtsflaeche');
    // mia-sticker: Gesicht mit Patch-Gesicht (Mias Gesicht, Ersatz sticker), Koerper sticker
    const ms = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'mia-sticker', an: ['face'], sticker: true });
    const mf = ms.flaechen.find((x) => x.zone === 'face');
    pruefe(!!mf && mf.behandlung === 'mia-gesicht' && mf.ersatz === 'sticker', `mia-sticker: Gesicht mia-gesicht mit Ersatz sticker (${JSON.stringify(mf)})`);
    const msi = ms.flaechen.indexOf(mf);
    pruefe(ms.stats[msi].kern.mittel > 20 && ms.stats[msi].ganz.rahmen > Math.round(Math.min(mf.box[2], mf.box[3]) * 0.5) && ms.stats[msi].sticker.sp === 0, 'mia-sticker: Mias Gesicht getauscht, pinker Rahmen, kein Sticker');
    const mk = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'mia-sticker', an: BED, sticker: true });
    pruefe(mk.flaechen.every((x) => x.behandlung === 'sticker'), 'mia-sticker: Koerper sticker');
    stickerPruefung(mk, 'mia-sticker Koerper');
    // kleine Flaeche (Anzeige 1/20): nur Pastell, kein Sticker, deckt trotzdem
    const kl = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'sticker', an: ['face'], anzeige: 0.05, sticker: true });
    pruefe(kl.stats[0].sticker.deck >= 0.99 && kl.stats[0].sticker.sp === 0, `kleine Flaeche: nur Pastell, ohne Sticker (${kl.stats[0].sticker.deck}, ${kl.stats[0].sticker.sp})`);
  } else if (!OHNE_TESTBILDER) pruefe(false, `Sticker-Tests brauchen das Testbild: ${sk.grund}`);
  // Hilfen: Pack entfernen und ein anderes importieren
  const entfernePack = async () => {
    await driver.findElement(By.css('#entfernen')).click();
    await bis('Rueckfrage s', () => sichtbar('#entfernen-frage'));
    await driver.findElement(By.css('#entfernen-ja')).click();
    await bis('Pack entfernt s', async () => (await text('#pack-status')).includes('No pack yet'));
  };
  const importierePack = async (pfad) => {
    await driver.findElement(By.css('#datei')).sendKeys(pfad);
    await bis('Lizenz s', () => sichtbar('#lizenz-block'));
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Pack da s', async () => (await text('#pack-titel')).includes('Dummy pack'));
  };
  // Sticker nicht dekodierbar: die Flaeche deckt trotzdem (Hide-first)
  await entfernePack();
  await importierePack(kaputtPfad);
  pruefe((await speicher('pack'))?.freischaltungen?.includes('zensur:sticker') === true, 'Pack mit kaputtem Sticker: Freischaltung bleibt');
  if (!sk.keinBild) {
    const kp = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'sticker', an: ['face'], sticker: true });
    pruefe(kp.ok && kp.stats[0].sticker.deck >= 0.99 && kp.stats[0].sticker.sp === 0, `Sticker kaputt: Flaeche deckt, ohne Sticker (${kp.ok && kp.stats[0].sticker.deck}, ${kp.ok && kp.stats[0].sticker.sp})`);
  }
  // Ein kaputter und zwei gute Sticker: nach dem Dekodierfehler kommt der naechste, jede Flaeche traegt einen guten Sticker (die erzwungene Wahl beim kaputten
  // Sticker prueft Chromium, hier laufen mehrere Flaechen und Bilder durch; die Versuchsgrenze prueft der Einheitstest)
  await entfernePack();
  await importierePack(teilweisePfad);
  if (!sk.keinBild) {
    const tw = await messung({ basis, satz: 'nsfw', name: KOERPER_BILD, klein: true, preset: 'sticker', an: BED, sticker: true });
    const tg = await messung({ basis, satz: 'sfw', name: TESTBILD, preset: 'sticker', an: ['face'], sticker: true });
    for (const [m, name] of [[tw, 'Koerper'], [tg, 'Gesicht']]) {
      pruefe(m.ok === true && m.stats.every((st, i) => st.sticker.deck >= 0.99 && (Math.min(m.flaechen[i].box[2], m.flaechen[i].box[3]) < 40 || st.sticker.mitteSticker)), `Pack mit einem kaputten Sticker (${name}): jede Flaeche gedeckt und mit Sticker in der Mitte`);
    }
  }
  // Pack ohne Sticker: Karten gesperrt, Hinweis, ein gespeichertes Sticker-Preset gilt als Mosaik
  await entfernePack();
  await importierePack(ohneStickerPfad);
  pruefe((await driver.findElement(By.css('#preset-sticker')).getAttribute('disabled')) === 'true' && (await driver.findElement(By.css('#preset-mia-sticker')).getAttribute('disabled')) === 'true', 'Pack ohne Sticker: die Sticker-Karten sind gesperrt');
  pruefe((await driver.findElement(By.css('#preset-mia-wort')).getAttribute('disabled')) !== 'true', 'Pack ohne Sticker: die Mia-Karten sind frei');
  pruefe(await sichtbar('#preset-pack-hinweis') && (await text('#preset-pack-hinweis')).includes('no stickers of me yet'), 'Pack ohne Sticker: eigener Hinweis');
  await imSeitenkontext(`const a = (await api.storage.local.get('einstellungen')).einstellungen; await api.storage.local.set({ einstellungen: { ...a, preset: 'sticker' } });`);
  await driver.navigate().refresh();
  await bis('Mosaik gilt', async () => (await driver.findElement(By.css('#preset-mosaik')).isSelected()));
  pruefe(!(await driver.findElement(By.css('#preset-sticker')).isSelected()), 'Pack ohne Sticker: gespeichertes Sticker-Preset gilt als Mosaik');
  // Pack mit Stickern wieder rein, Sticker-Preset waehlen, Pack entfernen: Preset zurueck auf Mosaik
  await entfernePack();
  await importierePack(packPfad);
  await driver.findElement(By.css('label:has(#preset-sticker)')).click();
  await bis('sticker gespeichert', async () => (await speicher('einstellungen'))?.preset === 'sticker');
  pruefe((await text('#stil-hinweis')).includes('A pastel patch over everything I cover'), 'Sticker-Preset: Satz unter der Wahl');
  // Popup-Zeile: Name und Satz des Sticker-Presets, eine Vorschau
  const optionenTab = await driver.getWindowHandle();
  await oeffne('popup.html');
  await bis('Popup-Zeile', async () => (await driver.findElements(By.css('#preset-name'))).length > 0 && (await text('#preset-name')) === 'Stickers');
  pruefe((await text('#pack-hinweis')).includes('A pastel patch over everything I cover') && (await driver.findElements(By.css('#preset-bild svg'))).length === 1, 'Popup: Zeile mit Sticker-Preset, Satz und Vorschau');
  await schliesse();
  await driver.switchTo().window(optionenTab);
  await driver.findElement(By.css('label:has(#preset-mia-sticker)')).click();
  await bis('mia-sticker gespeichert', async () => (await speicher('einstellungen'))?.preset === 'mia-sticker');
  pruefe((await speicher('einstellungen'))?.zonen?.face?.an === true, 'mia-sticker schaltet Face ein');
  await driver.findElement(By.css('label:has(#preset-sticker)')).click();
  await bis('sticker wieder', async () => (await speicher('einstellungen'))?.preset === 'sticker');
  await entfernePack();
  await bis('Preset zurueck auf Mosaik', async () => (await speicher('einstellungen'))?.preset === 'mosaik');
  pruefe((await driver.findElement(By.css('#preset-sticker')).getAttribute('disabled')) === 'true', 'Pack entfernt: Sticker-Karten gesperrt, Preset Mosaik');
  await importierePack(packPfad); // fuer Abschnitt 5 wieder ein Pack

  // 5. Echtes Pack (nur mit VEIL_ECHTES_PACK=<pfad>, der Pfad steht nie in Dateien): wie viele Patch-Bilder liefern ein Gesicht?
  if (process.env.VEIL_ECHTES_PACK) {
    await driver.findElement(By.css('#entfernen')).click();
    await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
    await driver.findElement(By.css('#entfernen-ja')).click();
    await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));
    await driver.findElement(By.css('#datei')).sendKeys(path.resolve(process.env.VEIL_ECHTES_PACK));
    await bis('Meldung', async () => (await text('#meldung')).includes('The pack is in'), 60_000).catch(async () => {
      await bis('Lizenz', () => sichtbar('#lizenz-block'));
      await driver.findElement(By.css('#annehmen')).click();
      await bis('Meldung', async () => (await text('#meldung')).includes('The pack is in'), 60_000);
    });
    const t0 = Date.now();
    const echt = await imSeitenkontext(`return JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'gesichtsscan' })));`);
    console.log(`firefox echt: Gesichtsscan ${JSON.stringify(echt)} in ${Date.now() - t0} ms`);
    pruefe(echt.geprueft === echt.gesamt, 'echtes Pack: alle Patch-Bilder geprueft');
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: presets.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
