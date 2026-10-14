import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deleteStoredAuthToken,
  readStoredAuthToken,
  writeStoredAuthToken,
  type AuthTokenStore,
} from '@/src/services/authTokenPersistence';

function createStore(
  values: { cache?: string | null; secure?: string | null; upgrade?: string | null } = {},
): {
  store: AuthTokenStore;
  state: { cache: string | null; secure: string | null; upgrade: string | null };
} {
  const state = {
    cache: values.cache ?? null,
    secure: values.secure ?? null,
    upgrade: values.upgrade ?? null,
  };
  return {
    state,
    store: {
      readCache: () => state.cache,
      writeCache: token => {
        state.cache = token;
      },
      deleteCache: () => {
        state.cache = null;
      },
      readSecure: async () => state.secure,
      writeSecure: async token => {
        state.secure = token;
      },
      deleteSecure: async () => {
        state.secure = null;
      },
      readUpgrade: async () => state.upgrade,
      deleteUpgrade: async () => {
        state.upgrade = null;
      },
    },
  };
}

describe('auth token persistence across app updates', () => {
  it('uses the existing cache without waiting for secure storage', async () => {
    const { store } = createStore({ cache: 'cached-token', secure: 'secure-token' });

    assert.deepEqual(await readStoredAuthToken(store), {
      token: 'cached-token',
      source: 'cache',
    });
  });

  it('restores the startup cache when an update leaves only the SecureStore token', async () => {
    const { store, state } = createStore({ secure: 'secure-token' });

    assert.deepEqual(await readStoredAuthToken(store), {
      token: 'secure-token',
      source: 'secure_store',
    });
    assert.equal(state.cache, 'secure-token');
  });

  it('migrates the protected token written by PR #358 builds', async () => {
    const { store, state } = createStore({ upgrade: 'v2-token' });

    assert.deepEqual(await readStoredAuthToken(store), {
      token: 'v2-token',
      source: 'secure_store',
    });
    assert.deepEqual(state, { cache: 'v2-token', secure: 'v2-token', upgrade: null });
  });

  it('keeps the PR #358 token when migration to the current key fails', async () => {
    const { store, state } = createStore({ upgrade: 'v2-token' });
    store.writeSecure = async () => {
      throw new Error('keychain write failed');
    };

    assert.deepEqual(await readStoredAuthToken(store), { token: null, source: 'none' });
    assert.equal(state.upgrade, 'v2-token');
  });

  it('keeps the migrated session when stale v2-key cleanup fails', async () => {
    const { store, state } = createStore({ upgrade: 'v2-token' });
    store.deleteUpgrade = async () => {
      throw new Error('cleanup failed');
    };

    assert.deepEqual(await readStoredAuthToken(store), {
      token: 'v2-token',
      source: 'secure_store',
    });
    assert.equal(state.cache, 'v2-token');
    assert.equal(state.secure, 'v2-token');
  });

  it('returns no local token when SecureStore is temporarily unavailable', async () => {
    const { store } = createStore();
    store.readSecure = async () => {
      throw new Error('keychain unavailable');
    };

    assert.deepEqual(await readStoredAuthToken(store), { token: null, source: 'none' });
  });

  it('uses the secure token even if repairing the startup cache fails', async () => {
    const { store } = createStore({ secure: 'secure-token' });
    store.writeCache = () => {
      throw new Error('cache unavailable');
    };

    assert.deepEqual(await readStoredAuthToken(store), {
      token: 'secure-token',
      source: 'secure_store',
    });
  });

  it('writes and deletes both copies together', async () => {
    const { store, state } = createStore();

    await writeStoredAuthToken(store, 'new-token');
    assert.deepEqual(state, { cache: 'new-token', secure: 'new-token', upgrade: null });

    await deleteStoredAuthToken(store);
    assert.deepEqual(state, { cache: null, secure: null, upgrade: null });
  });

  it('rejects empty tokens instead of persisting an unusable session', async () => {
    const { store } = createStore();
    await assert.rejects(writeStoredAuthToken(store, ''), /empty auth token/);
  });

  it('attempts secure cleanup even if cache cleanup fails', async () => {
    const { store, state } = createStore({
      cache: 'cached-token',
      secure: 'secure-token',
      upgrade: 'v2-token',
    });
    store.deleteCache = () => {
      throw new Error('cache cleanup failed');
    };

    await assert.rejects(deleteStoredAuthToken(store), /cache cleanup failed/);
    assert.equal(state.secure, null);
    assert.equal(state.upgrade, null);
  });
});
