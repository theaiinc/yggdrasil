import { AgentInfo, RequestContext } from '@/types';
import { getLogger } from './logger';

/**
 * Load balancer for distributing requests across healthy agents
 * Implements multiple algorithms and session affinity
 */
export class LoadBalancer {
  private logger = getLogger();
  private currentIndex = 0;
  private sessionMap = new Map<string, string>(); // sessionId -> agentId
  private algorithm:
    | 'round-robin'
    | 'least-connections'
    | 'ip-hash'
    | 'weighted';
  private sessionAffinity: boolean;
  private stickySessionTimeout: number;

  constructor(
    algorithm:
      | 'round-robin'
      | 'least-connections'
      | 'ip-hash'
      | 'weighted' = 'round-robin',
    sessionAffinity: boolean = true,
    stickySessionTimeout: number = 3600000 // 1 hour
  ) {
    this.algorithm = algorithm;
    this.sessionAffinity = sessionAffinity;
    this.stickySessionTimeout = stickySessionTimeout;
  }

  /**
   * Select an agent for the given request
   */
  public selectAgent(
    agents: AgentInfo[],
    context: RequestContext
  ): AgentInfo | null {
    if (agents.length === 0) {
      this.logger.warn('No healthy agents available');
      return null;
    }

    // Filter to only healthy agents
    const healthyAgents = agents.filter(
      agent => agent.health.status === 'healthy'
    );

    if (healthyAgents.length === 0) {
      this.logger.warn('No healthy agents available');
      return null;
    }

    // Check session affinity first
    if (this.sessionAffinity && context.sessionId) {
      const sessionAgentId = this.sessionMap.get(context.sessionId);
      if (sessionAgentId) {
        const sessionAgent = healthyAgents.find(
          agent => agent.id === sessionAgentId
        );
        if (sessionAgent) {
          this.logger.debug('Using session affinity', {
            sessionId: context.sessionId,
            agentId: sessionAgent.id,
          });
          return sessionAgent;
        } else {
          // Remove stale session mapping
          this.sessionMap.delete(context.sessionId);
        }
      }
    }

    // Select agent based on algorithm
    let selectedAgent: AgentInfo | null = null;

    try {
      switch (this.algorithm) {
        case 'round-robin':
          selectedAgent = this.roundRobin(healthyAgents);
          break;
        case 'least-connections':
          selectedAgent = this.leastConnections(healthyAgents);
          break;
        case 'ip-hash':
          selectedAgent = this.ipHash(healthyAgents, context);
          break;
        case 'weighted':
          selectedAgent = this.weighted(healthyAgents);
          break;
        default:
          selectedAgent = this.roundRobin(healthyAgents);
      }
    } catch (error) {
      this.logger.error('Agent selection failed', {
        error,
        algorithm: this.algorithm,
      });
      return null;
    }

    // Update session mapping if session affinity is enabled
    if (this.sessionAffinity && context.sessionId && selectedAgent) {
      this.sessionMap.set(context.sessionId, selectedAgent.id);

      // Clean up old session mappings periodically
      this.cleanupStaleSessions();
    }

    return selectedAgent;
  }

  /**
   * Round-robin algorithm
   */
  private roundRobin(agents: AgentInfo[]): AgentInfo {
    const agent = agents[this.currentIndex % agents.length];
    if (!agent) {
      throw new Error('No agents available for round-robin selection');
    }
    this.currentIndex = (this.currentIndex + 1) % agents.length;
    return agent;
  }

  /**
   * Least connections algorithm
   */
  private leastConnections(agents: AgentInfo[]): AgentInfo {
    return agents.reduce((min, current) =>
      current.metrics.activeConnections < min.metrics.activeConnections
        ? current
        : min
    );
  }

  /**
   * IP hash algorithm (uses request ID as hash input)
   */
  private ipHash(agents: AgentInfo[], context: RequestContext): AgentInfo {
    const hash = this.hashCode(context.id);
    const agent = agents[Math.abs(hash) % agents.length];
    if (!agent) {
      throw new Error('No agents available for IP hash selection');
    }
    return agent;
  }

  /**
   * Weighted algorithm (based on agent health and performance)
   */
  private weighted(agents: AgentInfo[]): AgentInfo {
    const weights = agents.map(agent => {
      let weight = 1;

      // Reduce weight for agents with high error rates
      if (agent.metrics.errorRate > 0.1) {
        weight *= 0.5;
      }

      // Reduce weight for agents with high response times
      if (agent.metrics.averageResponseTime > 1000) {
        weight *= 0.7;
      }

      // Increase weight for agents with low CPU usage
      if (agent.metrics.cpuUsage < 0.5) {
        weight *= 1.2;
      }

      return { agent, weight };
    });

    // Sort by weight and return the highest weighted agent
    weights.sort((a, b) => b.weight - a.weight);
    const selectedAgent = weights[0]?.agent;
    if (!selectedAgent) {
      throw new Error('No agents available for weighted selection');
    }
    return selectedAgent;
  }

  /**
   * Simple hash function for IP hash algorithm
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Clean up stale session mappings
   */
  private cleanupStaleSessions(): void {
    const staleSessions: string[] = [];

    // This is a simplified cleanup - in a real implementation,
    // you'd want to track session creation times
    if (this.sessionMap.size > 1000) {
      // If we have too many sessions, clean up some randomly
      const sessions = Array.from(this.sessionMap.keys());
      const toRemove = Math.floor(sessions.length * 0.1); // Remove 10%

      for (let i = 0; i < toRemove; i++) {
        const randomIndex = Math.floor(Math.random() * sessions.length);
        const sessionId = sessions[randomIndex];
        if (sessionId) {
          staleSessions.push(sessionId);
          sessions.splice(randomIndex, 1);
        }
      }
    }

    staleSessions.forEach(sessionId => {
      this.sessionMap.delete(sessionId);
    });

    if (staleSessions.length > 0) {
      this.logger.debug('Cleaned up stale sessions', {
        count: staleSessions.length,
      });
    }
  }

  /**
   * Remove session mapping
   */
  public removeSession(sessionId: string): void {
    this.sessionMap.delete(sessionId);
  }

  /**
   * Get session statistics
   */
  public getSessionStats(): { totalSessions: number; sessionMapSize: number } {
    return {
      totalSessions: this.sessionMap.size,
      sessionMapSize: this.sessionMap.size,
    };
  }

  /**
   * Update algorithm
   */
  public setAlgorithm(
    algorithm: 'round-robin' | 'least-connections' | 'ip-hash' | 'weighted'
  ): void {
    this.algorithm = algorithm;
    this.logger.info('Load balancer algorithm updated', { algorithm });
  }

  /**
   * Update session affinity settings
   */
  public setSessionAffinity(enabled: boolean, timeout?: number): void {
    this.sessionAffinity = enabled;
    if (timeout) {
      this.stickySessionTimeout = timeout;
    }
    this.logger.info('Session affinity settings updated', {
      enabled: this.sessionAffinity,
      timeout: this.stickySessionTimeout,
    });
  }
}
