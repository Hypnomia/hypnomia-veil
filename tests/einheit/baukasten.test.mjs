// Einheitstests des Custom-Baukastens, Oberflaeche (Phase 11 E6b): U1 (die Zeile Face: alle sieben Wahlen mal alle Ausgangslagen), U2 (Wort moeglich, gesperrt, gespeichert
// gesperrt), der Satz im Popup bei einem ersetzten Baustein und die Rechnung der Schau gesperrter Stile.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEISPIELE } from '../../src/beispiel.ts';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { presetDef } from '../../src/preset-def.ts';
import { CUSTOM_FLAECHE, CUSTOM_GESICHT, customDef, hatWort } from '../../src/presets.ts';
import { FACE_WAHLEN, FLAECHE_WAHLEN, faceAnzeige, faceGesperrt, faceSchreibteil, flaecheGesperrt, flaecheSchreibteil, gespeichertGesperrt, wortMoeglich, woerterSchreibteil } from '../../src/oberflaeche/baukasten.ts';
import { BAUKASTEN_TEXTE } from '../../src/oberflaeche/bedienung-texte.ts';
import { popupStilText } from '../../src/oberflaeche/preset-texte.ts';
import { SCHAU_PACK, rechneVorschau, schauEinstellungen, zeichenSchluessel } from '../../src/oberflaeche/vorschau/rechnung.ts';

const stand = (faceAn, balken, gesicht) => ({ zonen: { ...STANDARD.zonen, face: { an: faceAn } }, augenbalken: balken, custom: { gesicht, flaeche: 'blur', woerter: true } });
const ALLES = { mia: true, sticker: true };
const anwenden = (alt, teil) => ({ ...alt, ...teil });

// ---------- U1: Zeile Face ----------
test('U1: alle sieben Wahlen mal alle Ausgangslagen (Face an und aus, Eye bar an und aus, jedes gesicht) schreiben genau, was B3 sagt', () => {
  let n = 0;
  for (const faceAn of [true, false]) {
    for (const balken of [true, false]) {
      for (const gesicht of CUSTOM_GESICHT) {
        const alt = stand(faceAn, balken, gesicht);
        for (const wahl of FACE_WAHLEN) {
          const teil = faceSchreibteil(alt, wahl, ALLES);
          n++;
          assert.ok(teil, wahl);
          const neu = anwenden(alt, teil);
          // custom.gesicht bleibt in der Menge aus C1, die anderen Felder der Mischung bleiben
          assert.ok(CUSTOM_GESICHT.includes(neu.custom.gesicht));
          assert.equal(neu.custom.flaeche, 'blur');
          assert.equal(neu.custom.woerter, true);
          assert.equal(teil.preset, 'custom');
          // die anderen Zonen bleiben, wie sie waren
          for (const z of Object.keys(alt.zonen)) if (z !== 'face') assert.deepEqual(neu.zonen[z], alt.zonen[z]);
          if (wahl === 'nothing') {
            assert.equal(neu.zonen.face.an, false);
            assert.equal(neu.augenbalken, false);
            assert.equal(neu.custom.gesicht, gesicht);
          } else if (wahl === 'bar') {
            assert.equal(neu.zonen.face.an, false);
            assert.equal(neu.augenbalken, true);
            assert.equal(neu.custom.gesicht, gesicht);
          } else {
            assert.equal(neu.zonen.face.an, true);
            assert.equal(neu.custom.gesicht, wahl);
            assert.equal(neu.augenbalken, balken); // Eye bar bleibt
          }
          // die Anzeige nach der Wahl ist die Wahl
          assert.equal(faceAnzeige(neu), wahl);
          // zweimal dieselbe Wahl aendert nichts mehr
          const zweit = anwenden(neu, faceSchreibteil(neu, wahl, ALLES));
          assert.deepEqual(zweit, neu);
        }
      }
    }
  }
  assert.equal(n, 2 * 2 * 5 * 7);
});

