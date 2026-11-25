// T3 des Custom-Baukastens (Phase 11 E6a, Sicherheitsregel S3): fuer jede der 40 Mischungen, mit und ohne den Schalter Eye bar, und jeden Treffersatz (die acht abgelegten
// aus data/beispiel-treffer.json plus zwei erfundene mit ueberlappenden Treffern) deckt Custom mindestens jede Stelle, die das Preset Mosaik bei denselben Zonen, demselben
// Rand und derselben Schwelle deckt. Verglichen werden die Flaechen aus `berechneBildFlaechen` (wie im Bild-Weg, verschmelzen = true), gerastert mit Schritt 2 Bildpunkte
// innerhalb der Flaechen des Preset Mosaik; gedrehte Rechtecke (Augenbalken, Mias Gesicht) zaehlen als das gedrehte Rechteck. Wird eine Mischung rot, ist das ein Fund, der
// Test wird nicht angepasst.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEISPIELE, trefferFuer } from '../../src/beispiel.ts';
import { BEDECKBARE_ZONEN, STANDARD, ZONEN, vervollstaendige } from '../../src/einstellungen.ts';
import { aktiveZonenBoxen, berechneBildFlaechen, mitRand } from '../../src/erkenner/zonen.ts';
import { presetDef } from '../../src/preset-def.ts';
import { CUSTOM_FLAECHE, CUSTOM_GESICHT, PRESETS, customDef, wahlAusDef } from '../../src/presets.ts';

const SCHWELLE = 0.1;
const SCHRITT = 2;

const MISCHUNGEN = [];
for (const gesicht of CUSTOM_GESICHT) for (const flaeche of CUSTOM_FLAECHE) for (const woerter of [false, true]) MISCHUNGEN.push({ gesicht, flaeche, woerter });

const alleZonen = Object.fromEntries(ZONEN.map((z) => [z, BEDECKBARE_ZONEN.has(z) ? { an: true, bedeckt: true } : { an: true }]));
// Standard plus Face (Face an, Head aus): der Fall, in dem Mias Gesicht ohne Kopfflaeche darunter allein deckt (Ergaenzung der Leitung, E6n).
const standardPlusFace = { ...STANDARD.zonen, face: { an: true } };
const ZONEN_SAETZE = { standard: STANDARD.zonen, alle: alleZonen, 'standard-face': standardPlusFace };

// Erfundene Saetze mit ueberlappenden Treffern (Bild 800 x 1000): mehrere Gesichter dicht beieinander, ein gedrehtes Gesicht samt gedrehten Augen, Brust und Bauch ineinander,
// Genitalien und Gesaess ineinander, ein Fuss am Rand.
// Die Treffer, die YuNet je Gesicht liefert (Gesicht, Kopf, Augen, Mund); Kopf, Augen und Mund nach den Verhaeltnissen eines Gesichts, `winkel` neigt Gesicht und Augen.
function yunetGesicht(box, winkel) {
  const w = winkel === undefined ? {} : { winkel };
  return [
    { zone: 'face', bedeckt: false, score: 0.9, box, quelle: 'yunet', ...w },
    { zone: 'head', bedeckt: false, score: 0.9, box: [box[0] - box[2] * 0.2, box[1] - box[3] * 0.35, box[2] * 1.4, box[3] * 1.6], quelle: 'yunet' },
    { zone: 'eyes', bedeckt: false, score: 0.9, box: [box[0] + box[2] * 0.05, box[1] + box[3] * 0.25, box[2] * 0.9, box[3] * 0.2], quelle: 'yunet', ...w },
    { zone: 'mouth', bedeckt: false, score: 0.9, box: [box[0] + box[2] * 0.2, box[1] + box[3] * 0.65, box[2] * 0.6, box[3] * 0.2], quelle: 'yunet' },
  ];
}

