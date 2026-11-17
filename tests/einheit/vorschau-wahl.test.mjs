// Einheitstests Phase 11 Etappe 2 (Regeln O3 und O4): Ausschlussliste in der Wahl (Stufe schlaegt Ausschluss), Kennung je Kachel, Gedaechtnis,
// Speicher mit Wahl nacheinander.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERGABE_FENSTER, VERGABE_FENSTER_MAX, VERGABE_FENSTER_MIN, klemmeFenster, waehleVorschauNamen } from '../../src/pack/wahl.ts';
import { Kennungen, KachelGedaechtnis, videoKennung } from '../../src/schleier/vorschau-wahl.ts';
import { VorschauSpeicher } from '../../src/schleier/vorschau-speicher.ts';

const d = (name, stufe, breite, hoehe) => ({ name, stufe, breite, hoehe });
const QUER = ['a', 'b', 'c', 'd'].map((n) => d(`vorschau/${n}.webp`, 'hot', 1600, 900));
const NAMEN_QUER = QUER.map((x) => x.name);

test('Ausschluss: nicht ausgeschlossene Bilder kommen zuerst, die beste Klasse vor der Nachbarklasse', () => {
  const pool = [...QUER, d('vorschau/q.webp', 'hot', 1000, 1000)];
  const frei = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: [] });
  assert.equal(frei.length, 5);
  const aus = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: [NAMEN_QUER[0], NAMEN_QUER[1]] });
  assert.deepEqual(aus.slice(0, 2).every((n) => NAMEN_QUER.includes(n) && !NAMEN_QUER.slice(0, 2).includes(n)), true);
  // Alle vier Quer-Bilder ausgeschlossen: erst die Nachbarklasse (mit Zuschnitt), dann die Wiederholung
  const alle = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: NAMEN_QUER });
  assert.equal(alle[0], 'vorschau/q.webp');
});

test('Ausschluss: bei verbrauchtem Pool das am laengsten nicht gezeigte zuerst (Reihenfolge der Liste)', () => {
  const aus = ['vorschau/c.webp', 'vorschau/a.webp', 'vorschau/d.webp', 'vorschau/b.webp'];
  const liste = waehleVorschauNamen(QUER, 'hot', 'k', 16, 9, { ausschluss: aus });
  assert.deepEqual(liste, aus);
});

test('Stufe schlaegt Ausschluss: nie ein Bild einer schaerferen Stufe, auch wenn alle erlaubten ausgeschlossen sind', () => {
  const pool = [d('vorschau/t1.webp', 'tease', 1600, 900), d('vorschau/h1.webp', 'hot', 1600, 900), d('vorschau/e1.webp', 'explicit', 1600, 900), d('vorschau/e2.webp', 'explicit', 1600, 900)];
  for (const [stufe, erlaubt] of [['tease', ['vorschau/t1.webp']], ['hot', ['vorschau/t1.webp', 'vorschau/h1.webp']]]) {
    const liste = waehleVorschauNamen(pool, stufe, 'k', 16, 9, { ausschluss: erlaubt, bevorzugt: 'vorschau/e1.webp' });
    assert.equal(liste.every((n) => erlaubt.includes(n)), true, `${stufe}: ${liste}`);
    assert.equal(liste.length, erlaubt.length);
    assert.ok(!liste.includes('vorschau/e1.webp'));
  }
  // Ausschluss nennt Namen ausserhalb des Pools: sie tauchen nicht auf
  assert.deepEqual(waehleVorschauNamen(pool, 'tease', 'k', 16, 9, { ausschluss: ['vorschau/e2.webp'] }), ['vorschau/t1.webp']);
});

test('bevorzugt: kommt zuerst, aber nur wenn erlaubt; ohne Optionen unveraendert', () => {
  const ohne = waehleVorschauNamen(QUER, 'hot', 'k', 16, 9);
  assert.deepEqual(waehleVorschauNamen(QUER, 'hot', 'k', 16, 9, {}), ohne);
  const b = waehleVorschauNamen(QUER, 'hot', 'k', 16, 9, { bevorzugt: 'vorschau/d.webp' });
  assert.equal(b[0], 'vorschau/d.webp');
  assert.equal(new Set(b).size, 4);
  assert.deepEqual(waehleVorschauNamen(QUER, 'hot', 'k', 16, 9, { bevorzugt: 'gibt-es-nicht' }), ohne);
});

