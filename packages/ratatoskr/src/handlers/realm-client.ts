/**
 * Realm API client — talks to @theaiinc/realm-api HTTP server.
 *
 * Supports all Realm engines (ubuntu desktop, android vm, container, browser)
 * through the universal /api/v1/realms/:id/* interface.
 */

import axios, { type AxiosInstance } from 'axios';

export type RealmEngineType = 'ubuntu' | 'vm' | 'container' | 'browser';

export interface RealmActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
  timestamp?: string;
}

export interface RealmScreenshot {
  base64: string;
  piiRedacted?: boolean | undefined;
}

export interface RealmClientConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  realmId?: string | undefined;
  engine: RealmEngineType;
  realmName?: string | undefined;
  environment?: Record<string, string> | undefined;
}

export class RealmClient {
  private readonly http: AxiosInstance;
  private realmId: string | undefined;
  private readonly config: RealmClientConfig;
  private createdRealm = false;

  constructor(config: RealmClientConfig) {
    this.config = config;
    this.realmId = config.realmId;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      headers,
      timeout: 60_000,
    });
  }

  getRealmId(): string | undefined {
    return this.realmId;
  }

  /** Resolve or create a realm and ensure it is running. */
  async ensureRealm(): Promise<string> {
    if (this.realmId) {
      await this.startIfNeeded(this.realmId);
      return this.realmId;
    }

    const name = this.config.realmName || `ratatoskr-${this.config.engine}-${Date.now()}`;
    const { data } = await this.http.post<{ id: string }>('/api/v1/realms', {
      name,
      engine: this.config.engine,
      environment: this.config.environment,
    });
    this.realmId = data.id;
    this.createdRealm = true;
    await this.startIfNeeded(this.realmId);
    return this.realmId;
  }

  private async startIfNeeded(realmId: string): Promise<void> {
    const { data } = await this.http.get<{ realm?: { session?: { state: string } } }>(
      `/api/v1/realms/${realmId}`,
    );
    if (data.realm?.session?.state === 'running') return;
    await this.http.post(`/api/v1/realms/${realmId}/start`);
  }

  async capture(realmId: string): Promise<RealmScreenshot> {
    const { data } = await this.http.get<{ screenshot: string; piiRedacted?: boolean }>(
      `/api/v1/realms/${realmId}/capture`,
    );
    const screenshot: RealmScreenshot = { base64: data.screenshot };
    if (data.piiRedacted !== undefined) screenshot.piiRedacted = data.piiRedacted;
    return screenshot;
  }

  async click(realmId: string, x: number, y: number): Promise<RealmActionResult> {
    const { data } = await this.http.post<RealmActionResult>(
      `/api/v1/realms/${realmId}/click`,
      { x, y },
    );
    return data;
  }

  async type(realmId: string, text: string): Promise<RealmActionResult> {
    const { data } = await this.http.post<RealmActionResult>(
      `/api/v1/realms/${realmId}/type`,
      { text },
    );
    return data;
  }

  async navigate(realmId: string, url: string): Promise<RealmActionResult> {
    const { data } = await this.http.post<RealmActionResult>(
      `/api/v1/realms/${realmId}/navigate`,
      { url },
    );
    return data;
  }

  async exec(realmId: string, command: string): Promise<RealmActionResult> {
    const { data } = await this.http.post<RealmActionResult>(
      `/api/v1/realms/${realmId}/exec`,
      { command },
    );
    return data;
  }

  /** Destroy the realm if this client created it. */
  async cleanup(): Promise<void> {
    if (!this.realmId || !this.createdRealm) return;
    try {
      await this.http.delete(`/api/v1/realms/${this.realmId}`);
    } catch {
      // best-effort cleanup
    }
    this.realmId = undefined;
    this.createdRealm = false;
  }
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
