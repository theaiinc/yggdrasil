# Yggdrasil Admin Panel

A Grafana panel plugin for managing [Yggdrasil](https://github.com/theaiinc/yggdrasil) runners — update, restart, rotate API keys, set expected versions, and monitor your agent fleet health directly from Grafana.

![Yggdrasil Admin Panel](img/logo.svg)

## Features

- **Runner overview** — see all registered runners, their version, status, and update state at a glance
- **Request updates** — trigger runner updates from the Grafana UI
- **Rotate API keys** — rotate runner API keys in bulk or individually
- **Set expected version** — configure which runner version Yggdrasil considers current
- **REST API** — communicates directly with Yggdrasil's admin API endpoints
- **Self-update** — manually trigger Yggdrasil's own update mechanism from the panel

## Installation

### Option A: Grafana's official plugin catalog (recommended)

Search for "Yggdrasil Admin Panel" in Grafana's **Administration → Plugins** and install with one click.

### Option B: Install from npm (manual, for custom setups)

```bash
# Install the plugin globally (requires admin access on the Grafana server)
npm install -g @theaiinc/yggdrasiladmin-panel
```

Then configure Grafana to load the plugin. This depends on your Grafana setup:

**Docker Compose** — add a volume mount:

```yaml
volumes:
  - /path/to/node_modules/@theaiinc/yggdrasiladmin-panel/dist:/var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel
```

**Linux package install** — symlink into the plugins directory:

```bash
ln -s /usr/lib/node_modules/@theaiinc/yggdrasiladmin-panel/dist /var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel
```

### Option C: Docker Compose (monorepo setup)

If using the Yggdrasil [docker-compose.yml](https://github.com/theaiinc/yggdrasil/blob/main/docker-compose.yml), the plugin is already configured:

```yaml
grafana:
  image: grafana/grafana:latest
  volumes:
    - ./packages/yggdrasil-grafana-plugins/dist:/var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel
  environment:
    - GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=theaiinc-yggdrasiladmin-panel
```

## Configuration

After installing, add the panel to a dashboard:

1. **Create or open a dashboard** in Grafana
2. **Add a new panel** → select the **Yggdrasil Admin Panel** visualization
3. In the panel editor, configure these options:

| Option | Description | Default |
|---|---|---|
| **Yggdrasil URL** | Base URL of the Yggdrasil server | `http://localhost:3000` |
| **Admin API Key** | API key for `X-Admin-Api-Key` authentication | _(empty)_ |

> **Important:** The Yggdrasil URL must be reachable from the browser running Grafana. If Yggdrasil runs in Docker, use the host-accessible address (e.g. `http://localhost:3000`), not the Docker internal hostname.

## Usage

Once configured, the panel shows:

- **Health summary** — Yggdrasil version, uptime, and runner counts (online/offline/total)
- **Runner table** — each runner with:
  - Name, version, status badge (online/offline)
  - Outdated indicator when version doesn't match expected
  - Pending update / API key rotation flags
  - Action buttons (update, key rotation)
- **Expected version** — set or view the runner version Yggdrasil considers current
- **Self-update** — trigger Yggdrasil's own update mechanism (if `DOCKER_UPDATE_COMMAND` is configured)

### Required Admin API Key

The plugin needs an admin API key to communicate with Yggdrasil. Configure this in the Yggdrasil server:

```bash
# Set via environment variable in docker-compose.yml or .env
ADMIN_API_KEY=your-secure-key-here
```

Then enter the same key in the panel editor's **Admin API Key** field.

## Prerequisites

- **Grafana v10.0 or later** (v13+ recommended)
- **Yggdrasil v0.3.0 or later** with the admin API enabled
- **Unsigned plugin allowance** if not installed from the Grafana catalog:
  ```bash
  GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=theaiinc-yggdrasiladmin-panel
  ```

## Development

```bash
# Clone the monorepo
git clone https://github.com/theaiinc/yggdrasil.git
cd yggdrasil/packages/yggdrasil-grafana-plugins

# Install dependencies
npm install

# Build for production
npm run build

# Watch mode for development
npm run dev
```

### Build output

The built plugin is written to `dist/` and contains:

```
dist/
├── module.js        # Plugin entry point (webpack bundle)
├── module.js.map    # Source map
├── plugin.json      # Grafana plugin manifest
├── README.md        # Copy of this file (displayed in Grafana)
├── CHANGELOG.md     # Version history
└── LICENSE          # MIT license
```

## Architecture

The plugin is a self-contained React application that communicates directly with Yggdrasil's REST API. It does not use a Grafana data source — all data is fetched client-side from the configured Yggdrasil URL.

```
┌─────────────────────────────────────────────┐
│  Browser (Grafana)                          │
│  ┌───────────────────────────────────────┐  │
│  │  Yggdrasil Admin Panel (React)        │  │
│  │  ┌────────────┐  ┌─────────────────┐  │  │
│  │  │ Health     │  │ Runner Table    │  │  │
│  │  │ Summary    │  │ + Actions       │  │  │
│  │  └────────────┘  └─────────────────┘  │  │
│  │         │                │              │  │
│  │         ▼                ▼              │  │
│  │   HTTP GET/POST with X-Admin-Api-Key    │  │
│  └───────────────────────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Yggdrasil (port 3000)                        │
│  /api/admin/runners                           │
│  /api/admin/expected-version                  │
│  /api/admin/runners/request-update            │
│  /api/admin/api-keys/rotate                   │
│  /api/admin/self-update                       │
└──────────────────────────────────────────────┘
```

## API Endpoints Used

The panel requires these endpoints on the Yggdrasil server:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/runners` | List all runners with status, version, pending updates |
| `POST` | `/api/admin/runners/request-update` | Request an update for one or more runners |
| `POST` | `/api/admin/expected-version` | Set the expected runner version |
| `POST` | `/api/admin/api-keys/rotate` | Rotate API keys for one or more runners |
| `POST` | `/api/admin/self-update` | Trigger Yggdrasil's own update |

## License

MIT
