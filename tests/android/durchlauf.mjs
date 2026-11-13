// Android-Durchlauf (Phase 8): der Weg einer Nutzerin in Firefox fuer Android im Emulator, je Schritt Fotos und Zahlen.
// Aufruf: node tests/android/durchlauf.mjs --alle | --schritt <apis|einstieg|schleier|pack|sticker|besuch|pause|bedienung|speicher>[,<...>]
// Vorher: Emulator veil-android15 laeuft (ohne Ton), Testbau `VEIL_AUSGABE=.output-android WXT_TESTHAKEN=1 npm run zip:test:firefox`.
// Echtes Pack ueber VEIL_ECHTES_PACK (Pfad nie in Dateien). Fotos nach ../03 Recherche/emulator/phase8-*.png, Zahlen nach
// scripts/messung/ergebnis-android-*.json. Der Firefox-Willkommensdialog wird im Emulator weggetippt (Entscheidung 152, lib.mjs).
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { By } from 'selenium-webdriver';
import { starteFixtureServer } from '../fixtures-server.mjs';
import * as L from './lib.mjs';

process.env.SE_AVOID_STATS = 'true';
const ALLE = ['apis', 'einstieg', 'schleier', 'pack', 'sticker', 'besuch', 'pause', 'bedienung', 'speicher'];
const argv = process.argv.slice(2);
const wahl = argv.includes('--alle') ? ALLE : (argv[argv.indexOf('--schritt') + 1] ?? '').split(',').filter(Boolean);
if (wahl.length === 0 || wahl.some((s) => !ALLE.includes(s))) {
  console.error(`Aufruf: --alle oder --schritt ${ALLE.join('|')}`);
  process.exit(2);
}
// Waechter: haengt etwas, endet der Lauf nach 15 Minuten.
setTimeout(() => {
  console.error('android: Zeitlimit 15 min');
  process.exit(1);
}, 15 * 60_000).unref();

if (!L.emulatorBereit()) {
  console.error('android: Emulator nicht bereit (adb, sys.boot_completed)');
  process.exit(1);
}

const ergebnis = { start: new Date().toISOString(), schritte: {} };
let driver;
let server = [];
let code = 0;

// Kleine Helfer im Inhaltskontext.
const js = (code, ...args) => driver.executeScript(code, ...args);
const klick = (css) => js(`document.querySelector(arguments[0]).click()`, css);
const schritt = () => js(`return document.querySelector('#schritt')?.dataset.schritt ?? null`);
const bisSchritt = (soll) => L.bis(`Schritt ${soll}`, async () => (await schritt()) === soll, 15_000);
const sende = (n) => L.imSeitenkontext(driver, `return await api.runtime.sendMessage(args[0]);`, n);

// Mass der Seite: waagrechtes Scrollen, Fingerziele (sichtbare Knoepfe, Links, Beschriftungen) unter 44 px.
async function vermesse() {
  return js(`
    const d = document.documentElement;
    const ziele = [...document.querySelectorAll('button, a[href], label, input, select, summary')]
      .filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0)
      .map((e) => { const r = e.getBoundingClientRect(); return { art: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), text: (e.textContent || e.value || e.id || '').trim().slice(0, 40), h: Math.round(r.height), b: Math.round(r.width) }; })
      .filter((z) => z.h > 0 && z.b > 0);
    return { breite: d.clientWidth, scrollBreite: d.scrollWidth, waagrecht: d.scrollWidth > d.clientWidth,
             knoepfe: ziele.filter((z) => z.art.startsWith('button')).map((z) => z.h),
             klein: ziele.filter((z) => z.h < 44 && !z.art.startsWith('input:checkbox') && !z.art.startsWith('input:radio')) };
  `);
}

