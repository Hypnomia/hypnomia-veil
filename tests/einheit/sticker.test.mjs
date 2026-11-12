// Einheitstests der Sticker-Zensur, Stufe A (STICKER-BAUPLAN): Geometrie und Farbe (src/sticker.ts), Flaechen und Behandlungen der beiden
// Presets, wirksames Preset mit und ohne `zensur:sticker`, Vertrag und Format (Rolle, Freischaltung faellt ohne Rolle weg, altes Pack bleibt
// gueltig), Dummy-Pack mit und ohne Sticker, Zeichenregeln S1 und S2 an einem aufzeichnenden Kontext.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  STICKER_ANTEIL,
  STICKER_FARBEN,
  STICKER_MAX_VERSUCHE,
  STICKER_MIN_SEITE,
  holeJeFlaeche,
  ordneNeu,
  waehleNaechsten,
  stickerFarbe,
  stickerFarbName,
  stickerPasst,
  stickerRechteck,
  stickerStart,
} from '../../src/sticker.ts';
import { FARBEN } from '../../src/oberflaeche/design/werte.ts';
import { PRESETS, PRESET_IDS, behandlungFuerZone, ganzesBildBehandlung, nutztMiasGesicht, nutztSticker, packGenuegt, presetFuerPack } from '../../src/presets.ts';
import { ZONEN, vervollstaendige, waehlePreset } from '../../src/einstellungen.ts';
import { berechneFlaechen, yunetTreffer } from '../../src/erkenner/zonen.ts';
import { rahmenBreite, zeichneSticker } from '../../src/erkenner/stile.ts';
import { pruefePack, quelleAusBytes, schreibePack } from '../../src/pack/format.ts';
import { BENOETIGT, FREISCHALTUNGEN, ROLLEN, kurzAusRoh, presetFuerPackKurz } from '../../src/pack/vertrag.ts';
import { baueDummyPack, DUMMY_STICKER } from '../../scripts/pack/baue-pack.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const kodiere = (t) => new TextEncoder().encode(t);
const LIZENZ = { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Lizenz'), rolle: 'lizenz' };
const kopf = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', erstellt: 'x', mindestVeil: VERSION, freischaltungen });
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);

// ---------- Farbe ----------

test('stickerFarbe: stabil je Schluessel, nur die drei Pastelltoene aus werte.ts, alle drei kommen vor', () => {
  assert.deepEqual([...STICKER_FARBEN], ['rosa-200', 'lav-200', 'pfirsich-200']);
  const erlaubt = new Set(STICKER_FARBEN.map((n) => FARBEN[n]));
  const gesehen = new Set();
  for (let i = 0; i < 300; i++) {
    const k = `bild-${i}|face|${i},${i * 2},50,60`;
    const f = stickerFarbe(k);
    assert.ok(erlaubt.has(f), `${k}: ${f}`);
    assert.equal(stickerFarbe(k), f, 'stabil beim zweiten Aufruf');
    assert.equal(FARBEN[stickerFarbName(k)], f);
    gesehen.add(f);
  }
  assert.equal(gesehen.size, 3, 'alle drei Toene');
  assert.equal(stickerFarbe(''), stickerFarbe(''));
});

// ---------- Geometrie ----------

const innen = (flaeche, r) => [flaeche[0] + r, flaeche[1] + r, flaeche[2] - 2 * r, flaeche[3] - 2 * r];

test('stickerRechteck: mittig, innerhalb des Rahmens, Seitenverhaeltnis bleibt, laengste Seite 86 Prozent der kuerzeren Innenseite', () => {
  assert.equal(STICKER_ANTEIL, 0.86);
  for (const flaeche of [[10, 20, 200, 100], [0, 0, 100, 300], [40, 40, 120, 120], [5, 7, 61, 43]]) {
    for (const [bb, bh] of [[256, 256], [320, 240], [240, 320], [512, 100], [100, 512]]) {
      const r = rahmenBreite(flaeche[2], flaeche[3]);
      const s = stickerRechteck(flaeche, bb, bh, r);
      assert.ok(s, `${flaeche} ${bb}x${bh}`);
      const [ix, iy, iw, ih] = innen(flaeche, r);
      // innerhalb der Innenflaeche
      assert.ok(s[0] >= ix - 1e-9 && s[1] >= iy - 1e-9 && s[0] + s[2] <= ix + iw + 1e-9 && s[1] + s[3] <= iy + ih + 1e-9, `innerhalb ${flaeche} ${bb}x${bh}: ${s}`);
      // mittig
      assert.ok(Math.abs(s[0] + s[2] / 2 - (flaeche[0] + flaeche[2] / 2)) < 1e-9);
      assert.ok(Math.abs(s[1] + s[3] / 2 - (flaeche[1] + flaeche[3] / 2)) < 1e-9);
      // Seitenverhaeltnis
      assert.ok(Math.abs(s[2] / s[3] - bb / bh) < 1e-9);
      // laengste Seite
      assert.ok(Math.abs(Math.max(s[2], s[3]) - 0.86 * Math.min(iw, ih)) < 1e-9);
    }
  }
});

