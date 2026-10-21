import type { AuthProvider } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { transaction } from '../base';

const LEGACY_PROVIDER_USER_ID_PREFIXES = [
  'slack-migrated-',
  'bot_',
  'xyne-app-',
  'manual-',
  'healthcheck-',
  'added-',
  'imp-',
  'env_api_',
] as const;

const LEGACY_PROVIDER_USER_IDS = new Set([
  'ticket-bot',
  'xyne-bot-internal',
]);

const LEGACY_CUID_PROVIDER_USER_ID_PATTERN = /^c[a-z0-9]{24}$/;

function isLegacyProviderUserId(providerUserId: string): boolean {
  return (
    LEGACY_PROVIDER_USER_IDS.has(providerUserId) ||
    LEGACY_CUID_PROVIDER_USER_ID_PATTERN.test(providerUserId) ||
    LEGACY_PROVIDER_USER_ID_PREFIXES.some((prefix) =>
      providerUserId.startsWith(prefix),
    )
  );
}

/**
 * Relocated from services/legacyIdentityMigrationHelper.ts's migrateLegacyIdentity. Lazily
 * repairs all workspace-scoped user rows for an email after the current login provider has
 * verified the identity.
 *
 * Migration is allowed only when:
 * - at least one row already has the verified providerUserId, proving that the identity was
 *   previously associated with the email; or
 * - every row is a known legacy placeholder, which never represented a real login identity.
 *
 * A mixed set containing an unmatched real provider identity is deliberately left untouched so
 * the caller's provider-mismatch check still rejects the login instead of linking two accounts.
 * Read and write must commit atomically: a concurrent login racing the same repair must not see
 * a half-migrated set of rows; tx is not ACL-wrapped.
 */
export async function migrateLegacyIdentityTx(
  email: string,
  authProvider: AuthProvider,
  providerUserId: string,
): Promise<void> {
  await transaction(['User'], 'legacy identity migration: read of existing rows and the repair write must commit atomically so a concurrent login cannot race a half-migrated set', db, async (transactionClient) => {
    const existingRows = await transactionClient.user.findMany({
      where: { email },
      select: { providerUserId: true },
    });

    if (existingRows.length === 0) {
      return;
    }

    const hasMatchingIdentity = existingRows.some(
      (row) => row.providerUserId === providerUserId,
    );
    const hasOnlyLegacyPlaceholders = existingRows.every((row) =>
      isLegacyProviderUserId(row.providerUserId),
    );

    if (!hasMatchingIdentity && !hasOnlyLegacyPlaceholders) {
      return;
    }

    const result = await transactionClient.user.updateMany({
      where: {
        email,
        OR: [
          { providerUserId: { not: providerUserId } },
          { authProvider: { not: authProvider } },
        ],
      },
      data: {
        providerUserId,
        authProvider,
      },
    });

    if (result.count > 0) {
      logger.info(
        `[migrateLegacyIdentity] Migrated ${result.count} row(s) for ${email} to ${authProvider}`,
      );
    }
  });
}
