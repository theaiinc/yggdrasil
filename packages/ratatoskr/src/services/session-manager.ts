/**
 * Session Manager — bridges session requests from Yggdrasil to a Realm API server.
 *
 * Realm owns observation and input technologies. Ratatoskr merely forwards
 * session requests. The SessionManager does NOT understand streaming protocols,
 * video encoding, or computer-use logic — those belong to Realm.
 *
 * Consumers (Cognition) interact through session descriptors without knowing
 * the underlying transport details (WebRTC, screenshots, accessibility trees, etc.).
 */

import axios, { type AxiosInstance } from 'axios';
import { nanoid } from 'nanoid';

import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionDescriptor,
  SessionObservation,
  SessionInput,
  SessionInputResult,
  SessionHealth,
  SessionState,
  SessionCapability,
  SessionManagerConfig,
} from '../types/index.js';
import {
  type SessionAuthorizer,
  AllowAllAuthorizer,
} from './session-authorizer.js';

interface InternalSession {
  descriptor: SessionDescriptor;
  realmId: string;
  createdAt: Date;
  lastObservationAt?: Date;
  lastInputAt?: Date;
  errorCount: number;
}

export class SessionManager {
  private readonly http: AxiosInstance;
  private readonly realmUrl: string;
  private readonly sessions = new Map<string, InternalSession>();
  private readonly authorizer: SessionAuthorizer;

