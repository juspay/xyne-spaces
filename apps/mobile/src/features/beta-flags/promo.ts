/**
 * Whether to offer the "Beta features available" sheet on this launch.
 *
 * Pure, like `resolve.ts`, so every branch can be tested without a device.
 * The gate gathers the inputs; this only decides.
 */
import type { FlagKey } from '@/src/flags/registry';
import { isOnTabShell } from '@/src/navigation/routes';

import type { BetaFlag } from './resolve';

export type BetaPromoSkipReason =
  /** `lotus_beta_prompt.enabled` is off, missing or malformed. */
  | 'prompt_disabled'
  /** A beta CAC key failed. Never guess eligibility from a failed check. */
  | 'cac_error'
  /** The "Beta access updated" sheet owns this launch. */
  | 'revoked_pending'
  /** The update prompt owns this launch. */
  | 'update_prompt_pending'
  /** Nothing granted to this user that this build can render. */
  | 'no_visible_flags'
  /** Every visible flag is already switched on. */
  | 'all_enabled'
  /** Cold start landed somewhere other than a home tab: deep link, call, share. */
  | 'not_on_home_tab';

export type BetaPromoInput = {
  promptEnabled: boolean;
  hasError: boolean;
  /** `useBetaFlags().flags`: catalog ∩ grants ∩ this build. */
  visible: readonly BetaFlag[];
  /**
   * The switch position on the Beta screen (`storedFlag`), not the pinned
   * snapshot. The snapshot forces a child off while its parent is off, which
   * would count a flag the user did turn on as pending.
   */
  isStoredOn: (key: FlagKey) => boolean;
  revokedCount: number;
  updatePromptDue: boolean;
  isOnHomeTab: boolean;
};

export type BetaPromoDecision =
  { show: true; pending: BetaFlag[] } | { show: false; reason: BetaPromoSkipReason };

/** Visible flags the user has not switched on, in catalog order. */
export function pendingBetaFlags(
  visible: readonly BetaFlag[],
  isStoredOn: (key: FlagKey) => boolean,
): BetaFlag[] {
  return visible.filter(flag => !isStoredOn(flag.key));
}

/**
 * Ordered so the cheapest, most global reasons win: the kill switch first,
 * then anything that means another sheet owns the launch, then eligibility.
 */
export function decideBetaPromo(input: BetaPromoInput): BetaPromoDecision {
  if (!input.promptEnabled) return { show: false, reason: 'prompt_disabled' };
  if (input.hasError) return { show: false, reason: 'cac_error' };
  if (input.revokedCount > 0) return { show: false, reason: 'revoked_pending' };
  if (input.updatePromptDue) return { show: false, reason: 'update_prompt_pending' };
  if (input.visible.length === 0) return { show: false, reason: 'no_visible_flags' };

  const pending = pendingBetaFlags(input.visible, input.isStoredOn);
  if (pending.length === 0) return { show: false, reason: 'all_enabled' };

  if (!input.isOnHomeTab) return { show: false, reason: 'not_on_home_tab' };

  return { show: true, pending };
}

/** "A", "A and B", "A, B and C", "A, B and 2 more". */
export function summarizePendingLabels(pending: readonly BetaFlag[], maxNamed = 2): string {
  const labels = pending.map(flag => flag.label);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0] ?? '';

  if (labels.length <= maxNamed + 1) {
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }

  return `${labels.slice(0, maxNamed).join(', ')} and ${labels.length - maxNamed} more`;
}

/**
 * True when the route is a tab screen of either shell. Anything stacked on top
 * (chat, call, settings, share target) sits outside those groups.
 */
export function isHomeTabRoute(segments: readonly string[]): boolean {
  return isOnTabShell(segments);
}
