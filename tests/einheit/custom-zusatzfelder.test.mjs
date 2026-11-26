// Einheitstests zu Custom, Phase 11 Etappe 7a: (A2) feste, von Hand geschriebene Nachrichten an den Erkenner statt einer Nachricht aus derselben Funktion wie das Produkt,
// (A3) fremde Zusatzfelder und Prototyp-Schluessel in einer Mischung, (A4) die Schau und eine Pack-Kennung `schau` geben nie denselben Schluessel,
// (A6) die gemeinsame Funktion der Einstellungen an `pruefe` liefert genau die Felder, die der Schleier schickt, und die Vorschau rechnet mit denselben.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEISPIELE } from '../../src/beispiel.ts';
import { STANDARD, vervollstaendige, waehleCustom } from '../../src/einstellungen.ts';
import { presetDef } from '../../src/preset-def.ts';
import { pruefeCustom } from '../../src/presets.ts';
import { presetWahlFuerPackKurz } from '../../src/pack/vertrag.ts';
import { baueErkennerEinstellungen } from '../../src/pruef-einstellungen.ts';
import { erkennerEinstellungen, schauEinstellungen, zeichenSchluessel } from '../../src/oberflaeche/vorschau/rechnung.ts';

const PACK = { id: 'p', version: '1', titel: 'P', freischaltungen: ['stil:mia-patch', 'zensur:sticker'], bilder: 3, vorschau: 0, chibis: 0, werbung: 0, sticker: 3, groesse: 1, importiert: 7 };
const NUR_STICKER = { ...PACK, freischaltungen: ['zensur:sticker'] };
const DREI = ['flaeche', 'gesicht', 'woerter'];

// ---------- A2: feste Nachrichten, von Hand geschrieben ----------

// Die Nachricht, wie der Schleier sie baut (schleier.ts: presetWahlFuerPackKurz, pruefung.ts: baueErkennerEinstellungen), ohne Steigerung. Die Erwartung steht je Fall als
// feste Nachricht im Test, nicht als Rechnung.
const nachricht = (einstRoh, pack, packStand) => {
  const e = vervollstaendige({ version: 1, ...einstRoh });
  return baueErkennerEinstellungen(e, presetWahlFuerPackKurz(e, pack), packStand === undefined ? {} : { packStand });
};
const ZONEN_STANDARD = vervollstaendige({}).zonen;

test('A2: feste Nachrichten an den Erkenner (ohne Pack: Mias Gesicht und Sticker werden bausteinweise Mosaik; mit Pack: die Mischung bleibt)', () => {
  const faelle = [
    [{ preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } }, null, undefined, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } }],
    [{ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'schwarz', woerter: true } }, null, 0, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'blur', flaeche: 'schwarz', woerter: true }, packStand: 0 }],
    [{ preset: 'custom', custom: { gesicht: 'schwarz', flaeche: 'sticker', woerter: true } }, null, 0, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'schwarz', flaeche: 'mosaik', woerter: true }, packStand: 0 }],
    [{ preset: 'custom', custom: { gesicht: 'mia', flaeche: 'schwarz', woerter: true } }, null, 0, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'schwarz', woerter: true }, packStand: 0 }],
    [{ preset: 'custom', custom: { gesicht: 'sticker', flaeche: 'mosaik', woerter: false } }, null, undefined, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false } }],
    // nur Sticker im Pack: das Gesicht Mia wird Mosaik, der Sticker bleibt
    [{ preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } }, NUR_STICKER, 7, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'sticker', woerter: false }, packStand: 7 }],
    // mit vollem Pack bleibt alles
    [{ preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } }, PACK, 7, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false }, packStand: 7 }],
    // Eye bar und Themen gehen mit; ein Preset der Tabelle traegt keine Mischung
    [{ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'blur', woerter: false }, augenbalken: true, woerterThemen: ['a'] }, null, undefined, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'custom', custom: { gesicht: 'blur', flaeche: 'blur', woerter: false }, augenbalken: true, woerterThemen: ['a'] }],
    [{ preset: 'blur' }, null, undefined, { schwelle: 0.1, zonen: ZONEN_STANDARD, rand: 0.15, preset: 'blur' }],
  ];
  for (const [roh, pack, packStand, soll] of faelle) {
    assert.deepEqual(nachricht(roh, pack, packStand), soll, JSON.stringify(roh));
    // die Vorschau rechnet mit derselben Wahl (die Felder der Nachricht stehen in `e`, `vervollstaendige` fuellt nur den Rest)
    const { e } = erkennerEinstellungen(vervollstaendige({ version: 1, ...roh }), pack);
    for (const [k, v] of Object.entries(soll)) if (k !== 'packStand') assert.deepEqual(e[k], v, `${JSON.stringify(roh)}: ${k} in der Vorschau`);
  }
});

