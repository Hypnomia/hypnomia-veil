#!/bin/zsh
# Messreihe S1 (Wegwerf): alle Varianten nacheinander, Ausgabe in eine Logdatei.
cd "$(dirname "$0")/../.."
LOG="${1:-spike/s1-modell/reihe.log}"
: > "$LOG"
lauf() { echo "=== $* ===" >> "$LOG"; node spike/s1-modell/$1 "${@:2}" 2>&1 | grep -v "s1-server: GET" | grep -v "onnxruntime:, session_state" >> "$LOG"; }
lauf lauf-chromium.mjs --backend webgpu --modell 640m --kanal rgb
lauf lauf-chromium.mjs --backend webgpu --modell 640m --kanal bgr
lauf lauf-chromium.mjs --backend webgpu --modell 640m --kanal rgb --pad mitte
lauf lauf-chromium.mjs --backend webgpu --modell 320n --kanal rgb
lauf lauf-chromium.mjs --backend webgpu --modell 320n --kanal bgr
lauf lauf-chromium.mjs --backend wasm --threads 4 --modell 640m
lauf lauf-chromium.mjs --backend wasm --threads 4 --modell 320n
lauf lauf-chromium.mjs --backend wasm --modell 320n
lauf lauf-chromium.mjs --backend wasm --modell 640m
lauf lauf-firefox.mjs --backend wasm --modell 320n
lauf lauf-firefox.mjs --backend wasm --modell 640m
lauf lauf-firefox.mjs --backend webgpu --modell 640m --sichtbar
echo "=== REIHE FERTIG ===" >> "$LOG"
