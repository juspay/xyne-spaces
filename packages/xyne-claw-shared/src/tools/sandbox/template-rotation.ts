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
