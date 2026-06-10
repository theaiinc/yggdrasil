# @theaiinc/yggdrasil-ratatoskr

Lightweight discovery and heartbeat daemon for Yggdrasil runner registration.

Ratatoskr runs alongside an agent runner (any machine, anywhere) and continuously informs Yggdrasil about:

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
  yggdrasilUrl: 'http://localhost:3000',
  apiKey: 'my-api-key',  // required if Yggdrasil has API_KEYS set
});

await ratatoskr.start();
```

Within seconds, Yggdrasil automatically knows that the runner exists, where it lives, what it can do, and whether it is healthy.

### Running via CLI (no TypeScript needed)

```bash
YGGDRASIL_URL=http://localhost:3000 \
API_KEY=my-api-key \
RUNNER_NAME=my-laptop \
CAPABILITIES=http,health,browser \
npx @theaiinc/yggdrasil-ratatoskr
```

The `YGGDRASIL_URL` can point to a remote Yggdrasil over the internet — Ratatoskr connects outbound.

## Advanced Usage

```typescript
import { Ratatoskr } from '@theaiinc/yggdrasil-ratatoskr';

const ratatoskr = new Ratatoskr({
  runnerId: 'runner-a',
  name: 'MacBook Pro',
  yggdrasilUrl: 'https://yggdrasil.mycompany.com',
  apiKey: process.env['YGGDRASIL_API_KEY'],
  capabilities: ['browser', 'computer-use', 'llm'],
  heartbeatInterval: 15,
  leaseTtl: 45,
  detectLocalIp: true,
  detectPublicIp: false,
  endpointProvider: async () => 'http://192.168.1.5:8080',
  healthProvider: async () => ({ status: 'healthy' }),
});

await ratatoskr.start();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runnerId` | `string` | Auto-generated | Unique runner identifier |
| `name` | `string` | `'unknown'` | Human-readable runner name |
| `yggdrasilUrl` | `string` | (required) | Yggdrasil server URL (local or remote) |
| `apiKey` | `string` | `''` | API key for Yggdrasil auth |
| `capabilities` | `string[]` | `[]` | List of runner capabilities |
| `heartbeatInterval` | `number` | `30` | Heartbeat interval in seconds |
| `leaseTtl` | `number` | `60` | Lease TTL in seconds |
| `detectLocalIp` | `boolean` | `true` | Auto-detect local IP |
| `detectPublicIp` | `boolean` | `false` | Auto-detect public IP |
| `endpointProvider` | `() => Promise<string>` | `undefined` | Custom endpoint resolver |
| `healthProvider` | `() => Promise<HealthResult>` | `undefined` | Custom health check |
| `labels` | `Record<string, string>` | `{}` | Additional labels |
| `metadata` | `Record<string, unknown>` | `{}` | Additional metadata |

## Environment Variables (for CLI runner)

| Variable | Default | Description |
|----------|---------|-------------|
| `YGGDRASIL_URL` | `http://orchestration-controller:3000` | Yggdrasil server URL |
| `API_KEY` | `''` | API key for authentication |
| `RUNNER_NAME` | `ratatoskr-<hostname>` | Human-readable runner name |
| `CAPABILITIES` | `http,health` | Comma-separated capabilities |

## Architecture

```
yggdrasil-ratatoskr
│
├── runner.ts              # CLI entrypoint (reads env vars)
├── ratatoskr.ts           # Main daemon class
├── types/                 # TypeScript interfaces and enums
├── transports/            # Transport abstraction (HTTP)
│   └── http-transport.ts  # HTTP transport with API key support
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
2. **Heartbeats** — Sent every N seconds (configurable) to confirm the runner is alive.
3. **Lease** — Each registration has a TTL. If Yggdrasil misses enough heartbeats, the runner is marked `offline`.
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
