// Einheitstests Auftrag T (Phase 6, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 7): Pack-Rolle `ton` (Audio mit Signaturpruefung, Rollenregeln,
// Namen aus TON_NAMEN, Freischaltung `ton`) und das Dummy-Pack mit seinen synthetischen Toenen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TON_BYTES, pruefePack, quelleAusBytes, schreibePack, tonNameAusDatei } from '../../src/pack/format.ts';
import { BENOETIGT, FREISCHALTUNGEN, ROLLEN } from '../../src/pack/vertrag.ts';
import { TON_NAMEN } from '../../src/ton/vertrag.ts';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';
import { baueWav, dummyToene } from '../../scripts/pack/dummy-toene.mjs';

const VERSION = '0.8.0';
const kodiere = (t) => new TextEncoder().encode(t);
const KOPF = { id: 'tontest', version: '1.0.0', titel: 'Tontest', erstellt: '2026-11-05T10:00:00Z', mindestVeil: '0.0.1', freischaltungen: ['ton'] };
const LIZENZ = { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Test license.'), rolle: 'lizenz' };
const fuell = (n) => Array.from({ length: n }, (_, i) => i & 255);
const ascii = (t) => [...t].map((c) => c.charCodeAt(0));

// Minimale Audio-Koepfe mit gueltiger Signatur (kein echter Klang, die Pruefung liest nur den Anfang).
const wav = () => baueWav(440, 50);
const ogg = () => Uint8Array.from([...ascii('OggS'), 0, 2, ...fuell(24)]);
const mp3Id3 = () => Uint8Array.from([...ascii('ID3'), 3, 0, 0, ...fuell(20)]);
const mp3Rahmen = () => Uint8Array.from([0xff, 0xfb, 0x90, 0x00, ...fuell(20)]);
const ton = (name, typ, daten) => ({ name, typ, daten, rolle: 'ton' });
const pruefe = async (dateien, kopf = KOPF) => pruefePack(quelleAusBytes(await schreibePack(kopf, [LIZENZ, ...dateien])), VERSION);

test('Rolle ton: wav, ogg und mp3 (ID3 und Rahmen) mit passender Signatur werden angenommen, Freischaltung ton bleibt', async () => {
  const p = await pruefe([
    ton('ton/quiz.wav', 'audio/wav', wav()),
    ton('ton/richtig.ogg', 'audio/ogg', ogg()),
    ton('ton/falsch.mp3', 'audio/mpeg', mp3Id3()),
    ton('verweigert.mp3', 'audio/mpeg', mp3Rahmen()),
  ]);
  assert.equal(p.rollen.ton, 4);
  assert.deepEqual(p.manifest.freischaltungen, ['ton']);
  assert.deepEqual(p.manifest.dateien.filter((d) => d.rolle === 'ton').map((d) => d.typ).sort(), ['audio/mpeg', 'audio/mpeg', 'audio/ogg', 'audio/wav']);
  console.log(`einheit ton: 4 Klangdateien (wav, ogg, mp3 mit ID3, mp3 mit Rahmen) angenommen, rollen.ton = ${p.rollen.ton}`);
});

test('Signatur: falsche Kopfbytes lehnen das Pack ab (signatur), je Typ', async () => {
  const falsch = Uint8Array.from(fuell(40));
  for (const [typ, endung] of [['audio/wav', 'wav'], ['audio/ogg', 'ogg'], ['audio/mpeg', 'mp3']]) {
    await assert.rejects(pruefe([ton(`ton/quiz.${endung}`, typ, falsch)]), /signatur/, typ);
  }
  // Bild-Bytes als Klang: JPEG-Anfang (FF D8 FF) ist kein MP3-Rahmen, ein PNG-Kopf kein WAV und kein OGG
  const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...fuell(30)]);
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...fuell(30)]);
  await assert.rejects(pruefe([ton('ton/quiz.mp3', 'audio/mpeg', jpegBytes)]), /signatur/, 'JPEG als mp3');
  await assert.rejects(pruefe([ton('ton/quiz.wav', 'audio/wav', pngBytes)]), /signatur/, 'PNG als wav');
  await assert.rejects(pruefe([ton('ton/quiz.ogg', 'audio/ogg', pngBytes)]), /signatur/, 'PNG als ogg');
  // MP3-Rahmen mit reserviertem Bitraten-Index (15) oder reservierter Version ist keiner
  await assert.rejects(pruefe([ton('ton/quiz.mp3', 'audio/mpeg', Uint8Array.from([0xff, 0xfb, 0xf0, 0, ...fuell(20)]))]), /signatur/, 'Bitrate 15');
  await assert.rejects(pruefe([ton('ton/quiz.mp3', 'audio/mpeg', Uint8Array.from([0xff, 0xe9, 0x90, 0, ...fuell(20)]))]), /signatur/, 'Version reserviert');
  // RIFF ohne WAVE ist kein WAV
  await assert.rejects(pruefe([ton('ton/quiz.wav', 'audio/wav', Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('AVI '), ...fuell(8)]))]), /signatur/);
  // ein WAV, das sich als OGG ausgibt
  await assert.rejects(pruefe([ton('ton/quiz.ogg', 'audio/ogg', wav())]), /signatur/);
});