test('stickerRechteck: leere Flaeche, leeres Bild oder ganz vom Rahmen gefuellt: nichts (null), nie eine Ausnahme', () => {
  assert.equal(stickerRechteck([0, 0, 0, 10], 10, 10, 2), null);
  assert.equal(stickerRechteck([0, 0, 10, 10], 0, 10, 2), null);
  assert.equal(stickerRechteck([0, 0, 10, 10], 10, 10, 5), null);
  assert.equal(stickerRechteck([0, 0, 10, 10], 10, 10, NaN) !== null, true, 'ungueltiger Rahmen zaehlt als 0');
});

test('stickerPasst: kuerzere Seite in Anzeigepixeln mindestens 24, die Skala rechnet um', () => {
  assert.equal(STICKER_MIN_SEITE, 24);
  assert.equal(stickerPasst([0, 0, 24, 500]), true);
  assert.equal(stickerPasst([0, 0, 23, 500]), false);
  assert.equal(stickerPasst([0, 0, 500, 23]), false);
  assert.equal(stickerPasst([0, 0, 48, 48], 0.5), true);
  assert.equal(stickerPasst([0, 0, 46, 48], 0.5), false);
  assert.equal(stickerPasst([0, 0, 23, 23], 0), false, 'Skala 0 gilt als 1');
});

test('stickerStart: stabil je Schluessel, im Bereich, ohne Sticker 0', () => {
  for (let i = 0; i < 50; i++) {
    const a = stickerStart(`k${i}`, 3);
    assert.ok(a >= 0 && a < 3);
    assert.equal(stickerStart(`k${i}`, 3), a);
  }
  assert.equal(stickerStart('x', 0), 0);
});

// ---------- Flaechen und Behandlungen ----------

// Alle Zonen an ausser Head (der Kopf schluckt sonst die Gesichtsflaeche, wie bei allen Presets): so ist die Face-Flaeche sichtbar.
const alleZonen = (faceAn) => vervollstaendige({ zonen: Object.fromEntries(ZONEN.map((z) => [z, { an: z === 'face' ? faceAn : z !== 'head', bedeckt: true }])) }).zonen;
const flaechenVon = (preset, faceAn) => {
  const gesicht = { score: 0.9, box: [100, 100, 120, 150], punkte: [[130, 150], [190, 150], [0, 0], [0, 0], [0, 0]] };
  const treffer = yunetTreffer(gesicht, 500, 500);
  treffer.push({ zone: 'breast', bedeckt: false, score: 0.9, box: [0, 300, 200, 100] });
  return berechneFlaechen(treffer, { zonen: alleZonen(faceAn), rand: 0.1, preset }, 500, 500);
};

test('Preset sticker: Face an: Gesicht als eigene Flaeche mit sticker, Koerper sticker; Face aus: kein Gesicht, Augen und Koerper sticker', () => {
  for (const faceAn of [true, false]) {
    const f = flaechenVon('sticker', faceAn);
    assert.ok(f.length > 0);
    for (const x of f) assert.equal(x.behandlung, 'sticker', `face ${faceAn} ${x.zone}`);
    assert.equal(f.some((x) => x.zone === 'face'), faceAn, `Face-Flaeche nur mit Face an (${faceAn})`);
    assert.ok(f.some((x) => x.zone === 'breast'));
    assert.ok(!f.some((x) => x.ersatz), 'kein Ersatz noetig');
  }
});

