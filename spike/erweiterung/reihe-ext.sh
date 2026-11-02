#!/bin/zsh
# Messreihe im Erweiterungskontext (Wegwerf): S1 voll, Kaltstart, nacheinander. Ausgabe in eine Logdatei.
cd "$(dirname "$0")/../.."
LOG="${1:-spike/erweiterung/reihe-ext.log}"
: > "$LOG"
lauf() { echo "=== $* ===" >> "$LOG"; VEIL_S1_PORT=47191 node spike/erweiterung/lauf-ext.mjs "$@" 2>&1 | grep -v "session_state" >> "$LOG"; }
lauf --browser chromium --modell 320n --backend wasm --aufgabe kaltstart --warten 35000 --schliessen
lauf --browser firefox --modell 320n --backend wasm --aufgabe kaltstart --warten 35000
lauf --browser chromium --modell 640m --backend webgpu --aufgabe kaltstart --warten 35000 --schliessen
lauf --browser chromium --modell 320n --backend wasm --aufgabe s1
lauf --browser chromium --modell 640m --backend webgpu --aufgabe s1
lauf --browser chromium --modell 640m --backend wasm --threads 4 --aufgabe s1 --max 30
lauf --browser chromium --modell 320n --backend wasm --threads 4 --aufgabe s1 --max 30
lauf --browser firefox --modell 320n --backend wasm --aufgabe s1
lauf --browser firefox --modell 640m --backend webgpu --aufgabe s1 --sichtbar --max 40
lauf --browser firefox --modell 640m --backend wasm --aufgabe s1 --max 20
echo "=== REIHE FERTIG ===" >> "$LOG"
