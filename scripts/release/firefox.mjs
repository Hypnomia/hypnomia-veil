// Release-Skript fuer die Firefox-Datei (Session 14, Auftrag R).
//   node scripts/release/firefox.mjs --kanal unlisted|amo [--nachbau] [--signieren]
//   node scripts/release/firefox.mjs --updates <xpi-adresse>          (allein: nur updates.json aus der signierten XPI schreiben)
// Baut ohne Testhaken nach .output-release-<kanal>, sucht Testhaken-Spuren, laesst web-ext lint laufen, packt das Quellcode-Paket fuer Mozilla
// (WXT-Quellzip plus BUILD.md plus extern/kern und extern/chibi) und baut es mit --nachbau in einem Wegwerf-Ordner nach (SHA-256 je Datei).
// --signieren (nur unlisted) und --updates bleiben Handarbeit des Orchestrators. Keine neuen Abhaengigkeiten; web-ext kommt aus dem PATH.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fehlendeSpuren, suche } from '../testhaken-spuren.mjs';
import { baudatumAusUmgebung, KANAELE } from './kanal.mjs';
import { signiere } from './signieren.mjs';
import { schreibeUpdates, sha256Datei } from './updates.mjs';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Befehlszeile lesen. Rein (ohne Seiteneffekte), damit der Einheitstest sie pruefen kann.
export function leseArgumente(argv) {
  const a = { kanal: null, nachbau: false, signieren: false, updates: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--kanal') a.kanal = argv[++i] ?? '';
    else if (t === '--nachbau') a.nachbau = true;
    else if (t === '--signieren') a.signieren = true;
    else if (t === '--updates') a.updates = argv[++i] ?? '';
    else throw new Error(`Unbekanntes Argument "${t}"`);
  }
  if (a.kanal !== null && !KANAELE.includes(a.kanal)) throw new Error(`--kanal "${a.kanal}" ist unbekannt (erlaubt: ${KANAELE.join(', ')})`);
  if (a.updates !== null && !/^https?:\/\/\S+$/.test(a.updates)) throw new Error('--updates braucht die Adresse der signierten XPI (http oder https)');
  if (a.signieren && a.kanal === 'amo') throw new Error('--signieren gibt es nur fuer den Kanal unlisted. Einreichung bei AMO: nur von Hand nach Einzel-Ok.');
  if (a.signieren && a.kanal === null) throw new Error('--signieren braucht --kanal unlisted');
  if (a.signieren && !a.nachbau) throw new Error('--signieren gibt es nur zusammen mit --nachbau (erst gruener Nachbau, dann signieren)');
  if (a.kanal === null && !(a.updates !== null && !a.signieren && !a.nachbau)) throw new Error('--kanal unlisted|amo fehlt');
  if (a.updates !== null && a.kanal === 'amo') throw new Error('--updates gehoert zum Kanal unlisted');
  return a;
}

// Der Befehl, der im Quellcode-Paket (BUILD.md) und beim Nachbau steht; alles in einer Zeile mit den Umgebungsvariablen.
export function bauBefehl({ kanal, baudatum }) {
  return `VEIL_KANAL=${kanal} VEIL_BAUDATUM=${baudatum} VEIL_KERN=extern/kern VEIL_CHIBI=extern/chibi npm run build:firefox`;
}

