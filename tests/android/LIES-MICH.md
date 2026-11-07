# Android-Test (Firefox fuer Android im Emulator)

Aufruf: `npm run test:android` (Emulator laeuft, `adb` und `geckodriver` im PATH, `ANDROID_HOME` gesetzt).

- Umgebung: `VEIL_ANDROID_SERIAL` (Standard `emulator-5554`), `VEIL_ANDROID_PACKAGE` (Standard `org.mozilla.firefox`), `VEIL_GECKODRIVER` (Pfad, sonst aus dem PATH).
- Schritt 1 laedt `http://10.0.2.2:47175/hello.html` und liest die Ueberschrift. Schritt 2 installiert die neueste `.output/signed/*.xpi` per `installAddon(pfad, false)` und prueft `dataset.hypnomiaVeil === "hello"`. Fehlt die XPI, wird Schritt 2 mit Meldung uebersprungen.
- Gemessen (Release-Fenix 159.0, Android 15 arm64): Schritt 1 etwa 120 bis 250 ms, Schritt 2 etwa 85 ms. Ein Release-Build genuegt, geckodriver schaltet Marionette selbst ueber die Intent-Argumente frei.
- Falle 1: Selenium Manager traegt sonst ein Desktop-Firefox als `binary` ein, das schliesst sich mit `androidPackage` aus. Darum wird der geckodriver-Pfad ueber `ServiceBuilder` selbst gesetzt.
- Falle 2: `-headless` stuerzt Fenix ab ("headless mode is not currently supported"). Nicht setzen.
- Falle 3: geckodriver loescht bei jedem Start die App-Daten, die Erweiterung ist also pro Lauf neu zu installieren.
- Nicht noetig, aber beobachtet: `am start ... --es args "-marionette"` startet Fenix nur normal, ohne sichtbare Wirkung.
- Fehlt der Test auf echten Geraeten: dort `adb -s <Seriennummer>` freigeben und `VEIL_ANDROID_SERIAL` setzen. Alternative waere Remote-Debugging ueber `adb forward` (nicht noetig, nicht geprueft).

## Phase 8 (Session 14): Durchlauf und Update-Test
- `node tests/android/durchlauf.mjs --alle` (oder `--schritt apis,einstieg,schleier,pack,besuch,pause,bedienung`): Weg einer Nutzerin im Emulator mit dem
  Testbau aus `.output-android` (`VEIL_AUSGABE=.output-android WXT_TESTHAKEN=1 npm run zip:test:firefox`), temporaer installiert. Echtes Pack ueber
  `VEIL_ECHTES_PACK=<pfad>` (Pfad nie in Dateien); es wird nur nach `/sdcard/Download/` im Emulator geschoben und im Android-Dateiwaehler gewaehlt.
  Fotos nach `../03 Recherche/emulator/phase8-*.png`, Zahlen nach `scripts/messung/ergebnis-android-*.json` (ignoriert). Ports 47420 bis 47422 per
  `adb reverse` (Testhaken greifen nur auf 127.0.0.1).
- Hilfen in `tests/android/lib.mjs`. Der Firefox-Willkommensdialog ("Terms of Use") kommt bei jedem geckodriver-Start wieder (App-Daten werden
  geloescht); `raeumeFirefoxDialogeWeg()` bestaetigt ihn im Emulator (Entscheidung 152 der Inhaberin, nur Emulator) und lehnt Einrichtungskarten ab.
  `VEIL_ANDROID_DIALOG_STOPP=1` bricht stattdessen ab.
- Falle: nach dem Start steht der Startbildschirm von Fenix vorn; eine geladene Seite laeuft dann unsichtbar (`innerWidth` 0). Das Skript holt sie
  ueber die Tab-Uebersicht nach vorn (`seiteNachVorn`).
- Falle: Popup oeffnet auf Android als ganze Seite ueber "More options", "Extensions", "HYPNOMIA VEIL"; der WebDriver-Inhaltskontext bleibt die Webseite.
- Update-Test: `node tests/android/update-test/erzeuge.mjs 1.0.0` und `1.1.0`, signieren mit `scripts/release/signieren.mjs` (nur mit Ok),
  dann `node tests/android/update-test/lauf.mjs` (https-Testserver auf 47177 mit eigenem Zertifikat, Ausnahme im Testprofil).
