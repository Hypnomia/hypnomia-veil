// Lokales Markierwerkzeug fuer die Soll-Zonen des Testbildsatzes.
// Nur Node-Bordmittel, keine Abhaengigkeiten. Bindet ausschliesslich an 127.0.0.1.
// Start: node scripts/annotate/server.mjs   (Port per VEIL_ANNOTATE_PORT, Standard 5188)
// Es wird nichts hochgeladen, kein Bild wird veraendert oder geloescht.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '../..');
const BILDER = path.resolve(REPO, '../05 Testbilder');
const ERGEBNIS = path.join(BILDER, 'soll-zonen.json');
const VORSCHLAG = path.join(BILDER, 'soll-zonen-vorschlag.json');

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.VEIL_ANNOTATE_PORT ?? '', 10) || 5188;

const SAETZE = ['nsfw', 'sfw'];
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ENDUNGEN = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);
const MAX_BODY = 2 * 1024 * 1024;
const MAX_NOTIZ = 500;

// Statische Dateien der Oberflaeche (feste Liste, kein freier Dateizugriff).
const STATISCH = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/zusammenfassung', ['zusammenfassung.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/zusammenfassung.js', ['zusammenfassung.js', 'text/javascript; charset=utf-8']],
]);

// ---------- Bilderliste ----------

