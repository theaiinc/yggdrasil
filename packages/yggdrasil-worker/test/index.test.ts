import { env, SELF, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const apiKey = "test-key";

function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-API-Key", apiKey);
  return SELF.fetch(`https://yggdrasil-worker.test${path}`, {
    ...init,
    headers,
  });
}

describe.sequential("Yggdrasil Worker", () => {
  it("keeps health and metrics public while protecting the API", async () => {
    const health = await SELF.fetch("https://yggdrasil-worker.test/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual(expect.objectContaining({
  status: "healthy",
  runners: { total: 0, online: 0, offline: 0 },
}));

    const unauthorized = await SELF.fetch("https://yggdrasil-worker.test/runners");
    expect(unauthorized.status).toBe(401);

    const metrics = await SELF.fetch("https://yggdrasil-worker.test/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("Content-Type")).toContain("text/plain");
    expect(await metrics.text()).toContain("yggdrasil_runners_total");
  });

  it("registers, heartbeats, and lists a runner", async () => {
    const runnerId = `lifecycle-runner-${Date.now()}`;
    const registration = await request("/runners/register", {
      method: "POST",
      body: JSON.stringify({
        runnerId,
        name: "Lifecycle runner",
        endpoint: "http://runner.local",
        version: "1.0.0",
        capabilities: ["tasks"],
      }),
    });
    expect(registration.status).toBe(201);
    expect(await registration.json()).toEqual({
      runnerId,
      status: "registered",
    });

    const heartbeat = await request("/runners/heartbeat", {
      method: "POST",
      body: JSON.stringify({ runnerId }),
    });
    expect(heartbeat.status).toBe(200);
    expect(await heartbeat.json()).toEqual({ status: "ok" });

    const listing = await request("/runners");
    expect(listing.status).toBe(200);
    const runners = await listing.json() as Array<{ runnerId: string; status: string }>;
    expect(runners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runnerId,
        status: "online",
      }),
    ]));
  });

  it("creates, reads, and updates tasks", async () => {
    const runnerId = `task-runner-${Date.now()}`;
    const registration = await request("/runners/register", {
      method: "POST",
      body: JSON.stringify({ runnerId }),
    });
    expect(registration.status).toBe(201);

    const created = await request(`/runners/${runnerId}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        taskId: "task-1",
        type: "demo",
        metadata: { source: "test" },
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(
      expect.objectContaining({
        taskId: "task-1",
        type: "demo",
        status: "running",
      }),
    );

    const updated = await request(`/runners/${runnerId}/tasks/task-1`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(
      expect.objectContaining({
        taskId: "task-1",
        status: "completed",
        completedAt: expect.any(Number),
      }),
    );

    const tasks = await request(`/runners/${runnerId}/tasks?status=completed`);
    expect(await tasks.json()).toEqual({
      runnerId,
      tasks: [expect.objectContaining({ taskId: "task-1", status: "completed" })],
      count: 1,
    });
  });

  it("marks an expired runner offline through the Durable Object alarm", async () => {
    const runnerId = `expiring-runner-${Date.now()}`;
    const registration = await request("/runners/register", {
      method: "POST",
      body: JSON.stringify({ runnerId }),
    });
    expect(registration.status).toBe(201);

    // Allow the one-second test lease to elapse before explicitly running the
    // Durable Object alarm.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const id = env.YGGDRASIL.idFromName("global");
    const durableObject = env.YGGDRASIL.get(id);
    await runDurableObjectAlarm(durableObject);

    const listing = await request("/runners");
    const runners = await listing.json() as Array<{ runnerId: string; status: string }>;
    expect(runners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runnerId,
        status: "offline",
      }),
    ]));
  });

  it("exposes every controller route without returning 404", async () => {
    const runnerId = `contract-runner-${Date.now()}`;
    const sessionId = `contract-session-${Date.now()}`;
    const realmId = `contract-realm-${Date.now()}`;
    const routes: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
      { method: "POST", path: "/runners/register", body: { runnerId } },
      { method: "POST", path: "/runners/heartbeat", body: { runnerId } },
      { method: "POST", path: `/runners/${runnerId}/request-update`, body: { version: "1.0.1" } },
      { method: "POST", path: "/runners/update", body: { runnerIds: [] } },
      { method: "POST", path: `/runners/${runnerId}/tasks`, body: { taskId: "contract-task", type: "test" } },
      { method: "GET", path: `/runners/${runnerId}/tasks` },
      { method: "PATCH", path: `/runners/${runnerId}/tasks/contract-task`, body: { status: "completed" } },
      { method: "POST", path: "/runners/offline", body: { runnerId } },
      { method: "GET", path: "/api/runners" },
      { method: "GET", path: `/api/runners/${runnerId}` },
      { method: "POST", path: "/api/v1/sessions", body: { sessionId } },
      { method: "GET", path: "/api/v1/sessions" },
      { method: "GET", path: `/api/v1/sessions/${sessionId}` },
      { method: "PATCH", path: `/api/v1/sessions/${sessionId}`, body: { status: "active" } },
      { method: "DELETE", path: `/api/v1/sessions/${sessionId}` },
      { method: "GET", path: "/api/v1/realms" },
      { method: "POST", path: "/api/v1/realms/register", body: { realmId } },
      { method: "POST", path: "/api/v1/realms/heartbeat", body: { realmId } },
      { method: "POST", path: "/api/v1/realms/deregister", body: { realmId } },
      { method: "GET", path: `/api/v1/realms/${realmId}` },
      { method: "PATCH", path: `/api/v1/realms/${realmId}`, body: { status: "active" } },
      { method: "DELETE", path: `/api/v1/realms/${realmId}` },
    ];

    for (const route of routes) {
      const response = await request(route.path, {
        method: route.method,
        ...(route.body ? { body: JSON.stringify(route.body) } : {}),
      });
      expect(response.status, `${route.method} ${route.path}`).not.toBe(404);
    }
  });
});