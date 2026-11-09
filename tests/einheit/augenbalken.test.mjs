// Einheitstests Stil Eye bar (Augenbalken): Einstellungen, wirksame Zonen, Balken-Geometrie, Neigung der Augenlinie.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESET_IDS, STANDARD, ZONEN, vervollstaendige, zonenFuerPreset } from '../../src/einstellungen.ts';
import {
  AUGENBALKEN_BREITE_FAKTOR_320N,
  AUGENBALKEN_HOEHE_FAKTOR,
  AUGENBALKEN_HOEHE_FAKTOR_320N,
  AUGENBALKEN_MIN_WINKEL,
  augenWinkel,
  augenbalken,
  berechneAugenbalken,
  berechneFlaechen,
  yunetTreffer,
} from '../../src/erkenner/zonen.ts';
import { wirksameZonen } from '../../src/steigerung.ts';

const alleAn = () => vervollstaendige({ zonen: Object.fromEntries(ZONEN.map((z) => [z, { an: true, bedeckt: true }])) }).zonen;
const gesicht = (box, re, le) => ({ score: 0.9, box, punkte: [re, le, [0, 0], [0, 0], [0, 0]] });

test('Einstellungen: alle Presets sind gueltig, alte `stil`-Werte werden zu Presets, Unbekanntes wird der Standard', () => {
  for (const preset of PRESET_IDS) assert.equal(vervollstaendige({ preset }).preset, preset);
  assert.equal(vervollstaendige({ preset: 'balken' }).preset, STANDARD.preset);
  assert.equal(vervollstaendige({}).preset, STANDARD.preset);
  // Migration aus dem alten `stil` (siehe auch preset-migration in presets.test.mjs)
  assert.equal(vervollstaendige({ stil: 'augenbalken' }).preset, 'augenbalken');
  assert.equal(vervollstaendige({ stil: 'mia-patch' }).preset, 'mia-wort');
});

test('zonenFuerPreset: Augenbalken schaltet alles ausser den Augen ab, Zensurbalken schaltet die Augen dazu, andere Presets lassen die Zonen unveraendert', () => {
  const z = alleAn();
  const nur = zonenFuerPreset('augenbalken', z);
  for (const name of ZONEN) assert.equal(nur[name].an, name === 'eyes', name);
  assert.ok(ZONEN.every((n) => nur[n].bedeckt !== true));
  // Auch bei ausgeschalteten Augen (Standard): im Preset Augenbalken laufen die Augen.
  assert.equal(zonenFuerPreset('augenbalken', STANDARD.zonen).eyes.an, true);
  const mit = zonenFuerPreset('zensurbalken', STANDARD.zonen);
  assert.equal(mit.eyes.an, true);
  assert.equal(mit.breast.an, STANDARD.zonen.breast.an);
  for (const preset of ['mosaik', 'blur', 'mia-wort', 'person-blur', undefined]) assert.equal(zonenFuerPreset(preset, z), z);
  // Die Eingabe bleibt unberuehrt.
  assert.equal(z.breast.an, true);
});

test('Steigerung: im Preset Augenbalken bleibt es bei den Augen, auch auf Stufe 4 (kein ganzes Bild)', () => {
  for (const stufe of [0, 1, 2, 3, 4]) {
    const w = wirksameZonen({ zonen: STANDARD.zonen, preset: 'augenbalken' }, stufe);
    assert.equal(w.ganzVerdecken, false, `Stufe ${stufe}`);
    for (const name of ZONEN) assert.equal(w.zonen[name].an, name === 'eyes', `${name} Stufe ${stufe}`);
  }
  // Andere Presets: Stufe 4 verdeckt weiter ganz, Stufe 2 fuegt Gesicht, Augen, Mund dazu.
  assert.equal(wirksameZonen({ zonen: STANDARD.zonen, preset: 'mosaik' }, 4).ganzVerdecken, true);
  assert.equal(wirksameZonen({ zonen: STANDARD.zonen }, 2).zonen.face.an, true);
  // Zensurbalken: Steigerung wie sonst, Augen immer an
  assert.equal(wirksameZonen({ zonen: STANDARD.zonen, preset: 'zensurbalken' }, 0).zonen.eyes.an, true);
  assert.equal(wirksameZonen({ zonen: STANDARD.zonen, preset: 'zensurbalken' }, 4).ganzVerdecken, true);
});

