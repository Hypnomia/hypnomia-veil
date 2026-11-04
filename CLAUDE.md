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
- `npm test`: Einheitstests, Builds mit Testhaken (`WXT_TESTHAKEN=1`) nach `.output-test`, dann Chromium- und Firefox-Tests (alles muss gruen sein); `.output/` bleibt dem Release-Bau vorbehalten
- `npm run test:einheit` (Node, ohne Browser), `npm run test:chromium`, `npm run test:firefox`: einzeln (Browser-Tests brauchen einen Build mit Testhaken: `npm run build:test`, `build:test:firefox`, `zip:test:firefox`)
- `VEIL_AUSGABE=<ordner>` waehlt einen anderen Ausgabeordner fuer Bau und Tests (z. B. wenn parallel gemessen wird); `VEIL_FIXTURE_PORT` und `VEIL_FIXTURE_PORT_FREMD` (Standard 47173 und 47175) die Ports des Testservers (`npm run fixtures` startet ihn von Hand)
- `node scripts/messung/zonen.mjs|feed.mjs|kaltstart.mjs`: Messwerkzeuge Phase 2 (Treffer je Zone, Zeit bis sichtbarer Bereich frei, Kaltstart), kein Produktcode; lesen den Testbau aus `.output-test` (nach `npm test`), `VEIL_AUSGABE` waehlt einen anderen Ordner
- `node scripts/messung/yunet.mjs --teil alles` (YuNet gegen die geschaetzten Gesichtsbaender, Modell aus `../04 Alt-Code Referenz/modelle/`), `node scripts/messung/video.mjs --laeufe 3 --dauer 30` (CPU-Last der laufenden Video-Nachpruefung); `scripts/messung/zonen.mjs` schaltet alle Zonen an und misst damit 320n plus YuNet
- `VEIL_NUR=<Praefix> node tests/firefox/video.test.mjs`: nur die Video-Faelle mit diesem Namensanfang
- `node scripts/messung/feed-lang.mjs --ausgabe <ordner> --browser beide --laeufe 3 [--takt 500]`: langer Feed mit Endlos-Nachladen (Anteil beim Eintritt beurteilter Bilder, Zeit bis frei je Scroll-Schritt, lange Aufgaben); eigener Server auf `VEIL_FIXTURE_PORT`
- `npm run pack:dummy`: Dummy-Pack aus synthetischen Bildern nach `.output-pack/dummy.miapack` (nie ins Repo); `npm run pack:bau -- --quelle <ordner> --aus <datei>`: Pack aus einem Ordner mit `pack.json` (spaeter `../02 Assets Mia/pack/`)
- Weitere Schalter fuer Tests: `VEIL_FIREFOX_BIN=<pfad>` (anderer Firefox, z. B. 128 aus `../.werkzeuge.nosync/`, Pfad nie in Dateien schreiben), `VEIL_OHNE_TESTBILDER=1` (Render-Tests ohne `../05 Testbilder` laut ueberspringen statt rot), `VEIL_NUR_RELEASEPRUEFUNG=1` (nur die Suche nach Testhaken-Spuren im Release-Bau)
- `npm run test:android`: Firefox fuer Android im Emulator (vorher `export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` und Emulator `veil-android15` starten); installiert die signierte XPI aus `.output/signed/`
- `npm run spike:s0`, `npm run spike:s1:chromium`, `npm run spike:s1:firefox` (plus `:webgpu`), `node spike/erweiterung/lauf-ext.mjs`, `npm run spike:s4:aufnahme`, `npm run spike:s2:server`, `node spike/s5-android/lauf-android.mjs`, `node spike/auswertung.mjs`: Wegwerf-Messgeschirr in `spike/` (je Ordner eine LIES-MICH), kein Produktcode; Messreihen `spike/reihe-final.sh` und `reihe-final-2.sh`
- `node scripts/annotate/server.mjs`: Markierwerkzeug fuer die Soll-Zonen (http://127.0.0.1:5188)
- `npm run build`: Chrome-Build; `npm run build:firefox`: Firefox-Build (beide ohne Testhaken, `prebuild` kopiert die WASM-Laufzeit nach `public/ort/`)
- `npm run zip`, `npm run zip:firefox`: Pakete fuer Release (landen in `.output/`, nie im Repo)
- `./scripts/leak-check.sh --all`: Leck-Sperre ueber das ganze Repo
- `VEIL_SKIP_TESTS=1 git commit ...`: nur fuer reine Doku-Commits erlaubt

## Aufbau
- `entrypoints/`: `background.ts` (Chrome: Service Worker, legt `offscreen/` an; Firefox: Hintergrundskript mit Erkenner), `content/` (Schleier, CSS hide-first), `wurzel-haken.content.ts` (Seitenwelt `world: 'MAIN'`: legt beim Anlegen jeder Shadow Root sofort die Versteck-Regel hinein), `popup/`, `options/` (Einstellungsseite: Mia Pack importieren und entfernen)
- `src/`: `nachrichten.ts` (Vertrag), `einstellungen.ts`, `erkenner/` (Modell 320n, YuNet fuer Gesichtszonen, Zonen, Stile, Nachladen mit Netzgrenze, Warteschlange), `schleier/` (Beobachter, Pruefung, Anwenden, Shadow Roots, Adresse, Status, `video.ts` laufende Video-Nachpruefung, `spiegel.ts` Leinwand folgt dem Urteil ihres Videos, `vorrang.ts` fuenf Stufen in der Warteschlange), `pack/` (`vertrag.ts` Vertrag, `format.ts` Dateiformat `.miapack`, `db.ts`/`speicher.ts` IndexedDB, `patches.ts` Patch-Bilder fuer den Erkenner)
- Phase 4 (Entscheidungen 99 bis 105): `src/quiz/` (Vertrag und Logik des Quiz), `src/riegel/` (Quiz-Riegel), `src/adapter/` (Erwachsenenseiten, Liste und Seiten-Adapter), `src/steigerung.ts` (Steigerung der Zensur), `src/chibi.ts` (Chibi-Posen), `src/hintergrund/` (Handler-Module je Auftrag), `src/oberflaeche/` (Popup- und Optionsteile), `src/ersatz/` (Komplett-Ersatz: Galerie in der Seite per Content-Script, Entscheidung 107), `src/player/` (Player-Riegel), `src/titel/` (Titel mit Mias Kommentar), `src/pause-lokal.ts` (sofortige Pause aus Riegel und Galerie), Freilegen in `src/schleier/freilegen.ts`; Demo-Chibis kommen beim Bau aus `../02 Assets Mia/chibi/`, nie ins Repo. Spezifikation `../00 Planung/PHASE-4-BAUPLAN.md`, Auftraege `../00 Planung/PHASE-4-AUFTRAEGE-SESSION-7.md` und `-SESSION-8.md`
- Phase 5 (Kontrolle, Entscheidungen 116 bis 124): `src/kontrolle/` (`grenzen.ts` Blitz-Grenzen als Code-Deckel, `gemeinsam.ts` Bedingungen fuer alle Kontroll-Teile), `src/werbung/` (Werbe-Tausch mit `data/werbung.json`, Werbebilder Rolle `werbung` mit Format), `src/blitz/` (Blitzwoerter, Zeitplan ueber alle Tabs), `src/spirale/` (Leerlauf-Spirale) mit `src/hintergrund/leerlauf.ts` (`browser.idle`, im Testbau nur ueber den Testhaken), Einstellungsseite Abschnitt "Mia’s control" (`entrypoints/options/kontrolle.ts`). Spezifikation `../00 Planung/PHASE-5-AUFTRAEGE-SESSION-9.md`
- Spezifikation Phase 2: `../00 Planung/PHASE-2-BAUPLAN.md` (Nachrichten-Vertrag, Einstellungen, Auftraege, Nachtraege nach Pruefung, Abschnitt 9 Pack und Netzgrenze, Abschnitt 10 Videos und YuNet); Spezifikation Phase 3: `../00 Planung/PHASE-3-BAUPLAN.md` (Live-Umfrage, Auftraege D+V, S, R)
- `public/`: Icons, `modelle/320n.onnx` und `modelle/yunet-2023mar.onnx` (im Repo, siehe `data/MODELL-LIES-MICH.md`), `ort/` (WASM-Laufzeit, nicht im Repo); keine Mia-Bilder
- `tests/einheit/`: Node-Tests; `tests/chromium/`: Playwright; `tests/firefox/`: geckodriver/WebDriver; `tests/fixtures/`: lokale Testseiten (Bilder vom Testserver aus `../05 Testbilder/` oder synthetisch)
- `scripts/`: Hooks, Leck-Sperre, Pack-Bau, Release
- `data/`: Datendateien (`links.json` Links der Marke, `ausnahmen-standard.json` Standard-Ausnahmeliste, `erwachsenenseiten.json` Liste der Erwachsenenseiten). Quiz-Bank und Mias Saetze liegen NICHT hier, sondern nur im Pack (Rollen `quiz`, `texte`, Entscheidung 100); im Repo nur synthetische Testdaten (`scripts/pack/dummy-inhalte.mjs`)
- `docs/`: Anleitungen (Englisch, Mias Stimme)

## Technik (aus ENTSCHEIDUNGEN.md, dort gilt die Langfassung)
- Manifest V3, WXT als Geruest (ein Code, zwei Manifeste, Firefox-Build inklusive). Fester `key` im Chrome-Manifest (privater Schluessel in `../.lokal/`, nie im Repo). `browser_specific_settings.gecko.id` fuer Firefox.
- Erkennung im Browser mit onnxruntime-web, kein Netzverkehr ausser Bild-Nachladen der aktuellen Seite und Versions-Check.
- Pack-Speicher: IndexedDB mit `unlimitedStorage`.
- Hide-first: erst verstecken, dann pruefen, dann freigeben.
