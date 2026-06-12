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

# Also sync Grafana plugin.json (separate from package.json)
PLUGIN_JSON="$ROOT/packages/yggdrasil-grafana-plugins/src/plugin.json"
if [ -f "$PLUGIN_JSON" ]; then
  CURRENT="$(node -p "JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf-8')).info.version")"
  if [ "$CURRENT" != "$ROOT_VERSION" ]; then
    node -e "
      const p = JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf-8'));
      p.info.version = '$ROOT_VERSION';
      p.info.updated = new Date().toISOString().slice(0,10);
      require('fs').writeFileSync('$PLUGIN_JSON', JSON.stringify(p, null, 2) + '\n');
    "
    echo "  ✓ plugin.json -> $ROOT_VERSION"
  else
    echo "  ✓ plugin.json already at $ROOT_VERSION"
  fi
fi

echo "Done."
