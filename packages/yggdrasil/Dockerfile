# Orchestration controller for Yggdrasil — distributed runner orchestration
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev deps for build)
RUN npm install

# Copy application source config
COPY tsconfig.json ./
COPY src/ ./src/

# Build the application
RUN npm run build

# Runtime stage
FROM node:18-alpine

# Install monitoring tools
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

LABEL org.opencontainers.image.title="Yggdrasil"
LABEL org.opencontainers.image.description="Distributed runner orchestration controller — registration, heartbeat, task dispatch, lease management, Realm lifecycle, and Prometheus metrics for Ratatoskr agents"
LABEL org.opencontainers.image.url="https://github.com/theaiinc/yggdrasil"
LABEL org.opencontainers.image.source="https://github.com/theaiinc/yggdrasil"
LABEL org.opencontainers.image.vendor="The AI Inc"
LABEL org.opencontainers.image.licenses="MIT"

# Copy only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Set resource limits
ENV NODE_OPTIONS="--max-old-space-size=256"

# Start the orchestration controller
CMD ["npm", "start"]
