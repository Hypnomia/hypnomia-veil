#!/bin/zsh
# Finale Messreihe Teil 2 (Wegwerf): S4 Aufnahmen mit Positivkontrolle, Feed-Kennzahl. Nach Teil 1 und der S4-Nachbesserung.
cd "$(dirname "$0")/.."
LOG="${1:-spike/reihe-final-2.log}"
: > "$LOG"
while ! grep -q "REIHE FERTIG" spike/reihe-final-1.log 2>/dev/null; do sleep 5; done
for st in a b c; do node spike/erweiterung/bau.mjs --browser chromium --modell 320n --backend wasm --strategie $st --freigabe nie --name s4-$st >> "$LOG"; done
for st in a c; do node spike/erweiterung/bau.mjs --browser firefox --modell 320n --backend wasm --strategie $st --freigabe nie --name s4-$st >> "$LOG"; done
auf() { echo "=== aufnahme $* ===" >> "$LOG"; VEIL_S4_PORT=47192 VEIL_S4_PORT2=47193 node spike/s4-schleier/aufnahme.mjs "$@" --dauer 6 2>&1 | grep -v session_state >> "$LOG"; }
ext() { echo "=== ext $* ===" >> "$LOG"; VEIL_S1_PORT=47191 node spike/erweiterung/lauf-ext.mjs "$@" 2>&1 | grep -v session_state >> "$LOG"; }
auf --browser chromium --ohne-erweiterung --name chromium-kontrolle --url http://127.0.0.1:47192/blitz.html
auf --browser firefox --ohne-erweiterung --name firefox-kontrolle --url http://127.0.0.1:47192/blitz.html
for i in 1 2 3; do
  auf --browser chromium --erweiterung .output/spike-chromium-s4-a --name chromium-s4-a-$i --url http://127.0.0.1:47192/blitz.html
  auf --browser firefox --erweiterung .output/spike-firefox-s4-a.zip --name firefox-s4-a-$i --url http://127.0.0.1:47192/blitz.html
done
auf --browser chromium --erweiterung .output/spike-chromium-s4-b --name chromium-s4-b --url http://127.0.0.1:47192/blitz.html
auf --browser chromium --erweiterung .output/spike-chromium-s4-c --name chromium-s4-c --url http://127.0.0.1:47192/blitz.html
auf --browser firefox --erweiterung .output/spike-firefox-s4-c.zip --name firefox-s4-c --url http://127.0.0.1:47192/blitz.html
node spike/s4-schleier/server.mjs > /dev/null 2>&1 &
S4PID=$!
sleep 2
F="http://127.0.0.1:47182/feed.html?n=20&spalten=2"
ext --browser chromium --modell 320n --backend wasm --strategie a --aufgabe feed --url "$F" --wartenSeite 8000
ext --browser chromium --modell 320n --backend wasm --strategie b --aufgabe feed --url "$F" --wartenSeite 8000
ext --browser chromium --modell 320n --backend wasm --strategie c --aufgabe feed --url "$F" --wartenSeite 8000
ext --browser chromium --modell 640m --backend webgpu --vorladen --strategie a --aufgabe feed --url "$F" --wartenSeite 10000
ext --browser chromium --modell 640m --backend wasm --threads 4 --strategie a --aufgabe feed --url "$F" --wartenSeite 12000
ext --browser chromium --modell 320n --backend webgpu --strategie a --aufgabe feed --url "$F" --wartenSeite 8000
ext --browser firefox --modell 320n --backend wasm --strategie a --aufgabe feed --url "$F" --wartenSeite 8000
ext --browser firefox --modell 320n --backend wasm --strategie c --aufgabe feed --url "$F" --wartenSeite 8000
ext --browser firefox --modell 640m --backend webgpu --vorladen --strategie a --aufgabe feed --url "$F" --wartenSeite 12000 --sichtbar
ext --browser firefox --modell 640m --backend wasm --vorladen --strategie a --aufgabe feed --url "$F" --wartenSeite 20000
kill $S4PID 2>/dev/null
echo "=== REIHE FERTIG ===" >> "$LOG"