test('U1: die Anzeige teilt alle Lagen eindeutig (jede Lage genau eine der sieben Wahlen), Face aus zeigt nie einen Baustein', () => {
  const gesehen = new Set();
  for (const faceAn of [true, false]) for (const balken of [true, false]) for (const gesicht of CUSTOM_GESICHT) {
    const a = faceAnzeige(stand(faceAn, balken, gesicht));
    assert.ok(FACE_WAHLEN.includes(a));
    if (!faceAn) assert.equal(a, balken ? 'bar' : 'nothing');
    else assert.equal(a, gesicht);
    gesehen.add(a);
  }
  assert.deepEqual([...gesehen].sort(), [...FACE_WAHLEN].sort());
});

test('U1: unbekannte Wahlen und eine ungueltige gespeicherte Mischung schreiben nie etwas Falsches', () => {
  const alt = stand(true, false, 'mosaik');
  for (const schlecht of [undefined, null, 'x', 'constructor', '__proto__', 3, {}, 'Nothing']) {
    assert.equal(faceSchreibteil(alt, schlecht, ALLES), null);
    assert.equal(flaecheSchreibteil(alt, schlecht, ALLES), null);
  }
  assert.equal(woerterSchreibteil(alt, 'ja'), null);
  assert.equal(woerterSchreibteil(alt, 1), null);
  // ungueltige gespeicherte Mischung: Standard (alles Mosaik), nie eine teilweise Reparatur; die Wahl schreibt eine gueltige
  for (const kaputt of [null, undefined, 3, { gesicht: 'x', flaeche: 'mosaik', woerter: false }, { gesicht: 'mia' }]) {
    const t = faceSchreibteil({ ...alt, custom: kaputt }, 'blur', ALLES);
    assert.deepEqual(t.custom, { gesicht: 'blur', flaeche: 'mosaik', woerter: false });
  }
  assert.deepEqual(flaecheSchreibteil({ custom: 'kaputt' }, 'schwarz', ALLES).custom, { gesicht: 'mosaik', flaeche: 'schwarz', woerter: false });
  assert.deepEqual(woerterSchreibteil({ custom: null }, true).custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: true });
});

test('U1: Flaeche und Woerter schreiben nur ihr Feld', () => {
  for (const gesicht of CUSTOM_GESICHT) for (const flaeche of CUSTOM_FLAECHE) for (const woerter of [true, false]) {
    const alt = { custom: { gesicht, flaeche, woerter } };
    for (const neu of FLAECHE_WAHLEN) assert.deepEqual(flaecheSchreibteil(alt, neu, ALLES).custom, { gesicht, flaeche: neu, woerter });
    for (const an of [true, false]) assert.deepEqual(woerterSchreibteil(alt, an).custom, { gesicht, flaeche, woerter: an });
  }
});

// ---------- U2: Wort moeglich, gesperrt ----------
test('U2: Wort moeglich stimmt mit der Definition ueberein (ein Wort kann stehen, wo eine Behandlung mit Wort liegt), alle 40 Mischungen mit Face an und aus', () => {
  let n = 0;
  for (const gesicht of CUSTOM_GESICHT) for (const flaeche of CUSTOM_FLAECHE) for (const faceAn of [true, false]) {
    const d = customDef({ gesicht, flaeche, woerter: true });
    const erwartet = hatWort(d.koerper) || (faceAn && hatWort(d.gesicht));
    assert.equal(wortMoeglich({ gesicht, flaeche }, faceAn), erwartet, `${gesicht}/${flaeche}/${faceAn}`);
    n++;
  }
  assert.equal(n, 40);
  // die Faelle aus B5 ausdruecklich
  assert.equal(wortMoeglich({ gesicht: 'mosaik', flaeche: 'blur' }, false), false);
  assert.equal(wortMoeglich({ gesicht: 'mosaik', flaeche: 'blur' }, true), true);
  assert.equal(wortMoeglich({ gesicht: 'blur', flaeche: 'sticker' }, true), false);
  assert.equal(wortMoeglich({ gesicht: 'mia', flaeche: 'sticker' }, true), false);
  assert.equal(wortMoeglich({ gesicht: 'sticker', flaeche: 'blur' }, true), false);
  assert.equal(wortMoeglich({ gesicht: 'blur', flaeche: 'schwarz' }, false), true);
});

