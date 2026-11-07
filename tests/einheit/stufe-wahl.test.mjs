// Einheitstests Phase 7, Auftrag I (Intensitaet, Formatwahl, Kern-Bilder): Stufenwahl (kumulativ, nie schaerfer), Klassenwahl nach Seitenverhaeltnis,
// alte Packs ohne Masse, Einstellung mit unbekanntem Wert, Pack-Masse beim Pruefen, Kern-Wahl je Tag.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STANDARD, STUFEN_WAHL, vervollstaendige } from '../../src/einstellungen.ts';
import { bildKlasse, erlaubteStufen, schluesselMitKlasse, trenneKlasse, waehleVorschauNamen } from '../../src/pack/wahl.ts';
import { kernName, tagesZahl, waehleKern } from '../../src/kern.ts';
import { pruefePack, quelleAusBytes, schreibePack } from '../../src/pack/format.ts';
import { baueDummyPack, DUMMY_STUFEN_BILDER } from '../../scripts/pack/baue-pack.mjs';

const datei = (name, stufe, breite, hoehe) => ({ name, stufe, breite, hoehe });
// Je Stufe und Klasse genau ein Bild (wie das Dummy-Pack mit Stufen-Satz).
const SATZ = DUMMY_STUFEN_BILDER.map((x) => datei(`vorschau/stufe-${x.schluessel}.webp`, x.stufe, x.breite, x.hoehe));
const stufeVon = (name) => SATZ.find((d) => d.name === name)?.stufe;

test('Einstellung: Standard hot, unbekannte oder fehlende Werte fallen auf hot zurueck, gueltige bleiben', () => {
  assert.equal(STANDARD.erwachsen.stufe, 'hot');
  assert.equal(vervollstaendige({}).erwachsen.stufe, 'hot');
  assert.equal(vervollstaendige({ erwachsen: { stufe: 'extrem' } }).erwachsen.stufe, 'hot');
  assert.equal(vervollstaendige({ erwachsen: { stufe: 7 } }).erwachsen.stufe, 'hot');
  assert.equal(vervollstaendige({ erwachsen: null }).erwachsen.stufe, 'hot');
  for (const s of STUFEN_WAHL) assert.equal(vervollstaendige({ erwachsen: { stufe: s } }).erwachsen.stufe, s);
  // Alte Staende ohne das Feld behalten ihre anderen Werte.
  const alt = vervollstaendige({ erwachsen: { an: false, komplettErsatz: true } });
  assert.equal(alt.erwachsen.an, false);
  assert.equal(alt.erwachsen.komplettErsatz, true);
  assert.equal(alt.erwachsen.stufe, 'hot');
});

test('Stufen sind kumulativ: tease nur tease, hot tease und hot, explicit alle', () => {
  assert.deepEqual([...erlaubteStufen('tease')], ['tease']);
  assert.deepEqual([...erlaubteStufen('hot')], ['tease', 'hot']);
  assert.deepEqual([...erlaubteStufen('explicit')], ['tease', 'hot', 'explicit']);
  assert.deepEqual([...erlaubteStufen('unbekannt')], ['tease']);
});

test('Stufenwahl: tease zeigt nie hot oder explicit, hot nie explicit (viele Schluessel, alle Klassen)', () => {
  for (let k = 0; k < 200; k++) {
    for (const [b, h] of [[16, 9], [9, 16], [1, 1]]) {
      const tease = waehleVorschauNamen(SATZ, 'tease', `quelle-${k}`, b, h);
      assert.ok(tease.length > 0 && tease.every((n) => stufeVon(n) === 'tease'), `tease ${k} ${b}:${h} ${tease}`);
      const hot = waehleVorschauNamen(SATZ, 'hot', `quelle-${k}`, b, h);
      assert.ok(hot.length > 0 && hot.every((n) => stufeVon(n) !== 'explicit'), `hot ${k} ${b}:${h} ${hot}`);
    }
  }
  // explicit nimmt alle drei Stufen in die Reihenfolge auf
  const alle = waehleVorschauNamen(SATZ, 'explicit', 'x', 16, 9);
  assert.equal(new Set(alle.map(stufeVon)).size, 3);
});

test('Nie eine schaerfere Stufe: ohne Bild in einer erlaubten Stufe bleibt die Liste leer, sonst nur erlaubte Stufen', () => {
  const nurExplicit = [datei('a.webp', 'explicit', 640, 360)];
  assert.deepEqual(waehleVorschauNamen(nurExplicit, 'tease', 'x', 16, 9), []);
  assert.deepEqual(waehleVorschauNamen(nurExplicit, 'hot', 'x', 16, 9), []);
  assert.deepEqual(waehleVorschauNamen(nurExplicit, 'explicit', 'x', 16, 9), ['a.webp']);
  const teaseUndExplicit = [datei('t.webp', 'tease', 640, 360), datei('e.webp', 'explicit', 640, 360)];
  assert.deepEqual(waehleVorschauNamen(teaseUndExplicit, 'hot', 'x', 16, 9), ['t.webp']);
  assert.deepEqual(waehleVorschauNamen(teaseUndExplicit, 'tease', 'x', 16, 9), ['t.webp']);
  // Bild ohne Stufe (gibt es im gueltigen Pack nicht) gilt nie als erlaubt
  assert.deepEqual(waehleVorschauNamen([{ name: 'o.webp' }], 'explicit', 'x', 16, 9), []);
});

