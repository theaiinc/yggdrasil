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

// ─── Session types ─────────────────────────────────────────────────────────

/** Supported session types for interaction with execution environments. */
export type SessionType = 'computer-use' | 'phone-use';

/** Lifecycle states for a session. */
export type SessionState = 'creating' | 'active' | 'paused' | 'completed' | 'failed' | 'terminated';

/** Observation method chosen by Realm — consumers must not depend on a specific implementation. */
export type ObservationMethod = 'accessibility_tree' | 'dom_snapshot' | 'screenshot' | 'video_stream' | 'hybrid';

/** Input capabilities a session may expose. */
export type InputCapability = 'mouse' | 'keyboard' | 'touch' | 'scroll' | 'drag' | 'clipboard';

/**
 * Capabilities a session may support — used for session contracts and Veil authorization.
 * Broader than InputCapability: includes observation and device-level capabilities.
 */
export type SessionCapability = 'observe' | 'mouse' | 'keyboard' | 'touch' | 'scroll' | 'drag' | 'clipboard' | 'audio' | 'camera';

// ─── Realm types ────────────────────────────────────────────────────

/** Types of execution environments a runner can host. */
export type RealmTemplateType = 'ubuntu' | 'android' | 'browser' | 'windows';

/** A realm template advertised by a runner — describes what CAN be spawned. */
export interface RealmTemplate {
  id: string;
  type: RealmTemplateType;
  capabilities: SessionCapability[];
}

/**
 * Descriptor for an active session.
 *
 * Yggdrasil is the **control plane** — it creates/terminates/pauses/resumes sessions.
 * Realm is the **data plane** — observation and input go DIRECTLY to Realm endpoints,
 * NOT through Yggdrasil.
 *
 * Consumers (Cognition via ComputerUseRuntime) use observationEndpoint and
 * inputEndpoint to talk to Realm directly. Yggdrasil never proxies observe/input calls.
 */
export interface SessionDescriptor {
  id: string;
  type: SessionType;
  state: SessionState;
  /** Full Realm URL for observation (e.g. screenshots, a11y tree, DOM). Consumers talk to Realm directly. */
  observationEndpoint: string;
  /** Full Realm URL for input (e.g. click, type, scroll). Consumers talk to Realm directly. */
  inputEndpoint: string;
  /** Capabilities this session supports (e.g. ["mouse", "keyboard"]). */
  capabilities: SessionCapability[];
  /** The observation method Realm chose (internal detail — informational only). */
  observationMethod: ObservationMethod;
  /** Realm ID backing this session. */
  realmId: string;
  /** Identity of the entity that owns this session. */
  ownerId?: string | undefined;
  /** Identities of participants allowed to interact with this session. */
  participantIds?: string[] | undefined;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

/** Request to create a new interaction session. */
export interface CreateSessionRequest {
  type: SessionType;
  ownerId?: string | undefined;
  participantIds?: string[] | undefined;
  /** Requested capabilities for this session. If omitted, type defaults apply. */
  capabilities?: SessionCapability[] | undefined;
  realmId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Response from creating a session. */
export interface CreateSessionResponse {
  sessionId: string;
  descriptor: SessionDescriptor;
}

/** Observation payload returned by a session's observe endpoint. */
export interface SessionObservation {
  /** Base64-encoded screenshot (when method is screenshot or hybrid). */
  screenshot?: string | undefined;
  /** Accessibility tree snapshot (when method is accessibility_tree or hybrid). */
  accessibilityTree?: unknown;
  /** DOM snapshot (when method is dom_snapshot or hybrid). */
  domSnapshot?: unknown;
  /** Whether PII redaction was applied. */
  piiRedacted?: boolean | undefined;
  /** Timestamp of the observation. */
  timestamp: string;
  /** Structured data for JSON-based observation (e.g. UI element tree). */
  data?: Record<string, unknown> | undefined;
}

/** Input action sent to a session. */
export interface SessionInput {
  type: InputCapability;
  params: Record<string, unknown>;
}

/** Result of an input action. */
export interface SessionInputResult {
  success: boolean;
  error?: string | undefined;
}

/** Session health reported by Ratatoskr to Yggdrasil. */
export interface SessionHealth {
  sessionId: string;
  state: SessionState;
  realmId: string;
  lastObservationAt?: string | undefined;
  lastInputAt?: string | undefined;
  errorCount: number;
}

// ─── Realm lifecycle types ────────────────────────────────────────────

/**
 * Registration payload sent by a Realm instance (via Ratatoskr) to Yggdrasil.
 * Realm announces itself after boot.
 */
export interface RealmRegistration {
  realmId: string;
  runnerId: string;
  template: RealmTemplateType;
  version: string;
  capabilities: SessionCapability[];
  endpoints: {
    observation: string;
    input: string;
  };
  /** Future: Veil-issued token for authenticating registrations. */
  registrationToken?: string | undefined;
  startedAt: string;
}

/**
 * Periodic heartbeat from a Realm instance (via Ratatoskr) to Yggdrasil.
 */
export interface RealmHeartbeat {
  realmId: string;
  uptime: number;
  healthy: boolean;
  memoryMb?: number | undefined;
  cpuPercent?: number | undefined;
  activeSessions: number;
}

/**
 * Deregistration payload sent by a Realm instance on shutdown.
 */
export interface RealmDeregistration {
  realmId: string;
  reason: 'shutdown' | 'error' | 'replaced';
}

/**
 * Configuration for a Ratatoskr SessionManager that bridges
 * session requests from Yggdrasil to a Realm API server.
 */
export interface SessionManagerConfig {
  realmUrl: string;
  realmApiKey?: string;
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
  /** Realm templates this runner can host. */
  realmTemplates?: RealmTemplate[];
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
  /** Realm templates this runner can host (e.g. ubuntu, android, browser). */
  realmTemplates?: RealmTemplate[];
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

  // ── Realm lifecycle relays (Realm → Ratatoskr → Yggdrasil) ─────────

  /** Relay a realm registration to Yggdrasil. */
  registerRealm(payload: RealmRegistration): Promise<void>;
  /** Relay a realm heartbeat to Yggdrasil. */
  heartbeatRealm(payload: RealmHeartbeat): Promise<void>;
  /** Relay a realm deregistration to Yggdrasil. */
  deregisterRealm(payload: RealmDeregistration): Promise<void>;

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
