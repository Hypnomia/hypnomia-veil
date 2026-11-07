// Update-Test-Erweiterung fuer Android (Session 14, Auftrag R), getrennt vom Produkt.
//   node tests/android/update-test/erzeuge.mjs <version>        (zum Beispiel 1.0.0 und 1.1.0)
// Erzeugt eine winzige Erweiterung (ID veil-updatetest@hypnomia, ein Hintergrundskript ohne Rechte, das nichts setzt) nach
// .output-updatetest/<version>/ und daneben veil-updatetest-<version>.zip. update_url zeigt per https auf 127.0.0.1:47177 im Emulator (adb reverse zum Mac; der AMO-Linter lehnt http ab, Session 14).
// Signieren: scripts/release/signieren.mjs (signiere mit diesem Ordner, ohne quellzip). Das Skript selbst signiert nie.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const UPDATE_TEST_ID = 'veil-updatetest@hypnomia';
export const UPDATE_TEST_URL = 'https://127.0.0.1:47177/updates.json';

export function manifestFuer(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Version "${version}" ist ungueltig (erwartet 1.0.0)`);
  return {
    manifest_version: 3,
    name: 'Veil Update Test',
    version,
    description: 'Test extension for the update path. Does nothing.',
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: UPDATE_TEST_ID,
        strict_min_version: '128.0',
        update_url: UPDATE_TEST_URL,
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '128.0' },
    },
  };
}

export function erzeuge(version) {
  const manifest = manifestFuer(version);
  const ordner = path.join(wurzel, '.output-updatetest', version);
  rmSync(ordner, { recursive: true, force: true });
  mkdirSync(ordner, { recursive: true });
  writeFileSync(path.join(ordner, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(ordner, 'background.js'), '// Veil Update Test: tut nichts. Die Version steht im Manifest.\n');
  const zip = path.join(wurzel, '.output-updatetest', `veil-updatetest-${version}.zip`);
  rmSync(zip, { force: true });
  const z = spawnSync('zip', ['-q', '-X', '-r', zip, '.'], { cwd: ordner, encoding: 'utf8' });
  if (z.status !== 0) throw new Error(`zip fehlgeschlagen: ${z.stderr || z.error}`);
  return { ordner, zip };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { ordner, zip } = erzeuge(process.argv[2]);
    console.log(`Ordner: ${path.relative(wurzel, ordner)}\nZip: ${path.relative(wurzel, zip)}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