// Fenix zeigt nach dem Start den Startbildschirm; eine per loadURI geladene Erweiterungsseite laeuft dann unsichtbar (Breite 0).
// Darum zuerst eine normale Seite laden: danach ist die Seitenansicht vorn und folgende loadURI-Seiten sind sichtbar.
// Steht noch der Startbildschirm vorn, den Tab antippen (Karte "Continue" oder Tab-Uebersicht), wie eine Nutzerin es taete.
// Session 20: nach dem Bildschirmvideo (Schritt schleier) blieb die Tab-Uebersicht vorn, obwohl innerWidth > 0 meldete: erst "Add tab" prueft es.
const trayOffen = () => L.leseOberflaeche().some((n) => /^Add tab$/.test(n.beschreibung));
const seiteVorn = async () => (await js('return innerWidth > 0')) && !trayOffen();
async function seiteNachVorn() {
  if (await seiteVorn()) return;
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    const k = L.leseOberflaeche();
    if (L.pruefeKeinDialog(k)) {
      await L.raeumeFirefoxDialogeWeg();
      continue;
    }
    // Tab-Uebersicht offen: den Tab mit dem Titel der Seite antippen (Text-Knoten, nicht "Close tab ...").
    const titel = (await js('return document.title').catch(() => '')) || '';
    const imTray = k.some((n) => /^Add tab$/.test(n.beschreibung));
    const karte = titel ? k.find((n) => n.text === titel) : null;
    if (karte) L.tippe(karte.mx, karte.my);
    else if (imTray) {
      const erster = k.find((n) => n.text && n.my > 300 && n.my < 900 && !/protected/i.test(n.text));
      if (erster) L.tippe(erster.mx, erster.my);
    } else {
      const zaehler = k.find((n) => n.id === 'ADDRESSBAR_TABS_COUNTER' || /Tabs Open: \d+\. Tap to switch/.test(n.beschreibung));
      if (zaehler) L.tippe(zaehler.mx, zaehler.my);
    }
    await L.warte(800);
    if (await seiteVorn()) return;
  }
  throw new Error('Seite nicht nach vorn zu holen');
}

async function oeffneErweiterungsseite(seite) {
  // Nach dem Popup (Pause-Schritt) geht der erste Ladeversuch manchmal verloren (Session 20: auch der zweite): bis zu dreimal, dazwischen
  // Firefox nach vorn holen und die Seitenansicht pruefen.
  let ms;
  for (let versuch = 1; ; versuch++) {
    await L.ladeUrl(driver, L.erweiterungsUrl(seite));
    try {
      ms = await L.bisSeite(driver, seite, versuch === 1 ? 10_000 : 15_000);
      break;
    } catch (e) {
      if (versuch >= 3) throw e;
      console.log(`android: ${seite} nicht geladen (Versuch ${versuch}), Firefox nach vorn und noch einmal`);
      L.holeFirefoxNachVorn();
      await L.warte(1500);
      await seiteNachVorn().catch(() => null);
    }
  }
  await seiteNachVorn();
  return ms;
}

// ---------- Schritte ----------

async function apis() {
  await oeffneErweiterungsseite('options.html');
  const r = await L.imSeitenkontext(
    driver,
    `const hat = (n) => n.split('.').reduce((o, k) => (o == null ? undefined : o[k]), api) !== undefined;
     const est = await navigator.storage.estimate().catch((e) => ({ fehler: String(e) }));
     return {
       windows: hat('windows'), windowsGet: hat('windows.get'), idle: hat('idle'), commands: hat('commands'), tabs: hat('tabs'),
       dnr: hat('declarativeNetRequest'), webRequest: hat('webRequest'), menus: hat('menus'), notifications: hat('notifications'),
       persisted: await navigator.storage.persisted().catch(() => null), quotaMB: est.quota ? Math.round(est.quota / 1e6) : null,
       usageMB: est.usage != null ? Math.round(est.usage / 1e5) / 10 : null,
       userAgent: navigator.userAgent, breite: innerWidth, dpr: devicePixelRatio,
     };`,
  );
  console.log('android apis:', JSON.stringify(r));
  ergebnis.schritte.apis = r;
}

