// Einheitstest Player-Riegel (Auftrag P): reine Teile in src/player/logik.ts, ohne Browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istGeloest, quellSchluessel, quelleVon, vollbildBetrifft, waehleGroessten, willSpielen } from '../../src/player/logik.ts';

test('Hauptvideo: groesstes ab 200 x 150, kleinere nie', () => {
  assert.equal(waehleGroessten([]), null);
  assert.equal(waehleGroessten([{ el: 'a', breite: 199, hoehe: 400 }, { el: 'b', breite: 400, hoehe: 149 }]), null);
  assert.equal(waehleGroessten([{ el: 'a', breite: 200, hoehe: 150 }, { el: 'b', breite: 640, hoehe: 360 }, { el: 'c', breite: 300, hoehe: 200 }]), 'b');
  assert.equal(waehleGroessten([{ el: 'a', breite: 300, hoehe: 200 }, { el: 'b', breite: 300, hoehe: 200 }]), 'a');
});

test('Quelle: gesetztes src zaehlt sofort, sonst currentSrc', () => {
  const mit = (attr, src, cur) => ({ getAttribute: (n) => (n === 'src' ? attr : null), src, currentSrc: cur });
  assert.equal(quelleVon(mit('x', 'http://h/x', 'http://h/alt')), 'http://h/x');
  assert.equal(quelleVon(mit(null, '', 'http://h/kind')), 'http://h/kind');
  assert.equal(quelleVon(mit(null, '', '')), '');
});

test('geloest nur bei gleicher Quelle', () => {
  assert.equal(istGeloest(undefined, 'a'), false);
  assert.equal(istGeloest('a', 'a'), true);
  assert.equal(istGeloest('a', 'b'), false);
});

test('Wille zum Abspielen', () => {
  assert.equal(willSpielen({ paused: false, ended: false, autoplay: false, currentTime: 3 }), true);
  assert.equal(willSpielen({ paused: true, ended: false, autoplay: true, currentTime: 0 }), true);
  assert.equal(willSpielen({ paused: true, ended: false, autoplay: true, currentTime: 4 }), false);
  assert.equal(willSpielen({ paused: true, ended: false, autoplay: false, currentTime: 0 }), false);
  assert.equal(willSpielen({ paused: false, ended: true, autoplay: true, currentTime: 0 }), false);
});

test('Vollbild betrifft das Video selbst, einen Behaelter oder ein Kind', () => {
  const baum = (kinder = []) => ({ kinder, contains(n) { return this.kinder.includes(n); } });
  const v = baum();
  const behaelter = baum([v]);
  const fremd = baum();
  assert.equal(vollbildBetrifft(v, v), true);
  assert.equal(vollbildBetrifft(behaelter, v), true);
  assert.equal(vollbildBetrifft(fremd, v), false);
  assert.equal(vollbildBetrifft(null, v), false);
  const kind = baum();
  assert.equal(vollbildBetrifft(kind, baum([kind])), true);
});

test('blob:-Quellen gelten als dieselbe Quelle, andere Adressen nicht', () => {
  assert.equal(quellSchluessel('blob:http://h/aaa'), quellSchluessel('blob:http://h/bbb'));
  assert.equal(istGeloest('blob:http://h/aaa', 'blob:http://h/bbb'), true);
  assert.equal(istGeloest('blob:http://h/aaa', 'http://h/film.mp4'), false);
  assert.equal(istGeloest('http://h/film.mp4', 'blob:http://h/aaa'), false);
  assert.equal(istGeloest('http://h/a.mp4', 'http://h/b.mp4'), false);
  assert.equal(istGeloest('http://h/a.mp4', 'http://h/a.mp4'), true);
  assert.equal(istGeloest('obj:1', 'obj:2'), false);
});
