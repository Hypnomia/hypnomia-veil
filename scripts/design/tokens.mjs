// Erzeugt src/oberflaeche/design/tokens.css aus src/oberflaeche/design/werte.ts (eine Quelle, Phase 8b).
// Aufruf: node --experimental-strip-types scripts/design/tokens.mjs [--pruefen]
// --pruefen: schreibt nichts, Exit 1 wenn die Datei nicht dem erzeugten Stand entspricht (auch als Einheitstest).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WERTE, SCHRIFTEN, GEMEINSAM, ERWEITERUNG } from '../../src/oberflaeche/design/werte.ts';


export function erzeugeTokensCss() {
  const zeilen = [
    '/* ERZEUGT aus werte.ts durch scripts/design/tokens.mjs, nicht von Hand aendern (Phase 8b, Entscheidung 161). */',
    '',
  ];
  for (const s of SCHRIFTEN) {
    zeilen.push(`@font-face { font-family: '${s.familie}'; font-style: normal; font-weight: ${s.gewicht}; font-display: swap; src: url('/${s.datei}') format('woff2'); }`);
  }
  zeilen.push('', ':root {');
  for (const [k, v] of Object.entries(WERTE)) zeilen.push(`  --v-${k}: ${v};`);
  zeilen.push('}', '');
  zeilen.push('/* Funkel-Stern: langsamer Zyklus (6 s), nur Deckkraft und Groesse, keine Helligkeitsblitze. */');
  zeilen.push('@keyframes v-funkeln { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.05); } }');
  zeilen.push('@keyframes v-dreh { to { transform: rotate(360deg); } }');
  zeilen.push(GEMEINSAM);
  zeilen.push('/* Nur Erweiterungsseiten: gemeinsamer Regler (regler.ts setzt --wert fuer Chromium). */');
  zeilen.push(ERWEITERUNG);
  zeilen.push('@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }');
  zeilen.push('');
  return zeilen.join('\n');
}

const ziel = fileURLToPath(new URL('../../src/oberflaeche/design/tokens.css', import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const neu = erzeugeTokensCss();
  if (process.argv.includes('--pruefen')) {
    const alt = readFileSync(ziel, 'utf8');
    if (alt !== neu) {
      console.error('tokens.css passt nicht zu werte.ts: node --experimental-strip-types scripts/design/tokens.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(ziel, neu);
    console.log('geschrieben:', ziel.split('/veil.nosync/')[1] ?? 'tokens.css');
  }
}
