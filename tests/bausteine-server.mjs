// Testserver fuer die Bausteine der Oberflaeche (Phase 11 E4c0): baut das Buendel der Fixture-Seite im Test selbst (rolldown aus node_modules,
// schon da als Teil von wxt) in einen Ordner ausserhalb des Repos und liefert Seite, Buendel, bausteine.css, tokens.css und die Schriften aus.
// Nichts Erzeugtes kommt ins Repo, der Release-Bau und seine Dateiliste bleiben unberuehrt.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '..');

// rolldown ist nur Unterabhaengigkeit (wxt, vite, rolldown): es wird ueber die Kette der Pakete gesucht, nicht ueber einen festen Pfad.
function findePaket(name, von) {
  for (const ordner of createRequire(von).resolve.paths(name) ?? []) {
    const datei = path.join(ordner, name, 'package.json');
    if (existsSync(datei)) return datei;
  }
  throw new Error(`Paket "${name}" nicht gefunden (gesucht ab ${path.basename(path.dirname(von))}): ohne wxt, vite und rolldown in node_modules kann der Test das Buendel nicht bauen`);
}
async function ladeRolldown() {
  let von = path.join(wurzel, 'package.json');
  for (const name of ['wxt', 'vite', 'rolldown']) von = findePaket(name, von);
  const paket = JSON.parse(readFileSync(von, 'utf8'));
  const haupt = typeof paket.exports?.['.'] === 'string' ? paket.exports['.'] : (paket.module ?? paket.main);
  if (!haupt) throw new Error('rolldown: kein Einstieg in package.json');
  return import(pathToFileURL(path.join(path.dirname(von), haupt)).href);
}

export async function starteBausteineServer() {
  const { build } = await ladeRolldown();
  const ordner = await mkdtemp(path.join(tmpdir(), 'veil-bausteine-'));
  try {
    await build({
      input: path.join(hier, 'fixtures/bausteine-seite.ts'),
      cwd: wurzel,
      platform: 'browser',
      output: { dir: ordner, format: 'esm', entryFileNames: 'buendel.js' },
      logLevel: 'silent',
    });
  } catch (fehler) {
    await rm(ordner, { recursive: true, force: true }); // auch nach einem gescheiterten Bau bleibt nichts liegen
    throw fehler;
  }
  const dateien = {
    '/': [path.join(hier, 'fixtures/bausteine.html'), 'text/html; charset=utf-8'],
    '/bausteine.html': [path.join(hier, 'fixtures/bausteine.html'), 'text/html; charset=utf-8'],
    '/buendel.js': [path.join(ordner, 'buendel.js'), 'text/javascript; charset=utf-8'],
    '/bausteine.css': [path.join(wurzel, 'src/oberflaeche/bausteine/bausteine.css'), 'text/css; charset=utf-8'],
    '/tokens.css': [path.join(wurzel, 'src/oberflaeche/design/tokens.css'), 'text/css; charset=utf-8'],
  };
  const server = createServer(async (req, res) => {
    try {
      const pfad = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      let eintrag = dateien[pfad];
      if (!eintrag) {
        const schrift = /^\/schrift\/([\w-]+\.woff2)$/.exec(pfad);
        if (!schrift) throw new Error('unbekannt');
        eintrag = [path.join(wurzel, 'public/schrift', schrift[1]), 'font/woff2'];
      }
      res.writeHead(200, { 'Content-Type': eintrag[1], 'Cache-Control': 'no-store' });
      res.end(await readFile(eintrag[0]));
    } catch {
      res.writeHead(404);
      res.end('nicht gefunden');
    }
  });
  await new Promise((ok, fehler) => {
    server.once('error', fehler);
    server.listen(0, '127.0.0.1', ok);
  }).catch(async (fehler) => {
    await rm(ordner, { recursive: true, force: true });
    throw fehler;
  });
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/`,
    async schliesse() {
      await new Promise((ok) => server.close(ok));
      await rm(ordner, { recursive: true, force: true });
    },
  };
}
