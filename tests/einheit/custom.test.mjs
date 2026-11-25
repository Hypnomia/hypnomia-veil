// Einheitstests des Custom-Baukastens (Phase 11 E6a, Regeln C1 bis C14): T1 alle 40 Mischungen mal vier Pack-Staende, T2 Tabelle ungueltiger Werte, T4 keine Verwechslung
// der Mischungen (Definitionen, Eye bar, Schluessel der Vorschau), dazu Speicherwert, Wahl von Face (C10), Hilfsfunktionen je Kennung (C6), Weg zum Erkenner (C7)
// und Bestand unveraendert (C14). Die Soll-Werte stehen hier aus der Regel der Planung (C2, C5), nicht aus dem Code.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CUSTOM_FLAECHE,
  CUSTOM_GESICHT,
  CUSTOM_STANDARD,
  PRESETS,
  PRESET_IDS,
  behandlungFuerZone,
  customDef,
  customKennung,
  ganzesBildBehandlung,
  nutztMiasGesicht,
  nutztSticker,
  presetFuerPack,
  presetOderMosaik,
  pruefeCustom,
  stilHatBalken,
  wahlAusDef,
  wirkKennungVon,
  zonenFuerPreset,
} from '../../src/presets.ts';
import { presetDef, presetDefFuerKennung, presetKatalog } from '../../src/preset-def.ts';
import { STANDARD, vervollstaendige, waehleCustom, waehlePreset } from '../../src/einstellungen.ts';
import { berechneBildFlaechen, berechneFlaechen } from '../../src/erkenner/zonen.ts';
import { presetFuerPackKurz, presetWahlFuerPackKurz } from '../../src/pack/vertrag.ts';
import { erkennerEinstellungen, zeichenSchluessel } from '../../src/oberflaeche/vorschau/rechnung.ts';
import { BEISPIELE } from '../../src/beispiel.ts';

const PACKS = {
  keins: null,
  nurPatch: { freischaltungen: ['stil:mia-patch'] },
  nurSticker: { freischaltungen: ['zensur:sticker'] },
  beide: { freischaltungen: ['stil:mia-patch', 'zensur:sticker'] },
};
const PACK_STAND = { id: 'p', version: '1', titel: 'P', freischaltungen: ['stil:mia-patch', 'zensur:sticker'], bilder: 3, vorschau: 0, chibis: 0, werbung: 0, sticker: 3, groesse: 1, importiert: 7 };
const DECKEND = new Set(['mosaik', 'mosaik-wort', 'blur', 'schwarz', 'schwarz-wort', 'mia-gesicht', 'sticker']);

const MISCHUNGEN = [];
for (const gesicht of CUSTOM_GESICHT) for (const flaeche of CUSTOM_FLAECHE) for (const woerter of [false, true]) MISCHUNGEN.push({ gesicht, flaeche, woerter });

// Soll aus C2: Baustein plus Woerter auf die Behandlung.
function sollBehandlung(baustein, woerter) {
  switch (baustein) {
    case 'mia':
      return 'mia-gesicht';
    case 'sticker':
      return 'sticker';
    case 'blur':
      return 'blur';
    case 'mosaik':
      return woerter ? 'mosaik-wort' : 'mosaik';
    case 'schwarz':
      return woerter ? 'schwarz-wort' : 'schwarz';
  }
  throw new Error(`unbekannter Baustein ${baustein}`);
}
// Soll aus C5: bausteinweise ersetzen.
function sollGiltMischung(m, pack) {
  const mia = !!pack && pack.freischaltungen.includes('stil:mia-patch');
  const sticker = !!pack && pack.freischaltungen.includes('zensur:sticker');
  return {
    gesicht: (m.gesicht === 'mia' && !mia) || (m.gesicht === 'sticker' && !sticker) ? 'mosaik' : m.gesicht,
    flaeche: m.flaeche === 'sticker' && !sticker ? 'mosaik' : m.flaeche,
    woerter: m.woerter,
  };
}
const sollBraucht = (g, k) => (g === 'sticker' || k === 'sticker' ? 'sticker' : g === 'mia-gesicht' ? 'pack' : null);

