// Eigener Mini-Server fuer die Version-Tests (Auftrag V): liefert version.json in Varianten und zaehlt die Abrufe je Pfad.
// Die Tests treffen nie das echte GitHub. Pfade: /v/9.9.9.json (neuere Version), /v/0.6.1.json (gleich), /v/404.json (404),
// /v/kaputt.json (kein JSON), /v/falsch.json (JSON, aber ohne gueltige Version),
// /v/vorab.json (9.9.9-beta), /v/gross.json (ueber 4 KB), /v/langsam.json (9.9.9 nach 2,5 s), /v/umleiten.json (302 auf 9.9.9.json). Mit CORS-Kopf, damit der Abruf nie am Browser scheitert.
import { createServer } from 'node:http';

export const VERSION_PORT = Number(process.env.VEIL_VERSION_PORT ?? 47487);

const ANTWORTEN = {
  '/v/9.9.9.json': [200, JSON.stringify({ version: '9.9.9', datum: '2030-01-01' })],
  '/v/0.6.1.json': [200, JSON.stringify({ version: '0.6.1', datum: '2026-11-05' })],
  '/v/404.json': [404, 'nicht gefunden'],
  '/v/kaputt.json': [200, '{ das ist kein json'],
  '/v/falsch.json': [200, JSON.stringify({ version: 'neu', datum: 5 })],
  '/v/vorab.json': [200, JSON.stringify({ version: '9.9.9-beta', datum: '2030-01-01' })],
  '/v/gross.json': [200, JSON.stringify({ version: '9.9.9', datum: '2030-01-01', fuell: 'x'.repeat(6000) })],
  '/v/langsam.json': [200, JSON.stringify({ version: '9.9.9', datum: '2030-01-01' }), 2500],
  '/v/umleiten.json': [302, '', 0, '/v/9.9.9.json'],
};

export function starteVersionServer(port = VERSION_PORT) {
  const zaehler = {};
  const kopfzeilen = [];
  const server = createServer((req, res) => {
    const pfad = new URL(req.url ?? '/', 'http://localhost').pathname;
    zaehler[pfad] = (zaehler[pfad] ?? 0) + 1;
    kopfzeilen.push({ pfad, cookie: req.headers.cookie ?? null, auth: req.headers.authorization ?? null, cache: req.headers['cache-control'] ?? null });
    const [status, inhalt, verzoegerung = 0, ziel] = ANTWORTEN[pfad] ?? [404, 'nicht gefunden'];
    const antworte = () => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        ...(ziel ? { Location: ziel } : {}),
      });
      res.end(inhalt);
    };
    if (verzoegerung > 0) setTimeout(antworte, verzoegerung);
    else antworte();
  });
  const gesamt = () => Object.values(zaehler).reduce((a, b) => a + b, 0);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        zaehler,
        kopfzeilen,
        gesamt,
        adresse: (name) => `http://127.0.0.1:${port}/v/${name}`,
        schliesse: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      }),
    );
  });
}
