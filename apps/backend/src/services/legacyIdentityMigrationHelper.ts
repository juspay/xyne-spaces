import { AuthProvider } from '@xyne/shared';

export interface LegacyIdentityMigrationInput {
  email: string;
  authProvider: AuthProvider;
  providerUserId: string;
}

/**
 * Extension point for deployments that need to migrate legacy authentication
 * identities before the provider-mismatch check.
 */
export async function migrateLegacyIdentity(
  _input: LegacyIdentityMigrationInput,
): Promise<void> {
  return;
}
