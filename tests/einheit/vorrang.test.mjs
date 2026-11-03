// Einheitstests ohne Browser: Stufenwahl der Warteschlange (src/schleier/vorrang.ts, PHASE-3-BAUPLAN Auftrag V).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { istKleinDargestellt, liegtImBereich, vorrangStufe, waehleNachVorrang } from '../../src/schleier/vorrang.ts';

const stufeDe = (k) => vorrangStufe(k.sichtbar, k.nah, k.klein);

test('Stufen: sichtbar gross 1, sichtbar klein 2, nah gross 3, nah klein 4, Rest 5', () => {
  assert.equal(vorrangStufe(true, true, false), 1);
  assert.equal(vorrangStufe(true, true, true), 2);
  assert.equal(vorrangStufe(false, true, false), 3);
  assert.equal(vorrangStufe(false, true, true), 4);
  assert.equal(vorrangStufe(false, false, false), 5);
  assert.equal(vorrangStufe(false, false, true), 5);
  // sichtbar ohne Nah-Meldung (Beobachter noch nicht gemeldet) zaehlt trotzdem als sichtbar
  assert.equal(vorrangStufe(true, false, false), 1);
});

test('Wahl: niedrigste Stufe zuerst, innerhalb der Stufe in Einreihungsfolge', () => {
  const liste = [
    { id: 'fern1', sichtbar: false, nah: false, klein: false },
    { id: 'nahKlein', sichtbar: false, nah: true, klein: true },
    { id: 'sichtKlein1', sichtbar: true, nah: true, klein: true },
    { id: 'nahGross', sichtbar: false, nah: true, klein: false },
    { id: 'sichtGross1', sichtbar: true, nah: true, klein: false },
    { id: 'sichtKlein2', sichtbar: true, nah: true, klein: true },
    { id: 'sichtGross2', sichtbar: true, nah: true, klein: false },
  ];
  const reihenfolge = [];
  const menge = new Set(liste);
  for (;;) {
    const k = waehleNachVorrang(menge, stufeDe);
    if (!k) break;
    reihenfolge.push(k.id);
    menge.delete(k);
  }
  assert.deepEqual(reihenfolge, ['sichtGross1', 'sichtGross2', 'sichtKlein1', 'sichtKlein2', 'nahGross', 'nahKlein', 'fern1']);
});

test('Wahl: nichts wird ausgelassen, Stufe 5 kommt dran, wenn die vorderen leer sind; leere Menge liefert null', () => {
  const fern = [{ id: 'a' }, { id: 'b' }];
  const menge = new Set(fern);
  assert.equal(waehleNachVorrang(menge, () => 5), fern[0]);
  assert.equal(waehleNachVorrang(new Set(), () => 1), null);
});

test('Wahl: 0 heisst ueberspringen, Entfernen waehrend des Durchlaufs ist erlaubt', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  const menge = new Set([a, b, c]);
  const gewaehlt = waehleNachVorrang(menge, (k) => {
    if (k === a) {
      menge.delete(a);
      return 0;
    }
    return k === b ? 4 : 2;
  });
  assert.equal(gewaehlt, c);
  assert.equal(menge.has(a), false);
});

test('Wahl: Stufe 1 beendet den Durchlauf sofort', () => {
  const menge = [1, 2, 3, 4, 5];
  let aufrufe = 0;
  const gewaehlt = waehleNachVorrang(menge, (k) => {
    aufrufe++;
    return k === 2 ? 1 : 3;
  });
  assert.equal(gewaehlt, 2);
  assert.equal(aufrufe, 2);
});

test('Klein: laengste dargestellte Seite unter der Grenze; ohne Flaeche nicht klein', () => {
  assert.equal(istKleinDargestellt({ width: 149, height: 20 }, 150), true);
  assert.equal(istKleinDargestellt({ width: 150, height: 20 }, 150), false);
  assert.equal(istKleinDargestellt({ width: 40, height: 400 }, 150), false);
  assert.equal(istKleinDargestellt({ width: 0, height: 0 }, 150), false);
});

test('Bereich: Sichtbereich und zwei Bildschirmhoehen darum', () => {
  const rect = (top, hoehe = 100, links = 10) => ({ top, bottom: top + hoehe, left: links, right: links + 100, width: 100, height: hoehe });
  const H = 800;
  const B = 1200;
  assert.equal(liegtImBereich(rect(100), H, B, 0), true);
  assert.equal(liegtImBereich(rect(H), H, B, 0), false);
  assert.equal(liegtImBereich(rect(H + 10), H, B, 2), true);
  assert.equal(liegtImBereich(rect(3 * H - 1), H, B, 2), true);
  assert.equal(liegtImBereich(rect(3 * H), H, B, 2), false);
  assert.equal(liegtImBereich(rect(-2 * H - 50), H, B, 2), true);
  assert.equal(liegtImBereich(rect(-2 * H - 100), H, B, 2), false);
  // seitlich ohne Rand
  assert.equal(liegtImBereich(rect(100, 100, B + 1), H, B, 2), false);
  assert.equal(liegtImBereich({ top: 100, bottom: 100, left: 0, right: 0, width: 0, height: 0 }, H, B, 2), false);
});

test('Laufzeit: eine Wahl bei 500 Wartenden dauert unter 1 ms (Median ueber 200 Wahlen im Durchlauf ueber die ganze Menge)', () => {
  // Schlechtester Fall: kein Treffer der Stufe 1, der Durchlauf geht ueber alle 500 (Stufen 2 bis 5 gemischt, keine Stufe 1).
  const menge = new Set();
  for (let i = 0; i < 500; i++) menge.add({ id: i, sichtbar: i % 50 === 0, nah: i % 7 === 0, klein: true });
  const dauern = [];
  for (let n = 0; n < 200; n++) {
    const t0 = performance.now();
    const k = waehleNachVorrang(menge, stufeDe);
    dauern.push(performance.now() - t0);
    assert.ok(k);
  }
  dauern.sort((a, b) => a - b);
  const median = dauern[100];
  const p95 = dauern[190];
  console.log(`Vorrang: Wahl bei 500 Wartenden, Median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms, Maximum ${dauern[199].toFixed(4)} ms`);
  assert.ok(median < 1, `Median ${median} ms`);
  assert.ok(p95 < 1, `p95 ${p95} ms`);
});
