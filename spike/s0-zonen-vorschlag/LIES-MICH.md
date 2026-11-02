# Spike S0: Zonen-Vorschlag mit NudeNet 640m (Wegwerf-Code)
Start: `npm run spike:s0` (Node, onnxruntime-node und sharp, nur lokal, kein Netz).
Liest alle Bilder aus `../05 Testbilder/nsfw` und `sfw` und das Modell aus `../04 Alt-Code Referenz/modelle/640m.onnx`.
Verarbeitung wie im NudeNet-Paket: EXIF drehen, unten/rechts quadratisch auffuellen, bilinear auf 640, RGB/255, NMS 0.45, Schwelle 0.20 (`VEIL_SCHWELLE` aendert sie).
Klassen auf Zonen wie `NUDENET_MAP`: exposed ist sichtbar, covered ist bedeckt, sichtbar gewinnt. Achseln (armpits) kommen aus ARMPITS_EXPOSED (sichtbar) und ARMPITS_COVERED (bedeckt). Die Zone "hands" ist entfallen (Entscheidung 48).
Gesicht (FACE_FEMALE oder FACE_MALE) schlaegt face, head, eyes, mouth als sichtbar vor und steht in der Notiz als "abgeleitet".
Kein Treffer gibt `kein_mensch: false` mit der Notiz "keine Treffer, bitte pruefen", denn das Modell kennt keine Personenklasse. Das Markierwerkzeug zeigt den Vorschlag als Vorbelegung (gelber Rand, "noch nicht geprueft"); erst Speichern macht daraus einen Eintrag.
Ausgabe: `../05 Testbilder/soll-zonen-vorschlag.json` (nie `soll-zonen.json`, `geprueft` bleibt leer) und `ergebnis-node-<zeitstempel>.json` hier (per .gitignore draussen).
Der Vorschlag ist nur ein Vorschlag: der Inhaber bestaetigt oder korrigiert ihn im Markierwerkzeug.
