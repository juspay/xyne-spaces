import { useCacConfig } from '@xyne/shared/hooks';

/**
 * Rollout switch for Radar. CAC rather than a VITE_ constant so enabling it
 * needs no dashboard rebuild, and so a staged rollout can name accounts.
 *
 *   key:   radar_config
 *   value: { "enabled": true, "allowedEmails": ["pilot@example.com"] }
 *
 * An empty allowedEmails means everyone. While off, the sidebar entry is
 * hidden and the route renders nothing.
 */

export const RADAR_CAC_KEY = 'radar_config';

export interface RadarCacConfig {
  enabled: boolean;
  allowedEmails: string[];
}

export const DEFAULT_RADAR_CAC_CONFIG: RadarCacConfig = {
  enabled: false,
  allowedEmails: [],
};

/** One rule, so the nav entry and the route guard cannot disagree. */
export function isRadarAllowed(
  config: RadarCacConfig,
  userEmail: string | null | undefined,
): boolean {
  if (!config.enabled) return false;
  const allowed = config.allowedEmails ?? [];
  if (allowed.length === 0) return true;

  const normalizedEmail = userEmail?.toLowerCase();
  return !!normalizedEmail && allowed.some(e => e.toLowerCase() === normalizedEmail);
}

/** Denies while CAC is loading or unreachable, so a failed fetch hides Radar. */
export function useRadarEnabled(userEmail: string | null | undefined): boolean {
  const { config } = useCacConfig<RadarCacConfig>({
    key: RADAR_CAC_KEY,
    fallbackConfig: DEFAULT_RADAR_CAC_CONFIG,
  });

  return isRadarAllowed(config, userEmail);
}