test('T1: 40 Mischungen, gewaehlt nach C2, gilt nach C5, nie null, ohne Freischaltung weder Mias Gesicht noch Sticker', () => {
  assert.equal(MISCHUNGEN.length, 40);
  for (const m of MISCHUNGEN) {
    for (const [stufe, pack] of Object.entries(PACKS)) {
      const r = presetDef({ preset: 'custom', custom: m }, pack);
      const wo = `${JSON.stringify(m)}/${stufe}`;
      // gewaehlt: wie gespeichert
      const sg = sollBehandlung(m.gesicht, m.woerter);
      const sk = sollBehandlung(m.flaeche, m.woerter);
      assert.equal(r.gewaehlt.gesicht, sg, `${wo}: gewaehlt.gesicht`);
      assert.equal(r.gewaehlt.koerper, sk, `${wo}: gewaehlt.koerper`);
      assert.equal(r.gewaehlt.augen, 'wie-koerper', wo);
      assert.equal(r.gewaehlt.person, false, wo);
      assert.equal(r.gewaehlt.woerter, sg.endsWith('-wort') || sk.endsWith('-wort'), `${wo}: woerter`);
      assert.equal(r.gewaehlt.braucht, sollBraucht(sg, sk), `${wo}: braucht gewaehlt`);
      assert.deepEqual(r.gewaehlt.mischung, m, wo);
      // gilt: bausteinweise ersetzt
      const sm = sollGiltMischung(m, pack);
      const gg = sollBehandlung(sm.gesicht, sm.woerter);
      const gk = sollBehandlung(sm.flaeche, sm.woerter);
      assert.equal(r.gilt.gesicht, gg, `${wo}: gilt.gesicht`);
      assert.equal(r.gilt.koerper, gk, `${wo}: gilt.koerper`);
      assert.equal(r.gilt.braucht, sollBraucht(gg, gk), `${wo}: braucht gilt`);
      assert.equal(r.gilt.woerter, gg.endsWith('-wort') || gk.endsWith('-wort'), `${wo}: woerter gilt`);
      // Sicherheit S3: nie null, immer aus der deckenden Menge
      for (const d of [r.gewaehlt, r.gilt]) {
        assert.ok(DECKEND.has(d.gesicht), `${wo}: gesicht ${d.gesicht} deckt`);
        assert.ok(DECKEND.has(d.koerper), `${wo}: koerper ${d.koerper} deckt`);
      }
      // ohne Freischaltung kein Mia-Gesicht und kein Sticker in gilt
      if (!pack || !pack.freischaltungen.includes('stil:mia-patch')) assert.notEqual(r.gilt.gesicht, 'mia-gesicht', `${wo}: ohne Patch kein Mia-Gesicht`);
      if (!pack || !pack.freischaltungen.includes('zensur:sticker')) {
        assert.notEqual(r.gilt.gesicht, 'sticker', `${wo}: ohne Sticker kein Sticker am Gesicht`);
        assert.notEqual(r.gilt.koerper, 'sticker', `${wo}: ohne Sticker keiner an der Flaeche`);
      }
      // Eye bar aendert nur die Augen-Art, nie die Behandlungen
      const mit = presetDef({ preset: 'custom', custom: m, augenbalken: true }, pack);
      assert.equal(mit.gewaehlt.augen, 'balken-immer');
      assert.equal(mit.gilt.augen, 'balken-immer');
      assert.equal(mit.gewaehlt.gesicht, sg);
      assert.equal(mit.gilt.koerper, gk);
    }
  }
});

test('T1: Mias Gesicht ohne Patch-Freischaltung mit Sticker-Pack: nur das Gesicht wird Mosaik, die Flaeche bleibt Sticker (bausteinweise)', () => {
  const m = { gesicht: 'mia', flaeche: 'sticker', woerter: true };
  const r = presetDef({ preset: 'custom', custom: m }, PACKS.nurSticker);
  assert.equal(r.gilt.gesicht, 'mosaik-wort');
  assert.equal(r.gilt.koerper, 'sticker');
  assert.equal(r.gilt.braucht, 'sticker');
  const p = presetDef({ preset: 'custom', custom: m }, PACKS.nurPatch);
  assert.equal(p.gilt.gesicht, 'mia-gesicht');
  assert.equal(p.gilt.koerper, 'mosaik-wort');
  assert.equal(p.gilt.braucht, 'pack');
  // ohne Pack: das Wort MIA wie bei "Mosaic and words" (beide Stellen mosaik-wort)
  const k = presetDef({ preset: 'custom', custom: m }, null);
  assert.equal(k.gilt.gesicht, 'mosaik-wort');
  assert.equal(k.gilt.koerper, 'mosaik-wort');
  assert.equal(k.gilt.braucht, null);
});

test('T1: dieselbe Mischung liefert dasselbe eingefrorene Objekt, die Definition ist nur lesbar', () => {
  for (const m of MISCHUNGEN) {
    const a = presetDef({ preset: 'custom', custom: m }, PACKS.beide);
    const b = presetDef({ preset: 'custom', custom: { ...m } }, PACKS.beide);
    assert.equal(a.gewaehlt, b.gewaehlt);
    assert.equal(a.gilt, a.gewaehlt, 'mit beiden Freischaltungen ist gilt gleich gewaehlt');
    assert.ok(Object.isFrozen(a.gewaehlt));
    assert.ok(Object.isFrozen(a.gewaehlt.mischung));
    assert.equal(a.gewaehlt.name, 'Custom');
    assert.equal(a.gewaehlt.satz, 'You pick the face, the rest and the words. I do it your way.');
    assert.equal(a.gewaehlt.gruppe, 'custom');
  }
});

// ---------- T2 ----------

