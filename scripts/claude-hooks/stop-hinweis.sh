#!/usr/bin/env bash
# Claude-Code-Hook (Stop): erinnert an die Uebergabe, wenn heute keine UEBERGABE-N.md angefasst wurde.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UEB="$ROOT/../01 Uebergabe"
if [ -d "$UEB" ] && [ -z "$(find "$UEB" -name 'UEBERGABE-*.md' -mtime -1 2>/dev/null)" ]; then
  echo "Hinweis: heute wurde keine UEBERGABE-N.md geschrieben oder aktualisiert."
fi
exit 0
