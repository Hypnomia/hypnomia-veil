// Einheitstests der Zensur-Presets (ZENSUR-PRESETS-BAUPLAN): Tabelle, Migration, Zonen und Behandlungen je Preset, Personen-Gruppen,
// Wort-Vertrag und Wortwahl, Gesichtsausschnitt, Dummy-Pack mit Woertern.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GESICHT_RAND,
  GESICHT_VERHAELTNIS,
  GRUPPEN,
  GRUPPEN_NAMEN,
  MAX_THEMEN,
  NACHBAR_ANTEIL,
  PERSON_RAND,
  PRESETS,
  PRESET_IDS,
  STANDARD_WORT,
  WORT_MAX_LAENGE,
  WORT_MIN_BREITE,
  WORT_MIN_HOEHE,
  ganzesBildBehandlung,
  gesichtsAusschnitt,
  hatWort,
  ohneWort,
  personenGruppen,
  presetAusStil,
  pruefeWoerter,
  waehleWort,
  presetFuerPack,
  wortPasst,
} from '../../src/presets.ts';
import { STANDARD, ZONEN, vervollstaendige, waehlePreset } from '../../src/einstellungen.ts';
import { berechneFlaechen, berechneGesichter, berechnePersonen, yunetTreffer } from '../../src/erkenner/zonen.ts';
import { pruefePack, quelleAusBytes } from '../../src/pack/format.ts';
import { baueDummyPack, pruefeWoerterDatei } from '../../scripts/pack/baue-pack.mjs';
import { DUMMY_WOERTER } from '../../scripts/pack/dummy-inhalte.mjs';

const zonen = (an, bedeckt = []) => {
  const z = {};
  for (const n of ZONEN) z[n] = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'].includes(n) ? { an: an.includes(n), bedeckt: bedeckt.includes(n) } : { an: an.includes(n) };
  return z;
};
const t = (zone, box, extra = {}) => ({ zone, bedeckt: false, score: 0.9, box, ...extra });
const gesichtYunet = (box, re, le) => ({ score: 0.9, box, punkte: [re, le, [0, 0], [0, 0], [0, 0]] });

test('Tabelle: dreizehn Presets in vier Gruppen, Mia-Presets brauchen das Pack, Sticker-Presets Sticker, nur Wort-Presets nutzen Woerter', () => {
  assert.equal(PRESET_IDS.length, 13);
  assert.deepEqual(GRUPPEN, ['mia', 'sticker', 'klassisch', 'person']);
  const je = (g) => PRESET_IDS.filter((p) => PRESETS[p].gruppe === g);
  assert.deepEqual(je('mia'), ['mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur']);
  assert.deepEqual(je('sticker'), ['mia-sticker', 'sticker']);
  assert.deepEqual(je('klassisch'), ['mosaik', 'mosaik-wort', 'blur', 'zensurbalken', 'augenbalken']);
  assert.deepEqual(je('person'), ['person-mosaik', 'person-blur']);
  for (const p of PRESET_IDS) assert.equal(PRESETS[p].braucht, PRESETS[p].gruppe === 'mia' ? 'pack' : PRESETS[p].gruppe === 'sticker' ? 'sticker' : null, p);
  assert.deepEqual(PRESET_IDS.filter((p) => PRESETS[p].woerter), ['mia-wort', 'mia-mosaik-wort', 'mosaik-wort']);
  // Tabellenzeilen des Plans
  assert.deepEqual([PRESETS['mia-wort'].gesicht, PRESETS['mia-wort'].koerper], ['mia-gesicht', 'schwarz-wort']);
  assert.deepEqual([PRESETS['mia-mosaik'].gesicht, PRESETS['mia-mosaik'].koerper], ['mia-gesicht', 'mosaik']);
  assert.deepEqual([PRESETS['mia-mosaik-wort'].gesicht, PRESETS['mia-mosaik-wort'].koerper], ['mia-gesicht', 'mosaik-wort']);
  assert.deepEqual([PRESETS['mia-blur'].gesicht, PRESETS['mia-blur'].koerper], ['mia-gesicht', 'blur']);
  assert.deepEqual([PRESETS['mia-sticker'].gesicht, PRESETS['mia-sticker'].koerper, PRESETS['mia-sticker'].augen], ['mia-gesicht', 'sticker', 'wie-koerper']);
  assert.deepEqual([PRESETS.sticker.gesicht, PRESETS.sticker.koerper, PRESETS.sticker.augen], ['sticker', 'sticker', 'wie-koerper']);
  assert.deepEqual([PRESETS.zensurbalken.gesicht, PRESETS.zensurbalken.koerper, PRESETS.zensurbalken.augen], ['schwarz', 'schwarz', 'balken-immer']);
  assert.deepEqual([PRESETS.augenbalken.gesicht, PRESETS.augenbalken.koerper, PRESETS.augenbalken.augen], [null, null, 'nur-balken']);
  assert.equal(PRESETS['person-mosaik'].person && PRESETS['person-blur'].person, true);
  assert.equal(STANDARD.preset, 'mosaik');
  for (const p of PRESET_IDS) assert.ok(!/[\u2013\u2014]/.test(PRESETS[p].name + PRESETS[p].satz), `${p}: keine Gedankenstriche`);
  // Texte laut STICKER-TEXTE.md
  assert.equal(GRUPPEN_NAMEN.sticker, 'With my stickers');
  assert.equal(PRESETS['mia-sticker'].name, 'My face, stickers');
  assert.equal(PRESETS.sticker.name, 'Stickers');
});

