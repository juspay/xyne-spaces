/**
 * delegationBudget — per-agent, per-run delegation budget knob.
 *
 * The parent agent's config bag carries `maxDelegationsPerRun`. It bounds how
 * many child-agent delegations a single top-level run may make (each delegation
 * is a full nested agent run). The default applies when the agent has not set a
 * value; the upper bound is a cost / blast-radius guard.
 *
 * SINGLE SOURCE OF TRUTH for the CLIENT. Keep these values in sync with the
 * runtime authority in xyne-claw/src/agent-delegation.ts
 * (MAX_DELEGATIONS_PER_RUN_BOUNDS + clampMaxDelegationsPerRun). The runtime
 * re-clamps whatever we persist, so the UI can never widen the real bound —
 * these constants only shape what the editor offers and shows.
 */

export const MAX_DELEGATIONS_PER_RUN_BOUNDS = {
  MIN: 1,
  MAX: 25,
  DEFAULT: 3,
} as const;

/**
 * Discrete choices surfaced in the editor. Always includes the default (3) so a
 * viewer sees the effective value, and a spread up to MAX for orchestrators that
 * fan out (e.g. analyzer → N generators → code-writer).
 */
export const MAX_DELEGATIONS_PER_RUN_OPTIONS: readonly number[] = [
  3, 5, 6, 8, 10, 15, 20, 25,
];

/**
 * Coerce an untrusted config value into a valid budget. Non-integers,
 * out-of-range, and missing values fall back to the default; in-range values are
 * clamped to [MIN, MAX]. Mirrors clampMaxDelegationsPerRun in the runtime.
 */
export function clampMaxDelegationsPerRun(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return MAX_DELEGATIONS_PER_RUN_BOUNDS.DEFAULT;
  }
  return Math.min(
    MAX_DELEGATIONS_PER_RUN_BOUNDS.MAX,
    Math.max(MAX_DELEGATIONS_PER_RUN_BOUNDS.MIN, n),
  );
}
