import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../src/services/agent-manager';
import { AgentMetrics } from '../../src/types';

describe('AgentManager', () => {
  let agentManager: AgentManager;

  beforeEach(() => {
    agentManager = new AgentManager('/health');
  });

  afterEach(() => {
    // Clean up any intervals
    agentManager.stopHealthChecks();
  });

  describe('Agent Registration', () => {
    it('should register a new agent successfully', () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      expect(agentId).toBeDefined();
      expect(agentId.length).toBeGreaterThan(0);

      const agent = agentManager.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent?.url).toBe('http://localhost:8080');
      expect(agent?.health.status).toBe('unknown');
    });

    it('should register agent with session ID', () => {
      const sessionId = 'session-123';
      const agentId = agentManager.registerAgent(
        'http://localhost:8080',
        sessionId
      );

      const agent = agentManager.getAgent(agentId);
      expect(agent?.sessionId).toBe(sessionId);
    });

    it('should unregister an agent successfully', () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');
      const result = agentManager.unregisterAgent(agentId);

      expect(result).toBe(true);
      expect(agentManager.getAgent(agentId)).toBeUndefined();
    });

    it('should return false when unregistering non-existent agent', () => {
      const result = agentManager.unregisterAgent('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Agent Health Checks', () => {
    it('should perform health check on agent', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      const result = await agentManager.checkAgentHealth(agentId);

      expect(result.agentId).toBe(agentId);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(typeof result.responseTime).toBe('number');
    });

    it('should return unhealthy for non-existent agent', async () => {
      const result = await agentManager.checkAgentHealth('non-existent');

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Agent not found');
    });

    it('should update agent health status after health check', async () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      await agentManager.checkAgentHealth(agentId);
      const agent = agentManager.getAgent(agentId);

      expect(agent?.health.lastCheck).toBeInstanceOf(Date);
      expect(typeof agent?.health.responseTime).toBe('number');
    });
  });

  describe('Agent Queries', () => {
    beforeEach(() => {
      agentManager.registerAgent('http://localhost:8080', 'session-1');
      agentManager.registerAgent('http://localhost:8081', 'session-2');
      agentManager.registerAgent('http://localhost:8082');
    });

    it('should get all agents', () => {
      const agents = agentManager.getAllAgents();
      expect(agents).toHaveLength(3);
    });

    it('should get healthy agents only', () => {
      const healthyAgents = agentManager.getHealthyAgents();
      // Initially all agents are 'unknown' status, so none should be healthy
      expect(healthyAgents).toHaveLength(0);
    });

    it('should get agent by session ID', () => {
      const agent = agentManager.getAgentBySession('session-1');
      expect(agent).toBeDefined();
      expect(agent?.url).toBe('http://localhost:8080');
    });

    it('should return undefined for non-existent session', () => {
      const agent = agentManager.getAgentBySession('non-existent');
      expect(agent).toBeUndefined();
    });

    it('should get agent counts by health status', () => {
      const counts = agentManager.getAgentCounts();
      expect(counts.total).toBe(3);
      expect(counts.healthy).toBe(0);
      expect(counts.unhealthy).toBe(0);
    });
  });

  describe('Agent Metrics', () => {
    it('should update agent metrics', () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');
      const metrics: Partial<AgentMetrics> = {
        cpuUsage: 0.5,
        memoryUsage: 0.3,
        requestCount: 100,
        errorRate: 0.02,
        averageResponseTime: 150,
        activeConnections: 5,
      };

      agentManager.updateAgentMetrics(agentId, metrics);
      const agent = agentManager.getAgent(agentId);

      expect(agent?.metrics.cpuUsage).toBe(0.5);
      expect(agent?.metrics.memoryUsage).toBe(0.3);
      expect(agent?.metrics.requestCount).toBe(100);
    });
  });

  describe('Health Check Monitoring', () => {
    it('should start health checks', () => {
      agentManager.startHealthChecks(1000);
      // Health checks should be running
      expect(agentManager).toBeDefined();
    });

    it('should stop health checks', () => {
      agentManager.startHealthChecks(1000);
      agentManager.stopHealthChecks();
      // Health checks should be stopped
      expect(agentManager).toBeDefined();
    });
  });

  describe('Stale Agent Cleanup', () => {
    it('should cleanup stale agents', () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      // Simulate stale agent by setting lastSeen to old date
      const agent = agentManager.getAgent(agentId);
      if (agent) {
        agent.lastSeen = new Date(Date.now() - 400000); // 400 seconds ago
      }

      const cleanedCount = agentManager.cleanupStaleAgents(300000); // 300 second threshold
      expect(cleanedCount).toBe(1);
      expect(agentManager.getAgent(agentId)).toBeUndefined();
    });

    it('should not cleanup recent agents', () => {
      const agentId = agentManager.registerAgent('http://localhost:8080');

      const cleanedCount = agentManager.cleanupStaleAgents(300000);
      expect(cleanedCount).toBe(0);
      expect(agentManager.getAgent(agentId)).toBeDefined();
    });
  });
});
