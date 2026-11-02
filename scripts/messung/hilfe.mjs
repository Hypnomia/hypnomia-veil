// Gemeinsame Hilfen der Messwerkzeuge (kein Produktcode): Statistik, freie Ports, Erweiterungspfade, Browser-Start.
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const hier = path.dirname(fileURLToPath(import.meta.url));
export const wurzel = path.resolve(hier, '../..');
// Messungen brauchen den Testbau mit Testhaken (npm test baut nach .output-test; VEIL_AUSGABE waehlt den Ordner).
export const ausgabeOrdner = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output-test');
export const chromeErweiterung = path.join(ausgabeOrdner, 'chrome-mv3');
export const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
export const firefoxZip = path.join(ausgabeOrdner, `${paketJson.name}-${paketJson.version}-firefox.zip`);
export const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
export const GECKO_ID = 'veil@hypnomia';

export const warte = (ms) => new Promise((r) => setTimeout(r, ms));
export const rund = (x, stellen = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** stellen) / 10 ** stellen);

export function median(liste) {
  const l = liste.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (l.length === 0) return null;
  const m = Math.floor(l.length / 2);
  return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
}

// Perzentil nach naechstem Rang (p zwischen 0 und 1).
export function perzentil(liste, p) {
  const l = liste.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (l.length === 0) return null;
  return l[Math.min(l.length - 1, Math.max(0, Math.ceil(p * l.length) - 1))];
}

export function spanne(liste) {
  const l = liste.filter((v) => typeof v === 'number');
  return l.length ? { min: Math.min(...l), max: Math.max(...l) } : { min: null, max: null };
}

// Zusammenfassung einer Messreihe: Median und Spannweite.
export function fasse(liste, stellen = 1) {
  const s = spanne(liste);
  return { median: rund(median(liste), stellen), min: rund(s.min, stellen), max: rund(s.max, stellen), werte: liste.map((v) => rund(v, stellen)) };
}

function istFrei(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
  });
}

// Zwei freie Ports (Hauptserver und zweiter Ursprung: Port plus 2, so rechnen die Fixture-Seiten).
export async function freierPort() {
  for (let i = 0; i < 200; i++) {
    const p = 50_000 + Math.floor(Math.random() * 9000);
    if ((await istFrei(p)) && (await istFrei(p + 2))) return p;
  }
  throw new Error('kein freier Port gefunden');
}

export function zeitstempel() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function firefoxVersion() {
  const r = spawnSync(firefoxBin, ['--version'], { encoding: 'utf8' });
  return (r.stdout ?? '').trim().replace(/^Mozilla Firefox /, '');
}

export async function tempProfil(vorsilbe) {
  const ordner = await mkdtemp(path.join(tmpdir(), vorsilbe));
  return { ordner, aufraeumen: () => rm(ordner, { recursive: true, force: true }) };
}

export function argumente(argv = process.argv.slice(2)) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) a[k] = true;
      else { a[k] = n; i++; }
    }
  }
  return a;
}

export async function holeJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
