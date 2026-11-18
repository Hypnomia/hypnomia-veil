// Einheitstests Phase 11 E4c0 (Regeln B5, B6, B3, B8): Stufenlogik, Kleidungsfrage, Stufenlisten gegen die Grenzen, CSS ohne feste Farben,
// kein Content-Script erreicht die Bausteine. Die Bausteine selbst (DOM) misst tests/chromium/bausteine.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEDECKBARE_ZONEN, FREILEGEN_MAX_MS, FREILEGEN_MIN_MS, SCHWELLE_MAX, SCHWELLE_MIN, STANDARD, VERWEIGERN_MAX, VERWEIGERN_MIN, ZONEN } from '../../src/einstellungen.ts';
import { markierteStufe, pruefeStufenliste, stufenAnsicht } from '../../src/oberflaeche/bausteine/stufen.ts';
import { STUFENLISTEN } from '../../src/oberflaeche/bausteine/stufen-daten.ts';
import { kleidungsStand, setzeEineZone, setzeKleidung } from '../../src/oberflaeche/bausteine/kleidung.ts';
import { ZONEN_WAHLEN, bedecktAlle, setzeBedeckt, setzeZonenWahl } from '../../src/einstieg/zonen.ts';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const kopie = (o) => JSON.parse(JSON.stringify(o));

// ---------- Stufenlogik (B5) ----------
test('Stufenlogik: jede Stufe der vier Listen ist markiert, wenn der Wert genau ihr entspricht, und nur sie', () => {
  for (const [name, liste] of Object.entries(STUFENLISTEN)) {
    liste.stufen.forEach((s, i) => {
      const a = stufenAnsicht(liste, s.wert);
      assert.equal(a.markiert, i, `${name}: Stufe ${s.name}`);
      assert.equal(a.zwischenwert, false);
    });
  }
});

test('Stufenlogik: ein Zwischenwert markiert KEINE Stufe und oeffnet "Exact value"', () => {
  const zwischen = { stimmung: [0.11, 0.12, 0.13, 0.14, 0.16, 0.2, 0.21, 0.25], verweigern: [0.01, 0.09, 0.11, 0.2, 0.3], freilegen: [3000, 4000, 7000, 15000, 30000], lautstaerke: [0, 0.29, 0.31, 0.5, 0.61, 1] };
  for (const [name, werte] of Object.entries(zwischen)) {
    for (const w of werte) {
      const a = stufenAnsicht(STUFENLISTEN[name], w);
      assert.equal(a.markiert, null, `${name} ${w}`);
      assert.equal(a.zwischenwert, true, `${name} ${w}`);
    }
  }
});

test('Stufenlogik: Gleitkomma-Reste rutschen nicht auf die Nachbarstufe und fallen nicht von der Stufe (R3: Gleichheit nur bis auf Reste, kein Runden)', () => {
  const l = STUFENLISTEN.stimmung;
  assert.equal(stufenAnsicht(l, 0.15000000000000002).markiert, 1);
  assert.equal(stufenAnsicht(l, 0.1 + 0.05).markiert, 1);
  assert.equal(stufenAnsicht(l, 0.15 + 1e-12).markiert, 1);
  assert.equal(stufenAnsicht(l, 0.22 - 1e-12).markiert, 2);
  assert.equal(stufenAnsicht(l, 0.1000001).markiert, null, 'ein echter Rest ueber einem Millionstel Einheit ist ein Zwischenwert');
  assert.equal(stufenAnsicht(l, 0.13000001).markiert, null);
  assert.equal(stufenAnsicht(l, 0.14999).markiert, null, 'nicht auf Normal gerundet');
  assert.equal(stufenAnsicht(l, 0.1049).markiert, null, 'nicht auf Careful gerundet');
  assert.equal(stufenAnsicht(STUFENLISTEN.verweigern, 0).markiert, 0);
  assert.equal(stufenAnsicht(STUFENLISTEN.verweigern, 1e-12).markiert, 0);
  assert.equal(stufenAnsicht(STUFENLISTEN.verweigern, 0.095).markiert, null);
});

