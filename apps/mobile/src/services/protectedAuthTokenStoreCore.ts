/**
 * Storage policy for the reusable application bearer token.
 *
 * This module deliberately has no React Native or platform imports. Keeping the
 * migration state machine injectable makes its fail-closed behaviour testable
 * without pretending that a Node test is proof of Keychain/Keystore behaviour.
 */

export const AUTH_TOKEN_MIGRATION_VERSION = 'v1';
export const AUTH_TOKEN_SIGNED_OUT_STATE = 'signed_out';

export type ProtectedTokenStore = {
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  delete: () => Promise<void>;
  /** Existing SecureStore item created before the versioned key was introduced. */
  readLegacy?: () => Promise<string | null>;
  deleteLegacy?: () => Promise<void>;
};

export type LegacyTokenStore = {
  read: () => string | null;
  remove: () => void;
  readMigrationVersion: () => string | null;
  writeMigrationVersion: (version: string) => void;
};

export type ProtectedAuthTokenStore = {
  read: (canCommit?: () => boolean) => Promise<string | null>;
  write: (
    token: string,
    options?: { allowSignedOutRecovery?: boolean; canCommit?: () => boolean },
  ) => Promise<boolean>;
  delete: () => Promise<void>;
  markSignedOut: () => void;
  isSignedOut: () => boolean;
};

function isUsableToken(token: string | null): token is string {
  return typeof token === 'string' && token.length > 0;
}

/**
 * Creates the protected-token state machine.
 *
 * A protected value is always preferred. A legacy value is accepted only when
 * the protected write and read-back both succeed; otherwise the caller gets no
 * credential and the plaintext value remains available for a later retry.
 */
