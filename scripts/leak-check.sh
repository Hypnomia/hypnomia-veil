#!/usr/bin/env bash
# Leck-Sperre fuer HYPNOMIA VEIL.
# Prueft die zum Commit vorgemerkten Dateien (oder alle Dateien mit --all) gegen die
# Musterliste, die AUSSERHALB des Repos liegt: ../.lokal/leck-muster.txt neben veil.nosync.
# Fehlt die Liste, wird geblockt (lieber kein Commit als ein Leck).
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LISTE="$ROOT/../.lokal/leck-muster.txt"
if [ ! -r "$LISTE" ]; then
  echo "LECK-SPERRE: Musterliste nicht gefunden (../.lokal/leck-muster.txt). Commit geblockt." >&2
  exit 2
fi
MUSTER="$(mktemp)"; trap 'rm -f "$MUSTER"' EXIT
grep -v -E '^\s*(#|$)' "$LISTE" > "$MUSTER"
if [ ! -s "$MUSTER" ]; then echo "LECK-SPERRE: Musterliste ist leer. Commit geblockt." >&2; exit 2; fi
cd "$ROOT"
if [ "${1:-}" = "--all" ]; then
  DATEIEN="$(git ls-files -z | tr '\0' '\n'; git ls-files -z --others --exclude-standard | tr '\0' '\n')"
else
  DATEIEN="$(git diff --cached --name-only --diff-filter=ACMR)"
fi
FEHLER=0
# 1. Dateinamen und Inhalte gegen die Muster
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if printf '%s\n' "$f" | grep -i -q -E -f "$MUSTER"; then echo "LECK im Dateinamen: $f" >&2; FEHLER=1; fi
  [ -f "$f" ] || continue
  if grep -I -i -n -E -f "$MUSTER" -- "$f" >/dev/null 2>&1; then
    echo "LECK in Datei: $f" >&2
    grep -I -i -n -E -f "$MUSTER" -- "$f" | sed 's/^/   Zeile /' | cut -c1-120 >&2
    FEHLER=1
  fi
  # 2. Rasterbilder nur unter public/icons/ (Mia-Bilder nie ins Repo)
  case "$f" in
    public/icons/*.png) ;;
    *.jpg|*.jpeg|*.png|*.webp|*.gif|*.avif|*.heic|*.JPG|*.JPEG|*.PNG|*.WEBP) echo "BILD geblockt (nie ins Repo): $f" >&2; FEHLER=1 ;;
  esac
  # 3. Sourcemaps nie
  case "$f" in *.map) echo "SOURCEMAP geblockt: $f" >&2; FEHLER=1 ;; esac
done <<< "$DATEIEN"
# 4. Git-Autor muss Mia sein
AUTOR="$(git config user.name)"
if [ "$AUTOR" != "Mia" ]; then echo "AUTOR geblockt: user.name ist '$AUTOR', erwartet 'Mia'" >&2; FEHLER=1; fi
if git config user.email | grep -i -q -E -f "$MUSTER"; then echo "AUTOR-MAIL geblockt" >&2; FEHLER=1; fi
if [ "$FEHLER" -ne 0 ]; then echo "LECK-SPERRE: geblockt." >&2; exit 2; fi
echo "Leck-Sperre: sauber ($(printf '%s\n' "$DATEIEN" | grep -c . ) Dateien geprueft)."
