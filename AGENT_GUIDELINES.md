# Agent Guidelines — Yggdrasil

## Completed Milestone: Realm Registration & Lifecycle Loop (2026-06-12)

The operational control loop is now complete. Realm is no longer a passive object from Yggdrasil's perspective.

```
Yggdrasil ──→ Spawn command ──→ Ratatoskr ──→ Realm
                                                    │
                                                    ├── registration ──→ Ratatoskr ──→ Yggdrasil
                                                    ├── heartbeat    ──→ Ratatoskr ──→ Yggdrasil
                                                    └── deregister   ──→ Ratatoskr ──→ Yggdrasil
```

**Lifecycle states:** `creating` → `running` ↔ `unhealthy` → `destroyed`
- `RealmLifecycleService` handles registration, heartbeat, stale detection (60s TTL)
- Realm stale detection auto-recovers from `unhealthy` on next healthy heartbeat
- `unhealthy` state dropped from `RealmState` after recovery — Yggdrasil owns state transitions

**Key types added:**
- `RealmRegistration` — realm announces itself (ID, runner, template, version, capabilities, endpoints)
- `RealmHeartbeat` — periodic health (uptime, healthy, sessions)
- `RealmDeregistration` — intentional shutdown (reason: shutdown | error | replaced)

**Transport:** Realm → Ratatoskr `HttpTransport` relay → Yggdrasil routes. Ratatoskr never inspects or stores realm state.

**RegistrationClient** (`realm-core`): handles boot registration, periodic heartbeats (30s default), deregistration on SIGTERM/SIGINT. Wired into `realm-api/server.ts` via config or env vars.

**Current version:** `@theaiinc/yggdrasil` = 0.3.0, `@theaiinc/yggdrasil-ratatoskr` = 0.3.0, `@theaiinc/yggdrasil-runtime` = 0.1.1

---

### 2026-06-12 — Yggdrasil Decides, Ratatoskr Reports & Executes, Realm Runs

**Key Insight:** The `RealmScheduler` should NOT create realms. It should only return an allocation decision. Otherwise it becomes a god object with scheduling, spawning, registry, lifecycle, and ownership responsibilities.

**The Split:**
- `RealmScheduler` — **decides** which runner/template to use (allocation only)
- `RealmProvisioner` — **creates** realms (spawn or attach)
- `RealmRegistry` — **stores** realms and templates
- `SessionManager` — **attaches** sessions to realms

**The Flow:**
```
const allocation = await realmScheduler.schedule(request);
const realm = await realmProvisioner.ensureRealm(allocation);
const session = await sessionManager.create({ realmId: realm.id });
```

**Three Realm States (not 2):**
1. Template — what CAN be spawned (advertised by runner)
2. Instance — what IS running
3. Pool — what is IDLE and reusable

Scheduling priority: attach existing → reuse pooled → spawn new

**Naming Convention:**
- `Realm` (not `RealmInstance`) — cleaner everyday terminology
- `"Attach to realm-123"` vs `"Attach to realm-instance-123"`
- The template/instance distinction lives in the schema, not in everyday speech

**`ownerId` as Scheduling Primitive:**
- Not just session metadata — it's **affinity**
- `ownerId = steve` → scheduler checks if Steve has an existing realm → attach if yes, provision if no
- This is the foundation for persistent digital environments

---

### 2026-06-12 — Yggdrasil Decides, Ratatoskr Reports & Executes, Realm Runs

**Critical architectural boundary (learned by rolling back a decentralized allocator):**

Ratatoskr was briefly given `RealmAllocator` with `attach | reuse | spawn | reject` logic.
This was rolled back because it creates a **second orchestrator**.

**The dangerous path:**
```
Yggdrasil (global scheduler)
Ratatoskr (local allocator)   ← second scheduler forming
```
At first elegant. In practice: duplicated placement, reuse, pooling, affinity, resource selection.
Then you spend years figuring out which scheduler owns what.

**The correct boundary:**
```
Yggdrasil    — owns intent and policy
Ratatoskr    — owns facts and execution
Realm        — owns runtime behavior
Veil         — owns trust and permissions
```

Even shorter:
```
Yggdrasil decides.
Ratatoskr reports and executes.
Realm runs.
Veil protects.
```

**What Yggdrasil owns:**
- Global state
- Realm registry
- Session registry
- Scheduling policy
- Owner affinity
- Pooling policy

Questions it answers:
- Should we attach?
- Should we reuse?
- Should we spawn?
- Which runner?
- Which realm?

**What Ratatoskr owns:**
- Node discovery
- Resource collection
- Task execution
- Host capabilities
- Realm templates

Questions it answers:
- Can I do it? (not "What should we do?")

**What Realm owns:**
- Execution
- Observation
- Input
- Desktop/browser state

**The one thing worth preserving from the experiment — the VETO:**
Not `Ratatoskr.allocate()` (orchestration).
But `Ratatoskr.executeTask()` can fail (execution failure).

Example:
```
Yggdrasil → Spawn Ubuntu Realm
Ratatoskr: Not enough memory
returns: { success: false, reason: "insufficient_resources" }
```

That's not orchestration. That's execution failure. Very different thing.

**Rule for future contributors:**
Ratatoskr may say "I cannot do that."
Ratatoskr should NOT say "I think we should do this instead."
The moment Ratatoskr starts choosing between attach, reuse, spawn, pool selection,
affinity, and priorities, you've accidentally built a second Yggdrasil.

---

### 2026-06-11 — Realm Lifecycle Architecture (Scheduler / Provisioner / Registry Split)

### 2026-06-11 — Control Plane / Data Plane Split

**Yggdrasil** = Control Plane (session lifecycle, scheduling, authorization)
**Realm** = Data Plane (observation, input, execution)

Sessions do NOT run on runners. Sessions run on realms. Realms run on runners.

---

## TypeScript Strictness Notes

- `exactOptionalPropertyTypes: true` requires `| undefined` on optional properties
- `noUncheckedIndexedAccess: true` requires explicit checks on array access (e.g., `arr[0]!` or `if (arr[0])`)
- Never use `axios.create().defaults.baseURL` in tests — mock the instance properly

---

## Monorepo Structure

- `@theaiinc/yggdrasil` — orchestration server (control plane)
- `@theaiinc/yggdrasil-ratatoskr` — runner daemon (node agent)
- `@theaiinc/yggdrasil-runtime` — ComputerUseRuntime implementation (consumed by Cognition)
- Realm lives in a separate repo (`/Users/stevetran/theaiincrealm/`)
