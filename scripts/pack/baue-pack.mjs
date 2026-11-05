// Pack-Bau (PHASE-2-BAUPLAN Abschnitt 9.5). Schreibt eine `.miapack`-Datei (Format: src/pack/format.ts).
//   npm run pack:bau -- --quelle <ordner> --aus <datei>   Ordner mit pack.json und den Dateien
//   npm run pack:dummy [-- --aus <datei>]                  Dummy-Pack nur aus synthetischen Bildern (Standard .output-pack/dummy.miapack)
// pack.json: { "id", "version", "titel", "mindestVeil"?, "freischaltungen": ["stil:mia-patch", ...], "lizenz": "<Name der Lizenzdatei>",
//              "dateien": [{ "name", "datei"?, "typ"?, "rolle"?: "patch"|"lizenz"|"vorschau"|"quiz"|"texte"|"chibi"|"werbung",
//                            "stufe"?: "tease"|"hot"|"explicit", "format"?: "300x250"|... }] }
//              (vorschau braucht eine Stufe, werbung ein Format aus WERBE_FORMATE, quiz und texte hoechstens einmal)
// `datei` ist der Pfad unter dem Quellordner (Standard: gleich `name`), `typ` wird sonst aus der Endung geschlossen.
// Die Ausgabe landet nie im Repo: erlaubt sind Orte ausserhalb des Repos und Ordner `.output*` darin (ignoriert).
// Mia-Bilder liest nur der echte Bau (spaeter aus dem Assets-Ordner neben dem Repo); das Dummy-Pack erzeugt seine Bilder zur Laufzeit.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PackFehler, pruefePack, quelleAusBytes, schreibePack } from '../../src/pack/format.ts';
import { DUMMY_QUIZ, DUMMY_TEXTE } from './dummy-inhalte.mjs';

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

// Vorschau-Bilder des Dummy-Packs (Phase 4): Lila und Orange, gut unterscheidbar von den Patch-Farben, von Hauttoenen und vom Rahmen.
export const DUMMY_VORSCHAU_FARBEN = [
  [[150, 40, 200], [250, 150, 0]],
  [[90, 20, 160], [255, 200, 0]],
  [[200, 60, 255], [200, 100, 0]],
  [[120, 0, 120], [240, 240, 60]],
];

// Chibi-Platzhalter mit Transparenz: ein farbiger Kreis auf durchsichtigem Grund (Tests pruefen, dass die Ecken durchsichtig bleiben).
async function dummyChibi(farbe, seite = 256) {
  const { default: sharp } = await import('sharp');
  const px = Buffer.alloc(seite * seite * 4);
  const r = seite / 2;
  for (let y = 0; y < seite; y++) {
    for (let x = 0; x < seite; x++) {
      const i = (y * seite + x) * 4;
      const drin = (x - r) ** 2 + (y - r) ** 2 < (r * 0.8) ** 2;
      px[i] = farbe[0];
      px[i + 1] = farbe[1];
      px[i + 2] = farbe[2];
      px[i + 3] = drin ? 255 : 0;
    }
  }
  return new Uint8Array(await sharp(px, { raw: { width: seite, height: seite, channels: 4 } }).webp({ lossless: true }).toBuffer());
}
export const DUMMY_CHIBI_POSEN = ['jubeln', 'schmollen', 'sprechblase'];

