// Einheitstest Auftrag M (Meldungen): reine Logik in src/meldungen/logik.ts (Zaehler, Tageswechsel, Schritte, Abstand, Warten, Verfall, Vorrang).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MELDUNG_MIN_ABSTAND_MS } from '../../src/kontrolle/grenzen.ts';
import {
  WARTE_MAX_MS,
  fensterBeginnMs,
  klemmeZuletzt,
  kandidaten,
  leererStand,
  merkeWartend,
  nachGezeigt,
  neuerTag,
  pruefeStreng,
  pruefeStufe,
  vervollstaendigeStand,
  waehleSatz,
  zaehleMinute,
} from '../../src/meldungen/logik.ts';

const t0 = new Date(2026, 10, 5, 12, 0, 0);
const plus = (d, min) => new Date(d.getTime() + min * 60_000);

test('zensiert: Anlass bei 50, dann 100, Zahl ist der Stand', () => {
  let s = leererStand(t0);
  let r = zaehleMinute(s, { erwachsen: false, zensiert: 49 }, t0);
  assert.deepEqual(r.faellig, []);
  r = zaehleMinute(r.stand, { erwachsen: false, zensiert: 1 }, plus(t0, 1));
  assert.deepEqual(r.faellig, [{ anlass: 'zensiert', zahl: 50 }]);
  r = zaehleMinute(r.stand, { erwachsen: false, zensiert: 10 }, plus(t0, 2));
  assert.deepEqual(r.faellig, []);
  r = zaehleMinute(r.stand, { erwachsen: false, zensiert: 45 }, plus(t0, 3));
  assert.deepEqual(r.faellig, [{ anlass: 'zensiert', zahl: 105 }]);
  // ein grosser Sprung ist ein Anlass, nicht zwei
  r = zaehleMinute(leererStand(t0), { erwachsen: false, zensiert: 160 }, t0);
  assert.equal(r.faellig.length, 1);
  assert.equal(r.stand.zensiertSchritte, 3);
});

test('Tageswechsel (Ortszeit) setzt die Tageszaehler zurueck, Stufe und Abstand bleiben', () => {
  let s = { ...leererStand(t0), zensiert: 49, stufe: 2, zuletzt: 123 };
  s = merkeWartend(s, [{ anlass: 'zensiert', zahl: 50 }, { anlass: 'stufe' }], t0.getTime());
  const morgen = new Date(2026, 10, 6, 0, 1, 0);
  const n = neuerTag(s, morgen);
  assert.equal(n.zensiert, 0);
  assert.equal(n.stufe, 2);
  assert.equal(n.zuletzt, 123);
  assert.ok(!n.wartend.zensiert && n.wartend.stufe);
  const r = zaehleMinute(n, { erwachsen: false, zensiert: 1 }, morgen);
  assert.deepEqual(r.faellig, []);
  assert.equal(neuerTag(s, plus(t0, 5)), s);
});

test('erwachsen: je 20 Minuten, eine Uhr-Minute zaehlt einmal', () => {
  let s = leererStand(t0);
  let faellig = [];
  for (let i = 0; i < 40; i++) {
    const r = zaehleMinute(s, { erwachsen: true, zensiert: 0 }, plus(t0, i));
    s = r.stand;
    if (r.faellig.length) faellig.push(i);
  }
  assert.deepEqual(faellig, [19, 39]);
  const doppelt = zaehleMinute(s, { erwachsen: true, zensiert: 0 }, plus(t0, 39));
  assert.equal(doppelt.stand.erwachsenMs, s.erwachsenMs);
  const nicht = zaehleMinute(leererStand(t0), { erwachsen: false, zensiert: 0 }, t0);
  assert.equal(nicht.stand.erwachsenMs, 0);
});

test('Stufe: nur Anstieg loest aus, der erste Wert nicht', () => {
  let r = pruefeStufe(leererStand(t0), 2);
  assert.deepEqual(r.faellig, []);
  assert.equal(r.stand.stufe, 2);
  r = pruefeStufe(r.stand, 3);
  assert.deepEqual(r.faellig, [{ anlass: 'stufe' }]);
  r = pruefeStufe(r.stand, 1);
  assert.deepEqual(r.faellig, []);
  assert.equal(r.stand.stufe, 1);
  assert.deepEqual(pruefeStufe(r.stand, null).faellig, []);
});