test('Preset mia-sticker: Face an: Gesicht mia-gesicht mit Ersatz sticker, Koerper sticker; Face aus: alles sticker, kein Mias Gesicht', () => {
  const an = flaechenVon('mia-sticker', true);
  const gesichter = an.filter((x) => x.behandlung === 'mia-gesicht');
  assert.ok(gesichter.length > 0);
  for (const g of gesichter) {
    assert.equal(g.zone, 'face');
    assert.equal(g.ersatz, 'sticker', 'Ersatz fuer ein fehlendes Mia-Gesicht ist der Sticker');
  }
  for (const x of an.filter((y) => y.behandlung !== 'mia-gesicht')) assert.equal(x.behandlung, 'sticker', x.zone);
  assert.ok(an.some((x) => x.zone === 'breast' && x.behandlung === 'sticker'));
  const aus = flaechenVon('mia-sticker', false);
  assert.ok(aus.length > 0);
  for (const x of aus) assert.equal(x.behandlung, 'sticker', x.zone);
});

test('behandlungFuerZone und ganzesBildBehandlung: sticker in beiden Presets, ganzes Bild bleibt Mosaik', () => {
  for (const z of ['face', 'eyes', 'mouth', 'head', 'breast', 'feet']) assert.equal(behandlungFuerZone('sticker', z), 'sticker', z);
  assert.equal(behandlungFuerZone('mia-sticker', 'face'), 'mia-gesicht');
  for (const z of ['eyes', 'mouth', 'head', 'breast', 'feet']) assert.equal(behandlungFuerZone('mia-sticker', z), 'sticker', z);
  assert.equal(ganzesBildBehandlung('sticker'), 'mosaik');
  assert.equal(ganzesBildBehandlung('mia-sticker'), 'mosaik');
  for (const p of PRESET_IDS) assert.notEqual(ganzesBildBehandlung(p), 'sticker', p);
  assert.deepEqual(PRESET_IDS.filter(nutztSticker), ['mia-sticker', 'sticker']);
  assert.equal(nutztMiasGesicht('mia-sticker'), true);
  assert.equal(nutztMiasGesicht('sticker'), false);
});

test('waehlePreset: mia-sticker schaltet Face ein (wie die anderen Mia-Presets), sticker nicht', () => {
  const alt = { preset: 'mosaik', zonen: alleZonen(false) };
  assert.equal(waehlePreset(alt, 'mia-sticker').faceEingeschaltet, true);
  assert.equal(waehlePreset(alt, 'sticker').faceEingeschaltet, false);
});

// ---------- wirksames Preset ----------

const packKurz = (f) => kurzAusRoh({ id: 'p', version: '1.0.0', titel: 'P', freischaltungen: f, importiert: 1 });

test('wirksames Preset: Sticker-Presets nur mit zensur:sticker, Mia-Presets nur mit stil:mia-patch, sonst Mosaik', () => {
  const beide = packKurz(['stil:mia-patch', 'zensur:sticker']);
  const nurPatch = packKurz(['stil:mia-patch']);
  const nurSticker = packKurz(['zensur:sticker']);
  for (const p of PRESET_IDS) assert.equal(presetFuerPackKurz(p, beide), p);
  assert.equal(presetFuerPackKurz('sticker', nurPatch), 'mosaik');
  assert.equal(presetFuerPackKurz('mia-sticker', nurPatch), 'mosaik');
  assert.equal(presetFuerPackKurz('mia-wort', nurPatch), 'mia-wort');
  assert.equal(presetFuerPackKurz('sticker', nurSticker), 'sticker');
  assert.equal(presetFuerPackKurz('mia-sticker', nurSticker), 'mia-sticker');
  assert.equal(presetFuerPackKurz('mia-wort', nurSticker), 'mosaik');
  for (const p of ['sticker', 'mia-sticker', 'mia-wort']) {
    assert.equal(presetFuerPackKurz(p, null), 'mosaik');
    assert.equal(presetFuerPackKurz(p, undefined), 'mosaik');
  }
  assert.equal(presetFuerPackKurz('mosaik', null), 'mosaik');
  assert.equal(presetFuerPackKurz('person-blur', null), 'person-blur');
  assert.equal(packGenuegt('sticker', true, false), false);
  assert.equal(packGenuegt('sticker', false, true), true);
  assert.equal(packGenuegt('pack', false, true), false);
  assert.equal(packGenuegt(null, false, false), true);
  assert.equal(presetFuerPack('sticker', true, true), 'sticker');
});

// ---------- Vertrag und Format ----------

