// Einheitstest (Session 12, Auftrag P): vergleichePacks, alle fuenf Faelle, Vorabversionen, und die Hinweis-Saetze.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ersetztVorhandenes, vergleichePacks } from '../../src/pack/ersetzen.ts';
import { ersetzenHinweis } from '../../entrypoints/options/pack-texte.ts';

const alt = (version, id = 'mia') => ({ id, version, titel: 'Mia Pack' });
const neu = (version, id = 'mia') => ({ id, version, titel: 'Mia Pack' });

test('vergleichePacks: erstes, neuer, gleich, aelter, anderes', () => {
  assert.equal(vergleichePacks(null, neu('1.0.0')), 'erstes');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('1.1.0')), 'neuer');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('2.0.0')), 'neuer');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('1.0.1')), 'neuer');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('1.0.0')), 'gleich');
  assert.equal(vergleichePacks(alt('1.1.0'), neu('1.0.0')), 'aelter');
  assert.equal(vergleichePacks(alt('2.0.0'), neu('1.9.9')), 'aelter');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('9.9.9', 'anderes-pack')), 'anderes');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('1.0.0', 'anderes-pack')), 'anderes');
});

test('vergleichePacks: Zahlen zaehlen als Zahlen, nicht als Text', () => {
  assert.equal(vergleichePacks(alt('1.9.0'), neu('1.10.0')), 'neuer');
  assert.equal(vergleichePacks(alt('1.10.0'), neu('1.9.0')), 'aelter');
  assert.equal(vergleichePacks(alt('0.0.1'), neu('0.0.10')), 'neuer');
});

test('vergleichePacks: Vorabversionen folgen versionHoeher (Zusatz nach dem Bindestrich zaehlt nicht)', () => {
  assert.equal(vergleichePacks(alt('1.0.0-beta'), neu('1.0.0')), 'gleich');
  assert.equal(vergleichePacks(alt('1.0.0'), neu('1.0.0-beta')), 'gleich');
  assert.equal(vergleichePacks(alt('1.0.0-beta'), neu('1.0.1')), 'neuer');
  assert.equal(vergleichePacks(alt('1.0.1'), neu('1.0.0-beta')), 'aelter');
  assert.equal(vergleichePacks(alt('1.0.0-beta'), neu('1.0.0-rc1')), 'gleich');
});

test('ersetztVorhandenes: nur das erste Pack ersetzt nichts', () => {
  assert.equal(ersetztVorhandenes('erstes'), false);
  for (const f of ['neuer', 'gleich', 'aelter', 'anderes']) assert.equal(ersetztVorhandenes(f), true, f);
});

test('ersetzenHinweis: erstes gibt null, die anderen nennen Versionen und Titel', () => {
  const a = { titel: 'Mia Pack', version: '1.0.0' };
  const n = { titel: 'Neues Pack', version: '1.1.0' };
  assert.equal(ersetzenHinweis('erstes', null, n), null);
  const neuer = ersetzenHinweis('neuer', a, n);
  assert.ok(neuer.includes('1.0.0') && neuer.includes('1.1.0') && neuer.includes('settings stay'), neuer);
  const aelter = ersetzenHinweis('aelter', { ...a, version: '1.1.0' }, { ...n, version: '1.0.0' });
  assert.ok(aelter.includes('1.0.0') && aelter.includes('1.1.0') && aelter.startsWith('Careful'), aelter);
  const anderes = ersetzenHinweis('anderes', a, n);
  assert.ok(anderes.includes('Mia Pack') && anderes.includes('1.0.0'), anderes);
  const gleich = ersetzenHinweis('gleich', a, { ...n, version: '1.0.0' });
  assert.ok(gleich.includes('1.0.0') && gleich.includes('already in'), gleich);
  // Vorabversion: beide Versionstexte stehen da
  const beta = ersetzenHinweis('gleich', { ...a, version: '1.0.0-beta' }, { ...n, version: '1.0.0' });
  assert.ok(beta.includes('1.0.0-beta') && beta.includes('1.0.0'), beta);
});
