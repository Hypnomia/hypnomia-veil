// Einheitstests ohne Browser: Nachverarbeitung der Modellausgabe (src/erkenner/modell.ts).
// Node laedt die TypeScript-Datei direkt (Typen werden entfernt); das Modul braucht keine WXT-Globale.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometrieFuer, iou, KLASSEN, MODELL_GROESSE, NMS_IOU, nachverarbeite, ZUORDNUNG } from '../../src/erkenner/modell.ts';

const KANAELE = 4 + KLASSEN.length;

// Baut eine synthetische Ausgabe [1, 22, n]: je Anker Mittelpunkt, Breite, Hoehe (im 320er Feld) und ein Klassenwert.
function ausgabe(anker) {
  const n = Math.max(1, anker.length);
  const daten = new Float32Array(KANAELE * n);
  anker.forEach((a, i) => {
    daten[i] = a.mx;
    daten[n + i] = a.my;
    daten[2 * n + i] = a.b;
    daten[3 * n + i] = a.h;
    daten[(4 + KLASSEN.indexOf(a.klasse)) * n + i] = a.score;
  });
  return { daten, dims: [1, KANAELE, n] };
}

const lauf = (anker, geo, schwelle = 0.1) => {
  const { daten, dims } = ausgabe(anker);
  return nachverarbeite(daten, dims, geo, schwelle);
};

test('Geometrie: Skala richtet sich nach der laengeren Seite', () => {
  assert.equal(MODELL_GROESSE, 320);
  assert.deepEqual(geometrieFuer(640, 480), { skala: 0.5, breite: 640, hoehe: 480 });
  assert.deepEqual(geometrieFuer(160, 320), { skala: 1, breite: 160, hoehe: 320 });
});

test('Abbildung: Box aus dem 320er Feld zurueck in Bildkoordinaten (Querformat)', () => {
  const geo = geometrieFuer(640, 480);
  // Mitte (160, 120), 80 x 60 im Feld, Skala 0,5: Ecke (120, 90) wird (240, 180), Groesse 160 x 120.
  const t = lauf([{ mx: 160, my: 120, b: 80, h: 60, klasse: 'FEMALE_BREAST_EXPOSED', score: 0.9 }], geo);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].box, [240, 180, 160, 120]);
  assert.equal(t[0].zone, 'breast');
  assert.equal(t[0].bedeckt, false);
  assert.equal(t[0].score, 0.9);
});

test('Abbildung: Auffuellen unten kuerzt Boxen, die in den schwarzen Rand ragen', () => {
  const geo = geometrieFuer(640, 480);
  // Das Bild belegt im Feld nur y von 0 bis 240. Box y 200 bis 280 im Feld: Bildkoordinaten y 400 bis 560, begrenzt auf 480.
  const t = lauf([{ mx: 100, my: 240, b: 40, h: 80, klasse: 'BUTTOCKS_EXPOSED', score: 0.8 }], geo);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].box, [160, 400, 80, 80]);
});

test('Abbildung: Auffuellen rechts kuerzt Boxen, die in den schwarzen Rand ragen', () => {
  const geo = geometrieFuer(480, 640);
  // Hochformat 480 x 640, Skala 0,5, belegt im Feld x von 0 bis 240. Box x 210 bis 250: Bild x 420 bis 500, begrenzt auf 480.
  const t = lauf([{ mx: 230, my: 100, b: 40, h: 40, klasse: 'FEMALE_GENITALIA_EXPOSED', score: 0.7 }], geo);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].box, [420, 160, 60, 80]);
});

test('Box ueber den linken Rand: die Breite schrumpft um den abgeschnittenen Teil', () => {
  const geo = geometrieFuer(640, 480);
  // x von -10 bis 30 im Feld: sichtbar sind nur 30 Feldpixel, also 60 Bildpixel (nicht 80).
  const t = lauf([{ mx: 10, my: 60, b: 40, h: 40, klasse: 'BELLY_EXPOSED', score: 0.6 }], geo);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].box, [0, 80, 60, 80]);
});

test('Box ganz im Auffuellrand oder kleiner als ein Pixel faellt weg', () => {
  const geo = geometrieFuer(480, 640);
  const imRand = { mx: 300, my: 100, b: 20, h: 20, klasse: 'FEET_EXPOSED', score: 0.9 };
  const winzig = { mx: 50, my: 50, b: 0.4, h: 40, klasse: 'FEET_EXPOSED', score: 0.9 };
  assert.deepEqual(lauf([imRand, winzig], geo), []);
});

