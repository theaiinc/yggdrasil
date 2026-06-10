# @theaiinc/yggdrasil-ratatoskr

Lightweight discovery and heartbeat daemon for Yggdrasil runner registration.

Ratatoskr runs alongside an agent runner and continuously informs Yggdrasil about:

- Runner availability
- Network endpoints
- Capabilities
- Health status
- IP changes
- Shutdown events

## Installation

```bash
npm install @theaiinc/yggdrasil-ratatoskr
```

## Quick Start

```typescript
import { Ratatoskr } from '@theaiinc/yggdrasil-ratatoskr';

const ratatoskr = new Ratatoskr({
  yggdrasilUrl: 'http://localhost:4000',
});

await ratatoskr.start();
```

Within seconds, Yggdrasil automatically knows that the runner exists, where it lives, what it can do, and whether it is healthy.

## Advanced Usage

```typescript
import { Ratatoskr } from '@theaiinc/yggdrasil-ratatoskr';

const ratatoskr = new Ratatoskr({
  runnerId: 'runner-a',
  name: 'MacBook Pro',
  yggdrasilUrl: 'http://yggdrasil.prod:4000',
  capabilities: ['browser', 'computer-use', 'llm'],
  heartbeatInterval: 30,
  leaseTtl: 60,
  detectPublicIp: false,
  endpointProvider: async () => {
    return 'http://192.168.1.5:8080';
  },
  healthProvider: async () => {
    return {
      status: 'healthy',
    };
  },
});

await ratatoskr.start();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runnerId` | `string` | Auto-generated | Unique runner identifier |
| `name` | `string` | `'unknown'` | Human-readable runner name |
| `yggdrasilUrl` | `string` | (required) | Yggdrasil server URL |
| `capabilities` | `string[]` | `[]` | List of runner capabilities |
| `heartbeatInterval` | `number` | `30` | Heartbeat interval in seconds |
| `leaseTtl` | `number` | `60` | Lease TTL in seconds |
| `detectLocalIp` | `boolean` | `true` | Auto-detect local IP |
| `detectPublicIp` | `boolean` | `false` | Auto-detect public IP |
| `endpointProvider` | `() => Promise<string>` | `undefined` | Custom endpoint resolver |
| `healthProvider` | `() => Promise<HealthResult>` | `undefined` | Custom health check |
| `labels` | `Record<string, string>` | `{}` | Additional labels |
| `metadata` | `Record<string, unknown>` | `{}` | Additional metadata |

## Architecture

```
yggdrasil-ratatoskr
│
├── ratatoskr.ts          # Main entry point
├── types/                # TypeScript interfaces and enums
├── transports/           # Transport abstraction (HTTP, WebSocket, etc.)
│   └── http-transport.ts # HTTP transport implementation
└── services/
    ├── registrar.ts           # Runner registration lifecycle
    ├── heartbeat-sender.ts    # Periodic heartbeat sender
    ├── endpoint-detector.ts   # IP/hostname change detection
    ├── health-monitor.ts      # Health check orchestration
    ├── lease-manager.ts       # Lease expiry tracking
    └── retry-manager.ts       # Exponential backoff retry
```

## How It Works

1. **`ratatoskr.start()`** — Registers the runner with Yggdrasil, begins heartbeats, starts monitoring IP and lease expiry, and registers shutdown handlers.
2. **Heartbeats** — Sent every 30 seconds (configurable) to confirm the runner is alive.
3. **Lease** — Each registration has a 60-second TTL. If Yggdrasil misses 2 heartbeats (~60s), the runner is marked `offline`.
4. **IP Changes** — Detected every 10 seconds; if the local IP changes, Yggdrasil is notified via `POST /runners/update`.
5. **Graceful Shutdown** — On SIGTERM/SIGINT, Ratatoskr deregisters the runner with `POST /runners/offline`.

## Reliability

Ratatoskr is designed to survive:

- Temporary network outages
- Yggdrasil restarts
- IP changes
- Laptop sleep/wake cycles
- Docker container restarts

It uses exponential backoff for retries, persistent runner IDs, and automatic re-registration.

## API Endpoints (Yggdrasil)

Ratatoskr expects these endpoints on the Yggdrasil server:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/runners/register` | Register a new runner |
| `POST` | `/runners/heartbeat` | Send a heartbeat |
| `POST` | `/runners/update` | Update runner endpoint |
| `POST` | `/runners/offline` | Deregister a runner |

## License

MIT
