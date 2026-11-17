// Einheitstests ohne Browser fuer Etappe 3 (E3r): die reine Platzlogik der Zonen-Leinwand (E3a, src/schleier/video-platz.ts) und die vereinigte Flaeche
// der Zonen (E3b, neben boxenAnteil in src/schleier/video-zonen.ts). Beide Funktionen gibt es am Stand 9408eaa noch nicht: die Faelle sind dann mit
// `skip` gekennzeichnet (Grund E3a oder E3b), der Lauf bleibt gruen. Der Bauer legt die Funktionen mit genau dieser Schnittstelle an; sobald sie da sind,
// laufen die Faelle von selbst (die Kennzeichnung ist eine Bedingung, kein Eingriff).
//
// Erwartete Schnittstelle der Platzlogik (E3a), reine Funktion ohne Browser und ohne Zeitquelle:
//   export const PLATZ_WECHSEL_MIN_MS = 500;                       // P10: Mindestabstand zwischen zwei Platzwechseln im Dokument
//   export interface PlatzVideo { id: string; berechtigt: boolean; hatFlaechen: boolean }
//   export interface PlatzEingabe { halter: string | null; videos: PlatzVideo[]; seitWechselMs: number }
//   export type PlatzEntscheidung =
//     | { art: 'bleibt' }                      // Halter (oder keiner) behaelt, was er hat
//     | { art: 'wechselt'; zu: string }        // der Platz geht jetzt an `zu` (zuerst Verlierer verdecken, dann Leinwand des Gewinners)
//     | { art: 'wartet'; zu: string }          // Wechsel waere faellig, die Bremse haelt ihn zurueck: der Gewinner bleibt ganz verdeckt
//     | { art: 'gibtAb' };                     // der Halter ist weg (entfernt) und niemand nimmt den Platz: Platz wird frei
//   export function entscheidePlatz(e: PlatzEingabe): PlatzEntscheidung
// Bedeutung der Eingabe:
//   halter        Kennung des Videos mit der Leinwand, null = niemand
//   videos        alle dem Verwalter bekannten Videos in der Reihenfolge ihrer ersten Antwort (aelteste zuerst); `berechtigt` = geeignet (alle Punkte von
//                 pruefeEignung ausser `andere`), spielt (nicht pausiert, nicht zu Ende, Bilddaten da) und ist sichtbar (P12); `hatFlaechen` = es gibt eine
//                 Antwort des Erkenners mit Flaechen. Ein Halter, der in `videos` fehlt, gilt als entfernt (P11).
//   seitWechselMs Zeit seit dem letzten Platzwechsel im Dokument (Millisekunden)
// Regeln: 1 Halter berechtigt: bleibt, egal was die anderen sind und wie lange er schon haelt. 2 Halter nicht berechtigt: der erste Kandidat (berechtigt UND
// hatFlaechen, in der Reihenfolge von `videos`) bekommt den Platz; Mindestabstand 500 ms (P10) nur, wenn es einen Verlierer gibt (der Halter steht noch in
// `videos`): vorher `wartet`. 3 Halter nicht berechtigt, kein Kandidat: bleibt (ist der Halter entfernt: gibtAb). 4 Ohne Halter nimmt der erste Kandidat (berechtigt UND
// hatFlaechen) den Platz, gibt es keinen, das erste Video mit Flaechen, auch pausiert; ohne Wartezeit (es gibt keinen Verlierer). Mit Kandidaten gilt nur, wer berechtigt ist, nie ein pausiertes Video (2).
//
// Erwartete Schnittstelle der vereinigten Flaeche (E3b), in src/schleier/video-zonen.ts neben boxenAnteil:
//   export function boxenAnteilVereinigt(liste: readonly Kanten[], bildB: number, bildH: number): number
// Kanten wie bei boxenAnteil ({ l, t, r, b }). Ergebnis: Flaeche der Vereinigung aller Rechtecke, auf das Bild [0, bildB] mal [0, bildH] zugeschnitten, geteilt
// durch die Bildflaeche. Ungueltiges Bildmass (nicht > 0): 1, wie boxenAnteil. Rechtecke mit r <= l oder b <= t zaehlen nicht.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as zonen from '../../src/schleier/video-zonen.ts';

