import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getLogger } from './services/logger.js';
import { nanoid } from 'nanoid';

import { RealmRegistry } from './services/realm-registry.js';
import { RealmScheduler } from './services/realm-scheduler.js';
import { RealmProvisioner } from './services/realm-provisioner.js';
import { RealmLifecycleService } from './services/realm-lifecycle.js';
import { NpmVersionChecker } from './services/npm-version-checker.js';

import type {
  SystemResources,
  PendingUpdate,
  RunnerInfo,
  RunnerTask,
  UpdateStatus,
  RegisterRunnerPayload,
  HeartbeatPayload,
  HeartbeatResponse,
  RequestUpdatePayload,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionDescriptor,
  SessionHealth,
  RealmTemplateType,
  SessionCapability,
  RealmTemplate,
  Realm,
  RealmAllocation,
  RealmRegistration,
  RealmHeartbeat,
  RealmDeregistration,
} from './types/index.js';

const app = express();
const logger = getLogger();

const runners = new Map<string, RunnerInfo>();

// ─── Realm lifecycle services ───────────────────────────────────

const realmRegistry = new RealmRegistry();
const realmScheduler = new RealmScheduler(realmRegistry, (runnerId) => runners.get(runnerId));
const realmProvisioner = new RealmProvisioner(realmRegistry);
const realmLifecycle = new RealmLifecycleService(realmRegistry);

// ─── Yggdrasil version ─────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up from __dirname to find package.json (works from both src/ and dist/src/)
function findPackageJson(startDir: string, maxDepth: number = 5): { version: string } {
  let current = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = resolve(current, 'package.json');
    try {
      return JSON.parse(readFileSync(candidate, 'utf-8')) as { version: string };
    } catch {
      current = dirname(current);
    }
  }
  throw new Error('Could not find package.json');
}

const { version: YGGDRASIL_VERSION } = findPackageJson(__dirname);

// ─── NPM version checker ───────────────────────────────────────

const npmVersionChecker = new NpmVersionChecker('@theaiinc/yggdrasil', YGGDRASIL_VERSION);

// ─── API key authentication ─────────────────────────────────────

const API_KEYS: string[] =
  (process.env['API_KEYS'] || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k !== '');

function apiKeyAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // Allow unauthenticated access to health, metrics, admin APIs (admin is secured separately)
  if (req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/api/admin/')) {
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

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,       // Allow iframing by Grafana (different port)
}));
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
    version: YGGDRASIL_VERSION,
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
    '# HELP yggdrasil_api_keys_total Number of configured API keys',
    '# TYPE yggdrasil_api_keys_total gauge',
    `yggdrasil_api_keys_total ${API_KEYS.length}`,
    '# HELP yggdrasil_version_info Current Yggdrasil version (always 1) — label carries the running version',
    '# TYPE yggdrasil_version_info gauge',
    `yggdrasil_version_info{version="${escapePrometheusLabelValue(YGGDRASIL_VERSION)}"} 1`,
  ];

  const npmInfo = npmVersionChecker.getInfo();
  if (npmInfo.latest) {
    metrics.push(
      '# HELP yggdrasil_npm_latest_version Latest Yggdrasil version on npm (always 1) — label carries the latest version',
      '# TYPE yggdrasil_npm_latest_version gauge',
      `yggdrasil_npm_latest_version{current="${escapePrometheusLabelValue(npmInfo.current)}",latest="${escapePrometheusLabelValue(npmInfo.latest)}"} 1`,
    );
  }

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

  // Runners with a pending API key rotation (subset of pendingUpdateRunners)
  const pendingApiKeyRotations = pendingUpdateRunners.filter(([, r]) => r.pendingUpdate?.apiKey);
  if (pendingApiKeyRotations.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_pending_api_key_rotation Pending API key rotation flag per runner (1 = pending)',
      '# TYPE yggdrasil_runner_pending_api_key_rotation gauge',
    );
    for (const [id, runner] of pendingApiKeyRotations) {
      metrics.push(`yggdrasil_runner_pending_api_key_rotation{${runnerLabels(id, runner.name)}} 1`);
    }
  }

  // Update status metric: track the self-update progress of each runner
  const runnersWithUpdateStatus = snapshot.filter(([, r]) => r.updateStatus && r.updateStatus !== 'idle');
  if (runnersWithUpdateStatus.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_update_status Self-update status of each runner (1 = current status)',
      '# TYPE yggdrasil_runner_update_status gauge',
    );
    for (const [id, runner] of runnersWithUpdateStatus) {
      const statusLabels = `${runnerLabels(id, runner.name)},status="${escapePrometheusLabelValue(runner.updateStatus!)}"`;
      metrics.push(`yggdrasil_runner_update_status{${statusLabels}} 1`);
    }
  }

  // Runner update log tail — exposed as an info-style metric for operator visibility.
  // Grafana can display this via a text panel or the AdminPanel component.
  const runnersWithUpdateLog = snapshot.filter(([, r]) => r.updateLog);
  if (runnersWithUpdateLog.length > 0) {
    metrics.push(
      '# HELP yggdrasil_runner_update_log Raw update log tail per runner — last ~2KB of output',
      '# TYPE yggdrasil_runner_update_log gauge',
    );
    for (const [id, runner] of runnersWithUpdateLog) {
      const logLabels = `${runnerLabels(id, runner.name)},status="${escapePrometheusLabelValue(runner.updateStatus || 'idle')}"`;
      const truncated = runner.updateLog!.slice(-2000).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      metrics.push(`yggdrasil_runner_update_log{${logLabels},log="${truncated}"} 1`);
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
    realmTemplates?: Array<{ id: string; type: string; capabilities: string[] }>;
    labels?: Record<string, string>;
    metadata?: Record<string, unknown>;
    resources?: SystemResources;
    tasks?: RunnerTask[];
  };

  const runnerId = body.runnerId || nanoid();

  // Upsert: preserve existing tasks and templates when re-registering (lease expiry, reconnect)
  const existing = runners.get(runnerId);

  const templates: RealmTemplate[] = (body.realmTemplates ?? []).map(t => ({
    id: t.id,
    type: t.type as RealmTemplateType,
    capabilities: (t.capabilities ?? []) as SessionCapability[],
  }));

  runners.set(runnerId, {
    runnerId,
    name: body.name || 'unknown',
    endpoint: body.endpoint || 'unknown',
    version: body.version || '0.1.0',
    capabilities: body.capabilities || [],
    realmTemplates: templates,
    labels: body.labels || {},
    lastHeartbeat: new Date(),
    status: 'online',
    ...(body.resources ? { resources: body.resources } : {}),
    // Preserve existing tasks on re-registration
    tasks: existing?.tasks ?? body.tasks ?? [],
  });

  // Sync realm templates into the registry
  realmRegistry.setTemplates(runnerId, templates);

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
    updateStatus?: UpdateStatus;
    updateLog?: string;
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
  // Store update status reported by the runner (for observability)
  if (body.updateStatus) {
    runner.updateStatus = body.updateStatus;
    runner.updateLog = body.updateLog ?? '';
  }

  // If there is a pending update, include it in the response and clear it
  const pendingUpdate = runner.pendingUpdate;
  if (pendingUpdate) {
    delete runner.pendingUpdate;
  }

  logger.debug('Runner heartbeat received', { runnerId, hasPendingUpdate: !!pendingUpdate, updateStatus: body.updateStatus });
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
  realmRegistry.removeTemplates(runnerId);
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
      realmTemplates: r.realmTemplates,
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

// ─── Session management ─────────────────────────────────────────

const sessions = new Map<string, SessionDescriptor>();

function validateApiKey(req: express.Request): boolean {
  if (API_KEYS.length === 0) return true;
  const apiKey = req.headers['x-api-key'] as string | undefined;
  return !!apiKey && API_KEYS.includes(apiKey);
}

/**
 * Create a new interaction session.
 *
 * Flow:
 *   1. Validate request
 *   2. RealmScheduler decides which realm/realm template to use
 *   3. RealmProvisioner ensures the realm exists (spawn or attach)
 *   4. Create SessionDescriptor with realm endpoints
 *   5. Mark active and register
 */
app.post('/api/v1/sessions', async (req, res) => {
  const body = req.body as CreateSessionRequest;

  if (!body.type || !['computer-use', 'phone-use'].includes(body.type)) {
    res.status(400).json({ error: 'Invalid or missing session type. Must be "computer-use" or "phone-use".' });
    return;
  }

  try {
    // Step 1: Schedule — decide realm allocation
    const allocation = await realmScheduler.schedule(body);

    // Step 2: Provision — ensure realm exists
    const realm = await realmProvisioner.ensureRealm(allocation, body.ownerId);

    // Step 3: Create session attached to realm
    const sessionId = `session-${nanoid(12)}`;
    const now = new Date().toISOString();

    const descriptor: SessionDescriptor = {
      id: sessionId,
      type: body.type,
      state: 'creating',
      observationEndpoint: realm.endpoints.observation,
      inputEndpoint: realm.endpoints.input,
      capabilities: body.capabilities ?? (body.type === 'computer-use'
        ? ['mouse', 'keyboard', 'scroll', 'clipboard']
        : ['touch', 'keyboard', 'scroll']),
      observationMethod: 'screenshot',
      realmId: realm.id,
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
      ...(body.participantIds !== undefined ? { participantIds: body.participantIds } : {}),
      createdAt: now,
      updatedAt: now,
      metadata: {
        ...body.metadata,
        runnerId: realm.runnerId,
        allocationAction: allocation.action,
      },
    };

    descriptor.state = 'active';
    sessions.set(sessionId, descriptor);

    logger.info('Session created', {
      sessionId,
      type: body.type,
      realmId: realm.id,
      runnerId: realm.runnerId,
      allocationAction: allocation.action,
    });

    const response: CreateSessionResponse = { sessionId, descriptor };
    res.status(201).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to create session', { error: message });
    res.status(503).json({ error: `Unable to create session: ${message}` });
  }
});

/**
 * Get session details.
 */
app.get('/api/v1/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

/**
 * List all sessions, optionally filtered by type or state.
 */
app.get('/api/v1/sessions', (req, res) => {
  const { type, state } = req.query;
  let result = Array.from(sessions.values());

  if (type) {
    result = result.filter((s) => s.type === type);
  }
  if (state) {
    result = result.filter((s) => s.state === state);
  }

  res.json({ sessions: result, count: result.length });
});

/**
 * Update session state (pause, resume, terminate).
 */
app.patch('/api/v1/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const body = req.body as { state?: string; metadata?: Record<string, unknown> };
  const validTransitions: Record<string, string[]> = {
    creating: ['active', 'failed', 'terminated'],
    active: ['paused', 'completed', 'failed', 'terminated'],
    paused: ['active', 'terminated'],
    completed: [],
    failed: ['terminated'],
    terminated: [],
  };

  if (body.state) {
    const allowed = validTransitions[session.state] || [];
    if (!allowed.includes(body.state)) {
      res.status(400).json({
        error: `Invalid state transition from "${session.state}" to "${body.state}". Allowed: ${allowed.join(', ')}`,
      });
      return;
    }
    session.state = body.state as SessionDescriptor['state'];
  }

  if (body.metadata) {
    session.metadata = { ...session.metadata, ...body.metadata };
  }

  session.updatedAt = new Date().toISOString();

  logger.info('Session state updated', { sessionId: session.id, state: session.state });
  res.json(session);
});

/**
 * Delete/terminate a session.
 */
app.delete('/api/v1/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  session.state = 'terminated';
  session.updatedAt = new Date().toISOString();

  logger.info('Session terminated', { sessionId: session.id });
  res.json({ status: 'terminated', sessionId: session.id });
});

