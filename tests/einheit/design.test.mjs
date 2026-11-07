// Einheitstests Gestaltungs-System (Phase 8b): tokens.css passt zu werte.ts, Kontraste, Schriftdateien, Logos.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { erzeugeTokensCss } from '../../scripts/design/tokens.mjs';
import { AKZENT_STUFEN, FARBEN, SCHRIFTEN, WERTE } from '../../src/oberflaeche/design/werte.ts';
import { LOGOS } from '../../src/oberflaeche/design/logos.ts';

const wurzel = new URL('../../', import.meta.url);

function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function kontrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('tokens.css ist aus werte.ts erzeugt (node --experimental-strip-types scripts/design/tokens.mjs)', () => {
  const datei = readFileSync(new URL('src/oberflaeche/design/tokens.css', wurzel), 'utf8');
  assert.equal(datei, erzeugeTokensCss());
});

test('Kontraste: Textfarben auf hellen Gruenden mindestens 4,5:1', () => {
  const gruende = [FARBEN.weiss, FARBEN['rosa-50'], FARBEN['rosa-100'], FARBEN['lav-100'], FARBEN['pfirsich-100']];
  for (const t of ['text', 'leise', 'rosa-700', 'rosa-800', 'lav-700', 'fehler', 'ok']) {
    for (const g of gruende) assert.ok(kontrast(FARBEN[t], g) >= 4.5, `${t} auf ${g}: ${kontrast(FARBEN[t], g).toFixed(2)}`);
  }
});

test('Kontraste: weisse Schrift auf jeder Stufe des Akzent-Verlaufs und auf dem Etikett der Werbung mindestens 4,5:1', () => {
  for (const s of AKZENT_STUFEN) assert.ok(kontrast('#ffffff', s) >= 4.5, `${s}: ${kontrast('#ffffff', s).toFixed(2)}`);
  assert.ok(kontrast('#ffffff', FARBEN.etikett) >= 7, 'Etikett');
});

test('Kontraste: Raender, Fokusring und Schalterbahn mindestens 3:1 gegen Weiss', () => {
  for (const t of ['rand', 'lav-500']) assert.ok(kontrast(FARBEN[t], FARBEN.weiss) >= 3, t);
});

test('Schriften: Dateien vorhanden, woff2, zusammen unter 300 KB, Lizenz liegt bei', () => {
  let summe = 0;
  for (const s of SCHRIFTEN) {
    const p = new URL(`public/${s.datei}`, wurzel);
    assert.ok(existsSync(p), s.datei);
    const kopf = readFileSync(p).subarray(0, 4).toString('latin1');
    assert.equal(kopf, 'wOF2', s.datei);
    summe += statSync(p).size;
  }
  assert.ok(summe < 300_000, `Schriften zusammen ${summe} Bytes`);
  for (const l of ['OFL-nunito.txt', 'OFL-m-plus-rounded-1c.txt']) assert.ok(existsSync(new URL(`public/schrift/${l}`, wurzel)), l);
});

test('Werte: keine Variable doppelt, Schriftfamilien mit Systemrueckfall', () => {
  assert.equal(new Set(Object.keys(WERTE)).size, Object.keys(WERTE).length);
  assert.match(WERTE['schrift-display'], /^'VEIL Rounded'.*system-ui/);
  assert.match(WERTE['schrift-text'], /^'VEIL Text'.*system-ui/);
});

test('Logos: sechs Plattformen, Farben als Hex, Pfade ohne Skript oder Fremdadresse', () => {
  assert.deepEqual(Object.keys(LOGOS).sort(), ['discord', 'itch', 'patreon', 'subscribestar', 'x', 'youtube']);
  for (const [name, l] of Object.entries(LOGOS)) {
    assert.match(l.farbe, /^#[0-9a-f]{6}$/i, name);
    for (const f of l.formen) assert.match(f.d, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,\-]+$/, `${name}: nur Pfadbefehle`);
  }
});
