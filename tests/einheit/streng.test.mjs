// Einheitstest Auftrag Z1 (Session 10): Blitz-Haeufigkeit in strengen Zeiten. Die Logik der Fenster selbst prueft vertrag-session10.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wirksameHaeufigkeit } from '../../src/blitz/zeitplan.ts';

// Mittwoch, 4. November 2026, 22:00 Ortszeit (getDay() = 3)
const ABENDS = new Date(2026, 10, 4, 22, 0, 0);
const MORGENS = new Date(2026, 10, 4, 9, 0, 0);
const FENSTER = [{ tage: [3], von: 21 * 60, bis: 23 * 60 }];
const PACK = { freischaltungen: ['kontrolle:blitz', 'kontrolle:zeitplan'] };
const OHNE_ZEITPLAN = { freischaltungen: ['kontrolle:blitz'] };
const e = (blitz, zeiten = FENSTER) => ({ kontrolle: { blitz, zeiten } });

test('in einer strengen Zeit wird selten oft, oft bleibt oft, aus bleibt aus', () => {
  assert.equal(wirksameHaeufigkeit(e('selten'), PACK, ABENDS), 'oft');
  assert.equal(wirksameHaeufigkeit(e('oft'), PACK, ABENDS), 'oft');
  assert.equal(wirksameHaeufigkeit(e('aus'), PACK, ABENDS), null);
});

test('ausserhalb des Fensters, ohne Freischaltung, ohne Pack oder ohne Fenster aendert sich nichts', () => {
  assert.equal(wirksameHaeufigkeit(e('selten'), PACK, MORGENS), 'selten');
  assert.equal(wirksameHaeufigkeit(e('selten'), OHNE_ZEITPLAN, ABENDS), 'selten');
  assert.equal(wirksameHaeufigkeit(e('selten'), null, ABENDS), 'selten');
  assert.equal(wirksameHaeufigkeit(e('selten', []), PACK, ABENDS), 'selten');
  assert.equal(wirksameHaeufigkeit({ kontrolle: { blitz: 'selten' } }, PACK, ABENDS), 'selten');
  assert.equal(wirksameHaeufigkeit(e('selten')), 'selten'); // alte Aufrufform ohne Pack
  assert.equal(wirksameHaeufigkeit(null, PACK, ABENDS), null);
});

test('Fenster ueber Mitternacht und Rand: bis ist ausgeschlossen', () => {
  const nacht = [{ tage: [3], von: 22 * 60, bis: 2 * 60 }];
  assert.equal(wirksameHaeufigkeit(e('selten', nacht), PACK, new Date(2026, 10, 5, 1, 30)), 'oft'); // Donnerstag 01:30, Fenster von Mittwoch
  assert.equal(wirksameHaeufigkeit(e('selten', nacht), PACK, new Date(2026, 10, 5, 2, 0)), 'selten');
  assert.equal(wirksameHaeufigkeit(e('selten'), PACK, new Date(2026, 10, 4, 23, 0)), 'selten');
  assert.equal(wirksameHaeufigkeit(e('selten'), PACK, new Date(2026, 10, 4, 21, 0)), 'oft');
});
