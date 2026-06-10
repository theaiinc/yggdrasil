# Technical Proposal — Ratatoskr-Based Runner Discovery

## 1. Overview

Yggdrasil is a distributed orchestration system for managing remote runner machines. Each runner runs a Ratatoskr daemon that continuously registers itself with Yggdrasil via heartbeat.

Key design decisions:
- **Ratatoskr is client-side**: it runs on each runner machine and connects *outbound* to Yggdrasil. Runners can be anywhere — local Docker containers, laptops, cloud VMs, or edge devices.
- **Yggdrasil is the server**: it receives registrations, tracks liveness via lease-based offline detection, and exposes an API to query available runners.
- **Pull model**: Yggdrasil does not probe runners. Runners push their state via heartbeats instead.

## 2. Architecture

```
┌─────────────────────────────────┐
│        Yggdrasil Server         │
│  (Node.js / Express)            │
│                                 │
│  POST /runners/register         │
│  POST /runners/heartbeat        │
│  POST /runners/update           │
│  POST /runners/offline          │
│  GET  /api/runners              │
│  GET  /health                   │
│  GET  /metrics                  │
└──────────┬──────────────────────┘
           │
    ┌──────┴──────┐
    │  Internet   │
    └──────┬──────┘
           │
    ┌──────┴───────────────┐
    │  Ratatoskr Daemon    │  ← runs on each runner machine
    │  (registration,      │
    │   heartbeat,         │
    │   health,            │
    │   endpoint detect)   │
    └──────────────────────┘
```

### Key properties

| Property | Detail |
|----------|--------|
| **Transport** | HTTP(S) — Ratatoskr connects *outbound* to Yggdrasil |
| **Auth** | API key via `X-API-Key` header |
| **Liveness** | Lease-based: heartbeats renew a TTL; missing heartbeats → offline |
| **Scaling** | Any number of runners register independently |
| **Network** | No inbound ports needed on runners; works across NAT/firewalls |

## 3. Ratatoskr Lifecycle

1. **Startup**: Registers runner metadata (ID, name, endpoint, capabilities) via `POST /runners/register`
2. **Heartbeat**: Sends health status every N seconds via `POST /runners/heartbeat`
3. **IP Change**: Detects endpoint changes every 10s, notifies via `POST /runners/update`
4. **Lease Check**: Re-registers if lease expires (e.g. Yggdrasil restarted)
5. **Shutdown**: Deregisters via `POST /runners/offline` on SIGTERM/SIGINT

## 4. Yggdrasil Server Behavior

| Function | Implementation |
|----------|---------------|
| Runner tracking | In-memory `Map<string, RunnerInfo>` |
| Offline detection | Polls every 10s, marks runners offline if `now - lastHeartbeat > LEASE_TTL_MS` |
| Metrics | Prometheus scrape at `/metrics` (runner count, online/offline) |
| Auth | API key middleware on all routes except `/health` and `/metrics` |

## 5. Monitoring

Prometheus scrapes Yggdrasil's `/metrics` endpoint. Available metrics:

- `yggdrasil_runners_total` — total registered runners
- `yggdrasil_runners_online` — currently online runners
- `yggdrasil_runners_offline` — offline runners
- `yggdrasil_uptime_seconds` — server uptime

Grafana can be used to visualize these metrics.

## 6. Next Steps

1. **Deploy Yggdrasil** to a publicly accessible server
2. **Run Ratatoskr** on target machines (laptops, VMs, Docker)
3. **Connect to Yggdrasil programmatically** via `GET /api/runners` to discover available runners
4. **Add TLS** for production (reverse proxy with nginx/caddy)
5. **Add persistent storage** for runner state across Yggdrasil restarts
