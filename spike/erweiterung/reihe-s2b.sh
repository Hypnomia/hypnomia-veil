#!/bin/zsh
# S2/S3 Wiederholung nach Fehlerbehebung (Wegwerf): Fixtures, Threads-Variante, Reddit; Chromium und Firefox.
cd "$(dirname "$0")/../.."
LOG="${1:-spike/erweiterung/reihe-s2b.log}"
: > "$LOG"
while ! grep -q "REIHE FERTIG" spike/erweiterung/reihe-nachlauf.log 2>/dev/null; do sleep 5; done
rm -f spike/erweiterung/ergebnis-s2-*ext*.json
node spike/s2-s3-fremd/server.mjs > /dev/null 2>&1 &
S2PID=$!
sleep 2
ext() { echo "=== ext $* ===" >> "$LOG"; VEIL_S1_PORT=47191 node spike/erweiterung/lauf-ext.mjs "$@" 2>&1 | grep -v session_state >> "$LOG"; }
ext --browser chromium --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser firefox --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel --wartenSeite 4000
ext --browser firefox --modell 320n --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel --wartenSeite 4000
ext --browser chromium --modell 320n --threads 4 --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --threads 4 --coep credentialless --name t4-credentialless --aufgabe s2 --url http://127.0.0.1:47184/bilder.html --wartenSeite 5000
ext --browser chromium --modell 320n --aufgabe s2 --url https://www.reddit.com/r/pics/ --wartenSeite 10000
ext --browser firefox --modell 320n --aufgabe s2 --url https://www.reddit.com/r/pics/ --wartenSeite 10000
kill $S2PID 2>/dev/null
echo "=== REIHE FERTIG ===" >> "$LOG"