const ERFUNDEN = [
  {
    name: 'erfunden-a',
    breite: 800,
    hoehe: 1000,
    treffer: [
      { zone: 'breast', bedeckt: false, score: 0.8, box: [300, 380, 110, 100], weiblich: true },
      { zone: 'breast', bedeckt: true, score: 0.7, box: [390, 385, 105, 95], weiblich: true },
      { zone: 'belly', bedeckt: false, score: 0.6, box: [330, 470, 140, 120] },
      { zone: 'face', bedeckt: false, score: 0.85, box: [340, 120, 120, 150], weiblich: true },
      { zone: 'face', bedeckt: false, score: 0.95, box: [345, 118, 112, 148], quelle: 'yunet' },
      { zone: 'head', bedeckt: false, score: 0.95, box: [320, 80, 160, 210], quelle: 'yunet' },
      { zone: 'eyes', bedeckt: false, score: 0.95, box: [360, 160, 90, 28], quelle: 'yunet', winkel: 0.3 },
      { zone: 'mouth', bedeckt: false, score: 0.95, box: [375, 235, 60, 24], quelle: 'yunet' },
    ],
  },
  {
    // Zwei Gesichter dicht beieinander, eines gedreht, so wie die Pipeline sie liefert (YuNet bringt Gesicht, Kopf, Augen und Mund; kein 320n-Gesicht daneben, das
    // `kombiniereGesichter` zu einem Paar gemacht und verworfen haette), dazu Genitalien und Gesaess ineinander, Fuss am Rand, zwei Achseln dicht beieinander.
    name: 'erfunden-b',
    breite: 800,
    hoehe: 1000,
    treffer: [
      ...yunetGesicht([80, 60, 90, 110], -0.4),
      ...yunetGesicht([150, 70, 90, 110]),
      { zone: 'genitals', bedeckt: false, score: 0.7, box: [320, 560, 90, 70] },
      { zone: 'buttocks', bedeckt: false, score: 0.7, box: [300, 540, 130, 110] },
      { zone: 'feet', bedeckt: false, score: 0.6, box: [700, 930, 100, 70] },
      { zone: 'armpits', bedeckt: false, score: 0.6, box: [20, 300, 60, 60] },
      { zone: 'armpits', bedeckt: false, score: 0.6, box: [50, 320, 60, 60] },
    ],
  },
  // Ein YuNet-Gesicht bei Neigung 0, 0,2 und 0,4 rad (Eckenfall der Mia-Presets, E6n): Gesicht, Kopf, Augen, Mund wie die Pipeline sie liefert.
  ...[0, 0.2, 0.4].map((w) => ({ name: `erfunden-neigung-${w}`, breite: 800, hoehe: 1000, treffer: yunetGesicht([300, 200, 100, 130], w) })),
];

// FUND (E6a, nicht in die Hauptpruefung aufgenommen): ein 320n-Gesicht, das NICHT mit einem YuNet-Gesicht gepaart wurde (IoU unter 0,3), neben einem gedrehten YuNet-Gesicht.
// Mosaik verschmilzt Kopf (aus dem 320n-Gesicht abgeleitet), Gesicht und Augen zu einer Huelle mit einer unbelegten Ecke; bei Mias Gesicht entfallen Gesicht, Augen und Mund
// als Zonen (wie bei den Mia-Presets), die Huelle ist kleiner, und Mias gedrehtes Gesicht fuellt die Ecke nicht. Die Ecke ist kein Treffer, nur die Fuellung der Huelle.
const FUND = {
  name: 'fund-ungepaart',
  breite: 800,
  hoehe: 1000,
  treffer: [
    { zone: 'face', bedeckt: false, score: 0.9, box: [80, 60, 90, 110], quelle: 'yunet', winkel: -0.4 },
    { zone: 'face', bedeckt: false, score: 0.5, box: [140, 55, 100, 120], weiblich: true },
    { zone: 'eyes', bedeckt: false, score: 0.9, box: [90, 95, 70, 22], quelle: 'yunet', winkel: -0.4 },
  ],
};

