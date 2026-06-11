/**
 * GitHub CLI handler — runs gh CLI commands.
 */
import { execSync } from 'child_process';

async function githubHandler(task: { command: string; args?: string[] }): Promise<{ stdout: string; stderr: string; code: number }> {
  const ghToken = process.env.GITHUB_TOKEN || '';

  const env: Record<string, string | undefined> = { ...process.env };
  if (ghToken && !env.GH_TOKEN) {
    env.GH_TOKEN = ghToken;
  }

  const fullArgs = (task.args ?? []).join(' ');
  const command = `gh ${task.command} ${fullArgs}`;

  try {
    const output = execSync(command, {
      timeout: 120_000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: 'pipe',
      shell: '/bin/sh',
      env: env as Record<string, string>,
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

export { githubHandler };
