import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EndpointDetector } from '../../src/services/endpoint-detector';
import { LeaseManager } from '../../src/services/lease-manager';
import { Registrar } from '../../src/services/registrar';
import { RetryManager } from '../../src/services/retry-manager';
import type { Transport, EndpointUpdatePayload } from '../../src/types';

describe('Registrar', () => {
  let transport: Transport;
  let endpointDetector: EndpointDetector;
  let retryManager: RetryManager;
  let leaseManager: LeaseManager;
  let registrar: Registrar;

  beforeEach(() => {
    transport = {
      register: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      deregister: vi.fn().mockResolvedValue(undefined),
    };

    endpointDetector = new EndpointDetector(8080);
    retryManager = new RetryManager(10, 100, 1);
    leaseManager = new LeaseManager(60);

    registrar = new Registrar(
      transport,
      endpointDetector,
      retryManager,
      leaseManager,
      'runner-123',
      'Test Runner',
      ['llm', 'browser'],
    );
  });

  describe('register', () => {
    it('should send registration payload with runner metadata', async () => {
      await registrar.register();

      expect(transport.register).toHaveBeenCalledTimes(1);
      expect(transport.register).toHaveBeenCalledWith(
        expect.objectContaining({
          runnerId: 'runner-123',
          name: 'Test Runner',
          capabilities: ['llm', 'browser'],
          version: '0.1.0',
        }),
      );
    });

    it('should include endpoint in registration', async () => {
      await registrar.register();

      expect(transport.register).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: endpointDetector.getCurrentEndpoint(),
        }),
      );
    });

    it('should mark as registered after success', async () => {
      expect(registrar.isRegistered()).toBe(false);
      await registrar.register();
      expect(registrar.isRegistered()).toBe(true);
    });
  });

  describe('renewIfNeeded', () => {
    it('should register if not registered', async () => {
      await registrar.renewIfNeeded();
      expect(transport.register).toHaveBeenCalledTimes(1);
    });

    it('should not re-register if lease is still valid', async () => {
      await registrar.register();
      vi.clearAllMocks();

      await registrar.renewIfNeeded();
      expect(transport.register).not.toHaveBeenCalled();
    });
  });

  describe('updateEndpoint', () => {
    it('should send update with runnerId filled in', async () => {
      const update: EndpointUpdatePayload = {
        runnerId: '',
        oldEndpoint: 'http://192.168.1.5:8080',
        newEndpoint: 'http://192.168.1.6:8080',
      };

      await registrar.updateEndpoint(update);

      expect(transport.update).toHaveBeenCalledWith({
        runnerId: 'runner-123',
        oldEndpoint: 'http://192.168.1.5:8080',
        newEndpoint: 'http://192.168.1.6:8080',
      });
    });
  });

  describe('deregister', () => {
    it('should send deregistration', async () => {
      await registrar.register();
      await registrar.deregister();

      expect(transport.deregister).toHaveBeenCalledWith({
        runnerId: 'runner-123',
      });
    });

    it('should mark as not registered after deregistration', async () => {
      await registrar.register();
      expect(registrar.isRegistered()).toBe(true);

      await registrar.deregister();
      expect(registrar.isRegistered()).toBe(false);
    });

    it('should not send deregistration if never registered', async () => {
      await registrar.deregister();
      expect(transport.deregister).not.toHaveBeenCalled();
    });
  });
});
