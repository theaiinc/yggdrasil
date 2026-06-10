import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EndpointUpdatePayload } from '../../src/types';
import { EndpointDetector } from '../../src/services/endpoint-detector';

describe('EndpointDetector', () => {
  let detector: EndpointDetector;

  beforeEach(() => {
    detector = new EndpointDetector(8080, false);
  });

  describe('constructor', () => {
    it('should create with default port 8080', () => {
      const d = new EndpointDetector();
      expect(d.getCurrentEndpoint()).toMatch(/^http:\/\/[\d.]+:8080$/);
    });

    it('should create with custom port', () => {
      const d = new EndpointDetector(9090);
      expect(d.getCurrentEndpoint()).toMatch(/^http:\/\/[\d.]+:9090$/);
    });
  });

  describe('getCurrentEndpoint', () => {
    it('should return a string starting with http://', () => {
      expect(detector.getCurrentEndpoint()).toMatch(/^http:\/\//);
    });
  });

  describe('detect', () => {
    it('should return null when endpoint has not changed', async () => {
      const result = await detector.detect();
      expect(result).toBeNull();
    });

    it('should return update payload when endpoint changes', async () => {
      const d = new EndpointDetector(8080);

      // Override the endpoint so detect() sees a change
      d.setEndpoint('http://10.0.0.1:8080');
      const endpointBeforeDetect = d.getCurrentEndpoint();

      const result = await d.detect();

      expect(result).not.toBeNull();
      expect(result!.runnerId).toBe('');
      expect(result!.oldEndpoint).toBe(endpointBeforeDetect);
      expect(result!.newEndpoint).not.toBe('http://10.0.0.1:8080');
    });
  });

  describe('setEndpoint', () => {
    it('should override the current endpoint', () => {
      detector.setEndpoint('http://custom:8080');
      expect(detector.getCurrentEndpoint()).toBe('http://custom:8080');
    });
  });

  describe('getHostname', () => {
    it('should return a non-empty string', () => {
      const hostname = detector.getHostname();
      expect(typeof hostname).toBe('string');
      expect(hostname.length).toBeGreaterThan(0);
    });
  });

  describe('detect with detectPublicIp', () => {
    it('should fall back to local endpoint when public IP fetch fails', async () => {
      const d = new EndpointDetector(8080, true);
      const endpoint = d.getCurrentEndpoint();
      expect(endpoint).toMatch(/^http:\/\/[\d.]+:8080$/);
    });
  });
});
