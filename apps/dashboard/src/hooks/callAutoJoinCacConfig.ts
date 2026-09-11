import { useCacConfig } from '@xyne/shared/hooks';

/**
 * CAC key: "call_auto_join_config"
 *
 * Kill switch for the call URL API — the `?autoJoin=1` family of query params
 * read by useCallAutoJoin. While this is off, those params are inert and a
 * channel URL carrying them behaves exactly like one that doesn't.
 *
 * Toggle from Superposition CAC (snake_case key, matching the other CAC keys
 * such as xyne_telepresence_config / call_privacy_reminder_config):
 *   key:   call_auto_join_config
 *   value: { "enabled": true, "allowedEmails": ["station-1@example.com"] }
 *
 * allowedEmails narrows the rollout to specific accounts — intended for the
 * dedicated always-on room/station accounts this shipped for. An EMPTY list
 * means every user in the workspace, which is how the flag graduates to a
 * general feature without having to enumerate accounts.
 *
 * For local dev without Superposition, temporarily set enabled: true in
 * DEFAULT_CALL_AUTO_JOIN_CAC_CONFIG.
 */

export const CALL_AUTO_JOIN_CAC_KEY = 'call_auto_join_config';

export interface CallAutoJoinCacConfig {
  enabled: boolean;
  allowedEmails: string[];
}

export const DEFAULT_CALL_AUTO_JOIN_CAC_CONFIG: CallAutoJoinCacConfig = {
  enabled: false,
  allowedEmails: [],
};

/**
 * The gate itself, as a plain function of the config and the user.
 *
 * Split out from the hook so the same decision can be made away from React —
 * roomMachine re-checks it at the point it actually applies the override, rather
 * than trusting that whoever sent the event had checked (see
 * utils/callUrlOverrides). One rule, two call sites, no chance of them drifting.
 */
export function isCallAutoJoinAllowed(
  config: CallAutoJoinCacConfig,
  userEmail: string | null | undefined,
): boolean {
  if (!config.enabled) return false;
  const allowed = config.allowedEmails ?? [];
  if (allowed.length === 0) return true;

  const normalizedEmail = userEmail?.toLowerCase();
  return !!normalizedEmail && allowed.some(e => e.toLowerCase() === normalizedEmail);
}

/**
 * Whether the current user may drive calls via URL params.
 *
 * Note the fallback while CAC is loading or unreachable is `false` (deny), so a
 * station whose CAC fetch fails stays out of the call rather than joining
 * unflagged. useCacConfig caches for an hour and this hook re-renders when the
 * query resolves, so a slow CAC response delays auto-join rather than losing it.
 */
export function useCallAutoJoinEnabled(userEmail: string | null | undefined): boolean {
  const { config } = useCacConfig<CallAutoJoinCacConfig>({
    key: CALL_AUTO_JOIN_CAC_KEY,
    fallbackConfig: DEFAULT_CALL_AUTO_JOIN_CAC_CONFIG,
  });

  return isCallAutoJoinAllowed(config, userEmail);
}
