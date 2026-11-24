// Einheitstests der Rechnung der Live-Vorschau (Phase 11 E5, src/oberflaeche/vorschau/rechnung.ts): aufgeloestes Preset, Treffersatz mit und ohne Gesichtssuche (V6),
// Filter nach Schwelle, Flaechen nur ueber berechneBildFlaechen (V1), Schluessel des Zeichnens aus allen Eingaben (V8), Kennung und Pack-Stand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEISPIELE, trefferFuer } from '../../src/beispiel.ts';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { berechneBildFlaechen } from '../../src/erkenner/zonen.ts';
import { kennungImProdukt, rechneVorschau, zeichenSchluessel } from '../../src/oberflaeche/vorschau/rechnung.ts';

const einst = (teil = {}) => vervollstaendige({ ...STANDARD, ...teil });
const gesichtsZonen = { ...STANDARD.zonen, face: { an: true }, eyes: { an: true }, mouth: { an: true }, head: { an: true } };
const MIT_PACK = { id: 'p', version: '1', titel: 'P', freischaltungen: ['stil:mia-patch', 'zensur:sticker'], bilder: 3, vorschau: 0, chibis: 0, werbung: 0, sticker: 3, groesse: 1, importiert: 7 };
const bild = (k) => BEISPIELE.find((b) => b.kennung === k);
const eingabe = (teil = {}) => ({ einstellungen: einst(), pack: null, gesichter: null, bild: 'vorn', breite: bild('vorn').breite, hoehe: bild('vorn').hoehe, ...teil });

test('ohne Pack gilt der Ersatz, nicht das gewaehlte Preset (die echte Zensur bekommt das aufgeloeste)', () => {
  const r = rechneVorschau(eingabe({ einstellungen: einst({ preset: 'mia-wort' }) }));
  assert.notEqual(r.gilt.id, 'mia-wort');
  assert.equal(r.e.preset, r.gilt.id);
  const mit = rechneVorschau(eingabe({ einstellungen: einst({ preset: 'mia-wort' }), pack: MIT_PACK }));
  assert.equal(mit.gilt.id, 'mia-wort');
  assert.equal(mit.e.preset, 'mia-wort');
});

test('Treffersatz: mit Gesichtssuche genau unter der Bedingung des Erkenners (V6), drei Faelle', () => {
  assert.equal(rechneVorschau(eingabe()).mitGesichtssuche, false); // Standard-Zonen, keine Gesichtszone
  assert.equal(rechneVorschau(eingabe({ einstellungen: einst({ zonen: gesichtsZonen }) })).mitGesichtssuche, true);
  assert.equal(rechneVorschau(eingabe({ einstellungen: einst({ preset: 'zensurbalken' }) })).mitGesichtssuche, true); // Balken: Augen laufen mit
  const mit = rechneVorschau(eingabe({ einstellungen: einst({ zonen: gesichtsZonen }) }));
  assert.deepEqual(
    mit.treffer.map((t) => t.score),
    trefferFuer('vorn', true).filter((t) => t.score >= 0.1).map((t) => t.score),
  );
});

test('Schwelle: nur Treffer mit score >= Schwelle, bei 0,25 nie mehr als bei 0,1', () => {
  const a = rechneVorschau(eingabe({ einstellungen: einst({ schwelle: 0.1 }) }));
  const b = rechneVorschau(eingabe({ einstellungen: einst({ schwelle: 0.25 }) }));
  assert.ok(b.treffer.length <= a.treffer.length);
  // Nur Modell-Treffer filtert der Erkenner nach der Schwelle (`nachverarbeite`); YuNet hat eine eigene Schwelle (0,75) und bleibt bei jeder Schwelle der Einstellung.
  assert.ok(b.treffer.filter((t) => t.quelle !== 'yunet').every((t) => t.score >= 0.25));
  const gz = { einstellungen: einst({ schwelle: 0.25, zonen: gesichtsZonen }) };
  const mitY = rechneVorschau(eingabe(gz)).treffer;
  const yAbgelegt = trefferFuer('vorn', true).filter((t) => t.quelle === 'yunet');
  assert.ok(yAbgelegt.length > 0);
  assert.equal(mitY.filter((t) => t.quelle === 'yunet').length, yAbgelegt.length);
  assert.ok(mitY.filter((t) => t.quelle !== 'yunet').every((t) => t.score >= 0.25));
});

