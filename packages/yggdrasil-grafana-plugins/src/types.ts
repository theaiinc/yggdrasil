/** Plugin options configured in the panel editor. */
export interface PluginOptions {
  /** Yggdrasil server URL (e.g. http://orchestration-controller:3000). */
  yggdrasilUrl: string;
  /** Admin API key for X-Admin-Api-Key authentication. */
  adminApiKey: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
  uptime: number;
  runners: { total: number; online: number; offline: number };
}

export interface RunnerInfo {
  runnerId: string;
  name: string;
  version: string;
  status: string;
  outdated: boolean;
  hasPendingUpdate: boolean;
  hasPendingApiKey: boolean;
  updateStatus: string;
  updateLog: string;
}

export interface RunnersResponse {
  runners: RunnerInfo[];
  expectedVersion: string | null;
  count: number;
}
