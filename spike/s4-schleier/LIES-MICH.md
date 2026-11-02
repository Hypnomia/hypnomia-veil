# S4: Schleier vor dem ersten Zeichnen

Wegwerf-Messgeschirr, kein Produktcode. Frage: Verdeckt die Erweiterung Bilder, bevor der Browser sie zum ersten Mal zeichnet (kein Aufblitzen)? Gemessen wird mit einer Bildschirmaufnahme der sichtbaren Browser-Sitzung. Als Testbild dient ein reines Magenta (#FF00FF). Ist die Erweiterung wirksam, darf in keinem Einzelbild Magenta auftauchen.

## Dateien

- `server.mjs`: Messserver auf 127.0.0.1, zwei Ports (haupt 47182, fremd 47183, per `VEIL_S4_PORT` und `VEIL_S4_PORT2` aenderbar). Routen: `/magenta.png` (200x200, zur Laufzeit mit sharp erzeugt), `/magenta.mp4` (2 s, einmalig per ffmpeg nach `.output/spike-s4/` erzeugt, ohne ffmpeg 404), `/blitz.html`, `/rahmen.html`, `/feed.html?n=20&spalten=1` (soziales Netzwerk mit Testbildern aus `/testbild/sfw/<name>`, ab dem fuenften Bild `loading="lazy"`, jedes Bild mit `data-feed-index`) und `/testbild/sfw/<name>` (Dateien aus `../05 Testbilder/sfw/`).
  - `spalten=1` (Standard): eine Spalte, Bild 600 x 750 (4:5).
  - `spalten=2`: Bildbreite 300 (quadratisch). Bei 1280x713 Seitenausschnitt liegen 4 Bilder zumindest teilweise im Startausschnitt, 2 davon ganz.
  - `spalten=3`: Bildbreite 200 (4:5). 6 Bilder liegen ganz im Startausschnitt.
- `fixture/blitz.html`: 18 Kacheln im Raster 6 x 3 (je 200x200, 10 px Abstand, Raster 1260 px breit, weil 6 mal 200 plus 5 Abstaende schon 1250 px sind), dazu die Kachel `lazy-scroll` weit unterhalb. Die Faelle:
  - Verdeckung: `html-sofort`, `skript-0ms`, `skript-50ms`, `skript-500ms`, `lazy`, `shadow-offen`, `shadow-geschlossen`, `shadow-deklarativ`, `iframe-fremd`, `iframe-blank`, `css-style`, `css-klasse`, `picture`, `video`, `canvas`.
  - `referenz`: reines Gruen (#00FF00) als CSS-Hintergrund, kein Bild, `position: fixed` (bleibt auch beim Scrollen sichtbar). Positivkontrolle: Eine Erweiterung kann sie nicht verdecken.
  - `blitz-1frame`: magentafarbenes div, 400 ms nach load fuer genau einen requestAnimationFrame sichtbar (ein Anzeigebild, etwa 13 bis 17 ms).
  - `blitz-50ms`: magentafarbenes div, 800 ms nach load fuer 50 ms sichtbar.
  - `lazy-scroll`: Bild mit `loading="lazy"` 3800 px unter dem Seitenanfang (rund 3000 px unter dem Ausschnitt). Das Aufnahmeskript scrollt 2,5 s nach der Navigation dorthin.
  - Ein blauer Streifen am Seitenanfang (`#phasenmarke`) zeigt je Frame, ob die Seite noch oben steht oder schon gescrollt ist (siehe Auswertung).
  - Der Server setzt den Port des fremden Servers in `data-port2` am body ein. Beim load-Ereignis steht `document.documentElement.dataset.s4Geladen` (performance.now).
- `aufnahme.mjs`: startet den Server, den Browser sichtbar (1280x800 bei 0,0), nimmt den Bildschirm auf, zaehlt Magenta je Einzelbild und je Kachel.

## Start

```
npm run spike:s4:server
npm run spike:s4:aufnahme -- --browser chromium --ohne-erweiterung --dauer 4
npm run spike:s4:aufnahme -- --browser chromium --erweiterung .output/chrome-mv3 --name chromium-veil
npm run spike:s4:aufnahme -- --browser firefox --erweiterung .output/hypnomia-veil-0.0.1-firefox.zip --name firefox-veil
# Testhaken "Freigabe sperren" (nur mit Testbau, WXT_TESTHAKEN=1): kein Element wird je sichtbar
npm run spike:s4:aufnahme -- --browser chromium --erweiterung .output-test/chrome-mv3 --freigabe-sperren --name chromium-gesperrt
```

Der Browser muss auf dem Bildschirm sichtbar sein (nicht verdeckt, kein zweites Fenster darueber, kein Bildschirmschoner). Waehrend der Aufnahme nichts anklicken. Dem startenden Programm (Terminal oder Claude) muss in den macOS-Systemeinstellungen die Bildschirmaufnahme erlaubt sein.

## Parameter

| Parameter | Bedeutung |
|---|---|
| `--browser chromium\|firefox` | Pflicht |
| `--erweiterung <Pfad>` | Chromium: entpackter Ordner (z. B. `.output/chrome-mv3`); Firefox: Zip oder XPI (temporaer installiert) |
| `--ohne-erweiterung` | Kontrolllauf ohne Erweiterung (muss Magenta in allen Verdeckungs-Kacheln zeigen) |
| `--url <Adresse>` | Standard `http://127.0.0.1:47182/blitz.html`. Die Zaehlung nach Kacheln gilt nur fuer `blitz.html` |
| `--dauer <Sekunden>` | Aufnahmedauer, Standard 6. Mit 4 Sekunden bleiben nach dem Scrollen nur etwa 20 bis 25 Frames fuer `lazy-scroll`; 6 ist komfortabler |
| `--freigabe-sperren` | haengt `veil-freigabe=nie` an die Seitenadresse (auch an den Rahmen `iframe-fremd`). Mit einem Testbau der Erweiterung bekommt dann kein Element je ein Urteil-Attribut und bleibt bei opacity 0 (weder frei noch zensiert noch unscharf). Erwartung: in keinem Einzelbild Magenta in einer Verdeckungs-Kachel, auch nicht nach Ende der Beurteilung (dort sonst die Freigabe). Ausnahme ist `css-klasse`: Hintergruende aus einem Stylesheet versteckt der Schleier nicht vorab (erst nach load beurteilt, ein Klassen-Hintergrund ohne Treffer bleibt ohnehin sichtbar), diese Kachel zaehlt in der Gegenprobe nicht. Im Release-Bau ist der Haken nicht enthalten, der Parameter bleibt wirkungslos. Das Ergebnis traegt `freigabeGesperrt: true` |
| `--name <Kennung>` | fuer Dateinamen und Arbeitsordner, Standard Browsername (plus `-kontrolle`) |

Umgebungsvariablen: `VEIL_FIREFOX_BIN`, `VEIL_FFMPEG`, `VEIL_S4_PORT`, `VEIL_S4_PORT2`, `VEIL_S4_LOG`.

## Ablauf

1. Server starten, Browser starten, `about:blank` laden. Wiederholrate des Bildschirms per `system_profiler SPDisplaysDataType` notieren (`bildschirmHz`).
2. ffmpeg starten: AVFoundation, Eintrag "Capture screen 0", Wunsch 60 Bilder je Sekunde, ohne Mauszeiger, yuv444p, libx264 mit `-qp 0` (verlustfrei). Zusaetzlich `-preset ultrafast`, damit der Kodierer bei Retina-Aufloesung mithaelt.
3. Sobald ffmpeg das erste Bild geschrieben hat, 300 ms warten, dann die Zieladresse laden (Firefox mit `pageLoadStrategy eager`).
4. Direkt nach DOMContentLoaded Fensterlage und Kacheln lesen (frueh), nach dem load-Ereignis noch einmal (spaet). Weichen beide Lagen um mehr als 0,5 px ab, steht `kachelnVerschoben: true` samt `verschiebungen` im Ergebnis.
5. 2,5 s nach der Navigation per `window.scrollTo` zur Kachel `lazy-scroll` scrollen und die Lage danach neu lesen.
6. Nach der Dauer ffmpeg beenden, Browser schliessen. Einzelbilder (auf den Seiteninhalt zugeschnitten) nach `.output/spike-s4/<name>/bildschirm/frame-%04d.png` mit den echten Zeitstempeln (`-fps_mode passthrough`, Zeit je Frame aus `showinfo`), nicht auf eine feste Bildrate aufgefuellt.
7. Zaehlung mit sharp: Magenta heisst R>200, G<60, B>200; Gruen R<60, G>200, B<60. Je Frame wird die Phase bestimmt (blaue Marke zu mindestens 30 Prozent sichtbar: oben, Lage der Kacheln nach dem Laden; sonst: gescrollt, dann zaehlen nur `lazy-scroll` an der neuen Lage und `referenz`). So kann die Kachel `lazy-scroll` ohne Zeitabgleich zwischen Browser und Aufnahme gezaehlt werden.
8. Nur Chromium: das Playwright-Video (`recordVideo`) wird als zweite Quelle genauso ausgewertet (Ordner `pw-frames`).

Scheitert die Bildschirmaufnahme am Recht, meldet das Skript "macOS-Recht Bildschirmaufnahme fehlt" und endet mit Exit 2; das Playwright-Video wird trotzdem ausgewertet. Ist die Positivkontrolle nicht erfuellt, endet das Skript mit Exit 3.

## Ausgabe

`ergebnis-<name>-<zeitstempel>.json` (Quelle `bildschirm`) und, nur Chromium, `ergebnis-<name>-pwvideo-<zeitstempel>.json` (Quelle `playwright-video`). Beide stehen in `.gitignore`. Felder:

- Kopf: `browser`, `erweiterung` (ja oder nein), `bildschirmHz`, `fenster`, `navigationNachAufnahmestartMsUngefaehr`, `kachelnVerschoben`, `lazyScrollGescrollt`, `aufnahmeStatistik` (ffmpeg: geschriebene Bilder, Tempo, dup, drop).
- `ungueltig` (`true` mit `ungueltigGrund`), wenn die Referenz nie erscheint, in weniger als 90 Prozent der Frames sichtbar ist (gezaehlt ab dem ersten Frame, in dem sie erscheint) oder erst mehr als 3 s nach der Navigation auftaucht. `referenz`: `framesMitGruen`, `anteil`, `basisFrames`, `ersterGruenFrame`, `ersterGruenMs`.
- `frames`, `bildrate` (Wunsch), `bildrateEffektiv`, `dauerMs`, `ersterMagentaFrame`, `letzterMagentaFrame`, `framesMitMagenta`, `skala`.
- `luecken`: `[{ nachFrame, ms }]` fuer Abstaende zwischen zwei Frames von mehr als 20 ms, dazu `lueckenGroessteMs` und `lueckenSummeMs`.
- `magentaOhneKachel`: `{ frames, maxPixel }`, Magenta ausserhalb aller Kacheln.
- `kurzblitze`: je `blitz-1frame` und `blitz-50ms` `erfasst`, `framesMitMagenta`, `ersterFrame`.
- `kacheln`: Objekt je Fallname mit `framesMitMagenta`, `framesVoll` (mehr als 90 Prozent der Kachel magenta), `ersterFrame`, `ersterFrameMs`, `maxPixel`, `erfasst`.
- `magentaFrames`: je Frame mit Magenta `frame` (ab 1), `ms`, `magentaPixel`, `ausserhalbKachel`, `kacheln` (Pixelzahl je betroffener Kachel).

Lesen der Kurzblitze: Ein Anzeigebild dauert bei 60 Hz rund 16,7 ms (der Bildschirm laeuft laut `system_profiler` mit 60 oder 75 Hz). Die Aufnahme liefert echte Frames in unregelmaessigem Abstand, deshalb kann `blitz-1frame` auch ohne Erweiterung verfehlt werden. Fuer die Auswertung einer Erweiterung gilt: Ist `blitz-50ms` erfasst, ist die Aufnahme fein genug fuer Blitze ab 50 ms; ein verfehlter `blitz-1frame` sagt dann nichts ueber die Erweiterung. Ein Magenta-Blitz in der Erweiterungs-Aufnahme, der kuerzer als ein Frame ist, bleibt moeglicherweise unsichtbar.

Luecken: Bei ruhigem Bildschirm (vor dem ersten Zeichnen der Seite) liefert AVFoundation Frames nur bei Aenderungen oder seltener; Luecken am Anfang der Aufnahme sind daher normal. Luecken waehrend der Seitenphase sind kritisch, weil dort ein Aufblitzen verschwinden koennte. Beim Playwright-Video (25 Bilder je Sekunde) sind Luecken von 40 ms die Regel.

## Was geprueft wurde (2026-11-02, 4 Sekunden, ohne Erweiterung)

Kontrolllaeufe, Beweis fuer die Zaehlung: In allen 15 Verdeckungs-Kacheln ist Magenta sichtbar, die Referenz ist in 100 Prozent der Frames gruen, Magenta ausserhalb der Kacheln gibt es nie, `kachelnVerschoben` ist in allen Laeufen `false`.

| Lauf | Quelle | Frames | Referenz | Luecken > 20 ms | Magenta je Verdeckungs-Kachel |
|---|---|---|---|---|---|
| Chromium 1 | Bildschirm | 213 (53/s) | 165/165 | 15, groesste 84 ms | 155 Frames, `skript-500ms` 129, `iframe-fremd` 154 |
| Chromium 2 | Bildschirm | 212 (53/s) | 170/170 | 14, groesste 100 ms | 148 Frames, `skript-500ms` 119 |
| Firefox | Bildschirm | 216 (54/s) | 167/167 | 12, groesste 83 ms | 142 Frames, `skript-500ms` 115, `skript-50ms` und `iframe-fremd` 141 |

Alle Luecken liegen in den ersten rund 20 Frames (weisse Seite vor dem ersten Zeichnen) oder beim Scrollen, nicht in der Seitenphase mit den Kurzblitzen.

Kurzblitze und `lazy-scroll`:

| Lauf | `blitz-1frame` | `blitz-50ms` | `lazy-scroll` |
|---|---|---|---|
| Chromium 1, Bildschirm | nicht erfasst | erfasst, 3 Frames | 10 Frames, erster Frame 204 |
| Chromium 2, Bildschirm | erfasst, 1 Frame | erfasst, 3 Frames | 22 Frames, erster Frame 191 |
| Chromium 1, Playwright-Video | erfasst, 1 Frame | erfasst, 1 Frame | 24 Frames |
| Firefox, Bildschirm | erfasst, 1 Frame | erfasst, 3 Frames | 25 Frames, erster Frame 192 |

Der Verzoegerungsunterschied von `skript-500ms` gegenueber den uebrigen Kacheln (rund 26 Frames, 430 bis 450 ms) passt zur Verzoegerung von 500 ms. Im Playwright-Video erscheint `blitz-50ms` in nur einem Frame, weil es mit 25 Bildern je Sekunde aufnimmt.

`maxPixel` einer vollen Kachel liegt im Bildschirm bei 159200 statt 160000 (400 x 400): Die Aufnahme laeuft als uyvy422 (4:2:2, ffmpeg meldet die Umstellung), dadurch sind die zwei Randspalten der Kachel farbverschmiert und fallen unter die Schwelle. Das stoert die Zaehlung nicht.

## Bekannte Grenzen

- Der Browser muss auf "Capture screen 0" liegen; sonst warnt das Skript ueber das Seitenverhaeltnis (`warnung` im Ergebnis).
- Die erste Aufnahme nach frischer Rechtevergabe kann haengen (macOS fragt nach); danach laufen die Aufnahmen.
- Das Playwright-Video beginnt mit dem Seitenstart und ist zeitlich nicht mit der Bildschirmaufnahme abgeglichen.
- Zwischen dem Aufruf der Navigation und dem ersten sichtbaren Frame liegen in der Aufnahme rund 0,9 Sekunden (Erfassungs-Latenz). Die Zeiten der Aufnahme sind deshalb untereinander vergleichbar, nicht mit den Zeiten im Browser.
- Firefox ersetzt das anfaengliche about:blank im Fall `iframe-blank` asynchron, deshalb fuellt die Seite das Bild nach dem Laden erneut ein.