// R9: das Modul ist gebaut; ein fehlendes oder kaputtes `video-platz.ts` ist ein Fehler (kein stilles Ueberspringen). Uebersprungen bleiben nur die Faelle fuer E3b.
import * as platz from '../../src/schleier/video-platz.ts';

assert.equal(typeof platz.entscheidePlatz, 'function', 'video-platz.ts: entscheidePlatz fehlt');
const E3A = false;
const E3B = typeof zonen.boxenAnteilVereinigt === 'function' ? false : 'E3b: boxenAnteilVereinigt in video-zonen.ts fehlt noch';

const nah = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ist nicht ${b} (+-${eps})`);

// ---------- Platzlogik: Tabelle der Platzregel 1 bis 5 und P10 ----------

const v = (id, berechtigt, hatFlaechen = true) => ({ id, berechtigt, hatFlaechen });
const VIEL = 100000;
// [Name, Eingabe, erwartete Entscheidung]
const PLATZ_FAELLE = [
  // Regel 1: der Halter behaelt den Platz, solange er berechtigt ist, kein Wechsel nach Zeit.
  ['1 Halter berechtigt, anderes berechtigt mit Flaechen: bleibt', { halter: 'a', videos: [v('a', true), v('b', true)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['1 Halter berechtigt, lange Haltezeit und noch ein drittes: bleibt', { halter: 'a', videos: [v('a', true), v('b', true), v('c', true)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['1 Halter berechtigt, Bremse laeuft: bleibt (kein Wechsel, also nichts zu bremsen)', { halter: 'a', videos: [v('a', true), v('b', true)], seitWechselMs: 0 }, { art: 'bleibt' }],
  // Regel 2: nicht mehr berechtigt, ein anderes berechtigt und mit Flaechen: Wechsel.
  ['2 Halter pausiert, anderes spielt mit Flaechen: wechselt', { halter: 'a', videos: [v('a', false), v('b', true)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'b' }],
  ['2 mehrere Kandidaten: der erste in der Reihenfolge der ersten Antwort', { halter: 'a', videos: [v('a', false), v('c', true), v('b', true)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'c' }],
  ['2 Kandidat ohne Flaechen wird uebersprungen', { halter: 'a', videos: [v('a', false), v('c', true, false), v('b', true)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'b' }],
  ['2 pausiertes Video mit Flaechen ist kein Kandidat (nur berechtigte)', { halter: 'a', videos: [v('a', false), v('p', false), v('b', true)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'b' }],
  ['2 Halter steht im Verzeichnis hinten, Kandidat davor: wechselt', { halter: 'z', videos: [v('b', true), v('z', false)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'b' }],
  // Regel 3: kein anderes Video will den Platz: der Halter behaelt ihn (Zonen auf dem Standbild bleiben).
  ['3 Halter pausiert, kein anderes Video: bleibt', { halter: 'a', videos: [v('a', false)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['3 Halter pausiert, anderes spielt ohne Antwort mit Flaechen: bleibt', { halter: 'a', videos: [v('a', false), v('b', true, false)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['3 Halter pausiert, anderes ist auch pausiert (Vorschau mit Flaechen): bleibt', { halter: 'a', videos: [v('a', false), v('b', false)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['3 Halter ausserhalb des Bildes, anderes ebenfalls nicht berechtigt: bleibt', { halter: 'a', videos: [v('a', false), v('b', false, false)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  // Regel 4: ohne Halter nimmt das erste Video mit Flaechen den Platz, auch pausiert, ohne Wartezeit.
  ['4 ohne Halter, ein pausiertes Video mit Flaechen: nimmt', { halter: null, videos: [v('p', false)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'p' }],
  // Entscheidung 265: ohne Halter geht ein berechtigtes Video mit Flaechen vor (sonst naehme die Vorschau den Platz und gaebe ihn 500 ms spaeter wieder ab).
  ['4 ohne Halter, ein berechtigtes Video mit Flaechen geht vor einem frueheren pausierten', { halter: null, videos: [v('x', false, false), v('p', false), v('b', true)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'b' }],
  ['4 ohne Halter, berechtigtes Video ohne Flaechen zaehlt nicht: das pausierte mit Flaechen nimmt', { halter: null, videos: [v('b', true, false), v('p', false)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'p' }],
  ['4 ohne Halter, zwei pausierte mit Flaechen: das erste nimmt', { halter: null, videos: [v('p', false), v('q', false)], seitWechselMs: VIEL }, { art: 'wechselt', zu: 'p' }],
  ['4 ohne Halter, kein Video mit Flaechen: bleibt (nichts zu vergeben)', { halter: null, videos: [v('a', true, false)], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['4 ohne Halter, keine Videos: bleibt', { halter: null, videos: [], seitWechselMs: VIEL }, { art: 'bleibt' }],
  ['4 ohne Halter und gerade gewechselt: nimmt trotzdem sofort (kein Verlierer, der verdeckt werden muesste)', { halter: null, videos: [v('p', false)], seitWechselMs: 0 }, { art: 'wechselt', zu: 'p' }],
  // P11: ein entfernter Halter (fehlt im Verzeichnis) gibt den Platz sofort ab.
  ['P11 Halter entfernt, anderes berechtigt: wechselt sofort, auch bei laufender Bremse', { halter: 'a', videos: [v('b', true)], seitWechselMs: 0 }, { art: 'wechselt', zu: 'b' }],
  ['P11 Halter entfernt, nur ein pausiertes Video mit Flaechen: wechselt nicht, Platz wird frei', { halter: 'a', videos: [v('p', false)], seitWechselMs: VIEL }, { art: 'gibtAb' }],
  ['P11 Halter entfernt, keine anderen Videos: gibt ab', { halter: 'a', videos: [], seitWechselMs: VIEL }, { art: 'gibtAb' }],
  // Regel 5 und P10: Mindestabstand 500 ms zwischen zwei Platzwechseln; wer deshalb warten muss, bleibt ganz verdeckt.
  ['P10 Wechsel faellig, 499 ms seit dem letzten: wartet', { halter: 'a', videos: [v('a', false), v('b', true)], seitWechselMs: 499 }, { art: 'wartet', zu: 'b' }],
  ['P10 Wechsel faellig, genau 500 ms: wechselt', { halter: 'a', videos: [v('a', false), v('b', true)], seitWechselMs: 500 }, { art: 'wechselt', zu: 'b' }],
  ['P10 Wechsel faellig, 0 ms: wartet', { halter: 'a', videos: [v('a', false), v('b', true)], seitWechselMs: 0 }, { art: 'wartet', zu: 'b' }],
  ['P10 wartet nennt den ersten Kandidaten', { halter: 'a', videos: [v('a', false), v('c', true), v('b', true)], seitWechselMs: 100 }, { art: 'wartet', zu: 'c' }],
  ['P10 kein Wechsel faellig: bleibt, auch bei 0 ms', { halter: 'a', videos: [v('a', false), v('b', true, false)], seitWechselMs: 0 }, { art: 'bleibt' }],
];

test('Platzlogik: PLATZ_WECHSEL_MIN_MS ist 500 (P10)', { skip: E3A }, () => {
  assert.equal(platz.PLATZ_WECHSEL_MIN_MS, 500);
});

for (const [name, eingabe, erwartet] of PLATZ_FAELLE) {
  test(`Platzlogik ${name}`, { skip: E3A }, () => {
    const kopie = structuredClone(eingabe);
    assert.deepEqual(platz.entscheidePlatz(eingabe), erwartet);
    assert.deepEqual(eingabe, kopie, 'die Eingabe darf nicht veraendert werden');
  });
}

test('Platzlogik: kein Hin und Her ohne Ereignis (zweimal dieselbe Eingabe, dieselbe Antwort; nach dem Wechsel bleibt der neue Halter)', { skip: E3A }, () => {
  const e = { halter: 'a', videos: [v('a', false), v('b', true)], seitWechselMs: VIEL };
  assert.deepEqual(platz.entscheidePlatz(e), platz.entscheidePlatz(e));
  // Nach dem Wechsel: b haelt, a ist wieder berechtigt (z. B. zurueckgescrollt): b bleibt (Regel 1), kein Wechsel nach Zeit.
  assert.deepEqual(platz.entscheidePlatz({ halter: 'b', videos: [v('a', true), v('b', true)], seitWechselMs: VIEL }), { art: 'bleibt' });
});

test('Platzlogik: Sicherheit, ein Wechsel nennt nie ein Video, das nicht berechtigt und nicht (ohne Halter) mit Flaechen ist', { skip: E3A }, () => {
  // Alle Kombinationen von Halter, zwei weiteren Videos und Bremse: wer `zu` ist, ist ein Kandidat nach den Regeln.
  const bools = [false, true];
  for (const halter of ['a', 'b', null]) {
    for (const [ba, fa, bb, fb, ms] of cartesisch([bools, bools, bools, bools, [0, 499, 500, VIEL]])) {
      const videos = [v('a', ba, fa), v('b', bb, fb)];
      const r = platz.entscheidePlatz({ halter, videos, seitWechselMs: ms });
      if (r.art === 'wechselt' || r.art === 'wartet') {
        const g = videos.find((x) => x.id === r.zu);
        assert.ok(g, `Gewinner ${r.zu} unbekannt`);
        assert.ok(g.hatFlaechen, `Gewinner ohne Flaechen: ${JSON.stringify({ halter, videos, ms, r })}`);
        if (halter !== null) assert.ok(g.berechtigt, `Gewinner nicht berechtigt: ${JSON.stringify({ halter, videos, ms, r })}`);
        assert.notEqual(r.zu, halter, 'der Halter wechselt nicht zu sich selbst');
      }
      // Regel 1 immer: berechtigter Halter bleibt
      const h = videos.find((x) => x.id === halter);
      if (h && h.berechtigt) assert.deepEqual(r, { art: 'bleibt' });
    }
  }
});

function cartesisch(listen) {
  return listen.reduce((a, l) => a.flatMap((x) => l.map((y) => [...x, y])), [[]]);
}


// ---------- P12: Sichtbarkeit mit zwei Schwellen (Viertel und Zehntel), reine Logik in video-platz.ts ----------

const R = (left, top, right, bottom) => ({ left, top, right, bottom });
test('P12 sichtAnteil: Anteil der Videoflaeche im Ausschnitt', { skip: E3A }, () => {
  nah(platz.sichtAnteil(R(0, 0, 100, 100), 800, 600), 1);
  nah(platz.sichtAnteil(R(0, -50, 100, 50), 800, 600), 0.5);
  nah(platz.sichtAnteil(R(-75, 0, 25, 100), 800, 600), 0.25);
  nah(platz.sichtAnteil(R(700, 500, 900, 700), 800, 600), 0.25);
  nah(platz.sichtAnteil(R(0, 600, 100, 700), 800, 600), 0); // genau unterhalb
  nah(platz.sichtAnteil(R(-300, -300, 1100, 900), 800, 600), 800 * 600 / (1400 * 1200));
  nah(platz.sichtAnteil(R(0, 0, 0, 100), 800, 600), 0); // ohne Flaeche
  nah(platz.sichtAnteil(R(0, 0, 100, 100), 0, 600), 0); // ohne Ausschnitt
  nah(platz.sichtAnteil(R(Number.NaN, 0, 100, 100), 800, 600), 0);
});

test('P12 sichtbarMitHysterese: ab einem Viertel sichtbar, erst unter einem Zehntel verloren', { skip: E3A }, () => {
  const f = platz.sichtbarMitHysterese;
  assert.equal(platz.SICHT_AB, 0.25);
  assert.equal(platz.SICHT_BIS, 0.1);
  assert.equal(f(0.24, false), false, 'unter einem Viertel wird ein unsichtbares Video nicht sichtbar');
  assert.equal(f(0.25, false), true, 'genau ein Viertel wird sichtbar');
  assert.equal(f(0.15, true), true, 'zwischen Zehntel und Viertel bleibt ein sichtbares sichtbar');
  assert.equal(f(0.1, true), true, 'genau ein Zehntel verliert noch nicht');
  assert.equal(f(0.099, true), false, 'unter einem Zehntel ist es verloren');
  assert.equal(f(0.15, false), false, 'zwischen den Schwellen wird ein unsichtbares nicht sichtbar');
  assert.equal(f(Number.NaN, true), false);
});

test('P12 Zittern an der Sichtgrenze wechselt nicht: Anteile 0,22 bis 0,28 im Wechsel ergeben nach dem ersten Sichtbarwerden keinen Wechsel mehr', { skip: E3A }, () => {
  let sicht = false;
  const folge = [];
  for (const a of [0.22, 0.26, 0.22, 0.28, 0.2, 0.27, 0.15, 0.3, 0.12]) {
    sicht = platz.sichtbarMitHysterese(a, sicht);
    folge.push(sicht);
  }
  assert.deepEqual(folge, [false, true, true, true, true, true, true, true, true]);
});

// ---------- Vereinigte Flaeche (E3b, Entscheidung 255: Schwelle bleibt 0,6, nur die Rechnung aendert sich) ----------

const K = (l, t, r, b) => ({ l, t, r, b });
// [Name, Rechtecke, Bildbreite, Bildhoehe, erwarteter Anteil]
const FLAECHEN_FAELLE = [
  ['leere Liste: 0', [], 100, 100, 0],
  ['ein Rechteck: Flaeche durch Bildflaeche', [K(0, 0, 50, 100)], 100, 100, 0.5],
  ['zwei getrennte Rechtecke: Summe', [K(0, 0, 10, 10), K(50, 50, 70, 60)], 100, 100, 0.03],
  ['zwei gleiche Rechtecke: nur einmal', [K(10, 10, 60, 60), K(10, 10, 60, 60)], 100, 100, 0.25],
  ['ineinander liegend: nur das aeussere', [K(0, 0, 80, 50), K(10, 10, 20, 20)], 100, 100, 0.4],
  ['ueberlappend: Summe minus Schnitt (50 mal 100 und 50 mal 100, 40 Breite gemeinsam)', [K(0, 0, 50, 100), K(10, 0, 60, 100)], 100, 100, 0.6],
  ['stark ueberlappend: Summe ueber 0,6, Vereinigung darunter (die Szene aus F2)', [K(0, 0, 40, 100), K(2, 0, 42, 100)], 100, 100, 0.42],
  ['Kreuz: Schnitt nur einmal', [K(0, 40, 100, 60), K(40, 0, 60, 100)], 100, 100, 0.2 + 0.2 - 0.04],
  ['drei in Kette (jedes schneidet nur das naechste)', [K(0, 0, 40, 10), K(30, 0, 70, 10), K(60, 0, 100, 10)], 100, 100, 0.1],
  ['aneinanderstossend (Kante an Kante): Summe', [K(0, 0, 50, 100), K(50, 0, 100, 100)], 100, 100, 1],
  ['ueber den Bildrand: nur der Teil im Bild zaehlt', [K(-50, -50, 50, 50)], 100, 100, 0.25],
  ['ueber den Bildrand rechts unten', [K(80, 80, 200, 200)], 100, 100, 0.04],
  ['groesser als das Bild: 1', [K(-10, -10, 500, 500)], 100, 100, 1],
  ['ganz ausserhalb: 0', [K(150, 0, 200, 50), K(-80, -80, -10, -10)], 100, 100, 0],
  ['zwei ueber den Rand, ueberlappend im Bild', [K(-20, 0, 30, 100), K(20, 0, 120, 100)], 100, 100, 1],
  ['ohne Flaeche (r gleich l) und verkehrt (b kleiner t): zaehlen nicht', [K(10, 10, 10, 90), K(50, 50, 40, 10), K(0, 0, 10, 10)], 100, 100, 0.01],
  ['nicht quadratisches Bild', [K(0, 0, 160, 90), K(80, 45, 240, 135)], 320, 180, (160 * 90 + 160 * 90 - 80 * 45) / (320 * 180)],
  ['Bruchteile von Bildpunkten', [K(0.5, 0.5, 10.5, 10.5), K(5.5, 5.5, 15.5, 15.5)], 100, 100, (100 + 100 - 25) / 10000],
];

for (const [name, liste, b, h, erwartet] of FLAECHEN_FAELLE) {
  test(`vereinigte Flaeche: ${name}`, { skip: E3B }, () => {
    nah(zonen.boxenAnteilVereinigt(liste, b, h), erwartet, 1e-9);
  });
}

test('vereinigte Flaeche: ungueltiges Bildmass gibt 1 wie boxenAnteil', { skip: E3B }, () => {
  for (const [b, h] of [[0, 100], [100, 0], [-1, 100], [Number.NaN, 100]]) {
    assert.equal(zonen.boxenAnteilVereinigt([K(0, 0, 1, 1)], b, h), zonen.boxenAnteil([K(0, 0, 1, 1)], b, h));
  }
});

test('vereinigte Flaeche: nie groesser als die Summe, nie kleiner als das groesste einzelne Rechteck, nie ueber 1 (Zufallsfaelle mit festem Anfangswert)', { skip: E3B }, () => {
  let x = 12345;
  const zufall = () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
  for (let n = 0; n < 300; n++) {
    const liste = [];
    const k = 1 + Math.floor(zufall() * 6);
    for (let i = 0; i < k; i++) {
      const l = zufall() * 140 - 20;
      const t = zufall() * 140 - 20;
      liste.push(K(l, t, l + zufall() * 80, t + zufall() * 80));
    }
    const u = zonen.boxenAnteilVereinigt(liste, 100, 100);
    const summe = zonen.boxenAnteil(liste, 100, 100);
    assert.ok(u >= -1e-12 && u <= 1 + 1e-12, `ausserhalb 0 bis 1: ${u}`);
    // Die Summe zaehlt Teile ausserhalb des Bildes mit, die Vereinigung nicht: Vergleich nach Zuschnitt auf das Bild
    const zugeschnitten = liste.map((r) => K(Math.max(0, r.l), Math.max(0, r.t), Math.min(100, r.r), Math.min(100, r.b)));
    const sz = zonen.boxenAnteil(zugeschnitten.filter((r) => r.r > r.l && r.b > r.t), 100, 100);
    assert.ok(u <= sz + 1e-9, `Vereinigung ${u} ueber der Summe ${sz}`);
    assert.ok(u <= summe + 1e-9);
    const groesstes = Math.max(0, ...zugeschnitten.map((r) => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t) / 10000));
    assert.ok(u >= groesstes - 1e-9, `Vereinigung ${u} unter dem groessten Rechteck ${groesstes}`);
  }
});

test('vereinigte Flaeche: die Schwelle 0,6 trennt die Szene aus F2 (Summe ueber, Vereinigung unter der Schwelle) und F3 (beide ueber der Schwelle)', { skip: E3B }, () => {
  const schwelle = 0.6;
  const f2 = [K(0, 0, 40, 100), K(2, 0, 42, 100), K(4, 0, 44, 100)]; // Summe 1,2, Vereinigung 0,44
  assert.ok(zonen.boxenAnteil(f2, 100, 100) > schwelle);
  assert.ok(zonen.boxenAnteilVereinigt(f2, 100, 100) <= schwelle);
  const f3 = [K(0, 0, 50, 100), K(10, 0, 70, 100)]; // Summe 1,1, Vereinigung 0,7
  assert.ok(zonen.boxenAnteilVereinigt(f3, 100, 100) > schwelle);
});

// ---------- R6 und R8: Frische der Antwort, Abstand der Runden ----------
test('R6 antwortFrisch: hoechstens 400 ms alt, eine alte Antwort startet keine Leinwand', () => {
  assert.equal(platz.PLATZ_ANTWORT_MAX_MS, 400);
  assert.equal(platz.antwortFrisch(0), true);
  assert.equal(platz.antwortFrisch(400), true);
  assert.equal(platz.antwortFrisch(401), false);
  assert.equal(platz.antwortFrisch(60_000), false, 'eine Antwort von vor einer Minute (pausierte Vorschau) ist nie frisch');
  assert.equal(platz.antwortFrisch(-1), false);
  assert.equal(platz.antwortFrisch(Number.NaN), false);
});

test('R8 PLATZ_RUNDE_MIN_MS: Scrollen und Groesse stossen hoechstens alle 250 ms eine Runde an', () => {
  assert.equal(platz.PLATZ_RUNDE_MIN_MS, 250);
});

// Gegenprobe der Datei selbst: laeuft der Lauf mit gebauten Funktionen, muss mindestens ein Fall wirklich gerechnet haben (die Tabellen sind nicht leer).
test('Tabellen sind nicht leer', () => {
  assert.ok(PLATZ_FAELLE.length >= 20);
  assert.ok(FLAECHEN_FAELLE.length >= 15);
});
