// Einheitstests ohne Browser: reine Logik der bereichsweisen Video-Zensur (src/schleier/video-zonen.ts, daumen.ts, verfolgung.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Rundlauf,
  SPUR_ERBE_MAX,
  SPUR_ERBE_S,
  SpurListe,
  boxenAnteil,
  darfFrei,
  entscheideAnsicht,
  entspanne,
  fruehestensAnsicht,
  fuehreDurch,
  inhaltsRechteck,
  iou,
  istSprung,
  matrixDreht,
  parsePosition,
  pruefeEignung,
  rueckkehrOk,
  saubereZeitNach,
  spurHalten,
  skaliereFlaechen,
  stilFuerZone,
  brauchtWort,
  ersatzFuer,
  wirksameBehandlung,
  suchRadius,
  zeitOhneRueckfall,
  zielKanten,
} from '../../src/schleier/video-zonen.ts';
import { daumenAusGrau, grauAusRgba, vergleicheDaumen } from '../../src/schleier/daumen.ts';
import { verfolgeBox } from '../../src/schleier/verfolgung.ts';
import { readFileSync } from 'node:fs';
import { PRESET_IDS, PRESETS, behandlungFuerZone, ganzesBildBehandlung, personenGruppen } from '../../src/presets.ts';
import { SchriftVersuche, SCHRIFT_PAUSEN_MS } from '../../src/oberflaeche/design/schrift-versuche.ts';
import { vervollstaendige, ZONEN } from '../../src/einstellungen.ts';
import { berechneFlaechen, yunetTreffer } from '../../src/erkenner/zonen.ts';
import { Schranke } from '../../src/erkenner/schranke.ts';

