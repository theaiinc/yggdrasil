/**
 * Node handler — executes Node.js scripts or expressions.
 */
import { execSync } from 'child_process';

async function nodeHandler(task: { script: string }): Promise<{ stdout: string; stderr: string; code: number }> {
  const nodeBin = process.env.NODE_BIN || 'node';

  try {
    const output = execSync(`${nodeBin} -e "${task.script.replace(/"/g, '\\"')}"`, {
      timeout: 60_000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: 'pipe',
      shell: '/bin/sh',
    });
    return { stdout: output.trim(), stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString().trim() ?? '',
      stderr: err.stderr?.toString().trim() ?? err.message,
      code: err.status ?? 1,
    };
  }
}

async function nodeRunHandler(task: { file: string; args?: string[] }): Promise<{ stdout: string; stderr: string; code: number }> {
  const nodeBin = process.env.NODE_BIN || 'node';
  const args = (task.args ?? []).join(' ');

  try {
    const output = execSync(`${nodeBin} ${task.file} ${args}`, {
      timeout: 120_000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: 'pipe',
      shell: '/bin/sh',
    });
    return { stdout: output.trim(), stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString().trim() ?? '',
      stderr: err.stderr?.toString().trim() ?? err.message,
      code: err.status ?? 1,
    };
  }
}

export { nodeHandler, nodeRunHandler };
