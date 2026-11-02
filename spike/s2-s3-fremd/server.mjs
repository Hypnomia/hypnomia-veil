// WEGWERF-Messcode (Spike S2/S3), kein Produktcode.
// Lokaler Testserver auf zwei Ports (haupt und fremd), nur 127.0.0.1.
// Beide Ports liefern dieselben Routen; der fremde Port ist ein anderer Ursprung.
// Zweck: messen, ob eine Erweiterung fremde Bilder und Videos nachladen und lesen kann.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repoWurzel = path.resolve(hier, '..', '..');
const ausgabe = path.join(repoWurzel, '.output', 'spike-s2');
const HOST = '127.0.0.1';
const FFMPEG = process.env.VEIL_FFMPEG ?? (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

// ---------- Medien einmalig erzeugen ----------

async function erzeugeTestbild() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff3d71"/><stop offset="0.5" stop-color="#ffd166"/><stop offset="1" stop-color="#2ec4b6"/>
    </linearGradient></defs>
    <rect width="640" height="480" fill="url(#g)"/>
    <text x="320" y="250" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="bold" fill="#101010" text-anchor="middle">S2 TESTBILD</text>
    <text x="320" y="310" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#101010" text-anchor="middle">640 x 480</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function ladeRiesig() {
  const datei = path.join(ausgabe, 'riesig.jpg');
  if (fs.existsSync(datei)) return fs.readFileSync(datei);
  const b = 8000;
  // Farbverlauf mit Muster und Rauschen (sharp), damit die Datei nicht trivial klein wird.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b}" height="${b}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6a00f4"/><stop offset="0.5" stop-color="#f15bb5"/><stop offset="1" stop-color="#00f5d4"/>
      </linearGradient>
      <pattern id="p" width="200" height="200" patternUnits="userSpaceOnUse">
        <circle cx="100" cy="100" r="70" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="6"/>
        <path d="M0 0L200 200M200 0L0 200" stroke="#fff" stroke-opacity="0.25" stroke-width="3"/>
      </pattern>
    </defs>
    <rect width="${b}" height="${b}" fill="url(#g)"/>
    <rect width="${b}" height="${b}" fill="url(#p)"/>
    <text x="${b / 2}" y="${b / 2}" font-family="Helvetica, Arial, sans-serif" font-size="900" font-weight="bold" fill="#fff" text-anchor="middle">8000</text>
  </svg>`;
  const rauschen = await sharp({ create: { width: b, height: b, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).raw().toBuffer();
  const puffer = await sharp(Buffer.from(svg), { limitInputPixels: false })
    .composite([{ input: rauschen, raw: { width: b, height: b, channels: 3 }, blend: 'soft-light' }])
    .jpeg({ quality: 70 }).toBuffer();
  fs.mkdirSync(ausgabe, { recursive: true });
  fs.writeFileSync(datei, puffer);
  return puffer;
}

function sorgeFuerVideos() {
  fs.mkdirSync(ausgabe, { recursive: true });
  const normal = path.join(ausgabe, 'test.mp4');
  const frag = path.join(ausgabe, 'test-frag.mp4');
  if (!fs.existsSync(normal)) {
    // 3 Sekunden 320x240, je Sekunde rot, gruen, blau. Baseline-Profil, ein Keyframe je Sekunde.
    execFileSync(FFMPEG, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1:r=25',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=1:r=25',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=25',
      '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0,format=yuv420p',
      '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
      '-g', '25', '-keyint_min', '25', '-sc_threshold', '0',
      '-movflags', '+faststart', '-an', normal,
    ]);
  }
  if (!fs.existsSync(frag)) {
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', normal, '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', frag]);
  }
  return { normal: fs.readFileSync(normal), frag: fs.readFileSync(frag) };
}

// avc1-Codecstring aus der avcC-Box der fragmentierten Datei lesen (Profil, Kompatibilitaet, Level).
function lesCodec(puffer) {
  const i = puffer.indexOf('avcC');
  if (i < 0) return 'avc1.42E01E';
  const hex = (n) => puffer[i + 4 + n].toString(16).padStart(2, '0');
  return `avc1.${hex(1)}${hex(2)}${hex(3)}`.toUpperCase().replace('AVC1', 'avc1');
}

// ---------- Server ----------

const CORS = { 'access-control-allow-origin': '*' };
const meta = new Set(['/zaehler.json', '/zaehler/reset', '/protokoll.json', '/protokoll/reset']);

function ursprungVon(wert) {
  try { return new URL(wert).origin; } catch { return null; }
}

function parseRange(kopf, gesamt) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(kopf ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let ende;
  if (m[1] === '') { // letzte n Bytes
    const n = Number(m[2]);
    start = Math.max(0, gesamt - n); ende = gesamt - 1;
  } else {
    start = Number(m[1]);
    ende = m[2] === '' ? gesamt - 1 : Math.min(Number(m[2]), gesamt - 1);
  }
  if (start > ende || start >= gesamt) return 'ungueltig';
  return { start, ende };
}

export async function starteS2Server(optionen = {}) {
  const port = Number(optionen.port ?? process.env.VEIL_S2_PORT ?? 47184);
  const port2 = Number(optionen.port2 ?? process.env.VEIL_S2_PORT2 ?? 47185);
  const stumm = optionen.stumm ?? false;

  const bild = await erzeugeTestbild();
  const riesig = await ladeRiesig();
  const videos = sorgeFuerVideos();
  const codec = lesCodec(videos.frag);
  const seiten = {
    '/videos.html': fs.readFileSync(path.join(hier, 'seiten', 'videos.html'), 'utf8'),
    '/bilder.html': fs.readFileSync(path.join(hier, 'seiten', 'bilder.html'), 'utf8'),
  };

  function baueServer(eigenerPort, andererPort) {
    // Zustand je Port: Zaehler und Protokoll.
    let zaehler = {};
    let protokoll = [];
    let seit = new Date().toISOString();

    const handler = (req, res) => {
      const url = new URL(req.url, `http://${HOST}`);
      const route = url.pathname;
      const host = req.headers.host ?? `${HOST}:${eigenerPort}`;
      const eigenerUrsprung = `http://${host}`;
      const referer = req.headers.referer ?? null;
      const cookieKopf = req.headers.cookie ?? '';
      const hatCookie = /(?:^|;\s*)s2test=1(?:;|$)/.test(cookieKopf);

      const antworte = (status, kopf, koerper) => {
        const laenge = koerper ? koerper.length : 0;
        res.writeHead(status, { 'content-length': laenge, 'cache-control': 'no-store', ...kopf });
        res.end(req.method === 'HEAD' ? undefined : koerper);
        if (meta.has(route)) return;
        const z = (zaehler[route] ??= { anfragen: 0, bytes: 0 });
        z.anfragen += 1;
        if (req.method !== 'HEAD') z.bytes += laenge;
        const secFetch = {};
        for (const [k, w] of Object.entries(req.headers)) if (k.startsWith('sec-fetch-')) secFetch[k] = w;
        protokoll.push({
          route, methode: req.method, status,
          refererVorhanden: referer !== null,
          refererHerkunft: referer ? ursprungVon(referer) : null,
          cookie: hatCookie,
          range: req.headers.range ?? null,
          secFetch,
          zeit: new Date().toISOString(),
        });
      };
      const json = (obj) => antworte(200, { 'content-type': 'application/json; charset=utf-8', ...CORS }, Buffer.from(JSON.stringify(obj, null, 2)));
      const text = (status, t, extra = {}) => antworte(status, { 'content-type': 'text/plain; charset=utf-8', ...extra }, Buffer.from(t));
      const sendeBild = (puffer, mitCors) => antworte(200, { 'content-type': 'image/jpeg', ...(mitCors ? CORS : {}) }, puffer);

      // Preflight fuer Routen mit CORS.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': 'range, content-type', 'content-length': 0 });
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'nur GET und HEAD');

      switch (route) {
        case '/ok.jpg': return sendeBild(bild, true);
        case '/403-ohne-referer.jpg':
          return referer === null ? text(403, 'Referer fehlt', CORS) : sendeBild(bild, true);
        case '/403-fremder-referer.jpg': {
          const ok = referer !== null && (referer === eigenerUrsprung || referer.startsWith(`${eigenerUrsprung}/`));
          return ok ? sendeBild(bild, true) : text(403, 'Referer nicht vom eigenen Ursprung', CORS);
        }
        case '/kein-cors.jpg': return sendeBild(bild, false);
        case '/langsam.jpg': return void setTimeout(() => sendeBild(bild, true), 2000);
        case '/riesig.jpg': return sendeBild(riesig, false);
        case '/cookie.jpg': return hatCookie ? sendeBild(bild, true) : text(403, 'Cookie s2test=1 fehlt', CORS);
        case '/setze-cookie':
          return text(200, 'Cookie s2test=1 gesetzt', { 'set-cookie': 's2test=1; Path=/; SameSite=Lax' });
        case '/video.mp4': return sendeVideo(videos.normal, false);
        case '/video-cors.mp4': return sendeVideo(videos.normal, true);
        case '/video-frag.mp4': return sendeVideo(videos.frag, true);
        case '/zaehler.json': return json({ port: eigenerPort, seit, routen: zaehler });
        case '/zaehler/reset': zaehler = {}; seit = new Date().toISOString(); return json({ ok: true });
        case '/protokoll.json': return json({ port: eigenerPort, seit, eintraege: protokoll });
        case '/protokoll/reset': protokoll = []; return json({ ok: true });
        case '/videos.html':
        case '/bilder.html': {
          const html = seiten[route].replaceAll('{{PORT2}}', String(andererPort)).replaceAll('{{CODEC}}', codec);
          return antworte(200, { 'content-type': 'text/html; charset=utf-8' }, Buffer.from(html));
        }
        default: return text(404, 'unbekannte Route');
      }

      function sendeVideo(puffer, mitCors) {
        const kopf = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', ...(mitCors ? { ...CORS, 'access-control-expose-headers': 'content-range, accept-ranges, content-length' } : {}) };
        const r = parseRange(req.headers.range, puffer.length);
        if (r === 'ungueltig') {
          return antworte(416, { ...kopf, 'content-range': `bytes */${puffer.length}` }, undefined);
        }
        if (r) {
          return antworte(206, { ...kopf, 'content-range': `bytes ${r.start}-${r.ende}/${puffer.length}` }, puffer.subarray(r.start, r.ende + 1));
        }
        return antworte(200, kopf, puffer);
      }
    };

    return http.createServer(handler);
  }

  const haupt = baueServer(port, port2);
  const fremd = baueServer(port2, port);
  await new Promise((ok, fehler) => { haupt.once('error', fehler); haupt.listen(port, HOST, ok); });
  await new Promise((ok, fehler) => { fremd.once('error', fehler); fremd.listen(port2, HOST, ok); });
  if (!stumm) console.log(`S2-Server: haupt http://${HOST}:${port}  fremd http://${HOST}:${port2}  (Codec ${codec})`);

  return {
    port, port2, codec,
    schliessen: () => Promise.all([haupt, fremd].map((s) => new Promise((ok) => { s.closeAllConnections?.(); s.close(ok); }))),
  };
}

// Direktaufruf: dauerhaft laufen lassen.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  starteS2Server().catch((e) => { console.error(e); process.exit(1); });
}
