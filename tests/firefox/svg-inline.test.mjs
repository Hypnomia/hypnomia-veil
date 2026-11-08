// Firefox: Bilder in Inline-SVG (<svg><image href|xlink:href>) laufen durch den Schleier (Nacht 18, Paket N1), Gegenstueck zu
// tests/chromium/svg-inline.spec.ts. Hide-first (eigener Waechter in tests/fixtures/svg-inline.html), Pruefung wie bei img (Treffer zensiert,
// Fassung schon beim Urteil gezeigt), Umgehungen (SMIL, sofort widerrufene blob:-Adresse) nie frei, Quellwechsel, Pause, eigenstaendiges
// SVG-Dokument. Einstellungen ueber das Ereignis veil-test (nur auf 127.0.0.1). Stumm gestartet (media.volume_scale 0.0) wie alle Firefox-Tests.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

setTimeout(() => {
  console.error('firefox svg-inline: Zeitlimit von 180 s ueberschritten');
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
  console.error(`firefox svg-inline: Paket fehlt: ${path.relative(wurzel, paket)} (zip:test:firefox)`);
  process.exit(1);
}
if (!testbilder) {
  const meldung = 'firefox svg-inline: ohne ../05 Testbilder';
  if (process.env.VEIL_OHNE_TESTBILDER === '1') {
    console.log(`${meldung}, uebersprungen`);
    process.exit(0);
  }
  console.error(meldung);
  process.exit(1);
}

const TREFFER = ['i-href', 'i-xlink', 'i-fremd', 'i-data', 'i-blob', 'i-shadow'];
const HARMLOS = ['i-sfw', 'i-sfw-xlink'];
const GESPERRT = ['i-smil', 'i-smil-fern', 'i-blob-weg'];
const ALLE = [...TREFFER, ...HARMLOS, ...GESPERRT];

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox svg-inline: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox svg-inline: FEHLER ${name}:`, fehler?.message ?? fehler);
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

// Zustand aller SVG-Bilder (auch in der offenen Shadow Root): Urteil, Quelle (href oder xlink:href), Deckkraft, Filter.
const lies = () =>
  driver.executeScript(`
    const XLINK = 'http://www.w3.org/1999/xlink';
    const bilder = [...document.querySelectorAll('image'), ...(document.getElementById('wirt')?.shadowRoot?.querySelectorAll('image') ?? [])]
      .filter((el) => el.namespaceURI === 'http://www.w3.org/2000/svg');
    return bilder.map((el) => {
      const stil = getComputedStyle(el);
      return { id: el.id, urteil: el.getAttribute('data-veil') ?? '', quelle: el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href') ?? '',
        hatHref: el.hasAttribute('href'), xlink: el.getAttributeNS(XLINK, 'href'), opacity: stil.opacity, filter: stil.filter };
    });`);
const svgWaechter = () => driver.executeScript('return { aufblitzen: window.__svgAufblitzen, proben: window.__svgProben, wer: window.__svgWer }');

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

async function oeffne() {
  await driver.get(`${basis}/svg-inline.html`);
  await bis('Testseite bereit', () => driver.executeScript("return document.documentElement.dataset.svgBereit === '1'"), 10_000);
}

// Pixelprobe im Augenblick des Urteils (Waechter der Testseite) gegen die eingesetzte Fassung, mittlere Abweichung je Kanal; dazu der Abstand
// Original gegen Fassung als Mass fuer die Trennschaerfe.
const zensurAbweichung = (ids) =>
  driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
    (async (liste) => {
      const aus = {};
      const wirt = document.getElementById('wirt')?.shadowRoot;
      const zeichne = async (src) => { const b = new Image(); b.src = src; await b.decode(); const k = document.createElement('canvas'); k.width = 64; k.height = 64;
        const x = k.getContext('2d'); x.drawImage(b, 0, 0, 64, 64); return x.getImageData(0, 0, 64, 64).data; };
      const abstand = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) s += Math.abs(a[i] - b[i]); return Math.round((s / ((a.length / 4) * 3)) * 100) / 100; };
      for (const id of liste) {
        const el = document.getElementById(id) ?? wirt?.getElementById(id);
        const probe = window.__svgZensurProbe[id];
        if (!el || probe === undefined) { aus[id] = 'keine Probe'; continue; }
        if (probe === 'verschmutzt') { aus[id] = 'verschmutzt'; continue; }
        const fassung = await zeichne(el.getAttribute('href'));
        aus[id] = abstand(fassung, probe);
        try { aus[id + ':original'] = abstand(await zeichne(window.__svgQuellen[id]), fassung); } catch { aus[id + ':original'] = 'nicht lesbar'; }
      }
      return aus;
    })(arguments[0]).then(fertig, (e) => fertig({ fehler: String(e) }));`,
    ids,
  );

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  console.log(`firefox svg-inline: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  await test('Hide-first: kein Bild in Inline-SVG ist ohne Urteil sichtbar, ein HTML-Element namens image bleibt sichtbar', async () => {
    await oeffne();
    await warte(3000);
    const w = await svgWaechter();
    console.log(`firefox svg-inline: Proben ${w.proben}, aufgeblitzt ${w.aufblitzen} ${w.wer.slice(0, 8).join(', ')}`);
    if (!(w.proben > 0)) throw new Error('keine Proben');
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal ohne Urteil sichtbar: ${w.wer.join(', ')}`);
    const html = await driver.executeScript("return getComputedStyle(document.getElementById('html-image')).opacity");
    if (html !== '1') throw new Error(`HTML-Element namens image: opacity ${html}`);
  });

  await test('Bilder in Inline-SVG werden geprueft: Treffer zensiert (Fassung schon beim Urteil gezeigt), harmlose frei', async () => {
    await oeffne();
    const urteile = await warteAufUrteile([...TREFFER, ...HARMLOS]);
    const quellen = await driver.executeScript('return window.__svgQuellen');
    for (const [id, b] of urteile) console.log(`firefox svg-inline: ${id} ${b.urteil} (${b.quelle.slice(0, 30)}, opacity ${b.opacity}, filter ${b.filter})`);
    for (const id of TREFFER) {
      const b = urteile.get(id);
      if (b.urteil !== 'zensiert') throw new Error(`${id}: Urteil "${b.urteil}"`);
      if (!/^data:image\//.test(b.quelle) || b.quelle === quellen[id]) throw new Error(`${id}: zensiert ohne eigene Fassung`);
    }
    for (const id of HARMLOS) if (urteile.get(id).urteil !== 'frei') throw new Error(`${id}: Urteil "${urteile.get(id).urteil}"`);
    for (const id of [...TREFFER, ...HARMLOS]) if (urteile.get(id).opacity !== '1') throw new Error(`${id}: opacity ${urteile.get(id).opacity} trotz Urteil`);
    const abweichung = await zensurAbweichung(TREFFER);
    console.log(`firefox svg-inline: Abweichung Probe beim Urteil gegen Fassung ${JSON.stringify(abweichung)}`);
    for (const id of TREFFER) if (!(typeof abweichung[id] === 'number' && abweichung[id] < 3)) throw new Error(`${id}: Probe beim Urteil ${abweichung[id]}`);
    const w = await svgWaechter();
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal aufgeblitzt: ${w.wer.join(', ')}`);
  });

  await test('Umgehungen (SMIL-Wechsel der Quelle, sofort widerrufene blob:-Adresse) sind zu keinem Zeitpunkt frei', async () => {
    await oeffne();
    const gesehen = new Map();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      for (const b of await lies()) {
        if (!GESPERRT.includes(b.id)) continue;
        if (!gesehen.has(b.id)) gesehen.set(b.id, new Set());
        gesehen.get(b.id).add(b.urteil || '-');
      }
      await warte(100);
    }
    console.log(`firefox svg-inline: Umgehungen ${JSON.stringify([...gesehen].map(([id, s]) => [id, [...s]]))}`);
    for (const id of GESPERRT) {
      const s = gesehen.get(id) ?? new Set();
      if (s.has('frei')) throw new Error(`${id} war frei`);
      if (!s.has('zensiert') && !s.has('verdeckt')) throw new Error(`${id} ohne Urteil`);
    }
    const w = await svgWaechter();
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal aufgeblitzt: ${w.wer.join(', ')}`);
  });

  await test('Quellwechsel nach "frei" (href und xlink:href) verbirgt sofort und prueft neu', async () => {
    await oeffne();
    await warteAufUrteile(HARMLOS);
    const direkt = await driver.executeAsyncScript(`
      const fertig = arguments[arguments.length - 1];
      const XLINK = 'http://www.w3.org/1999/xlink';
      document.getElementById('i-sfw').setAttribute('href', '/testbild/nsfw/IMG_0260.jpg?neu=1');
      document.getElementById('i-sfw-xlink').setAttributeNS(XLINK, 'xlink:href', '/testbild/nsfw/IMG_0260.jpg?neu=2');
      requestAnimationFrame(() => fertig(['i-sfw', 'i-sfw-xlink'].map((id) => (document.getElementById(id).getAttribute('data-veil') ?? '') + '|' + getComputedStyle(document.getElementById(id)).opacity)));`);
    console.log(`firefox svg-inline: nach Wechsel im naechsten Frame ${direkt.join(', ')}`);
    for (const d of direkt) if (d !== '|0') throw new Error(`nach dem Wechsel noch sichtbar: ${direkt.join(', ')}`);
    await bis(
      'neue Urteile nach dem Wechsel',
      async () => {
        const l = (await lies()).filter((b) => HARMLOS.includes(b.id));
        return l.every((b) => b.urteil === 'zensiert') ? l : null;
      },
      20_000,
    );
    const w = await svgWaechter();
    if (w.aufblitzen !== 0) throw new Error(`${w.aufblitzen} Mal aufgeblitzt: ${w.wer.join(', ')}`);
  });

  await test('Quellwechsel nur an xlink:href waehrend "zensiert": eigene Fassung geht sofort weg, neue Quelle wird geprueft', async () => {
    await oeffne();
    const vorher = await warteAufUrteile(['i-xlink']);
    if (vorher.get('i-xlink').urteil !== 'zensiert') throw new Error(`i-xlink vorher ${vorher.get('i-xlink').urteil}`);
    const direkt = await driver.executeAsyncScript(`
      const fertig = arguments[arguments.length - 1];
      const el = document.getElementById('i-xlink');
      el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '/synthetisch/7.png');
      requestAnimationFrame(() => fertig((el.getAttribute('data-veil') ?? '') + '|' + getComputedStyle(el).opacity + '|' + el.hasAttribute('href')));`);
    console.log(`firefox svg-inline: xlink-Wechsel im Zustand zensiert, naechster Frame ${direkt}`);
    if (direkt !== '|0|false') throw new Error(`naechster Frame: ${direkt}`);
    const b = await bis('i-xlink frei', async () => (await lies()).find((x) => x.id === 'i-xlink' && x.urteil === 'frei'), 15_000);
    if (b.hatHref || b.xlink !== '/synthetisch/7.png') throw new Error(`danach href ${b.hatHref}, xlink ${b.xlink}`);
  });

  await test('Pause gibt alle SVG-Bilder frei und stellt die Originale her, danach wieder beurteilt', async () => {
    await oeffne();
    const vorher = await warteAufUrteile(ALLE);
    try {
      await setze({ pause: true });
      await bis('Pause gilt', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === 'aus'"), 5000);
      const quellen = await driver.executeScript('return window.__svgQuellen');
      const inPause = await lies();
      if (inPause.length !== ALLE.length) throw new Error(`${inPause.length} SVG-Bilder`);
      for (const b of inPause) {
        if (b.urteil !== '') throw new Error(`${b.id}: Urteil "${b.urteil}" in der Pause`);
        if (b.opacity !== '1') throw new Error(`${b.id}: opacity ${b.opacity} in der Pause`);
        if (b.filter !== 'none') throw new Error(`${b.id}: filter ${b.filter} in der Pause`);
        if (b.quelle !== quellen[b.id]) throw new Error(`${b.id}: Original nicht zurueck`);
      }
      const x = inPause.find((b) => b.id === 'i-xlink');
      if (x.hatHref || x.xlink !== '/testbild/nsfw/IMG_0260.jpg') throw new Error(`i-xlink in der Pause: href ${x.hatHref}, xlink ${x.xlink}`);
    } finally {
      await setze({ pause: false });
    }
    await bis('Pause aus', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === null"), 5000);
    const danach = await warteAufUrteile(ALLE);
    for (const id of TREFFER) if (danach.get(id).urteil !== vorher.get(id).urteil) throw new Error(`${id}: nach der Pause ${danach.get(id).urteil}, vorher ${vorher.get(id).urteil}`);
    for (const id of GESPERRT) if (danach.get(id).urteil === 'frei') throw new Error(`${id} nach der Pause frei`);
  });

  // Eigenstaendiges SVG-Dokument (oben im Tab): Schleier wirkt, Pause gibt frei (Ausnahme in style.css als :root[data-veil-seite="aus"]).
  await test('Eigenstaendiges SVG-Dokument: geprueft, Pause gibt frei und stellt her', async () => {
    await driver.get(`${basis}/svg-dokument.svg`);
    const liesDok = () =>
      driver.executeScript(`return [...document.querySelectorAll('image')].map((el) => ({ id: el.id, urteil: el.getAttribute('data-veil') ?? '',
        quelle: el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '', opacity: getComputedStyle(el).opacity }));`);
    const fertig = async () => (await liesDok()).map((b) => b.urteil).join(',') === 'zensiert,frei';
    await bis('Urteile im SVG-Dokument', fertig, 20_000);
    const w = await driver.executeScript('return { aufblitzen: window.__svgAufblitzen, verborgen: window.__svgVerborgen }');
    console.log(`firefox svg-inline: SVG-Dokument Waechter ${JSON.stringify(w)}`);
    if (w.aufblitzen !== 0 || !(w.verborgen > 0)) throw new Error(`Hide-first im SVG-Dokument: ${JSON.stringify(w)}`);
    try {
      await setze({ pause: true });
      await bis('Pause gilt', () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite') === 'aus'"), 5000);
      const inPause = (await liesDok()).map((b) => `${b.id}|${b.urteil}|${b.opacity}|${b.quelle}`).join(',');
      console.log(`firefox svg-inline: SVG-Dokument in der Pause ${inPause.slice(0, 200)}`);
      if (inPause !== 'd-href||1|/testbild/nsfw/IMG_0260.jpg,d-sfw||1|/synthetisch/3.png') throw new Error(`in der Pause: ${inPause.slice(0, 200)}`);
    } finally {
      await setze({ pause: false });
    }
    await bis('Urteile nach der Pause', fertig, 20_000);
  });
  // SMIL-Umgehungen nach dem Urteil (Pruefer Runde 2): umlenken, einfuegen, spaete id. Danach im naechsten Frame nicht frei, dann verdeckt.
  for (const [art, id] of [['umlenken', 'i-umlenken'], ['spaet', 'i-spaet'], ['id', 'i-id']]) {
    await test(`SMIL-Umgehung nach "frei" (${art}): sofort nicht mehr frei, dann verdeckt`, async () => {
      await driver.get(`${basis}/svg-inline-smil.html`);
      await bis('drei frei', () => driver.executeScript("return [...document.querySelectorAll('image')].map((e) => e.getAttribute('data-veil') ?? '').join(',') === 'frei,frei,frei'"), 20_000);
      const direkt = await driver.executeAsyncScript(
        `const fertig = arguments[arguments.length - 1]; const [a, i] = [arguments[0], arguments[1]];
        window.umgehe(a);
        requestAnimationFrame(() => { const el = document.getElementById(i) ?? document.querySelector('.ohne-id'); fertig((el?.getAttribute('data-veil') ?? '') + '|' + (el ? getComputedStyle(el).opacity : '')); });`,
        art,
        id,
      );
      console.log(`firefox svg-inline: SMIL ${art}, naechster Frame ${direkt}`);
      if (direkt.startsWith('frei|')) throw new Error(`im naechsten Frame noch frei: ${direkt}`);
      const gesehen = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 3000) {
        gesehen.add(await driver.executeScript("return document.getElementById(arguments[0])?.getAttribute('data-veil') ?? ''", id));
        await warte(100);
      }
      console.log(`firefox svg-inline: SMIL ${art}, danach ${[...gesehen].join(',')}`);
      if (gesehen.has('frei')) throw new Error(`${id} wieder frei`);
      const ende = await driver.executeScript("return document.getElementById(arguments[0])?.getAttribute('data-veil') ?? ''", id);
      if (ende !== 'verdeckt') throw new Error(`${id} am Ende ${ende}`);
    });
  }
} finally {
  await driver?.quit().catch(() => {});
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox svg-inline: ${fehlerListe.length} Fehler`);
  process.exit(1);
}
console.log('firefox svg-inline: alles gruen');
process.exit(0);
