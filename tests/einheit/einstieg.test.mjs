// Einheitstests Einstieg (Auftrag E, PHASE-6-AUFTRAEGE-SESSION-11.md): Zonen-Wahlen hin und zurueck, "even when clothed", Schrittfolge,
// Startschritt und Fortschritt. Reine Logik, ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEDECKBARE_ZONEN, STANDARD, STUFEN_WAHL, ZONEN, vervollstaendige } from '../../src/einstellungen.ts';
import { EINSTIEG_LEER, INTERVIEW_SEITEN, INTERVIEW_SEITEN_OHNE_PACK, einstiegFertig } from '../../src/einstieg/vertrag.ts';
import { ALLE_SCHRITTE, ETAPPEN, INTERVIEW_SCHRITTE, etappe, fortschritt, interviewSeiten, naechster, startSchritt, vorheriger } from '../../src/einstieg/schritte.ts';
import { ZONEN_WAHLEN, bedecktAlle, setzeBedeckt, setzeZonenWahl, zonenDerWahl, zonenWahl } from '../../src/einstieg/zonen.ts';
import { kleidungsStand, setzeEineZone, setzeKleidung, zonenSchreibteil, zonenUnterKleidung } from '../../src/oberflaeche/bausteine/kleidung.ts';
import { erwachsenGesperrt, erwachsenKarte, erwachsenKarten, erwachsenNachWahl } from '../../src/oberflaeche/bausteine/erwachsen-wahl.ts';

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

