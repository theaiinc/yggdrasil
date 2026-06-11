import { execSync } from 'node:child_process';

import type { Transport, RunnerTask, TaskHandler, TaskExecutorConfig } from '../types/index.js';

/**
 * Built-in handler: 'echo'
 * Simply completes the task with the metadata echoed back.
 */
const echoHandler: TaskHandler = async (task) => {
  const result = {
    message: 'Task executed successfully',
    taskType: task.type,
    taskId: task.taskId,
    input: task.metadata ?? {},
    executedAt: new Date().toISOString(),
  };
  console.log(`[TaskExecutor] Echo task ${task.taskId}:`, JSON.stringify(result));
  return { status: 'completed', metadata: { output: result } };
};

/**
 * Built-in handler: 'exec'
 * Runs a shell command from task.metadata.command.
 */
const execHandler: TaskHandler = async (task) => {
  const command = task.metadata?.command as string | undefined;
  if (!command) {
    return {
      status: 'failed',
      metadata: { error: 'No command specified in task.metadata.command' },
    };
  }

  const timeout = (task.metadata?.timeout as number) ?? 30_000;

  try {
    console.log(`[TaskExecutor] Executing command: ${command}`);
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 1024 * 1024,
    });
    const stderr = ''; // execSync throws on non-zero exit, so this is clean
    return {
      status: 'completed',
      metadata: { stdout, stderr, command, exitCode: 0 },
    };
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; stderr?: string; status?: number };
    return {
      status: 'failed',
      metadata: {
        command,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        exitCode: error.status ?? 1,
      },
    };
  }
};

/**
 * Built-in handler: 'http'
 * Performs an HTTP request to the URL from task.metadata.url.
 */
const httpHandler: TaskHandler = async (task) => {
  const url = task.metadata?.url as string | undefined;
  if (!url) {
    return {
      status: 'failed',
      metadata: { error: 'No URL specified in task.metadata.url' },
    };
  }

  const method = (task.metadata?.method as string) ?? 'GET';
  const body = task.metadata?.body as Record<string, unknown> | undefined;

  try {
    const fetchInit: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      fetchInit.body = JSON.stringify(body);
    }
    const response = await fetch(url, fetchInit);
    const responseBody = await response.text();
    return {
      status: 'completed',
      metadata: {
        url,
        method,
        statusCode: response.status,
        body: responseBody.slice(0, 100_000), // cap response size
      },
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      status: 'failed',
      metadata: { url, method, error: error.message },
    };
  }
};

const DEFAULT_HANDLERS: Record<string, TaskHandler> = {
  echo: echoHandler,
  exec: execHandler,
  http: httpHandler,
};

/**
 * TaskExecutor — polls Yggdrasil for pending tasks and executes them.
 *
 * On each poll cycle:
 *   1. Fetches all 'running' tasks for this runner
 *   2. For each task, looks up a handler by task.type
 *   3. Executes the handler
 *   4. Reports the result back to Yggdrasil
 */
export class TaskExecutor {
  private readonly transport: Transport;
  private readonly config: Required<TaskExecutorConfig>;
  private readonly handlers: Record<string, TaskHandler>;
  private timerId: ReturnType<typeof setInterval> | undefined;
  private running: Set<string> = new Set();

  constructor(transport: Transport, config: TaskExecutorConfig) {
    this.transport = transport;
    this.config = {
      runnerId: config.runnerId,
      pollInterval: config.pollInterval ?? 10,
      handlers: {},
    };
    this.handlers = { ...DEFAULT_HANDLERS, ...config.handlers };
  }

  /**
   * Start polling for pending tasks.
   */
  start(): void {
    if (this.timerId) return;

    console.log(`[TaskExecutor] Starting — polling every ${this.config.pollInterval}s for runner ${this.config.runnerId}`);
    this.poll(); // immediate first poll
    this.timerId = setInterval(() => this.poll(), this.config.pollInterval * 1000);
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
   * Register (or override) a task handler at runtime.
   * Used by the preset system to load handlers via dynamic import.
   */
  addHandler(type: string, handler: TaskHandler): void {
    this.handlers[type] = handler;
  }

  /**
   * Returns the number of tasks currently being executed.
   */
  runningCount(): number {
    return this.running.size;
  }

  /**
   * Single poll cycle.
   */
  private async poll(): Promise<void> {
    try {
      const tasks = await this.transport.fetchTasks(this.config.runnerId, 'running');

      for (const task of tasks) {
        // Skip tasks already being processed in this cycle
        if (this.running.has(task.taskId)) continue;
        this.running.add(task.taskId);

        // Process without blocking the poll cycle
        this.executeTask(task).finally(() => {
          this.running.delete(task.taskId);
        });
      }
    } catch (err) {
      // Poll failures are non-fatal; will retry on next interval
    }
  }

  /**
   * Execute a single task and report the result.
   */
  private async executeTask(task: RunnerTask): Promise<void> {
    const tag = task.correlationId
      ? `task ${task.taskId} (corr: ${task.correlationId})`
      : `task ${task.taskId}`;

    const handler = this.handlers[task.type];
    if (!handler) {
      console.warn(`[TaskExecutor] No handler for type "${task.type}" — ${tag}`);
      await this.transport.updateTask(this.config.runnerId, task.taskId, {
        status: 'failed',
        metadata: { error: `No handler registered for task type "${task.type}"` },
      });
      return;
    }

    console.log(`[TaskExecutor] Executing ${tag} (type: ${task.type})`);
    try {
      const result = await handler(task);
      await this.transport.updateTask(this.config.runnerId, task.taskId, {
        status: result.status,
        metadata: result.metadata ?? {},
      });
      console.log(`[TaskExecutor] ${tag} ${result.status}`);
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[TaskExecutor] Handler threw for ${tag}:`, error.message);
      await this.transport.updateTask(this.config.runnerId, task.taskId, {
        status: 'failed',
        metadata: { error: error.message },
      });
    }
  }
}
