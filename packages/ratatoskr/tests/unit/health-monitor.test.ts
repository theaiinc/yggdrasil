import { describe, it, expect, beforeEach } from 'vitest';
import { RunnerHealth } from '../../src/types';
import { HealthMonitor } from '../../src/services/health-monitor';

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  describe('check (default)', () => {
    it('should return healthy by default', async () => {
      const result = await monitor.check();
      expect(result.status).toBe(RunnerHealth.HEALTHY);
    });

    it('should not include details by default', async () => {
      const result = await monitor.check();
      expect(result.details).toBeUndefined();
    });
  });

  describe('setHealthProvider', () => {
    it('should return result from custom provider', async () => {
      monitor.setHealthProvider(async () => ({
        status: RunnerHealth.DEGRADED,
        details: 'High memory usage',
      }));

      const result = await monitor.check();
      expect(result.status).toBe(RunnerHealth.DEGRADED);
      expect(result.details).toBe('High memory usage');
    });

    it('should return unhealthy when provider throws', async () => {
      monitor.setHealthProvider(async () => {
        throw new Error('Check failed');
      });

      const result = await monitor.check();
      expect(result.status).toBe(RunnerHealth.UNHEALTHY);
      expect(result.details).toContain('Check failed');
    });

    it('should return unhealthy when provider throws non-Error', async () => {
      monitor.setHealthProvider(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'Boom';
      });

      const result = await monitor.check();
      expect(result.status).toBe(RunnerHealth.UNHEALTHY);
      expect(result.details).toBe('Health provider threw: Boom');
    });
  });
});
