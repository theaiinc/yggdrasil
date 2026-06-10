import { describe, it, expect, beforeEach } from 'vitest';
import { LeaseManager } from '../../src/services/lease-manager';

describe('LeaseManager', () => {
  let leaseManager: LeaseManager;

  beforeEach(() => {
    leaseManager = new LeaseManager(60);
  });

  describe('constructor', () => {
    it('should create with default 60s TTL', () => {
      const lm = new LeaseManager();
      expect(lm.getTtlMs()).toBe(60_000);
    });

    it('should create with custom TTL', () => {
      const lm = new LeaseManager(30);
      expect(lm.getTtlMs()).toBe(30_000);
    });
  });

  describe('renew', () => {
    it('should reset the lease timer', () => {
      leaseManager.renew();
      expect(leaseManager.isExpired()).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should be expired before first renew', () => {
      expect(leaseManager.isExpired()).toBe(true);
    });

    it('should not be expired right after renew', () => {
      leaseManager.renew();
      expect(leaseManager.isExpired()).toBe(false);
    });
  });

  describe('getRemainingMs', () => {
    it('should be near TTL after renew', () => {
      leaseManager.renew();
      const remaining = leaseManager.getRemainingMs();
      expect(remaining).toBeGreaterThan(59_000);
      expect(remaining).toBeLessThanOrEqual(60_000);
    });

    it('should be 0 if never renewed', () => {
      expect(leaseManager.getRemainingMs()).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear the renewal timestamp', () => {
      leaseManager.renew();
      expect(leaseManager.isExpired()).toBe(false);

      leaseManager.reset();
      expect(leaseManager.isExpired()).toBe(true);
    });
  });
});
