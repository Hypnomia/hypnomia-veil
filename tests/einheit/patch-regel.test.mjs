// Einheitstests der Passt-Regel fuer Mias Gesicht (src/erkenner/stile.ts, patchPasst): sichtbarer Anteil des Bildes nach dem Beschneiden und kleinste Seite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATCH_MIN_ANTEIL, PATCH_MIN_SEITE, patchPasst, sichtbarerAnteil } from '../../src/erkenner/stile.ts';

test('Konstanten: Haelfte des Bildes, 24 px', () => {
  assert.equal(PATCH_MIN_ANTEIL, 0.5);
  assert.equal(PATCH_MIN_SEITE, 24);
});

test('sichtbarerAnteil: gleiches Format 1, doppelt so breit oder hoch 0,5, Streifen 4 zu 1 gegen Quadrat 0,25', () => {
  assert.equal(sichtbarerAnteil(100, 100, 400, 400), 1);
  assert.equal(sichtbarerAnteil(200, 100, 400, 400), 0.5);
  assert.equal(sichtbarerAnteil(100, 200, 400, 400), 0.5);
  assert.equal(sichtbarerAnteil(400, 100, 300, 300), 0.25);
  assert.equal(sichtbarerAnteil(0, 100, 300, 300), 0);
  assert.equal(sichtbarerAnteil(100, 100, 0, 300), 0);
});

test('sichtbarerAnteil stimmt mit dem formatfuellenden Beschnitt von zeichnePatch ueberein', () => {
  // zeichnePatch: skala = max(w/sb, h/sh), sichtbar sind (w/skala) x (h/skala) des Bildes.
  for (const [w, h, sb, sh] of [[300, 120, 600, 800], [90, 300, 800, 600], [64, 64, 1024, 683]]) {
    const skala = Math.max(w / sb, h / sh);
    const echt = (w / skala) * (h / skala) / (sb * sh);
    assert.ok(Math.abs(sichtbarerAnteil(w, h, sb, sh) - echt) < 1e-12, `${w}x${h} in ${sb}x${sh}`);
  }
});

test('patchPasst: genau Faktor 2 passt noch, knapp darueber nicht', () => {
  assert.equal(patchPasst([0, 0, 200, 100], 400, 400), true);
  assert.equal(patchPasst([0, 0, 201, 100], 400, 400), false);
  assert.equal(patchPasst([0, 0, 100, 200], 400, 400), true);
  assert.equal(patchPasst([0, 0, 100, 201], 400, 400), false);
});

test('patchPasst: schmale lange Streifen (Augen, Mund) passen nicht, auch nicht zu einem breiten Patch', () => {
  assert.equal(patchPasst([0, 0, 240, 40], 800, 600), false); // 6 zu 1 gegen 4 zu 3
  assert.equal(patchPasst([0, 0, 40, 240], 600, 800), false);
  assert.equal(patchPasst([0, 0, 180, 60], 800, 800), false); // 3 zu 1
});

test('patchPasst: kleinste Seite mindestens 24 px, auch bei passendem Format', () => {
  assert.equal(patchPasst([0, 0, 24, 24], 500, 500), true);
  assert.equal(patchPasst([0, 0, 23, 23], 500, 500), false);
  assert.equal(patchPasst([0, 0, 40, 23], 500, 500), false);
  assert.equal(patchPasst([0, 0, 23, 40], 500, 500), false);
  assert.equal(patchPasst([0, 0, 30, 30], 500, 500), true);
});

test('patchPasst: gewoehnliche Brust- und Po-Flaechen im Hoch- und Querformat passen', () => {
  assert.equal(patchPasst([10, 10, 180, 150], 800, 1000), true);
  assert.equal(patchPasst([10, 10, 300, 220], 1200, 800), true);
});

test('patchPasst: die kleinste Seite zaehlt in Anzeigegroesse (anzeigeSkala), das Verhaeltnis bleibt', () => {
  // Arbeitsbild 1600 px, angezeigt 400 px: Skala 0,25. Eine Flaeche von 60 x 60 Arbeitspixeln ist 15 x 15 auf dem Bildschirm.
  assert.equal(patchPasst([0, 0, 60, 60], 500, 500), true);
  assert.equal(patchPasst([0, 0, 60, 60], 500, 500, 0.25), false);
  assert.equal(patchPasst([0, 0, 96, 96], 500, 500, 0.25), true); // 24 px angezeigt
  assert.equal(patchPasst([0, 0, 95, 95], 500, 500, 0.25), false);
  // Vergroesserte Darstellung: 12 Arbeitspixel sind angezeigt 24
  assert.equal(patchPasst([0, 0, 12, 12], 500, 500, 2), true);
  // Das Verhaeltnis aendert die Skala nicht
  assert.equal(patchPasst([0, 0, 400, 100], 500, 500, 0.25), false);
  // Unbrauchbare Skala zaehlt als 1
  for (const k of [0, -1, NaN, Infinity]) assert.equal(patchPasst([0, 0, 30, 30], 500, 500, k), true);
});
