// Einheitstests Phase 11 E4d2 (Regel F5): was jede Handlung der neuen Bedienung in den Speicher schreibt, ueber ALLE Ausgangsstaende der Zonen
// (2^10 Schalter mal 2^6 Kaestchen = 65536). Gemessen wird die Deckung als Menge von Paaren (Zone, nackt oder bekleidet): eine Zone deckt nackt, wenn sie an
// ist, und bekleidet, wenn sie an ist UND `bedeckt` hat (Zonen ohne Kaestchen deckten nie bekleidet). Eine Handlung darf nur Deckung nehmen, die der
// Nutzer mit genau dieser Wahl abgewaehlt hat. Dazu: die Anzeige nennt nie mehr Deckung als gespeichert ist; die Gruppe der Erwachsenenseiten (F4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEDECKBARE_ZONEN, STANDARD, STUFEN_WAHL, ZONEN } from '../../src/einstellungen.ts';
import { gleicheDeckung, kleidungsStand, setzeEineZone, setzeKleidung, zonenUnterKleidung } from '../../src/oberflaeche/bausteine/kleidung.ts';
import { erwachsenGesperrt, erwachsenKarte, erwachsenKarten, erwachsenNachWahl } from '../../src/oberflaeche/bausteine/erwachsen-wahl.ts';
import { ZONEN_WAHLEN, setzeZonenWahl, zonenDerWahl } from '../../src/einstieg/zonen.ts';

const BED = ZONEN.filter((z) => BEDECKBARE_ZONEN.has(z));

// Alle 65536 Staende: Bit i der Schalter fuer ZONEN[i], Bit j der Kaestchen fuer BED[j].
function* staende() {
  for (let a = 0; a < 1 << ZONEN.length; a++) {
    for (let b = 0; b < 1 << BED.length; b++) {
      const s = {};
      ZONEN.forEach((z, i) => {
        s[z] = { an: !!(a & (1 << i)) };
        const j = BED.indexOf(z);
        if (j >= 0) s[z].bedeckt = !!(b & (1 << j));
      });
      yield s;
    }
  }
}
const nackt = (s) => new Set(ZONEN.filter((z) => s[z].an));
const bekleidet = (s) => new Set(ZONEN.filter((z) => s[z].an && s[z].bedeckt === true));
const verloren = (vorher, nachher) => ({
  nackt: [...nackt(vorher)].filter((z) => !nackt(nachher).has(z)),
  bekleidet: [...bekleidet(vorher)].filter((z) => !bekleidet(nachher).has(z)),
});

test('F1 Karte: eine Karte nimmt nur die Deckung der Zonen, die sie ausschaltet; was an bleibt, behaelt nackt und bekleidet; alle 65536 Staende mal drei Karten', () => {
  let n = 0;
  for (const s of staende()) {
    for (const wahl of ZONEN_WAHLEN) {
      const neu = setzeZonenWahl(s, wahl);
      const soll = zonenDerWahl(wahl);
      const v = verloren(s, neu);
      for (const z of [...v.nackt, ...v.bekleidet]) assert.equal(soll.has(z), false, `${wahl}: ${z} blieb an, verlor aber Deckung`);
      // Die Karte schaltet genau ihre Zonen ein, nichts sonst
      for (const z of ZONEN) assert.equal(neu[z].an, soll.has(z), `${wahl}: an ${z}`);
      n += 1;
    }
  }
  assert.equal(n, 65536 * 3);
});

test('F1 Chip: ein Chip aendert nur diese Zone; einschalten nimmt nie Deckung, ausschalten nur die dieser Zone; alle 65536 Staende mal zehn Chips', () => {
  for (const s of staende()) {
    for (const z of ZONEN) {
      const neu = setzeEineZone(s, z, !s[z].an);
      const v = verloren(s, neu);
      if (!s[z].an) assert.deepEqual(v, { nackt: [], bekleidet: [] }, `einschalten ${z}`);
      else for (const y of [...v.nackt, ...v.bekleidet]) assert.equal(y, z, `ausschalten ${z} nahm ${y}`);
      for (const y of ZONEN) if (y !== z) assert.equal(neu[y].an, s[y].an, `Chip ${z} aenderte ${y}`);
    }
  }
});

