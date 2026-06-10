import { RunnerHealth, type HeartbeatPayload } from '../types/index.js';
import type { HealthMonitor } from './health-monitor.js';
import type { Transport } from '../transports/transport.js';
import type { RetryManager } from './retry-manager.js';

/**
 * Heartbeat sender that periodically sends health status to Yggdrasil.
 */
export class HeartbeatSender {
  private readonly transport: Transport;
  private readonly healthMonitor: HealthMonitor;
  private readonly retryManager: RetryManager;
  private readonly runnerId: string;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | undefined;
  private running: boolean = false;

  constructor(
    transport: Transport,
    healthMonitor: HealthMonitor,
    retryManager: RetryManager,
    runnerId: string,
    intervalSeconds: number = 30,
  ) {
    this.transport = transport;
    this.healthMonitor = healthMonitor;
    this.retryManager = retryManager;
    this.runnerId = runnerId;
    this.intervalMs = intervalSeconds * 1000;
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

    const payload: HeartbeatPayload = {
      runnerId: this.runnerId,
      timestamp: Math.floor(Date.now() / 1000),
      status: health.status,
    };

    try {
      await this.retryManager.execute(() => this.transport.heartbeat(payload));
    } catch {
      // Heartbeat failures are non-fatal; the retry manager will have
      // already attempted multiple times. On persistent failure the
      // lease will expire and trigger re-registration.
    }
  }
}
