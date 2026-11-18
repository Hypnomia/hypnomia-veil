// Einheitstests des Aufloesers `presetDef` (Phase 11 E4b): gewaehlt und wirksam je Kennung und Pack-Stufe, Rueckfall Mosaik, Katalog, Verbot der
// direkten Tabellenlesung ausserhalb von src/presets.ts und src/preset-def.ts, und der erwartet rote Test zum Befund aus speicher.ts.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRESETS, PRESET_IDS, behandlungFuerZone, ganzesBildBehandlung, nutztMiasGesicht, nutztSticker, presetFuerPack, presetOderMosaik, zonenFuerPreset } from '../../src/presets.ts';
import { istFreigeschaltet as istFreigeschaltetAlt, presetDef, presetDefFuerKennung, presetKatalog } from '../../src/preset-def.ts';
import { berechneFlaechen } from '../../src/erkenner/zonen.ts';
import { STANDARD } from '../../src/einstellungen.ts';
import { wirksameZonen } from '../../src/steigerung.ts';
import { ersatzFuer } from '../../src/schleier/video-zonen.ts';
import { istFreigeschaltet, presetFuerPackKurz } from '../../src/pack/vertrag.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Pack-Stufen als Kurzfassung (nur die Freischaltungen zaehlen).
const PACKS = {
  keins: null,
  nurPatch: { freischaltungen: ['stil:mia-patch'] },
  nurSticker: { freischaltungen: ['zensur:sticker'] },
  beide: { freischaltungen: ['stil:mia-patch', 'zensur:sticker'] },
};
const BRAUCHT_PATCH = ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur'];
const BRAUCHT_STICKER = ['mia-sticker', 'sticker'];

// Soll aus der Tabelle der Planung, nicht aus dem Code: welche Kennung gilt bei welcher Pack-Stufe.
function sollGilt(kennung, stufe) {
  if (BRAUCHT_PATCH.includes(kennung)) return stufe === 'nurPatch' || stufe === 'beide' ? kennung : 'mosaik';
  if (BRAUCHT_STICKER.includes(kennung)) return stufe === 'nurSticker' || stufe === 'beide' ? kennung : 'mosaik';
  return kennung;
}

test('presetDef: alle 13 Kennungen mal vier Pack-Stufen, gewaehlt ist die Tabelle, gilt folgt der Pack-Tabelle', () => {
  assert.equal(PRESET_IDS.length, 13);
  for (const kennung of PRESET_IDS) {
    for (const [stufe, pack] of Object.entries(PACKS)) {
      const r = presetDef({ preset: kennung }, pack);
      assert.equal(r.gewaehlt, PRESETS[kennung], `${kennung}/${stufe}: gewaehlt ist dasselbe Objekt der Tabelle`);
      assert.equal(r.gilt, PRESETS[sollGilt(kennung, stufe)], `${kennung}/${stufe}: gilt`);
      assert.equal(presetFuerPackKurz(kennung, pack), sollGilt(kennung, stufe), `${kennung}/${stufe}: presetFuerPackKurz`);
    }
    // Ohne Pack-Angabe: kein Pack.
    assert.equal(presetDef({ preset: kennung }).gilt, PRESETS[sollGilt(kennung, 'keins')]);
    assert.equal(presetDef({ preset: kennung }, undefined).gewaehlt, PRESETS[kennung]);
  }
});

test('presetDef: gewaehlt und gilt fallen auseinander, wo das Pack fehlt (nicht vertauschbar)', () => {
  const r = presetDef({ preset: 'mia-wort' }, null);
  assert.equal(r.gewaehlt.id, 'mia-wort');
  assert.equal(r.gilt.id, 'mosaik');
  const s = presetDef({ preset: 'sticker' }, PACKS.nurPatch);
  assert.equal(s.gewaehlt.id, 'sticker');
  assert.equal(s.gilt.id, 'mosaik');
});

test('presetDef: fehlende oder unbekannte Kennung gilt als Mosaik (gewaehlt und gilt)', () => {
  for (const preset of [undefined, null, '', 'gibt-es-nicht', 'constructor', '__proto__', 'toString', 42, {}]) {
    for (const pack of [null, PACKS.beide]) {
      const r = presetDef({ preset }, pack);
      assert.equal(r.gewaehlt, PRESETS.mosaik, String(preset));
      assert.equal(r.gilt, PRESETS.mosaik, String(preset));
    }
  }
  assert.equal(presetDef({}).gewaehlt, PRESETS.mosaik);
  assert.equal(presetDefFuerKennung(undefined), PRESETS.mosaik);
  assert.equal(presetDefFuerKennung('blur'), PRESETS.blur);
  assert.equal(presetFuerPackKurz('gibt-es-nicht', PACKS.beide), 'mosaik');
});

