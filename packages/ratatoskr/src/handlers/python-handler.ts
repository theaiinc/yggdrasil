/**
 * Python handler — executes Python scripts or expressions.
 */
import { execSync } from 'child_process';

async function pythonHandler(task: { script: string; expression?: string }): Promise<{ stdout: string; stderr: string; code: number }> {
  const venvPython = '/app/python-venv/bin/python3';
  const pythonBin = process.env.PYTHON_BIN || venvPython;

  let command: string;
  if (task.expression) {
    command = `${pythonBin} -c "${task.expression.replace(/"/g, '\\"')}"`;
  } else {
    command = `${pythonBin} -c "${task.script.replace(/"/g, '\\"')}"`;
  }

  try {
    const output = execSync(command, {
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

export { pythonHandler };
