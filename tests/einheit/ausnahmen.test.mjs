// Einheitstests ohne Browser: Ausnahmeliste (scripts/ausnahmen-muster.mjs), Quelle fuer Manifest und Laufzeit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { manifestMuster, musterAusListe, passtAusnahme, zerlegeMuster } from '../../scripts/ausnahmen-muster.mjs';

test('zerlegeMuster: Host und optionaler Pfad, klein geschrieben', () => {
  assert.deepEqual(zerlegeMuster('paypal.com'), { host: 'paypal.com', pfad: '' });
  assert.deepEqual(zerlegeMuster('  PayPal.com  '), { host: 'paypal.com', pfad: '' });
  assert.deepEqual(zerlegeMuster('amazon.de/gp/buy'), { host: 'amazon.de', pfad: '/gp/buy' });
  assert.deepEqual(zerlegeMuster('amazon.de/'), { host: 'amazon.de', pfad: '' });
  assert.deepEqual(zerlegeMuster('localhost'), { host: 'localhost', pfad: '' });
});

test('zerlegeMuster: ungueltige Muster ergeben null', () => {
  for (const schlecht of ['', ' ', 'https://paypal.com', '*.paypal.com', 'paypal.com:8080', '-paypal.com', 'pay pal.com', 'a..de', null, undefined, 42, {}]) {
    assert.equal(zerlegeMuster(schlecht), null, String(schlecht));
  }
});

test('musterAusListe: Strings und Objekte, ungueltige Eintraege fallen weg', () => {
  const liste = {
    gruppen: [
      { name: 'a', muster: ['Sparkasse.de', { muster: 'volksbank.de', unsicher: true }, 'kaputt/!', 7] },
      { name: 'b', muster: ['amazon.de/gp/buy'] },
      { name: 'ohne' },
    ],
  };
  assert.deepEqual(musterAusListe(liste), ['sparkasse.de', 'volksbank.de', 'amazon.de/gp/buy']);
  assert.deepEqual(musterAusListe(null), []);
  assert.deepEqual(musterAusListe({}), []);
});

test('manifestMuster: Host und alle Subdomains, mit Pfad-Praefix', () => {
  assert.deepEqual(manifestMuster(['paypal.com']), ['*://paypal.com/*', '*://*.paypal.com/*']);
  assert.deepEqual(manifestMuster(['amazon.de/gp/buy']), ['*://amazon.de/gp/buy*', '*://*.amazon.de/gp/buy*']);
  // Doppelte und ungueltige Muster erzeugen nichts Doppeltes oder Kaputtes.
  assert.deepEqual(manifestMuster(['paypal.com', 'PayPal.com', '???']), ['*://paypal.com/*', '*://*.paypal.com/*']);
  assert.deepEqual(manifestMuster([]), []);
});

test('passtAusnahme: Host, Subdomain, Gross und Klein', () => {
  const m = ['paypal.com'];
  assert.equal(passtAusnahme({ hostname: 'paypal.com', pathname: '/' }, m), true);
  assert.equal(passtAusnahme({ hostname: 'www.paypal.com', pathname: '/de/home' }, m), true);
  assert.equal(passtAusnahme({ hostname: 'WWW.PayPal.COM', pathname: '/' }, m), true);
  // Aehnlicher Name oder Suffix ohne Punkt zaehlt nicht.
  assert.equal(passtAusnahme({ hostname: 'evilpaypal.com', pathname: '/' }, m), false);
  assert.equal(passtAusnahme({ hostname: 'paypal.com.evil.test', pathname: '/' }, m), false);
  assert.equal(passtAusnahme({ hostname: 'example.com', pathname: '/paypal.com' }, m), false);
});

test('passtAusnahme: Pfad-Praefix gilt nur fuer den Pfad', () => {
  const m = ['amazon.de/gp/buy'];
  assert.equal(passtAusnahme({ hostname: 'www.amazon.de', pathname: '/gp/buy/spc/handlers' }, m), true);
  assert.equal(passtAusnahme({ hostname: 'amazon.de', pathname: '/GP/Buy' }, m), true);
  assert.equal(passtAusnahme({ hostname: 'amazon.de', pathname: '/gp/product/123' }, m), false);
  assert.equal(passtAusnahme({ hostname: 'amazon.de', pathname: '/' }, m), false);
});

test('passtAusnahme: leere oder fehlende Eingaben passen nie', () => {
  assert.equal(passtAusnahme({ hostname: '', pathname: '/' }, ['paypal.com']), false);
  assert.equal(passtAusnahme(null, ['paypal.com']), false);
  assert.equal(passtAusnahme({ hostname: 'paypal.com', pathname: '/' }, []), false);
  assert.equal(passtAusnahme({ hostname: 'paypal.com', pathname: '/' }, null), false);
  assert.equal(passtAusnahme({ hostname: 'paypal.com', pathname: '/' }, ['kaputt!']), false);
  // Ohne Pfad zaehlt die Wurzel.
  assert.equal(passtAusnahme({ hostname: 'paypal.com' }, ['paypal.com']), true);
});

test('Standardliste: alle Muster gueltig, Manifest-Muster sind Match Patterns, jedes Muster greift auf seiner Seite', () => {
  const liste = JSON.parse(readFileSync(new URL('../../data/ausnahmen-standard.json', import.meta.url), 'utf8'));
  const roh = liste.gruppen.flatMap((g) => g.muster.map((e) => (typeof e === 'string' ? e : e.muster)));
  const muster = musterAusListe(liste);
  assert.ok(muster.length > 0);
  assert.equal(muster.length, roh.length, 'jedes Muster der Standardliste muss gueltig sein');
  const manifest = manifestMuster(muster);
  assert.ok(manifest.length >= muster.length);
  for (const mm of manifest) assert.match(mm, /^\*:\/\/(\*\.)?[a-z0-9.-]+\/.*$/, mm);
  for (const m of muster) {
    const z = zerlegeMuster(m);
    assert.equal(passtAusnahme({ hostname: z.host, pathname: `${z.pfad}/x` }, [m]), true, m);
    assert.equal(passtAusnahme({ hostname: `sub.${z.host}`, pathname: `${z.pfad}/x` }, [m]), true, m);
  }
});