const PROTO_NAMEN = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];
function ungueltige() {
  const gut = { gesicht: 'blur', flaeche: 'schwarz', woerter: true };
  const faelle = [
    ['custom fehlt', undefined],
    ['null', null],
    ['Zahl 0', 0],
    ['Zahl 1', 1],
    ['true', true],
    ['Zeichenkette', 'mia'],
    ['leere Zeichenkette', ''],
    ['Zeichenkette "custom"', 'custom'],
    ['JSON-Zeichenkette', JSON.stringify(gut)],
    ['Feld (Array)', [gut]],
    ['leeres Array', []],
    ['leeres Objekt', {}],
    ['Funktion', () => gut],
    ['Objekt ohne gesicht', { flaeche: 'schwarz', woerter: true }],
    ['Objekt ohne flaeche', { gesicht: 'blur', woerter: true }],
    ['Objekt ohne woerter', { gesicht: 'blur', flaeche: 'schwarz' }],
    ['von Prototyp geerbt', Object.create(gut)],
    ['Map', new Map(Object.entries(gut))],
    ['woerter Zeichenkette true', { ...gut, woerter: 'true' }],
    ['woerter Zeichenkette false', { ...gut, woerter: 'false' }],
    ['woerter 1', { ...gut, woerter: 1 }],
    ['woerter 0', { ...gut, woerter: 0 }],
    ['woerter null', { ...gut, woerter: null }],
    ['woerter undefined', { ...gut, woerter: undefined }],
    ['woerter Objekt', { ...gut, woerter: {} }],
    ['gesicht unbekannt', { ...gut, gesicht: 'rot' }],
    ['gesicht gross', { ...gut, gesicht: 'MIA' }],
    ['gesicht Behandlung mosaik-wort', { ...gut, gesicht: 'mosaik-wort' }],
    ['gesicht Behandlung mia-gesicht', { ...gut, gesicht: 'mia-gesicht' }],
    ['gesicht leer', { ...gut, gesicht: '' }],
    ['gesicht Zahl', { ...gut, gesicht: 3 }],
    ['gesicht null', { ...gut, gesicht: null }],
    ['gesicht Array', { ...gut, gesicht: ['mia'] }],
    ['flaeche unbekannt', { ...gut, flaeche: 'rot' }],
    ['flaeche mia (nur am Gesicht erlaubt)', { ...gut, flaeche: 'mia' }],
    ['flaeche Behandlung schwarz-wort', { ...gut, flaeche: 'schwarz-wort' }],
    ['flaeche Zahl', { ...gut, flaeche: 3 }],
    ['flaeche null', { ...gut, flaeche: null }],
    ['flaeche leer', { ...gut, flaeche: '' }],
  ];
  for (const n of PROTO_NAMEN) {
    faelle.push([`gesicht ${n}`, { ...gut, gesicht: n }]);
    faelle.push([`flaeche ${n}`, { ...gut, flaeche: n }]);
    faelle.push([`woerter ${n}`, { ...gut, woerter: n }]);
    faelle.push([`custom ${n} (Zeichenkette)`, n]);
  }
  // __proto__ als eigenes Feld (JSON.parse legt es als eigenes Feld an) neben vollstaendigen Feldern ist harmlos, ohne die drei Felder ungueltig
  faelle.push(['nur __proto__ als Feld', JSON.parse('{"__proto__": {"gesicht": "blur", "flaeche": "schwarz", "woerter": true}}')]);
  return faelle;
}

test('T2: jede ungueltige Mischung ist in presetDef genau die Definition von Mosaik (gewaehlt und gilt, alle Pack-Staende, mit und ohne Eye bar)', () => {
  const faelle = ungueltige();
  assert.ok(faelle.length >= 60);
  for (const [name, wert] of faelle) {
    for (const [stufe, pack] of Object.entries(PACKS)) {
      const r = presetDef({ preset: 'custom', custom: wert }, pack);
      assert.equal(r.gewaehlt, PRESETS.mosaik, `${name}/${stufe}: gewaehlt ist Mosaik`);
      assert.equal(r.gilt, PRESETS.mosaik, `${name}/${stufe}: gilt ist Mosaik`);
    }
    const mitBalken = presetDef({ preset: 'custom', custom: wert, augenbalken: true }, PACKS.beide);
    const sollBalken = presetDef({ preset: 'mosaik', augenbalken: true }, PACKS.beide);
    assert.equal(mitBalken.gewaehlt, sollBalken.gewaehlt, `${name}: mit Eye bar dieselbe Ableitung wie Mosaik`);
    assert.equal(wirkKennungVon({ preset: 'custom', custom: wert }), 'mosaik', name);
    assert.equal(pruefeCustom(wert), null, `${name}: pruefeCustom`);
  }
});

