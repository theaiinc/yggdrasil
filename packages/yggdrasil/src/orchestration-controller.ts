import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { getLogger } from './services/logger.js';
import { nanoid } from 'nanoid';

const app = express();
const logger = getLogger();

// ─── Runner & task types ─────────────────────────────────────────

interface SystemResources {
  cpu: {
    load1: number;
    load5: number;
    load15: number;
    cpus: number;
    percent: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  uptime: number;
}

interface RunnerInfo {
  runnerId: string;
  name: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  labels: Record<string, string>;
  lastHeartbeat: Date;
  status: 'online' | 'offline';
  resources?: SystemResources;
  tasks: RunnerTask[];
}

interface RunnerTask {
  taskId: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

const runners = new Map<string, RunnerInfo>();

// ─── API key authentication ─────────────────────────────────────

const API_KEYS: string[] =
  (process.env['API_KEYS'] || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k !== '');

function apiKeyAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (req.path === '/health' || req.path === '/metrics') {
    next();
    return;
  }

  if (API_KEYS.length === 0) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey || !API_KEYS.includes(apiKey)) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }
  next();
}

// ─── Middleware ──────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(apiKeyAuth);

app.use((req, _res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    requestId: req.headers['x-request-id'] || 'unknown',
  });
  next();
});

// ─── Health / Metrics / Liveness ────────────────────────────────

app.get('/health', (_req, res) => {
  const online = Array.from(runners.values()).filter(r => r.status === 'online');
  const offlineCount = runners.size - online.length;
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    uptime: process.uptime(),
    runners: {
      total: runners.size,
      online: online.length,
      offline: offlineCount,
    },
  });
});

app.get('/metrics', (_req, res) => {
  const online = Array.from(runners.values()).filter(r => r.status === 'online');
  const metrics: string[] = [
    '# HELP yggdrasil_runners_total Total number of registered runners',
    '# TYPE yggdrasil_runners_total gauge',
    `yggdrasil_runners_total ${runners.size}`,
    '# HELP yggdrasil_runners_online Number of online runners',
    '# TYPE yggdrasil_runners_online gauge',
    `yggdrasil_runners_online ${online.length}`,
    '# HELP yggdrasil_runners_offline Number of offline runners',
    '# TYPE yggdrasil_runners_offline gauge',
    `yggdrasil_runners_offline ${runners.size - online.length}`,
    '# HELP yggdrasil_uptime_seconds Server uptime in seconds',
    '# TYPE yggdrasil_uptime_seconds counter',
    `yggdrasil_uptime_seconds ${process.uptime()}`,
    '# HELP yggdrasil_tasks_running Number of currently running tasks across all runners',
    '# TYPE yggdrasil_tasks_running gauge',
    `yggdrasil_tasks_running ${Array.from(runners.values()).reduce((sum, r) => sum + r.tasks.filter(t => t.status === 'running').length, 0)}`,
  ];

  // Per-runner resource metrics
  for (const [id, runner] of runners.entries()) {
    if (runner.resources && runner.status === 'online') {
      const labels = `runner="${id}",name="${runner.name}"`;
      metrics.push(`# HELP yggdrasil_runner_cpu_percent CPU usage percent per runner`);
      metrics.push(`# TYPE yggdrasil_runner_cpu_percent gauge`);
      metrics.push(`yggdrasil_runner_cpu_percent{${labels}} ${runner.resources.cpu.percent}`);
      metrics.push(`# HELP yggdrasil_runner_memory_percent Memory usage percent per runner`);
      metrics.push(`# TYPE yggdrasil_runner_memory_percent gauge`);
      metrics.push(`yggdrasil_runner_memory_percent{${labels}} ${runner.resources.memory.percent}`);
      metrics.push(`# HELP yggdrasil_runner_memory_used_bytes Memory used bytes per runner`);
      metrics.push(`# TYPE yggdrasil_runner_memory_used_bytes gauge`);
      metrics.push(`yggdrasil_runner_memory_used_bytes{${labels}} ${runner.resources.memory.used}`);
    }
  }

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(metrics.join('\n') + '\n');
});

// ─── Runner lifecycle (heartbeat from Ratatoskr daemon) ─────────

app.post('/runners/register', (req, res) => {
  const body = req.body as {
    runnerId?: string;
    name?: string;
    endpoint?: string;
    version?: string;
    capabilities?: string[];
    labels?: Record<string, string>;
    metadata?: Record<string, unknown>;
    resources?: SystemResources;
    tasks?: RunnerTask[];
  };

  const runnerId = body.runnerId || nanoid();
  runners.set(runnerId, {
    runnerId,
    name: body.name || 'unknown',
    endpoint: body.endpoint || 'unknown',
    version: body.version || '0.1.0',
    capabilities: body.capabilities || [],
    labels: body.labels || {},
    lastHeartbeat: new Date(),
    status: 'online',
    ...(body.resources ? { resources: body.resources } : {}),
    tasks: body.tasks || [],
  });

  logger.info('Runner registered', { runnerId, name: body.name, endpoint: body.endpoint });
  res.status(201).json({ runnerId, status: 'registered' });
});

