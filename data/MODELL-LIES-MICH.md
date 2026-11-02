# Modell im Paket

`320n.onnx`: NudeNet 320n (YOLOv8-Form, Eingabe 1x3x320x320 float32 RGB 0 bis 1, Ausgabe 1x22xN, 18 Klassen), 12,2 MB.
Quelle und Pruefsumme: `03 Recherche/SPIKE-VORBEREITUNG.md` im Projektordner (SHA-256 beginnt mit `c15d8273`).
Gewaehlt in Entscheidung 54 (Session 2, Spike). Die WebAssembly-Laufzeit (`public/ort/`) kommt vor jedem Build aus `node_modules` (`scripts/kopiere-laufzeit.mjs`) und liegt nicht im Repo.
