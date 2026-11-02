// Pack-Bau (PHASE-2-BAUPLAN Abschnitt 9.5). Schreibt eine `.miapack`-Datei (Format: src/pack/format.ts).
//   npm run pack:bau -- --quelle <ordner> --aus <datei>   Ordner mit pack.json und den Dateien
//   npm run pack:dummy [-- --aus <datei>]                  Dummy-Pack nur aus synthetischen Bildern (Standard .output-pack/dummy.miapack)
// pack.json: { "id", "version", "titel", "mindestVeil"?, "freischaltungen": ["stil:mia-patch"], "lizenz": "<Name der Lizenzdatei>",
//              "dateien": [{ "name", "datei"?, "typ"?, "rolle"?: "patch"|"lizenz", "stufe"?: "tease"|"hot"|"explicit" }] }
// `datei` ist der Pfad unter dem Quellordner (Standard: gleich `name`), `typ` wird sonst aus der Endung geschlossen.
// Die Ausgabe landet nie im Repo: erlaubt sind Orte ausserhalb des Repos und Ordner `.output*` darin (ignoriert).
// Mia-Bilder liest nur der echte Bau (spaeter aus dem Assets-Ordner neben dem Repo); das Dummy-Pack erzeugt seine Bilder zur Laufzeit.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PackFehler, pruefePack, quelleAusBytes, schreibePack } from '../../src/pack/format.ts';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));

const TYPEN = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.json': 'application/json',
};

// Liest das fertige Pack mit demselben Code wie die Erweiterung (alle Pruefungen aus 9.1) und bricht bei jedem Fehler ab:
// ein Pack, das die Erweiterung ablehnen wuerde, verlaesst den Bau nicht.
async function pruefeErgebnis(bytes) {
  try {
    await pruefePack(quelleAusBytes(bytes), paketJson.version);
  } catch (e) {
    if (e instanceof PackFehler) throw new Error(`Das gebaute Pack besteht die eigene Pruefung nicht (${e.code}): ${e.detail}`);
    throw e;
  }
  return bytes;
}

// Farbpaare des Dummy-Packs: kraeftiges Gruen, Blau und Tuerkis, weit weg von Hauttoenen und vom pinken Rahmen (#ff4fa3).
export const DUMMY_FARBEN = [
  [[20, 220, 110], [40, 60, 230]],
  [[0, 200, 200], [120, 40, 220]],
  [[160, 230, 20], [20, 120, 230]],
  [[10, 180, 140], [230, 220, 20]],
  [[60, 40, 220], [20, 220, 160]],
  [[110, 220, 30], [20, 40, 200]],
];

// Diagonal gestreiftes Bild aus zwei Farben, Streifenbreite ~ 1/6 der Breite: grosse, ruhige Flaechen, damit Stichproben eindeutig sind.
async function dummyBild(a, b, breite = 480, hoehe = 360) {
  const { default: sharp } = await import('sharp');
  const streifen = Math.round(breite / 6);
  const px = Buffer.alloc(breite * hoehe * 3);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const f = Math.floor((x + y) / streifen) % 2 === 0 ? a : b;
      const i = (y * breite + x) * 3;
      px[i] = f[0];
      px[i + 1] = f[1];
      px[i + 2] = f[2];
    }
  }
  return new Uint8Array(await sharp(px, { raw: { width: breite, height: hoehe, channels: 3 } }).webp({ lossless: true }).toBuffer());
}

function lizenzTextDummy() {
  try {
    return readFileSync(path.join(wurzel, 'LIZENZ-MIA-INHALTE.md'), 'utf8');
  } catch {
    return 'Dummy pack for tests. Synthetic pictures only, no rights attached.\n';
  }
}

// Zweite Farbreihe (warme Toene) fuer Tests, die ein Pack durch ein anderes ersetzen.
export const DUMMY_FARBEN_WARM = [
  [[250, 140, 20], [120, 70, 20]],
  [[250, 180, 70], [150, 90, 30]],
  [[240, 100, 20], [100, 60, 10]],
];

