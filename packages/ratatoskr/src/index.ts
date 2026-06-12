export { Ratatoskr } from './ratatoskr.js';

export { HttpTransport } from './transports/http-transport.js';
export { EndpointDetector } from './services/endpoint-detector.js';
export { HealthMonitor } from './services/health-monitor.js';
export { HeartbeatSender } from './services/heartbeat-sender.js';
export { LeaseManager } from './services/lease-manager.js';
export { Registrar } from './services/registrar.js';
export { RetryManager } from './services/retry-manager.js';

export { ResourceCollector } from './services/resource-collector.js';
export { TaskExecutor } from './services/task-executor.js';
export { UpdateManager } from './services/update-manager.js';

// Export preset system
export { registerPreset, getPreset, listPresets, combinePresets, generateDockerfile, applyPresetDefaults, resolveCapabilities } from './presets/index.js';
export type { CapabilityPreset, CombinedPreset, DockerfileOptions, PresetEnvVar, PresetHandler, PresetFile } from './presets/index.js';
export { llm, webSearch, shell, agent, codeRunner, python, nodeRuntime, githubCli, computerUse, android } from './presets/builtins.js';

// Export types
export type { Transport } from './types/index.js';
export type {
  RatatoskrConfig,
  RatatoskrState,
  RunnerRegistration,
  HeartbeatPayload,
  HeartbeatResponse,
  PendingUpdate,
  EndpointUpdatePayload,
  DeregisterPayload,
  HealthResult,
  SystemResources,
  RunnerTask,
  TaskHandler,
  TaskExecutorConfig,

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
  SessionManagerConfig,

  // Realm types
  RealmTemplateType,
  RealmTemplate,
} from './types/index.js';

// Export enum
export { RunnerHealth } from './types/index.js';
