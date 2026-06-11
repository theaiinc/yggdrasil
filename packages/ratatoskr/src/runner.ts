#!/usr/bin/env node

/**
 * Ratatoskr runner entrypoint.
 *
 * Starts the Ratatoskr daemon to register and heartbeat with Yggdrasil.
 * Capabilities ARE presets — each name in CAPABILITIES is looked up as a
 * preset. Known presets resolve their transitive deps and load handlers
 * automatically. Unknown names pass through as raw capabilities.
 *
 * Env:
 *   YGGDRASIL_URL         — Yggdrasil server URL
 *   API_KEY                — API key for Yggdrasil auth
 *   RUNNER_NAME            — Human-readable runner name
 *   CAPABILITIES           — Comma-separated preset/capability names
 *                            e.g. 'agent'    → agent + llm + shell + web_search
 *                            e.g. 'llm,shell' → llm, shell
 *                            e.g. 'agent,code' → agent + llm + shell + web_search, code
 *   TASK_POLL_INTERVAL     — Task poll interval in seconds (default: 10)
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

const ratatoskr = new Ratatoskr({
  yggdrasilUrl,
  ...(apiKey ? { apiKey } : {}),
  name: runnerName,
  capabilities,
  heartbeatInterval: 15,
  leaseTtl: 45,
  taskPollInterval,
  detectLocalIp: true,
  detectPublicIp: false,
});

ratatoskr.start()
  .then(() => {
    const state = ratatoskr.getState();
    console.log(`[Ratatoskr] Started — runner: ${state.runnerId}, yggdrasil: ${yggdrasilUrl}, capabilities: ${capabilities.join(', ')}`);
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