test('Klassen: quer ab 1,2, hoch unter 0,85, sonst quadratisch; Unsinn gibt null', () => {
  assert.equal(bildKlasse(16, 9), 'quer');
  assert.equal(bildKlasse(120, 100), 'quer');
  assert.equal(bildKlasse(119, 100), 'quadratisch');
  assert.equal(bildKlasse(100, 100), 'quadratisch');
  assert.equal(bildKlasse(85, 100), 'quadratisch');
  assert.equal(bildKlasse(84, 100), 'hoch');
  assert.equal(bildKlasse(9, 16), 'hoch');
  assert.equal(bildKlasse(0, 10), null);
  assert.equal(bildKlasse(NaN, 10), null);
});

test('Klassenwahl: 16:9 nimmt ein Querbild, 9:16 ein Hochbild, 1:1 das Quadrat; ohne passende Klasse die naechste nach Verhaeltnis', () => {
  const name = (liste) => liste[0];
  for (let k = 0; k < 50; k++) {
    assert.equal(name(waehleVorschauNamen(SATZ, 'explicit', `q${k}`, 16, 9)).includes('quer'), true);
    assert.equal(name(waehleVorschauNamen(SATZ, 'explicit', `q${k}`, 9, 16)).includes('hoch'), true);
    assert.equal(name(waehleVorschauNamen(SATZ, 'hot', `q${k}`, 1, 1)), 'vorschau/stufe-hot-quadratisch.webp');
  }
  // Tease hat kein Quadrat: 1:1 bekommt die Klasse mit dem naechsten Verhaeltnis (Hochbild 3:4 liegt naeher an 1:1 als 16:9)
  assert.equal(name(waehleVorschauNamen(SATZ, 'tease', 'q', 1, 1)), 'vorschau/stufe-tease-hoch.webp');
  // Nur Querbilder da, Hochformat gefragt: das Querbild, und die Liste ist nie leer, solange die Stufe passt
  const nurQuer = [datei('q1.webp', 'tease', 640, 360), datei('q2.webp', 'hot', 640, 360)];
  assert.ok(waehleVorschauNamen(nurQuer, 'hot', 'x', 9, 16).length === 2);
  // Eine Flaeche ohne Masse (Breite oder Hoehe fehlt) waehlt wie vor Phase 7, ohne Klasse
  assert.equal(waehleVorschauNamen(SATZ, 'hot', 'x').length, SATZ.filter((d) => d.stufe !== 'explicit').length);
});

test('Wahl ist stabil je Schluessel und verteilt ueber Schluessel; die uebrigen Bilder folgen als Rueckfall', () => {
  const mehrere = [1, 2, 3, 4].map((i) => datei(`q${i}.webp`, 'hot', 640, 360));
  const a = waehleVorschauNamen(mehrere, 'hot', 'schluessel-1', 16, 9);
  const b = waehleVorschauNamen(mehrere, 'hot', 'schluessel-1', 16, 9);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 4);
  const ersterStueck = new Set();
  for (let k = 0; k < 40; k++) ersterStueck.add(waehleVorschauNamen(mehrere, 'hot', `s-${k}`, 16, 9)[0]);
  assert.ok(ersterStueck.size >= 3, `Verteilung ${ersterStueck.size}`);
});

test('Alte Packs ohne Masse: die Wahl nach Stufe geht, ohne Klasse; gemischt kommen Dateien ohne Masse zuletzt', () => {
  const alt = [datei('a.webp', 'tease'), datei('b.webp', 'hot'), datei('c.webp', 'explicit')];
  const hot = waehleVorschauNamen(alt, 'hot', 'x', 16, 9);
  assert.deepEqual([...hot].sort(), ['a.webp', 'b.webp']);
  const gemischt = [datei('ohne.webp', 'hot'), datei('mit-hoch.webp', 'hot', 360, 480), datei('mit-quer.webp', 'hot', 640, 360)];
  const l = waehleVorschauNamen(gemischt, 'hot', 'x', 16, 9);
  assert.equal(l[0], 'mit-quer.webp');
  assert.equal(l.at(-1), 'ohne.webp');
});

test('Zwischenspeicher-Schluessel traegt die Klasse und laesst sich wieder trennen', () => {
  const quer = schluesselMitKlasse('https://x/a.jpg', 320, 180);
  const hoch = schluesselMitKlasse('https://x/a.jpg', 180, 320);
  assert.notEqual(quer, hoch);
  assert.deepEqual(trenneKlasse(quer), { schluessel: 'https://x/a.jpg', breite: 16, hoehe: 9 });
  assert.deepEqual(trenneKlasse(hoch), { schluessel: 'https://x/a.jpg', breite: 9, hoehe: 16 });
  assert.deepEqual(trenneKlasse(schluesselMitKlasse('s', 100, 100)), { schluessel: 's', breite: 1, hoehe: 1 });
  assert.deepEqual(trenneKlasse('ohne'), { schluessel: 'ohne' });
  assert.equal(schluesselMitKlasse('s', 0, 0), 's');
});

