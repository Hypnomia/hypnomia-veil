// Gesamtlauf fuer npm test: Build Chrome, Build Firefox, Zip Firefox, dann beide Browser-Tests.
// Beide Tests laufen auch dann, wenn einer rot ist. Am Ende steht eine Zusammenfassung mit Millisekunden.
// Zusaetzlich baut der Lauf ohne Testhaken (Release-Pruefung) und sucht in allen JS-Dateien beider Bauten nach den Spuren der Testhaken.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Testbauten (mit Testhaken) landen in einem eigenen Ordner, nie unter den Release-Namen in .output.
const TESTBAU = { WXT_TESTHAKEN: '1', VEIL_AUSGABE: process.env.VEIL_AUSGABE ?? '.output-test' };
// Bau ohne Testhaken fuer die Release-Pruefung: der Schalter ist leer (nicht "1"), der Ordner gehoert nur dieser Pruefung.
const RELEASEBAU = { WXT_TESTHAKEN: '', VEIL_AUSGABE: '.output-release-pruefung' };
// Spuren der Testhaken: das, was der Testhaken in Seiten und Erweiterung schreibt oder abhoert. Im Release-Bau darf nichts davon stehen.
//   veil-test             CustomEvent, ueber das Tests Einstellungen setzen und den Erkenner abfragen
//   veil-freigabe         Seitenparameter "Freigabe sperren"
//   data-veil-erkenner    Antwort des Erkenner-Status im Testhaken
//   data-veil-status      Status-Attribut am Wurzelelement
//   data-veil-ms          Zeitstempel je Element
//   hypnomiaVeil, data-hypnomia-veil   Lebenszeichen-Attribut der Hallo-Tests (dataset.hypnomiaVeil)
//   veilHello             Lebenszeichen der Hallo-Tests in storage.local (Hintergrund, nur im Testbau)
//   videoVerzoegerungMs   Testhaken: kuenstlich verzoegerte Video-Antwort (veil-test)
//   steigerungUhrVor, veil-steigerung-takt   Testhaken der Steigerung (Uhr vorstellen, kurzer Melde-Takt)
//   veil-erwachsen        Testdomain veil-erwachsen.test fuer Erwachsenenseiten (src/adapter/liste.ts, Phase 4)
//   (videoZeiten und die anderen Schluessel des Status-Objekts stehen als Namen auch im Release-Bau, werden dort aber nie geschrieben:
//   das Schreiben haengt an testhakenAktiv(). Gesucht wird darum nach dem Attributnamen data-veil-status, nicht nach den Schluesseln.)
const TESTHAKEN_SPUREN = ['veil-test', 'veil-freigabe', 'data-veil-erkenner', 'data-veil-status', 'data-veil-ms', 'hypnomiaVeil', 'data-hypnomia-veil', 'veilHello', 'videoVerzoegerungMs', 'warteschlangeHalt', 'pruefVerzoegerungMs', 'data-veil-grenze', 'veil-erwachsen', 'data-veil-riegel', 'steigerungUhrVor', 'veil-steigerung-takt', 'data-veil-freilegen', 'data-veil-ersatz-abbild', 'data-veil-ersatz-host', 'data-veil-blitz', 'data-veil-spirale', 'data-veil-werbung', 'veil-werbung.test', 'data-veil-tabtitel', 'veil-besuch', 'data-veil-meldung', 'veil-version-test', 'data-veil-ledger', 'veil-einstieg-test', 'data-veil-ton'];
// Diese Spuren schreibt der Testbau wirklich; die Gegenprobe verlangt sie dort (data-hypnomia-veil kommt nur als dataset-Name vor).
const SPUREN_IM_TESTBAU = ['veil-test', 'veil-freigabe', 'data-veil-erkenner', 'data-veil-status', 'data-veil-ms', 'hypnomiaVeil', 'veilHello', 'videoVerzoegerungMs', 'warteschlangeHalt', 'pruefVerzoegerungMs', 'data-veil-grenze', 'veil-erwachsen', 'data-veil-riegel', 'steigerungUhrVor', 'veil-steigerung-takt', 'data-veil-freilegen', 'data-veil-ersatz-abbild', 'data-veil-ersatz-host', 'data-veil-blitz', 'data-veil-spirale', 'data-veil-werbung', 'veil-werbung.test', 'data-veil-tabtitel', 'veil-besuch', 'data-veil-meldung', 'veil-version-test', 'data-veil-ledger', 'veil-einstieg-test', 'data-veil-ton'];

