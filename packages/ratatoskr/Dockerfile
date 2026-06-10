# Ratatoskr — Lightweight discovery and heartbeat daemon
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev deps for build)
RUN npm ci

# Copy application source
COPY tsconfig.json ./
COPY src/ ./src/

# Build the application
RUN npm run build

# Runtime stage
FROM node:18-alpine

# Install networking tools
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

RUN chown -R nodejs:nodejs /app

USER nodejs

# Run the ratatoskr runner
CMD ["npm", "run", "start:runner"]
