// Messwerkzeug: Zeit bis der sichtbare Bereich frei ist (`sichtbarFreiMs` aus dem Testhaken `data-veil-status`), kein Produktcode.
// Aufruf: node scripts/messung/feed.mjs [--browser chromium|firefox|beide] [--satz sfw,nsfw] [--starts 3] [--md <Pfad>]
// kalt = erster Aufruf der Seite nach dem Browserstart (Erweiterung frisch geladen, Modell noch nicht warm),
// warm = dieselbe Seite danach noch einmal in einem neuen Tab. Seite: tests/fixtures/schleier-fotos.html?satz=<satz> (13 Bilder).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { starteChromium, starteFirefox } from './browser.mjs';
import { argumente, fasse, firefoxVersion, freierPort, paketJson, warte, wurzel, zeitstempel } from './hilfe.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const args = argumente();
const browserListe = args.browser === 'chromium' ? ['chromium'] : args.browser === 'firefox' ? ['firefox'] : ['chromium', 'firefox'];
const saetze = String(args.satz ?? 'sfw,nsfw').split(',');
const starts = Number(args.starts ?? 3);
const ERWARTET = 13; // Elemente der Seite, die der Schleier zaehlt (wie tests/*/schleier.*, Test f)
const dez = (v) => (v === null || v === undefined ? 'n/a' : String(v).replace('.', ','));

async function bis(beschreibung, lies, frist = 30_000) {
  const t0 = Date.now();
  let letzter = null;
  while (Date.now() - t0 < frist) {
    try {
      letzter = await lies();
      if (letzter) return letzter;
    } catch { /* Seite wechselt gerade */ }
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert ${JSON.stringify(letzter)})`);
}

const LIES_STATUS = "const r = document.documentElement.dataset.veilStatus; return r ? JSON.parse(r) : null";
// Zahl der beurteilten Elemente, die im Startausschnitt liegen, und die Fenstergroesse (zur Einordnung der Zeit).
const LIES_AUSSCHNITT = "const h = window.innerHeight, w = window.innerWidth; const l = [...document.querySelectorAll('[data-veil]')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < h && r.right > 0 && r.left < w; }); return { breite: w, hoehe: h, imAusschnitt: l.length }";
const fertigPruefung = (s) => (s && s.gesamt === ERWARTET && s.offen === 0 && s.sichtbarFreiMs !== null ? s : null);

async function messeChromium(b, url) {
  const messe = async () => {
    const seite = await b.context.newPage();
    try {
      const t0 = Date.now();
      await seite.goto(url);
      const s = await bis('Chromium Status', async () => fertigPruefung(await seite.evaluate(`(() => { ${LIES_STATUS} })()`)));
      const a = await seite.evaluate(`(() => { ${LIES_AUSSCHNITT} })()`);
      return { ...s, ...a, wandMs: Date.now() - t0 };
    } finally {
      await seite.close();
    }
  };
  const kalt = await messe();
  const warm = await messe();
  return { kalt, warm };
}

async function messeFirefox(b, url) {
  const d = b.driver;
  const messe = async () => {
    const t0 = Date.now();
    await d.get(url);
    const s = await bis('Firefox Status', async () => fertigPruefung(await d.executeScript(LIES_STATUS)));
    const a = await d.executeScript(LIES_AUSSCHNITT);
    return { ...s, ...a, wandMs: Date.now() - t0 };
  };
  const kalt = await messe();
  // Neuer Tab, alter Tab zu.
  const alt = await d.getWindowHandle();
  await d.switchTo().newWindow('tab');
  await d.switchTo().window(alt);
  await d.close();
  const handles = await d.getAllWindowHandles();
  await d.switchTo().window(handles[handles.length - 1]);
  const warm = await messe();
  return { kalt, warm };
}

const zaehlen = (s) => `${s.frei}/${s.zensiert}/${s.verdeckt}/${s.fehler}`;

async function haupt() {
  const port = await freierPort();
  const server = [await starteFixtureServer(port), await starteFixtureServer(port + 2)];
  const basis = `http://127.0.0.1:${port}`;
  const ergebnis = { meta: {}, messungen: [] };
  try {
    for (const browserArt of browserListe) {
      for (const satz of saetze) {
        const url = `${basis}/schleier-fotos.html?satz=${satz}`;
        const reihe = [];
        let version = '';
        for (let i = 1; i <= starts; i++) {
          const b = browserArt === 'chromium' ? await starteChromium() : await starteFirefox();
          try {
            version = b.version || version;
            const r = browserArt === 'chromium' ? await messeChromium(b, url) : await messeFirefox(b, url);
            reihe.push({ start: i, kalt: r.kalt, warm: r.warm });
            console.log(`${browserArt} ${satz} Start ${i}: kalt ${r.kalt.sichtbarFreiMs} ms (${zaehlen(r.kalt)}), warm ${r.warm.sichtbarFreiMs} ms (${zaehlen(r.warm)})`);
          } finally {
            await b.schliesse();
          }
        }
        ergebnis.messungen.push({ browser: browserArt, version: version || (browserArt === 'firefox' ? firefoxVersion() : ''), satz, reihe });
      }
    }
  } finally {
    for (const s of server) s.close();
  }
  ergebnis.meta = {
    werkzeug: 'scripts/messung/feed.mjs',
    befehl: `node scripts/messung/feed.mjs --browser ${args.browser ?? 'beide'} --satz ${saetze.join(',')} --starts ${starts}`,
    datum: new Date().toISOString(),
    paket: `${paketJson.name} ${paketJson.version}`,
    seite: 'tests/fixtures/schleier-fotos.html?satz=<satz>, 13 Elemente',
    starts,
  };
  const datei = path.join(hier, `ergebnis-feed-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);

  const md = [];
  md.push('| Browser | Satz | kalt Median ms (Spannweite) | warm Median ms (Spannweite) | Einzelwerte kalt | Einzelwerte warm |');
  md.push('|---|---|---|---|---|---|');
  for (const m of ergebnis.messungen) {
    const k = fasse(m.reihe.map((r) => r.kalt.sichtbarFreiMs), 0);
    const w = fasse(m.reihe.map((r) => r.warm.sichtbarFreiMs), 0);
    md.push(`| ${m.browser} ${m.version} | ${m.satz} | ${dez(k.median)} (${dez(k.min)} bis ${dez(k.max)}) | ${dez(w.median)} (${dez(w.min)} bis ${dez(w.max)}) | ${k.werte.join(', ')} | ${w.werte.join(', ')} |`);
  }
  md.push('');
  md.push('| Browser | Satz | Start | kalt: frei/zensiert/verdeckt/fehler | warm: frei/zensiert/verdeckt/fehler | Elemente im Startausschnitt (Fenster) | Ladezeit kalt (Wand, ms) |');
  md.push('|---|---|---|---|---|---|---|');
  for (const m of ergebnis.messungen) {
    for (const r of m.reihe) md.push(`| ${m.browser} | ${m.satz} | ${r.start} | ${zaehlen(r.kalt)} | ${zaehlen(r.warm)} | ${r.kalt.imAusschnitt} (${r.kalt.breite} x ${r.kalt.hoehe}) | ${r.kalt.wandMs} |`);
  }
  if (typeof args.md === 'string') await writeFile(args.md, md.join('\n'));
  console.log(md.join('\n'));
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
