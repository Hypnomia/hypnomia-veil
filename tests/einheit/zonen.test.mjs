// Einheitstests ohne Browser: Zonen aus Treffern (src/erkenner/zonen.ts) und die Schranke (src/erkenner/schranke.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schranke } from '../../src/erkenner/schranke.ts';
import {
  aktiveZonenBoxen,
  begrenzeBox,
  berechneFlaechen,
  fuehreZusammen,
  gesichtsZonen,
  mitRand,
} from '../../src/erkenner/zonen.ts';

const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];

// Zonen-Einstellung: `an` listet die eingeschalteten Zonen, `bedeckt` die Zonen mit "auch bedeckt".
function zonen(an, bedeckt = []) {
  const z = {};
  for (const name of ALLE) {
    z[name] = BEDECKBAR.includes(name) ? { an: an.includes(name), bedeckt: bedeckt.includes(name) } : { an: an.includes(name) };
  }
  return z;
}
const treffer = (zone, box, bedeckt = false, score = 0.9) => ({ zone, bedeckt, score, box });
const flaeche = (zone, box) => ({ zone, box });

test('begrenzeBox: auf das Bild begrenzen, mindestens 1 x 1', () => {
  assert.deepEqual(begrenzeBox(-10, -5, 50, 40, 100, 100), [0, 0, 40, 35]);
  assert.deepEqual(begrenzeBox(80, 90, 50, 50, 100, 100), [80, 90, 20, 10]);
  assert.deepEqual(begrenzeBox(150, 150, 10, 10, 100, 100), [99, 99, 1, 1]);
  assert.deepEqual(begrenzeBox(10.4, 10.4, 5.2, 5.2, 100, 100), [10, 10, 6, 6]);
});

test('Gesichtsbaender: Kopf, Augen und Mund aus der Gesichtsbox', () => {
  const z = gesichtsZonen([100, 100, 100, 100], 1000, 1000);
  assert.deepEqual(z.face, [100, 100, 100, 100]);
  assert.deepEqual(z.head, [65, 35, 170, 195]);
  assert.deepEqual(z.eyes, [105, 118, 90, 24]);
  assert.deepEqual(z.mouth, [120, 162, 60, 24]);
});

test('Gesichtsbaender: am Bildrand begrenzt', () => {
  const z = gesichtsZonen([0, 0, 100, 100], 120, 150);
  assert.deepEqual(z.head, [0, 0, 120, 130]);
  for (const box of Object.values(z)) {
    assert.ok(box[0] >= 0 && box[1] >= 0 && box[0] + box[2] <= 120 && box[1] + box[3] <= 150);
  }
});

test('Nur aktive Zonen kommen durch', () => {
  const t = [treffer('breast', [10, 10, 50, 50]), treffer('belly', [10, 100, 50, 50]), treffer('feet', [10, 200, 50, 50])];
  const r = aktiveZonenBoxen(t, zonen(['breast', 'feet']), 400, 400);
  assert.deepEqual(r.map((f) => f.zone), ['breast', 'feet']);
  assert.deepEqual(aktiveZonenBoxen(t, zonen([]), 400, 400), []);
});

test('Bedeckte Treffer nur mit `bedeckt` der Zone', () => {
  const t = [treffer('breast', [10, 10, 50, 50], true), treffer('genitals', [10, 100, 50, 50], true)];
  const nurBrust = aktiveZonenBoxen(t, zonen(['breast', 'genitals'], ['genitals']), 400, 400);
  assert.deepEqual(nurBrust.map((f) => f.zone), ['genitals']);
  const beide = aktiveZonenBoxen(t, zonen(['breast', 'genitals'], ['breast', 'genitals']), 400, 400);
  assert.equal(beide.length, 2);
  // Unbedeckter Treffer zaehlt unabhaengig von `bedeckt`.
  const frei = aktiveZonenBoxen([treffer('breast', [10, 10, 50, 50], false)], zonen(['breast']), 400, 400);
  assert.equal(frei.length, 1);
});

test('Gesichtstreffer liefert nur die eingeschalteten Gesichtszonen', () => {
  const t = [treffer('face', [100, 100, 100, 100])];
  assert.deepEqual(aktiveZonenBoxen(t, zonen(['eyes']), 1000, 1000).map((f) => f.zone), ['eyes']);
  assert.deepEqual(aktiveZonenBoxen(t, zonen(['head', 'mouth']), 1000, 1000).map((f) => f.zone), ['head', 'mouth']);
  assert.deepEqual(aktiveZonenBoxen(t, zonen(['breast']), 1000, 1000), []);
});