test('U2: gesperrt (Mias Gesicht ohne stil:mia-patch, Sticker an Gesicht und Flaeche ohne zensur:sticker), gespeichert gesperrt', () => {
  const keins = { mia: false, sticker: false };
  const nurMia = { mia: true, sticker: false };
  const nurSticker = { mia: false, sticker: true };
  const alles = { mia: true, sticker: true };
  for (const w of FACE_WAHLEN) {
    assert.equal(faceGesperrt(w, alles), false);
    assert.equal(faceGesperrt(w, keins), w === 'mia' || w === 'sticker');
    assert.equal(faceGesperrt(w, nurMia), w === 'sticker');
    assert.equal(faceGesperrt(w, nurSticker), w === 'mia');
  }
  for (const w of FLAECHE_WAHLEN) {
    assert.equal(flaecheGesperrt(w, alles), false);
    assert.equal(flaecheGesperrt(w, keins), w === 'sticker');
    assert.equal(flaecheGesperrt(w, nurMia), w === 'sticker');
  }
  // gespeichert gesperrt: das Gesicht zaehlt nur bei Face an
  assert.deepEqual(gespeichertGesperrt(stand(true, false, 'mia'), keins), { face: true, flaeche: false });
  assert.deepEqual(gespeichertGesperrt(stand(false, false, 'mia'), keins), { face: false, flaeche: false });
  assert.deepEqual(gespeichertGesperrt({ ...stand(true, false, 'blur'), custom: { gesicht: 'blur', flaeche: 'sticker', woerter: false } }, keins), { face: false, flaeche: true });
  assert.deepEqual(gespeichertGesperrt(stand(true, false, 'mia'), alles), { face: false, flaeche: false });
});

// ---------- Popup: ein Satz, wenn ein Baustein ersetzt wird ----------
const PACK_NUR_STICKER = { id: 'p', version: '1', titel: 'P', freischaltungen: ['zensur:sticker'], bilder: 0, vorschau: 0, chibis: 0, werbung: 0, sticker: 3, groesse: 1, importiert: 7 };
const PACK_NUR_MIA = { ...PACK_NUR_STICKER, freischaltungen: ['stil:mia-patch'], bilder: 3, sticker: 0 };
const PACK_ALLES = { ...PACK_NUR_STICKER, freischaltungen: ['stil:mia-patch', 'zensur:sticker'], bilder: 3 };
const popup = (einst, pack, faceAn = true) => {
  const e = vervollstaendige({ ...STANDARD, ...einst, zonen: { ...STANDARD.zonen, face: { an: faceAn } } });
  return popupStilText({ def: presetDef(e, pack), faceAn: e.zonen.face.an, frei: !!pack && pack.freischaltungen.includes('stil:mia-patch'), mitSticker: !!pack && pack.freischaltungen.includes('zensur:sticker'), pack, gesichterMit: null, bisDahin: ' Until then I use Mosaic.' });
};

