// Einheitstests des Aufloesers `presetDef` (Phase 11 E4b, E4c): gewaehlt und wirksam je Kennung und Pack-Stufe, der Schalter Eye bar, Rueckfall Mosaik, Katalog,
// Verbot der direkten Tabellenlesung ausserhalb von src/presets.ts und src/preset-def.ts, und der Verhaltenstest der Stilwahl beim ersten Pack.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRESETS, PRESET_IDS, behandlungFuerZone, ganzesBildBehandlung, nutztMiasGesicht, nutztSticker, presetFuerPack, presetOderMosaik, zonenFuerPreset } from '../../src/presets.ts';
import { istFreigeschaltet as istFreigeschaltetAlt, presetDef, presetDefFuerKennung, presetKatalog } from '../../src/preset-def.ts';
import { berechneFlaechen } from '../../src/erkenner/zonen.ts';
import { STANDARD, vervollstaendige, waehleBeimErstenPack } from '../../src/einstellungen.ts';
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

test('presetDef: alle 12 Kennungen mal vier Pack-Stufen, gewaehlt ist die Tabelle, gilt folgt der Pack-Tabelle', () => {
  assert.equal(PRESET_IDS.length, 12);
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

test('presetKatalog: alle 12 Definitionen in der Reihenfolge von PRESET_IDS, dieselben Objekte', () => {
  const k = presetKatalog();
  assert.equal(k.length, 12);
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

// E4c R7: der Aufloeser nimmt den Schalter Eye bar auf. Die gelieferte Definition traegt die wirksame Augen-Art, `gewaehlt` und `gilt` beide; ist der Schalter aus
// oder fehlt er, ist es das Objekt der Tabelle selbst (Identitaet bleibt).
test('presetDef mit dem Schalter Eye bar: Augen-Art balken-immer in jedem Stil, je Kennung dasselbe eingefrorene Objekt, ohne Schalter die Tabelle', () => {
  for (const kennung of PRESET_IDS) {
    for (const [stufe, pack] of Object.entries(PACKS)) {
      const an = presetDef({ preset: kennung, augenbalken: true }, pack);
      assert.equal(an.gewaehlt.augen, 'balken-immer', `${kennung}/${stufe} gewaehlt`);
      assert.equal(an.gilt.augen, 'balken-immer', `${kennung}/${stufe} gilt`);
      assert.equal(an.gewaehlt.id, kennung);
      assert.equal(an.gilt.id, sollGilt(kennung, stufe));
      // sonst unveraendert: jedes andere Feld gleicht der Tabelle
      assert.deepEqual({ ...an.gewaehlt, augen: PRESETS[kennung].augen }, PRESETS[kennung]);
      assert.equal(presetDef({ preset: kennung, augenbalken: true }, pack).gewaehlt, an.gewaehlt, 'dasselbe Objekt bei jedem Aufruf');
      if (PRESETS[kennung].augen !== 'balken-immer') assert.ok(Object.isFrozen(an.gewaehlt), 'abgeleitet und eingefroren');
      for (const aus of [false, undefined, null, 'ja', 1, {}]) {
        const r = presetDef({ preset: kennung, augenbalken: aus }, pack);
        assert.equal(r.gewaehlt, PRESETS[kennung], `${kennung}: Schalter ${String(aus)} ist aus`);
        assert.equal(r.gilt, PRESETS[sollGilt(kennung, stufe)]);
      }
    }
  }
  // Zensurbalken ist schon balken-immer: dasselbe Objekt der Tabelle auch mit Schalter
  assert.equal(presetDef({ preset: 'zensurbalken', augenbalken: true }).gewaehlt, PRESETS.zensurbalken);
  // unbekannte Kennung: Mosaik mit Balken
  assert.equal(presetDef({ preset: 'gibt-es-nicht', augenbalken: true }).gewaehlt.id, 'mosaik');
  assert.equal(presetDef({ preset: 'gibt-es-nicht', augenbalken: true }).gewaehlt.augen, 'balken-immer');
  // kein Stil hat mehr die Art `nur-balken`
  assert.equal(PRESET_IDS.some((k) => PRESETS[k].augen === 'nur-balken'), false);
});

// E4c R8: die Wahl des Stils beim ersten Pack ist eine reine Funktion (src/einstellungen.ts waehleBeimErstenPack; speicher.ts ruft sie). Verhaltenstest: der Schalter Eye bar
// bleibt, der Stil wechselt auf mia-wort, Face wird eingeschaltet, wo es aus war. Vorher nahm der Stilwechsel einem Eye-bar-Nutzer den Balken (Befund 3 der Karte).
test('Stilwahl beim ersten Pack: Stil mia-wort, Face an, der Schalter Eye bar bleibt unberuehrt (auch aus dem Altstand mit dem Stil Eye bar)', () => {
  const zeigt = (alt) => {
    const r = waehleBeimErstenPack(alt);
    // wie aendereEinstellungen: Teil auf den alten Stand legen, dann vervollstaendigen
    return { neu: vervollstaendige({ ...alt, ...r.teil }), r };
  };
  // Nutzer mit dem Schalter an
  const mitBalken = vervollstaendige({ preset: 'mosaik', augenbalken: true });
  const a = zeigt(mitBalken);
  assert.equal(a.neu.preset, 'mia-wort');
  assert.equal(a.neu.augenbalken, true, 'der Balken bleibt');
  assert.equal(a.neu.zonen.face.an, true);
  assert.equal(a.r.faceEingeschaltet, true);
  assert.equal('augenbalken' in a.r.teil, false, 'der Teil fasst den Schalter nicht an');
  // Nutzer mit dem Schalter aus bleibt aus
  assert.equal(zeigt(vervollstaendige({})).neu.augenbalken, false);
  // Altstand: der Stil Eye bar (roh) wandert VOR dem ersten Pack, der Balken ueberlebt den Stilwechsel
  const alt = vervollstaendige({ preset: 'augenbalken', zonen: { face: { an: true } } });
  const b = zeigt(alt);
  assert.equal(b.neu.preset, 'mia-wort');
  assert.equal(b.neu.augenbalken, true);
  assert.equal(b.r.faceEingeschaltet, false, 'Face war schon an');
  assert.equal(b.neu.hinweise.augenbalken, 'offen', 'der Merker bleibt');
  // Die Zonen-Schalter bleiben ausser Face, wie sie waren
  const c = zeigt(vervollstaendige({ preset: 'blur', zonen: { breast: { an: false }, genitals: { an: true } } }));
  assert.equal(c.neu.zonen.breast.an, false);
  assert.equal(c.neu.zonen.genitals.an, true);
});

// Die Stelle in src/pack/speicher.ts ruft diese Funktion und nicht mehr waehlePreset/PACK_PRESET selbst (damit es nur eine Regel gibt).
test('speicher.ts waehlt den Stil beim ersten Pack ueber waehleBeimErstenPack', () => {
  const quelle = readFileSync(join(WURZEL, 'src/pack/speicher.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/waehleBeimErstenPack\(alt\)/.test(quelle));
  assert.equal(/waehlePreset\(/.test(quelle), false);
});
