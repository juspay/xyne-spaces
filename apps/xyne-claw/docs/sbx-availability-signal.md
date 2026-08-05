# "We won't know when a sandbox is available" — the correction

**Branch:** `feature/sbx-resource-queue` · supersedes the *capacity-guessing* core of
`sbx-resource-queue-phase2.md`. TL;DR: **we already know.** The availability signal exists in the
operator; today we throw it away after 10 minutes. Don't build a Redis semaphore that guesses
capacity — lean on the signal that's already there and fix the two real root causes.

---

## The objection, and why it's right about the wrong design

The Phase-2 sketch proposed an app-level Redis semaphore that releases a slot on
`sandbox-destroy`/`evictSession` and wakes the next waiter. Valid objection: a slot we release in
*our* accounting is not the same as a *real* microVM being schedulable. Capacity here is also
produced by GKE node autoscaling and by a warm-pool controller — neither of which fires an app-level
"release." So a semaphore that only reacts to our own releases **would be blind** to most of the
capacity that actually appears. The objection kills the guess-a-number semaphore.

## What actually exists (verified against the live cluster)

The sandbox layer is the **`sigs.k8s.io/agent-sandbox`** operator (`agent-sandbox-controller v0.4.5`,
ns `agent-sandbox-system`) with **three** CRDs, and it already *is* the queue:

| CRD | Group | Role |
|---|---|---|
| `Sandbox` | `agents.x-k8s.io` | the Firecracker/Kata microVM (Pod + PVC + headless Service) |
| `SandboxClaim` | `extensions.agents.x-k8s.io/v1alpha1` | a request; operator binds it → `status.sandbox.name` |
| `SandboxWarmPool` | `extensions.agents.x-k8s.io` | keeps `desired` warm Sandboxes ready per flavor |

Provisioning is a **two-stage fallback the operator runs for us**:
1. **Adopt** a warm-pool Sandbox → `SandboxAdopted` → claim bound in ~sub-second.
2. Pool empty → **on-demand** create from template (`Created sandbox from template`) → Pod scheduled;
   if the node pool is full the Pod is `Pending/Unschedulable` (`FailedScheduling: Insufficient
   cpu/memory`, `3 max node group size reached`) and the operator **keeps reconciling until it fits**.

There is an **`euler-warmpool`** flavor. Right now every pool is sized **`desired:1, current:1`**, and
`kata-sandbox-ng` is **at its cap of 3/3 nodes**. That is the whole bug: only **one** warm euler
sandbox is kept ready, and when it's taken the next dev must wait for replenishment onto a node pool
that's already maxed → `sbx not available`.

## So: how do we know when a sandbox is available? Three real signals, already emitted

- **The claim binding** — `SandboxClaim.status.sandbox.name` goes from empty → a name the moment the
  operator adopts or provisions. This is the authoritative, per-request "your sandbox is ready."
  **The kata SDK already polls exactly this** (`packages/kata-sdk/src/client.ts` ·
  `waitForSandboxAssignment`, 1 s poll) — it just **gives up after `readyTimeoutMs` (10 min)** and
  throws, and then `tools.ts` substitutes a read-only session and the run ends. We are discarding a
  signal we already receive.
- **A k8s watch** on the claim → a *push* event on bind (no polling at all).
- **`SandboxWarmPool.status`** (`desired` vs `current`) — observable pool headroom for metrics/alerts.

None of these needs an app-side capacity estimate. The operator already accounts for warm pool +
on-demand + node autoscaling; a Redis semaphore would duplicate that, badly, and (the objection)
still couldn't see autoscaling capacity.

## Corrected design

**Root-cause fix (config, no code) — do this first, it's most of the win:**
- Raise `SandboxWarmPool` `desired` for the doctor flavors (`euler-warmpool`, lotus, lamf) from 1 to
  the real peak concurrency (e.g. 3–4).
- Raise `kata-sandbox-ng --max-nodes` (currently 3) so replenishment has somewhere to land.
  Warm-pool `desired` is only honorable if nodes exist to hold them.
- This alone removes most `sbx not available` events. **Confirm target numbers with infra.**

**Code fix — turn the 10-min give-up into suspend-resume driven by the binding signal:**
1. On the write path, keep the short in-process wait but **cut it to ~30–60 s** (don't block a pod
   or the LLM loop for 10 min).
2. If unbound by then, **do not** fall back to read-only and **do not** end the run. Instead **keep
   the SandboxClaim alive** (it already lives for hours via `lifecycle.shutdownTime`) and **suspend
   the run** using the existing run-recovery defer (ends the turn cleanly: *"queued — I'll resume
   automatically, no need to re-tag"*). Persist `claimName → rootSessionId`.
3. A lightweight **watcher in claw-auth** (k8s watch on the claim, or a cheap 1 Hz poll of
   `status.sandbox.name` — no LLM, no VM) resumes the run via `scheduleDispatch` the instant the
   claim binds. That binding *is* the "available now" event — covering warm-pool adoption, on-demand,
   AND autoscaling capacity, because all three end in a bind.
4. The resumed run must **reuse the now-bound sandbox** (thread `claimName`/`sandboxId` through the
   recovery payload) so it doesn't open a second claim.
5. Cap total wait; on give-up **delete the claim** (avoid leaking a claim that binds later and idles)
   and exhaust with a clear message.

**What survives from the Phase-2 doc:** the run-recovery integration (defer without consuming a
retry, GCS-marker idempotency, `deferSandboxRetry`/classifier, exhaust cap) is still exactly the
resume machinery — see `sbx-resource-queue-phase2.md` §4/§7. **What is dropped:** the Redis
capacity semaphore and the `sandbox:cap/inuse/waitq` accounting — the operator already owns capacity;
we only need to *listen for the bind*, not re-account.

## Open items for the owner / infra

1. Target `desired` per doctor warm pool and new `--max-nodes` for `kata-sandbox-ng` (biggest lever).
2. Watch vs poll for the claim-bind watcher (watch = push, needs claw-auth k8s RBAC to `get/watch`
   SandboxClaims; poll = simpler, ~1 GET/s/claim). Recommendation: poll first, watch later.
3. **Fairness under contention (Inferred, not code-verified):** the operator most likely processes
   pending claims in controller-runtime work-queue (≈FIFO) order — there is no priority/creation-time
   ordering flag on it. If strict FIFO fairness across many waiting doctor runs matters, that is the
   *only* place a thin app-side ordering ticket (Redis LIST, ordering **only**, no capacity guessing)
   would add value — layer it on step 3's watcher, not before.