test('Popup: Custom mit ersetztem Baustein sagt den einen Satz, in jeder Lage (kein Pack, Pack nur mit Stickern, Pack nur mit Gesicht)', () => {
  const SATZ = 'Part of your mix needs my Pack. That part is Mosaic for now.';
  assert.equal(BAUKASTEN_TEXTE.gespeichertGesperrt, SATZ);
  const miaUndSticker = { preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } };
  // genau die Lage der Leitung: Pack nur mit Stickern (ohne stil:mia-patch), Mischung mit mia und sticker: bisher blieb der Hinweis leer
  assert.deepEqual(popup(miaUndSticker, PACK_NUR_STICKER), { text: SATZ, gesperrt: true });
  assert.deepEqual(popup(miaUndSticker, PACK_NUR_MIA), { text: SATZ, gesperrt: true });
  assert.deepEqual(popup(miaUndSticker, null), { text: SATZ, gesperrt: true });
  assert.deepEqual(popup({ preset: 'custom', custom: { gesicht: 'mia', flaeche: 'blur', woerter: false } }, PACK_NUR_STICKER), { text: SATZ, gesperrt: true });
  assert.deepEqual(popup({ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'sticker', woerter: false } }, null), { text: SATZ, gesperrt: true });
  // nichts ersetzt: der Satz zum Stil, kein Hinweis zum Pack
  const frei = popup(miaUndSticker, PACK_ALLES);
  assert.equal(frei.gesperrt, false);
  assert.ok(frei.text.startsWith('You pick the face'), frei.text);
  const klassisch = popup({ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'schwarz', woerter: false } }, null);
  assert.equal(klassisch.gesperrt, false);
  // Bestand: die zwoelf Presets sagen es wie bisher (ohne Pack mit dem Satz "Until then")
  assert.ok(popup({ preset: 'mia-wort' }, null).text.endsWith(' Until then I use Mosaic.'));
  assert.equal(popup({ preset: 'mia-wort' }, null).gesperrt, true);
  assert.equal(popup({ preset: 'mosaik' }, null).gesperrt, false);
});

// ---------- Schau gesperrter Stile: die Rechnung ----------
const b = (k) => BEISPIELE.find((x) => x.kennung === k);
const eingabe = (teil = {}) => ({ einstellungen: vervollstaendige({ ...STANDARD }), pack: null, gesichter: null, bild: 'portraet', breite: b('portraet').breite, hoehe: b('portraet').hoehe, ...teil });

test('Schau: gerechnet wird der angetippte Stil wie mit Pack gewaehlt (gleiche Flaechen wie mit echtem Pack), ohne Pack-Stand und ohne Gesichts- und Stickerwahl aus dem Pack', () => {
  const zonen = { ...STANDARD.zonen, face: { an: true }, head: { an: true } };
  for (const preset of ['mia-wort', 'mia-mosaik', 'mia-sticker', 'sticker']) {
    const einst = vervollstaendige({ ...STANDARD, zonen, preset });
    const schau = rechneVorschau(eingabe({ einstellungen: einst, schau: true }));
    const echt = rechneVorschau(eingabe({ einstellungen: einst, pack: { ...PACK_ALLES, importiert: 1 } }));
    assert.equal(schau.schau, true);
    assert.equal(schau.gilt.id, preset);
    assert.deepEqual(schau.flaechen, echt.flaechen, preset);
    assert.equal(schau.packStand, undefined);
    assert.equal(schau.nutztGesicht, false);
    assert.equal(schau.nutztSticker, false);
    // ohne die Schau gilt ohne Pack Mosaik, mit der Schau nie
    assert.notEqual(rechneVorschau(eingabe({ einstellungen: einst })).gilt.id, preset);
  }
});

test('Schau: Custom mit gesperrtem Baustein, der Schluessel des Zeichnens unterscheidet Schau und Wirklichkeit und jeden Baustein', () => {
  const mix = (gesicht, flaeche) => vervollstaendige({ ...STANDARD, zonen: { ...STANDARD.zonen, face: { an: true } }, preset: 'custom', custom: { gesicht, flaeche, woerter: false } });
  const a = zeichenSchluessel(eingabe({ einstellungen: mix('mia', 'sticker') }));
  const s = zeichenSchluessel(eingabe({ einstellungen: mix('mia', 'sticker'), schau: true }));
  assert.notEqual(a, s);
  assert.notEqual(zeichenSchluessel(eingabe({ einstellungen: mix('sticker', 'sticker'), schau: true })), s);
  assert.equal(zeichenSchluessel(eingabe({ einstellungen: mix('mia', 'sticker'), schau: true })), s); // gleiche Eingabe, gleicher Schluessel
  const r = rechneVorschau(eingabe({ einstellungen: mix('mia', 'sticker'), schau: true }));
  assert.equal(r.gilt.gesicht, 'mia-gesicht');
  assert.equal(r.gilt.koerper, 'sticker');
});