async function einstieg() {
  await oeffneErweiterungsseite('options.html');
  const a = await sende({ ziel: 'hintergrund', typ: 'einstieg-test', zuruecksetzen: true });
  if (!a?.ok) throw new Error(`einstieg-test zuruecksetzen: ${JSON.stringify(a)}`);
  await oeffneErweiterungsseite('willkommen.html');
  const seiten = [];
  const halte = async (name) => {
    await L.warte(400);
    const m = await vermesse();
    seiten.push({ name, ...m, foto: L.foto('einstieg', name) });
  };
  await bisSchritt('warnung');
  await halte('warnung');
  await klick('#warnung-ok');
  await bisSchritt('alter');
  await halte('alter');
  await klick('#alter-ja');
  await bisSchritt('einwilligung');
  await halte('einwilligung');
  await klick('#einwilligung-ok');
  // Session 17 (Paket D): ohne Pack beim Eintritt nur 3 Interview-Seiten, mit Pack 5: weiter, solange Interview-Seiten kommen.
  await bisSchritt('interview-1');
  let n = 0;
  while (n < 6 && /^interview-\d+$/.test((await schritt()) ?? '')) {
    n = Number(((await schritt()) ?? '').split('-')[1]);
    await halte(`interview-${n}`);
    // Unterer Teil langer Seiten auch fotografieren
    const hoch = await js('return document.documentElement.scrollHeight > innerHeight + 40');
    if (hoch) {
      await js('scrollTo(0, document.documentElement.scrollHeight)');
      await halte(`interview-${n}-unten`);
    }
    await klick('#iv-weiter');
    await L.bis('naechste Seite', async () => (await schritt()) !== `interview-${n}`, 15_000);
  }
  console.log(`android: Interview mit ${n} Seiten`);
  await L.bis('Ende', async () => ![`interview-${n}`, null].includes(await schritt()), 15_000);
  const ende = await schritt();
  await halte(`ende-${ende}`);
  ergebnis.schritte.einstieg = { seiten, ende };
  const waagrecht = seiten.filter((s) => s.waagrecht).map((s) => s.name);
  console.log(`android einstieg: ${seiten.length} Ansichten, waagrecht gescrollt: ${waagrecht.length ? waagrecht.join(', ') : 'nie'}, Ende ${ende}`);
}

// Bildschirmlage der Seitenansicht (GeckoView) fuer adb-Tipps auf Seiten-Elemente.
function seitenAnsicht() {
  const k = L.leseOberflaeche();
  const v = k.filter((n) => /GeckoView|engineView|EngineView/i.test(n.klasse + ' ' + n.id)).sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))[0];
  if (!v) throw new Error(`Seitenansicht nicht gefunden (${k.map((n) => n.klasse).filter(Boolean).slice(0, 20).join(', ')})`);
  return v;
}
async function tippeElement(css) {
  const r = await js(`const e = document.querySelector(arguments[0]); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio };`, css);
  await L.warte(300);
  const v = seitenAnsicht();
  L.tippe(v.x1 + r.x * r.dpr, v.y1 + r.y * r.dpr);
}
const status = async () => {
  const roh = await js(`return document.documentElement.getAttribute('data-veil-status')`);
  try { return JSON.parse(roh); } catch { return roh; }
};
// Nur Bilder im sichtbaren Bereich zaehlen (schmaler Bildschirm: viele liegen darunter und werden erst beim Scrollen geprueft).
const offeneBilder = () => js(`return [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; }).filter((i) => !['frei', 'zensiert'].includes(i.dataset.veil ?? '')).length`);
const urteile = () => js(`const z = {}; for (const i of document.querySelectorAll('img')) { const v = i.dataset.veil ?? 'offen'; z[v] = (z[v] ?? 0) + 1; } return z;`);

async function schleier() {
  const r = {};
  for (const seite of ['schleier.html', 'schleier-fotos.html']) {
    const t0 = Date.now();
    await driver.get(`${L.basis}/${seite}`);
    await seiteNachVorn();
    if (seite === 'schleier-fotos.html') await L.bis('Fotos bereit', () => js('return document.documentElement.dataset.fotosBereit ?? null'), 20_000).catch(() => null);
    let fertig = null;
    try {
      await L.bis('alle beurteilt', async () => (await offeneBilder()) === 0, 60_000, 100);
      fertig = Date.now() - t0;
    } catch {
      fertig = null;
    }
    r[seite] = { msBisAlleBeurteilt: fertig, urteile: await urteile(), status: await status(), foto: L.foto('schleier', seite.replace('.html', '')) };
    console.log(`android schleier ${seite}: ${fertig ?? 'nicht fertig'} ms, ${JSON.stringify(r[seite].urteile)}`);
  }
  // Aufblitzen beim Laden: 10 s Bildschirmvideo im Emulator, Einzelbilder pruefen (Auswertung von Hand ueber die Fotos)
  try {
    L.shell('rm -f /sdcard/veil-blitz.mp4');
    const { spawn } = await import('node:child_process');
    const rec = spawn('adb', ['-s', L.seriennummer, 'shell', 'screenrecord', '--time-limit', '8', '/sdcard/veil-blitz.mp4']);
    await L.warte(800);
    await driver.get(`${L.basis}/schleier-fotos.html?neu=${Date.now()}`);
    await new Promise((res) => rec.on('exit', res));
    const ziel = `${process.env.TMPDIR ?? '/tmp'}/veil-android-blitz`;
    L.adb('pull', '/sdcard/veil-blitz.mp4', `${ziel}.mp4`);
    r.video = { datei: `${ziel}.mp4`, bilder: L.ffmpegBilder(`${ziel}.mp4`, ziel, 10) ? ziel : null };
    console.log(`android schleier: Video ${r.video.datei}, Einzelbilder ${r.video.bilder}`);
  } catch (e) {
    r.video = { fehler: String(e) };
  }
  ergebnis.schritte.schleier = r;
}