// Fuehrt ein npm-Skript aus, reicht die Ausgabe durch und liefert Exit-Code sowie Text.
function lauf(skript, umgebung = {}) {
  return new Promise((aufloesen) => {
    const kind = spawn(npm, ['run', skript], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...umgebung } });
    let text = '';
    kind.stdout.on('data', (d) => {
      text += d;
      process.stdout.write(d);
    });
    kind.stderr.on('data', (d) => {
      text += d;
      process.stderr.write(d);
    });
    kind.on('error', (fehler) => {
      console.error(`${skript}: Start fehlgeschlagen`, fehler);
      aufloesen({ code: 1, text });
    });
    kind.on('close', (code) => aufloesen({ code: code ?? 1, text }));
  });
}

// VEIL_NUR_RELEASEPRUEFUNG=1: nur den Release-Bau und die Suche nach Testhaken-Spuren (der Testbau muss in VEIL_AUSGABE schon liegen).
const NUR_RELEASE = process.env.VEIL_NUR_RELEASEPRUEFUNG === '1';

// Einheitstests ohne Browser zuerst (Nachverarbeitung, Zonen, Ausnahmen).
if (!NUR_RELEASE) {
  console.log('\n== test:einheit ==');
  const { code } = await lauf('test:einheit');
  if (code !== 0) {
    console.error(`\nTEST-LAUF ABGEBROCHEN: Einheitstests rot (Exit ${code}).`);
    process.exit(code);
  }
}

// Bauschritte: bricht einer ab, laufen die Tests nicht (sie haetten keine Grundlage).
// WXT_TESTHAKEN=1 baut die Testhaken (data-veil-status, veil-test auf 127.0.0.1) mit ein; Release-Builds (npm run zip) haben sie nicht.
for (const schritt of NUR_RELEASE ? [] : ['build', 'build:firefox', 'zip:firefox']) {
  console.log(`\n== ${schritt} (WXT_TESTHAKEN=1, ${TESTBAU.VEIL_AUSGABE}) ==`);
  const { code } = await lauf(schritt, TESTBAU);
  if (code !== 0) {
    console.error(`\nTEST-LAUF ABGEBROCHEN: Schritt "${schritt}" ist fehlgeschlagen (Exit ${code}).`);
    process.exit(code);
  }
}

// Release-Bau ohne Testhaken (beide Browser) fuer die Pruefung auf Testhaken-Spuren.
for (const schritt of ['build', 'build:firefox']) {
  console.log(`\n== ${schritt} (ohne Testhaken, ${RELEASEBAU.VEIL_AUSGABE}) ==`);
  const { code } = await lauf(schritt, RELEASEBAU);
  if (code !== 0) {
    console.error(`\nTEST-LAUF ABGEBROCHEN: Release-Bau "${schritt}" ist fehlgeschlagen (Exit ${code}).`);
    process.exit(code);
  }
}

// Durchsucht werden JS, HTML, CSS und das Manifest.
const DURCHSUCHT = /\.(m?js|cjs|html|css)$/;
const istJs = (name) => /\.(m?js|cjs)$/.test(name);

// Alle durchsuchten Dateien unter einem Ordner (rekursiv).
function dateien(ordner) {
  const liste = [];
  for (const name of readdirSync(ordner)) {
    const voll = path.join(ordner, name);
    if (statSync(voll).isDirectory()) liste.push(...dateien(voll));
    else if (DURCHSUCHT.test(name) || name === 'manifest.json') liste.push(voll);
  }
  return liste;
}

// Dateiname ohne Inhalts-Hash des Baus (chunks/popup-BJjSF3cq.js -> chunks/popup.js): zwei Baue vergleichen sich ueber die Namen.
const ohneHash = (rel) => rel.replace(/-[A-Za-z0-9_-]{8}(\.[a-z]+)$/, '$1');

