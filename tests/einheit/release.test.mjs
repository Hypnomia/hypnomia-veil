// Einheitstests ohne Browser: Release-Kanaele, Baudatum, updates.json, Signier-Argumente, Befehlszeile des Release-Skripts (Session 14, Auftrag R).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baudatumAusUmgebung, geckoEinstellungen, kanalAusUmgebung, UPDATE_URL } from '../../scripts/release/kanal.mjs';
import { bauBefehl, baueBuildMd, leseArgumente } from '../../scripts/release/firefox.mjs';
import { schwaerze, signierArgumente, signierUmgebung, zeilenSchwaerzer } from '../../scripts/release/signieren.mjs';
import { traegeUpdateEin } from '../../scripts/release/updates.mjs';

test('Kanal: Standard unlisted, amo erlaubt, Unbekanntes bricht ab', () => {
  assert.equal(kanalAusUmgebung({}), 'unlisted');
  assert.equal(kanalAusUmgebung({ VEIL_KANAL: 'unlisted' }), 'unlisted');
  assert.equal(kanalAusUmgebung({ VEIL_KANAL: 'amo' }), 'amo');
  for (const schlecht of ['', 'AMO', 'listed', 'beta']) assert.throws(() => kanalAusUmgebung({ VEIL_KANAL: schlecht }), /VEIL_KANAL/);
  assert.throws(() => geckoEinstellungen('x'), /unbekannt/);
});

test('Manifest: unlisted hat update_url, amo nicht, sonst identisch', () => {
  const u = geckoEinstellungen('unlisted');
  const a = geckoEinstellungen('amo');
  assert.equal(u.gecko.update_url, UPDATE_URL);
  assert.equal('update_url' in a.gecko, false);
  const { update_url, ...restU } = u.gecko;
  assert.deepEqual(restU, a.gecko);
  assert.deepEqual(u.gecko_android, a.gecko_android);
  assert.equal(a.gecko.id, 'veil@hypnomia');
  assert.equal(a.gecko.strict_min_version, '128.0');
  assert.deepEqual(a.gecko.data_collection_permissions, { required: ['none'] });
  assert.equal(a.gecko_android.strict_min_version, '128.0');
});

test('Baudatum: Umgebung gewinnt, ohne Variable die Uhr, Ungueltiges bricht ab', () => {
  assert.equal(baudatumAusUmgebung({ VEIL_BAUDATUM: '2026-11-06' }), '2026-11-06');
  assert.equal(baudatumAusUmgebung({}, new Date(2027, 0, 5)), '2027-01-05');
  for (const schlecht of ['', '2026-13-01', '2026-02-30', '26-11-06', '2026-1-6', '06.11.2026', '2026-11-06x']) {
    assert.throws(() => baudatumAusUmgebung({ VEIL_BAUDATUM: schlecht }), /VEIL_BAUDATUM/, schlecht);
  }
});

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH2 = `sha256:${'b'.repeat(64)}`;

test('updates.json: neuer Eintrag, alte bleiben, gleiche Version wird ersetzt', () => {
  const leer = { addons: { 'veil@hypnomia': { updates: [] } } };
  const eins = traegeUpdateEin(leer, { version: '0.8.0', link: 'https://example.org/a.xpi', hash: HASH });
  assert.deepEqual(eins.addons['veil@hypnomia'].updates, [{ version: '0.8.0', update_link: 'https://example.org/a.xpi', update_hash: HASH }]);
  assert.deepEqual(leer.addons['veil@hypnomia'].updates, [], 'Eingabe bleibt unveraendert');
  const zwei = traegeUpdateEin(eins, { version: '0.8.1', link: 'https://example.org/b.xpi', hash: HASH2 });
  assert.deepEqual(zwei.addons['veil@hypnomia'].updates.map((e) => e.version), ['0.8.0', '0.8.1']);
  const ersetzt = traegeUpdateEin(zwei, { version: '0.8.0', link: 'https://example.org/c.xpi', hash: HASH2 });
  assert.equal(ersetzt.addons['veil@hypnomia'].updates.length, 2);
  assert.equal(ersetzt.addons['veil@hypnomia'].updates[0].update_link, 'https://example.org/c.xpi');
  assert.equal(ersetzt.addons['veil@hypnomia'].updates[1].version, '0.8.1');
  const ausNichts = traegeUpdateEin(undefined, { version: '1.0.0', link: 'http://10.0.2.2:1/x.xpi', hash: HASH });
  assert.equal(ausNichts.addons['veil@hypnomia'].updates.length, 1);
});

test('updates.json: ungueltige Eingaben brechen ab', () => {
  assert.throws(() => traegeUpdateEin({}, { version: 'x', link: 'https://a.b/c', hash: HASH }), /Version/);
  assert.throws(() => traegeUpdateEin({}, { version: '1.0.0', link: 'ftp://a', hash: HASH }), /update_link/);
  assert.throws(() => traegeUpdateEin({}, { version: '1.0.0', link: 'https://a.b/c', hash: 'abc' }), /update_hash/);
});