test('Migration: stil wird preset, mia-patch wird mia-wort, Unbekanntes bleibt null; preset gewinnt gegen stil', () => {
  assert.equal(presetAusStil('mosaik'), 'mosaik');
  assert.equal(presetAusStil('blur'), 'blur');
  assert.equal(presetAusStil('mia-patch'), 'mia-wort');
  assert.equal(presetAusStil('augenbalken'), 'augenbalken');
  assert.equal(presetAusStil('xyz'), null);
  assert.equal(presetAusStil(undefined), null);
  assert.equal(vervollstaendige({ stil: 'blur' }).preset, 'blur');
  assert.equal(vervollstaendige({ stil: 'blur', preset: 'zensurbalken' }).preset, 'zensurbalken');
  assert.equal(vervollstaendige({ stil: 'kaputt' }).preset, 'mosaik');
  assert.equal('stil' in vervollstaendige({ stil: 'blur' }), false);
});

test('Einstellung woerterThemen: Standard null (alle), Liste nur gueltige Kennungen ohne Doppelte, hoechstens 12', () => {
  assert.equal(vervollstaendige({}).woerterThemen, null);
  assert.deepEqual(vervollstaendige({ woerterThemen: ['alpha', 'alpha', 'BAD ID', 7, 'beta'] }).woerterThemen, ['alpha', 'beta']);
  assert.deepEqual(vervollstaendige({ woerterThemen: [] }).woerterThemen, []);
  assert.equal(vervollstaendige({ woerterThemen: Array.from({ length: 30 }, (_, i) => `t${i}`) }).woerterThemen.length, MAX_THEMEN);
  assert.equal(vervollstaendige({ woerterThemen: 'alle' }).woerterThemen, null);
});

test('presetFuerPack: Mia-Presets ohne Patch-Pack und Sticker-Presets ohne Sticker werden Mosaik, die anderen bleiben', () => {
  for (const p of PRESET_IDS) assert.equal(presetFuerPack(p, true, true), p);
  for (const p of PRESET_IDS) assert.equal(presetFuerPack(p, false, true), PRESETS[p].gruppe === 'mia' ? 'mosaik' : p);
  for (const p of PRESET_IDS) assert.equal(presetFuerPack(p, true, false), PRESETS[p].gruppe === 'sticker' ? 'mosaik' : p);
  for (const p of PRESET_IDS) assert.equal(presetFuerPack(p, false, false), PRESETS[p].braucht !== null ? 'mosaik' : p);
  // ohne dritten Wert gilt: keine Sticker (sicherer Standard)
  assert.equal(presetFuerPack('sticker', true), 'mosaik');
});

