#!/usr/bin/env bash
# sync-versions.sh — Make root package.json the single source of truth for version.
# Syncs root version to all workspace packages.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_VERSION="$(node -p "require('$ROOT/package.json').version")"

if [ -z "$ROOT_VERSION" ]; then
  echo "ERROR: could not read version from root package.json"
  exit 1
fi

echo "Syncing version $ROOT_VERSION to workspace packages..."

for PKG in "$ROOT"/packages/*/package.json; do
  NAME="$(node -p "require('$PKG').name")"
  node -e "
    const p = require('$PKG');
    if (p.version !== '$ROOT_VERSION') {
      p.version = '$ROOT_VERSION';
      require('fs').writeFileSync('$PKG', JSON.stringify(p, null, 2) + '\n');
      console.log('  ✓ $NAME -> $ROOT_VERSION');
    } else {
      console.log('  ✓ $NAME already at $ROOT_VERSION');
    }
  "
done

echo "Done."
