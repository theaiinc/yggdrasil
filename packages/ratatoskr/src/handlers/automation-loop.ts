/**
 * Shared automation loop for Realm-backed computer use (desktop + Android).
 *
 * Flow: screenshot → decide action → execute via Realm API → repeat.
 */

import type { TaskHandler, RunnerTask } from '../types/index.js';
import {
  RealmClient,
  type RealmClientConfig,
  type RealmEngineType,
  type RealmScreenshot,
  loadRealmUrl,
  loadRealmApiKey,
} from './realm-client.js';

export interface AutomationConfig {
  engine: RealmEngineType;
  realmUrl: string;
  realmApiKey?: string | undefined;
  realmId?: string | undefined;
  realmName?: string | undefined;
  environment?: Record<string, string> | undefined;
  maxIterations: number;
}

export interface AutomationAction {
  action: string;
  params: Record<string, unknown>;
}

async function decideAction(
  goal: string,
  screenshot: RealmScreenshot,
  previousActions: string[],
): Promise<AutomationAction> {
  // Placeholder — real implementation will use a vision-capable LLM.
  void goal;
  void screenshot;
  void previousActions;
  return { action: 'wait', params: { ms: 500 } };
}

function isGoalComplete(result: { data?: unknown }): boolean {
  const data = result.data;
  if (data && typeof data === 'object' && 'goal_complete' in data) {
    return Boolean((data as Record<string, unknown>).goal_complete);
  }
  return false;
}

async function executeAction(
  client: RealmClient,
  realmId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  switch (action) {
    case 'click':
    case 'tap':
      return client.click(realmId, params.x as number, params.y as number);
    case 'type':
      return client.type(realmId, params.text as string);
    case 'navigate':
      return client.navigate(realmId, params.url as string);
    case 'exec':
      return client.exec(realmId, params.command as string);
    case 'wait':
      await new Promise((r) => setTimeout(r, (params.ms as number) ?? 500));
      return { success: true };
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

export function createAutomationHandler(config: AutomationConfig): TaskHandler {
  return async (task: RunnerTask) => {
    const goal = (task.metadata?.goal as string) || '';
    if (!goal) {
      return { status: 'failed', metadata: { error: 'No goal specified for automation task' } };
    }

    const realmIdOverride = (task.metadata?.realmId as string) || config.realmId;
    const clientConfig: RealmClientConfig = {
      baseUrl: config.realmUrl,
      engine: (task.metadata?.engine as RealmEngineType) || config.engine,
    };
    if (config.realmApiKey) clientConfig.apiKey = config.realmApiKey;
    if (realmIdOverride) clientConfig.realmId = realmIdOverride;
    if (config.realmName) clientConfig.realmName = config.realmName;
    if (config.environment) clientConfig.environment = config.environment;
    const client = new RealmClient(clientConfig);

    const previousActions: string[] = [];
    let iteration = 0;

    try {
      const realmId = await client.ensureRealm();

      while (iteration < config.maxIterations) {
        iteration++;

        const screenshot = await client.capture(realmId);
        const decision = await decideAction(goal, screenshot, previousActions);
        const result = await executeAction(client, realmId, decision.action, decision.params);

        if (!result.success) {
          return {
            status: 'failed',
            metadata: {
              error: result.error || `Action failed: ${decision.action}`,
              goal,
              realmId,
              engine: config.engine,
              iterations: iteration,
              lastAction: decision.action,
            },
          };
        }

        previousActions.push(`${decision.action}(${JSON.stringify(decision.params)})`);

        if (isGoalComplete(result)) {
          return {
            status: 'completed',
            metadata: {
              goal,
              realmId,
              engine: config.engine,
              iterations: iteration,
              actions: previousActions,
            },
          };
        }

        if (decision.action === 'wait') {
          const ms = (decision.params.ms as number) ?? 500;
          await new Promise((r) => setTimeout(r, ms));
        }
      }

      return {
        status: 'completed',
        metadata: {
          goal,
          realmId: client.getRealmId(),
          engine: config.engine,
          iterations: iteration,
          actions: previousActions,
          note: 'Max iterations reached',
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'failed',
        metadata: {
          error: `Automation loop error at iteration ${iteration}: ${message}`,
          goal,
          engine: config.engine,
          iterations: iteration,
        },
      };
    } finally {
      const destroy = task.metadata?.destroyRealm === true || process.env.REALM_DESTROY_ON_COMPLETE === 'true';
      if (destroy) await client.cleanup();
    }
  };
}

export function buildAutomationConfig(
  engine: RealmEngineType,
  extraEnv?: Record<string, string>,
): AutomationConfig {
  const config: AutomationConfig = {
    engine,
    realmUrl: loadRealmUrl(),
    maxIterations: parseInt(process.env.CU_MAX_ITERATIONS || '50', 10),
  };
  const apiKey = loadRealmApiKey();
  if (apiKey) config.realmApiKey = apiKey;
  if (process.env.REALM_ID) config.realmId = process.env.REALM_ID;
  if (extraEnv && Object.keys(extraEnv).length > 0) config.environment = extraEnv;
  return config;
}