// ─── Realm management API ────────────────────────────────────────

/**
 * List all realms managed by Yggdrasil.
 */
app.get('/api/v1/realms', (_req, res) => {
  const realms = realmRegistry.listRealms();
  res.json({ realms, count: realms.length });
});

/**
 * Get a realm by ID.
 */
app.get('/api/v1/realms/:realmId', (req, res) => {
  const realm = realmRegistry.getRealm(req.params.realmId);
  if (!realm) {
    res.status(404).json({ error: 'Realm not found' });
    return;
  }
  res.json(realm);
});

/**
 * Update realm state and endpoints (called by runners when a realm becomes ready).
 */
app.patch('/api/v1/realms/:realmId', (req, res) => {
  const realm = realmRegistry.getRealm(req.params.realmId);
  if (!realm) {
    res.status(404).json({ error: 'Realm not found' });
    return;
  }

  const body = req.body as {
    state?: Realm['state'];
    endpoints?: Realm['endpoints'];
  };

  if (body.state) {
    realmRegistry.updateRealmState(realm.id, body.state);
  }

  if (body.endpoints) {
    realmProvisioner.updateRealmEndpoints(realm.id, body.state ?? realm.state, body.endpoints);
  }

  const updated = realmRegistry.getRealm(realm.id);
  res.json(updated);
});

