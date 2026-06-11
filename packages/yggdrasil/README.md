# @theaiinc/yggdrasil

Distributed runner orchestration controller — receives runner registrations and heartbeats, dispatches tasks, and manages a dynamic pool of Ratatoskr agents.

Yggdrasil is the control plane for a fleet of runners. Each runner runs a [Ratatoskr](https://www.npmjs.com/package/@theaiinc/yggdrasil-ratatoskr) daemon that registers, heartbeats, and executes tasks. Yggdrasil tracks which runners are alive, assigns tasks to them, and handles lease expiry, updates, and health monitoring.

> **Version note**: `@theaiinc/yggdrasil` and `@theaiinc/yggdrasil-ratatoskr` are always released at the same version number.

## Installation

```bash
npm install @theaiinc/yggdrasil
```

## Quick Start

```typescript
import { Logger } from '@theaiinc/yggdrasil';

const logger = new Logger({ level: 'info', format: 'simple', transports: ['console'] });
logger.info('Yggdrasil ready');
```

### Running the controller

```bash
npx @theaiinc/yggdrasil
```

By default Yggdrasil listens on port 3000. Configure via environment variables:

```bash
PORT=3100 \
API_KEYS=my-secret-key \
LEASE_TTL_MS=60000 \
npx @theaiinc/yggdrasil
```

## Architecture

```
┌──────────────┐     HTTP (heartbeat, register, tasks)    ┌──────────────┐
│  Ratatoskr   │◄─────────────────────────────────────────►│   Yggdrasil  │
│  (runner)    │    POST /runners/register                 │  (controller)│
│              │    POST /runners/heartbeat                │              │
│              │    POST /runners/task/:id/patch           │              │
└──────────────┘                                          └──────────────┘
       │                                                         │
       │  Runs agent tasks                                       │  API surface
       │  (sub-agent LLM loop,                                   │  consumed by
       │   shell, file, web tools)                               │  orchestration layer
       ▼                                                         ▼
   Docker / host                                            api-gateway
```

## API Endpoints

The controller serves these endpoints (consumed by Ratatoskr and pool orchestrators):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Health check |
| `GET` | `/runners` | List all runners |
| `POST` | `/runners/register` | Register a new runner |
| `POST` | `/runners/heartbeat` | Runner heartbeat |
| `POST` | `/runners/update` | Update runner endpoint |
| `POST` | `/runners/offline` | Deregister a runner (graceful shutdown) |
| `GET` | `/runners/:id` | Get runner details |
| `GET` | `/runners/:id/tasks` | List runner tasks |
| `POST` | `/runners/:id/tasks` | Dispatch a task to a runner |
| `PATCH` | `/runners/:id/tasks/:tid` | Update task status |
| `POST` | `/version-check/:version` | Check version compliance |
| `POST` | `/runners/:id/request-update` | Request runner update |
| `GET` | `/admission` | Get admission state (circuit breaker) |
| `GET` | `/metrics` | Prometheus metrics |

## Configuration

### Controller environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `API_KEYS` | `''` | Comma-separated API keys for runner auth |
| `LEASE_TTL_MS` | `60000` | Milliseconds before an unresponsive runner is marked offline |
| `HEARTBEAT_INTERVAL_MS` | `15000` | Expected heartbeat interval (for lease calculation) |
| `NODE_ENV` | `development` | Environment name |
| `LOG_LEVEL` | `info` | Log level (error, warn, info, debug) |
| `LOG_FORMAT` | `simple` | Log format (json, simple) |
| `EXPECTED_RUNNER_VERSION` | `''` | Expected runner version string (for version compliance checks) |
| `METRICS_PREFIX` | `yggdrasil_` | Prefix for Prometheus metric names |

### Exported types

All wire protocol types are exported for consumers:

- `RunnerInfo`, `RunnerTask`, `SystemResources`, `PendingUpdate`
- `RegisterRunnerPayload`, `HeartbeatPayload`, `HeartbeatResponse`, `RequestUpdatePayload`
- `LogLevel`, `LoggerConfig`

### Exported utilities

- `Logger` — Structured logger (JSON or simple format, console transport)

## Prometheus Metrics

Yggdrasil exposes Prometheus metrics at `GET /metrics`:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `yggdrasil_runners_registered` | Gauge | — | Number of registered runners |
| `yggdrasil_runners_offline` | Gauge | — | Number of offline runners |
| `yggdrasil_runner_info` | Gauge | `runner_id`, `name`, `version`, `status` | Runner metadata |
| `yggdrasil_runner_uptime_seconds` | Gauge | `runner_id` | Runner uptime |
| `yggdrasil_runner_cpu_percent` | Gauge | `runner_id` | CPU usage |
| `yggdrasil_runner_memory_percent` | Gauge | `runner_id` | Memory usage |
| `yggdrasil_runner_leases` | Gauge | `runner_id` | Lease expiry timestamp |
| `yggdrasil_runner_tasks_running` | Gauge | `runner_id` | Running task count |
| `yggdrasil_tasks_dispatched_total` | Counter | — | Total dispatched tasks |
| `yggdrasil_tasks_completed_total` | Counter | `status` | Total completed tasks |

## Lease Management

Each runner registration includes a lease TTL. Yggdrasil expects heartbeats before the lease expires. On timeout:

1. The runner is marked `offline`
2. Its tasks transition to `failed`
3. A configured `RUNNER_OFFLINE_HOOK` can be triggered (if set)
4. The runner must re-register to come back online

## Self-Update Protocol

Yggdrasil supports requesting runner version updates:

1. Admin calls `POST /runners/:id/request-update` with a version/command
2. Yggdrasil stores the pending update on the runner's record
3. On the next heartbeat, Ratatoskr sees `pendingUpdate` and triggers the update
4. The update runs after all current tasks complete, then the runner restarts

## License

MIT — © 2026 The AI Inc
