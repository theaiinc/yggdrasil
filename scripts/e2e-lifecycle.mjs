#!/usr/bin/env node

/**
 * Real-world E2E test: Yggdrasil + Ratatoskr lifecycle.
 *
 * Scenario:
 *   1. Start Yggdrasil, verify /health shows 0 runners
 *   2. Start Ratatoskr, verify it registers on Yggdrasil
 *   3. Verify heartbeat updates lastHeartbeat
 *   4. Verify resources (CPU, memory) arrive with heartbeat
 *   5. Test tasks CRUD endpoints
 *   6. Kill Ratatoskr (simulate crash), verify lease expiry marks it offline
 *   7. Verify auth is enforced
 *   8. Cleanup
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if present (no external dep needed)
const envPath = resolve(__dirname, '..', '.env');
const parsedEnv = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    parsedEnv[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

const PORT = 4100;
const YGG_URL = `http://localhost:${PORT}`;
const API_KEY = parsedEnv['YGGDRASIL_API_KEY'] || 'test-e2e-key-abc';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const u = new URL(url);
      const req = http.get(u, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server not ready within ${timeoutMs}ms`));
        } else {
          setTimeout(poll, 300);
        }
      });
      req.end();
    };
    poll();
  });
}

function spawnProcess(cmd, args, env, label, cwd) {
  const proc = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
    env: { ...process.env, ...env },
  });

  proc.stdout.on('data', (d) => {
    process.stdout.write(`[${label}] ${d}`);
  });
  proc.stderr.on('data', (d) => {
    process.stderr.write(`[${label}] ${d}`);
  });

  return proc;
}

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} — ${detail || 'assertion failed'}`);
    failed++;
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  E2E Test: Yggdrasil + Ratatoskr Full Lifecycle');
  console.log('══════════════════════════════════════════════════════\n');

  // ── 1. Start Yggdrasil ──────────────────────────────────────────
  console.log('1. Starting Yggdrasil orchestration controller...');
  const ygg = spawnProcess('node', [
    'dist/src/orchestration-controller.js',
  ], {
    PORT: String(PORT),
    API_KEYS: API_KEY,
    LEASE_TTL_MS: '30000',
    LOG_LEVEL: 'warn',
  }, 'Yggdrasil', 'packages/yggdrasil');

  try {
    await waitForServer(`${YGG_URL}/health`, 15000);
  } catch (e) {
    console.log(`  ❌ Yggdrasil failed to start: ${e.message}`);
    ygg.kill();
    process.exit(1);
  }
  console.log('  ✅ Yggdrasil is running\n');

  // ── 2. Verify /health shows 0 runners ──────────────────────────
  console.log('2. Checking /health — expecting 0 runners...');
  const health1 = await fetchJson(`${YGG_URL}/health`);
  assert('health endpoint returns 200', health1.status === 200);
  assert('runners.total === 0', health1.body.runners?.total === 0,
    `got ${health1.body.runners?.total}`);
  assert('runners.online === 0', health1.body.runners?.online === 0,
    `got ${health1.body.runners?.online}`);

  // ── 3. Start Ratatoskr ──────────────────────────────────────────
  console.log('\n3. Starting Ratatoskr daemon...');
  const ratatoskr = spawnProcess('node', [
    'dist/src/runner.js',
  ], {
    YGGDRASIL_URL: YGG_URL,
    API_KEY: API_KEY,
    RUNNER_NAME: 'e2e-test-runner',
    CAPABILITIES: 'http,health,test',
    NODE_ENV: 'development',
  }, 'Ratatoskr', 'packages/ratatoskr');

  // Give Ratatoskr time to register (it sends register, then begins heartbeats)
  await sleep(5000);

  // ── 4. Verify Ratatoskr registered ──────────────────────────────
  console.log('\n4. Checking /api/runners — expecting 1 online runner...');
  const runners1 = await fetchJson(`${YGG_URL}/api/runners`, {
    headers: { 'X-API-Key': API_KEY },
  });

  assert('runners count === 1', runners1.body.count === 1,
    `got count=${runners1.body.count}`);
  assert('runner status is "online"', runners1.body.runners?.[0]?.status === 'online',
    `got status=${runners1.body.runners?.[0]?.status}`);
  assert('runner name matches', runners1.body.runners?.[0]?.name === 'e2e-test-runner',
    `got name=${runners1.body.runners?.[0]?.name}`);

  const runnerId = runners1.body.runners?.[0]?.runnerId;
  const firstHeartbeat = new Date(runners1.body.runners?.[0]?.lastHeartbeat).getTime();
  console.log(`    Runner ID: ${runnerId}`);
  console.log(`    First heartbeat: ${new Date(firstHeartbeat).toISOString()}`);

  // ── 5. Wait for next heartbeat, verify timestamp & resources ────
  console.log('\n5. Waiting for heartbeat cycle (18s)...');
  await sleep(18000);

  const runners2 = await fetchJson(`${YGG_URL}/api/runners`, {
    headers: { 'X-API-Key': API_KEY },
  });
  const runner2 = runners2.body.runners?.[0];
  const secondHeartbeat = new Date(runner2.lastHeartbeat).getTime();
  assert('runner still online', runner2.status === 'online');
  assert('heartbeat timestamp advanced', secondHeartbeat > firstHeartbeat,
    `first=${firstHeartbeat}, second=${secondHeartbeat}`);
  assert('resources are present', runner2.resources && typeof runner2.resources === 'object',
    `got ${JSON.stringify(runner2.resources)}`);
  assert('cpu percent is a number', typeof runner2.resources?.cpu?.percent === 'number',
    `got ${typeof runner2.resources?.cpu?.percent}`);
  assert('memory percent is a number', typeof runner2.resources?.memory?.percent === 'number',
    `got ${typeof runner2.resources?.memory?.percent}`);
  assert('memory total > 0', runner2.resources?.memory?.total > 0,
    `got ${runner2.resources?.memory?.total}`);
  assert('cpu cpus > 0', runner2.resources?.cpu?.cpus > 0,
    `got ${runner2.resources?.cpu?.cpus}`);
  assert('uptime is a number', typeof runner2.resources?.uptime === 'number',
    `got ${typeof runner2.resources?.uptime}`);

  console.log(`    CPU: ${runner2.resources?.cpu?.percent}% (${runner2.resources?.cpu?.cpus} cores)`);
  console.log(`    Memory: ${Math.round(runner2.resources?.memory?.used / 1024 / 1024)}MB / ${Math.round(runner2.resources?.memory?.total / 1024 / 1024)}MB (${runner2.resources?.memory?.percent}%)`);

  // ── 6. Test task CRUD endpoints ─────────────────────────────────
  console.log('\n6. Testing tasks CRUD...');

  // Create a task
  const createdTask = await fetchJson(`${YGG_URL}/runners/${runnerId}/tasks`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: {
      taskId: 'test-task-1',
      type: 'inference',
      status: 'running',
      metadata: { model: 'gpt-4', input: 'hello' },
    },
  });
  assert('create task returns 201', createdTask.status === 201,
    `got ${createdTask.status}`);
  assert('task has correct taskId', createdTask.body.taskId === 'test-task-1');
  assert('task type is inference', createdTask.body.type === 'inference');
  assert('task status is running', createdTask.body.status === 'running');

  console.log(`    Created task: ${createdTask.body.taskId} (${createdTask.body.type})`);

  // Update task to completed
  const updatedTask = await fetchJson(`${YGG_URL}/runners/${runnerId}/tasks/test-task-1`, {
    method: 'PATCH',
    headers: { 'X-API-Key': API_KEY },
    body: { status: 'completed', metadata: { output: 'done', tokens: 150 } },
  });
  assert('update task returns 200', updatedTask.status === 200,
    `got ${updatedTask.status}`);
  assert('task status is completed', updatedTask.body.status === 'completed');
  assert('task has completedAt', typeof updatedTask.body.completedAt === 'number',
    `got ${typeof updatedTask.body.completedAt}`);
  assert('task output metadata merged', updatedTask.body.metadata?.output === 'done');

  // List tasks
  const tasksList = await fetchJson(`${YGG_URL}/runners/${runnerId}/tasks`, {
    headers: { 'X-API-Key': API_KEY },
  });
  assert('list tasks returns 200', tasksList.status === 200);
  assert('tasks count === 1', tasksList.body.count === 1);
  assert('task shows in list', tasksList.body.tasks?.[0]?.taskId === 'test-task-1');

  // Create a running task to verify running tasks metric later
  await fetchJson(`${YGG_URL}/runners/${runnerId}/tasks`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: { taskId: 'test-task-2', type: 'api-call', status: 'running' },
  });

  // ── 7. Check resource metrics on /metrics ───────────────────────
  console.log('\n7. Checking resource Prometheus metrics...');
  const metricsResp = await fetchJson(`${YGG_URL}/metrics`);
  const metricsText = metricsResp.body;
  assert('/metrics returns 200', metricsResp.status === 200);

  const hasCpuMetric = metricsText.includes('yggdrasil_runner_cpu_percent');
  const hasMemMetric = metricsText.includes('yggdrasil_runner_memory_percent');
  const hasMemUsedMetric = metricsText.includes('yggdrasil_runner_memory_used_bytes');
  const hasTasksRunningMetric = metricsText.includes('yggdrasil_tasks_running');
  assert('yggdrasil_runner_cpu_percent present', hasCpuMetric);
  assert('yggdrasil_runner_memory_percent present', hasMemMetric);
  assert('yggdrasil_runner_memory_used_bytes present', hasMemUsedMetric);
  assert('yggdrasil_tasks_running present', hasTasksRunningMetric);

  // Verify tasks_running is correct (1 running task)
  const taskRunningLine = metricsText.split('\n').find(l => l.startsWith('yggdrasil_tasks_running '));
  const taskRunningValue = taskRunningLine ? parseInt(taskRunningLine.split(' ')[1], 10) : -1;
  assert('tasks_running == 1', taskRunningValue === 1,
    `got ${taskRunningValue}`);

  // ── 8. Kill Ratatoskr, verify lease expiry ──────────────────────
  console.log('\n8. Killing Ratatoskr (simulating runner crash)...');
  ratatoskr.kill('SIGTERM');

  console.log('    Waiting for lease expiry (35s)...');
  await sleep(35000);

  const runners3 = await fetchJson(`${YGG_URL}/api/runners`, {
    headers: { 'X-API-Key': API_KEY },
  });
  assert('runner count still 1 (offline, not removed)', runners3.body.count === 1);
  assert('runner status is "offline"', runners3.body.runners?.[0]?.status === 'offline',
    `got status=${runners3.body.runners?.[0]?.status}`);

  // ── 9. Verify /health now reflects offline ──────────────────────
  console.log('\n9. Final /health check...');
  const health2 = await fetchJson(`${YGG_URL}/health`);
  assert('runners.total === 1', health2.body.runners?.total === 1);
  assert('runners.online === 0', health2.body.runners?.online === 0);
  assert('runners.offline === 1', health2.body.runners?.offline === 1);

  // ── 10. Auth test ────────────────────────────────────────────────
  console.log('\n10. Verifying auth is enforced...');
  const noAuth = await fetchJson(`${YGG_URL}/api/runners`);
  assert('requests without API key return 401', noAuth.status === 401,
    `got ${noAuth.status}`);

  const badAuth = await fetchJson(`${YGG_URL}/api/runners`, {
    headers: { 'X-API-Key': 'wrong-key' },
  });
  assert('requests with bad API key return 401', badAuth.status === 401,
    `got ${badAuth.status}`);

  // health and metrics should be accessible without auth
  const healthPublic = await fetchJson(`${YGG_URL}/health`);
  assert('/health is public (no auth required)', healthPublic.status === 200,
    `got ${healthPublic.status}`);

  const metricsPublic = await fetchJson(`${YGG_URL}/metrics`);
  assert('/metrics is public (no auth required)', metricsPublic.status === 200,
    `got ${metricsPublic.status}`);

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');

  ygg.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