test('Schwelle: Werte darunter fallen weg, genau die Schwelle bleibt', () => {
  const geo = geometrieFuer(320, 320);
  const a = { mx: 80, my: 80, b: 40, h: 40, klasse: 'FEMALE_BREAST_COVERED', score: 0.5 };
  const b = { mx: 240, my: 240, b: 40, h: 40, klasse: 'FEMALE_BREAST_COVERED', score: 0.49 };
  assert.equal(lauf([a, b], geo, 0.5).length, 1);
  assert.equal(lauf([a, b], geo, 0.4).length, 2);
  assert.equal(lauf([a, b], geo, 0.6).length, 0);
});

test('NMS: Ueberlappung ueber 0,45 wird unterdrueckt, darunter bleiben beide', () => {
  assert.equal(NMS_IOU, 0.45);
  const geo = geometrieFuer(320, 320);
  // Zwei Boxen 100 x 100, seitlich um s verschoben: IoU = (100 - s) / (100 + s).
  const paar = (s) => [
    { mx: 150, my: 150, b: 100, h: 100, klasse: 'FEMALE_BREAST_EXPOSED', score: 0.9 },
    { mx: 150 + s, my: 150, b: 100, h: 100, klasse: 'FEMALE_BREAST_EXPOSED', score: 0.8 },
  ];
  assert.ok(iou([0, 0, 100, 100], [30, 0, 100, 100]) > NMS_IOU);
  assert.ok(iou([0, 0, 100, 100], [45, 0, 100, 100]) < NMS_IOU);
  const unterdrueckt = lauf(paar(30), geo);
  assert.equal(unterdrueckt.length, 1);
  assert.equal(unterdrueckt[0].score, 0.9);
  const beide = lauf(paar(45), geo);
  assert.equal(beide.length, 2);
  // Hoechster Wert zuerst.
  assert.deepEqual(beide.map((t) => t.score), [0.9, 0.8]);
});

test('NMS gilt ueber alle Klassen: schwaecherer Treffer anderer Klasse am selben Ort entfaellt', () => {
  const geo = geometrieFuer(320, 320);
  const t = lauf(
    [
      { mx: 150, my: 150, b: 100, h: 100, klasse: 'FEMALE_BREAST_EXPOSED', score: 0.6 },
      { mx: 152, my: 150, b: 100, h: 100, klasse: 'FEMALE_BREAST_COVERED', score: 0.9 },
    ],
    geo,
  );
  assert.equal(t.length, 1);
  assert.equal(t[0].bedeckt, true);
});

test('Klassenzuordnung: bedeckt nur bei den COVERED-Klassen, Gesicht ist nie bedeckt', () => {
  assert.equal(KLASSEN.length, 18);
  for (const name of KLASSEN) {
    const z = ZUORDNUNG[name];
    assert.ok(z, `Zuordnung fehlt: ${name}`);
    assert.equal(z[1], name.endsWith('_COVERED'), name);
  }
  assert.deepEqual(ZUORDNUNG.FACE_FEMALE, ['face', false]);
  assert.deepEqual(ZUORDNUNG.FACE_MALE, ['face', false]);
  assert.deepEqual(ZUORDNUNG.ANUS_EXPOSED, ['buttocks', false]);
  assert.deepEqual(ZUORDNUNG.MALE_GENITALIA_EXPOSED, ['genitals', false]);
  const treffer = lauf([{ mx: 100, my: 100, b: 50, h: 50, klasse: 'FEMALE_GENITALIA_COVERED', score: 0.9 }], geometrieFuer(320, 320));
  assert.equal(treffer[0].zone, 'genitals');
  assert.equal(treffer[0].bedeckt, true);
});

test('Ausgabe: ganze Pixel, Wert auf drei Stellen gerundet, leere Ausgabe ergibt keine Treffer', () => {
  const geo = geometrieFuer(320, 320);
  const t = lauf([{ mx: 100.6, my: 100.6, b: 50.4, h: 50.4, klasse: 'ARMPITS_EXPOSED', score: 0.87654 }], geo);
  assert.equal(t.length, 1);
  assert.ok(t[0].box.every(Number.isInteger));
  assert.ok(t[0].box[2] >= 1 && t[0].box[3] >= 1);
  assert.equal(t[0].score, 0.877);
  assert.deepEqual(lauf([], geo), []);
});

test('iou: gleich 1, getrennt 0, halb ueberlappend', () => {
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(iou([0, 0, 10, 10], [20, 20, 5, 5]), 0);
  assert.ok(Math.abs(iou([0, 0, 10, 10], [5, 0, 10, 10]) - 1 / 3) < 1e-9);
});