test('Wahl der Reihe nach: jede Kachel nimmt das erste freie Bild, danach Wiederholung mit groesstem Abstand', () => {
  const vergeben = [];
  const gewaehlt = [];
  for (let i = 0; i < 6; i++) {
    const n = waehleVorschauNamen(QUER, 'hot', `kachel:${i}`, 16, 9, { ausschluss: vergeben })[0];
    const stelle = vergeben.indexOf(n);
    if (stelle >= 0) vergeben.splice(stelle, 1); // wie im Gedaechtnis: eben gebraucht = zuletzt
    vergeben.push(n);
    gewaehlt.push(n);
  }
  assert.equal(new Set(gewaehlt.slice(0, 4)).size, 4);
  assert.equal(gewaehlt[4], gewaehlt[0]);
  assert.equal(gewaehlt[5], gewaehlt[1]);
});

test('Video-Kennung: aus dem Link, auch prozentkodiert im Parameter url', () => {
  assert.equal(videoKennung('/videos/abc123?x=1'), 'abc123');
  assert.equal(videoKennung('https://xhamster.com/fh/out?url=%2Fvideos%2Foptik1005%3Futm_content%3Dgold-video%26utm_term%3D1&utm_source=w'), 'optik1005');
  assert.equal(videoKennung('/view_video.php?viewkey=ph5a1'), 'ph5a1');
  assert.equal(videoKennung('/fh/out'), null);
  assert.equal(videoKennung('/fh/out?url=%E0%A4%A'), null);
});

test('Kennung je Kachel: gleiche Platzhalter-Quelle und kein Link ergibt je Element eine eigene Kennung, stabil bei Wiederholung', () => {
  const k = new Kennungen();
  const els = Array.from({ length: 12 }, () => ({}));
  const erste = els.map((e) => k.kennung(e, { kandidat: 'https://h/p.png' }));
  assert.equal(new Set(erste).size, 12);
  assert.deepEqual(els.map((e) => k.kennung(e, { kandidat: 'https://h/p.png' })), erste);
  // Schluessel `leer` ebenso
  const k2 = new Kennungen();
  assert.equal(new Set(els.map((e) => k2.kennung(e, { kandidat: 'leer' }))).size, 12);
});

test('Kennung je Kachel: ein gemeinsamer Link ohne Video-Kennung (zum Beispiel #) unterscheidet nicht, jede Kachel bekommt ihre eigene Kennung', () => {
  const k = new Kennungen();
  const els = Array.from({ length: 12 }, () => ({}));
  assert.equal(new Set(els.map((e) => k.kennung(e, { kandidat: 'https://h/seite' }))).size, 12);
});

test('Kennung je Kachel: dieselbe Video-Kennung zweimal gleichzeitig in der Seite ergibt zwei Kennungen, die erste behaelt die Video-Kennung', () => {
  const k = new Kennungen();
  const a = {}, b = {};
  assert.equal(k.kennung(a, { kandidat: 'video:x' }), 'video:x');
  const kb = k.kennung(b, { kandidat: 'video:x' });
  assert.notEqual(kb, 'video:x');
  assert.equal(k.kennung(b, { kandidat: 'video:x' }), kb); // stabil
  assert.equal(k.kennung(a, { kandidat: 'video:x' }), 'video:x');
});

test('Kennung je Kachel: eindeutige Quellen und Video-Kennungen bleiben Schluessel', () => {
  const k = new Kennungen();
  assert.equal(k.kennung({}, { kandidat: 'video:x' }), 'video:x');
  assert.equal(k.kennung({}, { kandidat: 'video:y' }), 'video:y');
  assert.equal(k.kennung({}, { kandidat: 'https://h/1.jpg' }), 'https://h/1.jpg');
  assert.equal(k.kennung({}, { kandidat: 'https://h/2.jpg' }), 'https://h/2.jpg');
});

