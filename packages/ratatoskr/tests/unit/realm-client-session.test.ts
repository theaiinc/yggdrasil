/**
 * Tests for the RealmClient session-based methods.
 *
 * Verifies the session-based API:
 *   - createSession → session-based realm management
 *   - observe → session-based observation (Realm decides delivery)
 *   - input → session-based typed input actions
 *   - getSession → session descriptor retrieval
 *   - terminateSession → session lifecycle end
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RealmClient } from '../../src/handlers/realm-client';

// Mock axios to avoid real HTTP calls
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(() => mockAxiosInstance),
  };
  // Return a function with static property for default.create
  const mockAxios = Object.assign(
    vi.fn(() => Promise.resolve()),
    {
      create: vi.fn(() => mockAxiosInstance),
      __mockInstance: mockAxiosInstance,
    },
  );
  return { default: mockAxios };
});

// eslint-disable-next-line @typescript-eslint/naming-convention
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAxios = (axios as any).__mockInstance;

describe('RealmClient — session methods', () => {
  let client: RealmClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: GET realm info returns running state
    mockAxios.get.mockImplementation((url: string) => {
      if (url.includes('/capture')) {
        return Promise.resolve({ data: { screenshot: 'base64-screenshot', piiRedacted: false } });
      }
      // GET realm status
      return Promise.resolve({ data: { realm: { session: { state: 'running' } } } });
    });

    // Default: POST creates realm / clicks / types
    mockAxios.post.mockImplementation((url: string) => {
      if (url.match(/\/realms$/)) {
        return Promise.resolve({ data: { id: 'realm-abc-123' } });
      }
      if (url.includes('/click') || url.includes('/type')) {
        return Promise.resolve({ data: { success: true } });
      }
      if (url.includes('/start')) {
        return Promise.resolve({ data: { success: true } });
      }
      return Promise.resolve({ data: { success: true } });
    });

    client = new RealmClient({
      baseUrl: 'http://realm.test:8542',
      engine: 'ubuntu',
    });
  });

  describe('createSession', () => {
    it('should create a computer-use session and return descriptor', async () => {
      const result = await client.createSession({ type: 'computer-use' });

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^session-/);
      expect(result.descriptor.type).toBe('computer-use');
      expect(result.descriptor.state).toBe('active');
      expect(result.descriptor.capabilities).toEqual(['mouse', 'keyboard', 'scroll', 'clipboard']);
      expect(result.descriptor.observationMethod).toBe('screenshot');
      // Endpoints point to Realm (data plane), not Yggdrasil
      expect(result.descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-abc-123/capture');
      expect(result.descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-abc-123');
    });

    it('should create a phone-use session', async () => {
      const result = await client.createSession({ type: 'phone-use' });

      expect(result.descriptor.type).toBe('phone-use');
      expect(result.descriptor.capabilities).toEqual(['touch', 'keyboard', 'scroll']);
      // Endpoints point to Realm (data plane), not Yggdrasil
      expect(result.descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-abc-123/capture');
      expect(result.descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-abc-123');
    });

    it('should attach metadata to session descriptor', async () => {
      const result = await client.createSession({
        type: 'computer-use',
        metadata: { taskId: 't-1' },
      });

      expect(result.descriptor.metadata).toEqual({ taskId: 't-1' });
    });

    it('should pass through ownerId and participantIds', async () => {
      const result = await client.createSession({
        type: 'computer-use',
        ownerId: 'user-abc',
        participantIds: ['user-def'],
      });

      expect(result.descriptor.ownerId).toBe('user-abc');
      expect(result.descriptor.participantIds).toEqual(['user-def']);
    });

    it('should accept capabilities filter from request', async () => {
      const result = await client.createSession({
        type: 'computer-use',
        capabilities: ['observe', 'keyboard'],
      });

      expect(result.descriptor.capabilities).toEqual(['observe', 'keyboard']);
    });

    it('should ensure a realm is created via HTTP', async () => {
      await client.createSession({ type: 'computer-use' });

      // Should have checked realm state then started
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/realms'),
        expect.objectContaining({ engine: 'ubuntu' }),
      );
    });
  });

  describe('observe', () => {
    it('should return screenshot observation from realm capture', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });

      mockAxios.get.mockResolvedValue({
        data: { screenshot: 'abc123', piiRedacted: true },
      });

      const observation = await client.observe(sessionId);
      expect(observation.screenshot).toBe('abc123');
      expect(observation.piiRedacted).toBe(true);
      expect(observation.timestamp).toBeDefined();
    });

    it('should throw for unknown session', async () => {
      await expect(client.observe('bad-session')).rejects.toThrow('Session not found');
    });

    it('should throw for terminated session', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });
      await client.terminateSession(sessionId);

      await expect(client.observe(sessionId)).rejects.toThrow('Session is terminated');
    });
  });

  describe('input', () => {
    it('should send mouse click to realm', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });

      mockAxios.post.mockResolvedValue({ data: { success: true } });

      const result = await client.input(sessionId, {
        type: 'mouse',
        params: { x: 100, y: 200 },
      });

      expect(result.success).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/click'),
        { x: 100, y: 200 },
      );
    });

    it('should send touch input to realm', async () => {
      const { sessionId } = await client.createSession({ type: 'phone-use' });

      mockAxios.post.mockResolvedValue({ data: { success: true } });

      const result = await client.input(sessionId, {
        type: 'touch',
        params: { x: 300, y: 500 },
      });

      expect(result.success).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/click'),
        { x: 300, y: 500 },
      );
    });

    it('should send keyboard input to realm', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });

      mockAxios.post.mockResolvedValue({ data: { success: true } });

      const result = await client.input(sessionId, {
        type: 'keyboard',
        params: { text: 'hello' },
      });

      expect(result.success).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/type'),
        { text: 'hello' },
      );
    });

    it('should return error for unsupported input type', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });

      const result = await client.input(sessionId, {
        type: 'clipboard',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported input type');
    });
  });

  describe('getSession', () => {
    it('should return session descriptor with Realm data-plane URLs', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });
      const descriptor = await client.getSession(sessionId);

      expect(descriptor.id).toBe(sessionId);
      expect(descriptor.type).toBe('computer-use');
      expect(descriptor.realmId).toBeDefined();
      // Endpoints point to Realm (data plane), not Yggdrasil
      expect(descriptor.observationEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-abc-123/capture');
      expect(descriptor.inputEndpoint).toBe('http://realm.test:8542/api/v1/realms/realm-abc-123');
    });
  });

  describe('terminateSession', () => {
    it('should mark session as terminated', async () => {
      const { sessionId } = await client.createSession({ type: 'computer-use' });
      await client.terminateSession(sessionId);

      await expect(client.observe(sessionId)).rejects.toThrow('Session is terminated');
    });
  });

});
