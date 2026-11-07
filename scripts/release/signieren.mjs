// Signieren bei Mozilla (web-ext sign), Session 14, Auftrag R. Nur aufrufen, wenn die Inhaberin oder der Orchestrator es ausdruecklich will.
// Der Schluessel liegt in ../.lokal/mozilla-api.txt (Zeilen `issuer=` und `secret=`) und geht NUR ueber die Umgebungsvariablen
// WEB_EXT_API_KEY und WEB_EXT_API_SECRET an web-ext, nie als Argument. Ausgaben von web-ext laufen durch einen Filter, der beide Werte schwaerzt.
// Wiederverwendbar mit anderem Quellordner und ohne Quellcode-Upload (Update-Test-Erweiterung in tests/android/update-test/).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHLUESSEL_DATEI = path.join(wurzel, '../.lokal/mozilla-api.txt');

// Liest issuer und secret. Gibt nie etwas aus; Fehlertexte nennen nur die Datei, nicht den Inhalt.
export function leseSchluessel(datei = SCHLUESSEL_DATEI) {
  let text;
  try {
    text = readFileSync(datei, 'utf8');
  } catch {
    throw new Error('Signieren: ../.lokal/mozilla-api.txt nicht lesbar');
  }
  const wert = (name) => {
    const zeile = text.split(/\r?\n/).find((z) => z.startsWith(`${name}=`));
    return zeile ? zeile.slice(name.length + 1).trim() : '';
  };
  const issuer = wert('issuer');
  const secret = wert('secret');
  if (!issuer || !secret) throw new Error('Signieren: ../.lokal/mozilla-api.txt braucht die Zeilen issuer= und secret=');
  return { issuer, secret };
}

// Schwaerzt die Werte in einem Text (falls web-ext sie je ausgaebe).
export function schwaerze(text, werte) {
  let aus = text;
  for (const w of werte) if (w) aus = aus.split(w).join('***');
  return aus;
}

// Argumentliste fuer web-ext sign (ohne Schluessel). Rein, damit der Einheitstest sie pruefen kann.
export function signierArgumente({ quellordner, ausgabeordner, kanal = 'unlisted', quellzip = null }) {
  if (kanal !== 'unlisted') throw new Error('Signieren: nur der Kanal unlisted wird von diesem Skript signiert');
  // --no-config-discovery: keine web-ext-Konfiguration aus Heimat- oder Arbeitsordner (kein fremder Schluessel, keine fremden Voreinstellungen).
  const args = ['sign', '--no-config-discovery', '--source-dir', quellordner, '--artifacts-dir', ausgabeordner, '--channel', kanal];
  if (quellzip) args.push('--upload-source-code', quellzip);
  return args;
}

// Gibt Text zeilenweise weiter und schwaerzt dabei die Werte. Gepuffert, damit ein Wert, der ueber zwei Datenbloecke verteilt kommt, nicht durchrutscht.
export function zeilenSchwaerzer(ziel, werte) {
  let rest = '';
  return {
    schreibe(d) {
      rest += String(d);
      const teile = rest.split('\n');
      rest = teile.pop();
      for (const z of teile) ziel.write(`${schwaerze(z, werte)}\n`);
    },
    ende() {
      if (rest) ziel.write(schwaerze(rest, werte));
      rest = '';
    },
  };
}

// Umgebung fuer web-ext: alle geerbten WEB_EXT_* entfernt, dann nur der eigene Schluessel.
export function signierUmgebung(basis, issuer, secret) {
  const env = {};
  for (const [k, v] of Object.entries(basis)) if (!k.startsWith('WEB_EXT_')) env[k] = v;
  return { ...env, WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret };
}

// Signiert und liefert den Exit-Code von web-ext. Ergebnis (XPI) liegt danach in ausgabeordner. Fehler (auch ein unlesbarer Schluessel) sind
// abgelehnte Promises mit Text ohne Schluesselwerte.
export async function signiere({ quellordner, ausgabeordner, kanal = 'unlisted', quellzip = null, webExt = 'web-ext', schluesselDatei = SCHLUESSEL_DATEI }) {
  const { issuer, secret } = leseSchluessel(schluesselDatei);
  const args = signierArgumente({ quellordner, ausgabeordner, kanal, quellzip });
  mkdirSync(ausgabeordner, { recursive: true });
  return new Promise((aufloesen, abbrechen) => {
    const kind = spawn(webExt, args, { stdio: ['ignore', 'pipe', 'pipe'], env: signierUmgebung(process.env, issuer, secret) });
    const aus = zeilenSchwaerzer(process.stdout, [issuer, secret]);
    const fehler = zeilenSchwaerzer(process.stderr, [issuer, secret]);
    kind.stdout.on('data', (d) => aus.schreibe(d));
    kind.stderr.on('data', (d) => fehler.schreibe(d));
    kind.on('error', () => abbrechen(new Error('Signieren: web-ext konnte nicht gestartet werden')));
    kind.on('close', (code) => {
      aus.ende();
      fehler.ende();
      aufloesen(code ?? 1);
    });
  });
}
