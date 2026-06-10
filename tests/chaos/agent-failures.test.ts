import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../src/services/agent-manager';
import { LoadBalancer } from '../../src/services/load-balancer';
import { RequestContext } from '../../src/types';

describe('Chaos Testing - Agent Failures', () => {
  let agentManager: AgentManager;
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    agentManager = new AgentManager('/health');
    loadBalancer = new LoadBalancer('round-robin', true, 3600000);
  });

  afterEach(() => {
    agentManager.stopHealthChecks();
  });

  describe('Agent Container Failures', () => {
    it('should handle single agent failure gracefully', async () => {
      // Setup multiple agents
      const agentId1 = agentManager.registerAgent('http://localhost:8080');
      const agentId2 = agentManager.registerAgent('http://localhost:8081');
      const agentId3 = agentManager.registerAgent('http://localhost:8082');

      // Initially all agents are healthy
      const allAgents = agentManager.getAllAgents().map(agent => ({
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

      // Simulate agent failure
      const agentsWithFailure = allAgents.map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status:
            agent.id === agentId1
              ? ('unhealthy' as const)
              : ('healthy' as const),
        },
      }));

      // Should still be able to route requests to healthy agents
      const selectedAgent = loadBalancer.selectAgent(
        agentsWithFailure,
        context
      );
      expect(selectedAgent).toBeDefined();
      expect(selectedAgent?.id).not.toBe(agentId1); // Should not select failed agent
      expect([agentId2, agentId3]).toContain(selectedAgent?.id);
    });

    it('should handle multiple agent failures', async () => {
      // Setup multiple agents
      for (let i = 0; i < 5; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      const allAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Simulate multiple failures (3 out of 5 agents fail)
      const agentsWithFailures = allAgents.map((agent, index) => ({
        ...agent,
        health: {
          ...agent.health,
          status: index < 3 ? ('unhealthy' as const) : ('healthy' as const),
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

      // Should still be able to route to remaining healthy agents
      const selectedAgent = loadBalancer.selectAgent(
        agentsWithFailures,
        context
      );
      expect(selectedAgent).toBeDefined();
      expect(selectedAgent?.health.status).toBe('healthy');
    });

    it('should handle complete agent failure gracefully', async () => {
      // Setup single agent
      agentManager.registerAgent('http://localhost:8080');

      const allAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'unhealthy' as const,
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

      // Should return null when no healthy agents available
      const selectedAgent = loadBalancer.selectAgent(allAgents, context);
      expect(selectedAgent).toBeNull();
    });
  });

  describe('Network Partition Simulation', () => {
    it('should handle network partition affecting some agents', async () => {
      // Setup agents in different network segments
      agentManager.registerAgent('http://segment-a:8080');
      agentManager.registerAgent('http://segment-b:8080');
      agentManager.registerAgent('http://segment-c:8080');

      const allAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Simulate network partition affecting segment-a
      const agentsWithPartition = allAgents.map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: agent.url.includes('segment-a')
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

      // Should route to agents in unaffected segments
      const selectedAgent = loadBalancer.selectAgent(
        agentsWithPartition,
        context
      );
      expect(selectedAgent).toBeDefined();
      expect(selectedAgent?.url).not.toContain('segment-a');
    });

    it('should handle intermittent connectivity issues', async () => {
      agentManager.registerAgent('http://localhost:8080');

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Simulate intermittent connectivity
      const scenarios = [
        { status: 'healthy' as const, expectedResult: 'success' },
        { status: 'unhealthy' as const, expectedResult: 'failure' },
        { status: 'healthy' as const, expectedResult: 'success' },
      ];

      for (const scenario of scenarios) {
        const agents = agentManager.getAllAgents().map(agent => ({
          ...agent,
          health: {
            ...agent.health,
            status: scenario.status,
          },
        }));

        const selectedAgent = loadBalancer.selectAgent(agents, context);

        if (scenario.expectedResult === 'success') {
          expect(selectedAgent).toBeDefined();
          expect(selectedAgent?.health.status).toBe('healthy');
        } else {
          expect(selectedAgent).toBeNull();
        }
      }
    });
  });

  describe('Resource Exhaustion Scenarios', () => {
    it('should handle agent memory exhaustion', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate memory exhaustion
      agentManager.updateAgentMetrics(agentId, {
        memoryUsage: 0.95, // 95% memory usage
        cpuUsage: 0.8,
        errorRate: 0.2,
        activeConnections: 15,
      });

      const agent = agentManager.getAgent(agentId);
      if (agent) {
        agent.health.status = 'unhealthy';
      }

      const allAgents = agentManager.getAllAgents();
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Should not select memory-exhausted agent
      const selectedAgent = loadBalancer.selectAgent(allAgents, context);
      expect(selectedAgent).toBeNull(); // No healthy agents available
    });

    it('should handle CPU exhaustion', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate CPU exhaustion
      agentManager.updateAgentMetrics(agentId, {
        cpuUsage: 0.98, // 98% CPU usage
        memoryUsage: 0.6,
        errorRate: 0.15,
        averageResponseTime: 2000, // High response time
      });

      const agent = agentManager.getAgent(agentId);
      if (agent) {
        agent.health.status = 'unhealthy';
      }

      const allAgents = agentManager.getAllAgents();
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Should not select CPU-exhausted agent
      const selectedAgent = loadBalancer.selectAgent(allAgents, context);
      expect(selectedAgent).toBeNull();
    });
  });

  describe('Circuit Breaker Behavior', () => {
    it('should handle consecutive failures', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate consecutive failures
      for (let i = 0; i < 5; i++) {
        agentManager.updateAgentMetrics(agentId, {
          errorRate: (i + 1) * 0.2, // Increasing error rate
        });
      }

      const agent = agentManager.getAgent(agentId);
      if (agent) {
        agent.health.status = 'unhealthy';
        agent.health.consecutiveFailures = 5;
      }

      const allAgents = agentManager.getAllAgents();
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Should not select agent with high failure rate
      const selectedAgent = loadBalancer.selectAgent(allAgents, context);
      expect(selectedAgent).toBeNull();
    });

    it('should allow recovery after failures', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate failure then recovery
      agentManager.updateAgentMetrics(agentId, {
        errorRate: 0.3,
      });

      const agent = agentManager.getAgent(agentId);
      if (agent) {
        agent.health.status = 'unhealthy';
      }

      // Simulate recovery
      agentManager.updateAgentMetrics(agentId, {
        errorRate: 0.01,
      });

      if (agent) {
        agent.health.status = 'healthy';
      }

      const allAgents = agentManager.getAllAgents();
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Should be able to select recovered agent
      const selectedAgent = loadBalancer.selectAgent(allAgents, context);
      expect(selectedAgent).toBeDefined();
      expect(selectedAgent?.health.status).toBe('healthy');
    });
  });

  describe('Session Affinity During Failures', () => {
    it('should handle session affinity when primary agent fails', async () => {
      const sessionId = 'session-123';

      // Register agents
      const agentId1 = agentManager.registerAgent(
        'http://localhost:8080',
        sessionId
      );
      const agentId2 = agentManager.registerAgent('http://localhost:8081');

      const allAgents = agentManager.getAllAgents().map(agent => ({
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

      // First request - should select session agent
      const agent1 = loadBalancer.selectAgent(allAgents, context);
      expect(agent1?.id).toBe(agentId1);

      // Simulate primary agent failure
      const agentsWithFailure = allAgents.map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status:
            agent.id === agentId1
              ? ('unhealthy' as const)
              : ('healthy' as const),
        },
      }));

      // Second request - should select different agent due to failure
      const agent2 = loadBalancer.selectAgent(agentsWithFailure, context);
      expect(agent2?.id).toBe(agentId2);
      expect(agent2?.id).not.toBe(agentId1);
    });
  });
});
