// Einheitstests ohne Browser: Wachfenster des Lageweckers (src/schleier/lagewecker.ts) mit einstellbarer Uhr und eigenem rAF.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lagewecker, WACH_MS, merkeEigenenHost, zaehltMutation } from '../../src/schleier/lagewecker.ts';

// Umgebung zum Steuern: Uhr, rAF-Warteschlange, Beobachter und Horcher mit Zaehlern.
function umgebung() {
  const u = {
    zeit: 0,
    rafs: new Map(),
    naechste: 1,
    verborgenWert: false,
    animation: false,
    beobachter: [],
    horcher: [],
    zustaende: [],
    jetzt: () => u.zeit,
    bild: (fn) => {
      const h = u.naechste++;
      u.rafs.set(h, fn);
      return h;
    },
    bildAb: (h) => u.rafs.delete(h),
    verborgen: () => u.verborgenWert,
    animationLaeuft: () => u.animation,
    beobachte: (wurzel, fn) => {
      const b = { wurzel, fn, aktiv: true };
      u.beobachter.push(b);
      return () => (b.aktiv = false);
    },
    horche: (wurzel, fn) => {
      const h = { wurzel, fn, aktiv: true };
      u.horcher.push(h);
      return () => (h.aktiv = false);
    },
    zustand: (w) => u.zustaende.push(w),
    // Ein Bild: Uhr um 16 ms vor, alle angeforderten rAF-Rueckrufe.
    tick(ms = 16) {
      u.zeit += ms;
      const alle = [...u.rafs.values()];
      u.rafs.clear();
      for (const f of alle) f();
    },
    aktiveBeobachter: () => u.beobachter.filter((b) => b.aktiv),
    aktiveHorcher: () => u.horcher.filter((h) => h.aktiv),
    mutiere: (saetze) => {
      for (const b of u.beobachter) if (b.aktiv) b.fn(saetze);
    },
  };
  return u;
}
function abo() {
  const a = { aufrufe: 0, lebend: true, lebt: () => a.lebend, jeBild: () => a.aufrufe++ };
  return a;
}
const fremd = {};
const attr = (target, attributeName = 'style') => ({ type: 'attributes', target, attributeName });

test('ohne Abonnenten: kein Beobachter, kein Horcher, ein Anlass tut nichts', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  w.anlass();
  assert.equal(u.beobachter.length, 0);
  assert.equal(u.horcher.length, 0);
  assert.equal(u.rafs.size, 0);
  assert.equal(w.wach, false);
});

test('Anlass weckt, je Bild wird der Abonnent gerufen, nach WACH_MS ohne Anlass schlaeft der Wecker und fordert kein rAF mehr', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  const a = abo();
  w.melde(a);
  assert.equal(w.wach, false);
  assert.equal(u.rafs.size, 0, 'ruhig: kein rAF');
  u.mutiere([attr(fremd)]);
  assert.equal(w.wach, true);
  assert.deepEqual(u.zustaende, [true]);
  let bilder = 0;
  while (u.rafs.size && bilder < 100) {
    u.tick();
    bilder++;
  }
  assert.equal(w.wach, false);
  assert.deepEqual(u.zustaende, [true, false]);
  assert.equal(u.rafs.size, 0);
  // 500 ms / 16 ms: 31 Bilder mit Aufruf, im 32. ist das Fenster abgelaufen
  assert.equal(a.aufrufe, Math.ceil(WACH_MS / 16) - 1);
  assert.ok(u.zeit >= WACH_MS && u.zeit < WACH_MS + 20);
});

test('ein neuer Anlass verlaengert das Fenster ab jetzt', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  w.melde(abo());
  w.anlass();
  for (let i = 0; i < 20; i++) u.tick(); // 320 ms
  w.anlass(); // wach bis 820
  for (let i = 0; i < 25; i++) u.tick(); // 720 ms
  assert.equal(w.wach, true);
  for (let i = 0; i < 10; i++) u.tick(); // 880 ms
  assert.equal(w.wach, false);
});

