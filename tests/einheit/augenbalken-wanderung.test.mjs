// Einheitstests Phase 11 E4c: Eye bar als Schalter mit Wanderung.
//   Test 1: die Wanderung des alten Stils (`preset: 'augenbalken'`, `stil: 'augenbalken'`) in vervollstaendige.
//   Test 2: Deckung "mehr, nie weniger" gegen das feste Soll des alten Stils (tests/einheit/daten/augenbalken-alt-soll.json).
//   Test 3: Regeln R4 und R5, Schalter an mal 12 Stile mal alle Zonen aus: jedes Gesicht hat verdeckte Augen.
// Das Soll des alten Stils ist eine feste Tabelle: erzeugt aus dem Code am Stand ad8fc11 (Erzeuger ausserhalb des Repos: der alte Stand wurde per `git archive ad8fc11 src`
// in einen eigenen Ordner entpackt und mit einem kleinen Skript ausgewertet: je Szene die Flaechen von berechneFlaechen mit dem Stil Eye bar; der alte Stil hing weder
// von den Zonen-Schaltern noch von der Stufe noch vom Verschmelzen ab, das prueft das Skript selbst). Zur Laufzeit wird nichts aus dem neuen Code gerechnet, was als Soll gilt.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ZONEN, STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { PRESET_IDS, malLauf } from '../../src/presets.ts';
import { presetDef } from '../../src/preset-def.ts';
import { wirksameZonen } from '../../src/steigerung.ts';
import { berechneAugenbalken, berechneBildFlaechen, berechneFlaechen, gesichtsZonen } from '../../src/erkenner/zonen.ts';
import { presetFuerPackKurz } from '../../src/pack/vertrag.ts';
import { ABDECKUNG_KURZ } from '../../entrypoints/popup/texte.ts';
import { EYE_BAR_SATZ, EYE_BAR_TEXT, HINWEIS_ZONEN_MIA, HINWEIS_ZONEN_ZENSURBALKEN } from '../../src/oberflaeche/gemeinsam.ts';

const HIER = dirname(fileURLToPath(import.meta.url));
const ALT = JSON.parse(readFileSync(join(HIER, 'daten', 'augenbalken-alt-soll.json'), 'utf8'));

const PACKS = { keins: null, beide: { freischaltungen: ['stil:mia-patch', 'zensur:sticker'] } };

// ---------- Test 1: Wanderung ----------

test('Wanderung: roh preset augenbalken wird Mosaik mit dem Schalter, die Zonen-Schalter bleiben, der Merker steht auf offen', () => {
  const zonen = { breast: { an: false }, genitals: { an: true, bedeckt: false }, eyes: { an: true } };
  const e = vervollstaendige({ preset: 'augenbalken', zonen });
  assert.equal(e.preset, 'mosaik');
  assert.equal(e.augenbalken, true);
  assert.equal(e.hinweise.augenbalken, 'offen');
  const ohne = vervollstaendige({ zonen });
  assert.deepEqual(e.zonen, ohne.zonen, 'die Zonen-Schalter bleiben, wie sie sind');
  // alle anderen Felder wie bei einem Stand ohne Eye bar
  const { preset: _p, augenbalken: _a, hinweise: _h, ...rest } = e;
  const { preset: _p2, augenbalken: _a2, hinweise: _h2, ...restOhne } = ohne;
  assert.deepEqual(rest, restOhne);
  // der Standard hat den Schalter aus und keinen Merker
  assert.equal(vervollstaendige({}).augenbalken, false);
  assert.equal(vervollstaendige({}).hinweise.augenbalken, 'keiner');
  assert.equal(STANDARD.augenbalken, false);
});

