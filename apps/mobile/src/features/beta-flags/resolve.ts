/**
 * From `flags/registry` rather than the `flags` barrel: the barrel re-exports
 * the runtime, which reaches MMKV and React Native. Everything here is pure,
 * and keeping it that way is what lets it be tested without a device.
 */
import { isFlagKey, type FlagKey } from '@/src/flags/registry';
import type { BetaAccess, BetaFlagCatalog, BetaFlagsEnabled } from '@/src/services/cac';

/** A flag this user may see, with the copy CAC supplied for it. */
export type BetaFlag = {
  key: FlagKey;
  label: string;
  description: string;
};

/**
 * What this user is allowed, once the global switches have had their say.
 *
 * `force` is unioned rather than merged in precedence order: a per-user
 * override cannot opt out of a flag that has been promoted to everyone, which
 * is the whole reason the switch exists. `disabled` wins over both, so an
 * incident cannot be half-resolved by a stale grant.
 */
export function effectiveGrants(granted: BetaFlagsEnabled, access: BetaAccess): string[] {
  if (access.disabled) return [];

  return Array.from(new Set([...granted, ...access.force]));
}

/**
 * The flags to show on the Beta screen.
 *
 * Three sources have to agree: CAC says what exists (`catalog`), CAC says who
 * may see it (`allowed`), and the binary says what it can actually do
 * (`isFlagKey`). A key only this build knows is not shown because nobody
 * granted it; a key only CAC knows is skipped because the switch would toggle
 * something this version cannot render — which is what lets a flag be added to
 * Superposition before the release that implements it, without breaking
 * installs that are already out.
 */
export function visibleBetaFlags(catalog: BetaFlagCatalog, allowed: BetaFlagsEnabled): BetaFlag[] {
  const grants = new Set(allowed);

  return catalog
    .filter(entry => grants.has(entry.key) && isFlagKey(entry.key))
    .map(entry => ({
      key: entry.key as FlagKey,
      label: entry.label,
      description: entry.description,
    }));
}

/**
 * Flags the user turned on and is no longer allowed to have.
 *
 * Compared against `allowed` rather than the catalog: a flag pulled from the
 * catalog entirely is revoked for everyone, and a flag the user simply lost
 * access to is revoked for them. Both land here, which is the point.
 */
export function revokedFlagKeys(allowed: BetaFlagsEnabled, enabled: readonly FlagKey[]): FlagKey[] {
  const grants = new Set(allowed);

  return enabled.filter(key => !grants.has(key));
}
