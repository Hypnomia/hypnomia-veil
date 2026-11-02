#!/bin/zsh
# Messreihe S4 (Aufnahmen), Feed-Kennzahl, S2/S3 Fixtures und Reddit (Wegwerf). Nacheinander, Log in Datei.
cd "$(dirname "$0")/../.."
LOG="${1:-spike/erweiterung/reihe-s4-s2.log}"
: > "$LOG"
# Warten, bis die Erweiterungs-Messreihe fertig ist (Tempo-Messungen nicht stoeren).
while ! grep -q "REIHE FERTIG" spike/erweiterung/reihe-ext.log 2>/dev/null; do sleep 5; done
node spike/s4-schleier/server.mjs > /dev/null 2>&1 &
S4PID=$!
node spike/s2-s3-fremd/server.mjs > /dev/null 2>&1 &
S2PID=$!
sleep 2
auf() { echo "=== aufnahme $* ===" >> "$LOG"; VEIL_S4_PORT=47192 VEIL_S4_PORT2=47193 node spike/s4-schleier/aufnahme.mjs "$@" --dauer 6 2>&1 | grep -v session_state >> "$LOG"; }
ext() { echo "=== ext $* ===" >> "$LOG"; VEIL_S1_PORT=47191 node spike/erweiterung/lauf-ext.mjs "$@" 2>&1 | grep -v session_state >> "$LOG"; }
auf --browser chromium --erweiterung .output/spike-chromium-s4-a --name chromium-s4-a --url http://127.0.0.1:47192/blitz.html
auf --browser chromium --erweiterung .output/spike-chromium-s4-b --name chromium-s4-b --url http://127.0.0.1:47192/blitz.html
auf --browser chromium --erweiterung .output/spike-chromium-s4-c --name chromium-s4-c --url http://127.0.0.1:47192/blitz.html
auf --browser firefox --erweiterung .output/spike-firefox-s4-a.zip --name firefox-s4-a --url http://127.0.0.1:47192/blitz.html
auf --browser firefox --erweiterung .output/spike-firefox-s4-c.zip --name firefox-s4-c --url http://127.0.0.1:47192/blitz.html
ext --browser chromium --modell 320n --backend wasm --strategie a --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser chromium --modell 640m --backend webgpu --strategie a --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser chromium --modell 320n --backend wasm --strategie c --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser firefox --modell 320n --backend wasm --strategie a --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser firefox --modell 320n --backend wasm --strategie c --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20" --wartenSeite 8000
ext --browser chromium --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser firefox --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel --wartenSeite 4000
ext --browser firefox --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel --wartenSeite 4000
ext --browser chromium --modell 320n --threads 4 --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --aufgabe s2 --url https://www.reddit.com/r/pics/ --wartenSeite 10000
ext --browser firefox --modell 320n --aufgabe s2 --url https://www.reddit.com/r/pics/ --wartenSeite 10000
kill $S4PID $S2PID 2>/dev/null
echo "=== REIHE FERTIG ===" >> "$LOG"