test('Stufenlogik: ganze Sekunden bei Freilegen (Millisekunden gespeichert), kein Runden', () => {
  const l = STUFENLISTEN.freilegen;
  assert.equal(stufenAnsicht(l, 10000).markiert, 1);
  assert.equal(stufenAnsicht(l, 10000.0000001).markiert, 1);
  assert.equal(stufenAnsicht(l, 9600).markiert, null);
  assert.equal(stufenAnsicht(l, 10499).markiert, null);
  assert.equal(stufenAnsicht(l, 11000).markiert, null);
  assert.equal(stufenAnsicht(l, 17000).markiert, null);
});

test('Stufenlogik: eine Viertel-Einheit auf jeder Seite jeder Stufe jeder Liste ist ein Zwischenwert (nie auf eine Stufe gerundet)', () => {
  for (const [name, l] of Object.entries(STUFENLISTEN)) {
    l.stufen.forEach((s, i) => {
      for (const d of [-0.25, 0.25]) {
        const w = s.wert + d * l.einheit;
        assert.equal(stufenAnsicht(l, w).markiert, null, `${name} Stufe ${i} ${d > 0 ? 'ueber' : 'unter'}`);
        assert.equal(stufenAnsicht(l, w).zwischenwert, true, `${name} Stufe ${i} ${d}`);
      }
      assert.equal(stufenAnsicht(l, s.wert).markiert, i, `${name} Stufe ${i} selbst`);
    });
  }
});

test('Stufenlogik: Grenzwerte und unbrauchbare Werte mit festen Erwartungen (nie eine Stufe geraten)', () => {
  // feste Erwartungen je Liste: [Wert, erwarteter Index oder null]
  const fest = {
    stimmung: [[0.1, 0], [0.25, null], [0.09, null], [0.26, null]],
    verweigern: [[0, 0], [0.3, null], [-0.004, null], [0.31, null]],
    freilegen: [[3000, null], [30000, null], [2000, null], [31000, null]],
    lautstaerke: [[0, null], [1, null], [-0.1, null], [1.1, null]],
  };
  for (const [name, faelle] of Object.entries(fest)) for (const [w, soll] of faelle) assert.equal(stufenAnsicht(STUFENLISTEN[name], w).markiert, soll, `${name} ${w}`);
  for (const [name, l] of Object.entries(STUFENLISTEN)) for (const bad of [Number.NaN, Infinity, -Infinity]) assert.equal(stufenAnsicht(l, bad).markiert, null, `${name} ${bad}`);
  assert.equal(markierteStufe(STUFENLISTEN.stimmung.stufen, 0.15, 0), null);
  assert.equal(markierteStufe([], 0.15, 0.01), null);
});

test('Stufenlogik: eine Anzeige rundet nie auf eine strengere Stufe (0,12 liegt zwischen Careful und Normal: keine Stufe)', () => {
  assert.equal(stufenAnsicht(STUFENLISTEN.stimmung, 0.12).markiert, null);
});