/** Liest die Bildnamen eines Satzes frisch ein (sfw wird eventuell gerade gefuellt). */
function leseSatz(satz) {
  const ordner = path.join(BILDER, satz);
  let namen;
  try {
    namen = fs.readdirSync(ordner, { withFileTypes: true });
  } catch {
    return [];
  }
  return namen
    .filter((e) => e.isFile() && !e.name.startsWith('.') && ENDUNGEN.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

function leseAlleSaetze() {
  const aus = {};
  for (const s of SAETZE) aus[s] = leseSatz(s);
  return aus;
}

// ---------- Ergebnisdatei ----------

function heute() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function leereDaten() {
  return { version: 1, zonen: [...ZONEN], bilder: {} };
}

/** Prueft einen Schluessel "satz/datei" nur auf Form, nicht auf Existenz. */
function schluesselForm(schluessel) {
  if (typeof schluessel !== 'string') return null;
  const teile = schluessel.split('/');
  if (teile.length !== 2) return null;
  const [satz, datei] = teile;
  if (!SAETZE.includes(satz)) return null;
  if (!datei || datei.startsWith('.') || datei.includes('\\') || datei.includes('\0') || datei.includes('..')) return null;
  if (!ENDUNGEN.has(path.extname(datei).toLowerCase())) return null;
  return { satz, datei };
}

// Hinweis: Zonen, die nicht (mehr) in ZONEN stehen (z. B. das fruehere "hands"), werden beim
// Laden und Speichern verworfen. Alte Eintraege bleiben so lesbar, ohne das Werkzeug zu stoeren.
function zoneListe(x) {
  if (!Array.isArray(x)) return [];
  return ZONEN.filter((z) => x.includes(z));
}

/** Bereinigt einen Eintrag auf die erlaubte Form. Wirft bei Unsinn. */
function bereinigeEintrag(roh) {
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) throw new Error('Eintrag muss ein Objekt sein');
  const keinMensch = roh.kein_mensch === true;
  const geprueft = typeof roh.geprueft === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(roh.geprueft) ? roh.geprueft : heute();
  return {
    sichtbar: keinMensch ? [] : zoneListe(roh.sichtbar),
    bedeckt: keinMensch ? [] : zoneListe(roh.bedeckt),
    kein_mensch: keinMensch,
    notiz: typeof roh.notiz === 'string' ? roh.notiz.slice(0, MAX_NOTIZ) : '',
    geprueft,
  };
}

function bereinigeDaten(roh) {
  if (roh === null || typeof roh !== 'object' || !roh.bilder || typeof roh.bilder !== 'object' || Array.isArray(roh.bilder)) {
    throw new Error('Feld "bilder" fehlt oder ist kein Objekt');
  }
  const aus = leereDaten();
  for (const k of Object.keys(roh.bilder).sort()) {
    if (!schluesselForm(k)) throw new Error(`Ungueltiger Schluessel: ${k}`);
    aus.bilder[k] = bereinigeEintrag(roh.bilder[k]);
  }
  return aus;
}

function ladeDaten() {
  try {
    const text = fs.readFileSync(ERGEBNIS, 'utf8');
    const roh = JSON.parse(text);
    // Unbekannte Schluessel (z. B. entfernte Bilder) bleiben erhalten, nur Form wird bereinigt.
    return bereinigeDaten(roh);
  } catch (e) {
    if (e && e.code === 'ENOENT') return leereDaten();
    console.error('Warnung: soll-zonen.json konnte nicht gelesen werden:', e.message);
    console.error('Die Datei wird nicht ueberschrieben, bevor sie lesbar ist. Bitte pruefen.');
    ladefehler = true;
    return leereDaten();
  }
}

let ladefehler = false;
let daten = ladeDaten();

/** Atomar schreiben: erst Temp-Datei im selben Ordner, dann rename. */
function speichere() {
  if (ladefehler) throw new Error('soll-zonen.json war beim Start nicht lesbar, Speichern gesperrt');
  const sortiert = leereDaten();
  for (const k of Object.keys(daten.bilder).sort()) sortiert.bilder[k] = daten.bilder[k];
  daten = sortiert;
  const tmp = `${ERGEBNIS}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(daten, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, ERGEBNIS);
}

/**
 * Liest den Modellvorschlag roh (Schluessel "satz/datei" auf Eintrag), ohne Bereinigung und ohne
 * Schreibzugriff. Fehlende oder unlesbare Datei ergibt ein leeres Objekt. Die Oberflaeche filtert
 * unbekannte Zonen selbst heraus. Der Vorschlag ist nie ein gespeicherter Eintrag.
 */
function ladeVorschlag() {
  try {
    const roh = JSON.parse(fs.readFileSync(VORSCHLAG, 'utf8'));
    const bilder = roh && typeof roh === 'object' ? roh.bilder : null;
    return bilder && typeof bilder === 'object' && !Array.isArray(bilder) ? bilder : {};
  } catch {
    return {};
  }
}

// ---------- HTTP-Hilfen ----------

const SICHERHEIT = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

function antwort(res, status, typ, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': typ, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...SICHERHEIT, ...extra });
  res.end(body);
}

function json(res, status, obj) {
  antwort(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function fehler(res, status, text) {
  json(res, status, { fehler: text });
}

function leseBody(req) {
  return new Promise((resolve, reject) => {
    const teile = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(Object.assign(new Error('Anfrage zu gross'), { status: 413 }));
        req.destroy();
        return;
      }
      teile.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(teile).toString('utf8') || 'null'));
      } catch {
        reject(Object.assign(new Error('Kein gueltiges JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Schutz gegen DNS-Rebinding und fremde Webseiten: Host und Origin muessen lokal sein. */
function herkunftOk(req) {
  const erlaubt = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  if (!erlaubt.has(String(req.headers.host ?? '').toLowerCase())) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return false;
  }
  return true;
}

// ---------- Routen ----------

function sendeBild(res, satz, datei) {
  const liste = leseSatz(satz);
  if (!liste.includes(datei)) return fehler(res, 404, 'Bild nicht gefunden');
  const voll = path.join(BILDER, satz, datei);
  let st;
  try {
    st = fs.statSync(voll);
  } catch {
    return fehler(res, 404, 'Bild nicht gefunden');
  }
  res.writeHead(200, {
    'Content-Type': ENDUNGEN.get(path.extname(datei).toLowerCase()),
    'Content-Length': st.size,
    'Cache-Control': 'private, max-age=300',
    ...SICHERHEIT,
  });
  const strom = fs.createReadStream(voll);
  strom.on('error', () => res.destroy());
  strom.pipe(res);
}

async function behandle(req, res) {
  if (!herkunftOk(req)) return fehler(res, 403, 'Nur lokaler Zugriff erlaubt');

  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const pfad = url.pathname;
  const methode = req.method ?? 'GET';

  // Oberflaeche
  if (methode === 'GET' && STATISCH.has(pfad)) {
    const [datei, typ] = STATISCH.get(pfad);
    try {
      return antwort(res, 200, typ, fs.readFileSync(path.join(HIER, datei)));
    } catch {
      return fehler(res, 404, `Datei fehlt: ${datei}`);
    }
  }

  // Bilder: /bild/<satz>/<datei>
  if (methode === 'GET' && pfad.startsWith('/bild/')) {
    let teile;
    try {
      teile = pfad.slice('/bild/'.length).split('/').map(decodeURIComponent);
    } catch {
      return fehler(res, 400, 'Ungueltiger Pfad');
    }
    if (teile.length !== 2 || !SAETZE.includes(teile[0])) return fehler(res, 404, 'Bild nicht gefunden');
    return sendeBild(res, teile[0], teile[1]);
  }

  // API
  if (pfad === '/api/liste' && methode === 'GET') {
    const saetze = leseAlleSaetze();
    const anzahl = Object.fromEntries(SAETZE.map((s) => [s, saetze[s].length]));
    return json(res, 200, { zonen: ZONEN, saetze, anzahl, bilder: daten.bilder, vorschlag: ladeVorschlag() });
  }

  if (pfad === '/api/daten' && methode === 'GET') {
    return json(res, 200, daten);
  }

  if (pfad === '/api/save' && methode === 'POST') {
    const roh = await leseBody(req);
    let neu;
    try {
      neu = bereinigeDaten(roh);
    } catch (e) {
      return fehler(res, 400, e.message);
    }
    daten = neu;
    speichere();
    return json(res, 200, { ok: true, anzahl: Object.keys(daten.bilder).length });
  }

  if (pfad.startsWith('/api/bild/') && (methode === 'PUT' || methode === 'DELETE')) {
    let schluessel;
    try {
      schluessel = decodeURIComponent(pfad.slice('/api/bild/'.length));
    } catch {
      return fehler(res, 400, 'Ungueltiger Pfad');
    }
    const form = schluesselForm(schluessel);
    if (!form) return fehler(res, 400, 'Ungueltiger Schluessel');
    if (methode === 'PUT') {
      if (!leseSatz(form.satz).includes(form.datei)) return fehler(res, 404, 'Bild nicht in der Liste');
      const roh = await leseBody(req);
      let eintrag;
      try {
        eintrag = bereinigeEintrag(roh);
      } catch (e) {
        return fehler(res, 400, e.message);
      }
      daten.bilder[schluessel] = eintrag;
      speichere();
      return json(res, 200, { ok: true, schluessel, eintrag });
    }
    const existierte = Object.hasOwn(daten.bilder, schluessel);
    if (existierte) {
      delete daten.bilder[schluessel];
      speichere();
    }
    return json(res, 200, { ok: true, schluessel, entfernt: existierte });
  }

  return fehler(res, 404, 'Nicht gefunden');
}

const server = http.createServer((req, res) => {
  behandle(req, res).catch((e) => {
    if (!res.headersSent) fehler(res, e && e.status ? e.status : 500, e && e.message ? e.message : 'Interner Fehler');
    else res.destroy();
  });
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} ist belegt. Anderen Port per VEIL_ANNOTATE_PORT setzen.` : e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const s = leseAlleSaetze();
  console.log(`Markierwerkzeug laeuft: http://${HOST}:${PORT}/`);
  console.log(`Zusammenfassung:        http://${HOST}:${PORT}/zusammenfassung`);
  console.log(`Bilder: nsfw ${s.nsfw.length}, sfw ${s.sfw.length}. Markiert: ${Object.keys(daten.bilder).length}`);
  console.log('Beenden mit Strg+C.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
