import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { HttpTransport } from '../../src/transports/http-transport';
import { RunnerHealth } from '../../src/types';
import type {
  RunnerRegistration,
  HeartbeatPayload,
  EndpointUpdatePayload,
  DeregisterPayload,
} from '../../src/types';

// Mock axios at module level
const mockPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: mockPost,
    })),
  },
}));

const mockAxiosCreate = vi.mocked(axios.create);

describe('HttpTransport', () => {
  const baseUrl = 'http://yggdrasil:4000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an axios instance with the base URL', () => {
      const transport = new HttpTransport(baseUrl);
      expect(transport).toBeInstanceOf(HttpTransport);
      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: baseUrl,
        }),
      );
    });

    it('should strip trailing slash from base URL', () => {
      new HttpTransport('http://yggdrasil:4000/');
      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://yggdrasil:4000',
        }),
      );
    });

    it('should set default headers', () => {
      new HttpTransport(baseUrl);
      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    });
  });

  describe('register', () => {
    it('should POST to /runners/register with registration payload', async () => {
      const transport = new HttpTransport(baseUrl);
      const payload: RunnerRegistration = {
        runnerId: 'runner-123',
        name: 'Test Runner',
        endpoint: 'http://192.168.1.5:8080',
        version: '1.0.0',
        capabilities: ['llm', 'browser'],
      };

      await transport.register(payload);

      expect(mockPost).toHaveBeenCalledWith('/runners/register', payload);
    });
  });

  describe('heartbeat', () => {
    it('should POST to /runners/heartbeat with heartbeat payload', async () => {
      const transport = new HttpTransport(baseUrl);
      const payload: HeartbeatPayload = {
        runnerId: 'runner-123',
        timestamp: 1710000000,
        status: RunnerHealth.HEALTHY,
      };

      await transport.heartbeat(payload);

      expect(mockPost).toHaveBeenCalledWith('/runners/heartbeat', payload);
    });
  });

  describe('update', () => {
    it('should POST to /runners/update with endpoint update payload', async () => {
      const transport = new HttpTransport(baseUrl);
      const payload: EndpointUpdatePayload = {
        runnerId: 'runner-123',
        oldEndpoint: 'http://192.168.1.5:8080',
        newEndpoint: 'http://192.168.1.6:8080',
      };

      await transport.update(payload);

      expect(mockPost).toHaveBeenCalledWith('/runners/update', payload);
    });
  });

  describe('deregister', () => {
    it('should POST to /runners/offline with runner ID', async () => {
      const transport = new HttpTransport(baseUrl);
      const payload: DeregisterPayload = {
        runnerId: 'runner-123',
      };

      await transport.deregister(payload);

      expect(mockPost).toHaveBeenCalledWith('/runners/offline', payload);
    });
  });
});
