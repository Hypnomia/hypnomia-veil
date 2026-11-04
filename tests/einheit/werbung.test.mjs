// Einheitstests Werbe-Tausch (Auftrag W): Format-Abgleich, Werbe-Merkmale, Kennzeichnung, stabile Wahl. Reine Logik, ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import links from '../../data/links.json' with { type: 'json' };
import { formatFuer, hatKennung, istKennzeichnung, istWerbeAdresse, istWerbeHost, kennzeichnungFuer, linkFuer, passtWerbeName, LINK_NAMEN, STANDARD_KENNZEICHNUNG } from '../../src/werbung/logik.ts';

test('Format: genaue Masse und 10 % Toleranz', () => {
  assert.equal(formatFuer(300, 250), '300x250');
  assert.equal(formatFuer(728, 90), '728x90');
  assert.equal(formatFuer(320, 50), '320x50');
  assert.equal(formatFuer(320, 100), '320x100');
  assert.equal(formatFuer(330, 225), '300x250'); // +10 % Breite, -10 % Hoehe
  assert.equal(formatFuer(331, 250), null); // knapp ausserhalb: 10 % von 300 sind 30
  assert.equal(formatFuer(300, 276), null);
});

test('Format: kleine Formate haben mindestens 4 px Spielraum', () => {
  assert.equal(formatFuer(728, 94), '728x90'); // 10 % von 90 sind 9
  assert.equal(formatFuer(320, 54), '320x50'); // 10 % von 50 sind 5
  assert.equal(formatFuer(0, 0), null);
  assert.equal(formatFuer(NaN, 250), null);
  assert.equal(formatFuer(500, 400), null);
});

test('Format: Nachbarformate verwechseln sich nicht', () => {
  assert.equal(formatFuer(336, 280), '336x280');
  assert.equal(formatFuer(300, 600), '300x600');
  assert.equal(formatFuer(160, 600), '160x600');
  assert.equal(formatFuer(970, 250), '970x250');
});

test('Werbe-Host: Subdomains zaehlen, Teilwoerter nicht', () => {
  assert.ok(istWerbeHost('doubleclick.net'));
  assert.ok(istWerbeHost('g.doubleclick.net'));
  assert.ok(istWerbeHost('TPC.GoogleSyndication.com'));
  assert.ok(!istWerbeHost('notdoubleclick.net'));
  assert.ok(!istWerbeHost('example.com'));
  assert.ok(!istWerbeHost(''));
  assert.ok(istWerbeAdresse('https://ads.exoclick.com/x', 'https://seite.example/'));
  assert.ok(istWerbeAdresse('//x.criteo.com/a', 'https://seite.example/'));
  assert.ok(!istWerbeAdresse('/lokal/ad.html', 'https://seite.example/'));
  assert.ok(!istWerbeAdresse('javascript:alert(1)'));
  assert.ok(!istWerbeAdresse(null));
});

test('Iframe-Namen: Muster ja, harmlose Namen nein', () => {
  assert.ok(passtWerbeName('google_ads_iframe_/123/slot_0'));
  assert.ok(passtWerbeName('aswift_2'));
  assert.ok(!passtWerbeName('header'));
  assert.ok(!passtWerbeName('shadow-frame'));
  for (const n of ['frameadmin', 'iframe-address', 'frame_advanced', 'adframework', 'iframe-ad-dress', 'broadband-frame', 'gpt-adventure']) assert.ok(!passtWerbeName(n), n);
  assert.ok(passtWerbeName('ad-iframe-3'));
  assert.ok(passtWerbeName('iframe_ad'));
  assert.ok(passtWerbeName('advert-frame'));
  assert.ok(!passtWerbeName(null));
});

test('Kennung: ganzes Token, nie Teilwort', () => {
  const nein = () => false;
  assert.ok(hatKennung('foo adsbygoogle bar', null, nein));
  assert.ok(hatKennung('Ad-Slot', null, nein));
  assert.ok(hatKennung(null, 'div-gpt-ad-1234-0', nein));
  assert.ok(hatKennung(null, null, (a) => a === 'data-ad-slot'));
  assert.ok(hatKennung(null, null, (a) => a === 'data-google-query-id'));
  for (const k of ['header', 'shadow', 'load', 'ad-less', 'padding', 'loader', 'headline']) assert.ok(!hatKennung(k, k, nein), k);
  assert.ok(!hatKennung('', '', nein));
});

test('Kennzeichnung: kurzer Text genau gleich, Schreibweise egal', () => {
  for (const t of ['Ad', 'ads', ' Advertisement ', 'SPONSORED', 'Promoted', 'Anzeige', 'Werbung', 'Gesponsert', 'Publicité', 'Annonce', 'Pubblicità', 'Publicidad']) assert.ok(istKennzeichnung(t), t);
  for (const t of ['Add', 'Ad blocker', 'Sponsored by Foo Bar Baz Qux', '', '   ', 'Header']) assert.ok(!istKennzeichnung(t), t);
  assert.ok(!istKennzeichnung(undefined));
  assert.ok(!istKennzeichnung('Ad' + ' '.repeat(60)), 'sehr langer Text wird gar nicht erst bearbeitet');
});

test('Link: stabil je Flaeche, nur aus links.json, alle fuenf kommen vor', () => {
  const gesehen = new Set();
  for (let i = 0; i < 200; i++) {
    const a = linkFuer(`x#${i}`);
    assert.equal(linkFuer(`x#${i}`).url, a.url);
    assert.ok(LINK_NAMEN.includes(a.name));
    assert.equal(a.url, links[a.name]);
    gesehen.add(a.name);
  }
  assert.equal(gesehen.size, 5);
});

test('Kennzeichnung der Flaeche: stabil, aus dem Pack, sonst eingebaut', () => {
  assert.equal(kennzeichnungFuer(undefined, 'a'), STANDARD_KENNZEICHNUNG);
  assert.equal(kennzeichnungFuer([], 'a'), STANDARD_KENNZEICHNUNG);
  const s = ['Eins by Mia', 'Zwei by Mia', 'Drei by Mia'];
  for (let i = 0; i < 20; i++) assert.equal(kennzeichnungFuer(s, `k${i}`), kennzeichnungFuer(s, `k${i}`));
  assert.equal(new Set(Array.from({ length: 60 }, (_, i) => kennzeichnungFuer(s, `k${i}`))).size, 3);
  assert.ok(!STANDARD_KENNZEICHNUNG.includes('–') && !STANDARD_KENNZEICHNUNG.includes('—'));
});