async function pack() {
  const quelle = process.env.VEIL_ECHTES_PACK;
  if (!quelle || !existsSync(quelle)) {
    ergebnis.schritte.pack = { uebersprungen: 'VEIL_ECHTES_PACK fehlt' };
    console.log('android pack: uebersprungen (VEIL_ECHTES_PACK fehlt)');
    return;
  }
  const name = 'mia-pack-0.7.0.miapack';
  L.adb('push', quelle, `/sdcard/Download/${name}`);
  await oeffneErweiterungsseite('options.html');
  await L.bis('Datei-Knopf frei', () => js(`const e = document.querySelector('#datei'); return !!e && !e.disabled`), 15_000);
  L.foto('pack', 'vor-import');
  await tippeElement('#datei');
  await L.warte(1500);
  const r = { waehler: [] };
  // Android-Dateiwaehler: Datei suchen, sonst ueber "Downloads" gehen.
  const t0 = Date.now();
  let gewaehlt = false;
  while (Date.now() - t0 < 30_000 && !gewaehlt) {
    const k = L.leseOberflaeche();
    r.waehler = k.map((n) => n.text || n.beschreibung).filter(Boolean).slice(0, 40);
    const datei = L.finde(k, name)[0];
    if (datei) {
      L.foto('pack', 'waehler');
      L.tippe(datei.mx, datei.my);
      gewaehlt = true;
      break;
    }
    const downloads = L.finde(k, /^Downloads?$/)[0];
    const wurzeln = L.finde(k, /Show roots|Wurzeln/)[0];
    if (downloads) L.tippe(downloads.mx, downloads.my);
    else if (wurzeln) L.tippe(wurzeln.mx, wurzeln.my);
    await L.warte(1200);
  }
  r.gewaehlt = gewaehlt;
  if (!gewaehlt) {
    L.foto('pack', 'waehler-ohne-datei');
    ergebnis.schritte.pack = r;
    L.zurueckTaste();
    throw new Error(`Datei im Waehler nicht gefunden: ${r.waehler.join(' | ')}`);
  }
  const t1 = Date.now();
  await seiteNachVorn();
  // Pruefung des Packs bis zur Lizenz (der Import wartet auf "annehmen")
  const sicht = (css) => js(`const e = document.querySelector(arguments[0]); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0`, css);
  r.msBisLizenz = await L.bis('Lizenz-Block', () => sicht('#lizenz-block'), 120_000, 200).then(() => Date.now() - t1).catch(() => null);
  r.lizenzKopf = await js(`return document.querySelector('#lizenz-kopf')?.textContent.trim() ?? ''`);
  r.lizenzFoto = L.foto('pack', 'lizenz');
  const t2 = Date.now();
  await tippeElement('#annehmen');
  const fertig = await L.bis('Pack importiert', async () => {
    const v = await js(`return document.querySelector('#pack-version')?.textContent.trim() ?? ''`);
    return v ? v : null;
  }, 120_000, 250).catch((e) => ({ fehler: String(e) }));
  r.msAnnehmenBisFertig = Date.now() - t2;
  r.msImport = Date.now() - t1;
  r.pack = typeof fertig === 'string' ? { version: fertig } : fertig;
  r.meldung = await js(`return [...document.querySelectorAll('[role=status], .meldung, #pack-status, #pack-meldung')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 5)`).catch(() => []);
  await js(`document.querySelector('#datei')?.scrollIntoView({ block: 'center' })`);
  r.foto = L.foto('pack', 'nach-import');
  ergebnis.schritte.pack = r;
  console.log(`android pack: gewaehlt ${gewaehlt}, Import ${r.msImport} ms, ${JSON.stringify(r.pack)}, Meldung ${JSON.stringify(r.meldung)}`);
}

