// Einheitstests fuer den Vertragsschritt Session 10 (PHASE-5-AUFTRAEGE-SESSION-10.md): Einstellungen Tab-Titel, Cursor, Meldungen,
// Pflicht-Besuche und strenge Zeiten, Freischaltungen, Satz-Gruppen, strenge Zeiten (src/kontrolle/streng.ts), Abstaende (grenzen.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENOETIGT, BENOETIGT_GRUPPE, FREISCHALTUNGEN, filtereNachGruppen } from '../../src/pack/vertrag.ts';
import { fuelleSatz, pruefeTexte } from '../../src/quiz/vertrag.ts';
import { MAX_STRENGE_ZEITEN, STANDARD, bereinigeZeiten, vervollstaendige } from '../../src/einstellungen.ts';
import { hebeHaeufigkeit, hebeStufe, istStrengeZeit, minutenAusText, naechsterWechselMs, textAusMinuten } from '../../src/kontrolle/streng.ts';
import { BESUCH_ABSTAND_MS, BESUCH_MIN_ABSTAND_MS, MELDUNG_MIN_ABSTAND_MS, naechsterBesuchAbstand } from '../../src/kontrolle/grenzen.ts';
import { DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';

// 2026-11-05 ist ein Donnerstag (getDay 4). Ortszeit, wie im Browser.
const am = (tag, h, m = 0) => new Date(2026, 10, tag, h, m, 0, 0);

test('Einstellungen: Standard und Bereinigung der neuen Felder', () => {
  assert.deepEqual(
    { tabtitel: STANDARD.kontrolle.tabtitel, cursor: STANDARD.kontrolle.cursor, meldungen: STANDARD.kontrolle.meldungen, besuche: STANDARD.kontrolle.besuche, zeiten: STANDARD.kontrolle.zeiten },
    { tabtitel: true, cursor: 'spirale', meldungen: true, besuche: false, zeiten: [] },
  );
  const alt = vervollstaendige({ kontrolle: { werbung: false } }); // Stand von Session 9
  assert.equal(alt.kontrolle.werbung, false);
  assert.equal(alt.kontrolle.cursor, 'spirale');
  assert.equal(alt.kontrolle.besuche, false);
  assert.deepEqual(alt.kontrolle.zeiten, []);
  const kaputt = vervollstaendige({ kontrolle: { tabtitel: 'ja', cursor: 'pfeil', meldungen: 1, besuche: 'true', zeiten: 'abends' } });
  assert.deepEqual(
    [kaputt.kontrolle.tabtitel, kaputt.kontrolle.cursor, kaputt.kontrolle.meldungen, kaputt.kontrolle.besuche, kaputt.kontrolle.zeiten],
    [true, 'spirale', true, false, []],
  );
  assert.equal(vervollstaendige({ kontrolle: { cursor: 'herz' } }).kontrolle.cursor, 'herz');
  assert.equal(vervollstaendige({ kontrolle: { cursor: 'aus' } }).kontrolle.cursor, 'aus');
});

test('bereinigeZeiten: Grenzen, Tage, hoechstens 3 Fenster (7 Faelle)', () => {
  assert.deepEqual(bereinigeZeiten([{ tage: [5, 1, 1, 9, -1, 2.5], von: 1260, bis: 1380 }]), [{ tage: [1, 5], von: 1260, bis: 1380 }]);
  assert.deepEqual(bereinigeZeiten([{ tage: [], von: 0, bis: 60 }]), []);
  assert.deepEqual(bereinigeZeiten([{ tage: [1], von: 1440, bis: 60 }]), []);
  assert.deepEqual(bereinigeZeiten([{ tage: [1], von: 10.5, bis: 60 }]), []);
  assert.deepEqual(bereinigeZeiten([null, 'x', { tage: [1], von: 0, bis: 0 }]), [{ tage: [1], von: 0, bis: 0 }]);
  const vier = Array.from({ length: 4 }, (_, i) => ({ tage: [i], von: 60, bis: 120 }));
  assert.equal(bereinigeZeiten(vier).length, MAX_STRENGE_ZEITEN);
  assert.deepEqual(bereinigeZeiten(undefined), []);
});

test('istStrengeZeit: normal, ueber Mitternacht, ganzer Tag (12 Faelle)', () => {
  const abends = [{ tage: [4], von: 21 * 60, bis: 23 * 60 }]; // Donnerstag 21 bis 23 Uhr
  assert.equal(istStrengeZeit(abends, am(5, 20, 59)), false);
  assert.equal(istStrengeZeit(abends, am(5, 21, 0)), true);
  assert.equal(istStrengeZeit(abends, am(5, 22, 59)), true);
  assert.equal(istStrengeZeit(abends, am(5, 23, 0)), false);
  assert.equal(istStrengeZeit(abends, am(6, 21, 30)), false); // Freitag
  const nacht = [{ tage: [4], von: 22 * 60, bis: 2 * 60 }]; // Donnerstag 22 Uhr bis Freitag 2 Uhr
  assert.equal(istStrengeZeit(nacht, am(5, 23, 30)), true);
  assert.equal(istStrengeZeit(nacht, am(6, 1, 59)), true);
  assert.equal(istStrengeZeit(nacht, am(6, 2, 0)), false);
  assert.equal(istStrengeZeit(nacht, am(5, 1, 0)), false); // Donnerstag frueh gehoert zum Mittwoch
  const ganz = [{ tage: [6], von: 600, bis: 600 }]; // Samstag ganz
  assert.equal(istStrengeZeit(ganz, am(7, 0, 0)), true);
  assert.equal(istStrengeZeit(ganz, am(8, 0, 0)), false);
  assert.equal(istStrengeZeit([], am(5, 22)), false);
});

test('naechsterWechselMs: bis Beginn, bis Ende, ohne Fenster', () => {
  const abends = [{ tage: [4], von: 21 * 60, bis: 23 * 60 }];
  assert.equal(naechsterWechselMs(abends, am(5, 20, 0)), 60 * 60_000);
  assert.equal(naechsterWechselMs(abends, am(5, 22, 30)), 30 * 60_000);
  const mitSekunden = new Date(2026, 10, 5, 20, 59, 30);
  assert.equal(naechsterWechselMs(abends, mitSekunden), 30_000);
  assert.equal(naechsterWechselMs([], am(5, 20)), null);
  const immer = [{ tage: [0, 1, 2, 3, 4, 5, 6], von: 0, bis: 0 }];
  assert.equal(naechsterWechselMs(immer, am(5, 20)), null);
});

test('hebeHaeufigkeit und hebeStufe', () => {
  assert.deepEqual(['aus', 'selten', 'oft'].map((h) => hebeHaeufigkeit(h, true)), ['aus', 'oft', 'oft']);
  assert.deepEqual(['aus', 'selten', 'oft'].map((h) => hebeHaeufigkeit(h, false)), ['aus', 'selten', 'oft']);
  assert.deepEqual([0, 1, 3, 4].map((s) => hebeStufe(s, true)), [1, 2, 4, 4]);
  assert.deepEqual([0, 2, 4].map((s) => hebeStufe(s, false)), [0, 2, 4]);
  assert.equal(hebeStufe(Number.NaN, true), 1);
});

test('Zeittext: HH:MM hin und zurueck', () => {
  assert.equal(minutenAusText('21:05'), 1265);
  assert.equal(minutenAusText('7:00'), 420);
  assert.equal(minutenAusText('24:00'), null);
  assert.equal(minutenAusText(''), null);
  assert.equal(textAusMinuten(1265), '21:05');
  assert.equal(textAusMinuten(0), '00:00');
});

test('Freischaltungen Session 10: Dateien und Gruppen', () => {
  for (const f of ['kontrolle:tabtitel', 'kontrolle:cursor', 'kontrolle:meldungen', 'kontrolle:zeitplan', 'kontrolle:besuche']) assert.ok(FREISCHALTUNGEN.includes(f), f);
  assert.equal(FREISCHALTUNGEN.length, 19); // 16 bis Session 10, dazu `ton` (Session 11), `zensur:woerter` (Zensur-Presets) und `zensur:sticker` (Sticker-Zensur)
  assert.equal(BENOETIGT['kontrolle:cursor'], null);
  assert.equal(BENOETIGT['kontrolle:zeitplan'], null);
  assert.equal(BENOETIGT['kontrolle:tabtitel'], 'texte');
  assert.equal(BENOETIGT_GRUPPE['kontrolle:tabtitel'], 'tabtitel');
  assert.equal(BENOETIGT_GRUPPE['kontrolle:besuche'], 'besuch');
  assert.equal(BENOETIGT_GRUPPE['kontrolle:meldungen'], undefined);
  const texte = pruefeTexte(DUMMY_TEXTE);
  assert.deepEqual(filtereNachGruppen(['kontrolle:tabtitel', 'kontrolle:besuche', 'kontrolle:meldungen'], texte), ['kontrolle:tabtitel', 'kontrolle:besuche', 'kontrolle:meldungen']);
  const ohne = { gruppen: { start: ['x'] } };
  assert.deepEqual(filtereNachGruppen(['kontrolle:tabtitel', 'kontrolle:besuche', 'kontrolle:cursor', 'kontrolle:zeitplan'], ohne), ['kontrolle:cursor', 'kontrolle:zeitplan']);
});

test('Satz-Gruppen Session 10: Laengen und {{count}}', () => {
  const basis = structuredClone(DUMMY_TEXTE);
  basis.gruppen.tabtitel = ['ok title', 'x'.repeat(61), 'Has {{count}}'];
  basis.gruppen.meldungZensiert = ['{{count}} pictures', 'no number here', 'y'.repeat(121) + '{{count}}'];
  basis.gruppen.meldungStufe = ['Level {{count}}', 'Up a level.'];
  basis.gruppen.besuch = ['z'.repeat(120), 'z'.repeat(121)];
  const t = pruefeTexte(basis);
  assert.deepEqual(t.gruppen.tabtitel, ['ok title']);
  assert.deepEqual(t.gruppen.meldungZensiert, ['{{count}} pictures']);
  assert.deepEqual(t.gruppen.meldungStufe, ['Up a level.']);
  assert.deepEqual(t.gruppen.besuch, ['z'.repeat(120)]);
  assert.equal(fuelleSatz('{{count}} pictures', { count: 50 }), '50 pictures');
});

test('Abstaende Meldungen und Besuche', () => {
  assert.equal(MELDUNG_MIN_ABSTAND_MS, 600_000);
  assert.equal(BESUCH_MIN_ABSTAND_MS, 7_200_000);
  assert.equal(naechsterBesuchAbstand(0), BESUCH_ABSTAND_MS[0]);
  assert.ok(naechsterBesuchAbstand(0.999999) <= BESUCH_ABSTAND_MS[1] && naechsterBesuchAbstand(0.999999) > BESUCH_ABSTAND_MS[1] - 100);
  assert.ok(naechsterBesuchAbstand(Number.NaN) >= BESUCH_MIN_ABSTAND_MS);
  for (let i = 0; i < 100; i++) assert.ok(naechsterBesuchAbstand(Math.random()) >= BESUCH_MIN_ABSTAND_MS);
});

test('Pruefer-Funde 8 und 13: fuelleSatz in einem Durchgang, Zeit mit Sekunden', () => {
  assert.equal(fuelleSatz('{{title}} {{seconds}}', { title: 'Has {{seconds}}', seconds: 5 }), 'Has {{seconds}} 5');
  assert.equal(fuelleSatz('{{count}} x', { count: Number.NaN }), ' x');
  assert.equal(minutenAusText('21:05:30'), 1265);
  assert.equal(minutenAusText('21:05:30.250'), 1265);
});