test('Zusammenfuehren: gleiche Zone mit IoU ueber 0,3 verschmilzt, andere Zone bleibt getrennt', () => {
  const r = fuehreZusammen([
    flaeche('breast', [0, 0, 100, 100]),
    flaeche('breast', [50, 0, 100, 100]),
    flaeche('belly', [0, 0, 100, 100]),
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.find((f) => f.zone === 'breast').box, [0, 0, 150, 100]);
  assert.deepEqual(r.find((f) => f.zone === 'belly').box, [0, 0, 100, 100]);
});

test('Zusammenfuehren: kleine Box (Ueberdeckung ueber 0,6) in grosser verschmilzt, entfernte nicht', () => {
  const nah = fuehreZusammen([flaeche('feet', [0, 0, 100, 100]), flaeche('feet', [10, 10, 50, 50])]);
  assert.deepEqual(nah.map((f) => f.box), [[0, 0, 100, 100]]);
  const weit = fuehreZusammen([flaeche('feet', [0, 0, 100, 100]), flaeche('feet', [200, 200, 50, 50])]);
  assert.equal(weit.length, 2);
  // Kaum Ueberlappung (IoU unter 0,3, Ueberdeckung unter 0,6): getrennt.
  const kaum = fuehreZusammen([flaeche('feet', [0, 0, 100, 100]), flaeche('feet', [80, 0, 100, 100])]);
  assert.equal(kaum.length, 2);
});

test('Zusammenfuehren: Verschachteltes in Kopf oder Gesicht wird verschluckt, in anderen Zonen nicht', () => {
  const imKopf = fuehreZusammen([flaeche('head', [0, 0, 200, 200]), flaeche('breast', [50, 50, 40, 40])]);
  assert.deepEqual(imKopf.map((f) => f.zone), ['head']);
  const imGesicht = fuehreZusammen([flaeche('face', [0, 0, 200, 200]), flaeche('mouth', [50, 150, 100, 40])]);
  assert.deepEqual(imGesicht.map((f) => f.zone), ['face']);
  // Nur zu 50 Prozent im Kopf: bleibt.
  const halb = fuehreZusammen([flaeche('head', [0, 0, 100, 100]), flaeche('breast', [50, 20, 100, 40])]);
  assert.equal(halb.length, 2);
  // Brust deckt nichts: Verschachteltes bleibt.
  const brust = fuehreZusammen([flaeche('breast', [0, 0, 200, 200]), flaeche('genitals', [50, 50, 40, 40])]);
  assert.equal(brust.length, 2);
});

test('Zusammenfuehren: Fixpunkt, auch wenn erst die Vereinigung eine dritte Box erreicht', () => {
  // Ein einzelner Durchgang liesse hier zwei Boxen uebrig: die dritte Box waechst die erste, die zweite passt erst danach dazu.
  const eingabe = [
    flaeche('breast', [10, 50, 100, 100]),
    flaeche('breast', [20, 10, 70, 90]),
    flaeche('breast', [40, 40, 70, 30]),
  ];
  const r = fuehreZusammen(eingabe);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].box, [10, 10, 100, 140]);
  assert.deepEqual(fuehreZusammen(r), r);
  // Eingabe bleibt unveraendert.
  assert.deepEqual(eingabe[0].box, [10, 50, 100, 100]);
  assert.deepEqual(fuehreZusammen([]), []);
});

test('Rand: je Seite Anteil der Boxgroesse, auf das Bild begrenzt', () => {
  const r = mitRand([flaeche('breast', [100, 100, 100, 50])], 0.15, 1000, 1000);
  // Halbe Pixel runden nach aussen (floor und ceil).
  assert.deepEqual(r[0].box, [85, 92, 130, 66]);
  const rand = mitRand([flaeche('breast', [0, 0, 100, 100])], 0.5, 120, 120);
  assert.deepEqual(rand[0].box, [0, 0, 120, 120]);
  assert.deepEqual(mitRand([flaeche('feet', [10, 10, 20, 20])], 0, 100, 100)[0].box, [10, 10, 20, 20]);
});

test('berechneFlaechen: aktive Zonen, Zusammenfuehren und Rand zusammen', () => {
  const t = [
    treffer('breast', [100, 100, 100, 100]),
    treffer('breast', [150, 100, 100, 100]),
    treffer('belly', [100, 400, 50, 50]),
  ];
  const r = berechneFlaechen(t, { zonen: zonen(['breast']), rand: 0.1 }, 1000, 1000);
  assert.equal(r.length, 1);
  assert.equal(r[0].zone, 'breast');
  // Vereinigung [100, 100, 150, 100], Rand 15 und 10 je Seite.
  assert.deepEqual(r[0].box, [85, 90, 180, 120]);
});

test('berechneFlaechen: bei allen Gesichtszonen bleibt nur der Kopf (Gesicht, Augen, Mund liegen darin)', () => {
  const t = [treffer('face', [300, 300, 100, 100])];
  const r = berechneFlaechen(t, { zonen: zonen(['eyes', 'mouth', 'face', 'head']), rand: 0 }, 1000, 1000);
  assert.deepEqual(r.map((f) => f.zone), ['head']);
});

test('Schranke: hoechstens so viele gleichzeitig, der Rest wartet der Reihe nach', async () => {
  const s = new Schranke(2);
  let gleichzeitig = 0;
  let hoechstens = 0;
  const reihenfolge = [];
  const arbeit = (nr) =>
    s.mitPlatz(async () => {
      gleichzeitig++;
      hoechstens = Math.max(hoechstens, gleichzeitig);
      reihenfolge.push(nr);
      await new Promise((ok) => setTimeout(ok, 5));
      gleichzeitig--;
      return nr;
    });
  const ergebnis = await Promise.all([1, 2, 3, 4, 5, 6].map(arbeit));
  assert.deepEqual(ergebnis, [1, 2, 3, 4, 5, 6]);
  assert.equal(hoechstens, 2);
  assert.deepEqual(reihenfolge, [1, 2, 3, 4, 5, 6]);
  assert.equal(s.wartend, 0);
});

test('Schranke: Fehler geben den Platz wieder frei, doppeltes Abgeben schadet nicht', async () => {
  const s = new Schranke(1);
  await assert.rejects(s.mitPlatz(async () => { throw new Error('kaputt'); }), /kaputt/);
  assert.equal(await s.mitPlatz(async () => 'weiter'), 'weiter');
  const abgeben = await s.betrete();
  abgeben();
  abgeben();
  const a = await s.betrete();
  let zweiter = false;
  const b = s.betrete().then((freigabe) => {
    zweiter = true;
    return freigabe;
  });
  await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(zweiter, false);
  assert.equal(s.wartend, 1);
  a();
  (await b)();
  assert.equal(zweiter, true);
});