test('Wanderung: roh stil augenbalken (ohne gueltiges preset) wandert ebenso; beides zugleich ebenso', () => {
  for (const roh of [{ stil: 'augenbalken' }, { stil: 'augenbalken', preset: 'kaputt' }, { stil: 'augenbalken', preset: 'augenbalken' }, { preset: 'augenbalken', stil: 'blur' }, { preset: 'augenbalken', stil: 'mosaik' }]) {
    const e = vervollstaendige(roh);
    assert.equal(e.preset, 'mosaik', JSON.stringify(roh));
    assert.equal(e.augenbalken, true, JSON.stringify(roh));
    assert.equal(e.hinweise.augenbalken, 'offen', JSON.stringify(roh));
    assert.equal('stil' in e, false);
  }
});

test('Wanderung: ein gueltiges preset gewinnt gegen einen alten stil augenbalken (wie bei der Stil-Wanderung), kein Balken ohne Wanderung', () => {
  const e = vervollstaendige({ preset: 'blur', stil: 'augenbalken' });
  assert.equal(e.preset, 'blur');
  assert.equal(e.augenbalken, false);
  assert.equal(e.hinweise.augenbalken, 'keiner');
  // jedes der 12 Presets bleibt, ohne Schalter
  for (const p of PRESET_IDS) {
    const x = vervollstaendige({ preset: p });
    assert.equal(x.preset, p);
    assert.equal(x.augenbalken, false);
  }
});

test('Wanderung: idempotent, auch ueber den Speicher (JSON) und ueber den Weg der Aenderung (alt plus Teil)', () => {
  for (const roh of [{ preset: 'augenbalken' }, { stil: 'augenbalken' }, { preset: 'augenbalken', stil: 'augenbalken', zonen: { face: { an: true } } }, {}, { preset: 'mia-wort', augenbalken: true }]) {
    const eins = vervollstaendige(roh);
    assert.deepEqual(vervollstaendige(eins), eins, `zweimal gelesen: ${JSON.stringify(roh)}`);
    assert.deepEqual(vervollstaendige(JSON.parse(JSON.stringify(eins))), eins, `nach dem Speichern: ${JSON.stringify(roh)}`);
    // aendereEinstellungen: alt = gelesener Stand, Teil darauf, vervollstaendigen
    const nach = vervollstaendige({ ...eins, ...{ schwelle: 0.2 } });
    assert.equal(nach.augenbalken, eins.augenbalken);
    assert.equal(nach.hinweise.augenbalken, eins.hinweise.augenbalken);
    assert.equal(nach.preset, eins.preset);
  }
  // Eine Aenderung des Stils fasst den Schalter nicht an
  const alt = vervollstaendige({ preset: 'augenbalken' });
  const neu = vervollstaendige({ ...alt, preset: 'blur' });
  assert.equal(neu.preset, 'blur');
  assert.equal(neu.augenbalken, true);
});

test('Wanderung: ein Schalter, der kein Boolean ist, gilt als aus; mit dem alten Stil wird er an', () => {
  for (const x of ['ja', 1, 0, null, {}, [], 'true', undefined]) {
    assert.equal(vervollstaendige({ augenbalken: x }).augenbalken, false, String(x));
    assert.equal(vervollstaendige({ augenbalken: x }).hinweise.augenbalken, 'keiner');
    const w = vervollstaendige({ preset: 'augenbalken', augenbalken: x });
    assert.equal(w.augenbalken, true, `Wanderung gewinnt gegen ${String(x)}`);
  }
  assert.equal(vervollstaendige({ augenbalken: true }).augenbalken, true);
  assert.equal(vervollstaendige({ augenbalken: true }).hinweise.augenbalken, 'keiner', 'ein Schalter ohne Wanderung setzt keinen Merker');
  assert.equal(vervollstaendige({ preset: 'augenbalken', augenbalken: false }).augenbalken, true);
});

