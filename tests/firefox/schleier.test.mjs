// Firefox-Test des Schleiers ueber geckodriver/WebDriver (PHASE-2-BAUPLAN Abschnitt 5, Punkt 8).
// Einstellungen setzt die Seite ueber das CustomEvent `veil-test` (nur auf 127.0.0.1), das das Content-Script in storage.local schreibt.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';

// Globaler Waechter: haengt irgendetwas, endet der Lauf nach 150 Sekunden mit Fehler.
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
const portFremd = port + 2; // zweiter Ursprung fuer fremde Bilder (die Fixture-Seiten rechnen ebenso: Port plus 2)
const basis = `http://127.0.0.1:${port}`;

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}

let letzterStatus = null;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerListe = [];
let driver;
const server = [];

// Fragt `fn` im Takt ab, bis es einen wahren Wert liefert (oder die Frist ablaeuft).
async function bis(beschreibung, fn, frist = 30_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)}, Status ${JSON.stringify(letzterStatus)})`);
}

const status = async () => {
  const roh = await driver.executeScript('return document.documentElement.dataset.veilStatus ?? null');
  return roh ? JSON.parse(roh) : null;
};
const waechter = () => driver.executeScript('return [window.__aufblitzen, window.__unsichtbar, window.__wer]');
const attribut = (name) => driver.executeScript(`return document.documentElement.getAttribute(arguments[0])`, name);

async function setze(einstellungen) {
  await driver.executeScript(
    "document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))",
    JSON.stringify({ einstellungen }),
  );
}

// Weitere Testhaken ueber veil-test (zum Beispiel zweiterVersuchMs).
async function setzeTest(detail) {
  await driver.executeScript("document.dispatchEvent(new CustomEvent('veil-test', { detail: arguments[0] }))", JSON.stringify(detail));
}

// Scrollt in Schritten ueber die ganze Seite, damit auch Firefox alle lazy-Bilder laedt (dort ist die Naehe zum Sichtbereich kleiner).
async function scrolleDurch() {
  const hoehe = await driver.executeScript('return document.body.scrollHeight');
  for (let y = 0; y <= hoehe; y += 300) {
    await driver.executeScript('window.scrollTo(0, arguments[0])', y);
    await warte(120);
  }
  await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
}

async function warteBeurteilt(n) {
  await bis(`${n} Elemente beurteilt`, async () => {
    const s = await status();
    letzterStatus = s;
    return s && s.gesamt === n && s.offen === 0 ? s : null;
  });
  return status();
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`firefox: OK     ${name} (${Date.now() - t0} ms)`);
  } catch (fehler) {
    console.error(`firefox: FEHLER ${name}:`, fehler?.message ?? fehler);
    fehlerListe.push(name);
  }
}

try {
  server.push(await starteFixtureServer(port));
  server.push(await starteFixtureServer(portFremd));
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 });
  await driver.installAddon(paket, true);

  const alleBilderSichtbar = () =>
    driver.executeScript("return [...document.querySelectorAll('img')].every((i) => getComputedStyle(i).opacity === '1')");
  const aufblitzen = async () => {
    const [blitz, unsichtbar, wer] = await waechter();
    const proben = await driver.executeScript('return window.__proben');
    if (unsichtbar !== 0) throw new Error(`${unsichtbar} Elemente mit Urteil, aber nicht opacity 1: ${JSON.stringify(wer)}`);
    return [blitz, proben, wer];
  };

  await test('a) opacity 0 vor dem Urteil, danach jedes Bild frei oder zensiert, kein Aufblitzen', async () => {
    await driver.get(`${basis}/schleier.html`);
    await bis('Status', status);
    await scrolleDurch();
    const s = await warteBeurteilt(16);
    if (s.frei + s.zensiert !== 16 || s.verdeckt !== 0) throw new Error(`Zaehlung ${JSON.stringify(s)}`);
    const ohne = await driver.executeScript(
      "return [...document.querySelectorAll('img')].filter((i) => !['frei', 'zensiert'].includes(i.dataset.veil ?? '')).length",
    );
    if (ohne !== 0) throw new Error(`${ohne} Bilder ohne Urteil`);
    const [blitz, proben, wer] = await aufblitzen();
    console.log(`firefox: ${proben} Proben, ${blitz} Aufblitzen ${JSON.stringify(wer)}`);
    if (blitz !== 0) throw new Error('Bilder waren vor dem Urteil sichtbar');
    const fertig = await bis('sichtbarFreiMs', async () => (await status()).sichtbarFreiMs);
    console.log(`firefox: sichtbarFreiMs ${fertig}, frei ${s.frei}, zensiert ${s.zensiert}`);
  });

  await test('b) Shadow Root (offen, geschlossen), Inline-Hintergrund und picture beurteilt', async () => {
    await driver.get(`${basis}/schleier.html`);
    for (const [name, js] of [
      ['offene Shadow Root', "return document.getElementById('shadow-offen').shadowRoot.querySelector('img').dataset.veil ?? ''"],
      ['Inline-Hintergrund', "return document.getElementById('hg').dataset.veil ?? ''"],
      ['picture', "return document.getElementById('pic').dataset.veil ?? ''"],
    ]) {
      await bis(name, async () => /^(frei|zensiert)$/.test(await driver.executeScript(js)));
    }
    // Die geschlossene Wurzel ist von der Seite nicht lesbar: der Status zaehlt ihr Bild mit (4 + 2 Wurzeln + Hintergrund + picture = 8).
    await bis('8 beurteilt', async () => {
      const s = await status();
      return s && s.frei + s.zensiert >= 8 && s.gesamt === 16;
    });
  });

  await test('c) eigene Ausnahme: Seite aus, opacity 1 ohne Wartezeit', async () => {
    await driver.get(`${basis}/schleier.html`);
    await bis('Status', status);
    await setze({ ausnahmen: ['127.0.0.1'] });
    await bis('Ausnahme gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    const t0 = Date.now();
    await driver.get(`${basis}/ausnahme.html`);
    await bis('seite aus nach Neuladen', async () => (await attribut('data-veil-seite')) === 'aus', 3000);
    console.log(`firefox: Ausnahme nach ${Date.now() - t0} ms (inklusive Laden der Seite)`);
    if (!(await alleBilderSichtbar())) throw new Error('Bilder nicht sichtbar');
    const n = await driver.executeScript("return document.querySelectorAll('[data-veil]').length");
    if (n !== 0) throw new Error(`${n} Elemente mit data-veil`);
    await setze({ ausnahmen: [] });
    await bis('Ausnahme aufgehoben', async () => (await attribut('data-veil-seite')) === null, 5000);
    await scrolleDurch();
    await warteBeurteilt(16);
  });

  await test('d) Pause: alles sichtbar, Pause aus: wieder beurteilt', async () => {
    await driver.get(`${basis}/schleier.html`);
    await bis('Status', status);
    await scrolleDurch();
    await warteBeurteilt(16);
    await setze({ pause: true });
    await bis('Pause gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    if (!(await alleBilderSichtbar())) throw new Error('Bilder in der Pause nicht sichtbar');
    const n = await driver.executeScript("return document.querySelectorAll('[data-veil]').length");
    if (n !== 0) throw new Error(`${n} Elemente mit data-veil in der Pause`);
    // Auch das Bild in der offenen Shadow Root ist in der Pause sichtbar.
    const wurzelOpacity = await driver.executeScript(
      "return getComputedStyle(document.getElementById('shadow-offen').shadowRoot.querySelector('img')).opacity",
    );
    if (wurzelOpacity !== '1') throw new Error(`Bild in der Shadow Root in der Pause: opacity ${wurzelOpacity}`);
    const daten = await driver.executeScript("return [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:')).length");
    if (daten !== 0) throw new Error('Originalquellen nicht wiederhergestellt');
    await setze({ pause: false });
    await bis('Pause aus', async () => (await attribut('data-veil-seite')) === null, 5000);
    await warteBeurteilt(16);
    const wurzelUrteil = await driver.executeScript("return document.getElementById('shadow-offen').shadowRoot.querySelector('img').dataset.veil ?? ''");
    if (!/^(frei|zensiert)$/.test(wurzelUrteil)) throw new Error(`Shadow-Root-Bild nach der Pause: ${wurzelUrteil}`);
  });

  await test('e) Strict: Seite wird nach der Beurteilung des Startausschnitts freigegeben', async () => {
    await driver.get(`${basis}/schleier.html`);
    await bis('Status', status);
    await setze({ strict: true });
    await bis('Strict gesetzt', async () => (await driver.executeScript("return document.documentElement.hasAttribute('data-veil-strict')")) === true, 5000);
    await driver.get(`${basis}/schleier.html`);
    await bis('Seite frei', async () => (await attribut('data-veil-seite')) === 'frei', 8000);
    await bis('seiteFreiMs', async () => (await status()).seiteFreiMs !== null, 3000);
    const s = await status();
    console.log(`firefox: Strict, seiteFreiMs ${s.seiteFreiMs}`);
    // Deutlich unter der Obergrenze von 4 s: die Seite wartet auf die Beurteilung des Startausschnitts, nicht auf die Frist.
    if (s.seiteFreiMs === null || s.seiteFreiMs >= 2500) throw new Error(`seiteFreiMs ${s.seiteFreiMs}`);
    // Vorher war die Seite unsichtbar und nie faelschlich sichtbar; jetzt ist sie frei.
    const strict = await driver.executeScript('return [window.__strictGesehen, window.__strictOffen, getComputedStyle(document.documentElement).opacity]');
    if (!(strict[0] > 0)) throw new Error('Seite war bei Strict nie unsichtbar');
    if (strict[1] !== 0) throw new Error(`Seite war bei Strict ${strict[1]} Mal faelschlich sichtbar`);
    if (strict[2] !== '1') throw new Error(`Seite nach Strict nicht sichtbar: opacity ${strict[2]}`);
    await setze({ strict: false });
    await bis('Strict aus', async () => (await driver.executeScript("return document.documentElement.hasAttribute('data-veil-strict')")) === false, 5000);
  });

  for (const satz of ['sfw', 'nsfw']) {
    await test(`f) Fotos (${satz}): alles beurteilt, nichts blitzt auf, Zensur tauscht die Quelle, Pause stellt wieder her`, async () => {
      await driver.get(`${basis}/schleier-fotos.html?satz=${satz}`);
      await bis('Fotos bereit', () => driver.executeScript('return document.documentElement.dataset.fotosBereit ?? null'), 10_000);
      const s = await warteBeurteilt(13);
      await bis('sichtbarFreiMs', async () => (await status()).sichtbarFreiMs);
      const fertig = await status();
      console.log(`firefox ${satz}: frei ${s.frei}, zensiert ${s.zensiert}, verdeckt ${s.verdeckt}, fehler ${s.fehler}, sichtbarFreiMs ${fertig.sichtbarFreiMs}`);
      const [blitz, , wer] = await aufblitzen();
      if (blitz !== 0) throw new Error(`Aufblitzen ${JSON.stringify(wer)}`);
      const z = await driver.executeScript(
        "const l = [...document.querySelectorAll('img[data-veil=zensiert]')]; return [l.length, l.every((i) => i.src.startsWith('data:image/jpeg')), l.every((i) => !i.hasAttribute('srcset'))]",
      );
      if (!z[1]) throw new Error('zensiertes Bild ohne Data-URL');
      if (satz === 'nsfw' && !(s.zensiert > 0 && z[0] > 0)) throw new Error('keine Zensur im NSFW-Satz');
      if (satz === 'sfw' && s.verdeckt !== 0) throw new Error('verdeckte Elemente im SFW-Satz');
      // Der Klassen-Hintergrund bleibt nach dem Urteil sichtbar.
      const klasseOpacity = await driver.executeScript("return getComputedStyle(document.getElementById('klasse')).opacity");
      if (klasseOpacity !== '1') throw new Error(`Klassen-Hintergrund opacity ${klasseOpacity}`);
      const karussell = await driver.executeScript("return document.getElementById('karussell').dataset.veil ?? ''");
      if (!/^(frei|zensiert)$/.test(karussell)) throw new Error(`Karussell: ${karussell}`);
      await setze({ pause: true });
      await bis('Pause gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
      const nachPause = await driver.executeScript(
        "return [[...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:')).length, document.querySelectorAll('[data-veil]').length, document.getElementById('klasse').style.backgroundImage]",
      );
      if (nachPause[0] !== 0 || nachPause[1] !== 0 || nachPause[2] !== '') throw new Error(`nach der Pause nicht zurueckgesetzt: ${JSON.stringify(nachPause)}`);
      await setze({ pause: false });
      const danach = await warteBeurteilt(13);
      if (danach.zensiert !== s.zensiert) throw new Error(`Zensur nach der Pause ${danach.zensiert}, vorher ${s.zensiert}`);
      await setze({ pause: false });
    });
  }

  // Strenge Seitenrichtlinie (kein data:, keine Inline-Stile): nichts darf aufblitzen, auch nicht in der Shadow Root.
  for (const satz of ['sfw', 'nsfw']) {
    await test(`g) strenge CSP (${satz}): nichts blitzt auf, alles bekommt ein Urteil`, async () => {
      await driver.get(`${basis}/schleier-csp.html?satz=${satz}`);
      await bis('Fotos bereit', () => driver.executeScript('return document.documentElement.dataset.fotosBereit ?? null'), 10_000);
      const s = await warteBeurteilt(5);
      console.log(`firefox CSP ${satz}: frei ${s.frei}, zensiert ${s.zensiert}, verdeckt ${s.verdeckt}`);
      const [blitz, , wer] = await aufblitzen();
      if (blitz !== 0) throw new Error(`Aufblitzen ${JSON.stringify(wer)}`);
    });
  }

  await test('h) Canvas und Video: lesbar und ohne Treffer werden freigegeben, kleine Canvas sofort, Video ohne Daten unscharf statt unsichtbar', async () => {
    await driver.get(`${basis}/schleier-medien.html`);
    await bis('Film bereit', () => driver.executeScript('return document.documentElement.dataset.filmBereit ?? null'), 15_000);
    // Canvas, kleines Canvas, Video, Video mit preload none = 4.
    const s = await warteBeurteilt(4);
    console.log(`firefox Medien: frei ${s.frei}, zensiert ${s.zensiert}, verdeckt ${s.verdeckt}`);
    const urteile = await driver.executeScript("return ['zeichnung', 'klein', 'film', 'film-leer'].map((id) => document.getElementById(id).dataset.veil)");
    if (JSON.stringify(urteile) !== JSON.stringify(['frei', 'frei', 'frei', 'verdeckt'])) throw new Error(`Urteile ${JSON.stringify(urteile)}`);
    const leer = await driver.executeScript("const st = getComputedStyle(document.getElementById('film-leer')); return [st.opacity, st.filter]");
    if (leer[0] !== '1' || !leer[1].includes('blur')) throw new Error(`Video ohne Daten: opacity ${leer[0]}, filter ${leer[1]}`);
    // Beim Abspielen kommen Daten: richtig geprueft, dann frei.
    await driver.executeScript('window.filmLeerStarten()');
    await bis('Video frei nach dem Abspielen', async () => (await driver.executeScript("return document.getElementById('film-leer').dataset.veil ?? ''")) === 'frei', 20_000);
    const [blitz, , wer] = await aufblitzen();
    if (blitz !== 0) throw new Error(`Aufblitzen ${JSON.stringify(wer)}`);
  });

  // Klassen-Hintergrund mit Zensur: das Element bekommt data-veil="zensiert" und bleibt samt Text sichtbar.
  await test('j) Klassen-Hintergrund wird zensiert und bleibt sichtbar (nsfw)', async () => {
    await driver.get(`${basis}/schleier-fotos.html?satz=nsfw`);
    await bis('Fotos bereit', () => driver.executeScript('return document.documentElement.dataset.fotosBereit ?? null'), 10_000);
    await warteBeurteilt(13);
    const pfad = await driver.executeScript("const i = document.querySelector('img[data-veil=\"zensiert\"][data-pfad]'); return i ? i.dataset.pfad : null");
    if (!pfad) throw new Error('kein zensiertes Foto mit Pfad');
    await driver.executeScript('window.fuegeKlasseEin(arguments[0])', pfad);
    await bis('klasse2 zensiert', async () => (await driver.executeScript("return document.getElementById('klasse2').dataset.veil ?? ''")) === 'zensiert', 30_000);
    const k = await driver.executeScript(
      `const e = document.getElementById('klasse2'); return [getComputedStyle(e).opacity, e.style.backgroundImage.startsWith('url("data:image/jpeg'), e.textContent]`,
    );
    if (k[0] !== '1') throw new Error(`klasse2 opacity ${k[0]}`);
    if (k[1] !== true) throw new Error(`klasse2 Hintergrund ${k[1]}`);
    if (k[2] !== 'Text im Klassen-Hintergrund') throw new Error('Text fehlt');
    const [blitz, , wer] = await aufblitzen();
    if (blitz !== 0) throw new Error(`Aufblitzen ${JSON.stringify(wer)}`);
    await setze({ pause: true });
    await bis('Pause gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    const nach = await driver.executeScript("const e = document.getElementById('klasse2'); return [e.style.backgroundImage, e.dataset.veil ?? '']");
    if (nach[0] !== '' || nach[1] !== '') throw new Error(`klasse2 nach der Pause: ${JSON.stringify(nach)}`);
    await setze({ pause: false });
  });

  // Fehlerpfade des Nachladens (Entscheidung 21): fremder Klassen-Hintergrund auf dem zweiten Ursprung. Das ist in Firefox auch der
  // Weg quelle.art = 'url' (der Erkenner laedt selbst, erst ohne Referer, bei 403 mit Referer-Regel).
  for (const modus of ['nurReferer', 'immer403']) {
    await test(`k) Fehlerpfad ${modus}: fremder Klassen-Hintergrund`, async () => {
      await driver.get(`${basis}/schleier-fehler.html?modus=${modus}`);
      await bis('Status', status);
      await setzeTest({ zweiterVersuchMs: 1500 });
      await driver.executeScript('window.fuegeEin()');
      const zeile = async () => {
        const s = await status();
        letzterStatus = s;
        return s ? `${s.gesamt}/${s.offen}/${s.fehler}/${s.verdeckt}` : '';
      };
      const feld = () =>
        driver.executeScript(
          "const e = document.getElementById('fremd'); const st = getComputedStyle(e); return [e.dataset.veil ?? '', st.opacity, st.filter, e.hasAttribute('data-veil-hg'), st.backgroundImage, e.textContent]",
        );
      if (modus === 'nurReferer') {
        await bis('beurteilt ohne Fehler', async () => (await zeile()) === '1/0/0/0');
        const s = await status();
        if (s.frei + s.zensiert !== 1) throw new Error(`Zaehlung ${JSON.stringify(s)}`);
        if ((await feld())[2] !== 'none') throw new Error('Hintergrund unscharf');
      } else {
        await bis('erster Fehler', async () => (await zeile()).startsWith('1/1/1/0'));
        if ((await feld())[0] !== '') throw new Error('schon vor dem zweiten Versuch verdeckt');
        await bis('nach dem zweiten Versuch verdeckt', async () => (await zeile()) === '1/0/2/1');
        const f = await feld();
        // Ein Klassen-Hintergrund verliert nur den Hintergrund: sichtbar, scharf, Text bleibt.
        if (f[0] !== 'verdeckt' || f[1] !== '1' || f[2] !== 'none' || f[3] !== true || f[4] !== 'none' || f[5] !== 'Fremder Hintergrund') {
          throw new Error(`Feld ${JSON.stringify(f)}`);
        }
      }
      const [, unsichtbar, wer] = await waechter();
      if (unsichtbar !== 0) throw new Error(`unsichtbar: ${JSON.stringify(wer)}`);
    });
  }

  // Hintergrund ueber CSS-Variablen (Kurzform und Langform): die Langform des Style-Objekts liest leer, das Element muss trotzdem beurteilt
  // werden. Ein zensiertes Foto (nsfw) beweist, dass wirklich geprueft wurde.
  await test('m) Hintergrund per var(): wird beurteilt und zensiert, Pause stellt wieder her (nsfw)', async () => {
    await driver.get(`${basis}/schleier-fotos.html?satz=nsfw`);
    await bis('Fotos bereit', () => driver.executeScript('return document.documentElement.dataset.fotosBereit ?? null'), 10_000);
    await warteBeurteilt(13);
    const pfad = await driver.executeScript("const i = document.querySelector('img[data-veil=\"zensiert\"][data-pfad]'); return i ? i.dataset.pfad : null");
    if (!pfad) throw new Error('kein zensiertes Foto mit Pfad');
    await driver.get(`${basis}/schleier-var.html`);
    await bis('Status', status);
    await driver.executeScript('window.fuegeVarEin(arguments[0])', pfad);
    const lese = () =>
      driver.executeScript(
        `return ['var-kurz', 'var-lang'].map((id) => { const e = document.getElementById(id); const st = getComputedStyle(e); return [e.dataset.veil ?? '', st.backgroundImage.startsWith('url("data:image/jpeg'), st.opacity]; })`,
      );
    await bis('beide zensiert', async () => (await lese()).map((e) => e[0]).join(',') === 'zensiert,zensiert', 30_000);
    for (const e of await lese()) if (e[1] !== true || e[2] !== '1') throw new Error(`var-Element nach der Zensur: ${JSON.stringify(e)}`);
    // Der Status wird mit kleiner Verzoegerung geschrieben: darauf warten, nicht einmal lesen.
    await warteBeurteilt(2);
    const [blitz, , wer] = await aufblitzen();
    if (blitz !== 0) throw new Error(`Aufblitzen ${JSON.stringify(wer)}`);
    await setze({ pause: true });
    await bis('Pause gilt', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    const nach = await driver.executeScript(
      `return ['var-kurz', 'var-lang'].map((id) => { const e = document.getElementById(id); return [e.dataset.veil ?? '', e.getAttribute('style'), getComputedStyle(e).backgroundImage]; })`,
    );
    for (const e of nach) {
      if (e[0] !== '' || !e[1].includes('var(--b)') || !e[2].includes('/testbild/nsfw/')) throw new Error(`var-Element nach der Pause: ${JSON.stringify(e)}`);
    }
    await setze({ pause: false });
  });

  // Inline-Hintergrund auf einem fensterfuellenden Container, dessen Abruf immer scheitert: bei endgueltiger Verdeckung faellt nur der
  // Hintergrund weg, Text bleibt lesbar (kein Blur ueber die ganze Seite).
  await test('n) grosser Inline-Hintergrund-Container: bei Verdeckung nur der Hintergrund weg, kein Blur', async () => {
    await driver.get(`${basis}/schleier-var.html`);
    await bis('Status', status);
    await setzeTest({ zweiterVersuchMs: 1500 });
    await driver.executeScript('window.fuegeGrossEin()');
    await bis('verdeckt nach zwei Versuchen', async () => {
      const s = await status();
      letzterStatus = s;
      return s && `${s.gesamt}/${s.offen}/${s.fehler}/${s.verdeckt}` === '1/0/2/1';
    });
    const g = await driver.executeScript(
      "const e = document.getElementById('gross'); const st = getComputedStyle(e); return [e.dataset.veil ?? '', e.hasAttribute('data-veil-hg'), st.opacity, st.filter, st.backgroundImage, e.textContent]",
    );
    if (JSON.stringify(g) !== JSON.stringify(['verdeckt', true, '1', 'none', 'none', 'Text im grossen Container'])) throw new Error(`Container ${JSON.stringify(g)}`);
    const [, unsichtbar, wer] = await waechter();
    if (unsichtbar !== 0) throw new Error(`unsichtbar: ${JSON.stringify(wer)}`);
  });

  // Eigene Ausnahmen gelten je Tab: Seite auf localhost, Rahmen auf 127.0.0.1.
  await test('l) Ausnahme gilt je Tab, auch im eingebetteten Rahmen', async () => {
    await driver.get(`${basis}/schleier.html`);
    await bis('Status', status);
    await setze({ ausnahmen: ['localhost'] });
    await warte(500);
    await driver.get(`http://localhost:${port}/rahmen.html`);
    await bis('Seite aus', async () => (await attribut('data-veil-seite')) === 'aus', 5000);
    const rahmen = await driver.findElement({ css: '#rahmen' });
    await driver.switchTo().frame(rahmen);
    try {
      await bis('Rahmen aus', async () => (await attribut('data-veil-seite')) === 'aus', 8000);
      if (!(await alleBilderSichtbar())) throw new Error('Bilder im Rahmen nicht sichtbar');
      await setze({ ausnahmen: [] });
      await bis('Rahmen wieder an', async () => (await attribut('data-veil-seite')) === null, 5000);
    } finally {
      await driver.switchTo().defaultContent();
    }
    await setze({ ausnahmen: [] });
  });
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  fehlerListe.push('Aufbau');
} finally {
  if (driver) {
    await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  }
  for (const s of server) s.close();
}
if (fehlerListe.length) {
  console.error(`firefox: ${fehlerListe.length} Test(s) rot: ${fehlerListe.join('; ')}`);
  process.exit(1);
}
console.log('firefox: alle Schleier-Tests gruen');
process.exit(0);