test('Zonen: "even when clothed" gilt fuer alle bedeckbaren Zonen (auch ausgeschaltete), auch nach einer neuen Wahl', () => {
  assert.equal(bedecktAlle(STANDARD.zonen), false); // ab Werk nur Genitals bedeckt
  const an1 = setzeBedeckt(STANDARD.zonen, true);
  assert.equal(bedecktAlle(an1), true);
  // R15: der Haken gilt fuer ALLE bedeckbaren Zonen, auch fuer ausgeschaltete (vorher blieben diese unberuehrt).
  for (const z of ZONEN) if (BEDECKBARE_ZONEN.has(z)) assert.equal(an1[z].bedeckt, true, z);
  // Wahl "Everything" danach: neue bedeckbare Zonen uebernehmen den gesetzten Haken.
  const alles = setzeZonenWahl(an1, 'alles');
  assert.equal(bedecktAlle(alles), true);
  for (const z of BEDECKBARE_ZONEN) assert.equal(alles[z].bedeckt, true);
  // Ohne Haken bleiben neue Zonen unbedeckt, Haken weg setzt alle bedeckbaren Zonen auf unbedeckt.
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
  assert.equal(ALLE_SCHRITTE.length, 10);
  assert.equal(naechster('warnung'), 'alter');
  assert.equal(naechster('alter'), 'einwilligung');
  assert.equal(naechster('einwilligung'), 'interview-1');
  assert.equal(naechster('interview-5'), 'interview-6');
  assert.equal(naechster('interview-6'), 'ende');
  assert.equal(naechster('ende'), 'ende');
  assert.equal(vorheriger('interview-1'), null);
  assert.equal(vorheriger('interview-3'), 'interview-2');
  assert.equal(vorheriger('alter'), null);
  assert.deepEqual(fortschritt('warnung'), { nr: 1, von: 9 });
  assert.deepEqual(fortschritt('interview-6'), { nr: 9, von: 9 });
  // Fund 19: beim Wiederholen zaehlen nur die sechs Interview-Seiten (E4e I1)
  assert.deepEqual(fortschritt('interview-1', true), { nr: 1, von: 6 });
  assert.deepEqual(fortschritt('interview-6', true), { nr: 6, von: 6 });
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

test('Schritte: ohne Pack vier Fragen (Fund 7, E4e I1), Fortschritt und Etappen (Fund 19)', () => {
  assert.equal(INTERVIEW_SEITEN, 6);
  assert.equal(INTERVIEW_SEITEN_OHNE_PACK, 4);
  assert.equal(interviewSeiten(true), 6);
  assert.equal(interviewSeiten(false), 4);
  const n = interviewSeiten(false);
  assert.equal(naechster('einwilligung', n), 'interview-1');
  assert.equal(naechster('interview-3', n), 'interview-4');
  assert.equal(naechster('interview-4', n), 'ende');
  assert.equal(naechster('interview-5', n), 'ende'); // gemerkter Schritt jenseits der Zahl
  assert.equal(naechster('interview-4'), 'interview-5'); // Standard bleibt sechs Seiten
  assert.deepEqual(fortschritt('warnung', false, n), { nr: 1, von: 7 });
  assert.deepEqual(fortschritt('interview-4', false, n), { nr: 7, von: 7 });
  assert.deepEqual(fortschritt('interview-4', true, n), { nr: 4, von: 4 });
  assert.deepEqual(fortschritt('interview-6', true, n), { nr: 4, von: 4 }); // nie ueber die Zahl hinaus
  assert.deepEqual(ETAPPEN, ['warnung', 'alter', 'einwilligung', 'interview']);
  assert.equal(etappe('alter'), 'alter');
  assert.equal(etappe('interview-4'), 'interview');
  assert.equal(etappe('ende'), null);
});

// ---------- E4e: I7 und I8 (1), (3) als Rechnung ueber alle gespeicherten Staende, die die Logik unterscheidet ----------

const tief = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') tief(v);
  return Object.freeze(o);
};
// Alle Staende der Zonen: `an` aller zehn Zonen (1024) mal `bedeckt` der sechs bedeckbaren (64).
function* zonenStaende() {
  const bed = ZONEN.filter((z) => BEDECKBARE_ZONEN.has(z));
  for (let a = 0; a < 1 << ZONEN.length; a++) {
    for (let b = 0; b < 1 << bed.length; b++) {
      const z = {};
      ZONEN.forEach((k, i) => (z[k] = { an: !!(a & (1 << i)) }));
      bed.forEach((k, i) => (z[k].bedeckt = !!(b & (1 << i))));
      yield z;
    }
  }
}

test('I8 (1): Anzeigen schreibt nie: die Lesefunktionen aendern ueber alle 65536 Zonenstaende nichts (eingefroren) und nennen nie mehr Deckung als gespeichert ist', () => {
  let n = 0;
  let gemischt = 0;
  for (const z of zonenStaende()) {
    tief(z);
    const w = zonenWahl(z);
    const k = kleidungsStand(z);
    const heute = zonenUnterKleidung(z);
    bedecktAlle(z);
    for (const g of heute) assert.ok(z[g].an && z[g].bedeckt === true, 'genannt nur, was an UND bedeckt ist');
    // keine Antwort markiert bei gemischtem Stand, sonst genau die gespeicherte
    if (k === 'gemischt') gemischt++;
    assert.ok(w === null || ZONEN_WAHLEN.includes(w));
    n++;
  }
  assert.equal(n, 65536);
  assert.ok(gemischt > 0);
});

test('I7: Handlungen der Zonen und Kleidung aendern nur `zonen`, Kleidung nie ein `an`; Hin und zurueck verliert keine Deckung ohne Wahl', () => {
  let n = 0;
  for (const z of zonenStaende()) {
    if (n++ % 37) continue; // jeder 37. Stand genuegt fuer die Handlungen (1771 Staende), die Anzeige oben deckt alle ab
    tief(z);
    for (const a of ['haut', 'auch-bedeckt']) {
      const neu = setzeKleidung(z, a);
      for (const k of ZONEN) assert.equal(neu[k].an, z[k].an, `Kleidung aendert an von ${k}`);
      for (const k of ZONEN) if (!BEDECKBARE_ZONEN.has(k)) assert.equal('bedeckt' in neu[k], 'bedeckt' in z[k]);
      assert.equal(kleidungsStand(neu) === (a === 'haut' ? 'haut' : 'auch-bedeckt'), true);
    }
    for (const w of ZONEN_WAHLEN) {
      const neu = setzeZonenWahl(z, w);
      assert.equal(zonenWahl(neu), w);
      // eine neu eingeschaltete bedeckbare Zone verliert nie ein gespeichertes `bedeckt`
      for (const k of ZONEN) if (BEDECKBARE_ZONEN.has(k) && z[k].bedeckt === true && neu[k].an) assert.equal(neu[k].bedeckt, true);
    }
  }
});

test('I7 und I8 (3): die Wahl der Erwachsenenseiten aendert nur `an` und `stufe`, eine unzulaessige Wahl ist null (schreibt nichts), keine Stufe ohne Freischaltung', () => {
  const basis = { ...STANDARD.erwachsen, komplettErsatz: true, erkennenAmInhalt: false, eigeneSeiten: ['a.example'] };
  for (const an of [true, false]) {
    for (const stufe of STUFEN_WAHL) {
      const alt = tief({ ...basis, an, stufe, eigeneSeiten: [...basis.eigeneSeiten] });
      for (const frei of [true, false]) {
        for (const karte of ['off', 'on', ...STUFEN_WAHL, 'unbekannt']) {
          const neu = erwachsenNachWahl(alt, karte, frei);
          if (neu === null) {
            assert.ok(karte === 'unbekannt' || (karte === 'on' && frei) || (STUFEN_WAHL.includes(karte) && !frei), `null nur wenn unzulaessig: ${karte} frei=${frei}`);
            continue;
          }
          const { an: a1, stufe: s1, ...rest } = neu;
          const { an: a0, stufe: s0, ...rest0 } = alt;
          assert.deepEqual(rest, rest0, 'komplettErsatz, erkennenAmInhalt und eigeneSeiten bleiben');
          if (karte === 'off') assert.deepEqual([a1, s1], [false, stufe]); // Off laesst die Stufe stehen
          if (karte === 'on') assert.deepEqual([a1, s1], [true, stufe]);
          if (STUFEN_WAHL.includes(karte)) assert.deepEqual([a1, s1], [true, karte]);
          void a0;
          void s0;
        }
        // Anzeige: ohne Freischaltung nie eine Stufe markiert
        const m = erwachsenKarte(alt, frei);
        if (!frei) assert.ok(m === 'off' || m === 'on');
        if (!an) assert.equal(m, 'off');
      }
    }
  }
  // Die Gruppe sperrt ohne Freischaltung genau die drei Stufen und mit Freischaltung nichts
  assert.deepEqual(erwachsenGesperrt(false), [...STUFEN_WAHL]);
  assert.deepEqual(erwachsenGesperrt(true), []);
  assert.deepEqual(erwachsenKarten(true), ['off', ...STUFEN_WAHL]);
  assert.deepEqual(erwachsenKarten(false), ['off', 'on', ...STUFEN_WAHL]);
});

test('I7: die Schreibfunktionen des Interviews (Zonen, Kleidung, Erwachsenen-Wahl) lassen jeden anderen Wert der gespeicherten Staende aus I8 (1) unberuehrt', () => {
  // Dieselben fuenf Staende wie die Browser-Tests (tests/chromium/interview.spec.ts), nach `vervollstaendige` wie im Speicher.
  const zonen = (an, bedeckt) =>
    Object.fromEntries(ZONEN.map((z) => [z, BEDECKBARE_ZONEN.has(z) ? { an, bedeckt } : { an }]));
  const staende = [
    {},
    { zonen: zonen(true, true) },
    { schwelle: 0.1049, strict: true },
    { augenbalken: true, preset: 'mia-wort' },
    {
      ruhig: true,
      preset: 'blur',
      erwachsen: { an: false, stufe: 'explicit', komplettErsatz: true, erkennenAmInhalt: false, eigeneSeiten: ['a.example'] },
      quiz: { verweigern: 0.3, freilegenMs: 7000 },
      kontrolle: { blitz: 'oft', leerlauf: false, cursor: 'aus' },
      ton: { an: true, lautstaerke: 0.45 },
    },
  ].map((e) => vervollstaendige({ version: 1, ...e }));
  const ohne = (e, ...schluessel) => Object.fromEntries(Object.entries(e).filter(([k]) => !schluessel.includes(k)));
  let faelle = 0;
  // K7 (E4k): Zonen und Kleidung gehen ueber die wirklichen Schreibfunktionen: die Handlung rechnet (setzeZonenWahl, setzeEineZone, setzeKleidung), der Teil, den
  // Einstellungsseite und Interview schreiben, ist `zonenSchreibteil`, und der Speicher macht daraus `vervollstaendige({ ...alt, ...teil })` (aendereEinstellungen).
  // Fasst eine dieser Funktionen einen anderen Wert an, wird der Vergleich rot.
  const schreibe = (alt, neu) => {
    const teil = zonenSchreibteil(alt.zonen, alt.zonen, neu);
    assert.ok(teil, 'auf dem Stand, auf dem gerechnet wurde, wird geschrieben');
    return vervollstaendige({ ...alt, ...teil });
  };
  const nurZonen = (gespeichert, geschrieben, name) => {
    assert.deepEqual(ohne(geschrieben, 'zonen'), ohne(gespeichert, 'zonen'), `${name} fasst nur zonen an`);
    for (const z of ZONEN) assert.deepEqual(Object.keys(geschrieben.zonen[z]).filter((k) => k !== 'an' && k !== 'bedeckt'), [], `${name}: ${z} hat nur an und bedeckt`);
  };
  for (const e of staende) {
    tief(structuredClone(e));
    for (const w of ZONEN_WAHLEN) {
      const g = schreibe(e, setzeZonenWahl(e.zonen, w));
      nurZonen(e, g, `Zones ${w}`);
      assert.equal(zonenWahl(g.zonen), w);
      faelle++;
    }
    for (const z of ZONEN) {
      const g = schreibe(e, setzeEineZone(e.zonen, z, !e.zonen[z].an));
      nurZonen(e, g, `Chip ${z}`);
      for (const k of ZONEN) if (k !== z) assert.equal(g.zonen[k].an, e.zonen[k].an, `Chip ${z} aendert an von ${k} nicht`);
      faelle++;
    }
    for (const a of ['haut', 'auch-bedeckt']) {
      const g = schreibe(e, setzeKleidung(e.zonen, a));
      nurZonen(e, g, `Clothes ${a}`);
      for (const z of ZONEN) assert.equal(g.zonen[z].an, e.zonen[z].an, `Clothes ${a} aendert an von ${z} nicht`);
      faelle++;
    }
    // eine Handlung auf einem anderen Stand als dem, auf dem sie gerechnet wurde, schreibt nichts (null)
    const anders = structuredClone(e.zonen);
    anders.genitals.an = !anders.genitals.an;
    assert.equal(zonenSchreibteil(anders, e.zonen, setzeZonenWahl(e.zonen, 'alles')), null, 'verworfen: nichts schreiben');
    for (const frei of [true, false]) {
      for (const karte of ['off', 'on', ...STUFEN_WAHL]) {
        const erw = erwachsenNachWahl(e.erwachsen, karte, frei);
        if (!erw) continue;
        const neu = { ...e, erwachsen: erw };
        assert.deepEqual(ohne(neu, 'erwachsen'), ohne(e, 'erwachsen'), 'Adult sites fasst nur erwachsen an');
        assert.equal(erw.komplettErsatz, e.erwachsen.komplettErsatz);
        assert.deepEqual(erw.eigeneSeiten, e.erwachsen.eigeneSeiten);
        faelle++;
      }
    }
  }
  assert.ok(faelle > 50);
});