test('T2: nach vervollstaendige steht der Standard (alles Mosaik), preset bleibt custom, nie eine teilweise Reparatur', () => {
  for (const [name, wert] of ungueltige()) {
    const e = vervollstaendige({ preset: 'custom', custom: wert });
    assert.equal(e.preset, 'custom', `${name}: preset bleibt stehen`);
    assert.deepEqual(e.custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false }, `${name}: custom ist der Standard`);
    assert.equal(presetDef(e).gewaehlt, presetOderMosaik('custom:mosaik:mosaik:-'), name);
  }
  // Teilweise Reparatur gibt es nicht: ein gutes Feld neben einem schlechten bleibt nicht stehen
  assert.deepEqual(vervollstaendige({ preset: 'custom', custom: { gesicht: 'schwarz', flaeche: 'blur', woerter: 'ja' } }).custom, CUSTOM_STANDARD);
  assert.deepEqual(vervollstaendige({ preset: 'custom', custom: { gesicht: 'schwarz', flaeche: 'mia', woerter: true } }).custom, CUSTOM_STANDARD);
  // auch bei einem anderen Preset wird eine ungueltige Mischung zum Standard (der Wert bleibt einheitlich)
  assert.deepEqual(vervollstaendige({ preset: 'blur', custom: 5 }).custom, CUSTOM_STANDARD);
  assert.equal(vervollstaendige({ preset: 'blur', custom: 5 }).preset, 'blur');
});

test('T2: der Standardwert der Mischung stimmt (C1) und die gueltige Mischung bleibt beim Laden unveraendert', () => {
  assert.deepEqual(STANDARD.custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false });
  assert.deepEqual(vervollstaendige({}).custom, { gesicht: 'mosaik', flaeche: 'mosaik', woerter: false });
  for (const m of MISCHUNGEN) {
    const e = vervollstaendige({ preset: 'custom', custom: m });
    assert.deepEqual(e.custom, m);
    assert.notEqual(e.custom, m, 'eine Kopie, nicht dasselbe Objekt');
    assert.equal(e.preset, 'custom');
    // zweimal laden aendert nichts (idempotent)
    assert.deepEqual(vervollstaendige(e), e);
  }
  // Fremde Zusatzfelder werden nicht uebernommen
  assert.deepEqual(vervollstaendige({ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'schwarz', woerter: true, extra: 1 } }).custom, { gesicht: 'blur', flaeche: 'schwarz', woerter: true });
});

test('C1: PRESET_IDS und der Katalog bleiben zwoelf, Custom ist eine eigene Kennung daneben', () => {
  assert.equal(PRESET_IDS.length, 12);
  assert.equal(presetKatalog().length, 12);
  assert.ok(!PRESET_IDS.includes('custom'));
  assert.ok(!presetKatalog().some((d) => d.id === 'custom' || d.gruppe === 'custom'));
  assert.ok(!Object.hasOwn(PRESETS, 'custom'));
  // Die blosse Kennung custom kennt keine Mischung: Mosaik (C7)
  assert.equal(presetOderMosaik('custom'), PRESETS.mosaik);
  assert.equal(presetDefFuerKennung('custom'), PRESETS.mosaik);
  assert.equal(presetDef({ preset: 'custom' }).gewaehlt, PRESETS.mosaik);
});

// ---------- C14: Bestand ----------

test('C14: die zwoelf Presets bleiben, wie sie sind; wer nie Custom gewaehlt hat, bekommt nur den Standardwert dazu', () => {
  for (const id of PRESET_IDS) {
    const e = vervollstaendige({ preset: id });
    assert.equal(e.preset, id);
    assert.deepEqual(e.custom, CUSTOM_STANDARD);
    for (const [stufe, pack] of Object.entries(PACKS)) {
      const r = presetDef({ preset: id }, pack);
      assert.equal(r.gewaehlt, PRESETS[id], `${id}/${stufe}`);
    }
  }
  // Ein alter Speicherstand ohne `custom` wird bis auf dieses Feld nicht veraendert
  const alt = { ...STANDARD };
  delete alt.custom;
  const neu = vervollstaendige(alt);
  const { custom, ...ohne } = neu;
  const { custom: _c, ...stdOhne } = STANDARD;
  assert.deepEqual(ohne, stdOhne);
  assert.deepEqual(custom, CUSTOM_STANDARD);
});

test('C14: ein veralteter stil-Wert neben preset custom wandert nicht (preset gewinnt, custom ist eine gueltige Kennung)', () => {
  const e = vervollstaendige({ preset: 'custom', stil: 'augenbalken', custom: { gesicht: 'blur', flaeche: 'blur', woerter: false } });
  assert.equal(e.preset, 'custom');
  assert.equal(e.augenbalken, false);
  assert.equal(e.hinweise.augenbalken, 'keiner');
});

// ---------- C6: Hilfsfunktionen je Kennung nie still auf Mosaik ----------

