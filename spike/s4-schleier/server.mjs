// Wegwerf-Messserver fuer S4 (Schleier vor dem ersten Zeichnen). Kein Produktcode.
// Zwei Ports auf 127.0.0.1: "haupt" (Standard 47182) und "fremd" (Standard 47183).
// Beide liefern dieselben Routen; das fremde iframe kommt vom jeweils anderen Ursprung.
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const bilderSfw = path.resolve(wurzel, '../05 Testbilder/sfw');
const ausgabe = path.join(wurzel, '.output/spike-s4');
const mp4Pfad = path.join(ausgabe, 'magenta.mp4');
const ffmpeg = process.env.VEIL_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const host = '127.0.0.1';

const ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const typen = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.html': 'text/html; charset=utf-8',
};

// Dateiliste wie in spike/s1-modell/server.mjs (leseSatz), hier nur fuer den Ordner sfw.
function leseSatz() {
  try {
    return readdirSync(bilderSfw, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.') && ENDUNGEN.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
}

// Vollflaechiges Magenta, 200x200, zur Laufzeit erzeugt (kommt nie ins Repo).
async function erzeugePng() {
  return sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer();
}

// Einmalig per ffmpeg; ohne ffmpeg bleibt die Route bei 404.
function sorgeFuerMp4() {
  if (existsSync(mp4Pfad)) return true;
  mkdirSync(ausgabe, { recursive: true });
  const lauf = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0xFF00FF:s=200x200:d=2:r=25',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart',
    mp4Pfad,
  ], { encoding: 'utf8' });
  if (lauf.error || lauf.status !== 0 || !existsSync(mp4Pfad)) {
    console.warn(`s4-server: ffmpeg fehlt oder scheiterte (${ffmpeg}), /magenta.mp4 liefert 404.`, lauf.error?.message ?? lauf.stderr ?? '');
    return false;
  }
  return true;
}

// Dateiauslieferung mit Range-Unterstuetzung (Video braucht das).
function sendeDatei(req, res, datei) {
  if (!existsSync(datei)) return res.writeHead(404).end('nicht gefunden');
  const groesse = statSync(datei).size;
  const kopf = {
    'content-type': typen[path.extname(datei).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
  };
  const bereich = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (bereich) {
    const von = bereich[1] === '' ? Math.max(0, groesse - Number(bereich[2])) : Number(bereich[1]);
    const bis = bereich[1] === '' || bereich[2] === '' ? groesse - 1 : Math.min(Number(bereich[2]), groesse - 1);
    if (von > bis || von >= groesse) return res.writeHead(416, { 'content-range': `bytes */${groesse}` }).end();
    res.writeHead(206, { ...kopf, 'content-range': `bytes ${von}-${bis}/${groesse}`, 'content-length': bis - von + 1 });
    return createReadStream(datei, { start: von, end: bis }).pipe(res);
  }
  res.writeHead(200, { ...kopf, 'content-length': groesse });
  createReadStream(datei).pipe(res);
}

function feedSeite(n, spalten) {
  const namen = leseSatz();
  const eintraege = [];
  for (let i = 0; i < n; i += 1) {
    const bild = namen.length ? `/testbild/sfw/${encodeURIComponent(namen[i % namen.length])}` : '/magenta.png';
    const lazy = i >= 4 ? ' loading="lazy"' : '';
    eintraege.push(`<article>
<h2>Eintrag ${i + 1}</h2>
<img src="${bild}" data-feed-index="${i}"${lazy} alt="">
<p>Erste Textzeile zu Eintrag ${i + 1}.</p>
<p>Zweite Textzeile zu Eintrag ${i + 1}.</p>
</article>`);
  }
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>S4 Feed</title>
<style>
body { margin: 0; background: #fff; color: #111; font: 16px/1.4 sans-serif; }
main { width: 600px; margin: 0 auto; display: grid; grid-template-columns: repeat(${spalten}, 1fr); }
article { padding: 16px 0 24px; min-width: 0; }
h2 { margin: 0 0 8px; font-size: 20px; }
img { display: block; width: 100%; aspect-ratio: ${spalten === 2 ? '1 / 1' : '4 / 5'}; object-fit: cover; background: #ddd; }
p { margin: 6px 0 0; }
</style></head><body><main>
${eintraege.join('\n')}
</main></body></html>`;
}

function baueServer(portKennung, ports, png) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET') return res.writeHead(405).end('nur GET');
    const url = new URL(req.url, `http://${host}`);
    const pfad = url.pathname;
    if (process.env.VEIL_S4_LOG) console.log(`s4-server(${portKennung}): GET`, pfad);
    if (pfad === '/magenta.png') {
      return res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' }).end(png);
    }
    if (pfad === '/magenta.mp4') return sendeDatei(req, res, mp4Pfad);
    if (pfad === '/blitz.html') {
      // Den Port des fremden Servers setzt der Server beim Ausliefern ein.
      const html = readFileSync(path.join(hier, 'fixture/blitz.html'), 'utf8').replaceAll('__PORT2__', String(ports.fremd));
      return res.writeHead(200, { 'content-type': typen['.html'], 'cache-control': 'no-store' }).end(html);
    }
    if (pfad === '/rahmen.html') {
      return res.writeHead(200, { 'content-type': typen['.html'], 'cache-control': 'no-store' })
        .end('<!doctype html><html><head><meta charset="utf-8"><title>Rahmen</title></head><body style="margin:0;background:#fff"><img src="/magenta.png" style="display:block;border:0"></body></html>');
    }
    if (pfad === '/feed.html') {
      const n = Math.max(1, Math.min(500, Number(url.searchParams.get('n') ?? 20) || 20));
      const spalten = Math.max(1, Math.min(3, Number(url.searchParams.get('spalten') ?? 1) || 1));
      return res.writeHead(200, { 'content-type': typen['.html'], 'cache-control': 'no-store' }).end(feedSeite(n, spalten));
    }
    if (pfad.startsWith('/testbild/sfw/')) {
      let name;
      try { name = decodeURIComponent(pfad.slice('/testbild/sfw/'.length)); } catch { name = ''; }
      if (leseSatz().includes(name)) return sendeDatei(req, res, path.join(bilderSfw, name));
      return res.writeHead(404).end('nicht gefunden');
    }
    return res.writeHead(404).end('nicht gefunden');
  });
}

function lausche(server, port) {
  return new Promise((ok, fehler) => {
    server.once('error', fehler);
    server.listen(port, host, () => { server.off('error', fehler); ok(); });
  });
}

// Startet beide Server und gibt sie samt Ports zurueck.
export async function starteS4Server() {
  const ports = {
    haupt: Number(process.env.VEIL_S4_PORT ?? 47182),
    fremd: Number(process.env.VEIL_S4_PORT2 ?? 47183),
  };
  const png = await erzeugePng();
  sorgeFuerMp4();
  const haupt = baueServer('haupt', ports, png);
  const fremd = baueServer('fremd', ports, png);
  await lausche(haupt, ports.haupt);
  await lausche(fremd, ports.fremd);
  const schliessen = () => Promise.all([haupt, fremd].map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); })));
  return { haupt, fremd, ports, schliessen };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const s = await starteS4Server();
  console.log(`s4-server: haupt ${host}:${s.ports.haupt}, fremd ${host}:${s.ports.fremd}`);
}
