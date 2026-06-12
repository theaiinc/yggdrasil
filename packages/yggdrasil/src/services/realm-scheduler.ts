/**
 * RealmScheduler — makes allocation decisions for session requests.
 *
 * Yggdrasil owns all scheduling policy:
 *   - Which realm type?
 *   - Which owner?
 *   - Reuse allowed?
 *   - Spawn allowed?
 *   - Priority?
 *
 * Ratatoskr reports facts (CPU, memory, realms, templates).
 * Yggdrasil decides. Ratatoskr may veto ("I cannot do that") but
 * must never suggest alternatives — that is orchestration.
 *
 * Current implementation:
 *   Simple first-fit by template match + online status.
 *
 * Future:
 *   Resource-aware, owner-aware, cost-aware, affinity-aware,
 *   informed by Ratatoskr's /state endpoint.
 */

import type {
  CreateSessionRequest,
  RealmAllocation,
  SessionCapability,
  RunnerInfo,
} from '../types/index.js';
import { RealmRegistry } from './realm-registry.js';

/**
 * Map from SessionType to the required RealmTemplateType.
 */
const SESSION_TO_TEMPLATE: Record<string, string> = {
  'computer-use': 'ubuntu',
  'phone-use': 'android',
};

/**
 * Default capabilities for a template when none are explicitly advertised.
 */
const DEFAULT_TEMPLATE_CAPABILITIES: Record<string, SessionCapability[]> = {
  ubuntu: ['observe', 'mouse', 'keyboard', 'scroll', 'clipboard'],
  android: ['observe', 'touch', 'keyboard', 'scroll'],
  browser: ['observe', 'keyboard'],
  windows: ['observe', 'mouse', 'keyboard', 'scroll'],
};

export class RealmScheduler {
  constructor(
    private readonly registry: RealmRegistry,
    private readonly getRunner: (runnerId: string) => RunnerInfo | undefined,
  ) {}

  /**
   * Decide how to allocate a realm for a session request.
   *
   * Yggdrasil decides:
   *   - Which runner
   *   - Which template
   *   - Whether to spawn new or attach to existing
   *
   * Priority order:
   *   1. Attach to existing realm owned by this owner (persistent realm)
   *   2. Attach to a pooled idle realm (pre-warmed)
   *   3. Spawn a new realm on a healthy runner
   */
  async schedule(request: CreateSessionRequest): Promise<RealmAllocation> {
    const templateType = SESSION_TO_TEMPLATE[request.type];
    if (!templateType) {
      throw new Error(`No realm template available for session type: ${request.type}`);
    }

    // Priority 1: Persistent realm affinity by owner
    if (request.ownerId) {
      const existing = this.registry.findRealmByOwner(request.ownerId, templateType);
      if (existing) {
        const entry = this.registry.getEntry(existing.id);
        return {
          runnerId: existing.runnerId,
          template: entry!.template,
          action: 'attach',
          realmId: existing.id,
        };
      }
    }

    // Priority 2: Pooled idle realm
    const pooled = this.registry.findPooledRealm(templateType);
    if (pooled) {
      const entry = this.registry.getEntry(pooled.id);
      return {
        runnerId: pooled.runnerId,
        template: entry!.template,
        action: 'attach',
        realmId: pooled.id,
      };
    }

    // Priority 3: Find a runner that can host this template type
    const candidates = this.registry.getTemplatesByType(templateType);
    if (candidates.length === 0) {
      throw new Error(`No runner available that can host realm type: ${templateType}`);
    }

    // Pick first healthy runner with capacity
    for (const candidate of candidates) {
      const runner = this.getRunner(candidate.runnerId);
      if (runner && runner.status === 'online') {
        return {
          runnerId: candidate.runnerId,
          template: candidate.template,
          action: 'spawn',
        };
      }
    }

    throw new Error(`No online runner available for realm type: ${templateType}`);
  }

  /**
   * Resolve default capabilities for a template type when not explicitly provided.
   */
  static defaultCapabilitiesFor(type: string): SessionCapability[] {
    return DEFAULT_TEMPLATE_CAPABILITIES[type] ?? ['observe'];
  }
}