test('Behandlungen: Wort-Behandlungen und ihre Variante ohne Wort, ganzes Bild nimmt die Koerper-Behandlung', () => {
  assert.equal(hatWort('mosaik-wort') && hatWort('schwarz-wort'), true);
  assert.equal(hatWort('mosaik') || hatWort('schwarz') || hatWort('mia-gesicht'), false);
  assert.equal(ohneWort('mosaik-wort'), 'mosaik');
  assert.equal(ohneWort('schwarz-wort'), 'schwarz');
  assert.equal(ohneWort('blur'), 'blur');
  assert.equal(ganzesBildBehandlung('mia-wort'), 'schwarz-wort');
  assert.equal(ganzesBildBehandlung('mia-blur'), 'blur');
  assert.equal(ganzesBildBehandlung('augenbalken'), 'mosaik');
  assert.equal(ganzesBildBehandlung('zensurbalken'), 'schwarz');
});

test('wortPasst: unter 48 px Hoehe oder 64 px Breite (Anzeigegroesse) kein Wort', () => {
  assert.equal(WORT_MIN_HOEHE, 48);
  assert.equal(WORT_MIN_BREITE, 64);
  assert.equal(wortPasst(64, 48), true);
  assert.equal(wortPasst(63, 48), false);
  assert.equal(wortPasst(64, 47), false);
  assert.equal(wortPasst(200, 100, 0.4), false); // 80 x 40 angezeigt
  assert.equal(wortPasst(200, 130, 0.4), true); // 80 x 52
  assert.equal(wortPasst(100, 100, 0), true); // ungueltige Skala zaehlt als 1
});

test('Wort-Vertrag: Grenzen fuer Woerter, Themen und Anzahl', () => {
  assert.equal(WORT_MAX_LAENGE, 14);
  const gut = ['AA', 'BB', 'CC', 'DD', 'EE'];
  const d = pruefeWoerter({ themen: [{ id: 'a-1', titel: 'Alpha', woerter: gut }] });
  assert.deepEqual(d.themen[0].woerter, gut);
  // ungueltige Woerter fallen weg: klein, zu lang, Sonderzeichen, leer, Nicht-Text
  const gemischt = pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: [...gut, 'lower', 'X'.repeat(15), 'A-B', '   ', 12] }] });
  assert.deepEqual(gemischt.themen[0].woerter, gut);
  // erlaubte Zeichen
  assert.ok(pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: ["IT'S 1!", 'YOU’RE MINE', ...gut] }] }).themen[0].woerter.includes('YOU’RE MINE')); // auch der typografische Apostroph
  // trimmen vor dem Pruefen, danach Doppelte entfernen
  const getrimmt = pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: [' MIA ', 'MIA', '  BB', 'CC  ', 'DD', 'EE', 'FF'] }] }).themen[0].woerter;
  assert.deepEqual(getrimmt, ['MIA', 'BB', 'CC', 'DD', 'EE', 'FF']);
  // zu wenig Woerter: Thema faellt weg, nichts uebrig: null
  assert.equal(pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: gut.slice(0, 4) }] }), null);
  // Doppelte zaehlen einmal
  assert.equal(pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: ['AA', 'AA', 'AA', 'AA', 'AA', 'BB'] }] }), null);
  // hoechstens 60 Woerter je Thema, hoechstens 12 Themen, Kennung eindeutig und im Muster
  const viele = Array.from({ length: 70 }, (_, i) => `W${i}`);
  assert.equal(pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: viele }] }).themen[0].woerter.length, 60);
  const themen = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, titel: `T${i}`, woerter: gut }));
  assert.equal(pruefeWoerter({ themen }).themen.length, MAX_THEMEN);
  assert.equal(pruefeWoerter({ themen: [{ id: 'a', titel: 'A', woerter: gut }, { id: 'a', titel: 'B', woerter: gut }] }).themen.length, 1);
  assert.equal(pruefeWoerter({ themen: [{ id: 'Bad Id', titel: 'A', woerter: gut }] }), null);
  for (const roh of [null, undefined, 'x', [], {}, { themen: 'x' }, { themen: [] }]) assert.equal(pruefeWoerter(roh), null);
});

