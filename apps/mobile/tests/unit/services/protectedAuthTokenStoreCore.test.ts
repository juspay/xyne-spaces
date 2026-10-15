import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTH_TOKEN_MIGRATION_VERSION,
  AUTH_TOKEN_SIGNED_OUT_STATE,
  createProtectedAuthTokenStore,
} from '@/src/services/protectedAuthTokenStoreCore';

type FakeStores = {
  protectedToken: string | null;
  legacyProtectedToken?: string | null;
  legacyToken: string | null;
  migrationVersion: string | null;
  protectedReadError?: Error;
  protectedWriteError?: Error;
  protectedDeleteError?: Error;
  legacyProtectedDeleteError?: Error;
  legacyRemoveError?: Error;
  protectedReadCount: number;
  protectedWriteCount: number;
  protectedDeleteCount: number;
  legacyProtectedDeleteCount: number;
  legacyRemoveCount: number;
  migrationWriteCount: number;
};

function makeStore(initial: Partial<FakeStores> = {}) {
  const state: FakeStores = {
    protectedToken: null,
    legacyProtectedToken: null,
    legacyToken: null,
    migrationVersion: null,
    protectedReadCount: 0,
    protectedWriteCount: 0,
    protectedDeleteCount: 0,
    legacyProtectedDeleteCount: 0,
    legacyRemoveCount: 0,
    migrationWriteCount: 0,
    ...initial,
  };

  const store = createProtectedAuthTokenStore(
    {
      read: async () => {
        state.protectedReadCount += 1;
        if (state.protectedReadError) throw state.protectedReadError;
        return state.protectedToken;
      },
      write: async token => {
        state.protectedWriteCount += 1;
        if (state.protectedWriteError) throw state.protectedWriteError;
        state.protectedToken = token;
      },
      delete: async () => {
        state.protectedDeleteCount += 1;
        if (state.protectedDeleteError) throw state.protectedDeleteError;
        state.protectedToken = null;
      },
      readLegacy: async () => state.legacyProtectedToken ?? null,
      deleteLegacy: async () => {
        state.legacyProtectedDeleteCount += 1;
        if (state.legacyProtectedDeleteError) throw state.legacyProtectedDeleteError;
        state.legacyProtectedToken = null;
      },
    },
    {
      read: () => state.legacyToken,
      remove: () => {
        state.legacyRemoveCount += 1;
        if (state.legacyRemoveError) throw state.legacyRemoveError;
        state.legacyToken = null;
      },
      readMigrationVersion: () => state.migrationVersion,
      writeMigrationVersion: version => {
        state.migrationWriteCount += 1;
        state.migrationVersion = version;
      },
    },
  );

  return { state, store };
}

