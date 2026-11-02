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
