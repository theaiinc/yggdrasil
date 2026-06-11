/**
 * System resources reported by a runner.
 */
export interface SystemResources {
  cpu: {
    load1: number;
    load5: number;
    load15: number;
    cpus: number;
    percent: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  uptime: number;
}

/**
 * A task being executed or tracked on a runner.
 */
export interface RunnerTask {
  taskId: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  /** Correlation ID for tracing tasks across distributed workflows. */
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

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
  resources?: SystemResources;
  tasks?: RunnerTask[];
}

/**
 * Heartbeat payload sent to Yggdrasil.
 */
export interface HeartbeatPayload {
  runnerId: string;
  timestamp: number;
  status: RunnerHealth;
  resources?: SystemResources;
  tasks?: RunnerTask[];
}

/**
 * Response returned by Yggdrasil after a heartbeat.
 * Can carry a pending update request that the runner should process
 * after its current tasks complete.
 */
export interface HeartbeatResponse {
  status: string;
  pendingUpdate?: PendingUpdate;
}

/**
 * An update request sent from Yggdrasil to a runner.
 * The runner should defer execution until all running tasks complete,
 * then run the update command and restart.
 */
export interface PendingUpdate {
  /** Version string to update to (e.g. '0.2.0'). */
  version: string;
  /** Shell command to execute for the update (e.g. 'npm update -g @theaiinc/yggdrasil-ratatoskr'). */
  command?: string;
  /** URL to download a new binary/package from. */
  downloadUrl?: string;
  /** Arbitrary metadata (e.g. Docker image tag, commit hash). */
  metadata?: Record<string, unknown>;
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
  /** List of capabilities (presets) this runner advertises.
   *  Each name is looked up as a preset; transitive deps are resolved
   *  automatically. Unknown names pass through as-is. */
  capabilities?: string[];
  /** Heartbeat interval in seconds (default: 30). */
  heartbeatInterval?: number;
  /** Lease TTL in seconds (default: 60). */
  leaseTtl?: number;
  /** Task poll interval in seconds. Set to 0 to disable task execution (default: 10). */
  taskPollInterval?: number;
  /** Custom task handlers keyed by task type (e.g. { echo, exec, http } built-in). */
  taskHandlers?: Record<string, TaskHandler>;
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
  /** Send a heartbeat to Yggdrasil. Returns the response which may contain a pendingUpdate. */
  heartbeat(payload: HeartbeatPayload): Promise<HeartbeatResponse>;
  /** Update the runner's endpoint. */
  update(payload: EndpointUpdatePayload): Promise<void>;
  /** Deregister the runner. */
  deregister(payload: DeregisterPayload): Promise<void>;
  /** Fetch pending (running) tasks for a runner. */
  fetchTasks(runnerId: string, status?: string): Promise<RunnerTask[]>;
  /** Update a task's status and metadata. */
  updateTask(runnerId: string, taskId: string, update: { status?: 'running' | 'completed' | 'failed'; metadata?: Record<string, unknown> }): Promise<void>;
}

/**
 * Signature for a custom task handler function.
 * Receives the task and returns the outcome (status + result metadata).
 */
export type TaskHandler = (task: RunnerTask) => Promise<{
  status: 'completed' | 'failed';
  metadata?: Record<string, unknown>;
}>;

/**
 * Configuration for the TaskExecutor.
 */
export interface TaskExecutorConfig {
  /** Runner ID used to identify this runner when polling. */
  runnerId: string;
  /** Poll interval in seconds (default: 10). */
  pollInterval?: number;
  /** Custom task handlers keyed by task type. */
  handlers?: Record<string, TaskHandler>;
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