test('Vertrag: Rolle sticker, Freischaltung zensur:sticker braucht die Rolle', () => {
  assert.ok(ROLLEN.includes('sticker'));
  assert.ok(FREISCHALTUNGEN.includes('zensur:sticker'));
  assert.equal(BENOETIGT['zensur:sticker'], 'sticker');
  assert.equal(packKurz([]).sticker, 0, 'fehlender Zaehler wird 0');
  assert.equal(kurzAusRoh({ id: 'x', sticker: 3 }).sticker, 3);
});

test('Format: zensur:sticker faellt ohne Sticker-Bild weg, mit Bild bleibt sie; Rolle nur fuer Bilder', async () => {
  const ohne = await pruefePack(quelleAusBytes(await schreibePack(kopf(['zensur:sticker']), [LIZENZ])), VERSION);
  assert.deepEqual(ohne.manifest.freischaltungen, []);
  assert.equal(ohne.rollen.sticker, 0);
  const datei = { name: 'sticker/a.png', typ: 'image/png', daten: PNG, rolle: 'sticker' };
  const mit = await pruefePack(quelleAusBytes(await schreibePack(kopf(['zensur:sticker']), [LIZENZ, datei])), VERSION);
  assert.deepEqual(mit.manifest.freischaltungen, ['zensur:sticker']);
  assert.equal(mit.rollen.sticker, 1);
  const kein = { name: 's.json', typ: 'application/json', daten: kodiere('{}'), rolle: 'sticker' };
  await assert.rejects(pruefePack(quelleAusBytes(await schreibePack(kopf([]), [LIZENZ, kein])), VERSION), /nur fuer Bilder/);
});

test('Altes Pack ohne Sticker (0.9.0 und aelter) bleibt gueltig, Freischaltungen unveraendert', async () => {
  const alt = await baueDummyPack({ ohnePhase4: true });
  const p = await pruefePack(quelleAusBytes(alt.bytes), VERSION);
  assert.deepEqual(p.manifest.freischaltungen, ['stil:mia-patch']);
  assert.equal(p.rollen.sticker, 0);
  const ohne = await baueDummyPack({ ohneSticker: true });
  const q = await pruefePack(quelleAusBytes(ohne.bytes), VERSION);
  assert.ok(q.manifest.freischaltungen.includes('stil:mia-patch') && !q.manifest.freischaltungen.includes('zensur:sticker'));
  assert.equal(q.rollen.sticker, 0);
});

test('Dummy-Pack mit Stickern: drei Sticker mit Transparenz-Bildern, Freischaltung da; stickerKaputt: eine Datei, Freischaltung bleibt', async () => {
  const mit = await baueDummyPack();
  const p = await pruefePack(quelleAusBytes(mit.bytes), VERSION);
  assert.ok(p.manifest.freischaltungen.includes('zensur:sticker'));
  assert.equal(p.rollen.sticker, 3);
  assert.deepEqual(
    p.manifest.dateien.filter((d) => d.rolle === 'sticker').map((d) => d.name),
    ['sticker/dummy-1.webp', 'sticker/dummy-2.webp', 'sticker/dummy-3.webp'],
  );
  assert.equal(DUMMY_STICKER.length, 3);
  // Farben weit weg von den Pastelltoenen und vom pinken Rahmen (#ff4fa3): kleinster Kanalabstand gross
  const pastell = STICKER_FARBEN.map((n) => FARBEN[n]).concat('#ff4fa3');
  const kanaele = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const d of DUMMY_STICKER) for (const h of pastell) assert.ok(Math.hypot(...kanaele(h).map((v, i) => v - d.farbe[i])) > 200, `${d.farbe} gegen ${h}`);
  const kaputt = await baueDummyPack({ stickerKaputt: true });
  const k = await pruefePack(quelleAusBytes(kaputt.bytes), VERSION);
  assert.equal(k.rollen.sticker, 1);
  assert.ok(k.manifest.freischaltungen.includes('zensur:sticker'));
});

// ---------- Zeichenregeln S1 und S2 ----------