test('presetDef: ein beschaedigtes Pack (freischaltungen keine Liste) zaehlt als kein Pack', () => {
  assert.equal(presetDef({ preset: 'mia-wort' }, { freischaltungen: 'stil:mia-patch' }).gilt.id, 'mosaik');
  assert.equal(presetDef({ preset: 'mia-wort' }, {}).gilt.id, 'mosaik');
});

test('presetKatalog: alle 13 Definitionen in der Reihenfolge von PRESET_IDS, dieselben Objekte', () => {
  const k = presetKatalog();
  assert.equal(k.length, 13);
  assert.deepEqual(k.map((d) => d.id), [...PRESET_IDS]);
  k.forEach((d, i) => assert.equal(d, PRESETS[PRESET_IDS[i]]));
});

function dateien(ordner, liste = []) {
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) dateien(pfad, liste);
    else if (/\.(ts|mts|js|mjs|css)$/.test(name)) liste.push(pfad);
  }
  return liste;
}

test('PRESETS[ steht unter src/ und entrypoints/ nur in src/presets.ts und src/preset-def.ts', () => {
  const erlaubt = new Set(['src/presets.ts', 'src/preset-def.ts']);
  const funde = [];
  for (const ordner of ['src', 'entrypoints']) {
    for (const pfad of dateien(join(WURZEL, ordner))) {
      const rel = relative(WURZEL, pfad).split('\\').join('/');
      if (erlaubt.has(rel)) continue;
      if (readFileSync(pfad, 'utf8').includes('PRESETS[')) funde.push(rel);
    }
  }
  assert.deepEqual(funde, []);
});

// M1: der Rueckfall Mosaik greift in JEDER Hilfsfunktion, die die Tabelle liest (nicht nur im Aufloeser).
const FREMDE = [undefined, null, '', 'gibt-es-nicht', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 42, {}];

test('presetOderMosaik: bekannte Kennung dieselbe Definition, alles andere Mosaik', () => {
  for (const k of PRESET_IDS) assert.equal(presetOderMosaik(k), PRESETS[k]);
  for (const k of FREMDE) assert.equal(presetOderMosaik(k), PRESETS.mosaik, String(k));
});

test('Hilfsfunktionen der Tabelle: fremde Kennung liefert dasselbe wie mosaik', () => {
  const zonen = STANDARD.zonen;
  const treffer = [
    { zone: 'breast', bedeckt: false, score: 0.9, box: [100, 100, 100, 100] },
    { zone: 'face', bedeckt: false, score: 0.9, box: [300, 50, 80, 80] },
  ];
  for (const k of FREMDE) {
    const m = 'mosaik';
    assert.equal(presetFuerPack(k, true, true), presetFuerPack(m, true, true), `presetFuerPack ${String(k)}`);
    assert.equal(presetFuerPack(k, false, false), 'mosaik');
    assert.equal(nutztSticker(k), nutztSticker(m), `nutztSticker ${String(k)}`);
    assert.equal(nutztMiasGesicht(k), nutztMiasGesicht(m), `nutztMiasGesicht ${String(k)}`);
    assert.equal(ganzesBildBehandlung(k), ganzesBildBehandlung(m), `ganzesBild ${String(k)}`);
    for (const z of ['face', 'eyes', 'breast', 'head']) assert.equal(behandlungFuerZone(k, z), behandlungFuerZone(m, z), `behandlungFuerZone ${String(k)} ${z}`);
    // dasselbe Objekt wie bei mosaik (Identitaet bleibt), auch ohne Kennung
    assert.equal(zonenFuerPreset(k, zonen), zonen, `zonenFuerPreset ${String(k)}`);
    assert.deepEqual(wirksameZonen({ zonen, preset: k }, 2), wirksameZonen({ zonen, preset: m }, 2), `wirksameZonen ${String(k)}`);
    assert.deepEqual(wirksameZonen({ zonen, preset: k }, 4), wirksameZonen({ zonen, preset: m }, 4));
    assert.equal(ersatzFuer(k), ersatzFuer(m), `ersatzFuer ${String(k)}`);
    for (const verschmelzen of [true, false]) {
      assert.deepEqual(
        berechneFlaechen(treffer, { zonen, rand: 0.1, preset: k }, 1000, 1000, verschmelzen),
        berechneFlaechen(treffer, { zonen, rand: 0.1, preset: m }, 1000, 1000, verschmelzen),
        `berechneFlaechen ${String(k)} ${verschmelzen}`,
      );
    }
  }
});