test('A6: die gemeinsame Funktion setzt genau die Felder, die gesetzt sind (kein Feld mehr, keins weniger), Zonen der Steigerung gehen vor', () => {
  const e = vervollstaendige({ version: 1 });
  const wahl = { preset: 'mosaik' };
  assert.deepEqual(Object.keys(baueErkennerEinstellungen(e, wahl)).sort(), ['preset', 'rand', 'schwelle', 'zonen']);
  const alles = baueErkennerEinstellungen({ ...e, augenbalken: true, woerterThemen: [] }, { preset: 'custom', custom: { gesicht: 'blur', flaeche: 'blur', woerter: true } }, { packStand: 0, ganzVerdecken: true, zonen: { ...e.zonen, face: { an: true } } });
  assert.deepEqual(Object.keys(alles).sort(), ['augenbalken', 'custom', 'ganzVerdecken', 'packStand', 'preset', 'rand', 'schwelle', 'woerterThemen', 'zonen']);
  assert.equal(alles.packStand, 0, 'packStand 0 geht mit');
  assert.equal(alles.zonen.face.an, true);
  assert.deepEqual(alles.woerterThemen, []);
  // ausgeschaltet: nichts davon steht in der Nachricht
  const aus = baueErkennerEinstellungen({ ...e, augenbalken: false, woerterThemen: null }, wahl, { ganzVerdecken: false });
  assert.deepEqual(Object.keys(aus).sort(), ['preset', 'rand', 'schwelle', 'zonen']);
  assert.equal(aus.zonen, e.zonen);
});

// ---------- A3: fremde Zusatzfelder und Prototyp-Schluessel ----------

test('A3: ein Zusatzfeld ergibt genau die drei bekannten Felder (pruefeCustom, vervollstaendige, waehleCustom, Nachricht an den Erkenner)', () => {
  const roh = { gesicht: 'blur', flaeche: 'schwarz', woerter: true, zusatz: 'x', verschachtelt: { a: 1 } };
  const m = pruefeCustom(roh);
  assert.deepEqual(m, { gesicht: 'blur', flaeche: 'schwarz', woerter: true });
  assert.deepEqual(Object.keys(m).sort(), DREI);
  assert.ok(Object.isFrozen(m));
  assert.notEqual(m, roh);
  // Speicher: was `vervollstaendige` und `waehleCustom` zurueckgeben, ist das, was in den Speicher geht
  const v = vervollstaendige({ version: 1, preset: 'custom', custom: roh });
  assert.deepEqual(Object.keys(v.custom).sort(), DREI);
  assert.ok(!JSON.stringify(v).includes('zusatz') && !JSON.stringify(v).includes('verschachtelt'));
  const w = waehleCustom({ preset: 'mosaik', zonen: STANDARD.zonen }, roh);
  assert.deepEqual(Object.keys(w.teil.custom).sort(), DREI);
  assert.ok(!JSON.stringify(w).includes('zusatz'));
  // Nachricht an den Erkenner: mit und ohne Pack, die Mischung dort hat nur die drei Felder
  for (const pack of [null, PACK]) {
    const n = baueErkennerEinstellungen(v, presetWahlFuerPackKurz(v, pack));
    assert.deepEqual(Object.keys(n.custom).sort(), DREI);
    assert.ok(!JSON.stringify(n).includes('zusatz') && !JSON.stringify(n).includes('verschachtelt'));
    assert.ok(!JSON.stringify(erkennerEinstellungen(v, pack).e).includes('zusatz'));
  }
  // der Rest der Einstellungen bleibt unberuehrt
  assert.equal(presetDef(v, PACK).gilt.id, presetDef(vervollstaendige({ version: 1, preset: 'custom', custom: { gesicht: 'blur', flaeche: 'schwarz', woerter: true } }), PACK).gilt.id);
});

test('A3: ein ungueltiger bekannter Wert macht die ganze Mischung ungueltig (dann Mosaik), auch neben einem Zusatzfeld', () => {
  for (const roh of [
    { gesicht: 'gibt-es-nicht', flaeche: 'schwarz', woerter: true, zusatz: 1 },
    { gesicht: 'blur', flaeche: 'schwarz', woerter: 'ja', zusatz: 1 },
    { gesicht: 'blur', flaeche: 7, woerter: true, zusatz: 1 },
    { gesicht: 'blur', flaeche: 'schwarz', zusatz: 1 },
  ]) {
    assert.equal(pruefeCustom(roh), null, JSON.stringify(roh));
    const v = vervollstaendige({ version: 1, preset: 'custom', custom: roh });
    assert.deepEqual(v.custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false }, 'Standard, keine halbe Reparatur');
    assert.deepEqual(baueErkennerEinstellungen(v, presetWahlFuerPackKurz(v, PACK)).custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false });
  }
});

