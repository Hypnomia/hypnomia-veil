// Einheitstests der Pause nach Regel S2 (Phase 11, E3c, Regel K): src/schleier/video-standbild.ts, reine Entscheidung ohne Browser.
// Wann darf ein Standbild geprueft werden, wann zaehlt eine Pruefung, wann faellt der Zaehler, wann die dritte saubere (Kopie, nie frei), wann wird die Kopie weggenommen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bewerteStandbildPruefung,
  deckeZuBeiEreignis,
  deckeZuBeiNachschau,
  neuesStandbild,
  standbildBerechtigt,
  zaehlerNachZudecken,
  zeigtPoster,
  zeigtPosterAm,
  STAND_ABWEICHUNG_MAX,
  STAND_EREIGNISSE,
  KOPIEN_MAX,
  zaehltSauberImLaufenden,
  zaehlerBeiSeekingImStand,
  posterAenderungWirkt,
  neuBeurteilenBeiBildmasse,
} from '../../src/schleier/video-standbild.ts';

const fakten = (aus = {}) => ({
  steht: true,
  seeking: false,
  readyState: 4,
  videoWidth: 640,
  gespielt: true,
  hatPoster: false,
  hatLeinwand: false,
  istStrom: false,
  verdeckt: true,
  schnell: false,
  ...aus,
});
const d = (...w) => Float32Array.from(w);
const gleich = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const aufn = (aus = {}) => ({ ct: 12.5, epoche: 0, quelle: 'blob:a', daumen: d(1, 2, 3), ...aus });
const jetzt = (aus = {}) => ({ steht: true, seeking: false, ct: 12.5, epoche: 0, quelle: 'blob:a', hatLeinwand: false, ...aus });
const stand = () => neuesStandbild(12.5, 0, 'blob:a');
const pruefe = (st, a = aufn(), j = jetzt(), erg = 'sauber') => bewerteStandbildPruefung(st, a, j, erg, gleich, 3);

// ---------- Wer geprueft werden darf (Punkt 1 und 2) ----------

test('berechtigt: pausiert, verdeckt, ohne Leinwand, schon gespielt (K6: der Bildwaechter ist keine Bedingung mehr)', () => {
  assert.equal(standbildBerechtigt(fakten()), true);
});

test('berechtigt: jede einzelne Bedingung ist noetig', () => {
  const nein = [
    { steht: false },
    { seeking: true },
    { readyState: 1 },
    { videoWidth: 0 },
    { hatLeinwand: true },
    { schnell: true },
    { istStrom: true },
    { verdeckt: false },
  ];
  for (const aus of nein) assert.equal(standbildBerechtigt(fakten(aus)), false, JSON.stringify(aus));
});

// E3d (P2): "zeigt sein Poster" heisst: poster-Attribut (auch leer) und seit dem Laden der Quelle nie gespielt. Eine Funktion fuer das Urteil und fuer die Kopie.
test('Poster: ein nie gespieltes Video mit poster-Attribut zeigt das Poster, kein Standbild, keine Kopie', () => {
  assert.equal(standbildBerechtigt(fakten({ gespielt: false, hatPoster: true })), false);
  assert.equal(zeigtPoster({ gespielt: false, hatPoster: true, videoWidth: 640 }), true);
});

test('Poster: ohne poster-Attribut gibt es nie ein Poster, auch nie gespielt, auch bei Sprung', () => {
  assert.equal(zeigtPoster({ gespielt: false, hatPoster: false, videoWidth: 640 }), false);
  assert.equal(standbildBerechtigt(fakten({ gespielt: false, hatPoster: false, readyState: 2 })), true);
});

test('Poster: hat das Video gespielt, gilt das Poster nicht mehr, auch mit poster-Attribut', () => {
  assert.equal(zeigtPoster({ gespielt: true, hatPoster: true, videoWidth: 640 }), false);
  assert.equal(standbildBerechtigt(fakten({ gespielt: true, hatPoster: true })), true);
});

test('zeigtPosterAm: leeres poster-Attribut zaehlt, played.length 0 heisst nie gespielt, ein Fehler beim Lesen von played gilt als nie gespielt (strengere Seite)', () => {
  const el = (attr, laenge, breite = 640) => ({ hasAttribute: (n) => n === 'poster' && attr, played: { length: laenge }, videoWidth: breite });
  assert.equal(zeigtPosterAm(el(true, 0)), true); // auch ein leeres Attribut: hasAttribute ist wahr
  assert.equal(zeigtPosterAm(el(true, 1)), false);
  assert.equal(zeigtPosterAm(el(false, 0)), false);
  assert.equal(zeigtPosterAm({ hasAttribute: () => true, get played() { throw new Error('x'); }, videoWidth: 640 }), true);
});

