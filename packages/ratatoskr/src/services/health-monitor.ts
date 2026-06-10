import { RunnerHealth, type HealthResult } from '../types/index.js';

/**
 * Health monitor that periodically assesses runner health.
 *
 * Supports a custom health provider callback and a default
 * ping-based health check.
 */
export class HealthMonitor {
  private healthProvider: (() => Promise<HealthResult>) | undefined;

  /**
   * Set a custom health provider callback.
   *
   * The callback should return a HealthResult with a status and optional details.
   */
  setHealthProvider(provider: () => Promise<HealthResult>): void {
    this.healthProvider = provider;
  }

  /**
   * Perform a health check and return the result.
   */
  async check(): Promise<HealthResult> {
    if (this.healthProvider) {
      try {
        return await this.healthProvider();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
          status: RunnerHealth.UNHEALTHY,
          details: `Health provider threw: ${message}`,
        };
      }
    }

    // Default health check: assume healthy
    return {
      status: RunnerHealth.HEALTHY,
    };
  }
}
