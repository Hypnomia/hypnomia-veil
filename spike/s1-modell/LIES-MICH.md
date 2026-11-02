# Spike S1: Modell-Tempo im Browser (Wegwerf-Code)

Zweck: Tempo des YOLOv8-Modells (640m.onnx, 640x640) mit onnxruntime-web (WASM, ein Thread) in Chromium und Firefox messen.
Kein Produktcode. Die 20 Testbilder sind synthetisch (Canvas: Verlaeufe, Rechtecke, Rauschen), es zaehlt nur das Tempo.

Start:
- `npm run spike:s1:chromium` (Playwright, headless)
- `VEIL_FIREFOX_BIN=<Pfad zur Firefox-Datei> npm run spike:s1:firefox` (selenium-webdriver, headless)

Ausgabe: Zusammenfassung im Terminal und `ergebnis-<browser>-<zeitstempel>.json` in diesem Ordner (per .gitignore ausgeschlossen).
Gemessen werden: Modell-Ladezeit, Kaltstart (Session bis erste Inferenz), Median, p90, min, max je Bild, SIMD, Ausgabeform, Gesamtzeit.
Hinweis: Echte Testbilder werden in Session 2 ueber `/api/bilder` nachgeruestet; bis dahin ist die Messung nur eine Tempo-Aussage.

## Backends (Erweiterung)

Die Messung kennt drei Backends, gewaehlt ueber URL-Parameter (die Laufskripte setzen sie):
- `?backend=wasm` (Standard): `ort.wasm.min.js`, ein Thread, geladen wird `ort-wasm-simd-threaded.wasm`.
- `?backend=webgpu`: `ort.webgpu.min.js` mit `executionProviders: ['webgpu']`. Geladen werden `ort-wasm-simd-threaded.asyncify.mjs` und `.asyncify.wasm` (nicht `jsep`, das hat ort-web 1.31.1 fuer dieses Bundle nicht angefragt). Scheitert WebGPU, faellt die Messung auf wasm zurueck, der Fehler steht in `fehlerLog`, `genutztesBackend` lautet dann `wasm-rueckfall` (die Zahlen sind dann wasm-Zahlen, nicht WebGPU).
- `?threads=4` (mit wasm): `numThreads = 4`. Der Server sendet dann `Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp` fuer die Seite sowie COEP und CORP auf den ORT-Dateien (ohne COEP auf den Worker-Skripten haengt der Start). Backend-Name im Ergebnis: `wasm-threads4`. Ohne `?threads` sendet der Server keine dieser Kopfzeilen, die Basismessung bleibt unberuehrt.

Start:
- `npm run spike:s1:chromium:webgpu`
- `npm run spike:s1:chromium:threads`
- `VEIL_FIREFOX_BIN=<Pfad> npm run spike:s1:firefox:webgpu`
- Zusatzparameter Chromium: `--sichtbar` (Fenster statt headless), `--threads N`, `--backend webgpu`.

Ergebnisdatei: `ergebnis-<browser>-<backend>-<zeitstempel>.json`. Neue Felder: `backend`, `genutztesBackend`, `navigatorGpu` (ja/nein), `gpuAdapter`, `fehlerLog`, `geladeneOrt` (tatsaechlich per Netz geladene ORT-Dateien), `crossOriginIsolated`.

Noetige Flags:
- Chromium headless (Playwright, Mac mit Apple-GPU): `--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal --ignore-gpu-blocklist`. Mit diesen Flags lief WebGPU headless, ein sichtbares Fenster war nicht noetig. Nicht einzeln geprueft, welche der Flags wirklich Pflicht sind.
- Firefox: `dom.webgpu.enabled=true` (per Preference gesetzt). `navigator.gpu` ist da, aber `requestAdapter()` liefert headless keinen Adapter, ORT faellt auf wasm zurueck. Nicht weiter untersucht (sichtbares Fenster, `dom.webgpu.allow-present-without-webrender` und Nightly-Flags sind ungeprueft).
- Hinweis: WebGPU-Kaltstart enthaelt das Uebersetzen der Shader, der Wert je Bild danach ist der Dauerwert.
