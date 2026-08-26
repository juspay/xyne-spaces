import { useOptionalCacConfig } from '@xyne/shared/hooks';
import {
  TELEPRESENCE_CAC_KEY,
  DEFAULT_TELEPRESENCE_CAC_CONFIG,
  type TelepresenceCacConfig,
} from './telepresenceCacConfig';

/**
 * Returns whether the telepresence/presentation mode feature is enabled
 * for the current user via CAC.
 *
 * Both conditions must be true:
 *   1. config.enabled is true (master kill-switch)
 *   2. the user's email is in config.allowedEmails
 */
export function useTelepresenceEnabled(userEmail: string | null | undefined): boolean {
  // Optional variant: FullCallView is reused by dashboard-external, which mounts
  // no HttpClientProvider, and the throwing `useCacConfig` crashed that render.
  const { config } = useOptionalCacConfig<TelepresenceCacConfig>({
    key: TELEPRESENCE_CAC_KEY,
    fallbackConfig: DEFAULT_TELEPRESENCE_CAC_CONFIG,
  });

  const normalizedEmail = userEmail?.toLowerCase();
  return (
    config.enabled &&
    !!normalizedEmail &&
    config.allowedEmails.some(e => e.toLowerCase() === normalizedEmail)
  );
}