export function createProtectedAuthTokenStore(
  protectedStore: ProtectedTokenStore,
  legacyStore: LegacyTokenStore,
): ProtectedAuthTokenStore {
  const markMigrationComplete = (): void => {
    legacyStore.writeMigrationVersion(AUTH_TOKEN_MIGRATION_VERSION);
  };

  const removeLegacyToken = (): void => {
    legacyStore.remove();
    markMigrationComplete();
  };

  return {
    async read(canCommit = (): boolean => true): Promise<string | null> {
      // A protected-store error must never cause a plaintext fallback.
      const migrationState = legacyStore.readMigrationVersion();
      if (migrationState === AUTH_TOKEN_SIGNED_OUT_STATE) {
        // A failed native delete must not resurrect the previous session after
        // process death. A subsequent successful login replaces this tombstone.
        try {
          legacyStore.remove();
        } catch {
          // Retry plaintext cleanup on the next protected-store read.
        }
        return null;
      }

      let protectedToken: string | null;
      try {
        protectedToken = await protectedStore.read();
      } catch {
        return null;
      }
      if (!canCommit()) {
        return null;
      }
      if (isUsableToken(protectedToken)) {
        if (migrationState !== AUTH_TOKEN_MIGRATION_VERSION) {
          let legacyProtectedCleanupFailed = false;
          if (protectedStore.deleteLegacy) {
            try {
              await protectedStore.deleteLegacy();
            } catch {
              // The versioned protected value is already authoritative. Keep
              // using it when retirement of an older protected copy is
              // temporarily unavailable; the next read retries cleanup.
              legacyProtectedCleanupFailed = true;
            }
          }
          if (!canCommit()) {
            return null;
          }
          // Remove the plaintext legacy copy independently. Do not record the
          // migration marker while either legacy store still needs cleanup;
          // otherwise a failed deletion would become invisible on relaunch.
          try {
            legacyStore.remove();
            if (!legacyProtectedCleanupFailed) {
              try {
                markMigrationComplete();
              } catch {
                // The protected value remains usable; retry the marker on
                // the next read rather than failing a valid session startup.
              }
            }
          } catch {
            // Keep returning the protected credential. The old value is not
            // an authorization source and cleanup will be retried later.
          }
        } else {
          // The native legacy item was already retired during migration. A
          // synchronous MMKV remove is still cheap and clears an interrupted
          // plaintext cleanup without touching Keychain on every read.
          try {
            legacyStore.remove();
          } catch {
            // Keep returning the protected credential; the next read can
            // retry this local cleanup.
          }
        }
        return protectedToken;
      }

      // A completed migration means the old SecureStore item is no longer an
      // authorization source. Clean a stale legacy copy without reading it.
      if (migrationState === AUTH_TOKEN_MIGRATION_VERSION) {
        try {
          legacyStore.remove();
        } catch {
          // Keep failing closed; the next read can retry cleanup.
        }
        return null;
      }

      let legacyProtectedToken: string | null = null;
      if (protectedStore.readLegacy) {
        try {
          legacyProtectedToken = await protectedStore.readLegacy();
        } catch {
          return null;
        }
        if (!canCommit()) {
          return null;
        }
      }

      if (isUsableToken(legacyProtectedToken)) {
        if (!canCommit()) {
          return null;
        }
        try {
          await protectedStore.write(legacyProtectedToken);
          const verifiedToken = await protectedStore.read();
          if (verifiedToken !== legacyProtectedToken || !canCommit()) {
            return null;
          }
          await protectedStore.deleteLegacy?.();
          if (!canCommit()) {
            return null;
          }
          removeLegacyToken();
          return verifiedToken;
        } catch {
          // Keep the old protected item for a later retry. Never fall through
          // to plaintext MMKV when this protected migration is uncertain.
          return null;
        }
      }

      // Once migration completed, an empty protected store means signed out.
      // Do not resurrect a legacy token after logout or protected-store loss.
      if (legacyStore.readMigrationVersion() === AUTH_TOKEN_MIGRATION_VERSION) {
        // A previous cleanup may have completed the marker write while the
        // legacy delete was interrupted. Remove any leftover plaintext on the
        // next read, but never return it as an authorization credential.
        try {
          legacyStore.remove();
        } catch {
          // Keep failing closed; the next read can retry cleanup.
        }
        return null;
      }

      const legacyToken = legacyStore.read();
      if (!isUsableToken(legacyToken)) {
        return null;
      }

      try {
        if (!canCommit()) {
          return null;
        }
        await protectedStore.write(legacyToken);
        if (!canCommit()) {
          return null;
        }
        const verifiedToken = await protectedStore.read();
        if (verifiedToken !== legacyToken) {
          return null;
        }
        if (!canCommit()) {
          return null;
        }
        removeLegacyToken();
        return verifiedToken;
      } catch {
        // Fail closed. The legacy token is intentionally not returned when
        // protected storage is unavailable or cannot be verified.
        return null;
      }
    },

    async write(
      token: string,
      options: { allowSignedOutRecovery?: boolean; canCommit?: () => boolean } = {},
    ): Promise<boolean> {
      if (!isUsableToken(token)) {
        throw new Error('Cannot persist an empty auth token');
      }

      if (
        legacyStore.readMigrationVersion() === AUTH_TOKEN_SIGNED_OUT_STATE &&
        !options.allowSignedOutRecovery
      ) {
        throw new Error('Refusing to persist auth token after logout without a new login');
      }

      const canCommit = options.canCommit ?? ((): boolean => true);
      if (!canCommit()) {
        return false;
      }

      await protectedStore.write(token);
      const verifiedToken = await protectedStore.read();
      if (verifiedToken !== token) {
        throw new Error('Protected auth token verification failed');
      }
      if (!canCommit()) {
        return false;
      }
      await protectedStore.deleteLegacy?.();
      if (!canCommit()) {
        return false;
      }

      // A successful protected write is not enough while a plaintext copy is
      // still present. Remove it before reporting persistence success.
      removeLegacyToken();
      return true;
    },

    async delete(): Promise<void> {
      let cleanupError: unknown;

      // Record intent before awaiting native storage. If the OS suspends or
      // kills the process while Keychain/Keystore deletion is blocked, a later
      // launch must still fail closed instead of restoring the old token.
      try {
        legacyStore.writeMigrationVersion(AUTH_TOKEN_SIGNED_OUT_STATE);
      } catch (error) {
        cleanupError = error;
      }

      try {
        await protectedStore.delete();
      } catch (error) {
        cleanupError ??= error;
      }

      try {
        await protectedStore.deleteLegacy?.();
      } catch (error) {
        cleanupError ??= error;
      }

      // Cleanup is independent: a protected-store failure must not leave the
      // legacy plaintext copy behind. The caller still sees the first failure.
      try {
        legacyStore.remove();
      } catch (error) {
        cleanupError ??= error;
      }

      try {
        legacyStore.writeMigrationVersion(AUTH_TOKEN_SIGNED_OUT_STATE);
      } catch (error) {
        cleanupError ??= error;
      }

      if (cleanupError) {
        throw cleanupError;
      }
    },

    markSignedOut(): void {
      legacyStore.writeMigrationVersion(AUTH_TOKEN_SIGNED_OUT_STATE);
    },

    isSignedOut(): boolean {
      return legacyStore.readMigrationVersion() === AUTH_TOKEN_SIGNED_OUT_STATE;
    },
  };
}
