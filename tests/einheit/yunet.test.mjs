// Einheitstests ohne Browser: YuNet-Nachverarbeitung (src/erkenner/yunet.ts) und die Zonenformeln aus YuNet-Punkten (src/erkenner/zonen.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { yunetNachverarbeite as kernNachverarbeite } from '../../scripts/messung/yunet-kern.mjs';
import { yunetNachverarbeite, yunetTensorDaten } from '../../src/erkenner/yunet.ts';
import {
  aktiveZonenBoxen,
  berechneFlaechen,
  kombiniereGesichter,
  yunetAugenBox,
  yunetMundBox,
  yunetTreffer,
} from '../../src/erkenner/zonen.ts';

// Vergleich mit Toleranz (Float32 rechnet nicht ganz exakt: log und exp).
const nah = (ist, soll, tol = 1e-9) => {
  assert.equal(ist.length, soll.length);
  ist.forEach((v, i) => assert.ok(Math.abs(v - soll[i]) < tol, `${v} statt ${soll[i]}`));
};

const S = 640;
const SKALA = 0.5; // Bild 1280 breit

// Leere Ausgaben (alles unter der Schwelle) in der Form des Modells.
function leereAusgaben() {
  const a = {};
  for (const schritt of [8, 16, 32]) {
    const n = (S / schritt) ** 2;
    a[`cls_${schritt}`] = new Float32Array(n);
    a[`obj_${schritt}`] = new Float32Array(n);
    a[`bbox_${schritt}`] = new Float32Array(n * 4);
    a[`kps_${schritt}`] = new Float32Array(n * 10);
  }
  return a;
}

// Setzt eine Zelle (Stufe schritt, Zeile r, Spalte c).
function setze(a, schritt, r, c, { cls, obj, bbox, kps }) {
  const spalten = S / schritt;
  const i = r * spalten + c;
  a[`cls_${schritt}`][i] = cls;
  a[`obj_${schritt}`][i] = obj;
  a[`bbox_${schritt}`].set(bbox, i * 4);
  a[`kps_${schritt}`].set(kps, i * 10);
}

// Feste Zelle: Stufe 8, Zeile 10, Spalte 20, Score Wurzel(0,81 * 1) = 0,9, Box 32 x 32 im Feld, Mitte (164, 84).
const ZELLE = {
  cls: 0.81,
  obj: 1,
  bbox: [0.5, 0.5, Math.log(4), Math.log(4)],
  // x, y je Punkt als Abstand zur Zelle in Zelleneinheiten (Schritt 8); im Bild mal 8 / 0,5 = mal 16
  kps: [-0.5, -1, 1.5, -1, 0.5, 0, -0.25, 1, 1.25, 1],
};

test('YuNet: feste Zelle ergibt Box und fuenf Punkte in Bildkoordinaten', () => {
  const a = leereAusgaben();
  setze(a, 8, 10, 20, ZELLE);
  const g = yunetNachverarbeite(a, S, SKALA);
  assert.equal(g.length, 1);
  assert.equal(g[0].score, 0.9);
  nah(g[0].box, [296, 136, 64, 64], 1e-5);
  assert.deepEqual(g[0].punkte, [[312, 144], [344, 144], [328, 160], [316, 176], [340, 176]]);
});

test('YuNet: Werte unter der Schwelle 0,75 fallen weg, cls und obj werden auf 0 bis 1 begrenzt', () => {
  const a = leereAusgaben();
  setze(a, 8, 10, 20, { ...ZELLE, cls: 0.5, obj: 0.5 });
  assert.equal(yunetNachverarbeite(a, S, SKALA).length, 0);
  // Wurzel(0,5625) = 0,75: genau auf der Schwelle fliegt es raus (wie OpenCV: behalten wird nur score > 0,75)
  setze(a, 8, 10, 20, { ...ZELLE, cls: 0.5625, obj: 1 });
  assert.equal(yunetNachverarbeite(a, S, SKALA).length, 0);
  setze(a, 8, 10, 20, { ...ZELLE, cls: 0.57, obj: 1 });
  assert.equal(yunetNachverarbeite(a, S, SKALA).length, 1);
  // Werte ueber 1 zaehlen als 1
  setze(a, 8, 10, 20, { ...ZELLE, cls: 7, obj: 7 });
  assert.equal(yunetNachverarbeite(a, S, SKALA)[0].score, 1);
});

