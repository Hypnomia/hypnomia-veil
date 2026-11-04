// Einheitstest Auftrag L (Leerlauf-Spirale): gedeckelte Drehzahl, Einblenden, Aufloesung, Bedingungen und Zustandslogik (src/spirale/logik.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPERRE_MS, STREIFEN_MAX_HZ, RUHIG_FAKTOR, deckleDrehzahl } from '../../src/kontrolle/grenzen.ts';
import {
  EINBLEND_MIN_MS,
  EINBLEND_MS,
  LEINWAND_MAX_SEITE,
  LeerlaufZustand,
  SPIRALE_ARME,
  WUNSCH_UMDREHUNGEN,
  absageGrund,
  deckkraftNach,
  drehungFuer,
  leinwandMasse,
  mausBewegt,
  waehleSatz,
} from '../../src/spirale/logik.ts';

test('Drehzahl: Streifen hoechstens 2,5 Hz, Ruhig 30 Prozent, ueber deckleDrehzahl', () => {
  const normal = drehungFuer(false);
  assert.equal(normal.umdrehungenJeSekunde, deckleDrehzahl(SPIRALE_ARME, WUNSCH_UMDREHUNGEN, false));
  assert.ok(normal.hz <= STREIFEN_MAX_HZ + 1e-9, `hz ${normal.hz}`);
  const ruhig = drehungFuer(true);
  assert.ok(Math.abs(ruhig.umdrehungenJeSekunde - normal.umdrehungenJeSekunde * RUHIG_FAKTOR) < 1e-9);
  assert.ok(ruhig.hz < normal.hz);
  // Auch ein hoher Wunsch wird gedeckelt, mit vielen Armen ebenso.
  for (const arme of [1, 3, 8, 20]) {
    assert.ok(drehungFuer(false, arme, 50).hz <= STREIFEN_MAX_HZ + 1e-9, `${arme} Arme`);
    assert.ok(drehungFuer(true, arme, 50).hz <= STREIFEN_MAX_HZ * RUHIG_FAKTOR + 1e-9, `${arme} Arme ruhig`);
  }
  console.log(`einheit: Streifenfrequenz normal ${normal.hz.toFixed(2)} Hz, ruhig ${ruhig.hz.toFixed(2)} Hz`);
});

test('Einblenden dauert mindestens 1200 ms und waechst gleichmaessig', () => {
  assert.ok(EINBLEND_MS >= EINBLEND_MIN_MS && EINBLEND_MIN_MS >= 1200);
  assert.equal(deckkraftNach(0), 0);
  assert.equal(deckkraftNach(-5), 0);
  assert.ok(deckkraftNach(EINBLEND_MIN_MS - 1, 100) < 1, 'kuerzere Wunschdauer wird auf 1200 ms angehoben');
  assert.equal(deckkraftNach(EINBLEND_MS), 1);
  assert.equal(deckkraftNach(EINBLEND_MS * 5), 1);
  // Kein harter Sprung: zwischen zwei Bildern (33 ms) aendert sich die Deckkraft um hoechstens 3 Prozent.
  assert.ok(deckkraftNach(33) <= 0.03);
});

test('Aufloesung: laengste Seite hoechstens 1280, Verhaeltnis bleibt', () => {
  assert.deepEqual(leinwandMasse(800, 600), { breite: 800, hoehe: 600 });
  const a = leinwandMasse(3840, 2160);
  assert.equal(Math.max(a.breite, a.hoehe), LEINWAND_MAX_SEITE);
  assert.ok(Math.abs(a.breite / a.hoehe - 3840 / 2160) < 0.01);
  const b = leinwandMasse(600, 5000);
  assert.equal(b.hoehe, LEINWAND_MAX_SEITE);
  assert.deepEqual(leinwandMasse(0, NaN), { breite: 1, hoehe: 1 });
});