test('Wanderung: der Merker wird nur beim ersten Mal gesetzt, ein vorhandener gueltiger Wert bleibt, Muell wird behandelt', () => {
  // erste Wanderung: offen
  assert.equal(vervollstaendige({ preset: 'augenbalken' }).hinweise.augenbalken, 'offen');
  // schon gespeichert (kein roher Stil mehr): bleibt offen
  assert.equal(vervollstaendige({ augenbalken: true, hinweise: { augenbalken: 'offen' } }).hinweise.augenbalken, 'offen');
  // ein vorhandener gueltiger Wert wird von der Wanderung nicht ueberschrieben
  assert.equal(vervollstaendige({ preset: 'augenbalken', hinweise: { augenbalken: 'keiner' } }).hinweise.augenbalken, 'keiner');
  assert.equal(vervollstaendige({ preset: 'augenbalken', hinweise: { augenbalken: 'offen' } }).hinweise.augenbalken, 'offen');
  // Muell: wie fehlend (Wanderung setzt offen, sonst keiner)
  for (const m of ['zeigen', 7, null, {}, undefined]) {
    assert.equal(vervollstaendige({ preset: 'augenbalken', hinweise: { augenbalken: m } }).hinweise.augenbalken, 'offen', String(m));
    assert.equal(vervollstaendige({ hinweise: { augenbalken: m } }).hinweise.augenbalken, 'keiner', String(m));
  }
  for (const h of ['x', 3, null, [], undefined]) {
    assert.equal(vervollstaendige({ preset: 'augenbalken', hinweise: h }).hinweise.augenbalken, 'offen');
    assert.equal(vervollstaendige({ hinweise: h }).hinweise.augenbalken, 'keiner');
  }
  // sonst bewirkt der Merker nichts: gleiche Deckung mit und ohne
  const a = vervollstaendige({ preset: 'mosaik', augenbalken: true, hinweise: { augenbalken: 'offen' } });
  const b = vervollstaendige({ preset: 'mosaik', augenbalken: true, hinweise: { augenbalken: 'keiner' } });
  assert.deepEqual(presetDef(a), presetDef(b));
  assert.deepEqual(wirksameZonen(a, 2), wirksameZonen(b, 2));
});

// ---------- Test 2: "mehr, nie weniger" ----------

// Wie die Pipeline es tut: Zonen aus der Steigerung, Stil nach Pack, Schalter in der Definition, dann die Flaechen des Bildes.
function neueFlaechen(szene, zonen, stufe, pack, verschmelzen) {
  const e = vervollstaendige({ preset: 'mosaik', augenbalken: true, zonen });
  const w = wirksameZonen(e, stufe);
  const preset = presetFuerPackKurz(e.preset, pack);
  return berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: w.zonen, rand: e.rand, preset, augenbalken: e.augenbalken }, w.ganzVerdecken, szene.b, szene.h, verschmelzen);
}

const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// R11 vergleicht Lage, Groesse und Behandlung; `wortBox` (der freie Platz fuer ein Wort, nur ein Hilfsfeld) darf sich durch den aufgelegten Balken aendern.
const ohneWortBox = ({ wortBox: _w, ...rest }) => rest;
const gleichDeckung = (a, b) => gleich(ohneWortBox(a), ohneWortBox(b));