function saetze() {
  const liste = [];
  for (const b of BEISPIELE) {
    for (const mit of [false, true]) {
      // wie rechneVorschau: Modell-Treffer nach Schwelle, YuNet-Treffer bleiben
      const treffer = trefferFuer(b.kennung, mit).filter((t) => t.quelle === 'yunet' || t.score >= SCHWELLE);
      liste.push({ name: `${b.kennung}${mit ? '-mit-gesichtssuche' : '-ohne-gesichtssuche'}`, breite: b.breite, hoehe: b.hoehe, treffer });
    }
  }
  for (const x of ERFUNDEN) liste.push({ ...x, treffer: x.treffer.filter((t) => t.quelle === 'yunet' || t.score >= SCHWELLE) });
  return liste;
}

// Ist der Punkt (px, py) von der Flaeche gedeckt? Mit `balken` das gedrehte Rechteck, sonst die Box. Mias Gesicht zaehlt so, wie es gemalt wird (zeichneGesicht in
// src/erkenner/stile.ts): Mass der Flaeche (gedreht um die Mitte), Ecken mit Radius 0,14 der kleineren Seite abgerundet.
function deckt(f, px, py) {
  if (f.behandlung === 'mia-gesicht') {
    const mitte = f.balken ? f.balken.mitte : [f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] / 2];
    const breite = f.balken ? f.balken.breite : f.box[2];
    const hoehe = f.balken ? f.balken.hoehe : f.box[3];
    const winkel = f.balken ? f.balken.winkel : 0;
    const dx = px - mitte[0];
    const dy = py - mitte[1];
    const lx = Math.abs(dx * Math.cos(-winkel) - dy * Math.sin(-winkel));
    const ly = Math.abs(dx * Math.sin(-winkel) + dy * Math.cos(-winkel));
    if (lx > breite / 2 + 1e-6 || ly > hoehe / 2 + 1e-6) return false;
    const r = Math.min(breite, hoehe) * 0.14;
    const qx = lx - (breite / 2 - r);
    const qy = ly - (hoehe / 2 - r);
    return qx <= 1e-6 || qy <= 1e-6 || Math.hypot(qx, qy) <= r + 1e-6;
  }
  if (f.balken) {
    const { mitte, breite, hoehe, winkel } = f.balken;
    const dx = px - mitte[0];
    const dy = py - mitte[1];
    const c = Math.cos(-winkel);
    const s = Math.sin(-winkel);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    return Math.abs(lx) <= breite / 2 + 1e-6 && Math.abs(ly) <= hoehe / 2 + 1e-6;
  }
  const [x, y, w, h] = f.box;
  return px >= x - 1e-6 && px < x + w + 1e-6 && py >= y - 1e-6 && py < y + h + 1e-6;
}

// Erste Stelle, die Mosaik deckt und Custom nicht (null: keine).
function ersteLuecke(mosaik, custom) {
  for (const f of mosaik) {
    const [x, y, w, h] = f.box;
    for (let py = Math.floor(y); py < y + h; py += SCHRITT) {
      for (let px = Math.floor(x); px < x + w; px += SCHRITT) {
        if (!deckt(f, px + 0.5, py + 0.5)) continue;
        if (!custom.some((g) => deckt(g, px + 0.5, py + 0.5))) return { x: px, y: py, zone: f.zone };
      }
    }
  }
  return null;
}

const flaechenFuer = (satz, zonen, wahl, balken) => {
  const e = vervollstaendige({ ...STANDARD, zonen, schwelle: SCHWELLE, ...wahl, augenbalken: balken });
  return berechneBildFlaechen(satz.treffer, satz.treffer, e, false, satz.breite, satz.hoehe, true);
};

