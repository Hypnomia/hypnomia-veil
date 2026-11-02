// Kopiert die WebAssembly-Laufzeit von onnxruntime-web aus node_modules nach public/ort/ (vor jedem Build, `prebuild`).
// public/ort/ steht in .gitignore: die Dateien kommen reproduzierbar aus npm install, nicht aus dem Repo.
// Das Modell selbst liegt im Repo unter public/modelle/320n.onnx (12 MB, Pruefsumme in data/MODELL-LIES-MICH.md).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quelle = path.join(wurzel, 'node_modules/onnxruntime-web/dist');
const ziel = path.join(wurzel, 'public/ort');
// Nur die Einzel-Thread-Variante: mehr Threads braeuchten COOP/COEP (Entscheidung 54: 1 Thread reicht fuer 320n).
const dateien = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

mkdirSync(ziel, { recursive: true });
for (const name of dateien) {
  const von = path.join(quelle, name);
  const nach = path.join(ziel, name);
  if (!existsSync(von)) {
    console.error(`kopiere-laufzeit: ${name} fehlt in node_modules/onnxruntime-web/dist (npm install?)`);
    process.exit(1);
  }
  if (existsSync(nach) && statSync(nach).size === statSync(von).size) continue;
  copyFileSync(von, nach);
  console.log(`kopiere-laufzeit: ${name} -> public/ort/`);
}
const modell = path.join(wurzel, 'public/modelle/320n.onnx');
if (!existsSync(modell)) {
  console.error('kopiere-laufzeit: public/modelle/320n.onnx fehlt (gehoert ins Repo, siehe data/MODELL-LIES-MICH.md)');
  process.exit(1);
}
