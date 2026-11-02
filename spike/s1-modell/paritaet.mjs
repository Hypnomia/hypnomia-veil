// Wegwerf: Paritaet Browser (ergebnis-chromium-webgpu-640m-rgb, Schwelle 0,2) gegen Node (s0-zonen-vorschlag, exakte
// bilineare Tabelle wie cv2). Vergleicht je Bild die Klassenmenge und die hoechsten Scores je Klasse.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const hier = path.dirname(fileURLToPath(import.meta.url));
const s0Ordner = path.join(hier, '../s0-zonen-vorschlag');
const neueste = (ordner, muster) => readdirSync(ordner).filter((n) => muster.test(n)).sort().at(-1);
const s0Datei = process.argv[2] ?? path.join(s0Ordner, neueste(s0Ordner, /^ergebnis-node-.*\.json$/));
const browserDatei = process.argv[3] ?? path.join(hier, neueste(hier, /^ergebnis-chromium-webgpu-640m-rgb-s02-.*\.json$/) ?? neueste(hier, /^ergebnis-chromium-webgpu-640m-rgb-.*\.json$/));
const s0 = JSON.parse(readFileSync(s0Datei, 'utf8'));
const br = JSON.parse(readFileSync(browserDatei, 'utf8'));
let bilder = 0; let gleicheMengen = 0; let maxAbw = 0; let summeAbw = 0; let paare = 0; const abweichend = [];
for (const [k, v] of Object.entries(br.jeBild ?? {})) {
  const n = s0.bilder?.[k];
  if (!n || !n.treffer || !v.treffer) continue;
  bilder++;
  const mengeN = new Set(n.treffer.map((t) => t.klasse));
  const mengeB = new Set(v.treffer.map((t) => t.klasse));
  const gleich = mengeN.size === mengeB.size && [...mengeN].every((x) => mengeB.has(x));
  if (gleich) gleicheMengen++; else abweichend.push(`${k.replace(/^.*\//, '')}: Node [${[...mengeN].join(',')}] Browser [${[...mengeB].join(',')}]`);
  for (const kl of mengeN) {
    const sn = Math.max(...n.treffer.filter((t) => t.klasse === kl).map((t) => t.score));
    const sb = Math.max(0, ...v.treffer.filter((t) => t.klasse === kl).map((t) => t.score));
    const d = Math.abs(sn - sb);
    maxAbw = Math.max(maxAbw, d); summeAbw += d; paare++;
  }
}
console.log(`Paritaet: ${path.basename(browserDatei)} gegen ${path.basename(s0Datei)} (Node Schwelle ${s0.schwelle}, Browser Schwelle ${br.schwelle})`);
console.log(`Bilder verglichen: ${bilder}, gleiche Klassenmengen: ${gleicheMengen} (${Math.round(100 * gleicheMengen / bilder)} %), Score-Abweichung je Klasse: max ${maxAbw.toFixed(3)}, Mittel ${(summeAbw / paare).toFixed(3)} (${paare} Paare)`);
console.log(`Abweichende Bilder (${abweichend.length}):\n${abweichend.slice(0, 40).join('\n')}`);