test('Wortwahl: stabil je Schluessel, wechselnd ueber Schluessel, Themenwahl und Rueckfall MIA', () => {
  const d = pruefeWoerter(DUMMY_WOERTER);
  assert.equal(waehleWort('bild-1|face|1,2,3,4', d, null), waehleWort('bild-1|face|1,2,3,4', d, null));
  const gesehen = new Set(Array.from({ length: 60 }, (_, i) => waehleWort(`bild-${i}|breast|0,0,9,9`, d, null)));
  assert.ok(gesehen.size >= 5, `Woerter wechseln ueber Bilder (${gesehen.size})`);
  // nur Thema alpha: alle Woerter aus alpha
  const alpha = new Set(d.themen[0].woerter);
  for (let i = 0; i < 40; i++) assert.ok(alpha.has(waehleWort(`b${i}`, d, ['alpha'])));
  // Themenwahl ohne Treffer, leer und ohne Datei: MIA
  assert.equal(waehleWort('x', d, []), STANDARD_WORT);
  assert.equal(waehleWort('x', d, ['gibt-es-nicht']), STANDARD_WORT);
  assert.equal(waehleWort('x', null, null), STANDARD_WORT);
  assert.equal(STANDARD_WORT, 'MIA');
});

test('Gesichtsausschnitt: Rand 25 %, Seitenverhaeltnis 3 zu 4, auf das Bild begrenzt', () => {
  assert.equal(GESICHT_RAND, 0.25);
  const [x, y, w, h] = gesichtsAusschnitt([400, 300, 200, 260], 1000, 1000);
  assert.ok(Math.abs(w / h - GESICHT_VERHAELTNIS) < 1e-9);
  // mindestens Gesicht plus Rand
  assert.ok(w >= 200 * 1.5 - 1e-9 && h >= 260 * 1.5 - 1e-9);
  // Mitte bleibt die Mitte des Gesichts
  assert.ok(Math.abs(x + w / 2 - 500) < 1e-9 && Math.abs(y + h / 2 - 430) < 1e-9);
  // ein breites Gesicht: die Breite bestimmt, die Hoehe waechst auf 4 zu 3
  const [, , w2, h2] = gesichtsAusschnitt([100, 100, 400, 300], 2000, 2000);
  assert.ok(Math.abs(w2 / h2 - 0.75) < 1e-9 && h2 >= 300 * 1.5);
  // am Bildrand: bleibt im Bild, Verhaeltnis bleibt
  const r = gesichtsAusschnitt([0, 0, 300, 400], 400, 500);
  assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 400 + 1e-9 && r[1] + r[3] <= 500 + 1e-9);
  assert.ok(Math.abs(r[2] / r[3] - 0.75) < 1e-9);
});

test('personenGruppen: Nachbarn und Ueberlappung bilden eine Gruppe (transitiv), ferne Boxen getrennte; nur Gruppen mit eingeschalteter Zone', () => {
  assert.equal(NACHBAR_ANTEIL, 0.15);
  // drei Boxen in einer Reihe: 1 und 2 nah, 2 und 3 nah, 1 und 3 weit: eine Gruppe (Kette)
  const kette = [[100, 100, 100, 100], [215, 100, 100, 100], [330, 100, 100, 100]];
  const g = personenGruppen(kette, [true, false, false], 1000, 1000);
  assert.equal(g.length, 1);
  // Huelle plus 8 % der laengeren Seite (330 breit): 26,4 -> auf ganze Pixel nach aussen
  assert.ok(g[0][0] <= 100 - 26 && g[0][0] + g[0][2] >= 430 + 26, `Huelle ${g[0]}`);
  // zwei ferne Gruppen, nur die zweite hat eine eingeschaltete Zone
  const fern = personenGruppen([[10, 10, 50, 50], [700, 700, 50, 50]], [false, true], 1000, 1000);
  assert.equal(fern.length, 1);
  assert.ok(fern[0][0] > 600);
  // keine eingeschaltete Zone: nichts
  assert.deepEqual(personenGruppen([[10, 10, 50, 50]], [false], 1000, 1000), []);
  // Rand wird am Bild begrenzt
  const rand = personenGruppen([[0, 0, 100, 100]], [true], 120, 120)[0];
  assert.deepEqual([rand[0], rand[1]], [0, 0]);
  assert.ok(rand[0] + rand[2] <= 120 && rand[1] + rand[3] <= 120);
  assert.equal(PERSON_RAND, 0.08);
});