const nah = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ist nicht ${b} (+-${eps})`);

// ---------- Inhaltsrechteck ----------

test('Inhaltsrechteck contain: breites Video in hoher Box, mittig', () => {
  const r = inhaltsRechteck(200, 400, 400, 200, 'contain');
  nah(r.w, 200);
  nah(r.h, 100);
  nah(r.x, 0);
  nah(r.y, 150);
});

test('Inhaltsrechteck cover: fuellt die Box und ragt ueber', () => {
  const r = inhaltsRechteck(200, 400, 400, 200, 'cover');
  nah(r.h, 400);
  nah(r.w, 800);
  nah(r.x, -300);
  nah(r.y, 0);
});

test('Inhaltsrechteck fill, none, scale-down', () => {
  assert.deepEqual(inhaltsRechteck(300, 100, 640, 480, 'fill'), { x: 0, y: 0, w: 300, h: 100 });
  const n = inhaltsRechteck(1000, 1000, 640, 480, 'none');
  nah(n.w, 640);
  nah(n.x, 180);
  nah(n.y, 260);
  const kleiner = inhaltsRechteck(320, 240, 640, 480, 'scale-down');
  nah(kleiner.w, 320);
  const gross = inhaltsRechteck(2000, 2000, 640, 480, 'scale-down');
  nah(gross.w, 640);
});

test('Inhaltsrechteck mit object-position: Prozent und Pixel', () => {
  const links = inhaltsRechteck(200, 400, 400, 200, 'contain', parsePosition('0% 0%'));
  nah(links.y, 0);
  const unten = inhaltsRechteck(200, 400, 400, 200, 'contain', parsePosition('100% 100%'));
  nah(unten.y, 300);
  const px = inhaltsRechteck(200, 400, 400, 200, 'contain', parsePosition('10px 20px'));
  nah(px.x, 10);
  nah(px.y, 20);
  assert.deepEqual(parsePosition('left top'), { x: { wert: 0, einheit: '%' }, y: { wert: 0, einheit: '%' } });
  assert.deepEqual(parsePosition('quatsch'), parsePosition(null));
});

test('Inhaltsrechteck: leere Masse liefern kein NaN', () => {
  const r = inhaltsRechteck(0, 100, 640, 480, 'contain');
  assert.ok(Number.isFinite(r.w) && Number.isFinite(r.h));
});

// ---------- Umrechnung und IoU ----------

test('skaliereFlaechen rechnet auf die Videoaufloesung um und begrenzt', () => {
  const l = skaliereFlaechen([{ zone: 'breast', box: [10, 20, 100, 50] }], 640, 360, 1280, 720);
  assert.deepEqual(l[0].box, { x: 20, y: 40, w: 200, h: 100 });
  const rand = skaliereFlaechen([{ zone: 'breast', box: [600, 340, 100, 100] }], 640, 360, 640, 360);
  assert.deepEqual(rand[0].box, { x: 600, y: 340, w: 40, h: 20 });
  assert.deepEqual(skaliereFlaechen([{ zone: 'breast', box: [700, 10, 5, 5] }], 640, 360, 640, 360), []);
  assert.deepEqual(skaliereFlaechen([{ zone: 'breast', box: [0, 0, NaN, 5] }], 640, 360, 640, 360), []);
});

test('iou: gleich 1, getrennt 0, Teilueberdeckung', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 20, y: 20, w: 5, h: 5 }), 0);
  nah(iou(a, { x: 5, y: 0, w: 10, h: 10 }), 50 / 150);
});

// ---------- Spuren ----------

const P = { zuordnungIou: 0.1, halten: 1.0 };
const kasten = (x, y, w, h) => ({ zone: 'breast', box: { x, y, w, h } });

test('Spuren: neue Erkennung legt eine Spur an, naechste ueberlappende wird zugeordnet', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(10, 10, 50, 50)], 0, P);
  assert.equal(sl.spuren.length, 1);
  const id = sl.spuren[0].id;
  sl.ordneZu([kasten(14, 12, 50, 50)], 0.1, P);
  assert.equal(sl.spuren.length, 1);
  assert.equal(sl.spuren[0].id, id);
  assert.deepEqual(sl.spuren[0].box, { x: 14, y: 12, w: 50, h: 50 });
  assert.equal(sl.spuren[0].letzterTreffer, 0.1);
});

test('Spuren: weit entfernte Erkennung ist eine zweite Spur', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 20, 20)], 0, P);
  sl.ordneZu([kasten(0, 0, 20, 20), kasten(200, 200, 20, 20)], 0.1, P);
  assert.equal(sl.spuren.length, 2);
});

test('Spuren: jede Erkennung nur einer Spur, groesster IoU zuerst', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 40, 40), kasten(30, 0, 40, 40)], 0, P);
  const [a, b] = sl.spuren.map((s) => s.id);
  sl.ordneZu([kasten(2, 0, 40, 40), kasten(32, 0, 40, 40)], 0.1, P);
  assert.equal(sl.spuren.length, 2);
  assert.deepEqual(sl.spuren.map((s) => s.id), [a, b]);
  assert.equal(sl.spuren[0].box.x, 2);
  assert.equal(sl.spuren[1].box.x, 32);
});

test('Spuren: eine Spur haelt 1,0 s Medienzeit ohne Treffer, dann faellt sie weg', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 20, 20)], 5, P);
  sl.entferneAlte(5.9, 1.0);
  assert.equal(sl.spuren.length, 1);
  sl.entferneAlte(6.05, 1.0);
  assert.equal(sl.spuren.length, 0);
});

test('Spuren: Pause laesst das Alter nicht wachsen, Sprung zurueck loescht alle', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 20, 20)], 5, P);
  for (let i = 0; i < 100; i++) sl.entferneAlte(5.0, 1.0); // Medienzeit steht (Pause)
  assert.equal(sl.spuren.length, 1);
  sl.entferneAlte(2.0, 1.0); // Sprung nach hinten
  assert.equal(sl.spuren.length, 0);
});

// ---------- Erbe des Motivs (Wort und Mias Gesicht ueber eine neu angelegte Spur hinweg) ----------

const zonenKasten = (zone, x, y, w, h, behandlung) => ({ zone, box: { x, y, w, h }, ...(behandlung ? { behandlung } : {}) });

test('Erbe: Konstanten (2 s, hoechstens 16 Eintraege)', () => {
  assert.equal(SPUR_ERBE_S, 2);
  assert.equal(SPUR_ERBE_MAX, 16);
});

test('Erbe: ohne Vorgaenger ist das Motiv die Kennung', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 40, 40), kasten(200, 200, 40, 40)], 0, P);
  for (const s of sl.spuren) assert.equal(s.motiv, s.id);
});

test('Erbe: Spur faellt weg (entferneAlte), neue Spur gleicher Zone in der Naehe erbt das Motiv; Box und Anzeige sind die der neuen Erkennung', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 5, P);
  const alt = sl.spuren[0];
  sl.entferneAlte(6.1, 1.0);
  assert.equal(sl.spuren.length, 0);
  assert.equal(sl.erbe.length, 1);
  // etwas verschoben (die Bewegung waehrend der Luecke): neue Kennung, aber dasselbe Motiv
  sl.ordneZu([kasten(130, 100, 40, 40)], 6.2, P);
  const neu = sl.spuren[0];
  assert.notEqual(neu.id, alt.id);
  assert.equal(neu.motiv, alt.motiv);
  assert.deepEqual(neu.box, { x: 130, y: 100, w: 40, h: 40 });
  assert.equal(neu.anzeige, null);
  assert.equal(neu.letzterTreffer, 6.2);
  assert.equal(sl.erbe.length, 0, 'der Eintrag wird beim Erben entfernt');
});

test('Erbe: leere() (neue Szene) behaelt die Motive, vergiss() loescht sie', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 3, P);
  const m = sl.spuren[0].motiv;
  sl.leere();
  assert.equal(sl.spuren.length, 0);
  sl.ordneZu([kasten(102, 101, 40, 40)], 3.3, P);
  assert.equal(sl.spuren[0].motiv, m);
  assert.notEqual(sl.spuren[0].id, m);
  const m2 = sl.spuren[0].motiv;
  sl.leere();
  sl.vergiss();
  assert.equal(sl.erbe.length, 0);
  sl.ordneZu([kasten(102, 101, 40, 40)], 3.4, P);
  assert.notEqual(sl.spuren[0].motiv, m2);
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id);
});

test('Erbe: andere Zone erbt nicht', () => {
  const sl = new SpurListe();
  sl.ordneZu([zonenKasten('breast', 100, 100, 40, 40)], 3, P);
  sl.leere();
  sl.ordneZu([zonenKasten('belly', 100, 100, 40, 40)], 3.2, P);
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id);
});

test('Erbe: andere wirksame Behandlung erbt nicht, gleiche wirksame (aus der Tabelle eingesetzt) schon', () => {
  const sl = new SpurListe();
  const PP = { ...P, preset: 'mosaik' };
  sl.ordneZu([zonenKasten('breast', 100, 100, 40, 40, 'mosaik')], 3, PP);
  sl.leere();
  sl.ordneZu([zonenKasten('breast', 100, 100, 40, 40, 'blur')], 3.2, PP);
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id, 'mosaik und blur gehoeren nicht zusammen');
  const sl2 = new SpurListe();
  sl2.ordneZu([zonenKasten('breast', 100, 100, 40, 40, behandlungFuerZone('mosaik', 'breast'))], 3, PP);
  const m = sl2.spuren[0].motiv;
  sl2.leere();
  // ohne `behandlung`: die Tabelle des Presets gilt, also dieselbe wirksame Behandlung
  sl2.ordneZu([zonenKasten('breast', 101, 100, 40, 40)], 3.2, PP);
  assert.equal(sl2.spuren[0].motiv, m);
});

test('Erbe: zu weit weg erbt nicht (keine Ueberlappung, Mittenabstand ueber der laengeren Seite der alten Box)', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 20)], 3, P);
  sl.leere();
  sl.ordneZu([kasten(141, 100, 40, 20)], 3.2, P); // Mitten 41 auseinander, laengere Seite 40, kein Schnitt
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id);
  const sl2 = new SpurListe();
  sl2.ordneZu([kasten(100, 100, 40, 20)], 3, P);
  const m = sl2.spuren[0].motiv;
  sl2.leere();
  sl2.ordneZu([kasten(140, 100, 40, 20)], 3.2, P); // Mitten 40 auseinander: noch nah
  assert.equal(sl2.spuren[0].motiv, m);
});

test('Erbe: zu alt (mehr als SPUR_ERBE_S Medienzeit seit dem letzten Treffer) erbt nicht, genau an der Grenze schon', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 3, P);
  sl.leere();
  sl.ordneZu([kasten(100, 100, 40, 40)], 3 + SPUR_ERBE_S + 0.01, P);
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id);
  const sl2 = new SpurListe();
  sl2.ordneZu([kasten(100, 100, 40, 40)], 3, P);
  const m = sl2.spuren[0].motiv;
  sl2.leere();
  sl2.ordneZu([kasten(100, 100, 40, 40)], 3 + SPUR_ERBE_S, P);
  assert.equal(sl2.spuren[0].motiv, m);
});

test('Erbe: Zeitsprung rueckwaerts ueber SPUR_ERBE_S erbt nicht, ein kleiner schon', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 10, P);
  sl.leere();
  sl.ordneZu([kasten(100, 100, 40, 40)], 10 - SPUR_ERBE_S - 0.5, P);
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id);
  // ueber entferneAlte (Sprung zurueck loescht alle Spuren): der Eintrag ist sofort zu alt
  const sl2 = new SpurListe();
  sl2.ordneZu([kasten(100, 100, 40, 40)], 10, P);
  sl2.entferneAlte(5, 1.0);
  assert.equal(sl2.spuren.length, 0);
  assert.equal(sl2.erbe.length, 0);
  const sl3 = new SpurListe();
  sl3.ordneZu([kasten(100, 100, 40, 40)], 10, P);
  const m = sl3.spuren[0].motiv;
  sl3.leere();
  sl3.ordneZu([kasten(100, 100, 40, 40)], 9.5, P);
  assert.equal(sl3.spuren[0].motiv, m);
});

test('Erbe: ein Eintrag wird nur einmal geerbt (naechste Mitte gewinnt), die zweite neue Spur bekommt ein eigenes Motiv', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 3, P);
  const m = sl.spuren[0].motiv;
  sl.leere();
  sl.ordneZu([kasten(120, 100, 40, 40), kasten(104, 100, 40, 40)], 3.2, P);
  const [weiter, naeher] = sl.spuren;
  assert.equal(naeher.motiv, m, 'die naehere Erkennung erbt');
  assert.equal(weiter.motiv, weiter.id, 'die weitere bekommt ein neues Motiv');
  assert.notEqual(weiter.motiv, naeher.motiv);
  // spaeter (Eintrag schon verbraucht) erbt niemand mehr dasselbe Motiv
  sl.leere();
  sl.ordneZu([kasten(104, 100, 40, 40), kasten(120, 100, 40, 40), kasten(112, 100, 40, 40)], 3.4, P);
  const motive = sl.spuren.map((s) => s.motiv);
  assert.equal(new Set(motive).size, motive.length, `doppeltes Motiv ${motive}`);
});

test('Erbe: zwei verlorene Spuren, zwei neue an denselben Stellen: jede erbt ihr eigenes Motiv', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 40, 40), kasten(300, 0, 40, 40)], 3, P);
  const [a, b] = sl.spuren.map((s) => s.motiv);
  sl.leere();
  sl.ordneZu([kasten(302, 2, 40, 40), kasten(2, 2, 40, 40)], 3.2, P);
  assert.equal(sl.spuren[0].motiv, b);
  assert.equal(sl.spuren[1].motiv, a);
});

test('Erbe: ein Motiv, das eine lebende Spur traegt, wird nie geerbt (keine zwei Flaechen mit demselben Motiv)', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 3, P);
  const lebend = sl.spuren[0];
  // kuenstlicher Eintrag mit dem Motiv der lebenden Spur gleich daneben (der Normalfall erzeugt ihn nicht, der Schutz muss trotzdem greifen)
  sl.gedaechtnis.push({ motiv: lebend.motiv, zone: 'breast', box: { x: 300, y: 100, w: 40, h: 40 }, zeit: 3 });
  sl.ordneZu([kasten(100, 100, 40, 40), kasten(302, 100, 40, 40)], 3.1, P);
  assert.equal(sl.spuren.length, 2);
  const neu = sl.spuren.find((s) => s.id !== lebend.id);
  assert.notEqual(neu.motiv, lebend.motiv);
  assert.equal(neu.motiv, neu.id);
});

test('Erbe: das Gedaechtnis ist begrenzt (Anzahl und Alter)', () => {
  const sl = new SpurListe();
  for (let i = 0; i < SPUR_ERBE_MAX + 5; i++) {
    sl.ordneZu([kasten(i * 100, 0, 40, 40)], 3, P);
    sl.leere();
  }
  assert.equal(sl.erbe.length, SPUR_ERBE_MAX);
  // die aeltesten fielen weg: die ersten Motive sind nicht mehr da
  assert.ok(!sl.erbe.some((g) => g.box.x === 0));
  sl.entferneAlte(3 + SPUR_ERBE_S + 0.1, 1.0);
  assert.equal(sl.erbe.length, 0);
});

test('Erbe: Zuordnung bestehender Spuren und ihre Kennungen bleiben wie ohne Gedaechtnis', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 40, 40)], 3, P);
  const s = sl.spuren[0];
  sl.ordneZu([kasten(300, 0, 40, 40)], 3.1, P);
  sl.leere();
  sl.ordneZu([kasten(2, 0, 40, 40)], 3.2, P);
  sl.ordneZu([kasten(4, 0, 40, 40)], 3.3, P);
  assert.equal(sl.spuren.length, 1, 'die zugeordnete Spur bleibt eine');
  assert.equal(sl.spuren[0].motiv, s.motiv);
  assert.deepEqual(sl.spuren[0].box, { x: 4, y: 0, w: 40, h: 40 });
});

test('Erbe: NaN-Zeit wirft nicht und erbt nicht', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 40, 40)], 3, P);
  const alt = sl.spuren[0];
  sl.leere();
  assert.doesNotThrow(() => sl.ordneZu([kasten(100, 100, 40, 40)], NaN, P));
  assert.equal(sl.spuren.length, 1);
  assert.equal(sl.spuren[0].motiv, sl.spuren[0].id);
  assert.notEqual(sl.spuren[0].motiv, alt.motiv);
});

test('Erbe: Box mit Breite 0 wirft nicht', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(100, 100, 0, 40)], 3, P);
  sl.leere();
  assert.doesNotThrow(() => sl.ordneZu([kasten(110, 100, 40, 40)], 3, P));
  assert.equal(sl.spuren.length, 1);
  assert.ok(Number.isFinite(sl.spuren[0].motiv));
  // Code: Ueberlappung 0, aber Mittenabstand (30) <= max(w, h) der alten Box (40): geerbt.
  assert.equal(sl.erbe.length, 0);
  assert.equal(sl.spuren[0].motiv, 1);
});

// ---------- Rand und Entspannen ----------

test('zielKanten: Randbasis plus Unsicherheit, auf das Bild begrenzt', () => {
  const k = zielKanten({ box: { x: 100, y: 100, w: 50, h: 40 }, unsicher: 10 }, 1000, 500, 0.01);
  // 0,01 * 1000 + 10 = 20
  assert.deepEqual(k, { l: 80, t: 80, r: 170, b: 160 });
  const rand = zielKanten({ box: { x: 2, y: 2, w: 50, h: 40 }, unsicher: 10 }, 1000, 500, 0.01);
  assert.equal(rand.l, 0);
  assert.equal(rand.t, 0);
});

test('entspanne: nach aussen sofort, nach innen gleitend', () => {
  const alt = { l: 100, t: 100, r: 200, b: 200 };
  const gross = entspanne(alt, { l: 80, t: 90, r: 230, b: 210 }, 0.016, 0.12);
  assert.deepEqual(gross, { l: 80, t: 90, r: 230, b: 210 });
  const klein = entspanne(alt, { l: 120, t: 120, r: 180, b: 180 }, 0.016, 0.12);
  assert.ok(klein.l > 100 && klein.l < 120);
  assert.ok(klein.r < 200 && klein.r > 180);
  // nie weniger als das Ziel
  assert.ok(klein.l <= 120 && klein.r >= 180);
  assert.deepEqual(entspanne(null, { l: 1, t: 2, r: 3, b: 4 }, 0.016, 0.12), { l: 1, t: 2, r: 3, b: 4 });
});

test('entspanne: nach langer Zeit erreicht die Box das kleinere Ziel', () => {
  let k = { l: 0, t: 0, r: 400, b: 400 };
  const ziel = { l: 100, t: 100, r: 200, b: 200 };
  for (let i = 0; i < 200; i++) k = entspanne(k, ziel, 0.016, 0.12);
  nah(k.l, 100, 0.5);
  nah(k.r, 200, 0.5);
});

test('boxenAnteil zaehlt die Flaechen, ohne Bildmass 1', () => {
  nah(boxenAnteil([{ l: 0, t: 0, r: 50, b: 100 }], 100, 100), 0.5);
  assert.equal(boxenAnteil([], 0, 0), 1);
});

// ---------- Entscheidung ----------

const frisch = { alter: 0.1, alterMax: 0.6, schnitt: false, sprung: false, wartetAufSzene: false, anteil: 0.1, ganzAnteil: 0.6, fehler: false };

test('Entscheidung: frisches Bild mit kleinen Boxen zeigt Zonen', () => {
  assert.deepEqual(entscheideAnsicht(frisch), { ansicht: 'zonen', grund: null });
});

test('Entscheidung: Schnitt, Sprung, Fehler, wartende Szene, Alter und Anteil decken ganz', () => {
  assert.equal(entscheideAnsicht({ ...frisch, schnitt: true }).grund, 'schnitt');
  assert.equal(entscheideAnsicht({ ...frisch, sprung: true }).grund, 'sprung');
  assert.equal(entscheideAnsicht({ ...frisch, fehler: true }).grund, 'fehler');
  assert.equal(entscheideAnsicht({ ...frisch, wartetAufSzene: true }).grund, 'wartet');
  assert.equal(entscheideAnsicht({ ...frisch, alter: 0.61 }).grund, 'alt');
  assert.equal(entscheideAnsicht({ ...frisch, alter: Infinity }).grund, 'alt');
  assert.equal(entscheideAnsicht({ ...frisch, anteil: 0.61 }).grund, 'anteil');
  assert.equal(entscheideAnsicht({ ...frisch, alter: 0.6 }).ansicht, 'zonen');
});

test('Bremse: Decken sofort, zurueck zu Zonen erst nach der Mindestzeit', () => {
  assert.equal(fruehestensAnsicht('ganz', 5000, 1000), Number.NEGATIVE_INFINITY);
  assert.equal(fruehestensAnsicht('zonen', 5000, 1000), 6000);
});

test('darfFrei: nur nach 3 s ohne Treffer, nie nach einem Sprung zurueck', () => {
  assert.equal(darfFrei(10, 8, 3), false);
  assert.equal(darfFrei(11, 8, 3), true);
  assert.equal(darfFrei(5, 8, 3), false);
});

// ---------- Rundlauf ----------

test('Rundlauf: Median der letzten 5, zu langsam erst mit drei Messwerten', () => {
  const r = new Rundlauf(5);
  r.push(900);
  r.push(900);
  assert.equal(r.zuLangsam(700), false);
  r.push(900);
  assert.equal(r.zuLangsam(700), true);
  for (let i = 0; i < 5; i++) r.push(60);
  assert.equal(r.median(), 60);
  assert.equal(r.zuLangsam(700), false);
  assert.equal(r.anzahl, 5);
});

test('Rundlauf: ein einzelner Ausreisser kippt den Median nicht', () => {
  const r = new Rundlauf(5);
  [60, 70, 2000, 65, 62].forEach((x) => r.push(x));
  assert.equal(r.median(), 65);
  assert.equal(r.zuLangsam(700), false);
});

// ---------- Eignung ----------

const gut = { einstellung: 'zonen', lesbar: true, drm: false, controls: false, untertitel: false, spiegel: false, dreht: false, cssB: 480, cssH: 270, minB: 200, minH: 150, vollbildVideo: false, andereAktiv: false, vorschau: false };

test('Eignung: ein gewoehnliches Video ist geeignet', () => {
  assert.deepEqual(pruefeEignung(gut), { ok: true });
});

test('Eignung: jeder Ausschluss nennt seinen Grund', () => {
  const faelle = [
    [{ einstellung: 'ganz' }, 'einstellung'],
    [{ lesbar: false }, 'unlesbar'],
    [{ drm: true }, 'drm'],
    [{ controls: true }, 'controls'],
    [{ untertitel: true }, 'untertitel'],
    [{ spiegel: true }, 'spiegel'],
    [{ dreht: true }, 'dreht'],
    [{ cssB: 199 }, 'klein'],
    [{ cssH: 149 }, 'klein'],
    [{ vollbildVideo: true }, 'vollbild'],
    [{ andereAktiv: true }, 'andere'],
    [{ vorschau: true }, 'vorschau'],
  ];
  for (const [abw, grund] of faelle) assert.deepEqual(pruefeEignung({ ...gut, ...abw }), { ok: false, grund });
});

test('matrixDreht: Skalieren und Spiegeln ja, Drehen und Scheren nein', () => {
  assert.equal(matrixDreht('none'), false);
  assert.equal(matrixDreht('matrix(1, 0, 0, 1, 10, 20)'), false);
  assert.equal(matrixDreht('matrix(0.5, 0, 0, 0.5, 0, 0)'), false);
  assert.equal(matrixDreht('matrix(-1, 0, 0, 1, 0, 0)'), false);
  assert.equal(matrixDreht('matrix(0.866, 0.5, -0.5, 0.866, 0, 0)'), true);
  assert.equal(matrixDreht('matrix(1, 0, 0.5, 1, 0, 0)'), true);
  assert.equal(matrixDreht('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,5,0,1)'), false);
  assert.equal(matrixDreht('matrix3d(1,0,0,0, 0,0.8,0.6,0, 0,-0.6,0.8,0, 0,0,0,1)'), true);
  assert.equal(matrixDreht('quatsch'), true);
});

test('istSprung: kleiner Schritt vor nein, grosser Schritt oder zurueck ja', () => {
  assert.equal(istSprung(1.0, 1.04, 0.75), false);
  assert.equal(istSprung(1.0, 1.0, 0.75), false);
  assert.equal(istSprung(1.0, 2.0, 0.75), true);
  assert.equal(istSprung(2.0, 1.0, 0.75), true);
  assert.equal(istSprung(1.05, 1.0, 0.75), false); // Bild gegen Uhr: ein bis zwei Bilder Abweichung
  assert.equal(istSprung(1.2, 1.0, 0.75), true);
  assert.equal(istSprung(NaN, 1.0, 0.75), true);
});

// ---------- Daumen und Szene ----------

function grauBild(b, h, f) {
  const px = new Uint8Array(b * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) px[y * b + x] = f(x, y);
  return { b, h, px };
}

const SCHW = { szene: 0.12, zelle: 0.3, anteil: 0.1 };

test('grauAusRgba: Weiss 255, Schwarz 0, Gruen heller als Blau', () => {
  const g = grauAusRgba(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 4, 1);
  assert.equal(g[0], 255);
  assert.equal(g[1], 0);
  assert.ok(g[2] > g[3]);
});

test('Daumen: gleiche Bilder ergeben keinen Schnitt', () => {
  const g = grauBild(160, 90, (x, y) => (x * 3 + y * 2) % 256);
  const d = daumenAusGrau(g, 32, 18);
  assert.deepEqual(vergleicheDaumen(d, d, SCHW), { mittel: 0, stark: 0, art: 'keiner' });
});

test('Daumen: ganz anderes Bild ist ein Schnitt', () => {
  const a = daumenAusGrau(grauBild(160, 90, () => 20), 32, 18);
  const b = daumenAusGrau(grauBild(160, 90, () => 200), 32, 18);
  assert.equal(vergleicheDaumen(a, b, SCHW).art, 'schnitt');
});

test('Daumen: grosse Flaeche stark veraendert, Mittel klein, gibt Sofortpruefung', () => {
  const a = daumenAusGrau(grauBild(160, 90, () => 30), 32, 18);
  // linkes Fuenftel hell: Mittel 0,2 * 0,7 = 0,14 waere ein Schnitt, darum nur 12 Prozent der Zellen etwas heller
  const b = daumenAusGrau(grauBild(160, 90, (x) => (x < 20 ? 150 : 30)), 32, 18);
  const r = vergleicheDaumen(a, b, SCHW);
  assert.equal(r.art, 'sofort');
  assert.ok(r.mittel < 0.12 && r.stark >= 0.1);
});

test('Daumen: kleine Bewegung im Bild bleibt ohne Befund', () => {
  const a = daumenAusGrau(grauBild(160, 90, (x, y) => (x > 70 && x < 78 && y > 40 && y < 48 ? 255 : 60)), 32, 18);
  const b = daumenAusGrau(grauBild(160, 90, (x, y) => (x > 74 && x < 82 && y > 40 && y < 48 ? 255 : 60)), 32, 18);
  assert.equal(vergleicheDaumen(a, b, SCHW).art, 'keiner');
});

test('Daumen: Seitenverhaeltnis ohne ganze Teilung liefert vollstaendige Zellen', () => {
  const d = daumenAusGrau(grauBild(161, 91, () => 128), 32, 18);
  assert.equal(d.length, 32 * 18);
  assert.ok(d.every((v) => Math.abs(v - 128 / 255) < 1e-6));
});

// ---------- Verfolgung ----------

// Zufallsbild mit fester Saat, gegen den Zufall der Testlaeufe.
function rauschen(b, h, saat) {
  let s = saat;
  const zuf = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const roh = new Float32Array(b * h).map(() => zuf() * 255);
  // leicht geglaettet, damit Verschiebungen unter einem Bildpunkt Sinn haben
  const px = new Uint8Array(b * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < b; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < b && yy < h) {
          sum += roh[yy * b + xx];
          n++;
        }
      }
      px[y * b + x] = sum / n;
    }
  }
  return { b, h, px };
}

function verschiebe(bild, dx, dy) {
  const px = new Uint8Array(bild.b * bild.h);
  for (let y = 0; y < bild.h; y++) {
    for (let x = 0; x < bild.b; x++) {
      const sx = Math.min(bild.b - 1, Math.max(0, x - dx));
      const sy = Math.min(bild.h - 1, Math.max(0, y - dy));
      px[y * bild.b + x] = bild.px[sy * bild.b + sx];
    }
  }
  return { b: bild.b, h: bild.h, px };
}

const OPT = { radius: 8, sadUnsicher: 22, kontrastMin: 3 };

test('Verfolgung: erkennt eine ganze Verschiebung und bleibt sicher', () => {
  const a = rauschen(160, 90, 7);
  const b = verschiebe(a, 3, -2);
  const v = verfolgeBox(a, b, { x: 60, y: 30, w: 40, h: 30 }, OPT);
  nah(v.dx, 3, 0.35);
  nah(v.dy, -2, 0.35);
  assert.equal(v.sicher, true);
});

test('Verfolgung: Stillstand ergibt keine Verschiebung', () => {
  const a = rauschen(160, 90, 9);
  const v = verfolgeBox(a, a, { x: 60, y: 30, w: 40, h: 30 }, OPT);
  nah(v.dx, 0, 0.1);
  nah(v.dy, 0, 0.1);
  assert.equal(v.sicher, true);
});

test('Verfolgung: flache Schablone ist unsicher', () => {
  const a = grauBild(160, 90, () => 100);
  const v = verfolgeBox(a, a, { x: 60, y: 30, w: 40, h: 30 }, OPT);
  assert.equal(v.sicher, false);
});

test('Verfolgung: Verschiebung ueber den Suchradius ist unsicher', () => {
  const a = rauschen(160, 90, 11);
  const b = verschiebe(a, 20, 0);
  const v = verfolgeBox(a, b, { x: 50, y: 30, w: 40, h: 30 }, { ...OPT, radius: 6 });
  assert.equal(v.sicher, false);
});

test('Verfolgung: unverwandtes neues Bild (Schnitt) ist unsicher', () => {
  const a = rauschen(160, 90, 13);
  const b = rauschen(160, 90, 99);
  assert.equal(verfolgeBox(a, b, { x: 60, y: 30, w: 40, h: 30 }, OPT).sicher, false);
});

test('Verfolgung: Box am Bildrand und winzige Box zerstoeren nichts', () => {
  const a = rauschen(160, 90, 5);
  const b = verschiebe(a, 2, 1);
  const rand = verfolgeBox(a, b, { x: 0, y: 0, w: 30, h: 20 }, OPT);
  assert.ok(Number.isFinite(rand.dx) && Number.isFinite(rand.dy));
  const winzig = verfolgeBox(a, b, { x: 10, y: 10, w: 2, h: 2 }, OPT);
  assert.equal(winzig.sicher, false);
});

test('fuehreDurch: folgt einer gleichmaessigen Bewegung ueber mehrere Bilder und haelt die Unsicherheit klein', () => {
  const basis = rauschen(200, 112, 21);
  const bilder = [0, 1, 2, 3, 4, 5].map((i) => verschiebe(basis, i * 2, 0));
  const zeiten = bilder.map((_, i) => i / 30);
  const p = { suchBasis: 4, suchMax: 14, sadUnsicher: 22, kontrastMin: 3, wachstumJeS: 0.25, fehlerSicher: 0.6 };
  // Videopixel = 4 mal Graupixel (Skala 0,25)
  const r = fuehreDurch({ x: 240, y: 120, w: 160, h: 120 }, 0, bilder, zeiten, 0.25, 800, p);
  nah(r.box.x, 240 + 10 * 4, 3);
  nah(r.box.y, 120, 3);
  assert.equal(r.sicher, true);
  assert.ok(r.unsicher < 0.6 / 0.25 * 5 + 1e-6);
});

test('fuehreDurch: unsichere Verfolgung laesst die Box wachsen statt zu raten', () => {
  const bilder = [rauschen(160, 90, 1), rauschen(160, 90, 2)];
  const p = { suchBasis: 4, suchMax: 14, sadUnsicher: 22, kontrastMin: 3, wachstumJeS: 0.25, fehlerSicher: 0.6 };
  const r = fuehreDurch({ x: 200, y: 100, w: 160, h: 120 }, 0, bilder, [0, 0.2], 0.25, 640, p);
  assert.equal(r.sicher, false);
  assert.deepEqual(r.box, { x: 200, y: 100, w: 160, h: 120 });
  nah(r.unsicher, 0.25 * 0.2 * 640, 1e-9);
});

test('suchRadius waechst mit der Zeit zwischen den Bildern und ist begrenzt', () => {
  const p = { suchBasis: 4, suchMax: 14 };
  assert.equal(suchRadius(0, p), 4);
  assert.ok(suchRadius(0.05, p) > 4);
  assert.equal(suchRadius(5, p), 14);
});

// ---------- Erkenner: Vorrang des Zonen-Videos in der Warteschlange ----------

test('Schranke: eine Pruefung mit Vorrang kommt vor Wartenden ohne Vorrang, nicht vor laufenden', async () => {
  const s = new Schranke(1);
  const reihenfolge = [];
  const lauf = async (name, vorrang) => {
    const ab = await s.betrete(vorrang);
    reihenfolge.push(name);
    await new Promise((r) => setTimeout(r, 5));
    ab();
  };
  const erster = lauf('laufend', false);
  const a = lauf('a', false);
  const b = lauf('b', false);
  const v1 = lauf('vorrang1', true);
  const v2 = lauf('vorrang2', true);
  await Promise.all([erster, a, b, v1, v2]);
  assert.deepEqual(reihenfolge, ['laufend', 'vorrang1', 'vorrang2', 'a', 'b']);
});

test('Schranke: ohne Vorrang bleibt es bei der Reihenfolge des Eintreffens', async () => {
  const s = new Schranke(1);
  const reihenfolge = [];
  const lauf = async (name) => {
    const ab = await s.betrete();
    reihenfolge.push(name);
    await new Promise((r) => setTimeout(r, 2));
    ab();
  };
  await Promise.all(['x', 'y', 'z'].map(lauf));
  assert.deepEqual(reihenfolge, ['x', 'y', 'z']);
});

// ---------- Runde 2: Hysterese, Rueckkehr, Haltezeit ----------

test('Entscheidung: keine Spur, aber das Urteil verdeckt gilt noch: ganz gedeckt, nie ein klares Bild', () => {
  assert.deepEqual(entscheideAnsicht({ ...frisch, anteil: 0, leerGehalten: true }), { ansicht: 'ganz', grund: 'leer' });
  // wird das Video frei gelassen (Hysterese erfuellt), ist ein leeres Zonen-Bild erlaubt
  assert.deepEqual(entscheideAnsicht({ ...frisch, anteil: 0, leerGehalten: false }), { ansicht: 'zonen', grund: null });
});

test('Entscheidung: Schnitt und Sprung gehen vor "leer", Fehler ebenso', () => {
  assert.equal(entscheideAnsicht({ ...frisch, leerGehalten: true, schnitt: true }).grund, 'schnitt');
  assert.equal(entscheideAnsicht({ ...frisch, leerGehalten: true, fehler: true }).grund, 'fehler');
});

test('rueckkehrOk: nur wenn zwei Rundlaeufe plus ein Bild unter dem erlaubten Alter liegen', () => {
  assert.equal(rueckkehrOk(null, 0.05, 0.6), true);
  assert.equal(rueckkehrOk(60, 0.05, 0.6), true);
  assert.equal(rueckkehrOk(260, 0.05, 0.6), true); // 0,57 s
  assert.equal(rueckkehrOk(280, 0.05, 0.6), false); // 0,61 s
  assert.equal(rueckkehrOk(350, 0.05, 0.6), false); // 0,75 s: vor der naechsten Antwort sind die Boxen zu alt
});

test('RTT-Grenze der Leinwand liegt nicht ueber dem, was rueckkehrOk noch erlaubt', () => {
  // konstanten.ts liest import.meta.env und laesst sich unter Node nicht laden: die Zahlen kommen aus dem Quelltext.
  const text = readFileSync(new URL('../../src/schleier/konstanten.ts', import.meta.url), 'utf8');
  const zahl = (name) => Number(new RegExp(`export const ${name} = ([0-9.]+)`).exec(text)[1]);
  const grenze = zahl('VIDEO_ZONEN_RTT_GRENZE_MS');
  assert.equal(rueckkehrOk(grenze, zahl('VIDEO_ZONEN_BILD_S'), zahl('VIDEO_ZONEN_ALTER_MAX_S')), true);
  assert.equal(rueckkehrOk(grenze + 30, zahl('VIDEO_ZONEN_BILD_S'), zahl('VIDEO_ZONEN_ALTER_MAX_S')), false);
});

test('spurHalten: mindestens 1 s, bei langsamem Erkenner das Dreifache des Rundlaufs', () => {
  assert.equal(spurHalten(null, 1.0), 1.0);
  assert.equal(spurHalten(60, 1.0), 1.0);
  assert.equal(spurHalten(200, 1.0), 1.0);
  assert.equal(spurHalten(400, 1.0), 1.2);
});

test('Spuren: mit der Haltezeit des langsamen Erkenners bleibt eine Spur zwischen zwei Antworten stehen', () => {
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 20, 20)], 5, P);
  sl.entferneAlte(6.1, spurHalten(400, 1.0));
  assert.equal(sl.spuren.length, 1);
  sl.entferneAlte(6.3, spurHalten(400, 1.0));
  assert.equal(sl.spuren.length, 0);
});

test('saubereZeitNach: waechst nur um beobachtete Schritte, ein Sprung ueber eine Luecke zaehlt hoechstens einen Schritt', () => {
  let z = 0;
  z = saubereZeitNach(z, Number.NEGATIVE_INFINITY, 20, false, 0.25); // erste Antwort der Szene
  assert.equal(z, 0);
  z = saubereZeitNach(z, 20, 20.06, false, 0.25);
  nah(z, 0.06);
  z = saubereZeitNach(z, 20.06, 25, false, 0.25); // Luecke von 5 s (Hintergrund): nur ein Schritt
  nah(z, 0.31);
  assert.equal(saubereZeitNach(z, 25, 25.05, true, 0.25), 0); // Treffer
  assert.equal(saubereZeitNach(1, 10, 9, false, 0.25), 1); // rueckwaerts: keine Zeit
});

test('saubereZeitNach: 3 s brauchen mindestens 12 Antworten mit vollem Schritt', () => {
  let z = 0;
  let mt = 5;
  let letzte = Number.NEGATIVE_INFINITY;
  let n = 0;
  while (z < 3 && n < 100) {
    z = saubereZeitNach(z, letzte, mt, false, 0.25);
    letzte = mt;
    mt += 10; // riesige Spruenge
    n++;
  }
  assert.ok(n >= 13, `nur ${n} Antworten`);
});


// ---------- Presets: Zeichenart je Zone ----------

const alleFlaechen = (preset, faceAn) => {
  const zonen = vervollstaendige({ zonen: Object.fromEntries(ZONEN.map((z) => [z, { an: z === 'face' ? faceAn : true, bedeckt: true }])) }).zonen;
  const gesicht = { score: 0.9, box: [100, 100, 120, 150], punkte: [[130, 150], [190, 150], [0, 0], [0, 0], [0, 0]] };
  const treffer = yunetTreffer(gesicht, 500, 500);
  treffer.push({ zone: 'breast', bedeckt: false, score: 0.9, box: [0, 300, 200, 100] });
  return berechneFlaechen(treffer, { zonen, rand: 0.1, preset }, 500, 500);
};
const lageVoll = { gesichtPasst: true, wortDa: true, wortPasst: true };

test('stilFuerZone: alle 11 Presets, Face an und aus: dieselbe Behandlung wie die Flaechen des Erkenners, aus der Tabelle auch ohne `behandlung`', () => {
  assert.equal(PRESET_IDS.length, 11);
  for (const preset of PRESET_IDS) {
    for (const faceAn of [true, false]) {
      const flaechen = alleFlaechen(preset, faceAn);
      assert.ok(flaechen.length > 0, `${preset} face ${faceAn}: keine Flaeche`);
      for (const f of flaechen) {
        const mit = stilFuerZone(preset, f.zone, { ...lageVoll, behandlung: f.behandlung, ersatz: f.ersatz });
        assert.equal(mit, f.behandlung, `${preset} face ${faceAn} ${f.zone}: Erkenner sagt ${f.behandlung}, Zeichner ${mit}`);
        // Ohne die Angabe des Erkenners: die Tabelle nach der Zone gibt dasselbe (Person: Gesicht und Koerper sind gleich).
        assert.equal(stilFuerZone(preset, f.zone, lageVoll), f.behandlung, `${preset} face ${faceAn} ${f.zone}: Tabelle weicht ab`);
      }
      // Mias Gesicht nur mit Face an (und nur in Mia-Presets); es gibt nie Mias Gesicht auf einer Koerperstelle.
      const gesichter = flaechen.filter((f) => f.behandlung === 'mia-gesicht');
      assert.equal(gesichter.length > 0, PRESETS[preset].gesicht === 'mia-gesicht' && faceAn, `${preset} face ${faceAn}`);
      for (const f of gesichter) assert.equal(f.zone, 'face');
      for (const f of flaechen.filter((x) => x.zone !== 'face')) assert.notEqual(stilFuerZone(preset, f.zone, lageVoll), 'mia-gesicht');
    }
  }
});

test('stilFuerZone: die Zeichenarten je Preset (Zensurbalken: Augen Balken, Koerper schwarz; Augenbalken nur Balken; Person: Mosaik oder Blur)', () => {
  assert.equal(stilFuerZone('zensurbalken', 'eyes', lageVoll), 'balken');
  assert.equal(stilFuerZone('zensurbalken', 'face', lageVoll), 'schwarz');
  assert.equal(stilFuerZone('zensurbalken', 'breast', lageVoll), 'schwarz');
  for (const z of ['eyes', 'face', 'breast']) assert.equal(stilFuerZone('augenbalken', z, lageVoll), 'balken');
  assert.equal(stilFuerZone('person-mosaik', 'breast', lageVoll), 'mosaik');
  assert.equal(stilFuerZone('person-blur', 'breast', lageVoll), 'blur');
  assert.equal(stilFuerZone('mia-wort', 'face', lageVoll), 'mia-gesicht');
  assert.equal(stilFuerZone('mia-wort', 'breast', lageVoll), 'schwarz-wort');
  assert.equal(stilFuerZone('mia-blur', 'breast', lageVoll), 'blur');
  assert.equal(stilFuerZone('mosaik-wort', 'face', lageVoll), 'mosaik-wort');
  assert.equal(behandlungFuerZone('mia-mosaik', 'head'), 'mosaik');
});

test('stilFuerZone: Mias Gesicht ohne passendes Bild wird die Koerper-Behandlung (nie leer), ohne Ersatz die des Presets', () => {
  const ohne = { ...lageVoll, gesichtPasst: false };
  assert.equal(stilFuerZone('mia-wort', 'face', { ...ohne, behandlung: 'mia-gesicht', ersatz: 'schwarz-wort' }), 'schwarz-wort');
  assert.equal(stilFuerZone('mia-mosaik', 'face', { ...ohne, behandlung: 'mia-gesicht', ersatz: 'mosaik' }), 'mosaik');
  assert.equal(stilFuerZone('mia-blur', 'face', ohne), 'blur');
  assert.equal(stilFuerZone('mia-wort', 'face', ohne), 'schwarz-wort');
  // der Ersatz ist nie wieder Mias Gesicht
  assert.equal(stilFuerZone('mia-wort', 'face', { ...ohne, behandlung: 'mia-gesicht', ersatz: 'mia-gesicht' }), 'schwarz-wort');
  assert.equal(ersatzFuer('mia-blur', undefined), 'blur');
  assert.equal(ganzesBildBehandlung('augenbalken'), 'mosaik');
});

test('stilFuerZone: Wort fehlt oder die Flaeche ist zu klein oder die Schrift fehlt: die Variante ohne Wort, nie offen', () => {
  assert.equal(stilFuerZone('mia-wort', 'breast', { ...lageVoll, wortDa: false }), 'schwarz');
  assert.equal(stilFuerZone('mia-wort', 'breast', { ...lageVoll, wortPasst: false }), 'schwarz');
  assert.equal(stilFuerZone('mosaik-wort', 'breast', { ...lageVoll, wortDa: false }), 'mosaik');
  assert.equal(stilFuerZone('mia-mosaik-wort', 'breast', { ...lageVoll, wortPasst: false }), 'mosaik');
  // Mias Gesicht ohne Bild mit Ersatz auf Wort: auch dort ohne Wort, wenn das Wort fehlt
  assert.equal(stilFuerZone('mia-wort', 'face', { gesichtPasst: false, wortDa: false, wortPasst: true }), 'schwarz');
  assert.equal(stilFuerZone('mia-wort', 'face', { gesichtPasst: true, wortDa: false, wortPasst: false }), 'mia-gesicht');
});

test('brauchtWort: nur Behandlungen mit Wort, auch als Ersatz fuer Mias Gesicht', () => {
  assert.equal(brauchtWort('mosaik', 'breast'), false);
  assert.equal(brauchtWort('blur', 'breast'), false);
  assert.equal(brauchtWort('mosaik-wort', 'breast'), true);
  assert.equal(brauchtWort('mia-wort', 'breast'), true);
  assert.equal(brauchtWort('mia-wort', 'face', 'mia-gesicht', 'schwarz-wort'), true);
  assert.equal(brauchtWort('mia-mosaik', 'face', 'mia-gesicht', 'mosaik'), false);
  assert.equal(wirksameBehandlung('mia-blur', 'face'), 'mia-gesicht');
});

test('skaliereFlaechen: Behandlung und Ersatz kommen mit, Unbekanntes faellt weg', () => {
  const r = skaliereFlaechen(
    [
      { zone: 'face', box: [10, 10, 20, 20], behandlung: 'mia-gesicht', ersatz: 'schwarz-wort' },
      { zone: 'breast', box: [0, 0, 10, 10], behandlung: 'gibt-es-nicht', ersatz: 5 },
      { zone: 'eyes', box: [5, 5, 10, 4] },
    ],
    100,
    100,
    200,
    200,
  );
  assert.equal(r[0].behandlung, 'mia-gesicht');
  assert.equal(r[0].ersatz, 'schwarz-wort');
  assert.equal('behandlung' in r[1], false);
  assert.equal('ersatz' in r[1], false);
  assert.equal('behandlung' in r[2], false);
});

test('SpurListe: Spuren mit anderer Behandlung gehoeren nicht zusammen (Gesicht nimmt nie die Spur des Kopfes), gleiche nehmen den Ersatz neu', () => {
  const sl = new SpurListe();
  const p = { zuordnungIou: 0.1, halten: 1 };
  const kopf = { zone: 'head', box: { x: 0, y: 0, w: 100, h: 100 }, behandlung: 'schwarz-wort' };
  const gesicht = { zone: 'face', box: { x: 20, y: 20, w: 60, h: 60 }, behandlung: 'mia-gesicht', ersatz: 'schwarz-wort' };
  sl.ordneZu([kopf, gesicht], 1, p);
  assert.equal(sl.spuren.length, 2);
  const idKopf = sl.spuren.find((s) => s.zone === 'head').id;
  const idGesicht = sl.spuren.find((s) => s.zone === 'face').id;
  sl.ordneZu([{ ...gesicht, box: { x: 22, y: 20, w: 60, h: 60 }, ersatz: 'mosaik' }, { ...kopf, box: { x: 2, y: 0, w: 100, h: 100 } }], 2, p);
  assert.equal(sl.spuren.length, 2);
  assert.equal(sl.spuren.find((s) => s.zone === 'head').id, idKopf);
  assert.equal(sl.spuren.find((s) => s.zone === 'face').id, idGesicht);
  assert.equal(sl.spuren.find((s) => s.zone === 'face').behandlung, 'mia-gesicht');
  assert.equal(sl.spuren.find((s) => s.zone === 'face').ersatz, 'mosaik');
  // Eine Erkennung mit anderer Behandlung (Preset gewechselt) wird eine neue Spur
  sl.ordneZu([{ ...kopf, behandlung: 'mosaik' }], 3, p);
  assert.equal(sl.spuren.length, 3);
});

test('personenGruppen: ohne eigenen Rand (Videozensur) bleibt die Huelle genau die Vereinigung, nahe Huellen werden eine, ferne nicht', () => {
  const nah2 = [
    [100, 100, 100, 200],
    [215, 120, 100, 200],
  ];
  const g0 = personenGruppen(nah2, [true, true], 1000, 1000, 0);
  assert.deepEqual(g0, [[100, 100, 215, 220]]);
  const g8 = personenGruppen(nah2, [true, true], 1000, 1000);
  assert.ok(g8[0][2] > 215 && g8[0][0] < 100, 'Standardrand 8 % bleibt');
  const fern = [
    [0, 0, 50, 50],
    [600, 600, 50, 50],
  ];
  assert.equal(personenGruppen(fern, [true, true], 1000, 1000, 0).length, 2);
});

test('SpurListe: fehlt `behandlung` auf einer Seite, gilt die Tabelle nach Preset und Zone (keine Doppelspur), andere Behandlung bleibt getrennt', () => {
  const sl = new SpurListe();
  const p = { zuordnungIou: 0.1, halten: 1, preset: 'mosaik' };
  // erste Antwort ohne Angabe der Behandlung, zweite mit der Behandlung der Tabelle: dieselbe Spur
  sl.ordneZu([{ zone: 'breast', box: { x: 0, y: 0, w: 100, h: 100 } }], 1, p);
  sl.ordneZu([{ zone: 'breast', box: { x: 3, y: 0, w: 100, h: 100 }, behandlung: 'mosaik' }], 2, p);
  assert.equal(sl.spuren.length, 1);
  // umgekehrt: Spur mit Behandlung, Erkennung ohne
  sl.ordneZu([{ zone: 'breast', box: { x: 5, y: 0, w: 100, h: 100 } }], 3, p);
  assert.equal(sl.spuren.length, 1);
  // eine andere Behandlung als die der Tabelle bleibt eine eigene Spur
  sl.ordneZu([{ zone: 'breast', box: { x: 5, y: 0, w: 100, h: 100 }, behandlung: 'blur' }], 4, p);
  assert.equal(sl.spuren.length, 2);
});

test('stilFuerZone: Mias Gesicht nicht zu zeichnen und kein Wort da: die Ersatz-Behandlung ohne Wort (nie leer)', () => {
  const art = stilFuerZone('mia-wort', 'face', { behandlung: 'mia-gesicht', ersatz: 'schwarz-wort', gesichtPasst: false, wortDa: false, wortPasst: true });
  assert.equal(art, 'schwarz');
  assert.equal(stilFuerZone('mia-mosaik-wort', 'face', { behandlung: 'mia-gesicht', ersatz: 'mosaik-wort', gesichtPasst: false, wortDa: true, wortPasst: true }), 'mosaik-wort');
});

test('SchriftVersuche: nach einem Fehlschlag Wiederholung nach 2 s, 8 s, 30 s, dann aufgegeben; Erfolg setzt zurueck', () => {
  assert.deepEqual([...SCHRIFT_PAUSEN_MS], [2000, 8000, 30000]);
  const v = new SchriftVersuche();
  assert.equal(v.darfVersuchen(0), true);
  v.meldeFehl(1000);
  assert.equal(v.darfVersuchen(2999), false);
  assert.equal(v.darfVersuchen(3000), true);
  v.meldeFehl(3000);
  assert.equal(v.darfVersuchen(10999), false);
  assert.equal(v.darfVersuchen(11000), true);
  v.meldeFehl(11000);
  assert.equal(v.darfVersuchen(40999), false);
  assert.equal(v.darfVersuchen(41000), true);
  v.meldeFehl(41000);
  assert.equal(v.aufgegeben, true);
  assert.equal(v.darfVersuchen(1e9), false);
  const w = new SchriftVersuche();
  w.meldeFehl(0);
  w.meldeOk();
  assert.equal(w.darfVersuchen(1), true);
});

// ---------- Uhr hinter der Bildzeit (Pause) ----------

const uhrToleranz = () => {
  const text = readFileSync(new URL('../../src/schleier/konstanten.ts', import.meta.url), 'utf8');
  return Number(/export const VIDEO_UHR_RUECK_S = ([0-9.]+)/.exec(text)[1]);
};

test('zeitOhneRueckfall: Uhr knapp hinter der Bildzeit gibt die Bildzeit, sonst die Uhr', () => {
  const tol = uhrToleranz();
  assert.equal(tol, 0.1);
  assert.equal(zeitOhneRueckfall(3.289, 3.293, tol, false), 3.293); // 4 ms
  assert.equal(zeitOhneRueckfall(3.282, 3.293, tol, false), 3.293); // 11 ms
  assert.equal(zeitOhneRueckfall(1.5, 1.625, 0.125, false), 1.625); // genau Toleranz (exakt darstellbare Zahlen)
  assert.equal(zeitOhneRueckfall(1.5625, 1.625, 0.125, false), 1.625);
  assert.equal(zeitOhneRueckfall(3.3, 3.293, tol, false), 3.3); // Uhr davor
  assert.equal(zeitOhneRueckfall(3.293, 3.293, tol, false), 3.293); // gleich
  assert.equal(zeitOhneRueckfall(3.1, 3.293, tol, false), 3.1); // mehr als Toleranz dahinter
  assert.equal(zeitOhneRueckfall(1.0, 1.126, 0.125, false), 1.0);
  assert.equal(zeitOhneRueckfall(3.289, Number.NaN, tol, false), 3.289); // nicht endlicher Bezug
  assert.equal(zeitOhneRueckfall(3.289, Number.NEGATIVE_INFINITY, tol, false), 3.289);
  assert.equal(zeitOhneRueckfall(3.289, Number.POSITIVE_INFINITY, tol, false), 3.289);
  assert.ok(Number.isNaN(zeitOhneRueckfall(Number.NaN, 3.293, tol, false))); // nicht endliche Uhr durchreichen
  assert.equal(zeitOhneRueckfall(Number.POSITIVE_INFINITY, 3.293, tol, false), Number.POSITIVE_INFINITY);
});

test('zeitOhneRueckfall: bei offenem Sprung immer die Uhr', () => {
  assert.equal(zeitOhneRueckfall(3.253, 3.293, 0.1, true), 3.253); // 40 ms hinter der Bildzeit, Sprung gemeldet
  assert.equal(zeitOhneRueckfall(3.253, 3.293, 0.1, false), 3.293);
});

test('Spuren: zurueckgefallene Uhr in der Pause verwirft die Spur nicht, ein echter Rueckwaertssprung schon', () => {
  const tol = uhrToleranz();
  const sl = new SpurListe();
  sl.ordneZu([kasten(0, 0, 20, 20)], 3.293, P);
  sl.entferneAlte(zeitOhneRueckfall(3.289, 3.293, tol, false), 1.0);
  assert.equal(sl.spuren.length, 1);
  // Gegenprobe: der Schutz gegen Rueckspruenge selbst ist unveraendert
  sl.entferneAlte(3.289, 1.0);
  assert.equal(sl.spuren.length, 0);
  // echter Sprung weit zurueck bleibt ein Sprung, auch durch die Funktion
  const s2 = new SpurListe();
  s2.ordneZu([kasten(0, 0, 20, 20)], 3.293, P);
  s2.entferneAlte(zeitOhneRueckfall(1.0, 3.293, tol, false), 1.0);
  assert.equal(s2.spuren.length, 0);
});

test('istSprung: Rueckwaertsgrenze ist die Uhr-Toleranz', () => {
  const tol = uhrToleranz();
  assert.equal(istSprung(3.293, 3.293 - tol + 0.001, 0.75), false);
  assert.equal(istSprung(3.293, 3.293 - tol - 0.001, 0.75), true);
});
