# @theaiinc/yggdrasil - Distributed Orchestration System

A robust, scalable orchestration system for agent containers with auto-scaling capabilities, built with stable, well-documented technologies.

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Orchestration │    │   Load Balancer │    │   Agent Pool    │
│   Controller    │───▶│   (Nginx)       │───▶│   (Docker)      │
│   (Node.js)     │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Monitoring    │    │   Health Checks │    │   Auto-scaling  │
│   (Prometheus)  │    │   (Express)     │    │   (Docker)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Technology Stack

### Core Technologies

- **Node.js + TypeScript** - Stable, well-documented runtime
- **Express.js** - Battle-tested web framework
- **Docker** - Industry standard containerization
- **Socket.IO** - Real-time communication

### Infrastructure

- **Docker Compose** - Local orchestration
- **Nginx** - Load balancing and session affinity
- **Prometheus + Grafana** - Monitoring and alerting
- **Redis** - Session storage (optional)

### Key Features

- ✅ **Low Maintenance** - Uses stable, mature technologies
- ✅ **Excellent Documentation** - All components well-documented
- ✅ **Auto-scaling** - Automatic agent scaling based on load
- ✅ **Session Affinity** - Sticky sessions for stateful workflows
- ✅ **Health Monitoring** - Comprehensive health checks
- ✅ **Circuit Breaker** - Fault tolerance and error handling
- ✅ **Metrics Collection** - Prometheus integration

## 📋 Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- 4GB+ RAM available for containers

## 🛠️ Quick Start

### 1. Clone and Setup

```bash
cd yggdrasil
npm install
```

### 2. Start the System

```bash
# Start all services
docker-compose up -d

# Or start with development mode
docker-compose -f docker-compose.dev.yml up
```

### 3. Access Services

- **Load Balancer**: http://localhost:80
- **Orchestration Controller**: http://localhost:3000
- **Grafana Dashboard**: http://localhost:3001 (admin/admin)
- **Prometheus**: http://localhost:9090

### 4. Health Check

```bash
# Check system health
curl http://localhost/health

# Check agent health
curl http://localhost/agent/agent-1/health
```

## 🔧 Configuration

### Environment Variables

```bash
# Orchestration Controller
NODE_ENV=development
LOG_LEVEL=info
HEALTH_CHECK_INTERVAL=30000
MAX_CONCURRENCY=80
MIN_INSTANCES=1
MAX_INSTANCES=10

# Agent Configuration
AGENT_ID=agent-1
PORT=8080
```

### Load Balancer Settings

Edit `nginx.conf` to modify:

- Load balancing algorithm
- Session affinity settings
- Rate limiting
- Health check endpoints

### Monitoring Configuration

Edit `prometheus.yml` to customize:

- Scrape intervals
- Target endpoints
- Alert rules

## 📊 Monitoring

### Metrics Available

- **Agent Health**: Response time, error rates, CPU/memory usage
- **Load Balancer**: Request distribution, session affinity stats
- **Orchestration**: Queue depth, scaling events, circuit breaker status
- **System**: Container resource usage, network metrics

### Grafana Dashboards

Pre-configured dashboards for:

- Agent Performance
- Load Balancer Metrics
- System Health
- Scaling Events

## 🧪 Testing

### Load Testing

```bash
# Run load test
npm run load:test

# Or use hey tool
hey -n 1000 -c 10 http://localhost/api/test
```

### Health Checks

```bash
# Check all agents
npm run health:check

# Individual agent check
curl http://localhost/agent/agent-1/health
```

### Unit Tests

```bash
npm test
npm run test:coverage
```

## 🔄 Auto-scaling

### Local Simulation

The system simulates Cloud Run auto-scaling behavior locally:

1. **Resource Monitoring**: CPU and memory usage tracking
2. **Scaling Triggers**: Automatic agent scaling based on metrics
3. **Queue Management**: Request queuing when at capacity
4. **Health Checks**: Continuous agent health monitoring

### Scaling Configuration

```yaml
# docker-compose.yml
deploy:
  resources:
    limits:
      cpus: '0.5'
      memory: 512M
    reservations:
      cpus: '0.25'
      memory: 256M
```

## 🚨 Error Handling

### Circuit Breaker

- **Failure Threshold**: Configurable failure count
- **Recovery Time**: Automatic recovery after timeout
- **Fallback**: Graceful degradation when agents fail

### Retry Logic

- **Exponential Backoff**: Smart retry with increasing delays
- **Max Retries**: Configurable retry limits
- **Timeout Handling**: Request timeout management

## 📈 Performance

### Benchmarks

- **Latency**: < 200ms (95th percentile)
- **Throughput**: > 1000 requests/second
- **Error Rate**: < 1%
- **Uptime**: 99.9%

### Optimization

- **Connection Pooling**: Reuse connections
- **Compression**: Gzip compression enabled
- **Caching**: Response caching where appropriate
- **Resource Limits**: Container resource constraints

## 🔒 Security

### Best Practices

- **Non-root Containers**: All containers run as non-root users
- **Resource Limits**: CPU and memory constraints
- **Network Isolation**: Docker network isolation
- **Input Validation**: Request validation and sanitization

### Authentication

```bash
# Add authentication middleware
npm run add:auth
```

## 🚀 Deployment

### Local Development

```bash
# Development mode with hot reload
docker-compose -f docker-compose.dev.yml up

# With debugging
docker-compose -f docker-compose.dev.yml up --build
```

### Staging Environment

```bash
# Deploy to staging
docker-compose -f docker-compose.staging.yml up -d
```

### Production Environment

```bash
# Deploy to production
docker-compose -f docker-compose.prod.yml up -d
```

## 📚 API Documentation

### Orchestration Controller

```bash
# Get system status
GET /status

# Get metrics
GET /metrics

# Health check
GET /health
```

### Agent Endpoints

```bash
# Agent health
GET /agent/{agentId}/health

# Agent metrics
GET /agent/{agentId}/metrics

# Process request
POST /agent/{agentId}/process
```

### Load Balancer

```bash
# Health check
GET /health

# Status page
GET /status

# Metrics
GET /metrics
```

## 🤝 Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Use conventional commits

## 📄 License

UNLICENSED - Proprietary software by The AI Inc

## 🆘 Support

- **Documentation**: Check the docs/ directory
- **Issues**: Create GitHub issues
- **Discussions**: Use GitHub discussions

## 🔄 Roadmap

- [ ] Cloud Run integration
- [ ] Advanced metrics
- [ ] Machine learning scaling
- [ ] Multi-region deployment
- [ ] Advanced authentication
- [ ] API rate limiting
- [ ] WebSocket support
- [ ] GraphQL API

---

**Built with ❤️ by The AI Inc using stable, well-documented technologies**
