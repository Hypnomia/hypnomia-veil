// Firefox-Test: Shadow Roots ohne Aufblitzen (PHASE-3-BAUPLAN Auftrag R, R5) ueber geckodriver/WebDriver. Gleiche Faelle wie
// tests/chromium/wurzel.spec.ts. Das Seitenwelt-Skript (world MAIN in content_scripts) gibt es ab Firefox 128; VEIL_FIREFOX_BIN waehlt den Browser.
// Einstellungen (Pause) setzt die Seite ueber das CustomEvent `veil-test` (nur auf 127.0.0.1).
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

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
const portFremd = port + 2;
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const OHNE_TESTBILDER = process.env.VEIL_OHNE_TESTBILDER === '1';
const ZENSIERT = /^(zensiert|verdeckt)$/;
const NSFW = new Set([0, 3, 4]);

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:test:firefox)`);
  process.exit(1);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(150);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

function pruefe(bedingung, text) {
  if (!bedingung) throw new Error(text);
}

async function test(name, fn) {
  if (process.env.VEIL_NUR && !name.startsWith(process.env.VEIL_NUR)) return;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

const zustand = () => driver.executeScript('return window.testZustand()');
const seiteAttr = () => driver.executeScript("return document.documentElement.getAttribute('data-veil-seite')");
const setzePause = (an) => driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify({ einstellungen: { pause: an } }));

async function oeffne(modus) {
  await driver.get(`${basis}/schleier-spaet.html?modus=${modus}&bild=${encodeURIComponent(BILD)}`);
  await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 20_000);
}

const fehlende = (z) => {
  if (Object.keys(z).length < 12) return ['fehlt'];
  const aus = [];
  for (let n = 0; n < 6; n++) {
    if (NSFW.has(n) ? !ZENSIERT.test(z[`w-img-${n}`]?.urteil ?? '') : z[`w-img-${n}`]?.urteil !== 'frei') aus.push(`w-img-${n}`);
    if (z[`w-vid-${n}`]?.urteil !== 'frei') aus.push(`w-vid-${n}`);
  }
  return aus;
};

async function warteUrteile() {
  let letzte = [];
  await bis('Urteile', async () => {
    letzte = fehlende(await zustand());
    return letzte.length === 0;
  }, 40_000).catch(async (f) => {
    throw new Error(`${f.message} fehlend ${JSON.stringify(letzte)} Zustand ${JSON.stringify(await zustand())}`);
  });
}

async function waechterOk() {
  const [blitz, proben, wer] = await driver.executeScript('return [window.__aufblitzen, window.__proben, window.__wer]');
  pruefe(proben > 0, 'Waechter hat nie geprueft');
  pruefe(blitz === 0, `Waechter: ${blitz} Aufblitzen ${JSON.stringify(wer)}`);
}

const unverdaechtig = (z) => Object.values(z).filter((s) => s.urteil !== '' || s.deckkraft !== '1').length;

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));

  const liste = (await (await fetch(`${basis}/api/testbilder?satz=nsfw`)).json()).bilder;
  if (!liste.includes(BILD)) {
    if (!OHNE_TESTBILDER) throw new Error(`Testbild ${BILD} fehlt (../05 Testbilder/nsfw); ohne Testbilder nur mit VEIL_OHNE_TESTBILDER=1`);
    console.log('firefox: AUSNAHME VEIL_OHNE_TESTBILDER=1: Wurzel-Tests uebersprungen');
    process.exit(0);
  }

  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);
  await driver.execute(new Command('install addon').setParameter('path', paket).setParameter('temporary', true));

  for (const modus of ['komponenten', 'takt', 'eigener']) {
    await test(`${modus}: Wurzeln, die nach dem Einfuegen entstehen, zeigen nie ungeschuetzt Bild oder Video (offen und geschlossen)`, async () => {
      await oeffne(modus);
      await warteUrteile();
      await waechterOk();
      if (modus === 'eigener') pruefe((await driver.executeScript('return window.__eigeneAufrufe')) >= 6, 'Umhaenger der Seite lief nicht');
      const stile = await driver.executeScript('return Object.values(window.__wurzeln).map((w) => w.querySelectorAll("style").length)');
      pruefe(JSON.stringify(stile) === '[1,1,1,1,1,1]', `Stile je Wurzel ${JSON.stringify(stile)}`);
      const erste = await driver.executeScript('return Object.values(window.__ersteKinder)');
      pruefe(JSON.stringify(erste) === '[true,true,true,true,true,true]', `erstes Kind der Wurzel ${JSON.stringify(erste)}`);
    });
  }

  await test('innerHTML direkt nach attachShadow und Sekunden spaeter noch einmal: der Stil kommt zurueck, nichts blitzt auf (offen und geschlossen)', async () => {
    await oeffne('innerhtml');
    await warteUrteile();
    await waechterOk();
    await warte(2500);
    await driver.executeScript('window.nochmal()');
    await warteUrteile();
    await waechterOk();
    const stile = await driver.executeScript('return Object.values(window.__wurzeln).map((w) => w.querySelectorAll("style").length)');
    pruefe(JSON.stringify(stile) === '[1,1,1,1,1,1]', `Stile je Wurzel ${JSON.stringify(stile)}`);
  });

  // Asynchrones Skript in der Seite: der Rumpf darf await benutzen und liefert den Rueckgabewert.
  const asynchron = (rumpf) =>
    driver.executeAsyncScript(`const fertig = arguments[arguments.length - 1]; (async () => { ${rumpf} })().then(fertig, (e) => fertig({ fehler: String(e) }));`);
  // Schluessel sortiert vergleichen: geckodriver gibt Objekte in anderer Reihenfolge zurueck.
  const kanon = (x) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
  const gleich = (ist, soll, was) => pruefe(kanon(ist) === kanon(soll), `${was}: ${kanon(ist)} statt ${kanon(soll)}`);

  await test('Haken: nach attachShadow und einem Mikrotask ist das Bild verdeckt, adoptedStyleSheets bleibt unveraendert (offen und geschlossen)', async () => {
    await oeffne('manuell');
    const r = await asynchron(`
      const aus = {};
      for (const modus of ['open', 'closed']) {
        const h = document.createElement('div'); document.body.appendChild(h);
        await new Promise((f) => setTimeout(f, 0));
        const w = h.attachShadow({ mode: modus });
        const img = document.createElement('img'); img.width = 50; img.height = 50; img.src = '/synthetisch/50.png';
        w.appendChild(img);
        await Promise.resolve();
        aus[modus] = { deckkraft: getComputedStyle(img).opacity, blaetter: w.adoptedStyleSheets.length };
      }
      return aus;`);
    gleich(r, { open: { deckkraft: '0', blaetter: 0 }, closed: { deckkraft: '0', blaetter: 0 } }, 'Deckkraft');
  });

  await test('Haken: Host nicht eingefuegt, attachShadow, Mikrotask, innerHTML, Mikrotask: genau ein gekennzeichneter Stil am Ende; die Vorlage behaelt ihr erstes Kind', async () => {
    await oeffne('manuell');
    const r = await asynchron(`
      const aus = {};
      for (const modus of ['open', 'closed']) {
        const h = document.createElement('div');
        const w = h.attachShadow({ mode: modus });
        const sofort = w.querySelectorAll('style').length;
        await Promise.resolve();
        const nachAnlegen = w.querySelectorAll('style[data-veil-haken]').length;
        w.innerHTML = '<img id="r6" width="10" height="10">';
        const direkt = w.querySelectorAll('style').length;
        await Promise.resolve();
        const st = w.querySelectorAll('style[data-veil-haken]');
        aus[modus] = { sofort, nachAnlegen, direkt, genau: st.length, ende: w.lastElementChild === st[0] };
      }
      const h2 = document.createElement('div'); document.body.appendChild(h2);
      const w2 = h2.attachShadow({ mode: 'closed' });
      const eigenes = document.createElement('p'); w2.appendChild(eigenes);
      const erstes = w2.firstElementChild === eigenes;
      await Promise.resolve();
      aus.vorlage = { erstes, nochErstes: w2.firstElementChild === eigenes, ende: w2.lastElementChild && w2.lastElementChild.localName };
      return aus;`);
    gleich(
      r,
      {
        open: { sofort: 0, nachAnlegen: 1, direkt: 0, genau: 1, ende: true },
        closed: { sofort: 0, nachAnlegen: 1, direkt: 0, genau: 1, ende: true },
        vorlage: { erstes: true, nochErstes: true, ende: 'style' },
      },
      'Stil am Ende',
    );
  });

  await test('Haken: Pause und Ende der Pause schalten nicht uebernommene Stile (media), auch ohne den Schleier', async () => {
    await oeffne('manuell');
    const r = await asynchron(`
      const h = document.createElement('div');
      const w = h.attachShadow({ mode: 'open' });
      await Promise.resolve();
      const st = w.querySelector('style[data-veil-haken]');
      const aus = [st.media];
      document.documentElement.setAttribute('data-veil-seite', 'aus');
      await Promise.resolve();
      aus.push(st.media);
      document.documentElement.removeAttribute('data-veil-seite');
      await Promise.resolve();
      aus.push(st.media);
      document.documentElement.setAttribute('data-veil-seite', 'aus');
      const h2 = document.createElement('div');
      const w2 = h2.attachShadow({ mode: 'closed' });
      await Promise.resolve();
      aus.push(w2.querySelector('style[data-veil-haken]').media);
      document.documentElement.removeAttribute('data-veil-seite');
      return aus;`);
    gleich(r, ['', 'not all', '', 'not all'], 'media');
  });

  await test('Haken: gefaelschte Ereignisse der Seite aendern nichts', async () => {
    await oeffne('manuell');
    const r = await asynchron(`
      for (const n of ['veil-wurzeln-aus', 'veil-wurzeln-an', 'veil-wurzeln-ab', 'veil-wurzel']) {
        document.dispatchEvent(new Event(n));
        document.body.dispatchEvent(new Event(n, { bubbles: true, composed: true }));
      }
      const blind = document.createElement('div'); document.body.appendChild(blind);
      blind.dispatchEvent(new Event('veil-wurzel', { bubbles: true, composed: true }));
      const h = document.createElement('div'); document.body.appendChild(h);
      await new Promise((f) => setTimeout(f, 0));
      const w = h.attachShadow({ mode: 'closed' });
      const img = document.createElement('img'); img.width = 50; img.height = 50; img.src = '/synthetisch/53.png';
      w.appendChild(img);
      await Promise.resolve();
      return { danach: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };`);
    gleich(r, { danach: '0', stile: 1 }, 'nach gefaelschten Ereignissen');
  });

  await test('Haken: Pause mit innerHTML, der Inhalt bleibt sichtbar; danach gilt die Wurzel wie im Dokument', async () => {
    await oeffne('manuell');
    await setzePause(true);
    await bis('Pause gilt', async () => (await seiteAttr()) === 'aus', 10_000);
    const r = await asynchron(`
      const h = document.createElement('div'); h.id = 'host-pi'; document.body.appendChild(h);
      const w = h.attachShadow({ mode: 'closed' });
      window.__wurzeln['host-pi'] = w;
      const html = '<img id="w-img-pi" width="50" height="50" src="/synthetisch/54.png">';
      w.innerHTML = html;
      await Promise.resolve();
      const sichtbar = getComputedStyle(w.getElementById('w-img-pi')).opacity;
      w.innerHTML = html;
      await Promise.resolve();
      const b = w.getElementById('w-img-pi');
      return { sichtbar, nochmal: getComputedStyle(b).opacity, urteil: b.getAttribute('data-veil') };`);
    await setzePause(false);
    gleich(r, { sichtbar: '1', nochmal: '1', urteil: null }, 'Pause mit innerHTML');
    await bis('Bild der Wurzel frei', async () => (await zustand())['w-img-pi']?.urteil === 'frei', 30_000);
  });

  await test('Declarative Shadow DOM (Parser und setHTMLUnsafe): kein Aufblitzen, die Bilder werden beurteilt', async () => {
    await oeffne('dsd');
    await bis('Urteile', async () => {
      const z = await zustand();
      return z['w-img-dsd']?.urteil === 'frei' && ZENSIERT.test(z['w-img-dsd-n']?.urteil ?? '') && z['w-vid-dsd']?.urteil === 'frei';
    }, 40_000);
    await waechterOk();
    const geht = await driver.executeScript(`
      if (typeof document.body.setHTMLUnsafe !== 'function') return false;
      const d = document.createElement('div'); document.body.appendChild(d);
      d.setHTMLUnsafe('<div id="host-dsd2"><template shadowrootmode="open"><img id="w-img-dsd2" width="100" height="100" src="/synthetisch/55.png"></template></div>');
      window.__wurzeln['host-dsd2'] = document.getElementById('host-dsd2').shadowRoot;
      return true;`);
    if (geht) {
      await bis('DSD-Bild frei', async () => (await zustand())['w-img-dsd2']?.urteil === 'frei', 30_000);
      await waechterOk();
    } else {
      console.log('firefox: setHTMLUnsafe UEBERSPRUNGEN, der Browser kennt es nicht');
    }
  });

  // Grenze: Host nicht eingefuegt (allein der Haken) und eingefuegt (der Schleier uebernimmt den Stil sofort und sichert ihn selbst).
  for (const eingefuegt of [false, true]) {
    await test(`Grenze (${eingefuegt ? 'Schleier' : 'Haken'}): eine Seite, die fremde Kinder ihrer Wurzel sofort entfernt, wird gedrosselt, der Tab bleibt bedienbar`, async () => {
      await oeffne('manuell');
      await driver.executeScript(
        `const h = document.createElement('div'); if (arguments[0]) document.body.appendChild(h);
         const w = h.attachShadow({ mode: 'open' });
         window.__entfernt = 0;
         const eigenes = document.createElement('p'); eigenes.setAttribute('data-meins', ''); w.appendChild(eigenes);
         new MutationObserver((liste) => {
           for (const m of liste) for (const k of m.addedNodes) if (k instanceof Element && !k.hasAttribute('data-meins')) { k.remove(); window.__entfernt++; }
         }).observe(w, { childList: true });`,
        eingefuegt,
      );
      await warte(1500);
      const n1 = await driver.executeScript('return window.__entfernt');
      await warte(3000);
      const n2 = await driver.executeScript('return window.__entfernt');
      const attribut = eingefuegt ? 'data-veil-grenze' : 'data-veil-grenze-haken';
      const gezaehlt = await driver.executeScript('return document.documentElement.getAttribute(arguments[0])', attribut);
      console.log(`firefox: Grenze ${eingefuegt ? 'Schleier' : 'Haken'}, ${n1} Entfernungen nach 1,5 s, ${n2} nach 4,5 s, gezaehlt ${gezaehlt}`);
      pruefe(n1 >= 21, `Grenze nie erreicht: ${n1}`);
      pruefe(n2 - n1 <= 3 * 21 + 5, `nicht gedrosselt: ${n1} dann ${n2}`);
      pruefe(n2 > n1, `Wiedereinlegen am Ende des Fensters fehlt: ${n1} dann ${n2}`);
      pruefe(Number(gezaehlt) >= 1, `gedrosselte Wurzel nicht gezaehlt: ${gezaehlt}`);
    });
  }

  // Lebenszeichen: Fixture, die das Zeichen mit !important ueberschreibt (Firefox entfernt die CSS bei der Deinstallation, siehe letzter Test).
  await test('Lebenszeichen in der Pause: ohne --veil-lebt verschwinden nicht uebernommene Stile, neue Wurzeln bleiben unverdeckt', async () => {
    await oeffne('manuell');
    await setzePause(true);
    await bis('Pause gilt', async () => (await seiteAttr()) === 'aus', 10_000);
    await driver.executeScript(`
      for (const modus of ['open', 'closed']) {
        const h = document.createElement('div'); document.body.appendChild(h);
        window.__wurzeln['host-' + modus] = h.attachShadow({ mode: modus });
      }`);
    await warte(200);
    const zaehle = (sel) => driver.executeScript('return Object.values(window.__wurzeln).map((w) => w.querySelectorAll(arguments[0]).length)', sel);
    gleich(await zaehle('style[data-veil-haken]'), [1, 1], 'nicht uebernommene Stile in der Pause');
    await driver.executeScript("const s = document.createElement('style'); s.textContent = 'html { --veil-lebt: initial !important; }'; document.head.appendChild(s);");
    await bis('Stile weg', async () => JSON.stringify(await zaehle('style')) === '[0,0]', 6000);
    const neu = await asynchron(`
      const h = document.createElement('div'); document.body.appendChild(h);
      const w = h.attachShadow({ mode: 'closed' });
      const img = document.createElement('img'); img.width = 50; img.height = 50; img.src = '/synthetisch/56.png';
      w.appendChild(img);
      await Promise.resolve();
      return { danach: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };`);
    await setzePause(false); // die Einstellungen bleiben im Browser stehen: fuer die folgenden Faelle zuruecknehmen
    gleich(neu, { danach: '1', stile: 0 }, 'neue Wurzel ohne Lebenszeichen');
  });

  await test('Lebenszeichen im aktiven Zustand: uebernommene Stile werden abgeschaltet, neue Wurzeln bleiben unverdeckt; kehrt das Zeichen zurueck, laeuft der Haken wieder an', async () => {
    await oeffne('takt');
    await warteUrteile();
    const eigene = () =>
      driver.executeScript("return [0, 1, 2, 3, 4, 5].map((n) => { const st = window.__wurzeln['host-' + n].querySelector('style[data-veil-eigen]'); return st ? st.media : 'fehlt'; })");
    gleich(await eigene(), ['', '', '', '', '', ''], 'uebernommene Stile vorher');
    const neueWurzel = (id) =>
      asynchron(`
        const h = document.createElement('div'); document.body.appendChild(h);
        await new Promise((f) => setTimeout(f, 0));
        const w = h.attachShadow({ mode: 'closed' });
        window.__wurzeln['${id}'] = w;
        const img = document.createElement('img'); img.width = 50; img.height = 50; img.src = '/synthetisch/58.png';
        w.appendChild(img);
        await Promise.resolve();
        return { danach: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };`);
    await driver.executeScript("const s = document.createElement('style'); s.id = 'lebt-weg'; s.textContent = 'html { --veil-lebt: initial !important; }'; document.head.appendChild(s);");
    await bis('uebernommene Stile abgeschaltet', async () => JSON.stringify(await eigene()) === JSON.stringify(Array(6).fill('not all')), 6000);
    const imBestand = await asynchron(`
      const w = window.__wurzeln['host-1'];
      const img = document.createElement('img'); img.width = 50; img.height = 50; img.src = '/synthetisch/59.png';
      w.appendChild(img);
      await Promise.resolve();
      return getComputedStyle(img).opacity;`);
    pruefe(imBestand === '1', `Bild ohne Urteil in bestehender Wurzel: Deckkraft ${imBestand}`);
    gleich(await neueWurzel('host-schlaf'), { danach: '1', stile: 0 }, 'neue Wurzel im Schlaf');
    await driver.executeScript("document.getElementById('lebt-weg').remove()");
    await bis('Stile laufen wieder', async () => JSON.stringify(await eigene()) === JSON.stringify(Array(6).fill('')), 6000);
    gleich(await neueWurzel('host-wach'), { danach: '0', stile: 1 }, 'neue Wurzel nach der Rueckkehr');
  });

  await test('Pause vor dem Anlegen: der Inhalt der neuen Wurzeln ist sichtbar; zurueck aus der Pause gelten die Urteile', async () => {
    await oeffne('manuell');
    await setzePause(true);
    await bis('Pause gilt', async () => (await seiteAttr()) === 'aus', 10_000);
    await driver.executeScript('window.legeAn()');
    await bis('zwoelf Medien', async () => Object.keys(await zustand()).length === 12, 10_000);
    await warte(500);
    pruefe(unverdaechtig(await zustand()) === 0, `waehrend der Pause nicht sichtbar: ${JSON.stringify(await zustand())}`);
    await setzePause(false);
    await warteUrteile();
    await setzePause(true);
    await bis('Pause gilt', async () => (await seiteAttr()) === 'aus', 10_000);
    await bis('alles sichtbar', async () => unverdaechtig(await zustand()) === 0, 10_000);
    await setzePause(false);
    await warteUrteile();
  });

  await test('Pause nach dem Anlegen und zurueck: Wurzeln verhalten sich wie das Dokument', async () => {
    await oeffne('takt');
    await warteUrteile();
    await setzePause(true);
    await bis('Pause gilt', async () => (await seiteAttr()) === 'aus', 10_000);
    await bis('alles sichtbar', async () => unverdaechtig(await zustand()) === 0, 10_000);
    await driver.executeScript(`
      const h = document.createElement('div'); h.id = 'host-pause'; document.getElementById('buehne').appendChild(h);
      const w = h.attachShadow({ mode: 'closed' }); window.__wurzeln['host-pause'] = w;
      const b = document.createElement('img'); b.id = 'w-img-pause'; b.width = 240; b.height = 150; b.src = '/synthetisch/41.png'; w.appendChild(b);`);
    await warte(500);
    const waehrend = (await zustand())['w-img-pause'];
    pruefe(waehrend && waehrend.urteil === '' && waehrend.deckkraft === '1', `Wurzel waehrend der Pause: ${JSON.stringify(waehrend)}`);
    await setzePause(false);
    await bis('Bild der Pause-Wurzel frei', async () => (await zustand())['w-img-pause']?.urteil === 'frei', 30_000);
    await warteUrteile();
  });

  // Erweiterung entfernen, die Seite bleibt offen: die Manifest-CSS verschwindet samt Lebenszeichen (kein ctx.onInvalidated), der Haken schlaeft, auch
  // die schon uebernommenen Stile bestehender Wurzeln sind abgeschaltet. Zuletzt, der Rest braucht die Erweiterung.
  await test('Deinstallation bei offener Seite: bestehende Wurzeln werden abgeschaltet, neue bleiben unverdeckt', async () => {
    await oeffne('takt');
    await warteUrteile();
    const eigene = () =>
      driver.executeScript("return [0, 1, 2, 3, 4, 5].map((n) => { const st = window.__wurzeln['host-' + n].querySelector('style[data-veil-eigen]'); return st ? st.media : 'fehlt'; })");
    gleich(await eigene(), ['', '', '', '', '', ''], 'uebernommene Stile vorher');
    const vorher = await driver.executeScript("return getComputedStyle(document.documentElement).getPropertyValue('--veil-lebt').trim()");
    pruefe(vorher === '1', `Lebenszeichen vor der Deinstallation: ${JSON.stringify(vorher)}`);
    await driver.execute(new Command('uninstall addon').setParameter('id', 'veil@hypnomia'));
    await bis('Lebenszeichen weg', async () => (await driver.executeScript("return getComputedStyle(document.documentElement).getPropertyValue('--veil-lebt').trim()")) === '', 10_000);
    await bis('bestehende Stile abgeschaltet', async () => JSON.stringify(await eigene()) === JSON.stringify(Array(6).fill('not all')), 6000);
    const r = await asynchron(`
      const alt = window.__wurzeln['host-2'];
      const bild = document.createElement('img'); bild.width = 50; bild.height = 50; bild.src = '/synthetisch/57.png';
      alt.appendChild(bild);
      const h = document.createElement('div'); document.body.appendChild(h);
      const w = h.attachShadow({ mode: 'closed' });
      const img = document.createElement('img'); img.width = 50; img.height = 50; img.src = '/synthetisch/57.png';
      w.appendChild(img);
      await Promise.resolve();
      return { bestehend: getComputedStyle(bild).opacity, neu: getComputedStyle(img).opacity, stile: w.querySelectorAll('style').length };`);
    gleich(r, { bestehend: '1', neu: '1', stile: 0 }, 'nach der Deinstallation');
  });
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  fehlerListe.push('Aufbau');
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox: ${fehlerListe.length} Test(s) rot: ${fehlerListe.join('; ')}`);
  process.exit(1);
}
console.log('firefox: alle Wurzel-Tests gruen');
process.exit(0);