test('Kennung je Kachel: ein Besitzer, der aus der Seite ist, gibt seine Kennung an ein neu gebautes Element desselben Videos ab', () => {
  let da = true;
  const k = new Kennungen(() => da);
  const alt = {};
  const neu = {};
  assert.equal(k.kennung(alt, { kandidat: 'video:x' }), 'video:x');
  da = false;
  assert.equal(k.kennung(neu, { kandidat: 'video:x' }), 'video:x');
});

test('Gedaechtnis: Ausschluss ordnet nach Vergabe (je Name einmal, juengste Vergabe zaehlt), sichtbare Namen getrennt', () => {
  const g = new KachelGedaechtnis();
  g.merke('k1', 'n1');
  g.merke('k2', 'n2');
  g.merke('k3', 'n3');
  g.merke('k4', 'n1'); // n1 nach Wiederholung
  assert.deepEqual(g.ausschluss(), ['n2', 'n3', 'n1']);
  assert.deepEqual(g.sichtbareNamen((k) => k === 'k2' || k === 'k4').sort(), ['n1', 'n2']);
  g.beruehre('k2');
  assert.deepEqual(g.ausschluss(), ['n3', 'n1', 'n2']);
  g.vergiss('k3');
  assert.deepEqual(g.ausschluss(), ['n1', 'n2']);
  g.leere();
  assert.deepEqual(g.ausschluss(), []);
});

// Erkenner-Ersatz im Test: waehlt wie src/erkenner/packbild.ts mit waehleVorschauNamen
function falscherErkenner(dateien, stufe = 'hot') {
  const protokoll = [];
  const holen = async (schluessel, zusatz = {}) => {
    protokoll.push({ schluessel, ...zusatz });
    const namen = waehleVorschauNamen(dateien, stufe, schluessel, 16, 9, zusatz);
    if (!namen.length) return null;
    await new Promise((r) => setTimeout(r, zusatz.nurWahl ? 0 : Math.random() * 5));
    return { ok: true, dataUrl: zusatz.nurWahl ? '' : 'data:image/jpeg;base64,AAAA', breite: 1, hoehe: 1, name: namen[0] };
  };
  return { holen, protokoll };
}

test('Speicher mit Wahl: 12 gleichzeitige Anfragen ergeben so viele verschiedene Bilder wie der Pool hergibt, jede Kachel behaelt ihres', async () => {
  const g = new KachelGedaechtnis();
  const e = falscherErkenner(QUER);
  const s = new VorschauSpeicher(e.holen, undefined, { gedaechtnis: g, daten: () => ({ ausschluss: g.ausschluss(), sichtbar: [] }) });
  const antworten = await Promise.all(Array.from({ length: 12 }, (_, i) => s.hole(`kachel:${i}`)));
  assert.equal(new Set(antworten.map((a) => a.name)).size, 4);
  const nochmal = await Promise.all(Array.from({ length: 12 }, (_, i) => s.hole(`kachel:${i}`)));
  assert.deepEqual(nochmal.map((a) => a.name), antworten.map((a) => a.name));
  // die ersten vier sind verschieden, die Wiederholung beginnt erst danach
  assert.equal(new Set(antworten.slice(0, 4).map((a) => a.name)).size, 4);
});

test('Speicher mit Wahl: ein verdraengtes Bild kommt fuer denselben Schluessel wieder (bevorzugt), nicht ein anderes', async () => {
  const g = new KachelGedaechtnis();
  const e = falscherErkenner(QUER);
  const s = new VorschauSpeicher(e.holen, { maxBilder: 2, maxBytes: 1e9, maxQuellen: 100 }, { gedaechtnis: g, daten: () => ({ ausschluss: g.ausschluss(), sichtbar: [] }) });
  const erste = [];
  for (let i = 0; i < 4; i++) erste.push((await s.hole(`kachel:${i}`)).name);
  assert.equal(s.sofort('kachel:0'), null); // verdraengt
  const wieder = await s.hole('kachel:0');
  assert.equal(wieder.name, erste[0]);
  assert.ok(e.protokoll.at(-1).bevorzugt === erste[0]);
});

