// Kleiner statischer Server fuer tests/fixtures (nur node:http, keine weitere Abhaengigkeit).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const STANDARD_PORT = 47173;

export function starteFixtureServer(port = STANDARD_PORT) {
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const datei = path.join(wurzel, path.normalize(name === '/' ? '/hello.html' : name));
      if (!datei.startsWith(wurzel)) throw new Error('ausserhalb');
      const inhalt = await readFile(datei);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(inhalt);
    } catch {
      res.writeHead(404);
      res.end('nicht gefunden');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Direktaufruf (Playwright webServer): Server dauerhaft laufen lassen.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.VEIL_FIXTURE_PORT ?? STANDARD_PORT);
  await starteFixtureServer(port);
  console.log(`Fixture-Server auf Port ${port}`);
}