test('Deckung: die neue Einstellung (Mosaik mit Schalter) enthaelt jede Flaeche, die der alte Stil Eye bar lieferte, fuer jede Zonen-Kombination, Stufe 0 bis 4, mit und ohne Gesicht, mit und ohne Pack', () => {
  assert.equal(ALT.erzeugtAus.startsWith('ad8fc11'), true);
  const szenen = Object.entries(ALT.szenen);
  assert.ok(szenen.length >= 10);
  assert.ok(szenen.some(([, s]) => s.treffer.length === 0 && s.flaechen.length === 0), 'Szene ohne Treffer');
  assert.ok(szenen.filter(([, s]) => s.flaechen.length > 0).length >= 7, 'Szenen mit Gesicht (alter Stil lieferte Balken)');
  assert.ok(szenen.some(([, s]) => s.treffer.some((t) => t.weiblich)), 'Szene mit Frau fuer Stufe 4');
  let geprueft = 0;
  // 1024 `an`-Kombinationen der Zonen, in zwei Staenden von `bedeckt` (alle bedeckbaren Zonen: aus oder an)
  for (let maske = 0; maske < 1 << ZONEN.length; maske++) {
    for (const bedeckt of [false, true]) {
      const zonen = {};
      ZONEN.forEach((z, i) => {
        zonen[z] = { an: !!(maske & (1 << i)), bedeckt };
      });
      for (const [name, szene] of szenen) {
        // die Stufen 0 und 4 fuer jede Kombination, 1 bis 3 fuer jede siebte (Rechenzeit); verschmelzen wechselt je Maske
        const stufen = maske % 7 === 0 ? [0, 1, 2, 3, 4] : [0, 4];
        for (const stufe of stufen) {
          for (const [packName, pack] of maske % 5 === 0 ? Object.entries(PACKS) : [['keins', null]]) {
            const neu = neueFlaechen(szene, zonen, stufe, pack, maske % 2 === 0);
            for (const alt of szene.flaechen) {
              assert.ok(neu.some((f) => gleich(f, alt)), `${name} Maske ${maske} bedeckt ${bedeckt} Stufe ${stufe} Pack ${packName}: Balken des alten Stils fehlt (${JSON.stringify(alt)})`);
            }
            geprueft++;
          }
        }
      }
    }
  }
  assert.ok(geprueft > 10000, `geprueft ${geprueft}`);
});

test('Deckung: ein Zustand, in dem der neue Stand mehr deckt als der alte: Zonen laut Schaltern und die Steigerung wirken, Stufe 4 verdeckt ganz und der Balken bleibt', () => {
  const szene = ALT.szenen.gesichtUndFrau;
  const zonen = vervollstaendige({}).zonen;
  const s0 = neueFlaechen(szene, zonen, 0, null, true);
  assert.ok(s0.some((f) => f.zone === 'breast' && f.behandlung === 'mosaik'), 'Mosaik auf der Brust laut Schaltern');
  assert.ok(s0.some((f) => f.behandlung === 'balken'));
  const s4 = neueFlaechen(szene, zonen, 4, null, true);
  assert.deepEqual(s4[0].box, [0, 0, szene.b, szene.h], 'Stufe 4: ganzes Bild');
  assert.equal(s4[0].behandlung, 'mosaik');
  assert.ok(s4.slice(1).every((f) => f.behandlung === 'balken') && s4.length === 1 + ALT.szenen.gesichtUndFrau.flaechen.length, 'Balken zusaetzlich zum ganzen Bild');
  // ohne Schalter bleibt es beim ganzen Bild allein (nichts anderes geaendert)
  const e = vervollstaendige({ preset: 'mosaik', zonen });
  const w = wirksameZonen(e, 4);
  const ohne = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: w.zonen, rand: e.rand, preset: 'mosaik' }, w.ganzVerdecken, szene.b, szene.h, true);
  assert.equal(ohne.length, 1);
});

// ---------- Test 3: R4 und R5 ----------