test('Speicher mit Wahl: Fehler der Wahl wirft, die Kette bleibt benutzbar; ohne Bild (ok false) ergibt null und kein Gedaechtnis', async () => {
  const g = new KachelGedaechtnis();
  let n = 0;
  const s = new VorschauSpeicher(
    async (k, z) => {
      n++;
      if (n === 1) throw new Error('weg');
      if (z?.nurWahl && k === 'leer') return null;
      return { ok: true, dataUrl: z?.nurWahl ? '' : 'data:image/jpeg;base64,AA', breite: 1, hoehe: 1, name: 'n' };
    },
    undefined,
    { gedaechtnis: g, daten: () => ({ ausschluss: [], sichtbar: [] }) },
  );
  await assert.rejects(s.hole('a'));
  assert.equal(await s.hole('leer'), null);
  assert.equal(g.name('leer'), undefined);
  assert.equal((await s.hole('b')).name, 'n');
  assert.equal(g.name('b'), 'n');
});

test('Speicher mit Wahl: nach leere() ist das Gedaechtnis leer', async () => {
  const g = new KachelGedaechtnis();
  const e = falscherErkenner(QUER);
  const s = new VorschauSpeicher(e.holen, undefined, { gedaechtnis: g, daten: () => ({ ausschluss: g.ausschluss(), sichtbar: [] }) });
  await s.hole('a');
  assert.equal(g.anzahl, 1);
  s.leere();
  assert.equal(g.anzahl, 0);
});

// Pool mit Formaten: quer a, b; hoch h; quadratisch q
const FORMEN = [d('vorschau/a.webp', 'hot', 1600, 900), d('vorschau/b.webp', 'hot', 1600, 900), d('vorschau/h.webp', 'hot', 900, 1600), d('vorschau/q.webp', 'hot', 1000, 1000)];

test('Rang: innerhalb eines Rangs gewinnt das Format, dann noch nie vergeben, dann am laengsten her', () => {
  // nichts vergeben: Format quer zuerst, dann quadratisch (naeher als hoch), dann hoch
  const frei = waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: [], sichtbar: [] });
  assert.deepEqual(frei.slice(2), ['vorschau/q.webp', 'vorschau/h.webp']);
  // a vergeben, nicht sichtbar, alles im Fenster: Rang 1 fuer a; Rang 0 sind b, q, h: b gewinnt (Format), a kommt nach den Rang-0-Bildern
  const l = waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: ['vorschau/a.webp'], sichtbar: [] });
  assert.deepEqual(l, ['vorschau/b.webp', 'vorschau/q.webp', 'vorschau/h.webp', 'vorschau/a.webp']);
});

test('O3 vor Format: ist die passende Klasse sichtbar belegt, kommt ein freies Bild einer anderen Klasse', () => {
  const l = waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: [NAMEN_QUER[0], NAMEN_QUER[1]], sichtbar: ['vorschau/a.webp', 'vorschau/b.webp'] });
  assert.equal(l[0], 'vorschau/q.webp');
  assert.deepEqual(l.slice(2).sort(), ['vorschau/a.webp', 'vorschau/b.webp']);
});

test('Alles sichtbar belegt: wieder entscheidet das Format (kleiner Vorrat)', () => {
  const alle = FORMEN.map((x) => x.name);
  const l = waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: alle, sichtbar: alle });
  assert.equal(l[0].match(/vorschau\/(a|b)\.webp/) !== null, true);
  const hoch = waehleVorschauNamen(FORMEN, 'hot', 'k', 9, 16, { ausschluss: alle, sichtbar: alle });
  assert.equal(hoch[0], 'vorschau/h.webp');
  const quad = waehleVorschauNamen(FORMEN, 'hot', 'k', 1, 1, { ausschluss: alle, sichtbar: alle });
  assert.equal(quad[0], 'vorschau/q.webp');
});