test('augenbalken: achsenparallel ohne Winkel, YuNet Hoehe mal 1,3 und Breite unveraendert, 320n Hoehe mal 1,6 und Breite mal 1,2', () => {
  const box = [100, 100, 200, 40];
  const y = augenbalken(box, true, undefined, 1000, 1000);
  assert.equal(y.zone, 'eyes');
  assert.equal(y.balken, undefined);
  assert.equal(y.box[0], 100);
  assert.equal(y.box[2], 200);
  assert.ok(Math.abs(y.box[3] - 40 * AUGENBALKEN_HOEHE_FAKTOR) <= 2);
  const n = augenbalken(box, false, undefined, 1000, 1000);
  assert.ok(Math.abs(n.box[2] - 200 * AUGENBALKEN_BREITE_FAKTOR_320N) <= 2);
  assert.ok(Math.abs(n.box[3] - 40 * AUGENBALKEN_HOEHE_FAKTOR_320N) <= 2);
  // Mitte bleibt die Mitte der Augenbox (auf ganze Pixel gerundet).
  assert.ok(Math.abs(n.box[0] + n.box[2] / 2 - 200) <= 1.5 && Math.abs(n.box[1] + n.box[3] / 2 - 120) <= 1.5);
  // Der Balken deckt die ganze Augenbox.
  for (const f of [y, n]) {
    assert.ok(f.box[0] <= box[0] && f.box[1] <= box[1] && f.box[0] + f.box[2] >= box[0] + box[2] && f.box[1] + f.box[3] >= box[1] + box[3]);
  }
});

test('augenbalken: am Bildrand auf das Bild begrenzt', () => {
  const f = augenbalken([0, 0, 100, 30], false, undefined, 105, 20);
  assert.deepEqual([f.box[0], f.box[1]], [0, 0]);
  assert.ok(f.box[0] + f.box[2] <= 105 && f.box[1] + f.box[3] <= 20);
});

test('augenbalken: mit Winkel gedreht um die Mitte, Box ist die umschliessende', () => {
  const w = Math.PI / 6; // 30 Grad
  const f = augenbalken([100, 100, 200, 40], true, w, 1000, 1000);
  assert.ok(f.balken);
  assert.deepEqual(f.balken.mitte, [200, 120]);
  assert.equal(f.balken.winkel, w);
  assert.equal(f.balken.breite, 200);
  assert.ok(Math.abs(f.balken.hoehe - 52) < 1e-9);
  const ub = 200 * Math.cos(w) + 52 * Math.sin(w);
  const uh = 200 * Math.sin(w) + 52 * Math.cos(w);
  assert.ok(Math.abs(f.box[2] - ub) <= 2 && Math.abs(f.box[3] - uh) <= 2);
});

test('augenWinkel: waagerecht bleibt leer, Neigung im Uhrzeigersinn positiv, auf dem Kopf dieselbe Linie', () => {
  assert.equal(augenWinkel(gesicht([0, 0, 100, 100], [30, 50], [70, 50])), undefined);
  // unter drei Grad gilt als waagerecht
  assert.equal(augenWinkel(gesicht([0, 0, 100, 100], [30, 50], [70, 52])), undefined);
  const w = augenWinkel(gesicht([0, 0, 100, 100], [30, 50], [70, 70]));
  assert.ok(Math.abs(w - Math.atan2(20, 40)) < 1e-9 && w > AUGENBALKEN_MIN_WINKEL);
  assert.ok(augenWinkel(gesicht([0, 0, 100, 100], [30, 70], [70, 50])) < 0);
  // Reihenfolge vertauscht (Gesicht auf dem Kopf): derselbe Winkel in (-90, 90] Grad
  const v = augenWinkel(gesicht([0, 0, 100, 100], [70, 70], [30, 50]));
  assert.ok(Math.abs(v - Math.atan2(20, 40)) < 1e-9);
  // zu dichte Augen: keine Richtung
  assert.equal(augenWinkel(gesicht([0, 0, 100, 100], [50, 50], [52, 53])), undefined);
});

test('yunetTreffer: Augen und Gesicht tragen den Winkel (Augenbalken, Mias Gesicht), Kopf und Mund nicht', () => {
  const t = yunetTreffer(gesicht([20, 20, 100, 120], [45, 60], [95, 90]), 400, 400);
  assert.ok(typeof t.find((x) => x.zone === 'eyes').winkel === 'number');
  assert.equal(t.find((x) => x.zone === 'face').winkel, t.find((x) => x.zone === 'eyes').winkel);
  for (const z of ['head', 'mouth']) assert.equal(t.find((x) => x.zone === z).winkel, undefined);
  const gerade = yunetTreffer(gesicht([20, 20, 100, 120], [45, 60], [95, 60]), 400, 400);
  assert.equal('winkel' in gerade.find((x) => x.zone === 'eyes'), false);
  assert.equal('winkel' in gerade.find((x) => x.zone === 'face'), false);
});

