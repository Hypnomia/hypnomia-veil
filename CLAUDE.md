# CLAUDE.md: Arbeitsregeln fuer HYPNOMIA VEIL

Browser-Erweiterung der Marke Mia (Hypnomia). Dieses Repo ist der Code (Demo, oeffentlich). Planung, Entscheidungen, Fahrplan und Uebergaben liegen im Elternordner (`../00 Planung`, `../01 Uebergabe`). Lies vor jeder Session `../00 Planung/START-HIER.md`, `ENTSCHEIDUNGEN.md`, die FAHRPLAN-Phase und die letzte `UEBERGABE-N.md`.

## Unverhandelbar
1. Nach aussen tritt nur Mia auf. Kein Klarname, keine private Mail, kein Nutzerpfad (keine absoluten Pfade mit Benutzername) in Code, Kommentaren, Git-Autor, Manifest, Build-Dateien, Bild-Metadaten, Anleitungen, Commit-Texten. Git-Autor ist "Mia" mit der GitHub-Tarnadresse. Keine Co-Author-, Session- oder Werkzeug-Zeilen in Commits.
2. Die Leck-Sperre (`scripts/leak-check.sh`) liest ihre Musterliste aus `../.lokal/leck-muster.txt`, AUSSERHALB des Repos. Die Muster stehen in keiner Repo-Datei und nicht in dieser Datei. Fehlt die Liste, blockt der Hook. Git-Hooks liegen in `scripts/hooks/` (core.hooksPath), Claude-Hooks in `.claude/settings.json`.
3. Mia-Bilder gehen nie ins Repo und nie zu GitHub. Rasterbilder sind per .gitignore und Hook geblockt (Ausnahme `public/icons/`). Der Pack-Bau und der Demo-Bau lesen Bilder aus `../02 Assets Mia/`.
4. Kein Commit ohne gruene Tests. Chromium (Playwright mit geladener Erweiterung) UND Firefox (web-ext/geckodriver, Playwright kann in Firefox keine Erweiterungen laden) in jeder Abnahme. Android-Emulator ab Phase 5.
5. Lieber messen als behaupten: jede Aussage "funktioniert" steht neben Datei, Zahl und Browser. Messdateien heissen `../00 Planung/MESSUNG-PHASE-N.md`.
6. Kein Agent prueft seine eigene Arbeit. Pruefer bekommt nur Spezifikation und Diff, nie die Begruendung des Bauers, und ist ein anderes Modell als der Bauer.
7. Nichts veroeffentlichen (GitHub-Release, AMO, Patreon, SubscribeStar, itch) ohne Einzel-Ok des Inhabers. Pushen des Codes nach GitHub ist erlaubt.
8. Nie Produktcode aus Werkzeug-Ausgaben abtippen; Dateien direkt bearbeiten.
9. Pause immer frei, Deinstallation normal, kein echter Lock. Blitz-Grenzen wie SUBMERGE: max. 3 vollflaechige Wechsel pro Sekunde, Streifen 2,5 Hz, Ruhig-Modus.

## Sprache und Stil
- Dokumente, Kommentare, Commit-Texte: Deutsch. Oberflaeche: Englisch in der Stimme von Mistress Mia (bestimmt, verspielt, nie grob gegen den Nutzer selbst, sachlicher Kern bei Sicherheitshinweisen).
- Nie gendern. Keine Gedankenstriche (kein "–" und kein "—"), stattdessen Komma, Punkt oder Doppelpunkt.
- Keine Umlaute in Dateinamen. In Texten sind ae/oe/ue erlaubt.

## Rollen (siehe `.claude/agents/`)
| Rolle | Datei | Modell | Werkzeuge |
|---|---|---|---|
| Bauer | bauer.md | Sonnet | alle, schreibt Code und Tests |
| Pruefer | pruefer.md | Opus | nur lesen |
| Messer | messer.md | Sonnet | fuehrt Tests aus, schreibt Messdatei, kein Produktcode |
| Sicherheit | sicherheit.md | Opus | nur lesen |
| Texter | texter.md | Opus | Texte in Mias Stimme |
| Bildwaehler | bildwaehler.md | Sonnet | Kontaktboegen, Frisur, Stufen |
| Handlanger | handlanger.md | Haiku | Konvertieren, Umbenennen, Rohfassungen |

Ablauf je Auftrag: Bauer, dann Messer, dann Pruefer, Nachbesserung durch Bauer, Pruefer erneut (max. 2 Runden, dann Eskalation an den Orchestrator).

## Befehle
- `npm test`: Chromium- und Firefox-Tests (beide muessen gruen sein)
- `npm run test:chromium`, `npm run test:firefox`: einzeln
- `npm run test:android`: Firefox fuer Android im Emulator (vorher `export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` und Emulator `veil-android15` starten); installiert die signierte XPI aus `.output/signed/`
- `npm run spike:s0`, `npm run spike:s1:chromium`, `npm run spike:s1:firefox` (plus `:webgpu`), `node spike/erweiterung/lauf-ext.mjs`, `npm run spike:s4:aufnahme`, `npm run spike:s2:server`, `node spike/s5-android/lauf-android.mjs`, `node spike/auswertung.mjs`: Wegwerf-Messgeschirr in `spike/` (je Ordner eine LIES-MICH), kein Produktcode; Messreihen `spike/reihe-final.sh` und `reihe-final-2.sh`
- `node scripts/annotate/server.mjs`: Markierwerkzeug fuer die Soll-Zonen (http://127.0.0.1:5188)
- `npm run build`: Chrome-Build; `npm run build:firefox`: Firefox-Build
- `npm run zip`, `npm run zip:firefox`: Pakete fuer Release (landen in `.output/`, nie im Repo)
- `./scripts/leak-check.sh --all`: Leck-Sperre ueber das ganze Repo
- `VEIL_SKIP_TESTS=1 git commit ...`: nur fuer reine Doku-Commits erlaubt

## Aufbau
- `entrypoints/`: background (Chrome: Service Worker + Offscreen-Dokument; Firefox: Hintergrundskript), content (Schleier), popup
- `src/`: Logik (Erkennung, Zonen, Stile, Whitelist, Pack-Import)
- `public/`: Icons und statische Dateien ohne Mia-Bilder
- `tests/chromium/`: Playwright; `tests/firefox/`: geckodriver/WebDriver; `tests/fixtures/`: lokale Testseiten
- `scripts/`: Hooks, Leck-Sperre, Pack-Bau, Release
- `data/`: Datendateien (`links.json`, Standard-Ausnahmeliste, Quiz-Bank)
- `docs/`: Anleitungen (Englisch, Mias Stimme)

## Technik (aus ENTSCHEIDUNGEN.md, dort gilt die Langfassung)
- Manifest V3, WXT als Geruest (ein Code, zwei Manifeste, Firefox-Build inklusive). Fester `key` im Chrome-Manifest (privater Schluessel in `../.lokal/`, nie im Repo). `browser_specific_settings.gecko.id` fuer Firefox.
- Erkennung im Browser mit onnxruntime-web, kein Netzverkehr ausser Bild-Nachladen der aktuellen Seite und Versions-Check.
- Pack-Speicher: IndexedDB mit `unlimitedStorage`.
- Hide-first: erst verstecken, dann pruefen, dann freigeben.
