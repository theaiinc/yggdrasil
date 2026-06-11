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
