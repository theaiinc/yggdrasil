# Ratatoskr

Lightweight discovery and heartbeat daemon for **Yggdrasil** — the runner agent that connects distributed machines to the orchestration control plane.

## Overview

Ratatoskr runs alongside agent workloads and continuously:

- **Registers** the runner with Yggdrasil (advertising capabilities, endpoints, resources)
- **Heartbeats** periodically to maintain lease and report health
- **Executes tasks** dispatched by Yggdrasil (supports custom handlers via presets)
- **Relays Realm lifecycle** — registration, heartbeats, and deregistration for execution environments
- **Self-updates** — receives version update commands from Yggdrasil and applies them in-place

## Architecture

Ratatoskr is built on **Approach A**: the runtime installs `@theaiinc/yggdrasil-ratatoskr` as a published npm package. This means self-update is simply:

```
cd /app && npm install @theaiinc/yggdrasil-ratatoskr@<version>
```

The process then exits; Docker's restart policy starts the container with the new version.

## Usage

```yaml
services:
  ratatoskr:
    image: theaiinc/ratatoskr:latest
    environment:
      - YGGDRASIL_URL=http://orchestration-controller:3000
      - API_KEY=your-api-key
      - RUNNER_NAME=my-runner
      - CAPABILITIES=http,health,docker,registration
```

## Related Images

- **[theaiinc/yggdrasil](https://hub.docker.com/r/theaiinc/yggdrasil)** — Orchestration controller

## Resources

- [GitHub](https://github.com/theaiinc/yggdrasil)
- [npm](https://www.npmjs.com/package/@theaiinc/yggdrasil-ratatoskr)
- License: MIT
