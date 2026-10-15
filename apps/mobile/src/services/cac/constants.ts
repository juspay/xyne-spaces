/** Superposition CAC keys used by Lotus. Must match keys defined in Superposition. */
export const CAC_KEYS = {
  lotusUpdateConfig: 'lotus_update_config',
  /** Every beta flag that exists, with its copy. Same for everyone. */
  betaFlagCatalog: 'lotus_beta_flag_catalog',
  /** The keys *this* user may see. Resolved from an `email` override. */
  betaFlagsEnabled: 'lotus_beta_flags_enabled',
  /** Global switches applied on top of the per-user grants. No overrides. */
  betaAccess: 'lotus_beta_access',
} as const;

export const CAC_QUERY_KEY = 'cac-config';

export const DEFAULT_STALE_TIME_MS = 60_000;

/**
 * Eligibility changes by hand in Superposition, not by the minute, and a
 * refetch mid-session cannot change the running UI anyway — the flag snapshot
 * is pinned at launch. Long enough to mean one fetch per app open.
 */
export const BETA_FLAGS_STALE_TIME_MS = 60_000;

export const UPDATE_PROMPT_DISMISS_KEY = 'lotus.appUpdate.dismissRecord';

/** How long an optional update prompt stays dismissed for the same target version. */
export const UPDATE_PROMPT_SNOOZE_MS = 10_000;
