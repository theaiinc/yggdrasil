/**
 * RealmRegistry — stores Realm templates advertised by runners and Realm instances.
 *
 * Responsibilities:
 *   - Tracks RealmTemplate[] per runner (what CAN be spawned)
 *   - Tracks Realm[] (what IS running)
 *   - Provides lookup by runner, template type, owner, and pool tag
 *
 * Yggdrasil is stateless-in-memory in v1. A future version may add
 * FileSessionStore or database-backed persistence.
 */

import type { Realm, RealmTemplate, RealmAllocation } from '../types/index.js';

export interface RealmRegistryEntry {
  realm: Realm;
  template: RealmTemplate;
}

export class RealmRegistry {
  /** Runner ID → realm templates they advertise. */
  private readonly templatesByRunner = new Map<string, RealmTemplate[]>();

  /** Realm ID → realm instance + its template. */
  private readonly realms = new Map<string, RealmRegistryEntry>();

  // ── Template management ──────────────────────────────────────────────

  /**
   * Register or update realm templates for a runner.
   */
  setTemplates(runnerId: string, templates: RealmTemplate[]): void {
    this.templatesByRunner.set(runnerId, templates);
  }

  /**
   * Get templates for a specific runner.
   */
  getTemplates(runnerId: string): RealmTemplate[] {
    return this.templatesByRunner.get(runnerId) ?? [];
  }

  /**
   * Get all templates across all runners that match a given template type.
   */
  getTemplatesByType(type: string): Array<{ runnerId: string; template: RealmTemplate }> {
    const results: Array<{ runnerId: string; template: RealmTemplate }> = [];
    for (const [runnerId, templates] of this.templatesByRunner.entries()) {
      for (const template of templates) {
        if (template.type === type) {
          results.push({ runnerId, template });
        }
      }
    }
    return results;
  }

  /**
   * Remove templates for a runner (e.g. on deregistration).
   */
  removeTemplates(runnerId: string): void {
    this.templatesByRunner.delete(runnerId);
  }

  // ── Realm instance management ────────────────────────────────────────

  /**
   * Register a new realm instance.
   */
  addRealm(realm: Realm, template: RealmTemplate): void {
    this.realms.set(realm.id, { realm, template });
  }

  /**
   * Get a realm instance by ID.
   */
  getRealm(realmId: string): Realm | undefined {
    return this.realms.get(realmId)?.realm;
  }

  /**
   * Get realm + template by ID.
   */
  getEntry(realmId: string): RealmRegistryEntry | undefined {
    return this.realms.get(realmId);
  }

  /**
   * Find a running realm by owner ID and template type (persistent realm affinity).
   * This is how ownerId becomes a scheduling primitive.
   */
  findRealmByOwner(ownerId: string, templateType: string): Realm | undefined {
    for (const [, entry] of this.realms.entries()) {
      if (
        entry.realm.ownerId === ownerId &&
        entry.template.type === templateType &&
        (entry.realm.state === 'running' || entry.realm.state === 'paused')
      ) {
        return entry.realm;
      }
    }
    return undefined;
  }

  /**
   * Find an idle realm in a pool (by template type, no owner).
   */
  findPooledRealm(templateType: string, poolTag?: string): Realm | undefined {
    for (const [, entry] of this.realms.entries()) {
      if (
        entry.realm.state === 'running' &&
        entry.template.type === templateType &&
        entry.realm.ownerId === undefined
      ) {
        if (poolTag === undefined || entry.realm.poolTag === poolTag) {
          return entry.realm;
        }
      }
    }
    return undefined;
  }

  /**
   * List all realm instances.
   */
  listRealms(): Realm[] {
    return Array.from(this.realms.values()).map((e) => e.realm);
  }

  /**
   * List realms for a specific runner.
   */
  listRealmsByRunner(runnerId: string): Realm[] {
    return Array.from(this.realms.values())
      .filter((e) => e.realm.runnerId === runnerId)
      .map((e) => e.realm);
  }

  /**
   * Update realm state.
   */
  updateRealmState(realmId: string, state: Realm['state']): void {
    const entry = this.realms.get(realmId);
    if (entry) {
      entry.realm.state = state;
      entry.realm.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Remove a realm.
   */
  removeRealm(realmId: string): void {
    this.realms.delete(realmId);
  }

  /**
   * Clear all state (useful for testing).
   */
  clear(): void {
    this.templatesByRunner.clear();
    this.realms.clear();
  }
}
