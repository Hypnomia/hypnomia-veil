// Einheitstest ohne Browser: die Versteck-Regel des Hakens in der Seitenwelt (entrypoints/wurzel-haken.content.ts) muss dieselben Elemente treffen
// wie die Regel des Dokuments (entrypoints/content/style.css). Der Haken kennt nur keine Ausnahme fuer html[data-veil-seite], die es in Wurzeln nicht gibt.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const hier = new URL('.', import.meta.url);
const css = readFileSync(new URL('../../entrypoints/content/style.css', hier), 'utf8');
const haken = readFileSync(new URL('../../entrypoints/wurzel-haken.content.ts', hier), 'utf8');

const AUSNAHME = ', :root[data-veil-seite="aus"] *';

// Die erste Regel mit opacity: 0 in style.css (ohne Kommentare).
function dokumentRegel() {
  const ohne = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const treffer = /(:is\([^{]*\)[^{]*)\{\s*opacity:\s*0\s*!important;\s*\}/.exec(ohne);
  assert.ok(treffer, 'Versteck-Regel in style.css nicht gefunden');
  return treffer[1].trim();
}

function hakenRegel() {
  const treffer = /const REGEL =\s*'([^']*)'/.exec(haken) ?? /const REGEL =\s*"([^"]*)"/.exec(haken);
  assert.ok(treffer, 'REGEL im Haken nicht gefunden');
  const regel = treffer[1];
  const auswahl = /^(.*?)\s*\{\s*opacity:\s*0\s*!important;\s*\}\s*$/.exec(regel);
  assert.ok(auswahl, 'REGEL im Haken hat nicht die Form "Auswahl { opacity: 0 !important; }"');
  return auswahl[1].trim();
}

test('Haken-Regel: dieselbe Auswahl wie die Dokument-Regel, nur ohne die Ausnahme fuer html[data-veil-seite]', () => {
  const doku = dokumentRegel();
  assert.ok(doku.includes(AUSNAHME), 'style.css: Ausnahme fuer html[data-veil-seite] fehlt');
  assert.equal(hakenRegel(), doku.replace(AUSNAHME, ''));
});

test('Haken-Regel: nennt alle vier Kandidaten und die drei Urteile', () => {
  const regel = hakenRegel();
  for (const teil of ['img', 'video', 'canvas', '[style*="background" i][style*="url(" i]', '[data-veil="frei"]', '[data-veil="zensiert"]', '[data-veil="verdeckt"]']) {
    assert.ok(regel.includes(teil), `fehlt: ${teil}`);
  }
});

test('Lebenszeichen: style.css setzt --veil-lebt auf dem Wurzelelement, der Haken liest dieselbe Eigenschaft', () => {
  assert.match(css, /html\s*\{\s*--veil-lebt:\s*1;\s*\}/);
  assert.ok(haken.includes("'--veil-lebt'"));
});