test('Stufenlisten: Werte in den heutigen Grenzen, aufsteigend, heutiger Standard ist eine Stufe', () => {
  const grenzen = {
    stimmung: [SCHWELLE_MIN, SCHWELLE_MAX, STANDARD.schwelle],
    verweigern: [VERWEIGERN_MIN, VERWEIGERN_MAX, STANDARD.quiz.verweigern],
    freilegen: [FREILEGEN_MIN_MS, FREILEGEN_MAX_MS, STANDARD.quiz.freilegenMs],
    lautstaerke: [0, 1, STANDARD.ton.lautstaerke],
  };
  for (const [name, [min, max, standard]] of Object.entries(grenzen)) {
    const l = STUFENLISTEN[name];
    assert.equal(l.min, min, name);
    assert.equal(l.max, max, name);
    assert.equal(l.standard, standard, name);
    assert.deepEqual(pruefeStufenliste(l), [], name);
    for (const s of l.stufen) assert.ok(s.wert >= min && s.wert <= max, `${name} ${s.wert}`);
    assert.equal(l.stufen.length, 3);
  }
  assert.deepEqual(STUFENLISTEN.stimmung.stufen.map((s) => s.wert), [0.1, 0.15, 0.22]);
  assert.deepEqual(STUFENLISTEN.verweigern.stufen.map((s) => s.wert), [0, 0.1, 0.25]);
  assert.deepEqual(STUFENLISTEN.freilegen.stufen.map((s) => s.wert), [5000, 10000, 20000]);
  assert.deepEqual(STUFENLISTEN.lautstaerke.stufen.map((s) => s.wert), [0.3, 0.6, 0.9]);
});

test('Stufenlisten: pruefeStufenliste findet eine Stufe ausserhalb, eine falsche Reihenfolge und einen Standard ohne Stufe', () => {
  const schlecht = { ...STUFENLISTEN.stimmung, stufen: [{ name: 'a', wert: 0.3 }, { name: 'b', wert: 0.1 }], standard: 0.12 };
  assert.equal(pruefeStufenliste(schlecht).length, 3);
});

// ---------- Kleidungsfrage (B6) ----------
const zonen = (bedeckt, an) => {
  const z = kopie(STANDARD.zonen);
  for (const k of ZONEN) {
    z[k].an = an(k);
    if (BEDECKBARE_ZONEN.has(k)) z[k].bedeckt = bedeckt(k);
  }
  return z;
};
const bed = [...BEDECKBARE_ZONEN];

test('kleidungsStand: haut, auch-bedeckt und gemischt ueber alle Staende', () => {
  assert.equal(kleidungsStand(zonen(() => false, () => true)), 'haut');
  assert.equal(kleidungsStand(zonen(() => true, () => true)), 'auch-bedeckt');
  // Jede Teilmenge der bedeckbaren Zonen (alle an): leer = haut, voll = auch-bedeckt, sonst gemischt.
  for (let m = 0; m < 1 << bed.length; m++) {
    const menge = new Set(bed.filter((_, i) => m & (1 << i)));
    const soll = menge.size === 0 ? 'haut' : menge.size === bed.length ? 'auch-bedeckt' : 'gemischt';
    assert.equal(kleidungsStand(zonen((k) => menge.has(k), () => true)), soll, [...menge].join());
  }
});

test('kleidungsStand: nur eingeschaltete bedeckbare Zonen zaehlen', () => {
  // breast bedeckt, genitals aus und nicht bedeckt: auch-bedeckt (die ausgeschaltete zaehlt nicht)
  const z = zonen((k) => k === 'breast', (k) => k === 'breast');
  assert.equal(kleidungsStand(z), 'auch-bedeckt');
  // eine ausgeschaltete bedeckte Zone macht eine Hautwahl nicht gemischt
  const z2 = zonen((k) => k === 'feet', (k) => k === 'breast');
  assert.equal(kleidungsStand(z2), 'haut');
  // R7: nichts bedeckbares an: es zaehlen die gespeicherten Kaestchen aller bedeckbaren Zonen
  assert.equal(kleidungsStand(zonen(() => true, () => false)), 'auch-bedeckt');
  assert.equal(kleidungsStand(zonen(() => false, () => false)), 'haut');
  assert.equal(kleidungsStand(zonen((k) => k === 'feet', () => false)), 'gemischt');
  // nicht bedeckbare Zonen (Face) spielen keine Rolle
  assert.equal(kleidungsStand(zonen(() => false, (k) => k === 'face' || k === 'breast')), 'haut');
});

