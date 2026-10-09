/** Fixed tuning for call AI runs on Claw (enabled by CALL_AI_USE_CLAW_AGENT). */
export const CLAW_CALL_AI_SETTINGS = {
  /** Claw agent that runs every call AI task; seeded in claw-auth. */
  agentSlug: 'call-intelligence',
  /** How long one run may take before it is cancelled and retried. */
  runTimeoutMs: 15 * 60_000,
  maxAttempts: 2,
  retryDelayMs: 30_000,
  /** How often the waiter checks Redis for the callback's result. */
  pollIntervalMs: 2_000,
  /** How often the waiter asks Claw for run status, in case the callback was lost. */
  statusPollIntervalMs: 15_000,
};