test('C6: jede Hilfsfunktion je Kennung liest die Mischung (Kennung der aufgeloesten Definition), nie still Mosaik', () => {
  for (const m of MISCHUNGEN) {
    const d = presetDef({ preset: 'custom', custom: m }, PACKS.beide).gilt;
    const sg = sollBehandlung(m.gesicht, m.woerter);
    const sk = sollBehandlung(m.flaeche, m.woerter);
    assert.equal(d.id, customKennung(m));
    assert.equal(presetDefFuerKennung(d.id), d);
    assert.equal(presetOderMosaik(d.id), d);
    assert.equal(behandlungFuerZone(d.id, 'face'), sg);
    assert.equal(behandlungFuerZone(d.id, 'breast'), sk);
    assert.equal(behandlungFuerZone(d.id, 'eyes'), sk, 'Augen wie Koerper');
    assert.equal(nutztMiasGesicht(d.id), sg === 'mia-gesicht');
    assert.equal(nutztSticker(d.id), sg === 'sticker' || sk === 'sticker');
    // ganzes Bild: die Behandlung der Flaeche, Sticker bleibt dort Mosaik wie heute
    assert.equal(ganzesBildBehandlung(d.id), sk === 'sticker' ? 'mosaik' : sk);
    assert.equal(stilHatBalken(d), false);
    const zonen = { eyes: { an: false }, face: { an: true } };
    assert.equal(zonenFuerPreset(d, zonen), zonen, 'ohne Schalter Eye bar dasselbe Objekt');
    assert.equal(zonenFuerPreset(d.id, zonen), zonen);
    const mitBalken = presetDef({ preset: 'custom', custom: m, augenbalken: true }, PACKS.beide).gewaehlt;
    assert.equal(stilHatBalken(mitBalken), false, 'Eye bar ist nur der Schalter, nie der Stil selbst');
    assert.equal(zonenFuerPreset(mitBalken, zonen), zonen, 'mit dem Schalter bleiben die Schalter des Nutzers (R11)');
    // presetFuerPack mit der Kennung einer Mischung ersetzt bausteinweise
    assert.equal(presetFuerPack(d.id, true, true), d.id);
    const ohne = sollGiltMischung(m, null);
    assert.equal(presetFuerPack(d.id, false, false), customKennung(ohne));
  }
  // Eine verfaelschte Kennung ist Mosaik
  for (const falsch of ['custom', 'custom:', 'custom:mia', 'custom:mia:mosaik', 'custom:mia:mosaik:x', 'custom:mia:mia:-', 'custom:rot:mosaik:-', 'custom:constructor:mosaik:-', 'custom:mia:mosaik:w:x', 'Custom:mia:mosaik:w', ' custom:mia:mosaik:w']) {
    assert.equal(presetOderMosaik(falsch), PRESETS.mosaik, falsch);
    assert.equal(ganzesBildBehandlung(falsch), 'mosaik');
    assert.equal(behandlungFuerZone(falsch, 'face'), 'mosaik');
  }
});

test('C6: presetFuerPackKurz und die Wahl fuer die Nachricht (C7): Kennung der gueltigen Mischung und `preset: custom` samt ersetzter Mischung', () => {
  const m = { gesicht: 'mia', flaeche: 'sticker', woerter: true };
  const e = { preset: 'custom', custom: m };
  assert.equal(presetFuerPackKurz(e, PACK_STAND), 'custom:mia:sticker:w');
  assert.equal(presetFuerPackKurz(e, null), 'custom:mosaik:mosaik:w');
  assert.equal(presetFuerPackKurz(e, PACKS.nurSticker), 'custom:mosaik:sticker:w');
  assert.equal(presetFuerPackKurz(e, PACKS.nurPatch), 'custom:mia:mosaik:w');
  assert.deepEqual(presetWahlFuerPackKurz(e, PACK_STAND), { preset: 'custom', custom: m });
  assert.deepEqual(presetWahlFuerPackKurz(e, null), { preset: 'custom', custom: { gesicht: 'mosaik', flaeche: 'mosaik', woerter: true } });
  assert.deepEqual(presetWahlFuerPackKurz({ preset: 'mia-wort' }, null), { preset: 'mosaik' });
  assert.deepEqual(presetWahlFuerPackKurz({ preset: 'mia-wort' }, PACK_STAND), { preset: 'mia-wort' });
  // ungueltige Mischung: Mosaik
  assert.deepEqual(presetWahlFuerPackKurz({ preset: 'custom', custom: { gesicht: 'x' } }, PACK_STAND), { preset: 'mosaik' });
  assert.equal(presetFuerPackKurz({ preset: 'custom' }, PACK_STAND), 'mosaik');
  // Die Wahl samt Mischung geht durch vervollstaendige (so liest sie der Erkenner) und liefert dieselbe Definition
  for (const mm of MISCHUNGEN) {
    const wahl = presetWahlFuerPackKurz({ preset: 'custom', custom: mm }, PACK_STAND);
    const beim = vervollstaendige({ ...wahl });
    assert.equal(presetDef(beim).gewaehlt, presetDef({ preset: 'custom', custom: mm }, PACK_STAND).gilt);
  }
  assert.deepEqual(wahlAusDef(PRESETS['mia-wort']), { preset: 'mia-wort' });
});