test('streng: einmal je Fenster, Beginn des Fensters, ueber Mitternacht', () => {
  const zeiten = [{ tage: [0, 1, 2, 3, 4, 5, 6], von: 21 * 60, bis: 23 * 60 }];
  const innen = new Date(2026, 10, 5, 21, 30, 0);
  assert.equal(fensterBeginnMs(zeiten, innen), new Date(2026, 10, 5, 21, 0, 0).getTime());
  assert.equal(fensterBeginnMs(zeiten, t0), null);
  let r = pruefeStreng(leererStand(t0), zeiten, true, innen);
  assert.deepEqual(r.faellig, [{ anlass: 'streng' }]);
  r = pruefeStreng(r.stand, zeiten, true, plus(innen, 10));
  assert.deepEqual(r.faellig, []);
  r = pruefeStreng(r.stand, zeiten, true, plus(innen, 120));
  assert.equal(r.stand.strengKennung, null);
  r = pruefeStreng(r.stand, zeiten, true, new Date(2026, 10, 6, 21, 5, 0));
  assert.equal(r.faellig.length, 1);
  assert.deepEqual(pruefeStreng(leererStand(t0), zeiten, false, innen).faellig, []);
  const nacht = [{ tage: [4], von: 22 * 60, bis: 2 * 60 }];
  assert.equal(fensterBeginnMs(nacht, new Date(2026, 10, 6, 1, 0, 0)), new Date(2026, 10, 5, 22, 0, 0).getTime());
  assert.equal(fensterBeginnMs([{ tage: [0, 1, 2, 3, 4, 5, 6], von: 0, bis: 0 }], t0), null);
});

test('Abstand: hoechstens eine Meldung je 10 Minuten, Wartende warten, Verfall nach 30 Minuten', () => {
  const ms = t0.getTime();
  let s = merkeWartend(leererStand(t0), [{ anlass: 'erwachsen' }], ms);
  assert.deepEqual(kandidaten(s, ms).map((k) => k.anlass), ['erwachsen']);
  s = nachGezeigt(s, 'erwachsen', ms);
  assert.deepEqual(s.wartend, {});
  s = merkeWartend(s, [{ anlass: 'zensiert', zahl: 50 }], ms + 60_000);
  assert.deepEqual(kandidaten(s, ms + 60_000), []);
  assert.deepEqual(kandidaten(s, ms + MELDUNG_MIN_ABSTAND_MS - 1), []);
  assert.deepEqual(kandidaten(s, ms + MELDUNG_MIN_ABSTAND_MS), [{ anlass: 'zensiert', zahl: 50 }]);
  // Verfall: nach 30 Minuten weg, auch beim Vormerken
  assert.deepEqual(kandidaten(s, ms + 60_000 + WARTE_MAX_MS + 1), []);
  const alt = merkeWartend(s, [], ms + 60_000 + WARTE_MAX_MS + 1);
  assert.deepEqual(alt.wartend, {});
  // je Anlass hoechstens einer, der neueste Stand zaehlt
  const neu = merkeWartend(s, [{ anlass: 'zensiert', zahl: 100 }], ms + 120_000);
  assert.equal(neu.wartend.zensiert.zahl, 100);
});

test('Vorrang: stufe, streng, zensiert, erwachsen', () => {
  const ms = t0.getTime();
  const s = merkeWartend(leererStand(t0), [{ anlass: 'erwachsen' }, { anlass: 'zensiert', zahl: 50 }, { anlass: 'streng' }, { anlass: 'stufe' }], ms);
  assert.deepEqual(kandidaten(s, ms).map((k) => k.anlass), ['stufe', 'streng', 'zensiert', 'erwachsen']);
});

test('Stand: kaputte Werte werden bereinigt', () => {
  const s = vervollstaendigeStand({ zensiert: -4, tag: 'x', stufe: 99, wartend: { stufe: { seit: 5 }, zensiert: 'x', erwachsen: { seit: -1 } } }, t0);
  assert.equal(s.zensiert, 0);
  assert.equal(s.stufe, 4);
  assert.equal(s.tag, '2026-11-05');
  assert.deepEqual(Object.keys(s.wartend), ['stufe']);
});

test('Satzwahl: nie derselbe zweimal hintereinander', () => {
  assert.equal(waehleSatz([], 0.3), null);
  assert.equal(waehleSatz(['a'], 0.3, 'a'), 'a');
  for (let i = 0; i < 20; i++) assert.equal(waehleSatz(['a', 'b'], i / 20, 'a'), 'b');
});