test('F2 Antwort: "Under clothes too" nimmt nie Deckung und aendert nie ein `an`; "Bare skin only" nimmt nur die bekleidete Deckung, nie die nackte; alle 65536 Staende', () => {
  for (const s of staende()) {
    const auch = setzeKleidung(s, 'auch-bedeckt');
    assert.deepEqual(verloren(s, auch), { nackt: [], bekleidet: [] });
    const haut = setzeKleidung(s, 'haut');
    assert.deepEqual(verloren(s, haut).nackt, []);
    for (const z of ZONEN) {
      assert.equal(auch[z].an, s[z].an);
      assert.equal(haut[z].an, s[z].an);
    }
    // Nach der Antwort zeigt die Frage genau diese Antwort, nie "gemischt"
    assert.equal(kleidungsStand(auch), 'auch-bedeckt');
    assert.equal(kleidungsStand(haut), 'haut');
  }
});

test('F2 Anzeige: markiert die Frage eine Antwort, stimmt sie fuer jede eingeschaltete bedeckbare Zone; bei gemischt ist keine Antwort markiert; alle 65536 Staende', () => {
  for (const s of staende()) {
    const stand = kleidungsStand(s);
    const an = BED.filter((z) => s[z].an);
    if (stand === 'auch-bedeckt' && an.length > 0) for (const z of an) assert.equal(s[z].bedeckt, true, 'auch-bedeckt markiert, aber eine Zone ist nur nackt gedeckt');
    if (stand === 'haut' && an.length > 0) for (const z of an) assert.notEqual(s[z].bedeckt, true, 'haut markiert, aber eine Zone deckt bekleidet');
    // gemischt: genau dann, wenn weder alle noch keine der gezaehlten Zonen bedeckt sind
    const gezaehlt = an.length > 0 ? an : BED;
    const n = gezaehlt.filter((z) => s[z].bedeckt === true).length;
    assert.equal(stand === 'gemischt', n > 0 && n < gezaehlt.length);
  }
});

test('F2 Hinweis: nennt nur Zonen, die an UND bedeckt sind (nie mehr Deckung als gespeichert), und alle davon; alle 65536 Staende', () => {
  for (const s of staende()) {
    const liste = zonenUnterKleidung(s);
    for (const z of liste) assert.equal(s[z].an && s[z].bedeckt === true, true);
    assert.equal(liste.length, BED.filter((z) => s[z].an && s[z].bedeckt === true).length);
  }
});

test('F2: der heutige Standard ist gemischt, die Frage markiert nichts, der Hinweis nennt genau Genitals; die Anzeige schreibt nichts (der Eingang bleibt unveraendert)', () => {
  const vorher = JSON.stringify(STANDARD.zonen);
  assert.equal(kleidungsStand(STANDARD.zonen), 'gemischt');
  assert.deepEqual(zonenUnterKleidung(STANDARD.zonen), ['genitals']);
  assert.equal(JSON.stringify(STANDARD.zonen), vorher);
});

test('gleicheDeckung: gleich bei gleichem an und bedeckt, ungleich bei jeder einzelnen Abweichung, ein fehlendes bedeckt gilt als falsch', () => {
  const a = JSON.parse(JSON.stringify(STANDARD.zonen));
  assert.equal(gleicheDeckung(a, STANDARD.zonen), true);
  for (const z of ZONEN) {
    const b = JSON.parse(JSON.stringify(a));
    b[z].an = !b[z].an;
    assert.equal(gleicheDeckung(a, b), false, `an ${z}`);
  }
  for (const z of BED) {
    const b = JSON.parse(JSON.stringify(a));
    b[z].bedeckt = !(b[z].bedeckt === true);
    assert.equal(gleicheDeckung(a, b), false, `bedeckt ${z}`);
    delete a[z].bedeckt;
    const c = JSON.parse(JSON.stringify(a));
    c[z].bedeckt = false;
    assert.equal(gleicheDeckung(a, c), true, `fehlt gleich falsch ${z}`);
    a[z].bedeckt = STANDARD.zonen[z].bedeckt;
  }
});