test('berechneFlaechen: Mosaik, Mosaik-Wort, Blur geben jeder Flaeche ihre Behandlung (wie die Schalter, Zusammenfuehren wie bisher)', () => {
  const tr = [t('breast', [100, 300, 200, 100]), t('genitals', [120, 420, 100, 80])];
  const z = zonen(['breast', 'genitals']);
  for (const [preset, erwartet] of [['mosaik', 'mosaik'], ['mosaik-wort', 'mosaik-wort'], ['blur', 'blur']]) {
    const f = berechneFlaechen(tr, { zonen: z, rand: 0.15, preset }, 800, 800);
    assert.equal(f.length, 2, preset);
    assert.ok(f.every((x) => x.behandlung === erwartet), preset);
  }
  // Ohne Preset (aelterer Aufrufer): Mosaik-Verhalten wie bisher, ohne Behandlung gilt die des Presets fuer ein ganzes Bild (Mosaik)
  const alt = berechneFlaechen(tr, { zonen: z, rand: 0.15 }, 800, 800);
  assert.equal(alt.length, 2);
});

test('berechneFlaechen Mia-Presets: Gesicht an tauscht das Gesicht (Augen und Mund dazu nichts), Koerper nach Preset; Gesicht aus laesst Gesichter frei', () => {
  const tr = [t('breast', [100, 400, 200, 100]), ...yunetTreffer(gesichtYunet([300, 100, 120, 150], [335, 150], [385, 150]), 800, 800)];
  const ein = (an) => ({ zonen: zonen(an), rand: 0.15 });
  const mit = berechneFlaechen(tr, { ...ein(['breast', 'face', 'eyes', 'mouth']), preset: 'mia-wort' }, 800, 800);
  assert.deepEqual(mit.map((f) => [f.zone, f.behandlung]), [['breast', 'schwarz-wort'], ['face', 'mia-gesicht']]);
  assert.equal(mit[1].ersatz, 'schwarz-wort');
  // Mia-Gesicht reicht ueber die Gesichtsbox (plus 10 % Rand je Seite)
  assert.ok(mit[1].box[0] <= 300 - 11 && mit[1].box[0] + mit[1].box[2] >= 420 + 11);
  // Gesicht aus: kein Gesichtstausch; Augen an: Augen bekommen die Koerper-Behandlung
  const ohne = berechneFlaechen(tr, { ...ein(['breast', 'eyes']), preset: 'mia-blur' }, 800, 800);
  assert.deepEqual(ohne.map((f) => [f.zone, f.behandlung]), [['breast', 'blur'], ['eyes', 'blur']]);
  assert.ok(!ohne.some((f) => f.behandlung === 'mia-gesicht'));
  // Mosaik und Mosaik-Wort als Koerper-Behandlung
  assert.equal(berechneFlaechen(tr, { ...ein(['breast', 'face']), preset: 'mia-mosaik' }, 800, 800).find((f) => f.zone === 'breast').behandlung, 'mosaik');
  assert.equal(berechneFlaechen(tr, { ...ein(['breast', 'face']), preset: 'mia-mosaik-wort' }, 800, 800).find((f) => f.zone === 'breast').behandlung, 'mosaik-wort');
  // Kopf bleibt eine eigene Flaeche mit Koerper-Behandlung (Haare), Mias Gesicht liegt zuletzt darueber
  const kopf = berechneFlaechen(tr, { ...ein(['face', 'head']), preset: 'mia-mosaik' }, 800, 800);
  assert.deepEqual(kopf.map((f) => [f.zone, f.behandlung]), [['head', 'mosaik'], ['face', 'mia-gesicht']]);
});

