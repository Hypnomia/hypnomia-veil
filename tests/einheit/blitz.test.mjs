// Einheitstests Blitzwoerter (Auftrag B, Phase 5): Zeitplan ueber alle Tabs und Planung der Ereignisse (src/blitz/zeitplan.ts, ereignis.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLITZ_ABSTAND_MS, BLITZ_WORT_MIN_ABSTAND_MS, SCHWARM_MAX_MS, SCHWARM_MAX_WORTE } from '../../src/kontrolle/grenzen.ts';
import { liesZeitplan, pruefeZeitplan, wirksameHaeufigkeit } from '../../src/blitz/zeitplan.ts';
import { planeEreignis, waehleArt } from '../../src/blitz/ereignis.ts';

const MIN = 60_000;
const JETZT = 1_800_000_000_000;

test('fehlender Plan: kein Wort sofort, Plan ab jetzt, Abstand im Bereich', () => {
  for (const h of ['selten', 'oft']) {
    const r = pruefeZeitplan(undefined, JETZT, h, 0.5);
    assert.equal(r.faellig, false);
    assert.equal(r.schreibe, true);
    assert.equal(r.plan.zuletzt, JETZT);
    assert.ok(r.plan.abstandMs >= BLITZ_ABSTAND_MS[h][0] && r.plan.abstandMs <= BLITZ_ABSTAND_MS[h][1]);
  }
  assert.equal(pruefeZeitplan({ zuletzt: 'x', abstandMs: 5 }, JETZT, 'selten', 0).faellig, false);
});

test('nicht faellig: Plan bleibt, nichts wird geschrieben', () => {
  const plan = { zuletzt: JETZT - 5 * MIN, abstandMs: 10 * MIN };
  const r = pruefeZeitplan(plan, JETZT, 'selten', 0.1);
  assert.deepEqual(r, { faellig: false, plan, schreibe: false });
});

test('faellig: neuer Plan ab jetzt, genau an der Grenze faellig', () => {
  const plan = { zuletzt: JETZT - 10 * MIN, abstandMs: 10 * MIN };
  const r = pruefeZeitplan(plan, JETZT, 'selten', 0);
  assert.equal(r.faellig, true);
  assert.equal(r.schreibe, true);
  assert.equal(r.plan.zuletzt, JETZT);
  assert.equal(r.plan.abstandMs, BLITZ_ABSTAND_MS.selten[0]);
  assert.equal(pruefeZeitplan({ zuletzt: JETZT - 10 * MIN + 1, abstandMs: 10 * MIN }, JETZT, 'selten', 0).faellig, false);
});

test('Wechsel der Haeufigkeit: neuer Abstand ab dem alten zuletzt', () => {
  const plan = { zuletzt: JETZT - 3 * MIN, abstandMs: 11 * MIN }; // geplant als selten
  const r = pruefeZeitplan(plan, JETZT, 'oft', 0.999);
  assert.equal(r.plan.zuletzt, plan.zuletzt);
  assert.ok(r.plan.abstandMs >= 2 * MIN && r.plan.abstandMs <= 4 * MIN);
  // 3 min vergangen, neuer Abstand knapp unter 4 min: noch nicht faellig; mit Zufall 0 (2 min) faellig
  assert.equal(r.faellig, false);
  assert.equal(r.schreibe, true);
  assert.equal(pruefeZeitplan(plan, JETZT, 'oft', 0).faellig, true);
});

test('Uhr zurueckgestellt: Plan beginnt neu, kein ewiges Schweigen', () => {
  const r = pruefeZeitplan({ zuletzt: JETZT + 5 * MIN, abstandMs: 10 * MIN }, JETZT, 'selten', 0.5);
  assert.equal(r.faellig, false);
  assert.equal(r.plan.zuletzt, JETZT);
});

test('Haeufigkeit nur ueber die Funktion, aus ist null', () => {
  assert.equal(wirksameHaeufigkeit({ kontrolle: { blitz: 'aus' } }), null);
  assert.equal(wirksameHaeufigkeit({ kontrolle: { blitz: 'oft' } }), 'oft');
  assert.equal(wirksameHaeufigkeit(null), null);
  assert.equal(liesZeitplan({ zuletzt: 1, abstandMs: 0 }), null);
});

