// Einheitstests fuer den Vertragsschritt Phase 5 (PHASE-5-AUFTRAEGE-SESSION-9.md): Freischaltungen `kontrolle:*`, Rolle `werbung` mit Format,
// Satz-Gruppen, Einstellungen `kontrolle`, Blitz-Grenzen (src/kontrolle/grenzen.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruefePack, quelleAusBytes, schreibePack } from '../../src/pack/format.ts';
import { BENOETIGT, BENOETIGT_GRUPPE, WERBE_FORMATE, filtereNachGruppen, formatMasse } from '../../src/pack/vertrag.ts';
import { pruefeTexte } from '../../src/quiz/vertrag.ts';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import {
  BLITZ_WORT_MIN_ABSTAND_MS,
  SCHWARM_MAX_MS,
  SCHWARM_MAX_WORTE,
  STREIFEN_MAX_HZ,
  QUIZ_WARNUNG_SCHLUESSEL,
  deckleDrehzahl,
  deckleWortPlan,
  naechsterBlitzAbstand,
  streifenHz,
} from '../../src/kontrolle/grenzen.ts';
import { baueDummyPack, DUMMY_WERBUNG } from '../../scripts/pack/baue-pack.mjs';
import { DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';
import { readFileSync } from 'node:fs';

const VERSION = '0.5.0';
const kodiere = (t) => new TextEncoder().encode(t);
const LIZENZ = { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Lizenz'), rolle: 'lizenz' };
const kopf = (freischaltungen) => ({ id: 't', version: '1.0.0', titel: 'T', erstellt: 'x', mindestVeil: VERSION, freischaltungen });
// Kleinstes gueltiges PNG (1 x 1), reicht fuer Rollen-Pruefungen.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);

test('Dummy-Pack: Werbebilder mit Format, Kontroll-Freischaltungen gelten', async () => {
  const { bytes, werbung } = await baueDummyPack();
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.equal(p.rollen.werbung, werbung);
  assert.equal(werbung, DUMMY_WERBUNG.length);
  for (const f of ['kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf']) assert.ok(p.manifest.freischaltungen.includes(f), f);
  const formate = p.manifest.dateien.filter((d) => d.rolle === 'werbung').map((d) => d.format);
  assert.ok(formate.every((f) => WERBE_FORMATE.includes(f)));
});

test('Rolle werbung ohne oder mit unbekanntem Format: Datei verliert die Rolle, Pack bleibt gueltig', async () => {
  for (const format of [undefined, '123x45']) {
    const datei = { name: 'w.png', typ: 'image/png', daten: PNG, rolle: 'werbung' };
    if (format) datei.format = format;
    const bytes = await schreibePack(kopf(['kontrolle:werbung']), [LIZENZ, datei]);
    const p = await pruefePack(quelleAusBytes(bytes), VERSION);
    assert.equal(p.manifest.dateien.find((d) => d.name === 'w.png').rolle, undefined);
    assert.equal(p.rollen.werbung, 0);
    assert.deepEqual(p.manifest.freischaltungen, []);
  }
});

test('kontrolle:werbung ohne Werbebild faellt weg, mit Bild bleibt sie', async () => {
  const ohne = await pruefePack(quelleAusBytes(await schreibePack(kopf(['kontrolle:werbung']), [LIZENZ])), VERSION);
  assert.deepEqual(ohne.manifest.freischaltungen, []);
  const datei = { name: 'w.png', typ: 'image/png', daten: PNG, rolle: 'werbung', format: '300x250' };
  const mit = await pruefePack(quelleAusBytes(await schreibePack(kopf(['kontrolle:werbung']), [LIZENZ, datei])), VERSION);
  assert.deepEqual(mit.manifest.freischaltungen, ['kontrolle:werbung']);
  assert.equal(mit.manifest.dateien.find((d) => d.name === 'w.png').format, '300x250');
});

test('Blitz und Leerlauf brauchen Texte plus ihre Gruppe', () => {
  assert.equal(BENOETIGT['kontrolle:blitz'], 'texte');
  assert.equal(BENOETIGT['kontrolle:leerlauf'], 'texte');
  assert.equal(BENOETIGT_GRUPPE['kontrolle:blitz'], 'blitzwoerter');
  assert.equal(BENOETIGT_GRUPPE['kontrolle:leerlauf'], 'leerlauf');
  // Der Import (src/pack/speicher.ts) filtert mit filtereNachGruppen nach der Schema-Pruefung.
  const alle = ['kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf', 'erwachsen:titel'];
  assert.deepEqual(filtereNachGruppen(alle, null), ['kontrolle:werbung', 'erwachsen:titel']);
  assert.deepEqual(filtereNachGruppen(alle, { gruppen: { blitzwoerter: ['DOWN'] } }), ['kontrolle:werbung', 'kontrolle:blitz', 'erwachsen:titel']);
  assert.deepEqual(filtereNachGruppen(alle, { gruppen: { blitzwoerter: [], leerlauf: ['x'] } }), ['kontrolle:werbung', 'kontrolle:leerlauf', 'erwachsen:titel']);
  const ohneGruppen = pruefeTexte({ ...DUMMY_TEXTE, gruppen: { ...DUMMY_TEXTE.gruppen, blitzwoerter: undefined, leerlauf: ['   '] } });
  assert.deepEqual(filtereNachGruppen(alle, ohneGruppen), ['kontrolle:werbung', 'erwachsen:titel']);
  const quelle = readFileSync(new URL('../../src/pack/speicher.ts', import.meta.url), 'utf8');
  assert.match(quelle, /filtereNachGruppen\(/);
});

test('Grenzen der Satzlaengen genau: 24/25 und 40/41 Zeichen, Emoji als ein Zeichen', () => {
  const t = pruefeTexte({
    ...DUMMY_TEXTE,
    gruppen: { ...DUMMY_TEXTE.gruppen, blitzwoerter: ['A'.repeat(24), 'B'.repeat(25), '💗'.repeat(24)], werbung: ['Mia ' + 'x'.repeat(36), 'Mia ' + 'y'.repeat(37)] },
  });
  assert.deepEqual(t.gruppen.blitzwoerter, ['A'.repeat(24), '💗'.repeat(24)]);
  assert.deepEqual(t.gruppen.werbung, ['Mia ' + 'x'.repeat(36)]);
});

test('Satz-Gruppen: Blitzwoerter kurz, Werbe-Kennzeichnung nur mit Mia', () => {
  const t = pruefeTexte({
    ...DUMMY_TEXTE,
    gruppen: {
      ...DUMMY_TEXTE.gruppen,
      blitzwoerter: ['DOWN', 'X'.repeat(25), 'OBEY'],
      werbung: ['Mia’s ad', 'An ad', 'Sponsored by Mia, obviously', 'Mia '.repeat(12)],
      leerlauf: ['Stay with me.'],
    },
  });
  assert.deepEqual(t.gruppen.blitzwoerter, ['DOWN', 'OBEY']);
  assert.deepEqual(t.gruppen.werbung, ['Mia’s ad', 'Sponsored by Mia, obviously']);
  assert.deepEqual(t.gruppen.leerlauf, ['Stay with me.']);
});

test('Einstellungen kontrolle: Standard und Begrenzung', () => {
  assert.deepEqual(STANDARD.kontrolle, { werbung: true, blitz: 'selten', leerlauf: true, leerlaufMinuten: 2 });
  assert.deepEqual(vervollstaendige({}).kontrolle, STANDARD.kontrolle);
  const k = vervollstaendige({ kontrolle: { werbung: false, blitz: 'dauernd', leerlauf: 'ja', leerlaufMinuten: 0.2 } }).kontrolle;
  assert.deepEqual(k, { werbung: false, blitz: 'selten', leerlauf: true, leerlaufMinuten: 1 });
  assert.equal(vervollstaendige({ kontrolle: { leerlaufMinuten: 999 } }).kontrolle.leerlaufMinuten, 60);
  assert.equal(vervollstaendige({ kontrolle: { blitz: 'oft', leerlaufMinuten: 7.4 } }).kontrolle.leerlaufMinuten, 7);
});

test('Wortplan: 185 ms Abstand, hoechstens 12 Woerter, hoechstens 2500 ms', () => {
  const dicht = Array.from({ length: 40 }, (_, i) => ({ beginnMs: i * 50, dauerMs: 400 }));
  const p = deckleWortPlan(dicht);
  assert.ok(p.length <= SCHWARM_MAX_WORTE);
  for (let i = 1; i < p.length; i++) {
    assert.ok(p[i].beginnMs - p[i - 1].beginnMs >= BLITZ_WORT_MIN_ABSTAND_MS);
    assert.ok(p[i - 1].beginnMs + p[i - 1].dauerMs <= p[i].beginnMs, 'Woerter ueberlappen nicht');
  }
  const ende = Math.max(...p.map((w) => w.beginnMs + w.dauerMs));
  assert.ok(ende <= SCHWARM_MAX_MS, `Ende ${ende}`);
  assert.equal(p[0].beginnMs, 0);
  // Einzelnes langes Wort: auf 2500 ms gekuerzt. Ungueltiges faellt weg.
  assert.deepEqual(deckleWortPlan([{ beginnMs: 100, dauerMs: 9000 }, { beginnMs: NaN, dauerMs: 10 }]), [{ beginnMs: 0, dauerMs: SCHWARM_MAX_MS }]);
  // 1000 zufaellige Plaene halten die Grenzen.
  for (let n = 0; n < 1000; n++) {
    const roh = Array.from({ length: 1 + Math.floor(Math.random() * 30) }, () => ({ beginnMs: Math.random() * 4000, dauerMs: 1 + Math.random() * 800 }));
    const q = deckleWortPlan(roh);
    assert.ok(q.length <= SCHWARM_MAX_WORTE);
    for (let i = 1; i < q.length; i++) assert.ok(q[i].beginnMs - q[i - 1].beginnMs >= BLITZ_WORT_MIN_ABSTAND_MS);
    for (const w of q) assert.ok(w.beginnMs + w.dauerMs <= SCHWARM_MAX_MS);
  }
});

test('Spirale: Streifen hoechstens 2,5 Hz, Ruhig 30 %', () => {
  for (const arme of [1, 2, 3, 4, 6, 8, 12]) {
    for (const u of [0.05, 0.3, 1, 5, -3]) {
      const d = deckleDrehzahl(arme, u, false);
      assert.ok(streifenHz(arme, d) <= STREIFEN_MAX_HZ + 1e-9, `${arme} Arme, ${u} U/s`);
      assert.ok(Math.abs(deckleDrehzahl(arme, u, true) - d * 0.3) < 1e-12);
    }
  }
  assert.equal(deckleDrehzahl(4, 0.25, false), 0.25);
  // Nicht endliche Werte: Stillstand; gebrochene Arme werden aufgerundet.
  for (const [a, u] of [[NaN, 1], [Infinity, 1], [3, NaN], [3, Infinity]]) assert.equal(deckleDrehzahl(a, u, false), 0);
  assert.ok(streifenHz(2.2, deckleDrehzahl(2.2, 5, false)) <= STREIFEN_MAX_HZ + 1e-9);
  assert.ok(3 * deckleDrehzahl(2.2, 5, false) <= STREIFEN_MAX_HZ + 1e-9);
});

test('Blitz-Abstand: selten 8 bis 12 min, oft 2 bis 4 min', () => {
  assert.equal(naechsterBlitzAbstand('selten', 0), 8 * 60_000);
  assert.ok(naechsterBlitzAbstand('selten', 1) <= 12 * 60_000);
  assert.equal(naechsterBlitzAbstand('oft', 0.5), 3 * 60_000);
  assert.equal(naechsterBlitzAbstand('oft', NaN), 3 * 60_000);
});

test('Warnschluessel der Einstellungsseite passt zum Riegel', () => {
  const quelle = readFileSync(new URL('../../src/riegel/riegel.ts', import.meta.url), 'utf8');
  assert.ok(quelle.includes(`WARNUNG_SCHLUESSEL = '${QUIZ_WARNUNG_SCHLUESSEL}'`));
});

test('formatMasse', () => {
  assert.deepEqual(formatMasse('728x90'), { breite: 728, hoehe: 90 });
});
