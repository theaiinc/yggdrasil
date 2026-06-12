/**
 * RealmProvisioner — ensures a realm exists for a given allocation decision.
 *
 * Yggdrasil decides. RealmProvisioner executes.
 *
 * If the allocation says "spawn", it sends a command to the runner (via
 * Ratatoskr's task mechanism) to create the Realm container/VM and waits
 * for the endpoints to be ready.
 *
 * If the allocation says "attach", it returns the existing realm.
 *
 * Future:
 *   - Synchronous spawn via Ratatoskr task endpoint
 *   - Pool management (pre-warm idle realms)
 *   - Retry with backoff on failed spawns
 *   - Veto check: if a runner rejects a spawn, fall through to next candidate
 */

import { nanoid } from 'nanoid';
import type { Realm, RealmAllocation, RealmTemplate } from '../types/index.js';
import { RealmRegistry } from './realm-registry.js';

export class RealmProvisioner {
  constructor(private readonly registry: RealmRegistry) {}

  /**
   * Ensure a realm matching the allocation exists.
   * Returns the realm (either existing or newly created).
   */
  async ensureRealm(allocation: RealmAllocation, ownerId?: string): Promise<Realm> {
    if (allocation.action === 'attach' && allocation.realmId) {
      const existing = this.registry.getRealm(allocation.realmId);
      if (existing) {
        return existing;
      }
    }

    return this.spawnRealm(allocation, ownerId);
  }

  /**
   * Create (or mark as creating) a new realm instance.
   *
   * In v1 this registers the realm in-memory with a 'creating' state.
   * The async spawn happens when the runner acknowledges and reports back
   * with the actual endpoints.
   */
  private async spawnRealm(allocation: RealmAllocation, ownerId?: string): Promise<Realm> {
    const now = new Date().toISOString();
    const realmId = `realm-${nanoid(12)}`;

    const realm: Realm = {
      id: realmId,
      templateId: allocation.template.id,
      runnerId: allocation.runnerId,
      ...(ownerId !== undefined ? { ownerId } : {}),
      state: 'creating',
      endpoints: {
        observation: '',
        input: '',
      },
      createdAt: now,
      updatedAt: now,
    };

    this.registry.addRealm(realm, allocation.template);

    // In a full implementation, this would send a command to the runner:
    //   POST /runners/:runnerId/tasks
    //   { type: "spawn_realm", template: template.type, realmId }
    //
    // The runner would Docker exec the realm container, wait for it,
    // then POST back to Yggdrasil:
    //   PATCH /api/v1/realms/:realmId
    //   { state: "running", endpoints: { observation, input } }
    //
    // The runner may also veto by returning a failed task.
    //
    // For now, simulate a short spawn delay and set placeholder endpoints.
    await new Promise((resolve) => setTimeout(resolve, 100));

    realm.state = 'running';
    realm.endpoints = {
      observation: `http://realm-placeholder:8542/api/v1/realms/${realmId}/capture`,
      input: `http://realm-placeholder:8542/api/v1/realms/${realmId}`,
    };
    realm.updatedAt = new Date().toISOString();

    return realm;
  }

  /**
   * Update realm endpoints and state (called when a runner reports back).
   */
  updateRealmEndpoints(
    realmId: string,
    state: Realm['state'],
    endpoints: Realm['endpoints'],
  ): void {
    this.registry.updateRealmState(realmId, state);
    const entry = this.registry.getEntry(realmId);
    if (entry) {
      entry.realm.endpoints = endpoints;
      entry.realm.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Destroy a realm instance.
   */
  async destroyRealm(realmId: string): Promise<void> {
    this.registry.updateRealmState(realmId, 'destroyed');
    // In a full implementation, would send a destroy command to the runner.
    this.registry.removeRealm(realmId);
  }
}
