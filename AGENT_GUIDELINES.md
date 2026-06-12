# Agent Guidelines — Yggdrasil

## Completed Milestone: Runner Update Observability (2026-06-12)

We can now observe remote Ratatoskr update progress from Yggdrasil without direct access to the runner's logs.

### How it works

Ratatoskr's `UpdateManager` tracks a state machine: `idle → pending → applying → applied/failed`. Each heartbeat includes the current `updateStatus` and a log tail (`updateLog`). Yggdrasil stores these on `RunnerInfo` and surfaces them through admin API, metrics, and the Grafana panel.

```
Yggdrasil                            Ratatoskr
   │                                      │
   ├── POST /request-update ────────────► │
   │    pendingUpdate stored              │
   │                                      │
   │◄──── heartbeat ──────────────────────│
   │    updateStatus: "pending"           │
   │    updateLog: "Waiting for tasks..." │
   │                                      │
   │◄──── heartbeat ──────────────────────│
   │    updateStatus: "applying"          │
   │    updateLog: "Running npm update.." │
   │                                      │
   │◄──── heartbeat ──────────────────────│
   │    updateStatus: "applied"           │
   │    updateLog: "Exiting for restart"  │
   │                                      │
   │         ... runner re-registers ...  │
   │◄──── registration ───────────────────│
   │    version: "0.3.0" ✓               │
```

### What was added

- **`UpdateStatus` type** (`idle | pending | applying | failed | applied`) in both packages' types
- **`UpdateManager.getStatus()` and `getLogTail()`** — exposes current progress and last ~2KB of update logs
- **Heartbeat carries `updateStatus` + `updateLog`** — Yggdrasil stores them on RunnerInfo
- **`GET /api/admin/runners/:runnerId/update-log`** — fetch a specific runner's update log
- **`yggdrasil_runner_update_status` metric** — Prometheus gauge with runner+status labels
- **`yggdrasil_runner_update_log` metric** — raw log tail in label (for Grafana text panels)
- **Grafana AdminPanel** — "Update" column in runners table with clickable status badges and expandable log viewer

### curl examples (from inside Docker or via docker exec)

```bash
# Check all runners with update status
docker exec yggdrasil-orchestration-controller-1 curl -s \
  http://localhost:3000/api/admin/runners \
  -H "X-Admin-Api-Key: admin-key-123"

# Check a specific runner's update log
docker exec yggdrasil-orchestration-controller-1 curl -s \
  http://localhost:3000/api/admin/runners/runner-GDn2cbWZ/update-log \
  -H "X-Admin-Api-Key: admin-key-123"

# Set expected version
docker exec yggdrasil-orchestration-controller-1 curl -s -X POST \
  http://localhost:3000/api/admin/expected-version \
  -H "Content-Type: application/json" \
  -H "X-Admin-Api-Key: admin-key-123" \
  -d '{"version":"0.3.0"}'

# Request update for all runners
docker exec yggdrasil-orchestration-controller-1 curl -s -X POST \
  http://localhost:3000/api/admin/runners/request-update \
  -H "Content-Type: application/json" \
  -H "X-Admin-Api-Key: admin-key-123" \
  -d '{"runnerIds":["ALL"],"version":"0.3.0","command":"npm update -g @theaiinc/yggdrasil-ratatoskr"}'
```

## Completed Milestone: Multi-Key & API Key Rotation (2026-06-12)

Yggdrasil now supports multiple API keys and dynamic rotation via an admin API + Grafana panel.

```
┌──────────────────────────────────────────────────────────────────┐
│  Grafana Dashboard ──→ curl POST /api/admin/api-keys/rotate     │
│                         { newApiKey, runnerIds?: string[] }      │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌─────────────────┐
                    │   Yggdrasil     │
                    │                 │
                    │  API_KEYS[] ←───┼── new key added immediately
                    │                 │
                    │  runner.pending │
                    │  Update.apiKey  │
                    └────────┬────────┘
                             │ (heartbeat response)
                             ▼
                    ┌─────────────────┐
                    │   Ratatoskr     │
                    │  ┌────────────┐ │
                    │  │Heartbeat   │─┼── calls transport.setApiKey()
                    │  │Sender      │ │   on next tick
                    │  └────────────┘ │
                    └─────────────────┘
```