test('Signieren: Argumente ohne Schluessel, nur unlisted, Quellcode-Upload optional', () => {
  const mit = signierArgumente({ quellordner: 'a', ausgabeordner: 'b', quellzip: 'q.zip' });
  assert.deepEqual(mit, ['sign', '--no-config-discovery', '--source-dir', 'a', '--artifacts-dir', 'b', '--channel', 'unlisted', '--upload-source-code', 'q.zip']);
  assert.ok(!signierArgumente({ quellordner: 'a', ausgabeordner: 'b' }).includes('--upload-source-code'));
  assert.ok(!mit.some((t) => /api|key|secret/i.test(t)));
  assert.throws(() => signierArgumente({ quellordner: 'a', ausgabeordner: 'b', kanal: 'amo' }), /unlisted/);
  assert.equal(schwaerze('x geheim y', ['geheim']), 'x *** y');
});

test('Release-Skript: Befehlszeile', () => {
  assert.deepEqual(leseArgumente(['--kanal', 'amo', '--nachbau']), { kanal: 'amo', nachbau: true, signieren: false, updates: null });
  assert.equal(leseArgumente(['--kanal', 'unlisted', '--nachbau', '--signieren']).signieren, true);
  assert.throws(() => leseArgumente(['--kanal', 'unlisted', '--signieren']), /--nachbau/);
  assert.equal(leseArgumente(['--updates', 'https://example.org/a.xpi']).kanal, null);
  assert.throws(() => leseArgumente([]), /--kanal/);
  assert.throws(() => leseArgumente(['--kanal', 'beta']), /unbekannt/);
  assert.throws(() => leseArgumente(['--kanal', 'amo', '--nachbau', '--signieren']), /unlisted/);
  assert.throws(() => leseArgumente(['--kanal', 'amo', '--updates', 'https://a.b/c']), /unlisted/);
  assert.throws(() => leseArgumente(['--kanal', 'unlisted', '--updates', 'nope']), /Adresse/);
  assert.throws(() => leseArgumente(['--kanal', 'unlisted', '--wirr']), /Unbekanntes/);
});

test('BUILD.md: nennt Befehle, Versionen und Bilder, ohne Pfade', () => {
  const md = baueBuildMd({
    version: '0.8.0', kanal: 'amo', baudatum: '2026-11-06', system: 'macOS 99, arm64', node: 'v99.0.0', npm: '99.0.0',
    ort: { version: '1.2.3' }, modelle: [{ name: 'public/modelle/m.onnx', beschreibung: 'Modell', sha256: 'ab' }], kern: ['kern-01.webp'], chibi: [],
  });
  assert.ok(md.includes(bauBefehl({ kanal: 'amo', baudatum: '2026-11-06' })));
  for (const teil of ['npm ci --ignore-scripts', 'npx wxt prepare', 'v99.0.0', '99.0.0', 'macOS 99', 'onnxruntime-web 1.2.3', 'https://www.npmjs.com/package/onnxruntime-web', 'kern-01.webp', 'VEIL_KERN=extern/kern', 'VEIL_CHIBI=extern/chibi']) {
    assert.ok(md.includes(teil), teil);
  }
  assert.ok(!md.includes('—') && !md.includes('–'));
});

test('Update-Test-Erweiterung: Manifest', async () => {
  const { manifestFuer, UPDATE_TEST_URL } = await import('../android/update-test/erzeuge.mjs');
  const m = manifestFuer('1.1.0');
  assert.equal(m.version, '1.1.0');
  assert.equal(m.browser_specific_settings.gecko.id, 'veil-updatetest@hypnomia');
  assert.equal(m.browser_specific_settings.gecko.update_url, 'https://127.0.0.1:47177/updates.json');
  assert.equal(UPDATE_TEST_URL, m.browser_specific_settings.gecko.update_url);
  assert.equal(m.permissions, undefined);
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.throws(() => manifestFuer('1.0'), /ungueltig/);
});

test('Signieren: Schwaerzung ueber Blockgrenzen, geerbte WEB_EXT_* fallen weg', () => {
  const ausgabe = [];
  const z = zeilenSchwaerzer({ write: (t) => ausgabe.push(t) }, ['geheimwert']);
  z.schreibe('Schluessel geheim');
  z.schreibe('wert Ende\nzweite Zeile');
  z.ende();
  assert.equal(ausgabe.join(''), 'Schluessel *** Ende\nzweite Zeile');
  const env = signierUmgebung({ PATH: '/bin', WEB_EXT_API_KEY: 'alt', WEB_EXT_API_SECRET: 'alt', WEB_EXT_CHANNEL: 'listed' }, 'i', 's');
  assert.deepEqual(env, { PATH: '/bin', WEB_EXT_API_KEY: 'i', WEB_EXT_API_SECRET: 's' });
});

test('Testhaken-Gegenprobe: fehlende Spuren werden genannt', async () => {
  const { fehlendeSpuren, SPUREN_IM_TESTBAU } = await import('../../scripts/testhaken-spuren.mjs');
  const alle = Object.fromEntries(SPUREN_IM_TESTBAU.map((m) => [m, ['x']]));
  assert.deepEqual(fehlendeSpuren({ treffer: alle }), []);
  assert.deepEqual(fehlendeSpuren({ treffer: { ...alle, 'veil-test': [] } }), ['veil-test']);
});
