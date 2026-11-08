// Einheitstests Einstieg (Auftrag E, PHASE-6-AUFTRAEGE-SESSION-11.md): Zonen-Wahlen hin und zurueck, "even when clothed", Schrittfolge,
// Startschritt und Fortschritt. Reine Logik, ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEDECKBARE_ZONEN, STANDARD, ZONEN, vervollstaendige } from '../../src/einstellungen.ts';
import { EINSTIEG_LEER, INTERVIEW_SEITEN, INTERVIEW_SEITEN_OHNE_PACK, einstiegFertig } from '../../src/einstieg/vertrag.ts';
import { ALLE_SCHRITTE, ETAPPEN, INTERVIEW_SCHRITTE, etappe, fortschritt, interviewSeiten, naechster, startSchritt, vorheriger } from '../../src/einstieg/schritte.ts';
import { ZONEN_WAHLEN, bedecktAlle, setzeBedeckt, setzeZonenWahl, zonenDerWahl, zonenWahl } from '../../src/einstieg/zonen.ts';

const an = (zonen) => ZONEN.filter((z) => zonen[z].an).sort();

test('Zonen: Standard ist "Body", jede Wahl schaltet genau ihre Zonen ein', () => {
  assert.equal(zonenWahl(STANDARD.zonen), 'koerper');
  assert.deepEqual(an(setzeZonenWahl(STANDARD.zonen, 'koerper')), ['breast', 'buttocks', 'genitals']);
  assert.deepEqual(an(setzeZonenWahl(STANDARD.zonen, 'koerper-gesicht')), ['breast', 'buttocks', 'face', 'genitals']);
  assert.equal(an(setzeZonenWahl(STANDARD.zonen, 'alles')).length, ZONEN.length);
  // 3 Wahlen x 3 Wahlen = 9 Uebergaenge: die Wahl ist danach erkannt, unabhaengig vom Ausgangspunkt.
  let faelle = 0;
  for (const von of ZONEN_WAHLEN) {
    for (const nach of ZONEN_WAHLEN) {
      const z = setzeZonenWahl(setzeZonenWahl(STANDARD.zonen, von), nach);
      assert.equal(zonenWahl(z), nach, `${von} -> ${nach}`);
      assert.deepEqual(new Set(an(z)), new Set(zonenDerWahl(nach)));
      faelle++;
    }
  }
  assert.equal(faelle, 9);
});

test('Zonen: Hin und zurueck ergibt den Ausgangsstand, Zwischenstaende ohne Wahl waehlen nichts vor', () => {
  const hin = setzeZonenWahl(setzeZonenWahl(STANDARD.zonen, 'alles'), 'koerper');
  assert.deepEqual(hin, STANDARD.zonen);
  const sonder = vervollstaendige({ zonen: { eyes: { an: true } } }).zonen;
  assert.equal(zonenWahl(sonder), null);
  assert.equal(zonenWahl(setzeZonenWahl(sonder, 'koerper')), 'koerper');
});

test('Zonen: "even when clothed" gilt fuer alle eingeschalteten bedeckbaren Zonen, auch nach einer neuen Wahl', () => {
  assert.equal(bedecktAlle(STANDARD.zonen), false); // ab Werk nur Genitals bedeckt
  const an1 = setzeBedeckt(STANDARD.zonen, true);
  assert.equal(bedecktAlle(an1), true);
  for (const z of ZONEN) if (BEDECKBARE_ZONEN.has(z)) assert.equal(an1[z].bedeckt, STANDARD.zonen[z].an ? true : STANDARD.zonen[z].bedeckt);
  // Wahl "Everything" danach: neue bedeckbare Zonen uebernehmen den gesetzten Haken.
  const alles = setzeZonenWahl(an1, 'alles');
  assert.equal(bedecktAlle(alles), true);
  for (const z of BEDECKBARE_ZONEN) assert.equal(alles[z].bedeckt, true);
  // Ohne Haken bleiben neue Zonen unbedeckt, Haken weg setzt alle eingeschalteten auf unbedeckt.
  const aus = setzeBedeckt(alles, false);
  assert.equal(bedecktAlle(aus), false);
  for (const z of BEDECKBARE_ZONEN) assert.equal(aus[z].bedeckt, false);
  assert.equal(setzeZonenWahl(STANDARD.zonen, 'alles').feet.bedeckt, false);
  // Nicht bedeckbare Zonen haben nie ein `bedeckt`.
  assert.equal('bedeckt' in setzeZonenWahl(an1, 'alles').face, false);
});