test('Rollenregeln: Audio nur in Rolle ton, Rolle ton nur Audio', async () => {
  // Audio ohne Rolle oder in einer unbekannten Rolle: verworfen, das Pack bleibt gueltig (Entscheidung 100, vorwaertsvertraeglich)
  for (const rolle of [undefined, 'stimme']) {
    const p = await pruefe([{ name: 'ton/quiz.wav', typ: 'audio/wav', daten: wav(), rolle }, ton('ton/richtig.wav', 'audio/wav', wav())]);
    assert.deepEqual(p.manifest.dateien.filter((d) => d.typ.startsWith('audio/')).map((d) => d.name), ['ton/richtig.wav'], String(rolle));
    assert.equal(p.rollen.ton, 1);
  }
  await assert.rejects(pruefe([{ name: 'a.wav', typ: 'audio/wav', daten: wav(), rolle: 'texte' }]), /rolle/, 'Audio in Rolle texte');
  await assert.rejects(pruefe([{ name: 'a.wav', typ: 'audio/wav', daten: wav(), rolle: 'patch' }]), /rolle/, 'Audio in Rolle patch');
  await assert.rejects(pruefe([ton('ton/quiz.json', 'application/json', kodiere('{}'))]), /rolle/, 'Rolle ton mit JSON');
  await assert.rejects(pruefe([ton('ton/quiz.txt', 'text/plain', kodiere('hi'))]), /rolle/, 'Rolle ton mit Text');
  const bild = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...fuell(14), 0xff, 0xc0, 0, 17, 8, 0, 48, 0, 64, 3, ...fuell(9), 0xff, 0xda, ...fuell(10)]);
  await assert.rejects(pruefe([ton('ton/quiz.jpg', 'image/jpeg', bild)]), /rolle/, 'Rolle ton mit Bild');
});

test('Endung muss zum Typ passen: ton/quiz.png als audio/wav und eine Datei ohne Endung werden verworfen', async () => {
  const p = await pruefe([
    ton('ton/quiz.png', 'audio/wav', wav()),
    ton('ton/richtig', 'audio/wav', wav()),
    ton('ton/falsch.mp3', 'audio/wav', wav()),
    ton('ton/verweigert.wav', 'audio/wav', wav()),
  ]);
  assert.deepEqual(p.manifest.dateien.filter((d) => d.rolle === 'ton').map((d) => d.name), ['ton/verweigert.wav']);
  assert.equal(p.rollen.ton, 1);
});

test('Groesse: genau 1 MB geht, ein Byte mehr nicht (ton-zu-gross)', async () => {
  const gross = (n) => {
    const w = new Uint8Array(n);
    w.set(wav().subarray(0, 44));
    return w;
  };
  const p = await pruefe([ton('ton/quiz.wav', 'audio/wav', gross(MAX_TON_BYTES))]);
  assert.equal(p.rollen.ton, 1);
  await assert.rejects(pruefe([ton('ton/quiz.wav', 'audio/wav', gross(MAX_TON_BYTES + 1))]), /ton-zu-gross/);
  console.log(`einheit ton: Grenze ${MAX_TON_BYTES} Bytes, ${MAX_TON_BYTES} geht, ${MAX_TON_BYTES + 1} abgelehnt`);
});

test('Namen: nur Dateinamen ohne Ordner und Endung aus TON_NAMEN zaehlen, der Rest wird verworfen', async () => {
  assert.equal(tonNameAusDatei('ton/richtig.ogg'), 'richtig');
  assert.equal(tonNameAusDatei('quiz.wav'), 'quiz');
  assert.equal(tonNameAusDatei('a/b/c/trigger.mp3'), 'trigger');
  assert.equal(tonNameAusDatei('ton/richtig.v2.ogg'), null);
  assert.equal(tonNameAusDatei('ton/Richtig.ogg'), null);
  assert.equal(tonNameAusDatei('ton/unsinn.ogg'), null);
  assert.equal(tonNameAusDatei('ton/.ogg'), null);
  for (const n of TON_NAMEN) assert.equal(tonNameAusDatei(`ton/${n}.wav`), n);

  const p = await pruefe([
    ton('ton/richtig.wav', 'audio/wav', wav()),
    ton('ton/unsinn.wav', 'audio/wav', wav()),
    ton('ton/richtig.ogg', 'audio/ogg', ogg()), // zweiter Klang mit demselben Namen
  ]);
  const toene = p.manifest.dateien.filter((d) => d.rolle === 'ton').map((d) => d.name);
  assert.deepEqual(toene, ['ton/richtig.wav']);
  assert.equal(p.rollen.ton, 1);
  assert.deepEqual(p.manifest.freischaltungen, ['ton']);
  console.log(`einheit ton: 3 Klangdateien im Pack, 1 behalten (${toene.join(', ')}), unbekannter Name und Doppelgaenger verworfen`);
});

