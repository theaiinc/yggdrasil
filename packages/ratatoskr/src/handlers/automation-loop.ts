/**
 * Shared automation loop for session-based Computer Use (desktop + Android).
 *
 * Flow: create session → observe → decide action → send input → observe → repeat.
 *
 * Cognition interacts through sessions:
 *   startSession({ type: "computer-use" })
 *   observe(sessionId)  →  SessionObservation
 *   input(sessionId, { type: "mouse", params: { x, y } })
 *
 * NOT through streaming:
 *   requestScreenStream()  ✗
 *   startStream()          ✗
 *   stopStream()           ✗
 */

import type { TaskHandler, RunnerTask } from '../types/index.js';
import type { SessionObservation, SessionInput } from '../types/index.js';
import {
  RealmClient,
  type RealmClientConfig,
  type RealmEngineType,
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
  observation: SessionObservation,
  previousActions: string[],
): Promise<AutomationAction> {
  // Placeholder — real implementation will use a vision-capable LLM.
  void goal;
  void observation;
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

async function executeSessionAction(
  client: RealmClient,
  sessionId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  switch (action) {
    case 'click':
    case 'tap': {
      const input: SessionInput = {
        type: action === 'click' ? 'mouse' : 'touch',
        params: { x: params.x, y: params.y },
      };
      const result = await client.input(sessionId, input);
      return {
        success: result.success,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    }
    case 'type': {
      const input: SessionInput = {
        type: 'keyboard',
        params: { text: params.text as string },
      };
      const result = await client.input(sessionId, input);
      return {
        success: result.success,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    }
    case 'navigate':
      // Navigate is a Realm input action.
      return { success: false, error: 'Navigate not yet supported in session mode' };
    case 'exec':
      return { success: false, error: 'Exec not yet supported in session mode' };
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
    let sessionId: string | undefined;

    try {
      // Create a session for this automation task.
      // Cognition requests: startSession({ type: "computer-use" })
      const sessionType = config.engine === 'vm' ? 'phone-use' : 'computer-use';
      const session = await client.createSession({
        type: sessionType,
        ...(realmIdOverride !== undefined ? { realmId: realmIdOverride } : {}),
        ...({ metadata: { goal, engine: config.engine } }),
      });
      sessionId = session.sessionId;

      while (iteration < config.maxIterations) {
        iteration++;

        // Observe the current state via the session.
        // Realm decides how observation is delivered (screenshot, a11y tree, etc.).
        const observation = await client.observe(sessionId);
        const decision = await decideAction(goal, observation, previousActions);
        const result = await executeSessionAction(client, sessionId, decision.action, decision.params);

        if (!result.success) {
          return {
            status: 'failed',
            metadata: {
              error: result.error || `Action failed: ${decision.action}`,
              goal,
              realmId: session.descriptor?.realmId,
              sessionId,
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
              realmId: session.descriptor?.realmId,
              sessionId,
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
          realmId: (await client.getSession(sessionId))?.realmId,
          sessionId,
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
      if (sessionId) {
        const destroy = task.metadata?.destroyRealm === true || process.env.REALM_DESTROY_ON_COMPLETE === 'true';
        await client.terminateSession(sessionId, destroy);
      }
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