function reihe(zahlen) {
  let i = 0;
  return () => zahlen[i++ % zahlen.length];
}
function pseudo(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('Art: 20 Prozent Schwarm', () => {
  assert.equal(waehleArt(0.19), 'schwarm');
  assert.equal(waehleArt(0.2), 'wort');
  assert.equal(waehleArt(0.99), 'wort');
});

test('Einzelwort: eines, Mitte, 300 ms', () => {
  const p = planeEreignis(['A', 'B', 'C'], 'wort', reihe([0.5]));
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].beginnMs, p[0].dauerMs, p[0].x, p[0].y], [0, 300, 0.5, 0.5]);
});

test('Schwarm: 6 bis 12 Woerter, Deckel eingehalten, nie dasselbe Wort in Folge, mittlerer Bereich', () => {
  const zahl = [];
  for (let seed = 1; seed <= 300; seed++) {
    const p = planeEreignis(['A', 'B', 'C'], 'schwarm', pseudo(seed), seed % 2 ? 'A' : null);
    zahl.push(p.length);
    assert.ok(p.length >= 1 && p.length <= SCHWARM_MAX_WORTE);
    if (seed % 2) assert.notEqual(p[0].text, 'A');
    for (let i = 1; i < p.length; i++) {
      assert.notEqual(p[i].text, p[i - 1].text);
      assert.ok(p[i].beginnMs - p[i - 1].beginnMs >= BLITZ_WORT_MIN_ABSTAND_MS);
      assert.ok(p[i - 1].beginnMs + p[i - 1].dauerMs <= p[i].beginnMs);
    }
    for (const w of p) {
      assert.ok(w.beginnMs + w.dauerMs <= SCHWARM_MAX_MS);
      assert.ok(w.x >= 0.2 && w.x <= 0.8 && w.y >= 0.2 && w.y <= 0.8);
    }
  }
  assert.ok(Math.min(...zahl) >= 6 - 0 && Math.max(...zahl) <= 12, `Anzahlen ${Math.min(...zahl)} bis ${Math.max(...zahl)}`);
});

test('ein einziges Wort im Pack: nur Einzelwort, keine Wiederholung als Schwarm; leer: nichts', () => {
  assert.equal(planeEreignis(['A'], 'schwarm', pseudo(3)).length, 1);
  assert.deepEqual(planeEreignis([], 'wort', pseudo(3)), []);
  assert.deepEqual(planeEreignis(['', ''], 'wort', pseudo(3)), []);
});

test('Plan aus der Zeit vor dem Pack-Import gilt wie ein fehlender: kein Wort sofort nach Import', () => {
  const alt = { zuletzt: JETZT - 60 * MIN, abstandMs: 10 * MIN };
  assert.equal(pruefeZeitplan(alt, JETZT, 'selten', 0.5).faellig, true); // ohne Import-Zeit: faellig
  const r = pruefeZeitplan(alt, JETZT, 'selten', 0.5, JETZT - 1000);
  assert.equal(r.faellig, false);
  assert.equal(r.schreibe, true);
  assert.equal(r.plan.zuletzt, JETZT);
  // Plan nach dem Import bleibt gueltig
  assert.equal(pruefeZeitplan(alt, JETZT, 'selten', 0.5, JETZT - 90 * MIN).faellig, true);
});

test('Zufallswerte ausserhalb 0 bis 1 oder kaputt: Orte im mittleren Bereich, kein Absturz, nie dasselbe Wort in Folge', () => {
  for (const wert of [-5, 7, NaN, Infinity, -0.3, 1]) {
    const p = planeEreignis(['A', 'B', 'C'], 'schwarm', () => wert, 'A');
    assert.ok(p.length >= 1 && p.length <= SCHWARM_MAX_WORTE);
    assert.notEqual(p[0].text, 'A');
    for (let i = 0; i < p.length; i++) {
      assert.ok(p[i].x >= 0.2 && p[i].x <= 0.8 && p[i].y >= 0.2 && p[i].y <= 0.8, `Ort ${p[i].x},${p[i].y}`);
      assert.ok(typeof p[i].text === 'string' && p[i].text.length > 0);
      if (i > 0) assert.notEqual(p[i].text, p[i - 1].text);
      if (i > 0) assert.ok(p[i].beginnMs - p[i - 1].beginnMs >= BLITZ_WORT_MIN_ABSTAND_MS);
    }
  }
});
