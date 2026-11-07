# Schriften (Phase 8b, Entscheidung 161)

Offene Schriften unter der SIL Open Font License 1.1, nur der Zeichensatz `latin` als woff2, aus den npm-Paketen von Fontsource 5.3.0
(`@fontsource/m-plus-rounded-1c`, `@fontsource/nunito`), Dateien `files/*-latin-<schnitt>-normal.woff2`, unveraendert und umbenannt.

| Datei | Schrift | Schnitt | Familie in der Oberflaeche |
|---|---|---|---|
| rounded-700.woff2, rounded-800.woff2 | M PLUS Rounded 1c | 700, 800 | `VEIL Rounded` (Ueberschriften, Marke, Pause) |
| text-400.woff2 bis text-800.woff2 | Nunito | 400, 600, 700, 800 | `VEIL Text` (Fliesstext, Knoepfe) |

Lizenztexte: `OFL-m-plus-rounded-1c.txt`, `OFL-nunito.txt`. Erweiterungsseiten laden die Dateien per `@font-face` (`src/oberflaeche/design/tokens.css`),
Seiten-Oberflaechen in fremden Seiten per `FontFace` aus einem ArrayBuffer (`src/oberflaeche/design/schrift.ts`), ohne `web_accessible_resources`.