test('kleidungsStand: der heutige Standard aus src/einstellungen.ts ist gemischt (keine Antwort markiert)', () => {
  assert.equal(kleidungsStand(kopie(STANDARD.zonen)), 'gemischt');
});

test('setzeKleidung: "auch bedeckt" setzt alle bedeckbaren, "haut" nimmt alle weg, nie ein Zonen-Schalter geaendert, Eingang unveraendert', () => {
  let n = 0;
  for (let m = 0; m < 1 << bed.length; m++) {
    for (let a = 0; a < 1 << ZONEN.length; a += 37) {
      const menge = new Set(bed.filter((_, i) => m & (1 << i)));
      const z = zonen((k) => menge.has(k), (k) => !!(a & (1 << ZONEN.indexOf(k))));
      const vorher = kopie(z);
      for (const antwort of ['haut', 'auch-bedeckt']) {
        const neu = setzeKleidung(z, antwort);
        assert.deepEqual(z, vorher, 'Eingang unveraendert');
        for (const k of ZONEN) {
          assert.equal(neu[k].an, z[k].an, `an von ${k} unveraendert`);
          if (BEDECKBARE_ZONEN.has(k)) assert.equal(neu[k].bedeckt, antwort === 'auch-bedeckt', k);
          else assert.equal('bedeckt' in neu[k], 'bedeckt' in z[k], `${k} behaelt seine Form`);
          if (antwort === 'auch-bedeckt' && z[k].bedeckt === true) assert.equal(neu[k].bedeckt, true, 'vorher bedeckt bleibt bedeckt');
        }
        assert.equal(kleidungsStand(neu), antwort);
        n += 1;
      }
    }
  }
  assert.ok(n > 100);
});

test('setzeEineZone: schaltet nur diese Zone, eine neu eingeschaltete bedeckbare Zone folgt der Kleidungsfrage', () => {
  const haut = zonen(() => false, (k) => k === 'breast');
  const a = setzeEineZone(haut, 'buttocks', true);
  assert.equal(a.buttocks.an, true);
  assert.equal(a.buttocks.bedeckt, false);
  assert.equal(a.breast.an, true);
  const voll = zonen(() => true, (k) => k === 'breast');
  assert.equal(setzeEineZone(voll, 'buttocks', true).buttocks.bedeckt, true);
  const aus = setzeEineZone(voll, 'breast', false);
  assert.equal(aus.breast.an, false);
  assert.equal(aus.breast.bedeckt, true, 'ausgeschaltet behaelt bedeckt');
  assert.equal(setzeEineZone(haut, 'face', true).face.an, true);
  assert.equal('bedeckt' in setzeEineZone(haut, 'face', true).face, false);
  assert.equal(haut.buttocks.an, false, 'Eingang unveraendert');
});

// R1: ueber alle Zonenstaende (an mal bedeckt), jede ausgeschaltete Zone eingeschaltet
function ueberAlleStaende(fn) {
  const bedZonen = ZONEN.filter((k) => BEDECKBARE_ZONEN.has(k));
  let n = 0;
  for (let a = 0; a < 1 << ZONEN.length; a++) {
    for (let m = 0; m < 1 << bedZonen.length; m++) {
      const z = zonen((k) => !!(m & (1 << bedZonen.indexOf(k))), (k) => !!(a & (1 << ZONEN.indexOf(k))));
      fn(z);
      n += 1;
    }
  }
  return n;
}

