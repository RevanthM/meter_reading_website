#!/bin/bash
# Sync shared session index code into the Lambda package before SAM build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/lambda/session-sync/sessionIndex"
cp -R "$ROOT/server/sessionIndex" "$ROOT/lambda/session-sync/sessionIndex"
echo "Synced server/sessionIndex → lambda/session-sync/sessionIndex"
