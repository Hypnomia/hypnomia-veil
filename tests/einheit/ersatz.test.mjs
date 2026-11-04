// Einheitstests Auftrag G: wann gilt der Komplett-Ersatz (src/ersatz/bedingung.ts), Blitz-Zaehler, Aufraeumen der alten Regel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { WechselZaehler, ersatzAktiv, ersatzGilt, frueherKandidat } from '../../src/ersatz/bedingung.ts';
import { UMLEITUNG_REGEL_ID, entferneAlteUmleitungRegel } from '../../src/hintergrund/umleitung.ts';

const PACK = { id: 'p', version: '1', titel: 't', freischaltungen: ['erwachsen:ersatz'], bilder: 0, vorschau: 1, chibis: 0, groesse: 1, importiert: 1 };
const an = (teil = {}) => vervollstaendige({ ...STANDARD, ...teil, erwachsen: { ...STANDARD.erwachsen, komplettErsatz: true, ...(teil.erwachsen ?? {}) } });
const adr = (u) => {
  const url = new URL(u);
  return { href: url.href, hostname: url.hostname, pathname: url.pathname };
};

test('ersatzAktiv: nur mit Pack, Freischaltung, Schalter und ohne Pause', () => {
  assert.equal(ersatzAktiv(an(), PACK), true);
  assert.equal(ersatzAktiv(an(), null), false);
  assert.equal(ersatzAktiv(an(), { ...PACK, freischaltungen: ['erwachsen:vorschau'] }), false);
  assert.equal(ersatzAktiv(vervollstaendige(STANDARD), PACK), false);
  assert.equal(ersatzAktiv(an({ pause: true }), PACK), false);
  assert.equal(ersatzAktiv(an({ erwachsen: { an: false } }), PACK), false);
  assert.equal(ersatzAktiv(an(), { ...PACK, vorschau: 0 }), false);
});

test('ersatzGilt: Liste und eigene Seiten ja, andere Seiten nie, eigene Ausnahme nein', () => {
  assert.equal(ersatzGilt(an(), PACK, adr('https://www.pornhub.com/video?a=1')), true);
  assert.equal(ersatzGilt(an(), PACK, adr('https://example.org/')), false, 'unbekannte Seite');
  assert.equal(ersatzGilt(an({ erwachsen: { erkennenAmInhalt: true } }), PACK, adr('https://example.org/')), false, 'am Inhalt erkannt zaehlt nie');
  assert.equal(ersatzGilt(an({ erwachsen: { eigeneSeiten: ['eigen.example'] } }), PACK, adr('https://eigen.example/x')), true, 'eigene Seite');
  assert.equal(ersatzGilt(an({ ausnahmen: ['pornhub.com'] }), PACK, adr('https://www.pornhub.com/')), false, 'Ausnahme');
  assert.equal(ersatzGilt(an({ ausnahmen: ['pornhub.com/nur-dieser-pfad'] }), PACK, adr('https://www.pornhub.com/')), true, 'Ausnahme mit anderem Pfad');
  assert.equal(ersatzGilt(an({ pause: true }), PACK, adr('https://www.pornhub.com/')), false, 'Pause');
});

test('frueherKandidat: nur Listenadressen, eigene Seiten erst nach dem Laden', () => {
  assert.equal(frueherKandidat('https://xvideos.com/'), true);
  assert.equal(frueherKandidat('https://eigen.example/'), false);
});

test('WechselZaehler: Verschwinden zaehlt, Erscheinen wartet, nie mehr als 3 Wechsel je Sekunde', () => {
  let t = 0;
  const z = new WechselZaehler(() => t);
  assert.equal(z.erscheinenIn(), 0);
  z.merke(); // Erscheinen
  assert.equal(z.erscheinenIn(), 0);
  t = 100;
  z.merke(); // Verschwinden
  t = 200;
  assert.ok(z.erscheinenIn() > 1000, 'neues Erscheinen wartet bis zum Ende des Fensters');
  t = 1500;
  assert.equal(z.erscheinenIn(), 0);
  // Folge von Wechseln im Takt der Wartezeit: nie mehr als 3 in einer Sekunde
  const zeiten = [];
  t = 0;
  const z2 = new WechselZaehler(() => t);
  for (let i = 0; i < 20; i++) {
    t += z2.erscheinenIn();
    z2.merke();
    zeiten.push(t);
    t += 10;
    z2.merke();
    zeiten.push(t);
    t += 10;
  }
  for (const a of zeiten) assert.ok(zeiten.filter((b) => b >= a && b < a + 1000).length <= 3);
});

test('entferneAlteUmleitungRegel: entfernt eine stehende Regel, sonst nichts, Fehler brechen nicht ab', async () => {
  let entfernt = [];
  const mit = (ids) => ({
    getDynamicRules: async () => ids.map((id) => ({ id })),
    updateDynamicRules: async (o) => void entfernt.push(...o.removeRuleIds),
  });
  assert.equal(await entferneAlteUmleitungRegel(mit([UMLEITUNG_REGEL_ID])), true);
  assert.deepEqual(entfernt, [UMLEITUNG_REGEL_ID]);
  entfernt = [];
  assert.equal(await entferneAlteUmleitungRegel(mit([7])), false);
  assert.deepEqual(entfernt, []);
  assert.equal(await entferneAlteUmleitungRegel({ getDynamicRules: async () => { throw new Error('x'); }, updateDynamicRules: async () => {} }), false);
});
