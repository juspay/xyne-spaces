import { useMemo } from 'react';

import { enabledFlagKeys, type FlagKey } from '@/src/flags';
import { CAC_KEYS, useCacConfig } from '@/src/services/cac';

import { effectiveGrants, revokedFlagKeys, visibleBetaFlags, type BetaFlag } from './resolve';

export type BetaFlagsResult = {
  /** Flags to render on the Beta screen. Empty until CAC answers. */
  flags: BetaFlag[];
  /** Flags the user has on but is no longer allowed to have. */
  revoked: FlagKey[];
  /** Every key resolved successfully. */
  isResolved: boolean;
  /** A key failed to resolve — unreachable, missing, or malformed. */
  hasError: boolean;
};

/**
 * Beta eligibility, from the three CAC keys that decide it.
 *
 * Three queries rather than one because the backend route resolves a single key
 * per call. They share a cache, so the Beta screen and the revocation gate both
 * read this without refetching.
 */
export function useBetaFlags(enabled = true): BetaFlagsResult {
  const catalog = useCacConfig(CAC_KEYS.betaFlagCatalog, { enabled });
  const granted = useCacConfig(CAC_KEYS.betaFlagsEnabled, { enabled });
  const access = useCacConfig(CAC_KEYS.betaAccess, { enabled });

  console.log('Flags Catalog', JSON.stringify(catalog.data, null, 2));
  console.log('Granted Catalog', JSON.stringify(granted.data, null, 2));

  /**
   * `isSuccess`, not `isFetched`.
   *
   * This guard only covers a query that *failed*. It is not enough on its own:
   * a key that is missing or malformed used to resolve to `[]` and count as a
   * success, which reads exactly like "this user was granted nothing" and had
   * the gate take their features away. `CacService` now throws for those two
   * keys instead, so that case lands here as an error rather than as an empty
   * list — see `requireValue` in the registry.
   */
  const isResolved = catalog.isSuccess && granted.isSuccess && access.isSuccess;

  const allowed = useMemo(
    () => effectiveGrants(granted.config, access.config),
    [access.config, granted.config],
  );

  const flags = useMemo(
    () => (isResolved ? visibleBetaFlags(catalog.config, allowed) : []),
    [allowed, catalog.config, isResolved],
  );

  const revoked = useMemo(
    () => (isResolved ? revokedFlagKeys(allowed, enabledFlagKeys()) : []),
    [allowed, isResolved],
  );

  return {
    flags,
    revoked,
    isResolved,
    hasError: catalog.isError || granted.isError || access.isError,
  };
}
