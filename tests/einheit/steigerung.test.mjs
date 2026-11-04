// Einheitstests Steigerung der Zensur (Auftrag S, PHASE-4-BAUPLAN Abschnitt 9) mit gestellter Uhr und gestelltem Zufall.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABBAU_MS,
  ANSTIEG_MAX_MINUTEN,
  ANSTIEG_MIN_MINUTEN,
  MAX_STUFE,
  STAND_START,
  minuteZaehlt,
  naechsteSchwelle,
  setzePause,
  verbucheMinute,
  verschiebeZeit,
  wirksameStufe,
} from '../../src/steigerung.ts';

const MINUTE = 60_000;
const T0 = 1_800_000_000_000; // feste Uhrzeit, glatte Minute

// Verbucht `n` Minuten nacheinander ab `ab` (je eine Uhr-Minute weiter).
function minuten(stand, n, ab, zufall = () => 0.5) {
  let s = stand;
  for (let i = 0; i < n; i++) s = verbucheMinute(s, ab + i * MINUTE, zufall);
  return s;
}

test('Schwelle: Zufall bleibt in 10 bis 20 Minuten, beide Enden erreichbar', () => {
  assert.equal(naechsteSchwelle(() => 0), ANSTIEG_MIN_MINUTEN);
  assert.equal(naechsteSchwelle(() => 0.9999999), ANSTIEG_MAX_MINUTEN);
  assert.equal(naechsteSchwelle(() => 5), ANSTIEG_MAX_MINUTEN);
  assert.equal(naechsteSchwelle(() => -1), ANSTIEG_MIN_MINUTEN);
  for (let i = 0; i < 500; i++) {
    const w = naechsteSchwelle(Math.random);
    assert.ok(w >= ANSTIEG_MIN_MINUTEN && w <= ANSTIEG_MAX_MINUTEN && Number.isInteger(w));
  }
});

test('Minute zaehlt bei Erwachsenenseite oder ab 3 neuen Urteilen zensiert', () => {
  assert.equal(minuteZaehlt(true, 0), true);
  assert.equal(minuteZaehlt(false, 2), false);
  assert.equal(minuteZaehlt(false, 3), true);
});

test('Anstieg: erste Stufe nach 15 Minuten, dann zufaellige Schwelle', () => {
  let s = minuten(STAND_START, 14, T0);
  assert.equal(s.stufe, 0);
  assert.equal(s.minutenSeitAnstieg, 14);
  s = verbucheMinute(s, T0 + 14 * MINUTE, () => 0); // 15. Minute, neue Schwelle 10
  assert.equal(s.stufe, 1);
  assert.equal(s.minutenSeitAnstieg, 0);
  assert.equal(s.naechsterAnstiegNach, 10);
  s = minuten(s, 10, T0 + 15 * MINUTE);
  assert.equal(s.stufe, 2);
});

test('Hoechstens Stufe 4', () => {
  const s = minuten(STAND_START, 200, T0, () => 0);
  assert.equal(s.stufe, MAX_STUFE);
  assert.equal(wirksameStufe(s, T0 + 200 * MINUTE), MAX_STUFE);
});

test('Dieselbe Uhr-Minute zaehlt nur einmal (mehrere Fenster)', () => {
  const a = verbucheMinute(STAND_START, T0, () => 0.5);
  const b = verbucheMinute(a, T0 + 30_000, () => 0.5);
  assert.equal(b, a);
  assert.equal(b.minutenSeitAnstieg, 1);
});

test('Abbau: eine Stufe je 12 Stunden ohne gezaehlte Minute, jede Minute startet die 12 Stunden neu', () => {
  let s = minuten(STAND_START, 40, T0, () => 0); // 15 + 10 + 10: Stufe 3
  assert.equal(s.stufe, 3);
  const ende = T0 + 39 * MINUTE;
  assert.equal(wirksameStufe(s, ende + ABBAU_MS - 1), 3);
  assert.equal(wirksameStufe(s, ende + ABBAU_MS), 2);
  assert.equal(wirksameStufe(s, ende + 3 * ABBAU_MS), 0);
  // Nach 11 Stunden eine Minute: Uhr startet neu, nach weiteren 11 Stunden immer noch Stufe 3.
  s = verbucheMinute(s, ende + 11 * 3_600_000, () => 0.5);
  assert.equal(wirksameStufe(s, ende + 22 * 3_600_000), 3);
});

test('Rueckkehr nach dem Abbau: Stufe tiefer, angefangene Minuten verfallen', () => {
  let s = minuten(STAND_START, 20, T0, () => 0); // Stufe 1, 5 Minuten Richtung Stufe 2
  assert.equal(s.stufe, 1);
  assert.equal(s.minutenSeitAnstieg, 5);
  s = verbucheMinute(s, T0 + 20 * MINUTE + ABBAU_MS, () => 0.5);
  assert.equal(s.stufe, 0);
  assert.equal(s.minutenSeitAnstieg, 1);
});