// P8: ein Video ohne Bildmasse (nur Ton) zeigt sein Poster auch beim Abspielen, solange das Attribut da ist; ohne Poster nie; mit Bildmasse gilt wieder P2.
test('P8 Poster: nur Ton (videoWidth 0) mit poster-Attribut zeigt das Poster auch nach dem Abspielen', () => {
  assert.equal(zeigtPoster({ gespielt: true, hatPoster: true, videoWidth: 0 }), true);
  assert.equal(zeigtPoster({ gespielt: false, hatPoster: true, videoWidth: 0 }), true);
  const el = (breite, gespielt) => ({ hasAttribute: () => true, played: { length: gespielt ? 1 : 0 }, videoWidth: breite });
  assert.equal(zeigtPosterAm(el(0, true)), true);
});

test('P8 Poster: nur Ton ohne poster-Attribut zeigt kein Poster; bekommt das Video Bildmasse und hat gespielt, gilt wieder P2', () => {
  assert.equal(zeigtPoster({ gespielt: true, hatPoster: false, videoWidth: 0 }), false);
  assert.equal(zeigtPoster({ gespielt: true, hatPoster: true, videoWidth: 640 }), false);
  assert.equal(zeigtPoster({ gespielt: false, hatPoster: true, videoWidth: 640 }), true);
});

// ---------- Wann zaehlt eine Pruefung, wann frei (Punkt 3 und 4) ----------

test('drei saubere Pruefungen desselben Standbilds in Folge: zaehlt, zaehlt, drei (die Kopie, nie frei)', () => {
  let b = pruefe(stand());
  assert.equal(b.aktion, 'zaehlt');
  assert.equal(b.stand.sauber, 1);
  b = pruefe(b.stand);
  assert.equal(b.aktion, 'zaehlt');
  assert.equal(b.stand.sauber, 2);
  b = pruefe(b.stand);
  assert.equal(b.aktion, 'drei');
  assert.equal(b.stand.sauber, 3);
});

test('die ersten beiden Pruefungen geben noch keine Kopie (Hysterese 3, eigener Zaehler)', () => {
  const b1 = pruefe(stand());
  const b2 = pruefe(b1.stand);
  assert.notEqual(b1.aktion, 'drei');
  assert.notEqual(b2.aktion, 'drei');
});

test('ein Treffer beendet die Pruefung dieses Standbilds: Zaehler null, nie frei, auch nicht mit spaeteren sauberen Antworten', () => {
  let b = pruefe(stand());
  b = pruefe(b.stand, aufn(), jetzt(), 'treffer');
  assert.equal(b.aktion, 'beendet');
  assert.equal(b.stand.sauber, 0);
  assert.equal(b.stand.beendet, true);
  for (let i = 0; i < 5; i++) {
    b = pruefe(b.stand);
    assert.equal(b.aktion, 'beendet');
  }
});

test('Fehler und nicht lesbar beenden die Pruefung wie ein Treffer', () => {
  for (const erg of ['fehler', 'unlesbar']) {
    const b = pruefe(stand(), aufn(), jetzt(), erg);
    assert.equal(b.aktion, 'beendet', erg);
    assert.equal(b.stand.sauber, 0);
  }
});

test('ohne lesbaren Daumen laesst sich "dasselbe Bild" nicht belegen: beendet, nie frei', () => {
  const b = pruefe(stand(), aufn({ daumen: null }));
  assert.equal(b.aktion, 'beendet');
});

test('Zeit hat sich zwischen Aufnahme und Antwort geaendert: die Antwort zaehlt nicht, der Zaehler faellt auf null', () => {
  const b1 = pruefe(stand());
  const b = pruefe(b1.stand, aufn(), jetzt({ ct: 12.6 }));
  assert.equal(b.aktion, 'verworfen');
  assert.equal(b.stand.sauber, 0);
  assert.equal(b.stand.daumen, null);
});

test('jede Abweichung bis zur Antwort verwirft: spielt, springt, andere Quelle, Quellenwechsel, Leinwand', () => {
  const abweichungen = [{ steht: false }, { seeking: true }, { epoche: 1 }, { quelle: 'blob:b' }, { hatLeinwand: true }];
  for (const aus of abweichungen) {
    const b1 = pruefe(stand());
    const b = pruefe(b1.stand, aufn(), jetzt(aus));
    assert.equal(b.aktion, 'verworfen', JSON.stringify(aus));
    assert.equal(b.stand.sauber, 0, JSON.stringify(aus));
  }
});

test('eine Aufnahme eines anderen Standbilds (andere Zeit oder Epoche als das Standbild) zaehlt nicht', () => {
  assert.equal(pruefe(stand(), aufn({ ct: 3.5 }), jetzt({ ct: 3.5 })).aktion, 'verworfen');
  assert.equal(pruefe(stand(), aufn({ epoche: 1 }), jetzt({ epoche: 1 })).aktion, 'verworfen');
});

