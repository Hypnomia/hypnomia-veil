// Einheitstests ohne Browser: Optik-Regel O1 und Sicherheits-Pflichtregel S1 fuer `berechneFlaechen` (src/erkenner/zonen.ts).
// Grundlage: Phase 11, Regeln O1 und S1 (Bewertung und Fahrplan, Abschnitt 2), Ursache B4 (Bestand Eigenschaften).
//
// O1: Zwei gleichrangige Flaechen mit sichtbarer Kante schneiden sich nie. Ausgenommen sind aufgelegte Flaechen (Mias Gesicht ueber der
//     Kopfflaeche, Augenbalken, Sticker auf ihrer Flaeche): diese Schichtung ist im Code Absicht (zonen.ts, `gesichtTausch` und Augenbalken)
//     und bleibt. Aufgelegt sind hier die Behandlungen `mia-gesicht` und `balken`; alle anderen Flaechen sind gleichrangig.
// S1: Jede Ausgangsbox samt Rand liegt vollstaendig in der Vereinigung der Ausgabeflaechen, jede Ausgabeflaeche traegt eine deckende
//     Behandlung. Heute gruen, bleibt als Waechter gruen. Die Gegenprobe (zu kleine Huelle) zeigt, dass der Pruefer den Fehler faengt.
//
// Seit Phase 11 Etappe 1 (src/erkenner/verschmelzen.ts) sind alle Faelle gruen; die Kennzeichnung `todo` ist entfallen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESETS } from '../../src/presets.ts';
import { aktiveZonenBoxen, berechneFlaechen as berechneFlaechenRoh, mitRand } from '../../src/erkenner/zonen.ts';

// Der Bild-Weg verschmilzt (5. Parameter true); ohne ihn liefert die Funktion die Flaechen wie vor Etappe 1 (Video-Wege, Abschnitt unten).
const berechneFlaechen = (tr, e, b, h) => berechneFlaechenRoh(tr, e, b, h, true);

const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];

function zonen(an, bedeckt = []) {
  const z = {};
  for (const name of ALLE) {
    z[name] = BEDECKBAR.includes(name) ? { an: an.includes(name), bedeckt: bedeckt.includes(name) } : { an: an.includes(name) };
  }
  return z;
}
const treffer = (zone, box, bedeckt = false, score = 0.9) => ({ zone, bedeckt, score, box });

// Presets mit Zonen-Flaechen, deren Ergebnis allein aus `berechneFlaechen` kommt (ohne Pack, ohne Person, ohne reinen Augenbalken).
const ZONEN_PRESETS = Object.values(PRESETS)
  .filter((d) => !d.person && d.augen !== 'nur-balken')
  .map((d) => d.id);
// Behandlungen, die auf einer anderen Flaeche liegen sollen (aufgelegt, O1 nimmt sie aus).
const AUFGELEGT = new Set(['mia-gesicht', 'balken']);
// Deckende Behandlungen (Sicherheitsbegriff): jede, die den Inhalt unkenntlich macht.
const DECKEND = new Set(['mosaik', 'mosaik-wort', 'blur', 'schwarz', 'schwarz-wort', 'sticker', 'balken', 'mia-gesicht']);

// ---------- Hilfen ----------

// Schnittflaeche zweier Boxen [x, y, b, h]; blosses Beruehren (gemeinsame Kante) zaehlt nicht als Schnitt.
function schnitt(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x2 <= x1 || y2 <= y1 ? 0 : (x2 - x1) * (y2 - y1);
}

// Alle Paare gleichrangiger Flaechen, die sich schneiden (leer = O1 erfuellt).
function schneidendePaare(flaechen) {
  const gleichrangig = flaechen.filter((f) => !AUFGELEGT.has(f.behandlung));
  const paare = [];
  for (let i = 0; i < gleichrangig.length; i++) {
    for (let j = i + 1; j < gleichrangig.length; j++) {
      const s = schnitt(gleichrangig[i].box, gleichrangig[j].box);
      if (s > 0) paare.push({ a: gleichrangig[i], b: gleichrangig[j], flaeche: s });
    }
  }
  return paare;
}

function pruefeO1(flaechen, name) {
  const paare = schneidendePaare(flaechen);
  assert.equal(
    paare.length,
    0,
    `${name}: O1 verletzt, ${paare.length} sich schneidende Paare gleichrangiger Flaechen: ${paare
      .map((p) => `${p.a.zone}/${p.a.behandlung} ${JSON.stringify(p.a.box)} mit ${p.b.zone}/${p.b.behandlung} ${JSON.stringify(p.b.box)} (Schnitt ${p.flaeche} px)`)
      .join('; ')}`,
  );
}