test('Pause zaehlt nicht als Abbau und zaehlt keine Minuten', () => {
  let s = minuten(STAND_START, 15, T0, () => 0); // Stufe 1
  const ende = T0 + 14 * MINUTE;
  s = setzePause(s, true, ende + 1000);
  assert.equal(verbucheMinute(s, ende + 2 * MINUTE, () => 0), s);
  // 30 Stunden Pause: Stufe bleibt
  assert.equal(wirksameStufe(s, ende + 30 * 3_600_000), 1);
  s = setzePause(s, false, ende + 1000 + 30 * 3_600_000);
  assert.equal(s.pauseSeit, null);
  // nach der Pause laufen die vor der Pause verstrichenen 1000 ms plus neue Zeit
  assert.equal(wirksameStufe(s, ende + 30 * 3_600_000 + ABBAU_MS - 2000), 1);
  assert.equal(wirksameStufe(s, ende + 30 * 3_600_000 + 1000 + ABBAU_MS), 0);
  // doppeltes An oder Aus aendert nichts
  assert.equal(setzePause(s, false, T0), s);
});

test('Uhr vorstellen (Testhaken) wirkt wie verstrichene Zeit', () => {
  const s = minuten(STAND_START, 15, T0, () => 0);
  const jetzt = T0 + 15 * MINUTE;
  const v = verschiebeZeit(s, ABBAU_MS);
  assert.equal(wirksameStufe(v, jetzt), 0);
  assert.equal(verschiebeZeit(STAND_START, ABBAU_MS).abbauAb, 0);
});

// ---------- Nachtrag nach Pruefer-Runde 1 ----------
import { klemmeAufJetzt, vervollstaendigeStand, wirksameZonen } from '../../src/steigerung.ts';
import { STANDARD } from '../../src/einstellungen.ts';

test('Stufe 4: jede gezaehlte Minute startet den Abbau neu, Minuten bleiben stehen', () => {
  let s = minuten(STAND_START, 60, T0, () => 0); // 15 + 3 * 10 = 45 Minuten bis Stufe 4
  assert.equal(s.stufe, 4);
  const spaeter = T0 + 60 * MINUTE + 11 * 3_600_000;
  s = verbucheMinute(s, spaeter, () => 0);
  assert.equal(s.abbauAb, spaeter);
  assert.equal(wirksameStufe(s, spaeter + ABBAU_MS - 1), 4);
});

test('Abbau um mehrere Stufen auf einmal', () => {
  const s = { ...STAND_START, stufe: 4, abbauAb: T0 };
  assert.equal(wirksameStufe(s, T0 + 2 * ABBAU_MS + 5), 2);
  const zurueck = verbucheMinute(s, T0 + 3 * ABBAU_MS, () => 0.5);
  assert.equal(zurueck.stufe, 1);
  assert.equal(zurueck.minutenSeitAnstieg, 1);
});

test('Uhr zurueckgestellt: Zeitpunkte aus der Zukunft werden geklemmt, keine Doppelzaehlung', () => {
  const zukunft = { ...STAND_START, stufe: 2, abbauAb: T0 + 5 * 3_600_000, letzteMinute: Math.floor((T0 + 5 * 3_600_000) / MINUTE) };
  const k = klemmeAufJetzt(zukunft, T0);
  assert.equal(k.abbauAb, T0);
  assert.equal(k.letzteMinute, Math.floor(T0 / MINUTE));
  assert.equal(verbucheMinute(zukunft, T0, () => 0.5).minutenSeitAnstieg, zukunft.minutenSeitAnstieg); // diese Minute gilt als gezaehlt
  assert.equal(klemmeAufJetzt(STAND_START, T0), STAND_START); // nichts zu klemmen: dasselbe Objekt
  assert.equal(klemmeAufJetzt({ ...STAND_START, pauseSeit: T0 + 99_999 }, T0).pauseSeit, T0);
});

test('Stand aus Muell, Uhr vorstellen mit Pause', () => {
  assert.deepEqual(vervollstaendigeStand('kaputt'), STAND_START);
  assert.deepEqual(vervollstaendigeStand({ stufe: -3, naechsterAnstiegNach: 99, pauseSeit: 'x', abbauAb: NaN }), { ...STAND_START, naechsterAnstiegNach: 20, pauseSeit: null });
  const p = verschiebeZeit({ ...STAND_START, stufe: 1, abbauAb: T0, pauseSeit: T0 + 10 }, 1000);
  assert.equal(p.pauseSeit, T0 + 10 - 1000);
  assert.equal(p.abbauAb, T0 - 1000);
});

test('Stufe 3 setzt auch die bedeckten Varianten von Bauch, Fuessen, Achseln', () => {
  const z = wirksameZonen({ zonen: structuredClone(STANDARD.zonen) }, 3).zonen;
  for (const k of ['belly', 'feet', 'armpits']) assert.deepEqual(z[k], { an: true, bedeckt: true }, k);
});
