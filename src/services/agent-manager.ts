import axios, { AxiosResponse } from 'axios';
import { AgentInfo, AgentMetrics, HealthCheckResult } from '@/types';
import { getLogger } from './logger';
import { nanoid } from 'nanoid';

/**
 * Manages agent registration, health checks, and lifecycle
 * Uses stable, well-documented libraries for reliability
 */
export class AgentManager {
  private agents: Map<string, AgentInfo> = new Map();
  private logger = getLogger();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckPath: string;

  constructor(healthCheckPath: string = '/health') {
    this.healthCheckPath = healthCheckPath;
  }

  /**
   * Register a new agent
   */
  public registerAgent(url: string, sessionId?: string): string {
    const agentId = nanoid();
    const agentInfo: AgentInfo = {
      id: agentId,
      url,
      health: {
        status: 'unknown',
        lastCheck: new Date(),
        responseTime: 0,
        errorCount: 0,
        consecutiveFailures: 0,
      },
      metrics: {
        cpuUsage: 0,
        memoryUsage: 0,
        requestCount: 0,
        errorRate: 0,
        averageResponseTime: 0,
        activeConnections: 0,
      },
      lastSeen: new Date(),
      ...(sessionId && { sessionId }),
    };

    this.agents.set(agentId, agentInfo);
    this.logger.info('Agent registered', { agentId, url, sessionId });
    return agentId;
  }

  /**
   * Unregister an agent
   */
  public unregisterAgent(agentId: string): boolean {
    const removed = this.agents.delete(agentId);
    if (removed) {
      this.logger.info('Agent unregistered', { agentId });
    }
    return removed;
  }

  /**
   * Get all healthy agents
   */
  public getHealthyAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.health.status === 'healthy'
    );
  }

  /**
   * Get agent by ID
   */
  public getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent by session ID
   */
  public getAgentBySession(sessionId: string): AgentInfo | undefined {
    return Array.from(this.agents.values()).find(
      agent => agent.sessionId === sessionId
    );
  }

  /**
   * Start health check monitoring
   */
  public startHealthChecks(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);

    this.logger.info('Health checks started', { intervalMs });
  }

  /**
   * Stop health check monitoring
   */
  public stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.logger.info('Health checks stopped');
    }
  }

  /**
   * Perform health check on a specific agent
   */
  public async checkAgentHealth(agentId: string): Promise<HealthCheckResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return {
        agentId,
        healthy: false,
        responseTime: 0,
        error: 'Agent not found',
        timestamp: new Date(),
      };
    }

    const startTime = Date.now();
    try {
      const response: AxiosResponse = await axios.get(
        `${agent.url}${this.healthCheckPath}`,
        { timeout: 5000 }
      );

      const responseTime = Date.now() - startTime;
      const healthy = response.status === 200;

      // Update agent health
      agent.health = {
        status: healthy ? 'healthy' : 'unhealthy',
        lastCheck: new Date(),
        responseTime,
        errorCount: healthy
          ? agent.health.errorCount
          : agent.health.errorCount + 1,
        consecutiveFailures: healthy ? 0 : agent.health.consecutiveFailures + 1,
      };

      agent.lastSeen = new Date();

      this.logger.info('Agent health check completed', {
        agentId,
        healthy,
        responseTime,
        status: agent.health.status,
      });

      return {
        agentId,
        healthy,
        responseTime,
        timestamp: new Date(),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update agent health
      agent.health = {
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime,
        errorCount: agent.health.errorCount + 1,
        consecutiveFailures: agent.health.consecutiveFailures + 1,
      };

      this.logger.warn('Agent health check failed', {
        agentId,
        error: errorMessage,
        responseTime,
      });

      return {
        agentId,
        healthy: false,
        responseTime,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Perform health checks on all agents
   */
  private async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.agents.keys()).map(agentId =>
      this.checkAgentHealth(agentId)
    );

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      this.logger.error('Health check batch failed', { error });
    }
  }

  /**
   * Update agent metrics
   */
  public updateAgentMetrics(
    agentId: string,
    metrics: Partial<AgentMetrics>
  ): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.metrics = { ...agent.metrics, ...metrics };
      agent.lastSeen = new Date();
    }
  }

  /**
   * Get all agents
   */
  public getAllAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent count by health status
   */
  public getAgentCounts(): {
    total: number;
    healthy: number;
    unhealthy: number;
  } {
    const agents = this.getAllAgents();
    return {
      total: agents.length,
      healthy: agents.filter(a => a.health.status === 'healthy').length,
      unhealthy: agents.filter(a => a.health.status === 'unhealthy').length,
    };
  }

  /**
   * Clean up stale agents (not seen for more than threshold)
   */
  public cleanupStaleAgents(thresholdMs: number = 300000): number {
    const now = new Date();
    const staleAgents: string[] = [];

    for (const [agentId, agent] of this.agents.entries()) {
      const timeSinceLastSeen = now.getTime() - agent.lastSeen.getTime();
      if (timeSinceLastSeen > thresholdMs) {
        staleAgents.push(agentId);
      }
    }

    staleAgents.forEach(agentId => {
      this.unregisterAgent(agentId);
    });

    if (staleAgents.length > 0) {
      this.logger.info('Cleaned up stale agents', {
        count: staleAgents.length,
        agentIds: staleAgents,
      });
    }

    return staleAgents.length;
  }
}
