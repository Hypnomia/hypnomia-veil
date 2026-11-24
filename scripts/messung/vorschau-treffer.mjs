// Messwerkzeug Phase 11 (Etappe 5c, Vorarbeit), kein Produktcode: holt die Rohtreffer des Produkt-Erkenners (320n plus YuNet) fuer WebP-Dateien
// und legt sie je Bild als JSON im Eingabeformat von `berechneFlaechen` ab (Treffer[]: zone, bedeckt, score, box in Bildpunkten, quelle, weiblich, winkel).
// Aufruf: node scripts/messung/vorschau-treffer.mjs --webp <ordner mit .webp> [--aus <ordner fuer json>] [--repo-datei data/beispiel-treffer.json] [--laeufe 2] [--browser chromium] [--schwelle 0.1]
// Je Bild zwei Treffersaetze (V6): MIT Gesichtssuche (alle zehn Zonen an, YuNet laeuft) und OHNE (die vier Gesichtszonen aus, YuNet laeuft nicht; die Bedingung steht in
// src/erkenner/gesichtssuche.ts). `--repo-datei` schreibt die Datendatei der Vorschau (die vier Beispielbilder nach Kennung, ohne Pfade und Uhrzeit), aber nur,
// wenn alle Laeufe bitgleich sind; sonst Abbruch mit Exit 3 und ohne Datei.
// Je Lauf ein frischer Browserstart mit geladener Erweiterung (Testbau, VEIL_AUSGABE waehlt den Ordner), alle zehn Zonen an, bedeckt wo moeglich,
// Schwelle 0,10 (Standard und Minimum); eine Schwelle ab 0,25 ist das Filtern nach Sicherheit (NMS laeuft von hoch nach tief).
// Je Bild: <aus>/<name>.json (Lauf 1) und <aus>/wiederholung.json (Vergleich aller Laeufe: bitgleich ja oder nein, groesste Abweichung).
// Pfade nur als Argumente. Die Bilder werden als data-URL uebergeben (Netzgrenze lehnt Loopback aus Erweiterungsseiten ab).
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { starteChromium, starteFirefox } from './browser.mjs';
import { argumente, firefoxVersion, paketJson, wurzel, warte } from './hilfe.mjs';

const args = argumente();
if (typeof args.webp !== 'string' || (typeof args.aus !== 'string' && typeof args['repo-datei'] !== 'string')) {
  console.error('Aufruf: node scripts/messung/vorschau-treffer.mjs --webp <ordner> [--aus <ordner>] [--repo-datei <datei>] [--laeufe 2] [--browser chromium|firefox] [--schwelle 0.1]');
  process.exit(2);
}
const webpOrdner = path.resolve(args.webp);
const ausOrdner = typeof args.aus === 'string' ? path.resolve(args.aus) : null;
const repoDatei = typeof args['repo-datei'] === 'string' ? path.resolve(args['repo-datei']) : null;
// Kennung der Vorschau zu Dateiname (ohne .webp), in der Reihenfolge der Punkte.
const BEISPIELE = [['vorn', 'a-ganzkoerper-vorn-2'], ['rueck', 'a-rueckansicht-1'], ['sitz', 'a-sitzend-sohlen-4'], ['portraet', 'a-portraet-10']];
const laeufeAnzahl = Number(args.laeufe ?? 2);
const browserArt = args.browser === 'firefox' ? 'firefox' : 'chromium';
const schwelle = Number(args.schwelle ?? 0.1);

const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const sha = (daten) => createHash('sha256').update(daten).digest('hex');

function alleZonen() {
  const z = {};
  for (const name of ZONEN) z[name] = BEDECKBAR.includes(name) ? { an: true, bedeckt: true } : { an: true };
  return z;
}

// Ohne Gesichtssuche: die vier Gesichtszonen aus (kein Balken-Stil, kein Eye bar), dann sucht der Erkenner keine Gesichter.
function zonenOhneGesicht() {
  const z = alleZonen();
  for (const name of ['eyes', 'mouth', 'face', 'head']) z[name] = { an: false };
  return z;
}