test('Schau: das gedachte Pack ist nur ein Wert (alles frei, nichts importiert), die gedachten Einstellungen setzen den Teil ueber die des Nutzers', () => {
  assert.deepEqual(SCHAU_PACK.freischaltungen, ['stil:mia-patch', 'zensur:sticker']);
  assert.equal(SCHAU_PACK.importiert, 0);
  const e = vervollstaendige({ ...STANDARD });
  const g = schauEinstellungen(e, { preset: 'mia-wort', zonen: { ...e.zonen, face: { an: true } } });
  assert.equal(g.preset, 'mia-wort');
  assert.equal(g.zonen.face.an, true);
  assert.equal(e.preset, STANDARD.preset); // der Stand des Nutzers bleibt unberuehrt
  assert.equal(e.zonen.face.an, false);
});

// ---------- M2: der Satz im Popup nur, wenn der ersetzte Baustein wirklich wirkt ----------
test('Popup M2: Mias Gesicht gesperrt bei Face aus sagt nichts (das Gesicht bleibt offen), bei Face an den einen Satz', () => {
  const SATZ = 'Part of your mix needs my Pack. That part is Mosaic for now.';
  const mia = { preset: 'custom', custom: { gesicht: 'mia', flaeche: 'blur', woerter: false } };
  for (const pack of [null, PACK_NUR_STICKER]) {
    const aus = popup(mia, pack, false);
    assert.equal(aus.gesperrt, false);
    assert.notEqual(aus.text, SATZ);
    assert.deepEqual(popup(mia, pack, true), { text: SATZ, gesperrt: true });
  }
  // die Flaeche zaehlt unabhaengig von Face
  const stickers = { preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'sticker', woerter: false } };
  assert.deepEqual(popup(stickers, null, false), { text: SATZ, gesperrt: true });
  // mit dem Pack, das alles frei hat, nie
  assert.equal(popup(mia, PACK_ALLES, true).gesperrt, false);
});

// ---------- N4: ein gesperrter Baustein ist in der Logik nicht speicherbar ----------
test('N4: faceSchreibteil und flaecheSchreibteil liefern fuer einen gesperrten Baustein keinen Schreibteil', () => {
  const alt = stand(true, false, 'mosaik');
  const keins = { mia: false, sticker: false };
  const nurMia = { mia: true, sticker: false };
  for (const w of FACE_WAHLEN) {
    assert.equal(faceSchreibteil(alt, w, keins) === null, w === 'mia' || w === 'sticker', `ohne Pack ${w}`);
    assert.equal(faceSchreibteil(alt, w, nurMia) === null, w === 'sticker', `nur Mia ${w}`);
    assert.notEqual(faceSchreibteil(alt, w, ALLES), null);
  }
  for (const w of FLAECHE_WAHLEN) {
    assert.equal(flaecheSchreibteil(alt, w, keins) === null, w === 'sticker');
    assert.equal(flaecheSchreibteil(alt, w, nurMia) === null, w === 'sticker');
    assert.notEqual(flaecheSchreibteil(alt, w, ALLES), null);
  }
  // Nothing und Bar sind nie gesperrt
  assert.notEqual(faceSchreibteil(alt, 'nothing', keins), null);
  assert.notEqual(faceSchreibteil(alt, 'bar', keins), null);
});
