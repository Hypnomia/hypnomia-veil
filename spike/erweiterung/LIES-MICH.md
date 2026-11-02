# Spike-Erweiterung (Wegwerf-Code, kein Produktcode)

Zweck: dieselben Messungen wie `spike/s1-modell/`, aber im echten Erweiterungskontext: Chrome Offscreen-Dokument,
Firefox Hintergrundseite, Content-Script bei `document_start` in allen Frames. Dazu S2 (fremde Bilder nachladen),
S3 (Videobilder), S4 (Schleier-Strategien a, b, c) und die Feed-Kennzahl (Zeit bis der sichtbare Bereich frei ist).

## Dateien
- `erkenner.js`: laedt Modell und ORT, beantwortet Nachrichten `wecke`, `status`, `lade`, `pruefeUrl`, `pruefePixel`, `hole`, `videoBild`, `steuer`. Laeuft im Offscreen-Dokument (Chrome) oder in der Hintergrundseite (Firefox, `background.scripts`).
- `sw.js`: Chrome Service Worker. Sorgt fuer das Offscreen-Dokument (`wecke` mit `ziel: 'sw'`), registriert bei Strategie b die CSS zur Laufzeit, fuehrt Steuerfunktionen mit tabs-API aus.
- `ort-lader.js`, `offscreen.html`: laden das ORT-Bundle (wasm oder webgpu) und den Erkenner.
- `inhalt.js` plus erzeugte `inhalt-konfig.js`: Content-Script. Verdeckt Shadow Roots nach (offen, geschlossen, deklarativ; Pruefung vor jedem Zeichnen per `requestAnimationFrame`), laesst sichtbare Bilder zuerst pruefen und gibt sie per `data-veil="frei"` frei, sammelt auf Anfrage Bild- und Videoadressen (`sammle`), testet Canvas-Lesbarkeit, schickt Videobilder als Pixelliste (`videoPixel`).
- `schleier.css` (Strategie a im Manifest, b zur Laufzeit), `vollschleier.css` (Strategie c: ganze Seite bis zum ersten Durchlauf).
- `steuer.js`: Steuerfunktionen (`messeS1`, `kaltstart`, `messeS2`, `holeListe`, `sammleTab`, `freigabenVonTab`, `status`). Laeuft als Content-Script auf der Brueckenseite, im Service Worker und in der Hintergrundseite.
- `bruecke.js`, `bruecke.html`: WebDriver kann in Firefox keine `moz-extension`-Seiten steuern. Die Laufskripte oeffnen deshalb `http://127.0.0.1:<port>/bruecke.html` (vom S1-Server geliefert), loesen dort das Ereignis `veil-befehl` aus, und das Content-Script schreibt die Antwort als Attribut ans html-Element.
- `popup.html`, `popup.js`: Knopf "Measure this tab" fuer den Lauf, den der Inhaber selbst startet (Entscheidung 49). Es gehen nur Hosts, Statuscodes, Bytes und Zeiten an `http://127.0.0.1:47180/api/ergebnis-s2`; keine Bilder, keine vollstaendigen Adressen.
- `bau.mjs`: baut nach `.output/spike-<browser>-<name>/` (Firefox zusaetzlich `.zip`). Kopiert ORT-Dateien und die Modelle aus `../04 Alt-Code Referenz/modelle/`, erzeugt `manifest.json` und `konfig.json`.
- `lauf-ext.mjs`: baut, startet den S1-Server (Port `VEIL_S1_PORT`, Standard 47181), laedt die Erweiterung (Chromium: Playwright, Firefox: selenium temporaer) und fuehrt eine Aufgabe aus.
- `reihe-ext.sh`: die Messreihe fuer MESSUNG-PHASE-1 (Log `reihe-ext.log`).

## Start
```
node spike/erweiterung/lauf-ext.mjs --browser chromium --modell 320n --backend wasm --aufgabe s1
node spike/erweiterung/lauf-ext.mjs --browser chromium --modell 640m --backend webgpu --aufgabe kaltstart --warten 35000 --schliessen
node spike/erweiterung/lauf-ext.mjs --browser firefox --modell 320n --backend wasm --aufgabe s1 --max 20
node spike/erweiterung/lauf-ext.mjs --browser chromium --aufgabe s2 --url https://www.reddit.com/r/pics/
node spike/erweiterung/lauf-ext.mjs --browser chromium --aufgabe s2 --url http://127.0.0.1:47184/videos.html --videoBild --videoPixel   (vorher npm run spike:s2:server)
node spike/erweiterung/lauf-ext.mjs --browser chromium --strategie a --aufgabe feed --url "http://127.0.0.1:47182/feed.html?n=20"   (vorher npm run spike:s4:server)
node spike/erweiterung/bau.mjs --browser chromium --strategie a --freigabe nie --name s4-a   (dann npm run spike:s4:aufnahme -- --browser chromium --erweiterung .output/spike-chromium-s4-a)
```
Parameter: `--modell 640m|320n|beide`, `--backend wasm|webgpu`, `--threads N` (Chrome: COOP/COEP im Manifest, `crossOriginIsolated` wird mitgeschrieben), `--strategie a|b|c`, `--freigabe pruefung|nie`, `--kanal rgb|bgr`, `--max N`, `--saetze nsfw,sfw`, `--sichtbar`, `--warten <ms>`, `--schliessen` (Chrome: Offscreen-Dokument ausdruecklich schliessen und neu starten).

## Lauf durch den Inhaber (S2/S3 live, Entscheidung 49)
1. `node spike/s1-modell/server.mjs` laufen lassen (Port 47180, nimmt die Ergebnisse an).
2. `node spike/erweiterung/bau.mjs --browser chromium --modell 320n --strategie a --name live` ergibt `.output/spike-chromium-live/`.
3. In Chrome `chrome://extensions`, Entwicklermodus an, "Entpackte Erweiterung laden", den Ordner waehlen.
4. Seite oeffnen, auf das Erweiterungssymbol klicken, "Measure this tab". Ergebnis landet als `ergebnis-s2-live-chrome-<host>-<zeit>.json` in diesem Ordner.
5. Danach die Erweiterung in `chrome://extensions` wieder entfernen.

Ergebnisdateien `ergebnis-*.json` sind per `.gitignore` ausgeschlossen.