// BUILD.md fuer Mozilla (englisch, sachlich). Alle Angaben kommen aus den uebergebenen Messwerten.
export function baueBuildMd({ version, kanal, baudatum, system, node, npm, ort, modelle, kern, chibi }) {
  const liste = (namen) => (namen.length ? namen.map((n) => `- \`${n}\``).join('\n') : '- (none)');
  return `# Build instructions for HYPNOMIA VEIL ${version} (Firefox, channel "${kanal}")

This archive contains everything needed to rebuild the submitted extension. The rebuild was checked on the same machine with the same Node.js and npm
versions as listed below: every file inside the package had the same SHA-256 as in the submitted build. On other machines or other Node.js versions
the result may differ; this was not tested.

## Environment

The submitted package was built with this environment:

- Operating system: ${system}
- Node.js: ${node}
- npm: ${npm}

Other Node.js and npm versions were not tested.

## Steps

1. Unpack this archive and open a shell in the unpacked folder.
2. Install the dependencies exactly as locked in \`package-lock.json\`:

       npm ci --ignore-scripts
       npx wxt prepare

3. Build the Firefox extension:

       ${bauBefehl({ kanal, baudatum })}

   The variables mean: \`VEIL_KANAL\` is the release channel (\`unlisted\` keeps \`update_url\` in the manifest, \`amo\` leaves it out),
   \`VEIL_BAUDATUM\` is the build date shown on the settings page, \`VEIL_KERN\` and \`VEIL_CHIBI\` are the folders with the bundled images
   (see below). \`npm run build:firefox\` first runs \`scripts/kopiere-laufzeit.mjs\` (copies the WebAssembly runtime, see below).
4. The finished extension is in \`.output/firefox-mv3/\`. \`npm run zip:firefox\` additionally writes the zip file to \`.output/\`
   (the zip container carries file timestamps, so compare the files inside, not the zip itself).

The build runs WXT (https://wxt.dev) with Vite and TypeScript. The bundle is minified. The settings page and the popup are plain TypeScript
without a UI framework.

## Third-party library

- onnxruntime-web ${ort.version}, unmodified, from npm: https://www.npmjs.com/package/onnxruntime-web (exact version and hash in \`package-lock.json\`).
  \`scripts/kopiere-laufzeit.mjs\` copies \`ort-wasm-simd-threaded.wasm\` and \`ort-wasm-simd-threaded.mjs\` from \`node_modules/onnxruntime-web/dist/\`
  to \`public/ort/\`, from where they go into the extension unchanged. The JavaScript entry (\`onnxruntime-web/wasm\`) is bundled by Vite.

## Models

Both models are part of this archive (\`public/modelle/\`) and are copied into the extension unchanged.

${modelle.map((m) => `- \`${m.name}\`: ${m.beschreibung}, SHA-256 \`${m.sha256}\``).join('\n')}

## Images

The extension shows illustrations that are original artwork of the project. They are not generated by the build. The build copies them unchanged
from \`extern/kern/\` and \`extern/chibi/\` into \`kern/\` and \`chibi/\` of the extension:

\`extern/kern/\`:

${liste(kern)}

\`extern/chibi/\`:

${liste(chibi)}

All other images (the extension icons in \`public/icons/\`) are in the source tree.

## Network use

The extension loads the images of the page the user has open again, so that it can check them (the Referer header is set with \`webRequest\` and
\`webRequestBlocking\`). Apart from that it makes no network requests. In Firefox it does not check for new versions by itself. It contains no analytics and no remote code.
`;
}

// Abbruch mit Text: Hilfsfunktionen werfen, damit ihre finally-Bloecke (Wegwerf-Ordner loeschen) laufen. Nur haupt() beendet den Prozess.
class Abbruch extends Error {}
const fehlerExit = (text) => {
  throw new Abbruch(text);
};

