/**
 * Tests for the SessionManager service.
 *
 * SessionManager bridges session requests from Yggdrasil to Realm.
 * Tests verify local session lifecycle logic; HTTP calls to Realm are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/services/session-manager';

// eslint-disable-next-line @typescript-eslint/naming-convention
import axios from 'axios';

// Store a reference to the mock axios instance created by axios.create()
let mockAxiosInstance: Record<string, ReturnType<typeof vi.fn>>;

// Mock axios to avoid real HTTP calls to Realm
vi.mock('axios', () => {
  const mockInstance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  };
  const mockAxios = vi.fn(() => Promise.resolve());
  mockAxios.create = vi.fn(() => mockInstance);
  return { default: mockAxios };
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get the mock instance created by the last axios.create() call
    mockAxiosInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    // If not yet created, the constructor will create one — capture after construction
  });

  function setupDefaultMocks() {
    // Re-capture the instance after SessionManager constructor calls axios.create()
    mockAxiosInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    if (!mockAxiosInstance) return;

    // Default mock: GET /api/v1/realms returns empty list (no existing realms)
    mockAxiosInstance.get.mockResolvedValue({ data: { realms: [] } });
    // Default mock: POST /api/v1/realms creates a new realm
    mockAxiosInstance.post.mockImplementation((url: string) => {
      if (url === '/api/v1/realms') {
        return Promise.resolve({ data: { id: 'realm-created-123' } });
      }
      if (url.includes('/start')) {
        return Promise.resolve({ data: { success: true } });
      }
      return Promise.resolve({ data: { success: true } });
    });
  }

  describe('createSession', () => {
    it('should create a computer-use session and return descriptor', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const result = await manager.createSession({ type: 'computer-use' });

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^session-/);
      expect(result.descriptor.type).toBe('computer-use');
      expect(result.descriptor.state).toBe('active');
      expect(result.descriptor.capabilities).toEqual(['mouse', 'keyboard', 'scroll', 'clipboard']);
      expect(result.descriptor.observationMethod).toBe('screenshot');
      // Endpoints point to Realm (data plane), not Yggdrasil
      expect(result.descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-created-123/capture');
      expect(result.descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-created-123');
      // Optional fields absent when not provided
      expect(result.descriptor.ownerId).toBeUndefined();
      expect(result.descriptor.participantIds).toBeUndefined();
    });

    it('should create a phone-use session', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const result = await manager.createSession({ type: 'phone-use' });

      expect(result.descriptor.type).toBe('phone-use');
      expect(result.descriptor.capabilities).toEqual(['touch', 'keyboard', 'scroll']);
      // Endpoints point to Realm (data plane), not Yggdrasil
      expect(result.descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-created-123/capture');
      expect(result.descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-created-123');
    });

    it('should attach metadata to the session descriptor', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const meta = { goal: 'test goal', userId: 'u-1' };
      const result = await manager.createSession({ type: 'computer-use', metadata: meta });

      expect(result.descriptor.metadata).toEqual(meta);
    });

    it('should pass through ownerId and participantIds', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const result = await manager.createSession({
        type: 'computer-use',
        ownerId: 'user-abc',
        participantIds: ['user-def'],
      });

      expect(result.descriptor.ownerId).toBe('user-abc');
      expect(result.descriptor.participantIds).toEqual(['user-def']);
    });

    it('should accept capabilities filter from request', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const result = await manager.createSession({
        type: 'computer-use',
        capabilities: ['observe', 'keyboard'],
      });

      expect(result.descriptor.capabilities).toEqual(['observe', 'keyboard']);
    });

    it('should reject session creation when authorizer denies', async () => {
      const denyingAuthorizer = {
        authorize: vi.fn().mockResolvedValue({ allowed: false, reason: 'Quota exceeded' }),
      };
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' }, denyingAuthorizer);
      setupDefaultMocks();

      await expect(
        manager.createSession({ type: 'computer-use' }),
      ).rejects.toThrow('Session creation denied: Quota exceeded');
    });

    it('should create a realm via HTTP when none exist', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      await manager.createSession({ type: 'computer-use' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/realms');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/realms',
        expect.objectContaining({ engine: 'ubuntu' }),
      );
    });

    it('should reuse an existing running realm', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      // Override GET to return an existing realm
      mockAxiosInstance.get.mockResolvedValue({
        data: { realms: [{ id: 'existing-realm-1', engine: 'ubuntu', session: { state: 'running' } }] },
      });

      await manager.createSession({ type: 'computer-use' });

      // Should NOT create a new realm since one already exists
      const postCalls = mockAxiosInstance.post.mock.calls.filter(
        (call: unknown[]) => call[0] === '/api/v1/realms',
      );
      expect(postCalls).toHaveLength(0);
    });

    it('should emit Realm data-plane URLs on session descriptor', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const result = await manager.createSession({ type: 'computer-use' });

      expect(result.descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-created-123/capture');
      expect(result.descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-created-123');
    });

    it('should emit correct Realm URLs when reusing an existing realm', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      // Override GET to return an existing realm
      mockAxiosInstance.get.mockResolvedValue({
        data: { realms: [{ id: 'existing-realm-1', engine: 'ubuntu', session: { state: 'running' } }] },
      });

      const result = await manager.createSession({ type: 'computer-use' });

      // Endpoints should reference the reused realm ID, not "realm-created-123"
      expect(result.descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/existing-realm-1/capture');
      expect(result.descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/existing-realm-1');
    });
  });

  describe('getSession', () => {
    it('should return the session descriptor', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });
      const descriptor = await manager.getSession(created.sessionId);

      expect(descriptor.id).toBe(created.sessionId);
      expect(descriptor.type).toBe('computer-use');
    });

    it('should throw for unknown session', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      await expect(manager.getSession('nonexistent')).rejects.toThrow('Session not found');
    });

    it('should throw for terminated session', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });
      await manager.terminateSession(created.sessionId);

      await expect(manager.getSession(created.sessionId)).rejects.toThrow('Session is terminated');
    });
  });

  describe('listSessions', () => {
    it('should list all created sessions', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      await manager.createSession({ type: 'computer-use' });
      await manager.createSession({ type: 'phone-use' });

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should return empty list when no sessions exist', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('terminateSession', () => {
    it('should mark session as terminated', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });
      await manager.terminateSession(created.sessionId);

      await expect(manager.getSession(created.sessionId)).rejects.toThrow('Session is terminated');
    });

    it('should destroy realm when requested', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      await manager.terminateSession(created.sessionId, true);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/realms/'),
      );
    });
  });

  describe('pauseSession / resumeSession', () => {
    it('should pause an active session', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });
      await manager.pauseSession(created.sessionId);

      const desc = await manager.getSession(created.sessionId);
      expect(desc.state).toBe('paused');
    });

    it('should resume a paused session', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });
      await manager.pauseSession(created.sessionId);
      await manager.resumeSession(created.sessionId);

      const desc = await manager.getSession(created.sessionId);
      expect(desc.state).toBe('active');
    });
  });

  describe('getHealth', () => {
    it('should report health for active sessions', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      await manager.createSession({ type: 'computer-use' });
      await manager.createSession({ type: 'phone-use' });

      const health = manager.getHealth();
      expect(health).toHaveLength(2);
      for (const h of health) {
        expect(h.state).toBe('active');
        expect(h.errorCount).toBe(0);
      }
    });

    it('should exclude terminated sessions from health', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });
      await manager.terminateSession(created.sessionId);

      const health = manager.getHealth();
      expect(health).toHaveLength(0);
    });

    it('should increment error count on failed observe', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      // Make observe throw
      mockAxiosInstance.get.mockRejectedValue(new Error('network error'));
      await manager.observe(created.sessionId);

      const health = manager.getHealth();
      expect(health[0]?.errorCount).toBe(1);
    });
  });

  describe('observe', () => {
    it('should return observation from realm capture', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      mockAxiosInstance.get.mockResolvedValue({
        data: { screenshot: 'base64image123', piiRedacted: true },
      });

      const observation = await manager.observe(created.sessionId);
      expect(observation.screenshot).toBe('base64image123');
      expect(observation.piiRedacted).toBe(true);
      expect(observation.timestamp).toBeDefined();
    });

    it('should return error data when capture fails', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      mockAxiosInstance.get.mockRejectedValue(new Error('Realm unavailable'));

      const observation = await manager.observe(created.sessionId);
      expect(observation.data).toBeDefined();
      expect((observation.data as Record<string, unknown>)?.error).toContain('Realm unavailable');
      expect(observation.timestamp).toBeDefined();
    });
  });

  describe('input', () => {
    it('should send mouse click to realm', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      const result = await manager.input(created.sessionId, {
        type: 'mouse',
        params: { x: 100, y: 200 },
      });

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining('/click'),
        { x: 100, y: 200 },
      );
    });

    it('should send keyboard input to realm', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      const result = await manager.input(created.sessionId, {
        type: 'keyboard',
        params: { text: 'hello world' },
      });

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining('/type'),
        { text: 'hello world' },
      );
    });

    it('should return error for unsupported input type', async () => {
      manager = new SessionManager({ realmUrl: 'http://realm.test:8542' });
      setupDefaultMocks();

      const created = await manager.createSession({ type: 'computer-use' });

      const result = await manager.input(created.sessionId, {
        type: 'drag',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported input type');
    });
  });
});