test('Pack-Pruefung liest die Masse jedes Bildes; das Dummy-Pack mit Stufen-Satz besteht sie', async () => {
  const dummy = await baueDummyPack({ vorschauSatz: 'stufen' });
  const p = await pruefePack(quelleAusBytes(dummy.bytes), '0.8.0');
  for (const x of DUMMY_STUFEN_BILDER) {
    const m = p.masse[`vorschau/stufe-${x.schluessel}.webp`];
    assert.deepEqual(m, { breite: x.breite, hoehe: x.hoehe }, x.schluessel);
    const e = p.manifest.dateien.find((d) => d.name === `vorschau/stufe-${x.schluessel}.webp`);
    assert.equal(e.stufe, x.stufe);
  }
  assert.equal(dummy.vorschau, DUMMY_STUFEN_BILDER.length);
  // Standard-Dummy: vier Querbilder, zwei Tease und zwei Hot (die Standardstufe zeigt alle vier)
  const std = await pruefePack(quelleAusBytes((await baueDummyPack()).bytes), '0.8.0');
  const vs = std.manifest.dateien.filter((d) => d.rolle === 'vorschau');
  assert.equal(vs.length, 4);
  assert.deepEqual(vs.map((d) => d.stufe), ['tease', 'hot', 'tease', 'hot']);
  assert.ok(vs.every((d) => std.masse[d.name].breite === 640 && std.masse[d.name].hoehe === 360));
});

test('Kern: Name mit zwei Stellen, Wahl stabil je Tag, rund um die Liste, ohne Bilder leer', () => {
  assert.equal(kernName(1), 'kern-01.webp');
  assert.equal(kernName(20), 'kern-20.webp');
  const liste = ['a', 'b', 'c', 'd'];
  assert.deepEqual(waehleKern(liste, 0, 1), ['a']);
  assert.deepEqual(waehleKern(liste, 5, 1), ['b']);
  assert.deepEqual(waehleKern(liste, 3, 3), ['d', 'a', 'b']);
  assert.deepEqual(waehleKern(liste, 2, 9), ['c', 'd', 'a', 'b']);
  assert.deepEqual(waehleKern(liste, -1, 1), ['d']);
  assert.deepEqual(waehleKern([], 4, 3), []);
  assert.deepEqual(waehleKern(liste, 4, 0), []);
  const heute = tagesZahl(new Date(2026, 10, 6, 1, 0));
  assert.equal(tagesZahl(new Date(2026, 10, 6, 23, 59)), heute);
  assert.equal(tagesZahl(new Date(2026, 10, 7, 0, 1)), heute + 1);
});

// ---------- Metadaten-Pruefung beim Bau (Runde 2, Fund 9) ----------
import { findeMetadaten, pruefeWebpDateien, webpChunks } from '../../scripts/webp-pruefung.mjs';

function riff(chunks) {
  const teile = chunks.map(([name, laenge]) => {
    const b = new Uint8Array(8 + laenge + (laenge & 1));
    b.set([...name].map((c) => c.charCodeAt(0)), 0);
    new DataView(b.buffer).setUint32(4, laenge, true);
    return b;
  });
  const gesamt = 4 + teile.reduce((s, t) => s + t.length, 0);
  const aus = new Uint8Array(8 + gesamt);
  aus.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  new DataView(aus.buffer).setUint32(4, gesamt, true);
  aus.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  let p = 12;
  for (const t of teile) {
    aus.set(t, p);
    p += t.length;
  }
  return aus;
}

test('Metadaten-Pruefung: saubere WebP gehen durch, EXIF und XMP brechen ab, Unsinn auch', () => {
  const sauber = riff([['VP8X', 10], ['ALPH', 5], ['VP8 ', 7]]);
  assert.deepEqual(webpChunks(sauber), ['VP8X', 'ALPH', 'VP8 ']);
  assert.deepEqual(findeMetadaten(sauber), []);
  assert.deepEqual(findeMetadaten(riff([['VP8X', 10], ['VP8 ', 7], ['EXIF', 11]])), ['EXIF']);
  assert.deepEqual(findeMetadaten(riff([['VP8X', 10], ['XMP ', 4], ['VP8 ', 6]])), ['XMP ']);
  assert.doesNotThrow(() => pruefeWebpDateien([['kern/kern-01.webp', sauber]]));
  assert.throws(() => pruefeWebpDateien([['kern/kern-02.webp', riff([['VP8 ', 6], ['EXIF', 4]])]]), /kern\/kern-02\.webp enthaelt Metadaten \(EXIF\)/);
  assert.throws(() => pruefeWebpDateien([['x.webp', new Uint8Array([1, 2, 3])]]), /nicht lesbar/);
  assert.throws(() => pruefeWebpDateien([['x.webp', new TextEncoder().encode('RIFF....WAVEdata')]]), /nicht lesbar/);
});