// Augenbereiche der Gesichter einer Szene: YuNet-Augenbox, bei einem 320n-Gesicht das geschaetzte Band.
function augenBoxen(szene) {
  const aus = [];
  for (const t of szene.treffer) {
    if (t.zone === 'eyes') aus.push(Object.assign([...t.box], { geneigt: t.winkel !== undefined }));
    else if (t.zone === 'face' && t.quelle !== 'yunet') aus.push(gesichtsZonen(t.box, szene.b, szene.h).eyes);
  }
  return aus;
}
function imRechteck(p, f) {
  if (f.balken) {
    const { mitte, breite, hoehe, winkel } = f.balken;
    const dx = p[0] - mitte[0];
    const dy = p[1] - mitte[1];
    const c = Math.cos(winkel);
    const s = Math.sin(winkel);
    const u = dx * c + dy * s;
    const v = -dx * s + dy * c;
    return Math.abs(u) <= breite / 2 + 1e-6 && Math.abs(v) <= hoehe / 2 + 1e-6;
  }
  return p[0] >= f.box[0] - 1e-6 && p[0] <= f.box[0] + f.box[2] + 1e-6 && p[1] >= f.box[1] - 1e-6 && p[1] <= f.box[1] + f.box[3] + 1e-6;
}
function augenGedeckt(box, flaechen) {
  // Eine geneigte Augenlinie dreht den Balken um die Mitte; die Ecken der achsenparallelen Augenbox liegen dann ausserhalb des gedrehten Rechtecks, ohne dass Augen
  // offen waeren (die Augen liegen auf der Linie). Dort zaehlt die Mittellinie.
  for (let i = 0; i <= 6; i++) {
    for (let j = box.geneigt ? 1 : 0; j <= (box.geneigt ? 1 : 2); j++) {
      const p = [box[0] + (box[2] * i) / 6, box[1] + (box[3] * j) / 2];
      if (!flaechen.some((f) => imRechteck(p, f))) return false;
    }
  }
  return true;
}

// Was gemalt wird, in der Reihenfolge des Zeichners (malLauf, dieselbe Funktion wie in src/erkenner/stile.ts und src/schleier/video-leinwand.ts). `miaGemalt`: das Malen von
// Mias Gesicht gelingt (true) oder scheitert (false: der Ersatz wird gemalt, danach kommen die Balken noch einmal). Liefert die Malliste (Index, Schicht, Wiederholung).
function malListe(flaechen, miaGemalt) {
  const log = [];
  malLauf(
    flaechen.map((f) => ({ behandlung: f.behandlung, gesichtMoeglich: f.behandlung === 'mia-gesicht' })),
    (i, schicht, wiederholung) => {
      log.push({ i, schicht, wiederholung, behandlung: flaechen[i].behandlung });
      return schicht === 'gesicht' ? miaGemalt : false;
    },
  );
  return log;
}
// Gemalte Flaechen: Mias Gesicht nur, wenn es gelingt; sonst deckt sein Ersatz dasselbe Rechteck (deckend, gleiche Box).
const gemalteFlaechen = (flaechen, log) => log.map((l) => flaechen[l.i]);