// Session 20: Preset "sticker" (nach dem Pack-Import, Pack mit Stickern): Preset in den Optionen antippen, auf der Foto-Testseite (nsfw)
// muss mindestens ein zensiertes Bild pastell gedeckt sein (Pixelprobe im Bild, dazu Foto); danach Preset "mia-wort" wiederherstellen.
async function sticker() {
  const r = {};
  const preset = () => L.imSeitenkontext(driver, `const e = (await api.storage.local.get('einstellungen')).einstellungen; return e ? e.preset ?? null : null;`);
  const waehle = async (id) => {
    await oeffneErweiterungsseite('options.html');
    r[`gesperrt-${id}`] = await js(`const e = document.querySelector('#preset-' + arguments[0]); return e ? e.disabled : 'fehlt'`, id);
    if (r[`gesperrt-${id}`] !== false) throw new Error(`Preset ${id} nicht waehlbar (${r[`gesperrt-${id}`]}): Pack ohne Sticker oder nicht importiert`);
    await tippeElement(`label:has(#preset-${id})`);
    await L.bis(`Preset ${id} gespeichert`, async () => (await preset()) === id, 10_000, 200);
  };
  r.vorher = await oeffneErweiterungsseite('options.html').then(() => preset());
  await waehle('sticker');
  r.optionenFoto = L.foto('sticker', 'optionen-sticker');
  await driver.get(`${L.basis}/schleier-fotos.html?satz=nsfw`);
  await seiteNachVorn();
  await L.bis('Fotos bereit', () => js('return document.documentElement.dataset.fotosBereit ?? null'), 30_000).catch(() => null);
  const t0 = Date.now();
  await L.bis('alle beurteilt', async () => (await offeneBilder()) === 0, 120_000, 200).catch(() => null);
  r.msBisAlleBeurteilt = Date.now() - t0;
  r.urteile = await urteile();
  r.proben = await js(`
    const PASTELL = [[255,211,230],[226,215,255],[255,220,199]], RAHMEN = [255,79,163];
    const dist = (p, q) => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
    const aus = [];
    for (const i of document.querySelectorAll('img')) {
      if ((i.dataset.veil ?? '') !== 'zensiert' || !i.complete || !i.naturalWidth) continue;
      const f = Math.min(1, 320 / i.naturalWidth);
      const c = document.createElement('canvas'); c.width = Math.round(i.naturalWidth * f); c.height = Math.round(i.naturalHeight * f);
      const x = c.getContext('2d'); x.drawImage(i, 0, 0, c.width, c.height);
      let d; try { d = x.getImageData(0, 0, c.width, c.height).data; } catch (e) { aus.push({ alt: i.alt, verschmutzt: true }); continue; }
      let n = 0, pastell = 0, rahmen = 0, dunkel = 0;
      for (let k = 0; k < d.length; k += 4) { const p = [d[k], d[k+1], d[k+2]]; n++; if (PASTELL.some((q) => dist(p, q) < 16)) pastell++; if (dist(p, RAHMEN) < 60) rahmen++; if (p[0] < 60 && p[1] < 60 && p[2] < 60) dunkel++; }
      aus.push({ alt: i.alt, n, pastell: +(pastell / n).toFixed(4), rahmen: +(rahmen / n).toFixed(4), dunkel: +(dunkel / n).toFixed(4) });
    }
    return aus;`);
  r.seitenFoto = L.foto('sticker', 'seite-sticker');
  await js('scrollTo(0, 0)');
  // Zweite Pixelprobe am Bildschirmfoto (die Canvas-Probe scheitert bei Bildern, deren Quelle den Canvas verschmutzt): Seitenbereich ohne Adressleiste
  // und Navigationsleiste; Anteil der Pastell- und Rahmenpixel (Farben der Sticker-Zensur, src/sticker.ts).
  {
    const { data, info } = await sharp(path.join(L.fotoOrdner, r.seitenFoto)).raw().toBuffer({ resolveWithObject: true });
    const PASTELL = [[255, 211, 230], [226, 215, 255], [255, 220, 199]], RAHMEN = [255, 79, 163];
    const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const y0 = Math.round(info.height * 0.13), y1 = Math.round(info.height * 0.45);
    let n = 0, pastell = 0, rahmen = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels, p = [data[i], data[i + 1], data[i + 2]];
      n++;
      if (PASTELL.some((q) => abstand(p, q) < 18)) pastell++;
      if (abstand(p, RAHMEN) < 50) rahmen++;
    }
    r.fotoProbe = { n, pastell: +(pastell / n).toFixed(4), rahmen: +(rahmen / n).toFixed(4) };
  }
  const gedeckt = r.proben.filter((p) => !p.verschmutzt && p.pastell >= 0.01);
  r.gedecktBilder = gedeckt.length;
  r.maxPastell = Math.max(0, ...r.proben.map((p) => p.pastell ?? 0));
  console.log(`android sticker: ${JSON.stringify(r.urteile)}, zensiert geprueft ${r.proben.length} (lesbar ${r.proben.filter((p) => !p.verschmutzt).length}), pastell gedeckt ${gedeckt.length}, groesster Pastellanteil ${r.maxPastell}, Fotoprobe ${JSON.stringify(r.fotoProbe)}`);
  ergebnis.schritte.sticker = r;
  // Preset immer wiederherstellen, auch bei rotem Befund.
  await waehle('mia-wort');
  r.nachher = await preset();
  r.optionenFotoZurueck = L.foto('sticker', 'optionen-mia-wort');
  if (r.proben.length === 0) throw new Error('kein zensiertes Bild auf der Testseite (Erkenner nicht fertig oder Satz nsfw fehlt)');
  if (r.fotoProbe.pastell < 0.05 || r.fotoProbe.rahmen < 0.002) throw new Error(`Bildschirmfoto zeigt keine Pastellflaechen mit Rahmen (${JSON.stringify(r.fotoProbe)})`);
  if (gedeckt.length === 0) throw new Error(`kein zensiertes Bild pastell gedeckt (groesster Anteil ${r.maxPastell})`);
  if (r.nachher !== 'mia-wort') throw new Error(`Preset nicht wiederhergestellt: ${r.nachher}`);
}

