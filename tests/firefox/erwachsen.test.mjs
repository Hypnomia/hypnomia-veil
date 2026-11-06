// Firefox-Test Phase 4, Auftrag E (PHASE-4-BAUPLAN Abschnitt 8): Vorschau-Tausch auf Erwachsenenseiten (Nachbauten, synthetische Bilder),
// Waechter 0 Aufblitzen, Pause stellt Originale zurueck, Lazy-Load, srcset und Quellwechsel, ohne Pack keine Aenderung, Erkennen am Inhalt
// (Testbilder aus ../05 Testbilder), Pack-Bilder ueber den Erkenner. Die Seiten laufen auf *.veil-erwachsen.test (nur im Testbau); Firefox
// loest die genauen Hosts ueber die Einstellung network.dns.localDomains auf (kein Platzhalter).
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

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
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const HOSTS = ['pornhub', 'xhamster', 'xvideos', 'xnxx', 'onlyfans', 'fansly', 'x'].map((n) => `${n}.veil-erwachsen.test`);
const seite = (name, datei) => `http://${name}.veil-erwachsen.test:${port}/${datei}`;

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
const uuid = randomUUID();
let hauptFenster;

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
  if (alle.length > 1 && !alle[0]?.startsWith?.('x')) {
    await driver.close();
  }
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

// Aktion auf einer Erweiterungsseite (Einstellungen setzen, Pack importieren), danach zurueck zur Webseite.
async function mitOptionen(fn) {
  await oeffneErweiterung('options.html');
  try {
    return await fn();
  } finally {
    await zurueckZumHaupt();
  }
}
const setzeEinstellungen = (neu) =>
  mitOptionen(() =>
    imSeitenkontext(
      `const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
       await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } });
       return true;`,
      neu,
    ),
  );