- **Multi-key support:** `API_KEYS` env var (comma-separated), checked via `includes()` — no breaking change.
- **Admin API:** `POST /api/admin/api-keys/rotate` secured by `ADMIN_API_KEY` env var + `X-Admin-Api-Key` header.
- **Selective push:** `runnerIds` field in rotate payload. **Default empty = no Ratatoskrs notified** (manual config).
- **Transport contract:** `Transport.setApiKey()` added to interface + `HttpTransport` updates axios defaults.
- **Metrics:** `yggdrasil_api_keys_total`, `yggdrasil_runner_pending_api_key_rotation` exposed via `/metrics`.
- **Grafana panels updated:** Admin Commands panel with curl examples for all admin operations, Outdated Runners table, improved Expected Version stat showing label value.

### Added: Version Management & Batch Updates (same deploy)

- **Dynamic expected version:** `POST /api/admin/expected-version` sets `EXPECTED_RUNNER_VERSION` at runtime. Grafana alert triggers when runners are outdated.
- **Batch update:** `POST /api/admin/runners/request-update` accepts `runnerIds: ["ALL"]` or a list of IDs. Delivered on next heartbeat.
- **Runner listing:** `GET /api/admin/runners` returns all runners with `outdated` and `hasPendingUpdate` flags for dashboard use.
- **How to update all Ratatoskr via Grafana:** Set the expected version first (`POST /api/admin/expected-version {"version": "0.4.0"}`), then request the update (`POST /api/admin/runners/request-update {"runnerIds": ["ALL"], "version": "0.4.0", "command": "npm update -g @theaiinc/yggdrasil-ratatoskr"}`).

### Added: Yggdrasil NPM Version Awareness & Self-Update (same deploy)

Yggdrasil now knows its own version and checks npm for updates:

- **`NpmVersionChecker`** — polls `https://registry.npmjs.org/@theaiinc/yggdrasil/latest` every 30 min. Results cached in memory.
- **`yggdrasil_version_info{version="0.3.0"}`** — metric always present, shows running version.
- **`yggdrasil_npm_latest_version{current="0.3.0", latest="0.4.0"}`** — present only when npm responds.
- **`POST /api/admin/self-update`** — runs `npm update -g @theaiinc/yggdrasil` then SIGTERM. For Docker: set `DOCKER_UPDATE_COMMAND` env var (e.g. `docker compose pull && docker compose up -d`). Idempotent — no-op if already on latest.
- **`/health`** now reports the real `package.json` version (was hardcoded `0.1.0`).
- **Grafana panels:** **Yggdrasil Version** stat (green), **NPM Latest** stat (green=up-to-date, red=new version). Admin Commands updated with self-update instructions.

## Completed Milestone: Realm Registration & Lifecycle Loop (2026-06-12)

The operational control loop is now complete. Realm is no longer a passive object from Yggdrasil's perspective.

```
Yggdrasil ──→ Spawn command ──→ Ratatoskr ──→ Realm
                                                    │
                                                    ├── registration ──→ Ratatoskr ──→ Yggdrasil
                                                    ├── heartbeat    ──→ Ratatoskr ──→ Yggdrasil
                                                    └── deregister   ──→ Ratatoskr ──→ Yggdrasil
```

**Lifecycle states:** `creating` → `running` ↔ `unhealthy` → `destroyed`
- `RealmLifecycleService` handles registration, heartbeat, stale detection (60s TTL)
- Realm stale detection auto-recovers from `unhealthy` on next healthy heartbeat
- `unhealthy` state dropped from `RealmState` after recovery — Yggdrasil owns state transitions

**Key types added:**
- `RealmRegistration` — realm announces itself (ID, runner, template, version, capabilities, endpoints)
- `RealmHeartbeat` — periodic health (uptime, healthy, sessions)
- `RealmDeregistration` — intentional shutdown (reason: shutdown | error | replaced)

**Transport:** Realm → Ratatoskr `HttpTransport` relay → Yggdrasil routes. Ratatoskr never inspects or stores realm state.

**RegistrationClient** (`realm-core`): handles boot registration, periodic heartbeats (30s default), deregistration on SIGTERM/SIGINT. Wired into `realm-api/server.ts` via config or env vars.

**Current version:** `@theaiinc/yggdrasil` = 0.3.0, `@theaiinc/yggdrasil-ratatoskr` = 0.3.0, `@theaiinc/yggdrasil-runtime` = 0.1.1

---

### 2026-06-12 — Yggdrasil Decides, Ratatoskr Reports & Executes, Realm Runs

**Key Insight:** The `RealmScheduler` should NOT create realms. It should only return an allocation decision. Otherwise it becomes a god object with scheduling, spawning, registry, lifecycle, and ownership responsibilities.

**The Split:**
- `RealmScheduler` — **decides** which runner/template to use (allocation only)
- `RealmProvisioner` — **creates** realms (spawn or attach)
- `RealmRegistry` — **stores** realms and templates
- `SessionManager` — **attaches** sessions to realms

