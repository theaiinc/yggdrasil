import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Ratatoskr } from '../../src/ratatoskr';
import { HttpTransport } from '../../src/transports/http-transport';
import { RunnerHealth } from '../../src/types';

vi.mock('../../src/transports/http-transport', () => {
  const mockTransport = {
    register: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deregister: vi.fn().mockResolvedValue(undefined),
  };

  return {
    HttpTransport: vi.fn().mockImplementation(() => mockTransport),
  };
});

describe('Ratatoskr', () => {
  let ratatoskr: Ratatoskr;

  beforeEach(() => {
    vi.useFakeTimers();
    ratatoskr = new Ratatoskr({
      yggdrasilUrl: 'http://localhost:4000',
      runnerId: 'test-runner',
      name: 'Test Runner',
      capabilities: ['llm', 'browser'],
      heartbeatInterval: 30,
      leaseTtl: 60,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (ratatoskr.isRunning()) {
      await ratatoskr.stop();
    }
  });

  describe('constructor', () => {
    it('should create a Ratatoskr instance', () => {
      expect(ratatoskr).toBeInstanceOf(Ratatoskr);
    });

    it('should generate runnerId when not provided', () => {
      const r = new Ratatoskr({
        yggdrasilUrl: 'http://localhost:4000',
      });
      const state = r.getState();
      expect(state.runnerId).toMatch(/^runner-/);
    });

    it('should use provided runnerId', () => {
      const state = ratatoskr.getState();
      expect(state.runnerId).toBe('test-runner');
      expect(state.runnerName).toBe('Test Runner');
    });
  });

  describe('start', () => {
    it('should register with Yggdrasil', async () => {
      await ratatoskr.start();
      expect(HttpTransport).toHaveBeenCalledWith('http://localhost:4000', '');
    });

    it('should not start twice', async () => {
      await ratatoskr.start();
      const transport = new HttpTransport('');
      const registerSpy = vi.mocked(transport.register);

      await ratatoskr.start();
      // Should not throw or re-register
      expect(ratatoskr.isRunning()).toBe(true);
    });
  });

  describe('stop', () => {
    it('should deregister and stop', async () => {
      await ratatoskr.start();
      expect(ratatoskr.isRunning()).toBe(true);

      await ratatoskr.stop();
      expect(ratatoskr.isRunning()).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('should return false before start', () => {
      expect(ratatoskr.isRunning()).toBe(false);
    });

    it('should return true after start', async () => {
      await ratatoskr.start();
      expect(ratatoskr.isRunning()).toBe(true);
    });
  });

  describe('isRegistered', () => {
    it('should return false before start', () => {
      expect(ratatoskr.isRegistered()).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return runner state', () => {
      const state = ratatoskr.getState();
      expect(state.runnerId).toBe('test-runner');
      expect(state.runnerName).toBe('Test Runner');
      expect(state.version).toBe('0.1.0');
    });
  });

  describe('setHealthProvider', () => {
    it('should set a custom health provider', async () => {
      ratatoskr.setHealthProvider(async () => ({
        status: RunnerHealth.DEGRADED,
        details: 'Custom check',
      }));

      // Provider should be used during heartbeat
      await ratatoskr.start();
      expect(ratatoskr.isRegistered()).toBe(true);
    });
  });

  describe('advanced mode', () => {
    it('should accept endpoint and health providers', async () => {
      const r = new Ratatoskr({
        runnerId: 'runner-a',
        yggdrasilUrl: 'http://localhost:4000',
        capabilities: ['browser', 'computer-use', 'llm'],
        endpointProvider: async () => 'http://192.168.1.5:8080',
        healthProvider: async () => ({
          status: RunnerHealth.HEALTHY,
        }),
      });

      await r.start();
      expect(r.isRunning()).toBe(true);

      const state = r.getState();
      expect(state.runnerId).toBe('runner-a');
    });
  });
});