app.post('/runners/heartbeat', (req, res) => {
  const body = req.body as {
    runnerId?: string;
    timestamp?: number;
    status?: string;
    resources?: SystemResources;
    tasks?: RunnerTask[];
  };
  const runnerId = body.runnerId;
  if (!runnerId || !runners.has(runnerId)) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  const runner = runners.get(runnerId)!;
  runner.lastHeartbeat = new Date();
  runner.status = 'online';
  if (body.resources) {
    runner.resources = body.resources;
  }
  if (body.tasks) {
    runner.tasks = body.tasks;
  }

  logger.debug('Runner heartbeat received', { runnerId });
  res.json({ status: 'ok' });
});

app.post('/runners/update', (req, res) => {
  const body = req.body as { runnerId?: string; oldEndpoint?: string; newEndpoint?: string };
  const runnerId = body.runnerId;
  if (!runnerId || !runners.has(runnerId)) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  const runner = runners.get(runnerId)!;
  runner.endpoint = body.newEndpoint || runner.endpoint;
  runner.lastHeartbeat = new Date();

  logger.info('Runner endpoint updated', { runnerId, newEndpoint: body.newEndpoint });
  res.json({ status: 'updated' });
});

app.post('/runners/offline', (req, res) => {
  const body = req.body as { runnerId?: string };
  const runnerId = body.runnerId;
  if (!runnerId || !runners.has(runnerId)) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  runners.get(runnerId)!.status = 'offline';
  logger.info('Runner went offline', { runnerId });
  res.json({ status: 'offline' });
});

// ─── Task management ────────────────────────────────────────────

app.post('/runners/:runnerId/tasks', (req, res) => {
  const runner = runners.get(req.params.runnerId);
  if (!runner) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  const body = req.body as {
    taskId?: string;
    type: string;
    status?: 'running' | 'completed' | 'failed';
    correlationId?: string;
    metadata?: Record<string, unknown>;
  };

  const task: RunnerTask = {
    taskId: body.taskId || `task-${nanoid(8)}`,
    type: body.type,
    status: body.status || 'running',
    startedAt: Date.now(),
    ...(body.correlationId ? { correlationId: body.correlationId } : {}),
    ...(body.metadata ? { metadata: body.metadata } : {}),
  };

  runner.tasks.push(task);
  logger.info('Task created on runner', { runnerId: runner.runnerId, taskId: task.taskId, type: task.type });
  res.status(201).json(task);
});

app.patch('/runners/:runnerId/tasks/:taskId', (req, res) => {
  const runner = runners.get(req.params.runnerId);
  if (!runner) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  const task = runner.tasks.find(t => t.taskId === req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const body = req.body as { status?: 'running' | 'completed' | 'failed'; metadata?: Record<string, unknown> };
  if (body.status) {
    task.status = body.status;
    if (body.status === 'completed' || body.status === 'failed') {
      task.completedAt = Date.now();
    }
  }
  if (body.metadata) {
    task.metadata = { ...task.metadata, ...body.metadata };
  }

  logger.info('Task updated', { runnerId: runner.runnerId, taskId: task.taskId, status: task.status });
  res.json(task);
});

app.get('/runners/:runnerId/tasks', (req, res) => {
  const runner = runners.get(req.params.runnerId);
  if (!runner) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  const { status } = req.query;
  let tasks = runner.tasks;
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }

  res.json({ runnerId: runner.runnerId, tasks, count: tasks.length });
});

// ─── Runner queries ─────────────────────────────────────────────

app.get('/api/runners', (_req, res) => {
  res.json({
    runners: Array.from(runners.values()).map(r => ({
      runnerId: r.runnerId,
      name: r.name,
      endpoint: r.endpoint,
      version: r.version,
      capabilities: r.capabilities,
      labels: r.labels,
      status: r.status,
      lastHeartbeat: r.lastHeartbeat,
      resources: r.resources,
      tasks: r.tasks,
    })),
    count: runners.size,
  });
});

app.get('/api/runners/:runnerId', (req, res) => {
  const runner = runners.get(req.params.runnerId);
  if (!runner) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }
  res.json(runner);
});

// ─── Lease-based offline detection ──────────────────────────────

const LEASE_TTL_MS = parseInt(process.env['LEASE_TTL_MS'] || '60000', 10);

setInterval(() => {
  const now = Date.now();
  const stale: string[] = [];

  for (const [runnerId, runner] of runners.entries()) {
    if (runner.status === 'offline') continue;
    const elapsed = now - runner.lastHeartbeat.getTime();
    if (elapsed > LEASE_TTL_MS) {
      stale.push(runnerId);
    }
  }

  for (const runnerId of stale) {
    const runner = runners.get(runnerId)!;
    runner.status = 'offline';
    logger.warn('Runner marked offline due to heartbeat timeout', {
      runnerId,
      name: runner.name,
      missedBy: `${Math.round((now - runner.lastHeartbeat.getTime()) / 1000)}s`,
    });
  }
}, 10_000);

// ─── Start server ───────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Orchestration controller started (runner-only mode via Ratatoskr)', {
    port: PORT,
    environment: process.env['NODE_ENV'] || 'development',
    apiKeysConfigured: API_KEYS.length > 0,
    leaseTtlMs: LEASE_TTL_MS,
  });
});
