// Einheitstests Auftrag U: wann gilt die Umleitung, wie sieht die Regel aus (src/hintergrund/umleitung.ts, reine Funktionen).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { ERWACHSENEN_LISTE } from '../../src/adapter/liste.ts';
import { UMLEITUNG_REGEL_ID, ausnahmeHosts, baueUmleitungRegel, ersatzAktiv } from '../../src/hintergrund/umleitung.ts';

const GALERIE = 'chrome-extension://abc/galerie.html';
const PACK = { id: 'p', version: '1', titel: 't', freischaltungen: ['erwachsen:ersatz'], bilder: 0, vorschau: 1, chibis: 0, groesse: 1, importiert: 1 };
const an = (teil = {}) => vervollstaendige({ ...STANDARD, ...teil, erwachsen: { ...STANDARD.erwachsen, komplettErsatz: true, ...(teil.erwachsen ?? {}) } });

test('ersatzAktiv: nur mit Pack, Freischaltung, Schalter und ohne Pause', () => {
  assert.equal(ersatzAktiv(an(), PACK), true);
  assert.equal(ersatzAktiv(an(), null), false, 'ohne Pack');
  assert.equal(ersatzAktiv(an(), { ...PACK, freischaltungen: ['erwachsen:vorschau'] }), false, 'ohne Freischaltung');
  assert.equal(ersatzAktiv(vervollstaendige(STANDARD), PACK), false, 'Schalter aus (Standard)');
  assert.equal(ersatzAktiv(an({ pause: true }), PACK), false, 'Pause');
  assert.equal(ersatzAktiv(an({ erwachsen: { an: false } }), PACK), false, 'Pornoseiten-Modus aus');
  assert.equal(ersatzAktiv(an(), { ...PACK, vorschau: 0 }), false, 'keine Vorschau-Bilder im Pack');
});

test('baueUmleitungRegel: keine Regel, solange ersatzAktiv nein sagt', () => {
  assert.equal(baueUmleitungRegel(an({ pause: true }), PACK, GALERIE), null);
  assert.equal(baueUmleitungRegel(an(), null, GALERIE), null);
});

test('baueUmleitungRegel: main_frame, Listen-Domains (eigene Seiten nur in Firefox, Entscheidung 107), Originaladresse roh hinter ziel=', () => {
  const r = baueUmleitungRegel(an({ erwachsen: { eigeneSeiten: ['www.Eigen.example/pfad'] } }), PACK, GALERIE);
  assert.equal(r.id, UMLEITUNG_REGEL_ID);
  assert.equal(r.action.type, 'redirect');
  assert.equal(r.action.redirect.regexSubstitution, `${GALERIE}?ziel=\\1`);
  assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
  assert.equal(r.condition.regexFilter, '^(https?://.*)$');
  const alle = ERWACHSENEN_LISTE.flatMap((e) => e.domains);
  for (const d of alle) assert.ok(r.condition.requestDomains.includes(d), d);
  // Node rechnet wie Chrome: eigene Seiten bis Session 8 nicht in der Regel (Entscheidung 107).
  assert.ok(!r.condition.requestDomains.includes('eigen.example'));
  assert.equal(r.condition.excludedRequestDomains, undefined);
});

test('Ausnahmen: nur reine Hosts, Muster mit Pfad und Ungueltiges zaehlen nicht', () => {
  assert.deepEqual(ausnahmeHosts(['PayPal.com', 'amazon.de/gp/buy', 'kein host', '*.x.de', 'paypal.com']).sort(), ['paypal.com']);
  const r = baueUmleitungRegel(an({ ausnahmen: ['xvideos.com', 'amazon.de/gp/buy'] }), PACK, GALERIE);
  assert.deepEqual(r.condition.excludedRequestDomains, ['xvideos.com']);
  assert.deepEqual(ausnahmeHosts(['www.xvideos.com', 'xvideos.com']), ['xvideos.com'], 'fuehrendes www. faellt weg');
});

test('Node-Lauf ohne Testhaken-Konstante: die Testdomain steht nicht in der Regel (der Release-Bau selbst wird in scripts/test-all.mjs geprueft)', () => {
  const r = baueUmleitungRegel(an(), PACK, GALERIE);
  assert.ok(!r.condition.requestDomains.some((d) => d.includes('veil-erwachsen')));
});