test('YuNet: NMS 0,3 entfernt ueberlappende Zellen, ferne Gesichter bleiben, hoechster Wert zuerst', () => {
  const a = leereAusgaben();
  setze(a, 8, 10, 20, ZELLE);
  // Nachbarzelle: gleiche Groesse, 16 Bildpixel versetzt, IoU 0,6, schwaecher
  setze(a, 8, 10, 21, { ...ZELLE, cls: 0.64 });
  // Fernes Gesicht auf Stufe 16 (Zeile 30, Spalte 5), Score 0,8
  setze(a, 16, 30, 5, { cls: 0.64, obj: 1, bbox: [0.5, 0.5, Math.log(2), Math.log(2)], kps: new Array(10).fill(0.5) });
  const g = yunetNachverarbeite(a, S, SKALA);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.score), [0.9, 0.8]);
  nah(g[1].box, [(5.5 * 16 - 16) / SKALA, (30.5 * 16 - 16) / SKALA, 64, 64], 1e-5);
});

test('YuNet: fehlende Ausgabe ist ein Fehler', () => {
  const a = leereAusgaben();
  delete a.cls_16;
  assert.throws(() => yunetNachverarbeite(a, S, SKALA), /Stufe 16/);
});

test('YuNet: gleiche Zahlen wie das Messwerkzeug (Zufallsausgaben)', () => {
  // Einfacher Zufallsgenerator mit festem Startwert, damit der Test wiederholbar ist.
  let z = 12345;
  const zufall = () => (z = (z * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let lauf = 0; lauf < 5; lauf++) {
    const a = leereAusgaben();
    for (const schritt of [8, 16, 32]) {
      const n = (S / schritt) ** 2;
      for (let i = 0; i < n; i++) {
        // Wenige starke Zellen, dazwischen schwache
        const stark = zufall() < 0.01;
        a[`cls_${schritt}`][i] = stark ? 0.8 + 0.2 * zufall() : 0.5 * zufall();
        a[`obj_${schritt}`][i] = stark ? 0.8 + 0.2 * zufall() : 0.5 * zufall();
        for (let k = 0; k < 4; k++) a[`bbox_${schritt}`][i * 4 + k] = k < 2 ? zufall() - 0.5 : 0.5 + zufall();
        for (let k = 0; k < 10; k++) a[`kps_${schritt}`][i * 10 + k] = 3 * (zufall() - 0.5);
      }
    }
    const skala = 0.3 + zufall();
    const meins = yunetNachverarbeite(a, S, skala);
    const kern = kernNachverarbeite(a, S, skala, 0, 0);
    assert.ok(meins.length > 0, 'Zufallsausgabe sollte Gesichter enthalten');
    assert.equal(meins.length, kern.length);
    meins.forEach((g, i) => {
      assert.equal(g.score, kern[i].score);
      assert.deepEqual(g.box, kern[i].box);
      assert.deepEqual(g.punkte, kern[i].lm);
    });
  }
});

test('YuNet: Tensordaten sind BGR, 0 bis 255, planar', () => {
  const px = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]); // 2 x 2 RGBA
  const d = yunetTensorDaten(px, 2);
  assert.deepEqual(Array.from(d), [30, 60, 90, 120, 20, 50, 80, 110, 10, 40, 70, 100]);
});

// ---------- Zonenformeln ----------
const GESICHT = {
  score: 0.9,
  box: [296, 136, 64, 64],
  punkte: [[312, 144], [344, 144], [328, 160], [316, 176], [340, 176]],
};

test('Zonenformeln: Augenbox aus den Augenpunkten', () => {
  // Abstand 32: Breite 73,6; Hoehe max(0,24 * 64 = 15,36; 0,75 * 32 = 24) = 24; Mitte (328, 144)
  nah(yunetAugenBox(GESICHT), [291.2, 132, 73.6, 24]);
  // Gesichtshoehe bestimmt die Hoehe, wenn sie ueberwiegt
  nah(yunetAugenBox({ ...GESICHT, box: [296, 100, 64, 200] }), [291.2, 144 - 24, 73.6, 48]);
  // Augenabstand mindestens 6 px
  nah(yunetAugenBox({ ...GESICHT, punkte: [[100, 50], [101, 50], [0, 0], [0, 0], [0, 0]], box: [90, 40, 20, 20] }), [100.5 - 6.9, 50 - 2.4, 13.8, 4.8]);
});