// Teile der Ausgangsboxen, die in keiner Ausgabeflaeche liegen (Koordinatenraster: jede Zelle innerhalb einer Ausgangsbox muss in einer
// Ausgabeflaeche liegen). Leer = die Vereinigung der Ausgabe ist eine Obermenge der Ausgangsboxen (S1).
function ungedeckt(ausgangsboxen, ausgabe) {
  const xs = new Set();
  const ys = new Set();
  for (const b of [...ausgangsboxen, ...ausgabe]) {
    xs.add(b[0]);
    xs.add(b[0] + b[2]);
    ys.add(b[1]);
    ys.add(b[1] + b[3]);
  }
  const sx = [...xs].sort((p, q) => p - q);
  const sy = [...ys].sort((p, q) => p - q);
  const luecken = [];
  for (let i = 0; i < sx.length - 1; i++) {
    for (let j = 0; j < sy.length - 1; j++) {
      const mx = (sx[i] + sx[i + 1]) / 2;
      const my = (sy[j] + sy[j + 1]) / 2;
      const inEingabe = ausgangsboxen.some((b) => mx > b[0] && mx < b[0] + b[2] && my > b[1] && my < b[1] + b[3]);
      if (!inEingabe) continue;
      const inAusgabe = ausgabe.some((b) => mx > b[0] && mx < b[0] + b[2] && my > b[1] && my < b[1] + b[3]);
      if (!inAusgabe) luecken.push([sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j]]);
    }
  }
  return luecken;
}

// Ausgangsboxen samt Rand, wie sie vor dem Verschmelzen vorliegen (gleiche Eingabe in `berechneFlaechen`, ohne zusammenzufuehren).
function ausgangsboxen(tr, einst, breite, hoehe) {
  return mitRand(aktiveZonenBoxen(tr, einst.zonen, breite, hoehe), einst.rand, breite, hoehe).map((f) => f.box);
}

// S1: Obermenge und deckende Behandlung. Gibt die Luecken zurueck, wirft nichts (die Gegenprobe braucht den Rueckgabewert).
function s1Luecken(tr, einst, breite, hoehe, flaechen = berechneFlaechen(tr, einst, breite, hoehe)) {
  return ungedeckt(ausgangsboxen(tr, einst, breite, hoehe), flaechen.map((f) => f.box));
}
function pruefeS1(tr, einst, breite, hoehe, name) {
  const flaechen = berechneFlaechen(tr, einst, breite, hoehe);
  const luecken = s1Luecken(tr, einst, breite, hoehe, flaechen);
  assert.deepEqual(luecken, [], `${name}: S1 verletzt, Teile der Ausgangsboxen liegen in keiner Ausgabeflaeche: ${JSON.stringify(luecken)}`);
  for (const f of flaechen) {
    assert.ok(DECKEND.has(f.behandlung), `${name}: S1 verletzt, Flaeche ${f.zone} ${JSON.stringify(f.box)} ohne deckende Behandlung (${String(f.behandlung)})`);
  }
}

// Gegenprobe: eine absichtlich zu kleine Huelle. Jede Ausgabeflaeche wird um `anteil` je Seite eingezogen (die verdeckte Menge schrumpft).
function zuKleineHuelle(flaechen, anteil = 0.1) {
  return flaechen.map((f) => {
    const dx = f.box[2] * anteil;
    const dy = f.box[3] * anteil;
    return { ...f, box: [f.box[0] + dx, f.box[1] + dy, f.box[2] - 2 * dx, f.box[3] - 2 * dy] };
  });
}

// ---------- Fallbeispiele ----------

const B = 600;
const H = 600;