test('R4 und R5: Schalter an mal 12 Stile mal alle Zonen aus: jedes Gesicht hat verdeckte Augen (Balken oder Mias Gesicht), in Bild und mit jeder Stufe', () => {
  const alleAus = Object.fromEntries(ZONEN.map((z) => [z, { an: false, bedeckt: false }]));
  const nurFace = { ...alleAus, face: { an: true, bedeckt: false } };
  const mitGesicht = Object.entries(ALT.szenen).filter(([, s]) => augenBoxen(s).length > 0);
  assert.ok(mitGesicht.length >= 6);
  let geprueft = 0;
  for (const kennung of PRESET_IDS) {
    for (const [zName, zonen] of [['alle aus', alleAus], ['nur Face', nurFace]]) {
      for (const stufe of [0, 4]) {
        for (const [packName, pack] of Object.entries(PACKS)) {
          for (const [name, szene] of mitGesicht) {
            const e = vervollstaendige({ preset: kennung, augenbalken: true, zonen });
            const w = wirksameZonen(e, stufe);
            const preset = presetFuerPackKurz(e.preset, pack);
            const flaechen = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: w.zonen, rand: e.rand, preset, augenbalken: e.augenbalken }, w.ganzVerdecken, szene.b, szene.h, true);
            for (const miaGemalt of [true, false]) {
              const gemalt = gemalteFlaechen(flaechen, malListe(flaechen, miaGemalt));
              for (const augen of augenBoxen(szene)) {
                assert.ok(augenGedeckt(augen, gemalt), `${kennung} ${zName} Stufe ${stufe} Pack ${packName} ${name} Mias Gesicht gemalt ${miaGemalt}: Augen ${augen} offen`);
                geprueft++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(geprueft > 1500, `geprueft ${geprueft}`);
});

test('R4: ohne den Schalter bleiben die Augen in Stilen ohne Balken ohne Balken (der Schalter ist die einzige Ursache), mit Zensurbalken kommt er immer', () => {
  const alleAus = Object.fromEntries(ZONEN.map((z) => [z, { an: false, bedeckt: false }]));
  const szene = ALT.szenen.gesichtYunet;
  for (const kennung of PRESET_IDS) {
    const e = vervollstaendige({ preset: kennung, zonen: alleAus });
    const w = wirksameZonen(e, 0);
    const f = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: w.zonen, rand: e.rand, preset: kennung }, false, szene.b, szene.h, true);
    assert.equal(f.some((x) => x.behandlung === 'balken'), kennung === 'zensurbalken', kennung);
  }
});

// ---------- R11 (Test 1 der Nacharbeit): der Schalter kommt nur dazu und nimmt nie etwas weg ----------

test('R11: jede Flaeche mit Schalter aus ist mit Schalter an unveraendert da (Lage, Groesse, Behandlung), dazu je Gesicht ein Balken; Zensurbalken mit Schalter gleich ohne', () => {
  const szenen = Object.entries(ALT.szenen);
  let geprueft = 0;
  let mitEyesAn = 0;
  for (const kennung of PRESET_IDS) {
    for (let maske = 0; maske < 1 << ZONEN.length; maske += 3) {
      for (const bedeckt of [false, true]) {
        const zonen = {};
        ZONEN.forEach((z, i) => {
          zonen[z] = { an: !!(maske & (1 << i)), bedeckt };
        });
        for (const stufe of [0, 1, 2, 3, 4]) {
          for (const pack of Object.values(PACKS)) {
            for (const [name, szene] of szenen) {
              const flaechen = (schalter) => {
                const e = vervollstaendige({ preset: kennung, augenbalken: schalter, zonen });
                const w = wirksameZonen(e, stufe);
                return berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: w.zonen, rand: e.rand, preset: presetFuerPackKurz(e.preset, pack), augenbalken: e.augenbalken }, w.ganzVerdecken, szene.b, szene.h, maske % 2 === 0);
              };
              const aus = flaechen(false);
              const an = flaechen(true);
              for (const f of aus) assert.ok(an.some((g) => gleichDeckung(g, f)), `${kennung} Maske ${maske} Stufe ${stufe} ${name}: Flaeche ohne Schalter fehlt mit Schalter (${JSON.stringify(f)})`);
              for (const b of berechneAugenbalken(szene.treffer, szene.b, szene.h)) assert.ok(an.some((g) => gleich(g, b)), `${kennung} ${name}: Balken fehlt`);
              if (kennung === 'zensurbalken') assert.deepEqual(an.map(ohneWortBox), aus.map(ohneWortBox), `Zensurbalken mit Schalter gleich ohne (${name})`);
              if (zonen.eyes.an && szene.treffer.some((t) => t.zone === 'eyes')) mitEyesAn++;
              geprueft++;
            }
          }
        }
      }
    }
  }
  assert.ok(geprueft > 100000, `geprueft ${geprueft}`);
  assert.ok(mitEyesAn > 1000, 'der Fall Zone Eyes an mit Gesicht ist dabei');
});

test('R11: der Befund des Pruefers: Mosaik, Zone Eyes an, Schalter an: die Augenflaeche des Stils (Augenbox plus Rand) bleibt, der Balken liegt darueber', () => {
  const szene = ALT.szenen.gesichtYunet;
  const zonen = vervollstaendige({}).zonen;
  const mitEyes = { ...zonen, eyes: { an: true } };
  const aus = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: mitEyes, rand: 0.15, preset: 'mosaik' }, false, szene.b, szene.h, false);
  const an = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: mitEyes, rand: 0.15, preset: 'mosaik', augenbalken: true }, false, szene.b, szene.h, false);
  const augenAus = aus.filter((f) => f.zone === 'eyes');
  assert.equal(augenAus.length, 1);
  assert.equal(augenAus[0].behandlung, 'mosaik');
  assert.ok(an.some((f) => gleichDeckung(f, augenAus[0])), 'Augenflaeche mit Rand bleibt');
  assert.equal(an.filter((f) => f.behandlung === 'balken').length, 1);
  // und ohne die Zone Eyes entsteht durch den Schalter keine zusaetzliche Augenflaeche (nur der Balken)
  const ohneEyes = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen, rand: 0.15, preset: 'mosaik', augenbalken: true }, false, szene.b, szene.h, false);
  assert.deepEqual(ohneEyes.map((f) => f.behandlung), ['balken']);
});