// Pause ueber das Firefox-Menue: drei Punkte, Erweiterungen, HYPNOMIA VEIL, Popup (Overlay), "Pause Mia".
async function oeffnePopupUeberMenue(r) {
  const weg = [];
  const menue = await L.tippeKnoten((n) => /main menu|more options|menu/i.test(n.beschreibung) && n.my < 400, 8000);
  weg.push(menue.beschreibung);
  await L.warte(800);
  // Firefox 159: Eintrag "Extensions" mit Unterzeile der Erweiterung, eingeklappt ("Extensions HYPNOMIA VEIL Collapsed").
  const erw = await L.tippeKnoten((n) => /^(Extensions|Add-ons)\b/.test(n.text || n.beschreibung), 8000);
  weg.push(erw.text || erw.beschreibung);
  await L.warte(800);
  r.menuFoto = L.foto('pause', 'menue-erweiterungen');
  // Session 17: pausiert traegt der Eintrag den Titel des Symbols "HYPNOMIA VEIL: paused" (src/hintergrund/symbol.ts).
  const veil = await L.tippeKnoten((n) => /^HYPNOMIA VEIL(: paused)?$/.test(n.text || n.beschreibung), 8000);
  weg.push(veil.text || veil.beschreibung);
  r.weg = weg;
  await L.warte(1500);
}
async function pause() {
  const r = {};
  await driver.get(`${L.basis}/schleier.html`);
  await seiteNachVorn();
  await L.bis('alle beurteilt', async () => (await offeneBilder()) === 0, 60_000, 100).catch(() => null);
  r.vorher = await urteile();
  const t0 = Date.now();
  await oeffnePopupUeberMenue(r);
  r.msMenueBisPopup = Date.now() - t0;
  r.popupFoto = L.foto('pause', 'popup');
  // Popup ist ein eigener WebDriver-Kontext? Sonst ueber adb tippen.
  const k = L.leseOberflaeche();
  const knopf = L.finde(k, /^Pause Mia$/)[0];
  r.knopfGesehen = !!knopf;
  const t1 = Date.now();
  if (knopf) L.tippe(knopf.mx, knopf.my);
  else await L.tippeKnoten(/Pause Mia/, 8000);
  await L.warte(800);
  r.popupNachFoto = L.foto('pause', 'popup-pausiert');
  // Der Content-Kontext des Fahrers ist die Webseite (dort gibt es keine Erweiterungs-API): Pause an der Popup-Anzeige ablesen.
  const pausiert = await L.bis('Popup zeigt Pause', async () => L.finde(L.leseOberflaeche(), /^Let Mia back in$/).length > 0, 10_000, 200).catch(() => false);
  r.msBisPause = Date.now() - t1;
  r.pausiert = pausiert;
  L.zurueckTaste();
  await L.warte(1000);
  await seiteNachVorn().catch(() => null);
  r.nachher = await urteile().catch(() => null);
  r.seitenFoto = L.foto('pause', 'seite-pausiert');
  // Wieder fortsetzen ueber das Menue
  await oeffnePopupUeberMenue({});
  await L.tippeKnoten(/Let Mia back in/, 8000).catch(() => null);
  await L.warte(800);
  L.zurueckTaste();
  ergebnis.schritte.pause = r;
  console.log(`android pause: Weg ${JSON.stringify(r.weg)}, Menue bis Popup ${r.msMenueBisPopup} ms, pausiert ${pausiert} nach ${r.msBisPause} ms, Bilder vorher ${JSON.stringify(r.vorher)} nachher ${JSON.stringify(r.nachher)}`);
}

