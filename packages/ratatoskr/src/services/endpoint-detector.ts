import * as os from 'os';
import axios from 'axios';

import type { EndpointUpdatePayload } from '../types/index.js';

/**
 * Detects and monitors the runner's network endpoint.
 *
 * Tracks local IP, hostname, and optionally public IP, emitting
 * endpoint changes so the registrar can notify Yggdrasil.
 */
export class EndpointDetector {
  private currentEndpoint: string;
  private readonly port: number;
  private readonly detectPublicIp: boolean;
  private publicIpCache: string | undefined;

  /**
   * @param port - The port the runner serves on.
   * @param detectPublicIp - Whether to fetch the public IP (default false).
   */
  constructor(port: number = 8080, detectPublicIp: boolean = false) {
    this.port = port;
    this.detectPublicIp = detectPublicIp;
    this.currentEndpoint = this.buildLocalEndpoint();
  }

  /**
   * Returns the currently detected endpoint URL.
   */
  getCurrentEndpoint(): string {
    return this.currentEndpoint;
  }

  /**
   * Override the detected endpoint with a custom value.
   * Used by custom endpoint providers.
   */
  setEndpoint(endpoint: string): void {
    this.currentEndpoint = endpoint;
  }

  /**
   * Performs a single endpoint detection and returns an update payload
   * if the endpoint changed, or null if unchanged.
   */
  async detect(): Promise<EndpointUpdatePayload | null> {
    const oldEndpoint = this.currentEndpoint;
    const newEndpoint = await this.resolveEndpoint();

    if (newEndpoint === oldEndpoint) {
      return null;
    }

    this.currentEndpoint = newEndpoint;

    return {
      runnerId: '', // filled in by the caller
      oldEndpoint,
      newEndpoint,
    };
  }

  /**
   * Resolves the best available endpoint for this runner.
   */
  private async resolveEndpoint(): Promise<string> {
    if (this.detectPublicIp) {
      try {
        const publicIp = await this.fetchPublicIp();
        return `http://${publicIp}:${this.port}`;
      } catch {
        // Fall through to local endpoint
      }
    }

    return this.buildLocalEndpoint();
  }

  /**
   * Builds a local endpoint from the first non-internal IPv4 address.
   */
  private buildLocalEndpoint(): string {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      const netInterfaces = interfaces[name];
      if (!netInterfaces) continue;

      for (const net of netInterfaces) {
        if (net.family === 'IPv4' && !net.internal) {
          return `http://${net.address}:${this.port}`;
        }
      }
    }

    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Fetches the public IP from an external service.
   */
  private async fetchPublicIp(): Promise<string> {
    if (this.publicIpCache) {
      return this.publicIpCache;
    }

    const response = await axios.get<string>('https://api.ipify.org', {
      timeout: 3000,
    });

    this.publicIpCache = response.data.trim();

    return this.publicIpCache;
  }

  /**
   * Returns the hostname of the current machine.
   */
  getHostname(): string {
    return os.hostname();
  }
}
