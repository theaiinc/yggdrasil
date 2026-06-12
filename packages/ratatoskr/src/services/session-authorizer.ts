/**
 * SessionAuthorizer — Veil integration seam for session creation.
 *
 * This is the contract for future authorization logic.
 * The default implementation (AllowAllAuthorizer) permits everything.
 *
 * To integrate Veil, implement this interface and pass it to SessionManager:
 *
 *   const authorizer: SessionAuthorizer = {
 *     async authorize(request) {
 *       const decision = await veilClient.evaluate(request);
 *       return decision.allowed
 *         ? { allowed: true }
 *         : { allowed: false, reason: decision.reason };
 *     },
 *   };
 *   const manager = new SessionManager(config, authorizer);
 */

import type { CreateSessionRequest } from '../types/index.js';

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string | undefined;
}

export interface SessionAuthorizer {
  authorize(request: CreateSessionRequest): Promise<AuthorizationResult>;
}

/**
 * Default authorizer that permits all session creation requests.
 * Used when no custom authorizer (e.g. Veil) is configured.
 */
export class AllowAllAuthorizer implements SessionAuthorizer {
  async authorize(_request: CreateSessionRequest): Promise<AuthorizationResult> {
    return { allowed: true };
  }
}