test('berechneFlaechen im Stil Eye bar: nur Augen, Zonen-Schalter egal, kein Gesicht gibt keine Flaeche', () => {
  const ein = { zonen: alleAn(), rand: 0.15, preset: 'augenbalken' };
  const treffer = yunetTreffer(gesicht([100, 100, 120, 150], [130, 150], [190, 150]), 500, 500);
  // dazu ein Treffer einer Brust: im Stil Eye bar ohne Wirkung
  treffer.push({ zone: 'breast', bedeckt: false, score: 0.9, box: [0, 300, 200, 100] });
  const f = berechneFlaechen(treffer, ein, 500, 500);
  assert.equal(f.length, 1);
  assert.equal(f[0].zone, 'eyes');
  // Mit allen Zonen aus, anderer Stil: Eye bar liefert trotzdem den Balken.
  const aus = { zonen: vervollstaendige({}).zonen, rand: 0, preset: 'augenbalken' };
  assert.equal(berechneFlaechen(treffer, aus, 500, 500).length, 1);
  assert.equal(berechneFlaechen([{ zone: 'breast', bedeckt: false, score: 0.9, box: [0, 300, 200, 100] }], ein, 500, 500).length, 0);
  assert.equal(berechneFlaechen([], ein, 500, 500).length, 0);
});

test('berechneAugenbalken: 320n-Gesicht liefert das geschaetzte Band, zwei Gesichter zwei Balken, Doppelungen bleiben', () => {
  const t320 = { zone: 'face', bedeckt: false, score: 0.9, box: [50, 50, 100, 120] };
  const f = berechneAugenbalken([t320], 400, 400);
  assert.equal(f.length, 1);
  assert.equal(f[0].balken, undefined);
  // geschaetztes Band: y von 50 + 0,18 * 120 = 71,6 bis 50 + 0,42 * 120 = 100,4: der Balken deckt es
  assert.ok(f[0].box[1] <= 71 && f[0].box[1] + f[0].box[3] >= 101);
  assert.equal(berechneAugenbalken([t320, { ...t320, box: [250, 50, 100, 120] }], 400, 400).length, 2);
  // zwei Balken uebereinander schaden nicht (schwarz auf schwarz), also wird nichts ausgefiltert
  assert.equal(berechneAugenbalken([t320, { ...t320 }], 400, 400).length, 2);
});

test('berechneAugenbalken: ein gedrehter Balken verschluckt den kleinen Balken eines zweiten Gesichts in der Ecke seiner Huelle nicht', () => {
  const gross = { zone: 'eyes', bedeckt: false, score: 0.9, box: [100, 100, 300, 60], quelle: 'yunet', winkel: Math.PI / 6 };
  const klein = { zone: 'eyes', bedeckt: false, score: 0.9, box: [102, 24, 20, 10], quelle: 'yunet' };
  const f = berechneAugenbalken([gross, klein], 600, 400);
  assert.equal(f.length, 2);
  const g = f.find((x) => x.balken);
  // Die Ecke liegt in der Huelle des gedrehten Balkens, aber nicht in ihm selbst: genau der Fall, der frueher den Balken kostete.
  const k = f.find((x) => !x.balken);
  assert.ok(g.box[0] <= k.box[0] && g.box[1] <= k.box[1] && k.box[0] + k.box[2] <= g.box[0] + g.box[2] && k.box[1] + k.box[3] <= g.box[1] + g.box[3], 'Ecke liegt in der Huelle');
});

test('320n-Rueckfall: der Balken deckt die Augenpunkte bei den gemessenen Lagen (Augenlinie 0,21 bis 0,36 der Gesichtshoehe, Augen bei 0,25 und 0,75 der Breite)', () => {
  // Messung scripts/messung/yunet.mjs (Satz sfw und nsfw, 98 Paare): Augenlinie relativ zur 320n-Box p10 0,206, Median 0,263, p90 0,36.
  for (const [w, h] of [[100, 120], [240, 300], [60, 80]]) {
    for (const rel of [0.206, 0.263, 0.36]) {
      for (const xr of [0.25, 0.75]) {
        const f = berechneAugenbalken([{ zone: 'face', bedeckt: false, score: 0.9, box: [100, 100, w, h] }], 800, 800)[0];
        const px = 100 + xr * w;
        const py = 100 + rel * h;
        assert.ok(px >= f.box[0] && px <= f.box[0] + f.box[2] && py >= f.box[1] && py <= f.box[1] + f.box[3], `Augenpunkt ${xr}/${rel} bei ${w}x${h} im Balken ${f.box}`);
      }
    }
  }
});

test('320n-Rueckfall: groessere Faktoren als bei YuNet (Hoehe 1,6, Breite 1,2)', () => {
  assert.equal(AUGENBALKEN_HOEHE_FAKTOR_320N, 1.6);
  assert.equal(AUGENBALKEN_BREITE_FAKTOR_320N, 1.2);
  const y = augenbalken([100, 100, 200, 40], true, undefined, 1000, 1000);
  const n = augenbalken([100, 100, 200, 40], false, undefined, 1000, 1000);
  assert.ok(n.box[3] > y.box[3] && n.box[2] > y.box[2]);
  assert.ok(Math.abs(n.box[3] - 64) <= 2 && Math.abs(n.box[2] - 240) <= 2);
});
