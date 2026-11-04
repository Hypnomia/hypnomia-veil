// Einheitstests Titel mit Mias Kommentar (Auftrag T): Kuerzen, stabile Satzwahl, Zusammenbau. Reine Logik, ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashText, istEigenerText, kuerzeTitel, titelMitKommentar, TITEL_MAX } from '../../src/titel/logik.ts';

test('kuerzen: kurze Titel bleiben, Leerraum wird zusammengezogen', () => {
  assert.equal(kuerzeTitel('Short title'), 'Short title');
  assert.equal(kuerzeTitel('  Two\n  lines \t here  '), 'Two lines here');
  assert.equal(kuerzeTitel('x'.repeat(TITEL_MAX)), 'x'.repeat(TITEL_MAX));
});

test('kuerzen: lange Titel enden auf einer Ellipse, hoechstens 60 Zeichen plus Ellipse', () => {
  const lang = 'word '.repeat(40);
  const k = kuerzeTitel(lang);
  assert.ok(k.endsWith('…'));
  assert.ok(Array.from(k).length <= TITEL_MAX + 1);
  assert.ok(!k.includes(' …'), 'kein Leerzeichen vor der Ellipse');
  const x = kuerzeTitel('y'.repeat(200));
  assert.equal(Array.from(x).length, TITEL_MAX + 1);
});

test('kuerzen: zaehlt Zeichen, trennt kein Ersatzpaar', () => {
  const k = kuerzeTitel('😀'.repeat(100));
  assert.equal(Array.from(k).length, TITEL_MAX + 1);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(k), 'kein einzelnes Ersatzzeichen');
});

test('Satzwahl ist stabil: gleicher Titel, gleicher Satz, auch mit anderem Leerraum', () => {
  const saetze = ['A {{title}}', 'B {{title}}', 'C {{title}}', 'D {{title}}'];
  const a = titelMitKommentar('Same title', saetze);
  for (let i = 0; i < 20; i++) assert.equal(titelMitKommentar('Same title', saetze), a);
  assert.equal(titelMitKommentar('  Same \n title ', saetze), a);
  assert.equal(hashText('abc'), hashText('abc'));
});

test('Satzwahl nutzt alle Saetze (verteilt ueber viele Titel)', () => {
  const saetze = ['A {{title}}', 'B {{title}}', 'C {{title}}'];
  const benutzt = new Set();
  for (let i = 0; i < 60; i++) benutzt.add(titelMitKommentar(`Title number ${i}`, saetze)[0]);
  assert.deepEqual([...benutzt].sort(), ['A', 'B', 'C']);
});

test('Zusammenbau: Platzhalter ersetzt, Original gekuerzt, Text bleibt Text', () => {
  assert.equal(titelMitKommentar('Hello', ['Test title: {{title}}']), 'Test title: Hello');
  const lang = titelMitKommentar('z'.repeat(100), ['Test title: {{title}}']);
  assert.equal(lang, `Test title: ${'z'.repeat(TITEL_MAX)}…`);
  assert.equal(titelMitKommentar('<b>bold</b>', ['Say {{title}}']), 'Say <b>bold</b>');
});

test('ohne Saetze oder ohne Titel: nichts', () => {
  assert.equal(titelMitKommentar('Hello', []), null);
  assert.equal(titelMitKommentar('Hello', undefined), null);
  assert.equal(titelMitKommentar('   \n ', ['T {{title}}']), null);
});

test('Schluessel: Text und Attribut desselben Titels bekommen denselben Satz', () => {
  const saetze = ['A {{title}}', 'B {{title}}', 'C {{title}}', 'D {{title}}', 'E {{title}}'];
  for (let i = 0; i < 40; i++) {
    const voll = `Full tooltip title ${i}`;
    const sichtbar = titelMitKommentar('Shortened text', saetze, voll);
    const tooltip = titelMitKommentar(voll, saetze, voll);
    assert.equal(sichtbar[0], tooltip[0]);
  }
});

test('eigener Text: nur Erzeugtes und gekuerzte Fassungen davon, fremde Titel nie', () => {
  const saetze = ['Oh {{title}}!', 'Test title: {{title}}'];
  const erzeugt = new Set([titelMitKommentar('Original card two', [saetze[1]]), titelMitKommentar('Another one', [saetze[0]])]);
  assert.equal(istEigenerText('Test title: Original card two', erzeugt), true);
  assert.equal(istEigenerText('Test title: Original car...', erzeugt), true);
  assert.equal(istEigenerText('Test title: Original car…', erzeugt), true);
  // zu kurze Kurzfassung und fremde Titel
  assert.equal(istEigenerText('Test...', erzeugt), false);
  assert.equal(istEigenerText('Oh my, what a title!', erzeugt), false);
  assert.equal(istEigenerText('Wow, this is great!', erzeugt), false);
  assert.equal(istEigenerText('Test title: Something else entirely...', erzeugt), false);
  assert.equal(istEigenerText('Some video', erzeugt), false);
  assert.equal(istEigenerText('x', undefined), false);
  assert.equal(istEigenerText('x', new Set()), false);
});
