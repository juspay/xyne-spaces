import * as SecureStore from 'expo-secure-store';

import { deleteKeys, getString, setString } from './localStorage';
import {
  enqueueAuthStoreMutation,
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
  trackAuthSessionOperation,
} from './authSessionLifecycle';
import {
  AUTH_TOKEN_SIGNED_OUT_STATE,
  createProtectedAuthTokenStore,
  type LegacyTokenStore,
  type ProtectedTokenStore,
} from './protectedAuthTokenStoreCore';

export type PersistStoredAuthTokenOptions = {
  allowSignedOutRecovery?: boolean;
  onPersisted?: () => void | Promise<void>;
};

export type DeleteStoredAuthTokenOptions = {
  onDeleted?: () => void | Promise<void>;
};

/** Legacy MMKV and pre-migration SecureStore key. */
export const AUTH_TOKEN_KEY = 'lotus_auth_token';
/** Versioned key ensures newly written iOS items receive the requested ACL. */
export const PROTECTED_AUTH_TOKEN_KEY = 'lotus_auth_token_v2';
export const AUTH_TOKEN_MIGRATION_KEY = 'lotus_auth_token_secure_store_migration';
/** Shared, non-secret logout tombstone read by the notification extension. */
export const AUTH_TOKEN_SIGNED_OUT_HANDOFF_KEY = 'lotus_auth_token_signed_out';

/**
 * Newly written tokens remain available to the app after the first unlock so
 * ordinary background refresh can continue, and are not migrated through
 * device backup. The versioned key is intentional: SecureStore does not
 * rewrite the accessibility attribute when updating an existing key.
 * The notification extension does not consume this app-only item; it receives
 * a separate platform-protected handoff through AuthContextModule.
 */
export const AUTH_TOKEN_SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const protectedStore: ProtectedTokenStore = {
  read: () => SecureStore.getItemAsync(PROTECTED_AUTH_TOKEN_KEY, AUTH_TOKEN_SECURE_STORE_OPTIONS),
  write: token =>
    SecureStore.setItemAsync(PROTECTED_AUTH_TOKEN_KEY, token, AUTH_TOKEN_SECURE_STORE_OPTIONS),
  delete: () =>
    SecureStore.deleteItemAsync(PROTECTED_AUTH_TOKEN_KEY, AUTH_TOKEN_SECURE_STORE_OPTIONS),
  readLegacy: () => SecureStore.getItemAsync(AUTH_TOKEN_KEY),
  deleteLegacy: () => SecureStore.deleteItemAsync(AUTH_TOKEN_KEY),
};

const legacyStore: LegacyTokenStore = {
  read: () => getString(AUTH_TOKEN_KEY),
  remove: () => deleteKeys([AUTH_TOKEN_KEY]),
  readMigrationVersion: () => getString(AUTH_TOKEN_MIGRATION_KEY),
  writeMigrationVersion: version => setString(AUTH_TOKEN_MIGRATION_KEY, version),
};

const tokenStore = createProtectedAuthTokenStore(protectedStore, legacyStore);
let processSignedOut = false;

export function isStoredAuthTokenSignedOut(): boolean {
  if (processSignedOut) {
    return true;
  }
  try {
    return tokenStore.isSignedOut();
  } catch {
    // If the durable state cannot be read, do not allow a cookie to revive a
    // session whose logout intent may already have been recorded.
    return true;
  }
}

export function markStoredAuthTokenSignedOut(): void {
  processSignedOut = true;
  let firstError: unknown;
  try {
    tokenStore.markSignedOut();
  } catch (error) {
    firstError = error;
  }
  try {
    setString(AUTH_TOKEN_SIGNED_OUT_HANDOFF_KEY, AUTH_TOKEN_SIGNED_OUT_STATE);
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}

export async function getStoredAuthToken(
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<string | null> {
  if (!isAuthScopeCurrent(generation, operation) || processSignedOut) {
    return null;
  }

  let token: string | null = null;
  await trackAuthSessionOperation(
    generation,
    enqueueAuthStoreMutation(
      generation,
      async (): Promise<void> => {
        if (processSignedOut) {
          return;
        }
        token = await tokenStore.read(
          () => isAuthScopeCurrent(generation, operation) && !processSignedOut,
        );
      },
      () => isAuthScopeCurrent(generation, operation),
    ),
  );
  return isAuthScopeCurrent(generation, operation) && !processSignedOut ? token : null;
}

export async function persistStoredAuthToken(
  token: string,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
  options: PersistStoredAuthTokenOptions = {},
): Promise<boolean> {
  if (
    !isAuthScopeCurrent(generation, operation) ||
    (processSignedOut && !options.allowSignedOutRecovery)
  ) {
    return false;
  }

  let committed = false;
  await trackAuthSessionOperation(
    generation,
    enqueueAuthStoreMutation(
      generation,
      async (): Promise<void> => {
        if (processSignedOut && !options.allowSignedOutRecovery) {
          return;
        }
        committed = await tokenStore.write(token, {
          ...(options.allowSignedOutRecovery !== undefined
            ? { allowSignedOutRecovery: options.allowSignedOutRecovery }
            : {}),
          canCommit: () =>
            isAuthScopeCurrent(generation, operation) &&
            (!processSignedOut || Boolean(options.allowSignedOutRecovery)),
        });
        if (!committed) {
          return;
        }
        if (
          !isAuthScopeCurrent(generation, operation) ||
          (processSignedOut && !options.allowSignedOutRecovery)
        ) {
          committed = false;
          return;
        }
        if (options.allowSignedOutRecovery) {
          processSignedOut = false;
        }
        // A protected token is authoritative again after a successful login.
        // Clear only the separate shared tombstone; the canonical migration
        // marker remains process-local and is managed by the state machine.
        deleteKeys([AUTH_TOKEN_SIGNED_OUT_HANDOFF_KEY]);
        await options.onPersisted?.();
      },
      () => isAuthScopeCurrent(generation, operation),
    ),
  );
  return committed && isAuthScopeCurrent(generation, operation);
}

export async function deleteStoredAuthToken(
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
  options: DeleteStoredAuthTokenOptions = {},
): Promise<void> {
  if (!isAuthScopeCurrent(generation, operation)) {
    return;
  }

  // Mark logout before entering the shared queue. A stalled earlier native
  // operation must not delay the durable barrier that prevents resurrection.
  let cleanupError: unknown;
  try {
    processSignedOut = true;
    markStoredAuthTokenSignedOut();
  } catch (error) {
    cleanupError = error;
  }

  let nativeCleanupError: unknown;
  try {
    await options.onDeleted?.();
  } catch (error) {
    nativeCleanupError = error;
  }

  try {
    await trackAuthSessionOperation(
      generation,
      enqueueAuthStoreMutation(
        generation,
        async (): Promise<void> => {
          await tokenStore.delete();
        },
        () => isAuthScopeCurrent(generation, operation),
      ),
    );
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError || nativeCleanupError) {
    throw cleanupError ?? nativeCleanupError;
  }
}
