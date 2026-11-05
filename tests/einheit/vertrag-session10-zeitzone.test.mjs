// Strenge Zeiten bei Zeitumstellung (Pruefer-Fund 1 und 12 zum Vertrag Session 10). Eigene Datei, weil die Zeitzone fuer den ganzen Prozess
// gilt: Europe/Berlin, Umstellung am 25.10.2026 (3:00 Sommerzeit wird 2:00 Winterzeit) und am 29.03.2026 (2:00 wird 3:00).
process.env.TZ = 'Europe/Berlin';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { istStrengeZeit, naechsterWechselMs } from '../../src/kontrolle/streng.ts';

const MIN = 60_000;
// Sonntag 25.10.2026: 2:15 Sommerzeit (UTC 00:15) und 2:15 Winterzeit (UTC 01:15).
const sommer0215 = new Date(Date.UTC(2026, 9, 25, 0, 15));
const winter0215 = new Date(Date.UTC(2026, 9, 25, 1, 15));
const fenster = [{ tage: [0], von: 2 * 60 + 30, bis: 5 * 60 }]; // Sonntag 2:30 bis 5:00

test('Zeitzone ist gesetzt', () => {
  assert.equal(sommer0215.getHours(), 2);
  assert.equal(winter0215.getHours(), 2);
});

test('Zurueckstellen: kein 0-ms-Wechsel, kein verpasster Wechsel', () => {
  // 2:15 Winterzeit: Fenster beginnt um 2:30 Winterzeit, also in 15 Minuten.
  assert.equal(istStrengeZeit(fenster, winter0215), false);
  assert.equal(naechsterWechselMs(fenster, winter0215), 15 * MIN);
  // 2:45 Sommerzeit liegt im Fenster; um 3:00 Sommerzeit wird es 2:00 Winterzeit (ausserhalb): Wechsel in 15 Minuten.
  const sommer0245 = new Date(Date.UTC(2026, 9, 25, 0, 45));
  assert.equal(istStrengeZeit(fenster, sommer0245), true);
  assert.equal(naechsterWechselMs(fenster, sommer0245), 15 * MIN);
  for (let m = 0; m < 6 * 60; m += 7) {
    const d = new Date(Date.UTC(2026, 9, 24, 22, 0) + m * MIN);
    const w = naechsterWechselMs(fenster, d);
    assert.ok(w === null || w > 0, `kein 0-ms-Wechsel um ${d.toISOString()}`);
  }
});

test('Vorstellen: Fenster 2:00 bis 2:30 an einem Tag ohne 2:xx', () => {
  const kurz = [{ tage: [0], von: 120, bis: 150 }];
  const vorher = new Date(Date.UTC(2026, 2, 29, 0, 50)); // 1:50 Winterzeit
  const w = naechsterWechselMs(kurz, vorher);
  assert.ok(w === null || w > 0);
});

test('Ueber Mitternacht und Wochenende, ganzer Tag (Pruefer-Fund 12)', () => {
  const samstagNacht = [{ tage: [6], von: 23 * 60, bis: 60 }]; // Samstag 23 Uhr bis Sonntag 1 Uhr
  const sa2230 = new Date(2026, 10, 7, 22, 30);
  assert.equal(naechsterWechselMs(samstagNacht, sa2230), 30 * MIN);
  const so0030 = new Date(2026, 10, 8, 0, 30);
  assert.equal(istStrengeZeit(samstagNacht, so0030), true);
  assert.equal(naechsterWechselMs(samstagNacht, so0030), 30 * MIN);
  const sonntag = [{ tage: [0], von: 0, bis: 0 }];
  assert.equal(naechsterWechselMs(sonntag, new Date(2026, 10, 7, 23, 0)), 60 * MIN);
  assert.equal(naechsterWechselMs(sonntag, new Date(2026, 10, 8, 12, 0)), 12 * 60 * MIN);
});