test('Freischaltung ton braucht mindestens eine gueltige Datei der Rolle', async () => {
  // keine Klangdatei
  assert.deepEqual((await pruefe([])).manifest.freischaltungen, []);
  // nur Klaenge mit unbekanntem Namen: nichts bleibt, die Freischaltung faellt weg
  const p = await pruefe([ton('ton/unsinn.wav', 'audio/wav', wav())]);
  assert.equal(p.rollen.ton, 0);
  assert.deepEqual(p.manifest.freischaltungen, []);
  // Klaenge ohne Freischaltung: die Dateien liegen im Pack, aber `ton` ist nicht freigeschaltet
  const q = await pruefe([ton('ton/quiz.wav', 'audio/wav', wav())], { ...KOPF, freischaltungen: [] });
  assert.equal(q.rollen.ton, 1);
  assert.deepEqual(q.manifest.freischaltungen, []);
});

test('Vertrag: ton ist Freischaltung und Rolle, BENOETIGT verweist auf die Rolle', () => {
  assert.ok(FREISCHALTUNGEN.includes('ton'));
  assert.ok(ROLLEN.includes('ton'));
  assert.equal(BENOETIGT.ton, 'ton');
  assert.deepEqual([...TON_NAMEN], ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger']);
});

test('Dummy-Pack: fuenf synthetische WAV-Toene, ton freigeschaltet, jeder Name genau einmal', async () => {
  const { bytes } = await baueDummyPack();
  const p = await pruefePack(quelleAusBytes(bytes), VERSION);
  assert.ok(p.manifest.freischaltungen.includes('ton'));
  assert.equal(p.rollen.ton, 5);
  const namen = p.manifest.dateien.filter((d) => d.rolle === 'ton').map((d) => tonNameAusDatei(d.name)).sort();
  assert.deepEqual(namen, [...TON_NAMEN].sort());
  for (const d of p.manifest.dateien.filter((x) => x.rolle === 'ton')) {
    assert.equal(d.typ, 'audio/wav');
    assert.ok(d.laenge > 1000 && d.laenge < MAX_TON_BYTES, `${d.name}: ${d.laenge} Bytes`);
  }
  const groessen = dummyToene().map((t) => t.daten.byteLength);
  console.log(`einheit ton: Dummy-Pack mit ${p.rollen.ton} Toenen (${groessen.join(', ')} Bytes), ton freigeschaltet`);
});

test('Dummy-Pack ohne Ton (ohneTon) und ohne Phase 4: keine Klaenge, keine Freischaltung ton', async () => {
  for (const opts of [{ ohneTon: true }, { ohnePhase4: true }]) {
    const p = await pruefePack(quelleAusBytes((await baueDummyPack(opts)).bytes), VERSION);
    assert.equal(p.rollen.ton, 0);
    assert.ok(!p.manifest.freischaltungen.includes('ton'));
  }
});

test('Dummy-Toene: gueltiges WAV, Hoehen unterscheiden sich, Aussteuerung bleibt unter Vollausschlag', () => {
  const toene = dummyToene();
  assert.equal(toene.length, TON_NAMEN.length);
  const kopf = (b) => String.fromCharCode(...b.subarray(0, 4)) + String.fromCharCode(...b.subarray(8, 12));
  for (const t of toene) assert.equal(kopf(t.daten), 'RIFFWAVE');
  const v = new DataView(toene[0].daten.buffer);
  let spitze = 0;
  for (let i = 44; i + 1 < toene[0].daten.byteLength; i += 2) spitze = Math.max(spitze, Math.abs(v.getInt16(i, true)));
  assert.ok(spitze > 8000 && spitze < 20000, `Spitze ${spitze}`);
  const verschieden = new Set(toene.map((t) => Buffer.from(t.daten).toString('base64')));
  assert.equal(verschieden.size, TON_NAMEN.length);
});