test('T3: jede Mischung deckt mindestens, was Mosaik deckt (alle Zonen, Standard-Zonen und Standard plus Face, mit und ohne Eye bar, 8 abgelegte und 5 erfundene Treffersaetze)', () => {
  const luecken = [];
  let verglichen = 0;
  let mitFlaechen = 0;
  for (const satz of saetze()) {
    for (const [zname, zonen] of Object.entries(ZONEN_SAETZE)) {
      for (const balken of [false, true]) {
        const mosaik = flaechenFuer(satz, zonen, { preset: 'mosaik' }, balken);
        if (mosaik.length > 0) mitFlaechen++;
        for (const m of MISCHUNGEN) {
          // Standard plus Face: Mias Gesicht deckt dort ohne Kopf darunter weniger als die Huelle von Mosaik (Bestand der Mia-Presets); sein Mass ist N1c.
          if (zname === 'standard-face' && m.gesicht === 'mia') continue;
          const custom = flaechenFuer(satz, zonen, { preset: 'custom', custom: m }, balken);
          verglichen++;
          const l = ersteLuecke(mosaik, custom);
          if (l) luecken.push(`${satz.name}/${zname}/Eye bar ${balken}/${JSON.stringify(m)}: Luecke bei ${l.x},${l.y} (Mosaik-Zone ${l.zone})`);
        }
      }
    }
  }
  assert.equal(verglichen, 13 * 2 * (40 + 40 + 32));
  assert.ok(mitFlaechen >= 30, `der Vergleich hat Gewicht: ${mitFlaechen} Szenen mit Flaechen`);
  assert.deepEqual(luecken, [], `${luecken.length} Luecken:\n${luecken.slice(0, 20).join('\n')}`);
});

test('T3: dasselbe mit dem Pack (Mias Gesicht und Sticker gelten) und ohne Pack (bausteinweise ersetzt, wie sie der Schleier schickt)', () => {
  const PACKS = [null, { freischaltungen: ['stil:mia-patch', 'zensur:sticker'] }];
  const luecken = [];
  for (const satz of saetze()) {
    for (const [zname, zonen] of Object.entries(ZONEN_SAETZE)) {
      for (const pack of PACKS) {
        const mosaik = flaechenFuer(satz, zonen, { preset: 'mosaik' }, false);
        for (const m of MISCHUNGEN) {
          if (zname === 'standard-face' && pack && m.gesicht === 'mia') continue; // wie oben, Mass N1c
          const wahl = wahlAusDef(presetDef({ preset: 'custom', custom: m }, pack).gilt);
          const custom = flaechenFuer(satz, zonen, wahl, false);
          const l = ersteLuecke(mosaik, custom);
          if (l) luecken.push(`${satz.name}/${zname}/${pack ? 'Pack' : 'ohne Pack'}/${JSON.stringify(m)}: Luecke bei ${l.x},${l.y}`);
        }
      }
    }
  }
  assert.deepEqual(luecken, [], luecken.slice(0, 20).join('\n'));
});

test('T3: der Vergleich sieht eine echte Luecke (Gegenprobe: ein Satz Flaechen ohne die Brust deckt weniger als Mosaik)', () => {
  const satz = saetze()[0];
  const mosaik = flaechenFuer(satz, STANDARD.zonen, { preset: 'mosaik' }, false);
  assert.ok(mosaik.length > 0);
  assert.equal(ersteLuecke(mosaik, mosaik), null);
  assert.notEqual(ersteLuecke(mosaik, mosaik.slice(1)), null);
  assert.notEqual(ersteLuecke(mosaik, []), null);
});

// ---------- N1 (E6n): das eigentliche Mass von S3 ist der TREFFER ----------
// Der Vergleich gegen Mosaik (oben) gilt fuer die Hauptsaetze. Fuer den Fundfall (ungepaartes 320n-Gesicht neben gedrehtem YuNet-Gesicht) gilt er NICHT: die verschmolzene
// Huelle von Mosaik deckt dort eine Ecke, die kein Treffer ist (nur die Fuellung der Huelle), und Mias Gesicht ist als Aufgelegtes kleiner als diese Huelle. Das Mass "mindestens
// wie Mosaik" war dort zu grob; hier gilt stattdessen (a): jede Trefferbox einer eingeschalteten Zone samt Rand ist gedeckt, (b): wo eine Mischung einem der zwoelf Presets
// entspricht, sind die Flaechen tief gleich, und (c) fuer Mias Gesicht die Gleichheit mit dem Bestand (mia-mosaik), weil das gemalte Gesicht (gedrehtes Rechteck mit runden Ecken) die
// Ecken der achsenparallelen YuNet-Box bei geneigtem Gesicht und Face an, Head aus nicht deckt: Bestand der Mia-Presets, Entscheidung der Inhaberin offen.
const SAETZE_N1 = () => [...saetze(), { ...FUND, treffer: FUND.treffer.filter((t) => t.quelle === 'yunet' || t.score >= SCHWELLE) }];