// Brust und Genital auf einem Oberkoerper.
const BRUST_GENITAL = {
  treffer: [treffer('breast', [100, 100, 200, 120]), treffer('genitals', [130, 180, 150, 150])],
  zonen: zonen(['breast', 'genitals']),
};
// Kette aus drei Boxen: A schneidet B, B schneidet C, A schneidet C nicht (nach dem Rand von 15 %: A bis x 165, B von 135 bis 265, C ab 240).
const KETTE = {
  treffer: [treffer('breast', [50, 50, 100, 100]), treffer('genitals', [150, 60, 100, 100]), treffer('belly', [255, 70, 100, 100])],
  zonen: zonen(['breast', 'genitals', 'belly']),
};
// Huelle, die erst durch das Verschmelzen eine vierte Flaeche schneidet: A (waagerecht) und B (senkrecht) schneiden sich in der Ecke, ihre
// Huelle [20, 20, 200, 200] schneidet D, obwohl D weder A noch B beruehrt. Rand 0, damit die Zahlen klar bleiben.
const HUELLE_VIERTE = {
  treffer: [treffer('breast', [20, 20, 200, 40]), treffer('genitals', [20, 20, 40, 200]), treffer('belly', [120, 120, 60, 60])],
  zonen: zonen(['breast', 'genitals', 'belly']),
  rand: 0,
};
// Getrennte Flaechen: weit auseinander, auch mit Rand ohne Beruehrung.
const GETRENNT = {
  treffer: [treffer('breast', [20, 20, 80, 80]), treffer('genitals', [400, 400, 80, 80])],
  zonen: zonen(['breast', 'genitals']),
};
// Gesicht (320n-Treffer liefert Gesicht, Kopf, Augen, Mund) mit Brust und Bauch darunter: Kopf, Brust und Bauch schneiden sich.
const GESICHT_KOERPER = {
  treffer: [treffer('face', [200, 100, 100, 100]), treffer('breast', [210, 190, 80, 60]), treffer('belly', [200, 170, 100, 100])],
  zonen: zonen(['face', 'head', 'eyes', 'mouth', 'breast', 'belly']),
};

const einst = (fall, preset) => ({ zonen: fall.zonen, rand: fall.rand ?? 0.15, preset });

// ---------- O1 ----------

test('O1: Brust und Genital auf einem Oberkoerper werden eine Flaeche (kein Schnitt, in allen Zonen-Presets)', () => {
  for (const preset of ZONEN_PRESETS) {
    pruefeO1(berechneFlaechen(BRUST_GENITAL.treffer, einst(BRUST_GENITAL, preset), B, H), `Brust und Genital, ${preset}`);
  }
});

test('O1: Kette aus drei Boxen (A mit B, B mit C, A nicht mit C) ergibt keine sich schneidenden Flaechen', () => {
  // Voraussetzung der Kette: mit Rand schneiden A und B, B und C, aber A und C nicht.
  const [a, b, c] = ausgangsboxen(KETTE.treffer, einst(KETTE, 'mosaik'), B, H);
  assert.ok(schnitt(a, b) > 0 && schnitt(b, c) > 0 && schnitt(a, c) === 0, 'Kette: Voraussetzung der Eingabe (A mit B, B mit C, A nicht mit C)');
  for (const preset of ZONEN_PRESETS) {
    pruefeO1(berechneFlaechen(KETTE.treffer, einst(KETTE, preset), B, H), `Kette, ${preset}`);
  }
});

test('O1: eine Huelle, die erst durch das Verschmelzen eine vierte Flaeche schneidet (wiederholen bis stabil)', () => {
  const [a, b, d] = ausgangsboxen(HUELLE_VIERTE.treffer, einst(HUELLE_VIERTE, 'mosaik'), B, H);
  assert.ok(schnitt(a, b) > 0 && schnitt(a, d) === 0 && schnitt(b, d) === 0, 'Huelle: Voraussetzung der Eingabe (A mit B, D weder mit A noch mit B)');
  for (const preset of ZONEN_PRESETS) {
    const f = berechneFlaechen(HUELLE_VIERTE.treffer, einst(HUELLE_VIERTE, preset), B, H);
    pruefeO1(f, `Huelle, ${preset}`);
    // Das Ergebnis liegt in der Huelle: D ist ueberdeckt (eine Flaeche oder mehrere ohne Schnitt, die D vollstaendig decken).
    assert.deepEqual(ungedeckt([d], f.map((x) => x.box)), [], `Huelle, ${preset}: D muss in der verschmolzenen Flaeche liegen`);
  }
});

test('O1: Kopf, Brust und Bauch eines Gesichts mit Koerper schneiden sich nicht', () => {
  for (const preset of ZONEN_PRESETS) {
    pruefeO1(berechneFlaechen(GESICHT_KOERPER.treffer, einst(GESICHT_KOERPER, preset), B, H), `Gesicht mit Koerper, ${preset}`);
  }
});

test('O1: getrennte Flaechen bleiben getrennt (Waechter gegen zu viel Verschmelzen)', () => {
  for (const preset of ZONEN_PRESETS) {
    const f = berechneFlaechen(GETRENNT.treffer, einst(GETRENNT, preset), B, H);
    assert.equal(f.length, 2, `${preset}: zwei getrennte Flaechen bleiben zwei`);
    pruefeO1(f, `getrennt, ${preset}`);
    assert.equal(schnitt(f[0].box, f[1].box), 0, `${preset}: kein Schnitt`);
  }
});