test('Flaechen kommen aus berechneBildFlaechen mit verschmelzen = true, nur Standard-Zonen: etwas zu verdecken', () => {
  for (const k of ['vorn', 'rueck', 'sitz', 'portraet']) {
    const r = rechneVorschau(eingabe({ bild: k, breite: bild(k).breite, hoehe: bild(k).hoehe }));
    const direkt = berechneBildFlaechen(r.treffer, r.treffer, r.e, false, bild(k).breite, bild(k).hoehe, true);
    assert.deepEqual(r.flaechen, direkt);
  }
  assert.ok(rechneVorschau(eingabe()).flaechen.length > 0);
});

test('Eye bar und Wort-Themen gehen in die Einstellungen der echten Zensur, Kennung und Pack-Stand stimmen', () => {
  const r = rechneVorschau(eingabe({ einstellungen: einst({ augenbalken: true, woerterThemen: ['a'], preset: 'mia-mosaik-wort' }), pack: MIT_PACK }));
  assert.equal(r.e.augenbalken, true);
  assert.deepEqual(r.e.woerterThemen, ['a']);
  assert.equal(r.packStand, 7);
  assert.equal(r.kennung, kennungImProdukt('vorn'));
  assert.equal(kennungImProdukt('sitz'), 'beispiel:sitz');
  assert.equal(rechneVorschau(eingabe({ kennungTest: 'daten:1:2' })).kennung, 'daten:1:2');
  assert.equal(rechneVorschau(eingabe({ einstellungen: einst({ preset: 'mosaik' }) })).packStand, undefined); // Mosaik nutzt das Pack nicht
});

test('Schluessel des Zeichnens: gleich bei gleichen Eingaben, anders bei jeder einzelnen Aenderung (V8)', () => {
  const basis = eingabe({ einstellungen: einst({ preset: 'mia-mosaik' }), pack: MIT_PACK, gesichter: { fertig: false, mit: 0 } });
  const s0 = zeichenSchluessel(basis);
  assert.equal(zeichenSchluessel({ ...basis }), s0);
  const e = basis.einstellungen;
  const aenderungen = {
    preset: { einstellungen: { ...e, preset: 'mia-blur' } },
    augenbalken: { einstellungen: { ...e, augenbalken: true } },
    zone: { einstellungen: { ...e, zonen: { ...e.zonen, belly: { an: true, bedeckt: false } } } },
    kleidung: { einstellungen: { ...e, zonen: { ...e.zonen, breast: { an: true, bedeckt: true } } } },
    rand: { einstellungen: { ...e, rand: 0.2 } },
    schwelle: { einstellungen: { ...e, schwelle: 0.2 } },
    themen: { einstellungen: { ...e, woerterThemen: [] } },
    packStand: { pack: { ...MIT_PACK, importiert: 8 } },
    packWeg: { pack: null },
    gesichtFertig: { gesichter: { fertig: true, mit: 1 } },
    bild: { bild: 'rueck' },
    kennung: { kennungTest: 'x' },
  };
  for (const [name, teil] of Object.entries(aenderungen)) assert.notEqual(zeichenSchluessel({ ...basis, ...teil }), s0, name);
  // Der Gesichtsstand zaehlt nur bei einem Preset mit Mias Gesicht
  const ohne = eingabe({ einstellungen: einst({ preset: 'mosaik' }) });
  assert.equal(zeichenSchluessel({ ...ohne, gesichter: { fertig: true, mit: 2 } }), zeichenSchluessel(ohne));
});
