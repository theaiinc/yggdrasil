import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { getLogger } from './services/logger.js';
import { nanoid } from 'nanoid';

import type {
  SystemResources,
  PendingUpdate,
  RunnerInfo,
  RunnerTask,
  RegisterRunnerPayload,
  HeartbeatPayload,
  HeartbeatResponse,
  RequestUpdatePayload,
} from './types/index.js';

const app = express();
const logger = getLogger();

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

function escapePrometheusLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function runnerLabels(id: string, name: string): string {
  return `runner="${escapePrometheusLabelValue(id)}",name="${escapePrometheusLabelValue(name)}"`;
}

app.get('/metrics', (_req, res) => {
  // Snapshot runner state once so concurrent heartbeats cannot produce duplicate
  // series with different values within a single scrape response.
  const snapshot = Array.from(runners.entries());
  const online = snapshot.filter(([, r]) => r.status === 'online');
  const offlineCount = snapshot.length - online.length;
  const tasksRunning = snapshot.reduce(
    (sum, [, r]) => sum + r.tasks.filter(t => t.status === 'running').length,
    0,
  );

  const metrics: string[] = [
    '# HELP yggdrasil_runners_total Total number of registered runners',
    '# TYPE yggdrasil_runners_total gauge',
    `yggdrasil_runners_total ${snapshot.length}`,
    '# HELP yggdrasil_runners_online Number of online runners',
    '# TYPE yggdrasil_runners_online gauge',
    `yggdrasil_runners_online ${online.length}`,
    '# HELP yggdrasil_runners_offline Number of offline runners',
    '# TYPE yggdrasil_runners_offline gauge',
    `yggdrasil_runners_offline ${offlineCount}`,
    '# HELP yggdrasil_uptime_seconds Server uptime in seconds',
    '# TYPE yggdrasil_uptime_seconds gauge',
    `yggdrasil_uptime_seconds ${process.uptime()}`,
    '# HELP yggdrasil_tasks_running Number of currently running tasks across all runners',
    '# TYPE yggdrasil_tasks_running gauge',
    `yggdrasil_tasks_running ${tasksRunning}`,
  ];

  if (EXPECTED_RUNNER_VERSION) {
    metrics.push(
      '# HELP yggdrasil_expected_runner_version Expected runner version (always 1) — label carries the expected version',
      '# TYPE yggdrasil_expected_runner_version gauge',
      `yggdrasil_expected_runner_version{version="${escapePrometheusLabelValue(EXPECTED_RUNNER_VERSION)}"} 1`,
    );
  }

  const onlineWithResources = online.filter(([, r]) => r.resources);
  if (onlineWithResources.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_cpu_percent CPU usage percent per runner',
      '# TYPE yggdrasil_runner_cpu_percent gauge',
    );
    for (const [id, runner] of onlineWithResources) {
      metrics.push(
        `yggdrasil_runner_cpu_percent{${runnerLabels(id, runner.name)}} ${runner.resources!.cpu.percent}`,
      );
    }

    metrics.push(
      '# HELP yggdrasil_runner_memory_percent Memory usage percent per runner',
      '# TYPE yggdrasil_runner_memory_percent gauge',
    );
    for (const [id, runner] of onlineWithResources) {
      metrics.push(
        `yggdrasil_runner_memory_percent{${runnerLabels(id, runner.name)}} ${runner.resources!.memory.percent}`,
      );
    }

    metrics.push(
      '# HELP yggdrasil_runner_memory_used_bytes Memory used bytes per runner',
      '# TYPE yggdrasil_runner_memory_used_bytes gauge',
    );
    for (const [id, runner] of onlineWithResources) {
      metrics.push(
        `yggdrasil_runner_memory_used_bytes{${runnerLabels(id, runner.name)}} ${runner.resources!.memory.used}`,
      );
    }
  }

  const outdatedRunners = EXPECTED_RUNNER_VERSION
    ? snapshot.filter(([, r]) => r.version !== EXPECTED_RUNNER_VERSION)
    : [];
  const pendingUpdateRunners = snapshot.filter(([, r]) => r.pendingUpdate);

  if (snapshot.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_version_info Runner version (always 1) — labels carry version',
      '# TYPE yggdrasil_runner_version_info gauge',
    );
    for (const [id, runner] of snapshot) {
      const verLabels = `${runnerLabels(id, runner.name)},version="${escapePrometheusLabelValue(runner.version)}"`;
      metrics.push(`yggdrasil_runner_version_info{${verLabels}} 1`);
    }
  }

  if (outdatedRunners.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_outdated Outdated runner flag (1 = version mismatch)',
      '# TYPE yggdrasil_runner_outdated gauge',
    );
    for (const [id, runner] of outdatedRunners) {
      const outdatedLabels = `${runnerLabels(id, runner.name)},current="${escapePrometheusLabelValue(runner.version)}",expected="${escapePrometheusLabelValue(EXPECTED_RUNNER_VERSION)}"`;
      metrics.push(`yggdrasil_runner_outdated{${outdatedLabels}} 1`);
    }
  }

  if (pendingUpdateRunners.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_pending_update Pending update flag per runner (1 = update pending)',
      '# TYPE yggdrasil_runner_pending_update gauge',
    );
    for (const [id, runner] of pendingUpdateRunners) {
      const updLabels = `${runnerLabels(id, runner.name)},current_version="${escapePrometheusLabelValue(runner.version)}",target_version="${escapePrometheusLabelValue(runner.pendingUpdate!.version)}"`;
      metrics.push(`yggdrasil_runner_pending_update{${updLabels}} 1`);
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

  // Upsert: preserve existing tasks when re-registering (lease expiry, reconnect)
  const existing = runners.get(runnerId);
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
    // Preserve existing tasks on re-registration
    tasks: existing?.tasks ?? body.tasks ?? [],
  });

  logger.info('Runner registered', { runnerId, name: body.name, endpoint: body.endpoint, reRegistered: !!existing });
  res.status(201).json({ runnerId, status: existing ? 're-registered' : 'registered' });
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

  // If there is a pending update, include it in the response and clear it
  const pendingUpdate = runner.pendingUpdate;
  if (pendingUpdate) {
    delete runner.pendingUpdate;
  }

  logger.debug('Runner heartbeat received', { runnerId, hasPendingUpdate: !!pendingUpdate });
  res.json({ status: 'ok', ...(pendingUpdate ? { pendingUpdate } : {}) });
});

