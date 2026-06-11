/**
 * Shell handler — executes shell commands.
 * Registered for the 'shell' task type.
 */

import type { TaskHandler } from '../types/index.js';
import { execSync } from 'child_process';

export const shellHandler: TaskHandler = async (task) => {
  const command = (task.metadata?.command as string) || '';
  if (!command) return { status: 'failed', metadata: { error: 'No command specified' } };

  const timeout = (task.metadata?.timeout as number) ?? 30_000;

  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      status: 'completed',
      metadata: { stdout: stdout.slice(0, 100_000), command, exitCode: 0 },
    };
  } catch (err: any) {
    return {
      status: 'failed',
      metadata: {
        command,
        stdout: (err.stdout || '').slice(0, 100_000),
        stderr: (err.stderr || err.message).slice(0, 100_000),
        exitCode: err.status ?? 1,
      },
    };
  }
};
