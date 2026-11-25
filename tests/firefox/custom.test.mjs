// Firefox: Custom-Baukasten (Phase 11 E6a, T5) ueber geckodriver/WebDriver, die echte Erweiterung auf der lokalen Testseite tests/fixtures/custom.html:
// (a) Schwarz mit Woertern plus weiches Gesicht wird so gemalt, (b) der Wechsel eines Bausteins bei offener Seite malt das Bild neu, (c) eine ungueltige Mischung im
// Speicher malt Mosaik, (d) Mias Gesicht und Sticker ohne Pack malen Mosaik an beiden Stellen. Einstellungen aendert die Seite ueber den Testhaken `veil-test`
// (derselbe Schreibweg `aendereEinstellungen` wie die Oberflaeche, storage.local). Testbild aus ../05 Testbilder (nie im Repo): fehlt es, ist der Test rot,
// ausser mit VEIL_OHNE_TESTBILDER=1. Firefox stumm.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { mitReitern } from './reiter-hilfe.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 300 s ueberschritten');
  process.exit(1);
}, 300_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const basis = `http://127.0.0.1:${port}`;
const GECKO_ID = 'veil@hypnomia';
const TESTBILD = 'sfw-001-portraet.jpg'; // 1280 x 800, ein Gesicht (YuNet), kleiner als das Arbeitsbild: Seite und Antwort haben dieselben Masse
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
const zonenNur = (an) => Object.fromEntries(ALLE.map((n) => [n, BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) }]));

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
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
    console.error(`firefox: ROT  ${text}`);
  }
}

let driver;
let server;
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

async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

const speicher = (k) => imSeitenkontext(`const r = await api.storage.local.get(args[0]); return JSON.parse(JSON.stringify(r[args[0]] ?? null));`, k);
const schreibeEinst = (teil, ersetze = false) =>
  imSeitenkontext(`const alt = args[1] ? {} : ((await api.storage.local.get('einstellungen')).einstellungen ?? {}); await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } });`, teil, ersetze);
const grund = (an) => ({ version: 1, pause: false, schwelle: 0.1, rand: 0.15, zonen: zonenNur(an), augenbalken: false });

