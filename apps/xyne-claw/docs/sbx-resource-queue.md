# Sandbox Resource Queue — design plan

**Status:** proposal · **Branch:** `feature/sbx-resource-queue` (cut from `feature/deploy-xyneclaw`)
**Problem owner ask:** when the writable dev sandbox can't be provisioned (`sbx not available`),
queue the run and continue the agent flow automatically when capacity frees — so devs stop
re-tagging the doctor agent.

---

## 1. What actually happens today (verified)

Doctor-style agents (e.g. euler/LotusPay/LAMF doctor) are pinned to a repo via
`agent.config.sandboxRepo`. Those repo configs are **not `readFirst`**, so every run goes
straight to the *writable golden-clone* path in `sandbox-repo-setup`.

Provisioning chain:

- `sandboxRepoSetup.execute` → `makeRepoSetupTool(...).execute` → `KataClient.createSession()`
  (`packages/kata-sdk/src/client.ts`) creates a `SandboxClaim` CRD and waits for it to
  **bind to a Sandbox** and reach **Running**, bounded by `readyTimeoutMs` (10 min for these repos).
- If the cluster can't schedule a fresh microVM / GCP throttles the per-snapshot CoW clone,
  the claim never binds → `KataClient` throws *"Timed out waiting for SandboxClaim … to bind"*
  (or *"… to reach Running phase"*).

Failure handling (`packages/xyne-claw-shared/src/tools/sandbox/tools.ts`,
`sandboxRepoSetup.execute`, ~L2083):

```
if (isSandboxProvisioningFailure(result)) {
  const reason = `the writable dev sandbox could NOT be provisioned right now (${firstLine}) — likely no capacity for a fresh machine.`;
  const ro = await resolveSbxGit(repoName, context, reason);   // READ-ONLY fallback
  if (!ro.startsWith("Error")) return ro;
}
```

**The core defect:** for a write-needing agent the read-only fallback is useless — the agent
can't build/fix/commit. The tool call *succeeds* with a read-only session, the LLM continues,
concludes it can't do the work, and the **run completes normally**. No signal reaches any
retry/recovery layer, so the human re-tags the agent — and it recurs the moment load is high.

There is **no app-level admission control / concurrency cap / queue** for sandboxes today.
`KataClient` only self-throttles *claim creation spacing* (`DEFAULT_MIN_CREATE_SPACING_MS = 10s`,
in-memory, per client instance). Capacity is whatever the k8s node pool + warm pool can schedule.

## 2. The reusable primitive we already have

`apps/xyne-claw-auth/backend/src/queue/run-recovery-worker.ts` already does exactly the hard
part — **defer a whole run and re-dispatch it later, idempotently**:

- `registerRunRecovery(...)` persists the full dispatch payload + session context in Redis,
  keyed by `rootSessionId`.
- BullMQ queue `agent-run-recovery` with `scheduleDispatch(root, reason, delayMs)` →
  `dispatchRetry(...)` re-POSTs to `/claw/api/v1/internal/run`.
- **Idempotency:** `runAlreadyCompleted()` checks the GCS result marker
  (`claw-results/<idempotencyKey>.json`) so a finished run is never re-executed.
- `deferLockContentionRetry(state, delayMs)` is the precise analog we want: when a run hits
  `session_locked`, it re-schedules the dispatch after a delay **without consuming a retry**,
  capped by `MAX_LOCK_DEFERRALS = 10`. The user never re-tags.

The sandbox-capacity case is the same shape: a transient resource contention that should
**defer-and-resume**, not fail.

## 3. Recommendation

Reuse the run-recovery machinery. Introduce a `sandbox_unavailable` deferral that mirrors
`session_locked`, and **fail the run fast BEFORE the read-only fallback** when the agent
genuinely needs write. Because a doctor agent's first meaningful action is `sandbox-repo-setup`,
failing fast and re-dispatching the whole task loses ~no work.

Ship in two phases.

### Phase 1 — Defer-and-retry (kills the re-tag pain; small, boring, reuses everything)

1. **Runtime: emit a deferral signal instead of silently degrading.**
   In `sandboxRepoSetup.execute`, when `wantWrite === true` (or an agent that requires write —
   `forceWriteSandbox`/`allowWriteInReadOnlyJob` context) AND `isSandboxProvisioningFailure(result)`:
   - do **not** substitute the read-only session;
   - end the run with a terminal signal `sandbox_unavailable` (same channel the runtime uses to
     surface `session_locked` to `handleRunCompletion`), carrying the repo + reason.
   Keep the read-only fallback for read-oriented / non-write calls (unchanged).

2. **Recovery worker: add `isSandboxUnavailableFailure()` + `deferSandboxRetry()`** next to the
   lock-contention equivalents. Same defer-without-consuming-retry semantics, own tunables:
   - `SANDBOX_RETRY_DELAY_MS` (default ~60s),
   - `MAX_SANDBOX_DEFERRALS` (default ~15; ~15 min of waiting at 60s),
   - jittered backoff to avoid a thundering herd of simultaneous re-claims.
   Wire it into `dispatchRetry` / `handleRunCompletion` exactly where `session_locked` is handled.