test('setzeEineZone (R1): eine neu eingeschaltete Zone hat nie weniger bedeckt als gespeichert und nie weniger als die Kleidungsfrage sagt, alle 65536 Staende', () => {
  const n = ueberAlleStaende((z) => {
    const auch = kleidungsStand(z) === 'auch-bedeckt';
    for (const k of ZONEN) {
      if (z[k].an) continue;
      const neu = setzeEineZone(z, k, true);
      assert.equal(neu[k].an, true);
      if (BEDECKBARE_ZONEN.has(k)) {
        assert.ok(neu[k].bedeckt === true || (z[k].bedeckt !== true && !auch), `${k}: gespeichertes bedeckt oder Kleidungsfrage verloren`);
        if (z[k].bedeckt === true) assert.equal(neu[k].bedeckt, true, 'gespeichert bedeckt bleibt');
        if (auch) assert.equal(neu[k].bedeckt, true, 'auch-bedeckt gilt fuer die neue Zone');
        // nie weniger, als die heutige Einstellungsseite ihr liesse (sie laesst bedeckt stehen) und als die Interview-Regel (bedecktAlle)
        assert.ok(!(z[k].bedeckt === true) || neu[k].bedeckt === true);
        assert.ok(!bedecktAlle(z) || neu[k].bedeckt === true);
      } else assert.equal('bedeckt' in neu[k], 'bedeckt' in z[k]);
      for (const a of ZONEN) if (a !== k) assert.deepEqual(neu[a], z[a], `${a} unberuehrt`);
    }
    // Ausschalten laesst bedeckt stehen
    for (const k of ZONEN) if (z[k].an) assert.deepEqual(setzeEineZone(z, k, false)[k], { ...z[k], an: false });
  });
  assert.equal(n, 65536);
});

test('setzeEineZone (R1): Rundweg Standard, Genitals aus und wieder an, behaelt bedeckt', () => {
  const aus = setzeEineZone(kopie(STANDARD.zonen), 'genitals', false);
  assert.deepEqual(aus.genitals, { an: false, bedeckt: true });
  assert.deepEqual(setzeEineZone(aus, 'genitals', true).genitals, { an: true, bedeckt: true });
});

test('setzeZonenWahl (R2): eine durch die Karte neu eingeschaltete bedeckbare Zone behaelt ihr gespeichertes bedeckt, alle Staende mal drei Karten', () => {
  let faelle = 0;
  const n = ueberAlleStaende((z) => {
    const vorher = bedecktAlle(z);
    for (const karte of ZONEN_WAHLEN) {
      const neu = setzeZonenWahl(z, karte);
      for (const k of ZONEN) {
        if (!BEDECKBARE_ZONEN.has(k)) continue;
        if (z[k].bedeckt === true) assert.equal(neu[k].bedeckt, true, `${karte} ${k}: gespeichert bedeckt verloren`);
        if (neu[k].an && !z[k].an && vorher) assert.equal(neu[k].bedeckt, true);
        faelle += 1;
      }
    }
  });
  assert.equal(n, 65536);
  assert.ok(faelle > 1_000_000);
});

test('setzeZonenWahl (R2 selbst): eine ausgeschaltete bedeckbare Zone mit gespeichertem bedeckt behaelt es beim Waehlen jeder Karte, ohne dass der Haken beruehrt wurde', () => {
  ueberAlleStaende((z) => {
    for (const karte of ZONEN_WAHLEN) {
      const neu = setzeZonenWahl(z, karte);
      for (const k of ZONEN) {
        if (!BEDECKBARE_ZONEN.has(k)) continue;
        if (!z[k].an && z[k].bedeckt === true) assert.equal(neu[k].bedeckt, true, `${karte} ${k}`);
      }
    }
  });
});

test('setzeBedeckt (R15): aendert nie ein `an`, nach true sind alle sechs bedeckbaren Zonen bedeckt, nach false keine, auch die ausgeschalteten', () => {
  const n = ueberAlleStaende((z) => {
    const vorher = kopie(z);
    for (const wert of [true, false]) {
      const neu = setzeBedeckt(z, wert);
      for (const k of ZONEN) {
        assert.equal(neu[k].an, z[k].an, `an von ${k}`);
        if (BEDECKBARE_ZONEN.has(k)) assert.equal(neu[k].bedeckt, wert, k);
        else assert.deepEqual(neu[k], z[k], `${k} unberuehrt`);
      }
    }
    assert.deepEqual(z, vorher, 'Eingang unveraendert');
  });
  assert.equal(n, 65536);
});