test('Zonenformeln: Mundbox aus den Mundwinkeln', () => {
  // Winkelabstand 24: Breite 48; Hoehe max(0,22 * 64 = 14,08; 0,5 * 48 = 24) = 24; Mitte (328, 176)
  nah(yunetMundBox(GESICHT), [304, 164, 48, 24]);
  // Winkelabstand mindestens 10 px: Breite 20, Hoehe max(0,22 * 20 = 4,4; 10) = 10
  nah(yunetMundBox({ ...GESICHT, box: [0, 0, 20, 20], punkte: [[0, 0], [0, 0], [0, 0], [50, 60], [52, 60]] }), [41, 55, 20, 10]);
});

test('Zonenformeln: YuNet-Treffer tragen die Quelle, ganze Pixel und bleiben im Bild', () => {
  const t = yunetTreffer(GESICHT, 1280, 800);
  assert.deepEqual(t.map((x) => x.zone), ['face', 'head', 'eyes', 'mouth']);
  for (const x of t) {
    assert.equal(x.quelle, 'yunet');
    assert.equal(x.bedeckt, false);
    assert.equal(x.score, 0.9);
    assert.ok(x.box.every(Number.isInteger));
  }
  assert.deepEqual(t[0].box, [296, 136, 64, 64]);
  assert.deepEqual(t[1].box, [273, 94, 110, 126]);
  assert.deepEqual(t[2].box, [291, 132, 74, 24]);
  assert.deepEqual(t[3].box, [304, 164, 48, 24]);
  // Am Bildrand begrenzt
  const rand = yunetTreffer({ ...GESICHT, box: [-20, -20, 64, 64] }, 100, 100);
  for (const x of rand) assert.ok(x.box[0] >= 0 && x.box[1] >= 0 && x.box[0] + x.box[2] <= 100 && x.box[1] + x.box[3] <= 100);
});

const treffer = (zone, box, extra = {}) => ({ zone, bedeckt: false, score: 0.5, box, ...extra });

test('Kombinieren: 320n-Gesicht mit YuNet-Gesicht (IoU ab 0,3) entfaellt, ohne Entsprechung bleibt es', () => {
  const passend = treffer('face', [300, 140, 64, 64]);
  const fern = treffer('face', [900, 500, 80, 80]);
  const brust = treffer('breast', [296, 300, 100, 100]);
  const alle = kombiniereGesichter([passend, fern, brust], [GESICHT], 1280, 800);
  assert.deepEqual(alle.filter((t) => t.quelle !== 'yunet').map((t) => t.zone), ['face', 'breast']);
  assert.deepEqual(alle.find((t) => t.quelle !== 'yunet' && t.zone === 'face').box, [900, 500, 80, 80]);
  assert.equal(alle.filter((t) => t.quelle === 'yunet').length, 4);
  // Ohne YuNet-Gesichter bleibt alles wie es war
  assert.deepEqual(kombiniereGesichter([passend, fern], [], 1280, 800), [passend, fern]);
  // Reicht die YuNet-Box ueber den Bildrand, zaehlt fuer den Vergleich ihr sichtbarer Teil: unbegrenzt waere die IoU nur 0,29
  const randGesicht = { ...GESICHT, box: [-100, 0, 140, 100] };
  const amRand = treffer('face', [0, 0, 40, 100]);
  assert.equal(kombiniereGesichter([amRand], [randGesicht], 1280, 800).filter((t) => t.quelle !== 'yunet').length, 0);
  // Eins zu eins: zwei 320n-Gesichter ueber demselben YuNet-Gesicht, nur das besser passende entfaellt, das andere behaelt seine Baender
  const gut = treffer('face', [296, 136, 64, 64]);
  const schlechter = treffer('face', [310, 140, 64, 64]);
  const zwei = kombiniereGesichter([schlechter, gut], [GESICHT], 1280, 800).filter((t) => t.quelle !== 'yunet');
  assert.equal(zwei.length, 1);
  assert.deepEqual(zwei[0].box, [310, 140, 64, 64]);
  // Zwei YuNet-Gesichter, ein 320n-Gesicht: es entfaellt einmal, beide YuNet-Gesichter bleiben
  const zweitesGesicht = { ...GESICHT, box: [330, 140, 64, 64] };
  const eins = kombiniereGesichter([gut], [GESICHT, zweitesGesicht], 1280, 800);
  assert.equal(eins.filter((t) => t.quelle !== 'yunet').length, 0);
  assert.equal(eins.filter((t) => t.quelle === 'yunet' && t.zone === 'face').length, 2);
  // Unter 0,3 (hier etwa 0,19): bleibt
  const daneben = treffer('face', [296 + 44, 136, 64, 64]);
  assert.equal(kombiniereGesichter([daneben], [GESICHT], 1280, 800).filter((t) => t.quelle !== 'yunet').length, 1);
});