test('Satzwahl und Mausbewegung', () => {
  assert.equal(waehleSatz(['a', 'b', 'c'], 0), 'a');
  assert.equal(waehleSatz(['a', 'b', 'c'], 0.999), 'c');
  assert.equal(waehleSatz([], 0.5), '');
  assert.equal(waehleSatz(['  '], 0.5), '');
  assert.equal(waehleSatz(undefined, 0.5), '');
  assert.equal(mausBewegt(null, { x: 5, y: 5 }), false, 'erstes Ereignis ohne eigene Bewegung ist nur ein nachgeschobenes');
  assert.equal(mausBewegt(null, { x: 5, y: 5, bewegungX: 2 }), true);
  assert.equal(mausBewegt({ x: 5, y: 5 }, { x: 5, y: 5 }), false);
  assert.equal(mausBewegt({ x: 5, y: 5 }, { x: 5, y: 7 }), true);
});

test('Bedingungen: jede Absage, feste Reihenfolge', () => {
  const gut = { oberste: true, schalterAn: true, erlaubt: true, sichtbar: true, tippt: false, belegt: false, vollbild: false, satz: 'Satz' };
  assert.equal(absageGrund(gut), null);
  const faelle = [
    ['oberste', false, 'nicht-oberste'],
    ['schalterAn', false, 'schalter-aus'],
    ['erlaubt', false, 'nicht-erlaubt'],
    ['sichtbar', false, 'unsichtbar'],
    ['tippt', true, 'eingabe'],
    ['belegt', true, 'belegt'],
    ['vollbild', true, 'vollbild'],
    ['satz', '', 'kein-satz'],
  ];
  for (const [feld, wert, soll] of faelle) assert.equal(absageGrund({ ...gut, [feld]: wert }), soll, feld);
  assert.equal(absageGrund({ ...gut, tippt: true, vollbild: true }), 'eingabe');
});

test('Zustand: Sperre bis zum naechsten active und idle, 334 ms Abstand', () => {
  const z = new LeerlaufZustand();
  assert.equal(z.versucheStart(1000), true);
  assert.equal(z.phase, 'laedt');
  assert.equal(z.versucheStart(1001), false, 'zweiter Start waehrend der Pruefung');
  assert.equal(z.zeigeSpirale(), true);
  assert.equal(z.phase, 'spirale');
  assert.equal(z.endeSpirale(5000), true);
  assert.equal(z.gesperrt, true);
  assert.equal(z.versucheStart(60_000), false, 'gesperrt bis active');
  assert.equal(z.warumNicht(60_000), 'gesperrt');
  assert.equal(z.aktiv(), 'nichts');
  assert.equal(z.versucheStart(5000 + SPERRE_MS - 1), false, 'unter 334 ms nach dem Ende');
  assert.equal(z.warumNicht(5000 + SPERRE_MS - 1), 'abstand');
  assert.equal(z.warumNicht(6000), 'laeuft-schon', 'frei, also kein Grund ausser einem laufenden');
  assert.equal(z.versucheStart(5000 + SPERRE_MS), true);
  z.verwirf();
  assert.equal(z.phase, 'ruhend');
  assert.equal(z.versucheStart(9000), true, 'verworfene Pruefung sperrt nicht');
});

test('Zustand: active beendet Spirale, bricht Pruefung ab, laesst Warnkarte stehen', () => {
  const z = new LeerlaufZustand();
  z.versucheStart(0);
  z.zeigeSpirale();
  assert.equal(z.aktiv(), 'spirale-beenden');
  z.endeSpirale(10);
  assert.equal(z.gesperrt, true);
  z.aktiv();
  z.versucheStart(1000);
  assert.equal(z.aktiv(), 'abgebrochen');
  assert.equal(z.phase, 'ruhend');
  z.versucheStart(2000);
  assert.equal(z.zeigeWarnung(), true);
  assert.equal(z.aktiv(), 'nichts');
  assert.equal(z.phase, 'warnung', 'die Karte bleibt, wenn die Person zurueckkommt');
  assert.equal(z.versucheStart(3000), false, 'solange die Karte steht, keine zweite Anzeige');
  z.schliesseWarnung(4000);
  assert.equal(z.phase, 'ruhend');
  assert.equal(z.gesperrt, false);
});
