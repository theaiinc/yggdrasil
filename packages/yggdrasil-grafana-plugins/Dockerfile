# Yggdrasil Admin Panel for Grafana
#
# Extends the official Grafana image with the @theaiinc/yggdrasiladmin-panel
# plugin baked in, so no volume mount or manual plugin install is needed.
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for build)
COPY package*.json ./
RUN npm install

# Copy webpack config and source
COPY webpack.config.ts ./
COPY tsconfig.json ./
COPY .config/ ./.config/
COPY src/ ./src/
COPY README.md ./README.md
COPY LICENSE ./LICENSE
COPY CHANGELOG.md ./CHANGELOG.md

# Build the plugin (output lands in dist/)
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage — official Grafana image with plugin pre-installed
# ─────────────────────────────────────────────────────────────────────────────
FROM grafana/grafana:latest

LABEL org.opencontainers.image.title="Yggdrasil Grafana"
LABEL org.opencontainers.image.description="Grafana with the Yggdrasil Admin Panel pre-installed — manage runners, update, restart, and rotate API keys from Grafana"
LABEL org.opencontainers.image.url="https://github.com/theaiinc/yggdrasil"
LABEL org.opencontainers.image.source="https://github.com/theaiinc/yggdrasil"
LABEL org.opencontainers.image.vendor="The AI Inc"
LABEL org.opencontainers.image.licenses="MIT"

# Copy the built plugin into the Grafana plugin directory
COPY --from=builder /app/dist/ /var/lib/grafana/plugins/theaiinc-yggdrasiladmin-panel/

# Allow loading unsigned plugins (the Yggdrasil Admin Panel is not signed)
ENV GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=theaiinc-yggdrasiladmin-panel
