// Einheitstests Pflicht-Besuche (Auftrag Z2, Session 10): Plan-Logik und harte Regeln des Hintergrunds (src/besuche/plan.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BESUCH_ABSTAND_MS, BESUCH_MIN_ABSTAND_MS } from '../../src/kontrolle/grenzen.ts';
import { besuchAblehnung, liesBesuchPlan, neuerBesuchPlan, pruefeBesuchPlan } from '../../src/besuche/plan.ts';

const H = 60 * 60_000;
const JETZT = 1_800_000_000_000;
const lageOk = { frameNull: true, tabBekannt: true, packFrei: true, schalterAn: true, pause: false, ausnahme: false, tabAktiv: true, fensterFokus: true, fensterVollbild: false, zuletzt: null, jetzt: JETZT };

test('fehlender oder kaputter Plan: ab jetzt, Abstand zwischen 2 und 4 Stunden, nie sofort faellig', () => {
  for (const roh of [undefined, null, 'x', { zuletzt: 'x', abstandMs: 5 }, { zuletzt: JETZT, abstandMs: -1 }]) {
    const r = pruefeBesuchPlan(roh, JETZT, 0.5);
    assert.equal(r.faellig, false);
    assert.equal(r.schreibe, true);
    assert.equal(r.plan.zuletzt, JETZT);
    assert.ok(r.plan.abstandMs >= BESUCH_ABSTAND_MS[0] && r.plan.abstandMs <= BESUCH_ABSTAND_MS[1]);
  }
  assert.equal(neuerBesuchPlan(JETZT, 0).abstandMs, 2 * H);
  assert.equal(neuerBesuchPlan(JETZT, 0.999999).abstandMs <= 4 * H, true);
});

test('Plan vor dem Pack-Import gilt als fehlend; gerade eingeschaltet: neu ab jetzt', () => {
  const plan = { zuletzt: JETZT - 5 * H, abstandMs: 3 * H };
  assert.equal(pruefeBesuchPlan(plan, JETZT, 0.2, JETZT - H).faellig, false);
  assert.equal(pruefeBesuchPlan(plan, JETZT, 0.2, JETZT - H).schreibe, true);
  assert.equal(pruefeBesuchPlan(plan, JETZT, 0.2, JETZT - 6 * H).faellig, true);
  const neu = pruefeBesuchPlan(plan, JETZT, 0.2, 0, true);
  assert.deepEqual([neu.faellig, neu.schreibe, neu.plan.zuletzt], [false, true, JETZT]);
});

test('nicht faellig: Plan bleibt, nichts wird geschrieben; genau an der Grenze faellig, Plan bleibt dabei unberuehrt', () => {
  const plan = { zuletzt: JETZT - 2 * H + 1, abstandMs: 2 * H };
  assert.deepEqual(pruefeBesuchPlan(plan, JETZT, 0.5), { faellig: false, plan, schreibe: false });
  const plan2 = { zuletzt: JETZT - 3 * H, abstandMs: 3 * H };
  assert.deepEqual(pruefeBesuchPlan(plan2, JETZT, 0.5), { faellig: true, plan: plan2, schreibe: false });
});

test('Uhr ging zurueck: neu ab jetzt; Abstand ausserhalb 2 bis 4 Stunden wird in den Bereich geholt', () => {
  const zukunft = pruefeBesuchPlan({ zuletzt: JETZT + H, abstandMs: 3 * H }, JETZT, 0.5);
  assert.deepEqual([zukunft.faellig, zukunft.schreibe, zukunft.plan.zuletzt], [false, true, JETZT]);
  const kurz = pruefeBesuchPlan({ zuletzt: JETZT - 10 * 60_000, abstandMs: 60_000 }, JETZT, 0.5);
  assert.equal(kurz.plan.abstandMs, BESUCH_MIN_ABSTAND_MS);
  assert.equal(kurz.faellig, false);
  assert.equal(kurz.schreibe, true);
  const lang = pruefeBesuchPlan({ zuletzt: JETZT - 5 * H, abstandMs: 99 * H }, JETZT, 0.5);
  assert.equal(lang.plan.abstandMs, 4 * H);
  assert.equal(lang.faellig, true);
});

test('liesBesuchPlan prueft die Form', () => {
  assert.deepEqual(liesBesuchPlan({ zuletzt: 5, abstandMs: 7 }), { zuletzt: 5, abstandMs: 7 });
  assert.equal(liesBesuchPlan({ zuletzt: Infinity, abstandMs: 7 }), null);
  assert.equal(liesBesuchPlan(42), null);
});

test('Hintergrund: ohne Einwand erlaubt, jeder einzelne Einwand lehnt ab', () => {
  assert.equal(besuchAblehnung(lageOk), null);
  const faelle = [
    [{ frameNull: false }, 'kein-tab'],
    [{ tabBekannt: false }, 'kein-tab'],
    [{ packFrei: false }, 'kein-pack'],
    [{ schalterAn: false }, 'aus'],
    [{ pause: true }, 'pause'],
    [{ ausnahme: true }, 'ausnahme'],
    [{ tabAktiv: false }, 'tab-nicht-aktiv'],
    [{ fensterFokus: false }, 'kein-fokus'],
    [{ fensterVollbild: true }, 'vollbild'],
    [{ zuletzt: JETZT - 2 * H + 1 }, 'zu-frueh'],
    [{ zuletzt: JETZT }, 'zu-frueh'],
  ];
  for (const [abw, grund] of faelle) assert.equal(besuchAblehnung({ ...lageOk, ...abw }), grund, JSON.stringify(abw));
});

test('2-Stunden-Grenze: genau 2 Stunden reicht, Wert aus der Zukunft sperrt (wird neu geschrieben), kaputt blockiert nicht', () => {
  assert.equal(besuchAblehnung({ ...lageOk, zuletzt: JETZT - 2 * H }), null);
  assert.equal(besuchAblehnung({ ...lageOk, zuletzt: JETZT + H }), 'zu-frueh');
  assert.equal(besuchAblehnung({ ...lageOk, zuletzt: Number.NaN }), null);
  assert.equal(besuchAblehnung({ ...lageOk, zuletzt: null }), null);
});
