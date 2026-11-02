#!/bin/zsh
# Finale Messreihe Teil 1 (Wegwerf), nach den Pruefer-Korrekturen: S1 Seite, S1 Erweiterung, Kaltstart, S2/S3, Reddit, Android.
cd "$(dirname "$0")/.."
LOG="${1:-spike/reihe-final-1.log}"
: > "$LOG"
s1c() { echo "=== s1 chromium $* ===" >> "$LOG"; VEIL_S1_PORT=47194 node spike/s1-modell/lauf-chromium.mjs "$@" 2>&1 | grep -v "s1-server: GET" | grep -v session_state >> "$LOG"; }
s1f() { echo "=== s1 firefox $* ===" >> "$LOG"; VEIL_S1_PORT=47194 node spike/s1-modell/lauf-firefox.mjs "$@" 2>&1 | grep -v "s1-server: GET" | grep -v session_state >> "$LOG"; }
ext() { echo "=== ext $* ===" >> "$LOG"; VEIL_S1_PORT=47191 node spike/erweiterung/lauf-ext.mjs "$@" 2>&1 | grep -v session_state >> "$LOG"; }
# S1 Seite: Treffer (WebGPU, schnell) mit Schwellen 0,2 und 0,25 (NudeNet-gleich), RGB/BGR, Pad mitte
s1c --backend webgpu --modell 640m --kanal rgb --schwelle 0.2
s1c --backend webgpu --modell 640m --kanal rgb --schwelle 0.25
s1c --backend webgpu --modell 640m --kanal bgr --schwelle 0.25
s1c --backend webgpu --modell 640m --kanal rgb --schwelle 0.25 --pad mitte
s1c --backend webgpu --modell 640m --kanal rgb --schwelle 0.1
s1c --backend webgpu --modell 320n --kanal rgb --schwelle 0.2
s1c --backend webgpu --modell 320n --kanal rgb --schwelle 0.25
s1c --backend webgpu --modell 320n --kanal bgr --schwelle 0.25
s1c --backend webgpu --modell 320n --kanal rgb --schwelle 0.1
# S1 Seite: Tempo
s1c --backend wasm --modell 320n --schwelle 0.25
s1c --backend wasm --threads 4 --modell 320n --schwelle 0.25
s1c --backend wasm --threads 4 --modell 640m --schwelle 0.25
s1c --backend wasm --modell 640m --schwelle 0.25
s1f --backend wasm --modell 320n --schwelle 0.25
s1f --backend wasm --modell 640m --schwelle 0.25 --max 40
s1f --backend webgpu --modell 640m --schwelle 0.25 --sichtbar
# S1 Erweiterung und Kaltstart
ext --browser chromium --modell 320n --backend wasm --aufgabe s1
ext --browser chromium --modell 640m --backend webgpu --aufgabe s1
ext --browser chromium --modell 640m --backend wasm --threads 4 --aufgabe s1 --max 30
ext --browser firefox --modell 320n --backend wasm --aufgabe s1
ext --browser firefox --modell 640m --backend webgpu --aufgabe s1 --sichtbar --max 40
ext --browser chromium --modell 320n --backend wasm --aufgabe kaltstart --warten 35000 --schliessen
ext --browser chromium --modell 640m --backend webgpu --aufgabe kaltstart --warten 35000 --schliessen
ext --browser firefox --modell 320n --backend wasm --aufgabe kaltstart --warten 35000
ext --browser firefox --modell 640m --backend wasm --aufgabe kaltstart --warten 35000
# S2/S3
node spike/s2-s3-fremd/server.mjs > /dev/null 2>&1 &
S2PID=$!
sleep 2
ext --browser chromium --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser firefox --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --threads 4 --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --threads 4 --coep credentialless --name t4-credentialless --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel --wartenSeite 4000
ext --browser firefox --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel --wartenSeite 4000
ext --browser chromium --modell 320n --aufgabe s2 --url https://www.reddit.com/r/pics/ --wartenSeite 10000
ext --browser firefox --modell 320n --aufgabe s2 --url https://www.reddit.com/r/pics/ --wartenSeite 10000
kill $S2PID 2>/dev/null
# Android (Emulator laeuft)
echo "=== android 320n ===" >> "$LOG"; node spike/s5-android/lauf-android.mjs --modell 320n --schwelle 0.25 2>&1 >> "$LOG"
echo "=== android 640m max 20 ===" >> "$LOG"; node spike/s5-android/lauf-android.mjs --modell 640m --max 20 2>&1 >> "$LOG"
echo "=== REIHE FERTIG ===" >> "$LOG"