// Phase 5 (Auftrag W): synthetische Werbebilder je Format, Rot mit Dunkelgrau bzw. Rot mit Weiss (weit weg von Patch-, Vorschau- und
// Rahmenfarben). Zwei Bilder fuer 300x250, damit die Rotation je Seitenaufruf pruefbar ist.
export const DUMMY_WERBUNG = [
  { format: '300x250', farben: [[220, 20, 40], [40, 40, 40]] },
  { format: '300x250', farben: [[220, 20, 40], [250, 250, 250]] },
  { format: '336x280', farben: [[200, 10, 30], [40, 40, 40]] },
  { format: '728x90', farben: [[220, 20, 40], [40, 40, 40]] },
  { format: '468x60', farben: [[200, 10, 30], [250, 250, 250]] },
  { format: '160x600', farben: [[220, 20, 40], [40, 40, 40]] },
  { format: '300x600', farben: [[200, 10, 30], [40, 40, 40]] },
  { format: '320x50', farben: [[220, 20, 40], [250, 250, 250]] },
  { format: '320x100', farben: [[200, 10, 30], [250, 250, 250]] },
  { format: '970x250', farben: [[220, 20, 40], [40, 40, 40]] },
];

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
  // Phase 4 (PHASE-4-BAUPLAN Abschnitt 8 Punkt 11): Vorschau-Bilder, Chibis, Quiz-Bank und Saetze. `opts.ohnePhase4` baut ein Pack
  // wie vor 0.4.0 (nur Patches), fuer Tests "Pack ohne die neuen Freischaltungen".
  const phase4 = !opts.ohnePhase4;
  if (phase4) {
    for (let i = 0; i < DUMMY_VORSCHAU_FARBEN.length; i++) {
      const [a, b] = DUMMY_VORSCHAU_FARBEN[i];
      dateien.push({ name: `vorschau/dummy-${i + 1}.webp`, typ: 'image/webp', daten: await dummyBild(a, b, 640, 360), rolle: 'vorschau', stufe: 'explicit' });
    }
    for (let i = 0; i < DUMMY_CHIBI_POSEN.length; i++) {
      dateien.push({ name: `chibi/${DUMMY_CHIBI_POSEN[i]}.webp`, typ: 'image/webp', daten: await dummyChibi(DUMMY_VORSCHAU_FARBEN[i][1]), rolle: 'chibi' });
    }
    for (let i = 0; i < DUMMY_WERBUNG.length; i++) {
      const { format, farben } = DUMMY_WERBUNG[i];
      const [b, h] = format.split('x').map(Number);
      dateien.push({ name: `werbung/dummy-${i + 1}-${format}.webp`, typ: 'image/webp', daten: await dummyBild(farben[0], farben[1], b, h), rolle: 'werbung', format });
    }
    const json = (x) => new TextEncoder().encode(JSON.stringify(x, null, 1));
    dateien.push({ name: 'quiz.json', typ: 'application/json', daten: json(opts.quiz ?? DUMMY_QUIZ), rolle: 'quiz' });
    dateien.push({ name: 'texte.json', typ: 'application/json', daten: json(opts.texte ?? DUMMY_TEXTE), rolle: 'texte' });
  }
  const bytes = await pruefeErgebnis(await schreibePack(
    {
      id: opts.id ?? 'dummy',
      version: '0.0.1',
      titel: 'Dummy pack (synthetic pictures)',
      erstellt: new Date().toISOString(),
      mindestVeil: paketJson.version,
      freischaltungen: phase4
        ? [
            'stil:mia-patch',
            'erwachsen:vorschau',
            'erwachsen:quiz',
            'erwachsen:titel',
            'erwachsen:ersatz',
            'quiz:freilegen',
            'zensur:steigerung',
            'chibi:pack',
            'kontrolle:werbung',
            'kontrolle:blitz',
            'kontrolle:leerlauf',
            'kontrolle:tabtitel',
            'kontrolle:cursor',
            'kontrolle:meldungen',
            'kontrolle:zeitplan',
            'kontrolle:besuche',
          ]
        : ['stil:mia-patch'],
    },
    dateien,
  ));
  return {
    bytes,
    farben: paare.flat(),
    bilder: paare.length,
    vorschauFarben: phase4 ? DUMMY_VORSCHAU_FARBEN.flat() : [],
    vorschau: phase4 ? DUMMY_VORSCHAU_FARBEN.length : 0,
    chibis: phase4 ? DUMMY_CHIBI_POSEN.length : 0,
    werbung: phase4 ? DUMMY_WERBUNG.length : 0,
  };
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
    if (d.format) eintrag.format = d.format;
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
