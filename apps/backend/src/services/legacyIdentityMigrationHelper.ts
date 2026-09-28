import { AuthProvider } from '@xyne/shared';
import { migrateLegacyIdentityTx } from '@/bypassAcl/transactions/legacyIdentityMigration';

export interface LegacyIdentityMigrationInput {
  email: string;
  authProvider: AuthProvider;
  providerUserId: string;
}

/**
 * Lazily repairs all workspace-scoped user rows for an email after the current login provider
 * has verified the identity. See migrateLegacyIdentityTx (bypassAcl/transactions) for the
 * matching rules and the transaction this runs inside.
 */
export async function migrateLegacyIdentity(
  input: LegacyIdentityMigrationInput,
): Promise<void> {
  const { email, authProvider, providerUserId } = input;
  if (!email || !providerUserId) {
    return;
  }

  await migrateLegacyIdentityTx(email, authProvider, providerUserId);
}