  constructor(config: SessionManagerConfig, authorizer?: SessionAuthorizer) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.realmApiKey) headers['x-api-key'] = config.realmApiKey;
    this.realmUrl = config.realmUrl.replace(/\/$/, '');
    this.http = axios.create({
      baseURL: this.realmUrl,
      headers,
      timeout: 60_000,
    });
    this.authorizer = authorizer ?? new AllowAllAuthorizer();
  }

  /**
   * Create a new interaction session.
   *
   * 1. Authorizes the request (Veil integration point).
   * 2. Resolves or creates a Realm for the given session type.
   * 3. Returns a session descriptor that consumers use to observe and act.
   *
   * Cognition calls startSession({ type: "computer-use" })
   * — NOT requestScreenStream() or startStream().
   */
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    const authResult = await this.authorizer.authorize(request);
    if (!authResult.allowed) {
      throw new Error(`Session creation denied: ${authResult.reason ?? 'Not authorized'}`);
    }

    const now = new Date().toISOString();
    const sessionId = `session-${nanoid(12)}`;
    const realmId = request.realmId || (await this.ensureRealm(request.type));

    const capabilities = request.capabilities ?? this.getCapabilitiesForType(request.type);

    const descriptor: SessionDescriptor = {
      id: sessionId,
      type: request.type,
      state: 'active',
      observationEndpoint: `${this.realmUrl}/api/v1/realms/${realmId}/capture`,
      inputEndpoint: `${this.realmUrl}/api/v1/realms/${realmId}`,
      capabilities,
      observationMethod: 'screenshot',
      realmId,
      ...(request.ownerId !== undefined ? { ownerId: request.ownerId } : {}),
      ...(request.participantIds !== undefined ? { participantIds: request.participantIds } : {}),
      createdAt: now,
      updatedAt: now,
      ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
    };

    this.sessions.set(sessionId, {
      descriptor,
      realmId,
      createdAt: new Date(),
      errorCount: 0,
    });

    return { sessionId, descriptor };
  }

  /**
   * Observe the current state of a session.
   * Realm decides how observation is delivered (screenshot, a11y tree, DOM, etc.).
   * Consumers must not depend on a specific implementation.
   */
  async observe(sessionId: string): Promise<SessionObservation> {
    const session = this.getInternalSession(sessionId);
    const timestamp = new Date().toISOString();

    try {
      const { data } = await this.http.get<{ screenshot: string; piiRedacted?: boolean }>(
        `/api/v1/realms/${session.realmId}/capture`,
      );

      session.lastObservationAt = new Date();

      return {
        screenshot: data.screenshot,
        ...(data.piiRedacted !== undefined ? { piiRedacted: data.piiRedacted } : {}),
        timestamp,
      };
    } catch (err: unknown) {
      session.errorCount++;
      const message = err instanceof Error ? err.message : String(err);
      return {
        data: { error: `Observation failed: ${message}` },
        timestamp,
      };
    }
  }

  /**
   * Send an input action to a session.
   * Input capabilities are attached to the session descriptor.
   */
  async input(sessionId: string, input: SessionInput): Promise<SessionInputResult> {
    const session = this.getInternalSession(sessionId);

    try {
      switch (input.type) {
        case 'mouse':
        case 'touch': {
          const { data } = await this.http.post<{ success: boolean; error?: string }>(
            `/api/v1/realms/${session.realmId}/click`,
            { x: input.params.x, y: input.params.y },
          );
          session.lastInputAt = new Date();
          return data;
        }
        case 'keyboard': {
          const { data } = await this.http.post<{ success: boolean; error?: string }>(
            `/api/v1/realms/${session.realmId}/type`,
            { text: input.params.text },
          );
          session.lastInputAt = new Date();
          return data;
        }
        default:
          return { success: false, error: `Unsupported input type: ${input.type}` };
      }
    } catch (err: unknown) {
      session.errorCount++;
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Input failed: ${message}` };
    }
  }

  /**
   * Get the descriptor for an active session.
   */
  async getSession(sessionId: string): Promise<SessionDescriptor> {
    return this.getInternalSession(sessionId).descriptor;
  }

  /**
   * List all sessions managed by this instance.
   */
  async listSessions(): Promise<SessionDescriptor[]> {
    return Array.from(this.sessions.values()).map((s) => s.descriptor);
  }

  /**
   * Terminate a session and optionally destroy the backing realm.
   */
  async terminateSession(sessionId: string, destroyRealm = false): Promise<void> {
    const session = this.getInternalSession(sessionId);
    if (destroyRealm) {
      try {
        await this.http.delete(`/api/v1/realms/${session.realmId}`);
      } catch {
        // best-effort cleanup
      }
    }
    session.descriptor.state = 'terminated';
    session.descriptor.updatedAt = new Date().toISOString();
  }

  /**
   * Pause a session (suspend observation/input).
   */
  async pauseSession(sessionId: string): Promise<void> {
    const session = this.getInternalSession(sessionId);
    session.descriptor.state = 'paused';
    session.descriptor.updatedAt = new Date().toISOString();
  }

  /**
   * Resume a paused session.
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = this.getInternalSession(sessionId);
    session.descriptor.state = 'active';
    session.descriptor.updatedAt = new Date().toISOString();
  }

  /**
   * Report session health for all managed sessions.
   * Used by Ratatoskr to include session health in heartbeat payloads.
   */
  getHealth(): SessionHealth[] {
    const health: SessionHealth[] = [];
    for (const [, session] of this.sessions) {
      if (session.descriptor.state === 'terminated' || session.descriptor.state === 'completed') {
        continue;
      }
      health.push({
        sessionId: session.descriptor.id,
        state: session.descriptor.state,
        realmId: session.realmId,
        ...(session.lastObservationAt !== undefined ? { lastObservationAt: session.lastObservationAt.toISOString() } : {}),
        ...(session.lastInputAt !== undefined ? { lastInputAt: session.lastInputAt.toISOString() } : {}),
        errorCount: session.errorCount,
      });
    }
    return health;
  }

  // ─── Private helpers ─────────────────────────────────────────

  private getInternalSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.descriptor.state === 'terminated' || session.descriptor.state === 'completed') {
      throw new Error(`Session is ${session.descriptor.state}: ${sessionId}`);
    }
    return session;
  }

  private getCapabilitiesForType(type: string): SessionCapability[] {
    switch (type) {
      case 'computer-use':
        return ['mouse', 'keyboard', 'scroll', 'clipboard'];
      case 'phone-use':
        return ['touch', 'keyboard', 'scroll'];
      default:
        return ['mouse', 'keyboard'];
    }
  }

  /**
   * Resolve or create a Realm for the given session type.
   * Reuses an existing Realm if one is already running.
   */
  private async ensureRealm(type: string): Promise<string> {
    // Look for an existing running realm for this type
    try {
      const { data } = await this.http.get<{ realms: Array<{ id: string; engine: string; session?: { state: string } }> }>(
        '/api/v1/realms',
      );
      const existing = data.realms?.find(
        (r) => r.engine === this.mapTypeToEngine(type) && r.session?.state === 'running',
      );
      if (existing) return existing.id;
    } catch {
      // No existing realms found, create a new one
    }

    const engine = this.mapTypeToEngine(type);
    const name = `session-${type}-${Date.now()}`;
    const { data } = await this.http.post<{ id: string }>('/api/v1/realms', {
      name,
      engine,
    });
    const realmId = data.id;

    // Ensure it's started
    await this.http.post(`/api/v1/realms/${realmId}/start`);

    return realmId;
  }

  private mapTypeToEngine(type: string): string {
    switch (type) {
      case 'computer-use':
        return 'ubuntu';
      case 'phone-use':
        return 'vm';
      default:
        return 'ubuntu';
    }
  }
}