**The Flow:**
```
const allocation = await realmScheduler.schedule(request);
const realm = await realmProvisioner.ensureRealm(allocation);
const session = await sessionManager.create({ realmId: realm.id });
```

**Three Realm States (not 2):**
1. Template — what CAN be spawned (advertised by runner)
2. Instance — what IS running
3. Pool — what is IDLE and reusable

Scheduling priority: attach existing → reuse pooled → spawn new

**Naming Convention:**
- `Realm` (not `RealmInstance`) — cleaner everyday terminology
- `"Attach to realm-123"` vs `"Attach to realm-instance-123"`
- The template/instance distinction lives in the schema, not in everyday speech

**`ownerId` as Scheduling Primitive:**
- Not just session metadata — it's **affinity**
- `ownerId = steve` → scheduler checks if Steve has an existing realm → attach if yes, provision if no
- This is the foundation for persistent digital environments

---

### 2026-06-12 — Yggdrasil Decides, Ratatoskr Reports & Executes, Realm Runs

**Critical architectural boundary (learned by rolling back a decentralized allocator):**

Ratatoskr was briefly given `RealmAllocator` with `attach | reuse | spawn | reject` logic.
This was rolled back because it creates a **second orchestrator**.

**The dangerous path:**
```
Yggdrasil (global scheduler)
Ratatoskr (local allocator)   ← second scheduler forming
```
At first elegant. In practice: duplicated placement, reuse, pooling, affinity, resource selection.
Then you spend years figuring out which scheduler owns what.

**The correct boundary:**
```
Yggdrasil    — owns intent and policy
Ratatoskr    — owns facts and execution
Realm        — owns runtime behavior
Veil         — owns trust and permissions
```

Even shorter:
```
Yggdrasil decides.
Ratatoskr reports and executes.
Realm runs.
Veil protects.
```

**What Yggdrasil owns:**
- Global state
- Realm registry
- Session registry
- Scheduling policy
- Owner affinity
- Pooling policy

Questions it answers:
- Should we attach?
- Should we reuse?
- Should we spawn?
- Which runner?
- Which realm?

**What Ratatoskr owns:**
- Node discovery
- Resource collection
- Task execution
- Host capabilities
- Realm templates

Questions it answers:
- Can I do it? (not "What should we do?")

**What Realm owns:**
- Execution
- Observation
- Input
- Desktop/browser state

**The one thing worth preserving from the experiment — the VETO:**
Not `Ratatoskr.allocate()` (orchestration).
But `Ratatoskr.executeTask()` can fail (execution failure).

Example:
```
Yggdrasil → Spawn Ubuntu Realm
Ratatoskr: Not enough memory
returns: { success: false, reason: "insufficient_resources" }
```

That's not orchestration. That's execution failure. Very different thing.

**Rule for future contributors:**
Ratatoskr may say "I cannot do that."
Ratatoskr should NOT say "I think we should do this instead."
The moment Ratatoskr starts choosing between attach, reuse, spawn, pool selection,
affinity, and priorities, you've accidentally built a second Yggdrasil.

---

### 2026-06-11 — Realm Lifecycle Architecture (Scheduler / Provisioner / Registry Split)

### 2026-06-11 — Control Plane / Data Plane Split

**Yggdrasil** = Control Plane (session lifecycle, scheduling, authorization)
**Realm** = Data Plane (observation, input, execution)

Sessions do NOT run on runners. Sessions run on realms. Realms run on runners.

---

## TypeScript Strictness Notes

- `exactOptionalPropertyTypes: true` requires `| undefined` on optional properties
- `noUncheckedIndexedAccess: true` requires explicit checks on array access (e.g., `arr[0]!` or `if (arr[0])`)
- Never use `axios.create().defaults.baseURL` in tests — mock the instance properly

---

## Monorepo Structure

- `@theaiinc/yggdrasil` — orchestration server (control plane)
- `@theaiinc/yggdrasil-ratatoskr` — runner daemon (node agent)
- `@theaiinc/yggdrasil-runtime` — ComputerUseRuntime implementation (consumed by Cognition)
- Realm lives in a separate repo (`/Users/stevetran/theaiincrealm/`)

---

## Grafana Custom Plugin: Yggdrasil Admin Panel

A native Grafana panel plugin (`theaiinc-yggdrasiladmin-panel`) that renders the Yggdrasil admin UI as a pure React component inside a Grafana dashboard — **no iframe, no server-side HTML, no `postMessage`**.

### Architecture (simplified)

