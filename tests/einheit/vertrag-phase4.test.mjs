// Einheitstests fuer den Vertragsschritt Phase 4 (PHASE-4-BAUPLAN Abschnitte 2, 8 Punkt 5 und 11, 9): Pack-Rollen und Freischaltungen,
// Schema von Quiz-Bank und Saetzen, Einstellungen, Steigerung (reine Funktionen), Seitenliste.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruefePack, quelleAusBytes, schreibePack } from '../../src/pack/format.ts';
import { BENOETIGT, FREISCHALTUNGEN, ROLLEN } from '../../src/pack/vertrag.ts';
import { fuelleSatz, pruefeQuizBank, pruefeTexte, sichererText } from '../../src/quiz/vertrag.ts';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { ABBAU_MS, anzeigeStufe, vervollstaendigeStand, wirksameStufe, wirksameZonen, STAND_START } from '../../src/steigerung.ts';
import { alleDomains, hostAus, istErwachsenenseite, seiteFuer } from '../../src/adapter/liste.ts';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';
import { DUMMY_QUIZ, DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';

const kodiere = (t) => new TextEncoder().encode(t);
const VERSION = '0.4.0';

test('Dummy-Pack: alle Phase-4-Freischaltungen, Rollen gezaehlt', async () => {
  const { bytes, vorschau, chibis } = await baueDummyPack();
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.deepEqual([...p.manifest.freischaltungen].sort(), [...FREISCHALTUNGEN].sort());
  assert.equal(p.rollen.vorschau, vorschau);
  assert.equal(p.rollen.chibi, chibis);
  assert.equal(p.rollen.quiz, 1);
  assert.equal(p.rollen.texte, 1);
  assert.ok(pruefeQuizBank(p.json.quiz));
  assert.ok(pruefeTexte(p.json.texte));
});

test('Dummy-Pack ohne Phase 4: nur stil:mia-patch', async () => {
  const { bytes } = await baueDummyPack({ ohnePhase4: true });
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.deepEqual(p.manifest.freischaltungen, ['stil:mia-patch']);
});

const LIZENZ = { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Lizenz'), rolle: 'lizenz' };
const kopf = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', erstellt: 'x', mindestVeil: '0.4.0', freischaltungen });

test('Freischaltung ohne Datei faellt weg, ohne Dateibedarf bleibt', async () => {
  const bytes = await schreibePack(kopf(['erwachsen:quiz', 'erwachsen:vorschau', 'zensur:steigerung', 'stil:mia-patch', 'gibts:nicht']), [LIZENZ]);
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.deepEqual(p.manifest.freischaltungen, ['zensur:steigerung']);
});

test('Kaputtes Quiz-JSON: Pack bleibt, Quiz-Freischaltungen fallen weg', async () => {
  const bytes = await schreibePack(kopf(['erwachsen:quiz', 'quiz:freilegen', 'zensur:steigerung']), [
    LIZENZ,
    { name: 'quiz.json', typ: 'application/json', daten: kodiere('{kaputt'), rolle: 'quiz' },
  ]);
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.deepEqual(p.manifest.freischaltungen, ['zensur:steigerung']);
  assert.equal(p.rollen.quiz, 0);
});

test('Unbekannte Rolle wird verworfen, nicht abgelehnt', async () => {
  const bytes = await schreibePack(kopf([]), [LIZENZ, { name: 'x.json', typ: 'application/json', daten: kodiere('{}'), rolle: 'ton' }]);
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.equal(p.manifest.dateien.find((d) => d.name === 'x.json').rolle, undefined);
});

test('Quiz zweimal: abgelehnt; Quiz als Text: abgelehnt', async () => {
  const q = (name) => ({ name, typ: 'application/json', daten: kodiere('{}'), rolle: 'quiz' });
  await assert.rejects(pruefePack(quelleAusBytes(await schreibePack(kopf([]), [LIZENZ, q('a.json'), q('b.json')])), VERSION), /rolle/);
  const text = { name: 'q.txt', typ: 'text/plain', daten: kodiere('{}'), rolle: 'quiz' };
  await assert.rejects(pruefePack(quelleAusBytes(await schreibePack(kopf([]), [LIZENZ, text])), VERSION), /rolle/);
});

test('Pack fuer 0.4.0 wird von 0.3.x abgelehnt (mindestVeil)', async () => {
  const { bytes } = await baueDummyPack();
  await assert.rejects(pruefePack(quelleAusBytes(bytes), '0.3.9'), /veil-zu-alt/);
});

test('BENOETIGT deckt alle Freischaltungen ab, Rollen bekannt', () => {
  for (const f of FREISCHALTUNGEN) assert.ok(f in BENOETIGT, f);
  for (const r of Object.values(BENOETIGT)) assert.ok(r === null || ROLLEN.includes(r));
});

test('Quiz-Bank: gueltige Bank, ungueltige Fragen fallen weg, unbekannte Felder nicht uebernommen', () => {
  const bank = pruefeQuizBank(DUMMY_QUIZ);
  assert.equal(bank.fragen.length, DUMMY_QUIZ.fragen.length);
  const roh = structuredClone(DUMMY_QUIZ);
  roh.fragen[0].html = '<b>x</b>';
  roh.fragen.push({ id: 'boese', art: 'wissen', schwere: 'leicht', frage: '<img src=x onerror=1>', antworten: ['a', 'b'], richtig: 0 });
  roh.fragen.push({ id: 'falsch-index', art: 'wissen', schwere: 'leicht', frage: 'F', antworten: ['a', 'b'], richtig: 2 });
  roh.fragen.push({ id: 'test-w1', art: 'tippen', schwere: 'leicht', frage: 'doppelt', satz: 'x' });
  const b2 = pruefeQuizBank(roh);
  assert.equal(b2.fragen.length, DUMMY_QUIZ.fragen.length);
  assert.equal('html' in b2.fragen[0], false);
  assert.equal(pruefeQuizBank({ version: 1, fragen: DUMMY_QUIZ.fragen.slice(0, 2) }), null);
  assert.equal(pruefeQuizBank({ version: 2, fragen: DUMMY_QUIZ.fragen }), null);
});

test('Texte: Pflichtgruppen, Platzhalter nur an ihrem Ort', () => {
  assert.ok(pruefeTexte(DUMMY_TEXTE));
  const roh = structuredClone(DUMMY_TEXTE);
  roh.gruppen.titel = ['ohne Platzhalter'];
  assert.equal(pruefeTexte(roh), null);
  const r2 = structuredClone(DUMMY_TEXTE);
  r2.gruppen.start.push('{{title}} falsch hier');
  assert.deepEqual(pruefeTexte(r2).gruppen.start, DUMMY_TEXTE.gruppen.start);
  assert.equal(fuelleSatz('A {{seconds}} B', { seconds: 9.6 }), 'A 10 B');
  assert.equal(sichererText('  a\u0000b\u202e  ', 10), 'a b');
});

test('Einstellungen: Standard und Grenzen der neuen Felder', () => {
  const e = vervollstaendige({});
  assert.deepEqual(e.erwachsen, STANDARD.erwachsen);
  assert.deepEqual(e.quiz, { verweigern: 0.1, freilegenMs: 10000 });
  assert.equal(e.ruhig, false);
  const g = vervollstaendige({ quiz: { verweigern: 0.9, freilegenMs: 100 }, erwachsen: { an: false, eigeneSeiten: [' Foo.com ', 'foo.com', 3] } });
  assert.equal(g.quiz.verweigern, 0.3);
  assert.equal(g.quiz.freilegenMs, 3000);
  assert.equal(g.erwachsen.an, false);
  assert.equal(g.erwachsen.komplettErsatz, false);
  assert.deepEqual(g.erwachsen.eigeneSeiten, ['foo.com']);
});

test('Steigerung: Zonen heben nur an, Stufe 4 verdeckt ganz', () => {
  const basis = { zonen: structuredClone(STANDARD.zonen) };
  basis.zonen.feet = { an: true, bedeckt: true };
  assert.deepEqual(wirksameZonen(basis, 0), { zonen: basis.zonen, ganzVerdecken: false });
  const s1 = wirksameZonen(basis, 1).zonen;
  assert.equal(s1.breast.bedeckt, true);
  assert.equal(s1.face.an, false);
  const s2 = wirksameZonen(basis, 2).zonen;
  assert.equal(s2.face.an && s2.eyes.an && s2.mouth.an, true);
  assert.equal(s2.belly.an, false);
  const s3 = wirksameZonen(basis, 3);
  assert.equal(s3.zonen.belly.an && s3.zonen.armpits.an && s3.zonen.feet.bedeckt, true);
  assert.equal(s3.ganzVerdecken, false);
  assert.equal(wirksameZonen(basis, 4).ganzVerdecken, true);
  assert.equal(basis.zonen.face.an, false); // Eingabe unveraendert
});

test('Steigerung: Abbau je 12 Stunden, Pause haelt die Uhr an', () => {
  const t0 = 1_000_000_000_000;
  const stand = { ...STAND_START, stufe: 3, abbauAb: t0 };
  assert.equal(wirksameStufe(stand, t0 + ABBAU_MS - 1), 3);
  assert.equal(wirksameStufe(stand, t0 + ABBAU_MS), 2);
  assert.equal(wirksameStufe(stand, t0 + 10 * ABBAU_MS), 0);
  assert.equal(wirksameStufe(stand, t0 - 5 * ABBAU_MS), 3);
  const pause = { ...stand, pauseSeit: t0 + 1000 };
  assert.equal(wirksameStufe(pause, t0 + 5 * ABBAU_MS), 3);
  assert.deepEqual(anzeigeStufe(pause, t0 + 2000), { stufe: 3, bisAbsenkungMs: null, pausiert: true });
  assert.equal(anzeigeStufe(stand, t0 + 1000).bisAbsenkungMs, ABBAU_MS - 1000);
  assert.deepEqual(vervollstaendigeStand({ stufe: 9, unbekannt: 1 }).stufe, 4);
});

test('Seitenliste: Liste, Spiegel, eigene Seiten, Testdomain nur im Testbau', () => {
  assert.equal(seiteFuer('https://www.pornhub.com/view_video.php?v=1'), 'pornhub');
  assert.equal(seiteFuer('https://de.xhamster.desi/videos/x'), 'xhamster');
  assert.equal(seiteFuer('https://www.xnxx.com/'), 'xnxx');
  assert.equal(seiteFuer('https://redtube.com/'), 'allgemein');
  assert.equal(seiteFuer('https://example.com/'), null);
  assert.equal(seiteFuer('https://notpornhub.com/'), null);
  assert.equal(istErwachsenenseite('https://sub.eigene.org/a', ['https://www.Eigene.org/pfad']), true);
  assert.equal(hostAus('javascript:alert(1)'), null);
  for (const boese of ['exa*mple.com', 'a..com', '-a-.com', 'localhost', 'x.-y.com']) assert.equal(hostAus(boese), null, boese);
  assert.equal(hostAus('*.Example.com'), 'example.com');
  assert.equal(hostAus('xn--bcher-kva.example'), 'xn--bcher-kva.example');
  assert.equal(hostAus('127.0.0.1'), '127.0.0.1');
  // In Node gibt es keinen Testhaken: die Testdomain ist keine Erwachsenenseite und steht nicht in den Domains.
  assert.equal(seiteFuer('https://pornhub.veil-erwachsen.test/'), null);
  assert.equal(alleDomains().includes('veil-erwachsen.test'), false);
});
