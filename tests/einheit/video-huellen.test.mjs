// Einheitstests der Huellen in der Zonen-Leinwand (Phase 11, E3b): src/schleier/video-huellen.ts, reine Logik ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HuellenSpeicher, HUELLE_MIN_MS, HUELLE_RUHE_MS } from '../../src/schleier/video-huellen.ts';

const sp = (id, l, t, r, b, behandlung = 'mosaik', motiv = id) => ({ id, motiv, behandlung, kanten: { l, t, r, b } });
const enthaelt = (h, k) => h.l <= k.l && h.t <= k.t && h.r >= k.r && h.b >= k.b;

test('Konstanten: 1000 ms Ruhe, 500 ms Mindestzeit', () => {
  assert.equal(HUELLE_RUHE_MS, 1000);
  assert.equal(HUELLE_MIN_MS, 500);
});

test('zwei sich schneidende Spuren: eine Huelle, die beide ganz enthaelt (S1)', () => {
  const a = sp(1, 0, 0, 50, 50);
  const b = sp(2, 40, 40, 100, 90);
  const aus = new HuellenSpeicher().berechne([a, b], 0, 'mosaik');
  assert.equal(aus.length, 1);
  assert.deepEqual(aus[0].ids, [1, 2]);
  assert.deepEqual(aus[0].kanten, { l: 0, t: 0, r: 100, b: 90 });
  assert.ok(enthaelt(aus[0].kanten, a.kanten) && enthaelt(aus[0].kanten, b.kanten));
});

test('getrennte und nur beruehrende Spuren bleiben einzeln', () => {
  const aus = new HuellenSpeicher().berechne([sp(1, 0, 0, 50, 50), sp(2, 50, 0, 100, 50), sp(3, 200, 200, 300, 300)], 0, 'mosaik');
  assert.deepEqual(aus.map((h) => h.ids), [[1], [2], [3]]);
});

test('Kette: jede Spur schneidet nur die naechste, eine Huelle', () => {
  const aus = new HuellenSpeicher().berechne([sp(1, 0, 0, 40, 10), sp(2, 30, 0, 70, 10), sp(3, 60, 0, 100, 10)], 0, 'mosaik');
  assert.equal(aus.length, 1);
  assert.deepEqual(aus[0].kanten, { l: 0, t: 0, r: 100, b: 10 });
});

test('eine Huelle, die erst durch das Zusammenfassen eine weitere Gruppe schneidet, verschmilzt mit ihr', () => {
  // a und b schneiden sich, die Huelle (0..100 hoch 0..100) schneidet c, obwohl c weder a noch b beruehrt
  const aus = new HuellenSpeicher().berechne([sp(1, 0, 0, 40, 40), sp(2, 30, 30, 100, 100), sp(3, 60, 5, 90, 20)], 0, 'mosaik');
  assert.equal(aus.length, 1);
  assert.deepEqual(aus[0].ids, [1, 2, 3]);
});

test('staerkste Behandlung: Schwarz vor Sticker vor Mosaik vor Weichzeichner; das Wort bleibt', () => {
  const m = new HuellenSpeicher();
  assert.equal(m.berechne([sp(1, 0, 0, 50, 50, 'blur'), sp(2, 40, 0, 90, 50, 'schwarz')], 0, 'mosaik')[0].behandlung, 'schwarz');
  assert.equal(new HuellenSpeicher().berechne([sp(1, 0, 0, 50, 50, 'blur'), sp(2, 40, 0, 90, 50, 'mosaik-wort')], 0, 'mosaik')[0].behandlung, 'mosaik-wort');
  assert.equal(new HuellenSpeicher().berechne([sp(1, 0, 0, 50, 50, 'mosaik'), sp(2, 40, 0, 90, 50, 'sticker')], 0, 'mosaik')[0].behandlung, 'sticker');
});

test('Motiv der Huelle ist das der aeltesten Spur, auch wenn die Reihenfolge der Liste anders ist', () => {
  const aus = new HuellenSpeicher().berechne([sp(7, 40, 0, 90, 50, 'mosaik', 70), sp(3, 0, 0, 50, 50, 'mosaik', 30)], 0, 'mosaik');
  assert.equal(aus[0].motiv, 30);
});

test('Ruhe: trennen sich die Spuren, deckt die Huelle weiter alle, bis 1000 ms ohne Schnitt vergangen sind', () => {
  const m = new HuellenSpeicher();
  const a = sp(1, 0, 0, 50, 50);
  const nah = sp(2, 40, 0, 90, 50);
  const fern = sp(2, 300, 0, 350, 50);
  assert.equal(m.berechne([a, nah], 0, 'mosaik').length, 1);
  for (const t of [100, 400, 900, 999]) {
    const aus = m.berechne([a, fern], t, 'mosaik');
    assert.equal(aus.length, 1, `bei ${t} ms noch eine Huelle`);
    assert.ok(enthaelt(aus[0].kanten, a.kanten) && enthaelt(aus[0].kanten, fern.kanten), 'die Huelle deckt beide Spuren');
  }
  assert.equal(m.berechne([a, fern], 1000, 'mosaik').length, 2, 'nach 1000 ms getrennt');
});

