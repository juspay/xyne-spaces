export type AuthTokenStore = {
  readCache: () => string | null;
  writeCache: (token: string) => void;
  deleteCache: () => void;
  readSecure: () => Promise<string | null>;
  writeSecure: (token: string) => Promise<void>;
  deleteSecure: () => Promise<void>;
  readUpgrade?: () => Promise<string | null>;
  deleteUpgrade?: () => Promise<void>;
};

export type StoredAuthToken = {
  token: string | null;
  source: 'cache' | 'secure_store' | 'none';
};

function isUsableToken(token: string | null): token is string {
  return typeof token === 'string' && token.length > 0;
}

/**
 * Reads the synchronous cache first so returning users can render immediately.
 * When an app update leaves only the SecureStore copy, restore the cache so the
 * next launch can use the same fast path.
 */
export async function readStoredAuthToken(store: AuthTokenStore): Promise<StoredAuthToken> {
  const cachedToken = store.readCache();
  if (isUsableToken(cachedToken)) {
    return { token: cachedToken, source: 'cache' };
  }

  let secureToken: string | null;
  try {
    secureToken = await store.readSecure();
  } catch {
    // A temporarily unavailable keychain must not prevent the caller from
    // attempting session-cookie recovery during an app upgrade.
    return { token: null, source: 'none' };
  }
  if (!isUsableToken(secureToken) && store.readUpgrade) {
    try {
      secureToken = await store.readUpgrade();
      if (isUsableToken(secureToken)) {
        // PR #358 used a versioned SecureStore key. Copy it into the current
        // store before removing the upgrade key so interrupted migrations are
        // safe to retry on the next launch.
        await store.writeSecure(secureToken);
        try {
          await store.deleteUpgrade?.();
        } catch {
          // The current key is durable now; stale-key cleanup can retry later.
        }
      }
    } catch {
      return { token: null, source: 'none' };
    }
  }

  if (!isUsableToken(secureToken)) {
    return { token: null, source: 'none' };
  }

  try {
    store.writeCache(secureToken);
  } catch {
    // The secure token is still valid for this launch. A later write or launch
    // can retry repairing the synchronous cache.
  }
  return { token: secureToken, source: 'secure_store' };
}

/** Keep both persistence paths in sync across binary and storage migrations. */
export async function writeStoredAuthToken(store: AuthTokenStore, token: string): Promise<void> {
  if (!isUsableToken(token)) {
    throw new Error('Cannot persist an empty auth token');
  }

  store.writeCache(token);
  await store.writeSecure(token);
  try {
    await store.deleteUpgrade?.();
  } catch {
    // Both current stores contain the new token, so stale-key cleanup is best effort.
  }
}

export async function deleteStoredAuthToken(store: AuthTokenStore): Promise<void> {
  let cleanupError: unknown;
  try {
    store.deleteCache();
  } catch (error) {
    cleanupError = error;
  }

  try {
    await store.deleteSecure();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await store.deleteUpgrade?.();
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}
