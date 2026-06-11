import { nanoid } from 'nanoid';

import type {
  RatatoskrConfig,
  RatatoskrState,
  HealthResult,
  TaskHandler,
} from './types/index.js';
import { RunnerHealth } from './types/index.js';
import { HttpTransport } from './transports/http-transport.js';
import type { Transport } from './transports/transport.js';
import { EndpointDetector } from './services/endpoint-detector.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HeartbeatSender } from './services/heartbeat-sender.js';
import { LeaseManager } from './services/lease-manager.js';
import { Registrar } from './services/registrar.js';
import { ResourceCollector } from './services/resource-collector.js';
import { RetryManager } from './services/retry-manager.js';
import { TaskExecutor } from './services/task-executor.js';
import { UpdateManager } from './services/update-manager.js';

// ── Preset resolution ───────────────────────────────────────────────────────

import type { CombinedPreset } from './presets/index.js';
import { applyPresetDefaults } from './presets/apply.js';
import { resolveCapabilities } from './presets/resolve.js';

interface HandlerPathInfo {
  module: string;
  export: string;
}

/**
 * Ratatoskr — Lightweight discovery and heartbeat daemon.
 *
 * Runs alongside an agent runner and continuously informs Yggdrasil about
 * runner availability, network endpoints, capabilities, health status,
 * IP changes, and shutdown events.
 */
export class Ratatoskr {
  private readonly config: Required<RatatoskrConfig>;
  private readonly state: RatatoskrState;
  private readonly transport: Transport;
  private readonly endpointDetector: EndpointDetector;
  private readonly healthMonitor: HealthMonitor;
  private readonly leaseManager: LeaseManager;
  private readonly retryManager: RetryManager;
  private readonly registrar: Registrar;
  private readonly heartbeatSender: HeartbeatSender;
  private readonly resourceCollector: ResourceCollector;
  private readonly taskExecutor: TaskExecutor | undefined;
  private readonly handlerPaths: Record<string, HandlerPathInfo>;
  private readonly combinedPreset: CombinedPreset;
  private readonly updateManager: UpdateManager;
  private endpointCheckTimer: ReturnType<typeof setInterval> | undefined;
  private leaseCheckTimer: ReturnType<typeof setInterval> | undefined;
  private shutdownHandlers: (() => void)[] = [];
  private started: boolean = false;

  constructor(config: RatatoskrConfig) {
    // Resolve capabilities (presets) — capabilities ARE the presets
    const rawCaps = config.capabilities ?? [];
    const { capabilities, handlerPaths, combined } = resolveCapabilities(rawCaps);
    this.handlerPaths = handlerPaths;
    this.combinedPreset = combined;
    const configWithCaps = { ...config, capabilities };

    this.config = this.resolveConfig(configWithCaps);
    this.state = this.initializeState();

    this.transport = new HttpTransport(
      this.config.yggdrasilUrl,
      this.config.apiKey,
    );
    this.endpointDetector = new EndpointDetector(
      8080,
      this.config.detectPublicIp,
    );
    this.healthMonitor = new HealthMonitor();

    if (config.healthProvider) {
      this.healthMonitor.setHealthProvider(config.healthProvider);
    }

    this.resourceCollector = new ResourceCollector();
    this.leaseManager = new LeaseManager(this.config.leaseTtl);
    this.retryManager = new RetryManager();

    this.registrar = new Registrar(
      this.transport,
      this.endpointDetector,
      this.retryManager,
      this.leaseManager,
      this.resourceCollector,
      this.state.runnerId,
      this.state.runnerName,
      this.config.capabilities,
      this.config.labels,
      this.config.metadata,
    );

    this.heartbeatSender = new HeartbeatSender(
      this.transport,
      this.healthMonitor,
      this.retryManager,
      this.resourceCollector,
      this.state.runnerId,
      this.config.heartbeatInterval,
    );

    // Initialize UpdateManager — waits for running tasks to finish
    // before applying a Yggdrasil-requested update.
    this.updateManager = new UpdateManager(() => {
      return this.taskExecutor ? this.taskExecutor.runningCount() : 0;
    });

    // Wire heartbeat response callback: Yggdrasil can signal pending updates
    this.heartbeatSender.setOnUpdateRequested((update) => {
      this.updateManager.requestUpdate(update);
    });

    // Initialize TaskExecutor without preset handlers initially;
    // handler loading happens in start() via dynamic import
    if (this.config.taskPollInterval > 0) {
      this.taskExecutor = new TaskExecutor(this.transport, {
        runnerId: this.state.runnerId,
        pollInterval: this.config.taskPollInterval,
        handlers: this.config.taskHandlers,
      });
    } else {
      this.taskExecutor = undefined;
    }
  }

