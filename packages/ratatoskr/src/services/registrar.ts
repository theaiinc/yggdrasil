import type { RunnerRegistration, EndpointUpdatePayload, RealmTemplate } from '../types/index.js';
import type { Transport } from '../transports/transport.js';
import type { EndpointDetector } from './endpoint-detector.js';
import type { RetryManager } from './retry-manager.js';
import type { LeaseManager } from './lease-manager.js';
import type { ResourceCollector } from './resource-collector.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPackageVersion(startDir: string, maxDepth = 5): string {
  let current = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = resolve(current, 'package.json');
    try {
      return JSON.parse(readFileSync(candidate, 'utf-8')).version as string;
    } catch {
      current = dirname(current);
    }
  }
  return '0.1.0';
}

const RATATOSKR_VERSION = findPackageVersion(__dirname);

/**
 * Registrar handles runner registration and re-registration with Yggdrasil.
 *
 * Manages the full registration lifecycle including initial registration,
 * endpoint change updates, and lease-based re-registration.
 */
export class Registrar {
  private readonly transport: Transport;
  private readonly endpointDetector: EndpointDetector;
  private readonly retryManager: RetryManager;
  private readonly leaseManager: LeaseManager;
  private readonly resourceCollector: ResourceCollector;
  private readonly runnerId: string;
  private readonly runnerName: string;
  private readonly version: string;
  private readonly capabilities: string[];
  private readonly realmTemplates: RealmTemplate[];
  private readonly labels: Record<string, string>;
  private readonly metadata: Record<string, unknown>;
  private registered: boolean = false;

  constructor(
    transport: Transport,
    endpointDetector: EndpointDetector,
    retryManager: RetryManager,
    leaseManager: LeaseManager,
    resourceCollector: ResourceCollector,
    runnerId: string,
    runnerName: string,
    capabilities: string[],
    realmTemplates?: RealmTemplate[],
    labels?: Record<string, string>,
    metadata?: Record<string, unknown>,
  ) {
    this.transport = transport;
    this.endpointDetector = endpointDetector;
    this.retryManager = retryManager;
    this.leaseManager = leaseManager;
    this.resourceCollector = resourceCollector;
    this.runnerId = runnerId;
    this.runnerName = runnerName;
    this.version = RATATOSKR_VERSION;
    this.capabilities = capabilities;
    this.realmTemplates = realmTemplates ?? [];
    this.labels = labels ?? {};
    this.metadata = metadata ?? {};
  }

  /**
   * Register the runner with Yggdrasil.
   *
   * Retries on failure with exponential backoff.
   */
  async register(): Promise<void> {
    const endpoint = this.endpointDetector.getCurrentEndpoint();
    const resources = await this.resourceCollector.collect();

    const payload: RunnerRegistration = {
      runnerId: this.runnerId,
      name: this.runnerName,
      endpoint,
      version: this.version,
      capabilities: this.capabilities,
      ...(this.realmTemplates.length > 0 ? { realmTemplates: this.realmTemplates } : {}),
      resources,
      ...(Object.keys(this.labels).length > 0 ? { labels: this.labels } : {}),
      ...(Object.keys(this.metadata).length > 0 ? { metadata: this.metadata } : {}),
    };

    await this.retryManager.execute(() => this.transport.register(payload));

    this.registered = true;
    this.leaseManager.renew();
  }

  /**
   * Re-register if the lease has expired.
   *
   * Called periodically by the main loop.
   */
  async renewIfNeeded(): Promise<void> {
    if (!this.registered || this.leaseManager.isExpired()) {
      await this.register();
    }
  }

  /**
   * Update the endpoint when an IP change is detected.
   */
  async updateEndpoint(payload: EndpointUpdatePayload): Promise<void> {
    const updatePayload: EndpointUpdatePayload = {
      ...payload,
      runnerId: this.runnerId,
    };

    try {
      await this.retryManager.execute(() =>
        this.transport.update(updatePayload),
      );
      this.leaseManager.renew();
    } catch {
      // If the update fails, force re-registration on next renewIfNeeded
      this.registered = false;
    }
  }

  /**
   * Deregister the runner from Yggdrasil.
   */
  async deregister(): Promise<void> {
    if (!this.registered) return;

    try {
      await this.transport.deregister({ runnerId: this.runnerId });
    } catch {
      // Best-effort deregistration
    } finally {
      this.registered = false;
      this.leaseManager.reset();
    }
  }

  /**
   * Returns whether the runner is currently registered.
   */
  isRegistered(): boolean {
    return this.registered;
  }
}
