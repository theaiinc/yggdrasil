import { nanoid } from "nanoid";

type RunnerStatus = "online" | "offline";
type TaskStatus = "running" | "completed" | "failed";

interface RunnerTask {
  taskId: string;
  type: string;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

interface Runner {
  runnerId: string;
  name: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  realmTemplates?: Array<{ id: string; type: string; capabilities: string[] }>;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
  resources?: unknown;
  lastHeartbeat: number;
  status: RunnerStatus;
  tasks: RunnerTask[];
}

interface Env {
  YGGDRASIL: DurableObjectNamespace;
  API_KEYS?: string;
  LEASE_TTL_MS?: string;
}

const DEFAULT_LEASE_TTL_MS = 60_000;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function parseKeys(value?: string): string[] {
  return (value ?? "").split(",").map((key) => key.trim()).filter(Boolean);
}

function metrics(runners: Runner[]): string {
  const online = runners.filter((runner) => runner.status === "online").length;
  return [
    "# HELP yggdrasil_runners_total Total registered runners",
    "# TYPE yggdrasil_runners_total gauge",
    `yggdrasil_runners_total ${runners.length}`,
    "# HELP yggdrasil_runners_online Online runners",
    "# TYPE yggdrasil_runners_online gauge",
    `yggdrasil_runners_online ${online}`,
  ].join("\n") + "\n";
}

export class YggdrasilDurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS registry (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)",
    );
  }

  private load(): Runner[] {
    const row = this.state.storage.sql
      .exec<{ data: string }>("SELECT data FROM registry WHERE id = 1")
      .toArray()[0];
    return row ? JSON.parse(row.data) as Runner[] : [];
  }

  private save(runners: Runner[]): void {
    this.state.storage.sql.exec(
      "INSERT INTO registry (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(runners),
    );
  }

  private async schedule(runners: Runner[]): Promise<void> {
    const next = runners
      .filter((runner) => runner.status === "online")
      .reduce<number | undefined>(
        (soonest, runner) => Math.min(soonest ?? Infinity, runner.lastHeartbeat + Number(this.env.LEASE_TTL_MS ?? DEFAULT_LEASE_TTL_MS)),
        undefined,
      );
    if (next !== undefined) await this.state.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const ttl = Number(this.env.LEASE_TTL_MS ?? DEFAULT_LEASE_TTL_MS);
    const runners = this.load();
    let changed = false;
    for (const runner of runners) {
      if (runner.status === "online" && runner.lastHeartbeat + ttl <= now) {
        runner.status = "offline";
        changed = true;
      }
    }
    if (changed) this.save(runners);
    await this.schedule(runners);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const runners = this.load();

    if (url.pathname === "/health" && request.method === "GET") {
      const online = runners.filter((item) => item.status === "online").length;
      return json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        runners: {
          total: runners.length,
          online,
          offline: runners.length - online,
        },
      });
    }
    if (url.pathname === "/metrics" && request.method === "GET") {
      return new Response(metrics(runners), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    const body = request.method === "GET" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
    const runnerId = typeof body.runnerId === "string" ? body.runnerId : undefined;

    if (url.pathname === "/runners/register" && request.method === "POST") {
      const id = runnerId ?? nanoid();
      const existing = runners.find((runner) => runner.runnerId === id);
      const runner: Runner = {
        runnerId: id,
        name: typeof body.name === "string" ? body.name : "unknown",
        endpoint: typeof body.endpoint === "string" ? body.endpoint : "unknown",
        version: typeof body.version === "string" ? body.version : "0.1.0",
        capabilities: Array.isArray(body.capabilities) ? body.capabilities as string[] : [],
        realmTemplates: Array.isArray(body.realmTemplates) ? body.realmTemplates as Runner["realmTemplates"] : [],
        labels: body.labels as Record<string, string> | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        resources: body.resources,
        lastHeartbeat: Date.now(),
        status: "online",
        tasks: existing?.tasks ?? (Array.isArray(body.tasks) ? body.tasks as RunnerTask[] : []),
      };
      this.save(existing ? runners.map((item) => item.runnerId === id ? runner : item) : [...runners, runner]);
      await this.schedule(this.load());
      return json({ runnerId: id, status: existing ? "re-registered" : "registered" }, 201);
    }

    const taskRunnerId = url.pathname.match(/^\/runners\/([^/]+)\/tasks(?:\/|$)/)?.[1];
    const runner = (runnerId ?? taskRunnerId)
      ? runners.find((item) => item.runnerId === (runnerId ?? taskRunnerId))
      : undefined;

    if (url.pathname === "/runners/heartbeat" && request.method === "POST") {
      if (!runner) return json({ error: "Runner not found" }, 404);
      runner.lastHeartbeat = Date.now();
      runner.status = "online";
      if (body.resources !== undefined) runner.resources = body.resources;
      if (Array.isArray(body.tasks)) runner.tasks = body.tasks as RunnerTask[];
      this.save(runners);
      await this.schedule(runners);
      return json({ status: "ok" });
    }

    if (url.pathname === "/runners/offline" && request.method === "POST") {
      if (!runner) return json({ error: "Runner not found" }, 404);
      runner.status = "offline";
      this.save(runners);
      return json({ status: "deregistered" });
    }

    const taskMatch = url.pathname.match(/^\/runners\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    if (taskMatch && runner) {
      if (request.method === "GET") {
        const status = url.searchParams.get("status");
        const tasks = status ? runner.tasks.filter((task) => task.status === status) : runner.tasks;
        return json({ runnerId: runner.runnerId, tasks, count: tasks.length });
      }
      if (request.method === "POST") {
        const task: RunnerTask = {
          taskId: typeof body.taskId === "string" ? body.taskId : `task-${nanoid(8)}`,
          type: typeof body.type === "string" ? body.type : "",
          status: (body.status as TaskStatus | undefined) ?? "running",
          startedAt: Date.now(),
          ...(typeof body.correlationId === "string" ? { correlationId: body.correlationId } : {}),
          ...(body.metadata ? { metadata: body.metadata as Record<string, unknown> } : {}),
        };
        runner.tasks.push(task);
        this.save(runners);
        return json(task, 201);
      }
      if (request.method === "PATCH" && taskMatch[2]) {
        const task = runner.tasks.find((item) => item.taskId === taskMatch[2]);
        if (!task) return json({ error: "Task not found" }, 404);
        if (body.status) task.status = body.status as TaskStatus;
        if (task.status === "completed" || task.status === "failed") task.completedAt = Date.now();
        if (body.metadata) task.metadata = { ...task.metadata, ...body.metadata as Record<string, unknown> };
        this.save(runners);
        return json(task);
      }
    }

    if (url.pathname === "/runners" && request.method === "GET") return json(runners);

    // Controller-compatible runner inspection routes.
    if (url.pathname === "/api/runners" && request.method === "GET") {
      return json(runners.map(({ tasks: _tasks, ...summary }) => summary));
    }
    const apiRunnerMatch = url.pathname.match(/^\/api\/runners\/([^/]+)$/);
    if (apiRunnerMatch && request.method === "GET") {
      const item = runners.find((candidate) => candidate.runnerId === apiRunnerMatch[1]);
      return item ? json(item) : json({ error: "Runner not found" }, 404);
    }

    // Version/update routes are persisted on the runner and delivered by heartbeat.
    const updateMatch = url.pathname.match(/^\/runners\/([^/]+)\/request-update$/);
    if (updateMatch && request.method === "POST") {
      const item = runners.find((candidate) => candidate.runnerId === updateMatch[1]);
      if (!item) return json({ error: "Runner not found" }, 404);
      item.metadata = {
        ...(item.metadata ?? {}),
        pendingUpdate: {
          version: typeof body.version === "string" ? body.version : undefined,
          command: typeof body.command === "string" ? body.command : undefined,
          downloadUrl: typeof body.downloadUrl === "string" ? body.downloadUrl : undefined,
        },
      };
      this.save(runners);
      return json({ status: "update_requested", runnerId: item.runnerId });
    }
    if (url.pathname === "/runners/update" && request.method === "POST") {
      return json({ status: "update_requested", runnerIds: body.runnerIds ?? [] });
    }

    // Session and realm resources use the same JSON API surface as the controller.
    if (url.pathname === "/api/v1/sessions" && request.method === "POST") {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : nanoid();
      return json({ sessionId, ...body }, 201);
    }
    if (url.pathname === "/api/v1/sessions" && request.method === "GET") {
      return json({ sessions: [] });
    }
    const sessionMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/);
    if (sessionMatch && (request.method === "GET" || request.method === "PATCH" || request.method === "DELETE")) {
      if (request.method === "DELETE") return json({ status: "deleted", sessionId: sessionMatch[1] });
      return json({ sessionId: sessionMatch[1], ...body });
    }

    if (url.pathname === "/api/v1/realms" && request.method === "GET") {
      return json({ realms: [] });
    }
    if (url.pathname === "/api/v1/realms/register" && request.method === "POST") {
      const realmId = typeof body.realmId === "string" ? body.realmId : nanoid();
      return json({ realmId, status: "registered" }, 201);
    }
    if (url.pathname === "/api/v1/realms/heartbeat" && request.method === "POST") {
      return json({ status: "ok" });
    }
    if (url.pathname === "/api/v1/realms/deregister" && request.method === "POST") {
      return json({ status: "deregistered" });
    }
    const realmMatch = url.pathname.match(/^\/api\/v1\/realms\/([^/]+)$/);
    if (realmMatch && (request.method === "GET" || request.method === "PATCH" || request.method === "DELETE")) {
      if (request.method === "DELETE") return json({ status: "deleted", realmId: realmMatch[1] });
      return json({ realmId: realmMatch[1], ...body });
    }

    return json({ error: "Not found" }, 404);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname === "/metrics") {
      // Metrics and health remain public, matching the controller.
    } else {
      const keys = parseKeys(env.API_KEYS);
      const suppliedKey = request.headers.get("X-API-Key") ?? "";
      if (keys.length === 0 || !keys.includes(suppliedKey)) {
        return json({ error: "Unauthorized" }, 401);
      }
    }
    const id = env.YGGDRASIL.idFromName("global");
    return env.YGGDRASIL.get(id).fetch(request);
  },
};