  /**
   * Start the Ratatoskr daemon.
   *
   * 1. Load preset handlers via dynamic import
   * 2. Registers the runner with Yggdrasil
   * 3. Begins sending heartbeats
   * 4. Monitors for IP changes
   * 5. Monitors lease expiry for re-registration
   * 6. Registers shutdown handlers for graceful deregistration
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 0. Apply preset env defaults, then load preset handlers
    applyPresetDefaults(this.combinedPreset);

    // 1. Load preset handlers (async ESM imports)
    await this.loadPresetHandlers();

    if (this.config.endpointProvider) {
      const customEndpoint = await this.config.endpointProvider();
      this.endpointDetector.setEndpoint(customEndpoint);
    }

    // 2. Register with Yggdrasil
    await this.registrar.register();

    // 3. Start heartbeats
    this.heartbeatSender.start();

    // 4. Monitor IP changes
    this.endpointCheckTimer = setInterval(() => {
      this.checkEndpoint();
    }, 10_000);

    // 5. Monitor lease expiry
    this.leaseCheckTimer = setInterval(() => {
      this.registrar.renewIfNeeded();
    }, 5_000);

    // 6. Start task execution polling (if enabled)
    if (this.taskExecutor) {
      this.taskExecutor.start();
    }

    // 7. Register shutdown handlers
    this.registerShutdownHandlers();
  }

  /**
   * Load preset handlers via dynamic ESM import and register them
   * with the TaskExecutor.
   */
  private async loadPresetHandlers(): Promise<void> {
    if (!this.taskExecutor) return;
    for (const [type, info] of Object.entries(this.handlerPaths)) {
      if (this.config.taskHandlers[type]) continue; // custom override wins
      try {
        const mod = await import(info.module);
        const fn = mod[info.export] as TaskHandler | undefined;
        if (fn) {
          this.taskExecutor.addHandler(type, fn);
          console.log(`[Ratatoskr] Loaded preset handler "${type}" from ${info.module} (export: ${info.export})`);
        }
      } catch (err: unknown) {
        console.warn(`[Ratatoskr] Failed to load handler "${type}" from ${info.module}:`, (err as Error).message);
      }
    }
  }

  /**
   * Stop the Ratatoskr daemon and deregister from Yggdrasil.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    // Stop periodic checks
    if (this.endpointCheckTimer !== undefined) {
      clearInterval(this.endpointCheckTimer);
      this.endpointCheckTimer = undefined;
    }

    if (this.leaseCheckTimer !== undefined) {
      clearInterval(this.leaseCheckTimer);
      this.leaseCheckTimer = undefined;
    }

    // Stop heartbeats
    this.heartbeatSender.stop();

    // Stop task execution
    if (this.taskExecutor) {
      this.taskExecutor.stop();
    }

    // Deregister from Yggdrasil
    await this.registrar.deregister();
  }

  /**
   * Set a custom health provider.
   */
  setHealthProvider(provider: () => Promise<HealthResult>): void {
    this.healthMonitor.setHealthProvider(provider);
  }

  /**
   * Returns the current runner state.
   */
  getState(): Readonly<RatatoskrState> {
    return { ...this.state };
  }

  /**
   * Returns whether the daemon is currently running.
   */
  isRunning(): boolean {
    return this.started;
  }

  /**
   * Returns whether the runner is registered with Yggdrasil.
   */
  isRegistered(): boolean {
    return this.registrar.isRegistered();
  }

  /**
   * Check for endpoint changes and notify Yggdrasil if detected.
   */
  private async checkEndpoint(): Promise<void> {
    const update = await this.endpointDetector.detect();
    if (update !== null) {
      await this.registrar.updateEndpoint(update);
    }
  }

  /**
   * Register handlers for SIGTERM and SIGINT.
   */
  private registerShutdownHandlers(): void {
    const handler = async (): Promise<void> => {
      await this.stop();
    };

    process.on('SIGTERM', handler);
    process.on('SIGINT', handler);

    this.shutdownHandlers.push(() => {
      process.removeListener('SIGTERM', handler);
      process.removeListener('SIGINT', handler);
    });
  }

  /**
   * Resolve the provided config with defaults.
   */
  private resolveConfig(config: RatatoskrConfig): Required<RatatoskrConfig> {
    return {
      runnerId: config.runnerId ?? `runner-${nanoid(8)}`,
      name: config.name ?? 'unknown',
      yggdrasilUrl: config.yggdrasilUrl,
      apiKey: config.apiKey ?? '',
      capabilities: config.capabilities ?? [],
      heartbeatInterval: config.heartbeatInterval ?? 30,
      leaseTtl: config.leaseTtl ?? 60,
      taskPollInterval: config.taskPollInterval ?? 10,
      taskHandlers: config.taskHandlers ?? {},
      endpointProvider: config.endpointProvider ?? (() => Promise.resolve('')),
      healthProvider: config.healthProvider ?? (() =>
        Promise.resolve({ status: RunnerHealth.HEALTHY })),
      detectLocalIp: config.detectLocalIp ?? true,
      detectPublicIp: config.detectPublicIp ?? false,
      labels: config.labels ?? {},
      metadata: config.metadata ?? {},
    };
  }

  /**
   * Initialize the internal state.
   */
  private initializeState(): RatatoskrState {
    return {
      runnerId: this.config.runnerId,
      runnerName: this.config.name,
      version: '0.1.0',
      endpoint: 'pending',
      lastHealth: RunnerHealth.HEALTHY,
      running: false,
    };
  }
}
