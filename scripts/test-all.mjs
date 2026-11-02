// Gesamtlauf fuer npm test: Build Chrome, Build Firefox, Zip Firefox, dann beide Browser-Tests.
// Beide Tests laufen auch dann, wenn einer rot ist. Am Ende steht eine Zusammenfassung mit Millisekunden.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Testbauten (mit Testhaken) landen in einem eigenen Ordner, nie unter den Release-Namen in .output.
const TESTBAU = { WXT_TESTHAKEN: '1', VEIL_AUSGABE: process.env.VEIL_AUSGABE ?? '.output-test' };

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

// Einheitstests ohne Browser zuerst (Nachverarbeitung, Zonen, Ausnahmen).
{
  console.log('\n== test:einheit ==');
  const { code } = await lauf('test:einheit');
  if (code !== 0) {
    console.error(`\nTEST-LAUF ABGEBROCHEN: Einheitstests rot (Exit ${code}).`);
    process.exit(code);
  }
}

// Bauschritte: bricht einer ab, laufen die Tests nicht (sie haetten keine Grundlage).
// WXT_TESTHAKEN=1 baut die Testhaken (data-veil-status, veil-test auf 127.0.0.1) mit ein; Release-Builds (npm run zip) haben sie nicht.
for (const schritt of ['build', 'build:firefox', 'zip:firefox']) {
  console.log(`\n== ${schritt} (WXT_TESTHAKEN=1, ${TESTBAU.VEIL_AUSGABE}) ==`);
  const { code } = await lauf(schritt, TESTBAU);
  if (code !== 0) {
    console.error(`\nTEST-LAUF ABGEBROCHEN: Schritt "${schritt}" ist fehlgeschlagen (Exit ${code}).`);
    process.exit(code);
  }
}

// Beide Tests immer ausfuehren, auch wenn der erste rot ist.
const ergebnisse = [];
for (const [name, skript] of [
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
const gesamt = ergebnisse.some((e) => e.code !== 0) ? 1 : 0;
console.log(`Gesamt: ${gesamt === 0 ? 'gruen' : 'ROT'} (Exit ${gesamt})`);
process.exit(gesamt);