test('Zonen: ein altes `bedeckt` kehrt bei einer neuen Wahl nicht zurueck (Everything, Haken an, Body, Haken aus, Everything)', () => {
  let z = setzeZonenWahl(STANDARD.zonen, 'alles');
  z = setzeBedeckt(z, true);
  z = setzeZonenWahl(z, 'koerper');
  z = setzeBedeckt(z, false);
  z = setzeZonenWahl(z, 'alles');
  assert.equal(bedecktAlle(z), false);
  for (const k of ['belly', 'feet', 'armpits']) assert.equal(z[k].bedeckt, false, k);
});

test('Schritte: Reihenfolge, Zurueck nur im Interview, Fortschritt', () => {
  assert.equal(INTERVIEW_SCHRITTE.length, INTERVIEW_SEITEN);
  assert.deepEqual(ALLE_SCHRITTE.slice(0, 3), ['warnung', 'alter', 'einwilligung']);
  assert.equal(ALLE_SCHRITTE.at(-1), 'ende');
  assert.equal(ALLE_SCHRITTE.length, 9);
  assert.equal(naechster('warnung'), 'alter');
  assert.equal(naechster('alter'), 'einwilligung');
  assert.equal(naechster('einwilligung'), 'interview-1');
  assert.equal(naechster('interview-5'), 'ende');
  assert.equal(naechster('ende'), 'ende');
  assert.equal(vorheriger('interview-1'), null);
  assert.equal(vorheriger('interview-3'), 'interview-2');
  assert.equal(vorheriger('alter'), null);
  assert.deepEqual(fortschritt('warnung'), { nr: 1, von: 8 });
  assert.deepEqual(fortschritt('interview-5'), { nr: 8, von: 8 });
  // Fund 19: beim Wiederholen zaehlen nur die fuenf Interview-Seiten
  assert.deepEqual(fortschritt('interview-1', true), { nr: 1, von: 5 });
  assert.deepEqual(fortschritt('interview-5', true), { nr: 5, von: 5 });
});

test('Schritte: Startschritt nach Stand und Adresse', () => {
  assert.equal(startSchritt(EINSTIEG_LEER, ''), 'warnung');
  assert.equal(startSchritt(EINSTIEG_LEER, '#interview'), 'warnung'); // ohne fertigen Einstieg nie am Gate vorbei
  assert.equal(startSchritt({ ...EINSTIEG_LEER, warnung: true }, ''), 'alter');
  assert.equal(startSchritt({ ...EINSTIEG_LEER, warnung: true, alter: true }, ''), 'einwilligung');
  const fertig = { ...EINSTIEG_LEER, warnung: true, alter: true, einwilligung: true, zeit: 1 };
  assert.equal(einstiegFertig(fertig), true);
  assert.equal(startSchritt(fertig, ''), 'interview-1'); // Interview noch offen
  assert.equal(startSchritt({ ...fertig, interview: 'fertig' }, ''), 'ende');
  assert.equal(startSchritt({ ...fertig, interview: 'fertig' }, '#interview'), 'interview-1');
  assert.equal(startSchritt({ ...fertig, interview: 'uebersprungen' }, '#interview'), 'interview-1');
});

test('Schritte: ohne Pack drei Fragen (Fund 7), Fortschritt und Etappen (Fund 19)', () => {
  assert.equal(INTERVIEW_SEITEN_OHNE_PACK, 3);
  assert.equal(interviewSeiten(true), 5);
  assert.equal(interviewSeiten(false), 3);
  const n = interviewSeiten(false);
  assert.equal(naechster('einwilligung', n), 'interview-1');
  assert.equal(naechster('interview-2', n), 'interview-3');
  assert.equal(naechster('interview-3', n), 'ende');
  assert.equal(naechster('interview-4', n), 'ende'); // gemerkter Schritt jenseits der Zahl
  assert.equal(naechster('interview-3'), 'interview-4'); // Standard bleibt fuenf Seiten
  assert.deepEqual(fortschritt('warnung', false, n), { nr: 1, von: 6 });
  assert.deepEqual(fortschritt('interview-3', false, n), { nr: 6, von: 6 });
  assert.deepEqual(fortschritt('interview-3', true, n), { nr: 3, von: 3 });
  assert.deepEqual(fortschritt('interview-5', true, n), { nr: 3, von: 3 }); // nie ueber die Zahl hinaus
  assert.deepEqual(ETAPPEN, ['warnung', 'alter', 'einwilligung', 'interview']);
  assert.equal(etappe('alter'), 'alter');
  assert.equal(etappe('interview-4'), 'interview');
  assert.equal(etappe('ende'), null);
});