test('A3: Prototyp-Schluessel als Zusatzfeld aendern nichts, und eine Mischung nur ueber die Prototypkette zaehlt nicht', () => {
  const rein = { gesicht: 'blur', flaeche: 'schwarz', woerter: true };
  // JSON.parse legt `__proto__` als eigenes Feld an (ein Objektliteral taete es nicht)
  const mitProto = JSON.parse('{"gesicht":"blur","flaeche":"schwarz","woerter":true,"__proto__":{"gesicht":"mia","polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":1}');
  assert.ok(Object.hasOwn(mitProto, '__proto__'), 'Vorbedingung: __proto__ ist ein eigenes Feld');
  const m = pruefeCustom(mitProto);
  assert.deepEqual(m, rein);
  assert.deepEqual(Object.keys(m).sort(), DREI);
  assert.equal(Object.getPrototypeOf(m), Object.prototype);
  assert.equal(Object.hasOwn(m, '__proto__'), false);
  assert.equal(m.polluted, undefined);
  const v = vervollstaendige({ version: 1, preset: 'custom', custom: mitProto });
  assert.deepEqual(Object.keys(v.custom).sort(), DREI);
  assert.deepEqual(v.custom, rein);
  const n = baueErkennerEinstellungen(v, presetWahlFuerPackKurz(v, PACK));
  assert.deepEqual(n.custom, rein);
  assert.equal(JSON.stringify(n).includes('polluted'), false);
  // dieselbe Mischung mit und ohne die Prototyp-Felder: gleicher Schluessel des Zeichnens
  const ein = (custom) => ({ einstellungen: vervollstaendige({ version: 1, preset: 'custom', custom }), pack: PACK, gesichter: null, bild: 'vorn', breite: 10, hoehe: 10 });
  assert.equal(zeichenSchluessel(ein(mitProto)), zeichenSchluessel(ein(rein)));
  // nichts ist global verschmutzt
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  // Felder nur ueber die Prototypkette zaehlen nicht (die Pruefung nimmt nur eigene Felder)
  assert.equal(pruefeCustom(Object.create(rein)), null);
  assert.equal(pruefeCustom(JSON.parse('{"__proto__":{"gesicht":"blur","flaeche":"schwarz","woerter":true}}')), null);
  // `waehleCustom` nimmt auch hier nur die drei Felder
  assert.deepEqual(waehleCustom({ preset: 'mosaik', zonen: STANDARD.zonen }, mitProto).teil.custom, rein);
});

// ---------- A4: Schau und Pack-Kennung `schau` ----------

test('A4: ein Pack mit der Kennung `schau` gibt nie denselben Schluessel wie die Schau (gleiche Einstellungen, gleiches Bild)', () => {
  const b = BEISPIELE[0];
  const einst = vervollstaendige({ version: 1, preset: 'mosaik' }); // ein Stil ohne Pack-Anteil: sonst unterschiede schon der Stand der Gesichtssuche
  const grund = { einstellungen: einst, gesichter: null, bild: b.kennung, breite: b.breite, hoehe: b.hoehe };
  const schau = zeichenSchluessel({ ...grund, pack: null, schau: true });
  const packSchau = { ...PACK, id: 'schau', importiert: 0, sticker: 0 };
  assert.notEqual(zeichenSchluessel({ ...grund, pack: packSchau }), schau, 'Pack `schau` ist nicht die Schau');
  assert.notEqual(zeichenSchluessel({ ...grund, pack: packSchau, schau: true }), zeichenSchluessel({ ...grund, pack: packSchau }));
  // und weiter: ohne Pack ist es auch nicht die Schau, und jede andere Kennung auch nicht
  for (const id of ['schau', 'Schau', 'SCHAU', 'schau ', '', '0', 'null']) {
    assert.notEqual(zeichenSchluessel({ ...grund, pack: { ...PACK, id, importiert: 0, sticker: 0 } }), schau, `Kennung ${JSON.stringify(id)}`);
  }
  assert.notEqual(zeichenSchluessel({ ...grund, pack: null }), schau);
  // die Schau selbst bleibt stabil
  assert.equal(zeichenSchluessel({ ...grund, pack: null, schau: true }), schau);
  assert.equal(zeichenSchluessel({ ...grund, pack: PACK, schau: true }), zeichenSchluessel({ ...grund, pack: null, schau: true }), 'in der Schau zaehlt das echte Pack nicht');
});

// ---------- A6: die Vorschau und der Schleier bauen dieselben Felder ----------

test('A6: schauEinstellungen und erkennerEinstellungen bleiben, wie sie waren (feste Werte)', () => {
  const einst = vervollstaendige({ version: 1, preset: 'zensurbalken', augenbalken: true, woerterThemen: ['x'], schwelle: 0.2, rand: 0.2 });
  const { e, gilt } = erkennerEinstellungen(einst, null);
  assert.equal(gilt.id, 'zensurbalken');
  assert.equal(e.preset, 'zensurbalken');
  assert.equal(e.schwelle, 0.2);
  assert.equal(e.rand, 0.2);
  assert.equal(e.augenbalken, true);
  assert.deepEqual(e.woerterThemen, ['x']);
  assert.deepEqual(e.zonen, einst.zonen);
  const s = schauEinstellungen(einst, { preset: 'mosaik' });
  assert.equal(s.preset, 'mosaik');
});