The plugin talks to Yggdrasil's JSON APIs directly — just like any Grafana panel talks to a data source. No special server-side route needed.

```
┌──────────────────────────────────────────────────────────┐
│  Grafana Dashboard                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Yggdrasil Admin Panel (React component)           │  │
│  │                                                     │  │
│  │  fetch(/health)  ───────────────────────────────┐   │  │
│  │  fetch(/api/admin/runners)  ─────────────────┐  │   │  │
│  │  POST(/api/admin/self-update)  ──────────┐   │  │   │  │
│  │  ...                                      ▼   ▼  ▼   │  │
│  │                                           Yggdrasil   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

No iframe, no `/api/admin/panel` endpoint, no server-rendered HTML, no `postMessage` handshake. Everything runs natively in Grafana's React context.

### Location

- Source: `packages/yggdrasil-grafana-plugins/src/`
- Build output: `packages/yggdrasil-grafana-plugins/dist/`
- Mounted into Grafana at `/var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel` (mapped to `dist/`)

### Plugin Structure

```
yggdrasil-grafana-plugins/
├── .config/                  # Official Grafana build pipeline (webpack)
├── src/
│   ├── module.ts            # Entry point — exports PanelPlugin with options
│   ├── plugin.json          # Metadata (type: "panel", id: "theaiinc-yggdrasiladmin-panel")
│   ├── types.ts             # PluginOptions + API response types
│   └── components/
│       └── AdminPanel.tsx    # Self-contained React admin UI
├── dist/                    # Build output (mounted into Grafana)
│   ├── module.js
│   ├── plugin.json
│   └── module.js.map
├── package.json
├── tsconfig.json
├── webpack.config.ts
└── CHANGELOG.md
```

### How it works

1. User configures `yggdrasilUrl` and `adminApiKey` in the Grafana panel editor
2. The React component fetches data from Yggdrasil's REST APIs directly:
   - `GET /health` — version, uptime, runner count
   - `GET /metrics` — npm latest version info
   - `GET /api/admin/runners` — runner list, expected version, pending updates
   - `POST /api/admin/self-update` — trigger Yggdrasil self-update
   - `POST /api/admin/expected-version` — set expected runner version
   - `POST /api/admin/runners/request-update` — push update to runners
   - `POST /api/admin/api-keys/rotate` — rotate/add API keys
3. All requests include `X-Admin-Api-Key` header from panel config
4. Auto-refreshes every 15 seconds
5. Two tabs: **Status** (overview + runner table) and **Control** (set version, update, rotate)

### Dashboard Configuration

```json
{
  "type": "theaiinc-yggdrasiladmin-panel",
  "options": {
    "yggdrasilUrl": "http://orchestration-controller:3000",
    "adminApiKey": "admin-key-123"
  }
}
```

### Why React in the plugin instead of server-side HTML?

Once we already had React (via the Grafana plugin SDK), serving HTML strings from the Yggdrasil API became unnecessary complexity:
- **No iframe** — the admin panel is a native Grafana component
- **No `postMessage`** — no credentials are ever in URLs or sent between frames
- **No server-side HTML** — the admin-panel.ts file was deleted entirely
- **Faster** — no nested frame to load, no postMessage handshake delay
- **Simpler** — the API is just a standard JSON backend with no UI responsibilities

### Docker Setup

- `docker-compose.yml` mounts the plugin dist dir: `./packages/yggdrasil-grafana-plugins/dist:/var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel`
- Env var `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=theaiinc-yggdrasiladmin-panel` allows unsigned plugin loading

### Building

The plugin uses the **official Grafana webpack build pipeline** (generated by `@grafana/create-plugin`), not esbuild. This is critical — Grafana's module loader requires AMD format with externalized dependencies, which only the official webpack config handles correctly.

```bash
cd packages/yggdrasil-grafana-plugins
npm install
npm run build
```

This produces `dist/module.js` in AMD format with external deps (`@grafana/data`, `react`, etc.) that Grafana supplies at runtime.

### Project layout (official structure)

```
yggdrasil-grafana-plugins/
├── .config/                   # Auto-generated by Grafana create-plugin
│   ├── webpack/
│   │   ├── webpack.config.ts  # Base webpack config (AMD output, externals)
│   │   ├── constants.ts
│   │   ├── utils.ts
│   │   └── BuildModeWebpackPlugin.ts
│   ├── bundler/
│   │   └── externals.ts       # All Grafana runtime deps marked external
│   ├── jest/
│   ├── tsconfig.json
│   └── .cprc.json
├── webpack.config.ts          # Root override: adds v13 jsx-runtime externals
├── tsconfig.json              # Root tsconfig (extends .config/tsconfig.json)
├── src/
│   ├── module.ts              # Entry point — exports PanelPlugin
│   ├── plugin.json            # Metadata (moved from root)
│   ├── types.ts
│   └── components/
│       └── AdminPanel.tsx
├── dist/                      # Build output (mounted into Grafana)
│   ├── module.js
│   ├── plugin.json
│   └── module.js.map
├── package.json
├── CHANGELOG.md
└── README.md
```

### Docker mount

```yaml
# docker-compose.yml mounts dist/ (not the whole plugin folder)
volumes:
  - ./packages/yggdrasil-grafana-plugins/dist:/var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel
```

### Common pitfalls

- **Do NOT use esbuild** — Grafana's unsigned-plugin sandbox expects AMD `define()` with external dependencies, not bundled IIFE
- **Do NOT put `plugin.json` at the root** — it goes in `src/` where the webpack CopyPlugin picks it up
- **Always run `npm run build` before docker compose up** — the `dist/` folder must exist for the volume mount
- **Grafana v13 needs `react/jsx-runtime` externalized** — configured in `webpack.config.ts` root override

### Version synchronization

Yggdrasil and Ratatoskr **must always share the same version** — the expected runner version defaults to Yggdrasil's own `package.json` version.

#### Single source of truth: root `package.json#version`

All package versions propagate from the root:

```json
# root package.json
"version": "0.3.0"
  → packages/yggdrasil/package.json  # version = 0.3.0
  → packages/ratatoskr/package.json   # version = 0.3.0
  → packages/yggdrasil-runtime/package.json
```

#### Workflow

- **`npm run sync-versions`** — Copies root version to all workspace packages
- **`npm run check-versions`** — CI check that all packages match root (fails non-zero on mismatch)
- **`npm run prebuild`** — Auto-runs `sync-versions` before any build (triggered by `npm run build` in root)

#### How to bump versions

```bash
# 1. Bump root (the single source of truth)
npm version patch   # 0.3.0 → 0.3.1 (root only)

# 2. Sync to all packages
npm run sync-versions

# 3. Build
npm run build
```

The `EXPECTED_RUNNER_VERSION` env var in Yggdrasil defaults to `YGGDRASIL_VERSION` (its own `package.json` version), so expected-runner-version stays in sync automatically. Override with `EXPECTED_RUNNER_VERSION` env var if you need a different expected version for testing.

### CI automated npm publish

When a GitHub Release is created (tag pushed), `.github/workflows/publish.yml` runs automatically.
It publishes 4 packages to npm via OIDC (no tokens):

- `@theaiinc/yggdrasil`
- `@theaiinc/yggdrasil-ratatoskr`
- `@theaiinc/yggdrasil-runtime`
- `@theaiinc/yggdrasiladmin-panel` (Grafana plugin)

#### How OIDC works

The workflow uses **npm Trusted Publishers** (OIDC) instead of long-lived tokens:

1. Job has `permissions: id-token: write` to request a GitHub Actions OIDC token
2. Job has `environment: release` so the OIDC token contains an `environment: release` claim
3. The job-level `environment:` must match the **Environment** field configured on npmjs.com
4. **Do NOT use `registry-url` in `setup-node`** — it writes a temp `.npmrc` with `_authToken` that overrides OIDC
5. npm CLI 11.5+ auto-detects `ACTIONS_ID_TOKEN_REQUEST_URL` and exchanges the OIDC token

#### One-time setup per package

For each package being published, configure a trusted publisher on npmjs.com:

1. Go to `npmjs.com → Packages → <package> → Settings → Trusted publisher`
2. Select **GitHub Actions**
3. Fields:
   - **Repository owner**: `theaiinc`
   - **Repository name**: `yggdrasil`
   - **Workflow filename**: `publish.yml`
   - **Environment**: `release` (must match workflow's `environment:`)
   - **Permissions**: check `npm publish` (and/or `npm stage publish`)
4. Save — npm does NOT validate at save time, errors appear only on publish

#### Troubleshooting

- **`ENEEDAUTH`**: OIDC didn't kick in. Common causes:
  - `registry-url` in `setup-node` creating a conflicting `.npmrc`
  - Missing `environment:` in job (or mismatch with npmjs.com config)
  - Missing `id-token: write` permission
- **`404 package not found`**: OIDC exchange succeeded but the trusted publisher config didn't match
  - Check the Environment field on npmjs.com
  - Check the workflow filename matches exactly (including `.yml` extension)
  - Self-hosted runners are not supported