// Kontext, der jede Operation mit dem Zustand von Alpha und Mischmodus aufzeichnet.
function aufzeichner() {
  const log = [];
  const stapel = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    save() { stapel.push({ a: this.globalAlpha, m: this.globalCompositeOperation, f: this.fillStyle }); log.push({ op: 'save' }); },
    restore() { const s = stapel.pop(); if (s) { this.globalAlpha = s.a; this.globalCompositeOperation = s.m; this.fillStyle = s.f; } log.push({ op: 'restore' }); },
    fillRect(x, y, w, h) { log.push({ op: 'fillRect', x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha, modus: this.globalCompositeOperation }); },
    drawImage(b, ...a) { log.push({ op: 'drawImage', a, alpha: this.globalAlpha, modus: this.globalCompositeOperation }); },
    clearRect() { log.push({ op: 'clearRect' }); },
    clip() { log.push({ op: 'clip' }); },
    beginPath() {}, rect() {}, stroke() {}, fill() {},
  };
  return { ctx, log, stapel };
}

test('zeichneSticker S1 und S2: Flaeche zuerst, Alpha 1, source-over, kein Clip, kein clearRect, Sticker danach mittig; Zustand zurueckgestellt', () => {
  const { ctx, log, stapel } = aufzeichner();
  const box = [10, 20, 200, 100];
  const farbe = stickerFarbe('x|face|10,20,200,100');
  zeichneSticker(ctx, box, farbe, { width: 256, height: 256 }, 1);
  const erste = log.find((e) => e.op === 'fillRect');
  assert.deepEqual([erste.x, erste.y, erste.w, erste.h], box, 'die Flaeche ist genau die Box');
  assert.equal(erste.fill, farbe);
  assert.equal(erste.alpha, 1);
  assert.equal(erste.modus, 'source-over');
  const iDraw = log.findIndex((e) => e.op === 'drawImage');
  assert.ok(iDraw > log.findIndex((e) => e.op === 'fillRect'), 'Flaeche vor dem Sticker');
  assert.equal(log[iDraw].alpha, 1);
  assert.equal(log[iDraw].modus, 'source-over');
  assert.ok(!log.some((e) => e.op === 'clearRect' || e.op === 'clip'));
  assert.equal(stapel.length, 0, 'save und restore ausgeglichen');
  assert.equal(ctx.globalAlpha, 1);
  assert.equal(ctx.globalCompositeOperation, 'source-over');
  // Sticker: mittig, einpassen
  const a = log[iDraw].a; // Zielrechteck x, y, w, h (drawImage mit 5 Argumenten)
  assert.equal(a.length, 4);
  assert.ok(Math.abs(a[0] + a[2] / 2 - 110) < 1e-9 && Math.abs(a[1] + a[3] / 2 - 70) < 1e-9);
  assert.ok(a[2] > 0 && Math.abs(a[2] - a[3]) < 1e-9);
});

test('zeichneSticker: ohne Sticker, mit zu kleiner Flaeche oder bei geworfenem drawImage steht die Flaeche trotzdem, nichts wirft', () => {
  for (const fall of ['ohne', 'klein', 'wirft']) {
    const { ctx, log } = aufzeichner();
    const box = fall === 'klein' ? [5, 5, 20, 90] : [5, 5, 120, 80];
    if (fall === 'wirft') ctx.drawImage = () => { throw new Error('geschlossen'); };
    zeichneSticker(ctx, box, '#ffd3e6', fall === 'ohne' ? null : { width: 100, height: 100 }, 1);
    const f = log.find((e) => e.op === 'fillRect');
    assert.deepEqual([f.x, f.y, f.w, f.h], box, fall);
    assert.equal(f.alpha, 1);
    if (fall !== 'wirft') assert.ok(!log.some((e) => e.op === 'drawImage'), fall);
  }
});

// ---------- Wahl mit Fehlern (Versuche, Lesefehler) ----------

test('waehleNaechsten: nach einem Dekodierfehler kommt der naechste Sticker, der kaputte wird vergessen und nicht noch einmal versucht', async () => {
  const namen = ['a', 'b', 'c'];
  for (let i = 0; i < 40; i++) {
    const k = `bild-${i}`;
    const kaputt = new Set();
    const versucht = [];
    const r = await waehleNaechsten(k, namen, kaputt, async (n) => {
      versucht.push(n);
      return n === 'c' ? null : n.toUpperCase();
    });
    assert.ok(r.wert && r.wert.name !== 'c' && !r.fehler, k);
    if (stickerStart(k, 3) === 2) {
      assert.deepEqual(versucht, ['c', 'a'], 'erst der kaputte, dann der naechste');
      assert.ok(kaputt.has('c'));
      const w2 = [];
      const r2 = await waehleNaechsten(k, namen, kaputt, async (n) => (w2.push(n), n.toUpperCase()));
      assert.deepEqual(w2, ['a'], 'der kaputte wird uebersprungen');
      assert.equal(r2.wert.name, 'a');
    }
  }
});

