// Einheitstests fuer den Vertragsschritt Session 11 (PHASE-6-AUFTRAEGE-SESSION-11.md): Ton-Einstellung, Einstieg, Ereignis-Kanal,
// Nachrichten-Typen, Ledger- und Ton-Namen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STANDARD, TON_LAUTSTAERKE_STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { EINSTIEG_LEER, INTERVIEW_SEITEN, einstiegFertig, vervollstaendigeEinstieg } from '../../src/einstieg/vertrag.ts';
import { EREIGNIS_ARTEN, beiEreignis, melde } from '../../src/ereignisse.ts';
import { HINTERGRUND_TYPEN } from '../../src/nachrichten.ts';
import { LEDGER_ZAEHLER } from '../../src/ledger/vertrag.ts';
import { TON_NAMEN } from '../../src/ton/vertrag.ts';
import { VERSION_ABSTAND_MS, VERSION_URL } from '../../src/version/vertrag.ts';

test('Ton: Standard aus, Lautstaerke begrenzt', () => {
  assert.deepEqual(STANDARD.ton, { an: false, lautstaerke: TON_LAUTSTAERKE_STANDARD });
  assert.deepEqual(vervollstaendige({}).ton, STANDARD.ton);
  assert.equal(vervollstaendige({ ton: { an: true, lautstaerke: 3 } }).ton.lautstaerke, 1);
  assert.equal(vervollstaendige({ ton: { an: 'ja', lautstaerke: -1 } }).ton.an, false);
  assert.equal(vervollstaendige({ ton: { lautstaerke: -1 } }).ton.lautstaerke, 0);
});

test('Einstieg: leer, bereinigt, fertig nur mit Warnung, 18+ und Einwilligung', () => {
  assert.equal(INTERVIEW_SEITEN, 5);
  assert.deepEqual(vervollstaendigeEinstieg(undefined), EINSTIEG_LEER);
  assert.equal(einstiegFertig(vervollstaendigeEinstieg({ warnung: true, alter: true })), false);
  assert.equal(einstiegFertig(vervollstaendigeEinstieg({ warnung: true, alter: true, einwilligung: true })), true);
  assert.equal(einstiegFertig(vervollstaendigeEinstieg({ warnung: 1, alter: true, einwilligung: true })), false);
  assert.equal(vervollstaendigeEinstieg({ interview: 'egal' }).interview, 'offen');
  assert.equal(vervollstaendigeEinstieg({ interview: 'uebersprungen' }).interview, 'uebersprungen');
  assert.equal(einstiegFertig(null), false);
});

test('Ereignis-Kanal: alle Hoerer, kaputter Hoerer stoert nicht, Abmelden', () => {
  const gehoert = [];
  const ab1 = beiEreignis(() => {
    throw new Error('kaputt');
  });
  const ab2 = beiEreignis((e) => gehoert.push(e.art));
  for (const art of EREIGNIS_ARTEN) melde(art === 'blitz' ? { art, woerter: 3 } : { art });
  assert.deepEqual(gehoert, [...EREIGNIS_ARTEN]);
  ab2();
  melde({ art: 'zensiert' });
  assert.equal(gehoert.length, EREIGNIS_ARTEN.length);
  ab1();
});

test('Nachrichten, Ledger, Ton, Version: Vertrag vollstaendig', () => {
  for (const t of ['ledger', 'ledger-loeschen', 'version', 'version-test', 'einstieg-test', 'packton']) assert.ok(HINTERGRUND_TYPEN.includes(t), t);
  assert.equal(new Set(LEDGER_ZAEHLER).size, LEDGER_ZAEHLER.length);
  assert.deepEqual([...TON_NAMEN], ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger']);
  assert.ok(VERSION_URL.startsWith('https://raw.githubusercontent.com/Hypnomia/hypnomia-veil/'));
  assert.equal(VERSION_ABSTAND_MS, 86_400_000);
});
