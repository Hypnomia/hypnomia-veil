// Gesamtlauf fuer npm test: Build Chrome, Build Firefox, Zip Firefox, dann beide Browser-Tests.
// Beide Tests laufen auch dann, wenn einer rot ist. Am Ende steht eine Zusammenfassung mit Millisekunden.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Fuehrt ein npm-Skript aus, reicht die Ausgabe durch und liefert Exit-Code sowie Text.
function lauf(skript) {
  return new Promise((aufloesen) => {
    const kind = spawn(npm, ['run', skript], { stdio: ['ignore', 'pipe', 'pipe'] });
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

// Bauschritte: bricht einer ab, laufen die Tests nicht (sie haetten keine Grundlage).
for (const schritt of ['build', 'build:firefox', 'zip:firefox']) {
  console.log(`\n== ${schritt} ==`);
  const { code } = await lauf(schritt);
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
  console.log(`\n== ${skript} ==`);
  const { code, text } = await lauf(skript);
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
