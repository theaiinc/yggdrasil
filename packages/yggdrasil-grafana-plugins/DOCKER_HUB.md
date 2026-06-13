# Yggdrasil Grafana

Grafana with the **Yggdrasil Admin Panel** plugin pre-installed — manage your runner fleet directly from Grafana dashboards.

## What's included

- Official Grafana base image
- `theaiinc-yggdrasiladmin-panel` plugin baked in (no volume mount needed)
- Unsigned plugin loading enabled by default

## Usage

```yaml
services:
  grafana:
    image: theaiinc/yggdrasil-grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## Features

- **Status tab** — view Yggdrasil health, runner versions, and self-update status
- **Control tab** — set expected versions, request runner updates, rotate API keys, purge offline runners

## Related Images

- **[theaiinc/yggdrasil](https://hub.docker.com/r/theaiinc/yggdrasil)** — Orchestration controller
- **[theaiinc/ratatoskr](https://hub.docker.com/r/theaiinc/ratatoskr)** — Runner daemon

## Resources

- [GitHub](https://github.com/theaiinc/yggdrasil)
- [npm](https://www.npmjs.com/package/@theaiinc/yggdrasiladmin-panel)
- License: MIT
