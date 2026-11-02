#!/usr/bin/env bash
# Claude-Code-Hook (PreToolUse auf Bash): wenn der Befehl "git commit" enthaelt,
# vorher Leck-Sperre und Tests. Exit 2 blockt das Werkzeug und zeigt die Meldung.
set -u
EINGABE="$(cat)"
BEFEHL="$(printf '%s' "$EINGABE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.command??"")}catch(e){}})')"
printf '%s' "$BEFEHL" | grep -q -E '\bgit\b.*\bcommit\b' || exit 0
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 0
"$ROOT/scripts/leak-check.sh" >&2 || exit 2
if [ -d node_modules ] && [ "${VEIL_SKIP_TESTS:-0}" != "1" ]; then
  npm test --silent >&2 || { echo "TESTS ROT: Commit geblockt." >&2; exit 2; }
fi
exit 0
