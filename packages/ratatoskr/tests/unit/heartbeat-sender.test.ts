import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunnerHealth } from '../../src/types';
import { HealthMonitor } from '../../src/services/health-monitor';
import { HeartbeatSender } from '../../src/services/heartbeat-sender';
import { RetryManager } from '../../src/services/retry-manager';
import type { Transport } from '../../src/types';

describe('HeartbeatSender', () => {
  let transport: Transport;
  let healthMonitor: HealthMonitor;
  let retryManager: RetryManager;
  let heartbeatSender: HeartbeatSender;

  const mockResourceCollector = {
    collect: vi.fn().mockResolvedValue({ cpu: { load1: 0, load5: 0, load15: 0, cpus: 1, percent: 0 }, memory: { total: 0, used: 0, free: 0, percent: 0 }, uptime: 0 }),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    healthMonitor = new HealthMonitor();
    retryManager = new RetryManager(10, 100, 1);

    transport = {
      register: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue({ status: 'ok' }),
      update: vi.fn().mockResolvedValue(undefined),
      deregister: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start', () => {
    it('should send a heartbeat immediately on start', async () => {
      heartbeatSender = new HeartbeatSender(
        transport,
        healthMonitor,
        retryManager,
        mockResourceCollector,
        'runner-123',
        30,
      );

      heartbeatSender.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });

    it('should not start if already running', async () => {
      heartbeatSender = new HeartbeatSender(
        transport,
        healthMonitor,
        retryManager,
        mockResourceCollector,
        'runner-123',
        30,
      );

      heartbeatSender.start();
      await vi.advanceTimersByTimeAsync(0);
      heartbeatSender.start(); // second call
      expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });

    it('should send heartbeats on interval', async () => {
      heartbeatSender = new HeartbeatSender(
        transport,
        healthMonitor,
        retryManager,
        mockResourceCollector,
        'runner-123',
        1, // 1 second interval for testing
      );

      heartbeatSender.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.heartbeat).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.heartbeat).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.heartbeat).toHaveBeenCalledTimes(3);
    });
  });

  describe('stop', () => {
    it('should stop sending heartbeats', async () => {
      heartbeatSender = new HeartbeatSender(
        transport,
        healthMonitor,
        retryManager,
        mockResourceCollector,
        'runner-123',
        1,
      );

      heartbeatSender.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.heartbeat).toHaveBeenCalledTimes(1);

      heartbeatSender.stop();

      await vi.advanceTimersByTimeAsync(5000);
      // Only the initial heartbeat was sent
      expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    });
  });
});
