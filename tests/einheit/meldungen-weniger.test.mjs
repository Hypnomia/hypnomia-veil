// Einheitstests fuer "Fewer notes?" (Session 17, UX-Pruefung Phase 9 Fund 25): drei Mal wegklicken in Folge innerhalb eines Tages, einmal je Woche.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEERER_STAND, TAG_MS, WOCHE_MS, beiAblauf, beiSchliessen, fragtJetzt, nachFrage, vervollstaendigeWeniger } from '../../src/meldungen/weniger.ts';

const T0 = 1_000_000_000_000;

test('drei Schliessen in Folge innerhalb eines Tages merken die Frage vor', () => {
  let s = beiSchliessen(LEERER_STAND, T0);
  assert.equal(s.folge, 1);
  assert.equal(s.fragt, false);
  s = beiSchliessen(s, T0 + 1000);
  assert.equal(s.fragt, false);
  s = beiSchliessen(s, T0 + 2000);
  assert.equal(s.folge, 3);
  assert.equal(s.fragt, true);
  assert.equal(fragtJetzt(s, T0 + 3000), true);
});

test('eine von selbst verschwundene Meldung unterbricht die Folge; ein Tag Abstand startet neu', () => {
  let s = beiSchliessen(beiSchliessen(LEERER_STAND, T0), T0 + 10);
  s = beiAblauf(s);
  assert.equal(s.folge, 0);
  s = beiSchliessen(beiSchliessen(s, T0 + 20), T0 + 30);
  assert.equal(s.fragt, false);
  // zu langsam: das erste Schliessen liegt mehr als einen Tag zurueck
  let t = beiSchliessen(beiSchliessen(LEERER_STAND, T0), T0 + 10);
  t = beiSchliessen(t, T0 + TAG_MS + 5);
  assert.equal(t.folge, 1);
  assert.equal(t.fragt, false);
});

test('hoechstens einmal pro Woche; eine vorgemerkte Frage uebersteht den Ablauf', () => {
  let s = { ...LEERER_STAND, folge: 2, seit: T0, fragt: false, gefragt: T0 - 1000 };
  s = beiSchliessen(s, T0 + 5);
  assert.equal(s.fragt, false, 'vor Ablauf der Woche keine Frage');
  const spaeter = T0 + WOCHE_MS + 10;
  let t = { ...LEERER_STAND, folge: 2, seit: spaeter - 100, fragt: false, gefragt: T0 };
  t = beiSchliessen(t, spaeter);
  assert.equal(t.fragt, true);
  assert.equal(beiAblauf(t).fragt, true);
  const danach = nachFrage(t, spaeter + 1);
  assert.deepEqual(danach, { folge: 0, seit: 0, fragt: false, gefragt: spaeter + 1 });
  assert.equal(fragtJetzt({ ...t, gefragt: spaeter }, spaeter + 5), false);
});

test('kaputte gespeicherte Werte werden zum Leerstand', () => {
  assert.deepEqual(vervollstaendigeWeniger(null), LEERER_STAND);
  assert.deepEqual(vervollstaendigeWeniger({ folge: 'x', seit: -4, fragt: 'ja', gefragt: NaN }), LEERER_STAND);
  assert.deepEqual(vervollstaendigeWeniger({ folge: 2.7, seit: 5, fragt: true, gefragt: 9 }), { folge: 2, seit: 5, fragt: true, gefragt: 9 });
});
