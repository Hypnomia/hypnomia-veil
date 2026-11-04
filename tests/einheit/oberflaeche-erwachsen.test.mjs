// Einheitstests Auftrag O: reine Funktionen fuer Popup und Einstellungsseite (src/oberflaeche/erwachsen.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatiereRest, hatErwachsenFunktionen, posePopup, waehleSatz } from '../../src/oberflaeche/erwachsen.ts';

test('formatiereRest: Stunden und Minuten, darunter Minuten und Sekunden', () => {
  assert.equal(formatiereRest(11 * 3600_000 + 42 * 60_000), '11 h 42 min');
  assert.equal(formatiereRest(42 * 60_000 + 10_000), '42 min 10 s');
  assert.equal(formatiereRest(-5), '0 min 00 s');
});

test('waehleSatz: Pack-Gruppe oder eingebauter Text', () => {
  assert.equal(waehleSatz(undefined, 'eingebaut', 0.5), 'eingebaut');
  assert.equal(waehleSatz(['', ' '], 'eingebaut', 0.5), 'eingebaut');
  assert.equal(waehleSatz(['a', 'b'], 'x', 0.99), 'b');
  assert.equal(waehleSatz(['a', 'b'], 'x', 0), 'a');
});

test('hatErwachsenFunktionen und posePopup', () => {
  assert.equal(hatErwachsenFunktionen(null), false);
  assert.equal(hatErwachsenFunktionen({ freischaltungen: ['stil:mia-patch'] }), false);
  assert.equal(hatErwachsenFunktionen({ freischaltungen: ['quiz:freilegen'] }), true);
  assert.equal(posePopup(true, 4), 'schmollen');
  assert.equal(posePopup(false, 4), 'thron');
  assert.equal(posePopup(false, 0), 'sprechblase');
});