// Die Boxen, die der Nutzer mit seinen Zonen gedeckt haben will: Treffer der eingeschalteten Zonen (320n-Gesichter liefern Gesicht, Kopf, Augen, Mund), samt Sicherheitsrand wie
// mitRand ihn rechnet, ohne Zusammenfuehren. `ohneGesicht`: Mias Gesicht ersetzt die Gesichter (Face an), dann zaehlen Gesicht, Augen und Mund nicht (Mass N1c).
function pflichtBoxen(satz, e, ohneGesicht = false) {
  return aktiveZonenBoxen(satz.treffer, e.zonen, satz.breite, satz.hoehe)
    .filter((f) => !(ohneGesicht && (f.zone === 'face' || f.zone === 'eyes' || f.zone === 'mouth')))
    .flatMap((f) => mitRand([f], e.rand, satz.breite, satz.hoehe));
}

// Erste Stelle einer Pflichtbox, die keine Flaeche deckt (null: keine). Gedrehte Rechtecke zaehlen als das gedrehte Rechteck, Mias Gesicht mit runden Ecken.
function ersteOffene(pflicht, flaechen) {
  for (const f of pflicht) {
    const [x, y, w, h] = f.box;
    for (let py = Math.floor(y); py < y + h; py += SCHRITT) {
      for (let px = Math.floor(x); px < x + w; px += SCHRITT) {
        if (!flaechen.some((g) => deckt(g, px + 0.5, py + 0.5))) return { x: px, y: py, zone: f.zone };
      }
    }
  }
  return null;
}

// Fuer eine Liste von Treffersaetzen: alle 40 Mischungen, alle Zonen-Staende, mit und ohne Eye bar, mit und ohne Pack. Liefert die offenen Stellen und die Zahl der Pflichtboxen.
// Bei Mias Gesicht mit Face an gilt N1a ohne Gesicht, Augen und Mund (die ersetzt Mia), dafuer N1c.
function pruefeN1a(liste) {
  const PACKS = [null, { freischaltungen: ['stil:mia-patch', 'zensur:sticker'] }];
  const offen = [];
  let verglichen = 0;
  let pflichtGesamt = 0;
  for (const satz of liste) {
    for (const [zname, zonen] of Object.entries(ZONEN_SAETZE)) {
      const e = vervollstaendige({ ...STANDARD, zonen, schwelle: SCHWELLE });
      const voll = pflichtBoxen(satz, e);
      const ohne = pflichtBoxen(satz, e, true);
      pflichtGesamt += voll.length;
      for (const balken of [false, true]) {
        for (const pack of PACKS) {
          for (const m of MISCHUNGEN) {
            const wahl = wahlAusDef(presetDef({ preset: 'custom', custom: m }, pack).gilt);
            const flaechen = flaechenFuer(satz, zonen, wahl, balken);
            const mia = wahl.custom.gesicht === 'mia' && zonen.face.an;
            verglichen++;
            const l = ersteOffene(mia ? ohne : voll, flaechen);
            if (l) offen.push(`${satz.name}/${zname}/Eye bar ${balken}/${pack ? 'Pack' : 'ohne Pack'}/${JSON.stringify(m)}: offen bei ${l.x},${l.y} (Zone ${l.zone})`);
          }
        }
      }
    }
  }
  return { offen, verglichen, pflichtGesamt };
}

