// Messwerkzeug: Kaltstart des Erkenners (`status.kaltstartMs`), kein Produktcode.
// Aufruf: node scripts/messung/kaltstart.mjs [--browser chromium|firefox|beide] [--starts 3] [--md <Pfad>]
// Chromium: `status` aus dem Service Worker an das Offscreen-Dokument. Firefox: `status` von einer Erweiterungsseite
// (moz-extension://<uuid>/popup.html) an das Hintergrundskript, in dem der Erkenner laeuft. `kaltstartMs` misst der Erkenner selbst
// (Modell laden, Session bauen, ein Leerbild rechnen); `bereitNachMs` ist die Wandzeit ab Start der Erweiterung (Chromium: ab Erscheinen
// des Service Workers, Firefox: ab Ende der Installation) bis `bereit` wahr ist.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteChromium, starteFirefox } from './browser.mjs';
import { argumente, fasse, firefoxVersion, paketJson, warte, wurzel, zeitstempel } from './hilfe.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const args = argumente();
const browserListe = args.browser === 'chromium' ? ['chromium'] : args.browser === 'firefox' ? ['firefox'] : ['chromium', 'firefox'];
const starts = Number(args.starts ?? 3);
const dez = (v) => (v === null || v === undefined ? 'n/a' : String(v).replace('.', ','));

async function haupt() {
  const ergebnis = { meta: {}, messungen: [] };
  for (const browserArt of browserListe) {
    const reihe = [];
    let version = '';
    for (let i = 1; i <= starts; i++) {
      const t0 = Date.now();
      const b = browserArt === 'chromium' ? await starteChromium() : await starteFirefox();
      try {
        version = b.version || version;
        const tErweiterung = Date.now();
        let status = null;
        for (let n = 0; n < 600; n++) {
          try {
            const w = await b.sende({ ziel: 'erkenner', typ: 'status' });
            if (w?.ok && w.bereit && typeof w.kaltstartMs === 'number') { status = w; break; }
          } catch { /* Hintergrund noch nicht bereit */ }
          await warte(50);
        }
        if (!status) throw new Error('Erkenner wurde nicht bereit');
        const r = { start: i, kaltstartMs: status.kaltstartMs, bereitNachMs: Date.now() - tErweiterung, browserStartMs: tErweiterung - t0, modell: status.modell, laeufe: status.laeufe };
        reihe.push(r);
        console.log(`${browserArt} Start ${i}: kaltstartMs ${r.kaltstartMs}, bereit nach ${r.bereitNachMs} ms (Browser-Start ${r.browserStartMs} ms)`);
      } finally {
        await b.schliesse();
      }
    }
    ergebnis.messungen.push({ browser: browserArt, version: version || (browserArt === 'firefox' ? firefoxVersion() : ''), reihe });
  }
  ergebnis.meta = {
    werkzeug: 'scripts/messung/kaltstart.mjs',
    befehl: `node scripts/messung/kaltstart.mjs --browser ${args.browser ?? 'beide'} --starts ${starts}`,
    datum: new Date().toISOString(),
    paket: `${paketJson.name} ${paketJson.version}`,
    starts,
  };
  const datei = path.join(hier, `ergebnis-kaltstart-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);
  const md = ['| Browser | `kaltstartMs` Median (Spannweite) | Einzelwerte | bereit nach Median (Spannweite), Wandzeit ms |', '|---|---|---|---|'];
  for (const m of ergebnis.messungen) {
    const k = fasse(m.reihe.map((r) => r.kaltstartMs), 0);
    const w = fasse(m.reihe.map((r) => r.bereitNachMs), 0);
    md.push(`| ${m.browser} ${m.version} | ${dez(k.median)} (${dez(k.min)} bis ${dez(k.max)}) | ${k.werte.join(', ')} | ${dez(w.median)} (${dez(w.min)} bis ${dez(w.max)}) |`);
  }
  if (typeof args.md === 'string') await writeFile(args.md, md.join('\n'));
  console.log(md.join('\n'));
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