function nachricht(dataUrl, mitGesicht = true) {
  return {
    ziel: 'erkenner', typ: 'pruefe', id: `vt-${Math.random().toString(36).slice(2, 8)}`, quelle: { art: 'daten', dataUrl },
    breite: 0, hoehe: 0,
    einstellungen: { schwelle, zonen: mitGesicht ? alleZonen() : zonenOhneGesicht(), rand: 0.15, stil: 'mosaik' },
    rendern: false,
  };
}

async function einLauf(eintraege) {
  const b = browserArt === 'chromium' ? await starteChromium() : await starteFirefox();
  try {
    let bereit = false;
    for (let i = 0; i < 400 && !bereit; i++) {
      try { bereit = (await b.sende({ ziel: 'erkenner', typ: 'wecke' }))?.bereit === true; } catch { /* Hintergrund noch nicht bereit */ }
      if (!bereit) await warte(100);
    }
    if (!bereit) throw new Error('Erkenner wurde nicht bereit');
    // Warmlauf mit dem ersten Bild (Kaltstart gehoert nicht in die Messung); das Ergebnis wird verworfen.
    await b.sende(nachricht(eintraege[0].dataUrl));
    const jeBild = {};
    const kuerze = (a) => a.treffer.map((t) => ({
      zone: t.zone, bedeckt: t.bedeckt, score: t.score, box: t.box,
      ...(t.quelle ? { quelle: t.quelle } : {}), ...(t.weiblich ? { weiblich: true } : {}), ...(t.winkel !== undefined ? { winkel: t.winkel } : {}),
    }));
    for (const e of eintraege) {
      const a = await b.sende(nachricht(e.dataUrl));
      if (!a?.ok) throw new Error(`${e.name}: ${a?.fehler ?? JSON.stringify(a)}`);
      const o = await b.sende(nachricht(e.dataUrl, false));
      if (!o?.ok) throw new Error(`${e.name} ohne Gesicht: ${o?.fehler ?? JSON.stringify(o)}`);
      if (o.breite !== a.breite || o.hoehe !== a.hoehe) throw new Error(`${e.name}: Arbeitsgroesse weicht zwischen den Saetzen ab`);
      jeBild[e.name] = { breite: a.breite, hoehe: a.hoehe, treffer: kuerze(a), trefferOhne: kuerze(o) };
    }
    return { version: b.version || (browserArt === 'firefox' ? firefoxVersion() : ''), jeBild };
  } finally {
    await b.schliesse();
  }
}

// Vergleich zweier Trefferlisten desselben Bilds: gleiche Anzahl und Reihenfolge, gleiche Klassen, groesste Abweichung bei Box und Score.
function vergleiche(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return { bitgleich: true, maxBox: 0, maxScore: 0, anzahlGleich: true };
  const gleichAnzahl = a.length === b.length;
  let maxBox = 0;
  let maxScore = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].zone !== b[i].zone || a[i].bedeckt !== b[i].bedeckt) { maxBox = Infinity; continue; }
    maxScore = Math.max(maxScore, Math.abs(a[i].score - b[i].score));
    for (let k = 0; k < 4; k++) maxBox = Math.max(maxBox, Math.abs(a[i].box[k] - b[i].box[k]));
  }
  return { bitgleich: false, maxBox: gleichAnzahl ? maxBox : Infinity, maxScore, anzahlGleich: gleichAnzahl };
}

