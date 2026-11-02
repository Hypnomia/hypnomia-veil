#!/usr/bin/env bash
# Claude-Code-Hook (PostToolUse auf Edit/Write): Lint fuer Dateien unter src/ oder entrypoints/.
set -u
EINGABE="$(cat)"
DATEI="$(printf '%s' "$EINGABE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch(e){}})')"
case "$DATEI" in *"/src/"*|*"/entrypoints/"*) ;; *) exit 0 ;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" && [ -d node_modules ] && npm run lint --if-present --silent 2>&1 | tail -20
exit 0
