/**
 * UpdateManager — handles deferred updates requested by Yggdrasil.
 *
 * When Yggdrasil signals a pending update via heartbeat response, the
 * UpdateManager waits for all running tasks to complete, executes the
 * update command, and then exits the process (expected to be restarted
 * by a process manager like Docker's restart policy or systemd).
 *
 * Status tracking (reported via heartbeat to Yggdrasil):
 *   idle      → no update pending
 *   pending   → update received, waiting for tasks to finish
 *   applying  → executing update command
 *   applied   → command succeeded, about to exit
 *   failed    → command failed (recoverable via re-request)
 */
import type { PendingUpdate, UpdateStatus } from '../types/index.js';
import { execSync } from 'child_process';

export type TaskCountProvider = () => number;

const MAX_LOG_LENGTH = 2000;

/**
 * Update manager that defers update execution until all tasks are done,
 * and exposes status for Yggdrasil observability.
 */
export class UpdateManager {
  private pendingUpdate: PendingUpdate | null = null;
  private getRunningTaskCount: TaskCountProvider;
  private applyInProgress: boolean = false;
  private checkIntervalMs: number;
  private status: UpdateStatus = 'idle';
  private logBuffer: string[] = [];
  private updateVersion: string = '';

  constructor(
    getRunningTaskCount: TaskCountProvider,
    checkIntervalMs: number = 5_000,
  ) {
    this.getRunningTaskCount = getRunningTaskCount;
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Returns the current update status for heartbeat reporting.
   */
  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * Returns the tail of the update log (last MAX_LOG_LENGTH chars).
   */
  getLogTail(): string {
    return this.logBuffer.join('\n').slice(-MAX_LOG_LENGTH);
  }

  /**
   * Returns the version being applied, if any.
   */
  getUpdateVersion(): string {
    return this.updateVersion;
  }

  /**
   * Append a line to the internal log buffer.
   * Keeps buffer trimmed to avoid unbounded growth.
   */
  private log(msg: string): void {
    const line = `[UpdateManager] ${msg}`;
    console.log(line);
    this.logBuffer.push(line);
    // Keep only the last ~50 lines
    if (this.logBuffer.length > 50) {
      this.logBuffer = this.logBuffer.slice(-50);
    }
  }

  /**
   * Called when a heartbeat response contains a pendingUpdate.
   * Stores the update request. The actual update is deferred until
   * all running tasks complete.
   */
  requestUpdate(update: PendingUpdate): void {
    if (this.pendingUpdate !== null) {
      this.log(`Update already pending (version=${this.pendingUpdate.version}), replacing with version=${update.version}`);
    }
    this.pendingUpdate = update;
    this.updateVersion = update.version;
    this.status = 'pending';
    this.log(`Update deferred until tasks complete: version=${update.version}`);
    this.tryApply(); // kick off the check loop
  }

  /**
   * Returns whether an update is currently pending or in progress.
   */
  isUpdatePending(): boolean {
    return this.pendingUpdate !== null || this.applyInProgress;
  }

  /**
   * Returns the pending update info, if any.
   */
  getPendingUpdate(): PendingUpdate | null {
    return this.pendingUpdate;
  }

  /**
   * Reset status back to idle (called after a failed update to allow retry).
   */
  reset(): void {
    this.pendingUpdate = null;
    this.applyInProgress = false;
    this.status = 'idle';
    this.updateVersion = '';
  }

  /**
   * Check if tasks are done and apply the update if so.
   */
  private async tryApply(): Promise<void> {
    if (this.applyInProgress) return;
    if (!this.pendingUpdate) return;

    const running = this.getRunningTaskCount();
    if (running > 0) {
      this.log(`Waiting for ${running} running task(s) to complete before applying update v${this.pendingUpdate.version}...`);
      // Check again after interval
      setTimeout(() => this.tryApply(), this.checkIntervalMs);
      return;
    }

    // No running tasks — apply the update
    this.applyInProgress = true;
    this.status = 'applying';
    const update = this.pendingUpdate;
    this.pendingUpdate = null;

    this.log(`All tasks complete. Applying update: version=${update.version}`);

    try {
      if (update.command) {
        this.log(`Running update command: ${update.command}`);
        const output = execSync(update.command, {
          encoding: 'utf-8',
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        this.log(`Update command output:\n${output}`);
      } else {
        this.log(`No update command specified — update requested but nothing to execute. Reset status to idle.`);
        this.status = 'idle';
        this.applyInProgress = false;
        return;
      }
    } catch (err: any) {
      this.log(`Update command failed: ${err.message}`);
      if (err.stdout) this.log(`stdout: ${err.stdout}`);
      if (err.stderr) this.log(`stderr: ${err.stderr}`);
      this.status = 'failed';
      this.applyInProgress = false;
      // Don't exit on failure — the operator can inspect logs and retry
      return;
    }

    this.status = 'applied';
    this.log(`Update applied. Exiting for restart (version=${update.version})...`);

    // Give logs a moment to flush, then exit
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }
}