3. **User-visible progress.** On first deferral, post one progress line to the thread:
   *"All dev sandboxes are busy — you're queued (position N). I'll continue automatically when one
   frees; no need to re-tag."* Update on resume / on exhaustion.

4. **Exhaustion path.** After `MAX_SANDBOX_DEFERRALS`, mark exhausted and post a clear message
   (optionally offer the read-only session as a downgrade). This is the only case that still
   needs human action.

This alone removes the re-tag loop. It is **poll-with-backoff** (retry until a claim succeeds),
so it does not need a real capacity counter.

### Phase 2 — Capacity-aware FIFO admission queue (fairness + no thundering herd)

Phase 1 retries blindly; under sustained load many deferred runs wake and race for the same slot.
Phase 2 adds real admission control:

- **Redis semaphore** `sandbox:capacity:<template>` sized to the warm-pool/node-pool budget per
  template (config-driven, e.g. `SANDBOX_MAX_CONCURRENT_<TEMPLATE>`). Acquire before
  `createSession`; release on `sandbox-destroy`, idle-eviction, and session death
  (`evictSession`). A TTL on each held slot prevents leaks when a pod dies without releasing.
- **FIFO wait list** `sandbox:waitq:<template>` (Redis list/ZSET). On provisioning contention the
  run parks here instead of blind-retrying; when a slot is released, pop the head and
  `scheduleDispatch(delay=0)` for that specific `rootSessionId`. Event-driven wakeup replaces
  polling → fair ordering, no herd.
- Emit metrics (see §5). Keep the Phase-1 backoff path as the fallback if the semaphore/queue is
  unavailable (fail-open).

## 4. Alternatives considered (and why weaker)

- **Block inside the tool** (poll for a free slot up to N min, keep the LLM loop parked): simplest
  to reason about, but it pins a claw pod + burns provider context/tokens for the whole wait and
  will breach the run/tool timeout under real contention. Rejected.
- **Grow the warm pool / raise concurrency only:** reduces frequency but doesn't bound it — the
  owner explicitly expects load to keep rising. Capacity tuning is complementary, not a fix.
- **Make doctor repos `readFirst`:** wrong for a *doctor* agent whose whole job is build/run/fix;
  read-only can't do the work.

## 5. Validation & observability

- **Metrics:** `sandbox_deferrals_total{template,reason}`, `sandbox_queue_depth{template}`,
  `sandbox_wait_ms` histogram, `sandbox_deferral_exhausted_total`, and (Phase 2)
  `sandbox_capacity_inuse{template}`.
- **Logs:** one line per defer/resume/exhaust keyed by `rootSessionId` (mirror the
  `[run-recovery] lock contention deferred …` format).
- **Tests:**
  - unit: `isSandboxUnavailableFailure` classification (provisioning timeout vs bad-branch vs
    repo-not-found — must NOT defer user-input errors);
  - unit: `deferSandboxRetry` caps at `MAX_SANDBOX_DEFERRALS`, doesn't consume retries, honors
    `runAlreadyCompleted` early-exit;
  - integration: forced provisioning failure → run deferred → capacity freed → same run resumes,
    exactly one user turn persisted, no duplicate side effects (GCS marker idempotency);
  - Phase 2: semaphore release wakes the FIFO head; slot never leaks on pod death (TTL).

## 6. Risks

- **Idempotency is load-bearing.** Re-dispatch must rely on the GCS result marker and
  `alreadyPersisted`/`__skipUserMessagePersist` so a resumed run never double-persists the user
  turn or repeats side effects. This is why we reuse run-recovery rather than roll a new dispatch.
- **Slot leaks (Phase 2):** a pod dying mid-hold must not permanently shrink capacity → TTL'd
  semaphore entries + reconcile on `evictSession`/session death.
- **Starvation:** blind Phase-1 backoff can starve some runs under heavy load → the Phase-2 FIFO
  fixes ordering; keep the deferral cap so nothing waits forever silently.
- **Scope of the deferral signal:** only genuine provisioning failures defer; bad-branch /
  repo-not-found / no-conversationId must pass through unchanged (already discriminated by
  `isSandboxProvisioningFailure`).

## 7. Files likely to change

- `packages/xyne-claw-shared/src/tools/sandbox/tools.ts` — emit `sandbox_unavailable` on
  write-path provisioning failure instead of the read-only substitution.
- `apps/xyne-claw-auth/backend/src/queue/run-recovery-worker.ts` — `isSandboxUnavailableFailure`,
  `deferSandboxRetry`, wiring in `dispatchRetry` / `handleRunCompletion`, tunables.
- Runtime run-completion path in `apps/xyne-claw/src/routes/run.ts` — propagate the terminal
  `sandbox_unavailable` status to the completion callback (mirror `session_locked`).
- Phase 2: new `sandbox-admission.ts` (Redis semaphore + FIFO) + acquire/release hooks around
  `createSession` / `evictSession` / `sandbox-destroy`.
