// Gesamtlauf fuer npm test: Build Chrome, Build Firefox, Zip Firefox, dann beide Browser-Tests.
// Beide Tests laufen auch dann, wenn einer rot ist. Am Ende steht eine Zusammenfassung mit Millisekunden.
// Zusaetzlich baut der Lauf ohne Testhaken (Release-Pruefung) und sucht in allen JS-Dateien beider Bauten nach den Spuren der Testhaken.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SPUREN_IM_TESTBAU, suche, TESTHAKEN_SPUREN } from './testhaken-spuren.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Testbauten (mit Testhaken) landen in einem eigenen Ordner, nie unter den Release-Namen in .output.
const TESTBAU = { WXT_TESTHAKEN: '1', VEIL_AUSGABE: process.env.VEIL_AUSGABE ?? '.output-test' };
// Playwright-Chromium fuer die Chromium-Tests: kommt nicht mehr aus postinstall (Reviewer sollen es nicht laden), sondern aus `npm run test:setup`.
if (process.env.VEIL_NUR_RELEASEPRUEFUNG !== '1') {
  const { chromium } = await import('@playwright/test');
  let pfad = '';
  try {
    pfad = chromium.executablePath();
  } catch {
    // Fehlermeldung unten
  }
  if (!pfad || !existsSync(pfad)) {
    console.error('TEST-LAUF ABGEBROCHEN: Playwright-Chromium fehlt. Einmal `npm run test:setup` ausfuehren (laedt es), dann `npm test` erneut.');
    process.exit(1);
  }
}
// Bau ohne Testhaken fuer die Release-Pruefung: der Schalter ist leer (nicht "1"), der Ordner gehoert nur dieser Pruefung.
const RELEASEBAU = { WXT_TESTHAKEN: '', VEIL_AUSGABE: '.output-release-pruefung' };
// Kern-Bilder der Testbaue (Phase 7, Auftrag I3): synthetische Bilder in einem Ordner ausserhalb des Repos statt der echten aus `../02 Assets Mia/kern/`,
// damit der Fall "mit Kern-Bildern" nie an echten Mia-Bildern haengt. Ein VEIL_KERN von aussen gewinnt. VEIL_KERN_PFLICHT=1 sagt den Kern-Tests,
// dass sie ihre Faelle nicht still ueberspringen duerfen (fehlt ein Bau, sind sie rot).
if (!process.env.VEIL_KERN && process.env.VEIL_NUR_RELEASEPRUEFUNG !== '1') {
  const { baueKernTest } = await import('./pack/baue-kern-test.mjs');
  TESTBAU.VEIL_KERN = await baueKernTest(mkdtempSync(path.join(tmpdir(), 'veil-kern-test-')), 3);
}
TESTBAU.VEIL_KERN_PFLICHT = '1';
// Spuren der Testhaken und ihre Suche stehen in scripts/testhaken-spuren.mjs (gemeinsam mit scripts/release/firefox.mjs).

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

// Testbau ohne Kern-Bilder (Phase 7, Auftrag I3): VEIL_KERN zeigt auf einen Ordner, den es nicht gibt, der Bau warnt und kopiert nichts. Die Kern-Tests
// pruefen damit den Fall "kein Rahmen ohne Bild", auch wenn `../02 Assets Mia/kern/` im Standardbau da ist.
const OHNEKERN = { WXT_TESTHAKEN: '1', VEIL_AUSGABE: process.env.VEIL_AUSGABE_OHNE_KERN ?? '.output-test-ohnekern', VEIL_KERN: '/nonexistent-kern-ordner' };
for (const schritt of NUR_RELEASE ? [] : ['build', 'build:firefox', 'zip:firefox']) {
  console.log(`\n== ${schritt} (ohne Kern-Bilder, ${OHNEKERN.VEIL_AUSGABE}) ==`);
  const { code } = await lauf(schritt, OHNEKERN);
  if (code !== 0) {
    console.error(`\nTEST-LAUF ABGEBROCHEN: Schritt "${schritt}" ohne Kern-Bilder ist fehlgeschlagen (Exit ${code}).`);
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