// Pflicht-Besuch auf Android (Auftrag F: ohne browser.windows lehnte der Hintergrund jeden Besuch mit "kein-tab" ab).
// Braucht ein importiertes Pack im selben Lauf (Schritt pack davor). Testhaken wie tests/firefox/besuche.test.mjs.
async function besuch() {
  const r = {};
  await driver.get(`${L.basis}/besuche.html`);
  await seiteNachVorn();
  const abbild = async () => { const roh = await js(`return document.documentElement.getAttribute('data-veil-besuch')`); return roh ? JSON.parse(roh) : null; };
  const sendeB = (b) => js("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ besuch: b }));
  await sendeB({ einstellungen: { kontrolle: { werbung: false, blitz: 'aus', leerlauf: false, leerlaufMinuten: 2, besuche: true } } });
  await L.warte(1500);
  const vorher = (await abbild())?.nr ?? 0;
  const t0 = Date.now();
  await sendeB({ faellig: true });
  const a = await L.bis('Antwort des Moduls', async () => { const x = await abbild(); return x && (x.nr ?? 0) > vorher ? x : null; }, 15_000, 100).catch((e) => ({ fehler: String(e) }));
  r.ms = Date.now() - t0;
  r.abbild = a;
  await L.warte(1200);
  r.foto = L.foto('besuch', 'hinweis');
  // Nach dem Hinweis (hinweisMs) oeffnet der Hintergrund Mias Seite als neuen Tab (Testbau: about:blank#veil-besuch): Ende abwarten.
  r.ende = await L.bis('Besuch zu Ende', async () => { const x = await abbild(); return x && x.phase !== 'hinweis' ? x : null; }, 20_000, 200).catch((e) => ({ fehler: String(e) }));
  await L.warte(1000);
  r.fotoEnde = L.foto('besuch', 'ende');
  r.tabs = L.finde(L.leseOberflaeche(), /Tabs Open: \d+/).map((n) => n.beschreibung).slice(0, 1);
  // Session 20: der Besuch oeffnet Mias Seite in einem zweiten Tab, der dann vorn bleibt; spaetere Schritte luden ihre Erweiterungsseite in diesem
  // fremden Tab und fanden sie im Fahrer-Tab nicht ("options.html nicht geladen"). Darum den fremden Tab hier schliessen.
  try {
    const eigener = await driver.getWindowHandle();
    r.fremdeTabs = 0;
    for (const h of await driver.getAllWindowHandles()) {
      if (h === eigener) continue;
      await driver.switchTo().window(h);
      await driver.close();
      r.fremdeTabs++;
    }
    await driver.switchTo().window(eigener);
    await seiteNachVorn();
  } catch (e) {
    r.fremdeTabsFehler = String(e);
  }
  ergebnis.schritte.besuch = r;
  console.log(`android besuch: ${JSON.stringify(a)} nach ${r.ms} ms; Ende ${JSON.stringify(r.ende)}; ${r.tabs.join(' ')}; fremde Tabs geschlossen ${r.fremdeTabs ?? '?'}${r.fremdeTabsFehler ? ' (' + r.fremdeTabsFehler.slice(0, 100) + ')' : ''}`);
}

async function bedienung() {
  const r = {};
  // Nach dem Popup (Pause-Schritt) zuerst eine normale Seite nach vorn holen, sonst geht das Laden der Erweiterungsseite verloren.
  await driver.get(`${L.basis}/hello.html`);
  await seiteNachVorn();
  await oeffneErweiterungsseite('options.html');
  r.optionen = await vermesse();
  r.optionenFotos = [L.foto('bedienung', 'optionen-oben')];
  const hoehe = await js('return document.documentElement.scrollHeight');
  for (let y = 900; y < hoehe; y += 900) {
    await js(`scrollTo(0, ${y})`);
    await L.warte(300);
    r.optionenFotos.push(L.foto('bedienung', `optionen-${y}`));
  }
  r.ablageSichtbar = await js(`const e = document.querySelector('#ablage-text'); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0`);
  r.dateiKnopfHoehe = await js(`return Math.round(document.querySelector('#datei')?.getBoundingClientRect().height ?? 0)`);
  r.zeiger = await js(`return { fein: matchMedia('(pointer: fine)').matches, grob: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches }`);
  r.desktopTexte = await js(`
    const t = document.body.innerText;
    return ['drop', 'Alt+Shift', 'shortcut', 'keyboard', 'Ctrl', 'right-click', 'hover', 'mouse'].filter((w) => t.toLowerCase().includes(w.toLowerCase()));
  `);
  ergebnis.schritte.bedienung = r;
  console.log(`android bedienung: Optionen ${r.optionen.breite}/${r.optionen.scrollBreite}, kleine Ziele ${r.optionen.klein.length}, Desktop-Woerter ${JSON.stringify(r.desktopTexte)}`);
}

async function speicher() {
  ergebnis.schritte.speicher = { uebersprungen: 'braucht signierte XPI und Nutzerweg ohne geckodriver (spaeter)' };
  console.log('android speicher: uebersprungen');
}

const SCHRITTE = { apis, einstieg, schleier, pack, sticker, besuch, pause, bedienung, speicher };

// ---------- Ablauf ----------
try {
  server = await L.starteServer(starteFixtureServer);
  const paket = L.suchePaket(process.env.VEIL_AUSGABE ?? '.output-android');
  ergebnis.paket = paket.split('/').at(-1);
  const { driver: d, kennung } = await L.starteFahrer(paket);
  driver = d;
  ergebnis.kennung = kennung;
  ergebnis.firefox = (await driver.getCapabilities()).get('browserVersion');
  console.log(`android: Firefox ${ergebnis.firefox}, Erweiterung ${kennung} (${ergebnis.paket})`);
  for (const s of wahl) {
    if (!SCHRITTE[s]) {
      console.log(`android: Schritt ${s} noch nicht gebaut`);
      continue;
    }
    const t0 = Date.now();
    try {
      await SCHRITTE[s]();
      console.log(`android: Schritt ${s} fertig in ${Date.now() - t0} ms`);
    } catch (e) {
      code = 1;
      ergebnis.schritte[s] = { ...(ergebnis.schritte[s] ?? {}), fehler: String(e?.stack ?? e) };
      console.error(`android: Schritt ${s} ROT: ${e?.message ?? e}`);
      try { L.foto(`fehler-${s}`); } catch {}
    }
  }
} catch (e) {
  code = 1;
  console.error('android: Abbruch', e);
} finally {
  await L.schliesse(driver);
  for (const s of server) await new Promise((r) => s.close(r));
  L.raeumeWeiterleitungenAuf();
  console.log(`android: Ergebnis ${L.schreibeErgebnis(ergebnis)}`);
}
process.exit(code);