test('O1: Mias Gesicht liegt ueber der Kopfflaeche (aufgelegt, bleibt geschichtet), der Kopf selbst steht allein', () => {
  const tr = [treffer('face', [200, 100, 100, 100])];
  const z = zonen(['face', 'head', 'eyes', 'mouth']);
  const f = berechneFlaechen(tr, { zonen: z, rand: 0.15, preset: 'mia-wort' }, B, H);
  const kopf = f.filter((x) => x.zone === 'head');
  const gesicht = f.filter((x) => x.behandlung === 'mia-gesicht');
  assert.equal(kopf.length, 1, 'eine Kopfflaeche');
  assert.equal(gesicht.length, 1, 'ein Mias Gesicht');
  assert.ok(schnitt(kopf[0].box, gesicht[0].box) > 0, 'Mias Gesicht liegt auf der Kopfflaeche (Schichtung bleibt)');
  assert.equal(ungedeckt([gesicht[0].box], [kopf[0].box]).length, 0, 'Mias Gesicht liegt ganz in der Kopfflaeche');
  pruefeO1(f, 'Mias Gesicht ueber Kopf');
});

test('O1: Augenbalken liegen ueber der Gesichts- oder Kopfflaeche (aufgelegt, bleiben geschichtet)', () => {
  const tr = [treffer('face', [200, 100, 100, 100])];
  const z = zonen(['face', 'head', 'eyes', 'mouth']);
  const f = berechneFlaechen(tr, { zonen: z, rand: 0.15, preset: 'zensurbalken' }, B, H);
  const balken = f.filter((x) => x.behandlung === 'balken');
  const grund = f.filter((x) => x.behandlung !== 'balken');
  assert.equal(balken.length, 1, 'ein Augenbalken');
  assert.ok(grund.length >= 1, 'eine Flaeche darunter (Kopf)');
  assert.ok(grund.some((g) => schnitt(g.box, balken[0].box) > 0), 'der Augenbalken liegt auf einer Flaeche (Schichtung bleibt)');
  pruefeO1(f, 'Augenbalken ueber Kopf');
});

test('O1: ganze Person (person-mosaik, person-blur): Brust und Genital werden eine Huelle, keine sich schneidenden Flaechen', () => {
  for (const preset of ['person-mosaik', 'person-blur']) {
    const f = berechneFlaechen(BRUST_GENITAL.treffer, einst(BRUST_GENITAL, preset), B, H);
    assert.ok(f.length >= 1, `${preset}: mindestens eine Flaeche`);
    pruefeO1(f, `Person, ${preset}`);
  }
});

// ---------- S1 ----------

const S1_FAELLE = [
  ['Brust und Genital', BRUST_GENITAL],
  ['Kette aus drei Boxen', KETTE],
  ['Huelle und vierte Flaeche', HUELLE_VIERTE],
  ['getrennte Flaechen', GETRENNT],
  ['Gesicht mit Koerper (Kopf verschluckt Gesicht, Augen und Mund)', GESICHT_KOERPER],
];
// Presets ohne Tausch des Gesichts: dort ist jede Ausgangsbox eine Zone, die der Zeichner deckt (Mias Gesicht und Augenbalken ersetzen Augen
// und Mund eigens, ihre Deckung prueft `presets.test.mjs`).
const S1_PRESETS = ['mosaik', 'mosaik-wort', 'blur', 'sticker'];

test('S1 (Waechter, heute gruen): jede Ausgangsbox samt Rand liegt ganz in der Vereinigung der Ausgabeflaechen, jede Flaeche deckt', () => {
  for (const [name, fall] of S1_FAELLE) {
    for (const preset of S1_PRESETS) {
      pruefeS1(fall.treffer, einst(fall, preset), B, H, `${name}, ${preset}`);
    }
  }
});

test('S1 (Waechter): auch die klassischen Presets mit allen Zonen und bedeckten Treffern, mit Rand 0 und mit Rand 0,3', () => {
  const alle = [
    treffer('face', [200, 60, 90, 90]),
    treffer('breast', [190, 170, 120, 90], true),
    treffer('belly', [200, 240, 100, 70]),
    treffer('genitals', [205, 300, 90, 80], true),
    treffer('feet', [150, 480, 80, 60]),
    treffer('armpits', [140, 160, 40, 40]),
  ];
  const z = zonen(['face', 'head', 'eyes', 'mouth', ...BEDECKBAR], BEDECKBAR);
  for (const rand of [0, 0.15, 0.3]) {
    for (const preset of S1_PRESETS) {
      pruefeS1(alle, { zonen: z, rand, preset }, B, H, `alle Zonen, Rand ${rand}, ${preset}`);
    }
  }
});

