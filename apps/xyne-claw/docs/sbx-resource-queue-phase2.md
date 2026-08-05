# Sandbox Resource Queue — Phase 2 (capacity-aware FIFO admission) build spec

**Status:** proposal · **Branch:** `feature/sbx-resource-queue` (from `feature/deploy-xyneclaw`)
**Decision:** go straight to Phase 2 (owner: "we can do phase 2 directly"). This doc is the
build-ready design. It supersedes §3 Phase 2 of `sbx-resource-queue.md`.

> **One thing changes vs the earlier sketch:** Phase 2 does **not** replace the defer-and-resume
> signal — it is built **on top of it**. The semaphore is a *soft* admission cap; the real
> capacity signal is still the k8s claim timeout. See §2.

---

## 1. The capacity fact that drives the design (verified)

Sandboxes are Firecracker microVMs scheduled onto a **dedicated GKE node pool**
(`apps/xyne-claw/infra/kata/00-node-pool.sh`):

```
kata-sandbox-ng · n1-standard-4 (4 vCPU / 15 GB) · nested virt
--enable-autoscaling --min-nodes=0 --max-nodes=3
```

Consequences:

- Capacity is **elastic but hard-capped at 3 nodes** — a small, finite ceiling of concurrent
  microVMs (≈ how many Firecracker VMs fit across 3× n1-standard-4, minus the claw pods).
- Scale-up 0→3 is **slow (minutes)**: GKE must add a node *and* the kata-deploy DaemonSet must
  install Firecracker on it before a claim can bind. This is exactly why a burst of doctor users
  blows past `readyTimeoutMs` (10 min) and surfaces `sbx not available`.
- There is **no single "real capacity" integer** — it depends on per-VM resource requests and how
  many nodes are currently warm. So an app-level semaphore can only ever be an *estimate*.

**Design implication:** admission control (semaphore + FIFO) prevents the thundering herd and gives
fair ordering, but the **provisioning-timeout deferral must remain as the backstop** for when the
estimate is too high or a node is mid-scale-up. A semaphore alone, sized wrong, just reproduces the
bug at a different threshold.

## 2. Target behavior

1. A doctor run needs a writable sandbox → it **acquires an admission slot** for its template
   before calling `createSession`.