async function haupt() {
  const namen = (await readdir(webpOrdner)).filter((n) => n.endsWith('.webp')).sort();
  if (!namen.length) throw new Error('keine .webp im Ordner');
  const eintraege = [];
  for (const n of namen) {
    const daten = await readFile(path.join(webpOrdner, n));
    eintraege.push({ name: n.replace(/\.webp$/, ''), sha256: sha(daten), dataUrl: `data:image/webp;base64,${daten.toString('base64')}` });
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wurzel }).toString().trim();
  const modelle = {};
  for (const [schluessel, datei] of [['320n', '320n.onnx'], ['yunet', 'yunet-2023mar.onnx']]) {
    try {
      const pfad = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output-test', 'chrome-mv3', 'modelle', datei);
      modelle[schluessel] = { datei, sha256: sha(await readFile(pfad)) };
    } catch { modelle[schluessel] = { datei, sha256: null }; }
  }
  console.log(`${eintraege.length} Bilder, ${laeufeAnzahl} Laeufe, ${browserArt}`);
  const laeufe = [];
  for (let i = 1; i <= laeufeAnzahl; i++) {
    const t0 = Date.now();
    laeufe.push(await einLauf(eintraege));
    console.log(`Lauf ${i}: ${Math.round((Date.now() - t0) / 100) / 10} s, Browser ${laeufe[i - 1].version}`);
  }
  const datum = new Date().toISOString();
  const vergleich = {};
  const vergleichOhne = {};
  if (ausOrdner) await mkdir(ausOrdner, { recursive: true });
  for (const e of eintraege) {
    const r = laeufe[0].jeBild[e.name];
    if (ausOrdner) await writeFile(path.join(ausOrdner, `${e.name}.json`), JSON.stringify({
      bild: e.name, webpSha256: e.sha256, breite: r.breite, hoehe: r.hoehe,
      modelle, erkenner: { schwelle, zonenAn: ZONEN, rand: 0.15 }, browser: `${browserArt} ${laeufe[0].version}`,
      gitCommit: commit, paket: `${paketJson.name} ${paketJson.version}`, datum,
      treffer: r.treffer, trefferOhneGesicht: r.trefferOhne,
    }, null, 1));
    vergleich[e.name] = laeufe.slice(1).map((l) => vergleiche(r.treffer, l.jeBild[e.name].treffer));
    vergleichOhne[e.name] = laeufe.slice(1).map((l) => vergleiche(r.trefferOhne, l.jeBild[e.name].trefferOhne));
  }
  const gleich = (v) => Object.values(v).every((x) => x.every((y) => y.bitgleich));
  const alleGleich = gleich(vergleich) && gleich(vergleichOhne);
  if (ausOrdner) await writeFile(path.join(ausOrdner, 'wiederholung.json'), JSON.stringify({ laeufe: laeufeAnzahl, browser: `${browserArt} ${laeufe[0].version}`, gitCommit: commit, datum, alleBitgleich: alleGleich, jeBild: vergleich, jeBildOhneGesicht: vergleichOhne }, null, 1));
  console.log(`bitgleich ueber alle Laeufe: ${alleGleich} (mit Gesichtssuche ${gleich(vergleich)}, ohne ${gleich(vergleichOhne)})`);
  for (const [t, vv] of [['mit', vergleich], ['ohne', vergleichOhne]]) for (const [n, v] of Object.entries(vv)) if (v.some((x) => !x.bitgleich)) console.log(`  Abweichung ${t} ${n}: ${JSON.stringify(v)}`);
  if (repoDatei) {
    if (!alleGleich) { console.error('Datendatei NICHT geschrieben: die Laeufe sind nicht bitgleich'); process.exit(3); }
    const bilder = BEISPIELE.map(([kennung, name]) => {
      const e = eintraege.find((x) => x.name === name);
      if (!e) throw new Error(`Beispielbild fehlt im Ordner: ${name}.webp`);
      const r = laeufe[0].jeBild[name];
      return { kennung, datei: `${name}.webp`, sha256: e.sha256, breite: r.breite, hoehe: r.hoehe, trefferMitGesicht: r.treffer, trefferOhneGesicht: r.trefferOhne };
    });
    await writeFile(repoDatei, `${JSON.stringify({ version: 1, schwelle, rand: 0.15, modelle, gitCommit: commit, browser: `${browserArt} ${laeufe[0].version}`, bilder }, null, 1)}\n`);
    console.log(`Datendatei geschrieben (${bilder.length} Bilder)`);
  }
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
