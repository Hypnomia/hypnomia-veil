// Einheitstest (Phase 11 E4f, F7 R1): zwei Saetze stehen als Literal an zwei Stellen und muessen gleich bleiben (kein Text aendert sich in einer Datei allein).
// C42: Unterzeile des Schalters der Erwachsenenseiten in `pack-einrichten.ts` (Willkommensseite) und im Popup; A104: Unterzeile der Leerlauf-Spirale in
// `pack-einrichten.ts` und auf der Einstellungsseite. Fehlt ein Satz in einer der Dateien oder weicht er ab, ist der Test rot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lies = (pfad) => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8');
const PAARE = [
  { name: 'C42', satz: 'on the sites I know, I swap the thumbnails for mine', dateien: ['entrypoints/options/pack-einrichten.ts', 'entrypoints/popup/index.html'] },
  { name: 'A104', satz: 'Sit still too long and my spiral comes. Any move or key ends it.', dateien: ['entrypoints/options/pack-einrichten.ts', 'entrypoints/options/index.html'] },
];

for (const p of PAARE) {
  test(`${p.name}: derselbe Satz in ${p.dateien.join(' und ')}`, () => {
    for (const datei of p.dateien) assert.ok(lies(datei).includes(p.satz), `${p.name} fehlt oder weicht ab in ${datei}`);
    // Der Satz steht in jeder Datei genau einmal (kein drittes, abweichendes Duplikat daneben).
    for (const datei of p.dateien) assert.equal(lies(datei).split(p.satz).length - 1, 1, `${p.name} nicht genau einmal in ${datei}`);
  });
}