// ---------- C7: Weg zum Erkenner ----------

test('C7: der Erkenner malt bei fehlender oder ungueltiger Mischung Mosaik (dieselben Flaechen wie das Preset Mosaik)', () => {
  const treffer = [
    { zone: 'breast', bedeckt: false, score: 0.8, box: [100, 200, 80, 90], weiblich: true },
    { zone: 'genitals', bedeckt: false, score: 0.7, box: [120, 400, 60, 50] },
    { zone: 'face', bedeckt: false, score: 0.9, box: [110, 40, 70, 90], quelle: 'yunet' },
  ];
  const zonen = { ...STANDARD.zonen, face: { an: true } };
  const mosaik = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'mosaik' }, false, 400, 600, true);
  for (const [name, wert] of ungueltige()) {
    const f = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom', custom: wert }, false, 400, 600, true);
    assert.deepEqual(f, mosaik, name);
  }
  // Nachricht mit `preset: custom` ohne Mischung (Feld fehlt ganz)
  assert.deepEqual(berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom' }, false, 400, 600, true), mosaik);
  // ... auch mit ganz verdecken (Steigerung Stufe 4) und beim Bildformat
  const ganz = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom', custom: 'x' }, true, 400, 600, true);
  assert.deepEqual(ganz, berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'mosaik' }, true, 400, 600, true));
});

test('C7 und C11: die Behandlung je Flaeche und das ganze Bild folgen der Mischung', () => {
  const treffer = [
    { zone: 'breast', bedeckt: false, score: 0.8, box: [100, 200, 80, 90], weiblich: true },
    { zone: 'face', bedeckt: false, score: 0.9, box: [110, 40, 70, 90], quelle: 'yunet' },
  ];
  const zonen = { ...STANDARD.zonen, face: { an: true } };
  const m = { gesicht: 'schwarz', flaeche: 'blur', woerter: true };
  const f = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom', custom: m }, false, 400, 600, true);
  assert.deepEqual(f.map((x) => [x.zone, x.behandlung]).sort(), [['breast', 'blur'], ['face', 'schwarz-wort']].sort());
  // ganz: Behandlung der Flaeche (blur); mit Sticker oder Mias Gesicht bleibt es Mosaik
  const ganz = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom', custom: m }, true, 400, 600, true);
  assert.equal(ganz[0].behandlung, 'blur');
  const st = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom', custom: { gesicht: 'mia', flaeche: 'sticker', woerter: false } }, true, 400, 600, true);
  assert.equal(st[0].behandlung, 'mosaik');
  const sw = berechneBildFlaechen(treffer, treffer, { zonen, rand: 0.15, preset: 'custom', custom: { gesicht: 'blur', flaeche: 'schwarz', woerter: true } }, true, 400, 600, true);
  assert.equal(sw[0].behandlung, 'schwarz-wort');
  // Mias Gesicht liegt als aufgelegte Flaeche ueber der Kopfflaeche, mit der Behandlung der Flaeche als Ersatz
  const treffer320 = [{ zone: 'face', bedeckt: false, score: 0.9, box: [110, 40, 70, 90] }]; // 320n liefert Kopf, Augen und Mund als abgeleitete Zonen
  const mia = berechneFlaechen(treffer320, { zonen: { ...zonen, head: { an: true } }, rand: 0.15, preset: 'custom', custom: { gesicht: 'mia', flaeche: 'schwarz', woerter: false } }, 400, 600, true);
  const gesicht = mia.find((x) => x.behandlung === 'mia-gesicht');
  assert.ok(gesicht, 'Mias Gesicht ist da');
  assert.equal(gesicht.ersatz, 'schwarz');
  assert.ok(mia.some((x) => x.zone === 'head' && x.behandlung === 'schwarz'), 'der Kopf bleibt eine Flaeche mit der Behandlung der Flaeche');
});

// ---------- T4 ----------

const bildVorn = BEISPIELE.find((b) => b.kennung === 'vorn');
const eingabe = (e, pack, extra = {}) => ({ einstellungen: vervollstaendige(e), pack, gesichter: null, bild: 'vorn', breite: bildVorn.breite, hoehe: bildVorn.hoehe, ...extra });

