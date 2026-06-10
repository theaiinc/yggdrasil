import { setTimeout, clearTimeout } from 'timers';

/**
 * Lease manager tracks the expected lease lifecycle.
 *
 * On the client side, it simply records when registration occurred
 * and helps the registrar decide when a re-registration is necessary.
 */
export class LeaseManager {
  private readonly leaseTtlMs: number;
  private lastRenewedAt: number = 0;

  /**
   * @param leaseTtlSeconds - Lease TTL in seconds (default 60).
   */
  constructor(leaseTtlSeconds: number = 60) {
    this.leaseTtlMs = leaseTtlSeconds * 1000;
  }

  /**
   * Mark the lease as renewed (called after successful registration/heartbeat).
   */
  renew(): void {
    this.lastRenewedAt = Date.now();
  }

  /**
   * Returns true if the lease has expired and re-registration is needed.
   */
  isExpired(): boolean {
    return Date.now() - this.lastRenewedAt > this.leaseTtlMs;
  }

  /**
   * Returns the remaining time in milliseconds before the lease expires.
   */
  getRemainingMs(): number {
    const elapsed = Date.now() - this.lastRenewedAt;

    return Math.max(0, this.leaseTtlMs - elapsed);
  }

  /**
   * Returns the lease TTL in milliseconds.
   */
  getTtlMs(): number {
    return this.leaseTtlMs;
  }

  /**
   * Reset the lease (called on initial start or after deregistration).
   */
  reset(): void {
    this.lastRenewedAt = 0;
  }
}
