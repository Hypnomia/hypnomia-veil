# Modell im Paket

`320n.onnx`: NudeNet 320n (YOLOv8-Form, Eingabe 1x3x320x320 float32 RGB 0 bis 1, Ausgabe 1x22xN, 18 Klassen), 12,2 MB.
Quelle und Pruefsumme: `03 Recherche/SPIKE-VORBEREITUNG.md` im Projektordner (SHA-256 beginnt mit `c15d8273`).
Gewaehlt in Entscheidung 54 (Session 2, Spike). Die WebAssembly-Laufzeit (`public/ort/`) kommt vor jedem Build aus `node_modules` (`scripts/kopiere-laufzeit.mjs`) und liegt nicht im Repo.

`yunet-2023mar.onnx`: YuNet (OpenCV-Modellsammlung `opencv_zoo`, Datei `face_detection_yunet_2023mar.onnx`), Gesichtsmodell mit fuenf Punkten (Augen, Nase, Mundwinkel), feste Eingabe 1x3x640x640 float32 BGR 0 bis 255, zwoelf Ausgaben (`cls_`, `obj_`, `bbox_`, `kps_` je Schrittweite 8, 16, 32), 0,23 MB.
Lizenz: MIT (Modellsammlung von OpenCV). SHA-256 beginnt mit `8f2383e4`.
Es laeuft nur, wenn eine Gesichtszone (Augen, Mund, Gesicht, Kopf) an ist, zusaetzlich zu 320n (`src/erkenner/yunet.ts`). Entscheidung 85, Messung in `MESSUNG-PHASE-2.md` Abschnitt 8.
