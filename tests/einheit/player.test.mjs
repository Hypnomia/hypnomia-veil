// Einheitstest Player-Riegel (Auftrag P): reine Teile in src/player/logik.ts, ohne Browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istGesteFuer, istListenPfad, istGeloest, quellSchluessel, quelleVon, vollbildBetrifft, waehleGroessten, willSpielen } from '../../src/player/logik.ts';

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

test('Listenseite: Startseite, Suche, Kategorien; Videoseiten nicht', () => {
  for (const p of ['/', '', '/search/mia', '/de/search', '/s/mia/', '/categories', '/category/x', '/video', '/video/search', '/new', '/models', '/models/', '/channels', '/de/pornstar', '/pornstars', '/tags/x', '/hot'])
    assert.equal(istListenPfad(p), true, p);
  for (const p of ['/view_video.php', '/video12345/titel', '/videos/titel-123', '/video/12345', '/5abc/video/titel', '/erwachsen-player.html', '/newcomer', '/watch/1', '/model/name/video/123', '/channels/x/videos/9', '/pornstar/x', '/models/abc'])
    assert.equal(istListenPfad(p), false, p);
});

test('Geste: frisch und ueber dem Video, oder eine Taste', () => {
  const r = [{ left: 0, top: 0, right: 100, bottom: 100 }];
  const zeigen = { t: 1000, taste: false, x: 50, y: 50 };
  assert.equal(istGesteFuer(null, 1100, r), false);
  assert.equal(istGesteFuer(zeigen, 1100, r), true);
  assert.equal(istGesteFuer(zeigen, 2600, r), false); // zu alt
  assert.equal(istGesteFuer({ ...zeigen, x: 500 }, 1100, r), false); // daneben
  assert.equal(istGesteFuer({ t: 1000, taste: true, x: 0, y: 0 }, 1100, r), true);
  assert.equal(istGesteFuer({ t: 1000, taste: true, x: 0, y: 0 }, 2600, r), false);
});
