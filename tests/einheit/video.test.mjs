// Einheitstests ohne Browser: reine Logik der laufenden Video-Nachpruefung (src/schleier/video.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Budget, entscheideHysterese, fruehestensWechsel } from '../../src/schleier/video.ts';

const NACH = 3;
const folge = (start, ergebnisse) => {
  let stand = start;
  const verlauf = [];
  for (const e of ergebnisse) {
    stand = entscheideHysterese(stand, e, NACH);
    verlauf.push(stand.soll);
  }
  return verlauf;
};

test('Hysterese: Treffer bei frei verdeckt sofort', () => {
  assert.deepEqual(folge({ soll: 'frei', sauber: 0 }, ['treffer']), ['verdeckt']);
});

test('Hysterese: erst die dritte saubere Pruefung in Folge gibt frei', () => {
  assert.deepEqual(folge({ soll: 'verdeckt', sauber: 0 }, ['sauber', 'sauber', 'sauber']), ['verdeckt', 'verdeckt', 'frei']);
});

test('Hysterese: ein Treffer setzt den Zaehler zurueck', () => {
  assert.deepEqual(folge({ soll: 'verdeckt', sauber: 0 }, ['sauber', 'sauber', 'treffer', 'sauber', 'sauber', 'sauber']), [
    'verdeckt',
    'verdeckt',
    'verdeckt',
    'verdeckt',
    'verdeckt',
    'frei',
  ]);
});

test('Hysterese: Fehler verdeckt ein freies Video und bringt bei verdeckt keinen Fortschritt', () => {
  assert.deepEqual(folge({ soll: 'frei', sauber: 0 }, ['fehler']), ['verdeckt']);
  assert.deepEqual(folge({ soll: 'verdeckt', sauber: 0 }, ['sauber', 'sauber', 'fehler', 'sauber', 'sauber']), ['verdeckt', 'verdeckt', 'verdeckt', 'verdeckt', 'verdeckt']);
});

test('Hysterese: freies Video bleibt bei sauberen Pruefungen frei', () => {
  assert.deepEqual(folge({ soll: 'frei', sauber: 0 }, ['sauber', 'sauber', 'sauber', 'sauber']), ['frei', 'frei', 'frei', 'frei']);
});

test('Budget: hoechstens vier Starts je Sekunde, danach Wartezeit bis zum aeltesten Start plus eine Sekunde', () => {
  const b = new Budget(4, 1000);
  for (const t of [0, 100, 200, 300]) {
    assert.equal(b.wartezeit(t), 0);
    b.nimm(t);
  }
  assert.equal(b.wartezeit(400), 600);
  assert.equal(b.wartezeit(999), 1);
  assert.equal(b.wartezeit(1000), 0);
  b.nimm(1000);
  assert.equal(b.wartezeit(1050), 50); // der Start bei 100 ist der naechste, der aus dem Fenster faellt
});

test('Budget: in keinem Fenster von einer Sekunde mehr als vier Starts, wenn man der Wartezeit folgt', () => {
  const b = new Budget(4, 1000);
  let t = 0;
  const starts = [];
  for (let i = 0; i < 60; i++) {
    t += b.wartezeit(t);
    b.nimm(t);
    starts.push(t);
    t += 37;
  }
  for (let i = 0; i + 4 < starts.length; i++) assert.ok(starts[i + 4] - starts[i] >= 1000, `Start ${i}: ${starts[i + 4] - starts[i]} ms`);
});

test('Wechsel-Zeitpunkt: Verdecken immer sofort, Freigeben 1000 ms nach dem letzten Wechsel des Videos und 334 ms nach der letzten Freigabe im Dokument', () => {
  const g = { wechselMinMs: 1000, blitzSperreMs: 334 };
  assert.equal(fruehestensWechsel('verdeckt', 5000, 5900, g), Number.NEGATIVE_INFINITY);
  assert.equal(fruehestensWechsel('verdeckt', 5900, 5900, g), Number.NEGATIVE_INFINITY);
  assert.equal(fruehestensWechsel('frei', 5000, 6100, g), 6434);
  assert.equal(fruehestensWechsel('frei', 5000, 5000, g), 6000);
  assert.equal(fruehestensWechsel('frei', 5000, Number.NEGATIVE_INFINITY, g), 6000);
  assert.equal(fruehestensWechsel('frei', Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, g), Number.NEGATIVE_INFINITY);
});
