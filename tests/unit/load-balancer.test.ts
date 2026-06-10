import { describe, it, expect, beforeEach } from 'vitest';
import { LoadBalancer } from '../../src/services/load-balancer';
import { AgentInfo, RequestContext } from '../../src/types';

describe('LoadBalancer', () => {
  let loadBalancer: LoadBalancer;
  let mockAgents: AgentInfo[];

  beforeEach(() => {
    loadBalancer = new LoadBalancer('round-robin', true, 3600000);

    mockAgents = [
      {
        id: 'agent-1',
        url: 'http://localhost:8080',
        health: {
          status: 'healthy',
          lastCheck: new Date(),
          responseTime: 50,
          errorCount: 0,
          consecutiveFailures: 0,
        },
        metrics: {
          cpuUsage: 0.3,
          memoryUsage: 0.4,
          requestCount: 100,
          errorRate: 0.01,
          averageResponseTime: 120,
          activeConnections: 3,
        },
        lastSeen: new Date(),
      },
      {
        id: 'agent-2',
        url: 'http://localhost:8081',
        health: {
          status: 'healthy',
          lastCheck: new Date(),
          responseTime: 60,
          errorCount: 0,
          consecutiveFailures: 0,
        },
        metrics: {
          cpuUsage: 0.5,
          memoryUsage: 0.6,
          requestCount: 150,
          errorRate: 0.02,
          averageResponseTime: 140,
          activeConnections: 5,
        },
        lastSeen: new Date(),
      },
    ];
  });

  describe('Agent Selection', () => {
    it('should return null when no agents available', () => {
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected = loadBalancer.selectAgent([], context);
      expect(selected).toBeNull();
    });

    it('should select agent using round-robin algorithm', () => {
      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected1 = loadBalancer.selectAgent(mockAgents, context);
      const selected2 = loadBalancer.selectAgent(mockAgents, context);
      const selected3 = loadBalancer.selectAgent(mockAgents, context);

      expect(selected1).toBeDefined();
      expect(selected2).toBeDefined();
      expect(selected3).toBeDefined();

      // Round-robin should cycle through agents
      expect(selected1?.id).toBe('agent-1');
      expect(selected2?.id).toBe('agent-2');
      expect(selected3?.id).toBe('agent-1');
    });

    it('should select agent using least-connections algorithm', () => {
      loadBalancer.setAlgorithm('least-connections');

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected = loadBalancer.selectAgent(mockAgents, context);
      expect(selected?.id).toBe('agent-1'); // agent-1 has fewer connections (3 vs 5)
    });

    it('should select agent using ip-hash algorithm', () => {
      loadBalancer.setAlgorithm('ip-hash');

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected = loadBalancer.selectAgent(mockAgents, context);
      expect(selected).toBeDefined();
      expect(['agent-1', 'agent-2']).toContain(selected?.id);
    });

    it('should select agent using weighted algorithm', () => {
      loadBalancer.setAlgorithm('weighted');

      const context: RequestContext = {
        id: 'req-1',
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected = loadBalancer.selectAgent(mockAgents, context);
      expect(selected).toBeDefined();
      expect(['agent-1', 'agent-2']).toContain(selected?.id);
    });
  });

  describe('Session Affinity', () => {
    it('should use session affinity when enabled', () => {
      const sessionId = 'session-123';
      const context: RequestContext = {
        id: 'req-1',
        sessionId,
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // First request should select an agent
      const selected1 = loadBalancer.selectAgent(mockAgents, context);
      expect(selected1).toBeDefined();

      // Second request with same session should select same agent
      const selected2 = loadBalancer.selectAgent(mockAgents, context);
      expect(selected2?.id).toBe(selected1?.id);
    });

    it('should not use session affinity when disabled', () => {
      loadBalancer.setSessionAffinity(false);

      const sessionId = 'session-123';
      const context: RequestContext = {
        id: 'req-1',
        sessionId,
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      const selected1 = loadBalancer.selectAgent(mockAgents, context);
      const selected2 = loadBalancer.selectAgent(mockAgents, context);

      // Without session affinity, agents might be different
      expect(selected1).toBeDefined();
      expect(selected2).toBeDefined();
    });

    it('should handle unhealthy agents in session affinity', () => {
      const unhealthyAgent: AgentInfo = {
        id: 'agent-unhealthy',
        url: 'http://localhost:8082',
        health: {
          status: 'unhealthy',
          lastCheck: new Date(),
          responseTime: 1000,
          errorCount: 5,
          consecutiveFailures: 3,
        },
        metrics: {
          cpuUsage: 0.9,
          memoryUsage: 0.8,
          requestCount: 200,
          errorRate: 0.1,
          averageResponseTime: 500,
          activeConnections: 10,
        },
        lastSeen: new Date(),
      };

      const allAgents = [...mockAgents, unhealthyAgent];
      const sessionId = 'session-123';
      const context: RequestContext = {
        id: 'req-1',
        sessionId,
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Should not select unhealthy agent even with session affinity
      const selected = loadBalancer.selectAgent(allAgents, context);
      expect(selected?.id).not.toBe('agent-unhealthy');
    });
  });

  describe('Session Management', () => {
    it('should remove session mapping', () => {
      const sessionId = 'session-123';
      const context: RequestContext = {
        id: 'req-1',
        sessionId,
        timestamp: new Date(),
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        timeout: 5000,
      };

      // Create session mapping
      loadBalancer.selectAgent(mockAgents, context);

      // Remove session
      loadBalancer.removeSession(sessionId);

      const stats = loadBalancer.getSessionStats();
      expect(stats.totalSessions).toBe(0);
    });

    it('should get session statistics', () => {
      const stats = loadBalancer.getSessionStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.sessionMapSize).toBe(0);
    });
  });

  describe('Algorithm Configuration', () => {
    it('should update algorithm', () => {
      loadBalancer.setAlgorithm('least-connections');
      // Algorithm should be updated (no way to directly test this, but no error should occur)
      expect(loadBalancer).toBeDefined();
    });

    it('should update session affinity settings', () => {
      loadBalancer.setSessionAffinity(false, 1800000);
      // Settings should be updated (no way to directly test this, but no error should occur)
      expect(loadBalancer).toBeDefined();
    });
  });
});
