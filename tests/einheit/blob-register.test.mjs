// Einheitstests Blob-Register (Phase 8b, Reste): Blob-Adressen der Pack-Chibis werden beim Ersetzen und beim Verlassen der Seite freigegeben.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neuesBlobRegister } from '../../src/oberflaeche/blob-register.ts';

test('gibFrei widerruft eine offene Adresse genau einmal', () => {
  const weg = [];
  const r = neuesBlobRegister((a) => weg.push(a));
  r.merke('blob:a');
  r.merke('blob:b');
  assert.equal(r.gibFrei('blob:a'), true);
  assert.equal(r.gibFrei('blob:a'), false);
  assert.deepEqual(weg, ['blob:a']);
  assert.equal(r.offen(), 1);
});

test('pagehide: gibAlleFrei widerruft alle offenen und leert das Register', () => {
  const weg = [];
  const r = neuesBlobRegister((a) => weg.push(a));
  for (const a of ['blob:1', 'blob:2', 'blob:3']) r.merke(a);
  r.gibFrei('blob:2');
  r.gibAlleFrei();
  assert.deepEqual(weg.sort(), ['blob:1', 'blob:2', 'blob:3']);
  assert.equal(r.offen(), 0);
  r.gibAlleFrei();
  assert.equal(weg.length, 3);
});

test('unbekannte Adresse wird nicht widerrufen', () => {
  const weg = [];
  neuesBlobRegister((a) => weg.push(a)).gibFrei('blob:x');
  assert.deepEqual(weg, []);
});