test('setzeKleidung liefert fuer jeden Stand dasselbe wie setzeBedeckt (eine Rechnung)', () => {
  ueberAlleStaende((z) => {
    assert.deepEqual(setzeKleidung(z, 'auch-bedeckt'), setzeBedeckt(z, true));
    assert.deepEqual(setzeKleidung(z, 'haut'), setzeBedeckt(z, false));
  });
});

// ---------- CSS ohne feste Farben (B3) ----------
const css = readFileSync(path.join(wurzel, 'src/oberflaeche/bausteine/bausteine.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync(path.join(wurzel, 'src/oberflaeche/design/tokens.css'), 'utf8');

test('bausteine.css: keine feste Farbe, keine eigene Schrift, kein Bild, nur var(--v-...) aus tokens.css', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'Hexfarbe');
  assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/, 'Farbfunktion');
  assert.deepEqual(css.match(/(?<![-\w])(white|black|red|green|blue|gray|grey|pink|purple|orange|yellow|silver|navy|teal|maroon|lime|aqua|fuchsia|olive|cyan|magenta|brown|gold|violet)(?![-\w])/gi) ?? [], [], 'Farbname');
  assert.doesNotMatch(css, /url\(|@import|@font-face/, 'Bild, Import oder Schrift');
  for (const m of css.matchAll(/font-family:\s*([^;]+);/g)) assert.match(m[1], /^var\(--v-schrift-(text|display)\)$/, `font-family ${m[1]}`);
  for (const m of css.matchAll(/font:\s*([^;]+);/g)) assert.match(m[1], /var\(--v-schrift-(text|display)\)\s*$/, `font ${m[1]}`);
  const benutzt = new Set([...css.matchAll(/var\((--v-[a-z0-9-]+)/g)].map((m) => m[1]));
  const lokal = new Set(['--v-spalten', '--v-spalten-schmal', '--v-kreis']); // Hilfsgroessen: die ersten zwei setzt bausteine.ts je Gruppe, --v-kreis setzt .v-frage
  assert.ok(benutzt.size > 20);
  for (const t of benutzt) assert.ok(lokal.has(t) || tokens.includes(`${t}:`), `unbekanntes Token ${t}`);
});

test('bausteine.css (R10): keine Sammelregel auf nackte Elemente oder auf Nachkommen von .v-baustein, die Zahl fester px sinkt nicht wieder', () => {
  assert.doesNotMatch(css, /\.v-baustein\s+(:is\(|button|input|select|\*)/, 'Sammelregel trifft fremden Inhalt');
  assert.doesNotMatch(css, /(^|\n)\s*(button|input|select|a|p|div|span)\s*[{,]/, 'nackter Elementselektor');
  const px = css.match(/(?<![\w.-])-?\d*\.?\d+px/g) ?? [];
  assert.ok(px.length <= 59, `feste px-Werte: ${px.length} (vorher 68)`);
});

test('bausteine.css: das Fingerziel kommt aus --v-fingerziel (44 Pixel) und steht bei den bedienbaren Klassen', () => {
  assert.match(tokens, /--v-fingerziel:\s*44px/);
  for (const klasse of ['.v-frage', '.v-schalter-knopf', '.v-stufe', '.v-chip', '.v-wahl-karte', '.v-auswahl .v-auswahl-feld', '.v-regler input[type=\'range\']']) {
    const i = css.search(new RegExp(`${klasse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`));
    assert.ok(i >= 0, klasse);
    const block = css.slice(i, css.indexOf('}', i));
    assert.match(block, /var\(--v-fingerziel\)/, `${klasse} nutzt --v-fingerziel`);
  }
});

// ---------- Kein Content-Script erreicht die Bausteine (B8) ----------
function alleDateien(ordner, aus = []) {
  for (const e of readdirSync(ordner)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = path.join(ordner, e);
    if (statSync(p).isDirectory()) alleDateien(p, aus);
    else if (/\.(ts|mts|js|mjs)$/.test(e)) aus.push(p);
  }
  return aus;
}
function aufloesen(von, spez) {
  let ziel;
  if (spez.startsWith('.')) ziel = path.resolve(path.dirname(von), spez);
  else if (/^[@~]{1,2}\//.test(spez)) ziel = path.join(wurzel, spez.replace(/^[@~]{1,2}\//, ''));
  else return null;
  for (const k of ['', '.ts', '.js', '.mjs', '/index.ts']) if (existsSync(ziel + k) && statSync(ziel + k).isFile()) return ziel + k;
  return null;
}
const importe = (datei) => {
  const q = readFileSync(datei, 'utf8');
  return [...q.matchAll(/(?:\bimport|\bexport)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
};
const BAUSTEINE = path.join(wurzel, 'src/oberflaeche/bausteine') + path.sep;

test('Importverbot: kein Content-Script erreicht ueber Importe die Bausteine', () => {
  const einstiege = alleDateien(path.join(wurzel, 'entrypoints')).filter((d) => readFileSync(d, 'utf8').includes('defineContentScript'));
  assert.ok(einstiege.length >= 2, 'Content-Scripts gefunden');
  const gesehen = new Set();
  const stapel = [...einstiege];
  while (stapel.length) {
    const d = stapel.pop();
    if (gesehen.has(d)) continue;
    gesehen.add(d);
    for (const s of importe(d)) {
      const z = aufloesen(d, s);
      if (z) stapel.push(z);
    }
  }
  assert.ok(gesehen.size > 50, `Graph zu klein: ${gesehen.size}`);
  const treffer = [...gesehen].filter((d) => d.startsWith(BAUSTEINE));
  assert.deepEqual(treffer, [], 'ein Content-Script erreicht die Bausteine');
});

test('Importverbot: die Importwanderung findet einen Treffer, wenn man ihr einen gibt (Gegenprobe des Suchers)', () => {
  // Der Sucher muss funktionieren: von bausteine.ts aus ist kleidung.ts erreichbar, ueber einstieg/zonen.ts auch einstellungen.ts.
  const start = path.join(BAUSTEINE, 'bausteine.ts');
  const gesehen = new Set();
  const stapel = [start];
  while (stapel.length) {
    const d = stapel.pop();
    if (gesehen.has(d)) continue;
    gesehen.add(d);
    for (const s of importe(d)) {
      const z = aufloesen(d, s);
      if (z) stapel.push(z);
    }
  }
  assert.ok(gesehen.has(path.join(BAUSTEINE, 'kleidung.ts')));
  assert.ok(gesehen.has(path.join(wurzel, 'src/einstieg/zonen.ts')));
});

test('Bausteine: kein Zugriff auf Erweiterungs-APIs, kein innerHTML, keine Saetze der Oberflaeche, Importe nur von Einstellungen und Zonenlogik', () => {
  const dateien = alleDateien(BAUSTEINE);
  assert.ok(dateien.length >= 5);
  for (const d of dateien) {
    const q = readFileSync(d, 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(q, /\b(browser|chrome)\.(storage|runtime|tabs)/, d);
    assert.doesNotMatch(q, /innerHTML|insertAdjacentHTML|outerHTML/, d);
    for (const s of importe(d)) {
      if (!s.startsWith('.')) assert.fail(`${d}: fremder Import ${s}`);
      const z = aufloesen(d, s);
      assert.ok(z.startsWith(BAUSTEINE) || z.endsWith('src/einstellungen.ts') || z.endsWith('src/einstieg/zonen.ts'), `${d}: Import ${s} ausserhalb der erlaubten Module`);
    }
  }
});