/**
 * Destroy a realm.
 */
app.delete('/api/v1/realms/:realmId', async (req, res) => {
  const realm = realmRegistry.getRealm(req.params.realmId);
  if (!realm) {
    res.status(404).json({ error: 'Realm not found' });
    return;
  }

  await realmProvisioner.destroyRealm(realm.id);
  res.json({ status: 'destroyed', realmId: realm.id });
});

// ─── Realm lifecycle routes (relayed by Ratatoskr) ─────────────────

/**
 * Register a realm that has just come online.
 * Called by Ratatoskr on behalf of a Realm instance.
 */
app.post('/api/v1/realms/register', (req, res) => {
  const body = req.body as {
    realmId: string;
    runnerId: string;
    template: string;
    version?: string;
    capabilities?: string[];
    endpoints?: { observation: string; input: string };
    registrationToken?: string;
    startedAt?: string;
  };

  if (!body.realmId || !body.runnerId || !body.template) {
    res.status(400).json({ error: 'realmId, runnerId, and template are required' });
    return;
  }

  const registration: RealmRegistration = {
    realmId: body.realmId,
    runnerId: body.runnerId,
    template: body.template as RealmTemplateType,
    version: body.version ?? '0.1.0',
    capabilities: (body.capabilities ?? []) as SessionCapability[],
    endpoints: body.endpoints ?? { observation: '', input: '' },
    registrationToken: body.registrationToken,
    startedAt: body.startedAt ?? new Date().toISOString(),
  };

  const realm = realmLifecycle.registerRealm(registration, body.template as RealmTemplateType);
  res.status(201).json(realm);
});

/**
 * Heartbeat from a realm instance (relayed by Ratatoskr).
 */
app.post('/api/v1/realms/heartbeat', (req, res) => {
  const body = req.body as {
    realmId: string;
    uptime?: number;
    healthy?: boolean;
    memoryMb?: number;
    cpuPercent?: number;
    activeSessions?: number;
  };

  if (!body.realmId) {
    res.status(400).json({ error: 'realmId is required' });
    return;
  }

  const heartbeat: RealmHeartbeat = {
    realmId: body.realmId,
    uptime: body.uptime ?? 0,
    healthy: body.healthy ?? true,
    memoryMb: body.memoryMb,
    cpuPercent: body.cpuPercent,
    activeSessions: body.activeSessions ?? 0,
  };

  const realm = realmLifecycle.heartbeatRealm(heartbeat);
  if (!realm) {
    res.status(404).json({ error: 'Realm not found' });
    return;
  }

  res.json({ status: 'ok', realmId: realm.id, state: realm.state });
});

/**
 * Deregister a realm on shutdown (relayed by Ratatoskr).
 */
app.post('/api/v1/realms/deregister', (req, res) => {
  const body = req.body as {
    realmId: string;
    reason?: 'shutdown' | 'error' | 'replaced';
  };

  if (!body.realmId) {
    res.status(400).json({ error: 'realmId is required' });
    return;
  }

  const deregistration: RealmDeregistration = {
    realmId: body.realmId,
    reason: body.reason ?? 'shutdown',
  };

  realmLifecycle.deregisterRealm(deregistration);
  res.json({ status: 'deregistered', realmId: deregistration.realmId });
});

// ─── Lease-based offline detection ──────────────────────────────

const LEASE_TTL_MS = parseInt(process.env['LEASE_TTL_MS'] || '60000', 10);
let EXPECTED_RUNNER_VERSION = process.env['EXPECTED_RUNNER_VERSION'] || YGGDRASIL_VERSION;

// ─── Admin API authentication ────────────────────────────────
// Separate admin API key for privileged operations (key rotation, etc.)
const ADMIN_API_KEY = process.env['ADMIN_API_KEY'] || '';

function adminKeyAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!ADMIN_API_KEY) {
    next();
    return;
  }
  const apiKey = req.headers['x-admin-api-key'] as string | undefined;
  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing admin API key' });
    return;
  }
  next();
}

// ─── Admin API routes ───────────────────────────────────────
// These are mounted BEFORE the global auth middleware via early path check,
// and secured separately with adminKeyAuth.

