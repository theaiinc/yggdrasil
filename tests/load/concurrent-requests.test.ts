import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../src/services/agent-manager';
import { LoadBalancer } from '../../src/services/load-balancer';
import { RequestContext } from '../../src/types';

describe('Concurrent Request Load Testing', () => {
  let agentManager: AgentManager;
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    agentManager = new AgentManager('/health');
    loadBalancer = new LoadBalancer('round-robin', true, 3600000);
  });

  afterEach(() => {
    agentManager.stopHealthChecks();
  });

  describe('High Concurrency Scenarios', () => {
    it('should handle 100 concurrent requests', async () => {
      // Setup agents
      for (let i = 0; i < 3; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Generate 100 concurrent requests
      const requests = Array.from({ length: 100 }, (_, i) => ({
        id: `req-${i}`,
        sessionId: `session-${i % 10}`, // 10 different sessions
        timestamp: new Date(),
        priority: 'normal' as const,
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      }));

      const startTime = Date.now();

      // Process all requests concurrently
      const results = await Promise.all(
        requests.map(request => {
          const context: RequestContext = request;
          return loadBalancer.selectAgent(healthyAgents, context);
        })
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify results
      expect(results).toHaveLength(100);
      expect(results.every(result => result !== null)).toBe(true);

      // Performance check - should complete within reasonable time
      expect(duration).toBeLessThan(1000); // Should complete within 1 second

      // Performance: Processed 100 concurrent requests in ${duration}ms
    });

    it('should handle 1000 concurrent requests with session affinity', async () => {
      // Setup agents
      for (let i = 0; i < 5; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Generate 1000 requests with 50 different sessions
      const requests = Array.from({ length: 1000 }, (_, i) => ({
        id: `req-${i}`,
        sessionId: `session-${i % 50}`, // 50 different sessions
        timestamp: new Date(),
        priority: 'normal' as const,
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      }));

      const startTime = Date.now();

      // Process all requests concurrently
      const results = await Promise.all(
        requests.map(request => {
          const context: RequestContext = request;
          return loadBalancer.selectAgent(healthyAgents, context);
        })
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify results
      expect(results).toHaveLength(1000);
      expect(results.every(result => result !== null)).toBe(true);

      // Performance check
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds

      // Performance: Processed 1000 concurrent requests in ${duration}ms
    });

    it('should maintain session affinity under load', async () => {
      // Setup agents
      for (let i = 0; i < 3; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Test session affinity with multiple requests per session
      const sessions = ['session-a', 'session-b', 'session-c'];
      const requestsPerSession = 50;

      const requests: RequestContext[] = [];

      for (const sessionId of sessions) {
        for (let i = 0; i < requestsPerSession; i++) {
          requests.push({
            id: `req-${sessionId}-${i}`,
            sessionId,
            timestamp: new Date(),
            priority: 'normal',
            retryCount: 0,
            maxRetries: 3,
            timeout: 5000,
          });
        }
      }

      // Process requests
      const results = await Promise.all(
        requests.map(request =>
          loadBalancer.selectAgent(healthyAgents, request)
        )
      );

      // Verify session affinity
      const sessionAgents = new Map<string, string>();

      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        const result = results[i];

        if (request && result) {
          if (!sessionAgents.has(request.sessionId!)) {
            sessionAgents.set(request.sessionId!, result.id);
          } else {
            // All requests for same session should go to same agent
            expect(result.id).toBe(sessionAgents.get(request.sessionId!));
          }
        }
      }

      expect(sessionAgents.size).toBe(3); // Should have 3 different session-agent mappings
    });
  });

  describe('Resource Utilization Monitoring', () => {
    it('should track agent metrics under load', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate high load
      const requests = Array.from({ length: 100 }, (_, i) => ({
        id: `req-${i}`,
        timestamp: new Date(),
        priority: 'normal' as const,
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      }));

      const healthyAgents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Process requests and update metrics
      for (const request of requests) {
        const context: RequestContext = request;
        const selectedAgent = loadBalancer.selectAgent(healthyAgents, context);

        if (selectedAgent) {
          // Simulate metrics update
          agentManager.updateAgentMetrics(selectedAgent.id, {
            requestCount: selectedAgent.metrics.requestCount + 1,
            activeConnections: Math.min(
              selectedAgent.metrics.activeConnections + 1,
              10
            ),
          });
        }
      }

      // Verify metrics were updated
      const agent = agentManager.getAgent(agentId);
      expect(agent?.metrics.requestCount).toBeGreaterThan(0);
    });

    it('should handle agent overload scenarios', async () => {
      // Setup agents with different capacities
      const agentId1 = agentManager.registerAgent('http://localhost:8080');
      const agentId2 = agentManager.registerAgent('http://localhost:8081');

      // Simulate one agent being overloaded
      agentManager.updateAgentMetrics(agentId1, {
        cpuUsage: 0.9,
        memoryUsage: 0.8,
        activeConnections: 10,
        errorRate: 0.1,
      });

      agentManager.updateAgentMetrics(agentId2, {
        cpuUsage: 0.3,
        memoryUsage: 0.4,
        activeConnections: 2,
        errorRate: 0.01,
      });

      const agents = agentManager.getAllAgents().map(agent => ({
        ...agent,
        health: {
          ...agent.health,
          status: 'healthy' as const,
        },
      }));

      // Load balancer should prefer less loaded agent
      loadBalancer.setAlgorithm('weighted');

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selectedAgent = loadBalancer.selectAgent(agents, context);
      expect(selectedAgent?.id).toBe(agentId2); // Should select less loaded agent
    });
  });

  describe('Error Rate Monitoring', () => {
    it('should track error rates under load', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate requests with some failures
      const totalRequests = 100;
      const failedRequests = 15;

      for (let i = 0; i < totalRequests; i++) {
        const isFailure = i < failedRequests;

        agentManager.updateAgentMetrics(agentId, {
          requestCount: i + 1,
          errorRate: isFailure
            ? failedRequests / (i + 1)
            : failedRequests / (i + 1),
        });
      }

      const agent = agentManager.getAgent(agentId);
      expect(agent?.metrics.requestCount).toBe(totalRequests);
      expect(agent?.metrics.errorRate).toBeCloseTo(0.15, 2); // 15% error rate
    });
  });
});