// ---- im Tab der Testseite ----
const hook = (einst) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen: einst }));
const urteil = () => driver.executeScript('return document.getElementById("bild").dataset.veil ?? ""');
// Hash der Bildbytes (gleiche Bytes heisst gleich gemalt).
const hash = () =>
  driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     (async () => {
       const el = document.getElementById('bild');
       const bytes = await (await (await fetch(el.src)).blob()).arrayBuffer();
       return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
     })().then(fertig, (e) => fertig('FEHLER ' + e));`,
  );
async function ruhenderHash() {
  let h = await hash();
  for (let i = 0; i < 25; i++) {
    await warte(400);
    const n = await hash();
    if (n === h) return n;
    h = n;
  }
  return h;
}
// Kennzahlen einer Box im angezeigten Bild gegen das Original: dunkel (alle Kanaele unter 60), Wort-Rosa, Rahmen-Rosa, mittlere Abweichung.
const kennzahlen = (box, inset) =>
  driver.executeAsyncScript(
    `const [box, inset, name, fertig] = [arguments[0], arguments[1], arguments[2], arguments[arguments.length - 1]];
     (async () => {
       const holen = async (u) => createImageBitmap(await (await fetch(u)).blob());
       const a = await holen(document.getElementById('bild').src);
       const o = await holen('/testbild/sfw/' + encodeURIComponent(name));
       const lies = (b) => { const c = new OffscreenCanvas(a.width, a.height); const g = c.getContext('2d'); g.drawImage(b, 0, 0, a.width, a.height); return g.getImageData(0, 0, a.width, a.height).data; };
       const p = lies(a), q = lies(o);
       let n = 0, dunkel = 0, wort = 0, rahmen = 0, summe = 0;
       for (let y = box[1] + inset; y < box[1] + box[3] - inset; y++) for (let x = box[0] + inset; x < box[0] + box[2] - inset; x++) {
         const i = (y * a.width + x) * 4; n++;
         if (p[i] < 60 && p[i + 1] < 60 && p[i + 2] < 60) dunkel++;
         if (Math.hypot(p[i] - 255, p[i + 1] - 179, p[i + 2] - 211) < 45) wort++;
         if (Math.hypot(p[i] - 255, p[i + 1] - 79, p[i + 2] - 163) < 60) rahmen++;
         summe += (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
       }
       return { breite: a.width, n, dunkel: dunkel / Math.max(1, n), wort, rahmen, mittel: summe / Math.max(1, n) };
     })().then(fertig, (e) => fertig({ fehlerText: String(e) }));`,
    box,
    inset,
    TESTBILD,
  );

// Die Pruefung des Erkenners wie der Bild-Weg des Schleiers sie schickt (verschmelzen: true) fuer das Testbild; liefert die Flaechen.
const flaechenFuer = (an, preset, custom) =>
  imSeitenkontext(
    `const [basis, name, an, preset, custom, zonen] = args;
     const blob = await (await fetch(basis + '/testbild/sfw/' + encodeURIComponent(name))).blob();
     const dataUrl = await new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.readAsDataURL(blob); });
     const roh = await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'pruefe', id: 'ff-c-' + Math.random(), quelle: { art: 'daten', dataUrl },
       breite: 0, hoehe: 0, einstellungen: { schwelle: 0.1, zonen, rand: 0.15, preset, ...(custom ? { custom } : {}) }, rendern: true, verschmelzen: true });
     const a = JSON.parse(JSON.stringify(roh));
     return a.ok ? { ok: true, flaechen: a.flaechen } : { ok: false, fehler: a.fehler };`,
    basis,
    TESTBILD,
    an,
    preset,
    custom ?? null,
    zonenNur(an),
  );

let optionenTab;
// Oeffnet die Testseite in einem neuen Tab (Einstellungen vorher gesetzt), ruft `fn` und kehrt zum Tab der Optionen zurueck.
async function aufSeite(fn) {
  await driver.switchTo().newWindow('tab');
  await driver.get(`${basis}/custom.html?satz=sfw&bild=${encodeURIComponent(TESTBILD)}`);
  try {
    await bis('Bild zensiert', async () => (await urteil()) === 'zensiert', 60_000);
    return await fn();
  } finally {
    await driver.close();
    await driver.switchTo().window(optionenTab);
  }
}

let code = 0;
try {
  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  mitReitern(driver);
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 120_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await installiere(driver, paket);
  optionenTab = await oeffne('options.html');
  await bis('Status mit YuNet bereit', async () => {
    const s = await imSeitenkontext(`return JSON.parse(JSON.stringify(await api.runtime.sendMessage({ ziel: 'erkenner', typ: 'status' })));`);
    return s && s.ok && s.gesichtBereit;
  });
  pruefe((await speicher('pack')) === null, 'frisches Profil ohne Pack');

  // ---- (a) Schwarz mit Woertern und weiches Gesicht ----
  const m1 = { gesicht: 'blur', flaeche: 'schwarz', woerter: true };
  const fg = await flaechenFuer(['face'], 'custom', m1);
  if (!fg.ok && /404|fehlt|nicht ladbar|Netz/i.test(String(fg.fehler)) && OHNE_TESTBILDER) {
    console.log(`firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Test uebersprungen (${fg.fehler})`);
  } else {
    pruefe(fg.ok && fg.flaechen.some((f) => f.zone === 'face' && f.behandlung === 'blur'), `Erkenner: Gesicht weichgezeichnet (${JSON.stringify(fg).slice(0, 160)})`);
    const gesicht = fg.flaechen.find((f) => f.zone === 'face');
    const fk = await flaechenFuer(['head'], 'custom', m1);
    pruefe(fk.ok && fk.flaechen.length === 1 && fk.flaechen[0].behandlung === 'schwarz-wort', `Erkenner: Flaeche schwarz mit Wort (${JSON.stringify(fk).slice(0, 160)})`);
    const kopf = fk.flaechen[0];

    await schreibeEinst({ ...grund(['face']), preset: 'custom', custom: m1 }, true);
    await aufSeite(async () => {
      const voll = await kennzahlen(gesicht.box, 0);
      const k = await kennzahlen(gesicht.box, 6);
      console.log(`firefox: T5a Gesicht weich: Rahmen ${voll.rahmen}, dunkel ${(k.dunkel * 100).toFixed(1)} %, Abweichung ${k.mittel.toFixed(1)}, Wortpixel ${k.wort}`);
      pruefe(voll.rahmen < 10 && k.dunkel < 0.3 && k.mittel > 3 && k.wort < 5, `T5a: Gesicht weich (Rahmen ${voll.rahmen}, dunkel ${k.dunkel}, Abweichung ${k.mittel}, Wort ${k.wort})`);
    });
    await schreibeEinst({ ...grund(['head']), preset: 'custom', custom: m1 }, true);
    await aufSeite(async () => {
      const voll = await kennzahlen(kopf.box, 0);
      const k = await kennzahlen(kopf.box, 8);
      console.log(`firefox: T5a Flaeche schwarz mit Wort: dunkel ${(k.dunkel * 100).toFixed(0)} %, Wortpixel ${k.wort}, Rahmen ${voll.rahmen}`);
      pruefe(k.dunkel > 0.7 && k.wort > 40 && voll.rahmen === 0, `T5a: Flaeche schwarz mit Wort (dunkel ${k.dunkel}, Wort ${k.wort}, Rahmen ${voll.rahmen})`);
    });

    // ---- (b) Wechsel eines Bausteins bei offener Seite ----
    const mosaik = { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false };
    const lies = (box, inset) => kennzahlen(box, inset);
    await schreibeEinst({ ...grund(['face']), preset: 'custom', custom: mosaik }, true);
    await aufSeite(async () => {
      const min = Math.round(Math.min(gesicht.box[2], gesicht.box[3]) * 0.9);
      pruefe((await lies(gesicht.box, 0)).rahmen > min, 'T5b: Ausgang Mosaik, pinker Rahmen');
      await hook({ custom: { ...mosaik, gesicht: 'schwarz' } });
      const schwarz = await bis('Gesicht wird schwarz', async () => (await lies(gesicht.box, 6)).dunkel > 0.9, 60_000).catch(() => false);
      pruefe(schwarz, 'T5b: Gesicht wird schwarz');
      await hook({ custom: { ...mosaik, gesicht: 'schwarz', woerter: true } });
      const wort = await bis('Wort auf dem schwarzen Gesicht', async () => (await lies(gesicht.box, 6)).wort > 40, 60_000).catch(() => false);
      pruefe(wort, 'T5b: Wort auf dem schwarzen Gesicht');
      await hook({ custom: { ...mosaik, gesicht: 'blur', woerter: true } });
      // weich heisst: nicht dunkel UND deutlich anders als das Original (das unverdeckte Original erfuellt dunkel < 0.3 und Rahmen < 10 auch, M3)
      const weich = await bis('Gesicht wird weich', async () => { const k = await lies(gesicht.box, 6); return k.dunkel < 0.3 && k.mittel > 3; }, 60_000).catch(() => false);
      // Erst messen, wenn das Bild ruht: gleich nach dem Wechsel zeigt das Element kurz das Original (Urteil leer) und danach eine erste Fassung (Sonde E6n N3).
      await ruhenderHash();
      const nach = await lies(gesicht.box, 0);
      const nachInnen = await lies(gesicht.box, 6);
      console.log(`firefox: T5b weich: ${weich}, Rahmen ${nach.rahmen}, dunkel ${nachInnen.dunkel}`);
      pruefe(weich && nach.rahmen < 10, `T5b: Gesicht wird weich, kein Rahmen (${weich}, Rahmen ${nach.rahmen})`);
    });
    // Gegenprobe (M3): mit dem Original als Eingabe (keine Zone an, die Seite bleibt unverdeckt) wird dieselbe Pruefung rot
    await schreibeEinst({ ...grund([]), preset: 'custom', custom: mosaik }, true);
    await driver.switchTo().newWindow('tab');
    await driver.get(`${basis}/custom.html?satz=sfw&bild=${encodeURIComponent(TESTBILD)}`);
    try {
      await bis('Bild frei', async () => (await urteil()) === 'frei', 60_000);
      const g0 = await lies(gesicht.box, 6);
      pruefe(g0.dunkel < 0.3, `Gegenprobe: das Original ist nicht dunkel, erfuellt dunkel < 0,3 allein (${g0.dunkel})`);
      pruefe(!(g0.mittel > 3), `Gegenprobe: mit dem Original als Eingabe ist die Pruefung "weicht ab" rot (mittel ${g0.mittel})`);
    } finally {
      await driver.close();
      await driver.switchTo().window(optionenTab);
    }
    await schreibeEinst({ ...grund(['head']), preset: 'custom', custom: mosaik }, true);
    await aufSeite(async () => {
      pruefe((await lies(kopf.box, 0)).rahmen > Math.round(Math.min(kopf.box[2], kopf.box[3]) * 0.9), 'T5b: Flaeche, Ausgang Mosaik');
      await hook({ custom: { ...mosaik, flaeche: 'blur' } });
      pruefe(await bis('Flaeche wird weich', async () => (await lies(kopf.box, 0)).rahmen < 10, 60_000).catch(() => false), 'T5b: Flaeche wird weich');
      await hook({ custom: { ...mosaik, flaeche: 'schwarz', woerter: true } });
      pruefe(await bis('Flaeche schwarz mit Wort', async () => { const k = await lies(kopf.box, 8); return k.dunkel > 0.7 && k.wort > 40; }, 60_000).catch(() => false), 'T5b: Flaeche wird schwarz mit Wort');
    });
    const e = await speicher('einstellungen');
    pruefe(e.preset === 'custom' && e.custom.flaeche === 'schwarz' && e.custom.woerter === true && e.custom.gesicht === 'mosaik', `T5b: gespeichert (${JSON.stringify(e?.custom)})`);
  }

  // ---- (c) ungueltige Mischung im Speicher, (d) Mias Gesicht und Sticker ohne Pack: Mosaik ----
  // Die Referenz entsteht auf einer frischen Seite mit dem Preset der Tabelle; je Fall wird eine frische Seite mit den Einstellungen geladen und ihr Bild verglichen.
  const bildHash = async (einst) => {
    await schreibeEinst(einst, true);
    return aufSeite(ruhenderHash);
  };
  for (const [zone, ort] of [['face', 'am Gesicht'], ['head', 'an der Flaeche']]) {
    const mosaik = await bildHash({ ...grund([zone]), preset: 'mosaik' });
    const mosaikWort = await bildHash({ ...grund([zone]), preset: 'mosaik-wort' });
    const blur = await bildHash({ ...grund([zone]), preset: 'blur' });
    pruefe(new Set([mosaik, mosaikWort, blur]).size === 3, `Referenzen ${ort} sind drei verschiedene Bilder`);
    const faelle = [
      ['Mischung fehlt', { preset: 'custom' }, mosaik],
      ['null', { preset: 'custom', custom: null }, mosaik],
      ['leeres Objekt', { preset: 'custom', custom: {} }, mosaik],
      ['unbekannter Wert', { preset: 'custom', custom: { gesicht: 'schwarz', flaeche: 'regenbogen', woerter: true } }, mosaik],
      ['woerter als Zeichenkette', { preset: 'custom', custom: { gesicht: 'schwarz', flaeche: 'blur', woerter: 'true' } }, mosaik],
      ['Prototyp-Name', { preset: 'custom', custom: { gesicht: 'constructor', flaeche: 'blur', woerter: false } }, mosaik],
      ['Mias Gesicht und Sticker ohne Pack', { preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } }, mosaik],
      ['Sticker und Sticker ohne Pack', { preset: 'custom', custom: { gesicht: 'sticker', flaeche: 'sticker', woerter: false } }, mosaik],
      ['Mias Gesicht und Sticker mit Woertern ohne Pack', { preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: true } }, mosaikWort],
      ['Sticker und Sticker mit Woertern ohne Pack', { preset: 'custom', custom: { gesicht: 'sticker', flaeche: 'sticker', woerter: true } }, mosaikWort],
    ];
    for (const [name, einst, soll] of faelle) {
      const h = await bildHash({ ...grund([zone]), ...einst });
      console.log(`firefox: T5c/T5d ${ort}, ${name}: ${h === soll ? 'wie die Referenz' : h === blur ? 'WEICHZEICHNER' : 'anderes Bild'}`);
      pruefe(h === soll, `T5c/T5d ${ort}, ${name}: malt Mosaik (Bild gleich der Referenz)`);
    }
    // die ungueltige Mischung bleibt im Speicher als custom stehen, geladen ist der Standard
    const e = await speicher('einstellungen');
    pruefe(e.preset === 'custom', 'T5c: preset bleibt custom im Speicher');
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
}
console.log(`firefox: custom.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
