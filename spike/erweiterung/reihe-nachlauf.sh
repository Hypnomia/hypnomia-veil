#!/bin/zsh
# Nachlaeufe (Wegwerf): S4 Firefox neu (Steuerseite hatte die Testseite verdeckt), S4 Chromium a/c wiederholen,
# Feed mit 640m WebGPU und Strategie c neu, S1 WebGPU 640m rgb neu, Schwellen-Reihe, danach Android.
cd "$(dirname "$0")/../.."
LOG="${1:-spike/erweiterung/reihe-nachlauf.log}"
: > "$LOG"
while ! grep -q "REIHE FERTIG" spike/erweiterung/reihe-s4-s2.log 2>/dev/null; do sleep 5; done
node spike/s4-schleier/server.mjs > /dev/null 2>&1 &
S4PID=$!
sleep 2
auf() { echo "=== aufnahme $* ===" >> "$LOG"; VEIL_S4_PORT=47192 VEIL_S4_PORT2=47193 node spike/s4-schleier/aufnahme.mjs "$@" --dauer 6 2>&1 | grep -v session_state >> "$LOG"; }
ext() { echo "=== ext $* ===" >> "$LOG"; VEIL_S1_PORT=47191 node spike/erweiterung/lauf-ext.mjs "$@" 2>&1 | grep -v session_state >> "$LOG"; }
s1() { echo "=== s1 $* ===" >> "$LOG"; VEIL_S1_PORT=47194 node spike/s1-modell/lauf-chromium.mjs "$@" 2>&1 | grep -v "s1-server: GET" | grep -v session_state >> "$LOG"; }
auf --browser firefox --erweiterung .output/spike-firefox-s4-a.zip --name firefox-s4-a2 --url http://127.0.0.1:47192/blitz.html
auf --browser firefox --erweiterung .output/spike-firefox-s4-c.zip --name firefox-s4-c2 --url http://127.0.0.1:47192/blitz.html
auf --browser chromium --erweiterung .output/spike-chromium-s4-a --name chromium-s4-a2 --url http://127.0.0.1:47192/blitz.html
auf --browser chromium --erweiterung .output/spike-chromium-s4-c --name chromium-s4-c2 --url http://127.0.0.1:47192/blitz.html
ext --browser chromium --modell 640m --backend webgpu --strategie a --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 15000
ext --browser chromium --modell 320n --backend wasm --strategie c --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser firefox --modell 320n --backend wasm --strategie c --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser chromium --modell 320n --backend wasm --strategie b --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
kill $S4PID 2>/dev/null
s1 --backend webgpu --modell 640m --kanal rgb
s1 --backend webgpu --modell 640m --kanal rgb --schwelle 0.1
s1 --backend webgpu --modell 640m --kanal rgb --schwelle 0.3
s1 --backend webgpu --modell 320n --kanal rgb --schwelle 0.1
s1 --backend webgpu --modell 320n --kanal rgb --schwelle 0.3
echo "=== android 320n ===" >> "$LOG"; node spike/s5-android/lauf-android.mjs --modell 320n 2>&1 >> "$LOG"
echo "=== android 640m max 20 ===" >> "$LOG"; node spike/s5-android/lauf-android.mjs --modell 640m --max 20 2>&1 >> "$LOG"
echo "=== REIHE FERTIG ===" >> "$LOG"