/**
 * Request an update for a specific runner.
 * The update is stored and delivered on the next heartbeat response.
 * The runner defers execution until all running tasks complete.
 */
app.post('/runners/:runnerId/request-update', (req, res) => {
  const runner = runners.get(req.params.runnerId);
  if (!runner) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  const body = req.body as {
    version: string;
    command?: string;
    downloadUrl?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.version) {
    res.status(400).json({ error: 'version is required' });
    return;
  }

  runner.pendingUpdate = {
    version: body.version,
    ...(body.command !== undefined ? { command: body.command } : {}),
    ...(body.downloadUrl !== undefined ? { downloadUrl: body.downloadUrl } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  };

  logger.info('Update requested for runner', {
    runnerId: runner.runnerId,
    version: body.version,
    hasCommand: !!body.command,
    hasDownloadUrl: !!body.downloadUrl,
  });

  res.json({
    status: 'update_requested',
    runnerId: runner.runnerId,
    pendingUpdate: runner.pendingUpdate,
  });
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
const EXPECTED_RUNNER_VERSION = process.env['EXPECTED_RUNNER_VERSION'] || '';

if (typeof process.env.VITEST === 'undefined') {
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
}

// ─── Start server ───────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] || '3000', 10);

// In test mode (vitest), export app/runners without starting the server
if (typeof process.env.VITEST === 'undefined') {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('Orchestration controller started (runner-only mode via Ratatoskr)', {
      port: PORT,
      environment: process.env['NODE_ENV'] || 'development',
      apiKeysConfigured: API_KEYS.length > 0,
      leaseTtlMs: LEASE_TTL_MS,
    });
  });
}

export { app, runners };

