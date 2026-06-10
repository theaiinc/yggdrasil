# Technical Proposal

## 1. Overview

We will implement a distributed orchestration system consisting of:

- **Single Orchestration Controller**: manages workflow, issues requests to agents.
- **Agent Containers**: perform tasks, auto-scaled via Cloud Run.
- **Local Simulation**: replicate runtime and autoscaling behavior on local/dev setups.

This setup ensures reliability, resource control, and consistency across environments.

---

## 2. Cloud Run Configuration

### 🧩 Concurrency & Auto‑Scaling

- Set `maxConcurrency` (default 80) or adjustable down to 1 for thread-unsafe or heavy workloads.
- Autoscaler monitors concurrency & CPU utilization, launching new instances ahead of CPU bottlenecks.
- Configure `minInstances` to reduce cold-starts and `maxInstances` to cap resource use.

### 🚦 Request Handling

- New requests arriving when an instance is at capacity are **queued** (for ~10 s + startup time).
- If capacity becomes available or a new instance launches, queued requests are served.
- If limits are hit, HTTP 429s are returned—handled by orchestration logic.

### 🗂 Session Affinity

- Optional stickiness via session affinity ensures repeated calls from the same client go to the same instance, useful for stateful workflows.

---

## 3. Local Simulation Strategy

Since Cloud Run’s autoscaler isn’t available locally, we replicate its behavior:

### Step-by-Step Workflow

1. **Run Agent Container Locally**
   - Via Docker (e.g., `docker run -p 9090:8080 …`) or `gcloud beta code dev` to simulate Cloud Run flags.
2. **Define Resource Limits & Concurrency**
   - Enforce CPU/memory caps in Docker.
   - Use emulator concurrency settings to mimic Cloud Run.
3. **Load-testing**
   - Use tools (e.g., `hey`, `wrk`) to generate concurrent requests up to capacity.
4. **Manual Instance Simulation**
   - Launch additional local containers to simulate scaling.
   - Route new requests to these instances via a simple local load-balancer or round-robin script.
5. **Retry / 429 Handling**
   - Force a 429 once capacity is reached; observe orchestration controller within app retrying or redirecting requests.

---

## 4. Orchestration Controller Behavior

- **Queuing & Retrying**: If a 429 or timeout is returned, controller retries with back-off or redirects to another instance.
- **Fail-fast / Circuit Breaker**: After configurable retries, mark agent as unhealthy and log alerts.
- **Health Checks**: Periodically call `/health` endpoint to detect instance readiness and ensure proper request distribution.
- **Session Affinity Awareness**: Route to same agent when adjacency/memory locality is required.

---

## 5. Monitoring & Metrics

We’ll track:

- **Concurrent request rate** per agent instance.
- **CPU and memory utilization** against thresholds.
- **Queue depth**, **cold-start counts**, and **429/timeout rates**.
- **Retry success rate** and **latency profiles**.

These inform tuning of `min/maxInstances`, `maxConcurrency`, and retry/back-off strategies.

---

## 6. Summary Table

| Concern                     | Cloud Run Behavior                                | Local Simulation Strategy                                 |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Resource control            | Set `maxConcurrency`, `min/maxInstances`          | Limit Docker containers, tune CPU/mem flags               |
| Autoscaling                 | Auto‑spawn instances on CPU/concurrency threshold | Manually start new containers, simulate load-balancing    |
| Queuing & overflow          | Queued for ~10s + startup; 429 on spillover       | Simulate queue + force 429s                               |
| Cold‑starts                 | Reduced by `minInstances`                         | Pre-launch containers to mimic warm state                 |
| Retry/back-off              | Controller retries on 429/timeout                 | Observe controller behavior under load simulation         |
| Session affinity (optional) | Cloud Run stickiness based on session affinity    | Local routing logic keeps same container for repeat calls |

---

## 7. Next Steps

1. **Prototype** local simulation: a Docker stack with multiple agent containers and load-generator.
2. **Record metrics** and tune threshold configurations.
3. **Deploy to Cloud Run** using locally-tested parameters.
4. **Monitor in production**, adjust as needed.

---

Let me know if you'd like me to add diagrams, specific scripts, or detailed metric dashboard examples!
