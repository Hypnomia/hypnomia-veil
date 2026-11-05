// Einheitstests Mauszeiger (Auftrag K2): reine Logik, ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KLICKPUNKT, ZEIGER_GROESSE, zeigerCss, zeigerSvg, zeigerUrl, zeigerWert } from '../../src/cursor/logik.ts';

test('Zeiger: hoechstens 32 x 32, Kennung je Art, Data-URL ohne Anfuehrungszeichen und Zeilenumbrueche', () => {
  assert.ok(ZEIGER_GROESSE <= 32);
  for (const art of ['spirale', 'herz']) {
    const svg = zeigerSvg(art);
    assert.match(svg, new RegExp(`id='veil-${art}'`));
    assert.match(svg, /width='32' height='32'/);
    assert.ok(!svg.includes('"'));
    const url = zeigerUrl(art);
    assert.ok(url.startsWith('data:image/svg+xml,'));
    assert.ok(!/["\s]/.test(url));
    assert.equal(decodeURIComponent(url.slice('data:image/svg+xml,'.length)), svg);
    assert.match(zeigerWert(art), new RegExp(`^url\\("data:[^"]+"\\) ${KLICKPUNKT} ${KLICKPUNKT}, auto$`));
  }
});

test('Blatt: Zeiger mit !important, Textfelder behalten text, Wurzel-Variante ohne :root', () => {
  const dok = zeigerCss('spirale', false);
  assert.match(dok, /:root:root \* \{ cursor: url\(/);
  assert.match(dok, /cursor: text !important/);
  assert.match(dok, /textarea/);
  assert.match(dok, /contenteditable/);
  assert.ok(!dok.includes('veil-herz'));
  const wurzel = zeigerCss('herz', true);
  assert.ok(!wurzel.includes(':root'));
  assert.ok(decodeURIComponent(wurzel).includes('veil-herz'));
});
