#!/usr/bin/env node

/**
 * Demo: Running tasks on a Yggdrasil runner.
 *
 * This script:
 *   1. Starts Yggdrasil (orchestration controller)
 *   2. Starts Ratatoskr with the TaskExecutor (polling for tasks)
 *   3. Submits several tasks of different types:
 *      - `echo` – echos back the input metadata
 *      - `exec` – runs a shell command on the runner
 *      - `http` – makes an HTTP request from the runner
 *   4. Polls for completion and shows results
 *   5. Cleans up
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Simple nanoid-like ID generator (no external deps)
function nanoid(size = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = randomBytes(size);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
const PROJECT_ROOT = resolve(__dirname, '..');

// ─── Load .env ──────────────────────────────────────────────────────────
const envPath = resolve(PROJECT_ROOT, '.env');
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

const PORT = 4200;
const YGG_URL = `http://localhost:${PORT}`;
const API_KEY = parsedEnv['YGGDRASIL_API_KEY'] || 'demo-key-abc-123';

// ─── Utilities ──────────────────────────────────────────────────────────

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

function waitForServer(url, timeoutMs = 20000) {
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
          setTimeout(poll, 500);
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
    const lines = d.toString().trimEnd();
    if (lines) process.stdout.write(`  [${label}] ${lines}\n`);
  });
  proc.stderr.on('data', (d) => {
    const lines = d.toString().trimEnd();
    if (lines) process.stderr.write(`  [${label}:err] ${lines}\n`);
  });

  return proc;
}

function createTask(runnerId, type, metadata = {}, correlationId) {
  const body = { type, metadata, status: 'running' };
  if (correlationId) body.correlationId = correlationId;
  return fetchJson(`${YGG_URL}/runners/${runnerId}/tasks`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body,
  });
}

function pollTask(runnerId, taskId, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      const res = await fetchJson(`${YGG_URL}/runners/${runnerId}/tasks`, {
        headers: { 'X-API-Key': API_KEY },
      });
      const tasks = res.body.tasks || [];
      const task = tasks.find(t => t.taskId === taskId);
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        resolve(task);
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`));
      } else {
        setTimeout(poll, 1000);
      }
    };
    poll();
  });
}

// ─── Main Demo ──────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Yggdrasil Demo: Run Anything on the Runner               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Start Yggdrasil ─────────────────────────────────────────────
  console.log('1. Starting Yggdrasil orchestration controller...');
  const ygg = spawnProcess('node', [
    'packages/yggdrasil/dist/src/orchestration-controller.js',
  ], {
    PORT: String(PORT),
    API_KEYS: API_KEY,
    LEASE_TTL_MS: '60000',
    LOG_LEVEL: 'warn',
  }, 'Yggdrasil', PROJECT_ROOT);

  try {
    await waitForServer(`${YGG_URL}/health`, 15000);
    console.log('   ✅ Yggdrasil is running\n');
  } catch (e) {
    console.error(`   ❌ Failed to start Yggdrasil: ${e.message}`);
    ygg.kill();
    process.exit(1);
  }

  // ── 2. Start Ratatoskr with task execution ─────────────────────────
  console.log('2. Starting Ratatoskr with TaskExecutor...');
  const ratatoskr = spawnProcess('node', [
    'packages/ratatoskr/dist/src/runner.js',
  ], {
    YGGDRASIL_URL: YGG_URL,
    API_KEY: API_KEY,
    RUNNER_NAME: 'demo-runner',
    CAPABILITIES: 'http,health,demo',
    TASK_POLL_INTERVAL: '3',     // poll every 3 seconds
    NODE_ENV: 'development',
  }, 'Ratatoskr', PROJECT_ROOT);

  // Wait for registration
  await sleep(5000);

  // Get the runner ID
  const runnersRes = await fetchJson(`${YGG_URL}/api/runners`, {
    headers: { 'X-API-Key': API_KEY },
  });
  const runnerId = runnersRes.body.runners?.[0]?.runnerId;
  const runnerName = runnersRes.body.runners?.[0]?.name;
  console.log(`   Runner: "${runnerName}" (${runnerId})`);
  console.log(`   Status: ${runnersRes.body.runners?.[0]?.status}\n`);

  // ── 3. Submit demo tasks ───────────────────────────────────────────
  console.log('3. Submitting demo tasks...\n');

  // Task 1: Echo — the simplest, just reflects metadata
  console.log('   ── Task 1: echo (reflect metadata) ──');
  const corr1 = `demo-${nanoid()}`;
  const task1 = await createTask(runnerId, 'echo', {
    message: 'Hello from the demo!',
    timestamp: Date.now(),
  }, corr1);
  console.log(`      Created:      ${task1.body.taskId}`);
  console.log(`      Correlation:  ${corr1}`);
  const result1 = await pollTask(runnerId, task1.body.taskId);
  console.log(`      Status:       ${result1.status}`);
  console.log(`      Output:       ${JSON.stringify(result1.metadata?.output, null, 6)}`);

  // Task 2: Exec — run a shell command on the runner
  console.log('\n   ── Task 2: exec (shell command) ──');
  const corr2 = `deploy-${nanoid()}`;
  const task2 = await createTask(runnerId, 'exec', {
    command: 'echo "Hello from the runner!" && uname -a && date',
    timeout: 10000,
  }, corr2);
  console.log(`      Created:      ${task2.body.taskId}`);
  console.log(`      Correlation:  ${corr2}`);
  const result2 = await pollTask(runnerId, task2.body.taskId);
  console.log(`      Status:       ${result2.status}`);
  if (result2.status === 'completed') {
    console.log(`      STDOUT:\n${result2.metadata.stdout}`);
  } else {
    console.log(`      Error:        ${result2.metadata?.stderr || result2.metadata?.error}`);
  }

  // Task 3: Exec — run a slightly more interesting command
  console.log('   ── Task 3: exec (system info) ──');
  const corr3 = `diagnose-${nanoid()}`;
  const task3 = await createTask(runnerId, 'exec', {
    command: 'node -e "console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, memory: process.memoryUsage(), cpus: require(\'os\').cpus().length}))"',
    timeout: 10000,
  }, corr3);
  console.log(`      Created:      ${task3.body.taskId}`);
  console.log(`      Correlation:  ${corr3}`);
  const result3 = await pollTask(runnerId, task3.body.taskId);
  console.log(`      Status:       ${result3.status}`);
  if (result3.status === 'completed') {
    try {
      const parsed = JSON.parse(result3.metadata.stdout.trim());
      console.log(`      Node:    ${parsed.node}`);
      console.log(`      Platform: ${parsed.platform} (${parsed.arch})`);
      console.log(`      CPUs:    ${parsed.cpus}`);
      console.log(`      Memory:  ${JSON.stringify(parsed.memory)}`);
    } catch {
      console.log(`      STDOUT:\n${result3.metadata.stdout}`);
    }
  }

  // Task 4: Http — fetch from a public API via the runner
  console.log('   ── Task 4: http (fetch from runner) ──');
  const corr4 = `webhook-${nanoid()}`;
  const task4 = await createTask(runnerId, 'http', {
    url: 'https://httpbin.org/get',
    method: 'GET',
  }, corr4);
  console.log(`      Created:      ${task4.body.taskId}`);
  console.log(`      Correlation:  ${corr4}`);
  const result4 = await pollTask(runnerId, task4.body.taskId);
  console.log(`      Status:       ${result4.status}`);
  if (result4.status === 'completed') {
    console.log(`      HTTP ${result4.metadata.statusCode} from ${result4.metadata.url}`);
    try {
      const parsed = JSON.parse(result4.metadata.body);
      console.log(`      Origin:  ${parsed.origin}`);
    } catch {}
  }

  // ── 4. Show final runner state ─────────────────────────────────────
  console.log('\n4. Final runner state:');
  const finalRunners = await fetchJson(`${YGG_URL}/api/runners`, {
    headers: { 'X-API-Key': API_KEY },
  });
  const runner = finalRunners.body.runners?.[0];
  if (runner) {
    console.log(`   Name:      ${runner.name}`);
    console.log(`   Status:    ${runner.status}`);
    console.log(`   Tasks:     ${runner.tasks.length} total`);
    for (const t of runner.tasks) {
      const icon = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⏳';
      console.log(`     ${icon} ${t.type}:${t.taskId.slice(0, 12)}… → ${t.status}`);
    }
    if (runner.resources) {
      console.log(`   CPU:       ${runner.resources.cpu.percent.toFixed(1)}%`);
      console.log(`   Memory:    ${runner.resources.memory.percent.toFixed(1)}%`);
      console.log(`   Uptime:    ${Math.round(runner.resources.uptime)}s`);
    }
  }

  // ── 5. Show health endpoint ────────────────────────────────────────
  console.log('\n5. Server health:');
  const health = await fetchJson(`${YGG_URL}/health`);
  console.log(`   Status:  ${health.body.status}`);
  console.log(`   Version: ${health.body.version}`);
  console.log(`   Runners: ${health.body.runners.online} online, ${health.body.runners.offline} offline, ${health.body.runners.total} total`);

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Demo Complete!                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\nWhat just happened:');
  console.log('  1. Yggdrasil orchestration server started on port 4200');
  console.log('  2. Ratatoskr daemon connected from the runner machine');
  console.log('  3. The TaskExecutor inside Ratatoskr polled for tasks every 3s');
  console.log('  4. Four tasks were submitted via the POST /runners/:id/tasks API');
  console.log('  5. Ratatoskr picked them up, executed them, and reported results');
  console.log('\nThe runner can execute ANYTHING — shell commands, HTTP requests,');
  console.log('or custom handlers you write. Add new task types by implementing');
  console.log('a TaskHandler function and passing it via taskHandlers config.\n');

  // ── Cleanup ─────────────────────────────────────────────────────────
  console.log('Cleaning up...');
  ratatoskr.kill('SIGTERM');
  await sleep(2000);
  ygg.kill();
  await sleep(500);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
