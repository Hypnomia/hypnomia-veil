// Einheitstests Auftrag V: Versionsvergleich, Pruefung von version.json, Faelligkeit, gespeicherter Stand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { STAND_LEER, istFaellig, istNeuer, pruefeVersionDatei, vervollstaendigeStand } from '../../src/version/logik.ts';
import { VERSION_ABSTAND_MS } from '../../src/version/vertrag.ts';

test('Vergleich: neuer, gleich, aelter, Zusatz nach dem Strich', () => {
  assert.equal(istNeuer('9.9.9', '0.6.0'), true);
  assert.equal(istNeuer('0.6.1', '0.6.0'), true);
  assert.equal(istNeuer('0.10.0', '0.9.9'), true, 'zehn ist mehr als neun, kein Textvergleich');
  assert.equal(istNeuer('0.6.0', '0.6.0'), false);
  assert.equal(istNeuer('0.5.9', '0.6.0'), false);
  assert.equal(istNeuer('0.6.0-beta', '0.6.0'), false);
  assert.equal(istNeuer('0.7.0-beta', '0.6.0'), false, 'Vorabversion wird nie als Update gemeldet');
  assert.equal(istNeuer('9.9.9-rc.1', '0.6.0'), false);
  assert.equal(istNeuer(null, '0.6.0'), false);
});

test('version.json: gueltig, kaputt, falscher Typ', () => {
  assert.deepEqual(pruefeVersionDatei({ version: '1.2.3', datum: '2026-11-05' }), { version: '1.2.3', datum: '2026-11-05' });
  assert.deepEqual(pruefeVersionDatei({ version: '1.2.3' }), { version: '1.2.3' });
  assert.deepEqual(pruefeVersionDatei({ version: '1.2.3', datum: 'gestern' }), { version: '1.2.3' }, 'schlechtes Datum faellt weg, Version bleibt');
  for (const schlecht of [null, undefined, 5, 'x', [], {}, { version: 3 }, { version: '1.2' }, { version: 'neu' }, { version: '1.2.3.4' }, { version: '<b>1.2.3</b>' }, { version: '1.2.3\n' }]) {
    assert.equal(pruefeVersionDatei(schlecht), null, JSON.stringify(schlecht));
  }
});

test('Faelligkeit: nie geprueft, 24 Stunden, Uhr zurueck, auch nach Fehler 24 Stunden', () => {
  const t = 1_800_000_000_000;
  assert.equal(istFaellig(STAND_LEER, t), true);
  assert.equal(istFaellig({ geprueft: t - 1000, neueste: '0.6.0', fehler: false }, t), false);
  assert.equal(istFaellig({ geprueft: t - VERSION_ABSTAND_MS + 1, neueste: null, fehler: false }, t), false);
  assert.equal(istFaellig({ geprueft: t - VERSION_ABSTAND_MS, neueste: null, fehler: false }, t), true);
  assert.equal(istFaellig({ geprueft: t + 5000, neueste: null, fehler: false }, t), true, 'Zeit in der Zukunft gilt als faellig');
  assert.equal(istFaellig({ geprueft: t - 60 * 60 * 1000, neueste: null, fehler: true }, t), false, 'auch nach Fehler 24 Stunden warten');
  assert.equal(istFaellig({ geprueft: t - VERSION_ABSTAND_MS, neueste: null, fehler: true }, t), true);
});

test('Gespeicherter Stand: Unsinn wird verworfen', () => {
  assert.deepEqual(vervollstaendigeStand(undefined), STAND_LEER);
  assert.deepEqual(vervollstaendigeStand('x'), STAND_LEER);
  assert.deepEqual(vervollstaendigeStand({ geprueft: 'heute', neueste: 7, fehler: 'ja' }), STAND_LEER);
  assert.deepEqual(vervollstaendigeStand({ geprueft: 5, neueste: '1.0.0', fehler: true }), { geprueft: 5, neueste: '1.0.0', fehler: true });
  assert.notEqual(vervollstaendigeStand(undefined), STAND_LEER, 'liefert eine Kopie');
});

test('version.json im Repo passt zu package.json und zum Vertrag', () => {
  const paket = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const datei = JSON.parse(readFileSync(new URL('../../version.json', import.meta.url), 'utf8'));
  assert.deepEqual(pruefeVersionDatei(datei), datei);
  assert.equal(datei.version, paket.version);
});
