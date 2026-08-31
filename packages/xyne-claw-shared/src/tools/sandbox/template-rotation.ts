/**
 * Golden-snapshot clone-rate spreading via template rotation.
 *
 * GCP rate-limits CreateVolume (PVC-from-snapshot restore) operations
 * PER SOURCE SNAPSHOT (`RESOURCE_OPERATION_RATE_EXCEEDED: Too frequent
 * operations from the source resource`). xyne-spaces is the highest-load
 * pool, so its many concurrent claims/warm-pool refills clone one snapshot
 * past that per-snapshot ceiling and storm.
 *
 * Fix: run N identical goldens (same content, N independent GCP snapshots),
 * each behind its own SandboxTemplate + SandboxWarmPool, and round-robin
 * claims across them. The per-snapshot op-rate then divides by N → N× the
 * effective clone ceiling. This does NOT change sandbox content — every
 * variant is baked from the same source, so which one a claim lands on is
 * irrelevant to the agent.
 *
 * Infra side (claw-deployments/kata-infra/xyne-spaces/): N templates named
 * `<base>-a|-b|-c|-d`, each with dataSource → its own snapshot, each with a
 * warmpool. Keep this list in sync with the deployed template names.
 */

/** base template name → its rotation variants (identical goldens, N snapshots). */
const ROTATION_SETS: Record<string, readonly string[]> = {
  "agent-workspace-gvisor-template": [
    "agent-workspace-gvisor-template-a",
    "agent-workspace-gvisor-template-b",
    "agent-workspace-gvisor-template-c",
    "agent-workspace-gvisor-template-d",
    // e/f added 2026-08-30: 4-way was no longer enough. Measured 32 claims in
    // one hour (18 of them agent-workspace, spread 5/5/4/4 across a-d), and
    // EVERY variant throttled simultaneously — so the rotation was working and
    // simply out of headroom, unlike the earlier storms which were config
    // faults (one snapshot, or a rotation nothing routed to).
    //
    // NOTE this is headroom, not a fix. The thing that turns a brief throttle
    // into a sustained one is that a failed clone retries every 12-30s with no
    // backoff: 15 stuck claims generated more clone attempts than the live
    // traffic did. Adding variants divides the per-snapshot rate; it does not
    // stop a retry loop from re-saturating whatever it is given.
    "agent-workspace-gvisor-template-e",
    "agent-workspace-gvisor-template-f",
  ],
  // euler: 2-way (not 4). It storms the most of any pool — 5 times between
  // 2026-08-11 and 2026-08-18, every one a RESOURCE_OPERATION_RATE_EXCEEDED on
  // whatever single snapshot it was pointed at (v8 -> v12). It also has the
  // LARGEST clones in the cluster (200Gi vs xyne-spaces' 100Gi), so each extra
  // variant costs real snapshot storage; a/b halves the per-snapshot restore
  // rate, which is the cheapest thing that actually breaks the cycle. Add c/d
  // if it still throttles.
  //
  // Infra side is created by:
  //   BASE_TEMPLATE=euler-workspace-template BASE_WARMPOOL=euler-warmpool \
  //   GOLDEN_PVC=euler-golden-pvc SNAP_PREFIX=euler-golden-snap-rot \
  //   VARIANTS="a b" bash claw-deployments/kata-infra/xyne-spaces/rotation-setup.sh
  "euler-workspace-template": [
    "euler-workspace-template-a",
    "euler-workspace-template-b",
  ],
  // upi: 4-way. Its load is BURSTY rather than steady — newton-doctor fans out
  // ~30 concurrent threads, and on 2026-08-11 that single burst stormed the one
  // snapshot. Clones are 100Gi (half euler's), so four variants cost ~$10/mo in
  // snapshot storage — cheap for 4x the clone ceiling against a fan-out that
  // arrives all at once and cannot be smoothed by a longer warm window.
  //
  // Infra side:
  //   BASE_TEMPLATE=upi-workspace-template BASE_WARMPOOL=upi-warmpool \
  //   GOLDEN_PVC=upi-golden-pvc SNAP_PREFIX=upi-golden-snap-rot \
  //   VARIANTS="a b c d" bash claw-deployments/kata-infra/xyne-spaces/rotation-setup.sh
  "upi-workspace-template": [
    "upi-workspace-template-a",
    "upi-workspace-template-b",
    "upi-workspace-template-c",
    "upi-workspace-template-d",
  ],
  // credit: 2-way. Stormed FOUR times on 2026-08-25 alone, every one a
  // RESOURCE_OPERATION_RATE_EXCEEDED on whichever single snapshot it pointed at
  // (v8 -> auto-20260825 -> auto-20260825b). Cutting a fresh snapshot bought
  // under an hour each time: the limit is per SOURCE snapshot, and a failed
  // clone retries every 12-30s, so once you cross the ceiling the retry traffic
  // alone holds you above it — measured 8 distinct PVCs still hammering one
  // snapshot with every credit pool already scaled to 0. Clones are 200Gi like
  // euler's, so start at a/b — the cheapest change that halves the per-snapshot
  // restore rate. Add c/d if it still throttles under Credit Doctor fan-out.
  //
  // Infra side is created by:
  //   BASE_TEMPLATE=credit-workspace-template BASE_WARMPOOL=credit-warmpool \
  //   GOLDEN_PVC=credit-golden-pvc SNAP_PREFIX=credit-golden-snap-rot \
  //   VARIANTS="a b" bash claw-deployments/kata-infra/xyne-spaces/rotation-setup.sh
  "credit-workspace-template": [
    "credit-workspace-template-a",
    "credit-workspace-template-b",
  ],
  // hyperswitch: 2-way. Stormed THREE times in 24h on 2026-08-26/27, each a
  // RESOURCE_OPERATION_RATE_EXCEEDED on whichever single snapshot it pointed at
  // (v6 -> v7 -> v8). Cutting a fresh snapshot bought roughly one working pod
  // each time before the new snapshot's budget went too — measured: v8 was 20
  // minutes old with three PVCs already throttled on it. Claim volume is LOW
  // (2 claims/hour), so this is not load: it is the retry loop. A failed clone
  // retries every 12-30s, and the unlettered pool kept spawning replacements
  // that could not bind, so retry traffic alone held the source above its
  // ceiling. Rotation breaks that by giving retries a different snapshot.
  //
  // Clones are 80Gi (vs euler/credit at 200Gi), so a/b is cheap; add c/d if
  // Doc Agent fan-out starts arriving concurrently.
  //
  // Infra side is created by:
  //   BASE_TEMPLATE=hyperswitch-workspace-template BASE_WARMPOOL=hyperswitch-warmpool \
  //   GOLDEN_PVC=hyperswitch-golden-pvc SNAP_PREFIX=hyperswitch-golden-snap-rot \
  //   VARIANTS="a b" bash claw-deployments/kata-infra/xyne-spaces/rotation-setup.sh
  // xyne-cli: 2-way. NOT over-provisioning -- the warmpool is replicas:1. On
  // 2026-08-31 SEVEN concurrent LIVE sessions (pods carrying claim-uid) each
  // CoW-cloned the single xyne-cli-golden-snap-v7, blew the per-source ceiling
  // with RESOURCE_OPERATION_RATE_EXCEEDED, and the 12-30s clone retries then
  // held it there: 6 of 8 pods stuck Pending with unbound PVCs, which reads as
  // "no node capacity" but is purely the snapshot op-rate.
  //
  // Clones are 20Gi -- the SMALLEST golden in the cluster -- so a/b is the
  // cheapest rotation set we run. Add c/d if concurrent CLI usage keeps growing.
  //
  // Infra side is created by:
  //   BASE_TEMPLATE=xyne-cli-workspace-template BASE_WARMPOOL=xyne-cli-warmpool \
  //   GOLDEN_PVC=xyne-cli-golden-pvc SNAP_PREFIX=xyne-cli-golden-snap-rot \
  //   VARIANTS="a b" bash claw-deployments/kata-infra/xyne-spaces/rotation-setup.sh
  "xyne-cli-workspace-template": [
    "xyne-cli-workspace-template-a",
    "xyne-cli-workspace-template-b",
  ],
  "hyperswitch-workspace-template": [
    "hyperswitch-workspace-template-a",
    "hyperswitch-workspace-template-b",
  ],
};

// Per-base round-robin cursor. Process-local (each claw pod has its own), which
// is fine — independent cursors across pods still spread clones across the N
// snapshots. Not persisted; a restart just resumes from 0.
const cursors: Record<string, number> = {};

/**
 * Round-robin the next rotation variant for `base`. If `base` has no rotation
 * set configured, returns it unchanged (non-rotated templates are untouched).
 */
export function rotateTemplate(base: string): string {
  const variants = ROTATION_SETS[base];
  if (!variants || variants.length === 0) return base;
  const n = cursors[base] ?? 0;
  cursors[base] = n + 1;
  return variants[n % variants.length]!;
}

/**
 * True when `candidate` is `base` itself OR any rotation variant of `base`.
 * Session reuse compares the cached session's template against the config's
 * base template; because a live session was created on a ROTATED variant
 * (e.g. `<base>-c`), a plain `===` would never match and would force a
 * needless recreate every turn. This treats the whole family as equivalent.
 */
export function isSameTemplateFamily(candidate: string | undefined, base: string): boolean {
  if (!candidate) return false;
  if (candidate === base) return true;
  const variants = ROTATION_SETS[base];
  return !!variants && variants.includes(candidate);
}
