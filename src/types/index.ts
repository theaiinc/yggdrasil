/**
 * Core types for the Yggdrasil orchestration system
 */

export interface AgentInfo {
  id: string;
  url: string;
  health: AgentHealth;
  metrics: AgentMetrics;
  lastSeen: Date;
  sessionId?: string;
}

export interface AgentHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  responseTime: number;
  errorCount: number;
  consecutiveFailures: number;
}

export interface AgentMetrics {
  cpuUsage: number;
  memoryUsage: number;
  requestCount: number;
  errorRate: number;
  averageResponseTime: number;
  activeConnections: number;
}

export interface RequestContext {
  id: string;
  sessionId?: string;
  timestamp: Date;
  priority: 'low' | 'normal' | 'high' | 'critical';
  retryCount: number;
  maxRetries: number;
  timeout: number;
}

export interface OrchestrationConfig {
  maxConcurrency: number;
  minInstances: number;
  maxInstances: number;
  healthCheckInterval: number;
  retryBackoffMs: number;
  maxRetries: number;
  sessionAffinity: boolean;
  circuitBreakerThreshold: number;
  queueTimeoutMs: number;
}

export interface LoadBalancerConfig {
  algorithm: 'round-robin' | 'least-connections' | 'ip-hash' | 'weighted';
  healthCheckPath: string;
  healthCheckInterval: number;
  sessionAffinity: boolean;
  stickySessionTimeout: number;
}

export interface MonitoringConfig {
  prometheusEnabled: boolean;
  prometheusPort: number;
  grafanaEnabled: boolean;
  grafanaPort: number;
  customMetrics: boolean;
  alertingEnabled: boolean;
}

export interface QueueItem {
  id: string;
  request: Record<string, unknown>;
  context: RequestContext;
  timestamp: Date;
  priority: number;
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: Date;
  nextAttemptTime: Date;
}

export interface ScalingMetrics {
  currentInstances: number;
  targetInstances: number;
  cpuUtilization: number;
  memoryUtilization: number;
  queueDepth: number;
  errorRate: number;
  responseTime: number;
}

export interface HealthCheckResult {
  agentId: string;
  healthy: boolean;
  responseTime: number;
  error?: string;
  timestamp: Date;
}

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  createdAt: Date;
  lastActivity: Date;
  requestCount: number;
}

export interface MetricsData {
  timestamp: Date;
  agentId: string;
  metrics: AgentMetrics;
  scalingMetrics: ScalingMetrics;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'simple';
  transports: string[];
}

export interface DockerConfig {
  image: string;
  tag: string;
  ports: number[];
  environment: Record<string, string>;
  volumes: string[];
  resourceLimits: {
    cpu: string;
    memory: string;
  };
}

export interface CloudRunConfig {
  serviceName: string;
  region: string;
  maxConcurrency: number;
  minInstances: number;
  maxInstances: number;
  cpu: number;
  memory: string;
  timeout: number;
}

export interface DeploymentConfig {
  environment: 'local' | 'staging' | 'production';
  docker: DockerConfig;
  cloudRun?: CloudRunConfig;
  monitoring: MonitoringConfig;
  orchestration: OrchestrationConfig;
  loadBalancer: LoadBalancerConfig;
}