test('laufende Animation am Ende des Fensters haelt weitere WACH_MS wach, danach erneute Pruefung', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  w.melde(abo());
  u.animation = true;
  w.anlass();
  for (let i = 0; i < 60; i++) u.tick(); // 960 ms
  assert.equal(w.wach, true, 'Animation haelt wach');
  u.animation = false;
  for (let i = 0; i < 40; i++) u.tick(); // 1600 ms: das verlaengerte Fenster (bis 1000 + ...) ist abgelaufen
  assert.equal(w.wach, false);
  assert.equal(u.rafs.size, 0);
});

test('verborgener Tab: Anlass weckt nicht, wach werdend verborgen schlaeft sofort', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  w.melde(abo());
  u.verborgenWert = true;
  w.anlass();
  assert.equal(w.wach, false);
  u.verborgenWert = false;
  w.anlass();
  assert.equal(w.wach, true);
  u.verborgenWert = true;
  u.tick();
  assert.equal(w.wach, false);
  assert.equal(u.rafs.size, 0);
});

test('eigene Hosts und eigene Markierungen wecken nicht, fremde Mutationen schon', () => {
  const host = {};
  merkeEigenenHost(host);
  assert.equal(zaehltMutation(attr(host)), false, 'Stil am eigenen Host');
  assert.equal(zaehltMutation(attr(fremd, 'data-veil-lagewecker')), false, 'eigene Markierung');
  assert.equal(zaehltMutation({ type: 'childList', target: fremd, addedNodes: [host], removedNodes: [] }), false, 'eigener Host eingefuegt');
  assert.equal(zaehltMutation({ type: 'childList', target: fremd, addedNodes: [], removedNodes: [host] }), false, 'eigener Host entfernt');
  assert.equal(zaehltMutation({ type: 'childList', target: fremd, addedNodes: [host, {}], removedNodes: [] }), true, 'fremder Knoten mit dabei');
  assert.equal(zaehltMutation(attr(fremd)), true);
  assert.equal(zaehltMutation(attr(fremd, 'class')), true);
  const u = umgebung();
  const w = new Lagewecker(u);
  w.melde(abo());
  u.mutiere([attr(host), attr(host, 'data-veil-standbild')]);
  assert.equal(w.wach, false);
  u.mutiere([attr(host), attr(fremd, 'class')]);
  assert.equal(w.wach, true);
});

test('Schattenwurzeln: gezaehlt mitbeobachtet, beim letzten Abmelden geloest; letzter Abonnent loest alles', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  const wurzel = {};
  const a = abo();
  const b = abo();
  const abA = w.melde(a, [wurzel]);
  const abB = w.melde(b, [wurzel]);
  assert.equal(u.aktiveBeobachter().length, 2, 'Dokument und eine Wurzel');
  assert.equal(u.aktiveHorcher().length, 2);
  w.anlass();
  assert.equal(u.rafs.size, 1);
  abA();
  assert.equal(u.aktiveBeobachter().length, 2, 'Wurzel bleibt, b liegt noch darin');
  abB();
  assert.equal(u.aktiveBeobachter().length, 0);
  assert.equal(u.aktiveHorcher().length, 0);
  assert.equal(u.rafs.size, 0, 'rAF geloest');
  assert.equal(w.wach, false);
  assert.equal(w.abonnenten, 0);
});

test('toter Abonnent (lebt false) faellt heraus; ist keiner mehr da, ist alles geloest', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  const a = abo();
  w.melde(a);
  w.anlass();
  u.tick();
  assert.equal(a.aufrufe, 1);
  a.lebend = false;
  u.tick();
  assert.equal(a.aufrufe, 1);
  assert.equal(w.abonnenten, 0);
  assert.equal(u.aktiveBeobachter().length, 0);
  assert.equal(u.aktiveHorcher().length, 0);
  assert.equal(u.rafs.size, 0);
});

test('Mutation fordert nur ein rAF an und ruft den Abonnenten nicht sofort (keine Messung je Mutation)', () => {
  const u = umgebung();
  const w = new Lagewecker(u);
  const a = abo();
  w.melde(a);
  for (let i = 0; i < 10; i++) u.mutiere([attr(fremd)]);
  assert.equal(a.aufrufe, 0);
  assert.equal(u.rafs.size, 1);
  u.tick();
  assert.equal(a.aufrufe, 1);
});