test('berechneGesichter: geneigte YuNet-Gesichter bekommen ein gedrehtes Rechteck, 320n-Gesichter ein achsenparalleles, Doppelte fallen weg', () => {
  const yg = yunetTreffer(gesichtYunet([300, 100, 120, 150], [335, 140], [385, 170]), 800, 800);
  const f = berechneGesichter(yg, 'mosaik', 800, 800);
  assert.equal(f.length, 1);
  assert.ok(f[0].balken && Math.abs(f[0].balken.winkel - Math.atan2(30, 50)) < 1e-9);
  assert.ok(Math.abs(f[0].balken.breite - 120 * 1.2) < 1e-9 && Math.abs(f[0].balken.hoehe - 150 * 1.2) < 1e-9);
  const n = berechneGesichter([t('face', [100, 100, 100, 130])], undefined, 800, 800);
  assert.equal(n.length, 1);
  assert.equal(n[0].balken, undefined);
  assert.equal(n[0].ersatz, undefined);
  assert.equal(berechneGesichter([t('face', [100, 100, 100, 130]), t('face', [102, 102, 98, 128])], undefined, 800, 800).length, 1);
});

test('Mias Gesicht: der Sicherheitsrand der Einstellungen gilt auch fuers Gesicht (max aus 10 % und rand), auch im Ersatzfall', () => {
  const yg = yunetTreffer(gesichtYunet([300, 100, 120, 150], [335, 150], [385, 150]), 800, 800);
  const breite = (rand) => berechneGesichter(yg, 'schwarz-wort', 800, 800, rand)[0].box[2];
  assert.ok(Math.abs(breite(0) - 144) <= 2); // 120 * 1,2 (10 % je Seite)
  assert.ok(Math.abs(breite(0.05) - 144) <= 2); // kleiner als der Mindestrand: bleibt
  assert.ok(Math.abs(breite(0.4) - 216) <= 2); // 120 * 1,8
  // ueber berechneFlaechen: bei rand 0,4 wird nicht weniger verdeckt als die Zonen-Flaeche (Treffer plus 40 % je Seite)
  const tr = [...yg];
  const f = berechneFlaechen(tr, { zonen: zonen(['face']), rand: 0.4, preset: 'mia-wort' }, 800, 800).find((x) => x.zone === 'face');
  const zone = berechneFlaechen(tr, { zonen: zonen(['face']), rand: 0.4, preset: 'mosaik' }, 800, 800).find((x) => x.zone === 'face');
  assert.ok(f.box[2] >= zone.box[2] - 2 && f.box[3] >= zone.box[3] - 2, `Gesicht ${f.box} gegen Zone ${zone.box}`);
  assert.equal(f.ersatz, 'schwarz-wort');
});

test('berechneFlaechen Zensurbalken: Augenbalken immer (auch ohne Eyes-Schalter), Koerper und Gesicht schwarz laut Schaltern', () => {
  const tr = [t('breast', [100, 400, 200, 100]), ...yunetTreffer(gesichtYunet([300, 100, 120, 150], [335, 150], [385, 150]), 800, 800)];
  const f = berechneFlaechen(tr, { zonen: zonen(['breast']), rand: 0.15, preset: 'zensurbalken' }, 800, 800);
  assert.deepEqual(f.map((x) => [x.zone, x.behandlung]), [['breast', 'schwarz'], ['eyes', 'balken']]);
  const mitGesicht = berechneFlaechen(tr, { zonen: zonen(['breast', 'face']), rand: 0.15, preset: 'zensurbalken' }, 800, 800);
  assert.deepEqual(mitGesicht.map((x) => [x.zone, x.behandlung]).sort(), [['breast', 'schwarz'], ['eyes', 'balken'], ['face', 'schwarz']]);
  // ohne Gesicht kein Balken
  assert.deepEqual(berechneFlaechen([tr[0]], { zonen: zonen(['breast']), rand: 0.15, preset: 'zensurbalken' }, 800, 800).map((x) => x.zone), ['breast']);
});

