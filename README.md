# @theaiinc/yggdrasil — Distributed Runner Orchestration

Yggdrasil is the orchestration controller that receives runner registrations and heartbeats from [Ratatoskr](https://github.com/theaiinc/yggdrasil-ratatoskr) daemons.

## Architecture

```
┌────────────────────────────────────────────┐
│              Load Balancer                 │
│              (Nginx / optional)             │
└────────────────┬───────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────┐
│         Orchestration Controller           │
│         (Node.js / Express)                │
│                                            │
│  • POST /runners/register                  │
│  • POST /runners/heartbeat                 │
│  • POST /runners/update                    │
│  • POST /runners/offline                   │
│  • GET  /api/runners                       │
│  • GET  /health                            │
│  • GET  /metrics                           │
└────┬───────────────────────┬───────────────┘
     │                       │
     ▼                       ▼
┌──────────┐        ┌──────────────────┐
│ Ratatoskr│        │    Monitoring    │
│ Daemon   │        │  (Prometheus +   │
│          │        │    Grafana)      │
└──────────┘        └──────────────────┘
```

Ratatoskr runs alongside each runner and automatically:
- Registers the runner with Yggdrasil on startup
- Sends periodic heartbeats
- Updates endpoint on IP changes
- Deregisters on graceful shutdown

Yggdrasil tracks runner state via lease-based offline detection — if a heartbeat doesn't arrive within `LEASE_TTL_MS`, the runner is automatically marked `offline`.

## Quick Start

```bash
# Build and start
docker compose up --build

# Yggdrasil API is at http://localhost:3000
curl http://localhost:3000/health
```

## API Key Authentication

Set `API_KEYS` environment variable (comma-separated). All endpoints except `/health` and `/metrics` require the `X-API-Key` header.

```bash
API_KEYS=my-secret-key docker compose up
curl -H "X-API-Key: my-secret-key" http://localhost:3000/api/runners
```

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@theaiinc/yggdrasil` | [npm](https://www.npmjs.com/package/@theaiinc/yggdrasil) | Orchestration controller |
| `@theaiinc/yggdrasil-ratatoskr` | [npm](https://www.npmjs.com/package/@theaiinc/yggdrasil-ratatoskr) | Runner discovery daemon |

## Development

```bash
# Install dependencies
npm install

# Build packages
npm run build

# Run E2E lifecycle test
node scripts/e2e-lifecycle.mjs
```

## License

MIT
