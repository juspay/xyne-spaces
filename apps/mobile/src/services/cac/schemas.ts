import { z } from 'zod';
import { BETA_FLAGS_STALE_TIME_MS, CAC_KEYS, DEFAULT_STALE_TIME_MS } from './constants';

export const PlatformUpdateConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['optional', 'force']).default('optional'),
    minSupportedVersion: z.string().default('0.0.0'),
    latestVersion: z.string().default('0.0.0'),
    latestBuildNumber: z.number().default(0),
    title: z.string().default(''),
    message: z.string().default(''),
    storeUrl: z.string().default(''),
  })
  .prefault({});

export const LotusUpdateConfigSchema = z
  .object({
    android: PlatformUpdateConfigSchema.optional(),
    ios: PlatformUpdateConfigSchema.optional(),
  })
  .prefault({});

/**
 * No `.catch`, on purpose.
 *
 * These two decide what a user is allowed to keep, so a malformed payload has
 * to fail loudly. Swallowing it into `[]` produces a value indistinguishable
 * from "this user was granted nothing", which the revocation gate acts on by
 * taking features away.
 */
export const BetaFlagCatalogSchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    description: z.string(),
  }),
);

export const BetaFlagsEnabledSchema = z.array(z.string());

/**
 * The global switches. `force` is unioned with a user's grants, so it reaches
 * people whose override says otherwise — including one set to `[]`, which is
 * the point of it. `disabled` short-circuits everything.
 *
 * Keeps its `.catch`, unlike the two above. Its neutral value can only add
 * (`force` unions nothing) or decline to kill (`disabled: false`), so falling
 * back to it is provably unable to take a feature away. That is the line: a
 * key whose absence could subtract must resolve; one whose absence is neutral
 * may fall back.
 */
export const BetaAccessSchema = z
  .object({
    force: z.array(z.string()).default([]),
    disabled: z.boolean().default(false),
  })
  .catch({ force: [], disabled: false });

/**
 * Registry of known CAC keys → Zod schema + cache policy.
 * Add a new Superposition key here; CacService picks it up with full type inference.
 *
 * `fallback` is stated rather than derived by parsing `{}`, which only ever
 * worked for object schemas. `requireValue` says a missing or malformed
 * payload is a misconfiguration to surface, not a reason to use it.
 */
export const CAC_REGISTRY = {
  [CAC_KEYS.lotusUpdateConfig]: {
    schema: LotusUpdateConfigSchema,
    staleTimeMs: DEFAULT_STALE_TIME_MS,
    fallback: LotusUpdateConfigSchema.parse({}),
    // An absent update config means "no prompt", which is the resting state.
    requireValue: false,
  },
  [CAC_KEYS.betaFlagCatalog]: {
    schema: BetaFlagCatalogSchema,
    staleTimeMs: BETA_FLAGS_STALE_TIME_MS,
    fallback: [],
    requireValue: true,
  },
  [CAC_KEYS.betaFlagsEnabled]: {
    schema: BetaFlagsEnabledSchema,
    staleTimeMs: BETA_FLAGS_STALE_TIME_MS,
    fallback: [],
    requireValue: true,
  },
  [CAC_KEYS.betaAccess]: {
    schema: BetaAccessSchema,
    staleTimeMs: BETA_FLAGS_STALE_TIME_MS,
    fallback: { force: [], disabled: false },
    requireValue: false,
  },
} as const;
