// Einheitstests ohne Browser: Schreiben und Lesen der .miapack-Datei (src/pack/format.ts), jede Ablehnung aus
// PHASE-2-BAUPLAN 9.1 als eigener Fall. Die Bilder sind synthetische Minimal-Bytes (nur Signatur), keine echten Bilder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Zwischenspeicher } from '../../src/pack/leihe.ts';
import {
  BILDKOPF_BYTES,
  KOPF_BYTES,
  MAX_BILD_SEITE,
  MAX_DATEIEN,
  MAX_GESAMT_BYTES,
  PackFehler,
  baueContainer,
  leseBildmasse,
  pruefePack,
  quelleAusBlob,
  quelleAusBytes,
  schreibePack,
  sha256,
} from '../../src/pack/format.ts';

const VEIL = '0.0.1';
const kodiere = (t) => new TextEncoder().encode(t);

// Minimale Bildkoepfe mit gueltiger Signatur UND lesbaren Massen (nur der Kopf, keine echten Bilder).
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
const fuell = (n) => Array.from({ length: n }, (_, i) => i & 255);
const ascii = (t) => [...t].map((c) => c.charCodeAt(0));
const png = (w = 64, h = 48) =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...ascii('IHDR'), ...u32(w), ...u32(h), 8, 2, 0, 0, 0, ...fuell(20)]);
const jpeg = (w = 64, h = 48) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...u16(16), ...fuell(14), 0xff, 0xc0, ...u16(17), 8, ...u16(h), ...u16(w), 3, ...fuell(9), 0xff, 0xda, ...fuell(10)]);
const webpRahmen = (kennung, nutzlast) => Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(kennung), 0, 0, 0, 0, ...nutzlast, ...fuell(8)]);
const webp = (w = 64, h = 48) => webpVp8(w, h);
// Verlustbehaftet: Frame-Tag (3), Startcode, Breite und Hoehe als 14 Bit little endian
const webpVp8 = (w = 64, h = 48) => webpRahmen('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >>> 8) & 0x3f, h & 255, (h >>> 8) & 0x3f]);
// Verlustfrei: Signatur 0x2f, dann 14 Bit Breite-1 und 14 Bit Hoehe-1
const webpVp8l = (w = 64, h = 48) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return webpRahmen('VP8L', [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]);
};
// Erweitert: Flags (4 Byte), Leinwandbreite-1 und -hoehe-1 als 24 Bit little endian
const webpVp8x = (w = 64, h = 48) =>
  webpRahmen('VP8X', [0, 0, 0, 0, (w - 1) & 255, ((w - 1) >>> 8) & 255, ((w - 1) >>> 16) & 255, (h - 1) & 255, ((h - 1) >>> 8) & 255, ((h - 1) >>> 16) & 255]);

const KOPF = {
  id: 'testpack',
  version: '1.0.0',
  titel: 'Testpack',
  erstellt: '2026-11-02T10:00:00Z',
  mindestVeil: '0.0.1',
  freischaltungen: ['stil:mia-patch'],
};

function dateien() {
  return [
    { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Nur fuer den privaten Gebrauch. Grüße.'), rolle: 'lizenz' },
    { name: 'patch/a.webp', typ: 'image/webp', daten: webp(), rolle: 'patch', stufe: 'tease' },
    { name: 'patch/b.png', typ: 'image/png', daten: png(), rolle: 'patch', stufe: 'hot' },
    { name: 'patch/c.jpg', typ: 'image/jpeg', daten: jpeg(), rolle: 'patch' },
    { name: 'daten.json', typ: 'application/json', daten: kodiere('{"a":1}') },
  ];
}

// Zerlegt ein geschriebenes Pack, laesst `aendere` am Manifest-Objekt arbeiten und baut es wieder zusammen (Daten unveraendert).
function mitManifest(bytes, aendere) {
  const L = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(KOPF_BYTES, KOPF_BYTES + L)));
  const daten = bytes.subarray(KOPF_BYTES + L);
  const neu = aendere(manifest);
  return baueContainer(JSON.stringify(neu ?? manifest), daten);
}

// Wie mitManifest, aber auch die Daten tauschen.
function mitDaten(bytes, aendere) {
  const L = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const text = new TextDecoder().decode(bytes.subarray(KOPF_BYTES, KOPF_BYTES + L));
  const daten = Uint8Array.from(bytes.subarray(KOPF_BYTES + L));
  aendere(daten, JSON.parse(text));
  return baueContainer(text, daten);
}