2. Slots available → proceed immediately (today's happy path, now bounded).
3. No slot → the run **parks in a per-template FIFO** and ends cleanly with `sandbox_unavailable`;
   the user sees *"queued (position N), I'll continue automatically — no need to re-tag."*
4. A slot is released (sandbox destroyed / evicted / lease TTL expired) → the **head of the FIFO**
   is woken and its run is re-dispatched via existing run-recovery.
5. Slot acquired but the k8s claim **still times out** (mid scale-up / estimate too high) → release
   the slot, re-park the run **at the FIFO head** (keep its place), defer with backoff. Capped by
   `MAX_SANDBOX_DEFERRALS` → then exhaust with a clear message.

## 3. Why a global (Redis) semaphore, not in-process

Both claw-auth and the runtime run **multiple replicas** (see `session-lock.ts`,
`cron-leader-lock.ts`, `daily-brief-worker.ts` "global slot… across ALL replicas"). The only
existing sandbox self-throttle is `KataClient`'s `DEFAULT_MIN_CREATE_SPACING_MS = 10s`, which is
**in-memory and per-client-instance** — it cannot cap *concurrency* across replicas. Admission must
live in **Redis** to be correct cluster-wide. This mirrors how the daily-brief global concurrency
slot already works.

## 4. Where admission attaches (exact anchors)

| Hook | File · symbol | Action |
|---|---|---|
| **Acquire** | `packages/xyne-claw-shared/src/tools/sandbox/tools.ts` · `makeRepoSetupTool.execute`, the write-claim branch right before `client.createSession({ template: claimTemplate, readyTimeoutMs })` (~L1457) | `acquireSlot(template, sessionKey)` with a short non-blocking wait; on miss → emit `sandbox_unavailable` (do **not** fall back to read-only for a write-needing run) |
| **Release (explicit)** | same file · `sandbox-destroy` tool (~L2104) after `session.destroy()` + `evictSession` | `releaseSlot(template, sessionKey)` + push `sandbox:release` signal |
| **Release (implicit)** | same file · `evictSession` (L329) — the central choke point for dead-probe / template-mismatch / idle eviction | `releaseSlot(...)` here so every eviction frees a slot |
| **Release (safety)** | n/a — pod death / server-side `writeIdleTimeoutMs`/`writeSessionTimeoutMs` auto-expiry may skip `evictSession` | **TTL lease** on each slot (renew via the run's heartbeat / `touchRunRecovery`) so a lost VM auto-frees |
| **FIFO wakeup** | `apps/xyne-claw-auth/backend/src/queue/run-recovery-worker.ts` — new `startSandboxReleaseConsumer()` mirroring `startHandoffSignalConsumer()` (L701); booted from `initRunRecoveryWorker()` (L651 → called in `main.ts:320`) | `BRPOP sandbox:release` → pop FIFO head → `scheduleDispatch(root, "sandbox slot freed", 0)` |
| **Defer/exhaust** | same worker — new `isSandboxUnavailableFailure()` + `deferSandboxRetry()` beside `deferLockContentionRetry()` (L179); wire into `handleRunCompletion` (L912) / `dispatchRetry` (L400) exactly where `session_locked` is handled | re-park at FIFO head, backoff, cap at `MAX_SANDBOX_DEFERRALS` |

The runtime already has a scoped Redis client pattern for exactly this kind of cross-service signal
— `apps/xyne-claw/src/handoff-redis.ts` (deliberately claw's only direct Redis use). The admission
client is the **second** scoped use: model it on that file (fail-open, dedicated connection, TTL'd
keys). Reusing that posture keeps the boundary honest.

## 5. Redis data model

```
sandbox:cap:<template>            (int)   configured slot budget (from env, see §6)
sandbox:inuse:<template>          (ZSET)  member=sessionKey, score=leaseExpiryMs   ← TTL leases
sandbox:waitq:<template>          (LIST)  FIFO of rootSessionIds waiting           ← fairness
sandbox:release                   (LIST)  BRPOP signal: {template} slot freed      ← wakeup
```

- **acquireSlot(template, key):** atomically (Lua) purge expired leases from `inuse` (score < now),
  then if `|inuse| < cap` add `key` with `score = now + leaseTtlMs` → **granted**; else `RPUSH` the
  root onto `waitq` → **queued**. One round-trip, no race across replicas.
- **releaseSlot(template, key):** `ZREM inuse key`; `LPUSH sandbox:release {template}`.
- **renewLease:** on run heartbeat (`touchRunRecovery`), bump the `inuse` score so a long legit
  build doesn't get its slot stolen by the expiry sweep.
- Every key TTL-guarded so a dead replica can't wedge the queue (same discipline as
  `HANDOFF_SIGNAL_QUEUE_KEY`'s `QUEUE_TTL_SECONDS`).

## 6. Sizing (operator-tuned, never hardcoded)

`SANDBOX_MAX_CONCURRENT_<TEMPLATE>` env per template (gvisor / lotus / lamf), defaulted
**conservatively** to match the ≤3-node pool (start low, raise as the node pool / VM requests are
tuned). Because it's an estimate, §2.5's timeout-backstop covers over-provisioning. Document the
relationship: raising the cap without raising `--max-nodes` just moves the failure from "queued" to
"claim timeout" (which now degrades gracefully instead of dead-ending).

## 7. Idempotency & correctness (reused, load-bearing)

Re-dispatch on wakeup goes through the existing run-recovery path, so it inherits:
- **GCS result marker** (`runAlreadyCompleted`, `claw-results/<idempotencyKey>.json`) → a run that
  actually finished is never re-run.
- `alreadyPersisted` / `__skipUserMessagePersist` → a resumed run does not duplicate the user's
  chat turn (no branch). Deferrals must **not** consume a retry (copy `deferLockContentionRetry`).

## 8. Observability

- Metrics: `sandbox_slot_inuse{template}`, `sandbox_queue_depth{template}`, `sandbox_wait_ms`
  (park→resume), `sandbox_admission_grants_total`, `sandbox_deferrals_total{reason}`,
  `sandbox_deferral_exhausted_total`, `sandbox_lease_expired_total` (leak detector).
- Logs keyed by `rootSessionId`, mirroring `[run-recovery] lock contention deferred …`.
- Alert on `sandbox_lease_expired_total` > 0 sustained (VMs dying without clean release) and on
  `sandbox_queue_depth` staying high (real capacity shortfall → bump `--max-nodes`).

## 9. Tests

- **Lua unit:** acquire respects cap; concurrent acquires across "replicas" never exceed cap;
  expired-lease purge frees a slot; queued root lands on `waitq` in order.
- **Classifier unit:** `isSandboxUnavailableFailure` fires on provisioning timeout only — NOT on
  bad-branch / repo-not-found / missing-conversationId (must pass through unchanged).
- **Worker unit:** `deferSandboxRetry` caps at `MAX_SANDBOX_DEFERRALS`, consumes no retry, honors
  `runAlreadyCompleted` early-exit, re-parks at FIFO **head**.
- **Integration:** cap=1 → run A holds slot, run B parks → destroy A → release signal wakes B →
  B resumes, exactly one user turn persisted, no duplicate side effects.
- **Leak:** kill A's replica without `evictSession` → lease TTL expires → next acquire/sweep frees
  the slot; `sandbox_lease_expired_total` increments.
- **Backstop:** grant slot but force `createSession` timeout → slot released, run re-parked at head,
  deferral counter increments, exhaust message after cap.

## 10. Rollout

1. Land Redis admission module (runtime, scoped like `handoff-redis.ts`) + Lua scripts. Behind
   `SANDBOX_ADMISSION_ENABLED` (default off) → **fail-open** to today's behavior.
2. Land worker `deferSandboxRetry` + `startSandboxReleaseConsumer` (boot from
   `initRunRecoveryWorker`). No-op while the flag is off.
3. Wire acquire/release hooks in `tools.ts` (gated by the flag).
4. Enable on **one** template first (the doctor repo hitting this) with a conservative
   `SANDBOX_MAX_CONCURRENT_*`; watch `sandbox_queue_depth` / `sandbox_wait_ms` / lease-expiry.
5. Tune cap ± `--max-nodes` together; then enable other templates.

## 11. Files to change

- `apps/xyne-claw/src/sandbox-admission.ts` **(new)** — scoped Redis client + Lua acquire/release/renew.
- `packages/xyne-claw-shared/src/tools/sandbox/tools.ts` — acquire before `createSession`; release
  in `sandbox-destroy` + `evictSession`; emit `sandbox_unavailable` on write-path miss/timeout.
- `apps/xyne-claw-auth/backend/src/queue/run-recovery-worker.ts` — `isSandboxUnavailableFailure`,
  `deferSandboxRetry`, `startSandboxReleaseConsumer`; wire into `handleRunCompletion` / `dispatchRetry`.
- `apps/xyne-claw/src/routes/run.ts` — propagate terminal `sandbox_unavailable` to the completion callback (mirror `session_locked`).
- config/env plumbing for `SANDBOX_ADMISSION_ENABLED`, `SANDBOX_MAX_CONCURRENT_*`,
  `SANDBOX_LEASE_TTL_MS`, `SANDBOX_RETRY_DELAY_MS`, `MAX_SANDBOX_DEFERRALS`.

## 12. Open decisions for the owner

1. **Semaphore sizing:** confirm a starting `SANDBOX_MAX_CONCURRENT_gvisor` (and per doctor
   template). I recommend starting at whatever ~2 warm nodes safely hold, since node #3 is slow to
   arrive — better to queue than to hand out slots that then time out.
2. **Runtime Redis boundary:** OK to add a *second* scoped Redis client in the runtime
   (`sandbox-admission.ts`, modeled on `handoff-redis.ts`)? The alternative — an S2S admission HTTP
   endpoint in claw-auth — reintroduces the hot-path HTTP hop that `handoff-redis.ts` deliberately
   moved off. Recommendation: scoped Redis client.
3. Whether to also bump the node pool `--max-nodes` (currently 3) as part of this — admission makes
   the shortage graceful, but if `sandbox_queue_depth` is chronically high the real fix is capacity.