test('S1 Gegenprobe: der Pruefer faengt eine absichtlich zu kleine Huelle (und besteht die echte Ausgabe)', () => {
  for (const [name, fall] of S1_FAELLE) {
    const e = einst(fall, 'mosaik');
    const echt = berechneFlaechen(fall.treffer, e, B, H);
    assert.deepEqual(s1Luecken(fall.treffer, e, B, H, echt), [], `${name}: die echte Ausgabe besteht`);
    const kleiner = zuKleineHuelle(echt);
    assert.ok(s1Luecken(fall.treffer, e, B, H, kleiner).length > 0, `${name}: eine zu kleine Huelle muss als Luecke erkannt werden`);
  }
  // Eine Huelle, die eine Ausgangsbox gar nicht enthaelt (zwei Boxen verschmolzen, eine herausgefallen), wird ebenfalls erkannt.
  // (Brust und Genital sind seit Etappe 1 eine Huelle; die fehlende Flaeche zeigt der getrennte Fall mit zwei Flaechen.)
  const e = einst(GETRENNT, 'mosaik');
  const echt = berechneFlaechen(GETRENNT.treffer, e, B, H);
  assert.equal(echt.length, 2);
  assert.ok(s1Luecken(GETRENNT.treffer, e, B, H, echt.slice(0, 1)).length > 0, 'fehlende Flaeche wird erkannt');
});

test('S1: die Behandlung ist deckend, auch wenn das Gesicht getauscht wird (mia-wort, mia-sticker) und beim Augenbalken (zensurbalken)', () => {
  const tr = [treffer('face', [200, 100, 100, 100]), treffer('breast', [210, 190, 80, 60])];
  const z = zonen(['face', 'head', 'eyes', 'mouth', 'breast']);
  for (const preset of ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'zensurbalken']) {
    const f = berechneFlaechen(tr, { zonen: z, rand: 0.15, preset }, B, H);
    assert.ok(f.length >= 2, `${preset}: Flaechen vorhanden`);
    for (const x of f) assert.ok(DECKEND.has(x.behandlung), `${preset}: ${x.zone} traegt eine deckende Behandlung (${String(x.behandlung)})`);
  }
});

// ---------- Feste Rohtreffer echter Testbilder (jugendfrei; nur Zahlen, Messung 0c, 320n Schwelle 0,10) ----------
// Je Bild: zwei oder drei Brust-Boxen derselben Zone, die `fuehreZusammen` wegen kleiner Ueberdeckung nicht vereinigt und die sich nach dem
// Rand schneiden (haeufigstes Paar der Messung). Erwartung: O1 und S1 in allen Zonen-Presets, die Huelle liegt in der Vereinigung.
const ECHT = [
  ['sfw-009-portraet', 1231, 1600, [[516, 1109, 367, 384], [118, 1214, 402, 385]]],
  ['sfw-015-figur', 1280, 853, [[695, 339, 140, 123], [582, 347, 124, 111]]],
  ['sfw-022-figur', 1068, 1600, [[465, 255, 184, 230], [348, 234, 203, 250], [635, 264, 222, 242]]],
];
test('O1 und S1 an festen Rohtreffern dreier Testbilder (Brust mit Brust, dieselbe Zone): eine Huelle je Bild, nichts verloren', () => {
  for (const [name, b, h, boxen] of ECHT) {
    const tr = boxen.map((x) => treffer('breast', x, true, 0.3));
    const fall = { treffer: tr, zonen: zonen(['breast'], ['breast']) };
    for (const preset of ZONEN_PRESETS) {
      const e = einst(fall, preset);
      const f = berechneFlaechen(tr, e, b, h);
      pruefeO1(f, `${name}, ${preset}`);
      assert.equal(f.length, 1, `${name}, ${preset}: eine Huelle`);
    }
    for (const preset of S1_PRESETS) pruefeS1(tr, einst(fall, preset), b, h, `${name}, ${preset}`);
  }
});

// ---------- Huellen, Rangfolge, wortBox ----------
import { huellenGruppen, groesstesFreiesRechteck, setzeWortBoxen, verschmelze } from '../../src/erkenner/verschmelzen.ts';
import { staerksteBehandlung } from '../../src/presets.ts';

