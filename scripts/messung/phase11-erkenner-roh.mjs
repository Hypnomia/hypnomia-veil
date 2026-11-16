// Messwerkzeug Phase 11 (0c und 0e), kein Produktcode: holt die Rohtreffer des Produkt-Erkenners (320n plus YuNet) fuer alle Bilder
// eines Satzes, alle zehn Zonen an, Schwelle 0,10 (Standard und Minimum). Die Auswertung (Flaechen, Raten) rechnet
// phase11-erkenner-auswertung.mjs offline aus diesen Rohdaten; ein Lauf bei Schwelle 0,25 ist exakt das Filtern nach Sicherheit ab 0,25
// (NMS laeuft von hoch nach tief, tiefe Treffer verdraengen nie hohe).
// Aufruf: node scripts/messung/phase11-erkenner-roh.mjs --satz testbilder|pack --browser chromium|firefox [--aus <ordner>]
// Testbilder kommen vom Fixture-Server (../05 Testbilder), Pack-Bilder werden als data-URL gelesen (../02 Assets Mia/pack-1.0/vorschau, nur lesen).
// Ausgabe: <aus>/roh-<satz>-<browser>.json (Dateinamen, Klasse als Zone plus bedeckt, Sicherheit, Box; keine Bilder).
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { starteChromium, starteFirefox } from './browser.mjs';
import { argumente, firefoxVersion, holeJson, paketJson, wurzel, warte } from './hilfe.mjs';

const args = argumente();
const satz = args.satz === 'pack' ? 'pack' : 'testbilder';
const browserArt = args.browser === 'firefox' ? 'firefox' : 'chromium';
const projekt = path.resolve(wurzel, '..');
const aus = typeof args.aus === 'string' ? path.resolve(args.aus) : path.join(projekt, '03 Recherche', 'phase-11', 'erkenner');
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];

function alleZonen() {
  const z = {};
  for (const name of ZONEN) z[name] = BEDECKBAR.includes(name) ? { an: true, bedeckt: true } : { an: true };
  return z;
}

function nachricht(quelle) {
  return {
    ziel: 'erkenner', typ: 'pruefe', id: `p11-${Math.random().toString(36).slice(2, 8)}`, quelle,
    breite: 0, hoehe: 0,
    einstellungen: { schwelle: 0.1, zonen: alleZonen(), rand: 0.15, stil: 'mosaik' },
    rendern: false,
  };
}

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

async function haupt() {
  const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47373);
  const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? 47375);
  const server = [await starteFixtureServer(port), await starteFixtureServer(portFremd)];
  const basis = `http://127.0.0.1:${port}`;
  const b = browserArt === 'chromium' ? await starteChromium() : await starteFirefox();
  try {
    let bereit = false;
    for (let i = 0; i < 400 && !bereit; i++) {
      try { bereit = (await b.sende({ ziel: 'erkenner', typ: 'wecke' }))?.bereit === true; } catch { /* noch nicht bereit */ }
      if (!bereit) await warte(100);
    }
    if (!bereit) throw new Error('Erkenner wurde nicht bereit');
    await b.sende(nachricht({ art: 'url', url: `${basis}/synthetisch/1.png`, referer: `${basis}/` }));
    const eintraege = [];
    if (satz === 'testbilder') {
      // Bilder als data-URL aus ../05 Testbilder (nur lesen): die Netzgrenze lehnt Loopback-Adressen aus einer Erweiterungsseite im Tab ab.
      for (const s of ['nsfw', 'sfw']) {
        const liste = (await holeJson(`${basis}/api/testbilder?satz=${s}`)).bilder;
        for (const name of liste) {
          const typ = MIME[path.extname(name).toLowerCase()];
          if (!typ) continue;
          const daten = await readFile(path.join(projekt, '05 Testbilder', s, name));
          eintraege.push({ schluessel: `${s}/${name}`, quelle: { art: 'daten', dataUrl: `data:${typ};base64,${daten.toString('base64')}` } });
        }
      }
    } else {
      const ordner = path.join(projekt, '02 Assets Mia', 'pack-1.0', 'vorschau');
      const pack = JSON.parse(await readFile(path.join(projekt, '02 Assets Mia', 'pack-1.0', 'pack.json'), 'utf8'));
      const stufen = new Map(pack.dateien.filter((d) => d.rolle === 'vorschau').map((d) => [d.name.replace(/^vorschau\//, ''), d.stufe]));
      for (const name of (await readdir(ordner)).sort()) {
        const typ = MIME[path.extname(name).toLowerCase()];
        if (!typ) continue;
        const daten = await readFile(path.join(ordner, name));
        eintraege.push({ schluessel: `pack/${name}`, stufe: stufen.get(name) ?? null, quelle: { art: 'daten', dataUrl: `data:${typ};base64,${daten.toString('base64')}` } });
      }
    }
    console.log(`Satz ${satz}: ${eintraege.length} Bilder, ${browserArt}`);
    const jeBild = {};
    let fehler = 0;
    const t0 = Date.now();
    for (const e of eintraege) {
      const a = await b.sende(nachricht(e.quelle));
      if (a?.ok) {
        jeBild[e.schluessel] = {
          ok: true, ...(e.stufe !== undefined ? { stufe: e.stufe } : {}), breite: a.breite, hoehe: a.hoehe,
          treffer: a.treffer.map((t) => ({ zone: t.zone, bedeckt: t.bedeckt, score: t.score, box: t.box, quelle: t.quelle ?? '320n', ...(t.weiblich ? { weiblich: true } : {}) })),
        };
      } else {
        fehler++;
        jeBild[e.schluessel] = { ok: false, fehler: a?.fehler ?? JSON.stringify(a) };
      }
    }
    const meta = {
      werkzeug: 'scripts/messung/phase11-erkenner-roh.mjs',
      befehl: `node scripts/messung/phase11-erkenner-roh.mjs --satz ${satz} --browser ${browserArt}`,
      browser: browserArt, version: b.version || (browserArt === 'firefox' ? firefoxVersion() : ''),
      datum: new Date().toISOString(), paket: `${paketJson.name} ${paketJson.version}`, schwelle: 0.1, zonenAn: ZONEN,
      anzahl: eintraege.length, fehler, dauerS: Math.round((Date.now() - t0) / 100) / 10,
    };
    await mkdir(aus, { recursive: true });
    const datei = path.join(aus, `roh-${satz}-${browserArt}.json`);
    await writeFile(datei, JSON.stringify({ meta, jeBild }));
    console.log(`fertig: ${eintraege.length} Bilder, Fehler ${fehler}, ${meta.dauerS} s, Browser ${meta.version}`);
  } finally {
    await b.schliesse();
    for (const s of server) s.close();
  }
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