// M2: jede Regel steht einmal. Die Freischalt-Regel ist dieselbe Funktion in preset-def.ts und vertrag.ts; presetFuerPack (Karten) und der
// Aufloeser geben fuer alle 13 Kennungen mal alle Pack-Stufen dasselbe.
test('eine Freischalt-Regel und eine Rueckfall-Regel: vertrag.ts reicht dieselbe Funktion weiter, presetFuerPack gleich presetDef.gilt', () => {
  assert.equal(istFreigeschaltet, istFreigeschaltetAlt);
  for (const kennung of PRESET_IDS) {
    for (const [stufe, pack] of Object.entries(PACKS)) {
      const patch = istFreigeschaltet(pack, 'stil:mia-patch');
      const sticker = istFreigeschaltet(pack, 'zensur:sticker');
      assert.equal(presetFuerPack(kennung, patch, sticker), presetDef({ preset: kennung }, pack).gilt.id, `${kennung}/${stufe}`);
      assert.equal(presetFuerPack(kennung, patch, sticker), sollGilt(kennung, stufe), `${kennung}/${stufe} Soll`);
    }
  }
});

test('PRESETS wird ausserhalb von src/presets.ts und src/preset-def.ts nirgends importiert', () => {
  const erlaubt = new Set(['src/presets.ts', 'src/preset-def.ts']);
  const funde = [];
  for (const ordner of ['src', 'entrypoints']) {
    for (const pfad of dateien(join(WURZEL, ordner))) {
      const rel = relative(WURZEL, pfad).split('\\').join('/');
      if (erlaubt.has(rel)) continue;
      const q = readFileSync(pfad, 'utf8');
      for (const m of q.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]*\/presets(?:\.ts)?['"]/g)) {
        if (/(^|[\s,])PRESETS([\s,]|$)/.test(m[1])) funde.push(rel);
      }
    }
  }
  assert.deepEqual(funde, []);
});

// Erwartet rot bis (b) (E4c): wer ein erstes Pack importiert und Eye bar gewaehlt hat, verliert heute still den Balken, weil src/pack/speicher.ts
// beim ersten Pack `waehlePreset(alt, PACK_PRESET)` ruft, ohne auf den bisherigen Stil zu sehen. Der Test liest die Stelle im Quelltext (die
// Importlogik braucht IndexedDB und laeuft nicht in Node), entfernt vorher Kommentare (`//` und `/* */`) und verlangt, dass der Zweig den Stil Eye bar
// kennt. Gekennzeichnet wie `erwartetRot` in tests/chromium/video-platz.spec.ts: mit Kennzeichnung besteht der Fall genau dann, wenn die Pruefung
// fehlschlaegt; besteht sie, schlaegt der Fall fehl (Kennzeichnung entfernen). Mit VEIL_E4_OHNE_KENNZEICHNUNG=1 laeuft der Fall als normaler Test.
// VEIL_E4_SPEICHER=<datei> liest eine andere Kopie von speicher.ts (nur zum Messen der Pruefung selbst).
const OHNE_KENNZEICHNUNG = process.env.VEIL_E4_OHNE_KENNZEICHNUNG === '1';
function e4cPruefung() {
  const pfad = process.env.VEIL_E4_SPEICHER ?? join(WURZEL, 'src/pack/speicher.ts');
  const quelle = readFileSync(pfad, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stelle = quelle.indexOf('waehlePreset(alt, PACK_PRESET)');
  assert.ok(stelle > 0, 'die Stelle fuer das erste Pack ist da');
  const zweig = quelle.slice(Math.max(0, stelle - 400), stelle + 400);
  assert.ok(/augenbalken/.test(zweig), 'der Zweig fuer das erste Pack unterscheidet den Stil Eye bar');
}
test('E4c erwartet rot: ein erstes Pack nimmt einem Nutzer mit Eye bar den Balken nicht', () => {
  if (OHNE_KENNZEICHNUNG) return e4cPruefung();
  let gruen = false;
  try {
    e4cPruefung();
    gruen = true;
  } catch {
    // erwartet: rot
  }
  if (gruen) assert.fail('E4c ist gruen geworden: die Kennzeichnung (erwartet rot) in tests/einheit/preset-def.test.mjs entfernen');
});