/**
 * Rotate / add a new API key and optionally push it to selected Ratatoskr runners.
 *
 * POST /api/admin/api-keys/rotate
 * Body: {
 *   newApiKey: string;           // Required: the new API key to add
 *   runnerIds?: string[];        // Ratatoskrs to receive the new key (empty = none)
 * }
 *
 * - The new key is added to Yggdrasil's accepted list immediately.
 * - A pendingUpdate with apiKey is set for each selected runner so the
 *   next heartbeat response delivers the new key to Ratatoskr.
 * - If runnerIds is omitted or empty, NO Ratatoskrs receive the key
 *   (manual configuration required on each Ratatoskr).
 */
app.post('/api/admin/api-keys/rotate', adminKeyAuth, (req, res) => {
  const body = req.body as {
    newApiKey?: string;
    runnerIds?: string[];
  };

  if (!body.newApiKey || body.newApiKey.trim().length === 0) {
    res.status(400).json({ error: 'newApiKey is required and must be non-empty' });
    return;
  }

  const normalizedKey = body.newApiKey.trim();

  // 1. Add the key to Yggdrasil's accepted list if not already present
  if (!API_KEYS.includes(normalizedKey)) {
    API_KEYS.push(normalizedKey);
  }

  // 2. Determine which runners to notify
  const targetRunnerIds = body.runnerIds ?? [];
  const notified: string[] = [];
  const skipped: string[] = [];

  if (targetRunnerIds.length === 0) {
    // Default: no automatic distribution — manual config required on Ratatoskr
    logger.info('API key rotated with no target runners — manual configuration required on Ratatoskr instances', {
      newKeyPrefix: normalizedKey.substring(0, 8) + '…',
      totalKeys: API_KEYS.length,
    });

    res.json({
      status: 'rotated',
      newApiKeyPrefix: normalizedKey.substring(0, 8) + '…',
      totalActiveKeys: API_KEYS.length,
      notifiedRunners: [],
      skippedRunners: [],
      message: 'No Ratatoskr instances selected. Each instance must be configured manually.',
    });
    return;
  }

  // 3. Push the new key via pendingUpdate on each target runner's heartbeat
  for (const runnerId of targetRunnerIds) {
    const runner = runners.get(runnerId);
    if (!runner) {
      skipped.push(runnerId);
      continue;
    }

    runner.pendingUpdate = {
      version: runner.version,
      apiKey: normalizedKey,
    };
    notified.push(runnerId);
  }

  logger.info('API key rotated and pushed to selected Ratatoskr runners', {
    newKeyPrefix: normalizedKey.substring(0, 8) + '…',
    totalKeys: API_KEYS.length,
    notifiedCount: notified.length,
    skippedCount: skipped.length,
    notifiedRunners: notified,
    skippedRunners: skipped,
  });

  res.json({
    status: 'rotated',
    newApiKeyPrefix: normalizedKey.substring(0, 8) + '…',
    totalActiveKeys: API_KEYS.length,
    notifiedRunners: notified,
    skippedRunners: skipped,
  });
});

/**
 * Set the expected runner version that Yggdrasil considers current.
 * Outdated runners are exposed via the yggdrasil_runner_outdated metric.
 *
 * POST /api/admin/expected-version
 * Body: { version: string }
 *
 * This is useful for proactively notifying the operator (via Grafana alert)
 * that some Ratatoskr instances are running an older version.
 */
app.post('/api/admin/expected-version', adminKeyAuth, (req, res) => {
  const body = req.body as { version?: string };

  if (!body.version || body.version.trim().length === 0) {
    res.status(400).json({ error: 'version is required and must be non-empty' });
    return;
  }

  const previous = EXPECTED_RUNNER_VERSION;
  EXPECTED_RUNNER_VERSION = body.version.trim();

  logger.info('Expected runner version updated', {
    previous: previous || '(not set)',
    current: EXPECTED_RUNNER_VERSION,
  });

  res.json({
    status: 'updated',
    previous: previous || null,
    current: EXPECTED_RUNNER_VERSION,
  });
});

/**
 * List all registered runners with minimal details (for dashboard dropdowns / selection).
 *
 * GET /api/admin/runners
 */
app.get('/api/admin/runners', adminKeyAuth, (_req, res) => {
  const runnerList = Array.from(runners.entries()).map(([id, r]) => ({
    runnerId: id,
    name: r.name,
    version: r.version,
    status: r.status,
    lastHeartbeat: r.lastHeartbeat,
    outdated: EXPECTED_RUNNER_VERSION ? r.version !== EXPECTED_RUNNER_VERSION : false,
    hasPendingUpdate: !!r.pendingUpdate,
    hasPendingApiKey: !!r.pendingUpdate?.apiKey,
    updateStatus: r.updateStatus ?? 'idle',
    updateLog: r.updateLog ?? '',
  }));

  res.json({
    runners: runnerList,
    expectedVersion: EXPECTED_RUNNER_VERSION || null,
    count: runnerList.length,
  });
});