test('anderer Daumen als bei der ersten sauberen Pruefung: Zaehler null, die erste Aufnahme gilt neu', () => {
  const b1 = pruefe(stand());
  const b2 = pruefe(b1.stand);
  assert.equal(b2.stand.sauber, 2);
  const b3 = pruefe(b2.stand, aufn({ daumen: d(9, 9, 9) }));
  assert.equal(b3.aktion, 'verworfen');
  assert.equal(b3.stand.sauber, 0);
  assert.equal(b3.stand.daumen, null);
  assert.equal(b3.stand.abweichungen, 1);
  // danach beginnt die Folge neu: drei saubere sind wieder noetig
  let b = pruefe(b3.stand, aufn({ daumen: d(9, 9, 9) }));
  assert.equal(b.aktion, 'zaehlt');
  b = pruefe(b.stand, aufn({ daumen: d(9, 9, 9) }));
  assert.equal(b.aktion, 'zaehlt');
  b = pruefe(b.stand, aufn({ daumen: d(9, 9, 9) }));
  assert.equal(b.aktion, 'drei');
});

test('zu viele Abweichungen des Daumens bei gleicher Zeit: die Pruefung ist beendet, das Video bleibt verdeckt', () => {
  let st = stand();
  st = pruefe(st).stand;
  let b = null;
  for (let i = 0; i < STAND_ABWEICHUNG_MAX; i++) {
    b = pruefe(st, aufn({ daumen: d(i + 10) }));
    st = b.stand;
    if (i < STAND_ABWEICHUNG_MAX - 1) st = pruefe(st, aufn({ daumen: d(i + 10) })).stand; // wieder einen Daumen festhalten
  }
  assert.equal(b.aktion, 'beendet');
});

test('ein bereits beendetes Standbild bleibt beendet (kein Dauerpruefen)', () => {
  const st = { ...stand(), beendet: true };
  assert.equal(pruefe(st).aktion, 'beendet');
});

test('der Eingabe-Stand wird nie veraendert', () => {
  const st = stand();
  const kopie = JSON.stringify({ ...st, daumen: null });
  pruefe(st);
  assert.equal(JSON.stringify({ ...st, daumen: null }), kopie);
  assert.equal(st.sauber, 0);
});

// ---------- Wann wieder zu (Punkt 5) ----------

test('diese Ereignisse nehmen die Kopie immer weg: play, playing, seeking, seeked, ratechange, loadstart, emptied, enterpictureinpicture (R4)', () => {
  for (const name of ['play', 'playing', 'seeking', 'seeked', 'ratechange', 'loadstart', 'emptied', 'enterpictureinpicture']) {
    assert.equal(deckeZuBeiEreignis(name, 12.5, 12.5), true, name);
    assert.ok(STAND_EREIGNISSE.includes(name), `${name} fehlt in der Liste der Horcher`);
  }
});

test('timeupdate deckt nur bei anderer Zeit zu', () => {
  assert.equal(deckeZuBeiEreignis('timeupdate', 12.5, 12.5), false);
  assert.equal(deckeZuBeiEreignis('timeupdate', 12.6, 12.5), true);
  assert.ok(STAND_EREIGNISSE.includes('timeupdate'));
});

test('andere Ereignisse (pause, waiting, canplay) decken nicht zu', () => {
  for (const name of ['pause', 'waiting', 'canplay', 'progress', 'volumechange', 'ended']) assert.equal(deckeZuBeiEreignis(name, 12.5, 12.5), false, name);
});

const nachschau = (aus = {}) => ({
  aktiv: true,
  eignungOk: true,
  poster: false,
  verbunden: true,
  steht: true,
  seeking: false,
  ct: 12.5,
  ctStand: 12.5,
  epoche: 0,
  epocheStand: 0,
  quelle: 'blob:a',
  quelleStand: 'blob:a',
  hatLeinwand: false,
  readyState: 4,
  ...aus,
});

test('Nachschau: unveraendert bleibt frei', () => {
  assert.equal(deckeZuBeiNachschau(nachschau()), false);
});

test('Nachschau: nimmt die Kopie weg, sobald das Video nicht mehr steht, springt, andere Zeit, Quelle oder Epoche hat, eine Leinwand bekommt, entfernt ist, die Eignung verliert, der Schleier ausgeht oder die Seite ein poster setzt', () => {
  const aenderungen = [{ steht: false }, { seeking: true }, { ct: 12.6 }, { epoche: 1 }, { quelle: 'blob:b' }, { hatLeinwand: true }, { verbunden: false }, { readyState: 1 }, { aktiv: false }, { eignungOk: false }, { poster: true }];
  for (const aus of aenderungen) assert.equal(deckeZuBeiNachschau(nachschau(aus)), true, JSON.stringify(aus));
});

