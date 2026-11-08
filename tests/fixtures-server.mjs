// Statischer Testserver fuer tests/fixtures (nur node:http und sharp, keine weitere Abhaengigkeit).
// Routen:
//   /<name>.html                 Seiten aus tests/fixtures/
//   /testbild/sfw/<name>         Testbilder aus ../05 Testbilder/sfw (nie im Repo), /testbild/nsfw/<name> entsprechend
//   /api/testbilder?satz=sfw     Namensliste des Satzes (JSON)
//   /synthetisch/<n>.png         Farbverlauf 640 x 480, zur Laufzeit erzeugt (n aendert die Farbe)
//   /soll-zonen.json             Soll-Zonen aus ../05 Testbilder/
//   /umleiten?ziel=<adresse>     302-Weiterleitung auf <adresse> (nur http://127.0.0.1 und http://localhost; Netzgrenze-Tests)
//   ?immer403=1                  jede Antwort 403; ?nurReferer=1: 403 ohne Referer von 127.0.0.1 oder localhost (Hotlink-Schutz)
// Zweiter Ursprung: derselbe Server auf einem zweiten Port (fremde Bilder). Bilder mit ?cors=1 bekommen CORS-Kopfzeilen, ohne nicht.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(hier, 'fixtures');
const testbilder = path.resolve(hier, '../../05 Testbilder');
export const STANDARD_PORT = 47173;
export const STANDARD_PORT_FREMD = 47175;

const ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function leseSatz(satz) {
  try {
    const eintraege = await readdir(path.join(testbilder, satz), { withFileTypes: true });
    return eintraege
      .filter((e) => e.isFile() && !e.name.startsWith('.') && ENDUNGEN.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  } catch {
    return [];
  }
}

const synthetisch = new Map();
async function synthetischesBild(n) {
  if (synthetisch.has(n)) return synthetisch.get(n);
  const { default: sharp } = await import('sharp');
  const breite = 640;
  const hoehe = 480;
  const px = Buffer.alloc(breite * hoehe * 3);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const i = (y * breite + x) * 3;
      px[i] = (x * 255) / breite;
      px[i + 1] = (y * 255) / hoehe;
      px[i + 2] = (n * 37) % 256;
    }
  }
  const png = await sharp(px, { raw: { width: breite, height: hoehe, channels: 3 } }).png().toBuffer();
  synthetisch.set(n, png);
  return png;
}

function sende(res, status, typ, inhalt, zusatz = {}) {
  res.writeHead(status, { 'Content-Type': typ, 'Cache-Control': 'no-store', ...zusatz });
  res.end(inhalt);
}

export function starteFixtureServer(port = STANDARD_PORT) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pfad = decodeURIComponent(url.pathname);
      const cors = url.searchParams.get('cors') === '1' ? { 'Access-Control-Allow-Origin': '*' } : {};
      // Fehlerpfade (Entscheidung 21): ?immer403=1 verweigert jeden Abruf; ?nurReferer=1 verweigert Abrufe ohne Referer
      // von einer lokalen Seite (Hotlink-Schutz). Die Seite selbst schickt einen Referer, der Erkenner erst nach der Referer-Regel.
      if (url.searchParams.get('immer403') === '1') return sende(res, 403, 'text/plain', 'verweigert');
      if (url.searchParams.get('nurReferer') === '1') {
        const referer = String(req.headers.referer ?? '');
        if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(referer)) return sende(res, 403, 'text/plain', 'verweigert: Referer fehlt');
      }
      if (pfad === '/umleiten') {
        const ziel = url.searchParams.get('ziel') ?? '';
        if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(ziel)) return sende(res, 400, 'text/plain', 'ziel nicht erlaubt');
        res.writeHead(302, { Location: ziel, 'Cache-Control': 'no-store', ...cors });
        return res.end();
      }
      if (pfad === '/api/testbilder') {
        const satz = url.searchParams.get('satz') === 'nsfw' ? 'nsfw' : 'sfw';
        return sende(res, 200, TYPEN['.json'], JSON.stringify({ satz, bilder: await leseSatz(satz) }), cors);
      }
      if (pfad === '/soll-zonen.json') {
        return sende(res, 200, TYPEN['.json'], await readFile(path.join(testbilder, 'soll-zonen.json')), cors);
      }
      const synth = /^\/synthetisch\/(\d{1,3})\.png$/.exec(pfad);
      if (synth) return sende(res, 200, TYPEN['.png'], await synthetischesBild(Number(synth[1])), cors);
      const bild = /^\/testbild\/(sfw|nsfw)\/([^/]+)$/.exec(pfad);
      if (bild) {
        const namen = await leseSatz(bild[1]);
        if (!namen.includes(bild[2])) throw new Error('unbekanntes Testbild');
        const typ = TYPEN[path.extname(bild[2]).toLowerCase()] ?? 'application/octet-stream';
        return sende(res, 200, typ, await readFile(path.join(testbilder, bild[1], bild[2])), cors);
      }
      const datei = path.join(fixtures, path.normalize(pfad === '/' ? '/hello.html' : pfad));
      if (!datei.startsWith(fixtures)) throw new Error('ausserhalb');
      const typ = TYPEN[path.extname(datei).toLowerCase()] ?? 'application/octet-stream';
      return sende(res, 200, typ, await readFile(datei), cors);
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

// Direktaufruf (Playwright webServer, Handtests): Hauptserver und zweiten Ursprung dauerhaft laufen lassen.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.VEIL_FIXTURE_PORT ?? STANDARD_PORT);
  const portFremd = Number(process.env.VEIL_FIXTURE_PORT_FREMD ?? STANDARD_PORT_FREMD);
  await starteFixtureServer(port);
  await starteFixtureServer(portFremd);
  console.log(`Fixture-Server auf Port ${port} (zweiter Ursprung ${portFremd})`);
}
