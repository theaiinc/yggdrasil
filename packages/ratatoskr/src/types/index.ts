/**
 * Enum representing the health state of a runner.
 */
export enum RunnerHealth {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/**
 * Metadata sent during runner registration.
 */
export interface RunnerRegistration {
  runnerId: string;
  name: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Heartbeat payload sent to Yggdrasil.
 */
export interface HeartbeatPayload {
  runnerId: string;
  timestamp: number;
  status: RunnerHealth;
}

/**
 * Endpoint update payload sent when the runner's IP/endpoint changes.
 */
export interface EndpointUpdatePayload {
  runnerId: string;
  oldEndpoint: string;
  newEndpoint: string;
}

/**
 * Deregistration payload sent on shutdown.
 */
export interface DeregisterPayload {
  runnerId: string;
}

/**
 * Result returned by a health provider callback.
 */
export interface HealthResult {
  status: RunnerHealth;
  details?: string;
}

/**
 * Configuration for the Ratatoskr instance.
 */
export interface RatatoskrConfig {
  /** Unique runner identifier (auto-generated if omitted). */
  runnerId?: string;
  /** Human-readable runner name (defaults to hostname). */
  name?: string;
  /** Yggdrasil server URL. */
  yggdrasilUrl: string;
  /** API key for authenticating with Yggdrasil. */
  apiKey?: string;
  /** List of capabilities this runner advertises. */
  capabilities?: string[];
  /** Heartbeat interval in seconds (default: 30). */
  heartbeatInterval?: number;
  /** Lease TTL in seconds (default: 60). */
  leaseTtl?: number;
  /** Custom endpoint provider for advanced endpoint detection. */
  endpointProvider?: () => Promise<string>;
  /** Custom health provider for advanced health checks. */
  healthProvider?: () => Promise<HealthResult>;
  /** Whether to detect local IP (default: true). */
  detectLocalIp?: boolean;
  /** Whether to detect public IP (default: false). */
  detectPublicIp?: boolean;
  /** Additional labels to attach to the registration. */
  labels?: Record<string, string>;
  /** Additional metadata to attach to the registration. */
  metadata?: Record<string, unknown>;
}

/**
 * Transport abstraction for communicating with Yggdrasil.
 */
export interface Transport {
  /** Register the runner with Yggdrasil. */
  register(payload: RunnerRegistration): Promise<void>;
  /** Send a heartbeat to Yggdrasil. */
  heartbeat(payload: HeartbeatPayload): Promise<void>;
  /** Update the runner's endpoint. */
  update(payload: EndpointUpdatePayload): Promise<void>;
  /** Deregister the runner. */
  deregister(payload: DeregisterPayload): Promise<void>;
}

/**
 * Internal state tracked by Ratatoskr.
 */
export interface RatatoskrState {
  runnerId: string;
  runnerName: string;
  version: string;
  endpoint: string;
  lastHealth: RunnerHealth;
  running: boolean;
}
