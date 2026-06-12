# Release Process

## Version Scheme

Yggdrasil follows [Semantic Versioning](https://semver.org/). The **root `package.json`** is the single source of truth — all workspace packages sync from it via `npm run sync-versions`.

| Bump | When | Example |
|---|---|---|
| `patch` | Bug fixes, minor enhancements, documentation | `0.3.0` → `0.3.1` |
| `minor` | New features, backwards-compatible | `0.3.0` → `0.4.0` |
| `major` | Breaking changes | `1.0.0` |

## Prerequisites

- Clean working tree (no uncommitted changes)
- All tests pass (`npm test`)
- You're on `main` branch and up to date

## Step-by-step

```bash
# 1. Ensure clean state
git checkout main
git pull --tags origin main

# 2. Check all versions are in sync
npm run check-versions

# 3. Review changes since last tag
git log v$(node -p "require('./package.json').version")..HEAD --oneline --no-merges

# 4. Bump the version (patch/minor/major)
npm version patch

# 5. Sync versions to all workspace packages
npm run sync-versions

# 6. Build all packages so lockfile is consistent
npm run build

# 7. Commit the version sync changes
git add packages/*/package.json package-lock.json
git commit -m "chore: sync package versions to $(node -p "require('./package.json').version")"

# 8. Create the release tag
VERSION=v$(node -p "require('./package.json').version")
git tag -a "$VERSION" -m "release $VERSION"

# 9. Push everything
git push origin main --tags
```

## Version tags

- `v0.3.0` — Yggdrasil + Ratatoskr unified release (single monorepo version)
- `runtime-v0.1.1` — Legacy runtime-only tags (kept for history)

Going forward, use only the main `v*` tag since all packages share the root version.

## Release notes template

When creating a GitHub Release from the tag, use this format:

```markdown
## What's changed

<!-- Summarize key changes grouped by category -->

### Bug fixes
- ...

### Features
- ...

### Maintenance
- ...

**Full changelog**: https://github.com/theaiinc/yggdrasil/compare/PREVIOUS_TAG...NEW_TAG
```