// Zaehlt je Spur die Dateien eines Baus, in denen sie steht.
function suche(ordner) {
  const alle = dateien(ordner);
  const treffer = Object.fromEntries(TESTHAKEN_SPUREN.map((m) => [m, []]));
  for (const datei of alle) {
    const text = readFileSync(datei, 'utf8');
    for (const muster of TESTHAKEN_SPUREN) if (text.includes(muster)) treffer[muster].push(datei);
  }
  const js = alle.filter((d) => istJs(d)).map((d) => ohneHash(path.relative(ordner, d))).sort();
  return { dateien: alle.length, js, treffer };
}

// Release-Pruefung: im Bau ohne Testhaken darf keine Spur stehen. Der Release-Bau muss dieselbe JS-Dateiliste haben wie der Testbau (und nicht leer
// sein), sonst durchsucht die Pruefung womoeglich etwas anderes als das, was ausgeliefert wird. Gegenprobe im Testbau: jede Spur, die er schreibt,
// muss dort vorkommen, sonst taugt die Suche nicht.
function releasePruefung() {
  console.log('\n== Release-Pruefung (Testhaken-Spuren) ==');
  let rot = false;
  for (const bau of ['chrome-mv3', 'firefox-mv3']) {
    const release = suche(path.join(RELEASEBAU.VEIL_AUSGABE, bau));
    const test = suche(path.join(TESTBAU.VEIL_AUSGABE, bau));
    console.log(`${bau}: ${release.dateien} durchsuchte Dateien im Release-Bau (${release.js.length} JS), ${test.dateien} im Testbau (${test.js.length} JS)`);
    if (release.js.length === 0) {
      console.error(`  ROT: ${bau}: keine JS-Dateien im Release-Bau`);
      rot = true;
    }
    const nurRelease = release.js.filter((n) => !test.js.includes(n));
    const nurTest = test.js.filter((n) => !release.js.includes(n));
    for (const n of nurRelease) console.error(`  ROT: ${bau}: ${n} nur im Release-Bau`);
    for (const n of nurTest) console.error(`  ROT: ${bau}: ${n} nur im Testbau`);
    if (nurRelease.length || nurTest.length) rot = true;
    for (const muster of TESTHAKEN_SPUREN) {
      const imRelease = release.treffer[muster];
      const imTest = test.treffer[muster];
      console.log(`  ${muster}: Release ${imRelease.length} Treffer, Testbau ${imTest.length} Treffer`);
      for (const datei of imRelease) {
        console.error(`  ROT: ${datei} enthaelt "${muster}"`);
        rot = true;
      }
    }
    for (const muster of SPUREN_IM_TESTBAU) {
      if (test.treffer[muster].length === 0) {
        console.error(`  ROT: Gegenprobe: "${muster}" steht nicht einmal im Testbau (${bau}), die Suche waere wirkungslos`);
        rot = true;
      }
    }
  }
  console.log(`Release-Pruefung: ${rot ? 'ROT' : 'gruen'}`);
  return rot ? 1 : 0;
}
const releaseCode = releasePruefung();

// Beide Tests immer ausfuehren, auch wenn der erste rot ist.
const ergebnisse = [];
for (const [name, skript] of NUR_RELEASE
  ? []
  : [
      ['chromium', 'test:chromium'],
      ['firefox', 'test:firefox'],
    ]) {
  console.log(`\n== ${skript} (${TESTBAU.VEIL_AUSGABE}) ==`);
  const { code, text } = await lauf(skript, TESTBAU);
  const treffer = text.match(/Attribut nach (\d+) ms/);
  ergebnisse.push({ name, code, ms: treffer ? Number(treffer[1]) : null });
}

console.log('\n== Zusammenfassung ==');
for (const { name, code, ms } of ergebnisse) {
  const zeit = ms === null ? 'keine Messung' : `${ms} ms`;
  console.log(`${name}: ${code === 0 ? 'gruen' : 'ROT'} (Exit ${code}), Attribut nach ${zeit}`);
}
console.log(`release: ${releaseCode === 0 ? 'gruen' : 'ROT'} (Exit ${releaseCode}), ${TESTHAKEN_SPUREN.length} Spuren in beiden Bauten gesucht`);
const gesamt = ergebnisse.some((e) => e.code !== 0) || releaseCode !== 0 ? 1 : 0;
console.log(`Gesamt: ${gesamt === 0 ? 'gruen' : 'ROT'} (Exit ${gesamt})`);
process.exit(gesamt);