test('N1a: jede Trefferbox einer eingeschalteten Zone samt Rand ist von den Flaechen der Mischung gedeckt (40 Mischungen, 3 Zonen-Staende, mit und ohne Eye bar, mit und ohne Pack, 8 abgelegte und 5 erfundene Treffersaetze, dazu der Fundfall)', () => {
  const { offen, verglichen, pflichtGesamt } = pruefeN1a(SAETZE_N1());
  assert.equal(verglichen, 14 * 3 * 2 * 2 * 40);
  assert.ok(pflichtGesamt >= 50, `der Vergleich hat Gewicht: ${pflichtGesamt} Pflichtboxen`);
  assert.deepEqual(offen, [], `${offen.length} offene Stellen:\n${offen.slice(0, 20).join('\n')}`);
});

test('N1a: Gegenprobe, der Vergleich sieht eine offene Stelle (Flaechen ohne die Brust, leere Flaechen)', () => {
  const satz = saetze()[0];
  const e = vervollstaendige({ ...STANDARD, schwelle: SCHWELLE });
  const pflicht = pflichtBoxen(satz, e);
  assert.ok(pflicht.length > 0);
  const flaechen = flaechenFuer(satz, STANDARD.zonen, { preset: 'mosaik' }, false);
  assert.equal(ersteOffene(pflicht, flaechen), null);
  assert.notEqual(ersteOffene(pflicht, flaechen.slice(1)), null);
  assert.notEqual(ersteOffene(pflicht, []), null);
});

// N1b: welche der 40 Mischungen entspricht einem der zwoelf Presets (gleiche Behandlung von Gesicht und Rest, Augen wie Koerper, keine Person)?
const PRESET_ZU_MISCHUNG = [];
for (const m of MISCHUNGEN) {
  const d = customDef(m);
  for (const p of Object.values(PRESETS)) {
    if (p.augen === 'wie-koerper' && !p.person && p.gesicht === d.gesicht && p.koerper === d.koerper) PRESET_ZU_MISCHUNG.push({ preset: p.id, m });
  }
}

// Mischungen mit und ohne Woerter sind bei Blur und Sticker gleich (kein Wort moeglich): diese vier Presets kommen je zweimal vor.
test('N1b: es gibt genau die erwarteten Entsprechungen zwischen Mischung und Preset (9 Presets, 13 Mischungen)', () => {
  const namen = PRESET_ZU_MISCHUNG.map((x) => x.preset).sort();
  assert.deepEqual(namen, ['blur', 'blur', 'mia-blur', 'mia-blur', 'mia-mosaik', 'mia-mosaik-wort', 'mia-sticker', 'mia-sticker', 'mia-wort', 'mosaik', 'mosaik-wort', 'sticker', 'sticker']);
  assert.equal(new Set(namen).size, 9);
});

test('N1b: eine Mischung, die einem Preset entspricht, liefert tief gleiche Flaechen wie das Preset (alle Saetze, alle Zonen-Staende, mit und ohne Eye bar, verschmolzen und nicht)', () => {
  const verschieden = [];
  let n = 0;
  for (const satz of SAETZE_N1()) {
    for (const [zname, zonen] of Object.entries(ZONEN_SAETZE)) {
      for (const balken of [false, true]) {
        for (const { preset, m } of PRESET_ZU_MISCHUNG) {
          const e1 = vervollstaendige({ ...STANDARD, zonen, schwelle: SCHWELLE, augenbalken: balken, preset });
          const e2 = vervollstaendige({ ...STANDARD, zonen, schwelle: SCHWELLE, augenbalken: balken, preset: 'custom', custom: m });
          for (const verschmelzen of [true, false]) {
            for (const ganz of [false, true]) {
              const a = berechneBildFlaechen(satz.treffer, satz.treffer, e1, ganz, satz.breite, satz.hoehe, verschmelzen);
              const b = berechneBildFlaechen(satz.treffer, satz.treffer, e2, ganz, satz.breite, satz.hoehe, verschmelzen);
              n++;
              try {
                assert.deepEqual(b, a);
              } catch {
                verschieden.push(`${satz.name}/${zname}/Eye bar ${balken}/${preset}/verschmolzen ${verschmelzen}/ganz ${ganz}`);
              }
            }
          }
        }
      }
    }
  }
  assert.equal(n, 14 * 3 * 2 * 13 * 2 * 2);
  assert.deepEqual(verschieden, [], verschieden.slice(0, 20).join('\n'));
});

