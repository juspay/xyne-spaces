import { useCacConfig } from '@xyne/shared/hooks';

/**
 * CAC key: "call_privacy_reminder_config"
 *
 * Timers for the in-call transcription/recording disclosure popup.
 *   intervalMs — recurring reminder cadence in ms. <= 0 disables the recurring
 *                reminder entirely (the once-per-call initial disclosure still
 *                shows on the first full-call view).
 *   visibleMs  — how long each popup stays on screen, in ms.
 *
 * Toggle from Superposition CAC (snake_case key, matching the other CAC keys
 * such as speaker_identification_config / xyne_telepresence_config):
 *   key:   call_privacy_reminder_config
 *   value: { "intervalMs": 7200000, "visibleMs": 6000 }
 *
 * When the key is absent (or CAC is unreachable, e.g. the public external-lobby
 * app), the DEFAULT below is used. It intentionally matches the previously
 * deployed VITE_CALL_PRIVACY_REMINDER_* values so removing those envs does not
 * change production behaviour.
 */

export const CALL_PRIVACY_REMINDER_CAC_KEY = 'call_privacy_reminder_config';

export interface CallPrivacyReminderCacConfig {
  intervalMs: number;
  visibleMs: number;
}

export const DEFAULT_CALL_PRIVACY_REMINDER_CAC_CONFIG: CallPrivacyReminderCacConfig = {
  intervalMs: 7_200_000, // 2h — recurring reminder effectively off by default
  visibleMs: 6_000, // 6s
};

const MIN_VISIBLE_MS = 1_000;

function normalizeCallPrivacyReminderConfig(
  config: Partial<CallPrivacyReminderCacConfig> | null | undefined,
): CallPrivacyReminderCacConfig {
  const intervalMs =
    typeof config?.intervalMs === 'number' && Number.isFinite(config.intervalMs)
      ? Math.max(0, config.intervalMs)
      : DEFAULT_CALL_PRIVACY_REMINDER_CAC_CONFIG.intervalMs;

  const visibleMs =
    typeof config?.visibleMs === 'number' && Number.isFinite(config.visibleMs)
      ? Math.max(MIN_VISIBLE_MS, config.visibleMs)
      : DEFAULT_CALL_PRIVACY_REMINDER_CAC_CONFIG.visibleMs;

  return { intervalMs, visibleMs };
}

/**
 * Returns the call transcription/recording disclosure timers from CAC.
 * Falls back to DEFAULT_CALL_PRIVACY_REMINDER_CAC_CONFIG while the config is
 * loading or when the CAC endpoint is unavailable (e.g. the unauthenticated
 * external lobby), so timers always resolve to sane values.
 */
export function useCallPrivacyReminderConfig(): CallPrivacyReminderCacConfig {
  const { config } = useCacConfig<CallPrivacyReminderCacConfig>({
    key: CALL_PRIVACY_REMINDER_CAC_KEY,
    fallbackConfig: DEFAULT_CALL_PRIVACY_REMINDER_CAC_CONFIG,
  });

  return normalizeCallPrivacyReminderConfig(config);
}
