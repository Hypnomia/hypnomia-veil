# Spike S2/S3: Messserver fuer fremde Bilder und Videos

WEGWERF-Messcode, kein Produktcode.

## Zweck

Lokaler Testserver, mit dem eine Erweiterung spaeter misst, ob sie fremde Bilder und Videos nachladen und lesen kann: Referer-Sperren, fehlendes CORS, Cookies, langsame und riesige Bilder, Videos mit und ohne CORS, Media Source Extensions (MSE). Zaehler und Protokoll liefern Zahlen, zum Beispiel fuer "doppelt geladene Bytes".

## Start

```
npm run spike:s2:server
```

Das ist `node spike/s2-s3-fremd/server.mjs`. Er laeuft dauerhaft, nur auf 127.0.0.1, auf zwei Ports:

- haupt: 47184 (Umgebungsvariable `VEIL_S2_PORT`)
- fremd: 47185 (Umgebungsvariable `VEIL_S2_PORT2`)

Beide Ports liefern dieselben Routen. Der fremde Port ist ein anderer Ursprung, aber dieselbe Site (Cookies kennen keine Ports, `SameSite=Lax` greift hier nicht). Fuer einen echten Cross-Site-Fall die Seite ueber `http://localhost:47184` statt `127.0.0.1` oeffnen.

Aus Code: `import { starteS2Server } from './server.mjs'`, Aufruf `await starteS2Server({ port, port2, stumm })`, Rueckgabe `{ port, port2, codec, schliessen() }`.

Beim ersten Start entstehen unter `.output/spike-s2/` (nie im Repo): `riesig.jpg` (8000x8000, Qualitaet 70, mit sharp), `test.mp4` und `test-frag.mp4` (mit ffmpeg, Pfad per `VEIL_FFMPEG` ueberschreibbar, Standard `/opt/homebrew/bin/ffmpeg`). Das Testbild (640x480) entsteht bei jedem Start im Speicher. Alle Antworten tragen `cache-control: no-store`, damit Zaehler und Protokoll jede Anfrage sehen.

## Bild-Routen

| Route | Verhalten | CORS |
|---|---|---|
| `/ok.jpg` | normal | ja (`*`) |
| `/403-ohne-referer.jpg` | 403, wenn kein `Referer`-Header kommt | ja |
| `/403-fremder-referer.jpg` | 403, wenn der Referer nicht mit `http://<Host:Port der Anfrage>` beginnt | ja |
| `/kein-cors.jpg` | normal | nein |
| `/langsam.jpg` | wie ok, aber nach 2000 ms | ja |
| `/riesig.jpg` | 8000x8000, 11,7 MB | nein |
| `/cookie.jpg` | 200 nur mit Cookie `s2test=1`, sonst 403 | ja |
| `/setze-cookie` | setzt `s2test=1` (Path=/, SameSite=Lax), Text 200 | nein |

## Video-Routen

Testvideo: 3 s, 320x240, rot, gruen, blau je Sekunde, H.264 Constrained Baseline, yuv420p. Codec-String aus der Datei gelesen: `avc1.42C01E` (nicht 42E01E; der Server liest ihn aus der `avcC`-Box und setzt ihn in die Seite ein).

| Route | Verhalten | CORS |
|---|---|---|
| `/video.mp4` | normal (`+faststart`), Range (206), `accept-ranges: bytes` | nein |
| `/video-cors.mp4` | dasselbe | ja |
| `/video-frag.mp4` | fragmentiert (`frag_keyframe+empty_moov+default_base_moof`) fuer MSE | ja |

Range: `bytes=a-b`, `bytes=a-`, `bytes=-n`; ungueltig gibt 416.

## Seiten

Der Server ersetzt `{{PORT2}}` durch den jeweils anderen Port (vom Hauptport aus also den fremden) und `{{CODEC}}` durch den avc1-Wert.

- `/videos.html`: vier Videos 320x240 mit `data-fall`: `gleich`, `fremd-ohne-cors`, `fremd-mit-cors` (`crossorigin="anonymous"`), `mse` (fetch vom fremden Port, ein SourceBuffer, `endOfStream`). Der MSE-Status steht in `window.__mseStatus`.
- `/bilder.html`: je Bildroute ein `<img>` gleich und fremd (`data-fall="<route>-<gleich|fremd>"`, zum Beispiel `ok-fremd`), plus `ok-fremd-crossorigin`.