test('Ruhe: ein erneuter Schnitt beginnt die 1000 ms neu', () => {
  const m = new HuellenSpeicher();
  const a = sp(1, 0, 0, 50, 50);
  m.berechne([a, sp(2, 40, 0, 90, 50)], 0, 'mosaik');
  m.berechne([a, sp(2, 300, 0, 350, 50)], 600, 'mosaik');
  m.berechne([a, sp(2, 40, 0, 90, 50)], 900, 'mosaik');
  assert.equal(m.berechne([a, sp(2, 300, 0, 350, 50)], 1500, 'mosaik').length, 1, '600 ms nach dem letzten Schnitt: noch Huelle');
  assert.equal(m.berechne([a, sp(2, 300, 0, 350, 50)], 1899, 'mosaik').length, 1, '999 ms nach dem letzten Schnitt: noch Huelle');
  assert.equal(m.berechne([a, sp(2, 300, 0, 350, 50)], 2000, 'mosaik').length, 2, '1100 ms nach dem letzten Schnitt: aufgeloest');
});

test('endet eine Spur, bleibt die Huelle fuer die uebrigen, das Motiv der aeltesten bleibt', () => {
  const m = new HuellenSpeicher();
  const a = sp(1, 0, 0, 50, 50, 'mosaik', 10);
  const b = sp(2, 40, 0, 90, 50, 'mosaik', 20);
  const c = sp(3, 80, 0, 130, 50, 'mosaik', 30);
  assert.equal(m.berechne([a, b, c], 0, 'mosaik')[0].ids.length, 3);
  // die aelteste Spur endet; b und c schneiden sich weiter
  const aus = m.berechne([b, c], 100, 'mosaik');
  assert.equal(aus.length, 1);
  assert.deepEqual(aus[0].ids, [2, 3]);
  assert.equal(aus[0].motiv, 10, 'das Wort springt nicht');
});

test('Gruppen mit weniger als zwei lebenden Spuren loesen sich sofort auf (eine Spur ist ihre eigene Flaeche)', () => {
  const m = new HuellenSpeicher();
  const a = sp(1, 0, 0, 50, 50);
  m.berechne([a, sp(2, 40, 0, 90, 50)], 0, 'mosaik');
  const aus = m.berechne([a], 10, 'mosaik');
  assert.deepEqual(aus.map((h) => h.ids), [[1]]);
  assert.equal(m.gehalten, 0);
});

test('jedes Bild: die Huelle enthaelt jede Spur ganz, auch wenn die Spuren wandern (Zufallsfolge mit festem Anfangswert)', () => {
  let x = 4711;
  const zufall = () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
  const m = new HuellenSpeicher();
  for (let t = 0; t < 400; t++) {
    const spuren = [];
    for (let i = 1; i <= 4; i++) {
      const l = zufall() * 200;
      const o = zufall() * 200;
      spuren.push(sp(i, l, o, l + 20 + zufall() * 60, o + 20 + zufall() * 60, ['mosaik', 'blur', 'schwarz', 'sticker'][i - 1]));
    }
    const aus = m.berechne(spuren, t * 33, 'mosaik');
    for (const s of spuren) {
      const h = aus.find((q) => q.ids.includes(s.id));
      assert.ok(h && enthaelt(h.kanten, s.kanten), `Bild ${t}: Spur ${s.id} nicht ganz in ihrer Huelle`);
    }
    // jede Spur steht in genau einer Huelle, und keine Huelle schneidet eine andere
    assert.equal(aus.flatMap((h) => h.ids).length, 4);
    for (let i = 0; i < aus.length; i++) {
      for (let j = i + 1; j < aus.length; j++) {
        const p = aus[i].kanten;
        const q = aus[j].kanten;
        assert.ok(!(Math.min(p.r, q.r) > Math.max(p.l, q.l) && Math.min(p.b, q.b) > Math.max(p.t, q.t)), `Bild ${t}: zwei Huellen schneiden sich`);
      }
    }
  }
});

test('F5 auf Logikebene: Spuren, die sich im Takt von 100 ms schneiden und trennen, ergeben hoechstens 2 Wechsel der Flaechenzahl je Sekunde', () => {
  const m = new HuellenSpeicher();
  const a = sp(1, 0, 0, 50, 50);
  const zahlen = [];
  for (let t = 0; t <= 8000; t += 50) {
    const schneidet = Math.floor(t / 100) % 2 === 0;
    zahlen.push([t, m.berechne([a, schneidet ? sp(2, 49, 0, 99, 50) : sp(2, 50.5, 0, 100, 50)], t, 'mosaik').length]);
  }
  const wechsel = [];
  for (let i = 1; i < zahlen.length; i++) if (zahlen[i][1] !== zahlen[i - 1][1]) wechsel.push(zahlen[i][0]);
  for (const t of wechsel) assert.ok(wechsel.filter((u) => u >= t && u < t + 1000).length <= 2, `zu viele Wechsel ab ${t}`);
  // Wer sich nur beruehrt (50 gegen 50,5 ist getrennt), schneidet nie dauerhaft: nach dem ersten Schnitt steht die Huelle durchgehend.
  assert.ok(wechsel.length <= 1, `Wechsel: ${wechsel}`);
});

test('leere() verwirft gehaltene Gruppen (neue Szene)', () => {
  const m = new HuellenSpeicher();
  const a = sp(1, 0, 0, 50, 50);
  m.berechne([a, sp(2, 40, 0, 90, 50)], 0, 'mosaik');
  m.leere();
  assert.equal(m.berechne([a, sp(2, 300, 0, 350, 50)], 10, 'mosaik').length, 2);
});