describe('protected auth token storage policy', (): void => {
  it('uses the protected value and removes a stale legacy copy', async (): Promise<void> => {
    const { state, store } = makeStore({ protectedToken: 'protected', legacyToken: 'legacy' });

    assert.equal(await store.read(), 'protected');
    assert.equal(state.legacyToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_MIGRATION_VERSION);
    assert.equal(state.protectedWriteCount, 0);
  });

  it('migrates legacy storage only after write/read verification', async (): Promise<void> => {
    const { state, store } = makeStore({ legacyToken: 'legacy' });

    assert.equal(await store.read(), 'legacy');
    assert.equal(state.protectedToken, 'legacy');
    assert.equal(state.legacyToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_MIGRATION_VERSION);
    assert.equal(state.protectedWriteCount, 1);

    // A second read is idempotent and never consults a removed legacy token.
    assert.equal(await store.read(), 'legacy');
    assert.equal(state.protectedWriteCount, 1);
  });

  it('migrates the previous protected key to the versioned key before deleting it', async (): Promise<void> => {
    const { state, store } = makeStore({ legacyProtectedToken: 'old-secure' });

    assert.equal(await store.read(), 'old-secure');
    assert.equal(state.protectedToken, 'old-secure');
    assert.equal(state.legacyProtectedToken, null);
    assert.equal(state.legacyProtectedDeleteCount, 1);
  });

  it('keeps a valid protected token usable when old protected cleanup fails', async (): Promise<void> => {
    const { state, store } = makeStore({
      protectedToken: 'current',
      legacyProtectedToken: 'old-secure',
      legacyToken: 'old-plaintext',
      legacyProtectedDeleteError: new Error('old secure item unavailable'),
    });

    assert.equal(await store.read(), 'current');
    assert.equal(state.legacyProtectedToken, 'old-secure');
    assert.equal(state.legacyToken, null);
    assert.equal(state.migrationVersion, null);
  });

  it('retries old protected cleanup before completing migration', async (): Promise<void> => {
    const { state, store } = makeStore({
      protectedToken: 'current',
      legacyProtectedToken: 'old-secure',
      legacyProtectedDeleteError: new Error('temporary unavailability'),
    });

    assert.equal(await store.read(), 'current');
    delete state.legacyProtectedDeleteError;

    assert.equal(await store.read(), 'current');
    assert.equal(state.legacyProtectedToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_MIGRATION_VERSION);
  });

  it('keeps a valid protected token usable when plaintext cleanup is temporarily unavailable', async (): Promise<void> => {
    const { state, store } = makeStore({
      protectedToken: 'current',
      legacyToken: 'old-plaintext',
      legacyRemoveError: new Error('MMKV unavailable'),
    });

    assert.equal(await store.read(), 'current');
    assert.equal(state.legacyToken, 'old-plaintext');
    assert.equal(state.migrationVersion, null);
  });

  it('retries plaintext cleanup before completing migration', async (): Promise<void> => {
    const { state, store } = makeStore({
      protectedToken: 'current',
      legacyToken: 'old-plaintext',
      legacyRemoveError: new Error('temporary unavailability'),
    });

    assert.equal(await store.read(), 'current');
    delete state.legacyRemoveError;

    assert.equal(await store.read(), 'current');
    assert.equal(state.legacyToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_MIGRATION_VERSION);
  });

  it('does not fall back to the previous protected key after migration completed', async (): Promise<void> => {
    const { state, store } = makeStore({
      migrationVersion: AUTH_TOKEN_MIGRATION_VERSION,
      legacyProtectedToken: 'outgoing-old',
    });

    assert.equal(await store.read(), null);
    assert.equal(state.protectedToken, null);
    assert.equal(state.legacyProtectedToken, 'outgoing-old');
    assert.equal(state.legacyProtectedDeleteCount, 0);
  });

  it('fails closed and keeps legacy data for retry when protected storage fails', async (): Promise<void> => {
    const { state, store } = makeStore({
      legacyToken: 'legacy',
      protectedWriteError: new Error('keystore unavailable'),
    });

    assert.equal(await store.read(), null);
    assert.equal(state.legacyToken, 'legacy');
    assert.equal(state.migrationVersion, null);
  });

  it('does not resurrect legacy data after migration is complete', async (): Promise<void> => {
    const { state, store } = makeStore({
      migrationVersion: AUTH_TOKEN_MIGRATION_VERSION,
      legacyToken: 'stale',
    });

    assert.equal(await store.read(), null);
    assert.equal(state.legacyToken, null);
    assert.equal(state.legacyRemoveCount, 1);
  });

  it('verifies new writes before removing legacy data', async (): Promise<void> => {
    const { state, store } = makeStore({ legacyToken: 'old' });

    await store.write('new', { allowSignedOutRecovery: true });
    assert.equal(state.protectedToken, 'new');
    assert.equal(state.legacyToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_MIGRATION_VERSION);
  });

  it('does not clear the signed-out barrier for a non-login persistence attempt', async (): Promise<void> => {
    const { state, store } = makeStore({
      migrationVersion: AUTH_TOKEN_SIGNED_OUT_STATE,
    });

    await assert.rejects(store.write('cookie-token'), /without a new login/);
    assert.equal(state.protectedToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_SIGNED_OUT_STATE);
  });

  it('removes legacy data even when protected deletion fails', async (): Promise<void> => {
    const error = new Error('keychain delete failed');
    const { state, store } = makeStore({
      protectedToken: 'token',
      legacyToken: 'legacy',
      protectedDeleteError: error,
    });

    await assert.rejects(store.delete(), error);
    assert.equal(state.legacyToken, null);
    assert.equal(state.migrationVersion, AUTH_TOKEN_SIGNED_OUT_STATE);
    // The failed native delete left the protected value behind, but the
    // signed-out tombstone prevents it from being restored on relaunch.
    assert.equal(await store.read(), null);
  });

  it('writes signed-out intent before a slow protected deletion starts', async (): Promise<void> => {
    let releaseDelete: (() => void) | undefined;
    const state: {
      protectedToken: string;
      legacyToken: string | null;
      migrationVersion: string | null;
    } = {
      protectedToken: 'old',
      legacyToken: 'legacy',
      migrationVersion: null as string | null,
    };
    const store = createProtectedAuthTokenStore(
      {
        read: async () => state.protectedToken,
        write: async token => {
          state.protectedToken = token;
        },
        delete: () =>
          new Promise<void>(resolve => {
            releaseDelete = resolve;
          }),
      },
      {
        read: () => state.legacyToken,
        remove: () => {
          state.legacyToken = null;
        },
        readMigrationVersion: () => state.migrationVersion,
        writeMigrationVersion: version => {
          state.migrationVersion = version;
        },
      },
    );

    const deletion = store.delete();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(state.migrationVersion, AUTH_TOKEN_SIGNED_OUT_STATE);
    releaseDelete?.();
    await deletion;
    assert.equal(state.legacyToken, null);
  });

  it('clears a signed-out tombstone only after a new protected write', async (): Promise<void> => {
    const { state, store } = makeStore({
      protectedToken: 'old',
      migrationVersion: AUTH_TOKEN_SIGNED_OUT_STATE,
    });

    assert.equal(await store.read(), null);
    await store.write('new', { allowSignedOutRecovery: true });
    assert.equal(await store.read(), 'new');
    assert.equal(state.migrationVersion, AUTH_TOKEN_MIGRATION_VERSION);
  });
});
