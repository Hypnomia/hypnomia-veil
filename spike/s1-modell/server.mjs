// Wegwerf-Messserver fuer Spike S1 (nur Tempo, kein Produktcode).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ortOrdner = path.join(wurzel, 'node_modules/onnxruntime-web/dist');
// Modell liegt im Elternordner des Repos, relativ aufgeloest.
const modell = path.resolve(wurzel, '../04 Alt-Code Referenz/modelle/640m.onnx');
const port = Number(process.env.VEIL_S1_PORT ?? 47180);

const typen = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

function sendeDatei(res, datei, kopf = {}) {
  if (!existsSync(datei)) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  res.writeHead(200, {
    'content-type': typen[path.extname(datei)] ?? 'application/octet-stream',
    'content-length': statSync(datei).size,
    'cache-control': 'no-store',
    ...kopf,
  });
  createReadStream(datei).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET') {
    if (process.env.VEIL_S1_LOG) console.log('s1-server: GET', url.pathname);
    // Fuer WASM-Threads (SharedArrayBuffer) nur bei ?threads=N isolieren, damit die Basismessung unberuehrt bleibt.
    const isolation = Number(url.searchParams.get('threads') ?? 1) > 1
      ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }
      : {};
    if (url.pathname === '/' || url.pathname === '/index.html') return sendeDatei(res, path.join(hier, 'index.html'), isolation);
    if (url.pathname === '/messung.js') return sendeDatei(res, path.join(hier, 'messung.js'));
    if (url.pathname === '/modell.onnx') return sendeDatei(res, modell);
    if (url.pathname.startsWith('/ort/')) {
      const name = url.pathname.slice(5);
      if (/^[\w.-]+\.(js|mjs|wasm)$/.test(name)) return sendeDatei(res, path.join(ortOrdner, name), { 'cross-origin-resource-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
    }
    return res.writeHead(404).end('nicht gefunden');
  }
  if (req.method === 'POST' && url.pathname === '/api/ergebnis') {
    const teile = [];
    for await (const t of req) teile.push(t);
    try {
      const daten = JSON.parse(Buffer.concat(teile).toString('utf8'));
      const browser = String(daten.browser ?? 'unbekannt').replace(/[^a-z0-9]/gi, '');
      const stempel = new Date().toISOString().replace(/[:.]/g, '-');
      const backend = String(daten.backend ?? 'wasm').replace(/[^a-z0-9-]/gi, '');
      const datei = path.join(hier, `ergebnis-${browser}-${backend}-${stempel}.json`);
      await writeFile(datei, JSON.stringify(daten, null, 2));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, datei: path.basename(datei) }));
    } catch (fehler) {
      res.writeHead(400).end(String(fehler));
    }
    return;
  }
  res.writeHead(404).end('nicht gefunden');
});

server.listen(port, '127.0.0.1', () => console.log(`s1-server: bereit auf ${port}`));