test('huellenGruppen: Schnitt groesser null, transitiv, wiederholt bis stabil, Beruehren zaehlt nicht', () => {
  assert.deepEqual(huellenGruppen([[0, 0, 10, 10], [10, 0, 10, 10]]), [[0], [1]], 'gemeinsame Kante ist kein Schnitt');
  assert.deepEqual(huellenGruppen([[0, 0, 10, 10], [5, 5, 10, 10], [12, 12, 10, 10]]), [[0, 1, 2]], 'Kette');
  assert.deepEqual(huellenGruppen([[20, 20, 200, 40], [20, 20, 40, 200], [120, 120, 60, 60]]), [[0, 1, 2]], 'Huelle schneidet die dritte');
  assert.deepEqual(huellenGruppen([[0, 0, 10, 10], [100, 100, 10, 10]]), [[0], [1]]);
  assert.deepEqual(huellenGruppen([]), []);
});

test('staerksteBehandlung: Schwarz vor Sticker vor Mosaik vor Blur, Wort bleibt, wenn eine staerkste Flaeche eines traegt', () => {
  assert.equal(staerksteBehandlung(['blur', 'mosaik'], 'mosaik'), 'mosaik');
  assert.equal(staerksteBehandlung(['mosaik-wort', 'sticker'], 'mosaik'), 'sticker');
  assert.equal(staerksteBehandlung(['sticker', 'schwarz'], 'mosaik'), 'schwarz');
  assert.equal(staerksteBehandlung(['schwarz', 'schwarz-wort'], 'mosaik'), 'schwarz-wort');
  assert.equal(staerksteBehandlung(['mosaik', 'mosaik-wort', 'blur'], 'mosaik'), 'mosaik-wort');
  assert.equal(staerksteBehandlung(['schwarz', 'mosaik-wort'], 'mosaik'), 'schwarz', 'das Wort der schwaecheren Flaeche zaehlt nicht');
  assert.equal(staerksteBehandlung([undefined, 'blur'], 'mosaik'), 'mosaik', 'fehlende Behandlung gilt als Standard, nie uebergangen');
  assert.equal(staerksteBehandlung([undefined, 'blur'], 'schwarz'), 'schwarz');
});

test('verschmelze: Huelle enthaelt alle Boxen, staerkste Behandlung, Zone der groessten Flaeche', () => {
  const f = verschmelze([
    { zone: 'breast', box: [0, 0, 10, 10], behandlung: 'blur' },
    { zone: 'belly', box: [5, 5, 40, 40], behandlung: 'schwarz-wort' },
    { zone: 'feet', box: [300, 300, 10, 10], behandlung: 'blur' },
  ], 'mosaik');
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].box, [0, 0, 45, 45]);
  assert.equal(f[0].behandlung, 'schwarz-wort');
  assert.equal(f[0].zone, 'belly');
  assert.deepEqual(f[1].box, [300, 300, 10, 10]);
});

test('wortBox: groesstes freies Rechteck neben einer aufgelegten Flaeche; ohne Aufgelegtes keine Aenderung; zu klein ergibt null oder ein kleines Rechteck', () => {
  assert.deepEqual(groesstesFreiesRechteck([0, 0, 100, 100], []), [0, 0, 100, 100]);
  assert.deepEqual(groesstesFreiesRechteck([0, 0, 100, 100], [[200, 200, 5, 5]]), [0, 0, 100, 100]);
  // aufgelegte Flaeche mitten in der Huelle: das groesste freie Rechteck ist ein Streifen am Rand
  const mitte = groesstesFreiesRechteck([0, 0, 100, 100], [[40, 40, 20, 20]]);
  assert.equal(mitte[2] * mitte[3], 100 * 40);
  assert.equal(schnitt(mitte, [40, 40, 20, 20]), 0);
  // aufgelegte Flaeche links oben: rechts daneben oder darunter, nie darunter geschnitten
  const ecke = groesstesFreiesRechteck([0, 0, 100, 60], [[0, 0, 70, 60]]);
  assert.deepEqual(ecke, [70, 0, 30, 60]);
  // alles bedeckt
  assert.equal(groesstesFreiesRechteck([0, 0, 50, 50], [[-5, -5, 100, 100]]), null);
  // setzeWortBoxen: nur Flaechen mit aufgelegter Flaeche bekommen das Feld
  const [a, b] = setzeWortBoxen([{ zone: 'head', box: [0, 0, 100, 100], behandlung: 'schwarz-wort' }, { zone: 'feet', box: [300, 300, 50, 50], behandlung: 'schwarz-wort' }], [[40, 40, 20, 20]]);
  assert.ok(Array.isArray(a.wortBox) && schnitt(a.wortBox, [40, 40, 20, 20]) === 0);
  assert.equal('wortBox' in b, false);
});

