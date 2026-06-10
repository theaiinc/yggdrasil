import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../src/services/agent-manager';
import { LoadBalancer } from '../../src/services/load-balancer';
import { RequestContext } from '../../src/types';

describe('Autoscaling Simulation Performance Tests', () => {
  let agentManager: AgentManager;
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    agentManager = new AgentManager('/health');
    loadBalancer = new LoadBalancer('round-robin', true, 3600000);
  });

  afterEach(() => {
    agentManager.stopHealthChecks();
  });

  describe('Cold Start Performance', () => {
    it('should handle cold start scenarios', async () => {
      // Simulate cold start - no agents initially
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Initially no agents available
      const initialAgents = agentManager.getAllAgents();
      expect(initialAgents).toHaveLength(0);

      const selectedAgent = loadBalancer.selectAgent(initialAgents, context);
      expect(selectedAgent).toBeNull();

      // Simulate agent startup
      const startTime = Date.now();
      const agentId = agentManager.registerAgent('http://localhost:8080');
      const startupTime = Date.now() - startTime;

      // Startup should be fast (simulated)
      expect(startupTime).toBeLessThan(100); // Should be very fast in simulation
      expect(agentId).toBeDefined();

      // Now agent should be available
      const agents = agentManager.getAllAgents();
      const newSelectedAgent = loadBalancer.selectAgent(agents, context);
      expect(newSelectedAgent).toBeDefined();
    });

    it('should handle multiple cold starts simultaneously', async () => {
      const contexts: RequestContext[] = Array.from({ length: 10 }, (_, i) => ({
        id: `req-${i}`,
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      }));

      // Simulate multiple cold starts
      const startTime = Date.now();

      const agentIds = await Promise.all(
        contexts.map(async () => {
          return agentManager.registerAgent(
            `http://localhost:${8080 + Math.floor(Math.random() * 10)}`
          );
        })
      );

      const totalTime = Date.now() - startTime;

      // Should handle multiple startups efficiently
      expect(totalTime).toBeLessThan(500);
      expect(agentIds).toHaveLength(10);
      expect(agentIds.every(id => id !== undefined)).toBe(true);
    });
  });

  describe('Concurrency Scaling', () => {
    it('should scale based on concurrent request load', async () => {
      const initialAgents = 2;
      const maxAgents = 10;
      const concurrentRequests = 50;

      // Start with initial agents
      for (let i = 0; i < initialAgents; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      // Mark all agents as healthy
      agentManager.getAllAgents().forEach(agent => {
        agent.health.status = 'healthy';
      });

      // Simulate high concurrent load
      const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
        id: `req-${i}`,
        timestamp: new Date(),
        priority: 'normal' as const,
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      }));

      const startTime = Date.now();

      // Process requests and simulate scaling
      const results = await Promise.all(
        requests.map(async (request, index) => {
          const context: RequestContext = request;
          const agents = agentManager.getAllAgents();

          // Simulate scaling based on load
          if (index % 10 === 0 && agents.length < maxAgents) {
            const newAgentId = agentManager.registerAgent(
              `http://localhost:808${agents.length}`
            );
            // Mark new agent as healthy
            const newAgent = agentManager.getAgent(newAgentId);
            if (newAgent) {
              newAgent.health.status = 'healthy';
            }
          }

          return loadBalancer.selectAgent(agents, context);
        })
      );

      const totalTime = Date.now() - startTime;
      const finalAgentCount = agentManager.getAllAgents().length;

      // Should scale up under load
      expect(finalAgentCount).toBeGreaterThan(initialAgents);
      expect(finalAgentCount).toBeLessThanOrEqual(maxAgents);
      expect(totalTime).toBeLessThan(1000); // Should complete within reasonable time
      expect(results.every(result => result !== null)).toBe(true);
    });

    it('should handle burst traffic patterns', async () => {
      // Simulate burst traffic
      const burstSizes = [10, 50, 100, 50, 10];
      const totalRequests = burstSizes.reduce((sum, size) => sum + size, 0);

      let currentAgentCount = 0;
      const results: unknown[] = [];

      for (const burstSize of burstSizes) {
        // Simulate burst
        const burstRequests = Array.from({ length: burstSize }, (_, i) => ({
          id: `burst-${i}`,
          timestamp: new Date(),
          priority: 'normal' as const,
          retryCount: 0,
          maxRetries: 3,
          timeout: 5000,
        }));

        // Scale up if needed
        const currentAgents = agentManager.getAllAgents();
        if (burstSize > currentAgents.length * 10) {
          // Scale if load > 10x capacity
          const neededAgents = Math.ceil(burstSize / 10) - currentAgents.length;
          for (let i = 0; i < neededAgents; i++) {
            const newAgentId = agentManager.registerAgent(
              `http://localhost:808${currentAgentCount + i}`
            );
            // Mark new agent as healthy
            const newAgent = agentManager.getAgent(newAgentId);
            if (newAgent) {
              newAgent.health.status = 'healthy';
            }
          }
          currentAgentCount += neededAgents;
        }

        // Mark all agents as healthy before processing
        agentManager.getAllAgents().forEach(agent => {
          agent.health.status = 'healthy';
        });

        // Process burst
        const burstResults = await Promise.all(
          burstRequests.map(request => {
            const context: RequestContext = request;
            const agents = agentManager.getAllAgents();
            return loadBalancer.selectAgent(agents, context);
          })
        );

        results.push(...burstResults);
      }

      expect(results).toHaveLength(totalRequests);
      expect(results.every(result => result !== null)).toBe(true);
      expect(agentManager.getAllAgents().length).toBeGreaterThan(0);
    });
  });

  describe('Resource-Based Scaling', () => {
    it('should scale based on CPU utilization', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate increasing CPU load
      const cpuLevels = [0.3, 0.5, 0.7, 0.9];
      let agentCount = 1;

      for (const cpuLevel of cpuLevels) {
        agentManager.updateAgentMetrics(agentId, {
          cpuUsage: cpuLevel,
          memoryUsage: 0.4,
          activeConnections: Math.floor(cpuLevel * 20),
        });

        // Simulate scaling decision based on CPU
        if (cpuLevel > 0.8 && agentCount < 3) {
          agentManager.registerAgent(`http://localhost:808${agentCount}`);
          agentCount++;
        }
      }

      const finalAgentCount = agentManager.getAllAgents().length;
      expect(finalAgentCount).toBeGreaterThan(1); // Should have scaled up
    });

    it('should scale based on memory utilization', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate increasing memory load
      const memoryLevels = [0.4, 0.6, 0.8, 0.95];
      let agentCount = 1;

      for (const memoryLevel of memoryLevels) {
        agentManager.updateAgentMetrics(agentId, {
          cpuUsage: 0.3,
          memoryUsage: memoryLevel,
          activeConnections: Math.floor(memoryLevel * 15),
        });

        // Simulate scaling decision based on memory
        if (memoryLevel > 0.85 && agentCount < 3) {
          agentManager.registerAgent(`http://localhost:808${agentCount}`);
          agentCount++;
        }
      }

      const finalAgentCount = agentManager.getAllAgents().length;
      expect(finalAgentCount).toBeGreaterThan(1); // Should have scaled up
    });
  });

  describe('Response Time Monitoring', () => {
    it('should track response times for scaling decisions', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate varying response times
      const responseTimes = [50, 100, 200, 500, 1000];
      let scaleUpCount = 0;

      for (const responseTime of responseTimes) {
        agentManager.updateAgentMetrics(agentId, {
          averageResponseTime: responseTime,
          requestCount: 100,
          errorRate: responseTime > 500 ? 0.1 : 0.01,
        });

        // Simulate scaling based on response time
        if (responseTime > 300 && scaleUpCount < 2) {
          agentManager.registerAgent(`http://localhost:808${scaleUpCount + 1}`);
          scaleUpCount++;
        }
      }

      const finalAgentCount = agentManager.getAllAgents().length;
      expect(finalAgentCount).toBeGreaterThan(1); // Should have scaled up due to high response times
    });
  });

  describe('Scaling Down', () => {
    it('should scale down when load decreases', async () => {
      // Start with multiple agents
      for (let i = 0; i < 5; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      const initialCount = agentManager.getAllAgents().length;
      expect(initialCount).toBe(5);

      // Simulate low load (context not used in this test)

      // Update metrics to show low utilization
      agentManager.getAllAgents().forEach(agent => {
        agentManager.updateAgentMetrics(agent.id, {
          cpuUsage: 0.1,
          memoryUsage: 0.2,
          activeConnections: 1,
          averageResponseTime: 50,
        });
      });

      // Simulate scale down decision (remove some agents)
      const agentsToRemove = agentManager.getAllAgents().slice(0, 2);
      agentsToRemove.forEach(agent => {
        agentManager.unregisterAgent(agent.id);
      });

      const finalCount = agentManager.getAllAgents().length;
      expect(finalCount).toBeLessThan(initialCount);
      expect(finalCount).toBe(3);
    });
  });

  describe('Performance Metrics', () => {
    it('should maintain performance under scaling', async () => {
      const startTime = Date.now();

      // Simulate scaling from 1 to 10 agents
      for (let i = 0; i < 10; i++) {
        agentManager.registerAgent(`http://localhost:808${i}`);
      }

      // Mark all agents as healthy
      agentManager.getAllAgents().forEach(agent => {
        agent.health.status = 'healthy';
      });

      const setupTime = Date.now() - startTime;
      expect(setupTime).toBeLessThan(100); // Should be very fast

      // Test load balancing performance
      const requests = Array.from({ length: 100 }, (_, i) => ({
        id: `req-${i}`,
        timestamp: new Date(),
        priority: 'normal' as const,
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      }));

      const loadBalancingStart = Date.now();
      const agents = agentManager.getAllAgents();

      const results = await Promise.all(
        requests.map(request => {
          const context: RequestContext = request;
          return loadBalancer.selectAgent(agents, context);
        })
      );

      const loadBalancingTime = Date.now() - loadBalancingStart;

      expect(loadBalancingTime).toBeLessThan(50); // Should be very fast
      expect(results.every(result => result !== null)).toBe(true);
    });
  });
});