test('Wartender Anlass behaelt sein erstes `seit`, nur `zahl` wird erneuert (Verfall nach 30 Minuten trotz Erneuerung)', () => {
  const ms = t0.getTime();
  let s = merkeWartend(leererStand(t0), [{ anlass: 'zensiert', zahl: 50 }], ms);
  s = merkeWartend(s, [{ anlass: 'zensiert', zahl: 100 }], ms + 20 * 60_000);
  assert.equal(s.wartend.zensiert.seit, ms);
  assert.equal(s.wartend.zensiert.zahl, 100);
  const spaet = merkeWartend(s, [], ms + WARTE_MAX_MS + 1);
  assert.deepEqual(spaet.wartend, {});
  // ein verfallener Anlass beginnt bei einem neuen Schritt von vorn
  const neu = merkeWartend(s, [{ anlass: 'zensiert', zahl: 150 }], ms + WARTE_MAX_MS + 5);
  assert.equal(neu.wartend.zensiert.seit, ms + WARTE_MAX_MS + 5);
});

test('Uhr zurueckgestellt: zuletzt in der Zukunft wird gekuerzt, der Abstand bleibt', () => {
  const ms = t0.getTime();
  const s = { ...leererStand(t0), zuletzt: ms + 5 * 3600_000 };
  assert.equal(klemmeZuletzt(s, ms).zuletzt, ms);
  assert.deepEqual(kandidaten(merkeWartend(klemmeZuletzt(s, ms), [{ anlass: 'stufe' }], ms), ms), []);
  assert.deepEqual(kandidaten(merkeWartend(s, [{ anlass: 'stufe' }], ms), ms), []);
});

test('streng: Suche ueber Raster findet den Beginn minutengenau; dasselbe Fenster ohne Suche', () => {
  const zeiten = [{ tage: [0, 1, 2, 3, 4, 5, 6], von: 21 * 60 + 3, bis: 23 * 60 }];
  for (const [h, m] of [[21, 3], [21, 4], [21, 13], [21, 14], [22, 59]]) {
    const jetzt = new Date(2026, 10, 5, h, m, 30);
    assert.equal(fensterBeginnMs(zeiten, jetzt), new Date(2026, 10, 5, 21, 3, 0).getTime(), `${h}:${m}`);
  }
  let r = pruefeStreng(leererStand(t0), zeiten, true, new Date(2026, 10, 5, 21, 10, 0));
  assert.equal(r.faellig.length, 1);
  assert.equal(r.stand.strengZuletzt, new Date(2026, 10, 5, 21, 10, 0).getTime());
  r = pruefeStreng(r.stand, zeiten, true, new Date(2026, 10, 5, 21, 11, 0));
  assert.deepEqual(r.faellig, []);
  // am naechsten Tag, ohne Auswertung dazwischen: neues Fenster
  r = pruefeStreng(r.stand, zeiten, true, new Date(2026, 10, 6, 21, 30, 0));
  assert.equal(r.faellig.length, 1);
  // Dauer-Fenster: kein Beginn, kein Anlass
  assert.deepEqual(pruefeStreng(leererStand(t0), [{ tage: [0, 1, 2, 3, 4, 5, 6], von: 0, bis: 0 }], true, t0).faellig, []);
});

test('Begruessung: Merker gilt 30 Minuten je Host, Muell und Abgelaufenes fallen heraus', async () => {
  const { bereinigeGrussMerker, grussFrisch, GRUSS_FRIST_MS, GRUSS_HOSTS_MAX } = await import('../../src/meldungen/gruss-merker.ts');
  const jetzt = 10_000_000_000;
  const m = bereinigeGrussMerker({ a: jetzt - 1000, b: jetzt - GRUSS_FRIST_MS, c: 'x', d: jetzt + 5000, e: NaN }, jetzt);
  assert.deepEqual(Object.keys(m), ['a']);
  assert.equal(grussFrisch(m, 'a', jetzt), true);
  assert.equal(grussFrisch(m, 'a', jetzt + GRUSS_FRIST_MS), false);
  assert.equal(grussFrisch(m, 'b', jetzt), false);
  assert.deepEqual(bereinigeGrussMerker(null, jetzt), {});
  assert.deepEqual(bereinigeGrussMerker([1, 2], jetzt), {});
  const viele = Object.fromEntries(Array.from({ length: GRUSS_HOSTS_MAX + 20 }, (_, i) => [`h${i}.test`, jetzt - 10 - i]));
  assert.equal(Object.keys(bereinigeGrussMerker(viele, jetzt)).length, GRUSS_HOSTS_MAX);
});
