// Einheitstest Freilegen (Auftrag F): Auswahl der Knoepfe, Position, Zeitrechnung (reine Teile ohne DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beschneide,
  istAbgelaufen,
  istFreilegbar,
  knopfPosition,
  restMs,
  sekundenFuerSatz,
  waehleKnoepfe,
} from '../../src/schleier/freilegen-rein.ts';

const basis = { art: 'bild', urteil: 'zensiert', ersetzt: false, freigelegt: false, breite: 200, hoehe: 150 };
const rr = (links, oben, b, h) => ({ links, oben, rechts: links + b, unten: oben + h });

test('freilegbar: nur zensierte Bilder und Hintergruende ab 80 px', () => {
  assert.equal(istFreilegbar(basis), true);
  assert.equal(istFreilegbar({ ...basis, art: 'hintergrund' }), true);
  assert.equal(istFreilegbar({ ...basis, art: 'video' }), false);
  assert.equal(istFreilegbar({ ...basis, art: 'canvas' }), false);
  assert.equal(istFreilegbar({ ...basis, urteil: 'verdeckt' }), false);
  assert.equal(istFreilegbar({ ...basis, urteil: 'frei' }), false);
  assert.equal(istFreilegbar({ ...basis, urteil: null }), false);
  assert.equal(istFreilegbar({ ...basis, ersetzt: true }), false);
  assert.equal(istFreilegbar({ ...basis, freigelegt: true }), false);
  assert.equal(istFreilegbar({ ...basis, breite: 79 }), false);
  assert.equal(istFreilegbar({ ...basis, hoehe: 79 }), false);
  assert.equal(istFreilegbar({ ...basis, breite: 80, hoehe: 80 }), true);
});

test('Auswahl: die groessten zuerst, hoechstens 24, kleine fliegen raus', () => {
  const liste = Array.from({ length: 40 }, (_, i) => ({ ziel: i, rechteck: rr(0, i * 10, 100 + i, 100 + i) }));
  liste.push({ ziel: 'klein', rechteck: rr(0, 0, 79, 500) });
  const w = waehleKnoepfe(liste);
  assert.equal(w.length, 24);
  assert.equal(w[0].ziel, 39);
  assert.equal(w[23].ziel, 16);
  assert.ok(!w.some((x) => x.ziel === 'klein'));
  assert.equal(waehleKnoepfe(liste, 3).length, 3);
  assert.equal(waehleKnoepfe(liste, 0).length, 0);
});

test('Auswahl: gleiche Groesse ordnet nach oben, dann links', () => {
  const w = waehleKnoepfe([
    { ziel: 'b', rechteck: rr(200, 0, 100, 100) },
    { ziel: 'c', rechteck: rr(0, 50, 100, 100) },
    { ziel: 'a', rechteck: rr(0, 0, 100, 100) },
  ]);
  assert.deepEqual(w.map((x) => x.ziel), ['a', 'b', 'c']);
});

test('Beschneiden und Knopfposition', () => {
  assert.equal(beschneide(rr(-500, -500, 100, 100), 800, 600), null);
  const s = beschneide(rr(700, 500, 300, 300), 800, 600);
  assert.deepEqual(s, { links: 700, oben: 500, rechts: 800, unten: 600 });
  const p = knopfPosition(rr(0, 0, 300, 200));
  assert.deepEqual(p, { x: 300 - 68 - 4, y: 4 });
  assert.equal(knopfPosition(rr(0, 0, 60, 200)), null);
  assert.equal(knopfPosition(rr(0, 0, 300, 20)), null);
  assert.ok(knopfPosition(rr(0, 0, 80, 80)));
});

test('Zeitrechnung', () => {
  assert.equal(restMs(1000, 400), 600);
  assert.equal(restMs(1000, 2000), 0);
  assert.equal(istAbgelaufen(1000, 999), false);
  assert.equal(istAbgelaufen(1000, 1000), true);
  assert.equal(sekundenFuerSatz(10000), 10);
  assert.equal(sekundenFuerSatz(3000), 3);
  assert.equal(sekundenFuerSatz(100), 1);
});
