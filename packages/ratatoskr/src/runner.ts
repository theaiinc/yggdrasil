#!/usr/bin/env node

/**
 * Ratatoskr runner entrypoint.
 *
 * Starts the Ratatoskr daemon to register and heartbeat with Yggdrasil.
 */
import { Ratatoskr } from './index.js';

const yggdrasilUrl = process.env['YGGDRASIL_URL'] || 'http://orchestration-controller:3000';
const apiKey = process.env['API_KEY'] || '';
const runnerName = process.env['RUNNER_NAME'] || `ratatoskr-${process.env['HOSTNAME'] || 'unknown'}`;
const capabilities = (process.env['CAPABILITIES'] || 'http,health')
  .split(',')
  .map(c => c.trim())
  .filter(c => c !== '');

const taskPollInterval = parseInt(process.env['TASK_POLL_INTERVAL'] || '10', 10);
const taskTypes = (process.env['TASK_TYPES'] || '')
  .split(',')
  .map(t => t.trim())
  .filter(t => t !== '');

const ratatoskr = new Ratatoskr({
  yggdrasilUrl,
  ...(apiKey ? { apiKey } : {}),
  name: runnerName,
  capabilities: [...capabilities, ...(taskTypes.length > 0 ? ['task-executor'] : [])],
  heartbeatInterval: 15,
  leaseTtl: 45,
  taskPollInterval,
  detectLocalIp: true,
  detectPublicIp: false,
});

ratatoskr.start()
  .then(() => {
    const extra = taskTypes.length > 0 ? `, task types: ${taskTypes.join(', ')}` : '';
    console.log(`[Ratatoskr] Started — runner: ${ratatoskr.getState().runnerId}, yggdrasil: ${yggdrasilUrl}${extra}`);
  })
  .catch((err) => {
    console.error('[Ratatoskr] Failed to start:', err);
    process.exit(1);
  });

// Keep the process alive
process.on('SIGTERM', async () => {
  console.log('[Ratatoskr] Shutting down...');
  await ratatoskr.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Ratatoskr] Shutting down...');
  await ratatoskr.stop();
  process.exit(0);
});
