# Yggdrasil

Distributed runner orchestration controller — the control plane for the Yggdrasil agent management system.

## Overview

Yggdrasil is the central orchestration controller that manages a fleet of **Ratatoskr** runner agents. It handles:

- **Runner registration & heartbeats** — track agent liveness and health
- **Task dispatch** — assign and monitor tasks across distributed runners
- **Lease management** — detect stale/offline runners via TTL-based leases
- **Realm lifecycle** — schedule, provision, and manage execution environments (realms)
- **Session management** — create, observe, and control interaction sessions attached to realms
- **Prometheus metrics** — monitor fleet health, version drift, and update progress
- **Self-update** — trigger npm or Docker-based updates via admin API

## Usage

```yaml
services:
  orchestration-controller:
    image: theaiinc/yggdrasil:latest
    ports:
      - "3000:3000"
    environment:
      - API_KEYS=your-api-key
      - ADMIN_API_KEY=your-admin-key
```

## Related Images

- **[theaiinc/ratatoskr](https://hub.docker.com/r/theaiinc/ratatoskr)** — Runner daemon that registers with Yggdrasil

## Resources

- [GitHub](https://github.com/theaiinc/yggdrasil)
- [npm](https://www.npmjs.com/package/@theaiinc/yggdrasil)
- License: MIT