test('T4: zwei verschiedene Mischungen liefern verschiedene Definitionen, auch mit Eye bar', () => {
  const ids = new Set();
  const objekte = new Set();
  const mitBalkenObjekte = new Set();
  for (const m of MISCHUNGEN) {
    const ohne = presetDef({ preset: 'custom', custom: m }, PACKS.beide).gewaehlt;
    const mit = presetDef({ preset: 'custom', custom: m, augenbalken: true }, PACKS.beide).gewaehlt;
    ids.add(ohne.id);
    objekte.add(ohne);
    mitBalkenObjekte.add(mit);
    assert.notEqual(ohne, mit, 'mit Eye bar ein eigenes Objekt');
    assert.equal(mit.id, ohne.id);
    assert.equal(mit.augen, 'balken-immer');
    assert.equal(ohne.augen, 'wie-koerper');
    assert.equal(mit.mischung, ohne.mischung);
    // die Ableitung mit Eye bar ist je Mischung genau ein Objekt
    assert.equal(mit, presetDef({ preset: 'custom', custom: { ...m }, augenbalken: true }, PACKS.beide).gewaehlt);
  }
  assert.equal(ids.size, 40);
  assert.equal(objekte.size, 40);
  assert.equal(mitBalkenObjekte.size, 40, 'zwei Mischungen teilen nie das abgeleitete Objekt mit Eye bar');
  // Auch gegen die zwoelf Presets
  for (const id of PRESET_IDS) assert.ok(!ids.has(id) && !objekte.has(PRESETS[id]));
});

test('T4: dieselbe Mischung liefert bei jedem Aufruf gleiche Werte (Definition, Wahl, Schluessel)', () => {
  const m = { gesicht: 'blur', flaeche: 'sticker', woerter: true };
  const a = zeichenSchluessel(eingabe({ preset: 'custom', custom: m }, PACK_STAND));
  for (let i = 0; i < 5; i++) {
    assert.equal(zeichenSchluessel(eingabe({ preset: 'custom', custom: { ...m } }, PACK_STAND)), a);
    assert.equal(presetDef({ preset: 'custom', custom: { ...m } }, PACK_STAND).gilt, presetDef({ preset: 'custom', custom: m }, PACK_STAND).gilt);
    assert.deepEqual(erkennerEinstellungen(vervollstaendige({ preset: 'custom', custom: m }), PACK_STAND).e, erkennerEinstellungen(vervollstaendige({ preset: 'custom', custom: m }), PACK_STAND).e);
  }
});

test('T4: zeichenSchluessel unterscheidet alle 40 Mischungen (mit Pack), auch mit Eye bar; ohne Pack nur die wirklich verschiedenen', () => {
  const mitPack = new Set();
  const mitPackBalken = new Set();
  const ohnePack = new Set();
  for (const m of MISCHUNGEN) {
    mitPack.add(zeichenSchluessel(eingabe({ preset: 'custom', custom: m }, PACK_STAND)));
    mitPackBalken.add(zeichenSchluessel(eingabe({ preset: 'custom', custom: m, augenbalken: true }, PACK_STAND)));
    ohnePack.add(zeichenSchluessel(eingabe({ preset: 'custom', custom: m }, null)));
  }
  assert.equal(mitPack.size, 40);
  assert.equal(mitPackBalken.size, 40);
  // ohne Pack werden Mias Gesicht und Sticker zu Mosaik: 3 Gesichter x 3 Flaechen x 2 Woerter bleiben
  assert.equal(ohnePack.size, 18);
  // Custom gegen jedes der zwoelf Presets: nie derselbe Schluessel
  const presets = new Set(PRESET_IDS.map((id) => zeichenSchluessel(eingabe({ preset: id }, PACK_STAND))));
  for (const k of mitPack) assert.ok(!presets.has(k));
  // Eine Aenderung nur an einem Baustein aendert den Schluessel (C8: neu pruefen und neu malen wie bei einem Stilwechsel)
  const basis = { gesicht: 'schwarz', flaeche: 'blur', woerter: false };
  const k0 = zeichenSchluessel(eingabe({ preset: 'custom', custom: basis }, PACK_STAND));
  for (const teil of [{ gesicht: 'blur' }, { flaeche: 'schwarz' }, { woerter: true }]) {
    assert.notEqual(zeichenSchluessel(eingabe({ preset: 'custom', custom: { ...basis, ...teil } }, PACK_STAND)), k0, JSON.stringify(teil));
  }
});

test('T4: die Einstellungen der Vorschau tragen die aufgeloeste Mischung wie die Nachricht an den Erkenner (C7, C12)', () => {
  for (const m of MISCHUNGEN) {
    for (const pack of [null, PACK_STAND]) {
      const einst = vervollstaendige({ preset: 'custom', custom: m });
      const { e, gilt } = erkennerEinstellungen(einst, pack);
      assert.equal(e.preset, 'custom');
      assert.deepEqual(e.custom, sollGiltMischung(m, pack ? PACKS.beide : null));
      assert.equal(presetDef(e).gewaehlt, gilt);
    }
  }
  // Ein Preset der Tabelle bleibt, wie es war
  assert.equal(erkennerEinstellungen(vervollstaendige({ preset: 'mia-wort' }), PACK_STAND).e.preset, 'mia-wort');
  assert.equal(erkennerEinstellungen(vervollstaendige({ preset: 'mia-wort' }), null).e.preset, 'mosaik');
});

// ---------- C10 ----------

const alt = (teil = {}) => ({ preset: 'mosaik', custom: { ...CUSTOM_STANDARD }, zonen: { ...STANDARD.zonen, face: { an: false } }, ...teil });

