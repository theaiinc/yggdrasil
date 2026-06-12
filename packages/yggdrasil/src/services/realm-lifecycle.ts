/**
 * RealmLifecycleService — handles Realm registration, heartbeat, and stale detection.
 *
 * Yggdrasil manages the lifecycle of Realm instances. Ratatoskr is the transport
 * that relays messages from Realm to Yggdrasil — it never stores or decides on realm state.
 *
 * Lifecycle:
 *   creating ──→ running ──→ unhealthy ──→ destroyed
 *                    ↑            │
 *                    └──── recover ┘
 *
 * Stale detection: if a realm has not heartbeated within the stale TTL,
 * Yggdrasil marks it unhealthy automatically.
 */

import { getLogger } from './logger.js';
import type { Realm, RealmRegistration, RealmHeartbeat, RealmDeregistration, RealmTemplateType } from '../types/index.js';
import { RealmRegistry } from './realm-registry.js';

const DEFAULT_STALE_TTL_MS = 60_000; // 60s without heartbeat → unhealthy
const STALE_CHECK_INTERVAL_MS = 10_000; // check every 10s

const logger = getLogger();

export class RealmLifecycleService {
  private staleTimer: ReturnType<typeof setInterval> | undefined;
  private registered: boolean = false;

  constructor(
    private readonly registry: RealmRegistry,
    private readonly staleTtlMs: number = DEFAULT_STALE_TTL_MS,
  ) {}

  /**
   * Register a realm that has just come online.
   * Transitions the realm from 'creating' → 'running' and sets its endpoints.
   * If the realm is not yet in the registry (spawned by an external process),
   * it is added directly.
   */
  registerRealm(registration: RealmRegistration, templateType: RealmTemplateType): Realm {
    const now = new Date().toISOString();
    const existing = this.registry.getRealm(registration.realmId);

    if (existing) {
      // Realm was pre-registered by RealmProvisioner — update it
      existing.state = 'running';
      existing.endpoints = registration.endpoints;
      existing.lastHeartbeat = now;
      existing.updatedAt = now;
      logger.info('Realm registered (updated existing)', {
        realmId: registration.realmId,
        runnerId: registration.runnerId,
        template: templateType,
      });
      return existing;
    }

    // Realm was spawned externally (e.g. manually) — add to registry
    const realm: Realm = {
      id: registration.realmId,
      templateId: templateType,
      runnerId: registration.runnerId,
      state: 'running',
      endpoints: { ...registration.endpoints },
      createdAt: now,
      updatedAt: now,
      lastHeartbeat: now,
    };

    // Create a minimal template from registration data
    const template = {
      id: `${registration.realmId}-template`,
      type: templateType,
      capabilities: registration.capabilities,
    };

    this.registry.addRealm(realm, template);
    logger.info('Realm registered (new)', {
      realmId: registration.realmId,
      runnerId: registration.runnerId,
      template: templateType,
    });

    return realm;
  }

  /**
   * Process a realm heartbeat.
   * Updates lastHeartbeat timestamp and recovers from unhealthy state.
   */
  heartbeatRealm(heartbeat: RealmHeartbeat): Realm | undefined {
    const realm = this.registry.getRealm(heartbeat.realmId);
    if (!realm) {
      logger.warn('Heartbeat for unknown realm', { realmId: heartbeat.realmId });
      return undefined;
    }

    realm.lastHeartbeat = new Date().toISOString();
    realm.updatedAt = realm.lastHeartbeat;

    // Recover from unhealthy state
    if (realm.state === 'unhealthy' && heartbeat.healthy) {
      realm.state = 'running';
      logger.info('Realm recovered from unhealthy', { realmId: heartbeat.realmId });
    }

    return realm;
  }

  /**
   * Process a realm deregistration (intentional shutdown).
   */
  deregisterRealm(deregistration: RealmDeregistration): void {
    const realm = this.registry.getRealm(deregistration.realmId);
    if (!realm) {
      logger.warn('Deregistration for unknown realm', { realmId: deregistration.realmId });
      return;
    }

    realm.state = 'destroyed';
    realm.updatedAt = new Date().toISOString();
    this.registry.removeRealm(deregistration.realmId);

    logger.info('Realm deregistered', {
      realmId: deregistration.realmId,
      reason: deregistration.reason,
    });
  }

  /**
   * Start stale detection timer.
   * Checks all running realms periodically and marks stale ones as unhealthy.
   */
  startStaleDetection(): void {
    if (this.staleTimer) return;
    this.registered = true;

    this.staleTimer = setInterval(() => {
      const now = Date.now();
      const stale: string[] = [];

      for (const realm of this.registry.listRealms()) {
        if (realm.state !== 'running') continue;
        if (!realm.lastHeartbeat) {
          // No heartbeat yet — give it time
          continue;
        }
        const elapsed = now - new Date(realm.lastHeartbeat).getTime();
        if (elapsed > this.staleTtlMs) {
          stale.push(realm.id);
        }
      }

      for (const realmId of stale) {
        this.registry.updateRealmState(realmId, 'unhealthy');
        logger.warn('Realm marked unhealthy due to heartbeat timeout', {
          realmId,
          missedBy: `${Math.round((now - new Date(this.registry.getRealm(realmId)?.lastHeartbeat ?? now).getTime()) / 1000)}s`,
        });
      }
    }, STALE_CHECK_INTERVAL_MS);
  }

  /**
   * Stop stale detection timer.
   */
  stopStaleDetection(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = undefined;
    }
    this.registered = false;
  }
}