// ---------- Zaehler des laufenden Videos nach dem Zudecken (Punkt 6) ----------

test('nach Play steht der Zaehler wie vor der Pause (nicht drei, nicht null)', () => {
  for (const vor of [0, 1, 2]) {
    assert.equal(zaehlerNachZudecken('play', false, vor), vor);
    assert.equal(zaehlerNachZudecken('playing', false, vor), vor);
  }
});

test('nach einem Sprung, Quellenwechsel oder einer Aenderung im Stand steht der Zaehler auf null', () => {
  for (const g of ['seeking', 'seeked', 'loadstart', 'emptied']) assert.equal(zaehlerNachZudecken(g, true, 2), 0, g);
  for (const g of ['timeupdate', 'bildwaechter', 'nachschau']) assert.equal(zaehlerNachZudecken(g, true, 2), 0, `${g} im Stand`);
});

test('Bildwaechter oder Nachschau finden das Video spielend: wie Play (Stand vor der Pause)', () => {
  assert.equal(zaehlerNachZudecken('bildwaechter', false, 2), 2);
  assert.equal(zaehlerNachZudecken('nachschau', false, 1), 1);
});

test('der Zaehler nach dem Zudecken ist nie drei oder mehr, wenn vor der Pause weniger stand (kein Zaehlerstand aus dem Standbild)', () => {
  // Die Pruefungen des Standbilds zaehlen nicht fuer das laufende Video: es gibt keinen Weg von sauber=3 des Standbilds zum Zaehler des Videos.
  for (const g of ['play', 'playing', 'ratechange', 'seeking', 'seeked', 'loadstart', 'emptied', 'timeupdate', 'bildwaechter', 'nachschau']) {
    for (const steht of [true, false]) assert.ok(zaehlerNachZudecken(g, steht, 1) <= 1, `${g} ${steht}`);
  }
});

test('negativer Zaehlerstand vor der Pause wird nie weitergegeben', () => {
  assert.equal(zaehlerNachZudecken('play', false, -1), 0);
});

// ---------- Kopien je Dokument (K7) ----------

test('hoechstens vier Kopien je Dokument', () => {
  assert.equal(KOPIEN_MAX, 4);
});

// ---------- V1: eine gewoehnliche Pruefung zaehlt nur, wenn das Video bei Start und Antwort lief ----------

test('V1: laeuft das Video bei Start und Antwort, zaehlt die saubere Pruefung', () => {
  assert.equal(zaehltSauberImLaufenden(true, true), true);
});

test('V1: stand das Video beim Start, bei der Antwort oder beides, zaehlt sie nicht', () => {
  assert.equal(zaehltSauberImLaufenden(false, true), false);
  assert.equal(zaehltSauberImLaufenden(true, false), false);
  assert.equal(zaehltSauberImLaufenden(false, false), false);
});

// ---------- V2: seeking im Stand setzt den Zaehler immer auf null ----------

test('V2: seeking im Stand setzt den Zaehler auf null, auch ohne Standbild und bei Zaehlerstand 1 oder 2', () => {
  for (const z of [0, 1, 2, 3]) assert.equal(zaehlerBeiSeekingImStand(true, z), 0);
});

test('V2: seeking bei laufendem Video aendert den Zaehler nicht', () => {
  for (const z of [0, 1, 2]) assert.equal(zaehlerBeiSeekingImStand(false, z), z);
});

// ---------- P9: eine Aenderung des poster-Attributs ----------

test('P9: ein Video, das schon gespielt hat und Bildmasse hat, wird von einem neuen oder entfernten poster nicht beruehrt', () => {
  assert.equal(posterAenderungWirkt(true, 640), false);
});

test('P9: nie gespielt oder ohne Bildmasse: die Aenderung des poster wirkt', () => {
  assert.equal(posterAenderungWirkt(false, 640), true);
  assert.equal(posterAenderungWirkt(false, 0), true);
  assert.equal(posterAenderungWirkt(true, 0), true);
});

// ---------- P11: Bildmasse kommt zu einem Video ohne Lauf ----------

test('P11: ein ohne Bildmasse beurteiltes Video ohne Lauf, das jetzt Bildmasse hat, wird neu beurteilt', () => {
  assert.equal(neuBeurteilenBeiBildmasse(true, 640, false), true);
});

test('P11: keine Neubeurteilung ohne Bildmasse, mit Lauf, oder wenn das Video nie ohne Bildmasse beurteilt wurde', () => {
  assert.equal(neuBeurteilenBeiBildmasse(true, 0, false), false);
  assert.equal(neuBeurteilenBeiBildmasse(true, 640, true), false);
  assert.equal(neuBeurteilenBeiBildmasse(false, 640, false), false);
});
