// Main entry point for @theaiinc/yggdrasil package

export { Logger } from './services/logger.js';
export { app, runners, sessions, realmRegistry, realmScheduler, realmProvisioner, realmLifecycle, npmVersionChecker, YGGDRASIL_VERSION } from './orchestration-controller.js';

export { RealmRegistry } from './services/realm-registry.js';
export { RealmScheduler } from './services/realm-scheduler.js';
export { RealmProvisioner } from './services/realm-provisioner.js';
export { RealmLifecycleService } from './services/realm-lifecycle.js';
export { NpmVersionChecker } from './services/npm-version-checker.js';
export type { NpmVersionInfo } from './services/npm-version-checker.js';

// Export all runtime types (controller wire protocol)
export type {
  LogLevel,
  LoggerConfig,

  // Session types
  SessionType,
  SessionState,
  ObservationMethod,
  InputCapability,
  SessionDescriptor,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionObservation,
  SessionInput,
  SessionInputResult,
  SessionHealth,

  // Realm types
  RealmTemplateType,
  RealmState,
  RealmTemplate,
  Realm,
  RealmAllocation,
  RealmRegistration,
  RealmHeartbeat,
  RealmDeregistration,

  // Runner & task wire types
  SystemResources,
  PendingUpdate,
  RunnerTask,
  RunnerInfo,

  // API request/response types
  RegisterRunnerPayload,
  HeartbeatPayload,
  HeartbeatResponse,
  RequestUpdatePayload,
} from './types/index.js';
