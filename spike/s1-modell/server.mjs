// Wegwerf-Messserver fuer Spike S1 (Tempo und Treffer, kein Produktcode).
// Liefert Messseite, ORT-Dateien, beide Modelle, die Testbilder (nur 127.0.0.1) und die Soll-Zonen. Nimmt Ergebnisse als JSON entgegen.
import http from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ortOrdner = path.join(wurzel, 'node_modules/onnxruntime-web/dist');
// Modelle und Bilder liegen im Elternordner des Repos, relativ aufgeloest.
const modelle = path.resolve(wurzel, '../04 Alt-Code Referenz/modelle');
const bilder = path.resolve(wurzel, '../05 Testbilder');
const port = Number(process.env.VEIL_S1_PORT ?? 47180);
// Immer nur 127.0.0.1: der Emulator erreicht den Mac-Loopback unter 10.0.2.2.
const host = '127.0.0.1';
const ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const typen = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function leseSatz(satz) {
  try {
    return readdirSync(path.join(bilder, satz), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.') && ENDUNGEN.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
}

function sendeDatei(res, datei, kopf = {}) {
  if (!existsSync(datei)) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  res.writeHead(200, {
    'content-type': typen[path.extname(datei).toLowerCase()] ?? 'application/octet-stream',
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
    if (url.pathname === '/bruecke.html') return sendeDatei(res, path.join(hier, '..', 'erweiterung', 'bruecke.html'));
    if (url.pathname === '/modell.onnx') return sendeDatei(res, path.join(modelle, '640m.onnx'));
    if (url.pathname === '/modell/640m.onnx' || url.pathname === '/modell/320n.onnx') return sendeDatei(res, path.join(modelle, path.basename(url.pathname)));
    if (url.pathname === '/soll-zonen.json') return sendeDatei(res, path.join(bilder, 'soll-zonen.json'));
    if (url.pathname === '/api/bilder') {
      const liste = [];
      for (const satz of ['nsfw', 'sfw']) for (const name of leseSatz(satz)) liste.push({ satz, name });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(liste));
      return;
    }
    if (url.pathname.startsWith('/bild/')) {
      const [satz, ...rest] = url.pathname.slice(6).split('/');
      const name = decodeURIComponent(rest.join('/'));
      if (['nsfw', 'sfw'].includes(satz) && leseSatz(satz).includes(name)) return sendeDatei(res, path.join(bilder, satz, name));
      return res.writeHead(404).end('nicht gefunden');
    }
    if (url.pathname.startsWith('/ort/')) {
      const name = url.pathname.slice(5);
      if (/^[\w.-]+\.(js|mjs|wasm)$/.test(name)) return sendeDatei(res, path.join(ortOrdner, name), { 'cross-origin-resource-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
    }
    return res.writeHead(404).end('nicht gefunden');
  }
  // Schreibzugriffe nur aus Erweiterungen oder von lokalen Seiten; Groesse begrenzt.
  if (req.method === 'POST') {
    const herkunft = req.headers.origin ?? '';
    const erlaubt = herkunft === '' || /^(chrome|moz)-extension:\/\//.test(herkunft) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(herkunft);
    if (!erlaubt) { res.writeHead(403).end('Herkunft nicht erlaubt'); return; }
    if (Number(req.headers['content-length'] ?? 0) > 50 * 1024 * 1024) { res.writeHead(413).end('zu gross'); return; }
  }
  if (req.method === 'POST' && url.pathname === '/api/ergebnis-s2') {
    // S2/S3-Ergebnisse (nur Hosts, Statuscodes, Zeiten) nach spike/erweiterung/.
    const teile = [];
    for await (const t of req) teile.push(t);
    try {
      const daten = JSON.parse(Buffer.concat(teile).toString('utf8'));
      const browser = String(daten.browser ?? 'unbekannt').replace(/[^a-z0-9-]/gi, '');
      const seite = String(daten.seite ?? '').replace(/[^a-z0-9.-]/gi, '').slice(0, 40);
      const stempel = new Date().toISOString().replace(/[:.]/g, '-');
      const datei = path.join(hier, '..', 'erweiterung', `ergebnis-s2-${browser}-${seite}-${stempel}.json`);
      await writeFile(datei, JSON.stringify(daten, null, 2));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ ok: true, datei: path.basename(datei) }));
    } catch (fehler) {
      res.writeHead(400).end(String(fehler));
    }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/ergebnis') {
    const teile = [];
    for await (const t of req) teile.push(t);
    try {
      const daten = JSON.parse(Buffer.concat(teile).toString('utf8'));
      const browser = String(daten.browser ?? 'unbekannt').replace(/[^a-z0-9]/gi, '');
      const stempel = new Date().toISOString().replace(/[:.]/g, '-');
      const backend = String(daten.backend ?? 'wasm').replace(/[^a-z0-9-]/gi, '');
      const modell = String(daten.modell ?? '').replace(/[^a-z0-9]/gi, '');
      const kanal = String(daten.kanal ?? '').replace(/[^a-z0-9]/gi, '');
      const schwelle = daten.schwelle !== undefined ? `-s${String(daten.schwelle).replace('.', '')}` : '';
      const pad = daten.pad && daten.pad !== 'ru' ? `-${daten.pad}` : '';
      const datei = path.join(hier, `ergebnis-${browser}-${backend}${modell ? `-${modell}` : ''}${kanal ? `-${kanal}` : ''}${schwelle}${pad}-${stempel}.json`);
      await writeFile(datei, JSON.stringify(daten, null, 2));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, datei: path.basename(datei) }));
    } catch (fehler) {
      res.writeHead(400).end(String(fehler));
    }
    return;
  }
  res.writeHead(404).end('nicht gefunden');
});

server.listen(port, host, () => console.log(`s1-server: bereit auf ${host}:${port}`));