test('wortBox im Ergebnis: Mias Gesicht auf der Kopfflaeche, das Wort steht nie unter dem Gesicht; Gesicht und Kopf bleiben geschichtet', () => {
  const tr = [treffer('face', [200, 100, 100, 100])];
  const f = berechneFlaechen(tr, { zonen: zonen(['face', 'head', 'eyes', 'mouth']), rand: 0.15, preset: 'mia-wort' }, B, H);
  const kopf = f.find((x) => x.zone === 'head');
  const gesicht = f.find((x) => x.behandlung === 'mia-gesicht');
  assert.ok(Array.isArray(kopf.wortBox), 'Kopf hat eine wortBox');
  assert.equal(schnitt(kopf.wortBox, gesicht.box), 0);
  assert.equal(ungedeckt([kopf.wortBox], [kopf.box]).length, 0, 'wortBox liegt in der Flaeche');
});

// ---------- Nachbesserung nach Pruefung: S1 gegen die Ausgabe von vorher, Bildrand, Mia, Zensurbalken, Person, Ersatz ----------
import { behandlungsRang } from '../../src/presets.ts';
import { yunetTreffer } from '../../src/erkenner/zonen.ts';

test('S1 gegen die Ausgabe vor dem Verschmelzen (Schalter aus), in allen Zonen-Presets mit Mias Gesicht und Zensurbalken, auch am Bildrand', () => {
  const gesicht = { box: [0, 40, 90, 110], score: 0.9, punkte: [[20, 80], [70, 80], [45, 100], [25, 125], [65, 125]] };
  const tr = [
    ...yunetTreffer(gesicht, B, H),
    treffer('breast', [0, 150, 160, 90], true),
    treffer('belly', [60, 200, 140, 120]),
    treffer('breast', [520, 500, 80, 100]),
    treffer('genitals', [540, 560, 60, 40]),
  ];
  const z = zonen(['face', 'head', 'eyes', 'mouth', 'breast', 'belly', 'genitals'], ['breast']);
  for (const preset of ZONEN_PRESETS) {
    const e = { zonen: z, rand: 0.15, preset };
    const vorher = berechneFlaechenRoh(tr, e, B, H, false);
    const nachher = berechneFlaechenRoh(tr, e, B, H, true);
    // Obermenge: jede Ausgangsflaeche liegt ganz in der Vereinigung der neuen; aufgelegte bleiben gleich
    assert.deepEqual(ungedeckt(vorher.map((f) => f.box), nachher.map((f) => f.box)), [], `${preset}: nachher deckt mindestens, was vorher gedeckt war`);
    for (const f of nachher) assert.ok(DECKEND.has(f.behandlung), `${preset}: deckende Behandlung`);
    assert.deepEqual(vorher.filter((f) => AUFGELEGT.has(f.behandlung)), nachher.filter((f) => AUFGELEGT.has(f.behandlung)), `${preset}: Aufgelegtes unveraendert`);
    // jede Ausgangsflaeche liegt in einer Huelle gleicher oder schwaecherer Behandlung (die Huelle ist nie schwaecher)
    for (const v of vorher.filter((f) => !AUFGELEGT.has(f.behandlung))) {
      const huelle = nachher.find((n) => !AUFGELEGT.has(n.behandlung) && n.box[0] <= v.box[0] && n.box[1] <= v.box[1] && n.box[0] + n.box[2] >= v.box[0] + v.box[2] && n.box[1] + n.box[3] >= v.box[1] + v.box[3]);
      assert.ok(huelle, `${preset}: ${v.zone} liegt ganz in einer Huelle`);
      assert.ok(behandlungsRang(huelle.behandlung) >= behandlungsRang(v.behandlung), `${preset}: Behandlung der Huelle nie schwaecher`);
    }
  }
});

