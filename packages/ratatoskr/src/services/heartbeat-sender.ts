import { RunnerHealth, type HeartbeatPayload, type HeartbeatResponse, type UpdateStatus } from '../types/index.js';
import type { PendingUpdate } from '../types/index.js';
import type { HealthMonitor } from './health-monitor.js';
import type { Transport } from '../transports/transport.js';
import type { RetryManager } from './retry-manager.js';
import type { ResourceCollector } from './resource-collector.js';

/**
 * Callback invoked when Yggdrasil signals a pending update via heartbeat response.
 */
export type UpdateRequestedCallback = (update: PendingUpdate) => void;

/**
 * Provider for update status — called each heartbeat to include
 * the current update progress in the payload for Yggdrasil observability.
 */
export type UpdateStatusProvider = () => { status: UpdateStatus; log: string };

/**
 * Heartbeat sender that periodically sends health status to Yggdrasil.
 * Captures any pendingUpdate in the heartbeat response and fires a callback.
 * Includes update status from the UpdateManager for remote observability.
 */
export class HeartbeatSender {
  private readonly transport: Transport;
  private readonly healthMonitor: HealthMonitor;
  private readonly retryManager: RetryManager;
  private readonly resourceCollector: ResourceCollector;
  private readonly runnerId: string;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | undefined;
  private running: boolean = false;
  private onUpdateRequested: UpdateRequestedCallback | undefined;
  private updateStatusProvider: UpdateStatusProvider | undefined;

  constructor(
    transport: Transport,
    healthMonitor: HealthMonitor,
    retryManager: RetryManager,
    resourceCollector: ResourceCollector,
    runnerId: string,
    intervalSeconds: number = 30,
  ) {
    this.transport = transport;
    this.healthMonitor = healthMonitor;
    this.retryManager = retryManager;
    this.resourceCollector = resourceCollector;
    this.runnerId = runnerId;
    this.intervalMs = intervalSeconds * 1000;
  }

  /**
   * Register a callback for when Yggdrasil requests an update.
   */
  setOnUpdateRequested(cb: UpdateRequestedCallback): void {
    this.onUpdateRequested = cb;
  }

  /**
   * Register a provider for the current update status (typically UpdateManager).
   */
  setUpdateStatusProvider(provider: UpdateStatusProvider): void {
    this.updateStatusProvider = provider;
  }

  /**
   * Start sending heartbeats.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.sendHeartbeat(); // Send immediately
    this.timerId = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);
  }

  /**
   * Stop sending heartbeats.
   */
  stop(): void {
    this.running = false;

    if (this.timerId !== undefined) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }

  /**
   * Send a single heartbeat with retry.
   */
  private async sendHeartbeat(): Promise<void> {
    const health = await this.healthMonitor.check();
    const resources = await this.resourceCollector.collect();

    const payload: HeartbeatPayload = {
      runnerId: this.runnerId,
      timestamp: Math.floor(Date.now() / 1000),
      status: health.status,
      resources,
    };

    // Include update status if provider is registered
    if (this.updateStatusProvider) {
      const { status, log } = this.updateStatusProvider();
      if (status !== 'idle') {
        payload.updateStatus = status;
        payload.updateLog = log;
      }
    }

    try {
      const response = await this.retryManager.execute<HeartbeatResponse>(() =>
        this.transport.heartbeat(payload),
      );

      if (response.pendingUpdate && this.onUpdateRequested) {
        console.log(`[HeartbeatSender] Update requested by Yggdrasil: version=${response.pendingUpdate.version}`);

        // ── API key rotation ────────────────────────────────────────
        // If Yggdrasil pushed a new API key, apply it immediately on
        // the transport so the next request uses the new credential.
        if (response.pendingUpdate.apiKey) {
          console.log('[HeartbeatSender] API key rotation received from Yggdrasil — applying new key');
          this.transport.setApiKey(response.pendingUpdate.apiKey);
        }
        // ────────────────────────────────────────────────────────────

        this.onUpdateRequested(response.pendingUpdate);
      }
    } catch {
      // Heartbeat failures are non-fatal; the retry manager will have
      // already attempted multiple times. On persistent failure the
      // lease will expire and trigger re-registration.
    }
  }
}