test('C10: waehleCustom schaltet Face an, wenn Mias Gesicht neu dazukommt und Face aus war', () => {
  const r = waehleCustom(alt(), { gesicht: 'mia', flaeche: 'schwarz', woerter: false });
  assert.equal(r.faceEingeschaltet, true);
  assert.equal(r.teil.preset, 'custom');
  assert.deepEqual(r.teil.custom, { gesicht: 'mia', flaeche: 'schwarz', woerter: false });
  assert.equal(r.teil.zonen.face.an, true);
  // die anderen Zonen bleiben
  for (const z of Object.keys(STANDARD.zonen)) if (z !== 'face') assert.deepEqual(r.teil.zonen[z], STANDARD.zonen[z]);
});

test('C10: kein Face-Schalter, wenn Face an ist, wenn nicht Mias Gesicht gewaehlt wird, oder wenn Mias Gesicht schon im Spiel war (wie waehlePreset)', () => {
  const faceAn = alt({ zonen: { ...STANDARD.zonen, face: { an: true } } });
  const a = waehleCustom(faceAn, { gesicht: 'mia', flaeche: 'blur', woerter: false });
  assert.equal(a.faceEingeschaltet, false);
  assert.equal('zonen' in a.teil, false);
  for (const g of ['sticker', 'mosaik', 'blur', 'schwarz']) {
    const r = waehleCustom(alt(), { gesicht: g, flaeche: 'mosaik', woerter: false });
    assert.equal(r.faceEingeschaltet, false, g);
    assert.equal('zonen' in r.teil, false, g);
  }
  // Vorher schon Custom mit Mias Gesicht, Face spaeter abgeschaltet: ein anderer Baustein schaltet Face nicht neu ein
  const vorher = alt({ preset: 'custom', custom: { gesicht: 'mia', flaeche: 'mosaik', woerter: false } });
  const b = waehleCustom(vorher, { gesicht: 'mia', flaeche: 'schwarz', woerter: false });
  assert.equal(b.faceEingeschaltet, false);
  // Vorher ein Mia-Preset (Face aus): auch kein neues Einschalten
  const c = waehleCustom(alt({ preset: 'mia-wort' }), { gesicht: 'mia', flaeche: 'schwarz', woerter: false });
  assert.equal(c.faceEingeschaltet, false);
  // Vorher Custom ohne Mias Gesicht: jetzt schon
  const d = waehleCustom(alt({ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'mosaik', woerter: false } }), { gesicht: 'mia', flaeche: 'schwarz', woerter: false });
  assert.equal(d.faceEingeschaltet, true);
});

test('C10: waehleCustom mit ungueltiger Mischung nimmt den Standard, waehlePreset sieht Mias Gesicht in Custom', () => {
  const r = waehleCustom(alt(), { gesicht: 'mia', flaeche: 'mia', woerter: false });
  assert.deepEqual(r.teil.custom, CUSTOM_STANDARD);
  assert.equal(r.faceEingeschaltet, false);
  // waehlePreset: vorher Custom mit Mias Gesicht, jetzt ein Mia-Preset, Face aus: kein neues Einschalten (Mias Gesicht war schon im Spiel)
  const w = waehlePreset(alt({ preset: 'custom', custom: { gesicht: 'mia', flaeche: 'mosaik', woerter: false } }), 'mia-wort');
  assert.equal(w.faceEingeschaltet, false);
  // vorher Custom ohne Mias Gesicht: ja
  const w2 = waehlePreset(alt({ preset: 'custom', custom: { gesicht: 'blur', flaeche: 'mosaik', woerter: false } }), 'mia-wort');
  assert.equal(w2.faceEingeschaltet, true);
  // der Teil traegt nur preset (und bei Face die Zonen), die Mischung bleibt gespeichert
  assert.equal('custom' in w2.teil, false);
  // den Teil nimmt vervollstaendige auf
  const neu = vervollstaendige({ ...STANDARD, ...waehleCustom(alt(), { gesicht: 'mia', flaeche: 'sticker', woerter: true }).teil });
  assert.equal(neu.preset, 'custom');
  assert.deepEqual(neu.custom, { gesicht: 'mia', flaeche: 'sticker', woerter: true });
  assert.equal(neu.zonen.face.an, true);
});

// ---------- Weitere Randfaelle ----------

test('C13: nichts stuerzt mit preset custom ab, Name und Satz sind vorlaeufig gesetzt', () => {
  const d = customDef({ gesicht: 'mosaik', flaeche: 'mosaik', woerter: false });
  assert.equal(d.name, 'Custom');
  assert.equal(d.satz, 'You pick the face, the rest and the words. I do it your way.');
  assert.equal(customDef({ gesicht: 'gibt-es-nicht' }), customDef(CUSTOM_STANDARD), 'customDef nimmt nie eine halbe Mischung');
  assert.equal(customKennung(CUSTOM_STANDARD), 'custom:mosaik:mosaik:-');
});
