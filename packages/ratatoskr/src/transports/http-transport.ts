import axios, { AxiosInstance } from 'axios';

import type {
  Transport,
  RunnerRegistration,
  HeartbeatPayload,
  EndpointUpdatePayload,
  DeregisterPayload,
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
   */
  async heartbeat(payload: HeartbeatPayload): Promise<void> {
    await this.client.post('/runners/heartbeat', payload);
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
}