const loescheEinstellungen = () => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove('einstellungen'); return true;`));
const text = (css) => driver.findElement(By.css(css)).getText();
const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();

const importierePack = (pfad) =>
  mitOptionen(async () => {
    await driver.findElement(By.css('#datei')).sendKeys(pfad);
    await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
    await driver.findElement(By.css('#annehmen')).click();
    await bis('Erfolgsmeldung', async () => (await text('#meldung')).includes('The pack is in'));
  });
const entfernePack = () =>
  mitOptionen(async () => {
    await bis('Optionsseite da', async () => (await text('#pack-status').catch(() => '')).length > 0);
    await warte(300);
    if (await sichtbar('#entfernen')) {
      await driver.findElement(By.css('#entfernen')).click();
      await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
      await driver.findElement(By.css('#entfernen-ja')).click();
      await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));
    }
  });
const sendeAnErkenner = (nachricht) =>
  mitOptionen(() => imSeitenkontext(`const a = await api.runtime.sendMessage(args[0]); return JSON.parse(JSON.stringify(a));`, nachricht));

// Stand der Elemente einer Seite: Urteil, Quelle (Attribut), Hintergrund, Deckkraft.
const stand = (ids) =>
  driver.executeScript(
    (liste) =>
      liste.map((id) => {
        const el = document.getElementById(id);
        if (!el) return { id, veil: 'FEHLT', src: '', hg: '', opacity: '' };
        return {
          id,
          veil: el.getAttribute('data-veil'),
          src: el instanceof HTMLImageElement ? el.getAttribute('src') || '' : '',
          hg: el.style.getPropertyValue('background-image'),
          opacity: getComputedStyle(el).opacity,
        };
      }),
    ids,
  );
const istPackBild = (e) => e.veil === 'zensiert' && (e.src.startsWith('data:image/jpeg') || e.hg.includes('data:image/jpeg'));
const warteAufTausch = (ids, frist = 30_000) => bis(`Tausch ${ids.join(',')}`, async () => (await stand(ids)).every(istPackBild), frist);
const warteAufUrteile = (ids, frist = 30_000) => bis(`Urteile ${ids.join(',')}`, async () => (await stand(ids)).every((e) => e.veil !== null), frist);
const erwachsenStand = () =>
  driver.executeScript(() => JSON.parse(document.documentElement.getAttribute('data-veil-erwachsen') ?? 'null'));
const waechter = () => driver.executeScript(() => ({ aufblitzen: window.__aufblitzen, unsichtbar: window.__unsichtbar, proben: window.__proben, wer: window.__wer }));
const vorschauIds = (n) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

async function wirdOrtGetauscht(ort) {
  await driver.get(seite(ort.name, ort.datei));
  const ids = vorschauIds(ort.karten);
  await warteAufTausch(ids);
  const ersetzt = (await stand(ids)).filter(istPackBild).length;
  console.log(`firefox E ${ort.name}: ${ersetzt} von ${ids.length} Vorschaubildern ersetzt`);
  pruefe(ersetzt === ids.length, `${ort.name}: alle Vorschaubilder ersetzt`);
  await bis(`${ort.name}: Avatar frei`, async () => (await stand(['avatar']))[0].veil === 'frei', 20_000);
  pruefe(/^\/synthetisch\//.test((await stand(['avatar']))[0].src), `${ort.name}: Avatar behaelt seine Quelle`);
  if (ort.name !== 'onlyfans' && ort.name !== 'fansly') {
    await bis(`${ort.name}: Logo frei`, async () => (await stand(['logo']))[0].veil === 'frei', 20_000);
    pruefe(/^\/synthetisch\//.test((await stand(['logo']))[0].src), `${ort.name}: Logo behaelt seine Quelle`);
  }
  if (ort.name === 'onlyfans' || ort.name === 'fansly') {
    await bis(`${ort.name}: Avatar gross frei`, async () => (await stand(['avatar-gross']))[0].veil === 'frei', 20_000);
    pruefe(/^\/synthetisch\//.test((await stand(['avatar-gross']))[0].src), `${ort.name}: Avatar ab 80 px im Profil-Link bleibt`);
    await bis(`${ort.name}: Beitragsvideo hat ein Urteil`, async () => (await stand(['beitrag-video']))[0].veil !== null, 20_000);
  }
  pruefe(
    await driver.executeScript(() => Array.from(document.querySelectorAll('img.vorschau, .post-media img, .b-post__media img')).every((i) => i.hasAttribute('data-veil-ersetzt') && i.currentSrc.startsWith('data:image/jpeg'))),
    `${ort.name}: Kennzeichen data-veil-ersetzt und currentSrc ist das Pack-Bild`,
  );
  const h = (await stand(['h1']))[0];
  pruefe(h.veil === null && h.opacity === '0', `${ort.name}: Hover-Video ohne Urteil und unsichtbar (${JSON.stringify(h)})`);
  await warte(300);
  const w = await waechter();
  console.log(`firefox E ${ort.name}: Waechter ${w.proben} Proben, ${w.aufblitzen} Aufblitzen, ${w.unsichtbar} unsichtbar`);
  pruefe(w.aufblitzen === 0 && w.unsichtbar === 0, `${ort.name}: Waechter 0 Aufblitzen (${w.wer.join('; ')})`);
  const st = await erwachsenStand();
  pruefe(st && st.liste === ort.name && st.tausch === true && st.amInhalt === false, `${ort.name}: Status ${JSON.stringify(st)}`);
}

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-erwachsen-'));
  const voll = await baueDummyPack();
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, voll.bytes);
  const altPfad = path.join(ordner, 'alt.miapack');
  await writeFile(altPfad, (await baueDummyPack({ ohnePhase4: true, id: 'alt' })).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', HOSTS.join(','));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  hauptFenster = (await driver.getAllWindowHandles())[0];
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.setContext(firefox.Context.CHROME).catch(() => {});
  await driver.setContext(firefox.Context.CONTENT);
  await driver.executeScript('return 1'); // Kontext pruefen
  await driver.switchTo().window(hauptFenster);
  await driver.manage();
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  // 1. Ohne Pack: nichts aendert sich; packbild liefert nichts
  await warte(1500);
  await driver.get(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile([...vorschauIds(6), 'logo', 'avatar']);
  const ohne = await stand(vorschauIds(6));
  pruefe(ohne.every((e) => e.veil === 'frei' && /^\/synthetisch\/\d+\.png$/.test(e.src)), 'ohne Pack: Originale, Urteil frei');
  pruefe((await waechter()).aufblitzen === 0, 'ohne Pack: 0 Aufblitzen');
  const keins = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'x' });
  pruefe(keins && keins.ok === false, `ohne Pack: packbild vorschau ok false (${JSON.stringify(keins)})`);

  // 2. Pack importieren
  await importierePack(packPfad);
  console.log('firefox E: Pack importiert');

  // 3. Die Nachbauten
  for (const ort of [
    { name: 'pornhub', datei: 'erwachsen-pornhub.html', karten: 6 },
    { name: 'xhamster', datei: 'erwachsen-xhamster.html', karten: 6 },
    { name: 'xvideos', datei: 'erwachsen-xvideos.html', karten: 6 },
    { name: 'xnxx', datei: 'erwachsen-xvideos.html', karten: 6 },
    { name: 'onlyfans', datei: 'erwachsen-onlyfans.html', karten: 4 },
    { name: 'fansly', datei: 'erwachsen-fansly.html', karten: 4 },
  ]) {
    await wirdOrtGetauscht(ort);
  }

  // 4. Dynamisch
  await driver.get(seite('x', 'erwachsen-dynamisch.html'));
  const tausch = ['lazy', 'pimg', 'wechsel', 'hg', 'breit-img'];
  await warteAufTausch(tausch);
  await warte(1300);
  const lazy = (await stand(['lazy']))[0];
  pruefe(istPackBild(lazy), 'Lazy-Load: am Ende das Pack-Bild');
  const pic = await driver.executeScript(() => ({
    srcset: document.getElementById('pq').getAttribute('srcset'),
    srcsetImg: document.getElementById('pimg').getAttribute('srcset'),
    aktuell: document.getElementById('pimg').currentSrc.slice(0, 15),
  }));
  pruefe(pic.srcset === null && pic.srcsetImg === null && pic.aktuell === 'data:image/jpeg', `picture/srcset neutralisiert (${JSON.stringify(pic)})`);
  const hg = (await stand(['hg']))[0];
  pruefe(hg.veil === 'zensiert' && hg.hg.includes('data:image/jpeg'), 'Inline-Hintergrund getauscht');
  const kasten = await driver.executeScript(() => {
    const el = document.getElementById('breit-img');
    const r = el.getBoundingClientRect();
    return { b: r.width, h: r.height, fit: getComputedStyle(el).objectFit };
  });
  console.log(`firefox E: Flaeche ${kasten.b} x ${kasten.h}, object-fit ${kasten.fit}`);
  pruefe(kasten.fit === 'cover' && Math.abs(kasten.b / kasten.h - 4 / 3) < 0.02, 'Seitenverhaeltnis der Flaeche bleibt, object-fit cover');
  await bis('Sprite', async () => istPackBild((await stand(['spr']))[0]), 10_000);
  const sprite = await driver.executeScript(() => { const c = getComputedStyle(document.getElementById('spr')); return [c.backgroundImage.startsWith('url("data:image/jpeg'), c.backgroundPosition]; });
  pruefe(sprite[0] === true && sprite[1] === '50% 50%', `Sprite: berechneter Hintergrund getauscht (${JSON.stringify(sprite)})`);
  await bis('Shadow Root', () => driver.executeScript(() => { const i = document.getElementById('schatten').shadowRoot.getElementById('s-img'); return i.getAttribute('data-veil') === 'zensiert' && i.currentSrc.startsWith('data:image/jpeg'); }), 15_000);
  await bis('picture vor source', async () => istPackBild((await stand(['qimg']))[0]), 10_000);
  await driver.executeScript(() => window.fuegeSourceEin());
  await bis('eingefuegte source', () => driver.executeScript(() => { const i = document.getElementById('qimg'); return i.getAttribute('data-veil') === 'zensiert' && i.currentSrc.startsWith('data:image/jpeg'); }), 10_000);
  pruefe((await driver.executeScript(() => document.querySelector('#qpic source').getAttribute('srcset'))) === null, 'eingefuegte source ist neutralisiert');
  const stumm = (await stand(['stumm-video']))[0];
  pruefe(stumm.veil === null && stumm.opacity === '0', 'stummes Video im Link bleibt versteckt');
  await driver.executeScript(() => window.tonAn());
  await bis('Video mit Ton wird normal geprueft', async () => (await stand(['stumm-video']))[0].veil !== null, 15_000);
  await bis('Beitragsvideo mit Bedienelementen hat ein Urteil', async () => (await stand(['player-video']))[0].veil !== null, 15_000);
  await bis('Shadow Root am Link', () => driver.executeScript(() => { const i = document.getElementById('host2').shadowRoot.getElementById('s2-img'); return i.getAttribute('data-veil') === 'zensiert' && i.currentSrc.startsWith('data:image/jpeg'); }), 15_000);
  await driver.executeScript(() => window.rotiere());
  await bis('Rotation fertig', () => driver.executeScript(() => window.__rotFertig === true), 10_000);
  const rot = await driver.executeScript(() => window.__rotLog);
  const schlecht = rot.filter((x) => !x.startsWith('zensiert|data:image/jpeg|1'));
  console.log(`firefox E: Rotation ${rot.length} Proben, ${schlecht.length} davon nicht Pack-Bild`);
  pruefe(schlecht.length === 0, `Rotation: Karte bleibt das Pack-Bild (${schlecht.slice(0, 3).join('; ')})`);
  await warteAufUrteile(['klein', 'logo', 'frei-stehend', 'logo-abs', 'werbung']);
  pruefe((await stand(['logo-abs', 'werbung'])).every((e) => e.veil === 'frei' && /^\/synthetisch\//.test(e.src)), 'absoluter Startseiten-Link und fremde Werbung bleiben beim normalen Schleier');
  pruefe((await stand(['klein', 'logo', 'frei-stehend'])).every((e) => e.veil === 'frei' && /^\/synthetisch\//.test(e.src)), 'klein, Startseiten-Link, frei stehend: normaler Weg');
  const vorher = (await erwachsenStand()).abrufe;
  await driver.executeScript(() => window.wechsle());
  await warte(150);
  await bis('Quellwechsel getauscht', async () => istPackBild((await stand(['wechsel']))[0]));
  await driver.executeScript(() => window.fuegeGleicheEin(20));
  await bis('20 gleiche Bilder', () => driver.executeScript(() => Array.from(document.querySelectorAll('#gleiche img')).every((i) => (i.getAttribute('src') || '').startsWith('data:image/jpeg'))));
  const nachher = await erwachsenStand();
  console.log(`firefox E: Abrufe ${vorher} -> ${nachher.abrufe}, ${nachher.bilder} Bilder im Zwischenspeicher`);
  pruefe(nachher.abrufe - vorher <= 1 && nachher.bilder <= 4, 'gleiche Quelle ein Abruf, Zwischenspeicher klein');
  pruefe((await waechter()).aufblitzen === 0, 'dynamisch: 0 Aufblitzen');

  // 5. Pause
  await setzeEinstellungen({ pause: true });
  await bis('Pause: Seite aus', () => driver.executeScript(() => document.documentElement.getAttribute('data-veil-seite') === 'aus'), 10_000);
  const zurueck = await driver.executeScript(() => ({
    lazy: document.getElementById('lazy').getAttribute('src'),
    pimg: document.getElementById('pimg').getAttribute('src'),
    pq: document.getElementById('pq').getAttribute('srcset'),
    hg: document.getElementById('hg').style.getPropertyValue('background-image'),
    hgGroesse: document.getElementById('hg').style.getPropertyValue('background-size'),
    fit: document.getElementById('breit-img').style.getPropertyValue('object-fit'),
    ratio: document.getElementById('breit-img').style.getPropertyValue('aspect-ratio'),
  }));
  console.log(`firefox E: nach Pause ${JSON.stringify(zurueck)}`);
  pruefe(
    zurueck.lazy === '/synthetisch/31.png' && zurueck.pimg === '/synthetisch/34.png' && zurueck.pq === '/synthetisch/32.png 1x, /synthetisch/33.png 2x' &&
      zurueck.hg.includes('/synthetisch/37.png') && zurueck.hgGroesse === '' && zurueck.fit === '' && zurueck.ratio === '',
    'Pause stellt Originale und Stile zurueck',
  );
  await setzeEinstellungen({ pause: false });
  await warteAufTausch(tausch);
  pruefe((await waechter()).aufblitzen === 0, 'nach der Pause: 0 Aufblitzen');
  await loescheEinstellungen();

  // 6. Schalter aus
  await setzeEinstellungen({ erwachsen: { an: false, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] } });
  await driver.get(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(vorschauIds(6));
  const aus = await stand(vorschauIds(6));
  pruefe(aus.every((e) => e.veil === 'frei' && /^\/synthetisch\//.test(e.src)), `erwachsen.an aus: kein Tausch (${JSON.stringify(aus.map((e) => `${e.veil}:${e.src.slice(0, 20)}`))})`);
  await loescheEinstellungen();

  // 7. Pack-Bilder ueber den Erkenner
  const a1 = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'https://bilder.example/a.jpg' });
  const a2 = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: 'https://bilder.example/a.jpg' });
  pruefe(a1.ok && a1.dataUrl.startsWith('data:image/jpeg') && Math.max(a1.breite, a1.hoehe) <= 480 && a2.name === a1.name, 'packbild: JPEG bis 480 px, stabile Wahl');
  const chibi = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'jubeln' });
  pruefe(chibi.ok && chibi.name.includes('jubeln') && /^data:image\/(webp|png)/.test(chibi.dataUrl), `packbild: Chibi aus dem Pack (${chibi.ok ? chibi.name : chibi.fehler})`);
  const alpha = await mitOptionen(() =>
    imSeitenkontext(
      `const b = new Image(); b.src = args[0]; await b.decode();
       const c = document.createElement('canvas'); c.width = b.naturalWidth; c.height = b.naturalHeight;
       const ctx = c.getContext('2d'); ctx.drawImage(b, 0, 0);
       return { ecke: ctx.getImageData(0, 0, 1, 1).data[3], mitte: ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] };`,
      chibi.dataUrl,
    ),
  );
  pruefe(alpha.ecke === 0 && alpha.mitte === 255, `Chibi behaelt Transparenz (${JSON.stringify(alpha)})`);
  const unbekannt = await sendeAnErkenner({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'gibt-es-nicht' });
  pruefe(unbekannt.ok === false, 'packbild: unbekannte Pose ok false');

  // 8. Erkennen am Inhalt (Testbilder)
  if (OHNE_TESTBILDER) console.log('firefox E: Erkennen am Inhalt uebersprungen (VEIL_OHNE_TESTBILDER=1)');
  else {
    await driver.get(`${basis}/erwachsen-inhalt.html?satz=nsfw&n=16`);
    await bis('am Inhalt erkannt', async () => (await erwachsenStand())?.amInhalt === true, 150_000);
    const st = await erwachsenStand();
    console.log(`firefox E: am Inhalt erkannt nach ${JSON.stringify(st.zaehlung)}`);
    pruefe(st.liste === null && st.tausch === false && st.zaehlung.gesamt >= 12 && st.zaehlung.treffer / st.zaehlung.gesamt >= 0.5, 'am Inhalt erkannt, ohne Tausch');
    await driver.findElement(By.css('#wechsel')).click();
    await bis('Seitenwechsel: Erkennung neu', async () => (await erwachsenStand())?.amInhalt === false, 8_000);
    await driver.findElement(By.css('#neu')).click();
    await bis('neue Ansicht wird neu erkannt', async () => (await erwachsenStand())?.amInhalt === true, 150_000);
    await driver.get(`${basis}/erwachsen-inhalt.html?satz=sfw&n=16`);
    await bis('sfw gezaehlt', async () => ((await erwachsenStand())?.zaehlung?.gesamt ?? 0) >= 12, 150_000);
    pruefe((await erwachsenStand()).amInhalt === false, 'Satz sfw bleibt unauffaellig');
  }

  // 8b. Pack mit defektem Vorschaubild: kein Bild lesbar, normaler Schleier
  {
    const { default: sharp } = await import('sharp');
    const { bauePackAusOrdner } = await import('../../scripts/pack/baue-pack.mjs');
    const quelle = path.join(ordner, 'kaputt');
    await mkdir(path.join(quelle, 'vorschau'), { recursive: true });
    const voll = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 120, g: 30, b: 200 } } }).webp({ quality: 90 }).toBuffer();
    await writeFile(path.join(quelle, 'vorschau', 'kaputt.webp'), voll.subarray(0, Math.min(voll.length - 1, 40)));
    await writeFile(path.join(quelle, 'lizenz.txt'), 'Test pack, synthetic pictures only.\n');
    await writeFile(path.join(quelle, 'pack.json'), JSON.stringify({ id: 'kaputt', version: '0.0.1', titel: 'Broken test pack', lizenz: 'lizenz.txt', freischaltungen: ['erwachsen:vorschau'], dateien: [{ name: 'lizenz.txt' }, { name: 'vorschau/kaputt.webp', rolle: 'vorschau', stufe: 'hot' }] }));
    const kaputtPfad = path.join(ordner, 'kaputt.miapack');
    await writeFile(kaputtPfad, await bauePackAusOrdner(quelle));
    await entfernePack();
    await importierePack(kaputtPfad);
    await driver.get(seite('pornhub', 'erwachsen-kaputt.html'));
    await warteAufUrteile(['v1', 'v2'], 40_000);
    pruefe((await stand(['v1', 'v2'])).every((e) => e.veil === 'frei' && /^\/synthetisch\//.test(e.src)), 'defektes Vorschaubild: Urteil frei, Original bleibt');
    const k = await erwachsenStand();
    pruefe(k.fehlgeschlagen >= 1 && k.gruende.includes('kein Bild') && k.abrufe <= 2, `defektes Vorschaubild: als gescheitert gezaehlt, keine Schleife (${JSON.stringify(k)})`);
    await warte(500);
    pruefe((await waechter()).aufblitzen === 0, 'defektes Vorschaubild: 0 Aufblitzen');
  }

  // 9. Pack ohne Freischaltung (wie vor 0.4.0) und Pack entfernt
  await entfernePack();
  await importierePack(altPfad);
  await driver.get(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(vorschauIds(6));
  const alt = await erwachsenStand();
  pruefe((await stand(vorschauIds(6))).every((e) => /^\/synthetisch\//.test(e.src)) && alt.liste === 'pornhub' && alt.tausch === false, 'Pack ohne Vorschau-Freischaltung: kein Tausch');
  await entfernePack();
  await driver.get(seite('pornhub', 'erwachsen-pornhub.html'));
  await warteAufUrteile(vorschauIds(6));
  pruefe((await stand(vorschauIds(6))).every((e) => /^\/synthetisch\//.test(e.src)), 'Pack entfernt: Originale');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: erwachsen.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
