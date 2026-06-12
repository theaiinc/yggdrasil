import axios, { AxiosInstance } from 'axios';

import type {
  Transport,
  RunnerRegistration,
  HeartbeatPayload,
  HeartbeatResponse,
  EndpointUpdatePayload,
  DeregisterPayload,
  RunnerTask,
  RealmRegistration,
  RealmHeartbeat,
  RealmDeregistration,
} from '../types/index.js';

/**
 * HTTP transport implementation for communicating with Yggdrasil.
 *
 * Sends registration, heartbeat, update, and deregistration requests
 * to the Yggdrasil orchestration server over HTTP.
 */
export class HttpTransport implements Transport {
  private readonly client: AxiosInstance;

  /**
   * @param baseUrl - The base URL of the Yggdrasil server (e.g. http://localhost:4000).
   * @param apiKey  - Optional API key for authentication (sent as X-API-Key header).
   * @param timeout - Request timeout in milliseconds (default 5000).
   */
  constructor(baseUrl: string, apiKey?: string, timeout: number = 5000) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout,
      headers,
    });
  }

  /**
   * Register the runner with Yggdrasil.
   */
  async register(payload: RunnerRegistration): Promise<void> {
    await this.client.post('/runners/register', payload);
  }

  /**
   * Send a heartbeat to Yggdrasil.
   * Returns the response which may carry a pendingUpdate.
   */
  async heartbeat(payload: HeartbeatPayload): Promise<HeartbeatResponse> {
    const res = await this.client.post<HeartbeatResponse>('/runners/heartbeat', payload);
    return res.data;
  }

  /**
   * Update the runner's endpoint.
   */
  async update(payload: EndpointUpdatePayload): Promise<void> {
    await this.client.post('/runners/update', payload);
  }

  /**
   * Deregister the runner.
   */
  async deregister(payload: DeregisterPayload): Promise<void> {
    await this.client.post('/runners/offline', payload);
  }

  // ── Realm lifecycle relays ──────────────────────────────────────────

  /**
   * Relay a realm registration to Yggdrasil.
   * Ratatoskr is the transport — it does not inspect or store realm state.
   */
  async registerRealm(payload: RealmRegistration): Promise<void> {
    await this.client.post('/api/v1/realms/register', payload);
  }

  /**
   * Relay a realm heartbeat to Yggdrasil.
   */
  async heartbeatRealm(payload: RealmHeartbeat): Promise<void> {
    await this.client.post('/api/v1/realms/heartbeat', payload);
  }

  /**
   * Relay a realm deregistration to Yggdrasil.
   */
  async deregisterRealm(payload: RealmDeregistration): Promise<void> {
    await this.client.post('/api/v1/realms/deregister', payload);
  }

  /**
   * Fetch tasks for a runner, optionally filtered by status.
   */
  async fetchTasks(runnerId: string, status?: string): Promise<RunnerTask[]> {
    const path = status
      ? `/runners/${runnerId}/tasks?status=${encodeURIComponent(status)}`
      : `/runners/${runnerId}/tasks`;
    const res = await this.client.get<{ tasks: RunnerTask[] }>(path);
    return res.data.tasks;
  }

  /**
   * Update a task's status and metadata.
   */
  async updateTask(
    runnerId: string,
    taskId: string,
    update: { status?: 'running' | 'completed' | 'failed'; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await this.client.patch(`/runners/${runnerId}/tasks/${taskId}`, update);
  }
}