/**
 * Get the update log tail for a specific runner.
 * The log is reported by the runner via heartbeat, so it's always fresh.
 *
 * GET /api/admin/runners/:runnerId/update-log
 */
app.get('/api/admin/runners/:runnerId/update-log', adminKeyAuth, (req, res) => {
  const runnerId = req.params.runnerId;
  if (!runnerId) {
    res.status(400).json({ error: 'runnerId parameter is required' });
    return;
  }
  const runner = runners.get(runnerId);
  if (!runner) {
    res.status(404).json({ error: 'Runner not found' });
    return;
  }

  res.json({
    runnerId: runner.runnerId,
    name: runner.name,
    updateStatus: runner.updateStatus ?? 'idle',
    updateLog: runner.updateLog ?? '',
  });
});

/**
 * Request an update for one or more Ratatoskr runners.
 * The update is stored and delivered on the next heartbeat response.
 *
 * POST /api/admin/runners/request-update
 * Body: {
 *   runnerIds: string[];              // Ratatoskrs to update (ALL = all, [] = none)
 *   version: string;                  // Target version
 *   command?: string;                 // Update command
 *   downloadUrl?: string;             // Download URL for new binary
 * }
 *
 * - If runnerIds is ["ALL"], every registered runner gets the update.
 * - If runnerIds is [], no runners receive the update.
 * - Each selected runner gets a pendingUpdate set on its record,
 *   delivered on the next heartbeat.
 */
app.post('/api/admin/runners/request-update', adminKeyAuth, (req, res) => {
  const body = req.body as {
    runnerIds?: string[];
    version?: string;
    command?: string;
    downloadUrl?: string;
  };

  if (!body.version || body.version.trim().length === 0) {
    res.status(400).json({ error: 'version is required and must be non-empty' });
    return;
  }

  const targetVersion = body.version.trim();

  // Resolve runnerIds: "ALL" = every runner, [] = none
  const rawIds = body.runnerIds ?? [];
  const targetRunnerIds: string[] = rawIds.length === 1 && rawIds[0] === 'ALL'
    ? Array.from(runners.keys())
    : rawIds;

  const notified: string[] = [];
  const skipped: string[] = [];

  if (targetRunnerIds.length === 0) {
    logger.info('Version update requested with no target runners', {
      version: targetVersion,
    });
    res.json({
      status: 'version_set',
      expectedVersion: targetVersion,
      notifiedRunners: [],
      skippedRunners: [],
      message: 'No Ratatoskr instances selected. Use runnerIds: ["ALL"] or a list of runner IDs.',
    });
    return;
  }

  for (const runnerId of targetRunnerIds) {
    const runner = runners.get(runnerId);
    if (!runner) {
      skipped.push(runnerId);
      continue;
    }

    runner.pendingUpdate = {
      version: targetVersion,
      ...(body.command !== undefined ? { command: body.command } : {}),
      ...(body.downloadUrl !== undefined ? { downloadUrl: body.downloadUrl } : {}),
    };
    notified.push(runnerId);
  }

  logger.info('Version update requested for selected Ratatoskr runners', {
    version: targetVersion,
    notifiedCount: notified.length,
    skippedCount: skipped.length,
    notifiedRunners: notified,
    skippedRunners: skipped,
  });

  res.json({
    status: 'update_requested',
    version: targetVersion,
    notifiedRunners: notified,
    skippedRunners: skipped,
  });
});

/**
 * Self-update and restart Yggdrasil.
 *
 * POST /api/admin/self-update
 *
 * Behavior depends on the deployment method:
 *
 *   **npm (default):** Runs `npm update -g @theaiinc/yggdrasil` to fetch the
 *   latest version, then sends SIGTERM for the process manager to restart.
 *   Nothing happens if already on the latest version.
 *
 *   **Docker:** Does NOT run automatically (Docker-in-Docker is unsafe by
 *   default). Instead, the operator should define `DOCKER_UPDATE_COMMAND`
 *   env var (e.g. `docker compose pull && docker compose up -d -t 30`).
 *   If set, Yggdrasil shells out to that command.
 *
 * Safe to call even when already on the latest version — it's idempotent.
 */
