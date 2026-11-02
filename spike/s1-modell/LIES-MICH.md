# Spike S1: Modell-Tempo und Treffer im Browser (Wegwerf-Code)

Zweck: Tempo und Treffer der beiden YOLOv8-Modelle (640m.onnx, 320n.onnx) mit onnxruntime-web in Chromium, Firefox
und Firefox fuer Android auf den echten Testbildern (`../05 Testbilder/nsfw` und `sfw`) gegen `soll-zonen.json`.
Kein Produktcode. Session 1 hat hier mit synthetischen Bildern gemessen; seit Session 2 laufen echte Bilder.

Start:
- `npm run spike:s1:chromium` (Playwright, headless), `npm run spike:s1:firefox` (selenium-webdriver, headless)
- Parameter (beide Laufskripte): `--modell 640m|320n`, `--kanal rgb|bgr`, `--pad ru|mitte` (rechts/unten schwarz wie
  NudeNet, oder zentriert grau 114 wie Ultralytics), `--schwelle 0.2` (0,25 ist NudeNet-gleich: das Python-Paket filtert
  erst 0,2 und dann in der NMS 0,25), `--max N`, `--saetze nsfw,sfw`, `--backend webgpu`, `--threads N` (nur Chromium),
  `--sichtbar` (Fenster statt headless; Firefox-WebGPU braucht ein sichtbares Fenster, headless gibt es keinen Adapter).
- Android: `node spike/s5-android/lauf-android.mjs --modell 320n` (Emulator laeuft, Server auf 127.0.0.1, Emulator sieht ihn als 10.0.2.2).
- Messreihe: `spike/reihe-final.sh` (alle Varianten nacheinander, Log `spike/reihe-final-1.log`).
- Auswertung: `node spike/auswertung.mjs s1` (Markdown-Tabellen), `node spike/s1-modell/paritaet.mjs` (Browser gegen Node).

Ablauf je Bild: Blob holen, `createImageBitmap` (EXIF beachtet), auf S x S zeichnen (Canvas, Browser-Skalierung),
`getImageData`, Tensor NCHW /255, `session.run`, Nachverarbeitung (beste Klasse je Anker, Schwelle, NMS klassenuebergreifend
IoU 0,45, Boxen zurueck in Originalpixel), Zonen wie `s0-zonen-vorschlag` (Gesicht leitet face/head/eyes/mouth ab).
Gemessen je Bild: Netz, Dekodieren, Vorverarbeitung, Inferenz, Nachverarbeitung; Kaltstart = Session-Erstellung bis
erste Inferenz mit Nullbild.

Zaehlung: je Zone Soll sichtbar, Treffer sichtbar, Treffer irgendwie (sichtbar oder bedeckt gemeldet), Soll bedeckt und davon
gefunden, Fehlalarm nsfw (gemeldet sichtbar, im Soll weder sichtbar noch bedeckt), Fehlalarm sfw (Koerperzone
breast/genitals/buttocks/belly/armpits als sichtbar gemeldet; der SFW-Satz ist nicht markiert, Regel aus UEBERGABE-1).
"Koerperzonen" in der Zusammenfassung = diese fuenf Zonen ohne Gesicht und Fuesse.

Ausgabe: Zusammenfassung im Terminal, Vollfassung mit `jeBild` (Treffer, Zonen, Zeiten je Bild, keine Bilder) in
`ergebnis-<browser>-<backend>-<modell>-<kanal>-s<schwelle>[-mitte]-<zeitstempel>.json` (per .gitignore ausgeschlossen).

## Backends
- `?backend=wasm` (Standard): `ort.wasm.min.js`, ein Thread, geladen wird `ort-wasm-simd-threaded.wasm`.
- `?backend=webgpu`: `ort.webgpu.min.js` mit `executionProviders: ['webgpu']`, geladen werden `ort-wasm-simd-threaded.asyncify.mjs` und `.asyncify.wasm`. Scheitert WebGPU, faellt die Messung auf wasm zurueck (`genutztesBackend` = `wasm-rueckfall`).
- `?threads=4` (mit wasm): der Server sendet COOP/COEP fuer die Seite und COEP/CORP fuer die ORT-Dateien.
Chromium headless braucht fuer WebGPU `--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal --ignore-gpu-blocklist`.
Firefox: `dom.webgpu.enabled=true` und ein sichtbares Fenster (`--sichtbar`).