const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
function zonen(an) {
  const z = {};
  for (const name of ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR]) {
    z[name] = BEDECKBAR.includes(name) ? { an: an.includes(name), bedeckt: false } : { an: an.includes(name) };
  }
  return z;
}

test('Zonen aus YuNet-Gesicht: Augen und Mund aus den Punkten, Gesicht und Kopf aus der Box, nur eingeschaltete', () => {
  const t = yunetTreffer(GESICHT, 1280, 800);
  const nurAugen = aktiveZonenBoxen(t, zonen(['eyes']), 1280, 800);
  assert.deepEqual(nurAugen.map((f) => f.zone), ['eyes']);
  assert.deepEqual(nurAugen[0].box, [291, 132, 74, 24]);
  const alle = aktiveZonenBoxen(t, zonen(['eyes', 'mouth', 'face', 'head']), 1280, 800);
  assert.deepEqual(alle.map((f) => f.zone).sort(), ['eyes', 'face', 'head', 'mouth']);
  assert.deepEqual(alle.find((f) => f.zone === 'mouth').box, [304, 164, 48, 24]);
  assert.deepEqual(alle.find((f) => f.zone === 'face').box, [296, 136, 64, 64]);
  // Mit Rand und Zusammenfuehren bleibt von jeder Zone genau eine Flaeche
  const fl = berechneFlaechen(t, { zonen: zonen(['eyes', 'mouth']), rand: 0.15 }, 1280, 800);
  assert.deepEqual(fl.map((f) => f.zone).sort(), ['eyes', 'mouth']);
});

test('Kopf aus der unbegrenzten YuNet-Box, erst danach auf das Bild begrenzt (rechter und unterer Rand)', () => {
  // Bild 1000 x 800, Gesicht ragt rechts und unten ueber den Rand: Box 940, 700, 100 x 120
  const g = { ...GESICHT, box: [940, 700, 100, 120] };
  const t = yunetTreffer(g, 1000, 800);
  assert.deepEqual(t.find((x) => x.zone === 'face').box, [940, 700, 60, 100]);
  // Kopf aus der vollen Box: x 905, y 622, 170 x 234, begrenzt auf [905, 622, 95, 178]. Aus der begrenzten Box waere er [919, 635, 81, 165].
  assert.deepEqual(t.find((x) => x.zone === 'head').box, [905, 622, 95, 178]);
  const fl = aktiveZonenBoxen(t, zonen(['head', 'face']), 1000, 800);
  assert.deepEqual(fl.find((f) => f.zone === 'head').box, [905, 622, 95, 178]);
  // Gleiches am linken und oberen Rand
  const links = yunetTreffer({ ...GESICHT, box: [-30, -40, 100, 120] }, 1000, 800);
  assert.deepEqual(links.find((x) => x.zone === 'head').box, [0, 0, 105, 116]);
});

test('Zonen: 320n-Gesicht ohne YuNet-Entsprechung bekommt die verschobenen Baender', () => {
  const alle = kombiniereGesichter([treffer('face', [900, 500, 100, 100])], [GESICHT], 1280, 800);
  const fl = aktiveZonenBoxen(alle, zonen(['eyes', 'mouth']), 1280, 800);
  // Augen 18 bis 42 %, Mund 62 bis 86 % von 100 px Hoehe, Breite 90 % und 60 %
  assert.ok(fl.some((f) => f.zone === 'eyes' && f.box.join() === [905, 518, 90, 24].join()));
  assert.ok(fl.some((f) => f.zone === 'mouth' && f.box.join() === [920, 562, 60, 24].join()));
});
