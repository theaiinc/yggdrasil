/**
 * Runtime types for the Yggdrasil orchestration system.
 *
 * These types define the wire protocol between Yggdrasil (the controller)
 * and Ratatoskr (the runner daemon). They are consumed by both the
 * controller itself and by custom pools (like Oasis yggdrasil-pool.ts)
 * that embed the controller API.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'simple';
  transports: string[];
}

// ─── Realm lifecycle types ────────────────────────────────────────────

/**
 * Registration payload sent by a Realm instance (via Ratatoskr) to Yggdrasil.
 * Realm announces itself after boot.
 */
export interface RealmRegistration {
  realmId: string;
  runnerId: string;
  /** The template type this realm was spawned from (e.g. "ubuntu", "android"). */
  template: RealmTemplateType;
  /** Realm software version. */
  version: string;
  /** Capabilities this realm instance provides. */
  capabilities: SessionCapability[];
  /** Live endpoints for observation and input. */
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

/** Types of execution environments a runner can host. */
export type RealmTemplateType = 'ubuntu' | 'android' | 'browser' | 'windows';

/** Lifecycle states for a Realm instance. */
export type RealmState = 'creating' | 'running' | 'paused' | 'unhealthy' | 'destroyed';

/**
 * A realm template advertised by a runner via Ratatoskr.
 * Templates describe what kinds of environments a runner CAN spawn,
 * not what is currently running.
 */
export interface RealmTemplate {
  id: string;
  type: RealmTemplateType;
  /** Capabilities this template provides when a realm is spawned (e.g. ["observe", "mouse", "keyboard"]). */
  capabilities: SessionCapability[];
}

/**
 * A running Realm instance — the actual execution environment that sessions attach to.
 *
 * Sessions do NOT run on runners. Sessions run on realms. Realms run on runners.
 */
export interface Realm {
  id: string;
  templateId: string;
  runnerId: string;
  /** The entity that owns or requested this realm (used for persistent realm affinity). */
  ownerId?: string | undefined;
  state: RealmState;
  endpoints: {
    /** Full URL for observation (e.g. screenshots, a11y tree). */
    observation: string;
    /** Full URL for input (e.g. click, type, scroll). */
    input: string;
  };
  createdAt: string;
  updatedAt: string;
  /** Timestamp of the last heartbeat received from this realm. */
  lastHeartbeat?: string | undefined;
  /** Future: Veil-issued token for authenticating realm operations. */
  registrationToken?: string | undefined;
  /** Pool tag — if set, this realm can be reused for sessions matching the same template+owner. */
  poolTag?: string | undefined;
}

/**
 * Result of a scheduling decision. The scheduler returns an allocation;
 * the provisioner acts on it.
 */
export interface RealmAllocation {
  runnerId: string;
  template: RealmTemplate;
  /** Whether to spawn a new realm or attach to an existing one. */
  action: 'spawn' | 'attach';
  /** Set when attaching to an existing realm. */
  realmId?: string | undefined;
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

// ─── Runner & task wire types ───────────────────────────────────────────────

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

export interface PendingUpdate {
  version: string;
  command?: string;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface RunnerTask {
  taskId: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface RunnerInfo {
  runnerId: string;
  name: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  /** Realm templates this runner can spawn. */
  realmTemplates: RealmTemplate[];
  labels: Record<string, string>;
  lastHeartbeat: Date;
  status: 'online' | 'offline';
  resources?: SystemResources;
  tasks: RunnerTask[];
  pendingUpdate?: PendingUpdate;
}

// ─── API request/response types ────────────────────────────────────────────

export interface RegisterRunnerPayload {
  runnerId?: string;
  name?: string;
  endpoint?: string;
  version?: string;
  capabilities?: string[];
  /** Realm templates this runner can spawn. */
  realmTemplates?: RealmTemplate[];
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
  resources?: SystemResources;
  tasks?: RunnerTask[];
}

export interface HeartbeatPayload {
  runnerId?: string;
  timestamp?: number;
  status?: string;
  resources?: SystemResources;
  tasks?: RunnerTask[];
}

export interface HeartbeatResponse {
  status: string;
  pendingUpdate?: PendingUpdate;
}

export interface RequestUpdatePayload {
  version: string;
  command?: string;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
}