// ---------- R12 (Test 2 der Nacharbeit): Malreihenfolge Zonen, Balken, Mias Gesicht ----------

test('R12: die Malreihenfolge ist Zonen (samt Ersatz), dann Balken, zuletzt Mias Gesicht; Mias Gesicht scheitert: die Balken kommen noch einmal obenauf', () => {
  const zonenListe = vervollstaendige({ preset: 'mia-wort', augenbalken: true, zonen: { face: { an: true }, breast: { an: true } } }).zonen;
  const szene = ALT.szenen.zweiGesichter;
  const e = vervollstaendige({ preset: 'mia-wort', augenbalken: true, zonen: zonenListe });
  const w = wirksameZonen(e, 0);
  const flaechen = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: w.zonen, rand: e.rand, preset: 'mia-wort', augenbalken: true }, false, szene.b, szene.h, true);
  assert.ok(flaechen.some((f) => f.behandlung === 'mia-gesicht') && flaechen.some((f) => f.behandlung === 'balken'));
  const rang = { zone: 0, balken: 1, gesicht: 2 };
  // gelingt: Zonen, Balken, Gesicht, ohne Wiederholung
  const gut = malListe(flaechen, true);
  assert.deepEqual(gut.map((l) => rang[l.schicht]), [...gut.map((l) => rang[l.schicht])].sort(), 'nach Schichten geordnet');
  assert.equal(gut.some((l) => l.wiederholung), false);
  assert.equal(gut.length, flaechen.length, 'jede Flaeche genau einmal');
  assert.equal(gut.at(-1).schicht, 'gesicht', 'Mias Gesicht zuletzt');
  // scheitert: Ersatz-Behandlung steht in der Schicht der Zonen (die Flaeche mit Behandlung mia-gesicht wird in der Zonen-Schicht gemalt, wenn sie nicht malbar ist), hier gesichtMoeglich
  // wahr: Gesicht kommt, scheitert, die Balken werden noch einmal gemalt und sind die oberste Schicht
  const schlecht = malListe(flaechen, false);
  assert.equal(schlecht.at(-1).behandlung, 'balken', 'die Balken sind die letzte Schicht');
  assert.equal(schlecht.at(-1).wiederholung, true);
  const letzte = new Map();
  schlecht.forEach((l) => letzte.set(l.i, schlecht.indexOf(l)));
  const balkenIndizes = flaechen.map((f, i) => (f.behandlung === 'balken' ? i : -1)).filter((i) => i >= 0);
  const gesichtIndizes = flaechen.map((f, i) => (f.behandlung === 'mia-gesicht' ? i : -1)).filter((i) => i >= 0);
  const letztePosition = (i) => schlecht.map((l, k) => (l.i === i ? k : -1)).filter((k) => k >= 0).at(-1);
  for (const b of balkenIndizes) for (const g of gesichtIndizes) assert.ok(letztePosition(b) > letztePosition(g), 'Balken liegt ueber dem gescheiterten Gesicht');
  // nicht malbar von Anfang an (kein Pack, kein Patch): das Gesicht zaehlt als Zone (Ersatz), danach die Balken
  const ohnePatch = [];
  malLauf(flaechen.map((f) => ({ behandlung: f.behandlung, gesichtMoeglich: false })), (i, schicht) => (ohnePatch.push({ i, schicht, b: flaechen[i].behandlung }), false));
  assert.ok(ohnePatch.filter((l) => l.b === 'mia-gesicht').every((l) => l.schicht === 'zone'));
  assert.equal(ohnePatch.at(-1).schicht, 'balken');
});

