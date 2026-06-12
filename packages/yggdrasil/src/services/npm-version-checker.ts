import { getLogger } from './logger.js';

const logger = getLogger();

export interface NpmVersionInfo {
  current: string;
  latest: string | null;
  lastChecked: string | null;
  hasNewVersion: boolean;
  error: string | null;
}

/**
 * Polls the npm registry for the latest version of a package and compares
 * it to the locally installed version.
 *
 * Designed to be started once and kept alive via setInterval.
 */
export class NpmVersionChecker {
  private readonly packageName: string;
  private readonly registryUrl: string;
  private readonly currentVersion: string;
  private latestVersion: string | null = null;
  private lastChecked: string | null = null;
  private error: string | null = null;
  private timerId: ReturnType<typeof setInterval> | undefined;

  constructor(packageName: string, currentVersion: string, registryUrl?: string) {
    this.packageName = packageName;
    this.currentVersion = currentVersion;
    this.registryUrl = registryUrl ?? 'https://registry.npmjs.org';
  }

  /**
   * Start polling the npm registry at the given interval.
   * Default: every 30 minutes.
   */
  start(intervalMs: number = 30 * 60 * 1000): void {
    if (this.timerId) return;

    this.check(); // Check immediately
    this.timerId = setInterval(() => this.check(), intervalMs);

    logger.info('NpmVersionChecker started', {
      packageName: this.packageName,
      currentVersion: this.currentVersion,
      pollIntervalMs: intervalMs,
    });
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }

  /**
   * Get the current version info snapshot.
   */
  getInfo(): NpmVersionInfo {
    return {
      current: this.currentVersion,
      latest: this.latestVersion,
      lastChecked: this.lastChecked,
      hasNewVersion: this.latestVersion !== null && this.latestVersion !== this.currentVersion,
      error: this.error,
    };
  }

  /**
   * Perform a single check against the npm registry.
   * Idempotent — safe to call externally.
   */
  async check(): Promise<void> {
    const url = `${this.registryUrl.replace(/\/+$/, '')}/${encodeURIComponent(this.packageName)}/latest`;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`npm registry responded with ${response.status}`);
      }

      const data = (await response.json()) as { version?: string };
      const latest = data.version ?? null;

      if (!latest) {
        throw new Error('npm registry response missing version field');
      }

      this.latestVersion = latest;
      this.lastChecked = new Date().toISOString();
      this.error = null;

      const isNew = latest !== this.currentVersion;
      if (isNew) {
        logger.info('New Yggdrasil version available on npm', {
          current: this.currentVersion,
          latest,
        });
      } else {
        logger.debug('Yggdrasil version is up to date', { version: this.currentVersion });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Don't log warnings for timeouts on first few attempts (npm registry may be slow)
      this.error = message;
      logger.debug('Failed to check npm registry for latest version', { error: message });
    }
  }
}