test('waehleNaechsten: hoechstens 4 Versuche, danach keiner (nur kaputte Sticker), die Wahl ist stabil je Schluessel', async () => {
  assert.equal(STICKER_MAX_VERSUCHE, 4);
  const namen = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const kaputt = new Set();
  const versucht = [];
  const r = await waehleNaechsten('k', namen, kaputt, async (n) => (versucht.push(n), null));
  assert.equal(r.wert, null);
  assert.equal(r.fehler, false);
  assert.equal(r.versuche, 4);
  assert.equal(versucht.length, 4);
  assert.equal(kaputt.size, 4);
  // dieselbe Wahl liefert denselben Sticker
  const a = await waehleNaechsten('stabil', namen, new Set(), async (n) => n);
  const b = await waehleNaechsten('stabil', namen, new Set(), async (n) => n);
  assert.equal(a.wert.name, b.wert.name);
  assert.equal((await waehleNaechsten('x', [], new Set(), async (n) => n)).wert, null);
});

test('waehleNaechsten: ein Lesefehler (wirft) beendet die Wahl sofort mit fehler, es wird nichts weiter versucht und nichts vergessen', async () => {
  const kaputt = new Set();
  let n = 0;
  const r = await waehleNaechsten('k', ['a', 'b', 'c'], kaputt, async () => {
    n++;
    throw new Error('Zeitgrenze');
  });
  assert.equal(r.fehler, true);
  assert.equal(r.wert, null);
  assert.equal(n, 1);
  assert.equal(kaputt.size, 0);
});

test('holeJeFlaeche: nach dem ersten Lesefehler wird fuer die restlichen Flaechen nichts mehr angefordert, Flaechen ohne Bedarf auch nicht', async () => {
  const gefragt = [];
  const aus = await holeJeFlaeche(
    5,
    (i) => i !== 1,
    async (i) => {
      gefragt.push(i);
      return i === 2 ? { wert: null, fehler: true } : { wert: `s${i}`, fehler: false };
    },
  );
  assert.deepEqual(gefragt, [0, 2], 'Flaeche 1 braucht keinen, nach Flaeche 2 (Fehler) wird nichts mehr gefragt');
  assert.deepEqual(aus, ['s0', null, null, null, null]);
  // ohne Fehler bekommt jede Flaeche mit Bedarf ihren Sticker, eine ohne Sticker (null) stoppt nichts
  const ok = await holeJeFlaeche(3, () => true, async (i) => ({ wert: i === 1 ? null : `s${i}`, fehler: false }));
  assert.deepEqual(ok, ['s0', null, 's2']);
});

test('Dummy-Pack stickerTeilweise: zwei gute Sticker und ein kaputter, sortiert zuletzt', async () => {
  const b = await baueDummyPack({ stickerTeilweise: true });
  const p = await pruefePack(quelleAusBytes(b.bytes), VERSION);
  assert.deepEqual(p.manifest.dateien.filter((d) => d.rolle === 'sticker').map((d) => d.name).sort(), ['sticker/dummy-1.webp', 'sticker/dummy-2.webp', 'sticker/kaputt-1.webp']);
  assert.ok(p.manifest.freischaltungen.includes('zensur:sticker'));
});

test('ordneNeu: ein Treffer rueckt ans Ende, so verdraengt die Obergrenze das am laengsten unbenutzte Motiv und nicht das gerade benutzte', () => {
  const m = new Map();
  const MAX = 4;
  const lege = (k) => {
    m.set(k, k);
    if (m.size > MAX) m.delete(m.keys().next().value);
  };
  for (const k of ['a', 'b', 'c', 'd']) lege(k);
  ordneNeu(m, 'a'); // a wird noch benutzt
  lege('e');
  assert.ok(m.has('a'), 'a bleibt');
  assert.ok(!m.has('b'), 'b (am laengsten unbenutzt) geht');
  ordneNeu(m, 'fehlt'); // unbekannter Schluessel: nichts
  assert.equal(m.size, 4);
});