test('R12: Bild und Video benutzen dieselbe Malreihenfolge (malLauf), und die Geometriepruefung balkenUnterGemaltemGesicht ist weg', () => {
  const lies = (pfad) => readFileSync(join(HIER, '..', '..', pfad), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const pfad of ['src/erkenner/stile.ts', 'src/schleier/video-leinwand.ts']) assert.ok(/malLauf\(/.test(lies(pfad)), pfad);
  for (const pfad of ['src/erkenner/stile.ts', 'src/schleier/video-leinwand.ts', 'src/presets.ts']) assert.equal(/balkenUnterGemaltemGesicht/.test(lies(pfad)), false, pfad);
});

test('R4: Ganze-Person-Stile und Stufe 4 tragen den Balken auf Gesichtern, bei ausgeschalteten Zonen und mit dem Schalter; ohne Gesicht keine Flaeche', () => {
  const alleAus = Object.fromEntries(ZONEN.map((z) => [z, { an: false, bedeckt: false }]));
  const e = vervollstaendige({ preset: 'person-mosaik', augenbalken: true, zonen: alleAus });
  const leer = berechneBildFlaechen([], [], { zonen: e.zonen, rand: e.rand, preset: e.preset, augenbalken: true }, false, 400, 400, true);
  assert.deepEqual(leer, []);
  const szene = ALT.szenen.gesichtYunet;
  const f = berechneBildFlaechen(szene.treffer, szene.treffer, { zonen: e.zonen, rand: e.rand, preset: e.preset, augenbalken: true }, false, szene.b, szene.h, true);
  assert.deepEqual(f.map((x) => x.behandlung), ['balken']);
  // mit eingeschalteten Zonen: Person und Balken
  const an = berechneBildFlaechen([...szene.treffer, { zone: 'breast', bedeckt: false, score: 0.9, box: [300, 320, 160, 120] }], szene.treffer, { zonen: vervollstaendige({ preset: 'person-mosaik' }).zonen, rand: 0.15, preset: 'person-mosaik', augenbalken: true }, false, szene.b, szene.h, true);
  assert.ok(an.some((x) => x.behandlung === 'mosaik') && an.some((x) => x.behandlung === 'balken'));
});

// N4 / Punkt 7: kein Text sagt "nichts" oder "nothing", solange der Balken gilt und alle Zonen aus sind.
test('Texte: Kurzzeile und Hinweis sagen bei Schalter an und allen Zonen aus nicht, dass nichts verdeckt wird', () => {
  assert.match(ABDECKUNG_KURZ([], false), /nothing/, 'ohne Schalter bleibt der Satz wie er war');
  assert.doesNotMatch(ABDECKUNG_KURZ([], true), /nothing|nichts/i);
  assert.match(ABDECKUNG_KURZ([], true), /eyes/);
  assert.match(ABDECKUNG_KURZ(['eyes', 'breasts'], true), /eyes, breasts, plus the eyes with a black bar/);
  // Die Hinweise zu den Zonen (zonenHinweis in src/oberflaeche/preset-texte.ts liefert nur diese beiden) und die Saetze des Schalters sagen nicht, dass nichts gedeckt wird.
  // ("add nothing on top" im Mia-Hinweis meint die Zonen Eyes und Mouth bei Face an, nicht die Deckung.)
  for (const t of [HINWEIS_ZONEN_ZENSURBALKEN, EYE_BAR_TEXT, EYE_BAR_SATZ]) assert.doesNotMatch(t, /nothing|nichts/i);
  assert.doesNotMatch(HINWEIS_ZONEN_MIA, /nothing (is )?(covered|hidden|veiled)|nothing right now/i);
});
