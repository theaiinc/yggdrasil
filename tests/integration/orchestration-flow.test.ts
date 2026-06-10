import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../src/services/agent-manager';
import { LoadBalancer } from '../../src/services/load-balancer';
import { RequestContext } from '../../src/types';

describe('Orchestration Flow Integration', () => {
  let agentManager: AgentManager;
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    agentManager = new AgentManager('/health');
    loadBalancer = new LoadBalancer('round-robin', true, 3600000);
  });

  afterEach(() => {
    agentManager.stopHealthChecks();
  });

  describe('End-to-End Request Flow', () => {
    it('should route request through complete flow', async () => {
      // 1. Register agents
      const agentId1 = agentManager.registerAgent(
        'http://localhost:8080',
        'session-1'
      );
      agentManager.registerAgent('http://localhost:8081', 'session-2');

      // 2. Update agent health to healthy
      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // 3. Create request context
      const context: RequestContext = {
        id: 'req-1',
        sessionId: 'session-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // 4. Select agent using load balancer
      const selectedAgent = loadBalancer.selectAgent(healthyAgents, context);

      expect(selectedAgent).toBeDefined();
      expect(selectedAgent?.id).toBe(agentId1); // Should select agent with session-1
    });

    it('should handle session affinity correctly', async () => {
      // Register agents with different sessions
      agentManager.registerAgent('http://localhost:8080', 'session-1');
      agentManager.registerAgent('http://localhost:8081', 'session-2');

      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Multiple requests with same session should go to same agent
      const context1: RequestContext = {
        id: 'req-1',
        sessionId: 'session-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const context2: RequestContext = {
        id: 'req-2',
        sessionId: 'session-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const agent1 = loadBalancer.selectAgent(healthyAgents, context1);
      const agent2 = loadBalancer.selectAgent(healthyAgents, context2);

      expect(agent1?.id).toBe(agent2?.id);
    });

    it('should handle agent failures gracefully', async () => {
      // Register agents
      const agentId1 = agentManager.registerAgent('http://localhost:8080');
      const agentId2 = agentManager.registerAgent('http://localhost:8081');

      // Simulate agent failure
      const agentsWithFailure = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status:
            agent.id === agentId1
              ? ('unhealthy' as const)
              : ('healthy' as const),
        },
      }));

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Should select healthy agent only
      const selectedAgent = loadBalancer.selectAgent(
        agentsWithFailure,
        context
      );
      expect(selectedAgent?.id).toBe(agentId2);
    });
  });

  describe('Load Balancing Algorithms', () => {
    beforeEach(() => {
      // Register multiple agents
      agentManager.registerAgent('http://localhost:8080');
      agentManager.registerAgent('http://localhost:8081');
      agentManager.registerAgent('http://localhost:8082');
    });

    it('should distribute load using round-robin', () => {
      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected1 = loadBalancer.selectAgent(healthyAgents, context);
      const selected2 = loadBalancer.selectAgent(healthyAgents, context);
      const selected3 = loadBalancer.selectAgent(healthyAgents, context);
      const selected4 = loadBalancer.selectAgent(healthyAgents, context);

      // Should cycle through agents
      expect(selected1?.id).not.toBe(selected2?.id);
      expect(selected2?.id).not.toBe(selected3?.id);
      expect(selected3?.id).not.toBe(selected4?.id);
      expect(selected4?.id).toBe(selected1?.id);
    });

    it('should select least loaded agent', () => {
      loadBalancer.setAlgorithm('least-connections');

      const healthyAgents = agentManager.getAllAgents().map((agent, index) => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
        metrics: {
          ...agent.metrics,
          activeConnections: index + 1, // Different connection counts
        },
      }));

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected = loadBalancer.selectAgent(healthyAgents, context);
      expect(selected?.metrics.activeConnections).toBe(1); // Should select agent with least connections
    });
  });

  describe('Health Check Integration', () => {
    it('should update agent health and affect load balancing', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Initially agent is unknown
      let healthyAgents = agentManager.getHealthyAgents();
      expect(healthyAgents).toHaveLength(0);

      // Simulate health check update
      agentManager.updateAgentMetrics(agentId, {
        activeConnections: 5,
      });

      const agent = agentManager.getAgent(agentId);
      if (agent) {
        agent.health.status = 'healthy';
      }

      // Now should have healthy agents
      healthyAgents = agentManager.getHealthyAgents();
      expect(healthyAgents).toHaveLength(1);
    });
  });

  describe('Session Management Integration', () => {
    it('should maintain session state across requests', () => {
      const sessionId = 'session-123';

      // Register agent with session
      agentManager.registerAgent('http://localhost:8080', sessionId);

      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      const context: RequestContext = {
        id: 'req-1',
        sessionId,
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // First request
      const agent1 = loadBalancer.selectAgent(healthyAgents, context);

      // Second request with same session
      const agent2 = loadBalancer.selectAgent(healthyAgents, context);

      // Should be same agent
      expect(agent1?.id).toBe(agent2?.id);

      // Session should be mapped
      const stats = loadBalancer.getSessionStats();
      expect(stats.totalSessions).toBe(1);
    });
  });
});