// N1c: Mias Gesicht. Jede Mischung mit `mia` liefert fuer jeden Treffersatz und jeden Zonen-Stand dieselben Gesichtsflaechen wie das Preset mia-mosaik (das Ersatz-Feld haengt an der
// Flaeche des Rests und fehlt im Vergleich); die echten Flaechen aus berechneBildFlaechen.
test('N1c: Mias Gesicht in Custom ist dieselbe Flaeche wie bei mia-mosaik (alle Saetze, alle Zonen-Staende, mit und ohne Eye bar)', () => {
  const nurGesicht = (fl) => fl.filter((f) => f.behandlung === 'mia-gesicht').map(({ ersatz, ...rest }) => rest);
  const verschieden = [];
  let n = 0;
  let mitGesicht = 0;
  for (const satz of SAETZE_N1()) {
    for (const [zname, zonen] of Object.entries(ZONEN_SAETZE)) {
      for (const balken of [false, true]) {
        const ref = nurGesicht(flaechenFuer(satz, zonen, { preset: 'mia-mosaik' }, balken));
        if (ref.length > 0) mitGesicht++;
        for (const m of MISCHUNGEN.filter((x) => x.gesicht === 'mia')) {
          n++;
          try {
            assert.deepEqual(nurGesicht(flaechenFuer(satz, zonen, { preset: 'custom', custom: m }, balken)), ref);
          } catch {
            verschieden.push(`${satz.name}/${zname}/Eye bar ${balken}/${JSON.stringify(m)}`);
          }
        }
      }
    }
  }
  assert.equal(n, 14 * 3 * 2 * 8);
  assert.ok(mitGesicht >= 10, `der Vergleich hat Gewicht: ${mitGesicht} Szenen mit Mias Gesicht`);
  assert.deepEqual(verschieden, [], verschieden.slice(0, 20).join('\n'));
});

// N1d: Waechter. Wie viele Rasterzellen (Schritt 2) der YuNet-Gesichtsbox bleiben bei Neigung 0, 0,2 und 0,4 rad mit Face an und Head aus ungedeckt? Bei Custom mit `mia` und beim
// Preset mia-mosaik gleich; die Zahlen stehen fest. Bestand, Entscheidung der Inhaberin offen: wird die Luecke groesser, wird dieser Test rot.
const LUECKE_ERWARTET = { 0: 0, 0.2: 0, 0.4: 28 };
function ungedeckteZellen(winkel, einst) {
  const box = [300, 200, 100, 130];
  const treffer = [{ zone: 'face', bedeckt: false, score: 0.9, box, quelle: 'yunet', winkel }];
  const e = vervollstaendige({ ...STANDARD, zonen: standardPlusFace, schwelle: SCHWELLE, ...einst });
  const fl = berechneBildFlaechen(treffer, treffer, e, false, 800, 1000, true);
  let n = 0;
  for (let py = box[1]; py < box[1] + box[3]; py += SCHRITT) for (let px = box[0]; px < box[0] + box[2]; px += SCHRITT) if (!fl.some((g) => deckt(g, px + 0.5, py + 0.5))) n++;
  return n;
}
test('N1d: Waechter, ungedeckte Rasterzellen der YuNet-Gesichtsbox bei Neigung 0, 0,2, 0,4 (Face an, Head aus): Custom mit mia gleich mia-mosaik, feste Zahlen', () => {
  const gemessen = {};
  for (const w of [0, 0.2, 0.4]) {
    const preset = ungedeckteZellen(w, { preset: 'mia-mosaik' });
    for (const m of MISCHUNGEN.filter((x) => x.gesicht === 'mia')) assert.equal(ungedeckteZellen(w, { preset: 'custom', custom: m }), preset, `Neigung ${w}, ${JSON.stringify(m)}`);
    gemessen[w] = preset;
  }
  assert.deepEqual(gemessen, LUECKE_ERWARTET);
});