// ---------- F4 und G1: Gruppe der Erwachsenenseiten ----------
const erw = (o = {}) => ({ ...STANDARD.erwachsen, komplettErsatz: true, erkennenAmInhalt: false, eigeneSeiten: ['a.example'], ...o });

test('F4 und G1: die Karten der zwei Formen, gesperrt sind ohne Freischaltung genau die drei Stufen', () => {
  assert.deepEqual([...erwachsenKarten(true)], ['off', 'tease', 'hot', 'explicit']);
  assert.deepEqual([...erwachsenKarten(false)], ['off', 'on', 'tease', 'hot', 'explicit']);
  assert.deepEqual([...erwachsenGesperrt(true)], []);
  assert.deepEqual([...erwachsenGesperrt(false)], ['tease', 'hot', 'explicit']);
});

test('G1: die markierte Karte: Off bei aus; mit Freischaltung die gespeicherte Stufe; ohne Freischaltung On und NIE eine Stufe', () => {
  for (const stufe of STUFEN_WAHL) {
    for (const frei of [true, false]) {
      assert.equal(erwachsenKarte({ an: false, stufe }, frei), 'off');
      assert.equal(erwachsenKarte({ an: true, stufe }, frei), frei ? stufe : 'on');
    }
    assert.equal(STUFEN_WAHL.includes(erwachsenKarte({ an: true, stufe }, false)), false, 'ohne Freischaltung nie eine Stufe markiert');
  }
});

test('G1: was jede Karte schreibt, ueber `an` mal drei Stufen mal mit und ohne Freischaltung (36 Faelle je Karte)', () => {
  for (const an of [true, false]) {
    for (const stufe of STUFEN_WAHL) {
      for (const frei of [true, false]) {
        const alt = erw({ an, stufe });
        // Off: nur `an: false`, immer, die Stufe und der Rest bleiben
        assert.deepEqual(erwachsenNachWahl(alt, 'off', frei), { ...alt, an: false }, 'Off');
        // On: ohne Freischaltung nur `an: true`, die Stufe bleibt; mit Freischaltung gibt es die Karte nicht
        assert.deepEqual(erwachsenNachWahl(alt, 'on', frei), frei ? null : { ...alt, an: true }, 'On');
        for (const ziel of STUFEN_WAHL) {
          const neu = erwachsenNachWahl(alt, ziel, frei);
          if (!frei) assert.equal(neu, null, 'ohne Freischaltung bleibt die Stufe gesperrt');
          else assert.deepEqual(neu, { ...alt, an: true, stufe: ziel });
        }
        assert.equal(erwachsenNachWahl(alt, 'unbekannt', frei), null);
        assert.equal(erwachsenNachWahl(alt, '', frei), null);
      }
    }
  }
});

test('G1: nie weniger Deckung durch eine Karte als Off: nur Off schreibt `an: false`, jede andere Karte schreibt nie `an: false`', () => {
  for (const frei of [true, false]) {
    for (const karte of ['on', ...STUFEN_WAHL]) {
      for (const an of [true, false]) {
        const neu = erwachsenNachWahl(erw({ an }), karte, frei);
        if (neu) assert.equal(neu.an, true, `${karte} (frei ${frei})`);
      }
    }
  }
});

test('F4: eine Wahl aendert den Eingang nie', () => {
  const alt = erw();
  const vorher = JSON.stringify(alt);
  for (const frei of [true, false]) for (const k of ['off', 'on', 'tease']) erwachsenNachWahl(alt, k, frei);
  assert.equal(JSON.stringify(alt), vorher);
});