test('Fenster: Bilder unter den letzten VERGABE_FENSTER Vergaben (nicht sichtbar) sind Rang 1, aeltere Rang 0', () => {
  assert.equal(VERGABE_FENSTER, 24);
  const pool = Array.from({ length: 30 }, (_, i) => d(`vorschau/p${String(i).padStart(2, '0')}.webp`, 'hot', 1600, 900));
  const namen = pool.map((x) => x.name);
  // alle 30 vergeben, p00 am aeltesten; die letzten 24 sind p06 bis p29: Rang 0 sind p00 bis p05
  const l = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: namen, sichtbar: [] });
  assert.deepEqual(l.slice(0, 6), namen.slice(0, 6)); // Rang 0 nach Alter
  assert.deepEqual(l.slice(6), namen.slice(6)); // Rang 1 nach Alter
  // ist p00 sichtbar, faellt es auf Rang 2 und kommt zuletzt
  const m = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: namen, sichtbar: [namen[0]] });
  assert.equal(m[0], namen[1]);
  assert.equal(m.at(-1), namen[0]);
});

test('Stufe vor allem: sichtbar, ausschluss und bevorzugt holen nie ein Bild einer schaerferen Stufe', () => {
  const pool = [d('vorschau/t1.webp', 'tease', 1600, 900), d('vorschau/h1.webp', 'hot', 1600, 900), d('vorschau/e1.webp', 'explicit', 1600, 900)];
  const l = waehleVorschauNamen(pool, 'tease', 'k', 16, 9, { ausschluss: ['vorschau/t1.webp'], sichtbar: ['vorschau/t1.webp'], bevorzugt: 'vorschau/e1.webp' });
  assert.deepEqual(l, ['vorschau/t1.webp']);
  const m = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: [], sichtbar: ['vorschau/t1.webp', 'vorschau/h1.webp'], bevorzugt: 'vorschau/e1.webp' });
  assert.equal(m.includes('vorschau/e1.webp'), false);
  assert.equal(m.length, 2);
});

test('Folge ohne Blickfeld: erst alle Bilder, dann Wiederholung mit groesstem Abstand', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => d(`vorschau/${n}.webp`, 'hot', 1600, 900));
  const g = new KachelGedaechtnis();
  const folge = [];
  for (let i = 0; i < 20; i++) {
    const name = waehleVorschauNamen(pool, 'hot', `k${i}`, 16, 9, { ausschluss: g.ausschluss(), sichtbar: [] })[0];
    g.merke(`k${i}`, name);
    folge.push(name);
  }
  assert.equal(new Set(folge.slice(0, 6)).size, 6);
  let kleinster = Infinity;
  const zuletzt = new Map();
  folge.forEach((n, i) => {
    if (zuletzt.has(n)) kleinster = Math.min(kleinster, i - zuletzt.get(n));
    zuletzt.set(n, i);
  });
  assert.ok(kleinster >= 6, `kleinster Abstand ${kleinster}`);
});

test('Rang 1 (nah, nicht im Blick): das Format zaehlt nicht, am laengsten her zuerst; Rang 0 (nicht nah) vor Rang 1', () => {
  // h (hoch) am aeltesten, dann a, dann b; alle drei nah, keiner im Blick; q noch nie vergeben (Rang 0)
  const aus = ['vorschau/h.webp', 'vorschau/a.webp', 'vorschau/b.webp'];
  const l = waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: aus, sichtbar: [] });
  assert.deepEqual(l, ['vorschau/q.webp', 'vorschau/h.webp', 'vorschau/a.webp', 'vorschau/b.webp']);
  // ohne q im Pool: nur Rang 1, das hoch-Bild ist am aeltesten und kommt vor den passenden quer-Bildern
  const ohneQ = FORMEN.filter((x) => !x.name.includes('/q.'));
  assert.deepEqual(waehleVorschauNamen(ohneQ, 'hot', 'k', 16, 9, { ausschluss: aus, sichtbar: [] }), aus);
});

test('Ohne sichtbar (die waehlende Kachel ist nicht im Blick): kein Kandidat ist im Blick, Rang 2 entfaellt', () => {
  const alle = FORMEN.map((x) => x.name);
  // alle vergeben, gerade alle nah, keiner im Blick: reine Altersfolge
  const l = waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: [alle[2], alle[3], alle[0], alle[1]], sichtbar: [] });
  assert.deepEqual(l, [alle[2], alle[3], alle[0], alle[1]]);
});

