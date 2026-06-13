# Ratatoskr — Lightweight discovery and heartbeat daemon
#
# Approach A: The runtime stage installs @theaiinc/yggdrasil-ratatoskr as a
# published npm package. This means self-update at runtime is simply:
#   cd /app && npm install @theaiinc/yggdrasil-ratatoskr@<version>
# followed by process.exit(0) — Docker restart policy picks up the new version.

# ─── Builder stage ──────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev deps for build)
RUN npm install

# Copy application source
COPY tsconfig.json ./
COPY src/ ./src/

# Build the application
RUN npm run build

# Pack the tarball — same artifact that npm publish would push to the registry
# npm pack creates a file like: theaiinc-yggdrasil-ratatoskr-0.3.8.tgz
RUN mkdir -p /tmp/pack && npm pack --pack-destination /tmp/pack/

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage — thin consumer of the published npm package
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine

# Install networking tools
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

LABEL org.opencontainers.image.title="Ratatoskr"
LABEL org.opencontainers.image.description="Lightweight discovery and heartbeat daemon for Yggdrasil — registration, heartbeat, task execution, Realm lifecycle relay, and LLM/agent capability presets"
LABEL org.opencontainers.image.url="https://github.com/theaiinc/yggdrasil"
LABEL org.opencontainers.image.source="https://github.com/theaiinc/yggdrasil"
LABEL org.opencontainers.image.vendor="The AI Inc"
LABEL org.opencontainers.image.licenses="MIT"

# Create a "consumer" package.json and install the freshly built package
# This mirrors exactly what `npm install @theaiinc/yggdrasil-ratatoskr` would do
# at runtime, so the image is self-contained and the update path is identical.
RUN npm init -y
COPY --from=builder /tmp/pack/ /tmp/pack/
RUN npm install /tmp/pack/*.tgz && rm -rf /tmp/pack/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Run from the installed package — same path regardless of whether it's the
# baked-in version or an updated version from `npm install`
CMD ["node", "node_modules/@theaiinc/yggdrasil-ratatoskr/dist/src/runner.js"]
