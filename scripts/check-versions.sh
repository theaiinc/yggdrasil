#!/usr/bin/env bash
# check-versions.sh — Verify all workspace packages share the same version.
# Fails with a non-zero exit code on mismatch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_VERSION="$(node -p "require('$ROOT/package.json').version")"
FAIL=0

echo "Checking version consistency (all packages must match root: $ROOT_VERSION)..."
echo ""

for PKG in "$ROOT"/packages/*/package.json; do
  NAME="$(node -p "require('$PKG').name")"
  PKG_VERSION="$(node -p "require('$PKG').version")"
  if [ "$PKG_VERSION" != "$ROOT_VERSION" ]; then
    echo "  ✗ $NAME: $PKG_VERSION (expected $ROOT_VERSION)"
    FAIL=1
  else
    echo "  ✓ $NAME: $PKG_VERSION"
  fi
done

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "FAILED — versions are out of sync. Run 'npm run sync-versions' to fix."
  exit 1
else
  echo "All versions match root ($ROOT_VERSION)."
fi