test('berechneFlaechen Augenbalken: nur Balken, Schalter ruhen', () => {
  const tr = [t('breast', [100, 400, 200, 100]), ...yunetTreffer(gesichtYunet([300, 100, 120, 150], [335, 150], [385, 150]), 800, 800)];
  const f = berechneFlaechen(tr, { zonen: zonen(['breast', 'face']), rand: 0.15, preset: 'augenbalken' }, 800, 800);
  assert.deepEqual(f.map((x) => [x.zone, x.behandlung]), [['eyes', 'balken']]);
});

test('berechnePersonen: eine Flaeche je Gruppe, nur mit eingeschalteter Zone, auch bekleidete Teile gehoeren zur Person', () => {
  const kopf = t('face', [300, 100, 100, 120]);
  const brust = t('breast', [290, 240, 120, 80]);
  const bekleidet = { ...t('belly', [280, 330, 140, 90]), bedeckt: true };
  const fern = t('breast', [900, 700, 100, 80]);
  const tr = [kopf, brust, bekleidet, fern];
  // Brust an: beide Gruppen
  const alle = berechnePersonen(tr, zonen(['breast']), 'mosaik', 1400, 1000);
  assert.equal(alle.length, 2);
  const person = alle.find((f) => f.box[0] < 400);
  assert.equal(person.behandlung, 'mosaik');
  // Huelle deckt Kopf, Brust und den bekleideten Bauch (obwohl Belly aus ist)
  assert.ok(person.box[0] <= 280 && person.box[1] <= 100 && person.box[0] + person.box[2] >= 420 && person.box[1] + person.box[3] >= 420, `Huelle ${person.box}`);
  // nur Gesicht an: nur die Gruppe mit dem Gesicht
  const nurGesicht = berechnePersonen(tr, zonen(['face']), 'blur', 1400, 1000);
  assert.equal(nurGesicht.length, 1);
  assert.equal(nurGesicht[0].behandlung, 'blur');
  // nichts an: nichts
  assert.deepEqual(berechnePersonen(tr, zonen([]), 'mosaik', 1400, 1000), []);
  // ueber berechneFlaechen: die Person-Presets
  assert.equal(berechneFlaechen(tr, { zonen: zonen(['breast']), rand: 0.15, preset: 'person-mosaik' }, 1400, 1000).every((f) => f.behandlung === 'mosaik'), true);
  assert.equal(berechneFlaechen(tr, { zonen: zonen(['breast']), rand: 0.15, preset: 'person-blur' }, 1400, 1000).every((f) => f.behandlung === 'blur'), true);
});

test('berechnePersonen: der Sicherheitsrand der Einstellungen macht die Person nie kleiner als die Zonen allein', () => {
  const tr = [t('feet', [300, 300, 100, 100])];
  const ohne = berechnePersonen(tr, zonen(['feet']), 'mosaik', 1000, 1000, 0)[0].box;
  const mit = berechnePersonen(tr, zonen(['feet']), 'mosaik', 1000, 1000, 0.15)[0].box;
  assert.ok(mit[2] > ohne[2] && mit[3] > ohne[3]);
  // Zonen-Flaeche (Treffer plus 15 % je Seite) liegt in der Person
  const zone = berechneFlaechen(tr, { zonen: zonen(['feet']), rand: 0.15, preset: 'mosaik' }, 1000, 1000)[0].box;
  const person = berechneFlaechen(tr, { zonen: zonen(['feet']), rand: 0.15, preset: 'person-mosaik' }, 1000, 1000)[0].box;
  assert.ok(person[0] <= zone[0] && person[1] <= zone[1] && person[0] + person[2] >= zone[0] + zone[2] && person[1] + person[3] >= zone[1] + zone[3]);
});

