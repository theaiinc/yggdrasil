import { nanoid } from 'nanoid';

import type {
  RatatoskrConfig,
  RatatoskrState,
  HealthResult,
} from './types/index.js';
import { RunnerHealth } from './types/index.js';
import { HttpTransport } from './transports/http-transport.js';
import type { Transport } from './transports/transport.js';
import { EndpointDetector } from './services/endpoint-detector.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HeartbeatSender } from './services/heartbeat-sender.js';
import { LeaseManager } from './services/lease-manager.js';
import { Registrar } from './services/registrar.js';
import { RetryManager } from './services/retry-manager.js';

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
  private endpointCheckTimer: ReturnType<typeof setInterval> | undefined;
  private leaseCheckTimer: ReturnType<typeof setInterval> | undefined;
  private shutdownHandlers: (() => void)[] = [];
  private started: boolean = false;

  constructor(config: RatatoskrConfig) {
    this.config = this.resolveConfig(config);
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

    this.leaseManager = new LeaseManager(this.config.leaseTtl);
    this.retryManager = new RetryManager();

    this.registrar = new Registrar(
      this.transport,
      this.endpointDetector,
      this.retryManager,
      this.leaseManager,
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
      this.state.runnerId,
      this.config.heartbeatInterval,
    );
  }

  /**
   * Start the Ratatoskr daemon.
   *
   * 1. Registers the runner with Yggdrasil
   * 2. Begins sending heartbeats
   * 3. Monitors for IP changes
   * 4. Monitors lease expiry for re-registration
   * 5. Registers shutdown handlers for graceful deregistration
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (this.config.endpointProvider) {
      const customEndpoint = await this.config.endpointProvider();
      this.endpointDetector.setEndpoint(customEndpoint);
    }

    // 1. Register with Yggdrasil
    await this.registrar.register();

    // 2. Start heartbeats
    this.heartbeatSender.start();

    // 3. Monitor IP changes
    this.endpointCheckTimer = setInterval(() => {
      this.checkEndpoint();
    }, 10_000);

    // 4. Monitor lease expiry
    this.leaseCheckTimer = setInterval(() => {
      this.registrar.renewIfNeeded();
    }, 5_000);

    // 5. Register shutdown handlers
    this.registerShutdownHandlers();
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