// Baut das Dummy-Pack im Speicher. Liefert die Bytes und die verwendeten Farben (Tests pruefen Pixel dagegen).
// `opts.farben`: eigene Farbpaare (Standard DUMMY_FARBEN), `opts.id`: andere Pack-Kennung.
export async function baueDummyPack(opts = {}) {
  const paare = opts.farben ?? DUMMY_FARBEN;
  const dateien = [{ name: 'lizenz.txt', typ: 'text/plain', daten: new TextEncoder().encode(lizenzTextDummy()), rolle: 'lizenz' }];
  for (let i = 0; i < paare.length; i++) {
    const [a, b] = paare[i];
    dateien.push({
      name: `patch/dummy-${i + 1}.webp`,
      typ: 'image/webp',
      daten: await dummyBild(a, b),
      rolle: 'patch',
      stufe: i % 2 === 0 ? 'tease' : 'hot',
    });
  }
  const bytes = await pruefeErgebnis(await schreibePack(
    {
      id: opts.id ?? 'dummy',
      version: '0.0.1',
      titel: 'Dummy pack (synthetic pictures)',
      erstellt: new Date().toISOString(),
      mindestVeil: paketJson.version,
      freischaltungen: ['stil:mia-patch'],
    },
    dateien,
  ));
  return { bytes, farben: paare.flat(), bilder: paare.length };
}

// Baut ein Pack aus einem Quellordner mit pack.json.
export async function bauePackAusOrdner(quelle) {
  const beschreibung = JSON.parse(await readFile(path.join(quelle, 'pack.json'), 'utf8'));
  for (const feld of ['id', 'version', 'titel', 'lizenz']) {
    if (typeof beschreibung[feld] !== 'string') throw new Error(`pack.json: Feld "${feld}" fehlt`);
  }
  if (!Array.isArray(beschreibung.dateien) || beschreibung.dateien.length === 0) throw new Error('pack.json: "dateien" fehlt oder ist leer');
  const dateien = [];
  for (const d of beschreibung.dateien) {
    const pfad = path.resolve(quelle, d.datei ?? d.name);
    if (!pfad.startsWith(path.resolve(quelle) + path.sep)) throw new Error(`pack.json: Datei ausserhalb des Quellordners: ${d.datei ?? d.name}`);
    const typ = d.typ ?? TYPEN[path.extname(d.name).toLowerCase()];
    if (!typ) throw new Error(`pack.json: Typ von ${d.name} unbekannt`);
    const eintrag = { name: d.name, typ, daten: new Uint8Array(await readFile(pfad)) };
    const rolle = d.name === beschreibung.lizenz ? 'lizenz' : d.rolle;
    if (rolle) eintrag.rolle = rolle;
    if (d.stufe) eintrag.stufe = d.stufe;
    dateien.push(eintrag);
  }
  return pruefeErgebnis(await schreibePack(
    {
      id: beschreibung.id,
      version: beschreibung.version,
      titel: beschreibung.titel,
      erstellt: new Date().toISOString(),
      mindestVeil: beschreibung.mindestVeil ?? paketJson.version,
      freischaltungen: beschreibung.freischaltungen ?? ['stil:mia-patch'],
    },
    dateien,
  ));
}

// Ausgabe nie ins Repo: ausserhalb ist frei, innerhalb nur unter einem ignorierten Ordner `.output*`.
function pruefeAusgabeOrt(ziel) {
  const rel = path.relative(wurzel, ziel);
  const innen = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (innen && !rel.split(path.sep)[0].startsWith('.output')) {
    throw new Error(`Ausgabe ${rel} liegt im Repo. Erlaubt: Orte ausserhalb oder unter .output-pack/`);
  }
}

function argument(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dummy = process.argv.includes('--dummy');
  const aus = path.resolve(argument('--aus') ?? path.join(wurzel, '.output-pack', 'dummy.miapack'));
  pruefeAusgabeOrt(aus);
  let bytes;
  if (dummy) {
    bytes = (await baueDummyPack()).bytes;
  } else {
    const quelle = argument('--quelle');
    if (!quelle || !argument('--aus')) throw new Error('Aufruf: npm run pack:bau -- --quelle <ordner> --aus <datei>');
    bytes = await bauePackAusOrdner(path.resolve(quelle));
  }
  await mkdir(path.dirname(aus), { recursive: true });
  await writeFile(aus, bytes);
  console.log(`pack: ${bytes.byteLength} Bytes -> ${path.relative(process.cwd(), aus) || aus}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`pack: FEHLER ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
