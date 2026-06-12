/**
 * Streamlined Realm API client — sessions replace direct capture/action calls.
 *
 * This client talks to @theaiinc/realm-api HTTP server but presents a
 * session-based interface. Consumers interact through sessions:
 *
 *   const client = new RealmClient({ baseUrl, engine: 'ubuntu' });
 *   const session = await client.createSession({ type: 'computer-use' });
 *   const observation = await client.observe(session.sessionId);
 *   const result = await client.input(session.sessionId, { type: 'mouse', params: { x: 100, y: 200 } });
 *
 * Consumers must NOT depend on transport details (WebRTC, screenshots, etc.).
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
  SessionType,
  SessionState,
  SessionCapability,
} from '../types/index.js';

export type RealmEngineType = 'ubuntu' | 'vm' | 'container' | 'browser';

export interface RealmActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
  timestamp?: string;
}

export interface RealmClientConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  realmId?: string | undefined;
  engine: RealmEngineType;
  realmName?: string | undefined;
  environment?: Record<string, string> | undefined;
}

interface InternalSession {
  id: string;
  type: string;
  realmId: string;
  state: string;
  capabilities: SessionCapability[];
  ownerId?: string | undefined;
  participantIds?: string[] | undefined;
  createdAt: Date;
}

export class RealmClient {
  private readonly http: AxiosInstance;
  private readonly config: RealmClientConfig;
  private readonly realmUrl: string;
  private readonly sessions = new Map<string, InternalSession>();

  constructor(config: RealmClientConfig) {
    this.config = config;
    this.realmUrl = config.baseUrl.replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    this.http = axios.create({
      baseURL: this.realmUrl,
      headers,
      timeout: 60_000,
    });
  }

  /**
   * Create an interaction session.
   * This replaces the old ensureRealm() + capture() pattern.
   */
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    const realmId = this.config.realmId || (await this.ensureRealm());
    const sessionId = `session-${nanoid(12)}`;
    const now = new Date().toISOString();

    const capabilities = request.capabilities ?? this.getCapabilitiesForType(request.type);

    const descriptor: SessionDescriptor = {
      id: sessionId,
      type: request.type,
      state: 'creating',
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
      id: sessionId,
      type: request.type,
      realmId,
      state: 'creating',
      capabilities,
      ...(request.ownerId !== undefined ? { ownerId: request.ownerId } : {}),
      ...(request.participantIds !== undefined ? { participantIds: request.participantIds } : {}),
      createdAt: new Date(),
    });

    // Mark active after setup
    descriptor.state = 'active';
    this.sessions.get(sessionId)!.state = 'active';

    return { sessionId, descriptor };
  }

  /**
   * Get the current session descriptor.
   */
  async getSession(sessionId: string): Promise<SessionDescriptor> {
    const internal = this.getSessionInternal(sessionId);
    return {
      id: internal.id,
      type: internal.type as SessionType,
      state: internal.state as SessionState,
      observationEndpoint: `${this.realmUrl}/api/v1/realms/${internal.realmId}/capture`,
      inputEndpoint: `${this.realmUrl}/api/v1/realms/${internal.realmId}`,
      capabilities: internal.capabilities,
      observationMethod: 'screenshot',
      realmId: internal.realmId,
      ...(internal.ownerId !== undefined ? { ownerId: internal.ownerId } : {}),
      ...(internal.participantIds !== undefined ? { participantIds: internal.participantIds } : {}),
      createdAt: internal.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Observe the current state of a session.
   * Realm decides how observation is delivered.
   */
  async observe(sessionId: string): Promise<SessionObservation> {
    const session = this.getSessionInternal(sessionId);
    const timestamp = new Date().toISOString();

    const { data } = await this.http.get<{ screenshot: string; piiRedacted?: boolean }>(
      `/api/v1/realms/${session.realmId}/capture`,
    );

    return {
      screenshot: data.screenshot,
      ...(data.piiRedacted !== undefined ? { piiRedacted: data.piiRedacted } : {}),
      timestamp,
    };
  }

  /**
   * Send an input action to a session.
   */
  async input(sessionId: string, input: SessionInput): Promise<SessionInputResult> {
    const session = this.getSessionInternal(sessionId);

    switch (input.type) {
      case 'mouse':
      case 'touch': {
        const { data } = await this.http.post<RealmActionResult>(
          `/api/v1/realms/${session.realmId}/click`,
          { x: input.params.x, y: input.params.y },
        );
        return {
          success: data.success,
          ...(data.error !== undefined ? { error: data.error } : {}),
        };
      }
      case 'keyboard': {
        const { data } = await this.http.post<RealmActionResult>(
          `/api/v1/realms/${session.realmId}/type`,
          { text: input.params.text },
        );
        return {
          success: data.success,
          ...(data.error !== undefined ? { error: data.error } : {}),
        };
      }
      default:
        return { success: false, error: `Unsupported input type: ${input.type}` };
    }
  }

  /**
   * Terminate a session.
   */
  async terminateSession(sessionId: string, destroyRealm = false): Promise<void> {
    const session = this.getSessionInternal(sessionId);
    session.state = 'terminated';
    if (destroyRealm && !this.config.realmId) {
      try {
        await this.http.delete(`/api/v1/realms/${session.realmId}`);
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Legacy alias for backward compatibility — delegates to createSession.
   * @deprecated Use createSession({ type: "computer-use" }) instead.
   */
  async ensureRealm(): Promise<string> {
    if (this.config.realmId) {
      await this.startIfNeeded(this.config.realmId);
      return this.config.realmId;
    }

    const name = this.config.realmName || `ratatoskr-${this.config.engine}-${Date.now()}`;
    const { data } = await this.http.post<{ id: string }>('/api/v1/realms', {
      name,
      engine: this.config.engine,
      environment: this.config.environment,
    });
    const realmId = data.id;
    await this.startIfNeeded(realmId);
    return realmId;
  }

  private async startIfNeeded(realmId: string): Promise<void> {
    const { data } = await this.http.get<{ realm?: { session?: { state: string } } }>(
      `/api/v1/realms/${realmId}`,
    );
    if (data.realm?.session?.state === 'running') return;
    await this.http.post(`/api/v1/realms/${realmId}/start`);
  }

  private getSessionInternal(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state === 'terminated' || session.state === 'completed') {
      throw new Error(`Session is ${session.state}: ${sessionId}`);
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

  // ─── All methods use the session-based API — no legacy compat ──
}

export function loadRealmUrl(): string {
  return (
    process.env.REALM_URL ||
    process.env.CU_REALM_URL ||
    'http://localhost:8542'
  );
}

export function loadRealmApiKey(): string | undefined {
  return process.env.REALM_API_KEY || process.env.CU_REALM_API_KEY || undefined;
}