test('Dummy-Pack mit Woertern: besteht die Pruefung, schaltet zensur:woerter frei, Rolle woerter; ohne Woerter keine Freischaltung', async () => {
  const mit = await baueDummyPack();
  const p = await pruefePack(quelleAusBytes(mit.bytes), '9.9.9');
  assert.ok(p.manifest.freischaltungen.includes('zensur:woerter'));
  assert.equal(p.rollen.woerter, 1);
  assert.deepEqual(pruefeWoerter(p.json.woerter).themen.map((x) => x.id), ['alpha', 'beta']);
  const ohne = await baueDummyPack({ ohneWoerter: true });
  const q = await pruefePack(quelleAusBytes(ohne.bytes), '9.9.9');
  assert.ok(!q.manifest.freischaltungen.includes('zensur:woerter'));
  assert.equal(q.rollen.woerter, 0);
  // kaputte Datei: Rolle zaehlt nicht, Freischaltung faellt weg, Pack bleibt gueltig
  const kaputt = await baueDummyPack({ woerter: { themen: 'nein' } });
  const k = await pruefePack(quelleAusBytes(kaputt.bytes), '9.9.9');
  assert.equal(pruefeWoerter(k.json.woerter), null);
});

test('Pack-Bau prueft die Woerter-Datei: genaue Meldung bei Fehlern, Warnung je verworfenem Wort oder Thema', () => {
  const bytes = (x) => new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x));
  assert.throws(() => pruefeWoerterDatei(bytes('{kein json'), 'woerter.json'), /woerter\.json: kein gueltiges JSON/);
  assert.throws(() => pruefeWoerterDatei(bytes({ themen: [{ id: 'a', titel: 'A', woerter: ['AA'] }] }), 'woerter.json'), /woerter\.json: kein gueltiges Thema/);
  const gut = ['AA', 'BB', 'CC', 'DD', 'EE'];
  const warnungen = [];
  const alt = console.warn;
  console.warn = (m) => warnungen.push(String(m));
  try {
    const d = pruefeWoerterDatei(bytes({ themen: [{ id: 'a', titel: 'A', woerter: [...gut, 'klein', 'ZU LANG ZU LANG X'] }, { id: 'b', titel: 'B', woerter: ['AA'] }, ...gut.length ? [] : []] }), 'woerter.json');
    assert.deepEqual(d.themen.map((t) => t.id), ['a']);
    assert.ok(warnungen.some((w) => w.includes('Thema "a"') && w.includes('"klein"') && w.includes('ZU LANG ZU LANG X')), warnungen.join(' | '));
    assert.ok(warnungen.some((w) => w.includes('Thema "b" faellt weg')));
    // saubere Datei: keine Warnung
    warnungen.length = 0;
    pruefeWoerterDatei(bytes(DUMMY_WOERTER));
    assert.deepEqual(warnungen, []);
  } finally {
    console.warn = alt;
  }
});

test('waehlePreset: der Wechsel auf ein Mia-Preset schaltet Face ein (nur wenn es aus war), alles andere nicht', () => {
  const aus = { preset: 'mosaik', zonen: zonen(['breast']) };
  const r = waehlePreset(aus, 'mia-wort');
  assert.equal(r.faceEingeschaltet, true);
  assert.equal(r.teil.preset, 'mia-wort');
  assert.equal(r.teil.zonen.face.an, true);
  assert.equal(r.teil.zonen.breast.an, true); // die anderen Zonen bleiben
  assert.equal(aus.zonen.face.an, false); // die Eingabe bleibt unberuehrt
  // Face war schon an: nichts zu melden
  const an = waehlePreset({ preset: 'blur', zonen: zonen(['face']) }, 'mia-blur');
  assert.equal(an.faceEingeschaltet, false);
  assert.equal(an.teil.zonen, undefined);
  // Mia-Preset zu Mia-Preset: ein abgeschaltetes Face bleibt aus (wird respektiert)
  const mia = waehlePreset({ preset: 'mia-wort', zonen: zonen([]) }, 'mia-mosaik');
  assert.equal(mia.faceEingeschaltet, false);
  assert.deepEqual(mia.teil, { preset: 'mia-mosaik' });
  // klassische und Personen-Presets schalten nichts
  for (const p of ['mosaik', 'mosaik-wort', 'blur', 'zensurbalken', 'augenbalken', 'person-mosaik', 'person-blur']) {
    const x = waehlePreset(aus, p);
    assert.equal(x.faceEingeschaltet, false, p);
    assert.deepEqual(x.teil, { preset: p }, p);
  }
});