test('N3: ganze Person, zwei Personen-Gruppen, deren Huellen erst durch den Rand ueberlappen, werden eine Huelle (Schalter an), sonst zwei', () => {
  const boxen = [[372, 85, 51, 49], [375, 167, 83, 78], [457, 109, 11, 121]];
  const tr = boxen.map((b) => treffer('breast', b));
  const e = { zonen: zonen(['breast']), rand: 0, preset: 'person-mosaik' };
  const aus = berechneFlaechenRoh(tr, e, B, H, false);
  const an = berechneFlaechenRoh(tr, e, B, H, true);
  assert.equal(aus.length, 2);
  assert.ok(schnitt(aus[0].box, aus[1].box) > 0, 'Voraussetzung: die Huellen schneiden sich');
  assert.equal(an.length, 1);
  assert.deepEqual(ungedeckt(aus.map((f) => f.box), an.map((f) => f.box)), []);
});

test('N1: die Huelle behaelt `ersatz`, und eine Flaeche ohne Behandlung gilt als Standard', () => {
  const [h] = verschmelze([
    { zone: 'breast', box: [0, 0, 50, 50], behandlung: 'sticker', ersatz: 'mosaik' },
    { zone: 'belly', box: [20, 20, 50, 50], behandlung: 'blur' },
  ], 'mosaik');
  assert.equal(h.behandlung, 'sticker');
  assert.equal(h.ersatz, 'mosaik');
  const [g] = verschmelze([{ zone: 'breast', box: [0, 0, 50, 50] }, { zone: 'belly', box: [20, 20, 50, 50], behandlung: 'blur' }], 'schwarz');
  assert.equal(g.behandlung, 'schwarz', 'fehlende Behandlung zaehlt als Standard, nicht als nichts');
  // Aufgelegte werden nie verschmolzen
  const r = verschmelze([{ zone: 'face', box: [0, 0, 50, 50], behandlung: 'mia-gesicht', ersatz: 'mosaik' }, { zone: 'head', box: [10, 10, 80, 80], behandlung: 'mosaik' }], 'mosaik');
  assert.equal(r.length, 2);
  assert.equal(r[1].behandlung, 'mia-gesicht');
});

test('wortBox: das Rechteck mit der groessten erreichbaren Schriftgroesse, nicht die groesste Flaeche', () => {
  // Hindernis in der Mitte unten: ein hoher schmaler Streifen links hat mehr Flaeche (40 x 200 = 8000), ein breiter flacher oben mehr Schrift
  const frei = groesstesFreiesRechteck([0, 0, 200, 200], [[40, 60, 160, 140]]);
  assert.deepEqual(frei, [0, 0, 200, 60]); // 0,8*200/4 = 40 gegen 0,5*60 = 30: Breite zaehlt, Schrift 30; links: min(0,8*40/4=8, 100) = 8
});

// ---------- O2: zweites Wort durch ein Ersatz-Gesicht (Pruefer-Fund N5) ----------
import { ersatzMitMarke } from '../../src/presets.ts';

test('ersatzMitMarke: ein Ersatz-Gesicht, das eine markierte Flaeche schneidet, verliert Wort bzw. Sticker; allein behaelt es sie', () => {
  const gesicht = [100, 100, 80, 80];
  const frei = [300, 300, 50, 50];
  const markiert = [[50, 50, 120, 120]];
  assert.deepEqual(ersatzMitMarke('schwarz-wort', gesicht, markiert), { behandlung: 'schwarz', ohneSticker: false });
  assert.deepEqual(ersatzMitMarke('mosaik-wort', gesicht, markiert), { behandlung: 'mosaik', ohneSticker: false });
  assert.deepEqual(ersatzMitMarke('sticker', gesicht, markiert), { behandlung: 'sticker', ohneSticker: true }, 'Flaeche bleibt, nur der Sticker entfaellt');
  assert.deepEqual(ersatzMitMarke('schwarz-wort', gesicht, [frei]), { behandlung: 'schwarz-wort', ohneSticker: false }, 'allein: Wort bleibt');
  assert.deepEqual(ersatzMitMarke('schwarz-wort', gesicht, []), { behandlung: 'schwarz-wort', ohneSticker: false });
  assert.deepEqual(ersatzMitMarke('schwarz-wort', gesicht, [[180, 100, 40, 40]]), { behandlung: 'schwarz-wort', ohneSticker: false }, 'blosses Beruehren schneidet nicht');
  assert.deepEqual(ersatzMitMarke('blur', gesicht, markiert), { behandlung: 'blur', ohneSticker: false }, 'ohne Marke ist nichts zu tun');
  assert.ok(['schwarz', 'mosaik', 'sticker', 'blur'].every((b) => behandlungsRang(ersatzMitMarke(b, gesicht, markiert).behandlung) === behandlungsRang(b)), 'die Staerke der Behandlung aendert sich nie (Deckung voll)');
});
