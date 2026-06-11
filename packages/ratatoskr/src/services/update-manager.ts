/**
 * UpdateManager — handles deferred updates requested by Yggdrasil.
 *
 * When Yggdrasil signals a pending update via heartbeat response, the
 * UpdateManager waits for all running tasks to complete, executes the
 * update command, and then exits the process (expected to be restarted
 * by a process manager like Docker's restart policy or systemd).
 */
import type { PendingUpdate } from '../types/index.js';
import { execSync } from 'child_process';

export type TaskCountProvider = () => number;

/**
 * Update manager that defers update execution until all tasks are done.
 */
export class UpdateManager {
  private pendingUpdate: PendingUpdate | null = null;
  private getRunningTaskCount: TaskCountProvider;
  private applyInProgress: boolean = false;
  private checkIntervalMs: number;

  constructor(
    getRunningTaskCount: TaskCountProvider,
    checkIntervalMs: number = 5_000,
  ) {
    this.getRunningTaskCount = getRunningTaskCount;
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Called when a heartbeat response contains a pendingUpdate.
   * Stores the update request. The actual update is deferred until
   * all running tasks complete.
   */
  requestUpdate(update: PendingUpdate): void {
    if (this.pendingUpdate !== null) {
      console.log(`[UpdateManager] Update already pending (version=${this.pendingUpdate.version}), replacing with version=${update.version}`);
    }
    this.pendingUpdate = update;
    console.log(`[UpdateManager] Update deferred until tasks complete: version=${update.version}`);
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
   * Check if tasks are done and apply the update if so.
   */
  private async tryApply(): Promise<void> {
    if (this.applyInProgress) return;
    if (!this.pendingUpdate) return;

    const running = this.getRunningTaskCount();
    if (running > 0) {
      console.log(`[UpdateManager] Waiting for ${running} running task(s) to complete before applying update v${this.pendingUpdate.version}...`);
      // Check again after interval
      setTimeout(() => this.tryApply(), this.checkIntervalMs);
      return;
    }

    // No running tasks — apply the update
    this.applyInProgress = true;
    const update = this.pendingUpdate;
    this.pendingUpdate = null;

    console.log(`[UpdateManager] All tasks complete. Applying update: version=${update.version}`);

    try {
      if (update.command) {
        console.log(`[UpdateManager] Running update command: ${update.command}`);
        const output = execSync(update.command, {
          encoding: 'utf-8',
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        console.log(`[UpdateManager] Update command output:\n${output}`);
      } else {
        console.log(`[UpdateManager] No update command specified — skipping execution`);
      }
    } catch (err: any) {
      console.error(`[UpdateManager] Update command failed: ${err.message}`);
      console.error(err.stdout || '');
      console.error(err.stderr || '');
      this.applyInProgress = false;
      // Don't exit on failure — the operator can inspect logs and retry
      return;
    }

    console.log(`[UpdateManager] Update applied. Exiting for restart (version=${update.version})...`);

    // Give logs a moment to flush, then exit
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }
}