// Fuehrt einen Befehl aus, reicht die Ausgabe durch und liefert Exit-Code und Text.
function lauf(befehl, args, { cwd = wurzel, env = process.env, still = false } = {}) {
  return new Promise((aufloesen) => {
    const kind = spawn(befehl, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    kind.stdout.on('data', (d) => {
      text += d;
      if (!still) process.stdout.write(d);
    });
    kind.stderr.on('data', (d) => {
      text += d;
      if (!still) process.stderr.write(d);
    });
    kind.on('error', () => aufloesen({ code: 127, text }));
    kind.on('close', (code) => aufloesen({ code: code ?? 1, text }));
  });
}

// Alle Dateien eines Ordners (relative Pfade, sortiert).
function alleDateien(ordner, rel = '') {
  const liste = [];
  for (const name of readdirSync(path.join(ordner, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(ordner, r)).isDirectory()) liste.push(...alleDateien(ordner, r));
    else liste.push(r);
  }
  return liste;
}

const sha256 = (pfad) => createHash('sha256').update(readFileSync(pfad)).digest('hex');
const groesse = (pfad) => `${(statSync(pfad).size / 1024 / 1024).toFixed(2)} MB`;

// Vergleicht zwei Baeume Datei fuer Datei per SHA-256. Liefert Abweichungen als Textzeilen (leer = identisch).
export function vergleicheOrdner(a, b) {
  const la = alleDateien(a);
  const lb = alleDateien(b);
  const abweichungen = [];
  for (const d of la) if (!lb.includes(d)) abweichungen.push(`fehlt im Nachbau: ${d}`);
  for (const d of lb) if (!la.includes(d)) abweichungen.push(`zusaetzlich im Nachbau: ${d}`);
  for (const d of la) if (lb.includes(d) && sha256(path.join(a, d)) !== sha256(path.join(b, d))) abweichungen.push(`Inhalt verschieden: ${d}`);
  return { dateien: la.length, abweichungen };
}

// Lint: Fehler brechen ab, Warnungen werden gezaehlt und aufgelistet.
async function lint(ordner, kanal) {
  console.log('\n== web-ext lint ==');
  // unlisted wird selbst verteilt: --self-hosted schaltet die AMO-Hosting-Meldungen ab (update_url ist dort erlaubt).
  const args = ['lint', '--source-dir', ordner, '--output', 'json', ...(kanal === 'unlisted' ? ['--self-hosted'] : [])];
  const r = spawnSync('web-ext', args, { cwd: wurzel, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) fehlerExit('web-ext nicht gefunden (PATH). Installieren: npm install --global web-ext');
  const start = r.stdout.indexOf('{');
  if (start < 0) fehlerExit(`web-ext lint lieferte kein JSON:\n${r.stdout}\n${r.stderr}`);
  const ergebnis = JSON.parse(r.stdout.slice(start));
  const zeile = (m) => `  ${m.code}: ${m.message}${m.file ? ` (${m.file}${m.line ? `:${m.line}` : ''})` : ''}`;
  console.log(`Lint: ${ergebnis.errors.length} Fehler, ${ergebnis.warnings.length} Warnungen, ${ergebnis.notices.length} Hinweise`);
  for (const m of ergebnis.warnings) console.log(`WARNUNG${zeile(m)}`);
  if (ergebnis.errors.length) {
    for (const m of ergebnis.errors) console.error(`FEHLER${zeile(m)}`);
    fehlerExit('web-ext lint meldet Fehler.');
  }
  return ergebnis;
}

// Spuren der Testhaken im Release-Bau (gleiche Suche wie scripts/test-all.mjs, gemeinsame Quelle scripts/testhaken-spuren.mjs).
// Gegenprobe wie in test-all: ein Testbau in einem Wegwerf-Ordner muss jede Spur enthalten, sonst taugt die Suche nichts.
async function pruefeTesthaken(ordner, kanal) {
  console.log('\n== Testhaken-Spuren im Release-Bau ==');
  const s = suche(ordner);
  const treffer = Object.entries(s.treffer).filter(([, dateien]) => dateien.length);
  console.log(`${s.dateien} Dateien durchsucht (${s.js.length} JS)`);
  if (s.js.length === 0) fehlerExit('keine JS-Dateien im Release-Bau');
  for (const [muster, dateien] of treffer) console.error(`  ROT: "${muster}" in ${dateien.map((d) => path.relative(ordner, d)).join(', ')}`);
  if (treffer.length) fehlerExit('Testhaken-Spuren im Release-Bau.');
  const test = mkdtempSync(path.join(os.tmpdir(), 'veil-gegenprobe-'));
  try {
    const env = { ...process.env, WXT_TESTHAKEN: '1', VEIL_AUSGABE: test, VEIL_KANAL: kanal };
    const r = await lauf('npm', ['run', 'build:firefox'], { env, still: true });
    if (r.code !== 0) {
      console.error(String(r.text ?? '').split('\n').slice(-40).join('\n'));
      fehlerExit(`Testbau fuer die Gegenprobe fehlgeschlagen (Exit ${r.code})`);
    }
    const fehlen = fehlendeSpuren(suche(path.join(test, 'firefox-mv3')));
    if (fehlen.length) fehlerExit(`Gegenprobe: ${fehlen.length} Spuren fehlen sogar im Testbau (${fehlen.join(', ')}), die Suche waere wirkungslos`);
    console.log('keine Spur im Release-Bau, Gegenprobe im Testbau bestanden');
  } finally {
    rmSync(test, { recursive: true, force: true });
  }
}

// Muster der Leck-Sperre (ausserhalb des Repos) als gefilterte Musterdatei fuer grep, wie scripts/leak-check.sh (ohne Kommentar- und
// Leerzeilen). Die Muster werden nie ausgegeben. Gibt den Pfad der Wegwerf-Datei zurueck; der Aufrufer loescht sie.
function leckMusterDatei() {
  let text;
  try {
    text = readFileSync(path.join(wurzel, '../.lokal/leck-muster.txt'), 'utf8');
  } catch {
    fehlerExit('Leck-Muster (../.lokal/leck-muster.txt) nicht lesbar: ohne sie wird kein Quellcode-Paket freigegeben');
  }
  const zeilen = text.split(/\r?\n/).filter((z) => !/^\s*(#|$)/.test(z));
  if (!zeilen.length) fehlerExit('Die Leck-Muster sind leer');
  const ordner = mkdtempSync(path.join(os.tmpdir(), 'veil-leckmuster-'));
  const datei = path.join(ordner, 'muster.txt');
  writeFileSync(datei, `${zeilen.join('\n')}\n`);
  return datei;
}

// grep wie in leak-check.sh: -i -E -f, zeilenweise. Exit 0 = Treffer, 1 = keiner, sonst Fehler (z. B. kaputtes Muster) = Abbruch ohne Musternennung.
function grepTreffer(args, eingabe, cwd) {
  const r = spawnSync('grep', args, { encoding: 'utf8', input: eingabe, cwd, maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 1) return [];
  if (r.status !== 0) fehlerExit('Leck-Muster: grep meldet einen Fehler (Musterdatei pruefen)');
  return r.stdout.split('\n').filter(Boolean);
}

// Prueft ein entpacktes Quellcode-Paket: Benutzername und Heimatordner, Leck-Muster (Fund nur als "Datei X", nie das Muster), Rasterbilder nur unter
// public/icons/, extern/kern/, extern/chibi/, keine .miapack.
export function pruefeQuellpaket(ordner) {
  const suchen = [os.userInfo().username, os.homedir()].filter((t) => t && t.length >= 3);
  const musterDatei = leckMusterDatei();
  const funde = [];
  const dateien = alleDateien(ordner);
  try {
    for (const d of grepTreffer(['-i', '-E', '-f', musterDatei], `${dateien.join('\n')}\n`)) funde.push(`Fund im Dateinamen: ${d}`);
    // Inhalte: -I ueberspringt Binaerdateien (Bilder, Modelle), wie die Leck-Sperre.
    for (const d of grepTreffer(['-r', '-I', '-i', '-E', '-l', '-f', musterDatei, '.'], undefined, ordner)) funde.push(`Fund in Datei ${d.replace(/^\.\//, '')}`);
  } finally {
    rmSync(path.dirname(musterDatei), { recursive: true, force: true });
  }
  for (const d of dateien) {
    if (suchen.some((t) => d.includes(t))) funde.push(`Fund im Dateinamen: ${d}`);
    if (/\.miapack$/i.test(d)) funde.push(`Pack-Datei im Paket: ${d}`);
    const raster = /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(d);
    if (raster && !/^(public\/icons|extern\/kern|extern\/chibi)\//.test(d)) funde.push(`Rasterbild am falschen Ort: ${d}`);
    if (/\.(onnx|wasm|png|jpe?g|webp|gif|avif|heic|miapack)$/i.test(d)) continue;
    const text = readFileSync(path.join(ordner, d), 'utf8');
    if (suchen.some((t) => text.includes(t))) funde.push(`Fund in Datei ${d}`);
  }
  if (funde.length) fehlerExit(`Quellcode-Paket nicht sauber:\n${[...new Set(funde)].join('\n')}`);
}

function systemText() {
  const r = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
  const mac = r.status === 0 ? `macOS ${r.stdout.trim()}, ` : '';
  return `${mac}${os.type()} ${os.release()}, ${os.arch()}`;
}

const nummerAus = (befehl, args) => spawnSync(befehl, args, { cwd: wurzel, encoding: 'utf8' }).stdout.trim();

// Quellcode-Paket: WXT-Quellzip plus BUILD.md plus extern/kern und extern/chibi (die Bilder, die der Bau kopiert hat).
function baueQuellpaket({ ausgabe, kanal, version, baudatum }) {
  const wxtZip = path.join(ausgabe, `hypnomia-veil-${version}-sources.zip`);
  if (!existsSync(wxtZip)) fehlerExit(`${wxtZip} fehlt (wxt zip hat kein Quellzip geschrieben)`);
  const ziel = path.join(ausgabe, `hypnomia-veil-${version}-sources-${kanal}.zip`);
  rmSync(ziel, { force: true });
  const stage = mkdtempSync(path.join(os.tmpdir(), 'veil-quellpaket-'));
  try {
    const bauOrdner = path.join(ausgabe, 'firefox-mv3');
    const kern = existsSync(path.join(bauOrdner, 'kern')) ? readdirSync(path.join(bauOrdner, 'kern')).sort() : [];
    const chibi = existsSync(path.join(bauOrdner, 'chibi')) ? readdirSync(path.join(bauOrdner, 'chibi')).sort() : [];
    mkdirSync(path.join(stage, 'extern/kern'), { recursive: true });
    mkdirSync(path.join(stage, 'extern/chibi'), { recursive: true });
    for (const n of kern) cpSync(path.join(bauOrdner, 'kern', n), path.join(stage, 'extern/kern', n));
    for (const n of chibi) cpSync(path.join(bauOrdner, 'chibi', n), path.join(stage, 'extern/chibi', n));
    const lock = JSON.parse(readFileSync(path.join(wurzel, 'package-lock.json'), 'utf8'));
    const modelle = [
      ['320n.onnx', 'NudeNet 320n, object detector. Origin: file `320n.onnx` of the GitHub release `v3.4-weights` (30 June 2024) of https://github.com/notAI-tech/NudeNet. Licence: AGPL-3.0 (repository and model metadata). This extension is AGPL-3.0 as well (see `LICENSE`)'],
      ['yunet-2023mar.onnx', 'YuNet, face detector. Origin: `face_detection_yunet_2023mar.onnx` of https://github.com/opencv/opencv_zoo (models/face_detection_yunet). Licence: MIT'],
    ].map(([name, beschreibung]) => ({ name: `public/modelle/${name}`, beschreibung, sha256: sha256(path.join(wurzel, 'public/modelle', name)) }));
    writeFileSync(
      path.join(stage, 'BUILD.md'),
      baueBuildMd({
        version,
        kanal,
        baudatum,
        system: systemText(),
        node: process.version,
        npm: nummerAus('npm', ['-v']),
        ort: { version: lock.packages['node_modules/onnxruntime-web'].version },
        modelle,
        kern,
        chibi,
      }),
    );
    cpSync(wxtZip, ziel);
    const z = spawnSync('zip', ['-q', '-X', '-r', ziel, 'BUILD.md', 'extern'], { cwd: stage, encoding: 'utf8' });
    if (z.status !== 0) {
      rmSync(ziel, { force: true });
      fehlerExit(`zip fehlgeschlagen: ${z.stderr || z.error}`);
    }
    // Das rohe WXT-Zip ist ersetzt und soll nicht neben dem fertigen Paket liegen bleiben.
    rmSync(wxtZip, { force: true });
    // Prueft den Inhalt des fertigen Pakets; bei einem Fund wird das Ziel-Zip geloescht.
    const pruef = mkdtempSync(path.join(os.tmpdir(), 'veil-quellpruefung-'));
    try {
      const u = spawnSync('unzip', ['-q', ziel, '-d', pruef], { encoding: 'utf8' });
      if (u.status !== 0) fehlerExit(`unzip fehlgeschlagen: ${u.stderr}`);
      pruefeQuellpaket(pruef);
    } catch (e) {
      rmSync(ziel, { force: true });
      throw e;
    } finally {
      rmSync(pruef, { recursive: true, force: true });
    }
    return { ziel, kern: kern.length, chibi: chibi.length };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// Nachbau: Quellcode-Paket in einen frischen Ordner unter $TMPDIR, npm ci, wxt prepare, bauen wie in BUILD.md, Dateien per SHA-256 vergleichen.
async function nachbau({ quellzip, ausgabe, kanal, baudatum }) {
  console.log('\n== Nachbau aus dem Quellcode-Paket ==');
  const start = Date.now();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'veil-nachbau-'));
  try {
    const u = spawnSync('unzip', ['-q', quellzip, '-d', dir], { encoding: 'utf8' });
    if (u.status !== 0) fehlerExit(`unzip fehlgeschlagen: ${u.stderr}`);
    // Saubere Umgebung: keine Schalter des Entwicklers, nur die aus BUILD.md.
    const env = { ...process.env };
    for (const k of ['VEIL_AUSGABE', 'WXT_TESTHAKEN', 'VEIL_KERN', 'VEIL_CHIBI', 'VEIL_KANAL', 'VEIL_BAUDATUM']) delete env[k];
    const schritte = [
      ['npm', ['ci', '--ignore-scripts'], env],
      ['npx', ['wxt', 'prepare'], env],
      ['npm', ['run', 'build:firefox'], { ...env, VEIL_KANAL: kanal, VEIL_BAUDATUM: baudatum, VEIL_KERN: 'extern/kern', VEIL_CHIBI: 'extern/chibi' }],
    ];
    for (const [befehl, args, e] of schritte) {
      console.log(`\n$ ${befehl} ${args.join(' ')}`);
      const r = await lauf(befehl, args, { cwd: dir, env: e });
      if (r.code !== 0) fehlerExit(`Nachbau: "${befehl} ${args.join(' ')}" ist fehlgeschlagen (Exit ${r.code})`);
    }
    const v = vergleicheOrdner(path.join(ausgabe, 'firefox-mv3'), path.join(dir, '.output/firefox-mv3'));
    const sek = ((Date.now() - start) / 1000).toFixed(1);
    if (v.abweichungen.length) {
      for (const z of v.abweichungen) console.error(`  ABWEICHUNG: ${z}`);
      fehlerExit(`Nachbau weicht ab (${v.abweichungen.length} Abweichungen bei ${v.dateien} Dateien).`);
    }
    console.log(`\nNachbau identisch: ${v.dateien} Dateien, alle SHA-256 gleich (Dauer ${sek} s)`);
    return { dateien: v.dateien, sekunden: sek };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Signierte XPI zur Version suchen (neueste Datei, die auf -<version>.xpi endet).
function findeXpi(ordner, version) {
  if (!existsSync(ordner)) return null;
  const treffer = readdirSync(ordner)
    .filter((n) => n.endsWith(`-${version}.xpi`))
    .map((n) => path.join(ordner, n))
    .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs);
  return treffer[0] ?? null;
}

async function haupt() {
  let a;
  try {
    a = leseArgumente(process.argv.slice(2));
  } catch (e) {
    fehlerExit(e.message);
  }
  const paket = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
  const version = paket.version;
  const signiertOrdner = path.join(wurzel, '.output/signed');

  // Nur updates.json schreiben.
  if (a.kanal === null) {
    const xpi = findeXpi(signiertOrdner, version);
    if (!xpi) fehlerExit(`keine signierte XPI fuer Version ${version} in .output/signed/`);
    schreibeUpdates(path.join(wurzel, 'updates.json'), { version, link: a.updates, hash: sha256Datei(xpi) });
    console.log(`updates.json: Version ${version} eingetragen (Hash aus ${path.basename(xpi)})`);
    return;
  }

  if (spawnSync('web-ext', ['--version'], { encoding: 'utf8' }).error) fehlerExit('web-ext nicht gefunden (PATH). Installieren: npm install --global web-ext');
  let baudatum;
  try {
    baudatum = baudatumAusUmgebung(process.env);
  } catch (e) {
    fehlerExit(e.message);
  }
  const ausgabeName = `.output-release-${a.kanal}`;
  const ausgabe = path.join(wurzel, ausgabeName);
  rmSync(ausgabe, { recursive: true, force: true });

  const t0 = Date.now();
  console.log(`== Bau Firefox, Kanal ${a.kanal}, Baudatum ${baudatum}, ${ausgabeName} ==`);
  const env = { ...process.env, WXT_TESTHAKEN: '', VEIL_AUSGABE: ausgabeName, VEIL_KANAL: a.kanal, VEIL_BAUDATUM: baudatum };
  const bau = await lauf('npm', ['run', 'zip:firefox'], { env });
  if (bau.code !== 0) fehlerExit(`Bau fehlgeschlagen (Exit ${bau.code})`);
  const bauOrdner = path.join(ausgabe, 'firefox-mv3');
  const firefoxZip = path.join(ausgabe, `hypnomia-veil-${version}-firefox.zip`);
  if (!existsSync(firefoxZip)) fehlerExit(`${firefoxZip} fehlt`);

  const manifest = JSON.parse(readFileSync(path.join(bauOrdner, 'manifest.json'), 'utf8'));
  const gecko = manifest.browser_specific_settings?.gecko ?? {};
  const hatUpdateUrl = 'update_url' in gecko;
  if (hatUpdateUrl !== (a.kanal === 'unlisted')) fehlerExit(`Manifest passt nicht zum Kanal ${a.kanal} (update_url ${hatUpdateUrl ? 'steht' : 'fehlt'})`);
  console.log(`Manifest: Kanal ${a.kanal}, update_url ${hatUpdateUrl ? 'vorhanden' : 'fehlt (richtig)'}, Version ${manifest.version}`);

  await pruefeTesthaken(bauOrdner, a.kanal);
  const l = await lint(bauOrdner, a.kanal);

  console.log('\n== Quellcode-Paket ==');
  const q = baueQuellpaket({ ausgabe, kanal: a.kanal, version, baudatum });
  console.log(`Quellcode-Paket: ${path.relative(wurzel, q.ziel)} (${groesse(q.ziel)}), extern/kern ${q.kern} Bilder, extern/chibi ${q.chibi} Bilder, keine persoenlichen Pfade`);

  let nb = null;
  if (a.nachbau) nb = await nachbau({ quellzip: q.ziel, ausgabe, kanal: a.kanal, baudatum });

  if (a.signieren) {
    console.log('\n== Signieren (unlisted) ==');
    const code = await signiere({ quellordner: bauOrdner, ausgabeordner: signiertOrdner, kanal: 'unlisted', quellzip: q.ziel });
    if (code !== 0) fehlerExit(`web-ext sign endete mit Exit ${code}`);
  }
  if (a.updates !== null) {
    const xpi = findeXpi(signiertOrdner, version);
    if (!xpi) fehlerExit(`keine signierte XPI fuer Version ${version} in .output/signed/`);
    schreibeUpdates(path.join(wurzel, 'updates.json'), { version, link: a.updates, hash: sha256Datei(xpi) });
    console.log(`updates.json: Version ${version} eingetragen`);
  }

  console.log('\n== Zusammenfassung ==');
  console.log(`Kanal ${a.kanal}, Version ${version}, Baudatum ${baudatum}`);
  console.log(`Firefox-Zip: ${path.relative(wurzel, firefoxZip)} (${groesse(firefoxZip)})`);
  console.log(`Quellcode-Zip: ${path.relative(wurzel, q.ziel)} (${groesse(q.ziel)})`);
  console.log(`Lint: ${l.errors.length} Fehler, ${l.warnings.length} Warnungen`);
  console.log(nb ? `Nachbau: identisch, ${nb.dateien} Dateien, ${nb.sekunden} s` : 'Nachbau: nicht angefordert (--nachbau)');
  console.log(`Gesamtdauer: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await haupt();
  } catch (e) {
    // Alle Fehler enden hier (die Hilfsfunktionen haben ihre Wegwerf-Ordner schon aufgeraeumt). Fehlertexte enthalten nie Schluessel.
    console.error(`\nRELEASE ABGEBROCHEN: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
