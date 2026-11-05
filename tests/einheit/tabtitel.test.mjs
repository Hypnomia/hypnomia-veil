// Einheitstest Auftrag K1 (Tab-Titel, Phase 5 Session 10): Wahl des Satzes ohne Wiederholung, Grenze fuer Titel-Aenderungen der Seite,
// Abstand zwischen zwei Setzungen. Laedt nur src/tabtitel/logik.ts (keine Laufzeit-Importe).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AENDERUNGS_FENSTER_MS,
  AenderungsBremse,
  MAX_AENDERUNGEN,
  MIN_ABSTAND_SETZEN_MS,
  waehleSatz,
  wartezeitBisSetzen,
} from '../../src/tabtitel/logik.ts';

test('Grenzen sind wie im Auftrag: 10 Aenderungen je Minute, eine Setzung je Sekunde', () => {
  assert.equal(MAX_AENDERUNGEN, 10);
  assert.equal(AENDERUNGS_FENSTER_MS, 60_000);
  assert.equal(MIN_ABSTAND_SETZEN_MS, 1000);
});

test('waehleSatz: ohne Saetze null, mit einem Satz immer dieser', () => {
  assert.equal(waehleSatz([], null, 0.5), null);
  assert.equal(waehleSatz(['a'], null, 0.5), 'a');
  assert.equal(waehleSatz(['a'], 'a', 0.5), 'a');
});

test('waehleSatz: nie derselbe Satz zweimal hintereinander (alle Zufallswerte, mehrere Saetze)', () => {
  const saetze = ['a', 'b', 'c'];
  for (const letzter of [null, ...saetze]) {
    for (let i = 0; i <= 100; i++) {
      const z = i / 100 === 1 ? 0.999999 : i / 100;
      const s = waehleSatz(saetze, letzter, z);
      assert.ok(saetze.includes(s));
      if (letzter !== null) assert.notEqual(s, letzter, `letzter ${letzter}, zufall ${z}`);
    }
  }
});

test('waehleSatz: jeder andere Satz kann vorkommen; kaputte Zufallswerte bleiben im Bereich', () => {
  const saetze = ['a', 'b', 'c'];
  const gesehen = new Set([0, 0.4, 0.7, 0.99].map((z) => waehleSatz(saetze, 'a', z)));
  assert.deepEqual([...gesehen].sort(), ['b', 'c']);
  for (const z of [NaN, -1, 5, Infinity]) assert.ok(saetze.includes(waehleSatz(saetze, null, z)));
});

test('waehleSatz: viele Besuche hintereinander ergeben nie eine Wiederholung', () => {
  const saetze = ['eins', 'zwei'];
  let letzter = null;
  let zaehler = 0;
  for (let i = 0; i < 200; i++) {
    const s = waehleSatz(saetze, letzter, Math.random());
    if (s === letzter) zaehler++;
    letzter = s;
  }
  console.log(`einheit tabtitel: 200 Wahlen, ${zaehler} Wiederholungen`);
  assert.equal(zaehler, 0);
});

test('AenderungsBremse: die 11. Aenderung innerhalb einer Minute gibt auf, die 10. noch nicht', () => {
  const b = new AenderungsBremse();
  for (let i = 0; i < 10; i++) assert.equal(b.melde(i * 1000), false, `Aenderung ${i + 1}`);
  assert.equal(b.melde(10_000), true);
});

test('AenderungsBremse: gleitendes Fenster, alte Aenderungen zaehlen nicht mehr', () => {
  const b = new AenderungsBremse();
  for (let i = 0; i < 10; i++) b.melde(i * 100);
  // erst 61 s nach der ersten ist wieder Platz
  assert.equal(b.melde(60_500), false);
  const c = new AenderungsBremse();
  for (let i = 0; i < 10; i++) c.melde(i * 5000); // 0 bis 45 s
  assert.equal(c.melde(59_999), true); // 11 in einer Minute
  const d = new AenderungsBremse();
  for (let i = 0; i < 10; i++) d.melde(i * 5000);
  assert.equal(d.melde(60_000), false); // die erste (0) ist genau eine Minute her, zaehlt nicht mehr
});

test('AenderungsBremse: zuruecksetzen beginnt einen neuen Besuch', () => {
  const b = new AenderungsBremse();
  for (let i = 0; i < 11; i++) b.melde(i);
  b.zuruecksetzen();
  for (let i = 0; i < 10; i++) assert.equal(b.melde(100 + i), false);
});

test('wartezeitBisSetzen: sofort ohne vorige Setzung, sonst bis zur vollen Sekunde', () => {
  assert.equal(wartezeitBisSetzen(5000, null), 0);
  assert.equal(wartezeitBisSetzen(5000, 4700), 700);
  assert.equal(wartezeitBisSetzen(5000, 4000), 0);
  assert.equal(wartezeitBisSetzen(5000, 1000), 0);
  assert.equal(wartezeitBisSetzen(5000, 5000), 1000);
});
