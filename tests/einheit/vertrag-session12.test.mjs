// Einheitstests fuer den Vertragsschritt Session 12 (PHASE-6-AUFTRAEGE-SESSION-12.md): gemeinsame Bausteine der Oberflaeche.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEHLER_SPEICHERN, STIMMUNG_WOERTER, STUFE_TEXT, datumLang, stimmungsWort } from '../../src/oberflaeche/gemeinsam.ts';
import { SCHWELLE_MAX, SCHWELLE_MIN, STANDARD } from '../../src/einstellungen.ts';

test('Stimmung: jedes Hundertstel zwischen Min und Max ergibt ein Wort, Enden wie die Regler-Beschriftung', () => {
  const gesehen = new Set();
  let faelle = 0;
  for (let h = Math.round(SCHWELLE_MIN * 100); h <= Math.round(SCHWELLE_MAX * 100); h++) {
    const w = stimmungsWort(h / 100);
    assert.ok(STIMMUNG_WOERTER.includes(w));
    gesehen.add(w);
    faelle++;
  }
  assert.equal(gesehen.size, 4, `4 Woerter ueber ${faelle} Stellungen`);
  assert.equal(stimmungsWort(SCHWELLE_MIN), 'Very suspicious');
  assert.equal(stimmungsWort(SCHWELLE_MAX), 'Relaxed');
  assert.equal(stimmungsWort(0.13000000001), stimmungsWort(0.13));
  assert.equal(stimmungsWort(NaN), stimmungsWort(STANDARD.schwelle));
});

test('Datum amerikanisch mit Monatsnamen, Fehlersatz und Stufe', () => {
  const ms = new Date(2026, 10, 5, 14, 3).getTime();
  assert.equal(datumLang(ms), 'Nov 5, 2026');
  assert.match(datumLang(ms, true), /^Nov 5, 2026, 2:03\sPM$/);
  assert.equal(datumLang(NaN), '');
  assert.match(FEHLER_SPEICHERN, /’/);
  assert.equal(STUFE_TEXT(2), 'level 2 of 4');
});
