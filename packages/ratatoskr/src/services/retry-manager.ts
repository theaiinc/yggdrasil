/**
 * Retry manager with configurable exponential backoff.
 *
 * Used to survive temporary network outages and Yggdrasil restarts.
 */
export class RetryManager {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxRetries: number;

  /**
   * @param baseDelayMs - Initial delay in ms (default 1000).
   * @param maxDelayMs - Maximum delay in ms (default 60_000).
   * @param maxRetries - Maximum number of retries before giving up (default Infinity).
   */
  constructor(
    baseDelayMs: number = 1_000,
    maxDelayMs: number = 60_000,
    maxRetries: number = Number.POSITIVE_INFINITY,
  ) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxRetries = maxRetries;
  }

  /**
   * Execute an async operation with exponential backoff retry.
   *
   * @param operation - The async function to retry.
   * @param attempt - The current attempt number (starts at 0).
   * @returns The result of the operation.
   */
  async execute<T>(
    operation: () => Promise<T>,
    attempt: number = 0,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const nextAttempt = attempt + 1;

      if (nextAttempt > this.maxRetries) {
        throw error;
      }

      const delay = this.calculateDelay(nextAttempt);
      await this.sleep(delay);

      return this.execute(operation, nextAttempt);
    }
  }

  /**
   * Calculate the delay for a given attempt using exponential backoff with jitter.
   */
  private calculateDelay(attempt: number): number {
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, this.maxDelayMs);
    // Add up to 25% jitter
    const jitter = capped * 0.25 * Math.random();

    return Math.floor(capped + jitter);
  }

  /**
   * Sleep for the given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