async function lehnAb(bytes, code, eigeneVersion = VEIL) {
  await assert.rejects(
    () => pruefePack(quelleAusBytes(bytes), eigeneVersion),
    (e) => {
      assert.ok(e instanceof PackFehler, `PackFehler erwartet, bekommen: ${e}`);
      assert.equal(e.code, code, `Code ${e.code} (${e.detail}) statt ${code}`);
      return true;
    },
  );
}

let gut;
async function gutesPack() {
  gut ??= await schreibePack(KOPF, dateien());
  return Uint8Array.from(gut);
}

test('Schreiben und Lesen: Rundlauf liefert Manifest, Lizenztext und Zahlen', async () => {
  const bytes = await gutesPack();
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), 'MIAPACK1');
  const t0 = performance.now();
  const fortschritte = [];
  const p = await pruefePack(quelleAusBytes(bytes), VEIL, (f, g) => fortschritte.push([f, g]));
  console.log(`einheit: Pack ${bytes.length} Bytes, ${p.manifest.dateien.length} Dateien, geprueft in ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(p.manifest.id, 'testpack');
  assert.equal(p.manifest.lizenz, 'lizenz.txt');
  assert.equal(p.lizenzText, 'Nur fuer den privaten Gebrauch. Grüße.');
  assert.equal(p.patches, 3);
  assert.equal(p.groesse, bytes.length);
  assert.deepEqual(p.manifest.freischaltungen, ['stil:mia-patch']);
  assert.deepEqual(fortschritte[0], [0, 5]);
  assert.deepEqual(fortschritte.at(-1), [5, 5]);
  // offset zaehlt ab Beginn des Datenbereichs
  const erster = p.manifest.dateien[0];
  assert.equal(erster.offset, 0);
  assert.equal(p.manifest.dateien[1].offset, erster.laenge);
  assert.equal(erster.sha256, await sha256(kodiere('Nur fuer den privaten Gebrauch. Grüße.')));
});

test('Lesen aus einem Blob (wie die Dateiauswahl) geht ebenso', async () => {
  const bytes = await gutesPack();
  const p = await pruefePack(quelleAusBlob(new Blob([bytes])), VEIL);
  assert.equal(p.manifest.dateien.length, 5);
});

test('Ablehnung: falsche Kennung', async () => {
  const bytes = await gutesPack();
  bytes[0] = 0x58;
  await lehnAb(bytes, 'kennung');
});

test('Ablehnung: Datei zu kurz fuer den Kopf', async () => {
  await lehnAb(kodiere('MIAPACK1'), 'zu-klein');
});

test('Ablehnung: Manifest groesser als 1 MiB', async () => {
  const bytes = await gutesPack();
  new DataView(bytes.buffer).setUint32(8, 1024 * 1024 + 1, true);
  await lehnAb(bytes, 'manifest-groesse');
});

test('Ablehnung: Manifestlaenge reicht ueber das Dateiende', async () => {
  const bytes = await gutesPack();
  new DataView(bytes.buffer).setUint32(8, bytes.length, true);
  await lehnAb(bytes, 'manifest-groesse');
});

test('Ablehnung: Manifest ist kein JSON', async () => {
  await lehnAb(baueContainer('{kaputt', new Uint8Array(4)), 'manifest-ungueltig');
});

test('Ablehnung: Manifest ist kein gueltiges UTF-8', async () => {
  const roh = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]);
  const bytes = new Uint8Array(KOPF_BYTES + roh.length);
  bytes.set(kodiere('MIAPACK1'));
  new DataView(bytes.buffer).setUint32(8, roh.length, true);
  bytes.set(roh, KOPF_BYTES);
  await lehnAb(bytes, 'utf8');
});

test('Ablehnung: Datei groesser als 300 MB (300 000 000 Bytes), genau 300 000 000 sind noch keine Groessen-Ablehnung', async () => {
  assert.equal(MAX_GESAMT_BYTES, 300_000_000);
  const zuGross = { groesse: 300_000_001, lies: async () => new Uint8Array(0) };
  await assert.rejects(() => pruefePack(zuGross, VEIL), (e) => e instanceof PackFehler && e.code === 'zu-gross');
  // Genau an der Grenze: weiter zur Kennung (die hier fehlt), nicht 'zu-gross'
  const grenze = { groesse: 300_000_000, lies: async (v, l) => new Uint8Array(l) };
  await assert.rejects(() => pruefePack(grenze, VEIL), (e) => e instanceof PackFehler && e.code === 'kennung');
});

const manifestFaelle = [
  ['format', 'format', (m) => void (m.format = 'anderes')],
  ['format-version', 'formatVersion 2', (m) => void (m.formatVersion = 2)],
  ['id', 'id mit Grossbuchstaben', (m) => void (m.id = 'Test Pack')],
  ['id', 'id zu lang', (m) => void (m.id = 'a'.repeat(41))],
  ['version', 'version ohne Patch-Teil', (m) => void (m.version = '1.0')],
  ['titel', 'titel laenger als 80 Zeichen', (m) => void (m.titel = 'x'.repeat(81))],
  ['titel', 'titel leer', (m) => void (m.titel = '')],
  ['mindest-veil', 'mindestVeil kaputt', (m) => void (m.mindestVeil = 'neu')],
  ['veil-zu-alt', 'mindestVeil hoeher als die eigene Version', (m) => void (m.mindestVeil = '9.0.0')],
  ['dateien', 'dateien leer', (m) => void (m.dateien = [])],
  ['dateiname', 'Dateiname mit ..', (m) => void (m.dateien[1].name = 'patch/../x.webp')],
  ['dateiname', 'Dateiname mit Grossbuchstaben', (m) => void (m.dateien[1].name = 'Patch/A.webp')],
  ['dateiname', 'Dateiname beginnt mit Punkt', (m) => void (m.dateien[1].name = '.versteckt')],
  ['dateiname', 'Dateiname laenger als 101 Zeichen', (m) => void (m.dateien[1].name = 'a'.repeat(102))],
  ['dateiname-doppelt', 'Dateiname doppelt', (m) => void (m.dateien[2].name = m.dateien[1].name)],
  ['dateityp', 'SVG ist nicht erlaubt', (m) => void (m.dateien[1].typ = 'image/svg+xml')],
  ['dateityp', 'HTML ist nicht erlaubt', (m) => void (m.dateien[4].typ = 'text/html')],
  ['dateityp', 'Skript ist nicht erlaubt', (m) => void (m.dateien[4].typ = 'text/javascript')],
  ['dateiangabe', 'offset negativ', (m) => void (m.dateien[1].offset = -1)],
  ['dateiangabe', 'laenge keine Ganzzahl', (m) => void (m.dateien[1].laenge = 1.5)],
  ['bereich', 'Bereich ueber das Dateiende', (m) => void (m.dateien[1].offset = 1_000_000)],
  ['ueberlappung', 'Bereiche ueberlappen', (m) => void (m.dateien[2].offset = m.dateien[1].offset + 1)],
  ['sha256', 'sha256 keine Hex-Zeichen', (m) => void (m.dateien[1].sha256 = 'zz')],
  ['sha256', 'sha256 stimmt nicht', (m) => void (m.dateien[1].sha256 = '0'.repeat(64))],
  ['lizenz', 'lizenz zeigt auf eine andere Datei', (m) => void (m.lizenz = 'daten.json')],
  ['lizenz', 'Lizenzdatei fehlt (Rolle entfernt)', (m) => void delete m.dateien[0].rolle],
  ['lizenz', 'zwei Lizenzdateien', (m) => void (m.dateien[4].rolle = 'lizenz')],
  ['lizenz', 'Lizenzdatei ist kein text/plain', (m) => void (m.dateien[0].typ = 'application/json')],
  ['rolle', 'unbekannte Rolle', (m) => void (m.dateien[1].rolle = 'skript')],
  ['rolle', 'Rolle patch auf Text', (m) => void (m.dateien[4].rolle = 'patch')],
  ['stufe', 'unbekannte Stufe', (m) => void (m.dateien[1].stufe = 'extrem')],
  ['freischaltungen', 'freischaltungen keine Liste', (m) => void (m.freischaltungen = 'alles')],
];

for (const [code, beschreibung, aendere] of manifestFaelle) {
  test(`Ablehnung (${code}): ${beschreibung}`, async () => {
    const bytes = mitManifest(await gutesPack(), (m) => void aendere(m));
    await lehnAb(bytes, code);
  });
}

test('Ablehnung: mehr als 5000 Dateien', async () => {
  const bytes = mitManifest(await gutesPack(), (m) => {
    m.dateien = Array.from({ length: MAX_DATEIEN + 1 }, (_, i) => ({ ...m.dateien[1], name: `p/${i}.webp`, offset: 0 }));
  });
  await lehnAb(bytes, 'zu-viele-dateien');
});

test('Ablehnung: Bild-Signatur passt nicht zum Typ (PNG-Bytes als WebP erklaert)', async () => {
  const bytes = mitManifest(await gutesPack(), (m) => void (m.dateien[2].typ = 'image/webp'));
  await lehnAb(bytes, 'signatur');
});

test('Ablehnung: Bild-Signatur jedes Typs wird einzeln geprueft', async () => {
  for (const [typ, quellIndex] of [['image/jpeg', 1], ['image/png', 1], ['image/webp', 3]]) {
    const bytes = mitManifest(await gutesPack(), (m) => void (m.dateien[quellIndex].typ = typ));
    await lehnAb(bytes, 'signatur');
  }
});

test('Bildmasse: jedes Format wird aus dem Dateikopf gelesen', () => {
  assert.deepEqual(leseBildmasse('image/png', png(640, 480)), { breite: 640, hoehe: 480 });
  assert.deepEqual(leseBildmasse('image/png', png(4096, 1)), { breite: 4096, hoehe: 1 });
  assert.deepEqual(leseBildmasse('image/jpeg', jpeg(1234, 567)), { breite: 1234, hoehe: 567 });
  assert.deepEqual(leseBildmasse('image/webp', webpVp8(321, 123)), { breite: 321, hoehe: 123 });
  assert.deepEqual(leseBildmasse('image/webp', webpVp8l(2000, 1500)), { breite: 2000, hoehe: 1500 });
  assert.deepEqual(leseBildmasse('image/webp', webpVp8x(4096, 3000)), { breite: 4096, hoehe: 3000 });
});

test('Bildmasse: JPEG mit mehreren Segmenten, Fuellbytes und Progressiv-SOF', () => {
  const kopf = [0xff, 0xd8, 0xff, 0xe1, ...u16(10), ...fuell(8), 0xff, 0xff, 0xff, 0xc4, ...u16(6), ...fuell(4), 0xff, 0xc2, ...u16(17), 8, ...u16(77), ...u16(99), 3, ...fuell(9)];
  assert.deepEqual(leseBildmasse('image/jpeg', Uint8Array.from(kopf)), { breite: 99, hoehe: 77 });
});

test('Bildmasse: nicht lesbare Koepfe liefern null', () => {
  assert.equal(leseBildmasse('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...fuell(30)])), null);
  assert.equal(leseBildmasse('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xda, ...u16(4), 0, 0])), null);
  assert.equal(leseBildmasse('image/webp', webpRahmen('ABCD', fuell(20))), null);
  assert.equal(leseBildmasse('image/png', png(0, 10)), null);
  assert.equal(leseBildmasse('image/webp', Uint8Array.from(ascii('RIFF'))), null);
});

for (const [name, bauen, typ] of [
  ['PNG', png, 'image/png'],
  ['JPEG', jpeg, 'image/jpeg'],
  ['WebP (VP8)', webpVp8, 'image/webp'],
  ['WebP (VP8L)', webpVp8l, 'image/webp'],
  ['WebP (VP8X)', webpVp8x, 'image/webp'],
]) {
  test(`Bildgroesse ${name}: 4096 je Seite gehen, 4097 werden abgelehnt (Breite wie Hoehe)`, async () => {
    const mit = async (w, h) =>
      schreibePack(KOPF, [
        { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Lizenz'), rolle: 'lizenz' },
        { name: 'patch/gross.bin', typ, daten: bauen(w, h), rolle: 'patch' },
      ]);
    assert.equal(MAX_BILD_SEITE, 4096);
    await pruefePack(quelleAusBytes(await mit(4096, 4096)), VEIL);
    await lehnAb(await mit(4097, 100), 'bild-zu-gross');
    await lehnAb(await mit(100, 4097), 'bild-zu-gross');
    await lehnAb(await mit(60000, 60000), 'bild-zu-gross');
  });
}

test('Ablehnung: Bildkopf ohne lesbare Masse', async () => {
  const kaputtPng = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...fuell(40)]);
  const bytes = await schreibePack(KOPF, [
    { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Lizenz'), rolle: 'lizenz' },
    { name: 'patch/a.png', typ: 'image/png', daten: kaputtPng, rolle: 'patch' },
  ]);
  await lehnAb(bytes, 'bildmasse');
});

test('Ablehnung: Datei veraendert (Pruefsumme)', async () => {
  const bytes = mitDaten(await gutesPack(), (daten) => void (daten[daten.length - 1] ^= 0xff));
  await lehnAb(bytes, 'sha256');
});

test('Ablehnung: Textdatei ist kein gueltiges UTF-8', async () => {
  const kaputt = [{ name: 'lizenz.txt', typ: 'text/plain', daten: Uint8Array.from([0x4c, 0xff, 0xfe, 0x41]), rolle: 'lizenz' }];
  const bytes = await schreibePack(KOPF, kaputt);
  await lehnAb(bytes, 'utf8');
});

test('Ablehnung: Datei hinter dem Ende abgeschnitten', async () => {
  const bytes = await gutesPack();
  await lehnAb(bytes.subarray(0, bytes.length - 3), 'bereich');
});

test('Ablehnung: leerer Lizenztext', async () => {
  const leer = [{ name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('   \n'), rolle: 'lizenz' }];
  await lehnAb(await schreibePack(KOPF, leer), 'lizenz');
});

test('Schreiben: ohne Lizenzdatei wird abgelehnt', async () => {
  await assert.rejects(
    () => schreibePack(KOPF, [{ name: 'a.png', typ: 'image/png', daten: png() }]),
    (e) => e instanceof PackFehler && e.code === 'lizenz',
  );
});

test('Unbekannte Freischaltungen werden verworfen, bekannte bleiben (ohne Doppelte)', async () => {
  const bytes = await schreibePack({ ...KOPF, freischaltungen: ['stil:mia-patch', 'quiz:alles', 'stil:mia-patch', 'ausfuehren'] }, dateien());
  const p = await pruefePack(quelleAusBytes(bytes), VEIL);
  assert.deepEqual(p.manifest.freischaltungen, ['stil:mia-patch']);
});

test('mindestVeil gleich der eigenen Version geht, hoeher nicht', async () => {
  const ok = await schreibePack({ ...KOPF, mindestVeil: '0.0.1' }, dateien());
  await pruefePack(quelleAusBytes(ok), '0.0.1');
  await pruefePack(quelleAusBytes(ok), '0.1.0');
  await lehnAb(await schreibePack({ ...KOPF, mindestVeil: '0.1.0' }, dateien()), 'veil-zu-alt', '0.0.9');
});

test('Pruefung ist nur lesend: Pack-Bytes bleiben unveraendert', async () => {
  const bytes = await gutesPack();
  const vorher = await sha256(bytes);
  await pruefePack(quelleAusBytes(bytes), VEIL);
  assert.equal(await sha256(bytes), vorher);
});

test('JPEG: SOF innerhalb von 1 MiB geht, dahinter wird beim Import abgelehnt (wie im Erkenner-Leser)', async () => {
  // APP-Segmente zu je 65 535 Bytes schieben den SOF nach hinten.
  const segment = [0xff, 0xe1, ...u16(65535), ...new Array(65533).fill(7)];
  const jpegMitVorspann = (anzahl) => {
    const kopf = [0xff, 0xd8];
    for (let i = 0; i < anzahl; i++) kopf.push(...segment);
    kopf.push(0xff, 0xc0, ...u16(17), 8, ...u16(48), ...u16(64), 3, ...fuell(9), 0xff, 0xda, ...fuell(10));
    return Uint8Array.from(kopf);
  };
  const mit = (daten) =>
    schreibePack(KOPF, [
      { name: 'lizenz.txt', typ: 'text/plain', daten: kodiere('Lizenz'), rolle: 'lizenz' },
      { name: 'patch/p.jpg', typ: 'image/jpeg', daten, rolle: 'patch' },
    ]);
  const nah = jpegMitVorspann(10); // SOF bei ~655 KB
  const fern = jpegMitVorspann(18); // SOF hinter 1 MiB
  assert.ok(nah.length < BILDKOPF_BYTES);
  assert.ok(fern.length > BILDKOPF_BYTES + 10_000);
  // Die Maße lassen sich aus dem ganzen Kopf lesen, aber nicht aus dem begrenzten Bereich.
  assert.deepEqual(leseBildmasse('image/jpeg', fern), { breite: 64, hoehe: 48 });
  assert.equal(leseBildmasse('image/jpeg', fern.subarray(0, BILDKOPF_BYTES)), null);
  await pruefePack(quelleAusBytes(await mit(nah)), VEIL);
  await lehnAb(await mit(fern), 'bildmasse');
});

// Fake-Bild mit close(), zaehlt Schliessungen.
const bild = (name) => ({ name, zu: 0, close() { this.zu++; } });

test('Zwischenspeicher: Verdraengen schliesst erst nach Rueckgabe der letzten Leihe', () => {
  const z = new Zwischenspeicher(2);
  const a = bild('a');
  const b = bild('b');
  const c = bild('c');
  const la = z.lege('a', a, true);
  z.lege('b', b, true).freigeben();
  assert.equal(z.groesse, 2);
  // c verdraengt a (aeltestes); a ist noch geliehen und bleibt offen
  z.lege('c', c, true).freigeben();
  assert.equal(z.groesse, 2);
  assert.equal(a.zu, 0, 'geliehenes Bild bleibt offen');
  la.freigeben();
  assert.equal(a.zu, 1, 'nach der Rueckgabe geschlossen');
  la.freigeben();
  assert.equal(a.zu, 1, 'doppelte Rueckgabe schliesst nicht doppelt');
  assert.equal(b.zu, 0);
  assert.equal(c.zu, 0);
});

test('Zwischenspeicher: hoechstens max Bilder, ungeliehene Verdraengte schliessen sofort', () => {
  const z = new Zwischenspeicher(3);
  const alle = Array.from({ length: 6 }, (_, i) => bild(`b${i}`));
  alle.forEach((b, i) => z.lege(b.name, b, true).freigeben());
  assert.equal(z.groesse, 3);
  assert.deepEqual(alle.map((b) => b.zu), [1, 1, 1, 0, 0, 0]);
  // hole() holt ein vorhandenes Bild und macht es zum juengsten
  const l = z.hole('b3');
  assert.ok(l && l.wert === alle[3]);
  z.lege('neu', bild('neu'), true).freigeben();
  assert.equal(alle[4].zu, 1, 'b4 war jetzt das aelteste');
  assert.equal(alle[3].zu, 0);
  l.freigeben();
  assert.equal(z.hole('gibtsnicht'), null);
});

test('Zwischenspeicher: leere() schliesst ungeliehene sofort, geliehene bei Rueckgabe; ueberholte Bilder werden nicht abgelegt', () => {
  const z = new Zwischenspeicher(5);
  const a = bild('a');
  const b = bild('b');
  const la = z.lege('a', a, true);
  z.lege('b', b, true).freigeben();
  z.leere();
  assert.equal(z.groesse, 0);
  assert.equal(b.zu, 1);
  assert.equal(a.zu, 0);
  la.freigeben();
  assert.equal(a.zu, 1);
  // ueberholt: nicht eingetragen, schliesst mit der Leihe
  const alt = bild('alt');
  const l = z.lege('alt', alt, false);
  assert.equal(z.groesse, 0);
  assert.equal(alt.zu, 0);
  l.freigeben();
  assert.equal(alt.zu, 1);
});

test('Zwischenspeicher: gleichzeitig dekodiertes Doppel wird geschlossen, das erste gilt', () => {
  const z = new Zwischenspeicher(5);
  const erstes = bild('x1');
  const zweites = bild('x2');
  const l1 = z.lege('x', erstes, true);
  const l2 = z.lege('x', zweites, true);
  assert.equal(l2.wert, erstes);
  assert.equal(zweites.zu, 1);
  assert.equal(erstes.zu, 0);
  l1.freigeben();
  l2.freigeben();
  assert.equal(erstes.zu, 0, 'bleibt im Speicher');
});

test('Zwischenspeicher: eine nie zurueckgegebene Leihe laeuft von selbst ab', async () => {
  const z = new Zwischenspeicher(1, 20);
  const a = bild('a');
  z.lege('a', a, true); // Leihe wird "vergessen"
  z.leere();
  assert.equal(a.zu, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(a.zu, 1);
});
