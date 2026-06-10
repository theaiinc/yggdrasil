import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryManager } from '../../src/services/retry-manager';

describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager(10, 1000, 3);
  });

  describe('execute', () => {
    it('should return the result of a successful operation', async () => {
      const result = await retryManager.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;

      const result = await retryManager.execute(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after exhausting retries', async () => {
      const operation = async (): Promise<string> => {
        throw new Error('Persistent failure');
      };

      await expect(
        retryManager.execute(operation),
      ).rejects.toThrow('Persistent failure');
    });

    it('should succeed on first try', async () => {
      const operation = async (): Promise<string> => 'ok';

      const result = await retryManager.execute(operation);
      expect(result).toBe('ok');
    });
  });
});
