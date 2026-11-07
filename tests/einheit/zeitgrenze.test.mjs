// Einheitstests Zeitgrenze (Phase 8b, Reste): Blitzwort wartet hoechstens kurz auf die Schrift, dann Rueckfall Systemschrift.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mitZeitgrenze } from '../../src/oberflaeche/design/zeitgrenze.ts';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

test('schnelles Versprechen: sein Wert gilt, ohne die Grenze abzuwarten', async () => {
  const t0 = performance.now();
  assert.equal(await mitZeitgrenze(warte(10).then(() => true), 300, false), true);
  assert.ok(performance.now() - t0 < 200);
});

test('langsames Versprechen: nach der Grenze gilt der Rueckfall', async () => {
  const t0 = performance.now();
  assert.equal(await mitZeitgrenze(warte(400).then(() => true), 50, false), false);
  const dt = performance.now() - t0;
  assert.ok(dt >= 40 && dt < 300, `dt ${dt}`);
});

test('abgelehntes Versprechen: Rueckfall, kein Fehler', async () => {
  assert.equal(await mitZeitgrenze(Promise.reject(new Error('x')), 300, false), false);
});

test('Quelltext: Blitz wartet vor dem ersten Wort auf die Schrift mit 300 ms und beruehrt die Grenzen nicht', async () => {
  const { readFileSync } = await import('node:fs');
  const q = readFileSync(new URL('../../src/blitz/blitz.ts', import.meta.url), 'utf8');
  assert.match(q, /const SCHRIFT_GRENZE_MS = 300;/);
  assert.match(q, /await mitZeitgrenze\(ladeSeitenSchriften\(\), SCHRIFT_GRENZE_MS, false\);/);
  const idx = q.indexOf('await mitZeitgrenze(');
  assert.ok(idx > q.indexOf('async function pruefeAlles') && idx < q.indexOf('async function pruefeAlles') + 1500);
});