## Zaehler und Protokoll

- `/zaehler.json`: je Route `{ anfragen, bytes }` (Laenge der gesendeten Antwort, bei abgebrochener Uebertragung der geplante Wert). Zaehler und Protokoll sind je Port getrennt, also auf dem Port abfragen, den man misst. `/zaehler/reset` setzt zurueck.
- `/protokoll.json`: je Antwort `route, methode, status, refererVorhanden, refererHerkunft` (nur Ursprung), `cookie` (ja/nein), `range`, `secFetch` (alle `sec-fetch-*`-Header), `zeit`. `/protokoll/reset` leert es.
- Die Meta-Routen selbst werden nicht gezaehlt oder protokolliert.

## Was geprueft wurde

Datum 2026-11-02, Node 26, Server mit Standardports.

Direkte Anfragen (Node-fetch, ohne Browser):

- Bildroute, ohne Referer / Referer eigen / Referer fremd / mit Cookie: ok 200/200/200/200; 403-ohne-referer 403/200/200/403 (ohne Referer und mit Cookie allein 403); 403-fremder-referer 403/200/403/403; kein-cors 200 ueberall, ohne CORS-Header; langsam 200 nach 2001 ms; riesig 200; cookie 403/403/403/200.
- `/riesig.jpg`: 11 672 008 Bytes, 8000x8000. `/ok.jpg`: 18 543 Bytes. `test.mp4`: 3336 Bytes, `test-frag.mp4`: 3709 Bytes.
- Range auf `/video.mp4`: `bytes=0-99` gibt 206 mit 100 Bytes und `content-range: bytes 0-99/3336`; `bytes=-50` gibt 206, 50 Bytes; `bytes=100-` gibt 206, 3236 Bytes; `bytes=99999-` gibt 416.
- `/setze-cookie`: 200, `set-cookie: s2test=1; Path=/; SameSite=Lax`.
- Reset von Zaehler und Protokoll geleert (0 Routen, 0 Eintraege).

Seiten in Playwright-Chromium (headless, ohne Erweiterung, Skript `pruefe-seiten.mjs`). Das ist die Grundlinie: was die Seite selbst lesen kann.

Videos nach 2 s:

| Fall | readyState | videoWidth | src beginnt mit blob: | getImageData wirft |
|---|---|---|---|---|
| gleich | 4 | 320 | nein | nein |
| fremd-ohne-cors | 4 | 320 | nein | ja (SecurityError) |
| fremd-mit-cors | 4 | 320 | nein | nein |
| mse | 4 | 320 | ja | nein |

Bilder nach 5 s (getImageData nach drawImage auf 16x16-Canvas):

| Route | gleich | fremd |
|---|---|---|
| ok | nein | ja (SecurityError) |
| 403-ohne-referer | nein | ja (SecurityError; der Browser sendet bei fremden Bildern einen Referer, daher 200) |
| 403-fremder-referer | nein | ja (InvalidStateError, Bild 403 und nicht geladen, naturalWidth 0) |
| kein-cors | nein | ja (SecurityError) |
| langsam | nein | ja (SecurityError) |
| riesig | nein | ja (SecurityError) |
| cookie ohne Cookie | ja (InvalidStateError, 403) | ja (InvalidStateError, 403) |
| cookie nach `/setze-cookie` | nein | ja (SecurityError) |
| ok-fremd-crossorigin | | nein (crossorigin="anonymous" mit CORS lesbar) |

Lesehilfe: Fremde Bilder und Videos ohne `crossorigin` und CORS machen den Canvas unlesbar (SecurityError). Mit `crossorigin="anonymous"` und `access-control-allow-origin: *` ist er lesbar. Ein MSE-Video (blob-URL) ist lesbar, weil die Seite die Bytes per CORS-fetch selbst geholt hat.

Nicht geprueft: Firefox, und alles mit geladener Erweiterung (das ist der eigentliche Spike).

## Dateien

- `server.mjs`: der Server
- `seiten/videos.html`, `seiten/bilder.html`: Testseiten
- `pruefe-seiten.mjs`: Grundlinien-Lauf in Playwright-Chromium