test('Fenster klemmen: fehlend, NaN, Unendlich, negativ, String ergeben 24; riesig 200; dazwischen gerundet', () => {
  assert.equal(VERGABE_FENSTER_MIN, 24);
  assert.equal(VERGABE_FENSTER_MAX, 200);
  for (const w of [undefined, null, Number.NaN, Infinity, -Infinity, '60', {}, [], true]) assert.equal(klemmeFenster(w), 24, String(w));
  assert.equal(klemmeFenster(-5), 24);
  assert.equal(klemmeFenster(0), 24);
  assert.equal(klemmeFenster(10), 24);
  assert.equal(klemmeFenster(1e9), 200);
  assert.equal(klemmeFenster(60.4), 60);
  assert.equal(klemmeFenster(60.6), 61);
});

test('Fenster 60: ein passendes Bild bleibt 60 Vergaben Rang 1, nicht schon nach 24 (Raster mit vielen Kacheln im Ausschnitt)', () => {
  // 10 passende quer-Bilder, 50 hoch-Bilder; 20 Vergaben liegen zurueck, alle 10 passenden sind unter den aeltesten
  const quer = Array.from({ length: 10 }, (_, i) => d(`vorschau/q${String(i).padStart(2, '0')}.webp`, 'hot', 1600, 900));
  const hoch = Array.from({ length: 40 }, (_, i) => d(`vorschau/h${String(i).padStart(2, '0')}.webp`, 'hot', 900, 1600));
  const pool = [...quer, ...hoch];
  const folge = [...quer, ...hoch].map((x) => x.name); // q00..q09 am aeltesten, dann h00..h39: die passenden liegen 40 bis 49 Vergaben zurueck
  // Fenster 24: die passenden sind nicht nah, Rang 0: das Format gewinnt, ein passendes kommt wieder
  const eng = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: folge, sichtbar: [], fenster: 24 });
  assert.ok(eng[0].includes('/q'), eng[0]);
  // Fenster 60: alle 50 Bilder sind nah, Rang 1: das aelteste, ohne Format, also dasselbe q00 als erstes, aber nicht per Format vor anderen Rang-0-Bildern
  const weit = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: folge, sichtbar: [], fenster: 60 });
  assert.deepEqual(weit, folge);
  // Fenster 30: die letzten 30 sind h10..h39, nah; q00..q09 und h00..h09 sind Rang 0, Format zuerst: q vor h
  const mitte = waehleVorschauNamen(pool, 'hot', 'k', 16, 9, { ausschluss: folge, sichtbar: [], fenster: 30 });
  assert.deepEqual(mitte.slice(0, 10), quer.map((x) => x.name));
  // ein Bild, das noch nie vergeben ist und nicht passt, steht bei Fenster 60 vor allen nahen (Rang 0 vor Rang 1)
  const frisch = [...pool, d('vorschau/neu.webp', 'hot', 900, 1600)];
  assert.equal(waehleVorschauNamen(frisch, 'hot', 'k', 16, 9, { ausschluss: folge, sichtbar: [], fenster: 60 })[0], 'vorschau/neu.webp');
});

test('Kleiner Vorrat unter dem Fenster: alles nah, das am laengsten her kommt zuerst, das Format zaehlt nicht', () => {
  const aus = ['vorschau/h.webp', 'vorschau/a.webp', 'vorschau/b.webp', 'vorschau/q.webp'];
  for (const fenster of [undefined, 24, 100, 1e9, 'x']) {
    assert.deepEqual(waehleVorschauNamen(FORMEN, 'hot', 'k', 16, 9, { ausschluss: aus, sichtbar: [], fenster }), aus);
  }
});

test('Fenster beeinflusst nur die Reihenfolge: Stufenfilter bleibt davor, keine Namen kommen dazu', () => {
  const pool = [d('vorschau/t1.webp', 'tease', 1600, 900), d('vorschau/e1.webp', 'explicit', 1600, 900), d('vorschau/e2.webp', 'explicit', 1600, 900)];
  for (const fenster of [undefined, 24, 200, -3, Number.NaN]) {
    const l = waehleVorschauNamen(pool, 'tease', 'k', 16, 9, { ausschluss: ['vorschau/e1.webp', 'vorschau/t1.webp'], sichtbar: [], fenster, bevorzugt: 'vorschau/e2.webp' });
    assert.deepEqual(l, ['vorschau/t1.webp']);
  }
});