app.post('/api/admin/self-update', adminKeyAuth, async (req, res) => {
  const npmInfo = npmVersionChecker.getInfo();
  const dockerUpdateCommand = process.env['DOCKER_UPDATE_COMMAND']?.trim();

  logger.info('Self-update requested via admin API', {
    npm: { current: npmInfo.current, latest: npmInfo.latest, hasNew: npmInfo.hasNewVersion },
    dockerUpdateCommand: dockerUpdateCommand ? 'configured' : 'not set',
  });

  // ── Docker path ──────────────────────────────────────────
  if (dockerUpdateCommand) {
    if (!npmInfo.latest) {
      res.json({
        status: 'update_skipped',
        reason: 'Could not determine latest npm version (check may still be in progress or npm unreachable). Try again in a few minutes.',
        currentVersion: npmInfo.current,
      });
      return;
    }

    res.json({
      status: 'update_started',
      currentVersion: npmInfo.current,
      latestVersion: npmInfo.latest,
      command: dockerUpdateCommand,
      message: `Executing "${dockerUpdateCommand}". Yggdrasil will be unavailable during the update. Check Docker logs for progress.`,
    });

    // Respond first, then execute the update command
    setTimeout(async () => {
      try {
        const { execSync } = await import('child_process');
        logger.info('Executing Docker update command', { command: dockerUpdateCommand });
        execSync(dockerUpdateCommand, { stdio: 'inherit', timeout: 120_000 });
        logger.info('Docker update command completed');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Docker update command failed', { error: message });
      }
    });
    return;
  }

  // ── npm path ─────────────────────────────────────────────
  // Check if we're already up to date
  if (npmInfo.latest && npmInfo.latest === npmInfo.current) {
    res.json({
      status: 'already_up_to_date',
      currentVersion: npmInfo.current,
      message: `Yggdrasil is already on version ${npmInfo.current}. No update needed.`,
    });
    return;
  }

  if (!npmInfo.latest) {
    // Try a fresh check now before giving up
    await npmVersionChecker.check();
    const freshInfo = npmVersionChecker.getInfo();

    if (!freshInfo.latest || freshInfo.latest === freshInfo.current) {
      res.json({
        status: 'update_skipped',
        reason: 'Could not determine latest npm version (check may still be in progress or npm unreachable). Try again in a few minutes.',
        currentVersion: freshInfo.current,
      });
      return;
    }
  }

  const targetVersion = npmVersionChecker.getInfo().latest!;

  logger.info('Running npm self-update', {
    from: npmInfo.current,
    to: targetVersion,
  });

  res.json({
    status: 'update_started',
    currentVersion: npmInfo.current,
    latestVersion: targetVersion,
    message: `Upgrading to ${targetVersion} via npm. Yggdrasil will restart once complete.`,
  });

  // Respond first, then run update + restart
  setTimeout(async () => {
    try {
      const { execSync } = await import('child_process');
      execSync('npm update -g @theaiinc/yggdrasil', { stdio: 'inherit', timeout: 120_000 });
      logger.info('npm update completed — restarting Yggdrasil', { newVersion: targetVersion });

      // Give the log a moment to flush, then restart
      setTimeout(() => {
        process.kill(process.pid, 'SIGTERM');
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('npm self-update failed', { error: message });
    }
  }, 500);
});

if (typeof process.env.VITEST === 'undefined') {
  // Start npm version checker (poll every 30 minutes)
  npmVersionChecker.start();
  // Runner lease TTL check
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

  // Realm stale detection
  realmLifecycle.startStaleDetection();
}

// ─── Start server ───────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] || '3000', 10);

// In test mode (vitest), export app/runners without starting the server
if (typeof process.env.VITEST === 'undefined') {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('Orchestration controller started (runner-only mode via Ratatoskr)', {
      port: PORT,
      environment: process.env['NODE_ENV'] || 'development',
      version: YGGDRASIL_VERSION,
      apiKeysConfigured: API_KEYS.length > 0,
      adminApiKeyConfigured: ADMIN_API_KEY.length > 0,
      leaseTtlMs: LEASE_TTL_MS,
    });
  });
}

export { app, runners, sessions, realmRegistry, realmScheduler, realmProvisioner, realmLifecycle, npmVersionChecker, YGGDRASIL_VERSION };

